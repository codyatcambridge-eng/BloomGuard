import { registerPlugin } from '@capacitor/core';

/**
 * Moderation categories for detailed content classification
 */
export type ModerationCategory = 
  | 'safe'
  | 'nudity'
  | 'partial_nudity'
  | 'shirtless_male'
  | 'swimwear'
  | 'suggestive'
  | 'sexy'
  | 'hentai'
  | 'porn';

export interface ModerationScanResult {
  src: string;
  shouldBlur: boolean;
  category: ModerationCategory;
  confidence: number;
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
 * Maps NSFWJS classes to our moderation categories
 */
export function mapToCategory(className: string, probability: number): ModerationCategory {
  const name = className.toLowerCase();
  
  if (name === 'porn' && probability > 0.5) return 'porn';
  if (name === 'hentai' && probability > 0.5) return 'hentai';
  if (name === 'sexy' && probability > 0.6) return 'sexy';
  if (name === 'sexy' && probability > 0.3) return 'suggestive';
  
  // More granular categories based on combined signals
  if (name === 'neutral' || name === 'drawing') return 'safe';
  
  return 'safe';
}

/**
 * Calculate detailed category from predictions
 */
export function calculateCategory(predictions: Record<string, number>): ModerationCategory {
  const porn = predictions['Porn'] || predictions['porn'] || 0;
  const hentai = predictions['Hentai'] || predictions['hentai'] || 0;
  const sexy = predictions['Sexy'] || predictions['sexy'] || 0;
  const neutral = predictions['Neutral'] || predictions['neutral'] || 0;
  
  if (porn > 0.5) return 'porn';
  if (hentai > 0.5) return 'hentai';
  if (sexy > 0.7) return 'sexy';
  if (sexy > 0.5) return 'suggestive';
  if (sexy > 0.3) return 'partial_nudity';
  
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

// The plugin will be implemented via message passing in the WebView
// This is a facade that works with the native message bridge
export const ModerationBridge = registerPlugin<ModerationBridgePlugin>('ModerationBridge', {
  web: () => import('./ModerationBridgeWeb').then(m => new m.ModerationBridgeWeb()),
});
