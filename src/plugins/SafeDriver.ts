import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface SafeDriverCarRouteEvent {
  portName: string;
  localizedName: string;
  portType: string;
  timestamp: string;
}

export interface SafeDriverPlugin {
  getCurrentRoute(): Promise<SafeDriverCarRouteEvent>;
  addListener(
    eventName: 'carRouteChange',
    listenerFunc: (event: SafeDriverCarRouteEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export const SafeDriver = registerPlugin<SafeDriverPlugin>('SafeDriver', {
  web: () => import('./SafeDriverWeb').then((m) => new m.SafeDriverWeb()),
});
