import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { getNativeBrowserHarness, resetNativeBrowserHarness } from './native-webview-browser-test-kit';
import { NativeWebViewBrowser } from '@/components/browser/NativeWebViewBrowser';

const nativeBrowserHarness = getNativeBrowserHarness();

afterEach(() => {
  vi.useRealTimers();
  resetNativeBrowserHarness();
});

describe('reload toggle state rehydration', () => {
  it('keeps the in-browser protection state aligned and resends settings on reload', async () => {
    vi.useFakeTimers();

    render(<NativeWebViewBrowser />);

    expect(nativeBrowserHarness.browserHeaderProps.current?.isProtected).toBe(true);

    nativeBrowserHarness.executeScriptCalls.length = 0;

    await act(async () => {
      fireEvent.click(screen.getByTestId('browser-refresh'));
      await nativeBrowserHarness.nativeOptions.current.onLoadStart?.(nativeBrowserHarness.nativeState.currentUrl);
      await nativeBrowserHarness.nativeOptions.current.onLoadEnd?.(nativeBrowserHarness.nativeState.currentUrl);
      await vi.advanceTimersByTimeAsync(1100);
    });

    const scripts = nativeBrowserHarness.executeScriptCalls.join('\n');
    expect(scripts).toContain('window.__MW_SYNC_HOST_CONTEXT__');
    expect(scripts).toContain("command: 'PING'");
    expect(scripts).toContain('__MW_SCAN_FULL__');
    expect(scripts).toContain('__MW_SCAN_YT__');
    expect(nativeBrowserHarness.browserHeaderProps.current?.isProtected).toBe(true);
  });
});
