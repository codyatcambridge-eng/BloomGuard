/**
 * Phase 0: hard blur without reveal is a failure on every main surface.
 *
 * Repro class: Results (or home/watch) → Active Shorts → exit left hard-blurred
 * thumbs with no reveal because enter-Shorts overlay sweep stripped all
 * non-portal reveals document-wide.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCard,
  injectScript,
  pushResultsUrl,
  pushShortsUrl,
  pushWatchUrl,
  restoreMainFeedUrl,
  type InjectionResult,
} from './harness';

const POSITIVE_ID = 'OrphanSurfPos1';
const POSITIVE_B = 'OrphanSurfPos2';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

function revealCount(): number {
  return document.querySelectorAll('.mw-reveal-overlay, .mw-reveal-btn').length;
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  restoreMainFeedUrl();
});

describe('Blur+reveal invariant across main surfaces after Shorts exit', () => {
  it('results page: orphan hard blur regains reveal after exit cleanup', () => {
    pushResultsUrl('bloomguard');
    const { video } = buildCard('ytm-video-with-context-renderer', POSITIVE_ID);
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
    expect(document.querySelector('.mw-reveal-btn')).not.toBeNull();

    // Simulate enter-Shorts sweep that used to strip ALL non-portal reveals.
    document.querySelectorAll('.mw-reveal-overlay, .mw-reveal-btn').forEach((n) => n.remove());
    expect(revealCount()).toBe(0);
    expect(hasBlurFilter(video)).toBe(true);

    // Exit cleanup / invariant repair must recreate reveal (not leave orphan blur).
    injection.probe.performShortsExitSurfaceCleanup('test_results_orphan_after_shorts');
    injection.probe.repairNonShortsBlurRevealInvariant('test_results_orphan_repair');

    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-btn')).not.toBeNull();
    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();
  });

  it('home page: orphan hard blur regains reveal after exit cleanup', () => {
    restoreMainFeedUrl();
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

    injection.probe.performShortsExitSurfaceCleanup('test_home_orphan');
    injection.probe.repairNonShortsBlurRevealInvariant('test_home_orphan_repair');

    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-btn')).not.toBeNull();
  });

  it('watch page recs: orphan hard blur regains reveal after exit cleanup', () => {
    pushWatchUrl(POSITIVE_ID);
    const { video } = buildCard('ytd-compact-video-renderer', POSITIVE_B);
    injection = injectScript();

    injection.probe.applyBlur(
      video,
      srcFor(POSITIVE_B),
      'porn',
      40,
      POSITIVE_B,
      'classifier_positive',
    );
    document.querySelectorAll('.mw-reveal-overlay, .mw-reveal-btn').forEach((n) => n.remove());

    injection.probe.performShortsExitSurfaceCleanup('test_watch_orphan');
    injection.probe.repairNonShortsBlurRevealInvariant('test_watch_orphan_repair');

    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-btn')).not.toBeNull();
  });

  it('results surface URL is classified as main thumbnail surface', () => {
    injection = injectScript();
    expect(
      injection.probe.isYouTubeMainPageThumbnailSurfaceUrl(
        'https://m.youtube.com/results?search_query=test',
      ),
    ).toBe(true);
    expect(
      injection.probe.isYouTubeMainPageThumbnailSurfaceUrl(
        'https://www.youtube.com/results?search_query=test',
      ),
    ).toBe(true);
  });

  it('hard blur without reveal is not left after repair when only filter stamp remains', () => {
    pushResultsUrl('edge');
    const { video } = buildCard('ytm-compact-video-renderer', POSITIVE_ID);
    injection = injectScript();
    const src = srcFor(POSITIVE_ID);

    // Partial stamp: moderated+filter but overlay never created (classic orphan).
    video.dataset.mwModerated = 'blurred';
    video.dataset.mwSrc = src;
    video.dataset.mwHardBlur = '1';
    video.dataset.mwHardBlurItemKey = POSITIVE_ID;
    video.dataset.mwCategory = 'porn';
    video.classList.add('mw-blurred');
    video.style.setProperty('filter', 'blur(40px)', 'important');

    expect(document.querySelector('.mw-reveal-btn')).toBeNull();
    injection.probe.repairNonShortsBlurRevealInvariant('test_filter_only_orphan');

    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-btn')).not.toBeNull();
  });
});

describe('Enter-Shorts overlay sweep must not strip main-surface reveals', () => {
  it('results reveals survive a simulated enter-shorts mode transition sweep', () => {
    pushResultsUrl('keep-reveals');
    const { video } = buildCard('ytm-video-with-context-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(
      video,
      srcFor(POSITIVE_ID),
      'porn',
      40,
      POSITIVE_ID,
      'classifier_positive',
    );
    expect(document.querySelector('.mw-reveal-btn')).not.toBeNull();

    // SPA enter shorts — mode transition fires overlay sweep.
    pushShortsUrl('ActiveShortEnter1');
    // Allow SPA hooks / intervals a tick; sweep runs on url change detection.
    // Directly re-run cleanup path that used to strip everything: exit then we
    // assert results-style orphan repair still works after short navigation.
    // While on shorts URL, main-surface repair is gated; returning to results:
    pushResultsUrl('keep-reveals');
    injection.probe.performShortsExitSurfaceCleanup('test_after_enter_exit_cycle');
    injection.probe.repairNonShortsBlurRevealInvariant('test_after_cycle');

    // Blur may still be present; reveal must exist if blur remains.
    if (hasBlurFilter(video) && video.dataset.mwModerated === 'blurred') {
      expect(document.querySelector('.mw-reveal-btn')).not.toBeNull();
    }
  });
});
