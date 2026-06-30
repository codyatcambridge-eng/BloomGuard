import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getNativeBrowserHarness, resetNativeBrowserHarness } from './native-webview-browser-test-kit';
import { NativeWebViewBrowser } from '@/components/browser/NativeWebViewBrowser';

const nativeBrowserHarness = getNativeBrowserHarness();

afterEach(() => {
  vi.useRealTimers();
  resetNativeBrowserHarness();
});

describe('browser blank open fallback', () => {
  it('shows the browser homepage instead of a blank black surface when the native webview URL is empty', () => {
    nativeBrowserHarness.nativeState.currentUrl = '';

    render(<NativeWebViewBrowser />);

    expect(screen.getByText('Focus Browser')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search the web safely…')).toBeInTheDocument();
  });
});
