/**
 * Local label queue utility.
 * - Persists pending labels in localStorage under key 'mw_label_queue_v1'
 * - Attempts upload to moderation-labels edge function
 * - Simple retry with exponential backoff
 * - Stores corrections for retraining
 *
 * Note: For privacy, we only upload image bytes if the user explicitly consented (consentImage = true).
 */

export interface LabelItem {
  requestId: string;
  itemId: string;
  src: string;
  pageUrl?: string;
  platform?: string;
  modelPrediction?: { category?: string; confidence?: number };
  userLabel: 'shirtless' | 'swimwear' | 'other' | 'unsure';
  userComment?: string;
  consentImage?: boolean;
  imageBase64?: string | null; // optional, not used by default
  timestamp: number;
  attempts?: number;
  lastAttempt?: number;
}

export interface CorrectionItem {
  type: 'moderation-correction';
  timestamp: number;
  itemId: string;
  src: string;
  pageUrl: string;
  platform: string;
  originalPrediction: string;
  userLabel: string;
  wasCorrect: boolean;
}

const STORAGE_KEY = 'mw_label_queue_v1';
const CORRECTIONS_KEY = 'mw_corrections_log';

// Get the Supabase URL from environment
function getUploadUrl(): string {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (supabaseUrl) {
    return `${supabaseUrl}/functions/v1/moderation-labels`;
  }
  // Fallback for development
  return '/api/moderation/labels';
}

function readQueue(): LabelItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LabelItem[];
  } catch (e) {
    console.error('[label-queue] failed read', e);
    return [];
  }
}

function writeQueue(q: LabelItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
  } catch (e) {
    console.error('[label-queue] failed write', e);
  }
}

export async function enqueueLabel(item: LabelItem) {
  const q = readQueue();
  q.push({ ...item, attempts: 0 });
  writeQueue(q);
  // try to upload in background
  uploadPending().catch(e => console.debug('[label-queue] background upload failed', e));
}

export function getPendingCount(): number {
  return readQueue().length;
}

/**
 * Get all corrections stored locally
 */
export function getCorrections(): CorrectionItem[] {
  try {
    const raw = localStorage.getItem(CORRECTIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CorrectionItem[];
  } catch (e) {
    console.error('[label-queue] failed to read corrections', e);
    return [];
  }
}

/**
 * Add a correction to the local log
 */
export function logCorrection(correction: CorrectionItem) {
  try {
    const existing = getCorrections();
    existing.push(correction);
    // Keep last 100 corrections
    if (existing.length > 100) {
      existing.shift();
    }
    localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(existing));
    console.log('[label-queue] correction logged:', correction.itemId, correction.userLabel);
  } catch (e) {
    console.error('[label-queue] failed to log correction', e);
  }
}

/**
 * Clear old corrections (older than 7 days)
 */
export function clearOldCorrections() {
  try {
    const corrections = getCorrections();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const filtered = corrections.filter(c => c.timestamp > sevenDaysAgo);
    localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(filtered));
    console.log('[label-queue] cleared old corrections, remaining:', filtered.length);
  } catch (e) {
    console.error('[label-queue] failed to clear old corrections', e);
  }
}

/**
 * Upload pending labels (best-effort).
 * Implements a simple per-item retry with exponential backoff.
 */
export async function uploadPending() {
  const q = readQueue();
  if (q.length === 0) return;
  
  const UPLOAD_URL = getUploadUrl();
  
  // process items sequentially to avoid overloading device/network
  for (let i = 0; i < q.length; i++) {
    const item = q[i];
    // skip items that have > 5 attempts
    if ((item.attempts || 0) >= 5) continue;
    // backoff: don't attempt too frequently
    const now = Date.now();
    if (item.lastAttempt && now - item.lastAttempt < Math.pow(2, (item.attempts || 0)) * 1000) {
      continue;
    }
    try {
      item.attempts = (item.attempts || 0) + 1;
      item.lastAttempt = now;
      writeQueue(q);
      
      // send minimal payload — backend may refetch image if consentImage true
      const payload: any = {
        requestId: item.requestId,
        itemId: item.itemId,
        src: item.src,
        pageUrl: item.pageUrl,
        platform: item.platform,
        modelPrediction: item.modelPrediction,
        userLabel: item.userLabel,
        userComment: item.userComment,
        consentUpload: !!item.consentImage,
        timestamp: item.timestamp,
      };
      
      if (item.consentImage && item.imageBase64) {
        // optional: if image base64 available, send it (careful with sizes)
        payload.imageBase64 = item.imageBase64;
      }
      
      const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      
      if (!res.ok) {
        console.warn('[label-queue] upload failed status', res.status);
        continue;
      }
      
      // success — remove item
      const newQ = readQueue().filter(qi => qi.itemId !== item.itemId || qi.requestId !== item.requestId);
      writeQueue(newQ);
      console.log('[label-queue] uploaded', item.itemId);
    } catch (e) {
      console.warn('[label-queue] upload error', e);
      // continue — will retry later
    }
  }
}

/**
 * Utility: start a periodic uploader (call this in app init)
 */
export function startLabelQueueUploader(intervalMs = 15_000) {
  // Trigger initial attempt
  uploadPending().catch(e => console.debug('[label-queue] initial upload fail', e));
  
  // Clear old corrections on startup
  clearOldCorrections();
  
  setInterval(() => {
    uploadPending().catch(e => console.debug('[label-queue] periodic upload fail', e));
  }, intervalMs);
}
