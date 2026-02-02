import { WebPlugin } from '@capacitor/core';
import type { 
  ModerationBridgePlugin, 
  ModerationScanResult, 
  ModerationThresholds,
  ModerationSettings,
  ModerationCategory
} from './ModerationBridge';
import { 
  calculateCategory, 
  getThresholdsForSensitivity, 
  shouldBlurCategory 
} from './ModerationBridge';

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

    const startTime = performance.now();

    try {
      // Load image
      const img = await this.loadImage(src);
      
      // Classify
      const predictions = await this.model.classify(img);
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
        predictions: predRecord,
        inferenceTime,
      };

      // Cache result
      this.imageCache.set(cacheKey, result);
      this.limitCache();

      console.log(`[MW-Bridge] scan result: ${category} (blur: ${shouldBlur}, conf: ${(confidence * 100).toFixed(1)}%, time: ${inferenceTime.toFixed(0)}ms)`);
      return result;
    } catch (error) {
      console.debug('[MW-Bridge] Scan failed:', src.substring(0, 50), error);
      return this.createSafeResult(src, 'error');
    }
  }

  async scanBatch(options: { sources: string[]; thresholds?: ModerationThresholds }): Promise<{ results: ModerationScanResult[] }> {
    const { sources, thresholds } = options;
    const results: ModerationScanResult[] = [];

    console.log('[ModerationBridgeWeb] Batch scan:', sources.length, 'images');

    // Process in parallel with concurrency limit
    const concurrency = 4;
    for (let i = 0; i < sources.length; i += concurrency) {
      const batch = sources.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(src => this.scan({ src, thresholds }))
      );
      results.push(...batchResults);
    }

    return { results };
  }

  async getSettings(): Promise<ModerationSettings> {
    // Load from localStorage
    try {
      const stored = localStorage.getItem('moderation_bridge_settings');
      if (stored) {
        this.settings = { ...this.settings, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.debug('[ModerationBridgeWeb] Failed to load settings');
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
      console.debug('[ModerationBridgeWeb] Failed to save settings');
    }
  }

  private async loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      const timeout = setTimeout(() => {
        img.src = '';
        reject(new Error('Image load timeout'));
      }, 8000);

      img.onload = () => {
        clearTimeout(timeout);
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

      img.src = src;
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
