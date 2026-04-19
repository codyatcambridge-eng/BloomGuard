import { registerPlugin } from '@capacitor/core';
import type { ModerationBridgePlugin } from './ModerationBridge.shared';

export * from './ModerationBridge.shared';

/**
 * Correction feedback interface for logging user corrections
 */
export interface CorrectionFeedback {
  itemId: string;
  src: string;
  originalCategory: string;
  wasCorrect: boolean;
  timestamp: number;
  platform: string;
}

/**
 * Store corrections for later analysis and model retraining
 */
const CORRECTIONS_STORAGE_KEY = 'mw_bridge_corrections';

export function logModerationCorrection(feedback: CorrectionFeedback): void {
  try {
    const existing = JSON.parse(localStorage.getItem(CORRECTIONS_STORAGE_KEY) || '[]');
    existing.push(feedback);
    // Keep last 200 corrections
    if (existing.length > 200) {
      existing.shift();
    }
    localStorage.setItem(CORRECTIONS_STORAGE_KEY, JSON.stringify(existing));
    console.log('[ModerationBridge] Logged correction:', feedback.itemId, 'correct:', feedback.wasCorrect);
  } catch (e) {
    console.error('[ModerationBridge] Failed to log correction:', e);
  }
}

export function getModerationCorrections(): CorrectionFeedback[] {
  try {
    return JSON.parse(localStorage.getItem(CORRECTIONS_STORAGE_KEY) || '[]');
  } catch (e) {
    console.error('[ModerationBridge] Failed to get corrections:', e);
    return [];
  }
}

export function clearModerationCorrections(): void {
  localStorage.removeItem(CORRECTIONS_STORAGE_KEY);
}

/**
 * Get correction statistics
 */
export function getCorrectionStats(): { total: number; correct: number; incorrect: number; accuracy: number } {
  const corrections = getModerationCorrections();
  const correct = corrections.filter(c => c.wasCorrect).length;
  const incorrect = corrections.length - correct;
  return {
    total: corrections.length,
    correct,
    incorrect,
    accuracy: corrections.length > 0 ? correct / corrections.length : 1,
  };
}

// The plugin will be implemented via message passing in the WebView
// This is a facade that works with the native message bridge
export const ModerationBridge = registerPlugin<ModerationBridgePlugin>('ModerationBridge', {
  web: () => import('./ModerationBridgeWeb').then(m => new m.ModerationBridgeWeb()),
});
