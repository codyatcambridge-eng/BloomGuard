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
import { generateModerationScript } from '@/lib/webview-injection-script';

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
  healActiveShortsBlurredNodeReveal: (reason: string) => boolean;
  healNonShortsBlurredNodeReveal: (reason: string) => boolean;
  refreshShortsFreshnessOnReentry: (reason: string) => boolean;
  scheduleRevealOverlayRepair: (
    node: Element,
    src: string,
    category: string,
    itemId?: string,
    reason?: string,
  ) => boolean;
  markRevealedForSource: (src: string, element: Element, reason: string) => unknown;
  applyBlur: (
    element: Element,
    src: string,
    category: string,
    blurPx: number,
    itemId: string,
    mvpProof?: string,
  ) => void;
  enforceRevealOverlayVisibilityGuard: (
    overlay: Element,
    anchorHint: Element | null,
    phase: string,
  ) => boolean;
  reapplyOwnedContainerBlur: (card: Element, reason: string) => void;
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
export function injectScript(): InjectionResult {
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
    healActiveShortsBlurredNodeReveal: healActiveShortsBlurredNodeReveal,
    healNonShortsBlurredNodeReveal: healNonShortsBlurredNodeReveal,
    refreshShortsFreshnessOnReentry: refreshShortsFreshnessOnReentry,
    scheduleRevealOverlayRepair: scheduleRevealOverlayRepair,
    markRevealedForSource: markRevealedForSource,
    applyBlur: applyBlur,
    enforceRevealOverlayVisibilityGuard: enforceRevealOverlayVisibilityGuard,
    reapplyOwnedContainerBlur: reapplyOwnedContainerBlur,
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
