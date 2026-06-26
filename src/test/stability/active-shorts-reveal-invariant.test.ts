import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';
const SECOND_ID = 'aBcD1234xyZ';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function setRect(el: HTMLElement, width = 360, height = 640): void {
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

function buildActiveShort(id: string): { frame: HTMLElement; video: HTMLVideoElement; src: string } {
  window.history.pushState({}, '', `https://m.youtube.com/shorts/${id}`);
  const player = document.createElement('div');
  player.id = 'shorts-player';
  const frame = document.createElement('ytm-reel-video-renderer') as HTMLElement;
  frame.setAttribute('selected', '');
  frame.setAttribute('data-video-id', id);
  const video = document.createElement('video') as HTMLVideoElement;
  const src = srcFor(id);
  video.setAttribute('src', src);
  video.setAttribute('poster', src);
  setRect(player);
  setRect(frame);
  setRect(video);
  frame.appendChild(video);
  player.appendChild(frame);
  document.body.appendChild(player);
  return { frame, video, src };
}

function revealOverlays(): HTMLElement[] {
  return Array.from(document.querySelectorAll('.mw-reveal-overlay')) as HTMLElement[];
}

function revealButton(): HTMLButtonElement | null {
  return document.querySelector('.mw-reveal-btn');
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

let injection: InjectionResult | undefined;
const describeOnYouTube = window.location.hostname === 'm.youtube.com' ? describe : describe.skip;

afterEach(() => {
  vi.useRealTimers();
  injection?.cleanup();
  injection = undefined;
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describeOnYouTube('Active Shorts blur/reveal invariant', () => {
  it('first-entry positive active Short gets blur and reveal on the same canonical target', () => {
    const { frame, video, src } = buildActiveShort(POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, src, 'porn', 40, POSITIVE_ID, 'classifier_positive');

    expect(frame.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(frame)).toBe(true);
    expect(revealButton()).not.toBeNull();
    expect(revealOverlays()).toHaveLength(1);
    expect(revealOverlays()[0].dataset.mwShortsOwnerToken).toBe(frame.dataset.mwShortsOwnerToken);
  });

  it('first-entry delayed owner/container exhaustion still ends with blur and reveal without health-heal', () => {
    const { frame, src } = buildActiveShort(POSITIVE_ID);
    injection = injectScript();

    frame.dataset.mwModerated = 'blurred';
    frame.dataset.mwSrc = src;
    frame.dataset.mwItemId = POSITIVE_ID;
    frame.style.setProperty('filter', 'blur(40px)', 'important');
    frame.classList.add('mw-blurred');

    const originalQuerySelector = document.querySelector.bind(document);
    const originalClosest = frame.closest;
    Object.defineProperty(frame, 'closest', {
      configurable: true,
      value: () => null,
    });
    const querySpy = vi.spyOn(document, 'querySelector').mockImplementation((selector: string) => {
      const selectorText = String(selector);
      if (
        selectorText.includes('#shorts-player') ||
        selectorText.includes('ytm-reel-video-renderer') ||
        selectorText === 'video'
      ) {
        return null;
      }
      return originalQuerySelector(selector);
    });
    try {
      for (let i = 0; i < 7; i += 1) {
        frame.dataset.mwOwnerDeferScheduled = 'false';
        injection.probe.createRevealOverlay(frame, src, 'porn', POSITIVE_ID, false);
      }
    } finally {
      querySpy.mockRestore();
      Object.defineProperty(frame, 'closest', {
        configurable: true,
        value: originalClosest,
      });
    }

    expect(frame.dataset.mwModerated).toBe('blurred');
    expect(frame.dataset.mwShortsOwnerToken || '').toContain('shorts_owner');
    expect(revealButton()).not.toBeNull();
    expect(revealOverlays()).toHaveLength(1);
    expect(revealOverlays()[0].dataset.mwShortsOwnerToken).toBe(frame.dataset.mwShortsOwnerToken);
  });

  it('video/poster swap keeps reveal anchored to the canonical active Shorts target', () => {
    const { frame, video, src } = buildActiveShort(POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, src, 'porn', 40, POSITIVE_ID, 'classifier_positive');
    video.setAttribute('poster', srcFor(SECOND_ID));
    video.setAttribute('src', srcFor(SECOND_ID));
    injection.probe.createRevealOverlay(frame, src, 'porn', POSITIVE_ID, false);

    expect(frame.dataset.mwModerated).toBe('blurred');
    expect(revealOverlays()).toHaveLength(1);
    expect(revealOverlays()[0].dataset.mwShortsOwnerToken).toBe(frame.dataset.mwShortsOwnerToken);
  });

  it('swipe replaces Short A reveal with Short B reveal and does not duplicate overlays', () => {
    const first = buildActiveShort(POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(first.video, first.src, 'porn', 40, POSITIVE_ID, 'classifier_positive');

    first.frame.remove();
    const second = buildActiveShort(SECOND_ID);
    injection.probe.applyBlur(second.video, second.src, 'porn', 40, SECOND_ID, 'classifier_positive');

    expect(revealOverlays()).toHaveLength(1);
    expect(revealOverlays()[0].dataset.mwShortsOwnerToken).toBe(second.frame.dataset.mwShortsOwnerToken);
  });

  it('owner-token churn does not hide the reveal of the Short that is still blurred', () => {
    const { frame, video, src } = buildActiveShort(POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, src, 'porn', 40, POSITIVE_ID, 'classifier_positive');

    const overlay = revealOverlays()[0];
    expect(overlay).toBeTruthy();

    // Simulate first-entry owner-token churn: the context re-resolved a different container
    // node, so the overlay now carries a token that no longer equals the live context token.
    // The anchor is still authoritatively blurred with matching content identity.
    overlay.dataset.mwShortsOwnerToken = 'shorts_owner|stale|churned|token';

    const kept = injection.probe.enforceRevealOverlayVisibilityGuard(overlay, frame, 'test_churn');

    expect(kept).toBe(true);
    expect(overlay.isConnected).toBe(true);
    expect(overlay.style.display).not.toBe('none');
    // Re-adopted to the anchor's live owner token rather than left stale.
    expect(overlay.dataset.mwShortsOwnerToken).toBe(frame.dataset.mwShortsOwnerToken);
    expect(revealButton()).not.toBeNull();
  });

  it('manual reveal is not re-blurred and does not create duplicate reveal overlays', () => {
    const { frame, video, src } = buildActiveShort(POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, src, 'porn', 40, POSITIVE_ID, 'classifier_positive');

    revealButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    injection.probe.applyBlur(frame, src, 'porn', 40, POSITIVE_ID, 'classifier_positive');

    expect(frame.dataset.mwModerated).toBe('revealed');
    expect(hasBlurFilter(frame)).toBe(false);
    expect(revealOverlays()).toHaveLength(0);
  });
});
