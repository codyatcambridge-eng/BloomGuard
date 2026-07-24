/**
 * P1 — Active Shorts Flash Shield veil identity stability.
 *
 * The veil's identity must be stable for the lifetime of one active Short.
 * The media source (poster -> blob/stream, quality swaps) changes during
 * normal playback of the SAME Short; when it participated in the identity,
 * every source churn wiped the resolved verdict and re-veiled the player —
 * the full-screen blur flash ("about to flag a positive, then it drops").
 * Verdict wipes are only legitimate when the Shorts URL id actually changed
 * (a real swipe), and an already-resolved Short must never be re-covered.
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
  // Overlays mid-fade (data-mw-veil-releasing) are visually released.
  return document.querySelectorAll(
    '.mw-flash-shorts-overlay:not([data-mw-veil-releasing="1"])',
  ).length;
}

let injection: InjectionResult | null = null;

afterEach(() => {
  injection?.cleanup();
  injection = null;
  vi.useRealTimers();
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('P1: active Shorts veil identity stability', () => {
  it('veil identity is stable across media source churn within the same Short', () => {
    window.history.pushState({}, '', shortsUrl(SHORTS_ID));
    const { frame, video } = buildActiveShort(SHORTS_ID);
    injection = injectScript({ flashShieldV1: true });

    const identityBefore = injection.probe.getFlashShieldShortsIdentity(frame, video);
    // Normal playback churn: poster -> stream src -> different stream URL.
    video.setAttribute('src', 'blob:https://m.youtube.com/9d1c2f-stream');
    const identityAfterSrc = injection.probe.getFlashShieldShortsIdentity(frame, video);
    video.setAttribute('src', 'https://redirector.googlevideo.com/videoplayback?id=abc123');
    const identityAfterSwap = injection.probe.getFlashShieldShortsIdentity(frame, video);

    expect(identityAfterSrc).toBe(identityBefore);
    expect(identityAfterSwap).toBe(identityBefore);
  });

  it('a resolved safe verdict survives source churn — no verdict wipe, no re-veil', () => {
    window.history.pushState({}, '', shortsUrl(SHORTS_ID));
    const { frame, video } = buildActiveShort(SHORTS_ID);
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    expect(video.dataset.mwVeil).toBe('1');

    injection.probe.clearFlashShieldResolution(video, 'safe');
    vi.advanceTimersByTime(300);
    expect(String(video.dataset.mwModerated || frame.dataset.mwModerated || '')).toBe('safe');
    expect(veilOverlayCount()).toBe(0);

    // Mid-playback source churn + the aggressive candidate bursts.
    video.setAttribute('src', 'blob:https://m.youtube.com/1a2b3c-stream');
    for (let i = 0; i < 5; i += 1) injection.probe.markFlashShieldShortsCandidate();

    // Verdict intact and the player is not re-covered.
    expect(String(video.dataset.mwModerated || frame.dataset.mwModerated || '')).toBe('safe');
    expect(veilOverlayCount()).toBe(0);
  });

  it('swiping to a different Short still resets the verdict (URL id change)', () => {
    window.history.pushState({}, '', shortsUrl(SHORTS_ID));
    const { frame, video } = buildActiveShort(SHORTS_ID);
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    injection.probe.clearFlashShieldResolution(video, 'safe');

    // Simulate swipe: URL id changes; the recycled frame/media must be
    // re-evaluated, so the stale safe verdict is wiped and the veil returns.
    window.history.pushState({}, '', shortsUrl('nExTsHoRt99'));
    frame.setAttribute('data-video-id', 'nExTsHoRt99');
    injection.probe.markFlashShieldShortsCandidate();

    expect(String(video.dataset.mwModerated || '')).not.toBe('safe');
    expect(video.dataset.mwVeil).toBe('1');
    expect(veilOverlayCount()).toBe(1);
  });

  it('a positive Short keeps its verdict through source churn', () => {
    window.history.pushState({}, '', shortsUrl(SHORTS_ID));
    const { video } = buildActiveShort(SHORTS_ID);
    injection = injectScript({ flashShieldV1: true });

    const src = `https://i.ytimg.com/vi/${SHORTS_ID}/oar2.jpg`;
    injection.probe.applyBlur(video, src, 'porn', 40, SHORTS_ID, 'classifier_positive');
    // Shorts-mode applyBlur stamps the resolved stable target (frame/container).
    const blurredNode = document.querySelector('[data-mw-moderated="blurred"]') as HTMLElement | null;
    expect(blurredNode).not.toBeNull();

    video.setAttribute('src', 'blob:https://m.youtube.com/positive-stream');
    for (let i = 0; i < 5; i += 1) injection.probe.markFlashShieldShortsCandidate();

    // Identity drift within the same Short must not wipe the positive verdict.
    expect(blurredNode!.dataset.mwModerated).toBe('blurred');
  });

  it('repeated candidate churn leaves at most one overlay per frame', () => {
    window.history.pushState({}, '', shortsUrl(SHORTS_ID));
    const { video } = buildActiveShort(SHORTS_ID);
    injection = injectScript({ flashShieldV1: true });

    for (let i = 0; i < 20; i += 1) {
      injection.probe.markFlashShieldShortsCandidate();
      if (i === 9) video.setAttribute('src', 'blob:https://m.youtube.com/churn-stream');
    }
    expect(veilOverlayCount()).toBe(1);
  });
});
