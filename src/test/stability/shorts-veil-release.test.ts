/**
 * P2/P3 — Active Shorts veil release reliability.
 *
 * P2: a safe/timeout-safe verdict whose element was swapped out
 * mid-classification (reel recycle) must release the veil on the CURRENT
 * active frame — but only when the live frame's identity matches the dead
 * element's. A pending veil has no reveal path, so a missed release is a
 * full-screen blur the user cannot escape (AGENTS.md §2).
 *
 * P3: a veil that never resolves must time out to timeout-safe (bounded,
 * replace-on-rearm timer) so no live Short stays veiled forever.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

const SHORTS_ID = 'sRt5xYw12Ab';

function shortsUrl(id: string): string {
  return `https://m.youtube.com/shorts/${id}`;
}

interface ShortsFixture {
  player: HTMLElement;
  frame: HTMLElement;
  video: HTMLVideoElement;
}

function buildActiveShort(videoId: string): ShortsFixture {
  const player = document.createElement('div');
  player.id = 'shorts-player';
  const frame = document.createElement('ytm-reel-video-renderer');
  frame.setAttribute('selected', '');
  frame.setAttribute('data-video-id', videoId);
  const video = document.createElement('video');
  video.setAttribute('poster', `https://i.ytimg.com/vi/${videoId}/oar2.jpg`);
  frame.appendChild(video);
  player.appendChild(frame);
  document.body.appendChild(player);
  return { player, frame, video };
}

function veilOverlayCount(): number {
  return document.querySelectorAll('.mw-flash-shorts-overlay').length;
}

/** A classified node YouTube already swapped out of the reel (disconnected). */
function makeDeadClassifiedNode(identity: string): HTMLVideoElement {
  const dead = document.createElement('video');
  dead.dataset.mwFlashIdentity = identity;
  return dead;
}

let injection: InjectionResult | null = null;

afterEach(() => {
  injection?.cleanup();
  injection = null;
  vi.useRealTimers();
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('P2: disconnected-verdict live-frame fallback release', () => {
  it('safe verdict for a disconnected element releases the same-identity live frame', () => {
    window.history.pushState({}, '', shortsUrl(SHORTS_ID));
    const { frame, video } = buildActiveShort(SHORTS_ID);
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    expect(video.dataset.mwVeil).toBe('1');
    expect(veilOverlayCount()).toBe(1);

    const identity = injection.probe.getFlashShieldShortsIdentity(frame, video);
    const dead = makeDeadClassifiedNode(identity);
    injection.probe.clearFlashShieldResolution(dead, 'safe');

    // The live player must be released — no stuck full-screen veil.
    expect(String(video.dataset.mwModerated || frame.dataset.mwModerated || '')).toBe('safe');
    expect(video.dataset.mwVeil).toBeUndefined();
    expect(veilOverlayCount()).toBe(0);
    expect(injection.probe.getFlashReleaseCounters().flash_release_fallback_used).toBe(1);
  });

  it('identity-mismatched disconnected verdict does NOT release the live frame', () => {
    window.history.pushState({}, '', shortsUrl(SHORTS_ID));
    const { video } = buildActiveShort(SHORTS_ID);
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    expect(video.dataset.mwVeil).toBe('1');

    // Verdict belongs to a DIFFERENT Short — releasing the current one would
    // expose potentially unsafe content.
    const dead = makeDeadClassifiedNode('oThErShOrT99|oThErShOrT99');
    injection.probe.clearFlashShieldResolution(dead, 'safe');

    expect(video.dataset.mwVeil).toBe('1');
    expect(veilOverlayCount()).toBe(1);
    expect(String(video.dataset.mwModerated || '')).not.toBe('safe');
    expect(injection.probe.getFlashReleaseCounters().flash_release_missed_disconnected).toBe(1);
  });

  it('an already-resolved live frame is left alone by the fallback', () => {
    window.history.pushState({}, '', shortsUrl(SHORTS_ID));
    const { frame, video } = buildActiveShort(SHORTS_ID);
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    injection.probe.clearFlashShieldResolution(video, 'safe');
    const identity = injection.probe.getFlashShieldShortsIdentity(frame, video);

    const dead = makeDeadClassifiedNode(identity);
    injection.probe.clearFlashShieldResolution(dead, 'timeout-safe');

    // Verdict stays 'safe' (first resolution wins); fallback is a no-op.
    expect(String(video.dataset.mwModerated || frame.dataset.mwModerated || '')).toBe('safe');
  });
});

describe('P3: bounded veil timeout', () => {
  it('an unresolved veil times out to timeout-safe', () => {
    window.history.pushState({}, '', shortsUrl(SHORTS_ID));
    const { frame, video } = buildActiveShort(SHORTS_ID);
    // Fake timers BEFORE injection so init-time candidate bursts arm the
    // timeout under the fake clock.
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true });

    for (let i = 0; i < 10; i += 1) injection.probe.markFlashShieldShortsCandidate();
    expect(video.dataset.mwVeil).toBe('1');
    expect(injection.probe.getTimerSnapshot().shortsVeilTimeoutTimer).toBe(true);

    vi.advanceTimersByTime(4000);

    expect(video.dataset.mwModerated).toBe('timeout-safe');
    expect(frame.dataset.mwModerated).toBe('timeout-safe');
    expect(video.dataset.mwVeil).toBeUndefined();
    expect(veilOverlayCount()).toBe(0);
    expect(injection.probe.getTimerSnapshot().shortsVeilTimeoutTimer).toBe(false);
  });

  it('a resolved veil does not fire the timeout (no false release)', () => {
    window.history.pushState({}, '', shortsUrl(SHORTS_ID));
    const { video } = buildActiveShort(SHORTS_ID);
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    injection.probe.clearFlashShieldResolution(video, 'safe');
    vi.advanceTimersByTime(5000);

    expect(String(video.dataset.mwModerated || '')).toBe('safe');
  });

  it('repeated candidate churn keeps exactly one pending timeout timer', () => {
    window.history.pushState({}, '', shortsUrl(SHORTS_ID));
    buildActiveShort(SHORTS_ID);
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true });

    for (let i = 0; i < 25; i += 1) injection.probe.markFlashShieldShortsCandidate();
    expect(injection.probe.getTimerSnapshot().shortsVeilTimeoutTimer).toBe(true);
    vi.advanceTimersByTime(4000);
    expect(injection.probe.getTimerSnapshot().shortsVeilTimeoutTimer).toBe(false);
  });
});
