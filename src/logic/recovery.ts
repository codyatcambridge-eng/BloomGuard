/**
 * Recovery Logic
 * 
 * Handles recovery flow after trigger attempts.
 * Privacy-safe - no content stored beyond TriggerEvent fields.
 */

import { UserProgress } from '@/models/UserProgress';
import { TriggerEvent, EmotionTag, TriggerOutcome } from '@/models/TriggerEvent';
import { 
  RECOVERY_COMPLETED, 
  PERFECT_SAVE_BONUS,
  QUICK_WIN_10,
  FOCUS_25,
  WORKOUT,
  JOURNAL,
  DEVOTIONAL,
  TEXT_BUDDY,
} from './points';
import type { GrowthActionType } from './progressEngine';

export type RecoveryNextMove = GrowthActionType | 'NONE';

export interface RecoveryFlowInput {
  triggerEventId: string;
  triggerOutcome: TriggerOutcome;
  emotion: EmotionTag;
  nextMove: RecoveryNextMove;
  ts: number;
}

export interface RecoveryResult {
  progress: UserProgress;
  pointsDelta: number;
  perfectSaveAwarded: boolean;
  growthPointsAwarded: number;
  autoTightenUntil: number | null;
}

/**
 * Calculate recovery points
 */
export function calculateRecoveryPoints(
  triggerOutcome: TriggerOutcome,
  nextMove: RecoveryNextMove
): {
  basePoints: number;
  perfectSaveBonus: number;
  growthPoints: number;
  total: number;
} {
  let basePoints = RECOVERY_COMPLETED; // +18 always
  let perfectSaveBonus = 0;
  let growthPoints = 0;

  // Perfect save bonus if resisted
  if (triggerOutcome === 'RESISTED') {
    perfectSaveBonus = PERFECT_SAVE_BONUS; // +10
  }

  // Growth action points
  if (nextMove !== 'NONE') {
    growthPoints = getGrowthActionPoints(nextMove);
  }

  return {
    basePoints,
    perfectSaveBonus,
    growthPoints,
    total: basePoints + perfectSaveBonus + growthPoints,
  };
}

/**
 * Get points for a growth action
 */
function getGrowthActionPoints(action: GrowthActionType): number {
  const pointsMap: Record<GrowthActionType, number> = {
    QUICK_WIN_10: QUICK_WIN_10,
    FOCUS_25: FOCUS_25,
    WORKOUT: WORKOUT,
    JOURNAL: JOURNAL,
    DEVOTIONAL: DEVOTIONAL,
    TEXT_BUDDY: TEXT_BUDDY,
  };
  return pointsMap[action] ?? 0;
}

/**
 * Apply recovery to progress
 */
export function applyRecovery(
  progress: UserProgress,
  input: RecoveryFlowInput
): RecoveryResult {
  const { triggerOutcome, nextMove, ts } = input;
  
  const points = calculateRecoveryPoints(triggerOutcome, nextMove);
  
  const newProgress: UserProgress = {
    ...progress,
    totalSP: progress.totalSP + points.total,
    spToday: progress.spToday + points.total,
  };

  // If slip (unlocked or partner override), optionally set auto-tighten
  // This is a FRONTEND state flag only
  let autoTightenUntil: number | null = null;
  if (
    (triggerOutcome === 'UNLOCKED' || triggerOutcome === 'PARTNER_OVERRIDE') &&
    progress.settings.autoTightenAfterSlipHours
  ) {
    autoTightenUntil = ts + (progress.settings.autoTightenAfterSlipHours * 60 * 60 * 1000);
  }

  return {
    progress: newProgress,
    pointsDelta: points.total,
    perfectSaveAwarded: points.perfectSaveBonus > 0,
    growthPointsAwarded: points.growthPoints,
    autoTightenUntil,
  };
}

/**
 * Check if this was a slip (unlocked or override)
 */
export function isSlip(outcome: TriggerOutcome): boolean {
  return outcome === 'UNLOCKED' || outcome === 'PARTNER_OVERRIDE';
}

/**
 * Get recovery copy based on outcome
 */
export function getRecoveryCopy(outcome: TriggerOutcome): {
  title: string;
  subtitle: string;
  completionMessage: string;
} {
  if (isSlip(outcome)) {
    return {
      title: 'Reset. Rebuild. Return.',
      subtitle: 'No shame. Next move.',
      completionMessage: 'You trained discipline.',
    };
  }
  
  return {
    title: 'Reset. Rebuild. Return.',
    subtitle: 'Strengthen your victory.',
    completionMessage: 'You trained discipline.',
  };
}

/**
 * Emotion options for picker
 */
export const EMOTION_OPTIONS: { id: EmotionTag; label: string; emoji: string }[] = [
  { id: 'BORED', label: 'Bored', emoji: '😑' },
  { id: 'LONELY', label: 'Lonely', emoji: '😔' },
  { id: 'STRESSED', label: 'Stressed', emoji: '😰' },
  { id: 'ANGRY', label: 'Angry', emoji: '😤' },
  { id: 'TEMPTED', label: 'Tempted', emoji: '🔥' },
];

/**
 * Next move options for picker
 */
export const NEXT_MOVE_OPTIONS: { 
  id: RecoveryNextMove; 
  label: string; 
  icon: string;
  points: number;
}[] = [
  { id: 'QUICK_WIN_10', label: 'Focus sprint', icon: 'Target', points: QUICK_WIN_10 },
  { id: 'WORKOUT', label: 'Workout', icon: 'Dumbbell', points: WORKOUT },
  { id: 'JOURNAL', label: 'Journal', icon: 'BookOpen', points: JOURNAL },
  { id: 'DEVOTIONAL', label: 'Devotional', icon: 'Heart', points: DEVOTIONAL },
  { id: 'TEXT_BUDDY', label: 'Call/text safe person', icon: 'MessageCircle', points: TEXT_BUDDY },
];
