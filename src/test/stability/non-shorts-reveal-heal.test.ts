import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';
const SAFE_ID = 'safe1234567';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function revealOverlayCount(): number {
  return document.querySelectorAll('.mw-reveal-overlay').length;
}

function revealButtonCount(): number {
  return document.querySelectorAll('.mw-reveal-btn').length;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
});

describe('Non-Shorts reveal heal (home/results)', () => {
  it('creates exactly one reveal for a home-feed blurred node missing reveal', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(revealOverlayCount()).toBe(0);

    const healed = injection.probe.healNonShortsBlurredNodeReveal('test_missing_reveal');

    expect(healed).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
    expect(hasBlurFilter(video)).toBe(true);
  });

  it('creates reveal on results surface after SPA navigation', () => {
    const { video } = buildCard('ytm-compact-video-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();

    window.history.pushState({}, '', '/results?search_query=test');
    const healed = injection.probe.healNonShortsBlurredNodeReveal('test_results_nav');

    expect(healed).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
  });

  it('does not duplicate an existing home-feed reveal', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    expect(revealOverlayCount()).toBe(1);

    const healed = injection.probe.healNonShortsBlurredNodeReveal('test_existing_reveal');

    expect(healed).toBe(false);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
  });

  it('does nothing for a safe or unblurred thumbnail', () => {
    const { video } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();

    const overlaysBefore = revealOverlayCount();
    const buttonsBefore = revealButtonCount();

    const healed = injection.probe.healNonShortsBlurredNodeReveal('test_safe_thumb');

    expect(healed).toBe(false);
    expect(revealOverlayCount()).toBe(overlaysBefore);
    expect(revealButtonCount()).toBe(buttonsBefore);
    expect(video.dataset.mwModerated).toBeUndefined();
  });

  it('does nothing when protection is Off', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();
    injection.probe.offModeCleanup('test_off_before_heal');

    video.dataset.mwModerated = 'blurred';
    video.dataset.mwHardBlur = '1';
    video.dataset.mwSrc = srcFor(POSITIVE_ID);
    video.classList.add('mw-blurred');
    video.style.setProperty('filter', 'blur(40px)', 'important');

    const healed = injection.probe.healNonShortsBlurredNodeReveal('test_off');

    expect(healed).toBe(false);
    expect(revealOverlayCount()).toBe(0);
    expect(revealButtonCount()).toBe(0);
  });
});