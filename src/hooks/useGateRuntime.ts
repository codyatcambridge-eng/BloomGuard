import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const GATE_STATE_STORAGE_KEY = 'gate_state_v1';
const GATE_STATE_UPDATED_EVENT = 'mw:gate_state_updated';

export type GateRequestContext = 'DisableShield' | 'RevealAttempt' | 'StartPass';

export interface GatePassState {
  reason: string;
  startedAt: number;
  endsAt: number;
  durationMinutes: number;
}

export interface GateCooldownState {
  reason: string;
  startedAt: number;
  endsAt: number;
}

export interface GateStateV1 {
  version: 1;
  activePass: GatePassState | null;
  cooldown: GateCooldownState | null;
  updatedAt: number;
}

export interface EffectiveShieldState {
  shieldEnabled: boolean;
  passActive: boolean;
  passEndsAt: number | null;
  passRemainingSeconds: number;
  cooldownActive: boolean;
  cooldownEndsAt: number | null;
  cooldownRemainingSeconds: number;
  status: 'shield_on' | 'shield_off_pass';
  statusLabel: string;
}

export interface GateAccessDecision {
  allowed: boolean;
  reason: string;
}

interface StartPassInput {
  reason: string;
  duration: number;
}

const DEFAULT_GATE_STATE: GateStateV1 = {
  version: 1,
  activePass: null,
  cooldown: null,
  updatedAt: 0,
};

function coerceTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value > 0 ? value : null;
}

function normalizeGateState(input: unknown): GateStateV1 {
  if (!input || typeof input !== 'object') {
    return DEFAULT_GATE_STATE;
  }

  const record = input as Partial<GateStateV1>;
  const activePassInput = record.activePass as Partial<GatePassState> | null | undefined;
  const cooldownInput = record.cooldown as Partial<GateCooldownState> | null | undefined;

  const passStartedAt = coerceTimestamp(activePassInput?.startedAt);
  const passEndsAt = coerceTimestamp(activePassInput?.endsAt);
  const cooldownStartedAt = coerceTimestamp(cooldownInput?.startedAt);
  const cooldownEndsAt = coerceTimestamp(cooldownInput?.endsAt);

  const activePass =
    passStartedAt !== null &&
    passEndsAt !== null &&
    passEndsAt > passStartedAt &&
    typeof activePassInput?.reason === 'string' &&
    activePassInput.reason.trim().length > 0
      ? {
          reason: activePassInput.reason,
          startedAt: passStartedAt,
          endsAt: passEndsAt,
          durationMinutes:
            typeof activePassInput.durationMinutes === 'number' &&
            Number.isFinite(activePassInput.durationMinutes) &&
            activePassInput.durationMinutes > 0
              ? Math.round(activePassInput.durationMinutes)
              : Math.max(1, Math.round((passEndsAt - passStartedAt) / 60000)),
        }
      : null;

  const cooldown =
    cooldownStartedAt !== null &&
    cooldownEndsAt !== null &&
    cooldownEndsAt > cooldownStartedAt &&
    typeof cooldownInput?.reason === 'string' &&
    cooldownInput.reason.trim().length > 0
      ? {
          reason: cooldownInput.reason,
          startedAt: cooldownStartedAt,
          endsAt: cooldownEndsAt,
        }
      : null;

  return {
    version: 1,
    activePass,
    cooldown,
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
  };
}

function pruneExpiredState(state: GateStateV1, nowTs: number): GateStateV1 {
  const activePass = state.activePass && state.activePass.endsAt > nowTs ? state.activePass : null;
  const cooldown = state.cooldown && state.cooldown.endsAt > nowTs ? state.cooldown : null;

  if (activePass === state.activePass && cooldown === state.cooldown) {
    return state;
  }

  return {
    ...state,
    activePass,
    cooldown,
    updatedAt: nowTs,
  };
}

