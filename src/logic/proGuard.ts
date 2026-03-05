/**
 * ProGuard Logic
 * 
 * Protects sensitive actions behind partner approval with:
 * - Plan tier gating (pro required)
 * - Daily request limits
 * - 5-minute request timeout
 * - Approval window enforcement
 * 
 * Protected actions cannot proceed without APPROVED request.
 */

import { UserProgress } from '@/models/UserProgress';
import { UserSettings } from '@/models/UserSettings';
import { 
  PartnerRequest, 
  PartnerRequestType, 
  PartnerRequestStatus,
  createPartnerRequest,
  isRequestExpired,
} from '@/models/PartnerRequest';
import { getTodayISO } from './dateUtils';

// ==================== TYPES ====================

export type ProtectedActionType = 
  | 'TURN_OFF_PROTECTION'
  | 'DISABLE_SAFE_BROWSER'
  | 'UNBLUR_HIGH_RISK'
  | 'CHANGE_SECURITY_SETTINGS';

export interface ProGuardCheckResult {
  allowed: boolean;
  reason: 'ALLOWED' | 'NOT_PRO' | 'DAILY_LIMIT_REACHED' | 'OUTSIDE_APPROVAL_WINDOW' | 'PENDING_REQUEST_EXISTS';
  existingRequest?: PartnerRequest;
  nextWindowTime?: string; // HH:MM when window opens
  requestsUsedToday?: number;
  requestsRemaining?: number;
}

export interface ProGuardRequestResult {
  success: boolean;
  request?: PartnerRequest;
  error?: 'NOT_PRO' | 'DAILY_LIMIT_REACHED' | 'OUTSIDE_APPROVAL_WINDOW';
}

// ==================== CONSTANTS ====================

/** Request expires after 5 minutes */
const REQUEST_EXPIRY_MS = 5 * 60 * 1000;

/** Storage key for daily request tracking */
const DAILY_REQUESTS_KEY = 'proguard_daily_requests';

