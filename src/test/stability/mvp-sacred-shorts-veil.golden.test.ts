/**
 * GOLDEN / FREEZE TEST — Flash Shield on the ACTIVE Shorts player + reveal-button heal.
 *
 * Locks the two additive behaviors:
 *   1. markFlashShieldShortsCandidate() stamps data-mw-veil="1" on the active reel's media
 *      (<video>/img) ONLY when CONFIG.flashShieldV1 && Shorts mode, never sets data-mw-moderated,
 *      and the veil CSS scoped to #shorts-player exists. OFF => no stamp.
 *   2. healShortsRevealOverlay() is idempotent — it does NOT create a second overlay on a node
 *      that already has one, and is a safe no-op when not in Shorts mode.
 *
 * Driven through generateModerationScript() in jsdom. No production code modified.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

const SHORT_ID = 'sHoRtVid123';

function enterShorts(id: string): void {
  window.history.pushState({}, '', `/shorts/${id}`);
}

function buildActiveShort(id: string): { player: HTMLElement; reel: Element; video: HTMLVideoElement } {
  const player = document.createElement('div');
  player.id = 'shorts-player';
  const reel = document.createElement('ytm-reel-video-renderer');
  reel.setAttribute('aria-hidden', 'false');
  reel.setAttribute('is-active', '');
  const video = document.createElement('video') as HTMLVideoElement;
  video.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  reel.appendChild(video);
  player.appendChild(reel);
  document.body.appendChild(player);
  return { player, reel, video };
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  window.history.pushState({}, '', '/'); // leave Shorts mode for the next test
});

describe('GOLDEN: Flash Shield on active Shorts (additive)', () => {
  it('veils the active Short media when flag ON + Shorts mode', () => {
    enterShorts(SHORT_ID);
    const { video } = buildActiveShort(SHORT_ID);
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();

    expect(video.dataset.mwVeil).toBe('1');
    // never sets a moderation state
    expect(video.hasAttribute('data-mw-moderated')).toBe(false);
  });

  it('the #shorts-player veil CSS rule is installed', () => {
    enterShorts(SHORT_ID);
    buildActiveShort(SHORT_ID);
    injection = injectScript({ flashShieldV1: true });
    injection.probe.ensureFlashShieldStyle();

    const style = document.getElementById('mw-flash-shield');
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain('#shorts-player');
    expect(style!.textContent).toMatch(/ytm-reel-video-renderer\s+\[data-mw-veil="1"\]/);
  });

  it('does NOT veil when flag is OFF', () => {
    enterShorts(SHORT_ID);
    const { video } = buildActiveShort(SHORT_ID);
    injection = injectScript({ flashShieldV1: false });

    injection.probe.markFlashShieldShortsCandidate();

    expect(video.dataset.mwVeil).toBeUndefined();
  });
});

describe('GOLDEN: Shorts reveal-button heal (additive, idempotent)', () => {
  it('does NOT create a duplicate overlay when one already exists', () => {
    enterShorts(SHORT_ID);
    const { video } = buildActiveShort(SHORT_ID);
    injection = injectScript({ flashShieldV1: false });

    // Simulate a positive-blurred active Short that ALREADY has a reveal overlay.
    video.dataset.mwModerated = 'blurred';
    video.dataset.mwSrc = `https://i.ytimg.com/vi/${SHORT_ID}/hqdefault.jpg`;
    const existing = document.createElement('div');
    existing.className = 'mw-reveal-overlay';
    existing.dataset.mwFor = video.dataset.mwSrc;
    (existing as unknown as { __mwAnchorTarget: Element }).__mwAnchorTarget = video;
    video.parentElement!.appendChild(existing);

    const before = document.querySelectorAll('.mw-reveal-overlay').length;
    injection.probe.healShortsRevealOverlay('test');
    const after = document.querySelectorAll('.mw-reveal-overlay').length;

    expect(after).toBe(before); // no duplicate created
  });

  it('is a safe no-op when not in Shorts mode', () => {
    window.history.pushState({}, '', '/'); // not Shorts
    injection = injectScript({ flashShieldV1: false });
    expect(() => injection.probe.healShortsRevealOverlay('test')).not.toThrow();
  });
});
