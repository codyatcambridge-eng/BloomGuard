/**
 * Utility Pass Hook
 * 
 * Manages utility pass state with localStorage persistence
 * and automatic expiry checking.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from '@/hooks/use-toast';
import {
  UtilityPassState,
  UtilityPassReason,
  UtilityPassDuration,
  DEFAULT_PASS_STATE,
  createUtilityPass,
  isPassActive,
  getRemainingSeconds,
  checkPassExpiry,
  endPassEarly as endPassEarlyLogic,
  formatRemainingTime,
  UTILITY_PASS_PLATFORM,
} from '@/logic/utilityPass';
import { createTriggerEvent } from '@/models/TriggerEvent';
import { appendTriggerEvent } from '@/storage/eventsRepo';

const STORAGE_KEY = 'utility_pass_state';

interface UseUtilityPassReturn {
  passState: UtilityPassState;
  isActive: boolean;
  remainingSeconds: number;
  remainingFormatted: string;
  startPass: (reason: UtilityPassReason, duration: UtilityPassDuration, gateLevel: number) => Promise<void>;
  endPassEarly: () => void;
}

export function useUtilityPass(): UseUtilityPassReturn {
  const [passState, setPassState] = useState<UtilityPassState>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as UtilityPassState;
        // Check if still valid
        return checkPassExpiry(parsed, Date.now());
      }
    } catch {
      // Ignore parse errors
    }
    return DEFAULT_PASS_STATE;
  });
  
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Persist state changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(passState));
  }, [passState]);
  
  // Update remaining time every second when active
  useEffect(() => {
    if (passState.isActive && passState.expiresAt) {
      const updateRemaining = () => {
        const nowTs = Date.now();
        const remaining = getRemainingSeconds(passState, nowTs);
        setRemainingSeconds(remaining);
        
        // Check expiry
        if (remaining <= 0) {
          setPassState(DEFAULT_PASS_STATE);
          toast({
            title: 'Reset. Rebuild. Return.',
            description: 'Utility Pass ended. Protection restored.',
            duration: 3000,
          });
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        }
      };
      
      updateRemaining();
      intervalRef.current = setInterval(updateRemaining, 1000);
      
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      };
    } else {
      setRemainingSeconds(0);
    }
  }, [passState.isActive, passState.expiresAt]);
  
  const startPass = useCallback(async (
    reason: UtilityPassReason,
    duration: UtilityPassDuration,
    gateLevel: number
  ) => {
    const nowTs = Date.now();
    const newState = createUtilityPass(reason, duration, nowTs);
    setPassState(newState);
    
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
  }, []);
  
  const endPassEarly = useCallback(() => {
    setPassState(endPassEarlyLogic());
    toast({
      title: 'Reset. Rebuild. Return.',
      description: 'Utility Pass ended early. Protection restored.',
      duration: 3000,
    });
  }, []);
  
  return {
    passState,
    isActive: isPassActive(passState, Date.now()),
    remainingSeconds,
    remainingFormatted: formatRemainingTime(remainingSeconds),
    startPass,
    endPassEarly,
  };
}
