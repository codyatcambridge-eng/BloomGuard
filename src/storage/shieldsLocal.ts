import {
  SHIELDS_STORAGE_VERSION,
  ShieldsState,
  buildDefaultShieldsState,
  normalizeShieldsState,
  hasShieldConfigBeenInitialized,
} from '@/logic/shields';

const SHIELDS_STORAGE_KEY = 'mw_local_shields_state';

export interface ShieldsStorageLoadResult {
  state: ShieldsState;
  hadPersistedState: boolean;
  wasMigrated: boolean;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function migrateShieldsState(input: unknown): { state: ShieldsState; wasMigrated: boolean } {
  if (!input || typeof input !== 'object') {
    return { state: buildDefaultShieldsState(), wasMigrated: false };
  }

  const asAny = input as Record<string, unknown>;
  const version = typeof asAny.version === 'number' ? asAny.version : null;

  // Missing version means this is not initialized state in this feature release.
  if (version === null) {
    return { state: buildDefaultShieldsState(), wasMigrated: false };
  }

  const normalized = normalizeShieldsState(asAny as Partial<ShieldsState>);
  const wasMigrated = version !== SHIELDS_STORAGE_VERSION;

  return {
    state: normalized,
    wasMigrated,
  };
}

export function loadShieldsState(): ShieldsStorageLoadResult {
  const raw = localStorage.getItem(SHIELDS_STORAGE_KEY);
  if (!raw) {
    return {
      state: buildDefaultShieldsState(),
      hadPersistedState: false,
      wasMigrated: false,
    };
  }

  const parsed = safeParse(raw);
  const hadPersistedState = hasShieldConfigBeenInitialized(parsed);
  const { state, wasMigrated } = migrateShieldsState(parsed);

  return {
    state,
    hadPersistedState,
    wasMigrated,
  };
}

export function saveShieldsState(state: ShieldsState): void {
  const normalized = normalizeShieldsState(state);
  localStorage.setItem(SHIELDS_STORAGE_KEY, JSON.stringify(normalized));
}

export function clearShieldsState(): void {
  localStorage.removeItem(SHIELDS_STORAGE_KEY);
}

export { SHIELDS_STORAGE_KEY };
