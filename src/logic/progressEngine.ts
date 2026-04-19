/**
 * Progress Engine
 * 
 * Deterministic progress update functions.
 * Same inputs always produce same outputs.
 */

import { UserProgress, RankId } from '@/models/UserProgress';
import { TriggerEvent, TriggerOutcome, GateLevel, EmotionTag, createTriggerEvent } from '@/models/TriggerEvent';
import { FocusSession, createFocusSession, completeFocusSession } from '@/models/FocusSession';
import {
  RESIST_IMMEDIATE,
  UNLOCK_HIGH_RISK,
  PARTNER_OVERRIDE,
  RECOVERY_COMPLETED,
  PERFECT_SAVE_BONUS,
  QUICK_WIN_10,
  FOCUS_25,
  WORKOUT,
  JOURNAL,
  DEVOTIONAL,
  TEXT_BUDDY,
  PROTECTED_DAY_NO_UNLOCK,
  PROTECTED_DAY_TRIGGERED_BUT_RESISTED,
  SHIELD_OFF,
  SHIELD_WEEK_BONUS,
  STRENGTH_WEEK_BONUS,
} from './points';
import { evaluateRank } from './rank';
import {
  updateShieldStreak,
  updateStrengthStreak,
  resetShieldStreak,
  shouldIncrementShieldStreak,
  shouldIncrementStrengthStreak,
  checkStreakMilestones,
} from './streakEngine';
import { checkWeekRollover, incrementWeeklyProgress } from './weekEngine';
import { getTodayISO, isToday } from './dateUtils';
import { appendTriggerEvent, appendFocusSession } from '@/storage/eventsRepo';

// ==================== TYPES ====================

export type GrowthActionType = 
  | 'QUICK_WIN_10'
  | 'FOCUS_25'
  | 'WORKOUT'
  | 'JOURNAL'
  | 'DEVOTIONAL'
  | 'TEXT_BUDDY';

export interface TriggerOutcomeInput {
  gateLevel: GateLevel;
  outcome: TriggerOutcome;
  highRiskUnlockedFlag: boolean;
  ts: number;
  platform?: string;
}

export interface RecoveryInput {
  triggerEventId: string;
  emotion: EmotionTag;
  nextMove: GrowthActionType | null;
  ts: number;
}

export interface GrowthActionInput {
  type: GrowthActionType;
  ts: number;
}

export interface DayContext {
  hadProtectionOn: boolean;
  hadPartnerOverride: boolean;
  hadProtectionOff: boolean;
  hadGrowthAction: boolean;
  hadTriggers: boolean;
  hadUnlocks: boolean;
  resistedAllTriggers: boolean;
}

export interface ProgressUpdate {
  progress: UserProgress;
  pointsDelta: number;
  events: TriggerEvent[];
  rankChanged: boolean;
  newRank: RankId | null;
}

// ==================== CORE FUNCTIONS ====================

/**
 * Apply trigger outcome to progress
 * 
 * - RESISTED immediate => +12
 * - UNLOCKED after friction => 0 (no penalty for completing friction)
 * - highRiskUnlockedFlag => -5 and degraded mode
 * - PARTNER_OVERRIDE => -25
 */
