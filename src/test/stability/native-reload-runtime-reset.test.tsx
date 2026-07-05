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
    const homeUrl = 'https://www.youtube.com/';
    nativeBrowserHarness.nativeState.currentUrl = homeUrl;

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
      await nativeBrowserHarness.nativeOptions.current.onLoadStart?.(homeUrl);
    });

    nativeBrowserHarness.executeScriptCalls.length = 0;

    await act(async () => {
      await nativeBrowserHarness.nativeOptions.current.onLoadEnd?.(homeUrl);
    });

    nativeBrowserHarness.executeScriptCalls.length = 0;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(24);
    });

    expect(nativeBrowserHarness.executeScriptCalls).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    const scripts = nativeBrowserHarness.executeScriptCalls.join('\n');
    expect(scripts).toContain('window.__MW_SYNC_HOST_CONTEXT__');
    expect(scripts).toContain('__MW_SCAN_FULL__');
    expect(scripts).toContain('__MW_SCAN_YT__');

    expect(nativeBrowserHarness.browserHeaderProps.current?.isProtected).toBe(true);
  });

  it('does not latch injection in-flight when a forced reinject resolves via host context sync', async () => {
    vi.useFakeTimers();
    const homeUrl = 'https://www.youtube.com/';
    nativeBrowserHarness.nativeState.currentUrl = homeUrl;

    render(<NativeWebViewBrowser />);

    await act(async () => {
      await nativeBrowserHarness.nativeOptions.current.onLoadStart?.(homeUrl);
    });
    await act(async () => {
      await nativeBrowserHarness.nativeOptions.current.onLoadEnd?.(homeUrl);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    expect(nativeBrowserHarness.executeScriptCalls.join('\n')).toContain('__MW_SCAN_FULL__');

    // Second load-end while the runtime is already alive: the host context sync
    // hook answers OK_NO_CHANGE, so injectModerationScript exits on the
    // sync-applied early return instead of dispatching the main script.
    nativeBrowserHarness.scriptResponder.current = (script) => {
      if (script.includes('__MW_SYNC_HOST_CONTEXT__(')) {
        return JSON.stringify({
          hostContext: 'OK',
          syncResult: 'OK_NO_CHANGE',
          navId: 1,
          pageEpoch: 1,
        });
      }
      return undefined;
    };
    await act(async () => {
      await nativeBrowserHarness.nativeOptions.current.onLoadEnd?.(homeUrl);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    nativeBrowserHarness.scriptResponder.current = null;
    nativeBrowserHarness.executeScriptCalls.length = 0;

    // A stale-liveness recovery (focus) must still be able to inject: the
    // sync-applied early return above must not leave injectionInFlight stuck.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(nativeBrowserHarness.executeScriptCalls.join('\n')).toContain('__MW_SCAN_FULL__');
  });
});