function areGateStatesEqual(a: GateStateV1, b: GateStateV1): boolean {
  return (
    a.version === b.version &&
    a.updatedAt === b.updatedAt &&
    a.activePass?.reason === b.activePass?.reason &&
    a.activePass?.startedAt === b.activePass?.startedAt &&
    a.activePass?.endsAt === b.activePass?.endsAt &&
    a.activePass?.durationMinutes === b.activePass?.durationMinutes &&
    a.cooldown?.reason === b.cooldown?.reason &&
    a.cooldown?.startedAt === b.cooldown?.startedAt &&
    a.cooldown?.endsAt === b.cooldown?.endsAt
  );
}

function writeGateState(next: GateStateV1, emitEvent: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GATE_STATE_STORAGE_KEY, JSON.stringify(next));
    if (emitEvent) {
      window.dispatchEvent(new CustomEvent(GATE_STATE_UPDATED_EVENT));
    }
  } catch (error) {
    console.error('[GateRuntime] Failed to persist gate state', error);
  }
}

function readGateState(nowTs: number = Date.now()): GateStateV1 {
  if (typeof window === 'undefined') return DEFAULT_GATE_STATE;
  try {
    const raw = window.localStorage.getItem(GATE_STATE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_GATE_STATE;
    }

    const parsed = JSON.parse(raw);
    const normalized = normalizeGateState(parsed);
    const pruned = pruneExpiredState(normalized, nowTs);

    if (!areGateStatesEqual(normalized, pruned)) {
      writeGateState(pruned, false);
    }

    return pruned;
  } catch (error) {
    console.error('[GateRuntime] Failed to read gate state', error);
    return DEFAULT_GATE_STATE;
  }
}

function buildEffectiveShieldState(state: GateStateV1, nowTs: number = Date.now()): EffectiveShieldState {
  const passActive = Boolean(state.activePass && state.activePass.endsAt > nowTs);
  const cooldownActive = Boolean(state.cooldown && state.cooldown.endsAt > nowTs);

  const passRemainingSeconds =
    passActive && state.activePass ? Math.max(0, Math.ceil((state.activePass.endsAt - nowTs) / 1000)) : 0;
  const cooldownRemainingSeconds =
    cooldownActive && state.cooldown ? Math.max(0, Math.ceil((state.cooldown.endsAt - nowTs) / 1000)) : 0;

  if (passActive && state.activePass) {
    return {
      shieldEnabled: false,
      passActive: true,
      passEndsAt: state.activePass.endsAt,
      passRemainingSeconds,
      cooldownActive,
      cooldownEndsAt: state.cooldown?.endsAt ?? null,
      cooldownRemainingSeconds,
      status: 'shield_off_pass',
      statusLabel: `Shield off for ${passRemainingSeconds}s`,
    };
  }

  return {
    shieldEnabled: true,
    passActive: false,
    passEndsAt: null,
    passRemainingSeconds: 0,
    cooldownActive,
    cooldownEndsAt: state.cooldown?.endsAt ?? null,
    cooldownRemainingSeconds,
    status: 'shield_on',
    statusLabel: 'Shield active',
  };
}

