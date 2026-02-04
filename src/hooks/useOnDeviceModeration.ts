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
  | 'model_not_ready';

export interface ModerationResult {
  isExplicit: boolean;
  shouldBlur: boolean;
  predictions: ModerationPrediction[];
  dominantClass: string;
  confidence: number;
  inferenceTime: number;
  reason: ModerationReason;
}

export interface AIThresholds {
  porn: number;
  sexy: number;
  hentai: number;
}

// NEW: Raised thresholds to reduce false positives
export const DEFAULT_THRESHOLDS: AIThresholds = { 
  porn: 0.60, 
  sexy: 0.75, 
  hentai: 0.60 
};

// NEW: Fast timeout for fail-open behavior
const FAST_TIMEOUT_MS = 800;

type ModelLoadingState = 'idle' | 'loading' | 'ready' | 'error';

// Singleton pattern for the model - load once, use everywhere
let globalModel: nsfwjs.NSFWJS | null = null;
let globalModelPromise: Promise<nsfwjs.NSFWJS> | null = null;

const loadModel = async (): Promise<nsfwjs.NSFWJS> => {
  if (globalModel) return globalModel;
  if (globalModelPromise) return globalModelPromise;

  globalModelPromise = (async () => {
    // Use the quantized model for faster loading and inference
    await tf.ready();
    
    // Set backend to WebGL for GPU acceleration
    await tf.setBackend('webgl');
    
    // Load the default NSFWJS model from the official URL
    // This uses the MobileNetV2 model which is ~2MB and runs fast
    const model = await nsfwjs.load();
    
    globalModel = model;
    return model;
  })();

  return globalModelPromise;
};

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
      // Prevent multiple init attempts
      if (initAttempted.current) return;
      initAttempted.current = true;
      
      setModelState('loading');
      
      try {
        // Check if WebGL is available
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
          
          // Log specific failure reason
          if (errorMsg.includes('WebGL')) {
            console.warn('[OnDeviceAI] WebGL not available - image moderation disabled');
          } else if (errorMsg.includes('fetch')) {
            console.warn('[OnDeviceAI] Could not fetch model - image moderation disabled');
          }
        }
      }
    };

    init();
    return () => { mounted = false; };
  }, []);

  // Classify a single image with FAIL-OPEN behavior
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
    const LOAD_TIMEOUT = 8000; // 8 second timeout for image loading

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
            img.src = ''; // Cancel load
            reject(new Error('Image load timeout'));
          }, LOAD_TIMEOUT);
          
          img.onload = () => {
            clearTimeout(timeout);
            // Validate image dimensions
            if (img.width < 10 || img.height < 10) {
              reject(new Error('Image too small'));
              return;
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
      }

      // NEW: Run classification with FAST timeout (800ms) - FAIL-OPEN
      const classifyPromise = modelRef.current.classify(image);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Classification timeout')), FAST_TIMEOUT_MS);
      });
      
      const predictions = await Promise.race([classifyPromise, timeoutPromise]);
      const inferenceTime = performance.now() - startTime;

      // Build prediction map (normalize to lowercase)
      const predMap: Record<string, number> = {};
      predictions.forEach(p => {
        predMap[p.className.toLowerCase()] = p.probability;
      });

      const pornScore = predMap['porn'] || 0;
      const sexyScore = predMap['sexy'] || 0;
      const hentaiScore = predMap['hentai'] || 0;
      const neutralScore = predMap['neutral'] || 0;

      // NEW: Neutral fast-pass - if Neutral >= 0.90, return safe immediately
      if (neutralScore >= 0.90) {
        const result: ModerationResult = {
          isExplicit: false,
          shouldBlur: false,
          predictions: predictions.map(p => ({
            className: p.className,
            probability: p.probability,
          })),
          dominantClass: 'Neutral',
          confidence: neutralScore,
          inferenceTime,
          reason: 'neutral_fastpass',
        };

        // Cache result
        if (cacheKey) {
          imageCache.current.set(cacheKey, result);
          limitCache();
        }

        console.debug('[OnDeviceAI] neutral_fastpass:', neutralScore.toFixed(2));
        return result;
      }

      // Check against raised thresholds
      const isExplicit = pornScore > thresholds.porn || hentaiScore > thresholds.hentai;
      const shouldBlur = isExplicit || sexyScore > thresholds.sexy;

      // Find dominant class
      const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
      const dominantClass = sorted[0]?.className || 'Unknown';
      const confidence = sorted[0]?.probability || 0;

      const reason: ModerationReason = shouldBlur ? 'threshold_hit' : 'threshold_safe';

      const result: ModerationResult = {
        isExplicit,
        shouldBlur,
        predictions: predictions.map(p => ({
          className: p.className,
          probability: p.probability,
        })),
        dominantClass,
        confidence,
        inferenceTime,
        reason,
      };

      // Cache result
      if (cacheKey) {
        imageCache.current.set(cacheKey, result);
        limitCache();
      }

      console.debug(`[OnDeviceAI] ${reason}: blur=${shouldBlur}, dom=${dominantClass}, conf=${confidence.toFixed(2)}`);
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      const inferenceTime = performance.now() - startTime;
      
      // NEW: FAIL-OPEN - Return shouldBlur=false on any error or timeout
      const isTimeout = errorMsg.includes('timeout');
      const reason: ModerationReason = isTimeout ? 'fail_open_timeout' : 'fail_open_error';
      
      console.debug(`[OnDeviceAI] ${reason}:`, errorMsg);
      
      // Return a safe result instead of null for fail-open
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
    
    // Process in parallel with concurrency limit
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
