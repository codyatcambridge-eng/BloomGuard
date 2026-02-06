/**
 * User Settings Model
 * Configurable preferences with safe defaults and clamping
 */

export interface UserSettings {
  // Friction gate timing (seconds)
  cooldownSeconds: number; // clamp 30-90, default 45
  
  // High-risk mode degradation duration (minutes)
  highRiskDegradedMinutes: number; // default 15
  
  // Auto-tighten settings after slip (hours, optional)
  autoTightenAfterSlipHours: number | null; // default 6
  
  // Feature toggles
  faithPromptsEnabled: boolean; // default false
  shareCardsEnabled: boolean; // default true
  
  // Partner/accountability settings (pro only)
  dailyRequestLimit: number; // default 3
  approvalWindowEnabled: boolean; // default false
  approvalWindowStart: string; // default "18:00"
  approvalWindowEnd: string; // default "22:00"
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  cooldownSeconds: 45,
  highRiskDegradedMinutes: 15,
  autoTightenAfterSlipHours: 6,
  faithPromptsEnabled: false,
  shareCardsEnabled: true,
  dailyRequestLimit: 3,
  approvalWindowEnabled: false,
  approvalWindowStart: "18:00",
  approvalWindowEnd: "22:00",
};

/**
 * Clamp cooldown seconds to valid range (30-90)
 */
export function clampCooldownSeconds(value: number): number {
  return Math.max(30, Math.min(90, value));
}

/**
 * Validate and normalize user settings
 */
export function normalizeUserSettings(partial: Partial<UserSettings>): UserSettings {
  return {
    ...DEFAULT_USER_SETTINGS,
    ...partial,
    cooldownSeconds: clampCooldownSeconds(partial.cooldownSeconds ?? DEFAULT_USER_SETTINGS.cooldownSeconds),
  };
}
