import { WebPlugin } from '@capacitor/core';
import type { ContentFilterPlugin } from './ContentFilter';

export class ContentFilterWeb extends WebPlugin implements ContentFilterPlugin {
  async startScanning(): Promise<Record<string, unknown>> {
    return { started: false, platform: 'web' };
  }

  async stopScanning(): Promise<Record<string, unknown>> {
    return { stopped: true, platform: 'web' };
  }

  async setNSFWSignal(): Promise<void> {
    return;
  }
}

