import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { getNativeBrowserHarness, resetNativeBrowserHarness } from './native-webview-browser-test-kit';
import { NativeWebViewBrowser } from '@/components/browser/NativeWebViewBrowser';

const nativeBrowserHarness = getNativeBrowserHarness();

afterEach(() => {
  vi.useRealTimers();
  resetNativeBrowserHarness();
});

describe('stale safe result triggers rescan', () => {
  it('rejects stale results and immediately queues a current-surface rescan', async () => {
    vi.useFakeTimers();

    render(<NativeWebViewBrowser />);

    nativeBrowserHarness.executeScriptCalls.length = 0;
    nativeBrowserHarness.clearCacheCalls.length = 0;

    await act(async () => {
      nativeBrowserHarness.nativeOptions.current.onMessageFromWebview?.({
        type: 'gc-moderation-request',
        requestId: 'stale-result-request',
        pageEpoch: 1,
        sovereignId: 'nav_1|epoch_1|abc123xyz',
        items: [{ itemId: 'item-1', src: 'https://example.com/image.jpg', sourceType: 'img' }],
        nonce: 'test-nonce',
        timestamp: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(1100);
    });

    const scripts = nativeBrowserHarness.executeScriptCalls.join('\n');
    expect(
      nativeBrowserHarness.postMessageCalls.some((call) => {
        const message = call as { type?: string; results?: Array<{ category?: string }> };
        return (
          message?.type === 'gc-moderation-result' &&
          message.results?.some((result) =>
            result.category === 'safe_epoch_stale' || result.category === 'safe_sovereign_stale'
          )
        );
      })
    ).toBe(false);
    expect(scripts).toContain('__MW_SCAN_FULL__');
    expect(scripts).toContain('__MW_SCAN_YT__');
  });
});
