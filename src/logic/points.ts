/**
 * Points System - Single Source of Truth
 * 
 * All SP values are defined here. No ad-hoc point values elsewhere.
 */

// ==================== RESISTANCE POINTS ====================
export const RESIST_IMMEDIATE = 12;        // Closed tempting content immediately
export const WAIT_COOLDOWN_NO_UNLOCK = 25; // Waited out cooldown without unlocking
export const CHOOSE_REPLACEMENT = 30;      // Chose healthy replacement activity
export const RESIST_REPEAT_10MIN = 35;     // Resisted again within 10 minutes
export const RECOVERY_COMPLETED = 18;      // Completed recovery flow after trigger
export const PERFECT_SAVE_BONUS = 10;      // Resisted + completed recovery (combo)

// ==================== GROWTH POINTS ====================
export const QUICK_WIN_10 = 8;             // 10-minute focus session completed
export const FOCUS_25 = 15;                // 25-minute focus session completed
export const WORKOUT = 15;                 // Logged a workout
export const JOURNAL = 12;                 // Wrote journal entry
export const DEVOTIONAL = 12;              // Completed devotional/reading
export const TEXT_BUDDY = 10;              // Texted accountability partner

// ==================== CONSISTENCY POINTS ====================
export const PROTECTED_DAY_NO_UNLOCK = 20;           // Full day with shield, no unlocks
export const PROTECTED_DAY_TRIGGERED_BUT_RESISTED = 25; // Triggered but resisted all day
export const SHIELD_WEEK_BONUS = 200;                // 7 consecutive shield days
export const STRENGTH_WEEK_BONUS = 120;              // 7 consecutive strength action days

// ==================== PENALTIES ====================
export const UNLOCK_HIGH_RISK = -5;        // Unlocked high-risk content
export const PARTNER_OVERRIDE = -25;       // Partner had to approve override
export const SHIELD_OFF = -100;            // Turned shield off (resets shield streak)

// ==================== POINT CATEGORIES ====================
export const RESISTANCE_POINTS = {
  RESIST_IMMEDIATE,
  WAIT_COOLDOWN_NO_UNLOCK,
  CHOOSE_REPLACEMENT,
  RESIST_REPEAT_10MIN,
  RECOVERY_COMPLETED,
  PERFECT_SAVE_BONUS,
} as const;

export const GROWTH_POINTS = {
  QUICK_WIN_10,
  FOCUS_25,
  WORKOUT,
  JOURNAL,
  DEVOTIONAL,
  TEXT_BUDDY,
} as const;

export const CONSISTENCY_POINTS = {
  PROTECTED_DAY_NO_UNLOCK,
  PROTECTED_DAY_TRIGGERED_BUT_RESISTED,
  SHIELD_WEEK_BONUS,
  STRENGTH_WEEK_BONUS,
} as const;

export const PENALTY_POINTS = {
  UNLOCK_HIGH_RISK,
  PARTNER_OVERRIDE,
  SHIELD_OFF,
} as const;

// ==================== POINT ACTION TYPES ====================
export type ResistanceAction = keyof typeof RESISTANCE_POINTS;
export type GrowthAction = keyof typeof GROWTH_POINTS;
export type ConsistencyAction = keyof typeof CONSISTENCY_POINTS;
export type PenaltyAction = keyof typeof PENALTY_POINTS;

export type PointAction = 
  | ResistanceAction 
  | GrowthAction 
  | ConsistencyAction 
  | PenaltyAction;

// ==================== HELPERS ====================

/**
 * Get points for an action
 */
export function getPointsForAction(action: PointAction): number {
  if (action in RESISTANCE_POINTS) {
    return RESISTANCE_POINTS[action as ResistanceAction];
  }
  if (action in GROWTH_POINTS) {
    return GROWTH_POINTS[action as GrowthAction];
  }
  if (action in CONSISTENCY_POINTS) {
    return CONSISTENCY_POINTS[action as ConsistencyAction];
  }
  if (action in PENALTY_POINTS) {
    return PENALTY_POINTS[action as PenaltyAction];
  }
  return 0;
}

/**
 * Check if action is positive (earns SP)
 */
export function isPositiveAction(action: PointAction): boolean {
  return getPointsForAction(action) > 0;
}

/**
 * Check if action is a penalty (loses SP)
 */
export function isPenaltyAction(action: PointAction): boolean {
  return getPointsForAction(action) < 0;
}

/**
 * Get empowering message for action
 */
export function getActionMessage(action: PointAction): string {
  const messages: Record<PointAction, string> = {
    // Resistance
    RESIST_IMMEDIATE: "Strong choice! You chose discipline in the moment.",
    WAIT_COOLDOWN_NO_UNLOCK: "Patience is power. You waited and won.",
    CHOOSE_REPLACEMENT: "Excellent redirect! You channeled that energy.",
    RESIST_REPEAT_10MIN: "Double strength! Back-to-back resistance.",
    RECOVERY_COMPLETED: "Recovery matters. You're processing, not running.",
    PERFECT_SAVE_BONUS: "Perfect save! Resisted and recovered.",
    
    // Growth
    QUICK_WIN_10: "10-minute win! Small victories compound.",
    FOCUS_25: "Deep focus achieved. You're building something real.",
    WORKOUT: "Body and mind aligned. Physical strength feeds mental strength.",
    JOURNAL: "Self-reflection is the foundation of growth.",
    DEVOTIONAL: "Spiritual strength activated.",
    TEXT_BUDDY: "Connection strengthens resolve.",
    
    // Consistency
    PROTECTED_DAY_NO_UNLOCK: "Protected day complete. Shield held strong.",
    PROTECTED_DAY_TRIGGERED_BUT_RESISTED: "Tested and triumphant. You faced it and won.",
    SHIELD_WEEK_BONUS: "A full week of protection! You're becoming unstoppable.",
    STRENGTH_WEEK_BONUS: "7 days of growth! Consistency is your superpower.",
    
    // Penalties (still encouraging)
    UNLOCK_HIGH_RISK: "A slip, not a fall. Get back up.",
    PARTNER_OVERRIDE: "You reached out. That takes courage.",
    SHIELD_OFF: "Shield down. Your streak resets, but your strength doesn't.",
  };
  
  return messages[action] ?? "Action recorded.";
}
