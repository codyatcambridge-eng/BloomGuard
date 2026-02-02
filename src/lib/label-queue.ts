/**
 * Label Queue Manager
 * 
 * Handles local storage of labels before upload to backend.
 * Supports offline queueing with batch uploads when online.
 */

import { supabase } from '@/integrations/supabase/client';

export type UserLabel = 'shirtless' | 'swimwear' | 'other' | 'unsure';

export interface LabelEntry {
  id: string;
  requestId: string;
  itemId: string;
  src: string;
  pageUrl: string;
  platform: string;
  modelPrediction: string;
  modelConfidence: number;
  userLabel: UserLabel;
  userComment?: string;
  consentImage: boolean;
  imageBase64?: string;
  deviceMeta: {
    userAgent: string;
    screenWidth: number;
    screenHeight: number;
    timestamp: number;
    timezone: string;
  };
  createdAt: number;
  uploaded: boolean;
  uploadedAt?: number;
  uploadError?: string;
}

const LABEL_QUEUE_KEY = 'mw_label_queue';
const UPLOAD_BATCH_SIZE = 10;
const UPLOAD_RETRY_DELAY = 30000; // 30 seconds

/**
 * Generate a unique label ID
 */
export function generateLabelId(): string {
  return 'lbl_' + crypto.randomUUID().slice(0, 8) + '_' + Date.now().toString(36);
}

/**
 * Get device metadata
 */
export function getDeviceMeta() {
  return {
    userAgent: navigator.userAgent,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    timestamp: Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/**
 * Load queue from localStorage
 */
export function loadLabelQueue(): LabelEntry[] {
  try {
    const stored = localStorage.getItem(LABEL_QUEUE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('[LabelQueue] Failed to load queue:', e);
  }
  return [];
}

/**
 * Save queue to localStorage
 */
export function saveLabelQueue(queue: LabelEntry[]): void {
  try {
    localStorage.setItem(LABEL_QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    console.error('[LabelQueue] Failed to save queue:', e);
  }
}

/**
 * Add a label to the queue
 */
export function addLabelToQueue(entry: Omit<LabelEntry, 'id' | 'createdAt' | 'uploaded' | 'deviceMeta'>): LabelEntry {
  const fullEntry: LabelEntry = {
    ...entry,
    id: generateLabelId(),
    deviceMeta: getDeviceMeta(),
    createdAt: Date.now(),
    uploaded: false,
  };

  const queue = loadLabelQueue();
  queue.push(fullEntry);
  saveLabelQueue(queue);

  console.log('[LabelQueue] Added label:', fullEntry.id, fullEntry.userLabel, fullEntry.src.substring(0, 50));

  // Trigger upload attempt
  scheduleUpload();

  return fullEntry;
}

/**
 * Get pending (not uploaded) labels
 */
export function getPendingLabels(): LabelEntry[] {
  return loadLabelQueue().filter(e => !e.uploaded);
}

/**
 * Get label statistics
 */
export function getLabelStats(): { total: number; pending: number; uploaded: number; byLabel: Record<UserLabel, number> } {
  const queue = loadLabelQueue();
  const byLabel: Record<UserLabel, number> = { shirtless: 0, swimwear: 0, other: 0, unsure: 0 };
  
  queue.forEach(e => {
    byLabel[e.userLabel]++;
  });

  return {
    total: queue.length,
    pending: queue.filter(e => !e.uploaded).length,
    uploaded: queue.filter(e => e.uploaded).length,
    byLabel,
  };
}

/**
 * Mark labels as uploaded
 */
export function markLabelsUploaded(ids: string[]): void {
  const queue = loadLabelQueue();
  const now = Date.now();
  
  queue.forEach(entry => {
    if (ids.includes(entry.id)) {
      entry.uploaded = true;
      entry.uploadedAt = now;
    }
  });
  
  saveLabelQueue(queue);
}

/**
 * Mark label upload error
 */
export function markLabelError(id: string, error: string): void {
  const queue = loadLabelQueue();
  
  queue.forEach(entry => {
    if (entry.id === id) {
      entry.uploadError = error;
    }
  });
  
  saveLabelQueue(queue);
}

/**
 * Clear old uploaded labels (cleanup)
 */
export function cleanupOldLabels(maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
  const queue = loadLabelQueue();
  const cutoff = Date.now() - maxAgeMs;
  
  const filtered = queue.filter(e => {
    // Keep if not uploaded or if uploaded recently
    if (!e.uploaded) return true;
    return (e.uploadedAt || e.createdAt) > cutoff;
  });
  
  if (filtered.length !== queue.length) {
    console.log('[LabelQueue] Cleaned up', queue.length - filtered.length, 'old labels');
    saveLabelQueue(filtered);
  }
}

/**
 * Upload pending labels to backend
 */
export async function uploadPendingLabels(): Promise<{ success: number; failed: number }> {
  const pending = getPendingLabels();
  
  if (pending.length === 0) {
    return { success: 0, failed: 0 };
  }

  console.log('[LabelQueue] Uploading', pending.length, 'pending labels');
  
  let success = 0;
  let failed = 0;
  const successIds: string[] = [];

  // Process in batches
  for (let i = 0; i < pending.length; i += UPLOAD_BATCH_SIZE) {
    const batch = pending.slice(i, i + UPLOAD_BATCH_SIZE);
    
    try {
      const { error } = await supabase.functions.invoke('moderation-labels', {
        body: {
          action: 'submit',
          labels: batch.map(entry => ({
            requestId: entry.requestId,
            itemId: entry.itemId,
            src: entry.src,
            pageUrl: entry.pageUrl,
            platform: entry.platform,
            modelPrediction: entry.modelPrediction,
            modelConfidence: entry.modelConfidence,
            userLabel: entry.userLabel,
            userComment: entry.userComment,
            consentImage: entry.consentImage,
            imageBase64: entry.consentImage ? entry.imageBase64 : undefined,
            deviceMeta: entry.deviceMeta,
          })),
        },
      });

      if (error) {
        console.error('[LabelQueue] Upload batch error:', error);
        failed += batch.length;
        batch.forEach(e => markLabelError(e.id, error.message));
      } else {
        success += batch.length;
        batch.forEach(e => successIds.push(e.id));
      }
    } catch (e) {
      console.error('[LabelQueue] Upload exception:', e);
      failed += batch.length;
      batch.forEach(entry => markLabelError(entry.id, e instanceof Error ? e.message : 'Unknown error'));
    }
  }

  // Mark successful uploads
  if (successIds.length > 0) {
    markLabelsUploaded(successIds);
  }

  console.log('[LabelQueue] Upload complete:', success, 'success,', failed, 'failed');
  
  return { success, failed };
}

// Debounced upload scheduler
let uploadTimeout: ReturnType<typeof setTimeout> | null = null;

export function scheduleUpload(delayMs = 5000): void {
  if (uploadTimeout) {
    clearTimeout(uploadTimeout);
  }
  
  uploadTimeout = setTimeout(async () => {
    uploadTimeout = null;
    
    if (!navigator.onLine) {
      console.log('[LabelQueue] Offline, skipping upload');
      return;
    }
    
    const result = await uploadPendingLabels();
    
    // Schedule retry if there were failures
    if (result.failed > 0) {
      scheduleUpload(UPLOAD_RETRY_DELAY);
    }
  }, delayMs);
}

// Upload when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[LabelQueue] Back online, scheduling upload');
    scheduleUpload(1000);
  });
}
