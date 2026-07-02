import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectScript, tick, type InjectionResult } from './harness';

const HOME_ID = 'dQw4w9WgXcQ';
const SHORTS_ID = 'aBcD1234xyZ';
const POSTER_ID = 'zYxW9876qwe';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  const wf = (el.style.getPropertyValue('-webkit-filter') || '').toLowerCase();
  const bf = (el.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
  return f.includes('blur(') || wf.includes('blur(') || bf.includes('blur(');
}

function revealOverlayCount(): number {
  return document.querySelectorAll('.mw-reveal-overlay').length;
}

function revealButton(): HTMLButtonElement | null {
  return document.querySelector('.mw-reveal-btn');
}

function buildMainFeedThumb(id: string): { card: HTMLElement; video: HTMLVideoElement; src: string } {
  const card = document.createElement('ytm-rich-item-renderer');
  const anchor = document.createElement('a');
  const src = srcFor(id);
  anchor.href = `/watch?v=${id}`;
  const video = document.createElement('video');
  video.src = src;
  video.poster = src;
  anchor.appendChild(video);
  card.appendChild(anchor);
  document.body.appendChild(card);
  return { card, video, src };
}

function buildShortsShelfThumb(id: string): { lockup: HTMLElement; video: HTMLVideoElement; src: string } {
  const lockup = document.createElement('ytm-shorts-lockup-view-model');
  const anchor = document.createElement('a');
  const src = srcFor(id);
  anchor.href = `/shorts/${id}`;
  const video = document.createElement('video');
  video.src = src;
  video.poster = src;
  anchor.appendChild(video);
  lockup.appendChild(anchor);
  document.body.appendChild(lockup);
  return { lockup, video, src };
}

function buildActiveShortThumb(id: string): { player: HTMLDivElement; frame: HTMLElement; video: HTMLVideoElement; src: string } {
  window.history.pushState({}, '', `https://m.youtube.com/shorts/${id}`);
  const src = srcFor(id);
  const player = document.createElement('div');
  player.id = 'shorts-player';
  const frame = document.createElement('ytm-reel-video-renderer');
  frame.setAttribute('selected', '');
  frame.setAttribute('aria-hidden', 'false');
  frame.setAttribute('is-active', '');
  const video = document.createElement('video');
  video.src = src;
  video.poster = src;
  frame.appendChild(video);
  player.appendChild(frame);
  document.body.appendChild(player);
  return { player, frame, video, src };
}

let injection: InjectionResult | undefined;

afterEach(() => {
  vi.useRealTimers();
  injection?.cleanup();
  injection = undefined;
  document.body.innerHTML = '';
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('ensureRevealForEveryBlurredNode guard', () => {
  it('repairs a home thumbnail reveal and keeps tap-to-reveal working', async () => {
    const { video, src } = buildMainFeedThumb(HOME_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, src, 'porn', 40, HOME_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();

    const repaired = injection.probe.ensureRevealForEveryBlurredNode('home_first_launch');

    expect(repaired).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButton()).not.toBeNull();
    expect(hasBlurFilter(video)).toBe(true);

    revealButton()!.click();
    await tick();

    expect(video.dataset.mwModerated).toBe('revealed');
    expect(hasBlurFilter(video)).toBe(false);
    expect(revealOverlayCount()).toBe(0);
  });

  it('repairs a Shorts shelf thumbnail reveal without creating duplicates', () => {
    const { video, src } = buildShortsShelfThumb(SHORTS_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, src, 'porn', 40, SHORTS_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();

    const firstRepair = injection.probe.ensureRevealForEveryBlurredNode('shorts_shelf');
    const secondRepair = injection.probe.ensureRevealForEveryBlurredNode('shorts_shelf_repeat');

    expect(firstRepair).toBe(true);
    expect(secondRepair).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButton()).not.toBeNull();

    revealButton()!.click();

    expect(video.dataset.mwModerated).toBe('revealed');
    expect(hasBlurFilter(video)).toBe(false);
    expect(revealOverlayCount()).toBe(0);
  });

  it('repairs a poster-style Shorts thumbnail reveal after overlay loss', () => {
    const { video, src } = buildShortsShelfThumb(POSTER_ID);
    injection = injectScript();

    video.dataset.poster = src;
    injection.probe.applyBlur(video, src, 'porn', 40, POSTER_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();

    const repaired = injection.probe.ensureRevealForEveryBlurredNode('poster_shorts');

    expect(repaired).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButton()).not.toBeNull();
    revealButton()!.click();
    expect(video.dataset.mwModerated).toBe('revealed');
    expect(hasBlurFilter(video)).toBe(false);
  });

  it('restores reveal after DOM replacement reparenting', () => {
    const { video, src } = buildMainFeedThumb(HOME_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, src, 'porn', 40, HOME_ID, 'classifier_positive');
    const overlay = document.querySelector('.mw-reveal-overlay');
    overlay?.remove();

    const replacementCard = document.createElement('ytm-rich-item-renderer');
    const replacementAnchor = document.createElement('a');
    replacementAnchor.href = `/watch?v=${HOME_ID}`;
    replacementAnchor.appendChild(video);
    replacementCard.appendChild(replacementAnchor);
    document.body.appendChild(replacementCard);

    const repaired = injection.probe.ensureRevealForEveryBlurredNode('dom_replacement');

    expect(repaired).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButton()).not.toBeNull();
  });

  it('repairs nodes inserted after the initial scan without duplicating overlays', () => {
    injection = injectScript();

    const { video, src } = buildMainFeedThumb(HOME_ID);
    injection.probe.applyBlur(video, src, 'porn', 40, HOME_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();

    const repaired = injection.probe.ensureRevealForEveryBlurredNode('mutation_burst');
    const repairedAgain = injection.probe.ensureRevealForEveryBlurredNode('mutation_burst_repeat');

    expect(repaired).toBe(true);
    expect(repairedAgain).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButton()).not.toBeNull();
  });

  it('keeps active Shorts reveal intact when the guard runs', () => {
    const { frame, video, src } = buildActiveShortThumb(HOME_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, src, 'porn', 40, HOME_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();

    const repaired = injection.probe.ensureRevealForEveryBlurredNode('active_shorts_reentry');

    expect(repaired).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButton()).not.toBeNull();
    expect(frame.dataset.mwShortsOwnerToken || '').not.toBe('');
  });

  it('stays inert in Off mode', () => {
    const { video, src } = buildMainFeedThumb(HOME_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, src, 'porn', 40, HOME_ID, 'classifier_positive');
    injection.probe.offModeCleanup('ensure_guard_off');

    const repaired = injection.probe.ensureRevealForEveryBlurredNode('off_mode');

    expect(repaired).toBe(false);
    expect(revealOverlayCount()).toBe(0);
    expect(revealButton()).toBeNull();
    expect(hasBlurFilter(video)).toBe(false);
  });
});
