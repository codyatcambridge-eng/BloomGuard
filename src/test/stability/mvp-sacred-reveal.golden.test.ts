/**
 * GOLDEN / FREEZE TEST — Tap-to-Reveal (SACRED)
 *
 * Locks the reveal-button contract that must NEVER regress (see FROZEN.md):
 *   1. A classified-positive home-feed thumbnail gets a tappable reveal button.
 *   2. Tapping the reveal button clears the blur (data-mw-moderated -> 'revealed').
 *   3. Stale-closure guard: after a card node is recycled to hold different
 *      (non-blurred) content, the reveal button does NOT operate on the stale
 *      node — it resolves the LIVE blurred node carrying the same src and reveals
 *      that one instead. This is the exact bug fixed on 2026-05-31.
 *   4. The reveal button is created for a search/compact card layout too
 *      (reveal works on all card surfaces, not just rich-item).
 *
 * Driven through generateModerationScript() in jsdom via the existing harness.
 * No production code is modified.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';
const SECOND_ID = 'aBcD1234xyZ';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function revealButton(): HTMLButtonElement | null {
  return document.querySelector('.mw-reveal-btn');
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('GOLDEN: Tap-to-Reveal (sacred — do not regress)', () => {
  it('a classified-positive home-feed thumbnail gets a reveal overlay + button', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
    const btn = revealButton();
    expect(btn).not.toBeNull();
    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();
  });

  it('tapping the reveal button clears the blur', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    const btn = revealButton();
    expect(btn).not.toBeNull();

    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(video.dataset.mwModerated).toBe('revealed');
    expect(hasBlurFilter(video)).toBe(false);
  });

  it('stale-closure guard: a recycled card node is NOT revealed; the live blurred node is', () => {
    const { video: video1 } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video1, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    const btn = revealButton();
    expect(btn).not.toBeNull();

    // Simulate YouTube recycling video1's node to hold different, non-blurred content.
    // The reveal overlay's anchor still references video1 (the stale closure target).
    video1.dataset.mwModerated = 'safe';
    video1.style.removeProperty('filter');

    // The genuinely-blurred node for this src now lives on a different element.
    const { video: video2 } = buildCard('ytm-compact-video-renderer', POSITIVE_ID);
    injection.probe.applyBlur(video2, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    expect(video2.dataset.mwModerated).toBe('blurred');

    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // The live blurred node is revealed; the recycled (stale) node is left as-is.
    expect(video2.dataset.mwModerated).toBe('revealed');
    expect(video1.dataset.mwModerated).toBe('safe');
  });

  it('reveal button is created for a compact/search-style card too', () => {
    const { video } = buildCard('ytm-compact-video-renderer', SECOND_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(SECOND_ID), 'porn', 40, SECOND_ID, 'classifier_positive');

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(revealButton()).not.toBeNull();
  });
});
