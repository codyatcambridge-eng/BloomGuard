/**
 * Preview-transition identity continuity.
 *
 * YouTube swaps a thumbnail's src between the static asset
 * (https://i.ytimg.com/vi/<ID>/hq720.jpg) and the animated preview
 * (https://i.ytimg.com/an_webp/<ID>/mqdefault_6s.webp?du=3000). Both carry the
 * same videoId and MUST resolve to the same media identity — otherwise every
 * identity-gated guard (overlay identity match, blur authorization, hard-blur
 * stamp, owned-card reapply) treats the previewing thumbnail as foreign
 * content and the repair machinery cycles clear/recreate, producing the
 * visible blur pulse.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { injectScript, type InjectionResult } from './harness';

const VIDEO_ID = 'dQw4w9WgXcQ';

const STATIC_SRC = `https://i.ytimg.com/vi/${VIDEO_ID}/hq720.jpg`;
const STATIC_WEBP_SRC = `https://i.ytimg.com/vi_webp/${VIDEO_ID}/hq720.webp`;
const ANIMATED_SRC = `https://i.ytimg.com/an_webp/${VIDEO_ID}/mqdefault_6s.webp?du=3000`;

function buildImgCard(videoId: string): { card: HTMLElement; img: HTMLImageElement } {
  const card = document.createElement('ytm-rich-item-renderer');
  const anchor = document.createElement('a');
  anchor.href = `/watch?v=${videoId}`;
  const img = document.createElement('img');
  img.src = `https://i.ytimg.com/vi/${videoId}/hq720.jpg`;
  anchor.appendChild(img);
  card.appendChild(anchor);
  document.body.appendChild(card);
  return { card, img };
}

function hasHardBlur(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(') && el.dataset.mwModerated === 'blurred';
}

function moderationStyleText(): string {
  return document.getElementById('mw-moderation-styles')?.textContent || '';
}

function revealOverlayCount(): number {
  return document.querySelectorAll('.mw-reveal-overlay').length;
}

function runMaintenancePasses(injection: InjectionResult): void {
  // The passes that previously tore blur down on identity mismatch.
  injection.probe.ensureRevealForEveryBlurredNode('preview_transition_test');
  injection.probe.repairNonShortsBlurRevealInvariant('preview_transition_test');
  injection.probe.healNonShortsBlurredNodeReveal('preview_transition_test');
}

let injection: InjectionResult | null = null;

afterEach(() => {
  injection?.cleanup();
  injection = null;
  vi.useRealTimers();
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('preview transition identity continuity', () => {
  it('an_webp preview URLs resolve to the same identity as /vi/ and /vi_webp/', () => {
    injection = injectScript();
    const staticKey = injection.probe.getDiagItemKey(STATIC_SRC);
    expect(staticKey).toBe(VIDEO_ID);
    expect(injection.probe.getDiagItemKey(STATIC_WEBP_SRC)).toBe(VIDEO_ID);
    expect(injection.probe.getDiagItemKey(ANIMATED_SRC)).toBe(VIDEO_ID);
    expect(injection.probe.getYouTubeAssetVideoId(STATIC_SRC)).toBe(VIDEO_ID);
    expect(injection.probe.getYouTubeAssetVideoId(STATIC_WEBP_SRC)).toBe(VIDEO_ID);
    expect(injection.probe.getYouTubeAssetVideoId(ANIMATED_SRC)).toBe(VIDEO_ID);
  });

  it('static positive keeps hard blur when src swaps to the animated preview', () => {
    const { img } = buildImgCard(VIDEO_ID);
    injection = injectScript();
    injection.probe.applyBlur(img, STATIC_SRC, 'porn', 40, VIDEO_ID, 'classifier_positive');
    expect(hasHardBlur(img)).toBe(true);
    expect(revealOverlayCount()).toBe(1);

    img.src = ANIMATED_SRC;
    runMaintenancePasses(injection);

    expect(hasHardBlur(img)).toBe(true);
    expect(img.dataset.mwHardBlur).toBe('1');
    expect(revealOverlayCount()).toBe(1);
  });

  it('hard-blurred positive thumbnails are not filter-transition animated', () => {
    const { img } = buildImgCard(VIDEO_ID);
    injection = injectScript();
    injection.probe.applyBlur(img, STATIC_SRC, 'porn', 40, VIDEO_ID, 'classifier_positive');

    expect(hasHardBlur(img)).toBe(true);
    expect(img.dataset.mwHardBlur).toBe('1');
    expect(moderationStyleText()).toContain('[data-mw-moderated="blurred"][data-mw-hard-blur="1"]');
    expect(moderationStyleText()).toContain('transition: none !important');
    expect(moderationStyleText()).toContain('.mw-softblur');
    expect(moderationStyleText()).toContain('transition: filter 0.24s ease !important');
  });

  it('overlay survives the swap without an unnecessary rebuild', () => {
    const { img } = buildImgCard(VIDEO_ID);
    injection = injectScript();
    injection.probe.applyBlur(img, STATIC_SRC, 'porn', 40, VIDEO_ID, 'classifier_positive');
    const overlayBefore = document.querySelector('.mw-reveal-overlay');
    const overlayIdBefore = (overlayBefore as HTMLElement | null)?.dataset.mwOverlayId || '';
    expect(overlayIdBefore).not.toBe('');

    img.src = ANIMATED_SRC;
    runMaintenancePasses(injection);

    const overlayAfter = document.querySelector('.mw-reveal-overlay');
    expect(overlayAfter).not.toBeNull();
    // Same overlay element, not a torn-down-and-recreated replacement.
    expect((overlayAfter as HTMLElement).dataset.mwOverlayId).toBe(overlayIdBefore);
  });

  it('classifier re-verdict on the animated src keeps one overlay and authorized blur', () => {
    const { img } = buildImgCard(VIDEO_ID);
    injection = injectScript();
    injection.probe.applyBlur(img, STATIC_SRC, 'porn', 40, VIDEO_ID, 'classifier_positive');

    // Device chain: src swaps to the animated preview, the rescan classifies
    // the new src positive, and the verdict re-applies against that src —
    // restamping the node's identity from the animated URL.
    img.src = ANIMATED_SRC;
    injection.probe.applyBlur(img, ANIMATED_SRC, 'porn', 40, VIDEO_ID, 'classifier_positive');
    runMaintenancePasses(injection);

    // With identity intact, maintenance must keep the blur authorized and must
    // not tear down / duplicate the overlay.
    expect(hasHardBlur(img)).toBe(true);
    expect(img.dataset.mwHardBlur).toBe('1');
    expect(revealOverlayCount()).toBe(1);
    expect(document.querySelectorAll('.mw-reveal-btn').length).toBe(1);

    // And the reveal must still act on the thumbnail (identity chain intact).
    const btn = document.querySelector('.mw-reveal-btn') as HTMLElement | null;
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(img.dataset.mwModerated).not.toBe('blurred');
  });

  it('swap back from animated preview to static keeps blur and reveal', () => {
    const { img } = buildImgCard(VIDEO_ID);
    injection = injectScript();
    injection.probe.applyBlur(img, STATIC_SRC, 'porn', 40, VIDEO_ID, 'classifier_positive');

    img.src = ANIMATED_SRC;
    runMaintenancePasses(injection);
    img.src = STATIC_SRC;
    runMaintenancePasses(injection);

    expect(hasHardBlur(img)).toBe(true);
    expect(revealOverlayCount()).toBe(1);
  });

  it('ten rapid static/animated swap cycles leave exactly one overlay and no timer growth', () => {
    const { img } = buildImgCard(VIDEO_ID);
    injection = injectScript();
    injection.probe.applyBlur(img, STATIC_SRC, 'porn', 40, VIDEO_ID, 'classifier_positive');
    const timersBefore = injection.probe.countActiveTimerHandles();

    for (let i = 0; i < 10; i += 1) {
      img.src = ANIMATED_SRC;
      runMaintenancePasses(injection);
      img.src = STATIC_SRC;
      runMaintenancePasses(injection);
    }

    expect(hasHardBlur(img)).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(document.querySelectorAll('.mw-reveal-btn').length).toBe(1);
    expect(injection.probe.countActiveTimerHandles()).toBeLessThanOrEqual(timersBefore + 2);
  });

  it('reveal button remains attached and tappable after preview transitions', () => {
    const { img } = buildImgCard(VIDEO_ID);
    injection = injectScript();
    injection.probe.applyBlur(img, STATIC_SRC, 'porn', 40, VIDEO_ID, 'classifier_positive');

    img.src = ANIMATED_SRC;
    runMaintenancePasses(injection);
    img.src = STATIC_SRC;
    runMaintenancePasses(injection);

    const btn = document.querySelector('.mw-reveal-btn') as HTMLElement | null;
    expect(btn).not.toBeNull();
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    // Tap-to-reveal clears the blur on the anchored element.
    expect((img.style.filter || '').includes('blur(')).toBe(false);
    expect(img.dataset.mwModerated).not.toBe('blurred');
  });

  it('late safe verdict on the animated preview does not drop authoritative hard blur', () => {
    const { img } = buildImgCard(VIDEO_ID);
    injection = injectScript();
    injection.probe.applyBlur(img, STATIC_SRC, 'porn', 40, VIDEO_ID, 'classifier_positive');
    img.src = ANIMATED_SRC;

    // Classifier scores the motion frame as safe — must not unblur a
    // positively-owned item mid-preview.
    injection.probe.findAndBlur(ANIMATED_SRC, 'safe', 0, false, VIDEO_ID);
    runMaintenancePasses(injection);

    expect(hasHardBlur(img)).toBe(true);
    expect(img.dataset.mwHardBlur).toBe('1');
    expect(revealOverlayCount()).toBe(1);
  });
});
