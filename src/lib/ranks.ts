/**
 * Miracle Worker Rank System
 * 
 * A one-way progression ladder. Once you unlock a rank, you keep it forever.
 * Ranks are earned through consistent effort, not perfection.
 */

export interface Rank {
  id: string;
  name: string;
  title: string;
  requiredSP: number;
  requiredDays: number;
  color: string;
  glowColor: string;
  description: string;
  unlockMessage: string;
}

export const RANKS: Rank[] = [
  {
    id: 'initiate',
    name: 'Initiate',
    title: 'New Warrior',
    requiredSP: 0,
    requiredDays: 0,
    color: 'hsl(var(--silver))',
    glowColor: 'hsl(var(--silver) / 0.3)',
    description: 'Every journey begins with a single step.',
    unlockMessage: 'Welcome, warrior. Your training begins now.',
  },
  {
    id: 'bronze',
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
    id: 'iron',
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
    id: 'gold',
    name: 'Gold',
    title: 'Gold Champion',
    requiredSP: 2000,
    requiredDays: 46,
    color: 'hsl(var(--gold))',
    glowColor: 'hsl(var(--gold) / 0.4)',
    description: 'A beacon of strength. Others look to you.',
    unlockMessage: 'Gold achieved! You\'re becoming who you were meant to be.',
  },
  {
    id: 'miracle',
    name: 'Miracle Worker',
    title: 'Miracle Worker Champion',
    requiredSP: 4000,
    requiredDays: 91,
    color: 'hsl(280, 80%, 60%)',
    glowColor: 'hsl(280, 80%, 60% / 0.5)',
    description: 'Master of self. Transformer of habits. Living proof that change is possible.',
    unlockMessage: 'MIRACLE WORKER! You\'ve achieved what once seemed impossible.',
  },
];

export interface RankProgress {
  currentRank: Rank;
  nextRank: Rank | null;
  totalSP: number;
  totalDays: number;
  spProgress: number; // 0-100
  daysProgress: number; // 0-100
  overallProgress: number; // 0-100 (average of both)
  spToNextRank: number;
  daysToNextRank: number;
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
 * Get the next rank to unlock
 */
export function getNextRank(currentRank: Rank): Rank | null {
  const currentIndex = RANKS.findIndex(r => r.id === currentRank.id);
  if (currentIndex === -1 || currentIndex === RANKS.length - 1) {
    return null;
  }
  return RANKS[currentIndex + 1];
}

/**
 * Calculate progress toward next rank
 */
export function calculateRankProgress(totalSP: number, totalDays: number): RankProgress {
  const currentRank = getCurrentRank(totalSP, totalDays);
  const nextRank = getNextRank(currentRank);
  
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
  
  // Calculate SP progress
  const spRange = nextRank.requiredSP - currentRank.requiredSP;
  const spGained = totalSP - currentRank.requiredSP;
  const spProgress = Math.min(100, Math.round((spGained / spRange) * 100));
  const spToNextRank = Math.max(0, nextRank.requiredSP - totalSP);
  
  // Calculate days progress
  const daysRange = nextRank.requiredDays - currentRank.requiredDays;
  const daysGained = totalDays - currentRank.requiredDays;
  const daysProgress = Math.min(100, Math.round((daysGained / daysRange) * 100));
  const daysToNextRank = Math.max(0, nextRank.requiredDays - totalDays);
  
  // Overall progress is average of both
  const overallProgress = Math.round((spProgress + daysProgress) / 2);
  
  return {
    currentRank,
    nextRank,
    totalSP,
    totalDays,
    spProgress,
    daysProgress,
    overallProgress,
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
 * Get encouraging message based on progress
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
