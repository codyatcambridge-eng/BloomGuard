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

  it('first-entry Shorts exit to home leaves no soft or filter partial blur', () => {
    // Repro: first entry /shorts → back home → top thumbs fogged without reveal.
    const { video: top } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();
    // Simulate residual soft + filter from pre-exit home scan / heal race.
    top.dataset.mwModerated = 'softblur';
    top.classList.add('mw-softblur');
    top.style.setProperty('filter', 'blur(8px)', 'important');
    top.style.setProperty('-webkit-filter', 'blur(8px)', 'important');

    injection.probe.performShortsExitSurfaceCleanup('test_first_entry_exit_home');

    expect(hasBlurFilter(top)).toBe(false);
    expect(top.classList.contains('mw-softblur')).toBe(false);
    expect(document.querySelector('[data-mw-moderated="softblur"]')).toBeNull();
    expect(document.querySelector('.mw-reveal-btn')).toBeNull();
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

  it('exit clears main-surface feed Flash veils (blank bordered thumbs) without touching Shorts shell', () => {
    // Repro: leave Active Shorts → home cards have borders but white/empty content
    // from data-mw-veil + Flash CSS. Shorts player veil must not be stripped mid-session
    // via shell skip (here we only run cleanup on home URL with residual player).
    const { video: homeThumb } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    homeThumb.dataset.mwVeil = '1';
    homeThumb.removeAttribute('data-mw-moderated');

    const player = document.createElement('div');
    player.id = 'shorts-player';
    const frame = document.createElement('ytm-reel-video-renderer');
    frame.setAttribute('selected', '');
    const shortsMedia = document.createElement('video');
    shortsMedia.dataset.mwVeil = '1';
    frame.appendChild(shortsMedia);
    player.appendChild(frame);
    document.body.appendChild(player);

    injection = injectScript();
    injection.probe.performShortsExitSurfaceCleanup('test_exit_blank_thumbs_veil');

    // Feed thumb veil cleared (blank-thumb fix) — scrub + explicit feed clear.
    expect(homeThumb.dataset.mwVeil).toBeUndefined();

    // Re-veil (simulates heal restamp race) then exit again — must strip again.
    homeThumb.dataset.mwVeil = '1';
    injection.probe.performShortsExitSurfaceCleanup('test_exit_blank_thumbs_veil_2');
    expect(homeThumb.dataset.mwVeil).toBeUndefined();
  });

  it('exit clears scan-dedup stamp on verdict-less feed imgs so heal can re-score them', () => {
    // Release side of blank-thumbs: img stamped mwScanned=true with NO verdict is
    // skipped forever by scanImgElement dedup, so a re-stamped veil never releases
    // (white card until manual scroll). Exit must clear the stale dedup stamp.
    const makeFeedImg = (id: string): HTMLImageElement => {
      const card = document.createElement('ytm-rich-item-renderer');
      const img = document.createElement('img');
      img.src = srcFor(id);
      card.appendChild(img);
      document.body.appendChild(card);
      return img;
    };
    const verdictless = makeFeedImg(SAFE_ID);
    verdictless.dataset.mwScanned = 'true';
    verdictless.dataset.mwLastScanSrc = srcFor(SAFE_ID);

    // A scored img must keep its dedup stamp (no rescan storm on verdicts).
    const scored = makeFeedImg(POSITIVE_ID);
    scored.dataset.mwScanned = 'true';
    scored.dataset.mwLastScanSrc = srcFor(POSITIVE_ID);
    scored.dataset.mwModerated = 'safe';

    // Active Shorts shell img must be untouched.
    const player = document.createElement('div');
    player.id = 'shorts-player';
    const frame = document.createElement('ytm-reel-video-renderer');
    frame.setAttribute('selected', '');
    const shellImg = document.createElement('img');
    shellImg.dataset.mwScanned = 'true';
    frame.appendChild(shellImg);
    player.appendChild(frame);
    document.body.appendChild(player);

    injection = injectScript();
    injection.probe.performShortsExitSurfaceCleanup('test_exit_verdictless_dedup');

    expect(verdictless.dataset.mwScanned).toBeUndefined();
    expect(verdictless.dataset.mwLastScanSrc).toBeUndefined();
    expect(scored.dataset.mwScanned).toBe('true');
    expect(shellImg.dataset.mwScanned).toBe('true');
  });

  it('exit clears stale Shorts frame-capture hard blur on main-surface shelf videos', () => {
    // Repro: enter positive Short from shelf → reveal → exit. In-flight video-frame
    // verdict (data-URI src) hard-blurred the recycled shelf preview video on home.
    // Reveal fallback is scope-blocked for shelf videos → permanent frosted card.
    // Exit scrub must CLEAR this residue (not attempt reveal repair).
    const shelfCard = document.createElement('ytm-shorts-lockup-view-model');
    const shelfVideo = document.createElement('video');
    shelfVideo.dataset.mwModerated = 'blurred';
    shelfVideo.classList.add('mw-blurred');
    shelfVideo.dataset.mwHardBlur = '1';
    shelfVideo.dataset.mwSourceType = 'video-frame';
    shelfVideo.dataset.mwSrc = 'data:image/jpeg;base64,/9j/4AAQSkZJRg';
    shelfVideo.style.setProperty('filter', 'blur(40px)', 'important');
    shelfCard.appendChild(shelfVideo);
    document.body.appendChild(shelfCard);

    // Control: a regular hard positive img on home must keep blur (not swept up).
    const { video: regularPositive } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(
      regularPositive, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive'
    );
    expect(regularPositive.dataset.mwModerated).toBe('blurred');

    injection.probe.performShortsExitSurfaceCleanup('test_stale_frame_residue');

    // Shelf frost cleared, marked safe — no reveal repair attempted for it.
    expect(hasBlurFilter(shelfVideo)).toBe(false);
    expect(shelfVideo.classList.contains('mw-blurred')).toBe(false);
    expect(shelfVideo.dataset.mwModerated).toBe('safe');

    // Regular owned positive survives the exit scrub with blur + reveal intact.
    expect(regularPositive.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(regularPositive)).toBe(true);
    expect(document.querySelector('.mw-reveal-overlay')).not.toBeNull();
  });
});
