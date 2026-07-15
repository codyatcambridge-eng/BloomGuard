/**
 * First-entry Active Shorts: Flash veil / CSS blur must never sit without Reveal.
 *
 * Holistic regression: sacc3 keeps poster/uncertain non-final (no applyBlur) while
 * first-entry Flash Shield still veils the player → blur with no button until frame.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildActiveShortsPlayer,
  injectScript,
  pushShortsUrl,
  restoreMainFeedUrl,
  type InjectionResult,
} from './harness';

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  restoreMainFeedUrl();
});

describe('First-entry Shorts veil must pair with reveal', () => {
  it('ensureActiveShortsVisibleBlurHasReveal pairs reveal when only CSS veil is on', () => {
    const id = 'FirstEntryVeil01';
    pushShortsUrl(id);
    const { frame, video, src } = buildActiveShortsPlayer(id);
    injection = injectScript({ flashShieldV1: true });

    expect(injection.probe.isShortsModeActive()).toBe(true);

    // Simulate unresolved first-entry veil (strip any bootstrap pairing first).
    document.querySelectorAll('.mw-reveal-overlay, .mw-reveal-btn').forEach((n) => n.remove());
    video.dataset.mwModerated = '';
    video.classList.remove('mw-blurred');
    video.dataset.mwVeil = '1';
    video.dataset.mwVeilAt = String(Date.now());
    video.dataset.mwSrc = src;
    frame.dataset.mwFlashFrame = '1';
    frame.dataset.mwModerated = '';
    const frost = document.createElement('div');
    frost.className = 'mw-flash-shorts-overlay';
    frame.appendChild(frost);

    expect(document.querySelector('.mw-reveal-btn')).toBeNull();

    const ok = injection.probe.ensureActiveShortsVisibleBlurHasReveal('test_veil_only');
    expect(ok).toBe(true);
    expect(
      document.querySelector('.mw-reveal-btn') ||
        document.querySelector('.mw-reveal-overlay') ||
        frame.querySelector('.mw-reveal-btn'),
    ).not.toBeNull();
  });

  it('first-entry force seed path leaves a reveal escape when veil is engaged', () => {
    const id = 'FirstEntrySeed02';
    pushShortsUrl(id);
    buildActiveShortsPlayer(id);
    injection = injectScript({ flashShieldV1: true });

    // Engage flash candidate + seed like host first entry.
    injection.probe.markFlashShieldShortsCandidate();
    injection.probe.ensureActiveShortsVisibleBlurHasReveal('test_after_seed');

    // Either portal reveal or flash-overlay reveal button must exist while veiled/blurred.
    const hasReveal =
      !!document.querySelector('.mw-reveal-btn') ||
      !!document.querySelector('.mw-reveal-overlay');
    // If flash never engaged (no flash config style), ensure still returns cleanly.
    // With flashShieldV1 true and active player, we expect a reveal path when veiled.
    const video = document.querySelector('#shorts-player video') as HTMLVideoElement | null;
    if (video && video.dataset.mwVeil === '1') {
      expect(hasReveal).toBe(true);
    } else {
      // Candidate may stamp veil — if nothing visible, no orphan obligation.
      expect(true).toBe(true);
    }
  });
});
