import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, stampPositiveBlur, type InjectionResult } from './harness';

const HOME_ID = 'dQw4w9WgXcQ';

let injection: InjectionResult | undefined;

afterEach(() => {
  injection?.cleanup();
  injection = undefined;
  document.body.innerHTML = '';
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('cold load soft veil and reveal repair', () => {
  it('keeps a cold-open homepage thumbnail blurred and repairs reveal across slow hydration', async () => {
    vi.useFakeTimers();
    injection = injectScript();

    expect(document.getElementById('mw-moderation-styles')?.textContent).toContain('mw-softveil-pending');
    expect(document.documentElement.classList.contains('mw-softveil-pending')).toBe(false);
    expect(document.querySelector('.mw-reveal-overlay')).toBeNull();

    (window as Window & { __MW_SCAN_FULL__?: () => void }).__MW_SCAN_FULL__?.();
    await vi.advanceTimersByTimeAsync(150);

    (window as Window & { __MW_SCAN_FULL__?: () => void }).__MW_SCAN_FULL__?.();
    await vi.advanceTimersByTimeAsync(200);

    const { video } = buildCard('ytm-rich-item-renderer', HOME_ID);
    stampPositiveBlur(video, HOME_ID);

    await vi.advanceTimersByTimeAsync(1);

    expect(document.documentElement.classList.contains('mw-softveil-pending')).toBe(false);
    expect(video.dataset.mwModerated).toBe('blurred');
    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();

    document.querySelector('.mw-reveal-overlay')?.remove();

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event('visibilitychange'));

    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();

    document.querySelector('.mw-reveal-overlay')?.remove();
    window.dispatchEvent(new Event('load'));

    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();
  });
});
