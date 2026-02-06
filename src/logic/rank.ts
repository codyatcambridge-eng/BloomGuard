/**
 * Rank System
 * 
 * One-way progression ladder. Once unlocked, ranks are permanent.
 * Ranks are based on total SP + days active.
 */

import type { RankId } from '@/models/UserProgress';

export interface Rank {
  id: RankId;
  name: string;
  title: string;
  requiredSP: number;
  requiredDays: number;
  color: string;       // CSS color value
  glowColor: string;   // CSS glow color
  description: string;
  unlockMessage: string;
}

/**
 * Rank definitions - ordered from lowest to highest
 */
export const RANKS: Rank[] = [
  {
    id: 'STONE',
    name: 'Stone',
    title: 'Stone Foundation',
    requiredSP: 0,
    requiredDays: 0,
    color: 'hsl(220, 10%, 45%)',
    glowColor: 'hsl(220, 10%, 45% / 0.3)',
    description: 'Every journey begins with a single step.',
    unlockMessage: 'Welcome, warrior. Your foundation is set.',
  },
  {
    id: 'BRONZE',
    name: 'Bronze',
    title: 'Bronze Guardian',
    requiredSP: 350,
    requiredDays: 8,
    color: 'hsl(30, 70%, 50%)',
    glowColor: 'hsl(30, 70%, 50% / 0.4)',
    description: 'Proving your commitment through consistent action.',
    unlockMessage: 'Bronze unlocked! You\'ve proven you can show up.',
  },
  {
    id: 'IRON',
    name: 'Iron',
    title: 'Iron Sentinel',
    requiredSP: 900,
    requiredDays: 22,
    color: 'hsl(220, 15%, 55%)',
    glowColor: 'hsl(220, 15%, 55% / 0.4)',
    description: 'Forged through resistance. Unbreakable resolve.',
    unlockMessage: 'Iron forged! Your discipline is becoming second nature.',
  },
  {
    id: 'GOLD',
    name: 'Gold',
    title: 'Gold Champion',
    requiredSP: 2000,
    requiredDays: 46,
    color: 'hsl(45, 90%, 55%)',
    glowColor: 'hsl(45, 90%, 55% / 0.4)',
    description: 'A beacon of strength. Others look to you.',
    unlockMessage: 'Gold achieved! You\'re becoming who you were meant to be.',
  },
  {
    id: 'CHAMP',
    name: 'Champ',
    title: 'Miracle Worker Champion',
    requiredSP: 4000,
    requiredDays: 91,
    color: 'hsl(280, 80%, 60%)',
    glowColor: 'hsl(280, 80%, 60% / 0.5)',
    description: 'Master of self. Living proof that change is possible.',
    unlockMessage: 'CHAMPION! You\'ve achieved what once seemed impossible.',
  },
];

/**
 * Get rank by ID
 */
export function getRankById(id: RankId): Rank {
  return RANKS.find(r => r.id === id) ?? RANKS[0];
}

/**
 * Get the highest unlocked rank based on SP and days
 */
export function getCurrentRank(totalSP: number, totalDays: number): Rank {
  let currentRank = RANKS[0];
  
  for (const rank of RANKS) {
    if (totalSP >= rank.requiredSP && totalDays >= rank.requiredDays) {
      currentRank = rank;
    }
  }
  
  return currentRank;
}

/**
 * Get the next rank to unlock (or null if at max)
 */
export function getNextRank(currentRankId: RankId): Rank | null {
  const currentIndex = RANKS.findIndex(r => r.id === currentRankId);
  if (currentIndex === -1 || currentIndex === RANKS.length - 1) {
    return null;
  }
  return RANKS[currentIndex + 1];
}

/**
 * Progress toward next rank
 */
export interface RankProgress {
  currentRank: Rank;
  nextRank: Rank | null;
  totalSP: number;
  totalDays: number;
  spProgress: number;      // 0-100 percentage
  daysProgress: number;    // 0-100 percentage
  overallProgress: number; // 0-100 (average)
  spToNextRank: number;
  daysToNextRank: number;
}

/**
 * Calculate progress toward next rank
 */
export function calculateRankProgress(totalSP: number, totalDays: number): RankProgress {
  const currentRank = getCurrentRank(totalSP, totalDays);
  const nextRank = getNextRank(currentRank.id);
  
  if (!nextRank) {
    return {
      currentRank,
      nextRank: null,
      totalSP,
      totalDays,
      spProgress: 100,
      daysProgress: 100,
      overallProgress: 100,
      spToNextRank: 0,
      daysToNextRank: 0,
    };
  }
  
  // SP progress
  const spRange = nextRank.requiredSP - currentRank.requiredSP;
  const spGained = totalSP - currentRank.requiredSP;
  const spProgress = Math.min(100, Math.round((spGained / spRange) * 100));
  const spToNextRank = Math.max(0, nextRank.requiredSP - totalSP);
  
  // Days progress
  const daysRange = nextRank.requiredDays - currentRank.requiredDays;
  const daysGained = totalDays - currentRank.requiredDays;
  const daysProgress = Math.min(100, Math.round((daysGained / daysRange) * 100));
  const daysToNextRank = Math.max(0, nextRank.requiredDays - totalDays);
  
  return {
    currentRank,
    nextRank,
    totalSP,
    totalDays,
    spProgress,
    daysProgress,
    overallProgress: Math.round((spProgress + daysProgress) / 2),
    spToNextRank,
    daysToNextRank,
  };
}

