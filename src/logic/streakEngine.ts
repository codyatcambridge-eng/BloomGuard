/**
 * Streak Engine
 * 
 * Deterministic streak calculation logic.
 * Shield streak resets ONLY on protection OFF or partner override.
 * Strength streak NEVER resets from slips.
 */

import { UserProgress } from '@/models/UserProgress';
import { getTodayISO, getYesterdayISO, areConsecutiveDays, isToday } from './dateUtils';

export interface StreakUpdate {
  shieldStreakDays: number;
  strengthStreakDays: number;
  lastShieldDayISO: string | null;
  lastStrengthDayISO: string | null;
}

/**
 * Check if shield streak should increment for today
 * Conditions: protection ON all day, no partner overrides, no protection OFF
 */
export function shouldIncrementShieldStreak(
  progress: UserProgress,
  dayISO: string,
  hadProtectionOn: boolean,
  hadPartnerOverride: boolean,
  hadProtectionOff: boolean
): boolean {
  // Can't increment if already counted this day
  if (progress.lastShieldDayISO === dayISO) {
    return false;
  }
  
  // Must have protection on, no overrides, no turning off
  return hadProtectionOn && !hadPartnerOverride && !hadProtectionOff;
}

/**
 * Check if strength streak should increment for today
 * Conditions: at least one growth action (NEVER resets from slips)
 */
export function shouldIncrementStrengthStreak(
  progress: UserProgress,
  dayISO: string,
  hadGrowthAction: boolean
): boolean {
  // Can't increment if already counted this day
  if (progress.lastStrengthDayISO === dayISO) {
    return false;
  }
  
  return hadGrowthAction;
}

/**
 * Calculate updated shield streak
 */
export function updateShieldStreak(
  progress: UserProgress,
  dayISO: string,
  shouldIncrement: boolean,
  shouldReset: boolean
): Pick<UserProgress, 'shieldStreakDays' | 'lastShieldDayISO'> {
  // Reset takes priority
  if (shouldReset) {
    return {
      shieldStreakDays: 0,
      lastShieldDayISO: null,
    };
  }
  
  if (!shouldIncrement) {
    return {
      shieldStreakDays: progress.shieldStreakDays,
      lastShieldDayISO: progress.lastShieldDayISO,
    };
  }
  
  // Check if this is consecutive
  const isConsecutive = progress.lastShieldDayISO 
    ? areConsecutiveDays(progress.lastShieldDayISO, dayISO)
    : true; // First day counts as consecutive
  
  if (isConsecutive || !progress.lastShieldDayISO) {
    return {
      shieldStreakDays: progress.shieldStreakDays + 1,
      lastShieldDayISO: dayISO,
    };
  }
  
  // Streak was broken by missing days, restart at 1
  return {
    shieldStreakDays: 1,
    lastShieldDayISO: dayISO,
  };
}

/**
 * Calculate updated strength streak
 * NEVER resets from slips - only from missing growth days
 */
export function updateStrengthStreak(
  progress: UserProgress,
  dayISO: string,
  shouldIncrement: boolean
): Pick<UserProgress, 'strengthStreakDays' | 'lastStrengthDayISO'> {
  if (!shouldIncrement) {
    return {
      strengthStreakDays: progress.strengthStreakDays,
      lastStrengthDayISO: progress.lastStrengthDayISO,
    };
  }
  
  // Check if this is consecutive
  const isConsecutive = progress.lastStrengthDayISO 
    ? areConsecutiveDays(progress.lastStrengthDayISO, dayISO)
    : true;
  
  if (isConsecutive || !progress.lastStrengthDayISO) {
    return {
      strengthStreakDays: progress.strengthStreakDays + 1,
      lastStrengthDayISO: dayISO,
    };
  }
  
  // Streak was broken by missing days, restart at 1
  return {
    strengthStreakDays: 1,
    lastStrengthDayISO: dayISO,
  };
}

/**
 * Reset shield streak (called on protection OFF or partner override)
 */
export function resetShieldStreak(
  progress: UserProgress
): Pick<UserProgress, 'shieldStreakDays' | 'lastShieldDayISO'> {
  return {
    shieldStreakDays: 0,
    lastShieldDayISO: null,
  };
}

/**
 * Check for streak milestone bonuses
 */
export function checkStreakMilestones(
  previousStreak: number,
  newStreak: number
): { shieldWeekBonus: boolean; strengthWeekBonus: boolean } {
  // Week bonus triggers at 7, 14, 21, etc.
  const previousWeeks = Math.floor(previousStreak / 7);
  const newWeeks = Math.floor(newStreak / 7);
  
  return {
    shieldWeekBonus: newWeeks > previousWeeks && newStreak >= 7,
    strengthWeekBonus: false, // Calculated separately
  };
}
