/**
 * Utility Pass Hook
 * 
 * Uses GateRuntime as the single pass/shield source of truth.
 */

import { useCallback, useMemo } from 'react';
import { toast } from '@/hooks/use-toast';
import {
  UtilityPassState,
  UtilityPassReason,
  UtilityPassDuration,
  formatRemainingTime,
  UTILITY_PASS_PLATFORM,
} from '@/logic/utilityPass';
import { createTriggerEvent } from '@/models/TriggerEvent';
import { appendTriggerEvent } from '@/storage/eventsRepo';
import { useGateRuntime } from './useGateRuntime';

interface UseUtilityPassReturn {
  passState: UtilityPassState;
  isActive: boolean;
  remainingSeconds: number;
  remainingFormatted: string;
  startPass: (reason: UtilityPassReason, duration: UtilityPassDuration, gateLevel: number) => Promise<void>;
  endPassEarly: () => void;
}

function isUtilityPassReason(value: string | null | undefined): value is UtilityPassReason {
  return value === 'SCHOOL' || value === 'WORK' || value === 'BILLS_BANK' || value === 'MEDICAL' || value === 'FAMILY';
}

function toUtilityPassDuration(value: number | null | undefined): UtilityPassDuration | null {
  if (value === 5 || value === 10 || value === 15) {
    return value;
  }
  return null;
}

export function useUtilityPass(): UseUtilityPassReturn {
  const { gateState, startPass: startGatePass, endPass } = useGateRuntime();
  const nowTs = Date.now();

  const activePass = gateState.activePass && gateState.activePass.endsAt > nowTs ? gateState.activePass : null;
  const isActive = Boolean(activePass);
  const remainingSeconds = activePass ? Math.max(0, Math.floor((activePass.endsAt - nowTs) / 1000)) : 0;

  const passState = useMemo<UtilityPassState>(() => {
    if (!activePass) {
      return {
        isActive: false,
        reason: null,
        startedAt: null,
        expiresAt: null,
        durationMinutes: null,
      };
    }

    return {
      isActive: true,
      reason: isUtilityPassReason(activePass.reason) ? activePass.reason : null,
      startedAt: activePass.startedAt,
      expiresAt: activePass.endsAt,
      durationMinutes: toUtilityPassDuration(activePass.durationMinutes),
    };
  }, [activePass]);
  
  const startPass = useCallback(async (
    reason: UtilityPassReason,
    duration: UtilityPassDuration,
    gateLevel: number
  ) => {
    startGatePass({ reason, duration });
    
    // Log trigger event (privacy-safe)
    const event = createTriggerEvent(
      gateLevel as 1 | 2 | 3 | 4,
      'UNLOCKED',
      {
        platform: UTILITY_PASS_PLATFORM,
        recoveryCompleted: false,
      }
    );
    await appendTriggerEvent(event);
    
    toast({
      title: 'Utility Pass active',
      description: `Shield engaged for ${duration} minutes`,
      duration: 2000,
    });
  }, [startGatePass]);
  
  const endPassEarly = useCallback(() => {
    endPass();
    toast({
      title: 'Reset. Rebuild. Return.',
      description: 'Utility Pass ended early. Protection restored.',
      duration: 3000,
    });
  }, [endPass]);
  
  return {
    passState,
    isActive,
    remainingSeconds,
    remainingFormatted: formatRemainingTime(remainingSeconds),
    startPass,
    endPassEarly,
  };
}
