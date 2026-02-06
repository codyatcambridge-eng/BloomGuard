/**
 * Week Engine
 * 
 * ISO week rollover logic for weekly challenges and bonuses.
 */

import { UserProgress } from '@/models/UserProgress';
import { getCurrentWeekISO, getWeekStartISO, getWeekEndISO } from './dateUtils';

export interface WeekRolloverResult {
  isNewWeek: boolean;
  previousWeekISO: string | null;
  currentWeekISO: string;
  weeklyProgress: Record<string, number>;
  weeklyChallengeId: string | null;
  weeklyChallengeWeekISO: string | null;
}

/**
 * Check if we need to roll over to a new week
 */
export function checkWeekRollover(progress: UserProgress): WeekRolloverResult {
  const currentWeek = getCurrentWeekISO();
  const storedWeek = progress.weeklyChallengeWeekISO;
  
  if (storedWeek === currentWeek) {
    // Same week, no rollover needed
    return {
      isNewWeek: false,
      previousWeekISO: null,
      currentWeekISO: currentWeek,
      weeklyProgress: progress.weeklyProgress,
      weeklyChallengeId: progress.weeklyChallengeId,
      weeklyChallengeWeekISO: progress.weeklyChallengeWeekISO,
    };
  }
  
  // New week detected - reset weekly progress
  return {
    isNewWeek: true,
    previousWeekISO: storedWeek,
    currentWeekISO: currentWeek,
    weeklyProgress: {}, // Reset weekly progress counters
    weeklyChallengeId: null, // Will be set by challenge selection logic
    weeklyChallengeWeekISO: currentWeek,
  };
}

/**
 * Apply week rollover to progress
 */
export function applyWeekRollover(
  progress: UserProgress,
  rollover: WeekRolloverResult
): Partial<UserProgress> {
  if (!rollover.isNewWeek) {
    return {};
  }
  
  return {
    weeklyProgress: rollover.weeklyProgress,
    weeklyChallengeId: rollover.weeklyChallengeId,
    weeklyChallengeWeekISO: rollover.weeklyChallengeWeekISO,
  };
}

/**
 * Increment weekly progress for an action type
 */
export function incrementWeeklyProgress(
  progress: UserProgress,
  actionType: string
): Record<string, number> {
  const currentCount = progress.weeklyProgress[actionType] ?? 0;
  return {
    ...progress.weeklyProgress,
    [actionType]: currentCount + 1,
  };
}

/**
 * Get weekly progress for a specific action
 */
export function getWeeklyProgressCount(
  progress: UserProgress,
  actionType: string
): number {
  return progress.weeklyProgress[actionType] ?? 0;
}

/**
 * Check if weekly challenge is complete
 */
export function isWeeklyChallengeComplete(
  progress: UserProgress,
  targetAction: string,
  targetCount: number
): boolean {
  const current = getWeeklyProgressCount(progress, targetAction);
  return current >= targetCount;
}

/**
 * Calculate days remaining in current week
 */
export function getDaysRemainingInWeek(): number {
  const now = new Date();
  const dayOfWeek = now.getDay();
  // Sunday = 0, so days until next Monday
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  return daysUntilSunday;
}
