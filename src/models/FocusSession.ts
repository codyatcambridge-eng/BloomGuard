/**
 * Focus Session Model
 * Tracks 10-minute wins and 25-minute focus blocks
 */

export type FocusDuration = 10 | 25;

export interface FocusSession {
  id: string;
  tsStart: number; // Unix timestamp (ms)
  durationMinutes: FocusDuration;
  completed: boolean;
}

/**
 * Create a new focus session
 */
export function createFocusSession(
  durationMinutes: FocusDuration
): FocusSession {
  return {
    id: 'focus_' + crypto.randomUUID(),
    tsStart: Date.now(),
    durationMinutes,
    completed: false,
  };
}

/**
 * Mark session as completed
 */
export function completeFocusSession(session: FocusSession): FocusSession {
  return {
    ...session,
    completed: true,
  };
}

/**
 * Check if session is a quick win (10 minutes)
 */
export function isQuickWin(session: FocusSession): boolean {
  return session.durationMinutes === 10 && session.completed;
}

/**
 * Check if session is a focus 25 (25 minutes)
 */
export function isFocus25(session: FocusSession): boolean {
  return session.durationMinutes === 25 && session.completed;
}
