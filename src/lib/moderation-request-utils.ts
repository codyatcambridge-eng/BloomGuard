/**
 * Utility functions for moderation request handling
 */

/**
 * Generate a unique request ID for moderation batches
 */
export function generateRequestId(): string {
  return 'r_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36);
}

/**
 * Generate a unique item ID for individual scan items
 */
export function generateItemId(): string {
  return 'i_' + Math.random().toString(36).slice(2, 9);
}

/**
 * Escape a string for safe injection into JavaScript
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
 * Message types for the moderation protocol
 */
export interface ModerationRequestMessage {
  type: 'gc-moderation-request';
  requestId: string;
  items: ModerationRequestItem[];
  thresholds?: {
    porn: number;
    sexy: number;
    hentai: number;
  };
  timestamp: number;
}

export interface ModerationRequestItem {
  itemId: string;
  src: string;
  sourceType: 'img' | 'bg-image' | 'video-poster';
}

export interface ModerationResultMessage {
  type: 'gc-moderation-result';
  requestId: string;
  results: ModerationResultItem[];
  timestamp?: number;
}

export interface ModerationResultItem {
  itemId: string;
  src: string;
  shouldBlur: boolean;
  category: string;
  confidence: number;
}

/**
 * Validate a moderation request message
 */
export function isValidModerationRequest(message: any): message is ModerationRequestMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.type === 'gc-moderation-request' &&
    typeof message.requestId === 'string' &&
    Array.isArray(message.items) &&
    message.items.every((item: any) =>
      item &&
      typeof item.itemId === 'string' &&
      typeof item.src === 'string'
    )
  );
}

/**
 * Create a result message to send back to the WebView
 */
export function createResultMessage(
  requestId: string,
  results: ModerationResultItem[]
): ModerationResultMessage {
  return {
    type: 'gc-moderation-result',
    requestId,
    results,
    timestamp: Date.now(),
  };
}
