import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const SAFE_ID = 'safe1234567';
const RISKY_ID = 'dQw4w9WgXcQ';
const OTHER_ID = 'other123456';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function previewSrcFor(id: string): string {
  return `https://rr1---sn.example.googlevideo.com/videoplayback?id=${id}`;
}

function setLargeRect(el: Element): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 320,
      height: 180,
      top: 0,
      left: 0,
      right: 320,
      bottom: 180,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

function appendPreviewVideo(parent: Element, id: string): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = previewSrcFor(id);
  video.poster = srcFor(id);
  setLargeRect(video);
  parent.appendChild(video);
  return video;
}

function appendThumbnailImage(parent: Element, id: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = srcFor(id);
  img.className = 'yt-core-image';
  setLargeRect(img);
  parent.appendChild(img);
  return img;
}

function revealOverlayCount(): number {
  return document.querySelectorAll('.mw-reveal-overlay').length;
}

function revealButtonCount(): number {
  return document.querySelectorAll('.mw-reveal-btn').length;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const filter = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return filter.includes('blur(');
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  document.body.innerHTML = '';
  window.history.pushState({}, '', '/');
});

describe('Homepage preview media replacement verdict continuity', () => {
  it('carries a safe homepage card verdict across static image to video preview replacement', () => {
    const { card, video, anchor } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();

    injection.probe.applyOwnedSafeCardClass(card, 'test_safe', SAFE_ID);
    video.remove();
    const preview = appendPreviewVideo(anchor ?? card, SAFE_ID);

    injection.probe.scanVideoPoster(preview);

    expect(preview.dataset.mwModerated).toBe('safe');
    expect(preview.dataset.mwVeil).toBeUndefined();
    expect(hasBlurFilter(preview)).toBe(false);
    expect(revealOverlayCount()).toBe(0);
  });

  it('keeps risky homepage card blur and reveal stable across preview media replacement', () => {
    const { card, video, anchor } = buildCard('ytm-rich-item-renderer', RISKY_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(RISKY_ID), 'porn', 40, RISKY_ID, 'classifier_positive');
    expect(revealOverlayCount()).toBe(1);

    video.remove();
    document.querySelectorAll('.mw-reveal-overlay').forEach((node) => node.remove());
    const preview = appendPreviewVideo(anchor ?? card, RISKY_ID);

    injection.probe.reapplyOwnedContainerBlurFromMutationNode(preview, 'test_preview_replacement');

    expect(preview.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(preview)).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
  });

  it('does not inherit a stale verdict when the logical card item changes', () => {
    const { card, video, anchor } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();

    injection.probe.applyOwnedSafeCardClass(card, 'test_safe', SAFE_ID);
    if (anchor) anchor.href = `/watch?v=${OTHER_ID}`;
    video.remove();
    const preview = appendPreviewVideo(anchor ?? card, OTHER_ID);

    const carried = injection.probe.applyKnownMainCardVerdictToMedia(preview, 'test_item_changed');

    expect(carried).toBe('');
    expect(preview.dataset.mwModerated).toBeUndefined();
    expect(preview.dataset.mwVeil).toBeUndefined();
    expect(hasBlurFilter(preview)).toBe(false);
  });

  it('does not Flash Shield re-veil a known safe replacement thumbnail', () => {
    const { card, video, anchor } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript({ flashShieldV1: true });

    injection.probe.applyOwnedSafeCardClass(card, 'test_safe', SAFE_ID);
    video.remove();
    const img = appendThumbnailImage(anchor ?? card, SAFE_ID);

    injection.probe.markFlashShieldCandidates(card);

    expect(img.dataset.mwModerated).toBe('safe');
    expect(img.dataset.mwVeil).toBeUndefined();
  });

  it('Off mode clears overlays, filters, reveal buttons, and veil state after replacement handling', () => {
    const { card, video, anchor } = buildCard('ytm-rich-item-renderer', RISKY_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(RISKY_ID), 'porn', 40, RISKY_ID, 'classifier_positive');
    video.remove();
    document.querySelectorAll('.mw-reveal-overlay').forEach((node) => node.remove());
    const preview = appendPreviewVideo(anchor ?? card, RISKY_ID);
    injection.probe.reapplyOwnedContainerBlurFromMutationNode(preview, 'test_preview_replacement');
    preview.dataset.mwVeil = '1';

    expect(hasBlurFilter(preview)).toBe(true);
    expect(revealOverlayCount()).toBe(1);

    const result = injection.probe.offModeCleanup('test_preview_off_cleanup');

    expect(result).toBe('OK_OFF_MODE_CLEANUP');
    expect(preview.dataset.mwVeil).toBeUndefined();
    expect(preview.dataset.mwModerated).toBe('safe');
    expect(hasBlurFilter(preview)).toBe(false);
    expect(revealOverlayCount()).toBe(0);
    expect(revealButtonCount()).toBe(0);
    expect(card.classList.contains('mw-owned-positive-card')).toBe(false);
    expect(card.classList.contains('mw-owned-safe-card')).toBe(false);
  });
});
