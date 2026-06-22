import { describe, expect, it } from 'vitest';
import {
  isProtectionOffState,
  shouldInjectForProtection,
  shouldRunFlashShield,
  shouldRunRuntimeModeration,
} from '@/lib/protection-mode';

describe('protection mode host policy', () => {
  it('Off wins over Flash Shield and blocks injection', () => {
    const state = {
      effectiveShieldEnabled: true,
      blurDial: 0,
      flashShieldEnabled: true,
    };

    expect(isProtectionOffState(state)).toBe(true);
    expect(shouldRunRuntimeModeration(state)).toBe(false);
    expect(shouldRunFlashShield(state)).toBe(false);
    expect(shouldInjectForProtection(state)).toBe(false);
  });

  it('disabled shield blocks injection even when Flash Shield is enabled', () => {
    const state = {
      effectiveShieldEnabled: false,
      blurDial: 3,
      flashShieldEnabled: true,
    };

    expect(isProtectionOffState(state)).toBe(true);
    expect(shouldRunFlashShield(state)).toBe(false);
    expect(shouldInjectForProtection(state)).toBe(false);
  });

  it('turning back On allows normal runtime moderation and Flash Shield', () => {
    const state = {
      effectiveShieldEnabled: true,
      blurDial: 3,
      flashShieldEnabled: true,
    };

    expect(isProtectionOffState(state)).toBe(false);
    expect(shouldRunRuntimeModeration(state)).toBe(true);
    expect(shouldRunFlashShield(state)).toBe(true);
    expect(shouldInjectForProtection(state)).toBe(true);
  });
});
