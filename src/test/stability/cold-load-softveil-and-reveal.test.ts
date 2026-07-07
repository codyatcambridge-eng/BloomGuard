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
  it('keeps a cold-open homepage thumbnail blurred and repairs reveal on load and visibility events', () => {
    const { video } = buildCard('ytm-rich-item-renderer', HOME_ID);
    stampPositiveBlur(video, HOME_ID);
    injection = injectScript();

    expect(document.getElementById('mw-moderation-styles')?.textContent).toContain('mw-softveil-pending');
    expect(document.documentElement.classList.contains('mw-softveil-pending')).toBe(false);
    expect(video.dataset.mwModerated).toBe('blurred');
    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();

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

  it('does not permanently dedupe a first-load thumbnail that is not measured yet', () => {
    const videoId = 'coldTopFeed123';
    const card = document.createElement('ytm-rich-item-renderer');
    const anchor = document.createElement('a');
    anchor.href = `/watch?v=${videoId}`;
    const img = document.createElement('img');
    img.src = `https://i.ytimg.com/vi/${videoId}/hq720.jpg`;
    Object.defineProperty(img, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        width: 0,
        height: 0,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    anchor.appendChild(img);
    card.appendChild(anchor);
    document.body.appendChild(card);

    injection = injectScript();

    expect(img.dataset.mwScanned).not.toBe('true');
    expect(img.dataset.mwLastScanSrc || '').toBe('');

    Object.defineProperty(img, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        width: 320,
        height: 180,
        top: 0,
        bottom: 180,
        left: 0,
        right: 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    (window as Window & { __MW_SCAN_FULL__?: () => void }).__MW_SCAN_FULL__?.();

    expect(img.dataset.mwScanned).toBe('true');
    expect(img.dataset.mwLastScanSrc).toBe(img.src);
  });
});
