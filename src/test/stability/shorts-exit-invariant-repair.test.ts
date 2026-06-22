import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';
const SAFE_ID = 'safe1234567';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('Shorts exit blur/reveal invariant repair', () => {
  it('clears non-positive BloomGuard blur residue on home thumbnails', () => {
    const { video } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();

    video.dataset.mwVeil = '1';
    video.dataset.mwModerated = 'softblur';
    video.classList.add('mw-softblur');
    video.style.setProperty('filter', 'blur(12px)', 'important');

    injection.probe.repairNonShortsBlurRevealInvariant('test_leave_shorts');

    expect(video.dataset.mwVeil).toBeUndefined();
    expect(video.dataset.mwModerated).toBe('safe');
    expect(video.classList.contains('mw-softblur')).toBe(false);
    expect(hasBlurFilter(video)).toBe(false);
    expect(document.querySelector('.mw-reveal-overlay')).toBeNull();
  });

  it('preserves an authorized positive blur and recreates its reveal overlay', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-overlay')).toBeNull();

    injection.probe.repairNonShortsBlurRevealInvariant('test_leave_shorts');

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();
  });
});
