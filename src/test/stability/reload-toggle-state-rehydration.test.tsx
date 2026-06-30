import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import NativeWebViewBrowser from '@/components/browser/NativeWebViewBrowser';
import { nativeBrowserHarness, resetNativeBrowserHarness } from './native-webview-browser-test-kit';

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
      await vi.runAllTimersAsync();
    });

    const scripts = nativeBrowserHarness.executeScriptCalls.join('\n');
    expect(scripts).toContain('Enabled: true');
    expect(scripts).toContain('blurStrength: 28');
    expect(scripts).toContain('scanEnabled: true');
    expect(nativeBrowserHarness.browserHeaderProps.current?.isProtected).toBe(true);
  });
});

