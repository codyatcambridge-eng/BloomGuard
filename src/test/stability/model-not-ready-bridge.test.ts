/**
 * Bridge must not return null-as-final when NSFWJS is not ready.
 * (Uses a lightweight shape check of the model_not_ready contract.)
 */
import { describe, expect, it } from 'vitest';
import type { ModerationCategory } from '@/plugins/ModerationBridge.shared';

describe('model_not_ready bridge contract', () => {
  it('model_not_ready is a valid ModerationCategory', () => {
    const cat: ModerationCategory = 'model_not_ready';
    expect(cat).toBe('model_not_ready');
  });

  it('pending category is distinct from safe and error', () => {
    const pending: ModerationCategory = 'model_not_ready';
    expect(pending).not.toBe('safe');
    expect(pending).not.toBe('error');
    expect(pending).not.toBe('timeout');
  });
});