function formatSecondsToClock(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function decideAccess(context: GateRequestContext, effective: EffectiveShieldState): GateAccessDecision {
  if (effective.cooldownActive) {
    return {
      allowed: false,
      reason: `Cooldown active (${formatSecondsToClock(effective.cooldownRemainingSeconds)} remaining).`,
    };
  }

  if (context === 'RevealAttempt' && effective.shieldEnabled) {
    return {
      allowed: false,
      reason: 'Shield is active. Start a pass before revealing.',
    };
  }

  return {
    allowed: true,
    reason: 'Allowed by current gate policy.',
  };
}

export function useGateRuntime() {
  const [gateState, setGateState] = useState<GateStateV1>(() => readGateState());
  const expiryTimerRef = useRef<number | null>(null);

  const syncFromStorage = useCallback(() => {
    const next = readGateState();
    setGateState((prev) => (areGateStatesEqual(prev, next) ? prev : next));
  }, []);

  const commitGateState = useCallback((next: GateStateV1) => {
    const pruned = pruneExpiredState(next, Date.now());
    writeGateState(pruned, true);
    setGateState(pruned);
    return pruned;
  }, []);

  const updateGateState = useCallback(
    (updater: (prev: GateStateV1, nowTs: number) => GateStateV1) => {
      const nowTs = Date.now();
      const prev = readGateState(nowTs);
      const candidate = normalizeGateState(updater(prev, nowTs));
      const next = {
        ...candidate,
        version: 1 as const,
        updatedAt: nowTs,
      };
      return commitGateState(next);
    },
    [commitGateState],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onStorage = (event: StorageEvent) => {
      if (event.key !== GATE_STATE_STORAGE_KEY) return;
      syncFromStorage();
    };
    const onGateEvent = () => syncFromStorage();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncFromStorage();
      }
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(GATE_STATE_UPDATED_EVENT, onGateEvent);
    window.addEventListener('focus', onGateEvent);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(GATE_STATE_UPDATED_EVENT, onGateEvent);
      window.removeEventListener('focus', onGateEvent);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [syncFromStorage]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (expiryTimerRef.current !== null) {
      window.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }

    const nowTs = Date.now();
    const expiryCandidates = [gateState.activePass?.endsAt, gateState.cooldown?.endsAt].filter(
      (value): value is number => typeof value === 'number' && value > nowTs,
    );

    if (expiryCandidates.length === 0) return;
    const nextExpiry = Math.min(...expiryCandidates);
    const delayMs = Math.max(0, nextExpiry - nowTs + 25);

    expiryTimerRef.current = window.setTimeout(() => {
      syncFromStorage();
    }, delayMs);

    return () => {
      if (expiryTimerRef.current !== null) {
        window.clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
    };
  }, [gateState.activePass?.endsAt, gateState.cooldown?.endsAt, syncFromStorage]);

  const effectiveShieldState = useMemo(() => buildEffectiveShieldState(gateState), [gateState]);

  const getEffectiveShieldState = useCallback(() => {
    const state = readGateState();
    const effective = buildEffectiveShieldState(state);
    setGateState((prev) => (areGateStatesEqual(prev, state) ? prev : state));
    return effective;
  }, []);

  const requestAccess = useCallback((context: GateRequestContext): GateAccessDecision => {
    const effective = getEffectiveShieldState();
    return decideAccess(context, effective);
  }, [getEffectiveShieldState]);

  const startPass = useCallback(
    ({ reason, duration }: StartPassInput) => {
      const durationMinutes = Math.max(1, Math.min(180, Math.round(duration)));
      return updateGateState((prev, nowTs) => ({
        ...prev,
        activePass: {
          reason: reason.trim() || 'manual',
          startedAt: nowTs,
          endsAt: nowTs + durationMinutes * 60 * 1000,
          durationMinutes,
        },
      }));
    },
    [updateGateState],
  );

  const endPass = useCallback(() => {
    return updateGateState((prev) => ({
      ...prev,
      activePass: null,
    }));
  }, [updateGateState]);

  const applyCooldown = useCallback(
    (seconds: number, reason: string) => {
      const durationSeconds = Math.max(0, Math.round(seconds));
      return updateGateState((prev, nowTs) => ({
        ...prev,
        cooldown:
          durationSeconds > 0
            ? {
                reason: reason.trim() || 'cooldown',
                startedAt: nowTs,
                endsAt: nowTs + durationSeconds * 1000,
              }
            : null,
      }));
    },
    [updateGateState],
  );

  return {
    gateState,
    effectiveShieldState,
    getEffectiveShieldState,
    requestAccess,
    startPass,
    endPass,
    applyCooldown,
  };
}
