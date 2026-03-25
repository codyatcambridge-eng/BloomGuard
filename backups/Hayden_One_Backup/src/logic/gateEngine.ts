/**
 * Gate Engine
 * 
 * Determines gate level based on trigger timing and escalation rules.
 * Does NOT modify detection/blur backend - only reads existing signals.
 */

import { UserProgress } from '@/models/UserProgress';

export type GateLevel = 1 | 2 | 3 | 4;

export interface GateState {
  level: GateLevel;
  cooldownSeconds: number;
  requiresIntention: boolean;
  requiresReplacement: boolean;
  isHighRisk: boolean;
}

// Time windows in milliseconds
const TEN_MINUTES_MS = 10 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

/**
 * Calculate gate level based on trigger history and risk flag
 * 
 * Rules:
 * - highRiskFlag => level 4
 * - no trigger in last 10 min => level 1
 * - 1 attempt within last 10 min => level 2
 * - 3+ attempts within last 30 min => level 3
 * - else => level 2
 */
export function calculateGateLevel(
  nowTs: number,
  lastTriggerAt: number | null,
  recentAttemptCount: number,
  highRiskFlag: boolean
): GateLevel {
  // High risk always escalates to level 4
  if (highRiskFlag) {
    return 4;
  }
  
  // No recent trigger => level 1 (minimal friction)
  if (!lastTriggerAt || nowTs - lastTriggerAt > TEN_MINUTES_MS) {
    return 1;
  }
  
  // 3+ attempts in rolling window => level 3
  if (recentAttemptCount >= 3) {
    return 3;
  }
  
  // 1+ attempt within 10 min => level 2
  if (recentAttemptCount >= 1) {
    return 2;
  }
  
  // Default to level 2
  return 2;
}

/**
 * Get full gate state including requirements
 */
export function getGateState(
  progress: UserProgress,
  nowTs: number,
  highRiskFlag: boolean
): GateState {
  const level = calculateGateLevel(
    nowTs,
    progress.lastTriggerAt,
    progress.recentAttemptCount,
    highRiskFlag
  );
  
  // Clamp cooldown to 30-90 seconds
  const cooldownSeconds = Math.max(30, Math.min(90, progress.settings.cooldownSeconds));
  
  return {
    level,
    cooldownSeconds,
    requiresIntention: level >= 2,
    requiresReplacement: level >= 3,
    isHighRisk: level === 4,
  };
}

/**
 * Update attempt count on gate open
 * Returns new recentAttemptCount
 */
export function incrementAttempts(
  nowTs: number,
  lastTriggerAt: number | null,
  currentAttempts: number
): number {
  // If last trigger was > 30 min ago, decay to 1
  if (!lastTriggerAt || nowTs - lastTriggerAt > THIRTY_MINUTES_MS) {
    return 1;
  }
  
  return currentAttempts + 1;
}

/**
 * Decay attempts if enough time has passed
 * Call this on app resume or periodic check
 */
export function decayAttempts(
  nowTs: number,
  lastTriggerAt: number | null,
  currentAttempts: number
): number {
  // If > 30 min since last trigger, decay to 0-1
  if (!lastTriggerAt || nowTs - lastTriggerAt > THIRTY_MINUTES_MS) {
    return Math.min(1, currentAttempts);
  }
  
  // If > 10 min, decay by 1
  if (nowTs - lastTriggerAt > TEN_MINUTES_MS) {
    return Math.max(0, currentAttempts - 1);
  }
  
  return currentAttempts;
}

/**
 * Check if within repeat bonus window (10 min)
 */
export function isWithinRepeatWindow(
  nowTs: number,
  lastTriggerAt: number | null
): boolean {
  if (!lastTriggerAt) return false;
  return nowTs - lastTriggerAt <= TEN_MINUTES_MS;
}

/**
 * Get level-specific copy
 */
export function getGateCopy(level: GateLevel): {
  title: string;
  subtitle: string;
  resistMessage: string;
} {
  switch (level) {
    case 1:
      return {
        title: 'Delay is power.',
        subtitle: 'Take a breath. Your future self is watching.',
        resistMessage: 'That was a win.',
      };
    case 2:
      return {
        title: 'Delay is power.',
        subtitle: 'Be honest with yourself.',
        resistMessage: 'That was a win.',
      };
    case 3:
      return {
        title: 'Redirect your energy.',
        subtitle: 'Choose strength over impulse.',
        resistMessage: 'That was a win.',
      };
    case 4:
      return {
        title: 'Shield engaged.',
        subtitle: 'This is a high-risk moment. You have the power to walk away.',
        resistMessage: 'That was a win.',
      };
  }
}

/**
 * Get cooldown for level 3 (replacement required OR wait)
 */
export function getLevel3WaitTime(): number {
  return 3 * 60; // 3 minutes in seconds
}
