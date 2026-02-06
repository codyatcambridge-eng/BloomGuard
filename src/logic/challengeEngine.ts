/**
 * Challenge Engine
 * 
 * Weekly challenge selection, progress tracking, and reward logic.
 * Frontend-only, no backend dependencies.
 */

import { UserProgress } from '@/models/UserProgress';
import { getCurrentWeekISO } from './dateUtils';

// ==================== CHALLENGE TYPES ====================

export type WeeklyChallengeType = 
  | 'NO_OVERRIDE_WEEK'
  | 'RESIST_10'
  | 'FOCUS_KNIGHT'
  | 'RECOVERY_WARRIOR';

export interface WeeklyChallengeDefinition {
  id: WeeklyChallengeType;
  name: string;
  description: string;
  goalDescription: string;
  goal: number;
  spReward: number;
  badgeId: string;
  icon: string; // Lucide icon name
}

export interface ChallengeProgress {
  challengeId: WeeklyChallengeType;
  weekISO: string;
  current: number;
  goal: number;
  completed: boolean;
  completedAt: number | null;
  rewardClaimed: boolean;
}

export interface WeeklyStats {
  overridesCount: number;
  triggerAttempts: number;
  resistedCount: number;
  focusMinutes: number;
  recoveriesCompleted: number;
  protectedDays: number;
}

// ==================== CHALLENGE CATALOG ====================

export const WEEKLY_CHALLENGES: Record<WeeklyChallengeType, WeeklyChallengeDefinition> = {
  NO_OVERRIDE_WEEK: {
    id: 'NO_OVERRIDE_WEEK',
    name: 'Iron Shield',
    description: 'Complete 7 days without any partner overrides.',
    goalDescription: '7 protected days',
    goal: 7,
    spReward: 200,
    badgeId: 'iron_shield',
    icon: 'Shield',
  },
  RESIST_10: {
    id: 'RESIST_10',
    name: 'Resistance Master',
    description: 'Resist 10 triggers this week.',
    goalDescription: '10 triggers resisted',
    goal: 10,
    spReward: 180,
    badgeId: 'resistance_master',
    icon: 'Zap',
  },
  FOCUS_KNIGHT: {
    id: 'FOCUS_KNIGHT',
    name: 'Focus Knight',
    description: 'Complete 5 deep focus sessions (25 min) OR 8 quick wins (10 min).',
    goalDescription: '5 deep focus or 8 quick wins',
    goal: 5, // Uses custom logic for 5x25min OR 8x10min
    spReward: 160,
    badgeId: 'focus_knight',
    icon: 'Target',
  },
  RECOVERY_WARRIOR: {
    id: 'RECOVERY_WARRIOR',
    name: 'Recovery Warrior',
    description: 'Complete 5 recovery flows this week.',
    goalDescription: '5 recoveries completed',
    goal: 5,
    spReward: 170,
    badgeId: 'recovery_warrior',
    icon: 'Heart',
  },
};

// ==================== SELECTION LOGIC ====================

/**
 * Select the best challenge for the week based on user's recent stats
 * 
 * Rules:
 * - Never repeat same type back-to-back
 * - If overrides_count > 0 this week => don't choose NO_OVERRIDE_WEEK
 * - If trigger_attempts >= 12 this week => choose RECOVERY_WARRIOR
 * - Else if resisted_count < 6 => choose RESIST_10
 * - Else if focus_minutes < 150 => choose FOCUS_KNIGHT
 * - Else rotate remaining
 */
export function selectWeeklyChallenge(
  previousChallengeId: WeeklyChallengeType | null,
  weeklyStats: WeeklyStats
): WeeklyChallengeType {
  const { overridesCount, triggerAttempts, resistedCount, focusMinutes } = weeklyStats;
  
  // Build candidate list excluding back-to-back repeat
  const allChallenges: WeeklyChallengeType[] = [
    'NO_OVERRIDE_WEEK',
    'RESIST_10',
    'FOCUS_KNIGHT',
    'RECOVERY_WARRIOR',
  ];
  
  let candidates = allChallenges.filter(c => c !== previousChallengeId);
  
  // Rule: If overrides > 0, exclude NO_OVERRIDE_WEEK (too hard after slips)
  if (overridesCount > 0) {
    candidates = candidates.filter(c => c !== 'NO_OVERRIDE_WEEK');
  }
  
  // Rule: High trigger attempts => prioritize RECOVERY_WARRIOR
  if (triggerAttempts >= 12 && candidates.includes('RECOVERY_WARRIOR')) {
    return 'RECOVERY_WARRIOR';
  }
  
  // Rule: Low resisted count => prioritize RESIST_10
  if (resistedCount < 6 && candidates.includes('RESIST_10')) {
    return 'RESIST_10';
  }
  
  // Rule: Low focus minutes => prioritize FOCUS_KNIGHT
  if (focusMinutes < 150 && candidates.includes('FOCUS_KNIGHT')) {
    return 'FOCUS_KNIGHT';
  }
  
  // Default: rotate through remaining candidates
  // Prioritize NO_OVERRIDE_WEEK if eligible (hardest challenge = highest reward)
  if (candidates.includes('NO_OVERRIDE_WEEK')) {
    return 'NO_OVERRIDE_WEEK';
  }
  
  // Otherwise pick first available
  return candidates[0] ?? 'RESIST_10';
}

// ==================== PROGRESS TRACKING ====================

/**
 * Get current challenge progress from user progress
 */
