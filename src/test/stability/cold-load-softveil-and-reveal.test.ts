import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const HOME_ID = 'dQw4w9WgXcQ';

let injection: InjectionResult | undefined;

afterEach(() => {
  injection?.cleanup();
  injection = undefined;
  document.body.innerHTML = '';
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('cold load soft veil and reveal repair', () => {
  it('keeps the boot veil until the first scan and repairs reveal on load and visibility events', () => {
    const { video } = buildCard('ytm-rich-item-renderer', HOME_ID);
    injection = injectScript();

    expect(document.getElementById('mw-moderation-styles')?.textContent).toContain('mw-softveil-pending');
    expect(document.documentElement.classList.contains('mw-softveil-pending')).toBe(false);

    injection.probe.applyBlur(video, video.src, 'porn', 40, HOME_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();

    (window as Window & { __MW_SCAN_FULL__?: () => void }).__MW_SCAN_FULL__?.();

    expect(document.documentElement.classList.contains('mw-softveil-pending')).toBe(false);
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
