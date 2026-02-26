import { useState, useEffect, useCallback, useRef } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as nsfwjs from 'nsfwjs';
import { useLocalSettings } from '@/hooks/useLocalSettings';

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
  | 'swimwear_detected'
  | 'thirst_detected';

export interface ModerationResult {
  isExplicit: boolean;
  shouldBlur: boolean;
  predictions: ModerationPrediction[];
  dominantClass: string;
  confidence: number;
  inferenceTime: number;
  reason: ModerationReason;
  nsfwRisk?: number;
  decisionReason?: string;
  modelVersion?: string;
  thresholdsUsed?: {
    nsfwGrayZoneMin: number;
    nsfwGrayZoneMax: number;
    explicitOverride: number;
    skinRatio: number;
    thirstWeights: {
      nsfw: number;
      skin: number;
      person: number;
    };
  };
  segmentation?: {
    attempted: boolean;
    applied: boolean;
    personPresent: boolean;
    personPixels: number;
    skinPixels: number;
    skinRatio: number;
    thirstScore: number;
    threshold: number;
    strictMode: boolean;
    grayZone: boolean;
    throttled: boolean;
    cached: boolean;
    modelVersion: string;
    imageWidth: number;
    imageHeight: number;
    inputWidth: number;
    inputHeight: number;
    host?: string;
    segMs: number;
    skinMs: number;
  };
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
const SEGMENTATION_TIMEOUT_MS = 2000;
const SEGMENTATION_MIN_PERSON_PIXELS = 1500;
const SEGMENTATION_GRAY_ZONE_MIN = 0.15;
const SEGMENTATION_GRAY_ZONE_MAX = 0.65;
const NSFW_EXPLICIT_OVERRIDE_THRESHOLD = 0.85;
const NSFW_WEIGHT = 0.65;
const SKIN_WEIGHT = 0.30;
const PERSON_WEIGHT = 0.05;
const SEGMENTATION_MODEL_VERSION = 'body-pix@2.x';
const NSFW_MODEL_VERSION = 'nsfwjs@4.2.0';

type ModelLoadingState = 'idle' | 'loading' | 'ready' | 'error';

// Singleton pattern for the model - load once, use everywhere
let globalModel: nsfwjs.NSFWJS | null = null;
let globalModelPromise: Promise<nsfwjs.NSFWJS> | null = null;
type BodyPixModel = {
  segmentPerson: (
    input: HTMLImageElement | HTMLCanvasElement,
    config?: Record<string, unknown>
  ) => Promise<{ data: Uint8Array | Int32Array; width: number; height: number }>;
};
let globalSegmentationModel: BodyPixModel | null = null;
let globalSegmentationModelPromise: Promise<BodyPixModel | null> | null = null;

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

const loadSegmentationModel = async (): Promise<BodyPixModel | null> => {
  if (globalSegmentationModel) return globalSegmentationModel;
  if (globalSegmentationModelPromise) return globalSegmentationModelPromise;

  globalSegmentationModelPromise = (async () => {
    try {
      await tf.ready();
      const bodyPix = await import('@tensorflow-models/body-pix');
      const model = await bodyPix.load({
        architecture: 'MobileNetV1',
        outputStride: 16,
        multiplier: 0.5,
        quantBytes: 2,
      });
      globalSegmentationModel = model as unknown as BodyPixModel;
      console.log('[OnDeviceAI] BodyPix model loaded successfully');
      return globalSegmentationModel;
    } catch (err) {
      console.warn('[OnDeviceAI] BodyPix unavailable, segmentation disabled:', err);
      return null;
    }
  })();

  return globalSegmentationModelPromise;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const toDialBucket = (thresholds: AIThresholds): 'relaxed' | 'medium' | 'strict' => {
  if (thresholds.sexy >= 0.8) return 'relaxed';
  if (thresholds.sexy >= 0.5) return 'medium';
  return 'strict';
};

const computeNsfwRisk = (porn: number, sexy: number, hentai: number): number => {
  const explicit = Math.max(porn, hentai);
  return clamp01(explicit * 0.8 + sexy * 0.45);
};

const isLikelySkinPixel = (r: number, g: number, b: number): boolean => {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return (
    y > 40 &&
    cr >= 133 && cr <= 173 &&
    cb >= 77 && cb <= 127 &&
    r > 70 && g > 35 && b > 20 &&
    r > g && r > b
  );
};

const getSkinRatioThresholdForDial = (
  dialBucket: 'relaxed' | 'medium' | 'strict',
  settings: {
    segmentationSkinRatioRelaxed: number;
    segmentationSkinRatioMedium: number;
    segmentationSkinRatioStrict: number;
  },
): number => {
  if (dialBucket === 'relaxed') return settings.segmentationSkinRatioRelaxed;
  if (dialBucket === 'medium') return settings.segmentationSkinRatioMedium;
  return settings.segmentationSkinRatioStrict;
};

const getImageDimensions = (image: HTMLImageElement | HTMLCanvasElement): { width: number; height: number } => {
  if (image instanceof HTMLImageElement) {
    return {
      width: image.naturalWidth || image.width || 0,
      height: image.naturalHeight || image.height || 0,
    };
  }
  return { width: image.width || 0, height: image.height || 0 };
};

const downscaleForSegmentation = (
  image: HTMLImageElement | HTMLCanvasElement,
  maxInputPx: number
): { canvas: HTMLCanvasElement; width: number; height: number } => {
  const dims = getImageDimensions(image);
  const longestSide = Math.max(dims.width, dims.height, 1);
  const scale = Math.min(1, maxInputPx / longestSide);
  const width = Math.max(1, Math.round(dims.width * scale));
  const height = Math.max(1, Math.round(dims.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { canvas, width, height };
  ctx.drawImage(image, 0, 0, width, height);
  return { canvas, width, height };
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
  const segmentationCache = useRef<Map<string, {
    expiresAt: number;
    value: {
      personPresent: boolean;
      personPixels: number;
      skinPixels: number;
      skinRatio: number;
      thirstScore: number;
      inputWidth: number;
      inputHeight: number;
      segMs: number;
      skinMs: number;
    };
  }>>(new Map());
  const segmentationLastRunAt = useRef(0);
  const segmentationCounters = useRef({ cacheHits: 0, throttleSkips: 0, attempts: 0 });
  const initAttempted = useRef(false);
  const { settings } = useLocalSettings();

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
      let inferenceTime = performance.now() - startTime;

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
      const nsfwRisk = computeNsfwRisk(pornScore, sexyScore, hentaiScore);
      const dialBucket = toDialBucket(thresholds);
      const strictMode = dialBucket === 'strict';
      const inGrayZone = nsfwRisk >= SEGMENTATION_GRAY_ZONE_MIN && nsfwRisk <= SEGMENTATION_GRAY_ZONE_MAX;
      const shouldTrySegmentation =
        settings.enableSegmentationSignal === true &&
        (strictMode || (settings.segmentationGrayZoneOnly ? inGrayZone : true));
      const segmentationThreshold = getSkinRatioThresholdForDial(dialBucket, settings);
      const sourceHost = (() => {
        if (!cacheKey) return undefined;
        try {
          return new URL(cacheKey).hostname;
        } catch {
          return undefined;
        }
      })();
      const imageDims = getImageDimensions(image);
      const diagEnabled = !!import.meta.env.DEV && settings.debug_mode === true;

      let segmentationAttempted = false;
      let segmentationApplied = false;
      let segmentationPersonPresent = false;
      let segmentationPersonPixels = 0;
      let segmentationSkinPixels = 0;
      let segmentationSkinRatio = 0;
      let segmentationThirstScore = clamp01(NSFW_WEIGHT * nsfwRisk);
      let segmentationThrottled = false;
      let segmentationCached = false;
      let segmentationInputWidth = imageDims.width;
      let segmentationInputHeight = imageDims.height;
      let segMs = 0;
      let skinMs = 0;

      if (shouldTrySegmentation) {
        segmentationAttempted = true;
        const now = Date.now();
        const cacheTtlMs = Math.max(1_000, Number(settings.segmentationCacheTtlMs) || 20_000);
        const cached = cacheKey ? segmentationCache.current.get(cacheKey) : undefined;
        if (cached && cached.expiresAt > now) {
          segmentationCached = true;
          segmentationCounters.current.cacheHits += 1;
          segmentationPersonPresent = cached.value.personPresent;
          segmentationPersonPixels = cached.value.personPixels;
          segmentationSkinPixels = cached.value.skinPixels;
          segmentationSkinRatio = cached.value.skinRatio;
          segmentationThirstScore = cached.value.thirstScore;
          segmentationInputWidth = cached.value.inputWidth;
          segmentationInputHeight = cached.value.inputHeight;
          segMs = cached.value.segMs;
          skinMs = cached.value.skinMs;
        } else {
          const throttleMs = Math.max(0, Number(settings.segmentationThrottleMs) || 800);
          if ((now - segmentationLastRunAt.current) < throttleMs) {
            segmentationThrottled = true;
            segmentationCounters.current.throttleSkips += 1;
          } else {
            segmentationCounters.current.attempts += 1;
            segmentationLastRunAt.current = now;
            try {
              const segmentationModel = await loadSegmentationModel();
              if (segmentationModel) {
                const maxInputPx = Math.max(96, Number(settings.segmentationMaxInputPx) || 256);
                const downscaled = downscaleForSegmentation(image, maxInputPx);
                segmentationInputWidth = downscaled.width;
                segmentationInputHeight = downscaled.height;

                const segStart = performance.now();
                const segmentPromise = segmentationModel.segmentPerson(downscaled.canvas, {
                  internalResolution: 'medium',
                  segmentationThreshold: 0.7,
                  maxDetections: 1,
                  scoreThreshold: 0.3,
                  nmsRadius: 20,
                });
                const segmentTimeout = new Promise<never>((_, reject) => {
                  setTimeout(() => reject(new Error('Segmentation timeout')), SEGMENTATION_TIMEOUT_MS);
                });
                const segmentation = await Promise.race([segmentPromise, segmentTimeout]);
                segMs = performance.now() - segStart;

                const ctx = downscaled.canvas.getContext('2d', { willReadFrequently: true });
                if (ctx && segmentation?.data) {
                  const skinStart = performance.now();
                  const pixels = ctx.getImageData(0, 0, downscaled.width, downscaled.height).data;
                  const mask = segmentation.data;
                  const limit = Math.min(mask.length, downscaled.width * downscaled.height);
                  let personPixels = 0;
                  let skinPixels = 0;

                  for (let i = 0; i < limit; i++) {
                    if ((mask[i] ?? 0) <= 0) continue;
                    personPixels++;
                    const pxIdx = i * 4;
                    if (isLikelySkinPixel(
                      pixels[pxIdx] ?? 0,
                      pixels[pxIdx + 1] ?? 0,
                      pixels[pxIdx + 2] ?? 0,
                    )) {
                      skinPixels++;
                    }
                  }
                  skinMs = performance.now() - skinStart;

                  segmentationPersonPixels = personPixels;
                  segmentationSkinPixels = skinPixels;
                  if (personPixels >= SEGMENTATION_MIN_PERSON_PIXELS) {
                    segmentationPersonPresent = true;
                    segmentationSkinRatio = clamp01(skinPixels / Math.max(1, personPixels));
                  } else {
                    segmentationPersonPresent = false;
                    segmentationSkinRatio = 0;
                  }
                  segmentationThirstScore = clamp01(
                    NSFW_WEIGHT * nsfwRisk +
                    SKIN_WEIGHT * segmentationSkinRatio +
                    PERSON_WEIGHT * (segmentationPersonPresent ? 1 : 0)
                  );

                  if (cacheKey) {
                    segmentationCache.current.set(cacheKey, {
                      expiresAt: now + cacheTtlMs,
                      value: {
                        personPresent: segmentationPersonPresent,
                        personPixels: segmentationPersonPixels,
                        skinPixels: segmentationSkinPixels,
                        skinRatio: segmentationSkinRatio,
                        thirstScore: segmentationThirstScore,
                        inputWidth: segmentationInputWidth,
                        inputHeight: segmentationInputHeight,
                        segMs,
                        skinMs,
                      },
                    });
                    if (segmentationCache.current.size > 400) {
                      const firstSegKey = segmentationCache.current.keys().next().value;
                      if (firstSegKey) segmentationCache.current.delete(firstSegKey);
                    }
                  }
                }
              }
            } catch (segErr) {
              // Fail-open by design for Stage-B.
              if (diagEnabled) {
                console.debug('[OnDeviceAI][StageB] segmentation_fail_open:', segErr);
              }
            }
          }
        }
      }

      segmentationApplied =
        segmentationPersonPresent &&
        segmentationSkinRatio > segmentationThreshold;

      // Neutral fast-pass: strongly neutral images should not be blurred unless explicit scores are meaningful.
      if (
        neutralScore >= NEUTRAL_FAST_PASS_THRESHOLD &&
        pornScore < thresholds.porn &&
        hentaiScore < thresholds.hentai &&
        sexyScore < Math.max(thresholds.sexy + 0.2, 0.7) &&
        nsfwRisk < NSFW_EXPLICIT_OVERRIDE_THRESHOLD &&
        !segmentationApplied
      ) {
        const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
        const dominantClass = sorted[0]?.className || 'Unknown';
        const confidence = sorted[0]?.probability || 0;
        inferenceTime = performance.now() - startTime;
        const result: ModerationResult = {
          isExplicit: false,
          shouldBlur: false,
          predictions: formattedPredictions,
          dominantClass,
          confidence,
          inferenceTime,
          reason: 'threshold_safe',
          nsfwRisk,
          decisionReason: 'neutral_fast_pass',
          modelVersion: `${NSFW_MODEL_VERSION}+${SEGMENTATION_MODEL_VERSION}`,
          thresholdsUsed: {
            nsfwGrayZoneMin: SEGMENTATION_GRAY_ZONE_MIN,
            nsfwGrayZoneMax: SEGMENTATION_GRAY_ZONE_MAX,
            explicitOverride: NSFW_EXPLICIT_OVERRIDE_THRESHOLD,
            skinRatio: segmentationThreshold,
            thirstWeights: {
              nsfw: NSFW_WEIGHT,
              skin: SKIN_WEIGHT,
              person: PERSON_WEIGHT,
            },
          },
          segmentation: {
            attempted: segmentationAttempted,
            applied: false,
            personPresent: segmentationPersonPresent,
            personPixels: segmentationPersonPixels,
            skinPixels: segmentationSkinPixels,
            skinRatio: segmentationSkinRatio,
            thirstScore: segmentationThirstScore,
            threshold: segmentationThreshold,
            strictMode,
            grayZone: inGrayZone,
            throttled: segmentationThrottled,
            cached: segmentationCached,
            modelVersion: SEGMENTATION_MODEL_VERSION,
            imageWidth: imageDims.width,
            imageHeight: imageDims.height,
            inputWidth: segmentationInputWidth,
            inputHeight: segmentationInputHeight,
            host: sourceHost,
            segMs,
            skinMs,
          },
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
      const explicitOverride = nsfwRisk >= NSFW_EXPLICIT_OVERRIDE_THRESHOLD;

      // ==== SWIMWEAR/SHIRTLESS LOGIC ====
      // If Sexy is high and skin-density is high (with weak clothing signal), mark as unsafe.
      const isSwimwearShirtless =
        sexyScore > SWIMWEAR_SEXY_THRESHOLD &&
        signals.skinDensity >= MIN_SKIN_DENSITY_FOR_SWIMWEAR &&
        !signals.hasClothing;

      if (isSwimwearShirtless) {
        inferenceTime = performance.now() - startTime;
        const result: ModerationResult = {
          isExplicit: false,
          shouldBlur: true,
          predictions: formattedPredictions,
          dominantClass: 'Swimwear',
          confidence: sexyScore,
          inferenceTime,
          reason: 'swimwear_detected',
          nsfwRisk,
          decisionReason: 'stage_a_swimwear_detected',
          modelVersion: `${NSFW_MODEL_VERSION}+${SEGMENTATION_MODEL_VERSION}`,
          thresholdsUsed: {
            nsfwGrayZoneMin: SEGMENTATION_GRAY_ZONE_MIN,
            nsfwGrayZoneMax: SEGMENTATION_GRAY_ZONE_MAX,
            explicitOverride: NSFW_EXPLICIT_OVERRIDE_THRESHOLD,
            skinRatio: segmentationThreshold,
            thirstWeights: {
              nsfw: NSFW_WEIGHT,
              skin: SKIN_WEIGHT,
              person: PERSON_WEIGHT,
            },
          },
          segmentation: {
            attempted: segmentationAttempted,
            applied: segmentationApplied,
            personPresent: segmentationPersonPresent,
            personPixels: segmentationPersonPixels,
            skinPixels: segmentationSkinPixels,
            skinRatio: segmentationSkinRatio,
            thirstScore: segmentationThirstScore,
            threshold: segmentationThreshold,
            strictMode,
            grayZone: inGrayZone,
            throttled: segmentationThrottled,
            cached: segmentationCached,
            modelVersion: SEGMENTATION_MODEL_VERSION,
            imageWidth: imageDims.width,
            imageHeight: imageDims.height,
            inputWidth: segmentationInputWidth,
            inputHeight: segmentationInputHeight,
            host: sourceHost,
            segMs,
            skinMs,
          },
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
      const isExplicit = pornHit || hentaiHit || explicitOverride;
      let shouldBlur = isExplicit || (sexyHit && neutralScore < NEUTRAL_FAST_PASS_THRESHOLD);

      // Find dominant class
      const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
      let dominantClass = sorted[0]?.className || 'Unknown';
      let confidence = sorted[0]?.probability || 0;
      let reason: ModerationReason = shouldBlur ? 'threshold_hit' : 'threshold_safe';
      let decisionReason = shouldBlur ? 'stage_a_threshold' : 'stage_a_safe';

      if (!shouldBlur && segmentationApplied) {
        shouldBlur = true;
        reason = 'thirst_detected';
        dominantClass = 'Thirst';
        confidence = Math.max(segmentationThirstScore, segmentationSkinRatio);
        decisionReason = 'stage_b_thirst_detected';
      } else if (explicitOverride) {
        shouldBlur = true;
        reason = 'threshold_hit';
        decisionReason = 'explicit_override';
      }

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
      inferenceTime = performance.now() - startTime;

      const result: ModerationResult = {
        isExplicit,
        shouldBlur,
        predictions: formattedPredictions,
        dominantClass,
        confidence,
        inferenceTime,
        reason,
        nsfwRisk,
        decisionReason,
        modelVersion: `${NSFW_MODEL_VERSION}+${SEGMENTATION_MODEL_VERSION}`,
        thresholdsUsed: {
          nsfwGrayZoneMin: SEGMENTATION_GRAY_ZONE_MIN,
          nsfwGrayZoneMax: SEGMENTATION_GRAY_ZONE_MAX,
          explicitOverride: NSFW_EXPLICIT_OVERRIDE_THRESHOLD,
          skinRatio: segmentationThreshold,
          thirstWeights: {
            nsfw: NSFW_WEIGHT,
            skin: SKIN_WEIGHT,
            person: PERSON_WEIGHT,
          },
        },
        segmentation: {
          attempted: segmentationAttempted,
          applied: segmentationApplied,
          personPresent: segmentationPersonPresent,
          personPixels: segmentationPersonPixels,
          skinPixels: segmentationSkinPixels,
          skinRatio: segmentationSkinRatio,
          thirstScore: segmentationThirstScore,
          threshold: segmentationThreshold,
          strictMode,
          grayZone: inGrayZone,
          throttled: segmentationThrottled,
          cached: segmentationCached,
          modelVersion: SEGMENTATION_MODEL_VERSION,
          imageWidth: imageDims.width,
          imageHeight: imageDims.height,
          inputWidth: segmentationInputWidth,
          inputHeight: segmentationInputHeight,
          host: sourceHost,
          segMs,
          skinMs,
        },
        signals,
      };

      if (cacheKey) {
        imageCache.current.set(cacheKey, result);
        limitCache();
      }

      if (diagEnabled) {
        console.debug(
          '[OnDeviceAI][2Stage]',
          `nsfwMs=${Math.round(inferenceTime - segMs - skinMs)}`,
          `segMs=${Math.round(segMs)}`,
          `skinMs=${Math.round(skinMs)}`,
          `totalMs=${Math.round(inferenceTime)}`,
          `nsfwRisk=${nsfwRisk.toFixed(3)}`,
          `personPresent=${segmentationPersonPresent}`,
          `skinRatio=${segmentationSkinRatio.toFixed(3)}`,
          `thirstScore=${segmentationThirstScore.toFixed(3)}`,
          `dial=${dialBucket}`,
          `skinThr=${segmentationThreshold.toFixed(3)}`,
          `decision=${shouldBlur ? 'blur' : 'safe'}`,
          `reason=${decisionReason}`,
          `segAttempted=${segmentationAttempted}`,
          `segCached=${segmentationCached}`,
          `segThrottled=${segmentationThrottled}`,
          `segAttempts=${segmentationCounters.current.attempts}`,
          `segCacheHits=${segmentationCounters.current.cacheHits}`,
          `segThrottleSkips=${segmentationCounters.current.throttleSkips}`,
        );
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
  }, [modelState, settings]);

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
