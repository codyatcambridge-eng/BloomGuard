import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectScript, stampPositiveBlur, type InjectionResult } from './harness';

const HOME_ID = 'dQw4w9WgXcQ';
const SHORTS_ID = 'aBcD1234xyZ';
const POSTER_ID = 'zYxW9876qwe';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

function revealOverlayCount(): number {
  return document.querySelectorAll('.mw-reveal-overlay').length;
}

function revealButtonCount(): number {
  return document.querySelectorAll('.mw-reveal-btn').length;
}

function setRect(el: HTMLElement, width = 320, height = 180): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }),
  });
}

function overrideIsConnected(el: Element, connected: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(el, 'isConnected');
  Object.defineProperty(el, 'isConnected', {
    configurable: true,
    get: () => connected,
  });
  return () => {
    if (original) {
      Object.defineProperty(el, 'isConnected', original);
      return;
    }
    delete (el as Record<string, unknown>).isConnected;
  };
}

function buildDetachedHomeThumb(id: string): { card: HTMLElement; video: HTMLVideoElement } {
  const card = document.createElement('ytm-rich-item-renderer') as HTMLElement;
  const anchor = document.createElement('a');
  anchor.href = `/watch?v=${id}`;
  const video = document.createElement('video') as HTMLVideoElement;
  const src = srcFor(id);
  video.src = src;
  video.poster = src;
  anchor.appendChild(video);
  card.appendChild(anchor);
  setRect(card);
  setRect(video);
  return { card, video };
}

function buildDetachedShortsShelfThumb(id: string): { lockup: HTMLElement; video: HTMLVideoElement } {
  const lockup = document.createElement('ytm-shorts-lockup-view-model') as HTMLElement;
  const anchor = document.createElement('a');
  anchor.href = `/shorts/${id}`;
  const video = document.createElement('video') as HTMLVideoElement;
  const src = srcFor(id);
  video.src = src;
  video.poster = src;
  lockup.dataset.mwShortsShelfOwned = '1';
  lockup.dataset.mwShortsShelfItemKey = id;
  lockup.dataset.mwShortsShelfAt = String(Date.now());
  anchor.appendChild(video);
  lockup.appendChild(anchor);
  setRect(lockup);
  setRect(video);
  return { lockup, video };
}

function buildDetachedPosterThumb(id: string): { lockup: HTMLElement; video: HTMLVideoElement } {
  const lockup = document.createElement('ytm-shorts-lockup-view-model') as HTMLElement;
  const anchor = document.createElement('a');
  anchor.href = `/shorts/${id}`;
  const video = document.createElement('video') as HTMLVideoElement;
  const src = srcFor(id);
  video.src = src;
  video.poster = src;
  video.dataset.poster = src;
  lockup.dataset.mwShortsShelfOwned = '1';
  lockup.dataset.mwShortsShelfItemKey = id;
  lockup.dataset.mwShortsShelfAt = String(Date.now());
  anchor.appendChild(video);
  lockup.appendChild(anchor);
  setRect(lockup);
  setRect(video);
  return { lockup, video };
}

let injection: InjectionResult | undefined;

afterEach(() => {
  vi.useRealTimers();
  injection?.cleanup();
  injection = undefined;
  document.body.innerHTML = '';
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('Reveal repair retry', () => {
  it('repairs a home thumbnail reveal after the node becomes connected', async () => {
    vi.useFakeTimers();
    const { card, video } = buildDetachedHomeThumb(HOME_ID);
    injection = injectScript();

    document.body.appendChild(card);
    stampPositiveBlur(video, HOME_ID);
    const restore = overrideIsConnected(video, false);
    injection.probe.scheduleRevealOverlayRepair(video, srcFor(HOME_ID), 'porn', HOME_ID, 'home_initial_miss');
    restore();

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(revealOverlayCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(1100);

    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
    expect(hasBlurFilter(video)).toBe(true);
  });

  it('repairs a Shorts shelf reveal after the node becomes connected', async () => {
    const { lockup, video } = buildDetachedShortsShelfThumb(SHORTS_ID);
    injection = injectScript();

    document.body.appendChild(lockup);
    stampPositiveBlur(video, SHORTS_ID);
    const restore = overrideIsConnected(video, false);
    restore();

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(revealOverlayCount()).toBe(0);

    const repaired = injection.probe.ensureRevealForEveryBlurredNode('shorts_shelf_repair');

    expect(repaired).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
    expect(hasBlurFilter(video)).toBe(true);
  });

  it('repairs a poster-style Shorts thumbnail reveal after the node becomes connected', async () => {
    const { lockup, video } = buildDetachedPosterThumb(POSTER_ID);
    injection = injectScript();

    document.body.appendChild(lockup);
    stampPositiveBlur(video, POSTER_ID);
    const restore = overrideIsConnected(video, false);
    restore();

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(revealOverlayCount()).toBe(0);

    const repaired = injection.probe.ensureRevealForEveryBlurredNode('poster_repair');

    expect(repaired).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
    expect(hasBlurFilter(video)).toBe(true);
  });

  it('restores reveal after the blurred thumbnail is moved to a replacement parent', async () => {
    const { card, video } = buildDetachedHomeThumb(HOME_ID);
    injection = injectScript();

    document.body.appendChild(card);
    stampPositiveBlur(video, HOME_ID);
    const firstRestore = overrideIsConnected(video, false);
    firstRestore();
    injection.probe.ensureRevealForEveryBlurredNode('replacement_initial_miss');

    expect(revealOverlayCount()).toBe(1);
    document.querySelector('.mw-reveal-overlay')?.remove();

    const replacementCard = document.createElement('ytm-rich-item-renderer') as HTMLElement;
    const replacementAnchor = document.createElement('a');
    replacementAnchor.href = `/watch?v=${HOME_ID}`;
    replacementAnchor.appendChild(video);
    replacementCard.appendChild(replacementAnchor);
    document.body.appendChild(replacementCard);

    injection.probe.ensureRevealForEveryBlurredNode('replacement_repair');

    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
  });

  it('does not duplicate reveal controls on repeated repair passes', async () => {
    const { card, video } = buildDetachedHomeThumb(HOME_ID);
    injection = injectScript();

    document.body.appendChild(card);
    stampPositiveBlur(video, HOME_ID);
    const restore = overrideIsConnected(video, false);
    restore();

    injection.probe.ensureRevealForEveryBlurredNode('duplicate_pass_1');

    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);

    injection.probe.ensureRevealForEveryBlurredNode('duplicate_pass_2');

    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
  });
});
