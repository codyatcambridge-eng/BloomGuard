import { WebPlugin } from '@capacitor/core';
import type { ContentFilterPlugin } from './ContentFilter';

export class ContentFilterWeb extends WebPlugin implements ContentFilterPlugin {
  async startScanning(): Promise<Record<string, unknown>> {
    return { started: false, platform: 'web' };
  }

  async stopScanning(): Promise<Record<string, unknown>> {
    return { stopped: true, platform: 'web' };
  }

  async getCounters(): Promise<{ softBlurCount: number; hardBlurCount: number }> {
    return { softBlurCount: 0, hardBlurCount: 0 };
  }

  async resetCounters(): Promise<Record<string, unknown>> {
    return { reset: true, platform: 'web' };
  }

  async setNSFWSignal(): Promise<void> {
    return;
  }

  async classifyImage(): Promise<ContentFilterNativePrediction> {
    return {
      predictions: {
        Porn: 0,
        Sexy: 0,
        Hentai: 0,
        Neutral: 1,
        Drawing: 0,
      },
      confidence: 0,
      inferenceTimeMs: 0,
    };
  }

  async isModelReady(): Promise<{ ready: boolean }> {
    return { ready: false };
  }
}
