import { Capacitor } from '@capacitor/core';
import { useState, useEffect, useCallback, useRef } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as nsfwjs from 'nsfwjs';
import { ContentFilter, imageSourceToBase64 } from '@/plugins/ContentFilter';

export interface ModerationPrediction {
  className: string;
  probability: number;
}

export type ModerationReason = 
  | 'threshold_hit' 
  | 'threshold_safe'
  | 'fail_open_timeout' 
  | 'fail_open_error'
  | 'fail_open_tiny'
  | 'model_not_ready'
  | 'swimwear_detected';

export interface ModerationResult {
  isExplicit: boolean;
  shouldBlur: boolean;
  predictions: ModerationPrediction[];
  dominantClass: string;
  confidence: number;
  inferenceTime: number;
  reason: ModerationReason;
  errorCode?: string;
  /** Detected signals for debugging */
  signals?: {
    hasHumanBody: boolean;
    hasSkinExposure: boolean;
    hasClothing: boolean;
    skinDensity: number;
  };
}

export interface AIThresholds {
  porn: number;
  sexy: number;
  hentai: number;
}

/**
 * Multi-parameter thresholds for refined detection
 */
export const DEFAULT_THRESHOLDS: AIThresholds = { 
  porn: 0.10, 
  sexy: 0.20, 
  hentai: 0.10 
};


/**
 * Swimwear/shirtless detection threshold - Sexy must exceed this
 * AND skin-density must be high (no Clothing signal)
 */
const SWIMWEAR_SEXY_THRESHOLD = 0.55;

/**
 * Minimum skin density to trigger swimwear detection
 * This is estimated from lack of "Neutral" + "Drawing" signals
 */
const MIN_SKIN_DENSITY_FOR_SWIMWEAR = 0.35;

/**
 * Neutral confidence floor used to avoid over-blurring benign content.
 */
const NEUTRAL_FAST_PASS_THRESHOLD = 0.80;

/**
 * Fast timeout for fail-open behavior (ms)
 */
const FAST_TIMEOUT_MS = 3000;

/**
 * Minimum image dimensions - smaller images fail-open
 */
const MIN_IMAGE_DIMENSION = 60;

const EXPECTED_NATIVE_LABELS = ['Porn', 'Sexy', 'Hentai', 'Neutral', 'Drawing'];

const normalizeNativePredictions = (
  raw: Record<string, number> | undefined,
): Record<string, number> => {
  const lowerMap: Record<string, number> = {};
  Object.entries(raw ?? {}).forEach(([key, value]) => {
    lowerMap[key.toLowerCase()] = Number(value) || 0;
  });
  return EXPECTED_NATIVE_LABELS.reduce((acc, label) => {
    acc[label] = lowerMap[label.toLowerCase()] ?? 0;
    return acc;
  }, {} as Record<string, number>);
};

type ModelLoadingState = 'idle' | 'loading' | 'ready' | 'error';

// Singleton pattern for the model - load once, use everywhere
let globalModel: nsfwjs.NSFWJS | null = null;
let globalModelPromise: Promise<nsfwjs.NSFWJS> | null = null;

const loadModel = async (): Promise<nsfwjs.NSFWJS> => {
  if (globalModel) return globalModel;
  if (globalModelPromise) return globalModelPromise;

  globalModelPromise = (async () => {
    await tf.ready();
    await tf.setBackend('webgl');
    const model = await nsfwjs.load();
    globalModel = model;
    return model;
  })();

  return globalModelPromise;
};

/**
 * Estimate "signals" from NSFWJS predictions
 * Since NSFWJS doesn't directly output body parts, we infer from class distributions
 */
function estimateSignals(predictions: ModerationPrediction[]): {
  hasHumanBody: boolean;
  hasSkinExposure: boolean;
  hasClothing: boolean;
  skinDensity: number;
} {
  const predMap: Record<string, number> = {};
  predictions.forEach(p => {
    predMap[p.className.toLowerCase()] = p.probability;
  });

  const porn = predMap['porn'] || 0;
  const sexy = predMap['sexy'] || 0;
  const hentai = predMap['hentai'] || 0;
  const neutral = predMap['neutral'] || 0;
  const drawing = predMap['drawing'] || 0;

  // Infer human body presence from sexy/porn scores
  // If Sexy or Porn > 0.15, likely has human body
  const hasHumanBody = (sexy > 0.15 || porn > 0.15);

  // Infer skin exposure from sexy score
  // Higher sexy = more skin exposure
  const hasSkinExposure = sexy > 0.25;

  // Infer clothing presence from neutral score
  // Higher neutral = more likely clothed
  const hasClothing = neutral > 0.50;

  // Skin density: inverse of (neutral + drawing), clamped
  // Higher = more exposed skin
  const clothingSignal = neutral + drawing;
  const skinDensity = Math.max(0, Math.min(1, 1 - clothingSignal));

  return {
    hasHumanBody,
    hasSkinExposure,
    hasClothing,
    skinDensity,
  };
}