interface DailyRequestsData {
  dateISO: string;
  count: number;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Map protected action to partner request type
 */
export function actionToRequestType(action: ProtectedActionType): PartnerRequestType {
  switch (action) {
    case 'TURN_OFF_PROTECTION':
      return 'DISABLE_SHIELD';
    case 'DISABLE_SAFE_BROWSER':
      return 'DISABLE_SAFE_BROWSER';
    case 'UNBLUR_HIGH_RISK':
      return 'UNBLUR_HIGH_RISK';
    case 'CHANGE_SECURITY_SETTINGS':
      return 'CHANGE_SECURITY_SETTINGS';
  }
}

/**
 * Get human-readable label for protected action (privacy-safe, no content details)
 */
export function getActionLabel(action: ProtectedActionType): string {
  switch (action) {
    case 'TURN_OFF_PROTECTION':
      return 'Pause Protection';
    case 'DISABLE_SAFE_BROWSER':
      return 'Disable Focus Browser';
    case 'UNBLUR_HIGH_RISK':
      return 'Access Override';
    case 'CHANGE_SECURITY_SETTINGS':
      return 'Modify Settings';
  }
}

/**
 * Parse time string "HH:MM" to minutes since midnight
 */
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Get current time as minutes since midnight
 */
function getCurrentTimeMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Check if current time is within approval window
 */
export function isWithinApprovalWindow(settings: UserSettings): boolean {
  if (!settings.approvalWindowEnabled) {
    return true; // No window = always allowed
  }
  
  const currentMinutes = getCurrentTimeMinutes();
  const startMinutes = parseTimeToMinutes(settings.approvalWindowStart);
  const endMinutes = parseTimeToMinutes(settings.approvalWindowEnd);
  
  // Handle overnight windows (e.g., 22:00 - 06:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
  }
  
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

/**
 * Get daily request count from local storage
 */
function getDailyRequestCount(): number {
  try {
    const stored = localStorage.getItem(DAILY_REQUESTS_KEY);
    if (!stored) return 0;
    
    const data: DailyRequestsData = JSON.parse(stored);
    const today = getTodayISO();
    
    // Reset if different day
    if (data.dateISO !== today) {
      return 0;
    }
    
    return data.count;
  } catch {
    return 0;
  }
}

/**
 * Increment daily request count
 */
function incrementDailyRequestCount(): void {
  const today = getTodayISO();
  const currentCount = getDailyRequestCount();
  
  const data: DailyRequestsData = {
    dateISO: today,
    count: currentCount + 1,
  };
  
  localStorage.setItem(DAILY_REQUESTS_KEY, JSON.stringify(data));
}

// ==================== CORE FUNCTIONS ====================

/**
 * Check if user can create a protected action request
 */
export function checkCanRequestAction(
  progress: UserProgress,
  action: ProtectedActionType,
  pendingRequests: PartnerRequest[]
): ProGuardCheckResult {
  const { planTier, settings } = progress;
  
  // Rule 1: Must be pro tier
  if (planTier !== 'pro') {
    return {
      allowed: false,
      reason: 'NOT_PRO',
    };
  }
  
  // Rule 2: Check daily limit
  const requestsUsedToday = getDailyRequestCount();
  const requestsRemaining = settings.dailyRequestLimit - requestsUsedToday;
  
  if (requestsRemaining <= 0) {
    return {
      allowed: false,
      reason: 'DAILY_LIMIT_REACHED',
      requestsUsedToday,
      requestsRemaining: 0,
    };
  }
  
  // Rule 3: Check approval window
  if (!isWithinApprovalWindow(settings)) {
    return {
      allowed: false,
      reason: 'OUTSIDE_APPROVAL_WINDOW',
      nextWindowTime: settings.approvalWindowStart,
      requestsUsedToday,
      requestsRemaining,
    };
  }
  
  // Rule 4: Check for existing pending request of same type
  const requestType = actionToRequestType(action);
  const existingPending = pendingRequests.find(
    r => r.type === requestType && r.status === 'PENDING' && !isRequestExpired(r)
  );
  
  if (existingPending) {
    return {
      allowed: false,
      reason: 'PENDING_REQUEST_EXISTS',
      existingRequest: existingPending,
      requestsUsedToday,
      requestsRemaining,
    };
  }
  
  // All checks passed
  return {
    allowed: true,
    reason: 'ALLOWED',
    requestsUsedToday,
    requestsRemaining,
  };
}

/**
 * Create a new protected action request
 * Returns request with 5-minute expiry
 */
export function createProtectedActionRequest(
  progress: UserProgress,
  action: ProtectedActionType,
  pendingRequests: PartnerRequest[]
): ProGuardRequestResult {
  // Re-check permissions
  const check = checkCanRequestAction(progress, action, pendingRequests);
  
  if (!check.allowed) {
    return {
      success: false,
      error: check.reason as 'NOT_PRO' | 'DAILY_LIMIT_REACHED' | 'OUTSIDE_APPROVAL_WINDOW',
    };
  }
  
  // Create request with 5-minute timeout
  const requestType = actionToRequestType(action);
  const request = createPartnerRequest(requestType, {
    expiresInMs: REQUEST_EXPIRY_MS,
  });
  
  // Increment daily counter
  incrementDailyRequestCount();
  
  return {
    success: true,
    request,
  };
}

/**
 * Check if a request should be auto-expired
 */
export function shouldAutoExpire(request: PartnerRequest): boolean {
  return request.status === 'PENDING' && isRequestExpired(request);
}

/**
 * Process expired requests - mark as EXPIRED (treated as DENIED)
 */
export function processExpiredRequests(requests: PartnerRequest[]): PartnerRequest[] {
  return requests.map(request => {
    if (shouldAutoExpire(request)) {
      return {
        ...request,
        status: 'EXPIRED' as PartnerRequestStatus,
      };
    }
    return request;
  });
}

/**
 * Check if a protected action is currently approved
 */
export function isActionApproved(
  action: ProtectedActionType,
  requests: PartnerRequest[]
): boolean {
  const requestType = actionToRequestType(action);
  
  // Find an approved request of this type that hasn't expired
  // Approved requests are valid for a short time after approval
  const approvedRequest = requests.find(
    r => r.type === requestType && 
         r.status === 'APPROVED' && 
         // Approval valid for 15 minutes after the request was created
         Date.now() < r.expiresAt + (15 * 60 * 1000)
  );
  
  return !!approvedRequest;
}

/**
 * Get time remaining on a pending request in seconds
 */
export function getRequestTimeRemaining(request: PartnerRequest): number {
  const remaining = request.expiresAt - Date.now();
  return Math.max(0, Math.floor(remaining / 1000));
}

/**
 * Format remaining time as MM:SS
 */
export function formatTimeRemaining(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ==================== ENCOURAGEMENT PRESETS ====================

export const ENCOURAGEMENT_PRESETS = [
  "Proud of you.",
  "Hold the line.",
  "Delay is power.",
] as const;

export type EncouragementPreset = typeof ENCOURAGEMENT_PRESETS[number];
