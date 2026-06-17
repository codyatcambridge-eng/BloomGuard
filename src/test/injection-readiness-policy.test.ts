import { describe, expect, it } from 'vitest';
import { isCurrentInjectionReadinessMessage } from '@/components/browser/NativeWebViewBrowser';

const ACTIVE_NAV_ID = 7;
const ACTIVE_EPOCH = 7;
const NONCE_PREFIX = 'phase0';

const validMessage = {
  type: 'MW_INJECTED_ACK',
  hostNavId: ACTIVE_NAV_ID,
  pageEpoch: ACTIVE_EPOCH,
  noncePrefix: NONCE_PREFIX,
  url: 'https://m.youtube.com/',
};

describe('Phase 0 injection readiness policy', () => {
  it('accepts readiness only for the active nav, epoch, nonce, and nonblank URL', () => {
    expect(isCurrentInjectionReadinessMessage(
      validMessage,
      ACTIVE_NAV_ID,
      ACTIVE_EPOCH,
      NONCE_PREFIX,
    )).toBe(true);
  });

  it.each([
    ['stale nav', { hostNavId: ACTIVE_NAV_ID - 1 }],
    ['stale epoch', { pageEpoch: ACTIVE_EPOCH - 1 }],
    ['wrong nonce', { noncePrefix: 'wrong' }],
    ['blank URL', { url: 'about:blank' }],
    ['missing host nav', { hostNavId: undefined }],
    ['missing epoch', { pageEpoch: undefined }],
  ])('rejects %s readiness', (_label, override) => {
    expect(isCurrentInjectionReadinessMessage(
      { ...validMessage, ...override },
      ACTIVE_NAV_ID,
      ACTIVE_EPOCH,
      NONCE_PREFIX,
    )).toBe(false);
  });
});
