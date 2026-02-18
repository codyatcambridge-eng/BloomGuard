import { useCallback, useEffect, useState } from 'react';
import {
  ShieldId,
  ShieldWindow,
  ShieldsState,
  OnboardingAnswers,
  buildDefaultShield,
  buildDefaultShieldsState,
  normalizeShieldsState,
  applyOnboardingDefaults,
} from '@/logic/shields';
import { loadShieldsState, saveShieldsState } from '@/storage/shieldsLocal';

export interface UseLocalShieldsResult {
  state: ShieldsState;
  isLoaded: boolean;
  hasPersistedState: boolean;
  saveState: (next: ShieldsState) => void;
  setShieldEnabled: (shieldId: ShieldId, enabled: boolean) => void;
  updateShieldWindows: (shieldId: ShieldId, windows: ShieldWindow[]) => void;
  addProtectedAppId: (shieldId: ShieldId, appId: string) => void;
  updateProtectedAppId: (shieldId: ShieldId, index: number, appId: string) => void;
  removeProtectedAppId: (shieldId: ShieldId, index: number) => void;
  moveProtectedAppId: (shieldId: ShieldId, index: number, direction: 'up' | 'down') => void;
  dismissOnboardingCta: () => void;
  applyOnboarding: (answers: OnboardingAnswers) => void;
}

export const useLocalShields = (): UseLocalShieldsResult => {
  const [state, setState] = useState<ShieldsState>(buildDefaultShieldsState());
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasPersistedState, setHasPersistedState] = useState(false);

  useEffect(() => {
    const loaded = loadShieldsState();
    setState(loaded.state);
    setHasPersistedState(loaded.hadPersistedState);

    if (loaded.wasMigrated && loaded.hadPersistedState) {
      saveShieldsState(loaded.state);
    }

    setIsLoaded(true);
  }, []);

  const saveState = useCallback((next: ShieldsState) => {
    const normalized = normalizeShieldsState(next);
    setState(normalized);
    saveShieldsState(normalized);
  }, []);

  const setShieldEnabled = useCallback((shieldId: ShieldId, enabled: boolean) => {
    const current = state.shields[shieldId] || buildDefaultShield(shieldId);
    saveState({
      ...state,
      configuredAt: state.configuredAt || new Date().toISOString(),
      shields: {
        ...state.shields,
        [shieldId]: { ...current, enabled },
      },
    });
  }, [state, saveState]);

  const updateShieldWindows = useCallback((shieldId: ShieldId, windows: ShieldWindow[]) => {
    const current = state.shields[shieldId] || buildDefaultShield(shieldId);
    saveState({
      ...state,
      configuredAt: state.configuredAt || new Date().toISOString(),
      shields: {
        ...state.shields,
        [shieldId]: {
          ...current,
          windows: windows.slice(0, 2),
        },
      },
    });
  }, [state, saveState]);

  const addProtectedAppId = useCallback((shieldId: ShieldId, appId: string) => {
    const trimmed = appId.trim();
    if (!trimmed) return;

    const current = state.shields[shieldId] || buildDefaultShield(shieldId);
    if (current.protectedAppIds.includes(trimmed)) return;

    saveState({
      ...state,
      configuredAt: state.configuredAt || new Date().toISOString(),
      shields: {
        ...state.shields,
        [shieldId]: {
          ...current,
          protectedAppIds: [...current.protectedAppIds, trimmed],
        },
      },
    });
  }, [state, saveState]);

  const updateProtectedAppId = useCallback((shieldId: ShieldId, index: number, appId: string) => {
    const trimmed = appId.trim();
    if (!trimmed) return;

    const current = state.shields[shieldId] || buildDefaultShield(shieldId);
    if (index < 0 || index >= current.protectedAppIds.length) return;

    const nextList = [...current.protectedAppIds];
    nextList[index] = trimmed;

    saveState({
      ...state,
      configuredAt: state.configuredAt || new Date().toISOString(),
      shields: {
        ...state.shields,
        [shieldId]: {
          ...current,
          protectedAppIds: nextList,
        },
      },
    });
  }, [state, saveState]);

  const removeProtectedAppId = useCallback((shieldId: ShieldId, index: number) => {
    const current = state.shields[shieldId] || buildDefaultShield(shieldId);
    if (index < 0 || index >= current.protectedAppIds.length) return;

    const nextList = [...current.protectedAppIds];
    nextList.splice(index, 1);

    saveState({
      ...state,
      configuredAt: state.configuredAt || new Date().toISOString(),
      shields: {
        ...state.shields,
        [shieldId]: {
          ...current,
          protectedAppIds: nextList,
        },
      },
    });
  }, [state, saveState]);

  const moveProtectedAppId = useCallback((shieldId: ShieldId, index: number, direction: 'up' | 'down') => {
    const current = state.shields[shieldId] || buildDefaultShield(shieldId);
    const nextIndex = direction === 'up' ? index - 1 : index + 1;

    if (index < 0 || nextIndex < 0 || index >= current.protectedAppIds.length || nextIndex >= current.protectedAppIds.length) {
      return;
    }

    const nextList = [...current.protectedAppIds];
    const [moved] = nextList.splice(index, 1);
    nextList.splice(nextIndex, 0, moved);

    saveState({
      ...state,
      configuredAt: state.configuredAt || new Date().toISOString(),
      shields: {
        ...state.shields,
        [shieldId]: {
          ...current,
          protectedAppIds: nextList,
        },
      },
    });
  }, [state, saveState]);

  const dismissOnboardingCta = useCallback(() => {
    saveState({
      ...state,
      onboardingDismissed: true,
    });
  }, [state, saveState]);

  const applyOnboarding = useCallback((answers: OnboardingAnswers) => {
    const initialized = applyOnboardingDefaults(answers);
    saveState({
      ...initialized,
      onboardingDismissed: true,
    });
    setHasPersistedState(true);
  }, [saveState]);

  return {
    state,
    isLoaded,
    hasPersistedState,
    saveState,
    setShieldEnabled,
    updateShieldWindows,
    addProtectedAppId,
    updateProtectedAppId,
    removeProtectedAppId,
    moveProtectedAppId,
    dismissOnboardingCta,
    applyOnboarding,
  };
};
