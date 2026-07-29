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
  prevVideo: HTMLVideoElement | null;
  activeVideo: HTMLVideoElement;
  nextVideo: HTMLVideoElement | null;
}

function buildReelWithNeighbors(
  activeId: string,
  prevId: string,
  nextId: string,
  options?: { prevMedia?: boolean; nextMedia?: boolean },
): ReelFixture {
  const player = document.createElement('div');
  player.id = 'shorts-player';

  function makeFrame(videoId: string, selected: boolean, withMedia = true): { frame: HTMLElement; video: HTMLVideoElement | null } {
    const frame = document.createElement('ytm-reel-video-renderer');
    frame.setAttribute('data-video-id', videoId);
    if (selected) frame.setAttribute('selected', '');
    const video = withMedia ? document.createElement('video') : null;
    if (video) {
      video.setAttribute('poster', `https://i.ytimg.com/vi/${videoId}/oar2.jpg`);
      frame.appendChild(video);
    }
    return { frame, video };
  }

  const prevPair = makeFrame(prevId, false, options?.prevMedia !== false);
  const activePair = makeFrame(activeId, true);
  const nextPair = makeFrame(nextId, false, options?.nextMedia !== false);

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
    activeVideo: activePair.video as HTMLVideoElement,
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
    const { prev, active, next, prevVideo, activeVideo, nextVideo } = buildReelWithNeighbors(
      'active-item',
      'prev-item',
      'next-item',
    );
    injection = injectScript({ flashShieldV1: true });

    expect(injection.probe.isShortsModeActive()).toBe(true);
    const activeFrame = injection.probe.getFlashShieldActiveShortsFrame();
    expect(activeFrame).toBe(active);
    expect(injection.probe.getFlashShieldNeighborShortsFrames(activeFrame)).toEqual([prev, next]);
    injection.probe.markFlashShieldShortsCandidate();

    expect(activeVideo.dataset.mwVeil).toBe('1');
    expect(prevVideo?.dataset.mwVeil).toBe('1');
    expect(nextVideo?.dataset.mwVeil).toBe('1');
  });

  it('gives neighbors a non-owner frame dampener without active ownership', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { prev, active, next } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();

    expect(active.dataset.mwFlashFrame).toBe('1');
    expect(prev.dataset.mwFlashFrame).toBeUndefined();
    expect(next.dataset.mwFlashFrame).toBeUndefined();
    expect(prev.dataset.mwNeighborVeil).toBe('1');
    expect(next.dataset.mwNeighborVeil).toBe('1');
    expect((prev.querySelector('.mw-flash-shorts-overlay') as HTMLElement | null)?.dataset.mwNeighborDampener).toBe('1');
    expect((next.querySelector('.mw-flash-shorts-overlay') as HTMLElement | null)?.dataset.mwNeighborDampener).toBe('1');
    expect((prev.querySelector('.mw-flash-shorts-overlay') as HTMLElement | null)?.dataset.mwActiveDampener).toBeUndefined();
    expect((next.querySelector('.mw-flash-shorts-overlay') as HTMLElement | null)?.dataset.mwActiveDampener).toBeUndefined();
  });

  it('pre-veils neighbor frames before their media pixels exist', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { next } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item', {
      nextMedia: false,
    });
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();

    const overlay = next.querySelector('.mw-flash-shorts-overlay') as HTMLElement | null;
    expect(next.dataset.mwNeighborVeil).toBe('1');
    expect(overlay).not.toBeNull();
    expect(overlay?.dataset.mwNeighborDampener).toBe('1');

    vi.advanceTimersByTime(1200);

    expect(next.dataset.mwModerated).toBe('timeout-safe');
    expect(next.dataset.mwNeighborVeil).toBeUndefined();
    expect(overlay?.dataset.mwVeilReleasing).toBe('1');
  });

  it('an unresolved neighbor veil bounded-releases to timeout-safe', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { nextVideo } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    expect(nextVideo?.dataset.mwVeil).toBe('1');
    expect(nextVideo?.dataset.mwModerated).toBeUndefined();
    const overlay = document.querySelector('.mw-flash-shorts-overlay[data-mw-neighbor-dampener="1"]') as HTMLElement | null;
    expect(overlay).not.toBeNull();

    vi.advanceTimersByTime(1200);

    expect(nextVideo?.dataset.mwModerated).toBe('timeout-safe');
    expect(overlay?.dataset.mwVeilReleasing).toBe('1');
  });

  it('works with the main blur dial disabled (Flash Shield independent of moderation)', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { nextVideo } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true, enabled: false, sensitivity: 0 });

    injection.probe.markFlashShieldShortsCandidate();
    expect(nextVideo?.dataset.mwVeil).toBe('1');

    vi.advanceTimersByTime(1200);
    expect(nextVideo?.dataset.mwModerated).toBe('timeout-safe');
  });

  it('swiping onto a still-veiled neighbor hands off to full active-frame ownership', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { next, nextVideo } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    injection = injectScript({ flashShieldV1: true });

    // Pre-veiled as a neighbor while 'active-item' is active.
    injection.probe.markFlashShieldShortsCandidate();
    expect(nextVideo?.dataset.mwVeil).toBe('1');
    expect(next.dataset.mwFlashFrame).toBeUndefined();
    expect((next.querySelector('.mw-flash-shorts-overlay') as HTMLElement | null)?.dataset.mwNeighborDampener).toBe('1');

    // Swipe settles: 'next-item' becomes the active frame.
    window.history.pushState({}, '', shortsUrl('next-item'));
    document.querySelector('[selected]')?.removeAttribute('selected');
    next.setAttribute('selected', '');
    injection.probe.markFlashShieldShortsCandidate();

    // Ownership handed off cleanly: still veiled, now the active frame owns it.
    expect(nextVideo?.dataset.mwVeil).toBe('1');
    expect(next.dataset.mwFlashFrame).toBe('1');
    expect((next.querySelector('.mw-flash-shorts-overlay') as HTMLElement | null)?.dataset.mwActiveDampener).toBe('1');
    expect((next.querySelector('.mw-flash-shorts-overlay') as HTMLElement | null)?.dataset.mwNeighborDampener).toBeUndefined();
  });

  it('swiping onto a neighbor that already timed out to safe gets a fresh active dampener', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { next, nextVideo } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    vi.useFakeTimers();
    injection = injectScript({ flashShieldV1: true });

    injection.probe.markFlashShieldShortsCandidate();
    vi.advanceTimersByTime(1200);
    expect(nextVideo?.dataset.mwModerated).toBe('timeout-safe');

    window.history.pushState({}, '', shortsUrl('next-item'));
    document.querySelector('[selected]')?.removeAttribute('selected');
    next.setAttribute('selected', '');
    injection.probe.markFlashShieldShortsCandidate();

    expect(nextVideo?.dataset.mwModerated).toBeUndefined();
    expect(nextVideo?.dataset.mwVeil).toBe('1');
    expect(next.dataset.mwFlashFrame).toBe('1');
    expect(next.dataset.mwActiveDampenedIdentity).toBe('next-item|next-item');
    const activeOverlay = Array.from(next.querySelectorAll('.mw-flash-shorts-overlay')).find(
      (overlay) => (overlay as HTMLElement).dataset.mwVeilReleasing !== '1',
    ) as HTMLElement | undefined;
    expect(activeOverlay?.dataset.mwActiveDampener).toBe('1');
  });

  it('Flash Shield disabled never pre-veils neighbors', () => {
    window.history.pushState({}, '', shortsUrl('active-item'));
    const { nextVideo, prevVideo } = buildReelWithNeighbors('active-item', 'prev-item', 'next-item');
    injection = injectScript({ flashShieldV1: false });

    injection.probe.markFlashShieldShortsCandidate();

    expect(nextVideo?.dataset.mwVeil).toBeUndefined();
    expect(prevVideo?.dataset.mwVeil).toBeUndefined();
  });
});
