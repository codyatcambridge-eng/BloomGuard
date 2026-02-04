import { useState, useEffect, useCallback, useRef } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as nsfwjs from 'nsfwjs';

export interface ModerationPrediction {
  className: string;
  probability: number;
}

export type ModerationReason = 
  | 'neutral_fastpass' 
  | 'threshold_hit' 
  | 'threshold_safe'
  | 'fail_open_timeout' 
  | 'fail_open_error'
  | 'fail_open_tiny'
  | 'model_not_ready'
  | 'human_centric_safe'
  | 'swimwear_detected';

export interface ModerationResult {
  isExplicit: boolean;
  shouldBlur: boolean;
  predictions: ModerationPrediction[];
  dominantClass: string;
  confidence: number;
  inferenceTime: number;
  reason: ModerationReason;
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
 * Neutral fast-pass threshold - if Neutral > this, immediately return safe
 */
const NEUTRAL_FASTPASS_THRESHOLD = 0.85;

/**
 * Swimwear/shirtless detection threshold - Sexy must exceed this
 * AND skin-density must be high (no Clothing signal)
 */
const SWIMWEAR_SEXY_THRESHOLD = 0.30;

/**
 * Minimum skin density to trigger swimwear detection
 * This is estimated from lack of "Neutral" + "Drawing" signals
 */
const MIN_SKIN_DENSITY_FOR_SWIMWEAR = 0.20;

/**
 * Fast timeout for fail-open behavior (ms)
 */
const FAST_TIMEOUT_MS = 800;

/**
 * Minimum image dimensions - smaller images fail-open
 */
const MIN_IMAGE_DIMENSION = 60;

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
          console.log('[OnDeviceAI] NSFWJS model loaded successfully');
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

  /**
   * Classify a single image with multi-parameter conditional logic and FAIL-OPEN behavior
   */
  const classifyImage = useCallback(async (
    imageSource: HTMLImageElement | HTMLCanvasElement | string,
    thresholds: AIThresholds = DEFAULT_THRESHOLDS
  ): Promise<ModerationResult | null> => {
    // FAIL-OPEN: Return null (no blur) if model isn't ready
    if (modelState !== 'ready' || !modelRef.current) {
      if (modelState === 'error') {
        console.debug('[OnDeviceAI] Model unavailable, fail-open: no blur');
      } else {
        console.warn('[OnDeviceAI] Model not ready, state:', modelState);
      }
      return null;
    }

    const startTime = performance.now();
    const LOAD_TIMEOUT = 8000;

    try {
      let image: HTMLImageElement | HTMLCanvasElement;
      let cacheKey = '';

      // Handle string URL input
      if (typeof imageSource === 'string') {
        cacheKey = imageSource;
        
        // Check cache first
        if (imageCache.current.has(cacheKey)) {
          return imageCache.current.get(cacheKey)!;
        }

        // Load image from URL with timeout
        image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          
          const timeout = setTimeout(() => {
            img.src = '';
            reject(new Error('Image load timeout'));
          }, LOAD_TIMEOUT);
          
          img.onload = () => {
            clearTimeout(timeout);
            // FAIL-OPEN: Skip tiny images (< 60x60)
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
        
        // Check dimensions for HTMLImageElement
        if (image instanceof HTMLImageElement) {
          if (image.naturalWidth < MIN_IMAGE_DIMENSION || image.naturalHeight < MIN_IMAGE_DIMENSION) {
            console.debug('[OnDeviceAI] fail_open_tiny: dimensions', image.naturalWidth, 'x', image.naturalHeight);
            return {
              isExplicit: false,
              shouldBlur: false,
              predictions: [],
              dominantClass: 'Unknown',
              confidence: 0,
              inferenceTime: performance.now() - startTime,
              reason: 'fail_open_tiny',
            };
          }
        }
      }

      // Run classification with FAST timeout (800ms) - FAIL-OPEN
      const classifyPromise = modelRef.current.classify(image);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Classification timeout')), FAST_TIMEOUT_MS);
      });
      
      const predictions = await Promise.race([classifyPromise, timeoutPromise]);
      const inferenceTime = performance.now() - startTime;

      // Build prediction map and formatted predictions
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

      // ==== PRIMARY FILTER: Neutral Fast-pass ====
      // If Neutral > 0.85, immediately return safe
      if (neutralScore > NEUTRAL_FASTPASS_THRESHOLD) {
        const result: ModerationResult = {
          isExplicit: false,
          shouldBlur: false,
          predictions: formattedPredictions,
          dominantClass: 'Neutral',
          confidence: neutralScore,
          inferenceTime,
          reason: 'neutral_fastpass',
        };

        if (cacheKey) {
          imageCache.current.set(cacheKey, result);
          limitCache();
        }

        console.debug('[OnDeviceAI] neutral_fastpass:', neutralScore.toFixed(2));
        return result;
      }

      // ==== Estimate signals for human-centric logic ====
      const signals = estimateSignals(formattedPredictions);

      // ==== STRICT THRESHOLD PARAMETERS ====
      // Blur if ANY threshold is exceeded - no human-centric bypass
      const hasExplicitScore = pornScore > thresholds.porn || sexyScore > thresholds.sexy || hentaiScore > thresholds.hentai;
      const signals_unused = signals; // Keep for debugging but don't gate on it

      // ==== SWIMWEAR/SHIRTLESS LOGIC ====
      // If Sexy > 0.55 AND high skin-density (no clothing), mark as unsafe
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

      // ==== STANDARD THRESHOLD CHECK (STRICT - no human signal requirement) ====
      const isExplicit = pornScore > thresholds.porn || hentaiScore > thresholds.hentai;
      const shouldBlur = isExplicit || sexyScore > thresholds.sexy || hasExplicitScore;

      // Find dominant class
      const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
      const dominantClass = sorted[0]?.className || 'Unknown';
      const confidence = sorted[0]?.probability || 0;

      const reason: ModerationReason = shouldBlur ? 'threshold_hit' : 'threshold_safe';

      // === CONSOLE LOGGING FOR XCODE DEBUG ===
      if (sexyScore > 0.05) {
        console.log(`[OnDeviceAI] SEXY DETECTED: ${(sexyScore * 100).toFixed(1)}% (threshold: ${(thresholds.sexy * 100).toFixed(0)}%)`);
      }
      if (pornScore > 0.05) {
        console.log(`[OnDeviceAI] PORN DETECTED: ${(pornScore * 100).toFixed(1)}% (threshold: ${(thresholds.porn * 100).toFixed(0)}%)`);
      }
      if (shouldBlur) {
        console.log(`[OnDeviceAI] >>> BLUR APPLIED <<< category=${dominantClass}, sexy=${(sexyScore * 100).toFixed(1)}%, porn=${(pornScore * 100).toFixed(1)}%`);
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
      const inferenceTime = performance.now() - startTime;
      
      // FAIL-OPEN: Return shouldBlur=false on any error or timeout
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
        shouldBlur: false,
        predictions: [],
        dominantClass: 'Unknown',
        confidence: 0,
        inferenceTime,
        reason,
      };
    }
  }, [modelState]);

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