export async function applyTriggerOutcome(
  progress: UserProgress,
  input: TriggerOutcomeInput
): Promise<ProgressUpdate> {
  const { gateLevel, outcome, highRiskUnlockedFlag, ts, platform } = input;
  
  let pointsDelta = 0;
  let newProgress = { ...progress };
  
  // Update trigger tracking
  newProgress.recentAttemptCount = progress.recentAttemptCount + 1;
  newProgress.lastTriggerAt = ts;
  
  // Calculate points based on outcome
  if (outcome === 'RESISTED') {
    pointsDelta = RESIST_IMMEDIATE;
  } else if (outcome === 'UNLOCKED') {
    // No reward for unlocking, but also no penalty for completing friction
    pointsDelta = 0;
    
    // Apply high-risk penalty if flag set
    if (highRiskUnlockedFlag) {
      pointsDelta = UNLOCK_HIGH_RISK;
      const degradedMinutes = progress.settings.highRiskDegradedMinutes;
      newProgress.degradedModeUntil = ts + (degradedMinutes * 60 * 1000);
    }
  } else if (outcome === 'PARTNER_OVERRIDE') {
    pointsDelta = PARTNER_OVERRIDE;
    
    // Reset shield streak on partner override
    const streakReset = resetShieldStreak(newProgress);
    newProgress.shieldStreakDays = streakReset.shieldStreakDays;
    newProgress.lastShieldDayISO = streakReset.lastShieldDayISO;
  }
  
  // Apply points
  newProgress.totalSP = Math.max(0, progress.totalSP + pointsDelta);
  newProgress.spToday = progress.spToday + pointsDelta;
  
  // Create and persist trigger event (privacy-safe)
  const event = createTriggerEvent(gateLevel, outcome, {
    platform: platform ?? null,
    recoveryCompleted: false,
  });
  await appendTriggerEvent(event);
  
  // Evaluate rank (only upgrades, never downgrades)
  const previousRank = progress.currentRank;
  newProgress.currentRank = evaluateRank(newProgress);
  const rankChanged = newProgress.currentRank !== previousRank;
  
  return {
    progress: newProgress,
    pointsDelta,
    events: [event],
    rankChanged,
    newRank: rankChanged ? newProgress.currentRank : null,
  };
}

/**
 * Apply recovery completion
 * 
 * - Always +18 for completing recovery
 * - If trigger was RESISTED => +10 perfect save bonus
 * - If nextMove is growth action => also award those points
 */
export async function applyRecoveryCompleted(
  progress: UserProgress,
  input: RecoveryInput,
  triggerEvent: TriggerEvent
): Promise<ProgressUpdate> {
  const { emotion, nextMove, ts } = input;
  
  let pointsDelta = RECOVERY_COMPLETED; // +18 always
  let newProgress = { ...progress };
  
  // Perfect save bonus if the trigger was resisted
  if (triggerEvent.outcome === 'RESISTED') {
    pointsDelta += PERFECT_SAVE_BONUS; // +10
  }
  
  // Mark trigger event as recovery completed
  const updatedEvent: TriggerEvent = {
    ...triggerEvent,
    recoveryCompleted: true,
    emotion,
  };
  
  // If user chose a growth action as next move, award those points too
  if (nextMove) {
    const growthPoints = getGrowthActionPoints(nextMove);
    pointsDelta += growthPoints;
    
    // Update weekly progress for the growth action
    newProgress.weeklyProgress = incrementWeeklyProgress(newProgress, nextMove);
    
    // Update strength streak if first growth action of day
    const today = getTodayISO();
    if (newProgress.lastStrengthDayISO !== today) {
      const streakUpdate = updateStrengthStreak(newProgress, today, true);
      newProgress.strengthStreakDays = streakUpdate.strengthStreakDays;
      newProgress.lastStrengthDayISO = streakUpdate.lastStrengthDayISO;
    }
  }
  
  // Apply points
  newProgress.totalSP = progress.totalSP + pointsDelta;
  newProgress.spToday = progress.spToday + pointsDelta;
  
  // Evaluate rank
  const previousRank = progress.currentRank;
  newProgress.currentRank = evaluateRank(newProgress);
  const rankChanged = newProgress.currentRank !== previousRank;
  
  return {
    progress: newProgress,
    pointsDelta,
    events: [updatedEvent],
    rankChanged,
    newRank: rankChanged ? newProgress.currentRank : null,
  };
}

/**
 * Apply growth action
 * 
 * Awards points for: quick win, focus, workout, journal, devotional, text buddy
 * Updates strength streak if first growth action of day
 */
