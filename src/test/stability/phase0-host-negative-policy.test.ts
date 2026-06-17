import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCard,
  injectScript,
  TEST_NONCE,
  TEST_PAGE_EPOCH,
  type InjectionResult,
} from './harness';

const VIDEO_ID = 'HostSafe001';

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('Phase 0: host-negative policy', () => {
  it('does not let hardBlurOverride re-escalate a host-negative result', () => {
    const { video } = buildCard('ytm-rich-item-renderer', VIDEO_ID);
    const src = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;
    injection = injectScript();
    injection.probe.registerElement(VIDEO_ID, video);

    injection.probe.handleModerationResult({
      type: 'gc-moderation-result',
      requestId: 'phase0-host-safe',
      nonce: TEST_NONCE,
      pageEpoch: TEST_PAGE_EPOCH,
      results: [{
        itemId: VIDEO_ID,
        src,
        shouldBlur: false,
        category: 'neutral',
        confidence: 0.95,
        predictions: {
          porn: 0.95,
          sexy: 0.02,
          hentai: 0.01,
          neutral: 0.02,
        },
        decision_reason: 'host_safe',
      }],
    });

    expect(video.dataset.mwModerated).not.toBe('blurred');
    expect(video.style.getPropertyValue('filter')).not.toContain('blur(');
  });
});
