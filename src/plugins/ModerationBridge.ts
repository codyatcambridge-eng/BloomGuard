import { registerPlugin } from '@capacitor/core';
import { type ModerationSeverity } from '@/lib/moderation-request-utils';

/**
 * Moderation categories for detailed content classification
 * Maps to NSFWJS classes with granular subcategories
 */
export type ModerationCategory = 
  | 'safe'
  | 'neutral'
  | 'drawing'
  | 'nudity'
  | 'partial_nudity'
  | 'shirtless_male'
  | 'swimwear'
  | 'legs'
  | 'torso'
  | 'suggestive'
  | 'sexy'
  | 'hentai'
  | 'porn'
  | 'timeout'
  | 'error';

export interface ModerationScanResult {
  src: string;
  shouldBlur: boolean;
  category: ModerationCategory;
  confidence: number;
  severity: ModerationSeverity;
  predictions: Record<string, number>;
  inferenceTime: number;
}

export interface ModerationBridgePlugin {
  /**
   * Scan a single image URL for inappropriate content
   */
  scan(options: { src: string; thresholds?: ModerationThresholds }): Promise<ModerationScanResult>;
  
  /**
   * Scan multiple images in batch
   */
  scanBatch(options: { sources: string[]; thresholds?: ModerationThresholds }): Promise<{ results: ModerationScanResult[] }>;
  
  /**
   * Get the current moderation settings
   */
  getSettings(): Promise<ModerationSettings>;
  
  /**
   * Check if the moderation model is ready
   */
  isReady(): Promise<{ ready: boolean }>;
}

export interface ModerationThresholds {
  porn: number;
  sexy: number;
  hentai: number;
}

export interface ModerationSettings {
  sensitivity: number; // 0-4 (0 = off, 4 = max)
  blurStrength: number; // px value
  enabled: boolean;
}

/**
 * Lightweight blur overlay bridge protocol between host and WebView.
 * WebView -> Host: MW_BLUR_READY
 * Host -> WebView: MW_BLUR_STATE (or MW_BLUR_COMMAND/PING)
 */
export type BlurBridgeCommand = 'ENABLE_BLUR' | 'DISABLE_BLUR' | 'PING';

export interface BlurReadyEvent {
  type: 'MW_BLUR_READY';
  url?: string;
  reason?: string;
  timestamp: number;
}

export interface BlurStateEvent {
  type: 'MW_BLUR_STATE';
  enabled: boolean;
  reason?: string;
  timestamp: number;
}

export interface BlurCommandEvent {
  type: 'MW_BLUR_COMMAND';
  command: BlurBridgeCommand;
  reason?: string;
  timestamp: number;
}

/**
 * Maps NSFWJS prediction classes to our granular moderation categories
 * Returns the most specific applicable category
 */
export function calculateCategory(predictions: Record<string, number>): ModerationCategory {
  // Normalize prediction keys to lowercase
  const norm: Record<string, number> = {};
  Object.entries(predictions).forEach(([k, v]) => {
    norm[k.toLowerCase()] = v;
  });
  
  const porn = norm['porn'] || 0;
  const hentai = norm['hentai'] || 0;
  const sexy = norm['sexy'] || 0;
  const neutral = norm['neutral'] || 0;
  const drawing = norm['drawing'] || 0;
  
  // Explicit content - highest priority
  if (porn > 0.5) return 'porn';
  if (hentai > 0.5) return 'hentai';
  
  // Suggestive content - nuanced categories
  if (sexy > 0.8) return 'sexy';
  if (sexy > 0.6) return 'suggestive';
  if (sexy > 0.4) return 'partial_nudity';
  if (sexy > 0.35) return 'swimwear';
  
  // Safe content
  if (neutral > 0.8) return 'neutral';
  if (drawing > 0.7) return 'drawing';
  
  return 'safe';
}

/**
 * Determine if content should be blurred based on category and sensitivity
 */
export function shouldBlurCategory(category: ModerationCategory, sensitivity: number): boolean {
  // Sensitivity 0 = off
  if (sensitivity === 0) return false;
  
  const categoryLevels: Record<ModerationCategory, number> = {
    'safe': 999,
    'neutral': 999,
    'drawing': 999,
    'timeout': 999,
    'error': 999,
    // These always blur at any sensitivity > 0
    'porn': 0,
    'hentai': 0,
    'nudity': 0,
    // These require higher sensitivity
    'sexy': 1,
    'suggestive': 2,
    'partial_nudity': 2,
    'shirtless_male': 3,
    'swimwear': 3,
    'legs': 4,
    'torso': 4,
  };
  
  const minSensitivity = categoryLevels[category] ?? 999;
  return sensitivity >= minSensitivity;
}

/**
 * Maps NSFWJS classes to our moderation categories (legacy helper)
 */
export function mapToCategory(className: string, probability: number): ModerationCategory {
  const name = className.toLowerCase();
  
  if (name === 'porn' && probability > 0.5) return 'porn';
  if (name === 'hentai' && probability > 0.5) return 'hentai';
  if (name === 'sexy' && probability > 0.6) return 'sexy';
  if (name === 'sexy' && probability > 0.3) return 'suggestive';
  if (name === 'neutral' || name === 'drawing') return 'safe';
  
  return 'safe';
}

/**
 * Sensitivity level thresholds (0-4 scale)
 * 0 = Off (no scanning)
 * 1 = Relaxed (only explicit content)
 * 2 = Moderate (explicit + suggestive)
 * 3 = Strict (all questionable content)
 * 4 = Maximum (aggressive filtering)
 */
export function getThresholdsForSensitivity(level: number): ModerationThresholds {
  switch (level) {
    case 0: return { porn: 1.1, sexy: 1.1, hentai: 1.1 }; // Never trigger
    case 1: return { porn: 0.7, sexy: 0.85, hentai: 0.7 }; // Relaxed
    case 2: return { porn: 0.5, sexy: 0.65, hentai: 0.5 }; // Moderate
    case 3: return { porn: 0.3, sexy: 0.45, hentai: 0.3 }; // Strict
    case 4: return { porn: 0.15, sexy: 0.25, hentai: 0.15 }; // Maximum
    default: return { porn: 0.3, sexy: 0.45, hentai: 0.3 };
  }
}

/**
 * Default blur strength values for each level
 */
export function getBlurStrengthForLevel(level: number): number {
  switch (level) {
    case 0: return 0;
    case 1: return 8;
    case 2: return 16;
    case 3: return 24;
    case 4: return 40;
    default: return 16;
  }
}

/**
 * Get human-readable label for a category
 */
export function getCategoryLabel(category: ModerationCategory): string {
  const labels: Record<ModerationCategory, string> = {
    'safe': 'Safe',
    'neutral': 'Neutral',
    'drawing': 'Drawing',
    'nudity': 'Nudity',
    'partial_nudity': 'Partial Nudity',
    'shirtless_male': 'Shirtless',
    'swimwear': 'Swimwear',
    'legs': 'Legs',
    'torso': 'Torso',
    'suggestive': 'Suggestive',
    'sexy': 'Sexy',
    'hentai': 'Hentai',
    'porn': 'Explicit',
    'timeout': 'Timeout',
    'error': 'Error',
  };
  return labels[category] || category;
}

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
