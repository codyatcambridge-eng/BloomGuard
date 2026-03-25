/**
 * Utility Pass Logic
 * 
 * Manages time-limited break passes that loosen frontend restrictions
 * while maintaining high-risk safety controls.
 * 
 * DOES NOT modify blur/moderation backend logic.
 */

import { UserProgress } from '@/models/UserProgress';
import { GateLevel, TriggerOutcome } from '@/models/TriggerEvent';
import { checkCanRequestAction, type ProtectedActionType } from './proGuard';

// ==================== TYPES ====================

export type UtilityPassReason = 
  | 'SCHOOL'
  | 'WORK'
  | 'BILLS_BANK'
  | 'MEDICAL'
  | 'FAMILY';

export type UtilityPassDuration = 5 | 10 | 15;

export interface UtilityPassState {
  isActive: boolean;
  reason: UtilityPassReason | null;
  startedAt: number | null;
  expiresAt: number | null;
  durationMinutes: UtilityPassDuration | null;
}

export interface UtilityPassRequest {
  reason: UtilityPassReason;
  durationMinutes: UtilityPassDuration;
  gateLevel: GateLevel;
  ts: number;
}

export interface UtilityPassResult {
  success: boolean;
  passState: UtilityPassState;
  requiresPartnerApproval: boolean;
  error?: 'NOT_PRO_EXTENDED' | 'OUTSIDE_APPROVAL_WINDOW' | 'DAILY_LIMIT_REACHED';
}

// ==================== CONSTANTS ====================

export const UTILITY_PASS_REASONS: Array<{
  id: UtilityPassReason;
  label: string;
  icon: string;
}> = [
  { id: 'SCHOOL', label: 'School', icon: '📚' },
  { id: 'WORK', label: 'Work', icon: '💼' },
  { id: 'BILLS_BANK', label: 'Bills/Bank', icon: '💳' },
  { id: 'MEDICAL', label: 'Medical', icon: '🏥' },
  { id: 'FAMILY', label: 'Family', icon: '👨‍👩‍👧' },
];

export const UTILITY_PASS_DURATIONS: Array<{
  minutes: UtilityPassDuration;
  label: string;
  requiresPro: boolean;
}> = [
  { minutes: 5, label: '5 min', requiresPro: false },
  { minutes: 10, label: '10 min', requiresPro: false },
  { minutes: 15, label: '15 min', requiresPro: false },
];

// Extended durations for Pro tier (require partner approval)
export const PRO_EXTENDED_DURATIONS: Array<{
  minutes: number;
  label: string;
}> = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
];

export const DEFAULT_PASS_STATE: UtilityPassState = {
  isActive: false,
  reason: null,
  startedAt: null,
  expiresAt: null,
  durationMinutes: null,
};

// ==================== CORE FUNCTIONS ====================

/**
 * Check if user can start a utility pass
 * Pro tier can request extended durations but requires partner approval
 */
export function canStartUtilityPass(
  progress: UserProgress,
  durationMinutes: number
): { allowed: boolean; requiresPartnerApproval: boolean; reason?: string } {
  // Basic tier: max 15 min, no partner approval needed
  if (progress.planTier === 'basic') {
    if (durationMinutes > 15) {
      return { 
        allowed: false, 
        requiresPartnerApproval: false,
        reason: 'Basic tier is limited to 15 minute passes'
      };
    }
    return { allowed: true, requiresPartnerApproval: false };
  }
  
  // Pro tier: extended durations require partner approval
  if (durationMinutes > 15) {
    const canRequest = checkCanRequestAction(
      progress,
      'UNBLUR_HIGH_RISK' as ProtectedActionType,
      [] // No pending requests
    );
    
    if (!canRequest.allowed) {
      return { 
        allowed: false, 
        requiresPartnerApproval: true,
        reason: canRequest.reason 
      };
    }
    
    return { allowed: true, requiresPartnerApproval: true };
  }
  
  return { allowed: true, requiresPartnerApproval: false };
}

/**
 * Create a new utility pass state
 */
export function createUtilityPass(
  reason: UtilityPassReason,
  durationMinutes: UtilityPassDuration,
  ts: number
): UtilityPassState {
  const durationMs = durationMinutes * 60 * 1000;
  
  return {
    isActive: true,
    reason,
    startedAt: ts,
    expiresAt: ts + durationMs,
    durationMinutes,
  };
}

/**
 * Check if utility pass is still active
 */
export function isPassActive(passState: UtilityPassState, nowTs: number): boolean {
  if (!passState.isActive || !passState.expiresAt) {
    return false;
  }
  return nowTs < passState.expiresAt;
}

/**
 * Get remaining time in seconds
 */
export function getRemainingSeconds(passState: UtilityPassState, nowTs: number): number {
  if (!passState.expiresAt) return 0;
  return Math.max(0, Math.floor((passState.expiresAt - nowTs) / 1000));
}

/**
 * End utility pass early
 */
export function endPassEarly(): UtilityPassState {
  return DEFAULT_PASS_STATE;
}

/**
 * Check if pass has expired and return updated state
 */
export function checkPassExpiry(passState: UtilityPassState, nowTs: number): UtilityPassState {
  if (!passState.isActive) return passState;
  
  if (!isPassActive(passState, nowTs)) {
    return DEFAULT_PASS_STATE;
  }
  
  return passState;
}

/**
 * Get the minimum gate level for utility pass (always Level 2+)
 */
export function getUtilityPassGateLevel(): GateLevel {
  return 2;
}

/**
 * Get reason label for logging (privacy-safe)
 */
export function getReasonLabel(reason: UtilityPassReason): string {
  const found = UTILITY_PASS_REASONS.find(r => r.id === reason);
  return found?.label ?? 'Unknown';
}

/**
 * Format pass duration for display
 */
export function formatPassDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return `${hours}h ${remaining}m`;
}

/**
 * Format remaining time for countdown display
 */
export function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return '0:00';
  
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ==================== POINTS CONSTANTS ====================

// No points for starting utility pass
// WAIT_COOLDOWN_NO_UNLOCK (+25) is awarded in progressEngine when user waits but doesn't unlock

export const UTILITY_PASS_PLATFORM = 'UTILITY_PASS';
