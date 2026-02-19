import {
  SafeDriver,
  type SafeDriverBluetoothDetectionEvent,
  type SafeDriverCarRouteEvent,
  type SafeDriverLiveActivityActionEvent,
  type SafeDriverPairedCarsEvent,
} from '@/plugins/SafeDriver';
import { loadShieldsState } from '@/storage/shieldsLocal';
import { SHIELD_STRICTNESS_PRECEDENCE, type ShieldId, type ShieldWindow } from '@/logic/shields';

export type SafeDriverMode = 'OFF' | 'COUNTDOWN' | 'ACTIVE';

export interface BluetoothDetectionConfig {
  identifiers: string[];
  serviceUUIDs: string[];
  rssiThreshold: number | null;
}

const CAR_LIKE_PORT_TYPES = new Set([
  'carAudio',
  'carPlay',
  'bluetoothA2DP',
  'bluetoothHFP',
]);

export interface DetectedCarInfo {
  portName: string;
  portType: string;
  timestamp: string;
  isApproved: boolean;
}

export interface PairedCar {
  id: string;
  name: string;
  connected: boolean;
}

export interface SafeDriverStorage {
  safeDriverEnabled: boolean;
  autoStartOnApprovedCar: boolean;
  mode: SafeDriverMode;
  countdownEndsAt: string | null;
  approvedPorts: string[];
  ignoredPortName: string | null;
  lastDetected: DetectedCarInfo | null;
  bluetoothDetection: BluetoothDetectionConfig;
  lastCheckinDate: string | null;
  accountabilityPartnerPhone: string | null;
  pairedCars: PairedCar[];
}

export interface SafeDriverSelection {
  blob: string;
  windows: ShieldWindow[];
  shieldId: ShieldId;
}

const STORAGE_KEY = 'mw_safe_driver_state';

const DEFAULT_BLUETOOTH_DETECTION: BluetoothDetectionConfig = {
  identifiers: [],
  serviceUUIDs: [],
  rssiThreshold: null,
};

const DEFAULT_STATE: SafeDriverStorage = {
  safeDriverEnabled: true,
  autoStartOnApprovedCar: false,
  mode: 'OFF',
  countdownEndsAt: null,
  approvedPorts: [],
  ignoredPortName: null,
  lastDetected: null,
  bluetoothDetection: DEFAULT_BLUETOOTH_DETECTION,
  lastCheckinDate: null,
  accountabilityPartnerPhone: null,
  pairedCars: [],
};

let state: SafeDriverStorage = DEFAULT_STATE;
let listeners = new Set<() => void>();
let detectionInitialized = false;

function log(message: string, data?: Record<string, unknown>) {
  console.debug('[SafeDriver][DIAG]', message, data ?? {});
}

function todayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function persist(next: SafeDriverStorage) {
  state = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.warn('[SafeDriver][DIAG] failed to persist state', error);
    }
  }
  for (const listener of listeners) {
    listener();
  }
  log('state', next);
}

function load() {
  if (typeof window === 'undefined') {
    state = DEFAULT_STATE;
    return;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SafeDriverStorage;
      const parsedBluetooth = (parsed as SafeDriverStorage)['bluetoothDetection'] as Partial<BluetoothDetectionConfig> | undefined;
      const bluetoothDetection = {
        identifiers: normalizeStringArray(parsedBluetooth?.identifiers),
        serviceUUIDs: normalizeStringArray(parsedBluetooth?.serviceUUIDs),
        rssiThreshold:
          typeof parsedBluetooth?.rssiThreshold === 'number'
            ? parsedBluetooth!.rssiThreshold
            : DEFAULT_BLUETOOTH_DETECTION.rssiThreshold,
      };
      state = {
        ...DEFAULT_STATE,
        ...parsed,
        approvedPorts: Array.isArray(parsed.approvedPorts) ? parsed.approvedPorts : [],
        ignoredPortName: typeof parsed.ignoredPortName === 'string' ? parsed.ignoredPortName : null,
        lastDetected: parsed.lastDetected ?? null,
        bluetoothDetection,
        accountabilityPartnerPhone:
          typeof parsed.accountabilityPartnerPhone === 'string'
            ? parsed.accountabilityPartnerPhone
            : null,
        pairedCars: normalizePairedCars(parsed.pairedCars),
      };
      return;
    }
  } catch (error) {
    console.warn('[SafeDriver][DIAG] failed to load state', error);
  }
  state = DEFAULT_STATE;
}

load();

function update(next: SafeDriverStorage) {
  persist(next);
}

