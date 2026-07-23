import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';
const SAFE_ID = 'safe1234567';

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

function revealButtonCount(): number {
  return document.querySelectorAll('.mw-reveal-btn').length;
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('Phase 0 Off-mode cleanup', () => {
  it('Flash Shield live Off preserves finalized positive blur while removing Flash residue', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript({ enabled: true, flashShieldV1: true });
    const src = srcFor(POSITIVE_ID);

    const applied = injection.probe.applyFlashShieldPositive(video, src, 'porn', POSITIVE_ID);
    video.dataset.mwVeil = '1';
    video.dataset.mwFlashFrame = '1';
    video.dataset.mwFlashIdentity = `${POSITIVE_ID}|home`;
    video.dataset.mwFlashRetry = '1';

    expect(applied).toBe(true);
    expect(video.dataset.mwModerated).toBe('blurred');
    expect(video.dataset.mwHardBlur).toBe('1');
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);

    const result = (
      window as unknown as { __MW_FLASH_SHIELD_SET__?: (enabled: boolean) => string }
    ).__MW_FLASH_SHIELD_SET__?.(false);

    expect(result).toBe('OK');
    expect(video.dataset.mwFlashPositive).toBeUndefined();
    expect(video.dataset.mwVeil).toBeUndefined();
    expect(video.dataset.mwFlashFrame).toBeUndefined();
    expect(video.dataset.mwFlashIdentity).toBeUndefined();
    expect(video.dataset.mwFlashRetry).toBeUndefined();
    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
    expect(document.querySelector('[data-mw-veil="1"]')).toBeNull();
    expect(document.documentElement.classList.contains('mw-flash-shield-on')).toBe(false);
  });

  it('removes existing blur overlays, reveal buttons, veil artifacts, and partial blur', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    video.dataset.mwVeil = '1';

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);

    const result = injection.probe.offModeCleanup('test_off_cleanup');

    expect(result).toBe('OK_OFF_MODE_CLEANUP');
    expect(video.dataset.mwModerated).toBe('safe');
    expect(video.dataset.mwVeil).toBeUndefined();
    expect(video.classList.contains('mw-blurred')).toBe(false);
    expect(video.classList.contains('mw-softblur')).toBe(false);
    expect(hasBlurFilter(video)).toBe(false);
    expect(revealOverlayCount()).toBe(0);
    expect(revealButtonCount()).toBe(0);
    expect(document.querySelector('[data-mw-veil="1"]')).toBeNull();
  });

  it('removes active Shorts blur and reveal artifacts', () => {
    injection = injectScript();
    const frame = document.createElement('ytm-reel-video-renderer');
    const video = document.createElement('video');
    video.dataset.mwModerated = 'blurred';
    video.dataset.mwSrc = srcFor(POSITIVE_ID);
    video.dataset.mwHardBlur = '1';
    video.dataset.mwVeil = '1';
    video.classList.add('mw-blurred');
    video.style.setProperty('filter', 'blur(40px)', 'important');
    frame.dataset.mwFlashFrame = '1';
    frame.appendChild(video);
    document.body.appendChild(frame);

    const portal = document.createElement('div');
    portal.id = 'mw-reveal-portal';
    const overlay = document.createElement('div');
    overlay.className = 'mw-reveal-overlay';
    const button = document.createElement('button');
    button.className = 'mw-reveal-btn';
    overlay.appendChild(button);
    portal.appendChild(overlay);
    document.body.appendChild(portal);

    const flashOverlay = document.createElement('div');
    flashOverlay.className = 'mw-flash-shorts-overlay';
    frame.appendChild(flashOverlay);

    injection.probe.offModeCleanup('test_off_shorts_cleanup');

    expect(video.dataset.mwModerated).toBe('safe');
    expect(video.dataset.mwVeil).toBeUndefined();
    expect(frame.dataset.mwFlashFrame).toBeUndefined();
    expect(hasBlurFilter(video)).toBe(false);
    expect(document.querySelector('#mw-reveal-portal')).toBeNull();
    expect(document.querySelector('.mw-flash-shorts-overlay')).toBeNull();
  });

  it('Off to On restores normal positive blur/reveal without duplicates', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    injection.probe.offModeCleanup('test_off_before_on');

    expect(hasBlurFilter(video)).toBe(false);
    expect(revealOverlayCount()).toBe(0);

    injection.cleanup();
    const { video: restoredVideo } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(restoredVideo, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    injection.probe.applyBlur(restoredVideo, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    expect(restoredVideo.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(restoredVideo)).toBe(true);
    expect(revealOverlayCount()).toBe(1);
    expect(revealButtonCount()).toBe(1);
  });

  it('Off to On keeps negatives clean', () => {
    const { video } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();

    injection.probe.offModeCleanup('test_off_negative');
    injection.cleanup();
    injection = injectScript();

    expect(video.dataset.mwModerated || '').not.toBe('blurred');
    expect(video.classList.contains('mw-blurred')).toBe(false);
    expect(hasBlurFilter(video)).toBe(false);
    expect(revealOverlayCount()).toBe(0);
  });

  it('blocks late applyBlur after Off', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.offModeCleanup('test_off_before_late_apply');
    expect(injection.probe.isVisualModerationActive()).toBe(false);

    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    expect(video.dataset.mwModerated || '').not.toBe('blurred');
    expect(hasBlurFilter(video)).toBe(false);
    expect(revealOverlayCount()).toBe(0);
    expect(revealButtonCount()).toBe(0);
  });

  it('blocks late createRevealOverlay after Off even if stale blur state remains', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.offModeCleanup('test_off_before_late_reveal');
    video.dataset.mwModerated = 'blurred';
    video.dataset.mwSrc = srcFor(POSITIVE_ID);
    video.dataset.mwHardBlur = '1';

    injection.probe.createRevealOverlay(video, srcFor(POSITIVE_ID), 'porn', POSITIVE_ID);

    expect(revealOverlayCount()).toBe(0);
    expect(revealButtonCount()).toBe(0);
    expect(video.dataset.mwHasOverlay || '').not.toBe('true');
  });

  it('blocks mutation and fanout paths after Off', () => {
    const { card, video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    const src = srcFor(POSITIVE_ID);
    video.dataset.mwOrigPoster = src;

    injection.probe.offModeCleanup('test_off_before_mutation');
    injection.probe.queueMutationScan(card, 'test_mutation_after_off');
    injection.probe.findAndBlur(src, 'porn', 40, true, POSITIVE_ID);

    expect(video.dataset.mwModerated || '').not.toBe('blurred');
    expect(hasBlurFilter(video)).toBe(false);
    expect(revealOverlayCount()).toBe(0);
    expect(revealButtonCount()).toBe(0);
  });

  it('blocks legacy moderation results after Off', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    const src = srcFor(POSITIVE_ID);
    video.dataset.mwOrigPoster = src;

    injection.probe.offModeCleanup('test_off_before_legacy_result');
    window.__GC_SCAN_RESULTS__ = [{
      src,
      shouldBlur: true,
      category: 'porn',
      blurStrengthPx: 40,
    }];

    injection.probe.processLegacyResults();

    expect(window.__GC_SCAN_RESULTS__).toHaveLength(0);
    expect(video.dataset.mwModerated || '').not.toBe('blurred');
    expect(hasBlurFilter(video)).toBe(false);
    expect(revealOverlayCount()).toBe(0);
  });

  it('blocks active Shorts reveal recreation while Off', () => {
    window.history.pushState({}, '', 'https://m.youtube.com/shorts/dQw4w9WgXcQ');
    injection = injectScript();
    const frame = document.createElement('ytm-reel-video-renderer');
    frame.setAttribute('selected', '');
    const video = document.createElement('video');
    const src = srcFor(POSITIVE_ID);
    video.dataset.mwModerated = 'blurred';
    video.dataset.mwSrc = src;
    video.dataset.mwHardBlur = '1';
    video.style.setProperty('filter', 'blur(40px)', 'important');
    frame.appendChild(video);
    const player = document.createElement('div');
    player.id = 'shorts-player';
    player.appendChild(frame);
    document.body.appendChild(player);

    injection.probe.offModeCleanup('test_off_before_active_shorts_reveal');
    video.dataset.mwModerated = 'blurred';
    video.dataset.mwSrc = src;
    injection.probe.createRevealOverlay(video, src, 'porn', POSITIVE_ID, false);
    const scanned = injection.probe.scanActiveShortsPlayerContainer('test_after_off');

    expect(scanned).toBe(false);
    expect(revealOverlayCount()).toBe(0);
    expect(revealButtonCount()).toBe(0);
  });

  it('Off cleanup is idempotent', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    expect(injection.probe.offModeCleanup('test_off_idempotent_1')).toBe('OK_OFF_MODE_CLEANUP');
    expect(injection.probe.offModeCleanup('test_off_idempotent_2')).toBe('OK_OFF_MODE_CLEANUP');

    expect(video.dataset.mwModerated).toBe('safe');
    expect(hasBlurFilter(video)).toBe(false);
    expect(revealOverlayCount()).toBe(0);
    expect(revealButtonCount()).toBe(0);
  });
});
