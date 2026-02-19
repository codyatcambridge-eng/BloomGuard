import { SafeDriver, type SafeDriverCarRouteEvent } from '@/plugins/SafeDriver';
import { loadShieldsState } from '@/storage/shieldsLocal';
import { SHIELD_STRICTNESS_PRECEDENCE, type ShieldId, type ShieldWindow } from '@/logic/shields';

export type SafeDriverMode = 'OFF' | 'ARMED' | 'COUNTDOWN' | 'ACTIVE';

export interface DetectedCarInfo {
  portName: string;
  localizedName: string;
  portType: string;
  timestamp: string;
  isApproved: boolean;
}

export interface SafeDriverStorage {
  mode: SafeDriverMode;
  countdownExpiresAt: string | null;
  approvedPortNames: string[];
  lastCheckinDate: string | null;
  lastDetectedCar: DetectedCarInfo | null;
}

export interface SafeDriverSelection {
  blob: string;
  windows: ShieldWindow[];
  shieldId: ShieldId;
}

const STORAGE_KEY = 'mw_safe_driver_state';

const DEFAULT_STATE: SafeDriverStorage = {
  mode: 'OFF',
  countdownExpiresAt: null,
  approvedPortNames: [],
  lastCheckinDate: null,
  lastDetectedCar: null,
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
      state = {
        ...DEFAULT_STATE,
        ...parsed,
        approvedPortNames: Array.isArray(parsed.approvedPortNames) ? parsed.approvedPortNames : [],
        lastDetectedCar: parsed.lastDetectedCar ?? null,
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

export function startCountdown() {
  const expiresAt = new Date(Date.now() + 90_000).toISOString();
  update({
    ...state,
    countdownExpiresAt: expiresAt,
    mode: 'COUNTDOWN',
  });
}

export function completeCountdown() {
  update({
    ...state,
    countdownExpiresAt: null,
    mode: 'ACTIVE',
  });
}

export function cancelSafeDriver() {
  update({
    ...state,
    countdownExpiresAt: null,
    mode: 'OFF',
  });
}

export function armSafeDriver() {
  update({
    ...state,
    countdownExpiresAt: null,
    mode: 'ARMED',
  });
}

export function addApprovedPort(portName: string) {
  if (!portName) return;
  const nextPorts = uniquePorts([...state.approvedPortNames, portName]);
  update({
    ...state,
    approvedPortNames: nextPorts,
  });
}

export function rememberDetectedCar() {
  const lastCar = state.lastDetectedCar;
  if (!lastCar) return;
  const nextPorts = uniquePorts([...state.approvedPortNames, lastCar.portName]);
  const next: SafeDriverStorage = {
    ...state,
    approvedPortNames: nextPorts,
    lastDetectedCar: { ...lastCar, isApproved: true },
  };
  if (next.mode === 'OFF') {
    next.mode = 'ARMED';
    next.countdownExpiresAt = null;
  }
  update(next);
}

export function clearDetectedCar() {
  if (!state.lastDetectedCar) return;
  update({
    ...state,
    lastDetectedCar: null,
  });
}

function buildDetectedCar(event: SafeDriverCarRouteEvent): DetectedCarInfo {
  const isApproved = state.approvedPortNames.includes(event.portName);
  return {
    portName: event.portName,
    localizedName: event.localizedName || event.portName,
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
  const detected = buildDetectedCar(event);
  const next: SafeDriverStorage = {
    ...state,
    lastDetectedCar: detected,
  };
  if (detected.isApproved && next.mode === 'OFF') {
    next.mode = 'ARMED';
    next.countdownExpiresAt = null;
  }
  update(next);
}

export function markCheckinShownToday() {
  update({
    ...state,
    lastCheckinDate: todayKey(),
  });
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
}

export async function initializeDetection() {
  if (typeof window === 'undefined') return;
  await initDetectionListener();
}

export function resetStateForTesting() {
  update(DEFAULT_STATE);
}
