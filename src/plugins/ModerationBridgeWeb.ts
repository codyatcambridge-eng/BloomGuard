import { WebPlugin } from '@capacitor/core';
import type { 
  ModerationBridgePlugin, 
  ModerationScanResult, 
  ModerationThresholds,
  ModerationSettings,
  ModerationCategory
} from './ModerationBridge.shared';
import { 
  calculateCategory, 
  getThresholdsForSensitivity, 
  shouldBlurCategory 
} from './ModerationBridge.shared';
import { mapModerationCategoryToSeverity } from '@/lib/moderation-request-utils';

/**
 * Web implementation of ModerationBridge using NSFWJS
 * This runs in the main app context and processes images from WebView
 */
export class ModerationBridgeWeb extends WebPlugin implements ModerationBridgePlugin {
  private model: any = null;
  private modelPromise: Promise<any> | null = null;
  private imageCache = new Map<string, ModerationScanResult>();
  private settings: ModerationSettings = {
    sensitivity: 3,
    blurStrength: 24,
    enabled: true,
  };
  
  // Timeouts and retry configuration
  private readonly IMAGE_LOAD_TIMEOUT = 10000; // 10s
  private readonly INFERENCE_TIMEOUT = 8000; // 8s
  private readonly MAX_RETRIES = 2;

  constructor() {
    super();
    console.log('[MW-Bridge] Initializing ModerationBridgeWeb...');
    this.initModel();
  }

  private async initModel(): Promise<void> {
    if (this.model) return;
    if (this.modelPromise) {
      await this.modelPromise;
      return;
    }

    this.modelPromise = (async () => {
      try {
        console.log('[MW-Bridge] Loading TensorFlow.js and NSFWJS...');
        const tf = await import('@tensorflow/tfjs');
        const nsfwjs = await import('nsfwjs');
        
        await tf.ready();
        console.log('[MW-Bridge] TensorFlow ready, setting backend...');
        
        await tf.setBackend('webgl');
        console.log('[MW-Bridge] WebGL backend set, loading model...');
        
        this.model = await nsfwjs.load();
        console.log('[MW-Bridge] NSFWJS model loaded successfully');
      } catch (error) {
        console.error('[MW-Bridge] Failed to load model:', error);
        throw error;
      }
    })();

    await this.modelPromise;
  }

  async scan(options: { src: string; thresholds?: ModerationThresholds }): Promise<ModerationScanResult> {
    const { src, thresholds = getThresholdsForSensitivity(this.settings.sensitivity) } = options;
    const startTime = performance.now();

    console.log('[MW-Bridge] scan received:', src.substring(0, 60));

    // Check cache
    const cacheKey = `${src}:${JSON.stringify(thresholds)}`;
    if (this.imageCache.has(cacheKey)) {
      console.log('[MW-Bridge] Cache hit');
      return this.imageCache.get(cacheKey)!;
    }

    // Ensure model is ready
    await this.initModel();
    
    if (!this.model) {
      console.warn('[MW-Bridge] Model not available, returning safe result');
      return this.createSafeResult(src);
    }

    try {
      // Load image with hardened loader
      const img = await this.loadImageWithFallback(src);
      
      // Classify with timeout
      const predictions = await this.classifyWithTimeout(img);
      const inferenceTime = performance.now() - startTime;

      // Convert to record format
      const predRecord: Record<string, number> = {};
      predictions.forEach((p: any) => {
        predRecord[p.className] = p.probability;
      });

      // Calculate category based on predictions
      const category = calculateCategory(predRecord);
      
      // Determine if we should blur based on thresholds
      const shouldBlur = this.shouldBlurForThresholds(predRecord, thresholds);
      
      // Get confidence (highest prediction)
      const confidence = Math.max(...Object.values(predRecord));

      const result: ModerationScanResult = {
        src,
        shouldBlur,
        category,
        confidence,
        severity: mapModerationCategoryToSeverity(category),
        predictions: predRecord,
        inferenceTime,
      };

      // Cache result
      this.imageCache.set(cacheKey, result);
      this.limitCache();

      console.log(`[MW-Bridge] scan result: ${category} (blur: ${shouldBlur}, conf: ${(confidence * 100).toFixed(1)}%, time: ${inferenceTime.toFixed(0)}ms)`);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.log('[MW-Bridge] Scan failed:', src.substring(0, 50), '-', errorMsg);
      return this.createSafeResult(src, 'error');
    }
  }

