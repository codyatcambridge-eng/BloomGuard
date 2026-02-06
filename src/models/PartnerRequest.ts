/**
 * Partner Request Model
 * Accountability partner override/approval requests
 */

export type PartnerRequestType = 
  | 'DISABLE_SHIELD'
  | 'UNBLUR_HIGH_RISK'
  | 'CHANGE_SECURITY_SETTINGS';

export type PartnerRequestStatus = 
  | 'PENDING'
  | 'APPROVED'
  | 'DENIED'
  | 'EXPIRED';

export interface PartnerRequest {
  id: string;
  ts: number; // Unix timestamp (ms) when created
  type: PartnerRequestType;
  status: PartnerRequestStatus;
  expiresAt: number; // Unix timestamp (ms)
  partnerMessagePreset: string | null;
}

// Default expiry window (24 hours)
const DEFAULT_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Create a new partner request
 */
export function createPartnerRequest(
  type: PartnerRequestType,
  options?: {
    expiresInMs?: number;
    messagePreset?: string;
  }
): PartnerRequest {
  const now = Date.now();
  const expiresInMs = options?.expiresInMs ?? DEFAULT_EXPIRY_MS;
  
  return {
    id: 'req_' + crypto.randomUUID(),
    ts: now,
    type,
    status: 'PENDING',
    expiresAt: now + expiresInMs,
    partnerMessagePreset: options?.messagePreset ?? null,
  };
}

/**
 * Check if request is expired
 */
export function isRequestExpired(request: PartnerRequest): boolean {
  return Date.now() > request.expiresAt;
}

/**
 * Check if request is still pending (not expired, not resolved)
 */
export function isRequestPending(request: PartnerRequest): boolean {
  return request.status === 'PENDING' && !isRequestExpired(request);
}

/**
 * Update request status
 */
export function updateRequestStatus(
  request: PartnerRequest,
  status: PartnerRequestStatus
): PartnerRequest {
  return {
    ...request,
    status,
  };
}

/**
 * Get human-readable type label
 */
export function getRequestTypeLabel(type: PartnerRequestType): string {
  const labels: Record<PartnerRequestType, string> = {
    DISABLE_SHIELD: 'Disable Shield',
    UNBLUR_HIGH_RISK: 'Unblur High-Risk Content',
    CHANGE_SECURITY_SETTINGS: 'Change Security Settings',
  };
  return labels[type];
}
