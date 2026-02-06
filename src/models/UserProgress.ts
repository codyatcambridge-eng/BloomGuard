/**
 * User Progress Model
 * Core state for the Champ System MVP
 */

import { UserSettings, DEFAULT_USER_SETTINGS } from './UserSettings';

export type PlanTier = 'basic' | 'pro';
export type RankId = 'STONE' | 'BRONZE' | 'IRON' | 'GOLD' | 'CHAMP';

export interface UserProgress {
  userId: string;
  planTier: PlanTier;
  
  // Strength Points
  totalSP: number;
  spToday: number;
  
  // Streaks
  shieldStreakDays: number;
  strengthStreakDays: number;
  lastShieldDayISO: string | null;
  lastStrengthDayISO: string | null;
  
  // Rank & Customization
  currentRank: RankId;
  themeId: string;
  badges: string[];
  
  // Weekly Challenge
  weeklyChallengeId: string | null;
  weeklyChallengeWeekISO: string | null; // e.g. "2026-W06"
  weeklyProgress: Record<string, number>;
  
  // Trigger/Risk State
  lastTriggerAt: number | null;
  recentAttemptCount: number;
  degradedModeUntil: number | null;
  
  // Trust Score
  integrityScore: number; // 0-100
  
  // Embedded settings
  settings: UserSettings;
}

/**
 * Generate a unique user ID for first install
 */
function generateUserId(): string {
  return 'user_' + crypto.randomUUID();
}

/**
 * Default user progress for first install
 */
export const DEFAULT_USER_PROGRESS: UserProgress = {
  userId: '', // Will be generated on first load
  planTier: 'basic',
  
  totalSP: 0,
  spToday: 0,
  
  shieldStreakDays: 0,
  strengthStreakDays: 0,
  lastShieldDayISO: null,
  lastStrengthDayISO: null,
  
  currentRank: 'STONE',
  themeId: 'cathedral',
  badges: [],
  
  weeklyChallengeId: null,
  weeklyChallengeWeekISO: null,
  weeklyProgress: {},
  
  lastTriggerAt: null,
  recentAttemptCount: 0,
  degradedModeUntil: null,
  
  integrityScore: 100,
  
  settings: DEFAULT_USER_SETTINGS,
};

/**
 * Create default progress for a new user
 */
export function createDefaultUserProgress(): UserProgress {
  return {
    ...DEFAULT_USER_PROGRESS,
    userId: generateUserId(),
  };
}

/**
 * Clamp integrity score to valid range (0-100)
 */
export function clampIntegrityScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}
