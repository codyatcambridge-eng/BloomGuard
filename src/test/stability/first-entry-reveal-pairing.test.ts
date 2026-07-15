/**
 * First YouTube entry: hard-blurred home thumbs must regain reveal if create
 * misses (static parent / cold lifecycle rescan). Sacred blur-without-reveal.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'FirstEntryReveal1';

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
  vi.useRealTimers();
});

describe('First-entry home reveal pairing', () => {
  it('applyBlur creates reveal on first home thumbnail', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    // Simulate first-row static parent (common on cold YouTube paint).
    if (video.parentElement) {
      video.parentElement.style.position = 'static';
    }
    injection = injectScript();
    injection.probe.applyBlur(
      video,
      srcFor(POSITIVE_ID),
      'porn',
      40,
      POSITIVE_ID,
      'classifier_positive',
    );

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();
    expect(document.querySelector('.mw-reveal-btn')).not.toBeNull();
  });

  it('repairNonShorts recreates missing reveal on hard-blurred positive', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(
      video,
      srcFor(POSITIVE_ID),
      'porn',
      40,
      POSITIVE_ID,
      'classifier_positive',
    );
    // Simulate orphan blur: remove overlay only.
    document.querySelectorAll('.mw-reveal-overlay, .mw-reveal-btn').forEach((n) => n.remove());
    expect(document.querySelector('.mw-reveal-overlay')).toBeNull();
    expect(hasBlurFilter(video)).toBe(true);

    injection.probe.repairNonShortsBlurRevealInvariant('test_first_entry_orphan');

    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();
    expect(document.querySelector('.mw-reveal-btn')).not.toBeNull();
  });

  it('lifecycle rescan repair path leaves hard positive with reveal', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(
      video,
      srcFor(POSITIVE_ID),
      'porn',
      40,
      POSITIVE_ID,
      'classifier_positive',
    );
    document.querySelectorAll('.mw-reveal-overlay, .mw-reveal-btn').forEach((n) => n.remove());

    const rescan = (window as unknown as { __MW_LIFECYCLE_RESCAN__?: (r: string) => string })
      .__MW_LIFECYCLE_RESCAN__;
    expect(typeof rescan).toBe('function');
    rescan!('test_first_entry_lifecycle');

    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();
  });
});
