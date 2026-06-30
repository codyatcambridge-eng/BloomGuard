import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import NativeWebViewBrowser from '@/components/browser/NativeWebViewBrowser';
import { nativeBrowserHarness, resetNativeBrowserHarness } from './native-webview-browser-test-kit';

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
      await vi.runAllTimersAsync();
    });

    const scripts = nativeBrowserHarness.executeScriptCalls.join('\n');
    expect(nativeBrowserHarness.clearCacheCalls.length).toBeGreaterThan(0);
    expect(scripts).toContain('__MW_SCAN_FULL__');
    expect(scripts).toContain('__MW_SCAN_YT__');
  });
});