export function getChallengeProgress(progress: UserProgress): ChallengeProgress | null {
  const { weeklyChallengeId, weeklyChallengeWeekISO, weeklyProgress } = progress;
  
  if (!weeklyChallengeId || !weeklyChallengeWeekISO) {
    return null;
  }
  
  const challengeType = weeklyChallengeId as WeeklyChallengeType;
  const definition = WEEKLY_CHALLENGES[challengeType];
  
  if (!definition) {
    return null;
  }
  
  const current = calculateChallengeProgress(challengeType, weeklyProgress);
  const completed = current >= definition.goal;
  
  return {
    challengeId: challengeType,
    weekISO: weeklyChallengeWeekISO,
    current,
    goal: definition.goal,
    completed,
    completedAt: weeklyProgress[`${challengeType}_COMPLETED_AT`] ?? null,
    rewardClaimed: weeklyProgress[`${challengeType}_REWARD_CLAIMED`] === 1,
  };
}

/**
 * Calculate progress for a specific challenge type
 */
export function calculateChallengeProgress(
  challengeType: WeeklyChallengeType,
  weeklyProgress: Record<string, number>
): number {
  switch (challengeType) {
    case 'NO_OVERRIDE_WEEK':
      // Count protected days (days with shield active, no overrides)
      return weeklyProgress['PROTECTED_DAY_NO_UNLOCK'] ?? 0;
    
    case 'RESIST_10':
      // Count resisted triggers
      return weeklyProgress['RESISTED'] ?? 0;
    
    case 'FOCUS_KNIGHT':
      // 5 deep focus (25min) OR 8 quick wins (10min)
      // We'll use a weighted formula: 1 deep focus = 1 point, 1 quick win = 0.625 points
      // Goal is 5, so 8 quick wins = 8 * 0.625 = 5
      const deepFocus = weeklyProgress['FOCUS_25'] ?? 0;
      const quickWins = weeklyProgress['QUICK_WIN_10'] ?? 0;
      
      // If 5+ deep focus, complete. If 8+ quick wins, complete. Otherwise weighted.
      if (deepFocus >= 5) return 5;
      if (quickWins >= 8) return 5;
      
      // Weighted progress: deep focus counts as 1, quick wins as 0.625
      return Math.min(5, deepFocus + (quickWins * 0.625));
    
    case 'RECOVERY_WARRIOR':
      // Count completed recoveries
      return weeklyProgress['RECOVERY_COMPLETED'] ?? 0;
    
    default:
      return 0;
  }
}

/**
 * Update weekly progress for challenge tracking
 * Call this after relevant actions (resist, recovery, focus, etc.)
 */
export function updateChallengeProgress(
  progress: UserProgress,
  actionType: string,
  increment: number = 1
): Record<string, number> {
  const current = progress.weeklyProgress[actionType] ?? 0;
  return {
    ...progress.weeklyProgress,
    [actionType]: current + increment,
  };
}

// ==================== REWARD LOGIC ====================

export interface ChallengeRewardResult {
  spAwarded: number;
  badgeUnlocked: string;
  weeklyProgress: Record<string, number>;
}

/**
 * Claim challenge reward (call once when challenge completes)
 */
export function claimChallengeReward(
  progress: UserProgress,
  challengeType: WeeklyChallengeType
): ChallengeRewardResult | null {
  const definition = WEEKLY_CHALLENGES[challengeType];
  if (!definition) return null;
  
  // Check if already claimed
  if (progress.weeklyProgress[`${challengeType}_REWARD_CLAIMED`] === 1) {
    return null;
  }
  
  const currentProgress = calculateChallengeProgress(challengeType, progress.weeklyProgress);
  
  // Must be completed to claim
  if (currentProgress < definition.goal) {
    return null;
  }
  
  // Mark as claimed
  const updatedProgress: Record<string, number> = {
    ...progress.weeklyProgress,
    [`${challengeType}_REWARD_CLAIMED`]: 1,
    [`${challengeType}_COMPLETED_AT`]: Date.now(),
  };
  
  return {
    spAwarded: definition.spReward,
    badgeUnlocked: definition.badgeId,
    weeklyProgress: updatedProgress,
  };
}

/**
 * Check if challenge is newly completed (for triggering reward modal)
 */
export function isChallengeNewlyCompleted(
  progress: UserProgress,
  previousProgress: Record<string, number>
): boolean {
  const challengeId = progress.weeklyChallengeId as WeeklyChallengeType;
  if (!challengeId) return false;
  
  const definition = WEEKLY_CHALLENGES[challengeId];
  if (!definition) return false;
  
  const prevProgress = calculateChallengeProgress(challengeId, previousProgress);
  const currProgress = calculateChallengeProgress(challengeId, progress.weeklyProgress);
  
  // Was not complete before, is complete now
  return prevProgress < definition.goal && currProgress >= definition.goal;
}

// ==================== WEEK ROLLOVER ====================

/**
 * Initialize a new week's challenge
 */
export function initializeWeeklyChallenge(
  progress: UserProgress,
  weeklyStats: WeeklyStats
): Partial<UserProgress> {
  const currentWeek = getCurrentWeekISO();
  const previousChallenge = progress.weeklyChallengeId as WeeklyChallengeType | null;
  
  // Select new challenge
  const newChallengeId = selectWeeklyChallenge(previousChallenge, weeklyStats);
  
  return {
    weeklyChallengeId: newChallengeId,
    weeklyChallengeWeekISO: currentWeek,
    weeklyProgress: {}, // Reset weekly progress
  };
}

/**
 * Get percentage progress for display
 */
export function getChallengeProgressPercent(
  challengeType: WeeklyChallengeType,
  weeklyProgress: Record<string, number>
): number {
  const definition = WEEKLY_CHALLENGES[challengeType];
  if (!definition) return 0;
  
  const current = calculateChallengeProgress(challengeType, weeklyProgress);
  return Math.min(100, Math.round((current / definition.goal) * 100));
}
