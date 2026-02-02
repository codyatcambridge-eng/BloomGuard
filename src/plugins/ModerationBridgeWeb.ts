import { WebPlugin } from '@capacitor/core';
import type { 
  ModerationBridgePlugin, 
  ModerationScanResult, 
  ModerationThresholds,
  ModerationSettings,
  ModerationCategory
} from './ModerationBridge';
import { calculateCategory, getThresholdsForSensitivity, getBlurStrengthForLevel } from './ModerationBridge';

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
        const tf = await import('@tensorflow/tfjs');
        const nsfwjs = await import('nsfwjs');
        
        await tf.ready();
        await tf.setBackend('webgl');
        
        this.model = await nsfwjs.load();
        console.log('[ModerationBridge] NSFWJS model loaded');
      } catch (error) {
        console.error('[ModerationBridge] Failed to load model:', error);
        throw error;
      }
    })();

    await this.modelPromise;
  }

  async scan(options: { src: string; thresholds?: ModerationThresholds }): Promise<ModerationScanResult> {
    const { src, thresholds = getThresholdsForSensitivity(this.settings.sensitivity) } = options;

    // Check cache
    const cacheKey = `${src}:${JSON.stringify(thresholds)}`;
    if (this.imageCache.has(cacheKey)) {
      return this.imageCache.get(cacheKey)!;
    }

    // Ensure model is ready
    await this.initModel();
    
    if (!this.model) {
      return this.createSafeResult(src);
    }

    const startTime = performance.now();

    try {
      // Load image
      const img = await this.loadImage(src);
      
      // Classify
      const predictions = await this.model.classify(img);
      const inferenceTime = performance.now() - startTime;

      // Convert to record
      const predRecord: Record<string, number> = {};
      predictions.forEach((p: any) => {
        predRecord[p.className] = p.probability;
      });

      // Calculate category and blur decision
      const category = calculateCategory(predRecord);
      const shouldBlur = this.shouldBlurForThresholds(predRecord, thresholds);

      const result: ModerationScanResult = {
        src,
        shouldBlur,
        category,
        confidence: Math.max(...Object.values(predRecord)),
        predictions: predRecord,
        inferenceTime,
      };

      // Cache result
      this.imageCache.set(cacheKey, result);
      this.limitCache();

      console.log(`[ModerationBridge] Scanned ${src.substring(0, 50)}... -> ${category} (blur: ${shouldBlur})`);
      return result;
    } catch (error) {
      console.debug('[ModerationBridge] Scan failed:', src.substring(0, 50), error);
      return this.createSafeResult(src);
    }
  }

  async scanBatch(options: { sources: string[]; thresholds?: ModerationThresholds }): Promise<{ results: ModerationScanResult[] }> {
    const { sources, thresholds } = options;
    const results: ModerationScanResult[] = [];

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
      console.debug('[ModerationBridge] Failed to load settings');
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
      console.debug('[ModerationBridge] Failed to save settings');
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

  private createSafeResult(src: string): ModerationScanResult {
    return {
      src,
      shouldBlur: false,
      category: 'safe',
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
