/**
 * Utility functions for moderation request handling
 * 
 * This module provides the core protocol utilities for the WebView moderation system:
 * - Request/Result message types with nonce security
 * - ID generation (requestId, itemId, nonce)
 * - Message validation
 * - Safe string escaping for executeScript
 * - Multi-parameter moderation logic
 */

/**
 * Generate a unique request ID for moderation batches
 * Format: r_<random>_<timestamp>
 */
export function generateRequestId(): string {
  return 'r_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36);
}

/**
 * Generate a unique item ID for individual scan items
 * Format: i_<random>
 */
export function generateItemId(): string {
  return 'i_' + Math.random().toString(36).slice(2, 9);
}

/**
 * Generate a cryptographically-sufficient nonce for message validation
 * This prevents message spoofing by ensuring only the legitimate host can respond
 * Format: n_<random>_<random>
 */
export function generateNonce(): string {
  const crypto = typeof window !== 'undefined' ? window.crypto : null;
  if (crypto && crypto.getRandomValues) {
    const arr = new Uint32Array(2);
    crypto.getRandomValues(arr);
    return 'n_' + arr[0].toString(36) + '_' + arr[1].toString(36);
  }
  // Fallback for non-browser environments
  return 'n_' + Math.random().toString(36).slice(2, 10) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * Escape a string for safe injection into JavaScript via executeScript
 * Prevents XSS and script injection attacks
 */
export function escapeForJs(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Moderation request item - represents a single image to scan
 */
export interface ModerationRequestItem {
  itemId: string;
  src: string;
  sourceType: 'img' | 'bg-image' | 'video-poster';
  /** Image dimensions for size filtering */
  width?: number;
  height?: number;
}

/**
 * Trigger configuration passed in requests
 * Maps trigger IDs to enabled state
 */
export interface TriggerConfig {
  [triggerId: string]: boolean;
}

/**
 * Request message sent from WebView to Host
 * 
 * Security: The nonce field is generated once per injection and must be included
 * in all responses. This prevents spoofed messages from being processed.
 */
export interface ModerationRequestMessage {
  type: 'gc-moderation-request';
  requestId: string;
  pageEpoch?: number;
  items: ModerationRequestItem[];
  thresholds?: {
    porn: number;
    sexy: number;
    hentai: number;
  };
  triggers?: TriggerConfig;
  platform?: string;
  nonce: string;
  timestamp: number;
}

/**
 * Moderation result item - represents the scan result for a single image
 */
export interface ModerationResultItem {
  itemId: string;
  src: string;
  shouldBlur: boolean;
  category: string;
  confidence: number;
  severity?: ModerationSeverity;
  /** Which triggers matched (for debugging) */
  matchedTriggers?: string[];
  /** Reason for the decision */
  reason?: string;
}

/**
 * Result message sent from Host back to WebView
 * 
 * Security: The nonce field must match the request's nonce for the result to be processed
 */
export interface ModerationResultMessage {
  type: 'gc-moderation-result';
  requestId: string;
  pageEpoch?: number;
  results: ModerationResultItem[];
  nonce: string;
  timestamp?: number;
}

// ============= WEBVIEW BLUR OVERLAY PROTOCOL =============

export type BlurOverlayCommand = 'ENABLE_BLUR' | 'DISABLE_BLUR' | 'PING';

export interface BlurOverlayCommandMessage {
  type: 'MW_BLUR_COMMAND';
  command: BlurOverlayCommand;
  reason?: string;
  timestamp: number;
}

export interface BlurOverlayReadyMessage {
  type: 'MW_BLUR_READY';
  url?: string;
  reason?: string;
  timestamp: number;
}

export interface BlurOverlayStateMessage {
  type: 'MW_BLUR_STATE';
  enabled: boolean;
  reason?: string;
  timestamp: number;
}

/**
 * State of a pending moderation request
 */
export type RequestState = 'pending' | 'waitingForHost' | 'handled' | 'timeout' | 'error';

/**
 * Validate a moderation request message
 * Checks for required fields and correct types
 */
export function isValidModerationRequest(message: any): message is ModerationRequestMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.type === 'gc-moderation-request' &&
    typeof message.requestId === 'string' &&
    typeof message.nonce === 'string' &&
    Array.isArray(message.items) &&
    message.items.every((item: any) =>
      item &&
      typeof item.itemId === 'string' &&
      typeof item.src === 'string'
    )
  );
}