export async function applyGrowthAction(
  progress: UserProgress,
  input: GrowthActionInput
): Promise<ProgressUpdate> {
  const { type, ts } = input;
  
  const pointsDelta = getGrowthActionPoints(type);
  let newProgress = { ...progress };
  
  // Check for week rollover
  const weekRollover = checkWeekRollover(progress);
  if (weekRollover.isNewWeek) {
    newProgress.weeklyProgress = weekRollover.weeklyProgress;
    newProgress.weeklyChallengeId = weekRollover.weeklyChallengeId;
    newProgress.weeklyChallengeWeekISO = weekRollover.weeklyChallengeWeekISO;
  }
  
  // Update weekly progress
  newProgress.weeklyProgress = incrementWeeklyProgress(newProgress, type);
  
  // Apply points
  newProgress.totalSP = progress.totalSP + pointsDelta;
  newProgress.spToday = progress.spToday + pointsDelta;
  
  // Update strength streak if first growth action of day
  const today = getTodayISO();
  if (progress.lastStrengthDayISO !== today) {
    const streakUpdate = updateStrengthStreak(newProgress, today, true);
    newProgress.strengthStreakDays = streakUpdate.strengthStreakDays;
    newProgress.lastStrengthDayISO = streakUpdate.lastStrengthDayISO;
    
    // Check for strength week bonus
    const milestones = checkStreakMilestones(
      progress.strengthStreakDays,
      newProgress.strengthStreakDays
    );
    if (newProgress.strengthStreakDays > 0 && newProgress.strengthStreakDays % 7 === 0) {
      newProgress.totalSP += STRENGTH_WEEK_BONUS;
      newProgress.spToday += STRENGTH_WEEK_BONUS;
    }
  }
  
  // Persist focus session if applicable
  if (type === 'QUICK_WIN_10' || type === 'FOCUS_25') {
    const duration = type === 'QUICK_WIN_10' ? 10 : 25;
    const session = completeFocusSession(createFocusSession(duration));
    await appendFocusSession(session);
  }
  
  // Evaluate rank
  const previousRank = progress.currentRank;
  newProgress.currentRank = evaluateRank(newProgress);
  const rankChanged = newProgress.currentRank !== previousRank;
  
  return {
    progress: newProgress,
    pointsDelta,
    events: [],
    rankChanged,
    newRank: rankChanged ? newProgress.currentRank : null,
  };
}

/**
 * End of day rollup
 * 
 * - Protected day with no unlocks => +20
 * - Triggered but resisted all => +25
 * - Updates streaks
 * - Resets spToday
 */
