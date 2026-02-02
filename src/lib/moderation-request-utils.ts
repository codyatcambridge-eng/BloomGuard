/**
 * Utility functions for moderation request handling
 * 
 * This module provides the core protocol utilities for the WebView moderation system:
 * - Request/Result message types with nonce security
 * - ID generation (requestId, itemId, nonce)
 * - Message validation
 * - Safe string escaping for executeScript
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
  items: ModerationRequestItem[];
  thresholds?: {
    porn: number;
    sexy: number;
    hentai: number;
  };
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
}

/**
 * Result message sent from Host back to WebView
 * 
 * Security: The nonce field must match the request's nonce for the result to be processed
 */
export interface ModerationResultMessage {
  type: 'gc-moderation-result';
  requestId: string;
  results: ModerationResultItem[];
  nonce: string;
  timestamp?: number;
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

/**
 * Create a result message to send back to the WebView
 * Includes the nonce from the original request for validation
 */
export function createResultMessage(
  requestId: string,
  results: ModerationResultItem[],
  nonce: string
): ModerationResultMessage {
  return {
    type: 'gc-moderation-result',
    requestId,
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
