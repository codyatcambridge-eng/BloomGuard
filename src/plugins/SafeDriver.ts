import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface SafeDriverCarRouteEvent {
  portName: string;
  localizedName: string;
  portType: string;
  timestamp: string;
}

export interface SafeDriverBluetoothDetectionConfig {
  approvedIdentifiers: string[];
  serviceUUIDs: string[];
  safeDriverEnabled: boolean;
  autoStartOnApprovedCar: boolean;
  rssiThreshold: number | null;
}

export interface SafeDriverBluetoothDetectionEvent {
  id: string;
  name: string | null;
  rssi: number | null;
  ts: string;
}

export interface SafeDriverLiveActivityActionEvent {
  action: 'snooze' | 'activate';
  carName?: string | null;
}

export interface SafeDriverPairedCar {
  id: string;
  name: string;
  connected: boolean;
}

export interface SafeDriverPairedCarsEvent {
  cars: SafeDriverPairedCar[];
}

export type SafeDriverBluetoothState =
  | 'unknown'
  | 'resetting'
  | 'unsupported'
  | 'unauthorized'
  | 'poweredOff'
  | 'poweredOn';

export interface SafeDriverBluetoothStatus {
  supported: boolean;
  enabled: boolean;
  state: SafeDriverBluetoothState;
}

export type SafeDriverLiveActivityState =
  | 'notDetermined'
  | 'restricted'
  | 'denied'
  | 'authorized'
  | 'unsupported';

export interface SafeDriverLiveActivityStatus {
  supported: boolean;
  enabled: boolean;
  status: SafeDriverLiveActivityState;
}

export type SafeDriverScreenTimeStatusType =
  | 'notDetermined'
  | 'restricted'
  | 'denied'
  | 'approved'
  | 'unsupported';

export interface SafeDriverPermissionSnapshot {
  screenTime: {
    supported: boolean;
    authorized: boolean;
    status: SafeDriverScreenTimeStatusType;
  };
  bluetooth: SafeDriverBluetoothStatus;
}

export interface SafeDriverScreenTimeAuthorizationResponse {
  supported: boolean;
  authorized: boolean;
  status: SafeDriverScreenTimeStatusType;
}

export interface SafeDriverStatus {
  safeModeActive: boolean;
  connectedVehicleName: string | null;
}

export interface SafeDriverPlugin {
  getCurrentRoute(): Promise<SafeDriverCarRouteEvent>;
  configureBluetoothDetection(
    config: SafeDriverBluetoothDetectionConfig,
  ): Promise<void>;
  registerAccessory(): Promise<void>;
  showPicker(): Promise<void>;
  startPairing(): Promise<void>;
  getBluetoothStatus(): Promise<SafeDriverBluetoothStatus>;
  getLiveActivityStatus(): Promise<SafeDriverLiveActivityStatus>;
  checkPermissions(): Promise<SafeDriverPermissionSnapshot>;
  requestPermissions(): Promise<SafeDriverPermissionSnapshot>;
  requestScreenTimeAuth(): Promise<SafeDriverScreenTimeAuthorizationResponse>;
  presentFamilyActivityPicker(): Promise<void>;
  requestTemporaryBreak(): Promise<void>;
  getCurrentStatus(): Promise<SafeDriverStatus>;
  testHeartbeat(): Promise<{ seen: boolean }>;
  openSettings(): Promise<{ opened: boolean }>;
  addListener(
    eventName: 'carRouteChange',
    listenerFunc: (event: SafeDriverCarRouteEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'carDetected',
    listenerFunc: (event: SafeDriverBluetoothDetectionEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'liveActivityAction',
    listenerFunc: (event: SafeDriverLiveActivityActionEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'pairedCars',
    listenerFunc: (event: SafeDriverPairedCarsEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export const SafeDriver = registerPlugin<SafeDriverPlugin>('SafeDriver', {
  web: () => import('./SafeDriverWeb').then((m) => new m.SafeDriverWeb()),
});