export const useOnDeviceModeration = () => {
  const [modelState, setModelState] = useState<ModelLoadingState>('idle');
  const [error, setError] = useState<string | null>(null);
  const modelRef = useRef<nsfwjs.NSFWJS | null>(null);
  const imageCache = useRef<Map<string, ModerationResult>>(new Map());
  const initAttempted = useRef(false);
  const nativeModelReadyRef = useRef(false);

  // Load model on mount with graceful error handling
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      if (initAttempted.current) return;
      initAttempted.current = true;
      
      setModelState('loading');
      
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) {
          throw new Error('WebGL not supported');
        }
        
        const model = await loadModel();
        if (mounted) {
          modelRef.current = model;
          setModelState('ready');
          console.debug('[OnDeviceAI] NSFWJS model loaded successfully');
        }
      } catch (err) {
        if (mounted) {
          const errorMsg = err instanceof Error ? err.message : 'Failed to load AI model';
          setError(errorMsg);
          setModelState('error');
          console.error('[OnDeviceAI] Failed to load model:', err);
        }
      }
    };

    init();
    return () => { mounted = false; };
  }, []);

  const refreshNativeReady = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      nativeModelReadyRef.current = false;
      return;
    }
    try {
      const state = await ContentFilter.isModelReady();
      nativeModelReadyRef.current = Boolean(state.ready);
    } catch {
      nativeModelReadyRef.current = false;
    }
  }, []);

  useEffect(() => {
    refreshNativeReady();
  }, [refreshNativeReady]);

  /**
   * Classify a single image with multi-parameter conditional logic and FAIL-OPEN behavior
   */
  const classifyImage = useCallback(async (
    imageSource: HTMLImageElement | HTMLCanvasElement | string,
    thresholds: AIThresholds = DEFAULT_THRESHOLDS
  ): Promise<ModerationResult | null> => {
    if (modelState !== 'ready' || !modelRef.current) {
      if (modelState === 'error') {
        console.debug('[OnDeviceAI] Model unavailable, fail-open: no blur');
      } else {
        console.warn('[OnDeviceAI] Model not ready, state:', modelState);
      }
      return null;
    }

    const LOAD_TIMEOUT = 8000;
    const loadStart = performance.now();

    try {
      let image: HTMLImageElement | HTMLCanvasElement;
      let cacheKey = '';

      // Handle string URL input
      if (typeof imageSource === 'string') {
        cacheKey = imageSource;

        if (imageCache.current.has(cacheKey)) {
          return imageCache.current.get(cacheKey)!;
        }

        image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';

          const timeout = setTimeout(() => {
            img.src = '';
            reject(new Error('Image load timeout'));
          }, LOAD_TIMEOUT);

          img.onload = () => {
            clearTimeout(timeout);
            if (img.width < MIN_IMAGE_DIMENSION || img.height < MIN_IMAGE_DIMENSION) {
              reject(new Error('Image too small - fail open'));
            }
            resolve(img);
          };

          img.onerror = () => {
            clearTimeout(timeout);
            reject(new Error('Failed to load image'));
          };

          img.src = imageSource;
        });
      } else {
        image = imageSource;

        if (image instanceof HTMLImageElement) {
          if (image.naturalWidth < MIN_IMAGE_DIMENSION || image.naturalHeight < MIN_IMAGE_DIMENSION) {
            console.debug('[OnDeviceAI] fail_open_tiny: dimensions', image.naturalWidth, 'x', image.naturalHeight);
            return {
              isExplicit: false,
              shouldBlur: false,
              predictions: [],
              dominantClass: 'Unknown',
              confidence: 0,
              inferenceTime: performance.now() - loadStart,
              reason: 'fail_open_tiny',
            };
          }
        }
      }

      const runTensorFlowClassification = async () => {
        const tfStart = performance.now();
        const classifyPromise = modelRef.current!.classify(image);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Classification timeout')), FAST_TIMEOUT_MS);
        });
        const rawPredictions = await Promise.race([classifyPromise, timeoutPromise]);
        const mapped = rawPredictions.map(p => ({
          className: p.className,
          probability: p.probability,
        }));
        return {
          predictions: mapped,
          inferenceTime: performance.now() - tfStart,
        };
      };

      let predictions: ModerationPrediction[] = [];
      let inferenceTime = 0;
      const useNative = Capacitor.isNativePlatform() && nativeModelReadyRef.current;

      if (useNative) {
        try {
          const base64 = await imageSourceToBase64(image);
          const nativeStart = performance.now();
          const nativeResult = await ContentFilter.classifyImage({ imageBase64: base64 });
          inferenceTime = nativeResult.inferenceTimeMs ?? (performance.now() - nativeStart);
          const normalized = normalizeNativePredictions(nativeResult.predictions);
          predictions = EXPECTED_NATIVE_LABELS.map((label) => ({
            className: label,
            probability: normalized[label],
          }));
        } catch (nativeError) {
          console.debug('[OnDeviceAI] Native inference failed, falling back:', nativeError);
          nativeModelReadyRef.current = false;
          await refreshNativeReady();
          const fallback = await runTensorFlowClassification();
          predictions = fallback.predictions;
          inferenceTime = fallback.inferenceTime;
        }
      } else {
        const fallback = await runTensorFlowClassification();
        predictions = fallback.predictions;
        inferenceTime = fallback.inferenceTime;
      }

      const formattedPredictions: ModerationPrediction[] = predictions.map(p => ({
        className: p.className,
        probability: p.probability,
      }));

      const predMap: Record<string, number> = {};
      predictions.forEach(p => {
        predMap[p.className.toLowerCase()] = p.probability;
      });

      const pornScore = predMap['porn'] || 0;
      const sexyScore = predMap['sexy'] || 0;
      const hentaiScore = predMap['hentai'] || 0;
      const neutralScore = predMap['neutral'] || 0;

      // Neutral fast-pass: strongly neutral images should not be blurred unless explicit scores are meaningful.
      if (
        neutralScore >= NEUTRAL_FAST_PASS_THRESHOLD &&
        pornScore < thresholds.porn &&
        hentaiScore < thresholds.hentai &&
        sexyScore < Math.max(thresholds.sexy + 0.2, 0.7)
      ) {
        const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
        const dominantClass = sorted[0]?.className || 'Unknown';
        const confidence = sorted[0]?.probability || 0;
        const result: ModerationResult = {
          isExplicit: false,
          shouldBlur: false,
          predictions: formattedPredictions,
          dominantClass,
          confidence,
          inferenceTime,
          reason: 'threshold_safe',
          signals: estimateSignals(formattedPredictions),
        };

        if (cacheKey) {
          imageCache.current.set(cacheKey, result);
          limitCache();
        }

        console.debug('[OnDeviceAI] neutral_fast_pass:', neutralScore.toFixed(2));
        return result;
      }

      // ==== Estimate signals for human-centric logic ====
      const signals = estimateSignals(formattedPredictions);

      // ==== THRESHOLD PARAMETERS ====
      const pornHit = pornScore > thresholds.porn;
      const hentaiHit = hentaiScore > thresholds.hentai;
      const sexyHit = sexyScore > thresholds.sexy;

      // ==== SWIMWEAR/SHIRTLESS LOGIC ====
      // If Sexy is high and skin-density is high (with weak clothing signal), mark as unsafe.
      const isSwimwearShirtless = 
        sexyScore > SWIMWEAR_SEXY_THRESHOLD && 
        signals.skinDensity >= MIN_SKIN_DENSITY_FOR_SWIMWEAR &&
        !signals.hasClothing;

      if (isSwimwearShirtless) {
        const result: ModerationResult = {
          isExplicit: false,
          shouldBlur: true,
          predictions: formattedPredictions,
          dominantClass: 'Swimwear',
          confidence: sexyScore,
          inferenceTime,
          reason: 'swimwear_detected',
          signals,
        };

        if (cacheKey) {
          imageCache.current.set(cacheKey, result);
          limitCache();
        }

        console.debug('[OnDeviceAI] swimwear_detected: sexy=', sexyScore.toFixed(2), 'skinDensity=', signals.skinDensity.toFixed(2));
        return result;
      }

      // ==== STANDARD THRESHOLD CHECK ====
      // Sexy-only hits are ignored when the image is strongly neutral to reduce false positives.
      const isExplicit = pornHit || hentaiHit;
      const shouldBlur = isExplicit || (sexyHit && neutralScore < NEUTRAL_FAST_PASS_THRESHOLD);

      // Find dominant class
      const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
      const dominantClass = sorted[0]?.className || 'Unknown';
      const confidence = sorted[0]?.probability || 0;

      const reason: ModerationReason = shouldBlur ? 'threshold_hit' : 'threshold_safe';

      // === CONSOLE LOGGING FOR XCODE DEBUG ===
      if (sexyScore > 0.05) {
        console.debug(`[OnDeviceAI] SEXY DETECTED: ${(sexyScore * 100).toFixed(1)}% (threshold: ${(thresholds.sexy * 100).toFixed(0)}%)`);
      }
      if (pornScore > 0.05) {
        console.debug(`[OnDeviceAI] PORN DETECTED: ${(pornScore * 100).toFixed(1)}% (threshold: ${(thresholds.porn * 100).toFixed(0)}%)`);
      }
      if (shouldBlur) {
        console.debug(`[OnDeviceAI] >>> BLUR APPLIED <<< category=${dominantClass}, sexy=${(sexyScore * 100).toFixed(1)}%, porn=${(pornScore * 100).toFixed(1)}%`);
      }

      const result: ModerationResult = {
        isExplicit,
        shouldBlur,
        predictions: formattedPredictions,
        dominantClass,
        confidence,
        inferenceTime,
        reason,
        signals,
      };

      if (cacheKey) {
        imageCache.current.set(cacheKey, result);
        limitCache();
      }

      console.debug(`[OnDeviceAI] ${reason}: blur=${shouldBlur}, dom=${dominantClass}, conf=${confidence.toFixed(2)}`);
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const inferenceTime = performance.now() - loadStart;
      
      // Fail-safe: never fail-open on timeouts; apply soft blur instead.
      const isTiny = errorMsg.includes('too small');
      const isTimeout = errorMsg.includes('timeout');
      const reason: ModerationReason = isTiny 
        ? 'fail_open_tiny' 
        : isTimeout 
          ? 'fail_open_timeout' 
          : 'fail_open_error';
      
      console.debug(`[OnDeviceAI] ${reason}:`, errorMsg);
      
      return {
        isExplicit: false,
        shouldBlur: true,
        predictions: [],
        dominantClass: 'Unknown',
        confidence: 0,
        inferenceTime,
        reason,
      };
    }
  }, [modelState, refreshNativeReady]);

  // Helper to limit cache size
  const limitCache = () => {
    if (imageCache.current.size > 500) {
      const firstKey = imageCache.current.keys().next().value;
      if (firstKey) imageCache.current.delete(firstKey);
    }
  };

  // Classify multiple images in batch
  const classifyBatch = useCallback(async (
    images: string[],
    thresholds: AIThresholds = DEFAULT_THRESHOLDS
  ): Promise<Map<string, ModerationResult>> => {
    const results = new Map<string, ModerationResult>();
    const batchStart = performance.now();
    
    const concurrency = 4;
    for (let i = 0; i < images.length; i += concurrency) {
      const batch = images.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(url => classifyImage(url, thresholds))
      );
      batch.forEach((url, idx) => {
        if (batchResults[idx]) {
          results.set(url, batchResults[idx]!);
        }
      });
    }

    const latencyMs = performance.now() - batchStart;
    console.debug('[OnDeviceAI] Scan Latency:', latencyMs.toFixed(1) + 'ms');
    return results;
  }, [classifyImage]);

  // Classify from file input
  const classifyFile = useCallback(async (
    file: File,
    thresholds: AIThresholds = DEFAULT_THRESHOLDS
  ): Promise<ModerationResult | null> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        const img = new Image();
        img.onload = async () => {
          const result = await classifyImage(img, thresholds);
          resolve(result);
        };
        img.onerror = () => resolve(null);
        img.src = reader.result as string;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }, [classifyImage]);

  // Clear cache
  const clearCache = useCallback(() => {
    imageCache.current.clear();
  }, []);

  // Flush cached results on navigation changes to prevent state leakage between tabs
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let lastHref = window.location.href;

    const emitLocationChange = () => {
      window.dispatchEvent(new Event('locationchange'));
    };

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    history.pushState = function (...args) {
      const ret = originalPushState.apply(this, args as any);
      emitLocationChange();
      return ret;
    };
    history.replaceState = function (...args) {
      const ret = originalReplaceState.apply(this, args as any);
      emitLocationChange();
      return ret;
    };

    const handleLocationChange = () => {
      const current = window.location.href;
      if (current === lastHref) return;
      lastHref = current;
      imageCache.current.clear();
      console.debug('[OnDeviceAI] location_change: cache cleared; default blur reset to safe');
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    window.addEventListener('locationchange', handleLocationChange);

    return () => {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
      window.removeEventListener('locationchange', handleLocationChange);
    };
  }, []);

  return {
    modelState,
    isReady: modelState === 'ready',
    isLoading: modelState === 'loading',
    error,
    classifyImage,
    classifyBatch,
    classifyFile,
    clearCache,
    DEFAULT_THRESHOLDS,
  };
};
