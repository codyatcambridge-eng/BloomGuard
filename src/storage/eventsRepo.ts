/**
 * Events Repository
 * Handles persistence for TriggerEvent, FocusSession, PartnerRequest
 */

import { TriggerEvent } from '@/models/TriggerEvent';
import { FocusSession } from '@/models/FocusSession';
import { PartnerRequest, isRequestExpired } from '@/models/PartnerRequest';
import { 
  getStorageItem, 
  appendToStorageArray, 
  filterStorageArray,
  updateInStorageArray,
  STORAGE_KEYS,
} from './db';

// ==================== TRIGGER EVENTS ====================

/**
 * Append a new trigger event to storage
 */
export async function appendTriggerEvent(event: TriggerEvent): Promise<void> {
  appendToStorageArray(STORAGE_KEYS.TRIGGER_EVENTS, event);
}

/**
 * Get trigger events within a time range
 */
export async function getTriggerEvents(
  fromTs: number,
  toTs: number
): Promise<TriggerEvent[]> {
  return filterStorageArray<TriggerEvent>(
    STORAGE_KEYS.TRIGGER_EVENTS,
    (event) => event.ts >= fromTs && event.ts <= toTs
  );
}

/**
 * Get all trigger events for today
 */
export async function getTodayTriggerEvents(): Promise<TriggerEvent[]> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;
  return getTriggerEvents(startOfDay, endOfDay);
}

/**
 * Count resistances in a time range
 */
export async function countResistances(fromTs: number, toTs: number): Promise<number> {
  const events = await getTriggerEvents(fromTs, toTs);
  return events.filter(e => e.outcome === 'RESISTED').length;
}

// ==================== FOCUS SESSIONS ====================

/**
 * Append a new focus session to storage
 */
export async function appendFocusSession(session: FocusSession): Promise<void> {
  appendToStorageArray(STORAGE_KEYS.FOCUS_SESSIONS, session);
}

/**
 * Get focus sessions within a time range
 */
export async function getFocusSessions(
  fromTs: number,
  toTs: number
): Promise<FocusSession[]> {
  return filterStorageArray<FocusSession>(
    STORAGE_KEYS.FOCUS_SESSIONS,
    (session) => session.tsStart >= fromTs && session.tsStart <= toTs
  );
}

/**
 * Update a focus session (e.g., mark as completed)
 */
export async function updateFocusSession(
  id: string,
  updates: Partial<FocusSession>
): Promise<void> {
  updateInStorageArray<FocusSession>(
    STORAGE_KEYS.FOCUS_SESSIONS,
    id,
    (session) => ({ ...session, ...updates })
  );
}

/**
 * Count completed sessions for today
 */
export async function countTodayCompletedSessions(): Promise<number> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000 - 1;
  const sessions = await getFocusSessions(startOfDay, endOfDay);
  return sessions.filter(s => s.completed).length;
}

// ==================== PARTNER REQUESTS ====================

/**
 * Save a partner request (create or update)
 */
export async function savePartnerRequest(request: PartnerRequest): Promise<void> {
  const existing = getStorageItem<PartnerRequest[]>(STORAGE_KEYS.PARTNER_REQUESTS) ?? [];
  const index = existing.findIndex(r => r.id === request.id);
  
  if (index >= 0) {
    existing[index] = request;
  } else {
    existing.push(request);
  }
  
  // Clean up expired requests older than 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const cleaned = existing.filter(r => r.ts > sevenDaysAgo);
  
  localStorage.setItem(STORAGE_KEYS.PARTNER_REQUESTS, JSON.stringify(cleaned));
}

/**
 * Get a specific partner request by ID
 */
export async function getPartnerRequest(id: string): Promise<PartnerRequest | null> {
  const requests = getStorageItem<PartnerRequest[]>(STORAGE_KEYS.PARTNER_REQUESTS) ?? [];
  return requests.find(r => r.id === id) ?? null;
}

/**
 * Get all pending (non-expired) partner requests
 */
export async function getPendingPartnerRequests(): Promise<PartnerRequest[]> {
  const requests = getStorageItem<PartnerRequest[]>(STORAGE_KEYS.PARTNER_REQUESTS) ?? [];
  return requests.filter(r => r.status === 'PENDING' && !isRequestExpired(r));
}

/**
 * Expire all overdue pending requests
 */
export async function expireOverdueRequests(): Promise<number> {
  const requests = getStorageItem<PartnerRequest[]>(STORAGE_KEYS.PARTNER_REQUESTS) ?? [];
  let expiredCount = 0;
  
  const updated = requests.map(r => {
    if (r.status === 'PENDING' && isRequestExpired(r)) {
      expiredCount++;
      return { ...r, status: 'EXPIRED' as const };
    }
    return r;
  });
  
  localStorage.setItem(STORAGE_KEYS.PARTNER_REQUESTS, JSON.stringify(updated));
  return expiredCount;
}
