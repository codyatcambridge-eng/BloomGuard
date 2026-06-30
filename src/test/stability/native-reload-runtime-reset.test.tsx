import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { getNativeBrowserHarness, resetNativeBrowserHarness } from './native-webview-browser-test-kit';
import { NativeWebViewBrowser } from '@/components/browser/NativeWebViewBrowser';

const nativeBrowserHarness = getNativeBrowserHarness();

afterEach(() => {
  vi.useRealTimers();
  resetNativeBrowserHarness();
});

describe('native reload runtime reset', () => {
  it('rehydrates the native runtime boundary on reload and forces a fresh scan', async () => {
    vi.useFakeTimers();

    render(<NativeWebViewBrowser />);

    nativeBrowserHarness.executeScriptCalls.length = 0;
    nativeBrowserHarness.clearCacheCalls.length = 0;
    nativeBrowserHarness.lifecycleLog.length = 0;

    await act(async () => {
      fireEvent.click(screen.getByTestId('browser-refresh'));
    });

    expect(nativeBrowserHarness.refreshClicks).toEqual(['refresh']);
    expect(nativeBrowserHarness.lifecycleLog).toEqual([
      'reload:start',
      'reload:preflight',
      'reload:done',
    ]);
    expect(nativeBrowserHarness.clearCacheCalls.length).toBeGreaterThan(0);

    await act(async () => {
      await nativeBrowserHarness.nativeOptions.current.onLoadStart?.(nativeBrowserHarness.nativeState.currentUrl);
      await nativeBrowserHarness.nativeOptions.current.onLoadEnd?.(nativeBrowserHarness.nativeState.currentUrl);
      await vi.advanceTimersByTimeAsync(1100);
    });

    const scripts = nativeBrowserHarness.executeScriptCalls.join('\n');
    expect(scripts).toContain('window.__MW_SYNC_HOST_CONTEXT__');
    expect(scripts).toContain('__MW_SCAN_FULL__');
    expect(scripts).toContain('__MW_SCAN_YT__');

    expect(nativeBrowserHarness.browserHeaderProps.current?.isProtected).toBe(true);
  });
});
