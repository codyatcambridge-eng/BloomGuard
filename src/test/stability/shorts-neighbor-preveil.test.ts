/**
 * Adjacent-Shorts pre-veil — closes the swipe-transition flash gap.
 *
 * The active-frame-only veil (P1-P4, shorts-veil-release.test.ts) only ever
 * covers the currently is-active/selected reel. YouTube pre-renders the
 * prev/next reel beside it, and that neighbor can become visible on screen
 * as the swipe transition slides it in, before its own is-active attribute
 * ever flips. This suite covers the additive fix: pre-veil the immediate
 * siblings of the active frame so nothing can flash unblurred mid-swipe,
 * with a clean hand-off to the existing (unmodified) active-frame logic
 * once a neighbor becomes active itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

function shortsUrl(id: string): string {
  return `https://m.youtube.com/shorts/${id}`;
}

interface ReelFixture {
  player: HTMLElement;
  prev: HTMLElement;
  active: HTMLElement;
  next: HTMLElement;
  prevVideo: HTMLVideoElement;
  activeVideo: HTMLVideoElement;
  nextVideo: HTMLVideoElement;
}

function buildReelWithNeighbors(activeId: string, prevId: string, nextId: string): ReelFixture {
  const player = document.createElement('div');
  player.id = 'shorts-player';

  function makeFrame(videoId: string, selected: boolean): { frame: HTMLElement; video: HTMLVideoElement } {
    const frame = document.createElement('ytm-reel-video-renderer');
    frame.setAttribute('data-video-id', videoId);
    if (selected) frame.setAttribute('selected', '');
    const video = document.createElement('video');
    video.setAttribute('poster', `https://i.ytimg.com/vi/${videoId}/oar2.jpg`);
    frame.appendChild(video);
    return { frame, video };
  }

  const prevPair = makeFrame(prevId, false);
  const activePair = makeFrame(activeId, true);
  const nextPair = makeFrame(nextId, false);

  player.appendChild(prevPair.frame);
  player.appendChild(activePair.frame);
  player.appendChild(nextPair.frame);
  document.body.appendChild(player);

  return {
    player,
    prev: prevPair.frame,
    active: activePair.frame,
    next: nextPair.frame,
    prevVideo: prevPair.video,
    activeVideo: activePair.video,
    nextVideo: nextPair.video,
  };
}

let injection: InjectionResult | null = null;

afterEach(() => {
  injection?.cleanup();
  injection = null;
  vi.useRealTimers();
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('Active Shorts: adjacent-frame pre-veil', () => {
  it('pre-veils the prev/next sibling videos when a Short becomes active', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { prevVideo, activeVideo, nextVideo } = buildReelWithNeighbors(
      'active-item',
      'prev-item',
      'next-item',
    );
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();

    expect(activeVideo.dataset.mwVeil).toBe('1');
    expect(prevVideo.dataset.mwVeil).toBe('1');
    expect(nextVideo.dataset.mwVeil).toBe('1');
  });

  it('never grants neighbors frame/overlay ownership — that stays exclusive to the active frame', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { prev, active, next } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();

    expect(active.dataset.mwFlashFrame).toBe('1');
    expect(prev.dataset.mwFlashFrame).toBeUndefined();
    expect(next.dataset.mwFlashFrame).toBeUndefined();
    expect(prev.querySelector('.mw-flash-shorts-overlay')).toBeNull();
    expect(next.querySelector('.mw-flash-shorts-overlay')).toBeNull();
  });

  it('an unresolved neighbor veil bounded-releases to timeout-safe', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { nextVideo } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    expect(nextVideo.dataset.mwVeil).toBe('1');
    expect(nextVideo.dataset.mwModerated).toBeUndefined();

    vi.advanceTimersByTime(4000);

    expect(nextVideo.dataset.mwModerated).toBe('timeout-safe');
  });

  it('works with the main blur dial disabled (Flash Shield independent of moderation)', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { nextVideo } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true, enabled: false, sensitivity: 0 });

    injection.probe.markFlashShieldShortsCandidate();
    expect(nextVideo.dataset.mwVeil).toBe('1');

    vi.advanceTimersByTime(4000);
    expect(nextVideo.dataset.mwModerated).toBe('timeout-safe');
  });

  it('swiping onto a still-veiled neighbor hands off to full active-frame ownership', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { next, nextVideo } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    injection = injectScript({ flashShieldV1: true });

    // Pre-veiled as a neighbor while 'active-item' is active.
    injection.probe.markFlashShieldShortsCandidate();
    expect(nextVideo.dataset.mwVeil).toBe('1');
    expect(next.dataset.mwFlashFrame).toBeUndefined();

    // Swipe settles: 'next-item' becomes the active frame.
    window.history.pushState({}, '', shortsUrl('next-item'));
    document.querySelector('[selected]')?.removeAttribute('selected');
    next.setAttribute('selected', '');
    injection.probe.markFlashShieldShortsCandidate();

    // Ownership handed off cleanly: still veiled, now the active frame owns it.
    expect(nextVideo.dataset.mwVeil).toBe('1');
    expect(next.dataset.mwFlashFrame).toBe('1');
    expect(next.querySelector('.mw-flash-shorts-overlay')).not.toBeNull();
  });

  it('swiping onto a neighbor that already timed out to safe does not re-veil it', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { next, nextVideo } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    vi.advanceTimersByTime(4000);
    expect(nextVideo.dataset.mwModerated).toBe('timeout-safe');

    window.history.pushState({}, '', shortsUrl('next-item'));
    document.querySelector('[selected]')?.removeAttribute('selected');
    next.setAttribute('selected', '');
    injection.probe.markFlashShieldShortsCandidate();

    expect(nextVideo.dataset.mwModerated).toBe('timeout-safe');
    expect(next.querySelector('.mw-flash-shorts-overlay')).toBeNull();
  });

  it('Flash Shield disabled never pre-veils neighbors', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { nextVideo, prevVideo } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    injection = injectScript({ flashShieldV1: false });

    injection.probe.markFlashShieldShortsCandidate();

    expect(nextVideo.dataset.mwVeil).toBeUndefined();
    expect(prevVideo.dataset.mwVeil).toBeUndefined();
  });
});
