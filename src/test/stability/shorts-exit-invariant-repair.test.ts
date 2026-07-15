import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';
const SAFE_ID = 'safe1234567';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('Shorts exit blur/reveal invariant repair', () => {
  it('clears non-positive BloomGuard blur residue on home thumbnails', () => {
    const { video } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();

    video.dataset.mwVeil = '1';
    video.dataset.mwModerated = 'softblur';
    video.classList.add('mw-softblur');
    video.style.setProperty('filter', 'blur(12px)', 'important');

    injection.probe.repairNonShortsBlurRevealInvariant('test_leave_shorts');

    expect(video.dataset.mwVeil).toBeUndefined();
    expect(video.dataset.mwModerated).toBe('safe');
    expect(video.classList.contains('mw-softblur')).toBe(false);
    expect(hasBlurFilter(video)).toBe(false);
    expect(document.querySelector('.mw-reveal-overlay')).toBeNull();
  });

  it('preserves an authorized positive blur and recreates its reveal overlay', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    document.querySelector('.mw-reveal-overlay')?.remove();

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-overlay')).toBeNull();

    injection.probe.repairNonShortsBlurRevealInvariant('test_leave_shorts');

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();
  });

  it('exit cleanup clears filter-only partial blur without softblur class', () => {
    // Repro: exit leaves style filter blur(8px) without mw-softblur (partial stamp).
    const { video } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();
    video.style.setProperty('filter', 'blur(8px)', 'important');
    video.style.setProperty('-webkit-filter', 'blur(8px)', 'important');
    // Intentionally no softblur class / moderated stamp.
    expect(hasBlurFilter(video)).toBe(true);

    injection.probe.performShortsExitSurfaceCleanup('test_filter_only_partial');

    expect(hasBlurFilter(video)).toBe(false);
    expect(document.querySelector('.mw-reveal-btn')).toBeNull();
  });

  it('exit cleanup clears top-row soft partial blur and suppresses re-soft on heal scan', () => {
    // Reproduces: leave Active Shorts → home top thumbs get softblur (8px) without reveal.
    const { video: top1 } = buildCard('ytm-rich-item-renderer', 'TopSoftExit01');
    const { video: top2 } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();

    // Simulate soft pre-blur residue from a post-exit rediscovery scan (no reveal).
    for (const video of [top1, top2]) {
      video.dataset.mwModerated = 'softblur';
      video.classList.add('mw-softblur');
      video.style.setProperty('filter', 'blur(8px)', 'important');
      video.dataset.mwSrc = video.src;
    }
    expect(hasBlurFilter(top1)).toBe(true);
    expect(document.querySelector('.mw-reveal-btn')).toBeNull();

    injection.probe.performShortsExitSurfaceCleanup('test_exit_partial_soft');

    expect(hasBlurFilter(top1)).toBe(false);
    expect(hasBlurFilter(top2)).toBe(false);
    expect(top1.classList.contains('mw-softblur')).toBe(false);
    expect(top2.classList.contains('mw-softblur')).toBe(false);
    // No reveal-less partial blur left on the top row.
    expect(document.querySelector('[data-mw-moderated="softblur"]')).toBeNull();
  });

  it('home feed heal after exit does not re-paint soft partial blur while suppressed', () => {
    const { video } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();
    video.dataset.mwModerated = 'softblur';
    video.classList.add('mw-softblur');
    video.style.setProperty('filter', 'blur(8px)', 'important');

    injection.probe.performShortsExitSurfaceCleanup('test_suppress_then_heal');
    const heal = (window as unknown as { __MW_HOME_FEED_HEAL__?: (r: string) => string })
      .__MW_HOME_FEED_HEAL__;
    expect(typeof heal).toBe('function');
    heal!('test_heal_no_partial');

    // Soft residue must stay gone (suppress window + force clear in heal).
    expect(hasBlurFilter(video)).toBe(false);
    expect(video.classList.contains('mw-softblur')).toBe(false);
  });

  it('clears stuck Shorts flash overlay + player residue that white-screen home after exit', () => {
    // Simulate YouTube keeping #shorts-player mounted under home after exit.
    const player = document.createElement('div');
    player.id = 'shorts-player';
    const frame = document.createElement('ytm-reel-video-renderer');
    frame.setAttribute('selected', '');
    frame.dataset.mwFlashFrame = '1';
    const video = document.createElement('video');
    video.dataset.mwVeil = '1';
    video.dataset.mwModerated = 'blurred';
    video.classList.add('mw-blurred');
    video.style.setProperty('filter', 'blur(40px)', 'important');
    const flashOverlay = document.createElement('div');
    flashOverlay.className = 'mw-flash-shorts-overlay';
    flashOverlay.style.cssText = 'position:absolute;inset:0;z-index:9999;background:rgba(255,255,255,0.8)';
    frame.appendChild(video);
    frame.appendChild(flashOverlay);
    player.appendChild(frame);
    document.body.appendChild(player);

    // Full-page inject overlay stuck enabled (frosted white screen).
    const pageOverlay = document.createElement('div');
    pageOverlay.id = 'mw-blur-overlay';
    pageOverlay.className = 'mw-enabled';
    pageOverlay.style.cssText = 'position:fixed;inset:0;opacity:1;display:block';
    document.body.appendChild(pageOverlay);

    // Portal reveal leftover from active Shorts.
    const portal = document.createElement('div');
    portal.id = 'mw-reveal-portal';
    const portalOv = document.createElement('div');
    portalOv.className = 'mw-reveal-overlay';
    portal.appendChild(portalOv);
    document.documentElement.appendChild(portal);

    injection = injectScript();
    // URL is home (harness default) — exit cleanup should run for still-mounted player.
    const result = injection.probe.performShortsExitSurfaceCleanup('test_white_screen_exit');

    expect(result.removedFlashOverlays).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.mw-flash-shorts-overlay')).toBeNull();
    expect(video.dataset.mwVeil).toBeUndefined();
    expect(frame.dataset.mwFlashFrame).toBeUndefined();
    expect(hasBlurFilter(video)).toBe(false);
    expect(pageOverlay.classList.contains('mw-enabled')).toBe(false);
    expect(portal.querySelector('.mw-reveal-overlay')).toBeNull();
  });
});