export function endOfDayRollup(
  progress: UserProgress,
  dayISO: string,
  context: DayContext
): ProgressUpdate {
  let pointsDelta = 0;
  let newProgress = { ...progress };
  
  const {
    hadProtectionOn,
    hadPartnerOverride,
    hadProtectionOff,
    hadGrowthAction,
    hadTriggers,
    hadUnlocks,
    resistedAllTriggers,
  } = context;
  
  // === DAY BONUSES ===
  
  // Protected day with no unlocks => +20
  if (hadProtectionOn && !hadUnlocks && !hadPartnerOverride) {
    pointsDelta += PROTECTED_DAY_NO_UNLOCK;
  }
  
  // Triggered but resisted all => +25 (replaces the +20)
  if (hadTriggers && resistedAllTriggers && !hadUnlocks && !hadPartnerOverride) {
    // This is the higher bonus, so subtract the basic one if it was added
    if (hadProtectionOn) {
      pointsDelta -= PROTECTED_DAY_NO_UNLOCK; // Remove the +20
    }
    pointsDelta += PROTECTED_DAY_TRIGGERED_BUT_RESISTED; // Add +25
  }
  
  // === STREAK UPDATES ===
  
  // Shield streak
  const shouldIncrementShield = shouldIncrementShieldStreak(
    progress,
    dayISO,
    hadProtectionOn,
    hadPartnerOverride,
    hadProtectionOff
  );
  
  // Reset shield streak on protection OFF
  if (hadProtectionOff) {
    pointsDelta += SHIELD_OFF; // -100
    const resetResult = resetShieldStreak(newProgress);
    newProgress.shieldStreakDays = resetResult.shieldStreakDays;
    newProgress.lastShieldDayISO = resetResult.lastShieldDayISO;
  } else if (shouldIncrementShield) {
    const previousShieldStreak = newProgress.shieldStreakDays;
    const shieldUpdate = updateShieldStreak(newProgress, dayISO, true, false);
    newProgress.shieldStreakDays = shieldUpdate.shieldStreakDays;
    newProgress.lastShieldDayISO = shieldUpdate.lastShieldDayISO;
    
    // Check for shield week bonus (every 7 days)
    if (newProgress.shieldStreakDays > 0 && newProgress.shieldStreakDays % 7 === 0) {
      pointsDelta += SHIELD_WEEK_BONUS; // +200
    }
  }
  
  // Strength streak
  const shouldIncrementStrength = shouldIncrementStrengthStreak(
    progress,
    dayISO,
    hadGrowthAction
  );
  
  if (shouldIncrementStrength) {
    const previousStrengthStreak = newProgress.strengthStreakDays;
    const strengthUpdate = updateStrengthStreak(newProgress, dayISO, true);
    newProgress.strengthStreakDays = strengthUpdate.strengthStreakDays;
    newProgress.lastStrengthDayISO = strengthUpdate.lastStrengthDayISO;
    
    // Check for strength week bonus (every 7 days)
    if (newProgress.strengthStreakDays > 0 && newProgress.strengthStreakDays % 7 === 0) {
      pointsDelta += STRENGTH_WEEK_BONUS; // +120
    }
  }
  
  // === APPLY POINTS ===
  newProgress.totalSP = Math.max(0, progress.totalSP + pointsDelta);
  
  // Reset daily SP counter
  newProgress.spToday = 0;
  
  // Evaluate rank
  const previousRank = progress.currentRank;
  newProgress.currentRank = evaluateRank(newProgress);
  const rankChanged = newProgress.currentRank !== previousRank;
  
  return {
    progress: newProgress,
    pointsDelta,
    events: [],
    rankChanged,
    newRank: rankChanged ? newProgress.currentRank : null,
  };
}

/**
 * Apply shield off (manually turning off protection)
 */
export function applyShieldOff(progress: UserProgress): ProgressUpdate {
  let newProgress = { ...progress };
  
  // -100 points
  const pointsDelta = SHIELD_OFF;
  newProgress.totalSP = Math.max(0, progress.totalSP + pointsDelta);
  newProgress.spToday = progress.spToday + pointsDelta;
  
  // Reset shield streak
  const resetResult = resetShieldStreak(newProgress);
  newProgress.shieldStreakDays = resetResult.shieldStreakDays;
  newProgress.lastShieldDayISO = resetResult.lastShieldDayISO;
  
  // Evaluate rank (won't downgrade)
  const previousRank = progress.currentRank;
  newProgress.currentRank = evaluateRank(newProgress);
  const rankChanged = newProgress.currentRank !== previousRank;
  
  return {
    progress: newProgress,
    pointsDelta,
    events: [],
    rankChanged,
    newRank: rankChanged ? newProgress.currentRank : null,
  };
}

// ==================== HELPERS ====================

/**
 * Get points for a growth action type
 */
function getGrowthActionPoints(type: GrowthActionType): number {
  const pointsMap: Record<GrowthActionType, number> = {
    QUICK_WIN_10: QUICK_WIN_10,
    FOCUS_25: FOCUS_25,
    WORKOUT: WORKOUT,
    JOURNAL: JOURNAL,
    DEVOTIONAL: DEVOTIONAL,
    TEXT_BUDDY: TEXT_BUDDY,
  };
  return pointsMap[type];
}