/**
 * Check if user just unlocked a new rank
 */
export function checkForRankUp(
  previousSP: number,
  previousDays: number,
  newSP: number,
  newDays: number
): Rank | null {
  const previousRank = getCurrentRank(previousSP, previousDays);
  const newRank = getCurrentRank(newSP, newDays);
  
  if (newRank.id !== previousRank.id) {
    return newRank;
  }
  
  return null;
}

/**
 * Get encouraging progress message
 */
export function getProgressMessage(progress: RankProgress): string {
  if (!progress.nextRank) {
    return "You've reached the pinnacle. Now help others climb.";
  }
  
  if (progress.overallProgress >= 90) {
    return `Almost there! ${progress.nextRank.name} is within reach.`;
  }
  
  if (progress.overallProgress >= 75) {
    return `Strong progress toward ${progress.nextRank.name}!`;
  }
  
  if (progress.overallProgress >= 50) {
    return `Halfway to ${progress.nextRank.name}. Keep building.`;
  }
  
  if (progress.overallProgress >= 25) {
    return `Building momentum toward ${progress.nextRank.name}.`;
  }
  
  return `Every action moves you closer to ${progress.nextRank.name}.`;
}

// ==================== RANK THRESHOLDS ====================

/**
 * Rank thresholds - uses OR logic (meet SP OR streak requirement)
 * 
 * BRONZE: totalSP >= 350 OR shieldStreakDays >= 8
 * IRON: totalSP >= 900 OR shieldStreakDays >= 22
 * GOLD: totalSP >= 2000 OR shieldStreakDays >= 46
 * CHAMP: totalSP >= 4000 OR shieldStreakDays >= 91
 */
export const RANK_THRESHOLDS = {
  STONE: { sp: 0, streak: 0 },
  BRONZE: { sp: 350, streak: 8 },
  IRON: { sp: 900, streak: 22 },
  GOLD: { sp: 2000, streak: 46 },
  CHAMP: { sp: 4000, streak: 91 },
} as const;

/**
 * Evaluate rank based on SP and shield streak
 * 
 * ONLY upgrades, NEVER downgrades.
 * Uses OR logic: meet SP threshold OR streak threshold.
 */
export function evaluateRank(progress: {
  currentRank: RankId;
  totalSP: number;
  shieldStreakDays: number;
}): RankId {
  const { currentRank, totalSP, shieldStreakDays } = progress;
  
  // Get current rank index to ensure we only go up
  const rankOrder: RankId[] = ['STONE', 'BRONZE', 'IRON', 'GOLD', 'CHAMP'];
  const currentIndex = rankOrder.indexOf(currentRank);
  
  let newRankIndex = currentIndex;
  
  // Check each higher rank
  for (let i = currentIndex + 1; i < rankOrder.length; i++) {
    const rankId = rankOrder[i];
    const threshold = RANK_THRESHOLDS[rankId];
    
    // OR logic: meet SP OR streak requirement
    if (totalSP >= threshold.sp || shieldStreakDays >= threshold.streak) {
      newRankIndex = i;
    } else {
      // Can't skip ranks, stop checking
      break;
    }
  }
  
  return rankOrder[newRankIndex];
}

/**
 * Check if 120-day champ run is complete
 */
export function isChampRunComplete(shieldStreakDays: number): boolean {
  return shieldStreakDays >= 120;
}

/**
 * Get rank by shield streak only (for display purposes)
 */
export function getRankByStreak(shieldStreakDays: number): RankId {
  if (shieldStreakDays >= 91) return 'CHAMP';
  if (shieldStreakDays >= 46) return 'GOLD';
  if (shieldStreakDays >= 22) return 'IRON';
  if (shieldStreakDays >= 8) return 'BRONZE';
  return 'STONE';
}

/**
 * Get rank by SP only (for display purposes)
 */
export function getRankBySP(totalSP: number): RankId {
  if (totalSP >= 4000) return 'CHAMP';
  if (totalSP >= 2000) return 'GOLD';
  if (totalSP >= 900) return 'IRON';
  if (totalSP >= 350) return 'BRONZE';
  return 'STONE';
}