/**
 * Validate a moderation result message
 * Checks for required fields and correct types
 */
export function isValidModerationResult(message: any): message is ModerationResultMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.type === 'gc-moderation-result' &&
    typeof message.requestId === 'string' &&
    typeof message.nonce === 'string' &&
    Array.isArray(message.results)
  );
}

export function isBlurOverlayReadyMessage(message: any): message is BlurOverlayReadyMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.type === 'MW_BLUR_READY' &&
    typeof message.timestamp === 'number'
  );
}

export function createBlurOverlayStateMessage(
  enabled: boolean,
  reason: string
): BlurOverlayStateMessage {
  return {
    type: 'MW_BLUR_STATE',
    enabled,
    reason,
    timestamp: Date.now(),
  };
}

/**
 * Create a result message to send back to the WebView
 * Includes the nonce from the original request for validation
 */
export function createResultMessage(
  requestId: string,
  results: ModerationResultItem[],
  nonce: string,
  pageEpoch?: number
): ModerationResultMessage {
  return {
    type: 'gc-moderation-result',
    requestId,
    pageEpoch,
    results,
    nonce,
    timestamp: Date.now(),
  };
}

/**
 * Create a safe JSON string for injection via executeScript
 * Properly escapes all special characters
 */
export function createSafeJsonForInjection(obj: object): string {
  const json = JSON.stringify(obj);
  return json
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

// ============= MULTI-PARAMETER MODERATION LOGIC =============

/**
 * Thresholds for multi-parameter conditional logic
 */
export const MODERATION_THRESHOLDS = {
  /** Porn threshold (zero-tolerance) */
  porn: 0.10,
  /** Sexy threshold (zero-tolerance) */
  sexy: 0.20,
  /** Hentai threshold (zero-tolerance) */
  hentai: 0.10,
  /** Swimwear/shirtless sexy threshold */
  swimwearSexy: 0.30,
  /** Minimum skin density for swimwear detection */
  minSkinDensity: 0.20,
  /** Minimum image dimension - smaller images are fail-open */
  minImageDimension: 50,
};

/**
 * Estimated signals from prediction scores
 */
export interface ModerationSignals {
  hasHumanBody: boolean;
  hasSkinExposure: boolean;
  hasClothing: boolean;
  skinDensity: number;
}

/**
 * Estimate human body/skin signals from NSFWJS predictions
 * Since NSFWJS doesn't directly output body parts, we infer from class distributions
 */
export function estimateSignals(predictions: Record<string, number>): ModerationSignals {
  const porn = predictions['porn'] || predictions['Porn'] || 0;
  const sexy = predictions['sexy'] || predictions['Sexy'] || 0;
  const neutral = predictions['neutral'] || predictions['Neutral'] || 0;
  const drawing = predictions['drawing'] || predictions['Drawing'] || 0;

  // Infer human body presence from sexy/porn scores
  const hasHumanBody = sexy > 0.15 || porn > 0.15;

  // Infer skin exposure from sexy score
  const hasSkinExposure = sexy > 0.25;

  // Infer clothing presence from neutral score
  const hasClothing = neutral > 0.50;

  // Skin density: inverse of (neutral + drawing), clamped
  const clothingSignal = neutral + drawing;
  const skinDensity = Math.max(0, Math.min(1, 1 - clothingSignal));

  return {
    hasHumanBody,
    hasSkinExposure,
    hasClothing,
    skinDensity,
  };
}

/**
 * Moderation decision result
 */
export interface ModerationDecision {
  shouldBlur: boolean;
  reason: string;
  category: string;
  confidence: number;
  signals?: ModerationSignals;
}

export type ModerationSeverity = 'safe' | 'soft' | 'hard';

const HARD_EXACT_CATEGORIES = new Set([
  'porn',
  'hentai',
  'nudity',
  'nude',
  'explicit',
]);

const HARD_SUBSTRING_KEYWORDS = [
  'genital',
];

const SOFT_EXACT_CATEGORIES = new Set([
  'sexy',
  'suggestive',
  'swimwear',
  'bikini',
  'lingerie',
  'cleavage',
  'shirtless',
  'partial_nudity',
  'shirtless_male',
]);

/**
 * Map moderation category labels to coarse safety severity.
 * Used by host-side aggregation to separate hard-unsafe from soft-unsafe hits.
 */
export function mapModerationCategoryToSeverity(category?: string): ModerationSeverity {
  const normalized = (category || '').toLowerCase();
  if (!normalized || normalized === 'safe' || normalized === 'neutral' || normalized === 'drawing') {
    return 'safe';
  }
  if (SOFT_EXACT_CATEGORIES.has(normalized)) {
    return 'soft';
  }
  if (HARD_EXACT_CATEGORIES.has(normalized) || HARD_SUBSTRING_KEYWORDS.some(keyword => normalized.includes(keyword))) {
    return 'hard';
  }
  return 'safe';
}

/**
 * Apply strict threshold logic for moderation (zero-tolerance)
 *
 * Rules:
 * - No Neutral fast-pass
 * - No human-centric safety override
 * - If ANY threshold is hit → shouldBlur: true
 */
export function evaluateModerationDecision(
  predictions: Record<string, number>,
  dimensions?: { width: number; height: number }
): ModerationDecision {
  // Normalize keys to lowercase
  const norm: Record<string, number> = {};
  Object.entries(predictions).forEach(([k, v]) => {
    norm[k.toLowerCase()] = v;
  });

  const porn = norm['porn'] || 0;
  const sexy = norm['sexy'] || 0;
  const hentai = norm['hentai'] || 0;
  const neutral = norm['neutral'] || 0;

  // ==== FAIL-OPEN: Size filtering ====
  if (dimensions) {
    const { width, height } = dimensions;
    if (width < MODERATION_THRESHOLDS.minImageDimension || height < MODERATION_THRESHOLDS.minImageDimension) {
      return {
        shouldBlur: false,
        reason: 'fail_open_tiny',
        category: 'safe',
        confidence: 1,
      };
    }
  }

  const signals = estimateSignals(norm);

  // ==== SWIMWEAR/SHIRTLESS LOGIC (strict) ====
  const isSwimwearShirtless =
    sexy > MODERATION_THRESHOLDS.swimwearSexy &&
    signals.skinDensity >= MODERATION_THRESHOLDS.minSkinDensity &&
    !signals.hasClothing;

  if (isSwimwearShirtless) {
    return {
      shouldBlur: true,
      reason: 'swimwear_detected',
      category: 'swimwear',
      confidence: sexy,
      signals,
    };
  }

  // ==== STANDARD THRESHOLD CHECK (strict, no human gating) ====
  const pornHit = porn > MODERATION_THRESHOLDS.porn;
  const hentaiHit = hentai > MODERATION_THRESHOLDS.hentai;
  const sexyHit = sexy > MODERATION_THRESHOLDS.sexy;

  const shouldBlur = pornHit || hentaiHit || sexyHit;

  let category = 'safe';
  let confidence = neutral;
  if (pornHit) {
    category = 'porn';
    confidence = porn;
  } else if (hentaiHit) {
    category = 'hentai';
    confidence = hentai;
  } else if (sexyHit) {
    category = 'sexy';
    confidence = sexy;
  }

  return {
    shouldBlur,
    reason: shouldBlur ? 'threshold_hit' : 'threshold_safe',
    category,
    confidence,
    signals,
  };
}
