import type { SafeDriverCarRouteEvent, SafeDriverPlugin } from './SafeDriver';
import { type PluginListenerHandle } from '@capacitor/core';

export class SafeDriverWeb implements SafeDriverPlugin {
  async getCurrentRoute(): Promise<SafeDriverCarRouteEvent> {
    return {
      portName: '',
      localizedName: 'No car detected',
      portType: 'none',
      timestamp: new Date().toISOString(),
    };
  }

  async addListener(): Promise<PluginListenerHandle> {
    return {
      remove: () => {},
    };
  }
}
