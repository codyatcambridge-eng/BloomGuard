import { afterEach, describe, expect, it } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';
const SECOND_ID = 'aBcD1234xyZ';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function revealOverlayCount(): number {
  return document.querySelectorAll('.mw-reveal-overlay').length;
}

function revealButtonCount(): number {
  return document.querySelectorAll('.mw-reveal-btn').length;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  const wf = (el.style.getPropertyValue('-webkit-filter') || '').toLowerCase();
  const bf = (el.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
  return f.includes('blur(') || wf.includes('blur(') || bf.includes('blur(');
}

function buildActiveShortsFrame(id: string): { player: HTMLDivElement; frame: HTMLElement; video: HTMLVideoElement; src: string } {
  const src = srcFor(id);
  const player = document.createElement('div');
  player.id = 'shorts-player';

  const frame = document.createElement('ytm-reel-video-renderer');
  frame.setAttribute('selected', '');
  frame.setAttribute('aria-hidden', 'false');

  const video = document.createElement('video');
  video.poster = src;
  frame.appendChild(video);
  player.appendChild(frame);
  document.body.appendChild(player);

  return { player, frame, video, src };
}

function stampBlurredShort(node: HTMLElement, src: string, itemId: string): void {
  node.dataset.mwModerated = 'blurred';
  node.dataset.mwSrc = src;
  node.dataset.mwCategory = 'porn';
  node.dataset.mwItemId = itemId;
  node.dataset.mwHardBlur = '1';
  node.dataset.mwHardBlurSrc = src;
  node.dataset.mwHardBlurItemKey = itemId;
  node.classList.add('mw-blurred');
  node.style.setProperty('filter', 'blur(40px)', 'important');
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
});

describe.skipIf(window.location.hostname !== 'm.youtube.com')('Active Shorts reveal heal', () => {
  it('creates exactly one reveal for an active Shorts blurred node missing reveal', () => {
    window.history.pushState({}, '', `/shorts/${POSITIVE_ID}`);
    const { video, src } = buildActiveShortsFrame(POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, src, 'porn', 40, POSITIVE_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();

    expect(document.querySelector('[data-mw-moderated="blurred"]')).not.toBeNull();
    expect(revealOverlayCount()).toBe(0);

    const healed = injection.probe.healActiveShortsBlurredNodeReveal('test_missing_reveal');

    expect(healed).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
  });

  it('does not duplicate an existing active Shorts reveal', () => {
    window.history.pushState({}, '', `/shorts/${POSITIVE_ID}`);
    const { video, src } = buildActiveShortsFrame(POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, src, 'porn', 40, POSITIVE_ID, 'classifier_positive');
    expect(revealOverlayCount()).toBe(1);

    const healed = injection.probe.healActiveShortsBlurredNodeReveal('test_existing_reveal');

    expect(healed).toBe(false);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
  });

  it('does nothing for a safe or unblurred active Short', () => {
    window.history.pushState({}, '', `/shorts/${SECOND_ID}`);
    injection = injectScript();
    document.querySelectorAll('.mw-reveal-overlay,#mw-reveal-portal').forEach((node) => node.remove());
    buildActiveShortsFrame(SECOND_ID);

    const overlaysBefore = revealOverlayCount();
    const buttonsBefore = revealButtonCount();

    const healed = injection.probe.healActiveShortsBlurredNodeReveal('test_safe_short');

    expect(healed).toBe(false);
    expect(revealOverlayCount()).toBe(overlaysBefore);
    expect(revealButtonCount()).toBe(buttonsBefore);
  });

  it('does nothing when protection is Off', () => {
    window.history.pushState({}, '', `/shorts/${POSITIVE_ID}`);
    const { frame, src } = buildActiveShortsFrame(POSITIVE_ID);
    injection = injectScript();

    injection.probe.offModeCleanup('test_off_before_heal');
    stampBlurredShort(frame, src, POSITIVE_ID);

    const healed = injection.probe.healActiveShortsBlurredNodeReveal('test_off');

    expect(healed).toBe(false);
    expect(revealOverlayCount()).toBe(0);
    expect(revealButtonCount()).toBe(0);
  });

  it('attaches reveal to the current live active Shorts node after a swap', () => {
    window.history.pushState({}, '', `/shorts/${POSITIVE_ID}`);
    const { player, frame: staleFrame, video, src } = buildActiveShortsFrame(POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, src, 'porn', 40, POSITIVE_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();
    staleFrame.remove();

    const liveFrame = document.createElement('ytm-reel-video-renderer');
    liveFrame.setAttribute('selected', '');
    liveFrame.setAttribute('aria-hidden', 'false');
    stampBlurredShort(liveFrame, src, POSITIVE_ID);
    player.appendChild(liveFrame);

    const healed = injection.probe.healActiveShortsBlurredNodeReveal('test_swap');
    const overlay = document.querySelector('.mw-reveal-overlay') as HTMLElement | null;

    expect(healed).toBe(true);
    expect(overlay).not.toBeNull();
    expect(overlay?.dataset.mwNodeId).toMatch(/^n\d+$/);
    expect(liveFrame.dataset.mwOverlayOwnerToken).toBe(overlay?.dataset.mwShortsOwnerToken);
    expect(liveFrame.dataset.mwShortsOwnerToken).toBe(overlay?.dataset.mwShortsOwnerToken);
    expect(liveFrame.dataset.mwShortsOwnerToken).toContain(`|${overlay?.dataset.mwNodeId}|`);
    expect(hasBlurFilter(liveFrame)).toBe(true);
    expect(revealOverlayCount()).toBe(1);
  });

  it('clears active Shorts blur residue without reveal when the Short was already revealed', () => {
    window.history.pushState({}, '', `/shorts/${POSITIVE_ID}`);
    const { frame, src } = buildActiveShortsFrame(POSITIVE_ID);
    injection = injectScript();

    injection.probe.markRevealedForSource(src, frame, 'test_manual_reveal');
    stampBlurredShort(frame, src, POSITIVE_ID);
    expect(hasBlurFilter(frame)).toBe(true);

    const healed = injection.probe.healActiveShortsBlurredNodeReveal('test_revealed_residue');

    expect(healed).toBe(true);
    expect(frame.dataset.mwModerated).toBe('revealed');
    expect(hasBlurFilter(frame)).toBe(false);
    expect(revealOverlayCount()).toBe(0);
    expect(revealButtonCount()).toBe(0);
  });
});
