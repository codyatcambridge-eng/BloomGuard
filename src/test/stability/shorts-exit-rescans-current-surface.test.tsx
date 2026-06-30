import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import NativeWebViewBrowser from '@/components/browser/NativeWebViewBrowser';
import { nativeBrowserHarness, resetNativeBrowserHarness } from './native-webview-browser-test-kit';

const SHORTS_URL = 'https://www.youtube.com/shorts/abc123xyz';
const HOME_URL = 'https://www.example.com/';

afterEach(() => {
  vi.useRealTimers();
  resetNativeBrowserHarness();
});

describe('shorts exit rescans current surface', () => {
  it('clears shorts lifecycle state and forces a fresh non-shorts scan after exit', async () => {
    vi.useFakeTimers();

    render(<NativeWebViewBrowser />);

    nativeBrowserHarness.executeScriptCalls.length = 0;
    nativeBrowserHarness.clearCacheCalls.length = 0;

    nativeBrowserHarness.nativeState.currentUrl = SHORTS_URL;

    await act(async () => {
      await nativeBrowserHarness.nativeOptions.current.onUrlChange?.(HOME_URL);
      await vi.runAllTimersAsync();
    });

    const afterExitScripts = nativeBrowserHarness.executeScriptCalls.join('\n');
    expect(nativeBrowserHarness.clearCacheCalls.length).toBeGreaterThan(0);
    expect(afterExitScripts).toContain('__MW_SCAN_FULL__');
    expect(afterExitScripts).toContain('__MW_SCAN_YT__');
    expect(afterExitScripts).not.toContain('__MW_SCAN_ACTIVE_SHORTS__');

    nativeBrowserHarness.executeScriptCalls.length = 0;

    await act(async () => {
      nativeBrowserHarness.nativeOptions.current.onMessageFromWebview?.({
        type: 'gc-moderation-request',
        requestId: 'stale-shorts-request',
        pageEpoch: 90,
        sovereignId: 'nav_1|epoch_90|abc123xyz',
        items: [{ itemId: 'item-1', src: 'https://example.com/image.jpg', sourceType: 'img' }],
        nonce: 'test-nonce',
        timestamp: Date.now(),
      });
      await vi.runAllTimersAsync();
    });

    const staleRejectScripts = nativeBrowserHarness.executeScriptCalls.join('\n');
    expect(staleRejectScripts).toContain('__MW_SCAN_FULL__');
    expect(staleRejectScripts).toContain('__MW_SCAN_YT__');
    expect(staleRejectScripts).not.toContain('__MW_SCAN_ACTIVE_SHORTS__');
  });
});