export function getState(): SafeDriverStorage {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function uniquePorts(portNames: string[]): string[] {
  return Array.from(new Set(portNames));
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const cleaned = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return Array.from(new Set(cleaned));
}

function normalizePairedCars(values: unknown): PairedCar[] {
  if (!Array.isArray(values)) return [];
  const seen = new Map<string, PairedCar>();
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    const entry = value as Partial<PairedCar>;
    const rawId = typeof entry.id === 'string' ? entry.id.trim() : '';
    const rawName = typeof entry.name === 'string' ? entry.name.trim() : '';
    const connected = Boolean(entry.connected);
    if (!rawId && !rawName) continue;
    const key = rawId || rawName;
    const existing = seen.get(key);
    const candidate: PairedCar = {
      id: rawId || rawName,
      name: rawName || 'Paired car',
      connected,
    };
    if (!existing) {
      seen.set(key, candidate);
    } else if (!existing.connected && candidate.connected) {
      seen.set(key, candidate);
    } else if (rawName && rawName !== existing.name) {
      seen.set(key, { ...existing, name: rawName });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function sanitizeBluetoothList(values: string[]): string[] {
  const cleaned = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return uniquePorts(cleaned);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function setSafeDriverEnabled(enabled: boolean) {
  if (state.safeDriverEnabled === enabled) return;
  const next: SafeDriverStorage = {
    ...state,
    safeDriverEnabled: enabled,
  };
  if (!enabled) {
    next.mode = 'OFF';
    next.countdownEndsAt = null;
  }
  update(next);
}

export function setAutoStartOnApprovedCar(enabled: boolean) {
  if (state.autoStartOnApprovedCar === enabled) return;
  update({
    ...state,
    autoStartOnApprovedCar: enabled,
  });
}

export function startCountdown() {
  if (!state.safeDriverEnabled || state.mode !== 'OFF') return;
  const endsAt = new Date(Date.now() + 90_000).toISOString();
  update({
    ...state,
    countdownEndsAt: endsAt,
    mode: 'COUNTDOWN',
  });
}

export function completeCountdown() {
  if (state.mode !== 'COUNTDOWN') return;
  update({
    ...state,
    countdownEndsAt: null,
    mode: 'ACTIVE',
  });
}

export function cancelSafeDriver() {
  if (state.mode === 'OFF' && !state.countdownEndsAt) return;
  update({
    ...state,
    countdownEndsAt: null,
    mode: 'OFF',
  });
}

export function addApprovedPort(portName: string) {
  if (!portName) return;
  const nextPorts = uniquePorts([...state.approvedPorts, portName]);
  update({
    ...state,
    approvedPorts: nextPorts,
  });
}

export function setBluetoothDetectionIdentifiers(identifiers: string[]) {
  const nextList = sanitizeBluetoothList(identifiers);
  if (arraysEqual(nextList, state.bluetoothDetection.identifiers)) return;
  update({
    ...state,
    bluetoothDetection: {
      ...state.bluetoothDetection,
      identifiers: nextList,
    },
  });
}

export function setBluetoothServiceUUIDs(serviceUUIDs: string[]) {
  const nextList = sanitizeBluetoothList(serviceUUIDs);
  if (arraysEqual(nextList, state.bluetoothDetection.serviceUUIDs)) return;
  update({
    ...state,
    bluetoothDetection: {
      ...state.bluetoothDetection,
      serviceUUIDs: nextList,
    },
  });
}

export function setBluetoothRssiThreshold(threshold: number | null) {
  if (state.bluetoothDetection.rssiThreshold === threshold) return;
  update({
    ...state,
    bluetoothDetection: {
      ...state.bluetoothDetection,
      rssiThreshold: threshold,
    },
  });
}

export function rememberDetectedCar() {
  const detected = state.lastDetected;
  if (!detected) return;
  const nextPorts = uniquePorts([...state.approvedPorts, detected.portName]);
  update({
    ...state,
    approvedPorts: nextPorts,
    ignoredPortName: null,
    lastDetected: { ...detected, isApproved: true },
  });
}

export function ignoreDetectedCar() {
  const detected = state.lastDetected;
  if (!detected || detected.isApproved) return;
  update({
    ...state,
    ignoredPortName: detected.portName,
  });
}

export function clearDetectedCar() {
  if (!state.lastDetected && !state.ignoredPortName) return;
  update({
    ...state,
    lastDetected: null,
  });
}

function buildDetectedCar(event: SafeDriverCarRouteEvent): DetectedCarInfo {
  const isApproved = state.approvedPorts.includes(event.portName);
  return {
    portName: event.portName,
    portType: event.portType,
    timestamp: event.timestamp,
    isApproved,
  };
}

export function handleCarDetection(event: SafeDriverCarRouteEvent) {
  if (!event.portName) {
    clearDetectedCar();
    return;
  }
  if (!CAR_LIKE_PORT_TYPES.has(event.portType)) {
    clearDetectedCar();
    return;
  }

  const nextIgnored =
    state.ignoredPortName && state.ignoredPortName !== event.portName
      ? null
      : state.ignoredPortName;
  const detected = buildDetectedCar(event);
  const next: SafeDriverStorage = {
    ...state,
    lastDetected: detected,
    ignoredPortName: nextIgnored,
  };
  update(next);

  const shouldAutoStart =
    detected.isApproved &&
    state.safeDriverEnabled &&
    state.autoStartOnApprovedCar &&
    state.mode === 'OFF';
  if (shouldAutoStart) {
    startCountdown();
  }
}

export function handleBluetoothCarDetection(event: SafeDriverBluetoothDetectionEvent) {
  if (!event || !event.id) return;
  const name = event.name?.trim() || event.id;
  if (!name) return;
  const timestamp = event.ts || new Date().toISOString();
  const detected: DetectedCarInfo = {
    portName: name,
    portType: 'bluetooth',
    timestamp,
    isApproved: true,
  };
  const shouldAutoStart =
    state.safeDriverEnabled && state.autoStartOnApprovedCar && state.mode === 'OFF';
  const next: SafeDriverStorage = {
    ...state,
    lastDetected: detected,
    ignoredPortName: null,
  };
  update(next);
  if (shouldAutoStart) {
    startCountdown();
  }
}

export function markCheckinShownToday() {
  update({
    ...state,
    lastCheckinDate: todayKey(),
  });
}

export function setAccountabilityPartnerPhone(phoneNumber: string | null) {
  if (state.accountabilityPartnerPhone === phoneNumber) return;
  update({
    ...state,
    accountabilityPartnerPhone: phoneNumber,
  });
}

const LIVE_ACTIVITY_SNOOZE_MS = 5 * 60 * 1000;

export function extendCountdownBy(durationMs: number) {
  if (state.mode !== 'COUNTDOWN' || !state.countdownEndsAt) return;
  const currentEnd = new Date(state.countdownEndsAt).getTime();
  const updated = new Date(currentEnd + durationMs).toISOString();
  update({
    ...state,
    countdownEndsAt: updated,
  });
}

export function handleLiveActivityAction(event: SafeDriverLiveActivityActionEvent) {
  if (event.action === 'snooze') {
    extendCountdownBy(LIVE_ACTIVITY_SNOOZE_MS);
    return;
  }
  if (event.action === 'activate') {
    completeCountdown();
  }
}

export function handlePairedCarsUpdate(event: SafeDriverPairedCarsEvent) {
  if (!event || !Array.isArray(event.cars)) return;
  const normalized = normalizePairedCars(event.cars);
  const next: SafeDriverStorage = {
    ...state,
    pairedCars: normalized,
  };
  update(next);
}

export function getSafeDriverSelection(): SafeDriverSelection | null {
  const { state: shieldsState } = loadShieldsState();
  for (const shieldId of SHIELD_STRICTNESS_PRECEDENCE) {
    const shield = shieldsState.shields[shieldId];
    if (shield.screenTimeSelectionBlob) {
      return {
        blob: shield.screenTimeSelectionBlob,
        windows: shield.windows.slice(0, 2),
        shieldId,
      };
    }
  }
  return null;
}

export function hasSafeDriverSelection(): boolean {
  return Boolean(getSafeDriverSelection());
}

export function isSafeDriverActive(): boolean {
  return state.mode === 'ACTIVE';
}

async function initDetectionListener() {
  if (detectionInitialized) return;
  detectionInitialized = true;

  try {
    const route = await SafeDriver.getCurrentRoute();
    if (route) {
      handleCarDetection(route);
    }
  } catch (error) {
    console.debug('[SafeDriver][DIAG] init route check failed', error);
  }

  try {
    await SafeDriver.addListener('carRouteChange', (event) => {
      handleCarDetection(event);
    });
  } catch (error) {
    console.debug('[SafeDriver][DIAG] failed to listen for car route changes', error);
  }

  try {
    await SafeDriver.addListener('carDetected', (event) => {
      handleBluetoothCarDetection(event);
    });
  } catch (error) {
    console.debug('[SafeDriver][DIAG] failed to listen for bluetooth car events', error);
  }

  try {
    await SafeDriver.addListener('pairedCars', (event) => {
      handlePairedCarsUpdate(event);
    });
  } catch (error) {
    console.debug('[SafeDriver][DIAG] failed to listen for paired car events', error);
  }
}

export async function initializeDetection() {
  if (typeof window === 'undefined') return;
  await initDetectionListener();
}

export function resetStateForTesting() {
  update(DEFAULT_STATE);
}
