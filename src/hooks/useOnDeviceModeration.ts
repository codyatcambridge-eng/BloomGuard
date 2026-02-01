import { useState, useEffect, useCallback, useRef } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as nsfwjs from 'nsfwjs';

export interface ModerationPrediction {
  className: string;
  probability: number;
}

export interface ModerationResult {
  isExplicit: boolean;
  shouldBlur: boolean;
  predictions: ModerationPrediction[];
  dominantClass: string;
  confidence: number;
  inferenceTime: number;
}

export interface AIThresholds {
  porn: number;
  sexy: number;
  hentai: number;
}

type ModelLoadingState = 'idle' | 'loading' | 'ready' | 'error';

// Singleton pattern for the model - load once, use everywhere
let globalModel: nsfwjs.NSFWJS | null = null;
let globalModelPromise: Promise<nsfwjs.NSFWJS> | null = null;

const loadModel = async (): Promise<nsfwjs.NSFWJS> => {
  if (globalModel) return globalModel;
  if (globalModelPromise) return globalModelPromise;

  globalModelPromise = (async () => {
    // Use the quantized model for faster loading and inference
    // MobileNetV2 quantized model - ~2MB, runs in ~50ms
    await tf.ready();
    
    // Set backend to WebGL for GPU acceleration
    await tf.setBackend('webgl');
    
    const model = await nsfwjs.load(
      'https://cdn.jsdelivr.net/npm/nsfwjs@4/dist/models/mobilenet_v2/model.json',
      { size: 224 } // MobileNetV2 expects 224x224 input
    );
    
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

  // Load model on mount
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      setModelState('loading');
      try {
        const model = await loadModel();
        if (mounted) {
          modelRef.current = model;
          setModelState('ready');
          console.log('[OnDeviceAI] NSFWJS model loaded successfully');
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load AI model');
          setModelState('error');
          console.error('[OnDeviceAI] Failed to load model:', err);
        }
      }
    };

    init();
    return () => { mounted = false; };
  }, []);

  // Classify a single image
  const classifyImage = useCallback(async (
    imageSource: HTMLImageElement | HTMLCanvasElement | string,
    thresholds: AIThresholds = { porn: 0.3, sexy: 0.4, hentai: 0.3 }
  ): Promise<ModerationResult | null> => {
    if (modelState !== 'ready' || !modelRef.current) {
      console.warn('[OnDeviceAI] Model not ready');
      return null;
    }

    const startTime = performance.now();

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

        // Load image from URL
        image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('Failed to load image'));
          img.src = imageSource;
        });
      } else {
        image = imageSource;
      }

      // Run classification
      const predictions = await modelRef.current.classify(image);
      const inferenceTime = performance.now() - startTime;

      // Find dominant class and check thresholds
      const predMap: Record<string, number> = {};
      predictions.forEach(p => {
        predMap[p.className.toLowerCase()] = p.probability;
      });

      const pornScore = predMap['porn'] || 0;
      const sexyScore = predMap['sexy'] || 0;
      const hentaiScore = predMap['hentai'] || 0;

      const isExplicit = pornScore > thresholds.porn || hentaiScore > thresholds.hentai;
      const shouldBlur = isExplicit || sexyScore > thresholds.sexy;

      // Find dominant class
      const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
      const dominantClass = sorted[0]?.className || 'Unknown';
      const confidence = sorted[0]?.probability || 0;

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
      };

      // Cache result
      if (cacheKey) {
        imageCache.current.set(cacheKey, result);
        // Limit cache size
        if (imageCache.current.size > 500) {
          const firstKey = imageCache.current.keys().next().value;
          if (firstKey) imageCache.current.delete(firstKey);
        }
      }

      return result;
    } catch (err) {
      console.error('[OnDeviceAI] Classification error:', err);
      return null;
    }
  }, [modelState]);

  // Classify multiple images in batch
  const classifyBatch = useCallback(async (
    images: string[],
    thresholds: AIThresholds = { porn: 0.3, sexy: 0.4, hentai: 0.3 }
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
    thresholds: AIThresholds = { porn: 0.3, sexy: 0.4, hentai: 0.3 }
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
  };
};
