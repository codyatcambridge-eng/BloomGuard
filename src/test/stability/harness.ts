/**
 * Stability test harness — no production code is modified here.
 *
 * Provides:
 *  - Selector constants replicated from production (sacred read-only copies)
 *  - Pure-function replication of getMvpCardHrefItemKey for isolated unit tests
 *  - DOM fixture builders
 *  - Script injection with a test-only probe that exposes internal functions
 */

import { vi } from 'vitest';
import { generateModerationScript, type InjectionConfig } from '@/lib/webview-injection-script';

// ---------------------------------------------------------------------------
// Sacred selector constants — replicated from production lines 2969-2987.
// If this list diverges from production, T1 tests will catch it.
// ---------------------------------------------------------------------------

export const CARD_SELECTOR_PARTS = [
  'ytm-rich-item-renderer',
  'ytm-video-with-context-renderer',
  'ytm-compact-video-renderer',
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  '#content',
] as const;

export type KnownRendererTag = (typeof CARD_SELECTOR_PARTS)[number];

export const NON_SHORTS_REATTACH_CARD_SELECTOR = CARD_SELECTOR_PARTS.join(',');

export const NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR = CARD_SELECTOR_PARTS
  .filter((t): t is Exclude<KnownRendererTag, '#content'> => t !== '#content')
  .join(',');

// ---------------------------------------------------------------------------
// Pure function replication of getMvpCardHrefItemKey (production lines 3087-3115).
// Used by T1/T2 without injecting the full script.
// ---------------------------------------------------------------------------