  async scanBatch(options: { sources: string[]; thresholds?: ModerationThresholds }): Promise<{ results: ModerationScanResult[] }> {
    const { sources, thresholds } = options;
    const results: ModerationScanResult[] = [];
    const startTime = performance.now();

    console.log('[MW-Bridge] scanBatch received:', sources.length, 'images');

    // Process in parallel with concurrency limit
    const concurrency = 4;
    for (let i = 0; i < sources.length; i += concurrency) {
      const batch = sources.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(src => this.scan({ src, thresholds }))
      );
      results.push(...batchResults);
    }

    const totalTime = performance.now() - startTime;
    console.log(`[MW-Bridge] scanBatch complete: ${results.length} images in ${totalTime.toFixed(0)}ms`);

    return { results };
  }

  /**
   * Process a batch request from WebView postMessage protocol
   * Returns results in the same order as requested with itemIds preserved
   */
  async processModerationRequest(request: {
    requestId: string;
    items: Array<{ itemId: string; src: string; sourceType: string }>;
    thresholds?: ModerationThresholds;
  }): Promise<{
    requestId: string;
    results: Array<{
      itemId: string;
      src: string;
      shouldBlur: boolean;
      category: ModerationCategory;
      confidence: number;
    }>;
  }> {
    const { requestId, items, thresholds } = request;
    const startTime = performance.now();

    console.log('[MW-Bridge] processModerationRequest', requestId, 'items=' + items.length);

    const results: Array<{
      itemId: string;
      src: string;
      shouldBlur: boolean;
      category: ModerationCategory;
      confidence: number;
    }> = [];

    // Process each item
    for (const item of items) {
      const { itemId, src, sourceType } = item;
      
      console.log('[MW-Bridge] Processing', itemId, '[' + sourceType + ']:', src.substring(0, 60));
      
      try {
        const scanResult = await this.scan({ src, thresholds });
        
        results.push({
          itemId,
          src,
          shouldBlur: scanResult.shouldBlur,
          category: scanResult.category,
          confidence: scanResult.confidence,
        });

        console.log('[MW-Bridge] Result', itemId, ':', scanResult.category, 'blur=' + scanResult.shouldBlur);
      } catch (error) {
        console.log('[MW-Bridge] Error processing', itemId, ':', error);
        
        results.push({
          itemId,
          src,
          shouldBlur: false,
          category: 'error',
          confidence: 0,
        });
      }
    }

    const totalTime = performance.now() - startTime;
    console.log('[MW-Bridge] processModerationRequest complete', requestId, 'time=' + totalTime.toFixed(0) + 'ms');

    return { requestId, results };
  }

  async getSettings(): Promise<ModerationSettings> {
    // Load from localStorage
    try {
      const stored = localStorage.getItem('moderation_bridge_settings');
      if (stored) {
        this.settings = { ...this.settings, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.debug('[MW-Bridge] Failed to load settings');
    }
    return this.settings;
  }

  async isReady(): Promise<{ ready: boolean }> {
    try {
      await this.initModel();
      return { ready: this.model !== null };
    } catch {
      return { ready: false };
    }
  }

  updateSettings(settings: Partial<ModerationSettings>): void {
    this.settings = { ...this.settings, ...settings };
    try {
      localStorage.setItem('moderation_bridge_settings', JSON.stringify(this.settings));
    } catch (e) {
      console.debug('[MW-Bridge] Failed to save settings');
    }
  }

  /**
   * Load image with multiple fallback strategies
   * 1. Try direct Image() with crossOrigin
   * 2. Try fetch() -> blob -> createObjectURL
   * 3. Return error if both fail
   */
  private async loadImageWithFallback(src: string): Promise<HTMLImageElement> {
    // Try direct load first
    try {
      return await this.loadImageDirect(src);
    } catch (directError) {
      console.log('[MW-Bridge] Direct load failed, trying fetch fallback:', (directError as Error).message);
    }

    // Try fetch -> blob -> objectURL fallback
    try {
      return await this.loadImageViaFetch(src);
    } catch (fetchError) {
      console.log('[MW-Bridge] Fetch fallback failed:', (fetchError as Error).message);
      throw new Error(`Failed to load image: ${(fetchError as Error).message}`);
    }
  }

  /**
   * Direct image load with crossOrigin
   */
  private async loadImageDirect(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      const timeout = setTimeout(() => {
        img.src = '';
        reject(new Error('Image load timeout (direct)'));
      }, this.IMAGE_LOAD_TIMEOUT);

      img.onload = () => {
        clearTimeout(timeout);
        if (img.width < 10 || img.height < 10) {
          reject(new Error('Image too small'));
          return;
        }
        resolve(img);
      };

      img.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error('Direct image load failed'));
      };

      img.src = src;
    });
  }

  /**
   * Load image via fetch -> blob -> objectURL
   * This can bypass some CORS issues when the server allows fetch but not crossOrigin images
   */
  private async loadImageViaFetch(src: string): Promise<HTMLImageElement> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.IMAGE_LOAD_TIMEOUT);

    try {
      const response = await fetch(src, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
        headers: {
          'Accept': 'image/*',
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.startsWith('image/')) {
        throw new Error(`Invalid content-type: ${contentType}`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      return new Promise((resolve, reject) => {
        const img = new Image();
        
        const loadTimeout = setTimeout(() => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Image load timeout (blob)'));
        }, 5000);

        img.onload = () => {
          clearTimeout(loadTimeout);
          // Don't revoke yet - we need it for inference
          // Schedule cleanup for later
          setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
          
          if (img.width < 10 || img.height < 10) {
            reject(new Error('Image too small'));
            return;
          }
          resolve(img);
        };

        img.onerror = () => {
          clearTimeout(loadTimeout);
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Blob image load failed'));
        };

        img.src = objectUrl;
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        throw new Error('Fetch timeout');
      }
      throw error;
    }
  }

  /**
   * Run model classification with timeout
   */
  private async classifyWithTimeout(img: HTMLImageElement): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Inference timeout'));
      }, this.INFERENCE_TIMEOUT);

      this.model.classify(img)
        .then((predictions: any[]) => {
          clearTimeout(timeout);
          resolve(predictions);
        })
        .catch((error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  private shouldBlurForThresholds(predictions: Record<string, number>, thresholds: ModerationThresholds): boolean {
    const porn = predictions['Porn'] || predictions['porn'] || 0;
    const hentai = predictions['Hentai'] || predictions['hentai'] || 0;
    const sexy = predictions['Sexy'] || predictions['sexy'] || 0;

    return porn > thresholds.porn || hentai > thresholds.hentai || sexy > thresholds.sexy;
  }

  private createSafeResult(src: string, category: ModerationCategory = 'safe'): ModerationScanResult {
    return {
      src,
      shouldBlur: false,
      category,
      confidence: 1,
      severity: mapModerationCategoryToSeverity(category),
      predictions: { Neutral: 1 },
      inferenceTime: 0,
    };
  }

  private limitCache(): void {
    if (this.imageCache.size > 500) {
      const firstKey = this.imageCache.keys().next().value;
      if (firstKey) this.imageCache.delete(firstKey);
    }
  }
}
