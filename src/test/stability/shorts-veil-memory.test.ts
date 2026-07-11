/**
 * E1/E2 — Active Shorts session verdict memory (no re-veil of known content).
 *
 * A Short this instance already resolved safe-class must never be re-veiled:
 * swipe-backs, recycled frames, and media-node swaps otherwise produce a
 * pointless ~100ms veil blip while the warm classifier re-confirms known
 * content. Positives are deliberately NOT remembered — a known-positive
 * revisit keeps its entry veil until hard blur re-establishes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

const SHORT_A = 'sRt5xYw12Ab';
const SHORT_B = 'nExTsHoRt99';

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
  return document.querySelectorAll(
    '.mw-flash-shorts-overlay:not([data-mw-veil-releasing="1"])',
  ).length;
}

/** Simulate a swipe: URL + recycled frame's id change, verdicts wiped by candidate. */
function swipeTo(fixture: ShortsFixture, injection: InjectionResult, id: string): void {
  window.history.pushState({}, '', shortsUrl(id));
  fixture.frame.setAttribute('data-video-id', id);
  injection.probe.markFlashShieldShortsCandidate();
}

let injection: InjectionResult | null = null;

afterEach(() => {
  injection?.cleanup();
  injection = null;
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('E1: session verdict memory prevents re-veil of known Shorts', () => {
  it('swiping back to a resolved-safe Short does not re-veil it', () => {
    window.history.pushState({}, '', shortsUrl(SHORT_A));
    const fixture = buildActiveShort(SHORT_A);
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    injection.probe.clearFlashShieldResolution(fixture.video, 'safe');
    expect(veilOverlayCount()).toBe(0);

    // Swipe away (B gets its own entry veil — correct)…
    swipeTo(fixture, injection, SHORT_B);
    expect(fixture.video.dataset.mwVeil).toBe('1');
    injection.probe.clearFlashShieldResolution(fixture.video, 'safe');

    // …and back to A: known content, must NOT be visibly re-veiled. (A stale
    // data-mw-veil attr may persist on the recycled node — it is CSS-inert
    // once the verdict is stamped; the visible layers are verdict + overlay.)
    swipeTo(fixture, injection, SHORT_A);
    expect(String(fixture.video.dataset.mwModerated || '')).toBe('safe');
    expect(veilOverlayCount()).toBe(0);
  });

  it('a media-node swap within a resolved Short does not re-veil it', () => {
    window.history.pushState({}, '', shortsUrl(SHORT_A));
    const fixture = buildActiveShort(SHORT_A);
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    injection.probe.clearFlashShieldResolution(fixture.video, 'safe');

    // YouTube swaps the media node (poster img -> attaching video).
    fixture.video.remove();
    const freshVideo = document.createElement('video');
    freshVideo.setAttribute('poster', `https://i.ytimg.com/vi/${SHORT_A}/oar2.jpg`);
    fixture.frame.appendChild(freshVideo);
    for (let i = 0; i < 5; i += 1) injection.probe.markFlashShieldShortsCandidate();

    expect(freshVideo.dataset.mwVeil).toBeUndefined();
    expect(veilOverlayCount()).toBe(0);
  });

  it('positives are not remembered: a known-positive revisit still gets its entry veil', () => {
    window.history.pushState({}, '', shortsUrl(SHORT_A));
    const fixture = buildActiveShort(SHORT_A);
    injection = injectScript({ flashShieldV1: true });

    const src = `https://i.ytimg.com/vi/${SHORT_A}/oar2.jpg`;
    injection.probe.markFlashShieldShortsCandidate();
    injection.probe.applyBlur(fixture.video, src, 'porn', 40, SHORT_A, 'classifier_positive');

    swipeTo(fixture, injection, SHORT_B);
    injection.probe.clearFlashShieldResolution(fixture.video, 'safe');
    swipeTo(fixture, injection, SHORT_A);

    // Protection first: the veil covers the known-positive revisit until the
    // classifier pipeline re-establishes hard blur.
    expect(fixture.video.dataset.mwVeil).toBe('1');
    expect(veilOverlayCount()).toBe(1);
  });

  it('memory is bounded (LRU, max 50)', () => {
    window.history.pushState({}, '', shortsUrl(SHORT_A));
    const fixture = buildActiveShort(SHORT_A);
    injection = injectScript({ flashShieldV1: true });

    for (let i = 0; i < 60; i += 1) {
      const id = 'memShort' + String(i).padStart(4, '0');
      swipeTo(fixture, injection, id);
      injection.probe.clearFlashShieldResolution(fixture.video, 'safe');
    }
    expect(injection.probe.getShortsVerdictMemorySize()).toBeLessThanOrEqual(50);
  });

  it('Off-mode cleanup clears the memory', () => {
    window.history.pushState({}, '', shortsUrl(SHORT_A));
    const fixture = buildActiveShort(SHORT_A);
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    injection.probe.clearFlashShieldResolution(fixture.video, 'safe');
    expect(injection.probe.getShortsVerdictMemorySize()).toBe(1);

    injection.probe.offModeCleanup('test_off');
    expect(injection.probe.getShortsVerdictMemorySize()).toBe(0);
  });
});
