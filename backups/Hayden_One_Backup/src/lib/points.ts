/**
 * Strength Points (SP) Economy
 * 
 * A deterministic points system that rewards resistance and growth actions.
 * Resistance actions are highest value - they represent choosing discipline in the moment.
 */

// Point values for different actions
export const SP_VALUES = {
  // Resistance actions (highest value - choosing strength in the moment)
  IMMEDIATE_RESISTANCE: 12,      // Closed tempting content immediately
  COOLDOWN_COMPLETED: 25,        // Waited out a cooldown timer
  REPLACEMENT_ACTION: 30,        // Chose a healthy replacement activity
  
  // Growth actions (daily disciplines)
  DAILY_CHECK_IN: 5,             // Opened the app and checked status
  ACCOUNTABILITY_MESSAGE: 8,     // Sent message to accountability partner
  REFLECTION_LOGGED: 10,         // Wrote a reflection or journal entry
  GOAL_REVIEWED: 3,              // Reviewed personal goals
  
  // Milestone bonuses
  STREAK_DAY_BONUS: 2,           // Per day of active streak
  WEEKLY_CLEAN_BONUS: 50,        // 7 days shield active with no overrides
  MONTHLY_WARRIOR_BONUS: 200,    // 30 days clean
  
  // Training moments (slips aren't failures, they're training)
  QUICK_RECOVERY: 15,            // Re-activated shield within 5 minutes
  SAME_DAY_RETURN: 8,            // Re-activated shield same day
} as const;

export type SPAction = keyof typeof SP_VALUES;

export interface SPTransaction {
  id: string;
  action: SPAction;
  points: number;
  timestamp: string;
  description?: string;
}

export interface DailyProgress {
  date: string;
  pointsEarned: number;
  actions: SPAction[];
  resistanceCount: number;
  growthCount: number;
}

/**
 * Calculate points for a specific action
 */
export function getPointsForAction(action: SPAction): number {
  return SP_VALUES[action];
}

/**
 * Calculate total points from transactions
 */
export function calculateTotalPoints(transactions: SPTransaction[]): number {
  return transactions.reduce((sum, t) => sum + t.points, 0);
}

/**
 * Calculate today's points
 */
export function calculateTodayPoints(transactions: SPTransaction[]): number {
  const today = new Date().toISOString().split('T')[0];
  return transactions
    .filter(t => t.timestamp.startsWith(today))
    .reduce((sum, t) => sum + t.points, 0);
}

/**
 * Get daily average points
 */
export function calculateDailyAverage(transactions: SPTransaction[], days: number = 7): number {
  if (transactions.length === 0) return 0;
  
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  
  const recentTransactions = transactions.filter(
    t => new Date(t.timestamp) >= cutoffDate
  );
  
  const total = recentTransactions.reduce((sum, t) => sum + t.points, 0);
  return Math.round(total / days);
}

/**
 * Create a new SP transaction
 */
export function createTransaction(
  action: SPAction,
  description?: string
): SPTransaction {
  return {
    id: crypto.randomUUID(),
    action,
    points: SP_VALUES[action],
    timestamp: new Date().toISOString(),
    description,
  };
}

/**
 * Get resistance action count for today
 */
export function getTodayResistanceCount(transactions: SPTransaction[]): number {
  const today = new Date().toISOString().split('T')[0];
  const resistanceActions: SPAction[] = [
    'IMMEDIATE_RESISTANCE',
    'COOLDOWN_COMPLETED', 
    'REPLACEMENT_ACTION',
    'QUICK_RECOVERY',
  ];
  
  return transactions.filter(
    t => t.timestamp.startsWith(today) && resistanceActions.includes(t.action)
  ).length;
}

/**
 * Get growth action count for today
 */
export function getTodayGrowthCount(transactions: SPTransaction[]): number {
  const today = new Date().toISOString().split('T')[0];
  const growthActions: SPAction[] = [
    'DAILY_CHECK_IN',
    'ACCOUNTABILITY_MESSAGE',
    'REFLECTION_LOGGED',
    'GOAL_REVIEWED',
  ];
  
  return transactions.filter(
    t => t.timestamp.startsWith(today) && growthActions.includes(t.action)
  ).length;
}

/**
 * Get empowering message based on action
 */
export function getActionMessage(action: SPAction): string {
  const messages: Record<SPAction, string> = {
    IMMEDIATE_RESISTANCE: "Strong choice! You chose discipline in the moment.",
    COOLDOWN_COMPLETED: "Patience is power. You waited and won.",
    REPLACEMENT_ACTION: "Excellent redirect! You channeled that energy.",
    DAILY_CHECK_IN: "Showing up matters. You're building momentum.",
    ACCOUNTABILITY_MESSAGE: "Connection strengthens resolve.",
    REFLECTION_LOGGED: "Self-awareness is the foundation of growth.",
    GOAL_REVIEWED: "Eyes on the prize. Your vision guides you.",
    STREAK_DAY_BONUS: "Another day of victory!",
    WEEKLY_CLEAN_BONUS: "A full week of strength! You're building something real.",
    MONTHLY_WARRIOR_BONUS: "30 days! You're becoming the person you want to be.",
    QUICK_RECOVERY: "Fast recovery! That's the mark of a warrior.",
    SAME_DAY_RETURN: "You came back. That's what matters.",
  };
  
  return messages[action];
}
