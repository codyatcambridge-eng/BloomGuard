/**
 * Challenge Catalog
 * 
 * Types and reward definitions only.
 * Selection logic will be implemented separately.
 */

import { 
  QUICK_WIN_10, 
  FOCUS_25, 
  WORKOUT, 
  JOURNAL, 
  DEVOTIONAL,
  TEXT_BUDDY,
  PROTECTED_DAY_NO_UNLOCK,
} from './points';

// ==================== CHALLENGE TYPES ====================

export type ChallengeType = 
  | 'RESISTANCE'   // Resist triggers
  | 'FOCUS'        // Complete focus sessions
  | 'GROWTH'       // Journaling, devotionals, etc.
  | 'CONSISTENCY'  // Maintain streaks
  | 'COMMUNITY';   // Partner interactions

export type ChallengeDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface ChallengeDefinition {
  id: string;
  name: string;
  description: string;
  type: ChallengeType;
  difficulty: ChallengeDifficulty;
  
  // What counts toward this challenge
  targetAction: string;  // Action key to track
  targetCount: number;   // How many to complete
  
  // Rewards
  spReward: number;
  badgeId: string | null;  // Unlockable badge (if any)
  
  // Availability
  minRank: 'STONE' | 'BRONZE' | 'IRON' | 'GOLD' | 'CHAMP';
  proOnly: boolean;
}

export interface ActiveChallenge {
  challengeId: string;
  weekISO: string;        // e.g., "2026-W06"
  progress: number;       // Current count
  completed: boolean;
  completedAt: number | null;
}

// ==================== CHALLENGE CATALOG ====================

export const CHALLENGE_CATALOG: ChallengeDefinition[] = [
  // === EASY CHALLENGES ===
  {
    id: 'quick_wins_3',
    name: '3 Quick Wins',
    description: 'Complete 3 ten-minute focus sessions this week.',
    type: 'FOCUS',
    difficulty: 'EASY',
    targetAction: 'QUICK_WIN_10',
    targetCount: 3,
    spReward: QUICK_WIN_10 * 3 + 25, // Base + bonus
    badgeId: null,
    minRank: 'STONE',
    proOnly: false,
  },
  {
    id: 'journal_2',
    name: 'Reflective Week',
    description: 'Write 2 journal entries this week.',
    type: 'GROWTH',
    difficulty: 'EASY',
    targetAction: 'JOURNAL',
    targetCount: 2,
    spReward: JOURNAL * 2 + 20,
    badgeId: null,
    minRank: 'STONE',
    proOnly: false,
  },
  {
    id: 'buddy_check_2',
    name: 'Stay Connected',
    description: 'Text your accountability partner 2 times.',
    type: 'COMMUNITY',
    difficulty: 'EASY',
    targetAction: 'TEXT_BUDDY',
    targetCount: 2,
    spReward: TEXT_BUDDY * 2 + 15,
    badgeId: null,
    minRank: 'STONE',
    proOnly: false,
  },
  
  // === MEDIUM CHALLENGES ===
  {
    id: 'focus_master_5',
    name: 'Focus Master',
    description: 'Complete 5 deep focus sessions (25 min each).',
    type: 'FOCUS',
    difficulty: 'MEDIUM',
    targetAction: 'FOCUS_25',
    targetCount: 5,
    spReward: FOCUS_25 * 5 + 50,
    badgeId: 'focus_master',
    minRank: 'BRONZE',
    proOnly: false,
  },
  {
    id: 'protected_days_5',
    name: 'Shield Week',
    description: 'Have 5 protected days (no unlocks).',
    type: 'CONSISTENCY',
    difficulty: 'MEDIUM',
    targetAction: 'PROTECTED_DAY_NO_UNLOCK',
    targetCount: 5,
    spReward: PROTECTED_DAY_NO_UNLOCK * 5 + 75,
    badgeId: 'shield_warrior',
    minRank: 'BRONZE',
    proOnly: false,
  },
  {
    id: 'workout_3',
    name: 'Body & Mind',
    description: 'Log 3 workouts this week.',
    type: 'GROWTH',
    difficulty: 'MEDIUM',
    targetAction: 'WORKOUT',
    targetCount: 3,
    spReward: WORKOUT * 3 + 40,
    badgeId: null,
    minRank: 'STONE',
    proOnly: false,
  },
  {
    id: 'devotional_5',
    name: 'Spiritual Strength',
    description: 'Complete 5 devotionals this week.',
    type: 'GROWTH',
    difficulty: 'MEDIUM',
    targetAction: 'DEVOTIONAL',
    targetCount: 5,
    spReward: DEVOTIONAL * 5 + 60,
    badgeId: 'faithful',
    minRank: 'STONE',
    proOnly: false,
  },
  
  // === HARD CHALLENGES ===
  {
    id: 'perfect_week',
    name: 'Perfect Week',
    description: '7 protected days in a row. Zero unlocks.',
    type: 'CONSISTENCY',
    difficulty: 'HARD',
    targetAction: 'PROTECTED_DAY_NO_UNLOCK',
    targetCount: 7,
    spReward: 250,
    badgeId: 'perfect_week',
    minRank: 'IRON',
    proOnly: false,
  },
  {
    id: 'resistance_master',
    name: 'Resistance Master',
    description: 'Resist 10 triggers without unlocking.',
    type: 'RESISTANCE',
    difficulty: 'HARD',
    targetAction: 'RESIST_IMMEDIATE',
    targetCount: 10,
    spReward: 180,
    badgeId: 'iron_will',
    minRank: 'IRON',
    proOnly: false,
  },
  {
    id: 'daily_focus_7',
    name: 'Daily Discipline',
    description: 'Complete at least one focus session every day.',
    type: 'FOCUS',
    difficulty: 'HARD',
    targetAction: 'FOCUS_DAILY',
    targetCount: 7,
    spReward: 200,
    badgeId: 'disciplined',
    minRank: 'BRONZE',
    proOnly: true,
  },
];

// ==================== HELPERS ====================

/**
 * Get challenges available for a rank
 */
export function getChallengesForRank(
  rankId: 'STONE' | 'BRONZE' | 'IRON' | 'GOLD' | 'CHAMP',
  isPro: boolean
): ChallengeDefinition[] {
  const rankOrder = ['STONE', 'BRONZE', 'IRON', 'GOLD', 'CHAMP'];
  const rankIndex = rankOrder.indexOf(rankId);
  
  return CHALLENGE_CATALOG.filter(c => {
    const minRankIndex = rankOrder.indexOf(c.minRank);
    const rankOk = rankIndex >= minRankIndex;
    const proOk = !c.proOnly || isPro;
    return rankOk && proOk;
  });
}

/**
 * Get challenge by ID
 */
export function getChallengeById(id: string): ChallengeDefinition | null {
  return CHALLENGE_CATALOG.find(c => c.id === id) ?? null;
}

/**
 * Get challenges by type
 */
export function getChallengesByType(type: ChallengeType): ChallengeDefinition[] {
  return CHALLENGE_CATALOG.filter(c => c.type === type);
}

/**
 * Get challenges by difficulty
 */
export function getChallengesByDifficulty(
  difficulty: ChallengeDifficulty
): ChallengeDefinition[] {
  return CHALLENGE_CATALOG.filter(c => c.difficulty === difficulty);
}
