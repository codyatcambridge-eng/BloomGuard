import type {
  SafeDriverBluetoothDetectionConfig,
  SafeDriverBluetoothDetectionEvent,
  SafeDriverBluetoothStatus,
  SafeDriverCarRouteEvent,
  SafeDriverLiveActivityActionEvent,
  SafeDriverLiveActivityStatus,
  SafeDriverPermissionSnapshot,
  SafeDriverPlugin,
  SafeDriverScreenTimeAuthorizationResponse,
  SafeDriverPairedCarsEvent,
} from './SafeDriver';
import { type PluginListenerHandle } from '@capacitor/core';

export class SafeDriverWeb implements SafeDriverPlugin {
  async getCurrentRoute(): Promise<SafeDriverCarRouteEvent> {
    return {
      portName: '',
      portType: 'none',
      timestamp: new Date().toISOString(),
    };
  }

  async configureBluetoothDetection(_config: SafeDriverBluetoothDetectionConfig): Promise<void> {
    return;
  }

  async registerAccessory(): Promise<void> {
    return;
  }

  async showPicker(): Promise<void> {
    console.debug('[SafeDriver][WEB] showPicker is not supported in the web preview');
  }

  async getBluetoothStatus(): Promise<SafeDriverBluetoothStatus> {
    const supported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
    let enabled = false;
    let state: SafeDriverBluetoothStatus['state'] = supported ? 'unknown' : 'unsupported';
    if (supported && typeof navigator.bluetooth !== 'undefined') {
      try {
        // @ts-expect-error navigator.bluetooth may not expose getAvailability in all browsers
        const availability = await navigator.bluetooth.getAvailability();
        enabled = Boolean(availability);
        state = enabled ? 'poweredOn' : 'poweredOff';
      } catch (error) {
        console.debug('[SafeDriver][WEB] bluetooth availability check failed', error);
      }
    }
    return { supported, enabled, state };
  }

  async getLiveActivityStatus(): Promise<SafeDriverLiveActivityStatus> {
    return {
      supported: false,
      enabled: false,
      status: 'unsupported',
    };
  }

  async openSettings(): Promise<{ opened: boolean }> {
    if (typeof window !== 'undefined') {
      window.open('about:preferences', '_blank');
    }
    return { opened: false };
  }

  async checkPermissions(): Promise<SafeDriverPermissionSnapshot> {
    return {
      bluetooth: {
        supported: false,
        enabled: false,
        state: 'unsupported',
      },
      screenTime: {
        supported: false,
        authorized: false,
        status: 'unsupported',
      },
    };
  }

  async requestScreenTimeAuth(): Promise<SafeDriverScreenTimeAuthorizationResponse> {
    return {
      supported: false,
      authorized: false,
      status: 'unsupported',
    };
  }

  async testHeartbeat(): Promise<{ seen: boolean }> {
    return { seen: false };
  }

  async addListener(
    eventName: 'carRouteChange',
    listenerFunc: (event: SafeDriverCarRouteEvent) => void,
  ): Promise<PluginListenerHandle>;
  async addListener(
    eventName: 'carDetected',
    listenerFunc: (event: SafeDriverBluetoothDetectionEvent) => void,
  ): Promise<PluginListenerHandle>;
  async addListener(
    eventName: 'liveActivityAction',
    listenerFunc: (event: SafeDriverLiveActivityActionEvent) => void,
  ): Promise<PluginListenerHandle>;
  async addListener(
    eventName: 'pairedCars',
    listenerFunc: (event: SafeDriverPairedCarsEvent) => void,
  ): Promise<PluginListenerHandle>;
  async addListener(
    eventName: 'carRouteChange' | 'carDetected' | 'liveActivityAction' | 'pairedCars',
    listenerFunc: (
      event: SafeDriverCarRouteEvent
        | SafeDriverBluetoothDetectionEvent
        | SafeDriverLiveActivityActionEvent
        | SafeDriverPairedCarsEvent,
    ) => void,
  ): Promise<PluginListenerHandle> {
    return {
      remove: () => {},
    };
  }
}