export function extractHrefItemKey(card: Element): string {
  if (!card || card.nodeType !== 1 || typeof card.querySelector !== 'function') return 'unknown';
  try {
    const inner = card.querySelector('a[href*="/watch"]');
    if (inner) {
      const href = String(inner.getAttribute('href') ?? '');
      if (href) {
        const m = href.match(/[?&]v=([^&/#]+)/);
        if (m?.[1]) return m[1];
      }
    }
    const outer =
      typeof (card as Element).closest === 'function'
        ? (card as Element).closest('a[href*="/watch"]')
        : null;
    if (outer) {
      const href = String(outer.getAttribute('href') ?? '');
      if (href) {
        const m = href.match(/[?&]v=([^&/#]+)/);
        if (m?.[1]) return m[1];
      }
    }
  } catch (_) { /* intentional */ }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// DOM fixture builders
// ---------------------------------------------------------------------------

export interface CardFixture {
  card: HTMLElement;
  video: HTMLVideoElement;
  anchor: HTMLAnchorElement | null;
}

export interface BuildCardOptions {
  /** Put the anchor inside the card (default) */
  innerAnchor?: boolean;
  /** Wrap the entire card in an outer anchor element */
  outerAnchor?: boolean;
  /** Don't create an anchor at all */
  noAnchor?: boolean;
  /** Attach a Shorts sibling next to the card */
  addShortsSibling?: boolean;
  /** Shorts video ID for the sibling */
  shortsId?: string;
}

/** Creates an element from a CSS selector part — handles the #content ID selector */
function makeElementFromTag(tag: string): HTMLElement {
  if (tag === '#content') {
    const el = document.createElement('div');
    el.id = 'content';
    return el;
  }
  return document.createElement(tag) as HTMLElement;
}

export function buildCard(
  tag: string,
  videoId: string,
  opts: BuildCardOptions = { innerAnchor: true },
): CardFixture {
  const card = makeElementFromTag(tag);
  const video = document.createElement('video') as HTMLVideoElement;

  // Use ytimg thumbnail URL format so getDiagItemKey extracts the right ID
  video.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  video.poster = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  let anchor: HTMLAnchorElement | null = null;

  if (opts.outerAnchor) {
    anchor = document.createElement('a') as HTMLAnchorElement;
    anchor.href = `/watch?v=${videoId}`;
    anchor.appendChild(card);
    card.appendChild(video);
    document.body.appendChild(anchor);
  } else if (opts.noAnchor) {
    card.appendChild(video);
    document.body.appendChild(card);
  } else {
    // innerAnchor (default)
    anchor = document.createElement('a') as HTMLAnchorElement;
    anchor.href = `/watch?v=${videoId}`;
    anchor.appendChild(video);
    card.appendChild(anchor);
    document.body.appendChild(card);
  }

  if (opts.addShortsSibling && opts.shortsId) {
    const shortsAnchor = document.createElement('a');
    shortsAnchor.href = `/shorts/${opts.shortsId}`;
    card.parentElement?.insertBefore(shortsAnchor, card.nextSibling);
  }

  return { card, video, anchor };
}

/** Stamp a video node as if it went through a positive classification + applyBlur */
export function stampPositiveBlur(video: HTMLVideoElement, videoId: string): void {
  const src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  video.dataset.mwModerated = 'blurred';
  video.dataset.mwHardBlur = '1';
  video.dataset.mwHardBlurItemKey = videoId;
  video.dataset.mwHardBlurSrc = src;
  video.dataset.mwSrc = src;
  video.dataset.mwCategory = 'porn';
  video.dataset.mwBlurStrength = '40';
  video.dataset.mwItemId = videoId;
  video.style.filter = 'blur(40px)';
}

/** Clear the 80ms reattach cooldown so diagNonShortsReattach can be called again */
export function clearReattachCooldown(video: HTMLVideoElement): void {
  video.dataset.mwNonShortsReattachAt = '0';
}

// ---------------------------------------------------------------------------
// Active Shorts fixtures (Step 0 regression net)
// ---------------------------------------------------------------------------

export interface ActiveShortsFixture {
  player: HTMLElement;
  frame: HTMLElement;
  video: HTMLVideoElement;
  src: string;
}

/**
 * Builds the active Shorts player shell that production selectors resolve:
 *   #shorts-player > ytm-reel-video-renderer[aria-hidden="false"] > video
 * The video carries the oardefault poster URL for the given Shorts id so
 * doesShortsContainerMatchSrc matches the frame for that src.
 *
 * NOTE: navigate to a /shorts/<id> URL (pushShortsUrl) BEFORE injectScript so
 * isShortsModeActive() is true during script bootstrap.
 */
export function buildActiveShortsPlayer(shortsId: string): ActiveShortsFixture {
  const src = `https://i.ytimg.com/vi/${shortsId}/oardefault.jpg`;
  const player = document.createElement('div');
  player.id = 'shorts-player';
  const frame = document.createElement('ytm-reel-video-renderer');
  frame.setAttribute('aria-hidden', 'false');
  const video = document.createElement('video') as HTMLVideoElement;
  video.src = src;
  video.poster = src;
  frame.appendChild(video);
  player.appendChild(frame);
  document.body.appendChild(player);
  return { player, frame, video, src };
}

/** Stamp blur residue on a node as applyBlur leaves it on active Shorts. */
export function stampShortsBlurResidue(
  node: HTMLElement,
  src: string,
  itemId: string,
  category = 'porn',
): void {
  node.dataset.mwModerated = 'blurred';
  node.dataset.mwCategory = category;
  node.dataset.mwSrc = src;
  node.dataset.mwItemId = itemId;
  node.classList.add('mw-blurred');
  node.style.setProperty('filter', 'blur(40px)', 'important');
}

/** Navigate jsdom to an active-Shorts URL (same origin, no reload). */
export function pushShortsUrl(shortsId: string): void {
  window.history.pushState({}, '', `/shorts/${shortsId}`);
}

/** Navigate jsdom to YouTube search results (main-surface for ownership/reveal). */
export function pushResultsUrl(query = 'test'): void {
  window.history.pushState({}, '', `/results?search_query=${encodeURIComponent(query)}`);
}

/** Navigate jsdom to a watch page (rec thumbs surface). */
export function pushWatchUrl(videoId: string): void {
  window.history.pushState({}, '', `/watch?v=${encodeURIComponent(videoId)}`);
}

/** Restore the default main-feed URL configured by vitest.stability.config.ts. */
export function restoreMainFeedUrl(): void {
  window.history.pushState({}, '', '/');
}

// ---------------------------------------------------------------------------
// Script injection with test-only probe
// ---------------------------------------------------------------------------

export const TEST_NONCE = 'mw_stability_test_2026_nonce';
export const TEST_PAGE_EPOCH = 1748800001000;

/**
 * Functions exposed from inside the injection script IIFE by probe injection.
 * These are NOT exported by production code — they exist only in the test
 * environment via string instrumentation of the generated script.
 */
export interface MWTestProbe {
  getMvpCardHrefItemKey: (card: Element) => string;
  isMvpBlurAuthorized: (
    element: Element,
    src: string,
    itemKey: string,
    mvpProof: string,
    callerCtx: string,
  ) => boolean;
  diagNonShortsReattach: (videoNode: HTMLVideoElement, reason: string) => void;
  isYouTubeMainPageThumbnailSurfaceUrl: (url: string) => boolean;
  repairNonShortsBlurRevealInvariant: (reason: string) => void;
  offModeCleanup: (reason: string) => string;
  isVisualModerationActive: () => boolean;
  createRevealOverlay: (
    element: Element,
    src: string,
    category: string,
    itemId?: string,
    allowShortsReresolve?: boolean,
  ) => void;
  findAndBlur: (
    src: string,
    category: string,
    blurPx: number,
    shouldBlur: boolean,
    originItemId?: string,
  ) => void;
  queueMutationScan: (node: Element, reason: string) => void;
  processLegacyResults: () => void;
  scanActiveShortsPlayerContainer: (reason: string) => boolean;
  applyBlur: (
    element: Element,
    src: string,
    category: string,
    blurPx: number,
    itemId: string,
    mvpProof?: string,
  ) => void;
  // --- Active Shorts reveal-pairing / veil probes (additive, Step 0 regression net) ---
  isShortsModeActive: () => boolean;
  getActiveShortsPlayerContainer: () => Element | null;
  resolveShortsStableBlurTarget: (
    node: Element,
    src: string,
  ) => { target: Element | null; selectorUsed: string } | null;
  healActiveShortsRevealPairing: (
    targetNode: Element,
    src: string,
    category: string,
    itemId: string,
    reason: string,
  ) => boolean;
  runShortsHealthHealForContainer: (container: Element, reason: string) => void;
  findRevealOverlayForElement: (element: Element, src: string) => Element | null;
  getFlashShieldShortsIdentity: (frame: Element | null, media: Element | null) => string;
  markFlashShieldShortsCandidate: () => void;
  clearFlashShieldResolution: (element: Element, nextState: string) => void;
  getFlashReleaseCounters: () => {
    flash_release_fallback_used: number;
    flash_release_missed_disconnected: number;
  };
  getTimerSnapshot: () => {
    shortsVeilTimeoutTimer: boolean;
  };
  getShortsVerdictMemorySize: () => number;
  reapplyOwnedContainerBlur: (card: Element, reason: string) => void;
  refreshShortsFreshnessOnReentry: (reason: string, options?: { force?: boolean; resetContext?: boolean }) => boolean;
  performShortsExitSurfaceCleanup: (reason: string) => {
    removedFlashOverlays: number;
    clearedVeilMarks: number;
    clearedPlayerResidue: number;
  };
  repositionAllShortsRevealOverlays: (reason: string) => void;
  // --- Reveal scope / recycled-node probes (post-reveal Shorts identity) ---
  isRevealedForSource: (src: string, element: Element | null) => boolean;
  markRevealedForSource: (
    src: string,
    element: Element | null,
    reason?: string,
  ) => { key: string; holdMs: number };
  clearStaleShortsRevealMarkersOnSwipe: (reason: string) => void;
  getCurrentShortsUrlId: () => string;
  ensureActiveShortsVisibleBlurHasReveal: (reason: string) => boolean;
  markFlashShieldShortsCandidate: () => void;
}

export interface InjectionResult {
  probe: MWTestProbe;
  logs: string[];
  cleanup: () => void;
}

/**
 * Generate and evaluate the injection script inside jsdom, exposing internal
 * functions via window.__MW_TEST_PROBE__. Does not touch any production file.
 *
 * @param locationHref Override the YouTube surface URL seen by the script.
 *   Defaults to 'https://m.youtube.com/' (main feed — MVP surface).
 */
/**
 * Generate and evaluate the injection script inside jsdom.
 *
 * Window URL is pre-configured by vitest.stability.config.ts to
 * https://m.youtube.com/ — no location stub needed here.
 */
export function injectScript(configOverrides?: Partial<InjectionConfig>): InjectionResult {
  // Reset any previous injection
  (window as Record<string, unknown>).__MW_ACTIVE__ = false;
  delete (window as Record<string, unknown>).__MW_NON_SHORTS_REATTACH_CONTEXT__;

  const logs: string[] = [];
  const consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  // Keep warn/error visible for debugging
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  const rawScript = generateModerationScript({
    sensitivity: 3,
    blurStrength: 40,
    enabled: true,
    nonce: TEST_NONCE,
    blockingMode: 'mvp',
    pageEpoch: TEST_PAGE_EPOCH,
    ...(configOverrides || {}),
  });

  // Inject probe code before the IIFE's closing return — production file untouched.
  const probeCode = `
  window.__MW_TEST_PROBE__ = {
    getMvpCardHrefItemKey: getMvpCardHrefItemKey,
    isMvpBlurAuthorized: isMvpBlurAuthorized,
    diagNonShortsReattach: diagNonShortsReattach,
    isYouTubeMainPageThumbnailSurfaceUrl: isYouTubeMainPageThumbnailSurfaceUrl,
    repairNonShortsBlurRevealInvariant: repairNonShortsBlurRevealInvariant,
    offModeCleanup: cleanupBloomGuardVisualModeration,
    isVisualModerationActive: isVisualModerationActive,
    createRevealOverlay: createRevealOverlay,
    findAndBlur: findAndBlur,
    queueMutationScan: queueMutationScan,
    processLegacyResults: processLegacyResults,
    scanActiveShortsPlayerContainer: scanActiveShortsPlayerContainer,
    applyBlur: applyBlur,
    isShortsModeActive: isShortsModeActive,
    getActiveShortsPlayerContainer: getActiveShortsPlayerContainer,
    resolveShortsStableBlurTarget: resolveShortsStableBlurTarget,
    healActiveShortsRevealPairing: healActiveShortsRevealPairing,
    runShortsHealthHealForContainer: runShortsHealthHealForContainer,
    findRevealOverlayForElement: findRevealOverlayForElement,
    getFlashShieldShortsIdentity: getFlashShieldShortsIdentity,
    markFlashShieldShortsCandidate: markFlashShieldShortsCandidate,
    clearFlashShieldResolution: clearFlashShieldResolution,
    getFlashReleaseCounters: function() {
      return {
        flash_release_fallback_used: diagFlashReleaseCounters.fallback_used,
        flash_release_missed_disconnected: diagFlashReleaseCounters.missed_disconnected,
      };
    },
    getTimerSnapshot: function() {
      return {
        shortsVeilTimeoutTimer: !!timerState.shortsVeilTimeoutTimer,
      };
    },
    getShortsVerdictMemorySize: function() {
      return flashShieldShortsVerdictMemory.size;
    },
    reapplyOwnedContainerBlur: reapplyOwnedContainerBlur,
    refreshShortsFreshnessOnReentry: refreshShortsFreshnessOnReentry,
    performShortsExitSurfaceCleanup: performShortsExitSurfaceCleanup,
    repositionAllShortsRevealOverlays: repositionAllShortsRevealOverlays,
    isRevealedForSource: isRevealedForSource,
    markRevealedForSource: markRevealedForSource,
    clearStaleShortsRevealMarkersOnSwipe: clearStaleShortsRevealMarkersOnSwipe,
    getCurrentShortsUrlId: getCurrentShortsUrlId,
    ensureActiveShortsVisibleBlurHasReveal: ensureActiveShortsVisibleBlurHasReveal,
    markFlashShieldShortsCandidate: markFlashShieldShortsCandidate,
  };
  `;

  const instrumentedScript = rawScript.replace(
    "return 'MW_INJECTED';",
    probeCode + "return 'MW_INJECTED';",
  );

  // new Function runs in global scope — all window/document refs resolve to jsdom globals.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function(instrumentedScript)();

  const probe = (window as Record<string, unknown>).__MW_TEST_PROBE__ as MWTestProbe;

  return {
    probe,
    logs,
    cleanup() {
      // Disconnect observers and clear timers BEFORE clearing innerHTML so that
      // MutationObserver callbacks don't fire on a partially-torn-down document.
      const teardown = (window as Record<string, unknown>).__MW_TEARDOWN__;
      if (typeof teardown === 'function') {
        (teardown as (r: string) => void)('test_cleanup');
      }
      (window as Record<string, unknown>).__MW_ACTIVE__ = false;
      delete (window as Record<string, unknown>).__MW_TEST_PROBE__;
      document.body.innerHTML = '';
      // The reveal portal is appended to document.documentElement (NOT body),
      // so clearing body leaves stale overlays behind. A stale overlay from a
      // previous injection instance can collide with a new instance's diag
      // node ids ("n1","n2",...) and trigger createRevealOverlay's
      // existing_owner_mismatch destruction path — poisoning later tests.
      document.getElementById('mw-reveal-portal')?.remove();
      document.querySelectorAll('.mw-reveal-overlay, .mw-reveal-btn').forEach(n => n.remove());
      document.documentElement.className = '';
      try {
        window.localStorage.clear();
      } catch {
        /* defensive */
      }
      consoleSpy.mockRestore();
      vi.restoreAllMocks();
    },
  };
}

/** Flush microtasks so MutationObserver callbacks settle */
export async function tick(): Promise<void> {
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
}
