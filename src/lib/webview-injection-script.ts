/**
 * WebView Injection Script for Image Moderation
 * 
 * This script runs INSIDE the WebView and handles:
 * 1. Image detection (img tags, background-images, video posters)
 * 2. Shadow DOM traversal for YouTube/TikTok
 * 3. Dynamic content via MutationObserver
 * 4. Communication with native app via postMessage protocol
 * 5. Blur application and reveal toggles
 * 6. Fail-open policy (default safe, no blur on timeout/error)
 * 7. Semantic delay with soft blur while scanning
 * 
 * Communication Flow (postMessage-based with nonce security):
 * 1. Script detects images and batches them into scan requests
 * 2. Script posts { type: 'gc-moderation-request', requestId, items, nonce } to parent
 * 3. Native app receives via message listener, processes with NSFWJS
 * 4. Native app posts back { type: 'gc-moderation-result', requestId, results, nonce }
 * 5. Script validates nonce, receives results and applies blurs
 * 
 * Security:
 * - Nonce prevents message spoofing from malicious page scripts
 * - Only results with matching nonce are processed
 */

export interface InjectionConfig {
  sensitivity: number; // 0-4 blur dial
  blurStrength: number; // px
  enabled: boolean;
  scanEnabled?: boolean; // Scanner/discovery can remain active for Flash Shield when the main dial is off
  flashShieldV1?: boolean;
  forcedBlur?: boolean; // Dev mode: blur everything
  failClosed?: boolean; // DEPRECATED: Now fail-open by default
  debug?: boolean; // Verbose logging
  nonce: string; // Security nonce for message validation
  blockingMode?: 'mvp' | 'full';
  pageEpoch?: number;
  diagYouTubeShorts?: boolean;
  enableShortsHealthHeal?: boolean;
}

/**
 * Minimal document-start bootstrap for iOS WKWebView.
 * The full moderation script replaces the bootstrap observer after injection.
 */
export function generateFlashShieldBootstrap(enabled: boolean): string {
  if (!enabled) return '';

  return `
    (function() {
      'use strict';
      if (window.__MW_FLASH_BOOTSTRAP__ && typeof window.__MW_FLASH_BOOTSTRAP__.setEnabled === 'function') {
        window.__MW_FLASH_BOOTSTRAP__.setEnabled(true);
        return;
      }
      var STYLE_ID = 'mw-flash-shield';
      var ROOT_CLASS = 'mw-flash-shield-on';
      var OVERLAY_CLASS = 'mw-flash-shorts-overlay';
      var observer = null;
      var active = true;
      var burstRaf = null;
      function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        var styleHost = document.head || document.documentElement;
        if (!styleHost) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
          'html.' + ROOT_CLASS + ' [data-mw-veil="1"]:not([data-mw-moderated="safe"]):not([data-mw-moderated="revealed"]):not([data-mw-moderated="timeout-safe"]) {',
          'filter: blur(20px) saturate(.72) brightness(.94) !important;',
          '-webkit-filter: blur(20px) saturate(.72) brightness(.94) !important;',
          'backdrop-filter: blur(22px) saturate(.82) !important;',
          '-webkit-backdrop-filter: blur(22px) saturate(.82) !important;',
          '}',
          'html.' + ROOT_CLASS + ' #shorts-player ytm-reel-video-renderer[aria-hidden="false"] video:not([data-mw-moderated="safe"]):not([data-mw-moderated="revealed"]):not([data-mw-moderated="timeout-safe"]),',
          'html.' + ROOT_CLASS + ' #shorts-player ytm-reel-video-renderer[is-active] video:not([data-mw-moderated="safe"]):not([data-mw-moderated="revealed"]):not([data-mw-moderated="timeout-safe"]),',
          'html.' + ROOT_CLASS + ' #shorts-player ytm-reel-video-renderer[selected] video:not([data-mw-moderated="safe"]):not([data-mw-moderated="revealed"]):not([data-mw-moderated="timeout-safe"]) {',
          'filter: blur(24px) saturate(.72) brightness(.92) !important;',
          '-webkit-filter: blur(24px) saturate(.72) brightness(.92) !important;',
          '}',
          'html.' + ROOT_CLASS + ' #shorts-player video[data-mw-veil="1"]:not([data-mw-moderated="safe"]):not([data-mw-moderated="revealed"]):not([data-mw-moderated="timeout-safe"]),',
          'html.' + ROOT_CLASS + ' ytm-reel-video-renderer video[data-mw-veil="1"]:not([data-mw-moderated="safe"]):not([data-mw-moderated="revealed"]):not([data-mw-moderated="timeout-safe"]),',
          'html.' + ROOT_CLASS + ' ytd-reel-video-renderer video[data-mw-veil="1"]:not([data-mw-moderated="safe"]):not([data-mw-moderated="revealed"]):not([data-mw-moderated="timeout-safe"]) {',
          'filter: blur(24px) saturate(.72) brightness(.92) !important;',
          '-webkit-filter: blur(24px) saturate(.72) brightness(.92) !important;',
          '}',
          'html.' + ROOT_CLASS + ' [data-mw-flash-frame="1"] {',
          'position: relative !important;',
          'isolation: isolate !important;',
          '}',
          'html.' + ROOT_CLASS + ' .' + OVERLAY_CLASS + ' {',
          'position: absolute !important;',
          'inset: 0 !important;',
          'display: block !important;',
          'pointer-events: none !important;',
          'z-index: 2147483000 !important;',
          'background: rgba(8,8,10,.22) !important;',
          'backdrop-filter: blur(22px) saturate(.82) !important;',
          '-webkit-backdrop-filter: blur(22px) saturate(.82) !important;',
          '}',
          'html.' + ROOT_CLASS + ' [data-mw-moderated="safe"] > .' + OVERLAY_CLASS + ',',
          'html.' + ROOT_CLASS + ' [data-mw-moderated="revealed"] > .' + OVERLAY_CLASS + ',',
          'html.' + ROOT_CLASS + ' [data-mw-moderated="timeout-safe"] > .' + OVERLAY_CLASS + ' {',
          'display: none !important;',
          '}',
          'html.' + ROOT_CLASS + ' [data-mw-moderated="safe"] [data-mw-veil="1"],',
          'html.' + ROOT_CLASS + ' [data-mw-moderated="revealed"] [data-mw-veil="1"],',
          'html.' + ROOT_CLASS + ' [data-mw-moderated="timeout-safe"] [data-mw-veil="1"],',
          'html.' + ROOT_CLASS + ' [data-mw-veil="1"][data-mw-moderated="safe"],',
          'html.' + ROOT_CLASS + ' [data-mw-veil="1"][data-mw-moderated="revealed"],',
          'html.' + ROOT_CLASS + ' [data-mw-veil="1"][data-mw-moderated="timeout-safe"] {',
          'filter: none !important;',
          '-webkit-filter: none !important;',
          'backdrop-filter: none !important;',
          '-webkit-backdrop-filter: none !important;',
          '}',
        ].join('');
        styleHost.appendChild(style);
      }
      function getActiveShortsFrame() {
        var selectors = [
          '#shorts-player ytm-reel-video-renderer[selected]',
          '#shorts-player ytm-reel-video-renderer[is-active]',
          '#shorts-player ytm-reel-video-renderer[aria-hidden="false"]',
          '#shorts-player ytm-reel-video-renderer[aria-current="true"]',
          '#shorts-player ytm-shorts-lockup-view-model-v2[selected]',
          '#shorts-player ytm-shorts-lockup-view-model-v2[is-active]',
          '#shorts-player ytm-shorts-lockup-view-model-v2[aria-hidden="false"]',
          '#shorts-player ytm-shorts-lockup-view-model[selected]',
          '#shorts-player ytm-shorts-lockup-view-model[is-active]',
          '#shorts-player ytd-reel-video-renderer[is-active]',
          'ytm-reel-video-renderer[selected]',
          'ytm-reel-video-renderer[is-active]',
          'ytm-reel-video-renderer[aria-hidden="false"]',
          'ytm-shorts-lockup-view-model-v2[is-active]',
          'ytm-shorts-lockup-view-model[is-active]',
          'ytd-reel-video-renderer[is-active]',
          '#shorts-player ytm-reel-video-renderer',
          '#shorts-player ytd-reel-video-renderer',
          '#shorts-player ytm-shorts-lockup-view-model-v2',
          '#shorts-player ytm-shorts-lockup-view-model',
          '#player-container',
          '#shorts-player'
        ];
        for (var i = 0; i < selectors.length; i += 1) {
          var frame = document.querySelector(selectors[i]);
          if (frame && frame.isConnected && frame.querySelector('video, img')) return frame;
        }
        return null;
      }
      function getShortsIdentity(frame, media) {
        var pathMatch = String(location.pathname || '').match(/\\/shorts\\/([^/?#]+)/i);
        var shortsId = pathMatch && pathMatch[1] ? pathMatch[1] : 'none';
        var nodeId = '';
        if (media && media.getAttribute) {
          nodeId = media.getAttribute('data-video-id') || media.getAttribute('data-item-id') || '';
        }
        if (!nodeId && frame && frame.getAttribute) {
          nodeId = frame.getAttribute('data-video-id') || frame.getAttribute('data-item-id') || frame.getAttribute('data-id') || '';
        }
        // C1/P1 (bootstrap copy): media source churns during normal playback
        // of the SAME Short — it must not participate in the identity.
        return [shortsId, nodeId || 'none'].join('|');
      }
      function ensureShortsOverlay(frame, identity) {
        var overlay = null;
        for (var i = 0; i < frame.children.length; i += 1) {
          if (frame.children[i].classList && frame.children[i].classList.contains(OVERLAY_CLASS)) {
            overlay = frame.children[i];
            break;
          }
        }
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.className = OVERLAY_CLASS;
          overlay.setAttribute('aria-hidden', 'true');
          frame.appendChild(overlay);
        }
        overlay.dataset.mwFlashIdentity = identity;
      }
      function stampActiveShorts() {
        if (!active || !/\\/shorts(?:\\/|$)/i.test(String(location.pathname || ''))) return;
        var frame = getActiveShortsFrame();
        if (!frame) return;
        var media = frame.querySelector('video.html5-main-video, video, img');
        if (!media) return;
        var identity = getShortsIdentity(frame, media);
        var previousIdentity = String(frame.dataset.mwFlashIdentity || '');
        // C1/P1 (bootstrap copy): wipe verdicts only on a real Short change
        // (URL id segment), never for drift within the same Short.
        var previousShortsId = previousIdentity ? previousIdentity.split('|')[0] : '';
        var currentShortsId = identity.split('|')[0];
        if (previousIdentity && previousIdentity !== identity && previousShortsId !== currentShortsId) {
          frame.removeAttribute('data-mw-moderated');
          media.removeAttribute('data-mw-moderated');
          media.removeAttribute('data-mw-preblur-clear');
        }
        document.querySelectorAll('[data-mw-flash-frame="1"]').forEach(function(node) {
          if (node !== frame) node.removeAttribute('data-mw-flash-frame');
        });
        frame.dataset.mwFlashIdentity = identity;
        frame.dataset.mwFlashFrame = '1';
        media.dataset.mwFlashIdentity = identity;
        // C1/P1 (bootstrap copy): veil only the unresolved window.
        var bootstrapVerdict = String(media.getAttribute('data-mw-moderated') || frame.getAttribute('data-mw-moderated') || '');
        var bootstrapResolved =
          bootstrapVerdict === 'blurred' ||
          bootstrapVerdict === 'safe' ||
          bootstrapVerdict === 'revealed' ||
          bootstrapVerdict === 'timeout-safe';
        if (!bootstrapResolved) {
          media.dataset.mwVeil = '1';
          ensureShortsOverlay(frame, identity);
        }
      }
      function startShortsBurst() {
        if (burstRaf || typeof requestAnimationFrame !== 'function') return;
        var startedAt = Date.now();
        var sweep = function() {
          stampActiveShorts();
          if (active && Date.now() - startedAt < 190) {
            burstRaf = requestAnimationFrame(sweep);
          } else {
            burstRaf = null;
          }
        };
        stampActiveShorts();
        burstRaf = requestAnimationFrame(sweep);
      }
      function stamp(root) {
        if (!active) return;
        ensureStyle();
        if (document.documentElement) document.documentElement.classList.add(ROOT_CLASS);
        var scope = root && root.querySelectorAll ? root : document;
        var media = scope.querySelectorAll(
          'yt-lockup-view-model img, yt-lockup-view-model-wiz img, ytm-rich-item-renderer img, ytm-media-item img, ytm-shorts-lockup-view-model img, .yt-core-image, yt-image img, img[src*="googleusercontent"], .g-img img'
        );
        for (var i = 0; i < media.length; i += 1) {
          if (!media[i].hasAttribute('data-mw-moderated')) media[i].dataset.mwVeil = '1';
        }
        stampActiveShorts();
      }
      function setEnabled(next) {
        active = !!next;
        if (document.documentElement) {
          document.documentElement.classList.toggle(ROOT_CLASS, active);
        }
        if (active) {
          stamp(document);
          return;
        }
        document.querySelectorAll('[data-mw-veil="1"]').forEach(function(node) {
          node.removeAttribute('data-mw-veil');
        });
        document.querySelectorAll('[data-mw-flash-frame="1"]').forEach(function(node) {
          node.removeAttribute('data-mw-flash-frame');
        });
        document.querySelectorAll('.' + OVERLAY_CLASS).forEach(function(node) {
          node.remove();
        });
      }
      ensureStyle();
      setEnabled(true);
      startShortsBurst();
      observer = new MutationObserver(function(mutations) {
        if (!active) return;
        for (var i = 0; i < mutations.length; i += 1) {
          for (var j = 0; j < mutations[i].addedNodes.length; j += 1) {
            var node = mutations[i].addedNodes[j];
            if (node && node.nodeType === 1) stamp(node);
          }
        }
        stamp(document);
        startShortsBurst();
      });
      observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'poster', 'aria-hidden', 'selected', 'is-active', 'class', 'style']
      });
      window.__MW_FLASH_BOOTSTRAP__ = {
        setEnabled: setEnabled,
        disconnect: function() {
          if (observer) observer.disconnect();
          observer = null;
          if (burstRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(burstRaf);
          burstRaf = null;
        }
      };
    })();
  `;
}

export interface FailOpenModePolicyInput {
  rawShouldBlur: boolean;
  normalizedCategory: string;
  predictedLabel: string;
  isErrorResult: boolean;
  failClosed: boolean;
  enabled: boolean;
  sensitivity: number;
  blockingMode?: 'mvp' | 'full';
}

export interface AnatomicalPolicyInput {
  shouldApplyBlur: boolean;
  predictedLabel: string;
  sexyScore: number | null;
  pornScore: number | null;
  hentaiScore?: number | null;
  anatomicalThreshold: number;
  /** Optional dial thr for this label; anatomical must not raise the bar above dial. */
  dialThreshold?: number | null;
  forceUnsafe: boolean;
  failClosed: boolean;
  enabled: boolean;
  sensitivity: number;
}

const MVP_UNSAFE_CATEGORIES = new Set([
  'swimwear',
  'shirtless',
  'shirtless_male',
  'bikini',
  'swim_trunks',
  'sports_bra',
  'thirst',
]);

function normalizePolicyLabel(label: string): string {
  return String(label || '').trim().toLowerCase();
}

function isMvpAllowedPolicyLabel(label: string): boolean {
  const normalized = normalizePolicyLabel(label);
  return (
    MVP_UNSAFE_CATEGORIES.has(normalized) ||
    normalized === 'porn' ||
    normalized === 'hentai' ||
    normalized === 'sexy' ||
    normalized === 'suggestive' ||
    normalized === 'partial_nudity'
  );
}

export function applyFailOpenAndModePolicyDecision(input: FailOpenModePolicyInput): { shouldBlur: boolean; reason: string | null } {
  const normalizedCategory = normalizePolicyLabel(input.normalizedCategory);
  const predictedLabel = normalizePolicyLabel(input.predictedLabel);
  const enabledAndActive = input.enabled && input.sensitivity > 0;

  if (input.isErrorResult) {
    if (input.failClosed && enabledAndActive) {
      return { shouldBlur: true, reason: 'failClosed/' + normalizedCategory };
    }
    return { shouldBlur: false, reason: 'failOpen/' + normalizedCategory };
  }

  if (input.blockingMode === 'mvp') {
    const categoryAllowed = isMvpAllowedPolicyLabel(normalizedCategory);
    const predictedAllowed = isMvpAllowedPolicyLabel(predictedLabel);
    if (input.rawShouldBlur && !categoryAllowed && !predictedAllowed) {
      return { shouldBlur: false, reason: 'mvp_filter/' + (normalizedCategory || predictedLabel || 'unknown') };
    }
  }

  return { shouldBlur: !!input.rawShouldBlur, reason: null };
}

export function applyAnatomicalThresholdDecision(input: AnatomicalPolicyInput): { shouldBlur: boolean; reason: string | null } {
  if (!input.shouldApplyBlur || input.forceUnsafe) {
    return { shouldBlur: !!input.shouldApplyBlur, reason: null };
  }
  if (
    input.predictedLabel !== 'sexy' &&
    input.predictedLabel !== 'porn' &&
    input.predictedLabel !== 'hentai'
  ) {
    return { shouldBlur: !!input.shouldApplyBlur, reason: null };
  }

  const score =
    input.predictedLabel === 'sexy'
      ? input.sexyScore
      : input.predictedLabel === 'hentai'
        ? input.hentaiScore
        : input.pornScore;
  if (score === null || !Number.isFinite(score)) {
    if (input.failClosed && input.enabled && input.sensitivity > 0) {
      return { shouldBlur: true, reason: input.predictedLabel + '_scoreNaN/failClosed' };
    }
    return { shouldBlur: false, reason: input.predictedLabel + '_scoreNaN/failOpen' };
  }

  // Never raise bar above dial thr (dial thr optional; falls back to anatomical only).
  const dialThr = Number(input.dialThreshold);
  const keepFloor = Number.isFinite(dialThr)
    ? Math.min(input.anatomicalThreshold, dialThr)
    : input.anatomicalThreshold;
  if (score < keepFloor) {
    return { shouldBlur: false, reason: input.predictedLabel + '<anatomicalFloor thr=' + keepFloor };
  }

  return { shouldBlur: true, reason: null };
}

/**
 * Category thresholds based on blur dial (0-4)
 */
export function getCategoryThresholds(dialLevel: number): { porn: number; sexy: number; hentai: number } {
  switch (dialLevel) {
    case 0: return { porn: 1.1, sexy: 1.1, hentai: 1.1 };       // Off
    case 1: return { porn: 0.7, sexy: 0.85, hentai: 0.7 };      // Relaxed
    case 2: return { porn: 0.5, sexy: 0.65, hentai: 0.5 };      // Moderate
    case 3: return { porn: 0.3, sexy: 0.45, hentai: 0.3 };      // Strict
    case 4: return { porn: 0.15, sexy: 0.25, hentai: 0.15 };    // Maximum
    default: return { porn: 0.3, sexy: 0.45, hentai: 0.3 };
  }
}

/**
 * Generate the JavaScript code to inject into WebView
 */
export function generateModerationScript(config: InjectionConfig): string {
  // Ensure nonce is provided
  const nonce = config.nonce || 'n_' + Math.random().toString(36).slice(2, 10) + '_' + Math.random().toString(36).slice(2, 10);
  // FAIL-OPEN by default now - only use fail-closed if explicitly requested
  const failClosed = config.failClosed === true;
  const buildVersion = Date.now();
  const buildCommit = 'ce87d1f';
  const pageEpoch = Number.isFinite(config.pageEpoch) ? Number(config.pageEpoch) : Date.now();
  const requestedBlurStrength = Number.isFinite(config.blurStrength) ? config.blurStrength : 0;
  const clampedBlurStrength = Math.min(Math.max(0, requestedBlurStrength), 20);
  
  return `
  (function() {
    'use strict';
    const REQUESTED_BLUR_STRENGTH = ${requestedBlurStrength};
    const CLAMPED_BLUR_STRENGTH = ${clampedBlurStrength};
  
  // ==================== INITIALIZATION ====================
  
  // Prevent double injection
  if (window.__MW_ACTIVE__) {
    console.log('[MW] Already injected, skipping');
    // FREEZE-OVERRIDE (P0 Off→On): host reinject after Off must re-arm the live instance.
    // Happy-path dial/exit/nosoft behavior is unchanged when already active and On.
    try {
      if (typeof window.__MW_RESUME_AFTER_REINJECT__ === 'function') {
        window.__MW_RESUME_AFTER_REINJECT__({
          sensitivity: ${config.sensitivity},
          enabled: ${config.enabled === true},
          flashShieldV1: ${config.flashShieldV1 === true},
        });
      }
    } catch (eResume) {}
    try {
      if (window.__MW_BLUR_OVERLAY_API__ && typeof window.__MW_BLUR_OVERLAY_API__.sendReady === 'function') {
        window.__MW_BLUR_OVERLAY_API__.sendReady('reinject');
      }
    } catch (e) {}
    return 'MW_ALREADY_ACTIVE';
  }
  window.__MW_ACTIVE__ = true;
  console.log('[MW-INJECT] version=${buildVersion} commit=${buildCommit}');
  
  console.log('[MW] ========================================');
  console.log('[MW] injected - Moderation Script v3.0');
  console.log('[MW] Filter Intensity:', ${config.sensitivity});
  console.log('[MW] Shield Strength:', CLAMPED_BLUR_STRENGTH, 'px', '(requested:', REQUESTED_BLUR_STRENGTH + 'px)');
  console.log('[MW] Enabled:', ${config.enabled});
  console.log('[MW] Forced Blur:', ${config.forcedBlur || false});
  console.log('[MW] Fail-Closed:', ${failClosed}, '(default: fail-open)');
  console.log('[MW] Nonce:', '${nonce.substring(0, 10)}...');
  console.log('[MW] URL:', window.location.href);
  console.log('[MW] ========================================');

  const CONFIG = {
    sensitivity: ${config.sensitivity},
    blurStrength: CLAMPED_BLUR_STRENGTH,
    softBlurStrength: 8, // Soft blur for semantic delay
    enabled: ${config.enabled},
    scanEnabled: ${config.scanEnabled === true || config.enabled === true},
    forcedBlur: ${config.forcedBlur || false},
    failClosed: ${failClosed},
    debug: ${config.debug || false},
    nonce: '${nonce}',
    blockingMode: '${config.blockingMode || 'mvp'}',
    pageEpoch: ${pageEpoch},
    diagYouTubeShorts: ${config.diagYouTubeShorts ? 'true' : 'false'},
    enableShortsHealthHeal: ${config.enableShortsHealthHeal === false ? 'false' : 'true'},
    minImageSize: 80, // Minimum image dimension (fail-open below this - 80x80)
    semanticDelayMs: 0, // Apply blur immediately; no delay to avoid flash of unblurred content
    // Neutral fast-pass removed for strict/YouTube mode
    anatomicalThreshold: 0.60, // Sexy/Porn must be > this to maintain blur
    scanDelay: 50,
    batchSize: 5,
    batchDelay: 100,
    requestTimeout: 8000,
    mvpPositiveCardOwnershipV1: true,
    // Flash Shield V1 - independent frosted pre-paint veil (strictly separate from sensitivity/dial)
    flashShieldV1: ${config.flashShieldV1 === true},
  };
  let offModeVisualCleanupActive = false;

  // FREEZE-OVERRIDE (lifecycle / MVP polish): soft pre-blur is 8px without reveal.
  // After Active Shorts exit (and briefly on first YouTube entry), home heal re-scans
  // top thumbs and re-applies softblur → user sees "partial blur" on the top row.
  // Suppress soft preblur in those windows; hard blur still applies on positive results.
  let softPreblurSuppressedUntil = 0;
  const injectBootAt = Date.now();
  // First ~1.2s after inject: avoid painting the whole top row with reveal-less soft blur
  // while the host model warms. Positives still hard-blur when results arrive.
  softPreblurSuppressedUntil = injectBootAt + 1200;

  function suppressSoftPreblur(ms, reason) {
    const until = Date.now() + Math.max(0, Number(ms) || 0);
    if (until > softPreblurSuppressedUntil) softPreblurSuppressedUntil = until;
    console.log(
      '[DIAG][SOFT_PREBLUR]',
      'event=suppress',
      'ms=' + String(ms || 0),
      'untilIn=' + Math.max(0, softPreblurSuppressedUntil - Date.now()),
      'reason=' + String(reason || 'unknown')
    );
  }

  function isSoftPreblurSuppressed() {
    return Date.now() < softPreblurSuppressedUntil;
  }

  /**
   * Phase 0 MVP: soft preblur is always reveal-less partial blur.
   * Never paint it on YouTube (home/results/watch/feed/channel/Shorts exit recovery).
   * Hard blur + reveal only when the classifier returns positive.
   */
  function shouldSkipSoftPreblur() {
    if (isSoftPreblurSuppressed()) return true;
    try {
      if (isShortsModeActive()) return true;
    } catch (e) {}
    try {
      // IS_YOUTUBE is set once at inject; also re-check live host so SPA is covered.
      const host = String((window.location && window.location.hostname) || '').toLowerCase();
      if (
        host.indexOf('youtube.com') !== -1 ||
        host.indexOf('youtu.be') !== -1 ||
        host.indexOf('ytimg.com') !== -1
      ) {
        return true;
      }
    } catch (e2) {}
    try {
      if (typeof IS_YOUTUBE !== 'undefined' && IS_YOUTUBE) return true;
    } catch (e3) {}
    return false;
  }

  function isSrcPendingScan(src) {
    if (!src) return false;
    try {
      const id = state.pendingBySrc.get(src);
      if (id && state.pending.has(id)) return true;
      // Also match normalized forms used as keys.
      const norm = normalizeUrl(src) || src;
      const id2 = state.pendingBySrc.get(norm);
      return !!(id2 && state.pending.has(id2));
    } catch (e) {
      return false;
    }
  }

  function isNodeUnderActiveShortsShell(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      if (typeof node.closest !== 'function') return false;
      return !!node.closest(
        '#shorts-player, ytm-reel-video-renderer, ytd-reel-video-renderer,' +
        'ytm-shorts-player-page, ytd-shorts, #shorts-inner-container, #shorts-container'
      );
    } catch (e) {
      return false;
    }
  }

  function nodeHasInlineBlurFilter(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      const filter = String(node.style.getPropertyValue('filter') || node.style.filter || '').toLowerCase();
      const webkit = String(node.style.getPropertyValue('-webkit-filter') || '').toLowerCase();
      const backdrop = String(node.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
      const webkitBackdrop = String(node.style.getPropertyValue('-webkit-backdrop-filter') || '').toLowerCase();
      return (
        filter.includes('blur(') ||
        webkit.includes('blur(') ||
        backdrop.includes('blur(') ||
        webkitBackdrop.includes('blur(')
      );
    } catch (e) {
      return false;
    }
  }

  /**
   * Clear reveal-less soft pre-blur on main feed (partial blur Phase 0 failure).
   * forceAll: drop every softblur (exit window). Otherwise only orphans with no pending.
   * FREEZE-OVERRIDE: forceAll still runs when Shorts mode is flaky so exit cleanup
   * can clear home/results soft residue while #shorts-player remains mounted.
   */
  function clearMainFeedSoftPreblurResidue(reason, forceAll) {
    if (isShortsModeActive() && !forceAll) return 0;
    let cleared = 0;
    try {
      const nodes = document.querySelectorAll(
        '[data-mw-moderated="softblur"],.mw-softblur'
      );
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (!node || node.nodeType !== 1 || !node.isConnected) continue;
        // Never strip hard positives.
        if (
          node.dataset.mwModerated === 'blurred' ||
          node.dataset.mwHardBlur === '1' ||
          node.classList.contains('mw-blurred')
        ) {
          continue;
        }
        // Leave true Active Shorts shell alone when still in shorts mode.
        if (isShortsModeActive() && isNodeUnderActiveShortsShell(node)) continue;
        const src = getBloomGuardMarkedNodeSrc(node) || String(node.dataset.mwSrc || '');
        if (!forceAll && isSrcPendingScan(src)) {
          // Keep brief semantic soft only while a host result is truly pending —
          // except model_not_ready can stick; still clear if suppress window active.
          if (!isSoftPreblurSuppressed()) continue;
        }
        try {
          if (clearAllBlurAndOverlay(node, src, 'soft_preblur_clear:' + (reason || 'unknown'), 'safe')) {
            cleared += 1;
          } else {
            node.style.removeProperty('filter');
            node.style.removeProperty('-webkit-filter');
            node.style.removeProperty('backdrop-filter');
            node.style.removeProperty('-webkit-backdrop-filter');
            node.classList.remove('mw-softblur');
            node.dataset.mwModerated = 'safe';
            node.dataset.mwPreblurClear = 'true';
            cleared += 1;
          }
        } catch (e) {}
      }
      if (cleared > 0) {
        console.log(
          '[DIAG][SOFT_PREBLUR]',
          'event=cleared',
          'count=' + cleared,
          'forceAll=' + String(!!forceAll),
          'reason=' + String(reason || 'unknown')
        );
      }
    } catch (e) {}
    return cleared;
  }

  /**
   * Nuclear exit partial-blur scrub for main surfaces (home/results/watch/feed).
   * Clears reveal-less soft/filter blur AND re-pairs hard positives missing reveal.
   * Does not touch the Active Shorts player shell.
   */
  function scrubPartialBlurAfterShortsExit(reason) {
    const tag = String(reason || 'shorts_exit_partial_scrub');
    // Long suppress: exit heal re-scans for several seconds; soft must not return.
    try { suppressSoftPreblur(9000, tag); } catch (e) {}
    let softCleared = 0;
    let filterCleared = 0;
    let revealsRepaired = 0;
    try {
      softCleared = clearMainFeedSoftPreblurResidue(tag, true);
    } catch (e) {}
    try {
      // Broad catch: filter blur without softblur class (DOM recycle / partial stamps).
      const candidates = document.querySelectorAll(
        'img, video, yt-image, yt-img-shadow, [data-mw-moderated], .mw-softblur, .mw-blurred,' +
        '[style*="blur"], [data-mw-src]'
      );
      for (let i = 0; i < candidates.length; i += 1) {
        const node = candidates[i];
        if (!node || node.nodeType !== 1 || !node.isConnected) continue;
        if (isNodeUnderActiveShortsShell(node)) continue;
        const src = getBloomGuardMarkedNodeSrc(node) || String((node.dataset && node.dataset.mwSrc) || '');
        const hard =
          (node.dataset && node.dataset.mwHardBlur === '1') ||
          (node.dataset && node.dataset.mwModerated === 'blurred' && node.classList.contains('mw-blurred')) ||
          (typeof isAuthoritativeHardBlur === 'function' &&
            isAuthoritativeHardBlur(node) &&
            String((node.dataset && node.dataset.mwModerated) || '') === 'blurred');
        const hasSoftMark =
          (node.dataset && node.dataset.mwModerated === 'softblur') ||
          node.classList.contains('mw-softblur');
        const hasFilter = nodeHasInlineBlurFilter(node);

        if (hard) {
          // Hard positive must have reveal — never leave partial pairing.
          if (src && !isRevealedForSource(src, node) && !findRevealOverlayForElement(node, src)) {
            try {
              if (typeof forceCreateRevealForHardPositive === 'function') {
                if (forceCreateRevealForHardPositive(node, src, 'exit_scrub:' + tag)) {
                  revealsRepaired += 1;
                }
              } else if (typeof healNonShortsHardPositiveMissingReveals === 'function') {
                // fall through to batch heal below
              }
            } catch (eHeal) {}
          }
          continue;
        }

        // Soft / partial / filter-only without hard stamp → clear (no reveal-less blur).
        if (hasSoftMark || hasFilter) {
          try {
            if (clearAllBlurAndOverlay(node, src, 'exit_partial_filter_clear:' + tag, 'safe')) {
              filterCleared += 1;
            } else if (hasFilter || hasSoftMark) {
              node.style.removeProperty('filter');
              node.style.removeProperty('-webkit-filter');
              node.style.removeProperty('backdrop-filter');
              node.style.removeProperty('-webkit-backdrop-filter');
              node.classList.remove('mw-softblur');
              node.classList.remove('mw-blurred');
              if (node.dataset) {
                node.dataset.mwModerated = 'safe';
                node.dataset.mwPreblurClear = 'true';
              }
              filterCleared += 1;
            }
          } catch (e2) {}
        }
      }
    } catch (e) {}
    try {
      if (typeof healNonShortsHardPositiveMissingReveals === 'function') {
        healNonShortsHardPositiveMissingReveals('exit_scrub:' + tag);
      }
    } catch (e) {}
    try {
      if (typeof enforceMainSurfaceBlurRevealInvariant === 'function') {
        enforceMainSurfaceBlurRevealInvariant('exit_scrub:' + tag);
      }
    } catch (e) {}
    try {
      // Veil marks on main-surface nodes only. Flash overlay DOM nodes are removed
      // in performShortsExitSurfaceCleanup step 3 (counted for telemetry/tests).
      document.querySelectorAll('[data-mw-veil="1"]').forEach(function(node) {
        if (!node || node.nodeType !== 1) return;
        if (isNodeUnderActiveShortsShell(node)) return;
        try {
          node.removeAttribute('data-mw-veil');
        } catch (e3) {}
      });
    } catch (e) {}
    console.log(
      '[DIAG][SOFT_PREBLUR]',
      'event=exit_partial_scrub',
      'reason=' + tag,
      'softCleared=' + softCleared,
      'filterCleared=' + filterCleared,
      'revealsRepaired=' + revealsRepaired,
      'suppressed=' + String(isSoftPreblurSuppressed())
    );
    return { softCleared: softCleared, filterCleared: filterCleared, revealsRepaired: revealsRepaired };
  }

  function isVisualModerationActive() {
    return !offModeVisualCleanupActive && CONFIG.scanEnabled === true && (CONFIG.enabled === true || CONFIG.flashShieldV1 === true);
  }

  // Threshold mappings for blur dial levels.
  const THRESHOLDS = {
    0: { porn: 1.1, sexy: 1.1, hentai: 1.1 },       // Off
    1: { porn: 0.7, sexy: 0.85, hentai: 0.7 },      // Relaxed
    2: { porn: 0.5, sexy: 0.65, hentai: 0.5 },      // Moderate
    3: { porn: 0.3, sexy: 0.45, hentai: 0.3 },      // Strict
    4: { porn: 0.15, sexy: 0.25, hentai: 0.15 },    // Maximum
  };
  function getThresholdsForLevel(level) {
    return THRESHOLDS[level] || THRESHOLDS[3];
  }
  // Flash-only scanning uses a fixed moderate classification profile without changing
  // CONFIG.sensitivity or enabling the main hard-blur dial.
  const FLASH_SHIELD_SCAN_LEVEL = 2;
  let effectiveThresholds = getThresholdsForLevel(
    CONFIG.sensitivity > 0 ? CONFIG.sensitivity : (CONFIG.flashShieldV1 ? FLASH_SHIELD_SCAN_LEVEL : 0)
  );

  // FREEZE-OVERRIDE (accuracy): Active Shorts use the SAME dial thresholds as MVP Candidate 1
  // baseline (MVPcandidate1-baseline). Elevated floors (0.58/0.72) caused ~6/10 FNs on true
  // positives and are DISABLED for decisioning. Residual diag only reports what a floor
  // would have done — it must not veto blur.
  // Home/feed still use effectiveThresholds unchanged.
  const ACTIVE_SHORTS_FP_FLOOR_DIAG_ONLY = { porn: 0.58, sexy: 0.72, hentai: 0.55 };
  const ACTIVE_SHORTS_FP_GUARD_DECISION_ENABLED = false;
  function getActiveShortsThresholds() {
    // Match baseline: dial thresholds only (no elevated Shorts floor).
    const base = effectiveThresholds || getThresholdsForLevel(CONFIG.sensitivity || 0);
    return {
      porn: Number(base.porn) || 0,
      sexy: Number(base.sexy) || 0,
      hentai: Number(base.hentai) || 0,
    };
  }
  function getRequestThresholdsForSurface() {
    // Always send dial thresholds (baseline parity). Shorts no longer inflate request thr.
    return effectiveThresholds;
  }

  // Flash Shield consts (early for init use; full functions defined later)
  const FLASH_SHIELD_STYLE_ID = 'mw-flash-shield';
  const FLASH_SHIELD_CLASS = 'mw-flash-shield-on';
  const FLASH_SHIELD_SHORTS_OVERLAY_CLASS = 'mw-flash-shorts-overlay';
  const FLASH_SHIELD_SHORTS_VEIL_TIMEOUT_MS = 4000;
  const FLASH_SHIELD_SHORTS_VERDICT_MEMORY_MAX = 50;
  // C1/E1: Session verdict memory (instance-local, safe-class verdicts only):
  // a Short this instance already resolved must never be re-veiled —
  // swipe-backs, recycled frames, and media-node swaps otherwise produce a
  // pointless ~100ms veil blip while the warm classifier re-confirms known
  // content. Positives are deliberately NOT remembered: a known-positive
  // revisit keeps its entry veil until hard blur re-establishes.
  // Instance-local means mode changes / Off->On / refresh (all of which
  // re-inject) naturally start with an empty memory.
  const flashShieldShortsVerdictMemory = new Map();

  function rememberShortsVerdict(shortsId, verdict) {
    if (!shortsId || shortsId === 'none') return;
    if (verdict !== 'safe' && verdict !== 'timeout-safe') return;
    if (flashShieldShortsVerdictMemory.has(shortsId)) {
      flashShieldShortsVerdictMemory.delete(shortsId);
    }
    flashShieldShortsVerdictMemory.set(shortsId, verdict);
    while (flashShieldShortsVerdictMemory.size > FLASH_SHIELD_SHORTS_VERDICT_MEMORY_MAX) {
      const oldest = flashShieldShortsVerdictMemory.keys().next();
      if (oldest.done) break;
      flashShieldShortsVerdictMemory.delete(oldest.value);
    }
  }

  const HEURISTIC_CACHE_KEY = 'mw_heuristic_cache';
  const HEURISTIC_CACHE_LIMIT = 32;
  const MW_REVEAL_STORE_KEY = 'mw_reveal_store';
  const MW_REVEAL_TTL_MS = 86400000; // 24 hours
  const MW_REVEAL_MAX_ENTRIES = 500;
  let lastShieldTarget = null;
  const DEBUG_DISABLE_BLUR_ON_YOUTUBE = false;
  const DEBUG_BLUR_TRACE_LIMIT = 10;
  const HOSTNAME = (window.location && window.location.hostname ? window.location.hostname.toLowerCase() : '');
  const DEBUG_SKIP_DOMAIN_BLUR = DEBUG_DISABLE_BLUR_ON_YOUTUBE && (HOSTNAME.includes('youtube.com') || HOSTNAME.includes('ytimg.com'));
  let blurTraceCount = 0;
  let predictionKeysLogged = false;
  const CATEGORY_ALIASES = {
    porn: 'porn',
    pornography: 'porn',
    explicit: 'porn',
    nsfw: 'porn',
    nudity: 'porn',
    nude: 'porn',
    sexy: 'sexy',
    sexual: 'sexy',
    suggestive: 'sexy',
    thirst: 'thirst',
    swimwear: 'sexy',
    shirtless: 'sexy',
    shirtless_male: 'sexy',
    partial_nudity: 'sexy',
    hentai: 'hentai',
    neutral: 'neutral',
    safe: 'safe',
    drawing: 'drawing',
  };
  const TRACE_UNSAFE_LABELS = new Set(['porn', 'sexy', 'hentai', 'thirst']);
  const LEGACY_RESULTS_POLL_MS = 250;
  const URL_CHANGE_POLL_MS = 1200;
  console.log('[MW] Effective config:', JSON.stringify({
    blurDial: CONFIG.sensitivity,
    thresholds: effectiveThresholds,
    minImageSize: CONFIG.minImageSize,
    debugDisableBlurOnYouTube: DEBUG_DISABLE_BLUR_ON_YOUTUBE,
    skipBlurOnCurrentDomain: DEBUG_SKIP_DOMAIN_BLUR,
  }));
  if (DEBUG_SKIP_DOMAIN_BLUR) {
    console.log('[MW] DEBUG kill-switch active: skipping blur on hostname', HOSTNAME);
  }

  function normalizeLabel(label) {
    const raw = String(label || '').trim().toLowerCase();
    return CATEGORY_ALIASES[raw] || raw;
  }

  function toFiniteNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizePredictionObject(rawPredictions) {
    const normalized = {};
    if (!rawPredictions || typeof rawPredictions !== 'object') return normalized;
    Object.entries(rawPredictions).forEach(([key, value]) => {
      const score = toFiniteNumber(value);
      if (score === null) return;
      const mapped = normalizeLabel(key);
      const prev = normalized[mapped];
      normalized[mapped] = Number.isFinite(prev) ? Math.max(prev, score) : score;
    });
    return normalized;
  }

  function getTopPredictionLabel(predictions) {
    let label = null;
    let score = null;
    Object.entries(predictions || {}).forEach(([k, v]) => {
      const n = toFiniteNumber(v);
      if (n === null) return;
      if (score === null || n > score) {
        score = n;
        label = k;
      }
    });
    return { label: label, score: score };
  }

  function logBlurTraceOncePerElement(trace) {
    if (blurTraceCount >= DEBUG_BLUR_TRACE_LIMIT) return;
    blurTraceCount += 1;
    console.log(
      '[MW-BLUR-TRACE]',
      'url=' + String(trace.urlPrefix || '').substring(0, 60),
      'size=' + (trace.width || 0) + 'x' + (trace.height || 0),
      'pred=' + (trace.predictedLabel || 'unknown'),
      'score=' + (toFiniteNumber(trace.labelScoreUsed) ?? 'NaN'),
      'thr=' + (toFiniteNumber(trace.thresholdUsed) ?? 'n/a'),
      'reason=' + (trace.decisionReason || 'unknown')
    );
  }

  // ==================== GLOBAL BLUR OVERLAY PROTOCOL ====================

  const OVERLAY_ID = 'mw-blur-overlay';
  const OVERLAY_STYLE_ID = 'mw-blur-overlay-style';
  const REVEAL_PORTAL_ID = 'mw-reveal-portal';
  const DOM_OVERLAY_ENABLED = true;

  const overlayState = window.__MW_BLUR_STATE__ || {
    enabled: false,
    updatedAt: Date.now(),
    reason: 'init',
  };
  window.__MW_BLUR_STATE__ = overlayState;

  function postToHost(payload) {
    let delivered = false;
    try {
      if (window.mobileApp && typeof window.mobileApp.postMessage === 'function') {
        window.mobileApp.postMessage({ detail: payload });
        delivered = true;
      }
    } catch (e) {}
    if (delivered) return;
    try {
      window.postMessage(payload, '*');
    } catch (e) {}
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*');
      }
    } catch (e) {}
  }

  function readHostEventPayload(eventLike) {
    if (!eventLike || typeof eventLike !== 'object') return null;
    if (eventLike.detail && typeof eventLike.detail === 'object') return eventLike.detail;
    if (eventLike.data && typeof eventLike.data === 'object') return eventLike.data;
    return null;
  }

  function ensureOverlayStyle() {
    if (!DOM_OVERLAY_ENABLED) return null;
    if (document.getElementById(OVERLAY_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = OVERLAY_STYLE_ID;
    style.textContent = [
      '#' + OVERLAY_ID + ' {',
      'position: fixed !important;',
      'inset: 0 !important;',
      'z-index: 2147483646 !important;',
      'pointer-events: none !important;',
      'display: none !important;',
      'opacity: 0 !important;',
      'background: rgba(20,20,20,0.16) !important;',
      'backdrop-filter: blur(22px) saturate(0.85) !important;',
      '-webkit-backdrop-filter: blur(22px) saturate(0.85) !important;',
      'transition: opacity 140ms ease !important;',
      '}',
      '#' + OVERLAY_ID + '.mw-enabled {',
      'display: block !important;',
      'opacity: 1 !important;',
      '}',
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureOverlayElement() {
    if (!DOM_OVERLAY_ENABLED) return null;
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.setAttribute('aria-hidden', 'true');
      (document.body || document.documentElement).appendChild(overlay);
    }
    return overlay;
  }

  function logOverlayElementState(eventName, requestedEnabled, reason, prevEnabled, nextEnabled, overlay) {
    const style = overlay ? window.getComputedStyle(overlay) : null;
    const rect = overlay ? overlay.getBoundingClientRect() : null;
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const fillsViewport = !!(
      rect &&
      viewportWidth > 0 &&
      viewportHeight > 0 &&
      rect.width >= viewportWidth * 0.95 &&
      rect.height >= viewportHeight * 0.95
    );
    console.log(
      '[DIAG][INJECT_OVERLAY_STATE]',
      'event=' + eventName,
      'requestedEnabled=' + (!!requestedEnabled),
      'reason=' + String(reason || 'unknown'),
      'prevEnabled=' + prevEnabled,
      'nextEnabled=' + nextEnabled,
      'overlayPresent=' + (!!overlay),
      'overlayClassEnabled=' + (!!(overlay && overlay.classList.contains('mw-enabled'))),
      'display=' + String(style ? style.display : 'none'),
      'visibility=' + String(style ? style.visibility : 'hidden'),
      'opacity=' + String(style ? style.opacity : '0'),
      'pointerEvents=' + String(style ? style.pointerEvents : 'none'),
      'rect=' + (rect ? (Math.round(rect.width) + 'x' + Math.round(rect.height)) : '0x0'),
      'viewport=' + viewportWidth + 'x' + viewportHeight,
      'fillsViewport=' + fillsViewport,
      'updatedAt=' + Date.now(),
    );
  }

  function setOverlayEnabled(enabled, reason) {
    const prevEnabled = !!overlayState.enabled;
    const suppressFullscreenForMainPageThumbReason = reason === 'moderation_request_main_page_item_blur';
    const nextEnabled = DOM_OVERLAY_ENABLED
      ? (!!enabled && !suppressFullscreenForMainPageThumbReason)
      : false;
    overlayState.enabled = nextEnabled;
    overlayState.reason = DOM_OVERLAY_ENABLED ? (reason || 'unknown') : 'dom_overlay_disabled';
    overlayState.updatedAt = Date.now();

    ensureOverlayStyle();
    const overlay = ensureOverlayElement();
    if (!overlay) return;

    if (overlayState.enabled) {
      overlay.classList.add('mw-enabled');
    } else {
      overlay.classList.remove('mw-enabled');
    }
    logOverlayElementState('setOverlayEnabled', enabled, overlayState.reason, prevEnabled, overlayState.enabled, overlay);
    if (CONFIG.debug && prevEnabled !== overlayState.enabled) {
      console.log('[MW][Overlay] enabled=' + overlayState.enabled, 'reason=' + overlayState.reason);
    }
    if (CONFIG.debug && prevEnabled !== overlayState.enabled) {
      console.log('[MW-DIAG][INJECT] source=overlay', 'enabled=' + overlayState.enabled, 'reason=' + overlayState.reason);
    }
  }

  const SENSITIVITY_LABELS = {
    0: 'Off',
    1: 'Relaxed',
    2: 'Moderate',
    3: 'Strict',
    4: 'Maximum',
  };
  const SENSITIVITY_ACCENTS = {
    0: { background: 'rgba(26,27,30,0.9)', border: 'rgba(98,101,108,0.9)' },
    1: { background: 'rgba(26,27,30,0.9)', border: 'rgba(118,147,124,0.75)' },
    2: { background: 'rgba(26,27,30,0.9)', border: 'rgba(118,147,124,0.82)' },
    3: { background: 'rgba(26,27,30,0.9)', border: 'rgba(118,147,124,0.9)' },
    4: { background: 'rgba(26,27,30,0.92)', border: 'rgba(118,147,124,1)' },
  };
  const SENSITIVITY_TOGGLE_ID = 'mw-sensitivity-toggle';
  const SENSITIVITY_TOGGLE_STYLE_ID = 'mw-sensitivity-toggle-style';
  const OWNED_CARD_STYLE_ID = 'mw-owned-card-style';
  const OWNED_POSITIVE_CARD_CLASS = 'mw-owned-positive-card';
  const OWNED_SAFE_CARD_CLASS = 'mw-owned-safe-card';

  function getSensitivityLabel(level) {
    return SENSITIVITY_LABELS[level] || 'Moderate';
  }

  function getSensitivityAccent(level) {
    return SENSITIVITY_ACCENTS[level] || SENSITIVITY_ACCENTS[2];
  }

  function updateSensitivityToggleButton(button) {
    if (!button) return;
    const level = CONFIG.sensitivity;
    const labelSpan = button.querySelector('.mw-sensitivity-label');
    if (labelSpan) {
      labelSpan.textContent = getSensitivityLabel(level);
    }
    const accent = getSensitivityAccent(level);
    button.style.background = accent.background;
    button.style.borderColor = accent.border;
    button.setAttribute('aria-label', 'Shield Strength / Filter Intensity: ' + getSensitivityLabel(level));
    button.dataset.mwSensitivityLevel = String(level);
  }

  function ensureSensitivityToggleStyle() {
    if (document.getElementById(SENSITIVITY_TOGGLE_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = SENSITIVITY_TOGGLE_STYLE_ID;
    style.textContent = "#".concat(SENSITIVITY_TOGGLE_ID, " { ") +
      " position: fixed; " +
      " bottom: 18px; " +
      " right: 18px; " +
      " z-index: 2147483647; " +
      " display: inline-flex; " +
      " align-items: center; " +
      " gap: 8px; " +
      " padding: 10px 14px; " +
      " border-radius: 999px; " +
      " border: 1px solid rgba(118,147,124,0.85); " +
      " color: #E0E0E0; " +
      " background: rgba(26,27,30,0.82); " +
      " box-shadow: 0 10px 24px rgba(0,0,0,0.35); " +
      " backdrop-filter: blur(8px); " +
      " -webkit-backdrop-filter: blur(8px); " +
      " font-weight: 600; " +
      " } " +
      "#".concat(SENSITIVITY_TOGGLE_ID, " .mw-sensitivity-icon { font-size: 16px; line-height: 1; } ") +
      "#".concat(SENSITIVITY_TOGGLE_ID, " .mw-sensitivity-label { color: #E0E0E0; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; } ");
    (document.head || document.documentElement || document.body || document.documentElement).appendChild(style);
  }

  function ensureOwnedCardStyle() {
    if (document.getElementById(OWNED_CARD_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = OWNED_CARD_STYLE_ID;
    style.textContent = [
      '.' + OWNED_POSITIVE_CARD_CLASS + ' { position: relative !important; }',
      '.' + OWNED_POSITIVE_CARD_CLASS + ' img,',
      '.' + OWNED_POSITIVE_CARD_CLASS + ' video,',
      '.' + OWNED_POSITIVE_CARD_CLASS + ' yt-image img,',
      '.' + OWNED_POSITIVE_CARD_CLASS + ' yt-img-shadow img,',
      '.' + OWNED_POSITIVE_CARD_CLASS + ' .yt-core-image,',
      '.' + OWNED_POSITIVE_CARD_CLASS + ' [style*="background-image"] {',
      'filter: blur(40px) !important;',
      '-webkit-filter: blur(40px) !important;',
      'backdrop-filter: blur(40px) !important;',
      '-webkit-backdrop-filter: blur(40px) !important;',
      '}',
      '.' + OWNED_POSITIVE_CARD_CLASS + '::after {',
      'content: "" !important;',
      'position: absolute !important;',
      'top: 0 !important;',
      'left: 0 !important;',
      'right: 0 !important;',
      'height: 0 !important;',
      'padding-bottom: 56.25% !important;',
      'pointer-events: none !important;',
      'background: rgba(0,0,0,0.08) !important;',
      'z-index: 2 !important;',
      '}',
      '.' + OWNED_SAFE_CARD_CLASS + ',',
      '.' + OWNED_SAFE_CARD_CLASS + '::after {',
      'background: transparent !important;',
      '}',
      '.' + OWNED_SAFE_CARD_CLASS + ' img,',
      '.' + OWNED_SAFE_CARD_CLASS + ' video,',
      '.' + OWNED_SAFE_CARD_CLASS + ' yt-image img,',
      '.' + OWNED_SAFE_CARD_CLASS + ' yt-img-shadow img,',
      '.' + OWNED_SAFE_CARD_CLASS + ' .yt-core-image,',
      '.' + OWNED_SAFE_CARD_CLASS + ' [style*="background-image"] {',
      'filter: none !important;',
      '-webkit-filter: none !important;',
      'backdrop-filter: none !important;',
      '-webkit-backdrop-filter: none !important;',
      '}',
    ].join('');
    (document.head || document.documentElement || document.body || document.documentElement).appendChild(style);
  }

  // ==================== FLASH SHIELD V1 (additive only on sacred baseline) ====================
  // FREEZE-OVERRIDE: new independent frosted glass pre-paint veil system.
  // No modifications to frozen function *bodies* (createRevealOverlay, diagNonShortsReattach, isMvpBlurAuthorized, resolveShortsStableBlurTarget, etc.).
  // Only new functions + additive call sites.
  // Controlled solely by flashShieldV1 (from host flash_shield_enabled).
  // Frosted aesthetic: backdrop-filter + saturate + rgba tint (from Liquid Glass/overlay history) + filter blur for speed/compatibility.
  // Targets: all YT thumbnails (home/search/results/shelf), active Shorts reel containers (for iOS), Google images.
  // <200ms on active Shorts: immediate calls in forceFirstEntry + reentry (best from mvp.2 + mvp.1).
  // Safe: clear instantly via moderated clear CSS.
  // Positive: keep frosted veil + additive call to frozen createRevealOverlay for button.
  // Separation: flag only; no touch to sensitivity, thresholds, main apply logic. Works at dial=0.

  function ensureFlashShieldStyle() {
    if (document.getElementById(FLASH_SHIELD_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = FLASH_SHIELD_STYLE_ID;
    style.textContent = [
      'html.' + FLASH_SHIELD_CLASS + ' [data-mw-veil="1"]:not([data-mw-moderated="safe"]):not([data-mw-moderated="revealed"]):not([data-mw-moderated="timeout-safe"]) {',
      '  filter: blur(20px) saturate(0.72) brightness(0.94) !important;',
      '  -webkit-filter: blur(20px) saturate(0.72) brightness(0.94) !important;',
      '  backdrop-filter: blur(22px) saturate(0.82) !important;',
      '  -webkit-backdrop-filter: blur(22px) saturate(0.82) !important;',
      '}',
      'html.' + FLASH_SHIELD_CLASS + ' #shorts-player video[data-mw-veil="1"]:not([data-mw-moderated="safe"]):not([data-mw-moderated="revealed"]):not([data-mw-moderated="timeout-safe"]),',
      'html.' + FLASH_SHIELD_CLASS + ' ytm-reel-video-renderer video[data-mw-veil="1"]:not([data-mw-moderated="safe"]):not([data-mw-moderated="revealed"]):not([data-mw-moderated="timeout-safe"]),',
      'html.' + FLASH_SHIELD_CLASS + ' ytd-reel-video-renderer video[data-mw-veil="1"]:not([data-mw-moderated="safe"]):not([data-mw-moderated="revealed"]):not([data-mw-moderated="timeout-safe"]) {',
      '  filter: blur(24px) saturate(0.72) brightness(0.92) !important;',
      '  -webkit-filter: blur(24px) saturate(0.72) brightness(0.92) !important;',
      '}',
      'html.' + FLASH_SHIELD_CLASS + ' [data-mw-flash-frame="1"] {',
      '  position: relative !important;',
      '  isolation: isolate !important;',
      '}',
      'html.' + FLASH_SHIELD_CLASS + ' .' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS + ' {',
      '  position: absolute !important;',
      '  inset: 0 !important;',
      '  display: block !important;',
      '  pointer-events: none !important;',
      '  z-index: 2147483000 !important;',
      '  backdrop-filter: blur(22px) saturate(0.82) !important;',
      '  -webkit-backdrop-filter: blur(22px) saturate(0.82) !important;',
      '  background: rgba(8,8,10,0.22) !important;',
      /* C1/P4: pending-veil release must read as a deliberate fade, not a snap. */
      '  transition: opacity 200ms ease !important;',
      '}',
      'html.' + FLASH_SHIELD_CLASS + ' [data-mw-moderated="safe"] > .' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS + ',',
      'html.' + FLASH_SHIELD_CLASS + ' [data-mw-moderated="revealed"] > .' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS + ',',
      'html.' + FLASH_SHIELD_CLASS + ' [data-mw-moderated="timeout-safe"] > .' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS + ' {',
      '  opacity: 0 !important;',
      '  pointer-events: none !important;',
      '}',
      'html.' + FLASH_SHIELD_CLASS + ' [data-mw-moderated="safe"] [data-mw-veil="1"],',
      'html.' + FLASH_SHIELD_CLASS + ' [data-mw-moderated="revealed"] [data-mw-veil="1"],',
      'html.' + FLASH_SHIELD_CLASS + ' [data-mw-moderated="timeout-safe"] [data-mw-veil="1"],',
      'html.' + FLASH_SHIELD_CLASS + ' [data-mw-veil="1"][data-mw-moderated="safe"],',
      'html.' + FLASH_SHIELD_CLASS + ' [data-mw-veil="1"][data-mw-moderated="revealed"],',
      'html.' + FLASH_SHIELD_CLASS + ' [data-mw-veil="1"][data-mw-moderated="timeout-safe"] {',
      '  filter: none !important;',
      '  -webkit-filter: none !important;',
      '  backdrop-filter: none !important;',
      '  -webkit-backdrop-filter: none !important;',
      '}',
    ].join('');
    (document.head || document.documentElement || document.body || document.documentElement).appendChild(style);
  }

  function markFlashShieldCandidates(root) {
    if (!CONFIG.flashShieldV1) return;
    try {
      const scope = root || document;
      const selector = (
        'yt-lockup-view-model img, yt-lockup-view-model-wiz img, ytm-rich-item-renderer img, ' +
        'ytm-media-item img, ytm-shorts-lockup-view-model img, .yt-core-image, yt-image img, ' +
        'img[src*="googleusercontent"], .g-img img'
      );
      const imgs = [];
      if (scope.nodeType === 1 && typeof scope.matches === 'function' && scope.matches(selector)) {
        imgs.push(scope);
      }
      if (typeof scope.querySelectorAll === 'function') {
        scope.querySelectorAll(selector).forEach(function(img) { imgs.push(img); });
      }
      for (let i = 0; i < imgs.length; i += 1) {
        const img = imgs[i];
        if (!img || img.dataset.mwVeil === '1') continue;
        if (img.hasAttribute('data-mw-moderated')) continue;
        const rect = img.getBoundingClientRect();
        if (rect.width >= 120 && rect.height >= 60) {
          img.dataset.mwVeil = '1';
        }
      }
    } catch (e) {}
  }

  function getFlashShieldActiveShortsFrame() {
    if (!isShortsModeActive()) return null;
    const selectors = [
      '#shorts-player ytm-reel-video-renderer[selected]',
      '#shorts-player ytm-reel-video-renderer[is-active]',
      '#shorts-player ytm-reel-video-renderer[aria-hidden="false"]',
      '#shorts-player ytm-reel-video-renderer[aria-current="true"]',
      '#shorts-player ytm-shorts-lockup-view-model-v2[selected]',
      '#shorts-player ytm-shorts-lockup-view-model-v2[is-active]',
      '#shorts-player ytm-shorts-lockup-view-model-v2[aria-hidden="false"]',
      '#shorts-player ytm-shorts-lockup-view-model[selected]',
      '#shorts-player ytm-shorts-lockup-view-model[is-active]',
      '#shorts-player ytd-reel-video-renderer[is-active]',
      'ytm-reel-video-renderer[selected]',
      'ytm-reel-video-renderer[is-active]',
      'ytm-reel-video-renderer[aria-hidden="false"]',
      'ytm-shorts-lockup-view-model-v2[is-active]',
      'ytm-shorts-lockup-view-model[is-active]',
      'ytd-reel-video-renderer[is-active]',
      '#shorts-player ytm-reel-video-renderer',
      '#shorts-player ytd-reel-video-renderer',
      '#shorts-player ytm-shorts-lockup-view-model-v2',
      '#shorts-player ytm-shorts-lockup-view-model',
      '#player-container',
      '#shorts-player',
    ];
    for (let i = 0; i < selectors.length; i += 1) {
      const frame = document.querySelector(selectors[i]);
      if (
        frame &&
        frame.isConnected &&
        typeof frame.querySelector === 'function' &&
        frame.querySelector('video, img')
      ) {
        return frame;
      }
    }
    return null;
  }

  function getFlashShieldShortsIdentity(frame, media) {
    // C1/P1: Identity must be stable for the lifetime of one active Short. The
    // media source (poster -> blob/stream, quality swaps) changes during NORMAL
    // playback of the SAME Short; including it made every source churn look
    // like a new Short, wiping the verdict and re-veiling mid-playback (the
    // full-screen blur flash). Only the Shorts URL id and the player's own
    // video/item id may participate.
    const shortsId = getCurrentShortsUrlId() || 'none';
    const mediaId = media && media.getAttribute
      ? String(media.getAttribute('data-video-id') || media.getAttribute('data-item-id') || '')
      : '';
    const frameId = frame && frame.getAttribute
      ? String(frame.getAttribute('data-video-id') || frame.getAttribute('data-item-id') || frame.getAttribute('data-id') || '')
      : '';
    return [shortsId, mediaId || frameId || 'none'].join('|');
  }

  function ensureFlashShieldShortsOverlay(frame, identity) {
    if (!frame || !frame.isConnected) return null;
    let overlay = null;
    for (let i = 0; i < frame.children.length; i += 1) {
      const child = frame.children[i];
      if (
        child.classList &&
        child.classList.contains(FLASH_SHIELD_SHORTS_OVERLAY_CLASS) &&
        child.dataset.mwVeilReleasing !== '1'
      ) {
        overlay = child;
        break;
      }
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = FLASH_SHIELD_SHORTS_OVERLAY_CLASS;
      overlay.setAttribute('aria-hidden', 'true');
      frame.appendChild(overlay);
    }
    overlay.dataset.mwFlashIdentity = identity;
    return overlay;
  }

  // C1/P4: Fade the pending veil out over 200ms, then remove the node. A
  // releasing overlay is marked so candidate passes create a fresh overlay for
  // the next Short instead of reusing a transparent one.
  function fadeOutAndRemoveFlashShortsOverlay(overlay) {
    if (!overlay || overlay.nodeType !== 1) return;
    try {
      overlay.dataset.mwVeilReleasing = '1';
      overlay.style.setProperty('opacity', '0', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
      setTimeout(function() {
        try {
          if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
        } catch (e) {}
      }, 240);
    } catch (e) {
      try { overlay.remove(); } catch (e2) {}
    }
  }

  function markFlashShieldShortsCandidate() {
    if (!CONFIG.flashShieldV1 || !isShortsModeActive()) {
      warnProfileOriginShortsDiag(
        'flash_shield_shorts_candidate_blocked',
        'flashShieldV1=' + String(!!CONFIG.flashShieldV1) +
        ' reason=' + (!CONFIG.flashShieldV1 ? 'flash_disabled' : 'shorts_mode_inactive')
      );
      return;
    }
    try {
      // FREEZE-OVERRIDE: additive active-player shield based on the March sovereign
      // targeting pattern. Frozen moderation, applyBlur, and reveal bodies are untouched.
      const frame = getFlashShieldActiveShortsFrame();
      if (!frame) {
        warnProfileOriginShortsDiag('flash_shield_no_active_frame', 'reason=no_frame');
        return;
      }
      const media = frame.querySelector('video.html5-main-video, video, img');
      if (!media) {
        warnProfileOriginShortsDiag(
          'flash_shield_no_media',
          'frameNodeId=' + getDiagNodeId(frame) + ' frameTag=' + String(frame.tagName || 'unknown')
        );
        return;
      }
      const identity = getFlashShieldShortsIdentity(frame, media);
      const previousIdentity = String(frame.dataset.mwFlashIdentity || '');
      // C1/P1: Verdicts may only be wiped when the SHORT itself changed (URL
      // id segment), never for identity drift within the same Short — wiping
      // a resolved verdict mid-playback re-veils the whole player (blur flash).
      const previousShortsId = previousIdentity ? previousIdentity.split('|')[0] : '';
      const currentShortsId = identity.split('|')[0];
      if (previousIdentity && previousIdentity !== identity && previousShortsId !== currentShortsId) {
        frame.removeAttribute('data-mw-moderated');
        frame.removeAttribute('data-mw-flash-positive');
        media.removeAttribute('data-mw-moderated');
        media.removeAttribute('data-mw-preblur-clear');
        media.removeAttribute('data-mw-flash-positive');
        clearAuthoritativeHardBlur(frame);
        clearAuthoritativeHardBlur(media);
      }
      document.querySelectorAll('[data-mw-flash-frame="1"]').forEach(function(node) {
        if (node !== frame) node.removeAttribute('data-mw-flash-frame');
      });
      frame.dataset.mwFlashIdentity = identity;
      frame.dataset.mwFlashFrame = '1';
      media.dataset.mwFlashIdentity = identity;
      // C1/P1: Veil + overlay may only cover the unresolved window. Re-adding
      // them to an already-resolved Short re-covers the player after release.
      const mediaVerdict = String(media.dataset.mwModerated || frame.dataset.mwModerated || '');
      const hasResolvedVerdict =
        mediaVerdict === 'blurred' ||
        mediaVerdict === 'safe' ||
        mediaVerdict === 'revealed' ||
        mediaVerdict === 'timeout-safe';
      if (!hasResolvedVerdict) {
        // C1/E1: this Short was already resolved safe-class by this instance —
        // stamp the verdict instead of re-veiling known content.
        const rememberedVerdict = flashShieldShortsVerdictMemory.get(currentShortsId);
        if (rememberedVerdict === 'safe' || rememberedVerdict === 'timeout-safe') {
          media.dataset.mwModerated = rememberedVerdict;
          frame.dataset.mwModerated = rememberedVerdict;
          frame.querySelectorAll(':scope > .' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS).forEach(function(leftover) {
            if (leftover.dataset.mwVeilReleasing !== '1') fadeOutAndRemoveFlashShortsOverlay(leftover);
          });
        } else {
          if (!media.dataset.mwVeilAt) media.dataset.mwVeilAt = String(Date.now());
          media.dataset.mwVeil = '1';
          ensureFlashShieldShortsOverlay(frame, identity);
          armShortsVeilTimeout(identity);
        }
      }
      warnProfileOriginShortsDiag(
        'flash_shield_engaged',
        'identity=' + String(identity || 'none').substring(0, 220) +
        ' frameNodeId=' + getDiagNodeId(frame) +
        ' mediaNodeId=' + getDiagNodeId(media),
        { throttleMs: 3000 }
      );
    } catch (e) {}
  }

  // C1/E3: DIAG-gated veil lifetime log on every release path — on-device
  // disambiguation of any residual veil blip.
  function diagLogVeilLifetime(media, reason) {
    try {
      const veiledAt = Number(media && media.dataset && media.dataset.mwVeilAt);
      if (media && media.removeAttribute) media.removeAttribute('data-mw-veil-at');
      if (!DIAG_ENABLED && !DIAG_YT_BLUR) return;
      if (!Number.isFinite(veiledAt) || veiledAt <= 0) return;
      console.log(
        '[DIAG][FLASH_SHIELD] veil_lifetime_ms',
        'ms=' + (Date.now() - veiledAt),
        'reason=' + (reason || 'unknown')
      );
    } catch (e) {}
  }

  // C1/P3: Bounded stuck-veil escape hatch — if the active Short's veil never
  // resolves (classification lost), stamp timeout-safe; the existing veil CSS
  // releases on that state, so a full-screen blur can never persist without a
  // reveal path (AGENTS.md section 2). One replace-on-rearm timer, no intervals.
  function armShortsVeilTimeout(identity) {
    if (!CONFIG.flashShieldV1 || timerState.teardownDone) return;
    if (timerState.shortsVeilTimeoutTimer && timerState.shortsVeilTimeoutIdentity === identity) return;
    if (timerState.shortsVeilTimeoutTimer) {
      clearTimeout(timerState.shortsVeilTimeoutTimer);
      timerState.shortsVeilTimeoutTimer = null;
    }
    timerState.shortsVeilTimeoutIdentity = identity;
    timerState.shortsVeilTimeoutTimer = setTimeout(function() {
      timerState.shortsVeilTimeoutTimer = null;
      const armedIdentity = timerState.shortsVeilTimeoutIdentity;
      timerState.shortsVeilTimeoutIdentity = '';
      if (!CONFIG.flashShieldV1 || timerState.teardownDone || !isShortsModeActive()) return;
      const frame = getFlashShieldActiveShortsFrame();
      if (!frame || !frame.isConnected) return;
      const media = frame.querySelector('video.html5-main-video, video, img');
      if (!media || !media.isConnected) return;
      if (getFlashShieldShortsIdentity(frame, media) !== armedIdentity) return;
      const verdict = String(media.dataset.mwModerated || frame.dataset.mwModerated || '');
      if (verdict) return;
      const stillVeiled =
        media.dataset.mwVeil === '1' ||
        !!(frame.querySelector && frame.querySelector(':scope > .' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS));
      if (!stillVeiled) return;
      diagLogVeilLifetime(media, 'timeout_release');
      media.dataset.mwModerated = 'timeout-safe';
      frame.dataset.mwModerated = 'timeout-safe';
      media.removeAttribute('data-mw-veil');
      frame.querySelectorAll(':scope > .' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS).forEach(function(overlay) {
        if (overlay.dataset.mwVeilReleasing !== '1') fadeOutAndRemoveFlashShortsOverlay(overlay);
      });
      rememberShortsVerdict(armedIdentity.split('|')[0], 'timeout-safe');
      console.log('[DIAG][FLASH_SHIELD] shorts_veil_timeout_release', 'identity=' + armedIdentity);
    }, FLASH_SHIELD_SHORTS_VEIL_TIMEOUT_MS);
    timerLog('start', 'shortsVeilTimeout');
  }

  function scheduleFlashShieldShortsBurst(reason) {
    if (!CONFIG.flashShieldV1 || !isShortsModeActive() || timerState.teardownDone) return;
    // FREEZE-OVERRIDE: bounded first-paint and node-reuse sweeps, all inside 200ms.
    [0, 16, 50, 120, 180].forEach(function(delayMs) {
      setTimeout(function() {
        if (!CONFIG.flashShieldV1 || timerState.teardownDone || !isShortsModeActive()) return;
        markFlashShieldShortsCandidate();
      }, delayMs);
    });
  }

  const diagFlashReleaseCounters = {
    fallback_used: 0,
    missed_disconnected: 0,
  };

  // C1/P2: Identity-matched live-frame fallback — a verdict whose element was
  // swapped out mid-classification (reel recycle) otherwise lands on a
  // disconnected node and the LIVE player keeps its veil forever; a pending
  // veil has no reveal path, so a missed release is an inescapable
  // full-screen blur (AGENTS.md section 2). Only a live frame whose veil
  // identity matches the dead element's may be released; a mismatch means the
  // verdict belongs to a different Short and releasing would expose
  // unclassified content.
  function maybeReleaseFlashShieldVeilForLiveFrame(deadElement, nextState) {
    if (!CONFIG.flashShieldV1 || !isShortsModeActive()) return false;
    try {
      const liveFrame = getFlashShieldActiveShortsFrame();
      if (!liveFrame || !liveFrame.isConnected) return false;
      const liveMedia = liveFrame.querySelector('video.html5-main-video, video, img');
      if (!liveMedia || !liveMedia.isConnected) return false;
      const liveVerdict = String(liveMedia.dataset.mwModerated || liveFrame.dataset.mwModerated || '');
      if (liveVerdict) return false;
      const stillVeiled =
        liveMedia.dataset.mwVeil === '1' ||
        !!liveFrame.querySelector(':scope > .' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS);
      if (!stillVeiled) return false;
      const deadIdentity = String((deadElement.dataset && deadElement.dataset.mwFlashIdentity) || '');
      const liveIdentity = getFlashShieldShortsIdentity(liveFrame, liveMedia);
      if (!deadIdentity || deadIdentity !== liveIdentity) {
        diagFlashReleaseCounters.missed_disconnected += 1;
        if (DIAG_ENABLED || DIAG_YT_BLUR) {
          console.log(
            '[DIAG][FLASH_SHIELD] release_fallback_identity_mismatch',
            'dead=' + (deadIdentity || 'none'),
            'live=' + liveIdentity,
            'missedCount=' + diagFlashReleaseCounters.missed_disconnected
          );
        }
        return false;
      }
      diagLogVeilLifetime(liveMedia, 'fallback_' + nextState);
      liveMedia.dataset.mwModerated = nextState;
      liveFrame.dataset.mwModerated = nextState;
      liveMedia.removeAttribute('data-mw-veil');
      liveFrame.querySelectorAll(':scope > .' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS).forEach(function(overlay) {
        if (overlay.dataset.mwVeilReleasing !== '1') fadeOutAndRemoveFlashShortsOverlay(overlay);
      });
      rememberShortsVerdict(liveIdentity.split('|')[0], nextState);
      diagFlashReleaseCounters.fallback_used += 1;
      if (DIAG_ENABLED || DIAG_YT_BLUR) {
        console.log(
          '[DIAG][FLASH_SHIELD] release_fallback_used',
          'identity=' + liveIdentity,
          'nextState=' + nextState,
          'usedCount=' + diagFlashReleaseCounters.fallback_used
        );
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function clearFlashShieldResolution(element, nextState) {
    if (!CONFIG.flashShieldV1 || !element || element.nodeType !== 1) return;
    try {
      const resolved = isShortsModeActive() ? resolveShortsStableBlurTarget(element, element.dataset.mwSrc || '') : null;
      const target = resolved && resolved.target && resolved.target.isConnected ? resolved.target : element;
      target.dataset.mwModerated = nextState;
      target.removeAttribute('data-mw-flash-frame');
      if (typeof target.querySelectorAll === 'function') {
        target.querySelectorAll(':scope > .' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS).forEach(function(overlay) {
          if (overlay.dataset.mwVeilReleasing !== '1') fadeOutAndRemoveFlashShortsOverlay(overlay);
        });
      }
      if (target.dataset.mwFlashPositive === '1') {
        target.removeAttribute('data-mw-flash-positive');
        clearAuthoritativeHardBlur(target);
      }
      const veiled = [];
      if (target.dataset.mwVeil === '1') veiled.push(target);
      if (typeof target.querySelectorAll === 'function') {
        target.querySelectorAll('[data-mw-veil="1"]').forEach(function(node) { veiled.push(node); });
      }
      veiled.forEach(function(node) {
        node.dataset.mwModerated = nextState;
      });
      // C1/E2: stamp the element's own flash frame too — a media node swapped
      // in after release would otherwise see an unstamped frame and re-veil.
      const flashFrame = (typeof element.closest === 'function')
        ? element.closest('[data-mw-flash-frame="1"]')
        : null;
      if (flashFrame && flashFrame.dataset) flashFrame.dataset.mwModerated = nextState;
      if (nextState === 'safe' || nextState === 'timeout-safe') {
        diagLogVeilLifetime(element, 'resolution_' + nextState);
        const identitySeed = String(
          (element.dataset && element.dataset.mwFlashIdentity) ||
          (flashFrame && flashFrame.dataset && flashFrame.dataset.mwFlashIdentity) ||
          ''
        );
        rememberShortsVerdict(
          identitySeed ? identitySeed.split('|')[0] : (getCurrentShortsUrlId() || ''),
          nextState
        );
      }
      if (
        (nextState === 'safe' || nextState === 'timeout-safe') &&
        (!element.isConnected || !target.isConnected)
      ) {
        maybeReleaseFlashShieldVeilForLiveFrame(element, nextState);
      }
    } catch (e) {}
  }

  function disableFlashShieldRuntime() {
    document.documentElement.classList.remove(FLASH_SHIELD_CLASS);
    document.querySelectorAll('[data-mw-flash-positive="1"]').forEach(function(node) {
      clearAllBlurAndOverlay(
        node,
        String(node.dataset.mwSrc || ''),
        'flash_shield_disabled',
        'safe'
      );
      node.removeAttribute('data-mw-flash-positive');
    });
    document.querySelectorAll('[data-mw-veil="1"]').forEach(function(node) {
      node.removeAttribute('data-mw-veil');
    });
    document.querySelectorAll('[data-mw-flash-frame="1"]').forEach(function(node) {
      node.removeAttribute('data-mw-flash-frame');
    });
    document.querySelectorAll('.' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS).forEach(function(node) {
      node.remove();
    });
  }

  // FREEZE-OVERRIDE: additive Flash-only positive state. This intentionally does not call
  // applyBlur or alter sensitivity/thresholds; it preserves the frosted veil and delegates
  // reveal UI creation to the existing frozen createRevealOverlay implementation.
  function applyFlashShieldPositive(element, src, category, itemId) {
    if (!isVisualModerationActive()) return false;
    if (!CONFIG.flashShieldV1 || !element || element.nodeType !== 1) return false;
    try {
      let target = element;
      let stableSelector = '';
      if (isShortsModeActive()) {
        const stableResolution = resolveShortsStableBlurTarget(element, src);
        if (stableResolution && stableResolution.target && stableResolution.target.isConnected) {
          target = stableResolution.target;
          stableSelector = stableResolution.selectorUsed || '';
        }
      }
      target.dataset.mwModerated = 'blurred';
      target.dataset.mwFlashPositive = '1';
      target.dataset.mwCategory = category || 'flagged';
      target.dataset.mwSrc = src || '';
      target.dataset.mwItemId = itemId || '';
      markAuthoritativeHardBlur(target, src);
      if (isShortsModeActive()) {
        target.dataset.mwFlashFrame = '1';
        setShortsBlurContextForNode(
          target,
          src,
          category || 'flagged',
          itemId,
          24,
          stableSelector || null,
          'flash_shield_positive'
        );
      }
      createRevealOverlay(target, src, category || 'flagged', itemId, false);
      if (isShortsModeActive() && target.isConnected && !findRevealOverlayForElement(target, src)) {
        scheduleActiveShortsRevealPairingBurst(
          target,
          src || '',
          category || 'flagged',
          itemId || '',
          'flash_shield_positive_orphan'
        );
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function healFlashShieldReveal(reason) {
    if (!CONFIG.flashShieldV1) return;
    try {
      const nodes = document.querySelectorAll('[data-mw-flash-positive="1"][data-mw-moderated="blurred"]');
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        const src = String(node.dataset.mwSrc || '');
        if (!node.isConnected || findRevealOverlayForElement(node, src)) continue;
        createRevealOverlay(
          node,
          src,
          String(node.dataset.mwCategory || 'flagged'),
          String(node.dataset.mwItemId || ''),
          false
        );
      }
    } catch (e) {}
  }

  function ensureSensitivityToggle() {
    ensureSensitivityToggleStyle();
    // Prefer documentElement so YouTube body SPA swaps do not destroy the control.
    const hostRoot = document.documentElement || document.body;
    if (!hostRoot) {
      requestAnimationFrame(ensureSensitivityToggle);
      return;
    }
    let button = document.getElementById(SENSITIVITY_TOGGLE_ID);
    if (button && button.isConnected) {
      updateSensitivityToggleButton(button);
      return;
    }
    if (button && !button.isConnected) {
      try {
        hostRoot.appendChild(button);
        updateSensitivityToggleButton(button);
        return;
      } catch (eRe) {
        try { button.remove(); } catch (eRm) {}
        button = null;
      }
    }
    button = document.createElement('button');
    button.type = 'button';
    button.id = SENSITIVITY_TOGGLE_ID;
    button.setAttribute('aria-live', 'polite');
    button.className = 'mw-sensitivity-toggle';
    const icon = document.createElement('span');
    icon.className = 'mw-sensitivity-icon';
    icon.textContent = '🛡';
    const label = document.createElement('span');
    label.className = 'mw-sensitivity-label';
    button.appendChild(icon);
    button.appendChild(label);
    button.addEventListener('click', () => {
      cycleSensitivityLevel();
    });
    hostRoot.appendChild(button);
    updateSensitivityToggleButton(button);
  }

  function cycleSensitivityLevel() {
    const nextLevel = (CONFIG.sensitivity + 1) % 5;
    applySensitivityLevel(nextLevel, 'floating_toggle_cycle');
  }

  // FREEZE-OVERRIDE (accuracy): immediately apply dial thr to already-stamped nodes
  // using stored mw*Score datasets so dial-down unblurs without waiting for host.
  // Active Shorts: host-stamped positives never score-released; provisional uncertain
  // always released for frame re-sample; dial-only uses a higher sexy keep-bar.
  function reevaluateStampedNodesForDial(reason) {
    const inShorts = isShortsModeActive();
    const thr = inShorts
      ? getActiveShortsThresholds()
      : (effectiveThresholds || getThresholdsForLevel(CONFIG.sensitivity || 0));
    // Shorts dial-only keep bar: require stronger sexy than bare dial thr (FP stability).
    const sexyKeep = inShorts
      ? Math.max(Number(thr.sexy) || 0, 0.72)
      : Number(thr.sexy) || 0;
    let released = 0;
    let kept = 0;
    let skipped = 0;
    try {
      const nodes = document.querySelectorAll(
        '[data-mw-moderated="blurred"][data-mw-src], .mw-blurred[data-mw-src]'
      );
      for (let i = 0; i < nodes.length; i += 1) {
        const el = nodes[i];
        if (!el || el.nodeType !== 1 || !el.isConnected) continue;
        if (String(el.dataset.mwModerated || '') === 'revealed') continue;
        const src = String(el.dataset.mwSrc || '');
        // Provisional empty-frame blurs are not accuracy truth — always release on dial churn.
        if (el.dataset.mwProvisionalUncertain === '1' || el.dataset.mwDialOnlyBlur === '1') {
          const pornP = toFiniteNumber(el.dataset.mwPornScore);
          const sexyP = toFiniteNumber(el.dataset.mwSexyScore);
          const hentaiP = toFiniteNumber(el.dataset.mwHentaiScore);
          const strongKeep =
            (pornP !== null && pornP > Number(thr.porn)) ||
            (hentaiP !== null && hentaiP > Number(thr.hentai)) ||
            (sexyP !== null && sexyP > sexyKeep);
          if (!strongKeep || el.dataset.mwProvisionalUncertain === '1') {
            try {
              clearAllBlurAndOverlay(el, src, 'dial_reeval_provisional_or_weak_dial:' + (reason || 'unknown'), 'safe');
              released += 1;
            } catch (e) {
              skipped += 1;
            }
            continue;
          }
        }
        // Host-stamped Shorts positives: dial score reeval must not strip them.
        if (inShorts && (el.dataset.mwHostBlur === '1' || el.dataset.mwForceUnsafe === '1')) {
          kept += 1;
          continue;
        }
        const porn = toFiniteNumber(el.dataset.mwPornScore);
        const sexy = toFiniteNumber(el.dataset.mwSexyScore);
        const hentai = toFiniteNumber(el.dataset.mwHentaiScore);
        if (porn === null && sexy === null && hentai === null) {
          // No scores: home may skip; Shorts dial-only without scores → release.
          if (inShorts && el.dataset.mwHostBlur !== '1') {
            try {
              clearAllBlurAndOverlay(el, src, 'dial_reeval_no_scores_shorts:' + (reason || 'unknown'), 'safe');
              released += 1;
            } catch (e) {
              skipped += 1;
            }
          } else {
            skipped += 1;
          }
          continue;
        }
        const hit =
          (porn !== null && porn > Number(thr.porn)) ||
          (hentai !== null && hentai > Number(thr.hentai)) ||
          (sexy !== null && sexy > (inShorts ? sexyKeep : Number(thr.sexy)));
        if (!hit) {
          try {
            clearAllBlurAndOverlay(el, src, 'dial_reeval_safe:' + (reason || 'unknown'), 'safe');
            released += 1;
          } catch (e) {
            skipped += 1;
          }
        } else {
          kept += 1;
        }
      }
    } catch (e) {}
    console.log(
      '[MW][DIAL_REEVAL]',
      'reason=' + (reason || 'unknown'),
      'shorts=' + inShorts,
      'thr=' + JSON.stringify(thr),
      'sexyKeep=' + sexyKeep,
      'released=' + released,
      'kept=' + kept,
      'skippedNoScores=' + skipped
    );
    return { released: released, kept: kept, skipped: skipped };
  }

  // FREEZE-OVERRIDE (accuracy): dial must retune live. Host slider previously
  // reinjected into MW_ALREADY_ACTIVE without updating CONFIG, so Relaxed≈Maximum.
  // Clear discovery dedupe + rescan with new effectiveThresholds on every change.
  function applySensitivityLevel(level, reason) {
    const normalized = Math.min(4, Math.max(0, Math.round(level)));
    const force = String(reason || '').indexOf('host_dial') === 0 || String(reason || '').indexOf('force_') === 0;
    if (!force && normalized === CONFIG.sensitivity && (normalized > 0) === CONFIG.enabled) {
      return;
    }
    const previousLevel = CONFIG.sensitivity;
    CONFIG.sensitivity = normalized;
    CONFIG.enabled = normalized > 0;
    CONFIG.scanEnabled = CONFIG.enabled || CONFIG.flashShieldV1;
    effectiveThresholds = getThresholdsForLevel(
      normalized > 0 ? normalized : (CONFIG.flashShieldV1 ? FLASH_SHIELD_SCAN_LEVEL : 0)
    );
    const toggle = document.getElementById(SENSITIVITY_TOGGLE_ID);
    if (toggle) {
      updateSensitivityToggleButton(toggle);
    }
    // Discovery cache is thr-agnostic — without clearing, dial changes never re-queue.
    try {
      if (state && state.scanned && typeof state.scanned.clear === 'function') {
        state.scanned.clear();
      }
    } catch (e) {}
    console.log(
      '[MW] Filter Intensity set to',
      normalized,
      'label=' + getSensitivityLabel(normalized),
      'prev=' + previousLevel,
      'thr=' + JSON.stringify(effectiveThresholds),
      'reason=' + (reason || 'toggle')
    );
    if (normalized === 0) {
      try {
        if (typeof cleanupBloomGuardVisualModeration === 'function') {
          cleanupBloomGuardVisualModeration('sensitivity_off');
        }
      } catch (e) {}
      // Keep floating dial visible so Off is not a dead-end UI.
      try { ensureSensitivityToggle(); } catch (eTog0) {}
    } else {
      // FREEZE-OVERRIDE (P0 Off→On): Off cleanup sets offModeVisualCleanupActive=true
      // and never cleared it. Happy-path dial (already On) only hits this when the
      // latch is false — reeval/Shorts frame paths below are unchanged.
      if (offModeVisualCleanupActive) {
        offModeVisualCleanupActive = false;
        CONFIG.scanEnabled = true;
        console.log(
          '[DIAG][OFF_MODE] reenable_after_cleanup',
          'level=' + normalized,
          'reason=' + String(reason || 'toggle')
        );
      }
      CONFIG.scanEnabled = CONFIG.enabled || CONFIG.flashShieldV1 || CONFIG.scanEnabled;
      // Host Off may have teardownManagedScheduling (teardownDone=true). Allow timers again.
      try {
        if (timerState.teardownDone) {
          timerState.teardownDone = false;
          timerState.paused = false;
          window.__MW_ACTIVE__ = true;
        }
        startManagedTimers('sensitivity_on:' + (reason || 'toggle'));
      } catch (eTimers) {}
      try { ensureSensitivityToggle(); } catch (eTog) {}
      if (CONFIG.flashShieldV1) {
        try { startFlashShieldRuntime(); } catch (eFlash) {}
      }
      if (CONFIG.scanEnabled) {
        // Instant dial retune using stored scores (Shorts-aware).
        try {
          reevaluateStampedNodesForDial(reason || 'toggle');
        } catch (e) {}
        if (isShortsModeActive()) {
          // FREEZE-OVERRIDE (accuracy): dial thr change on Active Shorts.
          // Prefer score reeval (already ran). Only wipe frame authority when this
          // short has no final decoded frame + scores — otherwise every dial tick
          // re-entered poster/provisional + Flash veil ("frozen short" stall).
          // Never full-feed poster rediscovery (preserves sacc battery/accuracy).
          let needPlayerScan = false;
          try {
            const liveShortsId = getCurrentShortsUrlId() || '';
            document.querySelectorAll('video').forEach(function(v) {
              if (!v || v.nodeType !== 1) return;
              try {
                if (!isActiveVisibleShortsVideo(v)) return;
                const hasScores =
                  toFiniteNumber(v.dataset.mwPornScore) !== null ||
                  toFiniteNumber(v.dataset.mwSexyScore) !== null ||
                  toFiniteNumber(v.dataset.mwHentaiScore) !== null;
                const settledId = String(v.dataset.mwShortsSettledId || '');
                const hasFinalFrame =
                  String(v.dataset.mwShortsFrameOk || '') === '1' &&
                  (!!liveShortsId ? settledId === liveShortsId : !!settledId);
                if (hasFinalFrame && hasScores) {
                  // Thr reeval is enough for this identity — keep scanning capacity.
                  console.log(
                    '[DIAG][DIAL] shorts_keep_final_frame',
                    'prev=' + previousLevel,
                    'next=' + normalized,
                    'shortsId=' + liveShortsId
                  );
                  return;
                }
                v.dataset.mwLastShortsFrameAttemptKey = '';
                v.dataset.mwShortsFrameOk = '0';
                v.dataset.mwShortsAwaitingFrame = '1';
                v.dataset.mwProvisionalUncertain = '0';
                scheduleActiveShortsFrameRetry(v, getShortsFrameScanKey(v), 'dial_change_rescan');
                needPlayerScan = true;
              } catch (e2) {}
            });
          } catch (e) {}
          if (needPlayerScan) {
            try {
              scanActiveShortsPlayerContainer('sensitivity_change:' + (reason || 'toggle'));
            } catch (e) {}
          }
        } else {
          scanFullPage();
          if (isYouTube()) {
            scanYouTubeThumbnails();
          }
        }
      }
    }
    postToHost({
      type: 'MW_SENSITIVITY_UPDATE',
      level: normalized,
      reason: reason || 'overlay_toggle',
      timestamp: Date.now(),
    });
  }

  try {
    window.__MW_APPLY_SENSITIVITY__ = function(level, reason) {
      applySensitivityLevel(level, reason || 'host_dial');
      return 'OK:' + String(CONFIG.sensitivity);
    };
  } catch (e) {}

  function sendBlurReady(reason) {
    if (!DOM_OVERLAY_ENABLED) return;
    postToHost({
      type: 'MW_BLUR_READY',
      reason: reason || 'ready',
      url: window.location.href,
      navId: window.__MW_NAV_ID__ || window.__MW_HOST_NAV_ID__ || null,
      pageEpoch: Number.isFinite(Number(CONFIG.pageEpoch)) ? Number(CONFIG.pageEpoch) : null,
      timestamp: Date.now(),
    });
  }

  function handleBlurCommand(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'MW_SHIELD_ACTION') {
      handleShieldAction(message.action);
      return true;
    }
    if (!DOM_OVERLAY_ENABLED) return false;
    if (message.type === 'MW_BLUR_STATE') {
      if (CONFIG.debug) {
        console.log('[MW-DIAG][INJECT] source=overlay_state_message', 'enabled=' + (!!message.enabled), 'reason=' + (message.reason || 'state'));
      }
      setOverlayEnabled(!!message.enabled, message.reason || 'state');
      return true;
    }

    if (message.type !== 'MW_BLUR_COMMAND') return false;

    if (message.command === 'ENABLE_BLUR') {
      setOverlayEnabled(true, message.reason || 'command_enable');
      return true;
    }
    if (message.command === 'DISABLE_BLUR') {
      setOverlayEnabled(false, message.reason || 'command_disable');
      return true;
    }
    if (message.command === 'PING') {
      sendBlurReady('ping');
      return true;
    }
    if (message.command === 'SET_SENSITIVITY') {
      const level = Number(message.level);
      applySensitivityLevel(
        Number.isFinite(level) ? level : CONFIG.sensitivity,
        message.reason || 'host_dial_command'
      );
      return true;
    }

    return false;
  }

  if (!window.__MW_BLUR_LISTENER__) {
    window.__MW_BLUR_LISTENER__ = true;
    const onBlurCommandEvent = function(event) {
      handleBlurCommand(readHostEventPayload(event));
    };
    window.addEventListener('message', onBlurCommandEvent);
    window.addEventListener('messageFromNative', onBlurCommandEvent);
  }

  if (DOM_OVERLAY_ENABLED && !window.__MW_BLUR_NAV_HOOKED__) {
    window.__MW_BLUR_NAV_HOOKED__ = true;
    const rawPushState = history.pushState;
    const rawReplaceState = history.replaceState;

    // Drive SPA-nav re-scan immediately instead of waiting for the 1200ms poll.
    // checkUrlChange self-guards on href !== lastUrl, so calling it here AND from
    // the poll is idempotent (no double rescan). This removes the ~1.2s window
    // where blur is absent after Home->Watch->Back style transitions.
    const triggerNavRescan = function(reason) {
      try {
        if (typeof checkUrlChange === 'function') checkUrlChange();
      } catch (e) {}
    };

    history.pushState = function() {
      const result = rawPushState.apply(this, arguments);
      setTimeout(function() { sendBlurReady('pushState'); triggerNavRescan('pushState'); }, 0);
      return result;
    };

    history.replaceState = function() {
      const result = rawReplaceState.apply(this, arguments);
      setTimeout(function() { sendBlurReady('replaceState'); triggerNavRescan('replaceState'); }, 0);
      return result;
    };

    window.addEventListener('popstate', function() { sendBlurReady('popstate'); triggerNavRescan('popstate'); });
    window.addEventListener('hashchange', function() { sendBlurReady('hashchange'); });
    window.addEventListener('pageshow', function() { sendBlurReady('pageshow'); });
    window.addEventListener('load', function() { sendBlurReady('load'); });
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) sendBlurReady('visibility');
    });
  }

  if (DOM_OVERLAY_ENABLED && !window.__MW_BLUR_HEAL_OBSERVER__) {
    window.__MW_BLUR_HEAL_OBSERVER__ = new MutationObserver(function() {
      ensureOverlayStyle();
      const overlay = ensureOverlayElement();
      if (!overlay) return;
      if (overlayState.enabled) {
        overlay.classList.add('mw-enabled');
      } else {
        overlay.classList.remove('mw-enabled');
      }
    });
    try {
      window.__MW_BLUR_HEAL_OBSERVER__.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  window.__MW_BLUR_OVERLAY_API__ = DOM_OVERLAY_ENABLED
    ? {
        enable: function(reason) { setOverlayEnabled(true, reason || 'api_enable'); },
        disable: function(reason) { setOverlayEnabled(false, reason || 'api_disable'); },
        setState: function(enabled, reason) { setOverlayEnabled(!!enabled, reason || 'api_state'); },
        sendReady: function(reason) { sendBlurReady(reason || 'api_ready'); },
        getState: function() { return { enabled: !!overlayState.enabled, reason: overlayState.reason, updatedAt: overlayState.updatedAt }; },
      }
    : {
        enable: function() {},
        disable: function() {},
        setState: function() {},
        sendReady: function() {},
        getState: function() { return { enabled: false, reason: 'dom_overlay_disabled', updatedAt: overlayState.updatedAt }; },
      };

  // Fail-open default: overlay starts disabled until host sends state.
  setOverlayEnabled(false, 'init_default_disabled');
  sendBlurReady('init');

  // ==================== REQUEST ID GENERATION ====================
  
  function generateRequestId() {
    return 'r_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36);
  }

  function generateItemId() {
    return 'i_' + Math.random().toString(36).slice(2, 9);
  }

  // ==================== STATE MANAGEMENT ====================
  
  const persistedNonShortsReattachContext = (function() {
    if (window.__MW_NON_SHORTS_REATTACH_CONTEXT__ && typeof window.__MW_NON_SHORTS_REATTACH_CONTEXT__.forEach === 'function') {
      return window.__MW_NON_SHORTS_REATTACH_CONTEXT__;
    }
    window.__MW_NON_SHORTS_REATTACH_CONTEXT__ = new Map();
    return window.__MW_NON_SHORTS_REATTACH_CONTEXT__;
  })();

  const state = {
    pageEpoch: Number.isFinite(CONFIG.pageEpoch) ? Number(CONFIG.pageEpoch) : 1,
    scanned: new Set(),
    pending: new Map(), // itemId -> { element, src, sourceType, requestId, timestamp, state, blurTimer }
    pendingBySrc: new Map(), // src -> itemId (dedupe)
    pendingRequests: new Map(), // requestId -> { items, timestamp, timeoutId, state }
    safeResolved: new Set(), // src values resolved as safe to suppress legacy re-blur
    safeResolvedAt: new Map(), // src -> timestamp (bounded/ttl for legacy suppression)
    blurred: new Set(),
    revealed: new Set(), // Tracks URLs that user has manually revealed
    revealedMeta: new Map(), // revealKey -> { revealedAt, expiresAt, reason, src, shortsId }
    elements: new Map(), // itemId -> element
    viewportObserver: null, // IntersectionObserver for viewport optimization
    mutationObservers: [],
    stats: {
      imgTags: 0,
      bgImages: 0,
      videoPosters: 0,
      shadowDom: 0,
      skipped: 0,
      skippedTiny: 0,
      skippedViewport: 0,
      blurred: 0,
      timeouts: 0,
      errors: 0,
      requestsSent: 0,
      responsesReceived: 0,
      nonceRejected: 0,
      semanticDelaySaved: 0, // Times we avoided blur due to fast safe result
      classificationCounts: {},
      blurSkippedByKillSwitch: 0,
      skippedQueueCap: 0,
      skippedRateLimited: 0,
      skippedMutationQueueCap: 0,
      staleEpochDiscarded: 0,
    },
    nonShortsReattachContext: persistedNonShortsReattachContext, // key -> { cardKey, itemKey, src, category, itemId, blurPx, nodeId, cardNodeId, updatedAt }
    regularMainCardBlurLatch: new Map(), // key -> { cardNodeId, navId, pageEpoch, hardBlurItemKey, hardBlurSrc, setAt, lastSeenAt, expiresAt }
    mvpCardObservers: new WeakMap(),
  };

  // Keep reveal stable for the current Shorts video (keyed by shorts:<videoId>).
  // No expiry prevents churn-triggered reblur/button flip while staying scoped per video id.
  const SHORTS_REVEAL_HOLD_MS = 0;

  function extractShortsIdFromUrl(url) {
    const normalized = normalizeUrl(url || '') || String(url || '');
    if (!normalized) return '';
    try {
      const parsed = new URL(normalized, window.location.href);
      const shortsMatch = String(parsed.pathname || '').match(new RegExp('^/shorts/([^/?#]+)'));
      if (shortsMatch && shortsMatch[1]) return shortsMatch[1];
      const queryId = parsed.searchParams.get('v');
      if (queryId) return queryId;
    } catch (e) {}
    return '';
  }

  function getRevealScopeForSource(src, element) {
    const normalizedSrc = normalizeUrl(src || '') || String(src || '');
    const shortsMode = isShortsModeActive();
    if (!shortsMode) {
      return {
        key: 'src:' + normalizedSrc,
        normalizedSrc: normalizedSrc,
        shortsId: '',
        holdMs: 0,
      };
    }
    // Prefer URL id over asset id when src is a canvas data: frame (no video id in src).
    // Still prefer asset id from ytimg/poster when present so shelf thumbs key correctly.
    const fromAsset = getYouTubeAssetVideoId(normalizedSrc);
    const fromSrcUrl = extractShortsIdFromUrl(normalizedSrc);
    const fromLocation = getCurrentShortsUrlId();
    const isDataFrame = String(normalizedSrc || '').indexOf('data:') === 0;
    const shortsId = isDataFrame
      ? (fromLocation || fromAsset || fromSrcUrl || '')
      : (fromAsset || fromSrcUrl || fromLocation || '');
    if (shortsId) {
      return {
        key: 'shorts:' + shortsId,
        normalizedSrc: normalizedSrc,
        shortsId: shortsId,
        holdMs: SHORTS_REVEAL_HOLD_MS,
      };
    }
    // Last resort: never use a bare data: URL as a global reveal key (too easy to collide
    // via empty/shared keys). Scope to a per-node ephemeral key if possible.
    return {
      key: 'src:' + (normalizedSrc ? normalizedSrc.substring(0, 120) : 'unknown'),
      normalizedSrc: normalizedSrc,
      shortsId: '',
      holdMs: 0,
    };
  }

  function getRevealMetaByKey(revealKey) {
    if (!revealKey) return null;
    const meta = state.revealedMeta.get(revealKey);
    if (!meta) return null;
    if (meta.expiresAt && Date.now() > meta.expiresAt) {
      state.revealedMeta.delete(revealKey);
      state.revealed.delete(revealKey);
      return null;
    }
    return meta;
  }

  function getRevealMetaForSource(src, element) {
    const scope = getRevealScopeForSource(src, element);
    const byKey = getRevealMetaByKey(scope.key);
    if (byKey) return { key: scope.key, meta: byKey, scope: scope };
    const legacySrcKey = scope.normalizedSrc;
    const byLegacy = getRevealMetaByKey(legacySrcKey);
    if (byLegacy) return { key: legacySrcKey, meta: byLegacy, scope: scope };
    return { key: scope.key, meta: null, scope: scope };
  }

  function clearStaleRevealDatasetOnElement(element, reason) {
    if (!element || !element.dataset) return;
    try {
      element.dataset.mwRevealed = 'false';
      element.dataset.mwRevealKey = '';
      element.dataset.mwRevealedAt = '';
      element.dataset.mwRevealExpiresAt = '';
      if (DIAG_YT_BLUR || isShortsModeActive()) {
        console.log(
          '[DIAG][REVEAL_EVT] stale_reveal_marker_cleared',
          'reason=' + String(reason || 'unknown'),
          'node=' + getDiagNodeId(element)
        );
      }
    } catch (e) {}
  }

  function isRevealedForSource(src, element) {
    const scope = getRevealScopeForSource(src, element);
    const normalizedSrc = scope.normalizedSrc;

    // FREEZE-OVERRIDE (Active Shorts MVP): YouTube recycles the same <video> node
    // across swipes. After revealing short A, the node keeps data-mw-revealed=true
    // and mwRevealKey=shorts:A. Without a key-match check, short B on that node
    // was treated as already revealed → positives stopped flagging after one reveal.
    if (element && element.dataset && element.dataset.mwRevealed === 'true') {
      const elementKey = String(element.dataset.mwRevealKey || '');
      if (elementKey && elementKey !== scope.key) {
        clearStaleRevealDatasetOnElement(element, 'scope_key_mismatch:' + elementKey + '->' + scope.key);
      } else if (
        scope.shortsId &&
        elementKey &&
        elementKey.indexOf('shorts:') === 0 &&
        elementKey !== ('shorts:' + scope.shortsId)
      ) {
        clearStaleRevealDatasetOnElement(element, 'shorts_id_mismatch');
      }
    }

    // Authoritative: reveal key for THIS scope only.
    if (getRevealMetaByKey(scope.key)) return true;
    if (state.revealed.has(scope.key)) return true;

    // Legacy src-key only for non-Shorts (or Shorts without a video id).
    // Never let a data: frame URL or ytimg poster cross-match another Short.
    if (!scope.shortsId && normalizedSrc && state.revealed.has(normalizedSrc)) {
      return true;
    }
    if (!scope.shortsId && normalizedSrc) {
      const byLegacy = getRevealMetaByKey(normalizedSrc);
      if (byLegacy) return true;
    }

    if (element && element.dataset && element.dataset.mwRevealed === 'true') {
      const elementKey = String(element.dataset.mwRevealKey || '');
      // Only honor element marker when it matches current scope key.
      if (elementKey && elementKey === scope.key) {
        if (getRevealMetaByKey(elementKey) || state.revealed.has(elementKey)) {
          return true;
        }
      }
      // Stale or expired marker.
      clearStaleRevealDatasetOnElement(element, 'expired_or_orphan_marker');
    }
    return false;
  }

  // Call on Shorts identity change so recycled media cannot carry reveal forever.
  function clearStaleShortsRevealMarkersOnSwipe(reason) {
    if (!isShortsModeActive()) return;
    const currentId = getCurrentShortsUrlId() || '';
    if (!currentId) return;
    const expectedKey = 'shorts:' + currentId;
    try {
      document.querySelectorAll('[data-mw-revealed="true"], [data-mw-reveal-key]').forEach(function(node) {
        if (!node || node.nodeType !== 1 || !node.dataset) return;
        const key = String(node.dataset.mwRevealKey || '');
        if (!key) return;
        if (key.indexOf('shorts:') === 0 && key !== expectedKey) {
          clearStaleRevealDatasetOnElement(node, 'swipe_clear:' + (reason || 'unknown'));
          // Also drop moderated=revealed if it was only for the previous short.
          if (String(node.dataset.mwModerated || '') === 'revealed') {
            try {
              node.dataset.mwModerated = '';
              node.dataset.mwPreblurClear = '';
            } catch (e2) {}
          }
        }
      });
      // Battery + accuracy: recycled active player video must re-scan the new short.
      document.querySelectorAll('#shorts-player video, ytm-reel-video-renderer video, ytd-reel-video-renderer video').forEach(function(node) {
        if (!node || node.nodeType !== 1 || !node.dataset) return;
        const settled = String(node.dataset.mwShortsSettledId || '');
        if (settled && settled !== currentId) {
          resetActiveShortsScanStateForIdentityChange(node, 'swipe_identity:' + (reason || 'unknown'));
        }
      });
    } catch (e) {}
  }

  function markRevealedForSource(src, element, reason) {
    const scope = getRevealScopeForSource(src, element);
    const now = Date.now();
    const expiresAt = scope.holdMs > 0 ? now + scope.holdMs : null;
    const meta = {
      revealedAt: now,
      expiresAt: expiresAt,
      reason: String(reason || 'manual_reveal'),
      src: scope.normalizedSrc,
      shortsId: scope.shortsId || '',
    };
    state.revealed.add(scope.key);
    if (scope.normalizedSrc) {
      state.revealed.delete(scope.normalizedSrc);
    }
    state.revealedMeta.set(scope.key, meta);
    persistRevealEntry(scope.key, meta);
    if (element && element.dataset) {
      element.dataset.mwRevealed = 'true';
      element.dataset.mwRevealKey = scope.key;
      element.dataset.mwRevealedAt = String(now);
      element.dataset.mwRevealExpiresAt = expiresAt ? String(expiresAt) : '';
    }
    return { key: scope.key, meta: meta, holdMs: scope.holdMs };
  }

  function unmarkRevealedForSource(src, element, reason) {
    const scope = getRevealScopeForSource(src, element);
    const revealKey = scope.key;
    state.revealed.delete(revealKey);
    if (scope.normalizedSrc) {
      state.revealed.delete(scope.normalizedSrc);
      state.revealedMeta.delete(scope.normalizedSrc);
    }
    state.revealedMeta.delete(revealKey);
    evictRevealEntry(revealKey);
    if (element && element.dataset) {
      element.dataset.mwRevealed = 'false';
      element.dataset.mwRevealKey = '';
      element.dataset.mwRevealedAt = '';
      element.dataset.mwRevealExpiresAt = '';
    }
    if (DIAG_YT_BLUR) {
      console.log(
        '[DIAG][REVEAL_EVT] reveal_cleared',
        'reason=' + String(reason || 'unknown'),
        'revealKey=' + revealKey,
        'src=' + String(scope.normalizedSrc || '').substring(0, 180)
      );
    }
    return revealKey;
  }

  function safeScore(value) {
    const n = toFiniteNumber(value);
    return n === null ? 0 : n;
  }

  function readHeuristicCache() {
    try {
      const stored = localStorage.getItem(HEURISTIC_CACHE_KEY);
      if (!stored) {
        return { blacklist: [], whitelist: [], history: [] };
      }
      const parsed = JSON.parse(stored);
      return {
        blacklist: Array.isArray(parsed.blacklist) ? parsed.blacklist : [],
        whitelist: Array.isArray(parsed.whitelist) ? parsed.whitelist : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    } catch (error) {
      return { blacklist: [], whitelist: [], history: [] };
    }
  }

  function writeHeuristicCache(cache) {
    try {
      localStorage.setItem(HEURISTIC_CACHE_KEY, JSON.stringify(cache));
    } catch (error) {}
  }

  function readRevealStore() {
    try {
      const stored = localStorage.getItem(MW_REVEAL_STORE_KEY);
      if (!stored) return {};
      const parsed = JSON.parse(stored);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (e) { return {}; }
  }

  function writeRevealStore(store) {
    try {
      localStorage.setItem(MW_REVEAL_STORE_KEY, JSON.stringify(store));
    } catch (e) {}
  }

  function isPersistentRevealKey(key) {
    return String(key || '').indexOf('shorts:') === 0;
  }

  function persistRevealEntry(key, meta) {
    try {
      if (!isPersistentRevealKey(key)) return;
      const now = Date.now();
      const expiresAt = (meta.expiresAt && meta.expiresAt > now) ? meta.expiresAt : (now + MW_REVEAL_TTL_MS);
      const newEntry = { revealedAt: meta.revealedAt || now, expiresAt: expiresAt, src: meta.src || '', shortsId: meta.shortsId || '' };
      const store = readRevealStore();
      const entries = Object.entries(store).filter(function([k, v]) {
        return isPersistentRevealKey(k) && v && v.expiresAt > now;
      });
      if (entries.length >= MW_REVEAL_MAX_ENTRIES) {
        entries.sort(function(a, b) { return (a[1].revealedAt || 0) - (b[1].revealedAt || 0); });
        entries.splice(0, entries.length - MW_REVEAL_MAX_ENTRIES + 1);
      }
      const result = {};
      entries.forEach(function([k, v]) { result[k] = v; });
      result[key] = newEntry;
      writeRevealStore(result);
    } catch (e) {}
  }

  function evictRevealEntry(key) {
    try {
      const store = readRevealStore();
      if (Object.prototype.hasOwnProperty.call(store, key)) {
        delete store[key];
        writeRevealStore(store);
      }
    } catch (e) {}
  }

  function hydrateRevealStateFromStorage() {
    try {
      const store = readRevealStore();
      const now = Date.now();
      const pruned = {};
      Object.entries(store).forEach(function([key, entry]) {
        if (!isPersistentRevealKey(key)) return;
        if (!entry || typeof entry !== 'object') return;
        if (entry.expiresAt && entry.expiresAt <= now) return;
        pruned[key] = entry;
        state.revealed.add(key);
        state.revealedMeta.set(key, {
          revealedAt: entry.revealedAt || now,
          expiresAt: entry.expiresAt || null,
          reason: 'hydrated',
          src: entry.src || '',
          shortsId: entry.shortsId || '',
        });
      });
      writeRevealStore(pruned);
    } catch (e) {}
  }

  function persistHeuristicEntry(entry, bucket) {
    const cache = readHeuristicCache();
    cache.history = cache.history || [];
    cache.history.push(entry);
    if (cache.history.length > HEURISTIC_CACHE_LIMIT) {
      cache.history = cache.history.slice(-HEURISTIC_CACHE_LIMIT);
    }
    if (bucket && cache[bucket]) {
      cache[bucket].push(entry);
      if (cache[bucket].length > HEURISTIC_CACHE_LIMIT) {
        cache[bucket] = cache[bucket].slice(-HEURISTIC_CACHE_LIMIT);
      }
    }
    writeHeuristicCache(cache);
  }

  function getShieldScores(predictions) {
    return {
      porn: safeScore(predictions?.porn),
      sexy: safeScore(predictions?.sexy),
      hentai: safeScore(predictions?.hentai),
      neutral: safeScore(predictions?.neutral),
    };
  }

  function resolveShieldElement(target) {
    if (!target) return null;
    if (target.element && target.element.isConnected) {
      return target.element;
    }
    if (target.itemId) {
      const stored = state.elements.get(target.itemId);
      if (stored && stored.isConnected) {
        return stored;
      }
    }
    return null;
  }

  function queueDeepScanTarget(target) {
    if (!target || !target.src) return;
    const element = resolveShieldElement(target);
    if (!element) {
      console.warn('[MW][ShieldAction] missing element for deep scan', target.src);
      return;
    }
    state.scanned.delete(target.src);
    clearSafeResolved(target.src);
    const prevPendingId = state.pendingBySrc.get(target.src);
    if (prevPendingId) {
      clearPendingItem(prevPendingId, 'deep_scan');
    }
    queueForScan(target.src, element, target.sourceType || 'deep_scan');
    console.log('[MW][ShieldAction] deep scan enqueued', target.src);
  }

  const SHIELD_CACHE_BUCKETS = {
    report: 'blacklist',
    false_positive: 'whitelist',
  };

  function logShieldAction(action, target, scores) {
    const entry = {
      action: action,
      src: target.src,
      category: target.normalizedCategory || target.category || 'unknown',
      timestamp: Date.now(),
      scores: scores,
      itemId: target.itemId || null,
    };
    console.log('[MW][ShieldAction]', action, 'scores=', scores, 'src=' + target.src);
    const bucket = SHIELD_CACHE_BUCKETS[action] || null;
    persistHeuristicEntry(entry, bucket);
  }

  function handleShieldAction(action) {
    if (!action) return;
    const target = lastShieldTarget;
    if (!target || !target.src) {
      console.warn('[MW][ShieldAction] no active target for', action);
      return;
    }
    const element = resolveShieldElement(target);
    if (!element) {
      console.warn('[MW][ShieldAction] missing DOM element for', action, target.src);
      return;
    }
    const scores = getShieldScores(target.predictions || {});
    logShieldAction(action, target, scores);
    if (action === 'report') {
      unmarkRevealedForSource(target.src, element, 'shield_report');
      clearSafeResolved(target.src);
      applyBlur(element, target.src, target.normalizedCategory || target.predictedLabel || 'flagged', CLAMPED_BLUR_STRENGTH, target.itemId);
      return;
    }
    if (action === 'false_positive') {
      markSafeResolved(target.src);
      unmarkRevealedForSource(target.src, element, 'shield_false_positive');
      clearElementBlur(element);
      return;
    }
    if (action === 'deep_scan') {
      queueDeepScanTarget(target);
    }
  }

  // Batch queue for collecting items before sending request
  let batchQueue = [];
  let batchTimer = null;
  const NAV_ID = window.__MW_NAV_ID__ || ('mw_' + Date.now().toString(36));
  window.__MW_NAV_ID__ = NAV_ID;
  function getSovereignNavToken() {
    const hostNavRaw = Number(window.__MW_HOST_NAV_ID__);
    if (Number.isFinite(hostNavRaw)) {
      return String(Math.floor(hostNavRaw));
    }
    return String(NAV_ID || 'none');
  }
  const NONCE_PREFIX = String(CONFIG.nonce || '').substring(0, 6);
  console.log('[MW][HYPEBOI] script_loaded navId=' + NAV_ID + ' pageEpoch=' + CONFIG.pageEpoch + ' ts=' + Date.now());
  postToHost({
    type: 'MW_INJECTED_ACK',
    navId: NAV_ID,
    pageEpoch: CONFIG.pageEpoch,
    noncePrefix: NONCE_PREFIX,
    url: window.location.href,
    timestamp: Date.now(),
  });
  console.log(
    '[MW][ACK] MW_INJECTED_ACK',
    'navId=' + NAV_ID,
    'pageEpoch=' + CONFIG.pageEpoch,
    'noncePrefix=' + NONCE_PREFIX,
    'url=' + window.location.href,
  );
  postToHost({
    type: 'MW_PATCH_MARKER',
    marker: 'shorts_transition_mvp_v2',
    navId: NAV_ID,
    pageEpoch: CONFIG.pageEpoch,
    url: window.location.href,
    timestamp: Date.now(),
  });
  const timerState = {
    legacyResultsInterval: null,
    urlChangeInterval: null,
    youtubePeriodicInterval: null,
    mainScrollTimeout: null,
    mainScrollHandler: null,
    youtubeScrollTimeout: null,
    youtubeScrollHandler: null,
    youtubeMutationScanTimeout: null,
    revealOverlayRepositionRaf: null,
    nonShortsRevealOverlayRepositionRaf: null,
    revealOverlayRetryTimeout: null,
    revealOverlayLastReason: '',
    nonShortsRevealOverlayLastReason: '',
    revealOverlayScrollHandler: null,
    revealOverlayResizeHandler: null,
    debugSummaryInterval: null,
    diagHeartbeatInterval: null,
    shortsHealthHealInterval: null,
    flashShieldInterval: null,
    flashShieldRafId: null,
    flashShieldBurstRafId: null,
    flashShieldObserver: null,
    shortsVeilTimeoutTimer: null,
    shortsVeilTimeoutIdentity: '',
    initialTimeouts: [],
    paused: document.visibilityState !== 'visible',
    teardownDone: false,
  };
  const isYouTubeHost = HOSTNAME.includes('youtube.com') || HOSTNAME.includes('youtu.be');
  const MAX_PENDING_ITEMS = isYouTubeHost ? 220 : 140;
  const MAX_BATCH_QUEUE_ITEMS = isYouTubeHost ? 180 : 120;
  const MAX_ENQUEUE_PER_SEC = isYouTubeHost ? 120 : 80;
  const MAX_SCAN_NODE_PER_SEC = isYouTubeHost ? 90 : 60;
  const MAX_MUTATION_SCAN_PER_SEC = isYouTubeHost ? 100 : 70;
  const MAX_MUTATION_QUEUE_ITEMS = isYouTubeHost ? 160 : 100;
  const MUTATION_SCAN_FLUSH_DELAY_MS = isYouTubeHost ? 70 : 100;
  const MUTATION_SCAN_FLUSH_BATCH = isYouTubeHost ? 24 : 14;
  const rateLimiter = {
    enqueue: { sec: 0, count: 0 },
    scanNode: { sec: 0, count: 0 },
    mutationScan: { sec: 0, count: 0 },
  };
  const SHORTS_HEAVY_SCAN_THROTTLE_MS = 1500;
  let shortsHeavyScanLastAt = 0;
  let diagPrevRequests = 0;
  let diagPrevResponses = 0;
  let diagLastShortsScanBatchStartAt = 0;
  const diagScanBatchStartAtByRequestId = new Map();
  const diagApplySeenNodes = new WeakSet();
  const diagScanSourceCounters = {
    poster_scan_used: 0,
    video_frame_scan_used: 0,
    scan_source_fallback_reason: 0,
  };
  const diagObserverModeCounters = {
    shorts_attr_mode_on: 0,
    shorts_attr_mode_off: 0,
    transitions: 0,
  };
  const diagEpochBypassCounters = {
    epoch_bypass_allowed: 0,
    epoch_bypass_blocked: 0,
  };
  const diagApplyCounters = {
    apply_by_item_id: 0,
    apply_by_src_fanout: 0,
  };
  const diagLifecycleCounters = {
    snapshots: 0,
  };
  const diagObserverModeState = {
    current: null,
    initialized: false,
  };
  const mutationScanQueue = [];
  const mutationScanSet = new Set();
  let mutationScanTimer = null;

  function allowPerSecond(bucket, maxPerSecond) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (bucket.sec !== nowSec) {
      bucket.sec = nowSec;
      bucket.count = 0;
    }
    if (bucket.count >= maxPerSecond) return false;
    bucket.count += 1;
    return true;
  }

  function timerLog(action, name) {
    console.log('[MW][Timer]', action, name, 'navId=' + NAV_ID, 'url=' + window.location.href);
  }

  function logShortsScanSkip(reason, itemId, src, sourceType) {
    if (!isShortsModeActive()) return;
    console.log(
      '[DIAG][SHORTS_SCAN] skip',
      'reason=' + (reason || 'unknown'),
      'itemId=' + (itemId || 'none'),
      'src=' + String(src || '').substring(0, 180),
      'sourceType=' + (sourceType || 'unknown')
    );
  }

  function collectShortsDiscoveryItems(root) {
    const collected = [];
    const seen = new Set();
    if (!root || root.nodeType !== 1) return collected;
    const pushItem = function(sourceType, src, node) {
      const normalizedSrc = normalizeUrl(src || '') || String(src || '');
      const signature = sourceType + '|' + normalizedSrc;
      if (seen.has(signature)) return;
      seen.add(signature);
      collected.push({
        itemId: getDiagNodeId(node),
        src: normalizedSrc.substring(0, 180),
        sourceType: sourceType,
      });
    };
    try {
      if (root.tagName === 'IMG') {
        pushItem('img', root.src || root.getAttribute('src') || '', root);
      }
      if (root.tagName === 'VIDEO') {
        pushItem('video-poster', root.poster || root.getAttribute('poster') || root.currentSrc || '', root);
      }
      root.querySelectorAll('img').forEach(function(img) {
        pushItem('img', img.src || img.getAttribute('src') || '', img);
      });
      root.querySelectorAll('video').forEach(function(video) {
        pushItem('video-poster', video.poster || video.getAttribute('poster') || video.currentSrc || '', video);
      });
      root.querySelectorAll('*').forEach(function(node) {
        const bgUrl = extractBgImageUrl(node);
        if (bgUrl) {
          pushItem('bg-image', bgUrl, node);
        }
      });
      root.querySelectorAll('canvas').forEach(function(canvas) {
        pushItem('canvas', 'canvas://pixel-buffer', canvas);
      });
    } catch (e) {}
    return collected;
  }

  function clearNamedInterval(key, reason) {
    const id = timerState[key];
    if (!id) return;
    clearInterval(id);
    timerState[key] = null;
    timerLog('stop', key + ':' + reason);
  }

  function clearNamedTimeout(key, reason) {
    const id = timerState[key];
    if (!id) return;
    clearTimeout(id);
    timerState[key] = null;
    timerLog('stop', key + ':' + reason);
  }

  function allowShortsHeavyScanSweep(reason) {
    if (!isShortsModeActive()) return true;
    const now = Date.now();
    if ((now - shortsHeavyScanLastAt) < SHORTS_HEAVY_SCAN_THROTTLE_MS) {
      if (DIAG_YT_BLUR) {
        console.log(
          '[MW-YT][DIAG][THROTTLE]',
          'action=skip_heavy_sweep',
          'reason=' + (reason || 'unknown'),
          'sinceMs=' + (now - shortsHeavyScanLastAt),
          'minMs=' + SHORTS_HEAVY_SCAN_THROTTLE_MS
        );
      }
      return false;
    }
    shortsHeavyScanLastAt = now;
    if (DIAG_YT_BLUR) {
      console.log(
        '[MW-YT][DIAG][THROTTLE]',
        'action=allow_heavy_sweep',
        'reason=' + (reason || 'unknown'),
        'at=' + now
      );
    }
    return true;
  }

  const SAFE_RESOLVED_MAX = 1500;
  const SAFE_RESOLVED_TTL_MS = 2 * 60 * 1000;

  function cleanupExpiredSafeResolved() {
    const now = Date.now();
    const expired = [];
    state.safeResolvedAt.forEach(function(ts, src) {
      if (!Number.isFinite(ts) || (now - ts) > SAFE_RESOLVED_TTL_MS) {
        expired.push(src);
      }
    });
    expired.forEach(function(src) {
      state.safeResolvedAt.delete(src);
      state.safeResolved.delete(src);
    });
  }

  function markSafeResolved(src) {
    if (!src) return;
    cleanupExpiredSafeResolved();
    const now = Date.now();
    state.safeResolved.add(src);
    state.safeResolvedAt.set(src, now);
    while (state.safeResolvedAt.size > SAFE_RESOLVED_MAX) {
      const oldest = state.safeResolvedAt.keys().next();
      if (oldest.done) break;
      const oldestSrc = oldest.value;
      state.safeResolvedAt.delete(oldestSrc);
      state.safeResolved.delete(oldestSrc);
    }
  }

  function clearSafeResolved(src) {
    if (!src) return;
    state.safeResolvedAt.delete(src);
    state.safeResolved.delete(src);
  }

  function isSafeResolvedActive(src) {
    const ts = state.safeResolvedAt.get(src);
    if (!Number.isFinite(ts)) return false;
    if ((Date.now() - ts) > SAFE_RESOLVED_TTL_MS) {
      clearSafeResolved(src);
      return false;
    }
    return state.safeResolved.has(src);
  }

  function clearPendingItem(itemId, reason) {
    const pendingItem = state.pending.get(itemId);
    if (!pendingItem) return;
    if (pendingItem.blurTimer) {
      clearTimeout(pendingItem.blurTimer);
    }
    if (pendingItem.src && state.pendingBySrc.get(pendingItem.src) === itemId) {
      state.pendingBySrc.delete(pendingItem.src);
    }
    state.pending.delete(itemId);
    if (CONFIG.debug) {
      console.log('[MW][Pending] cleared itemId=' + itemId, 'reason=' + (reason || 'unknown'));
    }
  }

  function clearElementScanDedupeMarkers(element, reason) {
    if (!element || element.nodeType !== 1 || !element.dataset) return;
    try {
      // Clear one-shot scan guards so stale-safe first-handoff responses can be retried.
      element.dataset.mwScanned = 'false';
      element.dataset.mwLastScanSrc = '';
      element.dataset.mwPosterScanned = 'false';
      element.dataset.mwLastPoster = '';
      element.dataset.mwLastShortsFrameAttemptKey = '';
      if (DIAG_YT_BLUR) {
        console.log(
          '[DIAG][SHORTS_SCAN] dedupe_markers_cleared',
          'reason=' + (reason || 'unknown'),
          'node=' + getDiagNodeId(element),
          'tag=' + String(element.tagName || 'unknown')
        );
      }
    } catch (e) {}
  }

  function pruneDisconnectedPending(reason) {
    const toClear = [];
    state.pending.forEach(function(pending, itemId) {
      if (!pending || !pending.element || !pending.element.isConnected) {
        toClear.push(itemId);
      }
    });
    toClear.forEach(function(itemId) { clearPendingItem(itemId, reason || 'disconnected'); });
  }

  function resetBlurState(reason) {
    state.pending.forEach(function(_item, itemId) {
      clearPendingItem(itemId, reason || 'sensitivity_reset');
    });
    state.pendingRequests.forEach(function(pending) {
      if (pending && pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
    });
    state.pendingRequests.clear();
    state.pendingBySrc.clear();
    state.safeResolved.clear();
    state.safeResolvedAt.clear();
    state.blurred.clear();
    state.scanned.clear();
    state.elements.forEach(function(element) {
      if (element && element.isConnected) {
        clearElementBlur(element);
      }
    });
  }

  function flushMutationScanQueue() {
    mutationScanTimer = null;
    if (timerState.paused || timerState.teardownDone) {
      mutationScanQueue.length = 0;
      mutationScanSet.clear();
      return;
    }

    let processed = 0;
    while (mutationScanQueue.length > 0 && processed < MUTATION_SCAN_FLUSH_BATCH) {
      const node = mutationScanQueue.shift();
      mutationScanSet.delete(node);
      if (!node || node.nodeType !== 1 || !node.isConnected) continue;
      if (!allowPerSecond(rateLimiter.mutationScan, MAX_MUTATION_SCAN_PER_SEC)) {
        state.stats.skippedRateLimited++;
        continue;
      }
      scanNode(node);
      processed += 1;
    }

    if (mutationScanQueue.length > 0) {
      mutationScanTimer = setTimeout(flushMutationScanQueue, MUTATION_SCAN_FLUSH_DELAY_MS);
    }
  }

  function queueMutationScan(node, reason) {
    if (!isVisualModerationActive()) return;
    if (!node || node.nodeType !== 1) return;
    if (mutationScanSet.has(node)) {
      diagMutationScheduleLog('skip_duplicate', node, reason || 'unknown', false);
      return;
    }
    if (mutationScanQueue.length >= MAX_MUTATION_QUEUE_ITEMS) {
      state.stats.skippedMutationQueueCap++;
      diagMutationScheduleLog('skip_queue_cap', node, reason || 'unknown', false);
      return;
    }
    mutationScanSet.add(node);
    mutationScanQueue.push(node);
    diagMutationScheduleLog('queued', node, reason || 'unknown', true);
    if (!mutationScanTimer) {
      mutationScanTimer = setTimeout(flushMutationScanQueue, MUTATION_SCAN_FLUSH_DELAY_MS);
      diagMutationScheduleLog('timer_started', node, reason || 'unknown', true);
    }
  }

  // ==================== PLATFORM DETECTION ====================

  function detectPlatform() {
    const url = window.location.href;
    const host = window.location.hostname;
    
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      if (url.includes('/shorts')) return 'youtube-shorts';
      return 'youtube';
    }
    if (host.includes('tiktok.com')) return 'tiktok';
    if (host.includes('instagram.com')) return 'instagram';
    if (host.includes('twitter.com') || host.includes('x.com')) return 'twitter';
    if (host.includes('facebook.com')) return 'facebook';
    return 'generic';
  }

  const PLATFORM = detectPlatform();
  const IS_YOUTUBE = PLATFORM === 'youtube' || PLATFORM === 'youtube-shorts';
  console.log('[MW] Platform detected:', PLATFORM, 'isYouTube:', IS_YOUTUBE);
  const DIAG_ENABLED = CONFIG.diagYouTubeShorts && IS_YOUTUBE;
  const DIAG_SHORTS_CONTEXT = window.location.href.indexOf('/shorts') !== -1;
  const DIAG_YT_BLUR = IS_YOUTUBE && DIAG_SHORTS_CONTEXT && (function() {
    try {
      if (window.DIAG_YT_BLUR === 1 || window.DIAG_YT_BLUR === '1') return true;
      if (window.localStorage && window.localStorage.getItem('DIAG_YT_BLUR') === '1') return true;
    } catch (e) {}
    return false;
  })();
  const diagLogTimestamps = {};
  const diagNodeIds = new WeakMap();
  const diagNodeParentAtBlur = new WeakMap();
  const diagShortsTimelineStartAt = Date.now();
  const diagShortsBlurParentObserverByNode = new WeakMap();
  const diagShortsBlurredHtml5MainVideoNodeIds = new Set();
  const diagShortsLastBlurNodeIdBySrc = {};
  const SHORTS_STABLE_CONTAINER_SELECTORS = [
    '#shorts-player ytm-reel-video-renderer[selected]',
    '#shorts-player ytm-reel-video-renderer[is-active]',
    '#shorts-player ytm-reel-video-renderer[aria-hidden="false"]',
    '#shorts-player ytm-reel-video-renderer[aria-current="true"]',
    '#shorts-player ytm-shorts-lockup-view-model-v2[selected]',
    '#shorts-player ytm-shorts-lockup-view-model-v2[is-active]',
    '#shorts-player ytm-shorts-lockup-view-model-v2[aria-hidden="false"]',
    '#shorts-player ytm-shorts-lockup-view-model-v2[aria-current="true"]',
    '#shorts-player ytm-shorts-lockup-view-model[selected]',
    '#shorts-player ytm-shorts-lockup-view-model[is-active]',
    '#shorts-player ytm-shorts-lockup-view-model[aria-hidden="false"]',
    '#shorts-player ytd-reel-video-renderer[is-active]',
    '#shorts-player ytd-reel-video-renderer[aria-hidden="false"]',
    'ytm-reel-video-renderer[selected]',
    'ytm-reel-video-renderer[is-active]',
    'ytm-reel-video-renderer[aria-hidden="false"]',
    'ytm-shorts-lockup-view-model-v2[is-active]',
    'ytm-shorts-lockup-view-model[is-active]',
    'ytd-reel-video-renderer[is-active]',
    '#shorts-player ytm-reel-video-renderer',
    '#shorts-player ytd-reel-video-renderer',
    '#shorts-player ytm-shorts-lockup-view-model-v2',
    '#shorts-player ytm-shorts-lockup-view-model',
    '#player-container',
    '#shorts-player',
  ];
  const SHORTS_STABLE_CONTAINER_TAG_SELECTOR = 'ytm-reel-video-renderer, ytd-reel-video-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, #shorts-player, #player-container';
  const SHORTS_SWAP_REATTACH_WINDOW_MS = 2600;
  const SHORTS_HEALTH_HEAL_COOLDOWN_MS = 1500;
  const SHORTS_HEALTH_HEAL_MAX_ATTEMPTS = 5;
  const SHORTS_HEALTH_HEAL_WINDOW_MS = 30000;
  const SHORTS_HEALTH_HEAL_GIVEUP_MS = 30000;
  const SHORTS_HEALTH_HEAL_INTERVAL_MS = 2000;
  // Default ON for Phase 0 active-Shorts reveal pairing. Host may opt out with false.
  const SHORTS_HEALTH_HEAL_ENABLED = CONFIG.enableShortsHealthHeal !== false;
  const SHORTS_HEALTH_LOG_PREFIX = '[MW-YT][DIAG][SHORTS_HEALTH]';
  const SHORTS_REENTRY_REFRESH_COOLDOWN_MS = 1200;
  const ADAPTIVE_SHORTS_RESCAN_DEBOUNCE_MS = 140;
  const ADAPTIVE_SHORTS_RESCAN_COOLDOWN_MS = 700;
  const ADAPTIVE_SHORTS_WATCH_ATTRIBUTE_FILTER = [
    'class',
    'style',
    'hidden',
    'aria-hidden',
    'aria-current',
    'selected',
    'is-active',
    'src',
    'poster',
    'data-video-id',
    'data-item-id',
    'data-id',
    'data-index',
  ];
  let shortsBlurContextByContainer = new WeakMap();
  let shortsBlurContextCount = 0;
  let shortsHealthStateByContainer = new WeakMap();
  const shortsActiveOwnerTokens = new Set();
  const adaptiveShortsWatchState = {
    observer: null,
    rootNode: null,
    rootNodeId: 'none',
    pendingRescanTimer: null,
    lastIdentity: '',
    lastIdentityLoggedAt: 0,
    lastRescanIdentity: '',
    lastRescanAt: 0,
    active: false,
  };
  const shortsReentryState = {
    lastRefreshAt: 0,
    lastReason: 'none',
  };
  const diagEpochCounters = {
    staleInjectedDiscardCount: 0,
    epochHeldCount: 0,
    epochIncrementedCount: 0,
  };
  let diagNodeSeq = 0;
  let diagRevealOverlaySeq = 0;
  function diagLog(key, message) {
    if (!DIAG_ENABLED) return;
    const now = Date.now();
    const previous = diagLogTimestamps[key] || 0;
    if (now - previous < 2500) return;
    diagLogTimestamps[key] = now;
    console.log('[MW-YT][DIAG]', message);
  }
  function describeElementHint(element) {
    var hint = 'no-hint';
    var id = element.id || '';
    if (id) {
      hint = id;
    } else {
      var className = (element.className || '').trim();
      if (className) {
        var tokens = [];
        className.split(' ').forEach(function(token) {
          if (token && tokens.length < 2) tokens.push(token);
        });
        if (tokens.length) {
          hint = tokens.join(' ');
        }
      }
    }
    return hint;
  }

  function isYouTubeDomainUrl(value) {
    if (!value) return false;
    try {
      var parsed = new URL(value, window.location.href);
      var host = String(parsed.hostname || '').toLowerCase();
      return host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
    } catch (e) {
      return false;
    }
  }

  function isYouTubeShortsUrl(value) {
    if (!value) return false;
    try {
      var parsed = new URL(value, window.location.href);
      var host = String(parsed.hostname || '').toLowerCase();
      return (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') && parsed.pathname.indexOf('/shorts') === 0;
    } catch (e) {
      return false;
    }
  }

  function isMobileYouTubeShortsUrl(value) {
    if (!value) return false;
    try {
      var parsed = new URL(value, window.location.href);
      var host = String(parsed.hostname || '').toLowerCase();
      return host === 'm.youtube.com' && parsed.pathname.indexOf('/shorts') === 0;
    } catch (e) {
      return false;
    }
  }

  // Profile/channel-origin Shorts often keep pathname like /@handle/shorts while the
  // active player (#shorts-player) is already mounted. URL-only gating leaves a mode gap.
  // Keep this narrow: profile/channel shorts routes + real player shell only.
  // Never treat home/feed/results shelves as shorts mode (no #shorts-player on those surfaces).
  function isProfileOrChannelShortsRoute(value) {
    try {
      const parsed = new URL(value || window.location.href, window.location.href);
      const path = String(parsed.pathname || '/');
      return (
        new RegExp('^/@[^/]+/shorts(?:/|$)', 'i').test(path) ||
        new RegExp('^/channel/[^/]+/shorts(?:/|$)', 'i').test(path) ||
        new RegExp('^/c/[^/]+/shorts(?:/|$)', 'i').test(path)
      );
    } catch (e) {
      return false;
    }
  }

  function hasActiveShortsPlayerShell() {
    try {
      const player = document.getElementById('shorts-player');
      if (!player || !player.isConnected) return false;
      const frameOrMedia = player.querySelector(
        'ytm-reel-video-renderer[selected], ' +
        'ytm-reel-video-renderer[is-active], ' +
        'ytm-reel-video-renderer[aria-hidden="false"], ' +
        'ytm-reel-video-renderer[aria-current="true"], ' +
        'ytd-reel-video-renderer[is-active], ' +
        'video.html5-main-video, video, img'
      );
      return !!(frameOrMedia && frameOrMedia.isConnected);
    } catch (e) {
      return false;
    }
  }

  function isShortsModeActive() {
    if (isYouTubeShortsUrl(window.location.href)) return true;
    // DOM-gated profile/channel origin only — does not widen home/feed/watch.
    if (isProfileOrChannelShortsRoute(window.location.href) && hasActiveShortsPlayerShell()) {
      return true;
    }
    return false;
  }

  function getProfileOriginShortsDiagContext() {
    const context = {
      url: String(window.location.href || ''),
      path: '',
      isYouTube: false,
      isShortsModeActive: false,
      isProfileShortsRoute: false,
      activeShortsDomPresent: false,
      shortsPlayerPresent: false,
      activeFrameCount: 0,
      reelFrameCount: 0,
      videoCount: 0,
      imageCount: 0,
      shortsAnchorCount: 0,
    };
    try {
      const parsed = new URL(context.url, window.location.href);
      const host = String(parsed.hostname || '').toLowerCase();
      const path = String(parsed.pathname || '/');
      context.path = path;
      context.isYouTube = host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com';
      context.isShortsModeActive = isShortsModeActive();
      context.isProfileShortsRoute = (
        new RegExp('^/@[^/]+/shorts(?:/|$)', 'i').test(path) ||
        new RegExp('^/channel/[^/]+/shorts(?:/|$)', 'i').test(path) ||
        new RegExp('^/c/[^/]+/shorts(?:/|$)', 'i').test(path)
      );
      context.shortsPlayerPresent = !!document.getElementById('shorts-player');
      context.activeFrameCount = document.querySelectorAll(
        '#shorts-player ytm-reel-video-renderer[selected], ' +
        '#shorts-player ytm-reel-video-renderer[is-active], ' +
        '#shorts-player ytm-reel-video-renderer[aria-hidden="false"], ' +
        '#shorts-player ytm-shorts-lockup-view-model-v2[is-active], ' +
        '#shorts-player ytm-shorts-lockup-view-model[is-active], ' +
        'ytm-reel-video-renderer[selected], ' +
        'ytm-reel-video-renderer[is-active], ' +
        'ytm-reel-video-renderer[aria-hidden="false"], ' +
        'ytd-reel-video-renderer[is-active]'
      ).length;
      context.reelFrameCount = document.querySelectorAll(
        '#shorts-player, ytm-reel-video-renderer, ytd-reel-video-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2'
      ).length;
      context.videoCount = document.querySelectorAll('#shorts-player video, ytm-reel-video-renderer video, ytd-reel-video-renderer video, video.html5-main-video').length;
      context.imageCount = document.querySelectorAll('#shorts-player img, ytm-reel-video-renderer img, ytd-reel-video-renderer img').length;
      context.shortsAnchorCount = document.querySelectorAll('a[href*="/shorts/"]').length;
      context.activeShortsDomPresent = !!(
        context.shortsPlayerPresent ||
        context.activeFrameCount > 0 ||
        (context.reelFrameCount > 0 && context.videoCount > 0)
      );
    } catch (e) {}
    return context;
  }

  // Diagnostics only: proves whether profile/channel-origin Shorts are route-gated,
  // missing containers, missing requests, or receiving safe verdicts. No state changes.
  function warnProfileOriginShortsDiag(eventName, details, options) {
    const opts = options || {};
    const context = getProfileOriginShortsDiagContext();
    if (!opts.force && !context.isShortsModeActive && !context.isProfileShortsRoute && !context.activeShortsDomPresent) return;
    try {
      const now = Date.now();
      const store = window.__MW_PROFILE_SHORTS_DIAG_LAST__ || {};
      window.__MW_PROFILE_SHORTS_DIAG_LAST__ = store;
      const key = String(eventName || 'unknown') + '|' + context.path;
      const throttleMs = Number.isFinite(opts.throttleMs) ? opts.throttleMs : 1500;
      if (!opts.force && store[key] && (now - store[key]) < throttleMs) return;
      store[key] = now;
    } catch (e) {}
    console.warn(
      '[MW-PROFILE-SHORTS-DIAG]',
      eventName || 'unknown',
      'url=' + context.url,
      'path=' + context.path,
      'isShortsModeActive=' + context.isShortsModeActive,
      'isProfileShortsRoute=' + context.isProfileShortsRoute,
      'activeShortsDomPresent=' + context.activeShortsDomPresent,
      'shortsPlayerPresent=' + context.shortsPlayerPresent,
      'activeFrameCount=' + context.activeFrameCount,
      'reelFrameCount=' + context.reelFrameCount,
      'videoCount=' + context.videoCount,
      'imageCount=' + context.imageCount,
      'shortsAnchorCount=' + context.shortsAnchorCount,
      details || ''
    );
  }

  // Diagnostics only (active Shorts reveal pairing + profile mode-gap). No state changes.
  // Surfaces why a blurred active Short can report overlayPresent=0 / overlayAnchored=0
  // without touching frozen createRevealOverlay / resolveShortsStableBlurTarget bodies.
  function postActiveShortsTransitionDiag(stage, details) {
    try {
      postToHost({
        type: 'MW_DIAG_TRANSITION',
        stage: String(stage || 'unknown'),
        surface: 'active_shorts',
        url: window.location.href,
        navId: NAV_ID,
        pageEpoch: state.pageEpoch,
        timestamp: Date.now(),
        details: details && typeof details === 'object' ? details : {},
      });
    } catch (e) {}
  }

  function warnActiveShortsRevealPairingDiag(eventName, details, options) {
    const opts = options || {};
    const context = getProfileOriginShortsDiagContext();
    if (
      !opts.force &&
      !context.isShortsModeActive &&
      !context.isProfileShortsRoute &&
      !context.activeShortsDomPresent
    ) {
      return;
    }
    try {
      const now = Date.now();
      const store = window.__MW_ACTIVE_SHORTS_REVEAL_DIAG_LAST__ || {};
      window.__MW_ACTIVE_SHORTS_REVEAL_DIAG_LAST__ = store;
      const key = String(eventName || 'unknown') + '|' + context.path;
      const throttleMs = Number.isFinite(opts.throttleMs) ? opts.throttleMs : 1200;
      if (!opts.force && store[key] && (now - store[key]) < throttleMs) return;
      store[key] = now;
    } catch (e) {}
    const d = details && typeof details === 'object' ? details : {};
    console.warn(
      '[MW-ACTIVE-SHORTS-REVEAL-DIAG]',
      eventName || 'unknown',
      'url=' + context.url,
      'path=' + context.path,
      'isShortsModeActive=' + context.isShortsModeActive,
      'isProfileShortsRoute=' + context.isProfileShortsRoute,
      'activeShortsDomPresent=' + context.activeShortsDomPresent,
      'shortsPlayerPresent=' + context.shortsPlayerPresent,
      'targetNodeId=' + String(d.targetNodeId || 'none'),
      'targetTag=' + String(d.targetTag || 'none'),
      'mwModerated=' + String(d.mwModerated || 'none'),
      'hasComputedBlur=' + String(!!d.hasComputedBlur),
      'overlayExpected=' + String(!!d.overlayExpected),
      'overlayPresent=' + String(!!d.overlayPresent),
      'overlayAttached=' + String(!!d.overlayAttached),
      'overlayVisible=' + String(!!d.overlayVisible),
      'overlayAnchored=' + String(!!d.overlayAnchored),
      'portalOverlayCount=' + String(Number.isFinite(d.portalOverlayCount) ? d.portalOverlayCount : -1),
      'ownerTokenPresent=' + String(!!d.ownerTokenPresent),
      'elementOwnerTokenPresent=' + String(!!d.elementOwnerTokenPresent),
      'ownerTokensMatch=' + String(!!d.ownerTokensMatch),
      'contextSrcKey=' + String(d.contextSrcKey || 'none'),
      'reason=' + String(d.reason || 'unknown'),
      'failClass=' + String(d.failClass || 'unknown')
    );
    postActiveShortsTransitionDiag(eventName || 'active_shorts_reveal_diag', d);
  }

  function classifyActiveShortsRevealGap(targetNode, overlayState, options) {
    const opts = options || {};
    const src = String(opts.src || (targetNode && targetNode.dataset && targetNode.dataset.mwSrc) || '');
    const context = opts.context || (targetNode ? getShortsBlurContextForNode(targetNode) : null);
    const activeOwnerToken = context && context.ownerToken ? String(context.ownerToken) : '';
    const elementOwnerToken = targetNode && targetNode.dataset
      ? String(targetNode.dataset.mwShortsOwnerToken || '')
      : '';
    const portal = document.getElementById(REVEAL_PORTAL_ID);
    const portalOverlayCount = portal && typeof portal.querySelectorAll === 'function'
      ? portal.querySelectorAll('.mw-reveal-overlay').length
      : 0;
    const moderated = !!(targetNode && targetNode.dataset && targetNode.dataset.mwModerated === 'blurred');
    const attached = !!(overlayState && overlayState.overlayAttached);
    const visible = !!(overlayState && overlayState.overlayVisible);
    let failClass = 'healthy';
    if (!targetNode || !targetNode.isConnected) failClass = 'target_disconnected';
    else if (!moderated) failClass = 'not_moderated_blurred';
    else if (!attached && portalOverlayCount > 0) failClass = 'portal_orphan_or_lookup_miss';
    else if (!attached && activeOwnerToken && elementOwnerToken && activeOwnerToken !== elementOwnerToken) {
      failClass = 'owner_token_mismatch';
    } else if (!attached && activeOwnerToken && !elementOwnerToken) {
      failClass = 'owner_token_unstamped';
    } else if (!attached && !activeOwnerToken && !elementOwnerToken) {
      failClass = 'owner_context_missing';
    } else if (!attached) failClass = 'overlay_missing';
    else if (attached && !visible) failClass = 'overlay_hidden';
    else failClass = 'blur_without_visible_reveal';
    return {
      targetNodeId: getDiagNodeId(targetNode),
      targetTag: String(targetNode && targetNode.tagName ? targetNode.tagName : 'none'),
      mwModerated: String(targetNode && targetNode.dataset ? (targetNode.dataset.mwModerated || 'none') : 'none'),
      hasComputedBlur: !!opts.hasComputedBlur,
      overlayExpected: opts.overlayExpected !== false,
      overlayPresent: !!(attached && visible),
      overlayAttached: !!attached,
      overlayVisible: !!visible,
      overlayAnchored: !!opts.overlayAnchored,
      portalOverlayCount: portalOverlayCount,
      ownerTokenPresent: !!activeOwnerToken,
      elementOwnerTokenPresent: !!elementOwnerToken,
      ownerTokensMatch: !!(activeOwnerToken && elementOwnerToken && activeOwnerToken === elementOwnerToken),
      contextSrcKey: getDiagItemKey(src || (context && context.src) || ''),
      reason: String(opts.reason || 'unknown'),
      failClass: failClass,
    };
  }

  // Fires when active Shorts player DOM is present but URL gate is false
  // (typical profile/channel intermediate route before /shorts/ID rewrite).
  function warnActiveShortsModeGapDiag(trigger) {
    const context = getProfileOriginShortsDiagContext();
    if (context.isShortsModeActive || !context.activeShortsDomPresent) return;
    warnActiveShortsRevealPairingDiag(
      'mode_gap_active_dom_without_shorts_url',
      {
        reason: String(trigger || 'unknown'),
        failClass: context.isProfileShortsRoute ? 'profile_route_mode_gap' : 'dom_present_mode_gap',
        overlayExpected: false,
        overlayPresent: false,
        overlayAttached: false,
        overlayVisible: false,
        overlayAnchored: false,
        hasComputedBlur: false,
      },
      { throttleMs: 2000 }
    );
    warnProfileOriginShortsDiag(
      'mode_gap_active_dom_without_shorts_url',
      'trigger=' + String(trigger || 'unknown'),
      { throttleMs: 2000 }
    );
  }

  function isYouTubeMainPageThumbnailSurfaceUrl(value) {
    if (!value) return false;
    try {
      var parsed = new URL(value, window.location.href);
      var host = String(parsed.hostname || '').toLowerCase();
      var isYouTubeMainHost =
        host === 'youtube.com' ||
        host === 'www.youtube.com' ||
        host === 'm.youtube.com';
      if (!isYouTubeMainHost) return false;
      var path = String(parsed.pathname || '/').toLowerCase();
      // FREEZE-OVERRIDE (MVP surface): AGENTS.md requires watch-page recommendation
      // thumbnails. Ownership/reattach/reveal-heal must run on /watch without
      // enabling Shorts mode (path /shorts is separate).
      return (
        path === '/' ||
        path.indexOf('/feed') === 0 ||
        path.indexOf('/results') === 0 ||
        path.indexOf('/watch') === 0 ||
        path.indexOf('/@') === 0 ||
        path.indexOf('/channel/') === 0 ||
        path.indexOf('/c/') === 0
      );
    } catch (e) {
      return false;
    }
  }

  function shouldDisableRevealUiForMvpMainPageSurface() {
    return false;
  }

  function getDiagUrlFamily(value) {
    if (!value) return 'unknown';
    if (isYouTubeShortsUrl(value)) return 'youtube_shorts';
    if (isYouTubeDomainUrl(value)) {
      try {
        const parsed = new URL(value, window.location.href);
        return String(parsed.hostname || '').toLowerCase() === 'm.youtube.com' ? 'youtube_mobile' : 'youtube';
      } catch (e) {
        return 'youtube';
      }
    }
    try {
      const parsed = new URL(value, window.location.href);
      return String(parsed.hostname || '').toLowerCase() || 'unknown';
    } catch (e) {
      return 'unknown';
    }
  }

  function diagLogScanSource(tag, details) {
    console.log(
      '[DIAG][SCAN_SOURCE]',
      tag,
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch,
      'urlFamily=' + getDiagUrlFamily(window.location.href),
      details || ''
    );
  }

  function diagLogEpochBypass(tag, reason, requestEpoch, currentEpoch, urlValue) {
    console.log(
      '[DIAG][EPOCH_BYPASS]',
      tag,
      'reason=' + (reason || 'none'),
      'navId=' + NAV_ID,
      'requestPageEpoch=' + (Number.isFinite(requestEpoch) ? String(requestEpoch) : 'none'),
      'currentPageEpoch=' + (Number.isFinite(currentEpoch) ? String(currentEpoch) : 'none'),
      'urlFamily=' + getDiagUrlFamily(urlValue || window.location.href),
      'url=' + (urlValue || window.location.href)
    );
  }

  function diagLogObserverMode(modeOn, reason, urlValue, extra) {
    const eventName = modeOn ? 'shorts_attr_mode_on' : 'shorts_attr_mode_off';
    if (modeOn) {
      diagObserverModeCounters.shorts_attr_mode_on += 1;
    } else {
      diagObserverModeCounters.shorts_attr_mode_off += 1;
    }
    const transitioned = diagObserverModeState.initialized && diagObserverModeState.current !== modeOn;
    if (transitioned) {
      diagObserverModeCounters.transitions += 1;
    }
    diagObserverModeState.current = modeOn;
    diagObserverModeState.initialized = true;
    console.log(
      '[DIAG][OBSERVER_MODE]',
      eventName,
      'transitioned=' + transitioned,
      'transitionCount=' + diagObserverModeCounters.transitions,
      'reason=' + (reason || 'none'),
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch,
      'urlFamily=' + getDiagUrlFamily(urlValue || window.location.href),
      'url=' + (urlValue || window.location.href),
      extra || ''
    );
  }

  function isRelevantShortsContainerNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const element = node;
    if (element.id === 'shorts-player') return true;
    const tag = String(element.tagName || '').toUpperCase();
    return (
      tag === 'YTM-REEL-VIDEO-RENDERER' ||
      tag === 'YTM-SHORTS-LOCKUP-VIEW-MODEL' ||
      tag === 'YTD-REEL-VIDEO-RENDERER'
    );
  }

  function shouldReevaluateShortsModeOnContainerAttribute(target, attrName) {
    if (!isRelevantShortsContainerNode(target)) return false;
    return (
      attrName === 'aria-hidden' ||
      attrName === 'hidden' ||
      attrName === 'selected' ||
      attrName === 'is-active' ||
      attrName === 'style' ||
      attrName === 'class' ||
      attrName === 'aria-current' ||
      attrName.indexOf('data-') === 0
    );
  }

  function resolveShortsObserverMode(urlValue) {
    return isYouTubeShortsUrl(urlValue || window.location.href);
  }

  function reevaluateShortsObserverMode(reason, urlValue, options) {
    const opts = options || {};
    const resolvedUrl = urlValue || window.location.href;
    const previousMode = diagObserverModeState.initialized ? !!diagObserverModeState.current : null;
    const nextMode = resolveShortsObserverMode(resolvedUrl);
    const transitioned = previousMode !== null && previousMode !== nextMode;
    if (!diagObserverModeState.initialized || transitioned || opts.forceLog === true) {
      diagLogObserverMode(nextMode, reason, resolvedUrl, opts.extra || '');
    }
    if (transitioned) {
      console.log(
        '[DIAG][OBSERVER_MODE]',
        'observer_mode_transition_reason',
        'reason=' + (reason || 'none'),
        'from=' + (previousMode ? 'on' : 'off'),
        'to=' + (nextMode ? 'on' : 'off'),
        'navId=' + NAV_ID,
        'pageEpoch=' + state.pageEpoch,
        'url=' + resolvedUrl
      );
    }
    return { mode: nextMode, transitioned: transitioned };
  }

  function diagLogApplyByItemId(itemId, src, element, extra) {
    if (!element || element.nodeType !== 1) return;
    const normalizedSrc = normalizeUrl(src || '') || String(src || '');
    const previousSrc = normalizeUrl(element.dataset && element.dataset.mwLastScanSrc ? element.dataset.mwLastScanSrc : '') || '';
    const recycled = !!previousSrc && !!normalizedSrc && previousSrc !== normalizedSrc;
    const newlyDiscovered = !diagApplySeenNodes.has(element);
    if (newlyDiscovered) {
      diagApplySeenNodes.add(element);
    }
    diagApplyCounters.apply_by_item_id += 1;
    console.log(
      '[DIAG][APPLY_PROVENANCE]',
      'apply_by_item_id',
      'count=' + diagApplyCounters.apply_by_item_id,
      'itemId=' + (itemId || 'none'),
      'src=' + String(src || '').substring(0, 180),
      'nodeId=' + getDiagNodeId(element),
      'tag=' + (element.tagName || 'unknown'),
      'nodeRecycled=' + recycled,
      'nodeNewlyDiscovered=' + newlyDiscovered,
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch,
      'urlFamily=' + getDiagUrlFamily(window.location.href),
      extra || ''
    );
  }

  function diagLogLifecycleSnapshot(eventName, reason, previousUrl, nextUrl) {
    diagLifecycleCounters.snapshots += 1;
    let activeTimerCount = 0;
    try {
      activeTimerCount = countActiveTimerHandles();
    } catch (e) {
      activeTimerCount = 0;
    }
    const activeTimerNames = [];
    if (timerState.legacyResultsInterval) activeTimerNames.push('legacyResultsInterval');
    if (timerState.urlChangeInterval) activeTimerNames.push('urlChangeInterval');
    if (timerState.youtubePeriodicInterval) activeTimerNames.push('youtubePeriodicInterval');
    if (timerState.shortsHealthHealInterval) activeTimerNames.push('shortsHealthHealInterval');
    if (timerState.mainScrollTimeout) activeTimerNames.push('mainScrollTimeout');
    if (timerState.youtubeScrollTimeout) activeTimerNames.push('youtubeScrollTimeout');
    if (timerState.youtubeMutationScanTimeout) activeTimerNames.push('youtubeMutationScanTimeout');
    if (timerState.revealOverlayRepositionRaf) activeTimerNames.push('revealOverlayRepositionRaf');
    if (timerState.revealOverlayRetryTimeout) activeTimerNames.push('revealOverlayRetryTimeout');
    if (batchTimer) activeTimerNames.push('batchTimer');
    if (mutationScanTimer) activeTimerNames.push('mutationScanTimer');
    if (adaptiveShortsWatchState.pendingRescanTimer) activeTimerNames.push('adaptiveShortsRescanTimeout');
    if (adaptiveShortsWatchState.observer) activeTimerNames.push('adaptiveShortsOverlayObserver');
    const activeInstanceId = window.__MW_ACTIVE_INSTANCE_ID__ || 'none';
    console.log(
      '[DIAG][LIFECYCLE_SNAPSHOT]',
      'event=' + (eventName || 'unknown'),
      'reason=' + (reason || 'none'),
      'snapshotCount=' + diagLifecycleCounters.snapshots,
      'activeTimers=' + activeTimerCount,
      'activeTimerNames=' + (activeTimerNames.length ? activeTimerNames.join(',') : 'none'),
      'listenerStatus=' + 'message=true,messageFromNative=true,visibility=true',
      'activeInstanceId=' + activeInstanceId,
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch,
      'currentUrl=' + window.location.href,
      'urlFamily=' + getDiagUrlFamily(window.location.href),
      'previousUrl=' + (previousUrl || 'none'),
      'nextUrl=' + (nextUrl || 'none'),
      'overlayHostState=' + (overlayState.enabled ? 'enabled' : 'disabled'),
      'overlayReason=' + overlayState.reason,
      'moderationEnabled=' + (CONFIG.enabled && CONFIG.sensitivity > 0)
    );
  }

  function getCurrentShortsUrlId() {
    if (!isShortsModeActive()) return '';
    try {
      const parsed = new URL(window.location.href, window.location.href);
      const match = String(parsed.pathname || '').match(/\\/shorts\\/([^/?#]+)/);
      if (match && match[1]) return String(match[1]);
    } catch (e) {}
    return '';
  }

  function getYouTubeAssetVideoId(rawUrl) {
    const normalized = normalizeUrl(rawUrl || '') || String(rawUrl || '');
    if (!normalized) return '';
    try {
      const parsed = new URL(normalized, window.location.href);
      const host = String(parsed.hostname || '').toLowerCase();
      const isYouTubeFamilyHost =
        host.indexOf('youtube.com') !== -1 ||
        host.indexOf('youtu.be') !== -1 ||
        host.indexOf('ytimg.com') !== -1 ||
        host.indexOf('googlevideo.com') !== -1;
      if (!isYouTubeFamilyHost) return '';
      const queryId = parsed.searchParams.get('v');
      if (queryId) return String(queryId);
      const shortsMatch = String(parsed.pathname || '').match(/\\/shorts\\/([^/?#]+)/);
      if (shortsMatch && shortsMatch[1]) return String(shortsMatch[1]);
      const viMatch = String(parsed.pathname || '').match(/\\/vi(?:_webp)?\\/([^/]+)/);
      if (viMatch && viMatch[1]) return String(viMatch[1]);
    } catch (e) {}
    return '';
  }

  function getShortsCardOrPlayerContainerFromNode(node) {
    if (!isShortsModeActive()) {
      warnProfileOriginShortsDiag(
        'container_lookup_blocked',
        'reason=shorts_mode_inactive nodeTag=' + String(node && node.tagName ? node.tagName : 'none') +
        ' nodeId=' + getDiagNodeId(node),
        { throttleMs: 3000 }
      );
      return null;
    }
    const containerSelector = SHORTS_STABLE_CONTAINER_TAG_SELECTOR;
    if (node && node.nodeType === 1) {
      if (typeof node.closest === 'function') {
        const closest = node.closest(containerSelector);
        if (closest) return closest;
      }
      if (node.id === 'shorts-player') return node;
    }
    const baseline = node ? diagNodeParentAtBlur.get(node) : null;
    const baselineParent = baseline && baseline.parent ? baseline.parent : null;
    if (baselineParent && baselineParent.nodeType === 1) {
      if (typeof baselineParent.closest === 'function') {
        const closestParent = baselineParent.closest(containerSelector);
        if (closestParent) return closestParent;
      }
      if (baselineParent.id === 'shorts-player') return baselineParent;
    }
    return null;
  }

  function getActiveShortsPlayerContainer() {
    if (!isShortsModeActive()) {
      warnProfileOriginShortsDiag(
        'active_container_blocked',
        'reason=shorts_mode_inactive',
        { throttleMs: 3000 }
      );
      return null;
    }
    for (let i = 0; i < SHORTS_STABLE_CONTAINER_SELECTORS.length; i += 1) {
      const found = document.querySelector(SHORTS_STABLE_CONTAINER_SELECTORS[i]);
      if (found && found.isConnected) {
        warnProfileOriginShortsDiag(
          'active_container_found',
          'selector=' + SHORTS_STABLE_CONTAINER_SELECTORS[i] +
          ' nodeId=' + getDiagNodeId(found) +
          ' tag=' + String(found.tagName || 'unknown'),
          { throttleMs: 3000 }
        );
        return found;
      }
    }
    const fallbackVideo = document.querySelector('#shorts-player video, ytm-reel-video-renderer video, video');
    if (fallbackVideo && fallbackVideo.isConnected) {
      const fallbackContainer = getShortsCardOrPlayerContainerFromNode(fallbackVideo);
      const resolvedFallback = fallbackContainer || fallbackVideo;
      warnProfileOriginShortsDiag(
        'active_container_fallback_video',
        'videoNodeId=' + getDiagNodeId(fallbackVideo) +
        ' resolvedNodeId=' + getDiagNodeId(resolvedFallback) +
        ' resolvedTag=' + String(resolvedFallback.tagName || 'unknown'),
        { throttleMs: 3000 }
      );
      return resolvedFallback;
    }
    warnProfileOriginShortsDiag('active_container_missing', 'reason=no_selector_or_fallback_video', { throttleMs: 3000 });
    return null;
  }

  function resolveAdaptiveShortsWatchRoot() {
    if (!isShortsModeActive()) return null;
    const shortsPlayer = document.getElementById('shorts-player');
    if (shortsPlayer && shortsPlayer.isConnected) return shortsPlayer;
    return getActiveShortsPlayerContainer();
  }

  function isAdaptiveShortsScopeNode(node, root) {
    if (!node || node.nodeType !== 1) return false;
    if (node === root) return true;
    if (isRelevantShortsContainerNode(node)) return true;
    const element = node;
    if (root && typeof root.contains === 'function' && root.contains(element)) return true;
    if (typeof element.closest === 'function') {
      return !!element.closest('#shorts-player, ytm-reel-video-renderer, ytm-shorts-lockup-view-model');
    }
    return false;
  }

  function isAdaptiveOverlayNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.id === 'mw-blur-overlay') return true;
    if (node.classList && node.classList.contains('mw-reveal-overlay')) return true;
    if (typeof node.querySelector === 'function') {
      if (node.querySelector('.mw-reveal-overlay')) return true;
      if (node.querySelector('#mw-blur-overlay')) return true;
    }
    return false;
  }

  function getAdaptiveActiveShortsCandidateIdentity() {
    const shortsUrlId = getCurrentShortsUrlId() || 'none';
    const container = getActiveShortsPlayerContainer();
    if (!container || !container.isConnected) {
      return {
        shortsUrlId: shortsUrlId,
        identity: 'none|' + shortsUrlId,
        contentIdentity: 'none|' + shortsUrlId,
        container: null,
        mediaNode: null,
        sourceKey: 'none',
        overlayCount: 0,
      };
    }

    let mediaNode = null;
    const containerTag = String(container.tagName || '').toUpperCase();
    if (containerTag === 'VIDEO' || containerTag === 'IMG') {
      mediaNode = container;
    } else if (typeof container.querySelector === 'function') {
      mediaNode = container.querySelector('video.html5-main-video, video, img');
    }
    const sourceNode = mediaNode || container;
    const source = getDiagSourceFields(sourceNode);
    const srcAttr = sourceNode && sourceNode.getAttribute ? String(sourceNode.getAttribute('src') || '') : '';
    const posterAttr = sourceNode && sourceNode.getAttribute ? String(sourceNode.getAttribute('poster') || '') : '';
    const normalizedCurrentSrc = normalizeUrl(source.currentSrc || srcAttr || '') || String(source.currentSrc || srcAttr || '');
    const normalizedPoster = normalizeUrl(source.poster || posterAttr || '') || String(source.poster || posterAttr || '');
    const nodeVideoId = sourceNode && sourceNode.getAttribute
      ? String(sourceNode.getAttribute('data-video-id') || sourceNode.getAttribute('data-item-id') || '')
      : '';
    const containerVideoId = container && container.getAttribute
      ? String(container.getAttribute('data-video-id') || container.getAttribute('data-item-id') || '')
      : '';
    const dataVideoId = nodeVideoId || containerVideoId || '';
    const sourceKey = (dataVideoId || normalizedCurrentSrc || normalizedPoster || 'none').substring(0, 220);
    const selectedState = String(
      (container.getAttribute && (
        container.getAttribute('selected') ||
        container.getAttribute('is-active') ||
        container.getAttribute('aria-hidden')
      )) || 'none'
    );
    const classHint = String(getDiagClassList(container) || '').split(' ').slice(0, 2).join('.');
    const overlayCount = (typeof container.querySelectorAll === 'function')
      ? container.querySelectorAll('.mw-reveal-overlay').length
      : 0;
    const contentIdentity = shortsUrlId + '|' + sourceKey;
    const identity =
      contentIdentity +
      '|container=' + getDiagNodeId(container) +
      '|media=' + getDiagNodeId(mediaNode || container) +
      '|state=' + selectedState +
      '|class=' + (classHint || 'none') +
      '|overlay=' + overlayCount;
    return {
      shortsUrlId: shortsUrlId,
      identity: identity,
      contentIdentity: contentIdentity,
      container: container,
      mediaNode: mediaNode,
      sourceKey: sourceKey,
      overlayCount: overlayCount,
    };
  }

  function logActiveShortsCandidateIdentity(reason, candidateInfo, forceLog) {
    if (!isShortsModeActive()) return;
    const candidate = candidateInfo || getAdaptiveActiveShortsCandidateIdentity();
    const identity = candidate && candidate.identity ? candidate.identity : 'none';
    const now = Date.now();
    const shouldSkip = (
      !forceLog &&
      adaptiveShortsWatchState.lastIdentity === identity &&
      (now - adaptiveShortsWatchState.lastIdentityLoggedAt) < 1200
    );
    if (shouldSkip) return;
    adaptiveShortsWatchState.lastIdentityLoggedAt = now;
    logAdaptiveShortsEvent(
      'active_candidate_identity',
      'reason=' + (reason || 'unknown') +
      ' identity=' + String(identity || 'none').substring(0, 240) +
      ' contentIdentity=' + String(candidate && candidate.contentIdentity ? candidate.contentIdentity : 'none').substring(0, 220) +
      ' sourceKey=' + String(candidate && candidate.sourceKey ? candidate.sourceKey : 'none').substring(0, 220) +
      ' shortsUrlId=' + String(candidate && candidate.shortsUrlId ? candidate.shortsUrlId : 'none') +
      ' containerNodeId=' + getDiagNodeId(candidate && candidate.container ? candidate.container : null) +
      ' mediaNodeId=' + getDiagNodeId(candidate && candidate.mediaNode ? candidate.mediaNode : null) +
      ' overlayCount=' + String(candidate && Number.isFinite(candidate.overlayCount) ? candidate.overlayCount : 0)
    );
  }

  function clearAdaptiveShortsRescanTimer(reason) {
    if (!adaptiveShortsWatchState.pendingRescanTimer) return;
    clearTimeout(adaptiveShortsWatchState.pendingRescanTimer);
    adaptiveShortsWatchState.pendingRescanTimer = null;
    logAdaptiveShortsEvent(
      'targeted_rescan_skipped',
      'reason=' + (reason || 'rescan_timer_cleared') +
      ' detail=timer_cleared'
    );
  }

  function triggerAdaptiveShortsTargetedRescan(reason, candidateInfo, options) {
    if (!isShortsModeActive()) {
      warnProfileOriginShortsDiag(
        'targeted_rescan_blocked',
        'reason=shorts_mode_inactive trigger=' + (reason || 'unknown'),
        { throttleMs: 2500 }
      );
      return;
    }
    // FREEZE-OVERRIDE: stamp before the existing rescan debounce/cooldown.
    markFlashShieldShortsCandidate();
    scheduleFlashShieldShortsBurst('adaptive:' + (reason || 'unknown'));
    const opts = options || {};
    const candidate = candidateInfo || getAdaptiveActiveShortsCandidateIdentity();
    const identity = candidate && candidate.contentIdentity ? candidate.contentIdentity : 'none';
    const now = Date.now();
    if (
      !opts.force &&
      adaptiveShortsWatchState.lastRescanIdentity === identity &&
      (now - adaptiveShortsWatchState.lastRescanAt) < ADAPTIVE_SHORTS_RESCAN_COOLDOWN_MS
    ) {
      logAdaptiveShortsEvent(
        'targeted_rescan_skipped',
        'reason=dedupe_cooldown' +
        ' trigger=' + (reason || 'unknown') +
        ' identity=' + String(identity || 'none').substring(0, 220) +
        ' sinceMs=' + (now - adaptiveShortsWatchState.lastRescanAt)
      );
      return;
    }
    if (adaptiveShortsWatchState.pendingRescanTimer) {
      if (!opts.force) {
        logAdaptiveShortsEvent(
          'targeted_rescan_skipped',
          'reason=pending_timer' +
          ' trigger=' + (reason || 'unknown') +
          ' identity=' + String(identity || 'none').substring(0, 220)
        );
        return;
      }
      clearAdaptiveShortsRescanTimer('force_reschedule');
    }
    const delayMs = opts.immediate ? 0 : ADAPTIVE_SHORTS_RESCAN_DEBOUNCE_MS;
    adaptiveShortsWatchState.pendingRescanTimer = setTimeout(function() {
      adaptiveShortsWatchState.pendingRescanTimer = null;
      if (timerState.paused || timerState.teardownDone || !isShortsModeActive()) {
        logAdaptiveShortsEvent(
          'targeted_rescan_skipped',
          'reason=inactive_state' +
          ' trigger=' + (reason || 'unknown')
        );
        return;
      }
      const liveCandidate = getAdaptiveActiveShortsCandidateIdentity();
      if (!liveCandidate.container || !liveCandidate.container.isConnected) {
        logAdaptiveShortsEvent(
          'targeted_rescan_skipped',
          'reason=no_active_container' +
          ' trigger=' + (reason || 'unknown')
        );
        return;
      }
      const liveIdentity = liveCandidate.contentIdentity || 'none';
      const runAt = Date.now();
      if (
        !opts.force &&
        adaptiveShortsWatchState.lastRescanIdentity === liveIdentity &&
        (runAt - adaptiveShortsWatchState.lastRescanAt) < ADAPTIVE_SHORTS_RESCAN_COOLDOWN_MS
      ) {
        logAdaptiveShortsEvent(
          'targeted_rescan_skipped',
          'reason=dedupe_after_delay' +
          ' trigger=' + (reason || 'unknown') +
          ' identity=' + String(liveIdentity || 'none').substring(0, 220)
        );
        return;
      }
      adaptiveShortsWatchState.lastRescanAt = runAt;
      adaptiveShortsWatchState.lastRescanIdentity = liveIdentity;
      try { clearStaleShortsRevealMarkersOnSwipe('adaptive_rescan:' + (reason || 'unknown')); } catch (eSwipe) {}
      logAdaptiveShortsEvent(
        'targeted_rescan_triggered',
        'reason=' + (reason || 'unknown') +
        ' identity=' + String(liveIdentity || 'none').substring(0, 220) +
        ' containerNodeId=' + getDiagNodeId(liveCandidate.container)
      );
      warnProfileOriginShortsDiag(
        'targeted_rescan_triggered',
        'reason=' + (reason || 'unknown') +
        ' identity=' + String(liveIdentity || 'none').substring(0, 220) +
        ' containerNodeId=' + getDiagNodeId(liveCandidate.container),
        { throttleMs: 1000 }
      );
      const scanned = scanActiveShortsPlayerContainer('adaptive:' + (reason || 'unknown'));
      if (!scanned) {
        logAdaptiveShortsEvent(
          'targeted_rescan_skipped',
          'reason=scan_returned_false' +
          ' trigger=' + (reason || 'unknown') +
          ' identity=' + String(liveIdentity || 'none').substring(0, 220)
        );
      }
    }, delayMs);
  }

  function stopAdaptiveShortsOverlayWatch(reason) {
    const hadObserver = !!adaptiveShortsWatchState.observer;
    const hadTimer = !!adaptiveShortsWatchState.pendingRescanTimer;
    if (adaptiveShortsWatchState.pendingRescanTimer) {
      clearTimeout(adaptiveShortsWatchState.pendingRescanTimer);
      adaptiveShortsWatchState.pendingRescanTimer = null;
    }
    if (adaptiveShortsWatchState.observer) {
      try { adaptiveShortsWatchState.observer.disconnect(); } catch (e) {}
      adaptiveShortsWatchState.observer = null;
    }
    adaptiveShortsWatchState.rootNode = null;
    adaptiveShortsWatchState.rootNodeId = 'none';
    adaptiveShortsWatchState.active = false;
    adaptiveShortsWatchState.lastIdentity = '';
    adaptiveShortsWatchState.lastRescanIdentity = '';
    adaptiveShortsWatchState.lastRescanAt = 0;
    if (hadObserver || hadTimer) {
      logAdaptiveShortsEvent(
        'adaptive_overlay_watch_stop',
        'reason=' + (reason || 'unknown')
      );
    }
  }

  function refreshAdaptiveShortsOverlayWatch(reason) {
    if (!isShortsModeActive() || timerState.paused || timerState.teardownDone) {
      warnProfileOriginShortsDiag(
        'adaptive_watch_blocked',
        'reason=' + (!isShortsModeActive() ? 'shorts_mode_inactive' : (timerState.paused ? 'paused' : 'teardown')) +
        ' trigger=' + (reason || 'unknown'),
        { throttleMs: 2500 }
      );
      if (!isShortsModeActive()) {
        warnActiveShortsModeGapDiag('adaptive_watch_blocked:' + (reason || 'unknown'));
      }
      stopAdaptiveShortsOverlayWatch('inactive:' + (reason || 'unknown'));
      return false;
    }
    const root = resolveAdaptiveShortsWatchRoot();
    if (!root || !root.isConnected) {
      warnProfileOriginShortsDiag(
        'adaptive_watch_no_root',
        'trigger=' + (reason || 'unknown'),
        { throttleMs: 2500 }
      );
      postActiveShortsTransitionDiag('adaptive_watch_no_root', {
        reason: String(reason || 'unknown'),
      });
      stopAdaptiveShortsOverlayWatch('no_root:' + (reason || 'unknown'));
      logAdaptiveShortsEvent(
        'targeted_rescan_skipped',
        'reason=no_watch_root' +
        ' trigger=' + (reason || 'unknown')
      );
      return false;
    }
    if (adaptiveShortsWatchState.observer && adaptiveShortsWatchState.rootNode === root) {
      return true;
    }
    warnProfileOriginShortsDiag(
      'adaptive_watch_attached',
      'trigger=' + (reason || 'unknown') +
      ' rootNodeId=' + getDiagNodeId(root) +
      ' rootTag=' + String(root.tagName || 'unknown'),
      { throttleMs: 2500 }
    );
    stopAdaptiveShortsOverlayWatch('refresh:' + (reason || 'unknown'));
    adaptiveShortsWatchState.rootNode = root;
    adaptiveShortsWatchState.rootNodeId = getDiagNodeId(root);

    const observer = new MutationObserver(function(mutations) {
      if (timerState.paused || timerState.teardownDone || !isShortsModeActive()) return;
      let sawOverlayMutation = false;
      let sawActiveMutation = false;
      const reasonParts = [];
      for (let i = 0; i < mutations.length; i += 1) {
        const mutation = mutations[i];
        if (mutation.type === 'childList') {
          for (let j = 0; j < mutation.addedNodes.length; j += 1) {
            const addedNode = mutation.addedNodes[j];
            if (!addedNode || addedNode.nodeType !== 1) continue;
            if (isAdaptiveShortsScopeNode(addedNode, root)) {
              sawActiveMutation = true;
              if (reasonParts.length < 3) reasonParts.push('child_added');
            }
            if (isAdaptiveOverlayNode(addedNode)) {
              sawOverlayMutation = true;
              if (reasonParts.length < 3) reasonParts.push('overlay_added');
            }
          }
          for (let j = 0; j < mutation.removedNodes.length; j += 1) {
            const removedNode = mutation.removedNodes[j];
            if (!removedNode || removedNode.nodeType !== 1) continue;
            if (isAdaptiveShortsScopeNode(removedNode, root)) {
              sawActiveMutation = true;
              if (reasonParts.length < 3) reasonParts.push('child_removed');
            }
            if (isAdaptiveOverlayNode(removedNode)) {
              sawOverlayMutation = true;
              if (reasonParts.length < 3) reasonParts.push('overlay_removed');
            }
          }
        } else if (mutation.type === 'attributes') {
          const target = mutation.target;
          const attrName = mutation.attributeName || '';
          if (!target || target.nodeType !== 1 || !isAdaptiveShortsScopeNode(target, root)) continue;
          const isActiveAttrSignal = (
            attrName === 'class' ||
            attrName === 'style' ||
            attrName === 'hidden' ||
            attrName === 'aria-hidden' ||
            attrName === 'aria-current' ||
            attrName === 'selected' ||
            attrName === 'is-active' ||
            attrName === 'src' ||
            attrName === 'poster' ||
            attrName.indexOf('data-') === 0
          );
          if (isActiveAttrSignal) {
            sawActiveMutation = true;
            if (reasonParts.length < 3) reasonParts.push('attr:' + attrName);
          }
          if (isAdaptiveOverlayNode(target)) {
            sawOverlayMutation = true;
            if (reasonParts.length < 3) reasonParts.push('overlay_attr:' + attrName);
          }
        }
      }
      if (!sawOverlayMutation && !sawActiveMutation) return;
      const reasonSummary = reasonParts.length ? reasonParts.join(',') : 'mutation';
      const candidate = getAdaptiveActiveShortsCandidateIdentity();
      logActiveShortsCandidateIdentity('mutation:' + reasonSummary, candidate, false);
      const previousIdentity = adaptiveShortsWatchState.lastIdentity || '';
      const nextIdentity = candidate && candidate.contentIdentity ? candidate.contentIdentity : '';
      const identityChanged = !!nextIdentity && previousIdentity !== nextIdentity;
      if (identityChanged) {
        logAdaptiveShortsEvent(
          'active_shorts_item_changed',
          'reason=' + reasonSummary +
          ' from=' + String(previousIdentity || 'none').substring(0, 220) +
          ' to=' + String(nextIdentity || 'none').substring(0, 220)
        );
        adaptiveShortsWatchState.lastIdentity = nextIdentity;
        triggerAdaptiveShortsTargetedRescan('active_item_changed:' + reasonSummary, candidate, { force: true });
      } else if (!adaptiveShortsWatchState.lastIdentity && nextIdentity) {
        adaptiveShortsWatchState.lastIdentity = nextIdentity;
      }
      if (sawOverlayMutation) {
        logAdaptiveShortsEvent(
          'overlay_mutation_detected',
          'reason=' + reasonSummary +
          ' identity=' + String(nextIdentity || candidate.contentIdentity || 'none').substring(0, 220)
        );
        triggerAdaptiveShortsTargetedRescan('overlay_mutation:' + reasonSummary, candidate, { force: false });
      } else if (sawActiveMutation && !identityChanged) {
        triggerAdaptiveShortsTargetedRescan('active_mutation:' + reasonSummary, candidate, { force: false });
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ADAPTIVE_SHORTS_WATCH_ATTRIBUTE_FILTER,
    });
    adaptiveShortsWatchState.observer = observer;
    adaptiveShortsWatchState.active = true;
    const seedCandidate = getAdaptiveActiveShortsCandidateIdentity();
    adaptiveShortsWatchState.lastIdentity = seedCandidate.contentIdentity || '';
    logAdaptiveShortsEvent(
      'adaptive_overlay_watch_start',
      'reason=' + (reason || 'unknown') +
      ' rootNodeId=' + adaptiveShortsWatchState.rootNodeId +
      ' rootTag=' + String(root.tagName || 'unknown')
    );
    logActiveShortsCandidateIdentity('watch_start', seedCandidate, true);
    triggerAdaptiveShortsTargetedRescan('watch_start:' + (reason || 'unknown'), seedCandidate, {
      force: true,
      immediate: true,
    });
    return true;
  }

  function clearAdaptiveShortsActiveAssumptions(reason) {
    const previousIdentity = adaptiveShortsWatchState.lastIdentity || 'none';
    const previousRescanIdentity = adaptiveShortsWatchState.lastRescanIdentity || 'none';
    clearAdaptiveShortsRescanTimer('clear_assumptions:' + (reason || 'unknown'));
    adaptiveShortsWatchState.lastIdentity = '';
    adaptiveShortsWatchState.lastIdentityLoggedAt = 0;
    adaptiveShortsWatchState.lastRescanIdentity = '';
    adaptiveShortsWatchState.lastRescanAt = 0;
    logAdaptiveShortsEvent(
      'active_assumptions_cleared',
      'reason=' + (reason || 'unknown') +
      ' prevIdentity=' + String(previousIdentity || 'none').substring(0, 220) +
      ' prevRescanIdentity=' + String(previousRescanIdentity || 'none').substring(0, 220)
    );
  }

  function refreshShortsFreshnessOnReentry(reason, options) {
    if (!isShortsModeActive()) return false;
    if (timerState.paused || timerState.teardownDone) {
      logAdaptiveShortsEvent(
        'shorts_reentry_refresh_skipped',
        'reason=inactive_state' +
        ' trigger=' + (reason || 'unknown') +
        ' paused=' + timerState.paused +
        ' teardown=' + timerState.teardownDone
      );
      return false;
    }

    const opts = options || {};
    const shouldResetContext = opts.resetContext !== false;
    const now = Date.now();
    if (!opts.force && (now - shortsReentryState.lastRefreshAt) < SHORTS_REENTRY_REFRESH_COOLDOWN_MS) {
      logAdaptiveShortsEvent(
        'shorts_reentry_refresh_skipped',
        'reason=cooldown' +
        ' trigger=' + (reason || 'unknown') +
        ' sinceMs=' + (now - shortsReentryState.lastRefreshAt)
      );
      return false;
    }

    const previousCandidate = getAdaptiveActiveShortsCandidateIdentity();
    const previousIdentity = previousCandidate && previousCandidate.contentIdentity
      ? previousCandidate.contentIdentity
      : 'none';
    shortsReentryState.lastRefreshAt = now;
    shortsReentryState.lastReason = reason || 'unknown';
    // FREEZE-OVERRIDE: immediate stamp plus bounded node-swap/reveal-heal burst.
    markFlashShieldShortsCandidate();
    scheduleFlashShieldShortsBurst('reentry:' + (reason || 'unknown'));
    [120, 250, 450, 800].forEach(function(delayMs) {
      setTimeout(function() {
        if (timerState.teardownDone) return;
        markFlashShieldShortsCandidate();
        healFlashShieldReveal('reentry:' + (reason || 'unknown'));
      }, delayMs);
    });
    logAdaptiveShortsEvent(
      'shorts_reentry_refresh_start',
      'reason=' + (reason || 'unknown') +
      ' prevIdentity=' + String(previousIdentity || 'none').substring(0, 220) +
      ' prevContainerNodeId=' + getDiagNodeId(previousCandidate && previousCandidate.container ? previousCandidate.container : null)
    );

    clearAdaptiveShortsActiveAssumptions('reentry:' + (reason || 'unknown'));
    if (shouldResetContext) {
      resetShortsBlurContext('reentry:' + (reason || 'unknown'));
    }
    stopAdaptiveShortsOverlayWatch('reentry:' + (reason || 'unknown'));
    const watchBound = refreshAdaptiveShortsOverlayWatch('reentry:' + (reason || 'unknown'));
    const nextCandidate = getAdaptiveActiveShortsCandidateIdentity();
    logActiveShortsCandidateIdentity('reentry:' + (reason || 'unknown'), nextCandidate, true);
    // Always force an immediate targeted rescan when a live candidate exists so
    // reentry does not wait solely on overlay-watch binding (or miss it entirely).
    if (nextCandidate && nextCandidate.container && nextCandidate.container.isConnected) {
      triggerAdaptiveShortsTargetedRescan('reentry_immediate:' + (reason || 'unknown'), nextCandidate, {
        force: true,
        immediate: true,
      });
    }
    if (!watchBound) {
      triggerAdaptiveShortsTargetedRescan('reentry_fallback:' + (reason || 'unknown'), nextCandidate, {
        force: true,
        immediate: true,
      });
    }
    const nextIdentity = nextCandidate && nextCandidate.contentIdentity ? nextCandidate.contentIdentity : 'none';
    logAdaptiveShortsEvent(
      'shorts_reentry_refresh_done',
      'reason=' + (reason || 'unknown') +
      ' watchBound=' + watchBound +
      ' prevIdentity=' + String(previousIdentity || 'none').substring(0, 220) +
      ' nextIdentity=' + String(nextIdentity || 'none').substring(0, 220) +
      ' nextContainerNodeId=' + getDiagNodeId(nextCandidate && nextCandidate.container ? nextCandidate.container : null)
    );
    return watchBound;
  }

  function forceFirstEntryModerationRequest(reason) {
    if (!isShortsModeActive()) return 'SKIP_NOT_SHORTS';
    if (timerState.paused || timerState.teardownDone) return 'SKIP_INACTIVE';

    // FREEZE-OVERRIDE: frosted pre-paint veil immediately on first entry.
    markFlashShieldShortsCandidate();
    scheduleFlashShieldShortsBurst('first_entry:' + (reason || 'unknown'));

    const shortsUrlId = getCurrentShortsUrlId() || '';
    const candidate = getAdaptiveActiveShortsCandidateIdentity();
    const container = candidate && candidate.container && candidate.container.isConnected
      ? candidate.container
      : getActiveShortsPlayerContainer();
    const mediaNode = candidate && candidate.mediaNode && candidate.mediaNode.isConnected
      ? candidate.mediaNode
      : (
          container && typeof container.querySelector === 'function'
            ? container.querySelector('video, img')
            : null
        );
    const fallbackNode = mediaNode || container;
    if (!fallbackNode || fallbackNode.nodeType !== 1) {
      console.warn(
        '[DIAG][SHORTS_REENTRY]',
        'action=first_entry_force_no_target',
        'reason=' + (reason || 'unknown'),
        'navId=' + NAV_ID,
        'pageEpoch=' + state.pageEpoch,
        'url=' + window.location.href
      );
      return 'NO_TARGET';
    }

    const seen = new Set();
    let queuedCount = 0;
    const queueSource = function(rawSrc, node, sourceType) {
      const normalized = normalizeUrl(rawSrc || '');
      if (!normalized) return false;
      const signature = String(sourceType || 'img') + '|' + normalized;
      if (seen.has(signature)) return false;
      seen.add(signature);
      const sourceVideoId = getYouTubeAssetVideoId(normalized);
      if (
        shortsUrlId &&
        sourceVideoId &&
        sourceVideoId !== shortsUrlId &&
        sourceType !== 'video-frame'
      ) {
        return false;
      }
      state.scanned.delete(normalized);
      clearSafeResolved(normalized);
      const existingPendingId = state.pendingBySrc.get(normalized);
      if (existingPendingId) {
        clearPendingItem(existingPendingId, 'force_first_entry_reset');
      }
      const queued = queueForScan(normalized, node, sourceType || 'img');
      if (queued) {
        queuedCount += 1;
      }
      return queued;
    };

    const queueNodeSources = function(node) {
      if (!node || node.nodeType !== 1) return;
      const source = getDiagSourceFields(node);
      const tag = String(node.tagName || '').toUpperCase();
      if (tag === 'VIDEO') {
        queueSource(source.poster || node.getAttribute('poster') || '', node, 'video-poster');
        queueSource(source.currentSrc || node.getAttribute('src') || '', node, 'video-frame');
      } else {
        queueSource(source.currentSrc || node.getAttribute('src') || '', node, 'img');
      }
      queueSource(extractBgImageUrl(node), node, 'bg-image');
    };

    queueNodeSources(fallbackNode);
    if (container && typeof container.querySelectorAll === 'function') {
      const mediaNodes = container.querySelectorAll('video, img');
      for (let i = 0; i < mediaNodes.length && i < 8; i += 1) {
        queueNodeSources(mediaNodes[i]);
      }
    }

    if (queuedCount === 0 && shortsUrlId) {
      queueSource('https://i.ytimg.com/vi/' + shortsUrlId + '/hq720.jpg', fallbackNode, 'img');
      queueSource('https://i.ytimg.com/vi/' + shortsUrlId + '/oardefault.jpg', fallbackNode, 'img');
    }

    console.warn(
      '[DIAG][SHORTS_REENTRY]',
      'action=first_entry_force_seed',
      'reason=' + (reason || 'unknown'),
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch,
      'shortsUrlId=' + (shortsUrlId || 'none'),
      'queued=' + queuedCount,
      'url=' + window.location.href
    );
    console.warn(
      '[DIAG][SHORTS_REENTRY]',
      'action=first_entry_force_seed',
      'reason=' + (reason || 'unknown'),
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch,
      'shortsUrlId=' + (shortsUrlId || 'none'),
      'queued=' + queuedCount,
      'url=' + window.location.href
    );
    // FREEZE-OVERRIDE (accuracy): after seed, schedule decoded-frame retries so
    // first-entry poster-safe does not stick until the user scrolls away/back.
    try {
      const mediaForRetry = mediaNode && mediaNode.tagName && String(mediaNode.tagName).toUpperCase() === 'VIDEO'
        ? mediaNode
        : (container && typeof container.querySelector === 'function' ? container.querySelector('video') : null);
      if (mediaForRetry) {
        scheduleActiveShortsFrameRetry(mediaForRetry, getShortsFrameScanKey(mediaForRetry), 'first_entry_force_seed');
      }
    } catch (e) {}
    if (queuedCount <= 0) return 'NO_CANDIDATES';
    return 'QUEUED:' + queuedCount;
  }

  function doesShortsContainerMatchSrc(container, normalizedSrc) {
    if (!container || container.nodeType !== 1) return false;
    if (!normalizedSrc) return true;
    const candidates = [];
    if (container.tagName === 'IMG' || container.tagName === 'VIDEO') {
      candidates.push(container);
    }
    if (typeof container.querySelectorAll === 'function') {
      container.querySelectorAll('img, video').forEach(function(candidate) {
        candidates.push(candidate);
      });
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      if (!candidate || candidate.nodeType !== 1) continue;
      const source = getDiagSourceFields(candidate);
      const currentSrc = normalizeUrl(source.currentSrc || '');
      const poster = normalizeUrl(source.poster || '');
      const attrSrc = normalizeUrl((candidate.getAttribute && candidate.getAttribute('src')) || '');
      const attrPoster = normalizeUrl((candidate.getAttribute && candidate.getAttribute('poster')) || '');
      const dataSrc = normalizeUrl((candidate.dataset && candidate.dataset.mwSrc) || '');
      const dataOrigSrc = normalizeUrl((candidate.dataset && candidate.dataset.mwOrigSrc) || '');
      const dataOrigPoster = normalizeUrl((candidate.dataset && candidate.dataset.mwOrigPoster) || '');
      if (
        currentSrc === normalizedSrc ||
        poster === normalizedSrc ||
        attrSrc === normalizedSrc ||
        attrPoster === normalizedSrc ||
        dataSrc === normalizedSrc ||
        dataOrigSrc === normalizedSrc ||
        dataOrigPoster === normalizedSrc
      ) {
        return true;
      }
    }
    return false;
  }

  function findStableShortsContainerByParentWalk(node) {
    if (!node || node.nodeType !== 1) return { target: null, selectorUsed: '' };
    let current = node;
    let shortsPlayerFallback = null;
    while (current && current.nodeType === 1) {
      const tag = String(current.tagName || '').toUpperCase();
      if (tag === 'YTM-REEL-VIDEO-RENDERER') {
        if (current.isConnected) return { target: current, selectorUsed: 'parent_walk:ytm-reel-video-renderer' };
      } else if (tag === 'YTM-SHORTS-LOCKUP-VIEW-MODEL') {
        if (current.isConnected) return { target: current, selectorUsed: 'parent_walk:ytm-shorts-lockup-view-model' };
      } else if (current.id === 'shorts-player') {
        if (current.isConnected && !shortsPlayerFallback) {
          shortsPlayerFallback = current;
        }
      }
      current = current.parentElement;
    }
    if (shortsPlayerFallback) {
      return { target: shortsPlayerFallback, selectorUsed: 'parent_walk:#shorts-player' };
    }
    return { target: null, selectorUsed: '' };
  }

  function resolveShortsStableBlurTarget(node, src) {
    if (!isShortsModeActive()) return null;
    const normalizedSrc = normalizeUrl(src || '');
    if (node && node.nodeType === 1 && typeof node.closest === 'function') {
      for (let i = 0; i < SHORTS_STABLE_CONTAINER_SELECTORS.length; i += 1) {
        const selector = SHORTS_STABLE_CONTAINER_SELECTORS[i];
        const closest = node.closest(selector);
        if (closest && closest.isConnected && doesShortsContainerMatchSrc(closest, normalizedSrc)) {
          return { target: closest, selectorUsed: 'closest:' + selector };
        }
      }
      const walked = findStableShortsContainerByParentWalk(node);
      if (walked.target && doesShortsContainerMatchSrc(walked.target, normalizedSrc)) {
        return walked;
      }
    }
    const baseline = node ? diagNodeParentAtBlur.get(node) : null;
    const baselineParent = baseline && baseline.parent ? baseline.parent : null;
    if (baselineParent && baselineParent.nodeType === 1 && typeof baselineParent.closest === 'function') {
      for (let i = 0; i < SHORTS_STABLE_CONTAINER_SELECTORS.length; i += 1) {
        const selector = SHORTS_STABLE_CONTAINER_SELECTORS[i];
        const closest = baselineParent.closest(selector);
        if (closest && closest.isConnected && doesShortsContainerMatchSrc(closest, normalizedSrc)) {
          return { target: closest, selectorUsed: 'baseline_closest:' + selector };
        }
      }
      const walkedBaseline = findStableShortsContainerByParentWalk(baselineParent);
      if (walkedBaseline.target && doesShortsContainerMatchSrc(walkedBaseline.target, normalizedSrc)) {
        return walkedBaseline;
      }
    }
    if (node && node.nodeType === 1 && node.isConnected) {
      for (let i = 0; i < SHORTS_STABLE_CONTAINER_SELECTORS.length; i += 1) {
        const selector = SHORTS_STABLE_CONTAINER_SELECTORS[i];
        const found = document.querySelector(selector);
        if (found && found.isConnected && doesShortsContainerMatchSrc(found, normalizedSrc)) {
          return { target: found, selectorUsed: 'query:' + selector };
        }
      }
      const activeContainer = getActiveShortsPlayerContainer();
      if (activeContainer && activeContainer.isConnected && doesShortsContainerMatchSrc(activeContainer, normalizedSrc)) {
        return { target: activeContainer, selectorUsed: 'active_container' };
      }
      const localContainer = getShortsCardOrPlayerContainerFromNode(node);
      if (localContainer && localContainer.isConnected && doesShortsContainerMatchSrc(localContainer, normalizedSrc)) {
        return { target: localContainer, selectorUsed: 'local_container' };
      }
      return { target: node, selectorUsed: 'self' };
    }
    return null;
  }

  function getDiagComputedBlurState(node) {
    if (!node || node.nodeType !== 1 || typeof window.getComputedStyle !== 'function') {
      return {
        filter: '',
        backdropFilter: '',
        visibility: '',
        display: '',
        opacity: '',
      };
    }
    try {
      const computed = window.getComputedStyle(node);
      return {
        filter: String(computed && computed.filter ? computed.filter : ''),
        backdropFilter: String(computed && computed.getPropertyValue ? computed.getPropertyValue('backdrop-filter') : ''),
        visibility: String(computed && computed.visibility ? computed.visibility : ''),
        display: String(computed && computed.display ? computed.display : ''),
        opacity: String(computed && computed.opacity ? computed.opacity : ''),
      };
    } catch (e) {
      return {
        filter: '',
        backdropFilter: '',
        visibility: '',
        display: '',
        opacity: '',
      };
    }
  }

  function diagLogShortsTargetResolution(reason, sourceNode, src, resolution) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    const target = resolution && resolution.target && resolution.target.nodeType === 1 ? resolution.target : null;
    const selectorUsed = resolution && resolution.selectorUsed ? resolution.selectorUsed : 'none';
    const activeContainer = getActiveShortsPlayerContainer();
    const targetComputed = getDiagComputedBlurState(target);
    const activeComputed = getDiagComputedBlurState(activeContainer);
    const targetAriaHidden = target && target.getAttribute ? String(target.getAttribute('aria-hidden') || '') : '';
    const activeAriaHidden = activeContainer && activeContainer.getAttribute ? String(activeContainer.getAttribute('aria-hidden') || '') : '';
    const activeVisible = !!(
      activeContainer &&
      activeComputed.display !== 'none' &&
      activeComputed.visibility !== 'hidden' &&
      activeComputed.opacity !== '0'
    );
    diagShortsTimeline(
      'stable_target_resolved',
      'reason=' + (reason || 'unknown') +
      ' src=' + String(src || '').substring(0, 180) +
      ' sourceTagName=' + String(sourceNode && sourceNode.tagName ? sourceNode.tagName : 'none') +
      ' sourceNodeId=' + getDiagNodeId(sourceNode) +
      ' sourceConnected=' + (!!(sourceNode && sourceNode.isConnected)) +
      ' targetTagName=' + String(target && target.tagName ? target.tagName : 'none') +
      ' targetNodeId=' + getDiagNodeId(target) +
      ' targetConnected=' + (!!(target && target.isConnected)) +
      ' selectorUsed=' + selectorUsed +
      ' targetComputedFilter=' + String(targetComputed.filter || '').substring(0, 120) +
      ' targetComputedBackdrop=' + String(targetComputed.backdropFilter || '').substring(0, 120) +
      ' targetAriaHidden=' + (targetAriaHidden || 'none') +
      ' targetRect=' + getDiagRect(target) +
      ' activeNodeId=' + getDiagNodeId(activeContainer) +
      ' activeTagName=' + String(activeContainer && activeContainer.tagName ? activeContainer.tagName : 'none') +
      ' activeAriaHidden=' + (activeAriaHidden || 'none') +
      ' activeVisible=' + activeVisible +
      ' activeRect=' + getDiagRect(activeContainer) +
      ' activeMatchesTarget=' + (!!(activeContainer && target && activeContainer === target))
    );
  }

  function getShortsBlurContextContainerForNode(node) {
    if (!isShortsModeActive()) return null;
    const containerFromNode = getShortsCardOrPlayerContainerFromNode(node);
    if (containerFromNode && containerFromNode.nodeType === 1) return containerFromNode;
    const activeContainer = getActiveShortsPlayerContainer();
    if (activeContainer && activeContainer.nodeType === 1) return activeContainer;
    return null;
  }

  function getShortsBlurContextForNode(node) {
    if (!isShortsModeActive()) return null;
    const container = getShortsBlurContextContainerForNode(node);
    if (!container || container.nodeType !== 1) return null;
    return shortsBlurContextByContainer.get(container) || null;
  }

  function buildShortsOwnerToken(container, src, itemId, shortsUrlId, updatedAt) {
    return [
      'shorts_owner',
      String(NAV_ID || 'none'),
      String(state.pageEpoch || 0),
      String(shortsUrlId || 'none'),
      String(getDiagNodeId(container) || 'none'),
      String(itemId || 'none').substring(0, 64),
      String(src || '').substring(0, 128),
      // Keep token stable across repeated first-entry reapply calls for the same
      // active shorts item; timestamp-based churn can invalidate reveal ownership
      // before overlay attach/reposition has a chance to settle.
      'stable',
    ].join('|');
  }

  function setShortsBlurContextEntry(container, context) {
    if (!container || container.nodeType !== 1) return;
    const hadExisting = !!shortsBlurContextByContainer.get(container);
    shortsBlurContextByContainer.set(container, context);
    if (!hadExisting) shortsBlurContextCount += 1;
    if (shortsBlurContextCount > 0) {
      maybeStartShortsHealthHealInterval('context_set');
    }
  }

  function deleteShortsBlurContextEntry(container) {
    if (!container || container.nodeType !== 1) return null;
    const existing = shortsBlurContextByContainer.get(container);
    if (!existing) return null;
    shortsBlurContextByContainer.delete(container);
    if (existing.ownerToken) {
      shortsActiveOwnerTokens.delete(existing.ownerToken);
    }
    shortsHealthStateByContainer.delete(container);
    shortsBlurContextCount = Math.max(0, shortsBlurContextCount - 1);
    if (shortsBlurContextCount <= 0) {
      stopShortsHealthHealInterval('no_contexts');
    }
    return existing;
  }

  function getShortsHealthHealState(container) {
    if (!container || container.nodeType !== 1) return null;
    let healthState = shortsHealthStateByContainer.get(container);
    if (!healthState) {
      healthState = {
        lastAttemptAt: 0,
        windowStartAt: 0,
        attemptsInWindow: 0,
        giveupUntil: 0,
      };
      shortsHealthStateByContainer.set(container, healthState);
    }
    return healthState;
  }

  function logShortsHealthEvent(eventName, details) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    console.log(
      SHORTS_HEALTH_LOG_PREFIX,
      'event=' + (eventName || 'unknown'),
      details || ''
    );
  }

  function setShortsBlurContextForNode(node, src, category, itemId, blurPx, selectorUsed, reason) {
    if (!isShortsModeActive()) return;
    const container = getShortsBlurContextContainerForNode(node);
    if (!container || container.nodeType !== 1) return;
    const existing = shortsBlurContextByContainer.get(container);
    const updatedAt = Date.now();
    const shortsUrlId = getCurrentShortsUrlId();
    const ownerToken = buildShortsOwnerToken(container, src, itemId, shortsUrlId, updatedAt);
    const context = {
      src: src || '',
      category: category || 'flagged',
      itemId: itemId || '',
      blurPx: Number.isFinite(blurPx) ? blurPx : (CONFIG.blurStrength || 30),
      selectorUsed: selectorUsed || '',
      targetNode: node || null,
      targetTagName: String(node && node.tagName ? node.tagName : ''),
      targetNodeId: getDiagNodeId(node),
      updatedAt: updatedAt,
      shortsUrlId: shortsUrlId,
      ownerToken: ownerToken,
      lastReattachAt: (existing && existing.lastReattachAt) || 0,
      lastReattachVideoId: (existing && existing.lastReattachVideoId) || '',
    };
    if (existing && existing.ownerToken && existing.ownerToken !== ownerToken) {
      shortsActiveOwnerTokens.delete(existing.ownerToken);
    }
    shortsActiveOwnerTokens.add(ownerToken);
    setShortsBlurContextEntry(container, context);
    if (node && node.nodeType === 1 && node.dataset) {
      node.dataset.mwShortsOwnerToken = ownerToken;
    }
    if (DIAG_YT_BLUR) {
      diagShortsTimeline(
        'shorts_blur_context_set',
        'reason=' + (reason || 'unknown') +
        ' containerNodeId=' + getDiagNodeId(container) +
        ' containerTagName=' + String(container.tagName || 'unknown') +
        ' containerRect=' + getDiagRect(container) +
        ' src=' + String(src || '').substring(0, 180) +
        ' itemId=' + (itemId || 'none') +
        ' targetNodeId=' + getDiagNodeId(node) +
        ' targetTagName=' + String(node && node.tagName ? node.tagName : 'none') +
        ' ownerToken=' + String(ownerToken).substring(0, 220) +
        ' selectorUsed=' + (selectorUsed || 'none') +
        ' shortsUrlId=' + (context.shortsUrlId || 'none')
      );
    }
  }

  function clearShortsBlurContextForNode(node, reason) {
    if (!isShortsModeActive()) return;
    const container = getShortsBlurContextContainerForNode(node);
    if (!container || container.nodeType !== 1) return;
    const existing = deleteShortsBlurContextEntry(container);
    if (!existing) return;
    if (DIAG_YT_BLUR) {
      diagShortsTimeline(
        'shorts_blur_context_cleared',
        'reason=' + (reason || 'unknown') +
        ' containerNodeId=' + getDiagNodeId(container) +
        ' containerTagName=' + String(container.tagName || 'unknown') +
        ' previousSrc=' + String(existing.src || '').substring(0, 180) +
        ' previousTargetNodeId=' + (existing.targetNodeId || 'none')
      );
    }
  }

  function resetShortsBlurContext(reason) {
    const normalizedReason = String(reason || 'unknown');
    const shouldPurgeOwnerTokens = !normalizedReason.startsWith('reentry:');
    if (shouldPurgeOwnerTokens) {
      const ownerTokens = Array.from(shortsActiveOwnerTokens);
      for (let i = 0; i < ownerTokens.length; i += 1) {
        clearShortsOwnedBlurAndOverlayByOwnerToken(ownerTokens[i], 'shorts_context_reset:' + normalizedReason);
      }
    }
    shortsBlurContextByContainer = new WeakMap();
    shortsBlurContextCount = 0;
    shortsHealthStateByContainer = new WeakMap();
    if (shouldPurgeOwnerTokens) {
      shortsActiveOwnerTokens.clear();
    }
    stopShortsHealthHealInterval('context_reset');
    if (DIAG_YT_BLUR) {
      diagShortsTimeline(
        'shorts_blur_context_reset',
        'reason=' + normalizedReason +
        ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
      );
    }
  }

  function clearShortsOwnedBlurAndOverlayByOwnerToken(ownerToken, reason) {
    const token = String(ownerToken || '');
    if (!token) return;
    const ownedNodes = document.querySelectorAll('[data-mw-shorts-owner-token]');
    for (let i = 0; i < ownedNodes.length; i += 1) {
      const node = ownedNodes[i];
      if (!node || node.nodeType !== 1 || !node.dataset) continue;
      if (String(node.dataset.mwShortsOwnerToken || '') !== token) continue;
      const srcForClear = String(node.dataset.mwSrc || '');
      clearAllBlurAndOverlay(node, srcForClear, reason || 'shorts_owner_clear', 'safe');
      node.dataset.mwOverlayOwnerToken = '';
      node.dataset.mwShortsOwnerToken = '';
    }
    const portal = document.getElementById(REVEAL_PORTAL_ID);
    if (portal && typeof portal.querySelectorAll === 'function') {
      const overlays = portal.querySelectorAll('.mw-reveal-overlay');
      for (let i = 0; i < overlays.length; i += 1) {
        const overlay = overlays[i];
        if (!overlay || overlay.nodeType !== 1 || !overlay.dataset) continue;
        if (String(overlay.dataset.mwShortsOwnerToken || '') !== token) continue;
        if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
      }
    }
  }

  function clearShortsOwnedBlurAndOverlayByContext(context, reason) {
    if (!context) return;
    const targetNode = context.targetNode && context.targetNode.nodeType === 1 ? context.targetNode : null;
    if (targetNode && targetNode.isConnected) {
      const srcForClear = String(context.src || targetNode.dataset.mwSrc || '');
      clearAllBlurAndOverlay(targetNode, srcForClear, reason || 'shorts_context_drop', 'safe');
    }
    if (context.ownerToken) {
      clearShortsOwnedBlurAndOverlayByOwnerToken(context.ownerToken, reason || 'shorts_context_drop');
      shortsActiveOwnerTokens.delete(context.ownerToken);
    }
  }

  function diagShortsSwapMarker(videoNode, reason, immediateAttempted, immediateApplied, deferredReason) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    if (!videoNode || videoNode.nodeType !== 1) return;
    if (String(videoNode.tagName || '').toUpperCase() !== 'VIDEO') return;
    const container = getShortsBlurContextContainerForNode(videoNode);
    const context = container ? shortsBlurContextByContainer.get(container) : null;
    const blurredNode = context && context.targetNode && context.targetNode.nodeType === 1 ? context.targetNode : null;
    const computed = getDiagComputedBlurState(videoNode);
    const source = getDiagSourceFields(videoNode);
    const visible = (
      computed.display !== 'none' &&
      computed.visibility !== 'hidden' &&
      computed.opacity !== '0'
    );
    console.log(
      '[DIAG][SHORTS_SWAP]',
      'reason=' + (reason || 'unknown'),
      'videoNodeId=' + getDiagNodeId(videoNode),
      'videoTag=' + String(videoNode.tagName || 'unknown'),
      'videoVisible=' + visible,
      'videoConnected=' + (!!videoNode.isConnected),
      'videoClass=' + String(getDiagClassList(videoNode) || '').substring(0, 140),
      'videoCurrentSrc=' + String(source.currentSrc || '').substring(0, 180),
      'videoPoster=' + String(source.poster || '').substring(0, 180),
      'containerNodeId=' + getDiagNodeId(container),
      'containerTag=' + String(container && container.tagName ? container.tagName : 'none'),
      'blurredNodeId=' + getDiagNodeId(blurredNode),
      'blurredTag=' + String(blurredNode && blurredNode.tagName ? blurredNode.tagName : 'none'),
      'blurredConnected=' + (!!(blurredNode && blurredNode.isConnected)),
      'trackedSrc=' + String(context && context.src ? context.src : '').substring(0, 180),
      'immediateAttempted=' + (!!immediateAttempted),
      'immediateApplied=' + (!!immediateApplied),
      'deferredReason=' + (deferredReason || 'none')
    );
  }

  function maybeReattachShortsBlurForVideoNode(videoNode, reason, relatedBlurNodeId) {
    if (!isShortsModeActive()) return false;
    if (!videoNode || videoNode.nodeType !== 1) return false;
    if (String(videoNode.tagName || '').toUpperCase() !== 'VIDEO') return false;
    const container = getShortsBlurContextContainerForNode(videoNode);
    if (!container || container.nodeType !== 1 || !container.isConnected) return false;
    const context = shortsBlurContextByContainer.get(container);
    if (!context || !context.src) return false;
    if (isRevealedForSource(context.src, videoNode)) {
      diagShortsSwapMarker(videoNode, reason || 'unknown', true, false, 'revealed');
      return false;
    }
    const now = Date.now();
    if (context.updatedAt && (now - context.updatedAt) > SHORTS_SWAP_REATTACH_WINDOW_MS) {
      clearShortsOwnedBlurAndOverlayByContext(context, 'shorts_swap_stale_context');
      deleteShortsBlurContextEntry(container);
      diagShortsSwapMarker(videoNode, reason || 'unknown', true, false, 'stale_context');
      if (DIAG_YT_BLUR) {
        diagShortsTimeline(
          'shorts_swap_reattach_skip',
          'reason=stale_context' +
          ' ageMs=' + (now - context.updatedAt) +
          ' containerNodeId=' + getDiagNodeId(container) +
          ' src=' + String(context.src || '').substring(0, 180)
        );
      }
      return false;
    }
    const currentShortsUrlId = getCurrentShortsUrlId();
    if (context.shortsUrlId && currentShortsUrlId && context.shortsUrlId !== currentShortsUrlId) {
      clearShortsOwnedBlurAndOverlayByContext(context, 'shorts_swap_url_changed');
      deleteShortsBlurContextEntry(container);
      diagShortsSwapMarker(videoNode, reason || 'unknown', true, false, 'shorts_url_changed');
      if (DIAG_YT_BLUR) {
        diagShortsTimeline(
          'shorts_swap_reattach_skip',
          'reason=shorts_url_changed' +
          ' contextShortsUrlId=' + context.shortsUrlId +
          ' currentShortsUrlId=' + currentShortsUrlId +
          ' containerNodeId=' + getDiagNodeId(container)
        );
      }
      return false;
    }
    const targetWasPosterImg = String(context.targetTagName || '').toUpperCase() === 'IMG';
    if (!targetWasPosterImg) {
      diagShortsSwapMarker(videoNode, reason || 'unknown', true, false, 'target_not_img');
      if (DIAG_YT_BLUR) {
        diagShortsTimeline(
          'shorts_swap_reattach_skip',
          'reason=target_not_img' +
          ' containerNodeId=' + getDiagNodeId(container) +
          ' targetTagName=' + (context.targetTagName || 'none') +
          ' targetNodeId=' + (context.targetNodeId || 'none')
        );
      }
      return false;
    }
    const videoNodeId = getDiagNodeId(videoNode);
    if (context.lastReattachVideoId === videoNodeId && (now - (context.lastReattachAt || 0)) < 400) {
      diagShortsSwapMarker(videoNode, reason || 'unknown', true, false, 'duplicate_video_window');
      return false;
    }
    const inlineFilter = String(videoNode.style.getPropertyValue('filter') || videoNode.style.filter || '').toLowerCase();
    const inlineBackdrop = String(videoNode.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
    if (
      videoNode.dataset.mwModerated === 'blurred' &&
      (inlineFilter.includes('blur(') || inlineBackdrop.includes('blur('))
    ) {
      diagShortsSwapMarker(videoNode, reason || 'unknown', true, false, 'video_already_blurred');
      return false;
    }
    diagShortsSwapMarker(videoNode, reason || 'unknown', true, true, '');
    if (DIAG_YT_BLUR) {
      const source = getDiagSourceFields(videoNode);
      diagShortsTimeline(
        'shorts_swap_reattach_attempt',
        'reason=' + (reason || 'unknown') +
        ' relatedBlurNodeId=' + (relatedBlurNodeId || 'none') +
        ' containerNodeId=' + getDiagNodeId(container) +
        ' contextSrc=' + String(context.src || '').substring(0, 180) +
        ' contextItemId=' + (context.itemId || 'none') +
        ' previousTargetNodeId=' + (context.targetNodeId || 'none') +
        ' videoNodeId=' + videoNodeId +
        ' videoCurrentSrc=' + String(source.currentSrc || '').substring(0, 180) +
        ' videoPoster=' + String(source.poster || '').substring(0, 180)
      );
    }
    context.lastReattachAt = now;
    context.lastReattachVideoId = videoNodeId;
    applyBlur(videoNode, context.src, context.category || 'flagged', context.blurPx || CONFIG.blurStrength, context.itemId || '');
    const refreshed = shortsBlurContextByContainer.get(container);
    if (refreshed) {
      refreshed.lastReattachAt = now;
      refreshed.lastReattachVideoId = videoNodeId;
    }
    if (DIAG_YT_BLUR) {
      diagShortsTimeline(
        'shorts_swap_reattach_done',
        'reason=' + (reason || 'unknown') +
        ' videoNodeId=' + videoNodeId +
        ' containerNodeId=' + getDiagNodeId(container) +
        ' videoConnected=' + (!!videoNode.isConnected)
      );
    }
    return true;
  }

  function reattachShortsBlurForInsertedNode(node, reason, relatedBlurNodeId) {
    if (!isShortsModeActive()) return false;
    const videos = diagCollectDescendantTagNodes(node, 'video');
    let reattached = false;
    for (let i = 0; i < videos.length; i += 1) {
      const video = videos[i];
      if (!video || video.nodeType !== 1) continue;
      const didReattach = maybeReattachShortsBlurForVideoNode(video, reason, relatedBlurNodeId);
      if (didReattach) {
        reattached = true;
      }
    }
    return reattached;
  }

  const NON_SHORTS_REATTACH_CARD_SELECTOR = [
    'ytm-rich-item-renderer',
    'ytm-video-with-context-renderer',
    'ytm-compact-video-renderer',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'yt-lockup-view-model',
    'yt-lockup-view-model-wiz',
    'ytd-movie-renderer',
  ].join(',');
  const NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR = [
    'ytm-rich-item-renderer',
    'ytm-video-with-context-renderer',
    'ytm-compact-video-renderer',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'yt-lockup-view-model',
    'yt-lockup-view-model-wiz',
    'ytd-movie-renderer',
  ].join(',');
  const NON_SHORTS_REATTACH_CONTEXT_TTL_MS = 45000;
  const NON_SHORTS_REATTACH_CONTEXT_MAX = 400;
  const NON_SHORTS_REATTACH_COOLDOWN_MS = 80;
  const NON_SHORTS_REVEAL_INTENT_TTL_MS = 1600;
  const NON_SHORTS_REATTACH_CARD_FALLBACK_ITEM_KEY = '__card_latest__';
  const NON_SHORTS_REATTACH_MIN_OVERLAY_INTERSECTION_RATIO = 0.35;
  const NON_SHORTS_REATTACH_MAX_CENTER_OFFSET_RATIO = 0.7;
  const REGULAR_MAIN_CARD_BLUR_LATCH_TTL_MS = 2200;
  const REGULAR_MAIN_CARD_BLUR_LATCH_MAX = 160;

  function isNonShortsYouTubeReattachContext() {
    return isYouTube() && !isShortsModeActive();
  }

  function postNonShortsTransitionDiag(stage, details) {
    try {
      postToHost({
        type: 'MW_DIAG_TRANSITION',
        stage: String(stage || 'unknown'),
        url: window.location.href,
        navId: NAV_ID,
        pageEpoch: state.pageEpoch,
        timestamp: Date.now(),
        details: details && typeof details === 'object' ? details : {},
      });
    } catch (e) {}
  }

  function buildNonShortsReattachContextKey(cardKey, itemKey) {
    return String(cardKey || 'none') + '|' + String(itemKey || 'unknown');
  }

  function pruneNonShortsReattachContext(now) {
    const contextMap = state.nonShortsReattachContext;
    if (!contextMap || typeof contextMap.forEach !== 'function') return;
    const cutoff = now - NON_SHORTS_REATTACH_CONTEXT_TTL_MS;
    contextMap.forEach(function(entry, key) {
      const updatedAt = Number(entry && entry.updatedAt ? entry.updatedAt : 0);
      if (!Number.isFinite(updatedAt) || updatedAt < cutoff) {
        contextMap.delete(key);
      }
    });
    if (contextMap.size <= NON_SHORTS_REATTACH_CONTEXT_MAX) return;
    const entries = Array.from(contextMap.entries());
    entries.sort(function(a, b) {
      const aAt = Number(a && a[1] && a[1].updatedAt ? a[1].updatedAt : 0);
      const bAt = Number(b && b[1] && b[1].updatedAt ? b[1].updatedAt : 0);
      return aAt - bAt;
    });
    const removeCount = Math.max(0, entries.length - NON_SHORTS_REATTACH_CONTEXT_MAX);
    for (let i = 0; i < removeCount; i += 1) {
      contextMap.delete(entries[i][0]);
    }
  }

  function findNonShortsReattachCardNode(node) {
    if (!node || node.nodeType !== 1 || typeof node.closest !== 'function') return null;
    return node.closest(NON_SHORTS_REATTACH_CARD_SELECTOR);
  }

  function isNonShortsStrongCardNode(node) {
    if (!node || node.nodeType !== 1 || typeof node.matches !== 'function') return false;
    try {
      return !!node.matches(NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR);
    } catch (e) {
      return false;
    }
  }

  function findNonShortsStrongCardNode(node) {
    if (!node || node.nodeType !== 1 || typeof node.closest !== 'function') return null;
    return node.closest(NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR);
  }

  function findRegularMainCardFallbackNode(node) {
    if (!node || node.nodeType !== 1) return null;
    let cursor = node.parentElement || null;
    for (let depth = 0; depth < 10 && cursor; depth += 1) {
      if (isNonShortsStrongCardNode(cursor)) return cursor;
      const nodeId = String(cursor.id || '').toLowerCase();
      if (nodeId === 'content') {
        cursor = cursor.parentElement || null;
        continue;
      }
      if (typeof cursor.querySelectorAll === 'function') {
        const shortsLockups = cursor.querySelectorAll('ytm-shorts-lockup-view-model');
        const shortsAnchors = cursor.querySelectorAll('a[href*="/shorts/"]');
        if (shortsLockups.length < 1 && shortsAnchors.length < 1) {
          const watchAnchors = cursor.querySelectorAll('a[href*="/watch"]');
          if (watchAnchors.length === 1) return cursor;
        }
      }
      cursor = cursor.parentElement || null;
    }
    return null;
  }

  function getOwnedCardContainerFromNode(node) {
    if (!node || node.nodeType !== 1 || typeof node.closest !== 'function') return null;
    // Prefer per-item card owners first to avoid broad section ownership blur.
    const strictOwner = (
      node.closest('ytm-shorts-lockup-view-model') ||
      node.closest('ytd-reel-item-renderer') ||
      node.closest('ytm-shorts-shelf-renderer') ||
      node.closest('ytd-shorts-shelf-renderer') ||
      node.closest('ytd-reel-shelf-renderer') ||
      node.closest('ytm-rich-shelf-renderer') ||
      node.closest('ytd-rich-shelf-renderer') ||
      node.closest('ytd-rich-grid-media') ||
      node.closest('ytd-rich-item-renderer') ||
      node.closest('ytd-video-renderer') ||
      node.closest('ytm-rich-item-renderer') ||
      node.closest('ytm-video-with-context-renderer') ||
      node.closest('ytm-compact-video-renderer') ||
      node.closest('yt-lockup-view-model') ||
      node.closest('yt-lockup-view-model-wiz') ||
      node.closest('ytd-movie-renderer') ||
      node.closest(NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR) ||
      node.closest(NON_SHORTS_REATTACH_CARD_SELECTOR)
    );
    if (strictOwner) return strictOwner;
    const fallbackOwner =
      node.closest('ytm-item-section-renderer') ||
      node.closest('ytd-item-section-renderer') ||
      node.closest('ytd-thumbnail') ||
      findRegularMainCardFallbackNode(node);
    return fallbackOwner || null;
  }

  function isShortsShelfOwnedCard(card) {
    if (!card || card.nodeType !== 1 || typeof card.matches !== 'function') return false;
    try {
      return !!card.matches(
        'ytm-shorts-lockup-view-model,' +
        'ytd-reel-item-renderer,' +
        'ytm-shorts-shelf-renderer,' +
        'ytd-shorts-shelf-renderer,' +
        'ytd-reel-shelf-renderer,' +
        'ytm-rich-shelf-renderer,' +
        'ytd-rich-shelf-renderer'
      );
    } catch (e) {
      return false;
    }
  }

  // Broad shelf *containers* must never own positive blur for every child thumbnail.
  // Item-level lockups (ytm-shorts-lockup-view-model / ytd-reel-item-renderer) remain eligible.
  function isBroadShortsShelfContainerCard(card) {
    if (!card || card.nodeType !== 1 || typeof card.matches !== 'function') return false;
    try {
      return !!card.matches(
        'ytm-shorts-shelf-renderer,' +
        'ytd-shorts-shelf-renderer,' +
        'ytd-reel-shelf-renderer,' +
        'ytm-rich-shelf-renderer,' +
        'ytd-rich-shelf-renderer'
      );
    } catch (e) {
      return false;
    }
  }

  function applyOwnedPositiveCardClass(card, itemKey, reason) {
    if (!card || card.nodeType !== 1) return;
    if (isShortsModeActive()) return;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return;
    if (isBroadShortsShelfContainerCard(card)) {
      applyOwnedSafeCardClass(card, reason || 'broad_shorts_shelf_positive_denied');
      console.log(
        '[MW-SHORTS-SHELF] broad_positive_owner_denied',
        'cardNodeId=' + getDiagNodeId(card),
        'itemKey=' + String(itemKey || 'unknown'),
        'reason=' + String(reason || 'unknown')
      );
      return;
    }
    ensureOwnedCardStyle();
    card.classList.add(OWNED_POSITIVE_CARD_CLASS);
    card.classList.remove(OWNED_SAFE_CARD_CLASS);
    if (card.dataset) {
      card.dataset.mwOwnedPositive = '1';
      card.dataset.mwOwnedPositiveItemKey = String(itemKey || 'unknown');
      card.dataset.mwOwnedPositiveAt = String(Date.now());
      card.dataset.mwOwnedPositiveReason = String(reason || 'unknown');
    }
    if (isShortsShelfOwnedCard(card)) {
      console.log(
        '[MW-SHORTS-SHELF] owned_positive',
        'cardNodeId=' + getDiagNodeId(card),
        'itemKey=' + String(itemKey || 'unknown'),
        'reason=' + String(reason || 'unknown')
      );
    }
  }

  function applyOwnedSafeCardClass(card, reason) {
    if (!card || card.nodeType !== 1) return;
    if (isShortsModeActive()) return;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return;
    ensureOwnedCardStyle();
    card.classList.remove(OWNED_POSITIVE_CARD_CLASS);
    card.classList.add(OWNED_SAFE_CARD_CLASS);
    if (card.dataset) {
      card.dataset.mwOwnedPositive = '0';
      card.dataset.mwOwnedPositiveItemKey = '';
      card.dataset.mwOwnedPositiveAt = '';
      card.dataset.mwOwnedPositiveReason = String(reason || 'unknown');
    }
    if (isShortsShelfOwnedCard(card)) {
      console.log(
        '[MW-SHORTS-SHELF] owned_safe',
        'cardNodeId=' + getDiagNodeId(card),
        'reason=' + String(reason || 'unknown')
      );
    }
  }

  function reapplyOwnedContainerBlur(card, reason) {
    if (!card || card.nodeType !== 1) return;
    if (isShortsModeActive()) return;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return;
    if (!card.classList || !card.classList.contains(OWNED_POSITIVE_CARD_CLASS)) return;
    if (isBroadShortsShelfContainerCard(card)) {
      applyOwnedSafeCardClass(card, reason || 'broad_shorts_shelf_reapply_denied');
      if (typeof card.querySelectorAll === 'function') {
        const staleOverlays = card.querySelectorAll('.mw-reveal-overlay');
        for (let i = 0; i < staleOverlays.length; i += 1) {
          const overlay = staleOverlays[i];
          if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
        }
      }
      console.log(
        '[MW-SHORTS-SHELF] broad_reapply_denied',
        'cardNodeId=' + getDiagNodeId(card),
        'reason=' + String(reason || 'unknown')
      );
      return;
    }
    // Lifecycle safety: refuse stale ownership and downgrade to safe immediately.
    if (!isShortsShelfOwnedCard(card)) {
      const hrefKey = getMvpCardHrefItemKey(card);
      const storedItemKey = String((card.dataset && card.dataset.mwOwnedPositiveItemKey) || 'unknown');
      const mvpEpoch = String((card.dataset && card.dataset.mwMvpPositiveEpoch) || '');
      const mvpOwned = String((card.dataset && card.dataset.mwMvpPositiveOwned) || '');
      const epochMatches = !mvpEpoch || mvpEpoch === String(state.pageEpoch || 0);
      const itemMatches = !!storedItemKey && storedItemKey !== 'unknown' && hrefKey !== 'unknown' && storedItemKey === hrefKey;
      const hasOwnedSignal = mvpOwned === '1' || String((card.dataset && card.dataset.mwOwnedPositive) || '') === '1';
      if (!hasOwnedSignal || !epochMatches || !itemMatches) {
        applyOwnedSafeCardClass(card, reason || 'reapply_invalidated_to_safe');
        console.log(
          '[MW-OWNED-CARD-REAPPLY-SKIP-STALE]',
          'cardNodeId=' + getDiagNodeId(card),
          'reason=' + String(reason || 'unknown'),
          'hrefKey=' + String(hrefKey || 'unknown'),
          'storedItemKey=' + String(storedItemKey || 'unknown'),
          'mvpOwned=' + mvpOwned,
          'mvpEpoch=' + mvpEpoch,
          'pageEpoch=' + String(state.pageEpoch || 0)
        );
        return;
      }
    }
    const ownedItemKey = String(
      (card.dataset && (
        card.dataset.mwOwnedPositiveItemKey ||
        card.dataset.mwMvpPositiveItemKey ||
        card.dataset.mwMvpPositiveHrefKey
      )) || 'unknown'
    );
    const mediaNodes = card.querySelectorAll('img,video,yt-image img,yt-img-shadow img,.yt-core-image');
    const nodeList = [];
    let skippedSafeCount = 0;
    let skippedUnownedCount = 0;
    let reapplyCount = 0;
    for (let i = 0; i < mediaNodes.length; i += 1) nodeList.push(mediaNodes[i]);
    for (let i = 0; i < nodeList.length; i += 1) {
      const media = nodeList[i];
      try {
        const moderatedState = String((media.dataset && media.dataset.mwModerated) || '').toLowerCase();
        const preblurCleared = !!(media.dataset && media.dataset.mwPreblurClear === 'true');
        const mediaSrc = String(
          (media.currentSrc && String(media.currentSrc)) ||
          (media.src && String(media.src)) ||
          (media.poster && String(media.poster)) ||
          ((media.dataset && (media.dataset.src || media.dataset.mwSrc || media.dataset.mwOrigSrc || media.dataset.mwOrigPoster)) || '')
        );
        // FREEZE-OVERRIDE: never trust moderated=revealed alone on recycled media.
        // Active Shorts reuses the same <video> node; after revealing A, B may still
        // carry mwModerated=revealed until scope-key checks clear it.
        if (moderatedState === 'revealed') {
          if (mediaSrc && isRevealedForSource(mediaSrc, media)) {
            skippedSafeCount += 1;
            continue;
          }
          // Stale reveal marker for a different identity — fall through and reapply.
        } else if (
          preblurCleared ||
          moderatedState === 'safe' ||
          moderatedState === 'timeout-safe'
        ) {
          skippedSafeCount += 1;
          continue;
        }
        // Guard recycled elements: mwModerated may be absent on a new DOM node
        // but the src key is still in state.revealed from the manual reveal tap.
        if (mediaSrc && isRevealedForSource(mediaSrc, media)) {
          skippedSafeCount += 1;
          continue;
        }
        const mediaItemKey = getDiagItemKey(mediaSrc);
        const mediaHardKey = String((media.dataset && media.dataset.mwHardBlurItemKey) || 'unknown');
        const isExistingHardBlur = (
          moderatedState === 'blurred' ||
          String((media.dataset && media.dataset.mwHardBlur) || '0') === '1' ||
          (media.classList && media.classList.contains('mw-blurred'))
        );
        const identityOwned =
          ownedItemKey !== 'unknown' &&
          (
            mediaItemKey === ownedItemKey ||
            mediaHardKey === ownedItemKey
          );
        if (!identityOwned && !isExistingHardBlur) {
          skippedUnownedCount += 1;
          continue;
        }
        media.style.setProperty('filter', 'blur(40px)', 'important');
        media.style.setProperty('-webkit-filter', 'blur(40px)', 'important');
        media.style.setProperty('backdrop-filter', 'blur(40px)', 'important');
        media.style.setProperty('-webkit-backdrop-filter', 'blur(40px)', 'important');
        media.dataset.mwModerated = 'blurred';
        reapplyCount += 1;
        // Guarantee a reveal overlay exists — reapply path skips applyBlur so overlay is never created otherwise
        if (media.isConnected) {
          const reapplySrc = String(
            (media.dataset.mwSrc) ||
            (media.src && String(media.src)) ||
            (media.currentSrc && String(media.currentSrc)) ||
            (media.poster && String(media.poster)) ||
            ''
          );
          if (reapplySrc && !findRevealOverlayForElement(media, reapplySrc)) {
            createRevealOverlay(
              media,
              reapplySrc,
              media.dataset.mwCategory || '',
              media.dataset.mwItemId || '',
              false
            );
          }
        }
      } catch (e) {}
    }
    console.log(
      '[MW-OWNED-CARD-BLUR-REAPPLY]',
      'cardNodeId=' + getDiagNodeId(card),
      'reason=' + String(reason || 'unknown'),
      'mediaCount=' + String(nodeList.length),
      'ownedItemKey=' + String(ownedItemKey || 'unknown'),
      'reapplied=' + String(reapplyCount),
      'skippedSafe=' + String(skippedSafeCount),
      'skippedUnowned=' + String(skippedUnownedCount)
    );
    if (isShortsShelfOwnedCard(card)) {
      console.log(
        '[MW-SHORTS-SHELF] reapply_owned_blur',
        'cardNodeId=' + getDiagNodeId(card),
        'reason=' + String(reason || 'unknown'),
        'mediaCount=' + String(nodeList.length)
      );
    }
  }

  function clearStaleOwnedLifecycleMarkers(reason) {
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return 'SKIP_NON_MAIN_SURFACE';
    const why = String(reason || 'host_lifecycle_boundary');
    let cardCount = 0;
    let shortsLockupCount = 0;
    try {
      const cards = document.querySelectorAll(
        '.' + OWNED_POSITIVE_CARD_CLASS +
        ',.' + OWNED_SAFE_CARD_CLASS +
        ',[data-mw-mvp-positive-owned="1"]' +
        ',[data-mw-owned-positive="1"]'
      );
      for (let i = 0; i < cards.length; i += 1) {
        const card = cards[i];
        if (!card || card.nodeType !== 1) continue;
        cardCount += 1;
        card.classList.remove(OWNED_POSITIVE_CARD_CLASS);
        card.classList.remove(OWNED_SAFE_CARD_CLASS);
        if (!card.dataset) continue;
        card.dataset.mwOwnedPositive = '';
        card.dataset.mwOwnedPositiveItemKey = '';
        card.dataset.mwOwnedPositiveAt = '';
        card.dataset.mwOwnedPositiveReason = why;
        card.dataset.mwMvpPositiveOwned = '';
        card.dataset.mwMvpPositiveItemKey = '';
        card.dataset.mwMvpPositiveHrefKey = '';
        card.dataset.mwMvpPositiveEpoch = '';
        card.dataset.mwMvpPositiveAt = '';
      }
    } catch (e) {}
    try {
      const lockups = document.querySelectorAll(
        'ytm-shorts-lockup-view-model,' +
        'ytd-reel-item-renderer,' +
        'ytm-shorts-shelf-renderer,' +
        'ytd-shorts-shelf-renderer,' +
        'ytd-reel-shelf-renderer'
      );
      for (let i = 0; i < lockups.length; i += 1) {
        const lockup = lockups[i];
        if (!lockup || lockup.nodeType !== 1 || !lockup.dataset) continue;
        if (lockup.dataset.mwShortsShelfOwned === '1') shortsLockupCount += 1;
        lockup.dataset.mwShortsShelfOwned = '';
        lockup.dataset.mwShortsShelfItemKey = '';
        lockup.dataset.mwShortsShelfAt = '';
      }
    } catch (e) {}
    console.log(
      '[MW-LIFECYCLE-OWNERSHIP-CLEAR]',
      'reason=' + why,
      'cards=' + String(cardCount),
      'shortsLockups=' + String(shortsLockupCount),
      'navId=' + String(NAV_ID || 'none'),
      'pageEpoch=' + String(state.pageEpoch || 0),
      'url=' + window.location.href
    );
    return 'OK';
  }

  function reapplyOwnedContainerBlurFromMutationNode(node, reason) {
    if (!node || node.nodeType !== 1) return;
    if (isShortsModeActive()) return;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return;
    const directCard = getOwnedCardContainerFromNode(node);
    if (directCard) {
      reapplyOwnedContainerBlur(directCard, reason + ':closest');
    }
    if (typeof node.querySelectorAll === 'function') {
      const ownedCards = node.querySelectorAll('.' + OWNED_POSITIVE_CARD_CLASS);
      for (let i = 0; i < ownedCards.length; i += 1) {
        reapplyOwnedContainerBlur(ownedCards[i], reason + ':descendant');
      }
    }
  }

  function reapplyOwnedShortsShelfBlurFromLifecycleEvent(node, reason) {
    if (!node || node.nodeType !== 1) return;
    if (isShortsModeActive()) return;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return;
    const ownedCard = getOwnedCardContainerFromNode(node);
    if (!ownedCard || !isShortsShelfOwnedCard(ownedCard)) return;
    if (!ownedCard.classList || !ownedCard.classList.contains(OWNED_POSITIVE_CARD_CLASS)) return;
    reapplyOwnedContainerBlur(ownedCard, reason || 'shorts_shelf_lifecycle_event');
    console.log(
      '[MW-SHORTS-SHELF] lifecycle_reapply',
      'event=' + String(reason || 'unknown'),
      'cardNodeId=' + getDiagNodeId(ownedCard),
      'sourceNodeId=' + getDiagNodeId(node)
    );
  }

  // ==================== MVP POSITIVE CARD OWNERSHIP KERNEL ====================

  function getMvpCardHrefItemKey(card) {
    if (!card || card.nodeType !== 1 || typeof card.querySelector !== 'function') return 'unknown';
    try {
      // Extract video ID from a raw href string, handling both /watch?v= and /shorts/ formats.
      var extractIdFromHref = function(href) {
        if (!href) return '';
        var wm = href.match(/[?&]v=([^&/#]+)/);
        if (wm && wm[1]) return String(wm[1]);
        var sm = href.match(/\\/shorts\\/([^/?#]+)/);
        if (sm && sm[1]) return String(sm[1]);
        return '';
      };
      var getHref = function(a) {
        return String(a.getAttribute ? a.getAttribute('href') : (a.href || ''));
      };

      // 1. Descendant search — works for ytm-compact-video-renderer and most simple cards.
      var inner = card.querySelector('a[href*="/watch"], a[href*="/shorts/"]');
      if (inner) {
        var key = extractIdFromHref(getHref(inner));
        if (key) {
          console.log('[MW-MVP-HREF-KEY-DESCENDANT-HIT]', 'cardNodeId=' + getDiagNodeId(card), 'key=' + key);
          return key;
        }
      }

      // 2. Ancestor search — card is itself inside an <a> (some embed layouts).
      var outer = (typeof card.closest === 'function')
        ? card.closest('a[href*="/watch"], a[href*="/shorts/"]')
        : null;
      if (outer) {
        var key = extractIdFromHref(getHref(outer));
        if (key) {
          console.log('[MW-MVP-HREF-KEY-ANCESTOR-HIT]', 'cardNodeId=' + getDiagNodeId(card), 'key=' + key);
          return key;
        }
      }

      // 3. Home-feed fallback: yt-lockup-view-model may shadow-scope its <a>, so walk up
      // to the outer ytm-rich-item-renderer / ytd-rich-item-renderer and search there.
      // This is a read-only DOM query — no state changes, zero regression risk.
      var richItem = (typeof card.closest === 'function')
        ? (card.closest('ytm-rich-item-renderer') || card.closest('ytd-rich-item-renderer'))
        : null;
      if (richItem && typeof richItem.querySelector === 'function') {
        var richInner = richItem.querySelector('a[href*="/watch"], a[href*="/shorts/"]');
        if (richInner) {
          var key = extractIdFromHref(getHref(richInner));
          if (key) {
            console.log('[DIAG][HOME_FEED_REVEAL] href_key_via_rich_item', 'cardNodeId=' + getDiagNodeId(card), 'richNodeId=' + getDiagNodeId(richItem), 'key=' + key);
            return key;
          }
        }
      }

      // 4. Open Shadow DOM attempt — yt-lockup-view-model components occasionally expose
      // an open shadowRoot. querySelector cannot cross shadow boundaries, but a direct
      // shadowRoot.querySelector can. Closed roots return null here (harmless no-op).
      var shadowHosts = [card];
      if (richItem && richItem !== card) shadowHosts.push(richItem);
      var lockup = (typeof card.closest === 'function') ? card.closest('yt-lockup-view-model') : null;
      if (lockup && shadowHosts.indexOf(lockup) === -1) shadowHosts.push(lockup);
      for (var s = 0; s < shadowHosts.length; s += 1) {
        var host = shadowHosts[s];
        var root = host && host.shadowRoot ? host.shadowRoot : null;
        if (root && typeof root.querySelector === 'function') {
          var shadowInner = root.querySelector('a[href*="/watch"], a[href*="/shorts/"]');
          if (shadowInner) {
            var key = extractIdFromHref(getHref(shadowInner));
            if (key) {
              console.log('[DIAG][HOME_FEED_REVEAL] href_key_via_shadow_root', 'cardNodeId=' + getDiagNodeId(card), 'hostTag=' + String(host.tagName || '').toLowerCase(), 'key=' + key);
              return key;
            }
          }
        }
      }
    } catch (e) {}
    console.log('[MW-MVP-HREF-KEY-UNKNOWN]', 'cardNodeId=' + getDiagNodeId(card));
    return 'unknown';
  }

  function isMvpStreamingUrlSrc(src) {
    if (!src) return false;
    try {
      const parsed = new URL(String(src), window.location.href);
      return String(parsed.hostname || '').toLowerCase().indexOf('googlevideo.com') !== -1;
    } catch (e) { return false; }
  }

  function isMvpPositiveCardOwned(card, hrefKey, itemKey) {
    if (!card || card.nodeType !== 1) return false;
    if (card.dataset.mwMvpPositiveOwned !== '1') return false;
    if (String(card.dataset.mwMvpPositiveEpoch || '0') !== String(state.pageEpoch || 0)) return false;
    if (card.dataset.mwMvpPositiveHrefKey !== hrefKey) return false;
    if (card.dataset.mwMvpPositiveItemKey !== itemKey) return false;
    return true;
  }

  function stampMvpPositiveCardOwnership(card, itemKey, hrefKey, epoch, reason) {
    if (!card || card.nodeType !== 1) return;
    try {
      card.dataset.mwMvpPositiveOwned = '1';
      card.dataset.mwMvpPositiveItemKey = String(itemKey || 'unknown');
      card.dataset.mwMvpPositiveHrefKey = String(hrefKey || 'unknown');
      card.dataset.mwMvpPositiveEpoch = String(epoch || 0);
      card.dataset.mwMvpPositiveAt = String(Date.now());
      applyOwnedPositiveCardClass(card, itemKey, reason || 'stamp_positive');
      console.log(
        '[MW-MVP-POSITIVE-CARD-STAMPED]',
        'cardNodeId=' + getDiagNodeId(card),
        'itemKey=' + String(itemKey || 'unknown'),
        'hrefKey=' + String(hrefKey || 'unknown'),
        'epoch=' + String(epoch || 0),
        'reason=' + String(reason || 'unknown')
      );
    } catch (e) {}
  }

  function clearMvpPositiveCardOwnershipFromCard(card, reason) {
    if (!card || card.nodeType !== 1) return;
    try {
      const cardNodeId = getDiagNodeId(card);
      const storedItemKey = String((card.dataset && card.dataset.mwMvpPositiveItemKey) || 'unknown');
      const storedHrefKey = String((card.dataset && card.dataset.mwMvpPositiveHrefKey) || 'unknown');
      card.dataset.mwMvpPositiveOwned = '';
      card.dataset.mwMvpPositiveItemKey = '';
      card.dataset.mwMvpPositiveHrefKey = '';
      card.dataset.mwMvpPositiveEpoch = '';
      card.dataset.mwMvpPositiveAt = '';
      applyOwnedSafeCardClass(card, reason || 'mvp_ownership_cleared');
      if (typeof card.querySelectorAll === 'function') {
        const blurredChildren = card.querySelectorAll('[data-mw-moderated="blurred"]');
        for (let i = 0; i < blurredChildren.length; i++) {
          const child = blurredChildren[i];
          if (child && child.nodeType === 1) {
            clearAllBlurAndOverlay(child, String((child.dataset && child.dataset.mwSrc) || ''), reason || 'mvp_ownership_cleared', 'safe');
          }
        }
      }
      console.log(
        '[MW-MVP-POSITIVE-CARD-HREF-MISMATCH-CLEAR]',
        'cardNodeId=' + cardNodeId,
        'storedItemKey=' + storedItemKey,
        'storedHrefKey=' + storedHrefKey,
        'reason=' + String(reason || 'unknown')
      );
    } catch (e) {}
  }

  function installMvpCardObserver(card) {
    if (!card || card.nodeType !== 1) return;
    if (state.mvpCardObservers.has(card)) return;
    const cardNodeId = getDiagNodeId(card);
    const obs = new MutationObserver(function() {
      if ((card.dataset && card.dataset.mwMvpPositiveOwned) !== '1') return;
      const currentHrefKey = getMvpCardHrefItemKey(card);
      const storedHrefKey = String((card.dataset && card.dataset.mwMvpPositiveHrefKey) || 'unknown');
      if (currentHrefKey !== storedHrefKey) {
        console.log(
          '[MW-MVP-OBSERVER-HREF-CHANGE]',
          'cardNodeId=' + cardNodeId,
          'stored=' + storedHrefKey,
          'current=' + currentHrefKey
        );
        clearMvpPositiveCardOwnershipFromCard(card, 'observer_href_change');
        obs.disconnect();
        state.mvpCardObservers.delete(card);
        console.log('[MW-MVP-OBSERVER-DISCONNECT]', 'cardNodeId=' + cardNodeId);
      }
    });
    obs.observe(card, { subtree: true, attributes: true, attributeFilter: ['href'] });
    state.mvpCardObservers.set(card, obs);
    console.log(
      '[MW-MVP-OBSERVER-INSTALL]',
      'cardNodeId=' + cardNodeId,
      'hrefKey=' + String((card.dataset && card.dataset.mwMvpPositiveHrefKey) || 'unknown')
    );
  }

  // ==================== SHORTS SHELF LOCKUP OWNERSHIP ====================

  const shortsShelfObservers = new WeakMap();

  function clearShortsShelfLockupOwnership(lockup, reason) {
    if (!lockup || lockup.nodeType !== 1) return;
    try {
      const lockupNodeId = getDiagNodeId(lockup);
      applyOwnedSafeCardClass(lockup, reason || 'shorts_shelf_ownership_cleared');
      lockup.dataset.mwShortsShelfOwned = '';
      lockup.dataset.mwShortsShelfItemKey = '';
      lockup.dataset.mwShortsShelfAt = '';
      if (typeof lockup.querySelectorAll === 'function') {
        const blurredChildren = lockup.querySelectorAll('[data-mw-moderated="blurred"]');
        for (let i = 0; i < blurredChildren.length; i++) {
          const child = blurredChildren[i];
          if (child && child.nodeType === 1) {
            clearAllBlurAndOverlay(
              child,
              String((child.dataset && child.dataset.mwSrc) || ''),
              reason || 'shorts_shelf_ownership_cleared',
              'safe'
            );
          }
        }
        const staleOverlays = lockup.querySelectorAll('.mw-reveal-overlay');
        for (let i = 0; i < staleOverlays.length; i++) {
          const ov = staleOverlays[i];
          if (ov && ov.parentElement) ov.parentElement.removeChild(ov);
        }
      }
      console.log(
        '[MW-MVP-SHORTS-SHELF-HREF-CHANGE-CLEAR]',
        'lockupNodeId=' + lockupNodeId,
        'reason=' + String(reason || 'unknown')
      );
    } catch (e) {}
  }

  function installShortsShelfLockupObserver(lockup) {
    if (!lockup || lockup.nodeType !== 1) return;
    if (shortsShelfObservers.has(lockup)) return;
    const lockupNodeId = getDiagNodeId(lockup);
    const getShelfId = function() {
      const anchor = typeof lockup.querySelector === 'function'
        ? lockup.querySelector('a[href^="/shorts/"]')
        : null;
      const rawHref = String(
        (anchor && anchor.getAttribute && anchor.getAttribute('href')) || ''
      );
      const m = rawHref.match(/\\/shorts\\/([^/?#]+)/);
      return m ? m[1] : 'unknown';
    };
    let lastKnownId = getShelfId();
    const obs = new MutationObserver(function() {
      const storedItemKey = String((lockup.dataset && lockup.dataset.mwShortsShelfItemKey) || 'unknown');
      if (storedItemKey === 'unknown') return;
      const currentId = getShelfId();
      if (currentId !== lastKnownId || (currentId !== 'unknown' && currentId !== storedItemKey)) {
        console.log(
          '[MW-MVP-SHORTS-SHELF-HREF-CHANGE-CLEAR]',
          'lockupNodeId=' + lockupNodeId,
          'storedItemKey=' + storedItemKey,
          'lastKnownId=' + lastKnownId,
          'currentId=' + currentId
        );
        lastKnownId = currentId;
        clearShortsShelfLockupOwnership(lockup, 'observer_href_change');
        obs.disconnect();
        shortsShelfObservers.delete(lockup);
      }
    });
    obs.observe(lockup, { subtree: true, attributes: true, attributeFilter: ['href'] });
    shortsShelfObservers.set(lockup, obs);
  }

  // ==================== END MVP POSITIVE CARD OWNERSHIP KERNEL ====================

  function buildRegularMainCardBlurLatchKey(navId, pageEpoch, cardNodeId) {
    return String(navId || 'none') + '|' + String(pageEpoch || 0) + '|' + String(cardNodeId || 'none');
  }

  function pruneRegularMainCardBlurLatch(now) {
    const latchMap = state.regularMainCardBlurLatch;
    if (!latchMap || typeof latchMap.forEach !== 'function') return;
    latchMap.forEach(function(entry, key) {
      const expiresAt = Number(entry && entry.expiresAt ? entry.expiresAt : 0);
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        latchMap.delete(key);
      }
    });
    if (latchMap.size <= REGULAR_MAIN_CARD_BLUR_LATCH_MAX) return;
    const entries = Array.from(latchMap.entries());
    entries.sort(function(a, b) {
      const aAt = Number(a && a[1] && a[1].lastSeenAt ? a[1].lastSeenAt : 0);
      const bAt = Number(b && b[1] && b[1].lastSeenAt ? b[1].lastSeenAt : 0);
      return aAt - bAt;
    });
    const removeCount = Math.max(0, entries.length - REGULAR_MAIN_CARD_BLUR_LATCH_MAX);
    for (let i = 0; i < removeCount; i += 1) {
      latchMap.delete(entries[i][0]);
    }
  }

  function writeRegularMainCardBlurLatch(cardNodeId, hardBlurItemKey, hardBlurSrc, reason, nodeId) {
    if (!cardNodeId || cardNodeId === 'none') return;
    if (!hardBlurItemKey || hardBlurItemKey === 'unknown') return;
    if (!hardBlurSrc) return;
    const now = Date.now();
    pruneRegularMainCardBlurLatch(now);
    const key = buildRegularMainCardBlurLatchKey(NAV_ID, state.pageEpoch, cardNodeId);
    const entry = {
      cardNodeId: String(cardNodeId || 'none'),
      navId: String(NAV_ID || 'none'),
      pageEpoch: Number(state.pageEpoch || 0),
      hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
      hardBlurSrc: String(hardBlurSrc || ''),
      setAt: now,
      lastSeenAt: now,
      expiresAt: now + REGULAR_MAIN_CARD_BLUR_LATCH_TTL_MS,
    };
    state.regularMainCardBlurLatch.set(key, entry);
    console.log(
      '[MW-MVP-REGULAR-THUMB-LATCH-V1-WRITE] card_scoped_latch_written',
      'reason=' + String(reason || 'unknown'),
      'nodeId=' + String(nodeId || 'none'),
      'cardNodeId=' + String(cardNodeId || 'none'),
      'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
      'hardBlurSrc=' + String(hardBlurSrc || '').substring(0, 180),
      'navId=' + String(NAV_ID || 'none'),
      'pageEpoch=' + String(state.pageEpoch || 0),
      'ttlMs=' + String(REGULAR_MAIN_CARD_BLUR_LATCH_TTL_MS)
    );
  }

  function readRegularMainCardBlurLatch(cardNodeId, hardBlurItemKey, hardBlurSrc) {
    if (!cardNodeId || cardNodeId === 'none') {
      return { entry: null, reason: 'missing_card_identity' };
    }
    if (!hardBlurItemKey || hardBlurItemKey === 'unknown') {
      return { entry: null, reason: 'missing_hard_item_key' };
    }
    if (!hardBlurSrc) {
      return { entry: null, reason: 'missing_hard_src' };
    }
    const now = Date.now();
    pruneRegularMainCardBlurLatch(now);
    const key = buildRegularMainCardBlurLatchKey(NAV_ID, state.pageEpoch, cardNodeId);
    const entry = state.regularMainCardBlurLatch.get(key);
    if (!entry) {
      return { entry: null, reason: 'no_entry_for_scope' };
    }
    const entryExpiresAt = Number(entry.expiresAt || 0);
    if (!Number.isFinite(entryExpiresAt) || entryExpiresAt <= now) {
      state.regularMainCardBlurLatch.delete(key);
      return { entry: null, reason: 'expired' };
    }
    if (String(entry.cardNodeId || 'none') !== String(cardNodeId || 'none')) {
      state.regularMainCardBlurLatch.delete(key);
      return { entry: null, reason: 'card_mismatch' };
    }
    if (String(entry.hardBlurItemKey || 'unknown') !== String(hardBlurItemKey || 'unknown')) {
      return { entry: null, reason: 'item_key_mismatch' };
    }
    if (String(entry.hardBlurSrc || '') !== String(hardBlurSrc || '')) {
      return { entry: null, reason: 'src_mismatch' };
    }
    entry.lastSeenAt = now;
    entry.expiresAt = now + REGULAR_MAIN_CARD_BLUR_LATCH_TTL_MS;
    state.regularMainCardBlurLatch.set(key, entry);
    return { entry: entry, reason: 'match' };
  }

  function extractShortsIdFromHrefValue(rawHref) {
    const href = String(rawHref || '');
    if (!href) return 'unknown';
    const match = href.match(/\\/shorts\\/([^/?#]+)/);
    return match && match[1] ? String(match[1]) : 'unknown';
  }

  function deriveNearbyShortsAnchorId(node) {
    if (!node || node.nodeType !== 1) return 'unknown';
    try {
      if (typeof node.closest === 'function') {
        const directAnchor = node.closest('a[href*="/shorts/"]');
        if (directAnchor) {
          const directHref = String(
            (directAnchor.getAttribute && directAnchor.getAttribute('href')) ||
            directAnchor.href ||
            ''
          );
          const directId = extractShortsIdFromHrefValue(directHref);
          if (directId !== 'unknown') return directId;
        }
      }
    } catch (e) {}
    let cursor = node;
    for (let depth = 0; depth < 6 && cursor; depth += 1) {
      try {
        if (typeof cursor.querySelector === 'function') {
          const nestedAnchor = cursor.querySelector('a[href*="/shorts/"]');
          if (nestedAnchor) {
            const nestedHref = String(
              (nestedAnchor.getAttribute && nestedAnchor.getAttribute('href')) ||
              nestedAnchor.href ||
              ''
            );
            const nestedId = extractShortsIdFromHrefValue(nestedHref);
            if (nestedId !== 'unknown') return nestedId;
          }
        }
      } catch (e) {}
      cursor = cursor.parentElement || null;
    }
    return 'unknown';
  }

  function isYouTubeMainPageShortsShelfVideoNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (String(node.tagName || '').toUpperCase() !== 'VIDEO') return false;
    if (isShortsModeActive()) return false;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return false;
    if (typeof node.closest !== 'function') return false;
    const lockup = node.closest('ytm-shorts-lockup-view-model');
    if (lockup) return true;
    const card = findNonShortsReattachCardNode(node);
    if (!card || typeof card.querySelector !== 'function') return false;
    const shortsLink = card.querySelector('a[href^="/shorts/"]');
    return !!shortsLink;
  }

  function getHomeShortsShelfOverlayContinuity(card, videoNode, expectedItemKey) {
    if (!card || !videoNode) return null;
    if (typeof card.querySelectorAll !== 'function') return null;
    const overlays = card.querySelectorAll('.mw-reveal-overlay[data-mw-for]');
    for (let i = 0; i < overlays.length; i += 1) {
      const overlay = overlays[i];
      if (!overlay || overlay.nodeType !== 1 || !overlay.isConnected) continue;
      if (!isNonShortsOverlayGeometryAnchored(overlay, videoNode)) continue;
      const overlayFor = normalizeUrl(String((overlay.dataset && overlay.dataset.mwFor) || '')) || '';
      if (!overlayFor) continue;
      const overlayItemKey = getDiagItemKey(overlayFor);
      if (!overlayItemKey || overlayItemKey === 'unknown') continue;
      if (expectedItemKey && expectedItemKey !== 'unknown' && overlayItemKey !== expectedItemKey) continue;
      return {
        overlayItemKey: overlayItemKey,
        overlayId: String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
      };
    }
    return null;
  }

  function isNonShortsOverlayGeometryAnchored(overlay, targetNode) {
    if (!overlay || overlay.nodeType !== 1 || !overlay.isConnected) return false;
    if (!targetNode || targetNode.nodeType !== 1 || !targetNode.isConnected) return false;
    if (typeof overlay.getBoundingClientRect !== 'function') return false;
    if (typeof targetNode.getBoundingClientRect !== 'function') return false;
    let overlayRect = null;
    let targetRect = null;
    try {
      overlayRect = overlay.getBoundingClientRect();
      targetRect = targetNode.getBoundingClientRect();
    } catch (e) {
      return false;
    }
    if (!overlayRect || !targetRect) return false;
    const targetWidth = Number(targetRect.width || 0);
    const targetHeight = Number(targetRect.height || 0);
    if (targetWidth < 16 || targetHeight < 16) return false;

    const targetArea = targetWidth * targetHeight;
    const left = Math.max(Number(overlayRect.left || 0), Number(targetRect.left || 0));
    const right = Math.min(Number(overlayRect.right || 0), Number(targetRect.right || 0));
    const top = Math.max(Number(overlayRect.top || 0), Number(targetRect.top || 0));
    const bottom = Math.min(Number(overlayRect.bottom || 0), Number(targetRect.bottom || 0));
    const intersectionWidth = Math.max(0, right - left);
    const intersectionHeight = Math.max(0, bottom - top);
    const intersectionArea = intersectionWidth * intersectionHeight;
    const intersectionRatio = targetArea > 0 ? (intersectionArea / targetArea) : 0;

    const overlayCx = Number(overlayRect.left || 0) + (Number(overlayRect.width || 0) / 2);
    const overlayCy = Number(overlayRect.top || 0) + (Number(overlayRect.height || 0) / 2);
    const targetCx = Number(targetRect.left || 0) + (targetWidth / 2);
    const targetCy = Number(targetRect.top || 0) + (targetHeight / 2);
    const dx = Math.abs(overlayCx - targetCx);
    const dy = Math.abs(overlayCy - targetCy);
    const maxOffset = Math.max(targetWidth, targetHeight) * NON_SHORTS_REATTACH_MAX_CENTER_OFFSET_RATIO;
    const centerCloseEnough = dx <= maxOffset && dy <= maxOffset;

    return intersectionRatio >= NON_SHORTS_REATTACH_MIN_OVERLAY_INTERSECTION_RATIO && centerCloseEnough;
  }

  function findNonShortsReattachContextByItemKey(itemKey, cardKey) {
    const contextMap = state.nonShortsReattachContext;
    const now = Date.now();
    pruneNonShortsReattachContext(now);
    if (!contextMap || !itemKey) return null;
    if (cardKey && cardKey !== 'none') {
      const cardEntry = contextMap.get(buildNonShortsReattachContextKey(cardKey, itemKey));
      if (cardEntry) {
        return { kind: 'itemkey_card', entry: cardEntry };
      }
    }
    let best = null;
    contextMap.forEach(function(entry) {
      if (!entry || entry.itemKey !== itemKey) return;
      if (!best || Number(entry.updatedAt || 0) > Number(best.updatedAt || 0)) {
        best = entry;
      }
    });
    if (!best) return null;
    return { kind: 'itemkey_global', entry: best };
  }

  function rememberNonShortsReattachContext(node, src, category, itemId, blurPx, reason) {
    if (!isNonShortsYouTubeReattachContext()) return;
    if (!node || node.nodeType !== 1) return;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return;
    const normalizedSrc = normalizeUrl(src || '') || '';
    const itemKey = getDiagItemKey(normalizedSrc || String(src || ''));
    if (!itemKey || itemKey === 'unknown') return;
    const cardNode = findNonShortsReattachCardNode(node);
    const cardKey = cardNode ? getDiagNodeId(cardNode) : 'none';
    let homeShortsAnchorId = 'unknown';
    if (cardNode && typeof cardNode.querySelector === 'function') {
      const shortsAnchor = cardNode.querySelector('a[href^="/shorts/"]');
      const anchorHrefRaw = String(
        (shortsAnchor && shortsAnchor.getAttribute && shortsAnchor.getAttribute('href')) ||
        (shortsAnchor && shortsAnchor.href) ||
        ''
      );
      const anchorMatch = anchorHrefRaw.match(/\\/shorts\\/([^/?#]+)/);
      if (anchorMatch && anchorMatch[1]) {
        homeShortsAnchorId = String(anchorMatch[1]);
      }
    }
    const now = Date.now();
    const entry = {
      cardKey: cardKey,
      itemKey: itemKey,
      src: normalizedSrc || String(src || ''),
      category: String(category || 'flagged'),
      itemId: String(itemId || ''),
      blurPx: Number.isFinite(blurPx) ? Number(blurPx) : (IS_YOUTUBE ? 40 : Math.min(CONFIG.blurStrength || 30, 20)),
      nodeId: getDiagNodeId(node),
      cardNodeId: cardNode ? getDiagNodeId(cardNode) : 'none',
      updatedAt: now,
    };
    state.nonShortsReattachContext.set(buildNonShortsReattachContextKey(cardKey, itemKey), entry);
    if (cardKey !== 'none') {
      state.nonShortsReattachContext.set(buildNonShortsReattachContextKey('none', itemKey), entry);
      state.nonShortsReattachContext.set(
        buildNonShortsReattachContextKey(cardKey, NON_SHORTS_REATTACH_CARD_FALLBACK_ITEM_KEY),
        entry
      );
      if (homeShortsAnchorId !== 'unknown') {
        state.nonShortsReattachContext.set(
          buildNonShortsReattachContextKey(cardKey, homeShortsAnchorId),
          entry
        );
        state.nonShortsReattachContext.set(
          buildNonShortsReattachContextKey('none', homeShortsAnchorId),
          entry
        );
        console.log(
          '[DIAG][HOME_SHORTS_KEY_BIND] remembered',
          'shortsId=' + homeShortsAnchorId,
          'itemKey=' + itemKey,
          'cardNodeId=' + cardKey,
          'reason=' + (reason || 'unknown')
        );
      }
    }
    pruneNonShortsReattachContext(now);
    if (DIAG_YT_BLUR) {
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] context_remembered',
        'reason=' + (reason || 'unknown'),
        'itemKey=' + itemKey,
        'itemId=' + String(entry.itemId || 'none'),
        'cardNodeId=' + String(entry.cardNodeId || 'none'),
        'nodeId=' + String(entry.nodeId || 'none')
      );
    }
  }

  function diagNonShortsReattach(videoNode, reason) {
    if (!isNonShortsYouTubeReattachContext()) return;
    if (!videoNode || videoNode.nodeType !== 1) return;
    if (String(videoNode.tagName || '').toUpperCase() !== 'VIDEO') return;
    const currentUrl = window.location.href;
    const isMainSurfaceUrl = isYouTubeMainPageThumbnailSurfaceUrl(currentUrl);
    const reasonText = String(reason || 'unknown');
    const reasonLooksTransition =
      reasonText.indexOf('event:') === 0 ||
      reasonText.indexOf('mutation_added') === 0 ||
      reasonText.indexOf('attr:') === 0;
    if (
      !isMainSurfaceUrl &&
      (
        !reasonLooksTransition ||
        !state.nonShortsReattachContext ||
        state.nonShortsReattachContext.size < 1
      )
    ) {
      return;
    }
    postNonShortsTransitionDiag('hit', {
      reason: String(reason || 'unknown'),
      isMainSurfaceUrl: !!isMainSurfaceUrl,
      contextSize: state.nonShortsReattachContext ? state.nonShortsReattachContext.size : 0,
    });
    const now = Date.now();
    const lastReattachAt = Number((videoNode.dataset && videoNode.dataset.mwNonShortsReattachAt) || '0');
    if (Number.isFinite(lastReattachAt) && (now - lastReattachAt) < NON_SHORTS_REATTACH_COOLDOWN_MS) {
      return;
    }
    if (videoNode.dataset) {
      videoNode.dataset.mwNonShortsReattachAt = String(now);
    }
    const isUserRevealIntentReason = !!(
      reasonText === 'event:play' ||
      reasonText === 'event:playing' ||
      reasonText === 'event:loadeddata'
    );
    const videoLikelyPlaying = !!(
      videoNode &&
      !videoNode.paused &&
      !videoNode.ended &&
      Number(videoNode.readyState || 0) >= 2
    );
    let revealFallbackScopeEligible = false;
    let pendingRevealActive = false;

    const source = getDiagSourceFields(videoNode);
    const normalizedPoster = normalizeUrl(source.poster || '') || '';
    const normalizedCurrent = normalizeUrl(source.currentSrc || '') || '';
    const reattachItemKey = getDiagItemKey(normalizedPoster || normalizedCurrent || '');
    const reattachItemId = String((videoNode.dataset && videoNode.dataset.mwItemId) || 'none');
    const videoNodeId = getDiagNodeId(videoNode);
    let card = (typeof videoNode.closest === 'function')
      ? videoNode.closest(NON_SHORTS_REATTACH_CARD_SELECTOR)
      : null;
    let cardNodeId = card ? getDiagNodeId(card) : 'none';
    const isHomeShortsShelfVideo = isYouTubeMainPageShortsShelfVideoNode(videoNode);
    const isRegularMainSurfaceNonShortsVideo = (function() {
      if (!isMainSurfaceUrl || isHomeShortsShelfVideo) return false;
      try {
        const parsed = new URL(currentUrl, window.location.href);
        return String(parsed.hostname || '').toLowerCase() === 'm.youtube.com';
      } catch (e) {
        return false;
      }
    })();
    const directShortsLockupNode = (
      typeof videoNode.closest === 'function'
        ? videoNode.closest('ytm-shorts-lockup-view-model')
        : null
    );
    const directShortsAnchorNode = (
      typeof videoNode.closest === 'function'
        ? videoNode.closest('a[href*="/shorts/"]')
        : null
    );
    const directShortsAnchorHref = String(
      (directShortsAnchorNode && directShortsAnchorNode.getAttribute && directShortsAnchorNode.getAttribute('href')) ||
      (directShortsAnchorNode && directShortsAnchorNode.href) ||
      ''
    );
    const hasDirectShortsLockupOnNodePath = !!directShortsLockupNode;
    const hasDirectShortsAnchorOnNodePath = (
      !!directShortsAnchorNode &&
      extractShortsIdFromHrefValue(directShortsAnchorHref) !== 'unknown'
    );
    const regularPathQuarantinePassed = !!(
      isRegularMainSurfaceNonShortsVideo &&
      !isHomeShortsShelfVideo &&
      !hasDirectShortsLockupOnNodePath &&
      !hasDirectShortsAnchorOnNodePath
    );
    if (regularPathQuarantinePassed && card && !isNonShortsStrongCardNode(card)) {
      const strongCard = findNonShortsStrongCardNode(videoNode);
      if (strongCard) {
        card = strongCard;
        cardNodeId = getDiagNodeId(strongCard);
        console.log(
          '[MW-MVP-REGULAR-THUMB-CARD-BOUNDARY-V1] upgraded_boundary',
          'reason=' + (reason || 'unknown'),
          'nodeId=' + videoNodeId,
          'cardNodeId=' + cardNodeId
        );
      } else {
        const fallbackCard = findRegularMainCardFallbackNode(videoNode);
        if (fallbackCard) {
          card = fallbackCard;
          cardNodeId = getDiagNodeId(fallbackCard);
          console.log(
            '[MW-MVP-REGULAR-THUMB-CARD-BOUNDARY-V1] fallback_watch_card_boundary',
            'reason=' + (reason || 'unknown'),
            'nodeId=' + videoNodeId,
            'cardNodeId=' + cardNodeId
          );
        } else {
          card = null;
          cardNodeId = 'none';
          console.log(
            '[MW-MVP-REGULAR-THUMB-CARD-BOUNDARY-V1] reject_weak_boundary',
            'reason=' + (reason || 'unknown'),
            'nodeId=' + videoNodeId,
            'cardNodeId=none',
            'weakBoundary=true'
          );
        }
      }
    }
    if (isRegularMainSurfaceNonShortsVideo && !regularPathQuarantinePassed) {
      console.log(
        '[MW-MVP-REGULAR-THUMB-QUARANTINE-V6-DIRECT-PATH] regular_path_special_handling_blocked',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'cardNodeId=' + cardNodeId,
        'isHomeShortsShelfVideo=' + String(!!isHomeShortsShelfVideo),
        'hasDirectShortsLockupOnNodePath=' + String(!!hasDirectShortsLockupOnNodePath),
        'hasDirectShortsAnchorOnNodePath=' + String(!!hasDirectShortsAnchorOnNodePath)
      );
      postNonShortsTransitionDiag('regular_main_quarantine_blocked', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        cardNodeId: cardNodeId,
        marker: 'MW-MVP-REGULAR-THUMB-QUARANTINE-V6-DIRECT-PATH',
        isHomeShortsShelfVideo: !!isHomeShortsShelfVideo,
        hasDirectShortsLockupOnNodePath: !!hasDirectShortsLockupOnNodePath,
        hasDirectShortsAnchorOnNodePath: !!hasDirectShortsAnchorOnNodePath,
      });
    }
    revealFallbackScopeEligible = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo
    );
    if (videoNode.dataset && revealFallbackScopeEligible && isUserRevealIntentReason) {
      videoNode.dataset.mwPendingRevealUntil = String(now + NON_SHORTS_REVEAL_INTENT_TTL_MS);
    }
    const pendingRevealUntil = Number((videoNode.dataset && videoNode.dataset.mwPendingRevealUntil) || '0');
    pendingRevealActive = Number.isFinite(pendingRevealUntil) && pendingRevealUntil > now;
    let strictContinuityItemKey = reattachItemKey;
    let derivedAnchorItemKey = 'unknown';
    const nearbyShortsAnchorId = (function() {
      if (isHomeShortsShelfVideo) return deriveNearbyShortsAnchorId(videoNode);
      if (regularPathQuarantinePassed) {
        if (!card) return 'unknown';
        return deriveNearbyShortsAnchorId(card);
      }
      return deriveNearbyShortsAnchorId(videoNode);
    })();
    if (
      isHomeShortsShelfVideo &&
      card &&
      typeof card.querySelector === 'function'
    ) {
      const shortsAnchor = card.querySelector('a[href^="/shorts/"]');
      const anchorHrefRaw = String(
        (shortsAnchor && shortsAnchor.getAttribute && shortsAnchor.getAttribute('href')) ||
        (shortsAnchor && shortsAnchor.href) ||
        ''
      );
      const anchorMatch = anchorHrefRaw.match(/\\/shorts\\/([^/?#]+)/);
      if (anchorMatch && anchorMatch[1]) {
        derivedAnchorItemKey = String(anchorMatch[1]);
        strictContinuityItemKey = derivedAnchorItemKey;
        console.log(
          '[DIAG][HOME_SHORTS_KEY_DERIVE] derived',
          'nodeId=' + videoNodeId,
          'cardNodeId=' + cardNodeId,
          'derivedKey=' + derivedAnchorItemKey,
          'anchor=' + anchorHrefRaw.substring(0, 180),
          'reason=' + (reason || 'unknown')
        );
      }
    }
    let nearbyShortsGuardSkippedNonShorts = false;
    if (strictContinuityItemKey === 'unknown' && nearbyShortsAnchorId !== 'unknown') {
      if (isHomeShortsShelfVideo) {
        strictContinuityItemKey = nearbyShortsAnchorId;
        derivedAnchorItemKey = nearbyShortsAnchorId;
        console.log(
          '[DIAG][HOME_SHORTS_KEY_DERIVE] nearby_anchor_fallback',
          'nodeId=' + videoNodeId,
          'cardNodeId=' + cardNodeId,
          'derivedKey=' + nearbyShortsAnchorId,
          'reason=' + (reason || 'unknown')
        );
      } else if (regularPathQuarantinePassed) {
        nearbyShortsGuardSkippedNonShorts = true;
        console.log(
          '[MW-MVP-REGULAR-THUMB-REATTACH-GUARD-V2] skip_nearby_shorts_anchor_non_shorts',
          'reason=' + (reason || 'unknown'),
          'nodeId=' + videoNodeId,
          'cardNodeId=' + cardNodeId,
          'nearbyShortsAnchorId=' + nearbyShortsAnchorId
        );
        postNonShortsTransitionDiag('regular_main_skip_nearby_shorts_anchor_non_shorts', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          cardNodeId: cardNodeId,
          marker: 'MW-MVP-REGULAR-THUMB-REATTACH-GUARD-V2',
          nearbyShortsAnchorId: String(nearbyShortsAnchorId || 'unknown'),
        });
      }
    }
    const usingDerivedStrictKey = (
      reattachItemKey === 'unknown' &&
      strictContinuityItemKey !== 'unknown'
    );

    console.log(
      '[DIAG][NON_SHORTS_REATTACH] attempt',
      'reason=' + (reason || 'unknown'),
      'nodeId=' + videoNodeId,
      'cardNodeId=' + cardNodeId,
      'currentSrc=' + String(source.currentSrc || '').substring(0, 180),
      'poster=' + String(source.poster || '').substring(0, 180),
      'url=' + currentUrl,
      'surface=' + (isMainSurfaceUrl ? 'main' : 'transition')
    );
    console.log(
      '[DIAG][MVP_NON_SHORTS] preview_transition_detected',
      'reason=' + (reason || 'unknown'),
      'nodeId=' + videoNodeId,
      'cardNodeId=' + cardNodeId,
      'url=' + window.location.href
    );
    console.log(
      '[DIAG][MVP_NON_SHORTS] reattach_attempt',
      'reason=' + (reason || 'unknown'),
      'nodeId=' + videoNodeId,
      'poster=' + String(source.poster || '').substring(0, 180),
      'currentSrc=' + String(source.currentSrc || '').substring(0, 180)
    );
    console.log(
      '[DIAG][MVP_ITEM_CHAIN] stage=reattach_attempt',
      'itemId=' + reattachItemId,
      'itemKey=' + reattachItemKey,
      'reason=' + (reason || 'unknown'),
      'nodeId=' + videoNodeId
    );

    let contextNode = null;
    let contextData = null;
    let contextKind = 'none';
    if (isMainSurfaceUrl && card && typeof card.querySelector === 'function') {
      contextNode = card.querySelector('[data-mw-moderated="blurred"][data-mw-src]');
      if (contextNode) {
        const contextSrcForCard = String((contextNode.dataset && contextNode.dataset.mwSrc) || '');
        const contextItemKeyForCard = getDiagItemKey(contextSrcForCard);
        const strictCardMatch = (
          strictContinuityItemKey &&
          strictContinuityItemKey !== 'unknown' &&
          contextItemKeyForCard &&
          contextItemKeyForCard !== 'unknown' &&
          strictContinuityItemKey === contextItemKeyForCard
        );
        const cardContextHardItemKey = String((contextNode.dataset && contextNode.dataset.mwHardBlurItemKey) || 'unknown');
        const cardContextHardSrc = normalizeUrl(String((contextNode.dataset && contextNode.dataset.mwHardBlurSrc) || '')) || '';
        const strictUnknownButCardAuthoritative = !!(
          regularPathQuarantinePassed &&
          !isHomeShortsShelfVideo &&
          cardNodeId !== 'none' &&
          (!strictContinuityItemKey || strictContinuityItemKey === 'unknown') &&
          isAuthoritativeHardBlur(contextNode) &&
          cardContextHardItemKey !== 'unknown' &&
          cardContextHardSrc
        );
        if (strictCardMatch || strictUnknownButCardAuthoritative) {
          contextKind = 'card_blurred';
          contextData = {
            src: String((contextNode.dataset && contextNode.dataset.mwSrc) || normalizedPoster || normalizedCurrent || ''),
            category: String((contextNode.dataset && contextNode.dataset.mwCategory) || 'flagged'),
            itemId: String((contextNode.dataset && contextNode.dataset.mwItemId) || reattachItemId || ''),
            blurPx: Number((contextNode.dataset && contextNode.dataset.mwBlurStrength) || '') || (IS_YOUTUBE ? 40 : Math.min(CONFIG.blurStrength || 30, 20)),
          };
          if (strictUnknownButCardAuthoritative) {
            strictContinuityItemKey = String(
              (contextItemKeyForCard && contextItemKeyForCard !== 'unknown')
                ? contextItemKeyForCard
                : cardContextHardItemKey
            );
            console.log(
              '[MW-MVP-REGULAR-THUMB-ADOPT-V1] strict_unknown_card_authoritative_adopt',
              'reason=' + (reason || 'unknown'),
              'nodeId=' + videoNodeId,
              'cardNodeId=' + cardNodeId,
              'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
              'contextItemKey=' + String(contextItemKeyForCard || 'unknown'),
              'contextHardItemKey=' + String(cardContextHardItemKey || 'unknown')
            );
          }
        } else {
          console.log(
            '[DIAG][NON_SHORTS_REATTACH] card_blurred_blocked_non_strict',
            'reason=' + (reason || 'unknown'),
            'nodeId=' + videoNodeId,
            'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
            'contextItemKey=' + String(contextItemKeyForCard || 'unknown')
          );
        }
      }
    }
    if (!contextNode && strictContinuityItemKey && strictContinuityItemKey !== 'unknown') {
      const remembered = findNonShortsReattachContextByItemKey(strictContinuityItemKey, cardNodeId);
      if (usingDerivedStrictKey) {
        console.log(
          remembered && remembered.entry
            ? '[DIAG][HOME_SHORTS_KEY_BIND] lookup_hit'
            : '[DIAG][HOME_SHORTS_KEY_BIND] lookup_miss',
          'shortsId=' + strictContinuityItemKey,
          'cardNodeId=' + cardNodeId,
          'reason=' + (reason || 'unknown')
        );
      }
      if (remembered && remembered.entry) {
        contextKind = remembered.kind;
        contextData = {
          src: String(remembered.entry.src || normalizedPoster || normalizedCurrent || ''),
          category: String(remembered.entry.category || 'flagged'),
          itemId: String(remembered.entry.itemId || reattachItemId || ''),
          blurPx: Number(remembered.entry.blurPx || (IS_YOUTUBE ? 40 : Math.min(CONFIG.blurStrength || 30, 20))),
        };
      }
    }
    if (!contextNode && !contextData && cardNodeId !== 'none' && isHomeShortsShelfVideo) {
      const contextMap = state.nonShortsReattachContext;
      const cardFallbackEntry = contextMap && contextMap.get
        ? contextMap.get(buildNonShortsReattachContextKey(cardNodeId, NON_SHORTS_REATTACH_CARD_FALLBACK_ITEM_KEY))
        : null;
      const fallbackItemKey = cardFallbackEntry ? getDiagItemKey(String(cardFallbackEntry.src || '')) : 'unknown';
      const strictItemKeyMatch = (
        strictContinuityItemKey &&
        strictContinuityItemKey !== 'unknown' &&
        fallbackItemKey &&
        fallbackItemKey !== 'unknown' &&
        strictContinuityItemKey === fallbackItemKey
      );
      const overlayContinuity = card
        ? getHomeShortsShelfOverlayContinuity(card, videoNode, fallbackItemKey)
        : null;
      const allowCardFallback = !!strictItemKeyMatch;
      if (usingDerivedStrictKey && !strictItemKeyMatch) {
        console.log(
          '[DIAG][HOME_SHORTS_KEY_DERIVE] strict_miss_fail_closed',
          'nodeId=' + videoNodeId,
          'cardNodeId=' + cardNodeId,
          'derivedKey=' + strictContinuityItemKey,
          'fallbackItemKey=' + String(fallbackItemKey || 'unknown'),
          'overlayContinuity=' + String(!!overlayContinuity),
          'reason=' + (reason || 'unknown')
        );
      }
      if (cardFallbackEntry && allowCardFallback) {
        contextKind = 'card_latest_home_shorts';
        contextData = {
          src: String(cardFallbackEntry.src || normalizedPoster || normalizedCurrent || ''),
          category: String(cardFallbackEntry.category || 'flagged'),
          itemId: String(cardFallbackEntry.itemId || reattachItemId || ''),
          blurPx: Number(cardFallbackEntry.blurPx || (IS_YOUTUBE ? 40 : Math.min(CONFIG.blurStrength || 30, 20))),
        };
        if (overlayContinuity) {
          contextKind = 'card_latest_home_shorts_overlay_continuity';
        }
      } else if (cardFallbackEntry) {
        console.log(
          '[DIAG][NON_SHORTS_REATTACH] card_fallback_blocked',
          'reason=' + (reason || 'unknown'),
          'nodeId=' + videoNodeId,
          'cardNodeId=' + cardNodeId,
          'reattachItemKey=' + String(reattachItemKey || 'unknown'),
          'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
          'fallbackItemKey=' + String(fallbackItemKey || 'unknown'),
          'strictItemKeyMatch=' + String(!!strictItemKeyMatch),
          'overlayContinuity=' + String(!!overlayContinuity),
          'usingDerivedStrictKey=' + String(!!usingDerivedStrictKey)
        );
      }
    }
    postNonShortsTransitionDiag('match', {
      reason: String(reason || 'unknown'),
      nodeId: videoNodeId,
      cardNodeId: cardNodeId,
      reattachItemKey: String(reattachItemKey || 'unknown'),
      strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
      derivedAnchorItemKey: String(derivedAnchorItemKey || 'unknown'),
      nearbyShortsAnchorId: String(nearbyShortsAnchorId || 'unknown'),
      contextFound: !!contextData,
      contextKind: String(contextKind || 'none'),
      isHomeShortsShelfVideo: !!isHomeShortsShelfVideo,
    });
    if (isMainSurfaceUrl && !contextData && (normalizedPoster || normalizedCurrent)) {
      const blurredCandidates = document.querySelectorAll('[data-mw-moderated="blurred"][data-mw-src]');
      for (let i = 0; i < blurredCandidates.length; i += 1) {
        const candidate = blurredCandidates[i];
        if (!candidate || candidate.nodeType !== 1) continue;
        const candidateSrc = normalizeUrl((candidate.dataset && candidate.dataset.mwSrc) || '') || '';
        if (!candidateSrc) continue;
        if (
          (normalizedPoster && candidateSrc === normalizedPoster) ||
          (normalizedCurrent && candidateSrc === normalizedCurrent)
        ) {
          contextNode = candidate;
          contextKind = 'src_match';
          contextData = {
            src: String((candidate.dataset && candidate.dataset.mwSrc) || normalizedPoster || normalizedCurrent || ''),
            category: String((candidate.dataset && candidate.dataset.mwCategory) || 'flagged'),
            itemId: String((candidate.dataset && candidate.dataset.mwItemId) || reattachItemId || ''),
            blurPx: Number((candidate.dataset && candidate.dataset.mwBlurStrength) || '') || (IS_YOUTUBE ? 40 : Math.min(CONFIG.blurStrength || 30, 20)),
          };
          break;
        }
      }
    }

    if (contextData) {
      const contextItemId = String(contextData.itemId || reattachItemId || 'none');
      const contextItemSrc = String(contextData.src || normalizedPoster || normalizedCurrent || '');
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] context_found',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'contextNodeId=' + (contextNode ? getDiagNodeId(contextNode) : 'none'),
        'contextKind=' + contextKind,
        'contextSrc=' + String(contextItemSrc || '').substring(0, 180)
      );
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] context_resolved_by=' + contextKind,
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'itemKey=' + reattachItemKey
      );
      console.log(
        '[DIAG][MVP_ITEM_CHAIN] stage=reattach_context_found',
        'itemId=' + contextItemId,
        'itemKey=' + getDiagItemKey(contextItemSrc),
        'reason=' + (reason || 'unknown'),
        'contextKind=' + contextKind,
        'nodeId=' + videoNodeId
      );
    } else {
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] no_context',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'poster=' + String(normalizedPoster || '').substring(0, 180),
        'current=' + String(normalizedCurrent || '').substring(0, 180)
      );
      console.log(
        '[DIAG][MVP_NON_SHORTS] reattach_skip_reason=no_context',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'poster=' + String(normalizedPoster || '').substring(0, 180),
        'current=' + String(normalizedCurrent || '').substring(0, 180)
      );
      console.log(
        '[DIAG][MVP_ITEM_CHAIN] stage=reattach_skip',
        'itemId=' + reattachItemId,
        'itemKey=' + reattachItemKey,
        'reason=no_context',
        'nodeId=' + videoNodeId
      );
    }
    const preserveCardBlurContinuityAfterNearbyShortsGuard = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      nearbyShortsGuardSkippedNonShorts &&
      cardNodeId !== 'none' &&
      !!contextData &&
      String(contextKind || 'none') === 'card_blurred'
    );
    if (preserveCardBlurContinuityAfterNearbyShortsGuard) {
      const cardContextItemKey = getDiagItemKey(String((contextData && contextData.src) || ''));
      if (
        (!strictContinuityItemKey || strictContinuityItemKey === 'unknown') &&
        cardContextItemKey &&
        cardContextItemKey !== 'unknown'
      ) {
        strictContinuityItemKey = cardContextItemKey;
      }
      console.log(
        '[MW-MVP-REGULAR-THUMB-CONTINUITY-GUARD-V1] preserve_card_blurred_after_nearby_shorts_guard',
        'reason=' + String(reason || 'unknown'),
        'nodeId=' + String(videoNodeId || 'none'),
        'cardNodeId=' + String(cardNodeId || 'none'),
        'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
        'contextItemKey=' + String(cardContextItemKey || 'unknown')
      );
      postNonShortsTransitionDiag('regular_main_preserve_card_blurred_after_nearby_shorts_guard', {
        reason: String(reason || 'unknown'),
        nodeId: String(videoNodeId || 'none'),
        cardNodeId: String(cardNodeId || 'none'),
        marker: 'MW-MVP-REGULAR-THUMB-CONTINUITY-GUARD-V1',
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        contextItemKey: String(cardContextItemKey || 'unknown'),
      });
    }

    const computed = getDiagComputedBlurState(videoNode);
    const inlineFilter = String(videoNode.style.getPropertyValue('filter') || videoNode.style.filter || '').toLowerCase();
    const inlineBackdrop = String(videoNode.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
    const computedFilter = String(computed.filter || '').toLowerCase();
    const computedBackdrop = String(computed.backdropFilter || '').toLowerCase();
    let hasAuthoritativeBlur = isAuthoritativeHardBlur(videoNode);
    const hasIncidentalBlur = (
      inlineFilter.indexOf('blur(') !== -1 ||
      inlineBackdrop.indexOf('blur(') !== -1 ||
      computedFilter.indexOf('blur(') !== -1 ||
      computedBackdrop.indexOf('blur(') !== -1
    );
    const hardBlurItemKey = String((videoNode.dataset && videoNode.dataset.mwHardBlurItemKey) || 'unknown');
    const hardBlurSrc = normalizeUrl(String((videoNode.dataset && videoNode.dataset.mwHardBlurSrc) || '')) || '';
    if (
      regularPathQuarantinePassed &&
      !contextData &&
      hasAuthoritativeBlur &&
      hardBlurSrc &&
      (
        (normalizedPoster && hardBlurSrc === normalizedPoster) ||
        (normalizedCurrent && hardBlurSrc === normalizedCurrent)
      )
    ) {
      const rescuedBlurStrength = Number((videoNode.dataset && videoNode.dataset.mwBlurStrength) || '') || (IS_YOUTUBE ? 40 : Math.min(CONFIG.blurStrength || 30, 20));
      contextData = {
        src: hardBlurSrc,
        category: String((videoNode.dataset && videoNode.dataset.mwCategory) || 'flagged'),
        itemId: String((videoNode.dataset && videoNode.dataset.mwItemId) || reattachItemId || ''),
        blurPx: rescuedBlurStrength,
      };
      contextKind = 'regular_main_hard_src_continuity';
      if (
        (!strictContinuityItemKey || strictContinuityItemKey === 'unknown') &&
        hardBlurItemKey &&
        hardBlurItemKey !== 'unknown'
      ) {
        strictContinuityItemKey = hardBlurItemKey;
      }
      console.log(
        '[MW-MVP-REGULAR-THUMB-CONTINUITY-V1] continuity_rescue',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
        'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
        'hardBlurSrc=' + String(hardBlurSrc || '').substring(0, 180)
      );
      postNonShortsTransitionDiag('regular_main_continuity_rescue', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-MVP-REGULAR-THUMB-CONTINUITY-V1',
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
      });
    }
    if (
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      !contextData &&
      hardBlurItemKey &&
      hardBlurItemKey !== 'unknown' &&
      cardNodeId !== 'none'
    ) {
      const recovered = findNonShortsReattachContextByItemKey(hardBlurItemKey, cardNodeId);
      const cardScopedRecovery = !!(
        recovered &&
        recovered.entry &&
        recovered.kind === 'itemkey_card' &&
        String((recovered.entry && recovered.entry.cardNodeId) || 'none') === String(cardNodeId || 'none')
      );
      if (cardScopedRecovery) {
        contextKind = 'regular_main_preclear_card_recovery';
        contextData = {
          src: String(recovered.entry.src || normalizedPoster || normalizedCurrent || ''),
          category: String(recovered.entry.category || 'flagged'),
          itemId: String(recovered.entry.itemId || reattachItemId || ''),
          blurPx: Number(recovered.entry.blurPx || (IS_YOUTUBE ? 40 : Math.min(CONFIG.blurStrength || 30, 20))),
        };
        strictContinuityItemKey = hardBlurItemKey;
        console.log(
          '[MW-MVP-REGULAR-THUMB-PRECLEAR-CARD-RECOVERY-V1] recovered',
          'reason=' + (reason || 'unknown'),
          'nodeId=' + videoNodeId,
          'cardNodeId=' + cardNodeId,
          'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
          'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown')
        );
        postNonShortsTransitionDiag('regular_main_preclear_card_recovery', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          cardNodeId: cardNodeId,
          marker: 'MW-MVP-REGULAR-THUMB-PRECLEAR-CARD-RECOVERY-V1',
          hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
          strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        });
      }
    }
    const strictIdentityKnown = strictContinuityItemKey && strictContinuityItemKey !== 'unknown';
    const hardItemKeyKnown = hardBlurItemKey && hardBlurItemKey !== 'unknown';
    const hardSrcMatchesCurrent = !!(
      hardBlurSrc &&
      (
        (normalizedPoster && hardBlurSrc === normalizedPoster) ||
        (normalizedCurrent && hardBlurSrc === normalizedCurrent)
      )
    );
    const hardKeyMatchesStrict = !!(
      strictIdentityKnown &&
      hardItemKeyKnown &&
      strictContinuityItemKey === hardBlurItemKey
    );
    const isTransitionChurnReason = !!(
      reasonText.indexOf('attr:') === 0 ||
      reasonText.indexOf('mutation_added:') === 0 ||
      reasonText === 'event:loadeddata' ||
      reasonText === 'event:playing' ||
      reasonText === 'event:play'
    );
    const hasHardBlurOwnershipMarker = !!(hardItemKeyKnown && hardBlurSrc);
    const latchWriteEligible = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      cardNodeId !== 'none' &&
      hasAuthoritativeBlur &&
      hasHardBlurOwnershipMarker &&
      hardSrcMatchesCurrent
    );
    if (latchWriteEligible) {
      writeRegularMainCardBlurLatch(
        String(cardNodeId || 'none'),
        String(hardBlurItemKey || 'unknown'),
        String(hardBlurSrc || ''),
        String(reason || 'unknown'),
        String(videoNodeId || 'none')
      );
    }
    const latchReuseAttempt = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      cardNodeId !== 'none' &&
      !contextData &&
      !strictIdentityKnown &&
      isTransitionChurnReason &&
      hasHardBlurOwnershipMarker
    );
    let holdBlurDuringUnresolvedTransition = false;
    if (latchReuseAttempt) {
      const latch = readRegularMainCardBlurLatch(
        String(cardNodeId || 'none'),
        String(hardBlurItemKey || 'unknown'),
        String(hardBlurSrc || '')
      );
      if (latch && latch.entry) {
        holdBlurDuringUnresolvedTransition = true;
        hasAuthoritativeBlur = true;
        markAuthoritativeHardBlur(videoNode, String(hardBlurSrc || ''));
        if (videoNode.dataset) {
          videoNode.dataset.mwHardBlurItemKey = String(hardBlurItemKey || 'unknown');
          videoNode.dataset.mwHardBlurSrc = String(hardBlurSrc || '');
        }
        if (!strictIdentityKnown) {
          strictContinuityItemKey = String(hardBlurItemKey || 'unknown');
        }
        console.log(
          '[MW-MVP-REGULAR-THUMB-LATCH-V1-REUSE] card_scoped_latch_reused',
          'reason=' + String(reason || 'unknown'),
          'nodeId=' + String(videoNodeId || 'none'),
          'cardNodeId=' + String(cardNodeId || 'none'),
          'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
          'hardBlurSrc=' + String(hardBlurSrc || '').substring(0, 180),
          'navId=' + String(NAV_ID || 'none'),
          'pageEpoch=' + String(state.pageEpoch || 0)
        );
        postNonShortsTransitionDiag('regular_main_card_latch_reuse', {
          reason: String(reason || 'unknown'),
          nodeId: String(videoNodeId || 'none'),
          marker: 'MW-MVP-REGULAR-THUMB-LATCH-V1-REUSE',
          cardNodeId: String(cardNodeId || 'none'),
          hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
        });
      } else {
        console.log(
          '[MW-MVP-REGULAR-THUMB-LATCH-V1-FAILCLOSED] latch_reuse_blocked',
          'reason=' + String(reason || 'unknown'),
          'failReason=' + String((latch && latch.reason) || 'unknown'),
          'nodeId=' + String(videoNodeId || 'none'),
          'cardNodeId=' + String(cardNodeId || 'none'),
          'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
          'hardBlurSrc=' + String(hardBlurSrc || '').substring(0, 180),
          'navId=' + String(NAV_ID || 'none'),
          'pageEpoch=' + String(state.pageEpoch || 0)
        );
        postNonShortsTransitionDiag('regular_main_card_latch_fail_closed', {
          reason: String(reason || 'unknown'),
          nodeId: String(videoNodeId || 'none'),
          marker: 'MW-MVP-REGULAR-THUMB-LATCH-V1-FAILCLOSED',
          failReason: String((latch && latch.reason) || 'unknown'),
          cardNodeId: String(cardNodeId || 'none'),
        });
      }
    } else if (
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      !contextData &&
      !strictIdentityKnown &&
      isTransitionChurnReason
    ) {
      let failReason = 'latch_not_applicable';
      if (String(cardNodeId || 'none') === 'none') {
        failReason = 'missing_card_identity';
      } else if (!hardItemKeyKnown) {
        failReason = 'missing_hard_item_key';
      } else if (!hardBlurSrc) {
        failReason = 'missing_hard_src';
      }
      console.log(
        '[MW-MVP-REGULAR-THUMB-LATCH-V1-FAILCLOSED] latch_reuse_blocked',
        'reason=' + String(reason || 'unknown'),
        'failReason=' + failReason,
        'nodeId=' + String(videoNodeId || 'none'),
        'cardNodeId=' + String(cardNodeId || 'none'),
        'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
        'hardBlurSrc=' + String(hardBlurSrc || '').substring(0, 180),
        'navId=' + String(NAV_ID || 'none'),
        'pageEpoch=' + String(state.pageEpoch || 0)
      );
    }
    const preserveShortsHardBlurDuringResolvedContinuity = !!(
      isHomeShortsShelfVideo &&
      isTransitionChurnReason &&
      strictIdentityKnown &&
      hardItemKeyKnown &&
      strictContinuityItemKey === hardBlurItemKey
    );
    const ownedCard = getOwnedCardContainerFromNode(videoNode);
    const cardExplicitOwnedPositive = !!(
      ownedCard &&
      ownedCard.classList &&
      ownedCard.classList.contains(OWNED_POSITIVE_CARD_CLASS) &&
      !ownedCard.classList.contains(OWNED_SAFE_CARD_CLASS)
    );
    if (
      hasAuthoritativeBlur &&
      !contextData &&
      !hardKeyMatchesStrict &&
      !hardSrcMatchesCurrent &&
      !holdBlurDuringUnresolvedTransition &&
      !preserveShortsHardBlurDuringResolvedContinuity &&
      !cardExplicitOwnedPositive
    ) {
      videoNode.style.removeProperty('filter');
      videoNode.style.removeProperty('-webkit-filter');
      videoNode.style.removeProperty('backdrop-filter');
      videoNode.style.removeProperty('-webkit-backdrop-filter');
      videoNode.classList.remove('mw-softblur');
      videoNode.classList.remove('mw-blurred');
      videoNode.dataset.mwModerated = 'safe';
      clearAuthoritativeHardBlur(videoNode);
      hasAuthoritativeBlur = false;
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] hard_blur_provenance_mismatch_cleared',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
        'hardBlurItemKey=' + hardBlurItemKey,
        'hardSrcMatchesCurrent=' + String(!!hardSrcMatchesCurrent)
      );
      postNonShortsTransitionDiag('hard_blur_provenance_mismatch_cleared', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        hardBlurItemKey: hardBlurItemKey,
        hardSrcMatchesCurrent: !!hardSrcMatchesCurrent,
      });
    } else if (preserveShortsHardBlurDuringResolvedContinuity && hasAuthoritativeBlur) {
      console.log(
        '[MW-MVP-SHORTS-CONTINUITY-GUARD-V1] preserve_hard_blur_during_churn',
        'reason=' + String(reason || 'unknown'),
        'nodeId=' + String(videoNodeId || 'none'),
        'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
        'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown')
      );
      postNonShortsTransitionDiag('shorts_preserve_hard_blur_during_churn', {
        reason: String(reason || 'unknown'),
        nodeId: String(videoNodeId || 'none'),
        marker: 'MW-MVP-SHORTS-CONTINUITY-GUARD-V1',
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
      });
    }
    let activeVideoBlurred = hasAuthoritativeBlur || hasIncidentalBlur;
    if (cardExplicitOwnedPositive) {
      activeVideoBlurred = true;
      hasAuthoritativeBlur = true;
    }
    if (activeVideoBlurred && !hasAuthoritativeBlur && !contextData) {
      videoNode.style.removeProperty('filter');
      videoNode.style.removeProperty('-webkit-filter');
      videoNode.style.removeProperty('backdrop-filter');
      videoNode.style.removeProperty('-webkit-backdrop-filter');
      videoNode.classList.remove('mw-softblur');
      videoNode.classList.remove('mw-blurred');
      videoNode.dataset.mwModerated = 'safe';
      clearAuthoritativeHardBlur(videoNode);
      activeVideoBlurred = false;
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] incidental_blur_cleared',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'contextFound=false',
        'contextKind=none'
      );
      postNonShortsTransitionDiag('incidental_blur_cleared', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        contextFound: false,
        contextKind: 'none',
      });
    }
    if (activeVideoBlurred) {
      const expectedBlurPx = IS_YOUTUBE ? 40 : Math.min(CONFIG.blurStrength || 30, 20);
      const expectedBlurToken = 'blur(' + expectedBlurPx + 'px)';
      const hasExpectedBlur = (
        inlineFilter.indexOf(expectedBlurToken) !== -1 ||
        inlineBackdrop.indexOf(expectedBlurToken) !== -1 ||
        computedFilter.indexOf(expectedBlurToken) !== -1 ||
        computedBackdrop.indexOf(expectedBlurToken) !== -1
      );
      if (!hasExpectedBlur) {
        videoNode.style.setProperty('filter', expectedBlurToken, 'important');
        videoNode.style.setProperty('-webkit-filter', expectedBlurToken, 'important');
        videoNode.style.setProperty('backdrop-filter', expectedBlurToken, 'important');
        videoNode.style.setProperty('-webkit-backdrop-filter', expectedBlurToken, 'important');
        videoNode.dataset.mwModerated = 'blurred';
        markAuthoritativeHardBlur(videoNode, String((videoNode.dataset && videoNode.dataset.mwSrc) || ''));
        videoNode.classList.add('mw-blurred');
        console.log(
          '[DIAG][NON_SHORTS_REATTACH] blur_strength_normalized',
          'reason=' + (reason || 'unknown'),
          'nodeId=' + videoNodeId,
          'expected=' + expectedBlurToken,
          'computedFilter=' + String(computed.filter || '').substring(0, 120),
          'computedBackdrop=' + String(computed.backdropFilter || '').substring(0, 120)
        );
      }
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] blur_reapplied',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'state=' + String(videoNode.dataset.mwModerated || ''),
        'computedFilter=' + String(computed.filter || '').substring(0, 120),
        'computedBackdrop=' + String(computed.backdropFilter || '').substring(0, 120)
      );
      console.log(
        '[DIAG][MVP_NON_SHORTS] reattach_success',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'mode=already_blurred'
      );
    } else if (contextData) {
      const contextSrc = String(contextData.src || '') || normalizedPoster || normalizedCurrent || '';
      const contextCategory = String(contextData.category || '') || 'flagged';
      const contextItemId = String(contextData.itemId || '');
      const contextBlurStrengthRaw = Number(contextData.blurPx || '');
      const contextBlurStrength = (
        Number.isFinite(contextBlurStrengthRaw) && contextBlurStrengthRaw > 0
          ? contextBlurStrengthRaw
          : (CONFIG.blurStrength || 30)
      );
      applyBlur(videoNode, contextSrc, contextCategory, contextBlurStrength, contextItemId, contextKind === 'card_blurred' ? 'card_blurred' : 'none');
      if (strictContinuityItemKey && strictContinuityItemKey !== 'unknown') {
        videoNode.dataset.mwHardBlurItemKey = strictContinuityItemKey;
      }
      hasAuthoritativeBlur = isAuthoritativeHardBlur(videoNode);
      activeVideoBlurred = hasAuthoritativeBlur || hasIncidentalBlur;
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] heal_apply_blur',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'contextNodeId=' + (contextNode ? getDiagNodeId(contextNode) : 'none'),
        'contextKind=' + contextKind,
        'contextSrc=' + String(contextSrc || '').substring(0, 180),
        'blurStrength=' + contextBlurStrength
      );
      console.log(
        '[DIAG][MVP_NON_SHORTS] reattach_success',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'mode=heal_apply_blur',
        'contextKind=' + contextKind
      );
      if (shouldDisableRevealUiForMvpMainPageSurface()) {
        removeRevealOverlay(videoNode, contextSrc, 'non_shorts_reattach_mvp_suppress');
        console.log(
          '[DIAG][NON_SHORTS_REATTACH] non_shorts_reattach_mvp_suppress',
          'reason=' + (reason || 'unknown'),
          'nodeId=' + videoNodeId,
          'contextSrc=' + String(contextSrc || '').substring(0, 180)
        );
        console.log(
          '[DIAG][MVP_NON_SHORTS] reattach_skip_reason=reveal_ui_suppressed',
          'reason=' + (reason || 'unknown'),
          'nodeId=' + videoNodeId,
          'contextSrc=' + String(contextSrc || '').substring(0, 180)
        );
      }
    } else {
      console.log(
        '[DIAG][MVP_NON_SHORTS] reattach_skip_reason=no_blurred_context',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId
      );
      console.log(
        '[DIAG][MVP_ITEM_CHAIN] stage=reattach_skip',
        'itemId=' + reattachItemId,
        'itemKey=' + reattachItemKey,
        'reason=no_blurred_context',
        'nodeId=' + videoNodeId
      );
    }

    const overlayProbeSrc = (
      String((videoNode.dataset && videoNode.dataset.mwSrc) || '') ||
      normalizedPoster ||
      normalizedCurrent ||
      ''
    );
    const overlayCategory = String(
      (contextData && contextData.category) ||
      (contextNode && contextNode.dataset && contextNode.dataset.mwCategory) ||
      (videoNode.dataset && videoNode.dataset.mwCategory) ||
      'flagged'
    );
    const overlayItemId = String(
      (contextData && contextData.itemId) ||
      (contextNode && contextNode.dataset && contextNode.dataset.mwItemId) ||
      (videoNode.dataset && videoNode.dataset.mwItemId) ||
      reattachItemId ||
      ''
    );
    const contextItemKey = getDiagItemKey(
      String((contextData && contextData.src) || (contextNode && contextNode.dataset && contextNode.dataset.mwSrc) || '')
    );
    let videoOverlay = findRevealOverlayForElement(videoNode, overlayProbeSrc);
    const overlayNodeId = String((videoOverlay && videoOverlay.dataset && videoOverlay.dataset.mwNodeId) || '');
    const overlayForSrc = String((videoOverlay && videoOverlay.dataset && videoOverlay.dataset.mwFor) || '');
    const overlayForItemKey = getDiagItemKey(overlayForSrc);
    const overlayWithinCard = !!(
      card &&
      videoOverlay &&
      typeof card.contains === 'function' &&
      card.contains(videoOverlay)
    );
    const cardOverlayCount = (
      card && typeof card.querySelectorAll === 'function'
        ? card.querySelectorAll('.mw-reveal-overlay').length
        : 0
    );
    const keepOverlayDuringRegularUnresolvedChurn = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      isTransitionChurnReason &&
      !activeVideoBlurred &&
      !contextData &&
      !!videoOverlay &&
      !!videoOverlay.isConnected &&
      !!videoOverlay.parentElement &&
      overlayWithinCard &&
      overlayNodeId === videoNodeId &&
      overlayForItemKey !== 'unknown' &&
      (
        (reattachItemKey !== 'unknown' && overlayForItemKey === reattachItemKey) ||
        (strictContinuityItemKey && strictContinuityItemKey !== 'unknown' && overlayForItemKey === strictContinuityItemKey) ||
        (cardOverlayCount === 1)
      )
    );
    const strictContinuityUnknown = !strictContinuityItemKey || strictContinuityItemKey === 'unknown';
    const nonShortsPendingRevealGuard = !!(
      revealFallbackScopeEligible &&
      !contextData &&
      strictContinuityUnknown &&
      reattachItemKey === 'unknown' &&
      (isUserRevealIntentReason || pendingRevealActive || videoLikelyPlaying)
    );
    const resolvedContextKind = String(contextKind || 'none');
    const nonShortsResolvedContextOverlayHold = !!(
      revealFallbackScopeEligible &&
      !!contextData &&
      (activeVideoBlurred || hasAuthoritativeBlur) &&
      (
        resolvedContextKind === 'card_blurred' ||
        resolvedContextKind === 'itemkey_global'
      ) &&
      (
        isUserRevealIntentReason ||
        reasonText === 'event:loadeddata' ||
        reasonText === 'event:playing' ||
        reasonText.indexOf('attr:style') === 0 ||
        pendingRevealActive ||
        videoLikelyPlaying
      ) &&
      !!videoOverlay &&
      !!videoOverlay.parentElement
    );
    const nonShortsCardBlurredContinuityOverlayHold = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      nearbyShortsGuardSkippedNonShorts &&
      !!contextData &&
      resolvedContextKind === 'card_blurred' &&
      !!videoOverlay &&
      !!videoOverlay.isConnected &&
      !!videoOverlay.parentElement &&
      overlayWithinCard &&
      overlayNodeId === videoNodeId &&
      overlayForItemKey !== 'unknown' &&
      (
        (strictContinuityItemKey && strictContinuityItemKey !== 'unknown' && overlayForItemKey === strictContinuityItemKey) ||
        (contextItemKey && contextItemKey !== 'unknown' && overlayForItemKey === contextItemKey)
      )
    );
    const hasResidualInlineBlur = !!(
      String(videoNode.style.getPropertyValue('filter') || videoNode.style.filter || '').toLowerCase().indexOf('blur(') !== -1 ||
      String(videoNode.style.getPropertyValue('backdrop-filter') || '').toLowerCase().indexOf('blur(') !== -1
    );
    const hasResidualBlurClass = !!(
      videoNode.classList.contains('mw-softblur') ||
      videoNode.classList.contains('mw-blurred') ||
      String(videoNode.dataset.mwModerated || '') === 'softblur' ||
      String(videoNode.dataset.mwModerated || '') === 'blurred'
    );
    const nonShortsBlurInvariantOverlayHold = !!(
      revealFallbackScopeEligible &&
      !!videoOverlay &&
      !!videoOverlay.parentElement &&
      (activeVideoBlurred || hasAuthoritativeBlur || hasResidualInlineBlur || hasResidualBlurClass)
    );
    if (
      !activeVideoBlurred &&
      !keepOverlayDuringRegularUnresolvedChurn &&
      !nonShortsResolvedContextOverlayHold &&
      !nonShortsCardBlurredContinuityOverlayHold &&
      !nonShortsPendingRevealGuard &&
      !nonShortsBlurInvariantOverlayHold &&
      videoOverlay &&
      videoOverlay.parentElement
    ) {
      const orphanOverlayId = String((videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown');
      videoOverlay.parentElement.removeChild(videoOverlay);
      videoOverlay = null;
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] overlay_removed_no_blur',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'overlayId=' + orphanOverlayId
      );
      postNonShortsTransitionDiag('overlay_removed_no_blur', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        overlayId: orphanOverlayId,
      });
    } else if (keepOverlayDuringRegularUnresolvedChurn) {
      console.log(
        '[MW-MVP-REGULAR-THUMB-OVERLAY-HOLD-V1] keep_overlay_unresolved_churn_same_node',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'overlayId=' + String((videoOverlay && videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown'),
        'overlayItemKey=' + String(overlayForItemKey || 'unknown'),
        'cardOverlayCount=' + String(cardOverlayCount || 0)
      );
      postNonShortsTransitionDiag('regular_main_keep_overlay_unresolved_churn_same_node', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-MVP-REGULAR-THUMB-OVERLAY-HOLD-V1',
        overlayItemKey: String(overlayForItemKey || 'unknown'),
        cardOverlayCount: Number(cardOverlayCount || 0),
      });
    } else if (nonShortsResolvedContextOverlayHold) {
      console.log(
        '[MW-MVP-REGULAR-THUMB-REVEAL-FALLBACK-V2] regular_non_shorts_overlay_remove_veto_context_resolved',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'contextKind=' + resolvedContextKind,
        'overlayId=' + String((videoOverlay && videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown')
      );
      postNonShortsTransitionDiag('regular_non_shorts_overlay_remove_veto_context_resolved', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-MVP-REGULAR-THUMB-REVEAL-FALLBACK-V2',
        contextKind: resolvedContextKind,
        overlayId: String((videoOverlay && videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown'),
      });
    } else if (nonShortsCardBlurredContinuityOverlayHold) {
      console.log(
        '[MW-MVP-REGULAR-THUMB-CONTINUITY-GUARD-V2] overlay_remove_veto_card_blurred_nearby_shorts_guard',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'overlayId=' + String((videoOverlay && videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown'),
        'overlayItemKey=' + String(overlayForItemKey || 'unknown'),
        'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
        'contextItemKey=' + String(contextItemKey || 'unknown')
      );
      postNonShortsTransitionDiag('regular_main_overlay_remove_veto_card_blurred_nearby_shorts_guard', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-MVP-REGULAR-THUMB-CONTINUITY-GUARD-V2',
        overlayId: String((videoOverlay && videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown'),
        overlayItemKey: String(overlayForItemKey || 'unknown'),
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        contextItemKey: String(contextItemKey || 'unknown'),
      });
    } else if (nonShortsPendingRevealGuard && videoOverlay && videoOverlay.parentElement) {
      console.log(
        '[MW-MVP-REGULAR-THUMB-REVEAL-FALLBACK-V1] overlay_remove_blocked_pending_reveal',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'overlayId=' + String((videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown')
      );
      postNonShortsTransitionDiag('overlay_remove_blocked_pending_reveal', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-MVP-REGULAR-THUMB-REVEAL-FALLBACK-V1',
        overlayId: String((videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown'),
      });
    } else if (nonShortsBlurInvariantOverlayHold && videoOverlay && videoOverlay.parentElement) {
      console.log(
        '[MW-MVP-REGULAR-THUMB-REVEAL-FALLBACK-V3] overlay_remove_veto_blur_invariant',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'activeVideoBlurred=' + String(!!activeVideoBlurred),
        'authoritativeBlur=' + String(!!hasAuthoritativeBlur),
        'residualInlineBlur=' + String(!!hasResidualInlineBlur),
        'residualBlurClass=' + String(!!hasResidualBlurClass),
        'overlayId=' + String((videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown')
      );
      postNonShortsTransitionDiag('regular_non_shorts_overlay_remove_veto_blur_invariant', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-MVP-REGULAR-THUMB-REVEAL-FALLBACK-V3',
        activeVideoBlurred: !!activeVideoBlurred,
        authoritativeBlur: !!hasAuthoritativeBlur,
        residualInlineBlur: !!hasResidualInlineBlur,
        residualBlurClass: !!hasResidualBlurClass,
        overlayId: String((videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown'),
      });
    }
    const unresolvedOwnershipAtPlayIntent = !!(
      revealFallbackScopeEligible &&
      !contextData &&
      strictContinuityUnknown &&
      (reattachItemKey === 'unknown') &&
      (isUserRevealIntentReason || pendingRevealActive || videoLikelyPlaying)
    );
    const shouldApplyRevealFallback = !!(
      unresolvedOwnershipAtPlayIntent &&
      ((videoOverlay && videoOverlay.isConnected) || hasResidualInlineBlur || hasResidualBlurClass)
    );
    if (shouldApplyRevealFallback) {
      const hadOverlay = !!(videoOverlay && videoOverlay.parentElement);
      const changed = clearAllBlurAndOverlay(
        videoNode,
        overlayProbeSrc || String((videoNode.dataset && videoNode.dataset.mwSrc) || ''),
        'regular_main_reveal_fallback_user_intent',
        'revealed'
      );
      if (videoNode.dataset) {
        videoNode.dataset.mwPendingRevealUntil = '0';
      }
      if (hadOverlay) {
        videoOverlay = null;
      }
      if (changed) {
        console.log(
          '[MW-MVP-REGULAR-THUMB-REVEAL-FALLBACK-V1] reveal_fallback_applied',
          'reason=' + (reason || 'unknown'),
          'nodeId=' + videoNodeId,
          'scope=regular_non_shorts',
          'pendingRevealActive=' + String(!!pendingRevealActive),
          'videoLikelyPlaying=' + String(!!videoLikelyPlaying),
          'overlayPresent=' + String(!!hadOverlay)
        );
        postNonShortsTransitionDiag('reveal_fallback_applied', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-MVP-REGULAR-THUMB-REVEAL-FALLBACK-V1',
          scope: 'regular_non_shorts',
          pendingRevealActive: !!pendingRevealActive,
          videoLikelyPlaying: !!videoLikelyPlaying,
          overlayPresent: !!hadOverlay,
        });
      }
    } else if (!revealFallbackScopeEligible && isUserRevealIntentReason) {
      postNonShortsTransitionDiag('reveal_fallback_skipped_scope', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-MVP-REGULAR-THUMB-REVEAL-FALLBACK-V1',
        scope: 'shorts_or_quarantined',
      });
    }
    const isOverlayNodeIdAnchored = function(overlay) {
      return !!(
        overlay &&
        overlay.isConnected &&
        String((overlay.dataset && overlay.dataset.mwNodeId) || '') === videoNodeId
      );
    };
    const normalizeNonShortsOverlayPresentation = function(overlay) {
      if (!overlay || overlay.nodeType !== 1 || !overlay.isConnected) return;
      overlay.style.position = 'absolute';
      overlay.style.inset = '0';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '9998';
      const button = overlay.querySelector ? overlay.querySelector('.mw-reveal-btn') : null;
      if (button && button.nodeType === 1) {
        button.style.pointerEvents = 'auto';
      }
    };
    const applyRegularNonShortsOverlayNormalization = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo
    );
    const normalizeOverlayAnchor = function(overlay, phase) {
      if (!isOverlayNodeIdAnchored(overlay)) {
        return { overlay: overlay, anchored: false };
      }
      if (isNonShortsOverlayGeometryAnchored(overlay, videoNode)) {
        return { overlay: overlay, anchored: true };
      }
      const overlayId = String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown');
      if (regularPathQuarantinePassed && (activeVideoBlurred || hasAuthoritativeBlur)) {
        const resolvedRegularOwnership = !!(contextData || hasAuthoritativeBlur);
        if (resolvedRegularOwnership) {
          const isFreshOverlayPhase = phase === 'post_create' || phase === 'post_migrate';
          if (isFreshOverlayPhase) {
            console.warn(
              '[MW-MVP-REGULAR-THUMB-OVERLAY-ANCHOR-V2] overlay_geometry_mismatch_defer_remove_fresh_overlay',
              'reason=' + (reason || 'unknown'),
              'phase=' + String(phase || 'unknown'),
              'nodeId=' + videoNodeId,
              'overlayId=' + overlayId
            );
            return { overlay: overlay, anchored: false };
          }
          console.warn(
            '[MW-MVP-REGULAR-THUMB-OVERLAY-ANCHOR-V1] overlay_geometry_mismatch_force_recreate',
            'reason=' + (reason || 'unknown'),
            'phase=' + String(phase || 'unknown'),
            'nodeId=' + videoNodeId,
            'overlayId=' + overlayId
          );
          if (overlay.parentElement) {
            overlay.parentElement.removeChild(overlay);
            console.log(
              '[DIAG][NON_SHORTS_REATTACH] overlay_removed_geometry_mismatch_force_recreate',
              'reason=' + (reason || 'unknown'),
              'phase=' + String(phase || 'unknown'),
              'nodeId=' + videoNodeId,
              'overlayId=' + overlayId
            );
          }
          return { overlay: null, anchored: false };
        }
        console.warn(
          '[MW-MVP-REGULAR-THUMB-CONTINUITY-V1] overlay_geometry_mismatch_keep',
          'reason=' + (reason || 'unknown'),
          'phase=' + String(phase || 'unknown'),
          'nodeId=' + videoNodeId,
          'overlayId=' + overlayId
        );
        return { overlay: overlay, anchored: false };
      }
      console.warn(
        '[DIAG][NON_SHORTS_REATTACH] overlay_geometry_mismatch',
        'reason=' + (reason || 'unknown'),
        'phase=' + String(phase || 'unknown'),
        'nodeId=' + videoNodeId,
        'overlayId=' + overlayId
      );
      if (overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
        console.log(
          '[DIAG][NON_SHORTS_REATTACH] overlay_removed_geometry_mismatch',
          'reason=' + (reason || 'unknown'),
          'phase=' + String(phase || 'unknown'),
          'nodeId=' + videoNodeId,
          'overlayId=' + overlayId
        );
      }
      return { overlay: null, anchored: false };
    };
    let normalizedOverlay = normalizeOverlayAnchor(videoOverlay, 'initial_probe');
    videoOverlay = normalizedOverlay.overlay;
    let overlayAnchored = normalizedOverlay.anchored;
    if (
      (activeVideoBlurred || hasAuthoritativeBlur) &&
      !overlayAnchored &&
      !shouldDisableRevealUiForMvpMainPageSurface()
    ) {
      let migratedOverlay = null;
      if (card && typeof card.querySelectorAll === 'function') {
        const overlaysInCard = card.querySelectorAll('.mw-reveal-overlay');
        for (let i = 0; i < overlaysInCard.length; i += 1) {
          const candidateOverlay = overlaysInCard[i];
          if (!candidateOverlay || candidateOverlay.nodeType !== 1 || !candidateOverlay.isConnected) continue;
          const overlayFor = String((candidateOverlay.dataset && candidateOverlay.dataset.mwFor) || '');
          const overlayItemKey = getDiagItemKey(overlayFor);
          const matchesReattachKey = reattachItemKey !== 'unknown' && overlayItemKey === reattachItemKey;
          const matchesContextKey = contextItemKey !== 'unknown' && overlayItemKey === contextItemKey;
          const allowSingleOverlayCardFallback = overlaysInCard.length === 1 && contextKind !== 'none';
          if (!matchesReattachKey && !matchesContextKey && !allowSingleOverlayCardFallback) continue;
          const anchorNodeId = String((candidateOverlay.dataset && candidateOverlay.dataset.mwNodeId) || '');
          if (anchorNodeId === videoNodeId) {
            if (applyRegularNonShortsOverlayNormalization && videoNode.parentElement) {
              if (candidateOverlay.parentElement !== videoNode.parentElement) {
                videoNode.parentElement.appendChild(candidateOverlay);
                console.log(
                  '[DIAG][NON_SHORTS_REATTACH] overlay_reparent_same_nodeid',
                  'reason=' + (reason || 'unknown'),
                  'nodeId=' + videoNodeId,
                  'overlayId=' + String((candidateOverlay.dataset && candidateOverlay.dataset.mwOverlayId) || 'unknown')
                );
              }
              const parentPos = window.getComputedStyle(videoNode.parentElement).position;
              if (parentPos === 'static') {
                videoNode.parentElement.style.position = 'relative';
              }
            }
            if (applyRegularNonShortsOverlayNormalization) {
              normalizeNonShortsOverlayPresentation(candidateOverlay);
            }
            migratedOverlay = candidateOverlay;
            break;
          }
          if (videoNode.parentElement) {
            if (candidateOverlay.parentElement !== videoNode.parentElement) {
              videoNode.parentElement.appendChild(candidateOverlay);
            }
            const parentPos = window.getComputedStyle(videoNode.parentElement).position;
            if (parentPos === 'static') {
              videoNode.parentElement.style.position = 'relative';
            }
          }
          candidateOverlay.dataset.mwNodeId = videoNodeId;
          candidateOverlay.dataset.mwFor = overlayProbeSrc;
          if (applyRegularNonShortsOverlayNormalization) {
            normalizeNonShortsOverlayPresentation(candidateOverlay);
          } else {
            candidateOverlay.style.display = 'flex';
            candidateOverlay.style.pointerEvents = 'none';
          }
          migratedOverlay = candidateOverlay;
          console.log(
            '[DIAG][NON_SHORTS_REATTACH] overlay_migrated_to_video',
            'reason=' + (reason || 'unknown'),
            'nodeId=' + videoNodeId,
            'overlayId=' + String((candidateOverlay.dataset && candidateOverlay.dataset.mwOverlayId) || 'unknown'),
            'itemKey=' + reattachItemKey
          );
          break;
        }
      }
      if (migratedOverlay) {
        videoOverlay = migratedOverlay;
      }
      normalizedOverlay = normalizeOverlayAnchor(videoOverlay, 'post_migrate');
      videoOverlay = normalizedOverlay.overlay;
      overlayAnchored = normalizedOverlay.anchored;
    }
    if (
      (activeVideoBlurred || hasAuthoritativeBlur) &&
      !overlayAnchored &&
      !shouldDisableRevealUiForMvpMainPageSurface()
    ) {
      createRevealOverlay(videoNode, overlayProbeSrc, overlayCategory, overlayItemId);
      videoOverlay = findRevealOverlayForElement(videoNode, overlayProbeSrc);
      normalizedOverlay = normalizeOverlayAnchor(videoOverlay, 'post_create');
      videoOverlay = normalizedOverlay.overlay;
      overlayAnchored = normalizedOverlay.anchored;
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] overlay_heal_create',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'src=' + String(overlayProbeSrc || '').substring(0, 180),
        'itemId=' + String(overlayItemId || 'none'),
        'anchored=' + overlayAnchored
      );
    }
    if (overlayAnchored) {
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] overlay_reanchored',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'overlayId=' + String((videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown')
      );
      console.log(
        '[DIAG][MVP_NON_SHORTS] reveal_control_rebound',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'overlayId=' + String((videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown')
      );
      console.log(
        '[DIAG][MVP_ITEM_CHAIN] stage=reattach_rebound',
        'itemId=' + reattachItemId,
        'itemKey=' + reattachItemKey,
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'overlayId=' + String((videoOverlay.dataset && videoOverlay.dataset.mwOverlayId) || 'unknown')
      );
    } else {
      console.log(
        '[DIAG][MVP_ITEM_CHAIN] stage=reattach_overlay_missing',
        'itemId=' + reattachItemId,
        'itemKey=' + reattachItemKey,
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId
      );
    }
    postNonShortsTransitionDiag('apply', {
      reason: String(reason || 'unknown'),
      nodeId: videoNodeId,
      activeVideoBlurred: !!activeVideoBlurred,
      authoritativeBlur: !!hasAuthoritativeBlur,
      incidentalBlur: !!hasIncidentalBlur,
      contextFound: !!contextData,
      contextKind: String(contextKind || 'none'),
      overlayAnchored: !!overlayAnchored,
      overlayPresent: !!videoOverlay,
    });

    const reattachItemKeyKnown = !!(reattachItemKey && reattachItemKey !== 'unknown');
    const strictContinuityItemKeyKnown = !!(strictContinuityItemKey && strictContinuityItemKey !== 'unknown');
    const contextFound = !!contextData;
    const noisyAttrTransition = reasonText.indexOf('attr:') === 0;
    const resolvedOwnershipKeys = new Set();
    if (strictContinuityItemKeyKnown) resolvedOwnershipKeys.add(String(strictContinuityItemKey));
    if (contextItemKey && contextItemKey !== 'unknown') resolvedOwnershipKeys.add(String(contextItemKey));
    if (reattachItemKeyKnown) resolvedOwnershipKeys.add(String(reattachItemKey));
    const hasResolvedOwnership = resolvedOwnershipKeys.size > 0 || contextFound;
    const skipStaleSweepForUnresolvedNoise = !!(
      regularPathQuarantinePassed &&
      noisyAttrTransition &&
      !contextFound &&
      !activeVideoBlurred &&
      !hasResolvedOwnership
    );
    if (skipStaleSweepForUnresolvedNoise) {
      const safeResolvedOverlayProbeSrc = !!(overlayProbeSrc && isSafeResolvedActive(overlayProbeSrc));
      if (safeResolvedOverlayProbeSrc && card && typeof card.querySelectorAll === 'function') {
        const overlays = card.querySelectorAll('.mw-reveal-overlay');
        let removed = 0;
        for (let i = 0; i < overlays.length; i += 1) {
          const overlay = overlays[i];
          if (!overlay || overlay.nodeType !== 1) continue;
          if (overlay.parentElement) {
            const overlayId = String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown');
            overlay.parentElement.removeChild(overlay);
            removed += 1;
            console.log(
              '[MW-MVP-REGULAR-THUMB-SAFE-PURGE] removed_overlay',
              'reason=' + (reason || 'unknown'),
              'nodeId=' + videoNodeId,
              'overlayId=' + overlayId,
              'srcKey=' + getDiagItemKey(overlayProbeSrc)
            );
          }
        }
        if (removed > 0) {
          try { videoNode.dataset.mwHasOverlay = 'false'; } catch (e) {}
          console.log(
            '[MW-MVP-REGULAR-THUMB-SAFE-PURGE] purged',
            'reason=' + (reason || 'unknown'),
            'nodeId=' + videoNodeId,
            'removed=' + removed,
            'src=' + String(overlayProbeSrc || '').substring(0, 180)
          );
          postNonShortsTransitionDiag('regular_main_safe_overlay_purge', {
            reason: String(reason || 'unknown'),
            nodeId: videoNodeId,
            marker: 'MW-MVP-REGULAR-THUMB-SAFE-PURGE',
            removed: removed,
            srcKey: String(getDiagItemKey(overlayProbeSrc)),
          });
        }
      }
      // Fail-closed MVP polish: even if ownership is unresolved and our overlay lookup reports
      // overlayPresent=0, a stale/orphan reveal UI may still be visible (attached outside the
      // current ownership parent chain). Hunt for any reveal overlays that geometrically cover
      // this video node and remove them.
      try {
        if (videoNode && videoNode.isConnected && typeof videoNode.getBoundingClientRect === 'function') {
          const huntCandidates = [];
          if (card && typeof card.querySelectorAll === 'function') {
            const cardOverlays = card.querySelectorAll('.mw-reveal-overlay');
            for (let i = 0; i < cardOverlays.length; i += 1) {
              huntCandidates.push(cardOverlays[i]);
            }
          }
          const globalOverlays = document.querySelectorAll('.mw-reveal-overlay');
          for (let i = 0; i < globalOverlays.length; i += 1) {
            huntCandidates.push(globalOverlays[i]);
          }
          const seenOverlays = new Set();
          let orphanHits = 0;
          for (let i = 0; i < huntCandidates.length; i += 1) {
            const overlay = huntCandidates[i];
            if (!overlay || overlay.nodeType !== 1 || !overlay.isConnected) continue;
            if (seenOverlays.has(overlay)) continue;
            seenOverlays.add(overlay);
            if (!overlay.parentElement) continue;
            if (overlay === videoOverlay) continue;
            const anchored = isNonShortsOverlayGeometryAnchored(overlay, videoNode);
            if (!anchored) continue;
            const overlayId = String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown');
            const overlayNodeId = String((overlay.dataset && overlay.dataset.mwNodeId) || 'none');
            const overlayFor = String((overlay.dataset && overlay.dataset.mwFor) || '');
            const overlayItemKey = getDiagItemKey(overlayFor);
            console.warn(
              '[MW-MVP-REVEAL-ORPHAN-HUNT] hit',
              'reason=' + (reason || 'unknown'),
              'nodeId=' + videoNodeId,
              'overlayFoundOutsideOwnership=true',
              'overlayId=' + overlayId,
              'overlayNodeId=' + overlayNodeId,
              'overlayItemKey=' + String(overlayItemKey || 'unknown')
            );
            overlay.parentElement.removeChild(overlay);
            orphanHits += 1;
            console.warn(
              '[MW-MVP-REVEAL-ORPHAN-HUNT] removed',
              'reason=' + (reason || 'unknown'),
              'nodeId=' + videoNodeId,
              'overlayId=' + overlayId
            );
          }
          if (orphanHits > 0) {
            try { videoNode.dataset.mwHasOverlay = 'false'; } catch (e) {}
            postNonShortsTransitionDiag('regular_main_reveal_orphan_hunt', {
              reason: String(reason || 'unknown'),
              nodeId: videoNodeId,
              marker: 'MW-MVP-REVEAL-ORPHAN-HUNT',
              removed: orphanHits,
            });
            console.warn(
              '[MW-MVP-REVEAL-ORPHAN-HUNT] done',
              'reason=' + (reason || 'unknown'),
              'nodeId=' + videoNodeId,
              'removed=' + orphanHits
            );
          }
        }
      } catch (e) {}
      console.log(
        '[MW-MVP-REGULAR-THUMB-STALE-SWEEP-GUARD-V3] skip_unresolved_noise',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'contextFound=' + String(contextFound),
        'activeVideoBlurred=' + String(!!activeVideoBlurred)
      );
      postNonShortsTransitionDiag('regular_main_stale_overlay_sweep_skipped_unresolved_noise', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-MVP-REGULAR-THUMB-STALE-SWEEP-GUARD-V3',
        contextFound: !!contextFound,
        activeVideoBlurred: !!activeVideoBlurred,
      });
    }
    let staleOverlayCount = 0;
    if (!skipStaleSweepForUnresolvedNoise && card && typeof card.querySelectorAll === 'function') {
      const overlays = card.querySelectorAll('.mw-reveal-overlay');
      for (let i = 0; i < overlays.length; i += 1) {
        const overlay = overlays[i];
        if (!overlay || overlay.nodeType !== 1 || !overlay.isConnected) continue;
        const anchorNodeId = String((overlay.dataset && overlay.dataset.mwNodeId) || '');
        if (!anchorNodeId || anchorNodeId === videoNodeId) continue;
        const overlayFor = String((overlay.dataset && overlay.dataset.mwFor) || '');
        const overlayItemKey = getDiagItemKey(overlayFor);
        const provablyStaleForResolvedOwnership = !!(
          resolvedOwnershipKeys.size > 0 &&
          overlayItemKey &&
          overlayItemKey !== 'unknown' &&
          !resolvedOwnershipKeys.has(String(overlayItemKey))
        );
        if (!provablyStaleForResolvedOwnership) {
          continue;
        }
        if (anchorNodeId && anchorNodeId !== videoNodeId) {
          console.warn(
            '[DIAG][NON_SHORTS_REATTACH] stale_overlay_detected',
            'reason=' + (reason || 'unknown'),
            'nodeId=' + videoNodeId,
            'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
            'overlayNodeId=' + String((overlay.dataset && overlay.dataset.mwNodeId) || 'none'),
            'overlayItemKey=' + String(overlayItemKey || 'unknown'),
            'activeVideoBlurred=' + activeVideoBlurred
          );
          if (overlay.parentElement) {
            const staleOverlayId = String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown');
            const staleOverlayNodeId = String((overlay.dataset && overlay.dataset.mwNodeId) || 'none');
            overlay.parentElement.removeChild(overlay);
            staleOverlayCount += 1;
            console.log(
              '[DIAG][NON_SHORTS_REATTACH] stale_overlay_removed',
              'reason=' + (reason || 'unknown'),
              'nodeId=' + videoNodeId,
              'overlayId=' + staleOverlayId,
              'overlayNodeId=' + staleOverlayNodeId,
              'overlayItemKey=' + String(overlayItemKey || 'unknown')
            );
          }
        }
      }
    }
    if (staleOverlayCount > 0 && regularPathQuarantinePassed) {
      console.log(
        '[MW-MVP-REGULAR-THUMB-REATTACH-GUARD-V2] stale_overlay_sweep',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'removed=' + staleOverlayCount
      );
      postNonShortsTransitionDiag('regular_main_stale_overlay_sweep', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-MVP-REGULAR-THUMB-REATTACH-GUARD-V2',
        removed: staleOverlayCount,
      });
    }
    if (staleOverlayCount > 0) {
      console.log(
        '[DIAG][NON_SHORTS_REATTACH] stale_overlay_sweep_done',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'removed=' + staleOverlayCount
      );
    }
  }

  function ensureNonShortsReattachListeners() {
    if (window.__MW_NON_SHORTS_REATTACH_LISTENERS__) return;
    window.__MW_NON_SHORTS_REATTACH_LISTENERS__ = true;
    const onVideoLifecycleEvent = function(event) {
      const target = event && event.target;
      if (!target || target.nodeType !== 1) return;
      if (String(target.tagName || '').toUpperCase() !== 'VIDEO') return;
      reapplyOwnedShortsShelfBlurFromLifecycleEvent(target, 'event:' + String(event.type || 'unknown'));
      diagNonShortsReattach(target, 'event:' + String(event.type || 'unknown'));
    };
    document.addEventListener('play', onVideoLifecycleEvent, true);
    document.addEventListener('playing', onVideoLifecycleEvent, true);
    document.addEventListener('loadeddata', onVideoLifecycleEvent, true);
  }

  function getDiagNodeId(node) {
    if (!node || node.nodeType !== 1) return 'n/a';
    const existing = diagNodeIds.get(node);
    if (existing) return existing;
    diagNodeSeq += 1;
    const created = 'n' + diagNodeSeq;
    diagNodeIds.set(node, created);
    return created;
  }

  function getDiagRect(node) {
    if (!node || typeof node.getBoundingClientRect !== 'function') {
      return 'x=0,y=0,w=0,h=0';
    }
    try {
      const rect = node.getBoundingClientRect();
      return 'x=' + Math.round(rect.x) + ',y=' + Math.round(rect.y) + ',w=' + Math.round(rect.width) + ',h=' + Math.round(rect.height);
    } catch (e) {
      return 'x=0,y=0,w=0,h=0';
    }
  }

  function getDiagSourceFields(node) {
    let currentSrc = '';
    let poster = '';
    try {
      if (node && typeof node.currentSrc === 'string' && node.currentSrc) {
        currentSrc = node.currentSrc;
      } else if (node && typeof node.src === 'string' && node.src) {
        currentSrc = node.src;
      }
      if (node && typeof node.poster === 'string' && node.poster) {
        poster = node.poster;
      }
    } catch (e) {}
    return { currentSrc: currentSrc, poster: poster };
  }

  function getDiagItemKey(src) {
    const normalized = normalizeUrl(src || '') || String(src || '');
    if (!normalized) return 'unknown';
    try {
      const parsed = new URL(normalized, window.location.href);
      const host = String(parsed.hostname || '').toLowerCase();
      const isYouTubeHost =
        host.indexOf('youtube.com') !== -1 ||
        host.indexOf('youtu.be') !== -1 ||
        host.indexOf('ytimg.com') !== -1 ||
        host.indexOf('googlevideo.com') !== -1;
      if (isYouTubeHost) {
        const queryId = parsed.searchParams.get('v');
        if (queryId) return queryId;
        const shortsMatch = String(parsed.pathname || '').match(/\\/shorts\\/([^/?#]+)/);
        if (shortsMatch && shortsMatch[1]) return shortsMatch[1];
        const viMatch = String(parsed.pathname || '').match(/\\/vi(?:_webp)?\\/([^/]+)/);
        if (viMatch && viMatch[1]) return viMatch[1];
      }
    } catch (e) {}
    return String(normalized).substring(0, 220);
  }

  function getDiagTargetDescriptor(target) {
    if (!target || target.nodeType !== 1) return 'unknown';
    const tag = String(target.tagName || 'unknown').toLowerCase();
    let classSuffix = '';
    try {
      const className = String(target.className || '').trim();
      if (className) {
        const tokens = className.split(/\\s+/).filter(Boolean).slice(0, 3);
        if (tokens.length) {
          classSuffix = '.' + tokens.join('.');
        }
      }
    } catch (e) {}
    return tag + classSuffix;
  }

  function logAdaptiveShortsEvent(eventName, details) {
    if (!DIAG_ENABLED && !DIAG_YT_BLUR) return;
    console.log(
      '[DIAG][ADAPTIVE]',
      eventName || 'unknown',
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch,
      details || ''
    );
  }

  function diagShortsTimeline(eventName, details) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    const elapsedMs = Date.now() - diagShortsTimelineStartAt;
    console.log(
      '[MW-YT][DIAG][SHORTS_TIMELINE]',
      't+' + elapsedMs + 'ms',
      'event=' + (eventName || 'unknown'),
      details || ''
    );
  }

  function getDiagClassList(node) {
    if (!node || node.nodeType !== 1) return '';
    try {
      if (node.classList && node.classList.length) {
        return Array.prototype.slice.call(node.classList, 0, 12).join(' ');
      }
      return String(node.className || '').trim();
    } catch (e) {
      return String(node.className || '').trim();
    }
  }

  function getDiagDatasetSnapshot(node) {
    if (!node || node.nodeType !== 1 || !node.dataset) return '{}';
    const snapshot = {};
    let keys = [];
    try {
      keys = Object.keys(node.dataset).sort();
    } catch (e) {
      keys = [];
    }
    const maxKeys = 20;
    for (let i = 0; i < keys.length && i < maxKeys; i += 1) {
      const key = keys[i];
      snapshot[key] = String(node.dataset[key] || '').substring(0, 140);
    }
    if (keys.length > maxKeys) {
      snapshot.__extraKeys = String(keys.length - maxKeys);
    }
    try {
      return JSON.stringify(snapshot);
    } catch (e) {
      return '{}';
    }
  }

  function getDiagNodeSignature(node) {
    if (!node || node.nodeType !== 1) return 'unknown';
    const tag = String(node.tagName || 'unknown').toLowerCase();
    const idSuffix = node.id ? ('#' + node.id) : '';
    const classes = getDiagClassList(node);
    let classSuffix = '';
    if (classes) {
      const classTokens = classes.split(/\\s+/).filter(Boolean).slice(0, 3);
      if (classTokens.length) {
        classSuffix = '.' + classTokens.join('.');
      }
    }
    return tag + idSuffix + classSuffix;
  }

  function getDiagParentChain(node, depth) {
    const chain = [];
    let current = node && node.parentElement ? node.parentElement : null;
    const maxDepth = Number.isFinite(depth) ? Math.max(0, depth) : 3;
    for (let i = 0; i < maxDepth && current; i += 1) {
      chain.push(getDiagNodeSignature(current) + '(nodeId=' + getDiagNodeId(current) + ')');
      current = current.parentElement;
    }
    return chain.join(' <= ');
  }

  function isDiagBlurActiveOnNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const inlineFilter = String(node.style.getPropertyValue('filter') || node.style.filter || '').toLowerCase();
    const inlineBackdrop = String(node.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
    return (
      inlineFilter.indexOf('blur(') !== -1 ||
      inlineBackdrop.indexOf('blur(') !== -1 ||
      (node.dataset && node.dataset.mwModerated === 'blurred') ||
      (node.classList && node.classList.contains('mw-blurred'))
    );
  }

  function isHtml5MainVideoNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (String(node.tagName || '').toUpperCase() !== 'VIDEO') return false;
    return !!(node.classList && node.classList.contains('html5-main-video'));
  }

  function diagCollectDescendantTagNodes(root, tagNameLower) {
    const matches = [];
    if (!root || root.nodeType !== 1) return matches;
    const normalizedTag = String(tagNameLower || '').toUpperCase();
    if (String(root.tagName || '').toUpperCase() === normalizedTag) {
      matches.push(root);
    }
    if (typeof root.querySelectorAll === 'function') {
      const descendants = root.querySelectorAll(String(tagNameLower || '').toLowerCase());
      for (let i = 0; i < descendants.length; i += 1) {
        matches.push(descendants[i]);
      }
    }
    return matches;
  }

  function diagLogHtml5MainVideoAppearance(videoNode, reason, relatedBlurNodeId, src, itemId) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    if (!videoNode || videoNode.nodeType !== 1) return;
    if (!isHtml5MainVideoNode(videoNode)) return;
    const videoNodeId = getDiagNodeId(videoNode);
    const classList = getDiagClassList(videoNode);
    const alreadyBlurred = isDiagBlurActiveOnNode(videoNode);
    const computed = getDiagComputedBlurState(videoNode);
    const everBlurredThisNode = diagShortsBlurredHtml5MainVideoNodeIds.has(videoNodeId);
    diagShortsTimeline(
      'html5_main_video_appeared',
      'nodeId=' + videoNodeId +
      ' tagName=' + String(videoNode.tagName || 'unknown') +
      ' reason=' + (reason || 'unknown') +
      ' classList=' + String(classList || '').substring(0, 200) +
      ' connected=' + (!!videoNode.isConnected) +
      ' computedFilter=' + String(computed.filter || '').substring(0, 120) +
      ' computedBackdrop=' + String(computed.backdropFilter || '').substring(0, 120) +
      ' blurredNow=' + alreadyBlurred +
      ' everBlurredThisNode=' + everBlurredThisNode +
      ' everBlurredAnyHtml5=' + (diagShortsBlurredHtml5MainVideoNodeIds.size > 0) +
      ' relatedBlurNodeId=' + (relatedBlurNodeId || 'none') +
      ' src=' + String(src || '').substring(0, 180) +
      ' itemId=' + (itemId || 'none')
    );
  }

  function diagLogVideoInserted(node, reason, relatedBlurNodeId, src, itemId) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    const videos = diagCollectDescendantTagNodes(node, 'video');
    for (let i = 0; i < videos.length; i += 1) {
      const video = videos[i];
      if (!video || video.nodeType !== 1) continue;
      const nodeId = getDiagNodeId(video);
      const classList = getDiagClassList(video);
      const dataset = getDiagDatasetSnapshot(video);
      const source = getDiagSourceFields(video);
      const html5Main = isHtml5MainVideoNode(video);
      const blurActive = isDiagBlurActiveOnNode(video);
      const computed = getDiagComputedBlurState(video);
      diagShortsTimeline(
        'video_inserted',
        'nodeId=' + nodeId +
        ' tagName=' + String(video.tagName || 'unknown') +
        ' reason=' + (reason || 'unknown') +
        ' classList=' + String(classList || '').substring(0, 200) +
        ' dataset=' + dataset +
        ' connected=' + (!!video.isConnected) +
        ' computedFilter=' + String(computed.filter || '').substring(0, 120) +
        ' computedBackdrop=' + String(computed.backdropFilter || '').substring(0, 120) +
        ' currentSrc=' + String(source.currentSrc || '').substring(0, 180) +
        ' poster=' + String(source.poster || '').substring(0, 180) +
        ' html5MainVideo=' + html5Main +
        ' blurredNow=' + blurActive +
        ' relatedBlurNodeId=' + (relatedBlurNodeId || 'none') +
        ' src=' + String(src || '').substring(0, 180) +
        ' itemId=' + (itemId || 'none')
      );
      if (html5Main) {
        diagLogHtml5MainVideoAppearance(video, reason, relatedBlurNodeId, src, itemId);
      }
    }
  }

  function diagLogImgRemoved(node, reason, relatedBlurNodeId, src, itemId) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    const imgs = diagCollectDescendantTagNodes(node, 'img');
    for (let i = 0; i < imgs.length; i += 1) {
      const img = imgs[i];
      if (!img || img.nodeType !== 1) continue;
      const source = getDiagSourceFields(img);
      const computed = getDiagComputedBlurState(img);
      diagShortsTimeline(
        'img_removed',
        'nodeId=' + getDiagNodeId(img) +
        ' tagName=' + String(img.tagName || 'unknown') +
        ' reason=' + (reason || 'unknown') +
        ' classList=' + String(getDiagClassList(img) || '').substring(0, 200) +
        ' dataset=' + getDiagDatasetSnapshot(img) +
        ' connected=' + (!!img.isConnected) +
        ' computedFilter=' + String(computed.filter || '').substring(0, 120) +
        ' computedBackdrop=' + String(computed.backdropFilter || '').substring(0, 120) +
        ' currentSrc=' + String(source.currentSrc || '').substring(0, 180) +
        ' relatedBlurNodeId=' + (relatedBlurNodeId || 'none') +
        ' src=' + String(src || '').substring(0, 180) +
        ' itemId=' + (itemId || 'none')
      );
    }
  }

  function isShortsHealthHealIntervalEligible() {
    if (!SHORTS_HEALTH_HEAL_ENABLED) return false;
    if (timerState.paused || timerState.teardownDone) return false;
    if (document.visibilityState !== 'visible') return false;
    if (!isShortsModeActive()) return false;
    if (shortsBlurContextCount <= 0) return false;
    return true;
  }

  function stopShortsHealthHealInterval(reason) {
    const id = timerState.shortsHealthHealInterval;
    if (!id) return;
    clearInterval(id);
    timerState.shortsHealthHealInterval = null;
    logShortsHealthEvent(
      'shorts_health_interval_stop',
      'reason=' + (reason || 'stop')
    );
  }

  function maybeStartShortsHealthHealInterval(reason) {
    if (!isShortsHealthHealIntervalEligible()) return;
    if (timerState.shortsHealthHealInterval) return;
    timerState.shortsHealthHealInterval = setInterval(function() {
      if (!isShortsHealthHealIntervalEligible()) {
        stopShortsHealthHealInterval('ineligible');
        return;
      }
      runShortsHealthHealCycle('interval');
    }, SHORTS_HEALTH_HEAL_INTERVAL_MS);
    logShortsHealthEvent(
      'shorts_health_interval_start',
      'reason=' + (reason || 'unknown') +
      ' intervalMs=' + SHORTS_HEALTH_HEAL_INTERVAL_MS
    );
    runShortsHealthHealCycle('start');
  }

  function runShortsHealthHealCycle(reason) {
    if (!isShortsHealthHealIntervalEligible()) return;
    const container = getActiveShortsPlayerContainer();
    if (!container || container.nodeType !== 1 || !container.isConnected) return;
    runShortsHealthHealForContainer(container, reason || 'interval');
  }

  // FREEZE-OVERRIDE: bounded retry burst for intermittent blur-without-reveal.
  // Owner-token defer / swipe DOM churn can miss the first createRevealOverlay;
  // health heal may also be in giveup. These retries only attach reveal — never unblur.
  function scheduleActiveShortsRevealPairingBurst(targetNode, src, category, itemId, reason) {
    if (!isShortsModeActive() || !targetNode || targetNode.nodeType !== 1) return;
    if (targetNode.dataset && targetNode.dataset.mwPairingBurstScheduled === 'true') return;
    try {
      if (targetNode.dataset) targetNode.dataset.mwPairingBurstScheduled = 'true';
    } catch (e) {}
    const delays = [0, 60, 180, 450, 900, 1600];
    for (let i = 0; i < delays.length; i += 1) {
      const delayMs = delays[i];
      setTimeout(function() {
        try {
          if (!isVisualModerationActive() || !isShortsModeActive()) return;
          if (!targetNode || !targetNode.isConnected) return;
          if (String((targetNode.dataset && targetNode.dataset.mwModerated) || '') !== 'blurred') return;
          if (isRevealedForSource(src, targetNode)) return;
          if (findRevealOverlayForElement(targetNode, src)) {
            try {
              if (targetNode.dataset) targetNode.dataset.mwPairingBurstScheduled = 'false';
            } catch (e2) {}
            return;
          }
          // Clear defer latches so createRevealOverlay can proceed.
          try {
            targetNode.dataset.mwOwnerDeferCount = '0';
            targetNode.dataset.mwOwnerDeferScheduled = 'false';
            targetNode.dataset.mwOwnerMismatchCount = '0';
            targetNode.dataset.mwOwnerMismatchRetryScheduled = 'false';
          } catch (e3) {}
          healActiveShortsRevealPairing(
            targetNode,
            src,
            category || 'flagged',
            itemId || '',
            'pairing_burst:' + (reason || 'unknown') + ':t' + delayMs
          );
          if (findRevealOverlayForElement(targetNode, src)) {
            try {
              if (targetNode.dataset) targetNode.dataset.mwPairingBurstScheduled = 'false';
            } catch (e4) {}
            console.log(
              '[DIAG][REVEAL_UI] pairing_burst_success',
              'delayMs=' + delayMs,
              'reason=' + (reason || 'unknown'),
              'node=' + getDiagNodeId(targetNode)
            );
          } else if (delayMs === delays[delays.length - 1]) {
            try {
              if (targetNode.dataset) targetNode.dataset.mwPairingBurstScheduled = 'false';
            } catch (e5) {}
            console.warn(
              '[DIAG][REVEAL_UI] pairing_burst_exhausted',
              'reason=' + (reason || 'unknown'),
              'node=' + getDiagNodeId(targetNode),
              'src=' + String(src || '').substring(0, 120)
            );
          }
        } catch (e) {}
      }, delayMs);
    }
  }

  // FREEZE-OVERRIDE (call-site only): surgical active-Shorts reveal pairing heal.
  // Does NOT rewrite createRevealOverlay / resolveShortsStableBlurTarget bodies.
  // Refreshes owner context then invokes the frozen createRevealOverlay on the
  // stable (or live) blur target when blur is present but reveal is missing.
  // FREEZE-OVERRIDE (reveal pairing): home/results first-entry cold load often
  // hard-blurs the first thumbnail before the card parent is position:relative /
  // before createRevealOverlay sticks. Shorts already had a pairing burst; main
  // surfaces only called createRevealOverlay once — first thumb lost reveal.
  function scheduleNonShortsRevealPairingBurst(targetNode, src, category, itemId, reason) {
    if (isShortsModeActive()) return;
    if (!targetNode || targetNode.nodeType !== 1) return;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return;
    if (targetNode.dataset && targetNode.dataset.mwNonShortsPairingBurst === 'true') return;
    try {
      if (targetNode.dataset) targetNode.dataset.mwNonShortsPairingBurst = 'true';
    } catch (e) {}
    const delays = [0, 80, 220, 500, 1000, 1800];
    for (let i = 0; i < delays.length; i += 1) {
      const delayMs = delays[i];
      setTimeout(function() {
        try {
          if (!isVisualModerationActive() || isShortsModeActive()) return;
          if (!targetNode || !targetNode.isConnected) return;
          if (String((targetNode.dataset && targetNode.dataset.mwModerated) || '') !== 'blurred') return;
          if (isRevealedForSource(src, targetNode)) return;
          if (findRevealOverlayForElement(targetNode, src)) {
            try {
              if (targetNode.dataset) targetNode.dataset.mwNonShortsPairingBurst = 'false';
            } catch (e2) {}
            return;
          }
          // Ensure parent can host absolute overlay (first-row cards often static).
          try {
            const parent = targetNode.parentElement;
            if (parent && parent.nodeType === 1) {
              const pos = window.getComputedStyle(parent).position;
              if (pos === 'static') parent.style.position = 'relative';
            }
          } catch (e3) {}
          createRevealOverlay(
            targetNode,
            src,
            category || targetNode.dataset.mwCategory || 'flagged',
            itemId || targetNode.dataset.mwItemId || '',
            false
          );
          if (findRevealOverlayForElement(targetNode, src)) {
            try {
              if (targetNode.dataset) targetNode.dataset.mwNonShortsPairingBurst = 'false';
            } catch (e4) {}
            console.log(
              '[DIAG][REVEAL_UI] non_shorts_pairing_burst_success',
              'delayMs=' + delayMs,
              'reason=' + (reason || 'unknown'),
              'node=' + getDiagNodeId(targetNode),
              'itemKey=' + getDiagItemKey(src)
            );
          } else if (delayMs >= 1800) {
            console.warn(
              '[DIAG][REVEAL_UI] non_shorts_pairing_burst_exhausted',
              'reason=' + (reason || 'unknown'),
              'node=' + getDiagNodeId(targetNode),
              'itemKey=' + getDiagItemKey(src)
            );
            try {
              if (targetNode.dataset) targetNode.dataset.mwNonShortsPairingBurst = 'false';
            } catch (e5) {}
          }
        } catch (e6) {}
      }, delayMs);
    }
  }

  function healActiveShortsRevealPairing(targetNode, src, category, itemId, reason) {
    if (!isShortsModeActive()) return false;
    if (!isVisualModerationActive()) return false;
    if (!targetNode || targetNode.nodeType !== 1 || !targetNode.isConnected) return false;
    const healSrc = String(src || (targetNode.dataset && targetNode.dataset.mwSrc) || '');
    if (!healSrc) return false;
    if (isRevealedForSource(healSrc, targetNode)) return false;
    if (String(targetNode.dataset.mwModerated || '') !== 'blurred') return false;
    if (findRevealOverlayForElement(targetNode, healSrc)) return true;

    let healTarget = targetNode;
    let selectorUsed = String((targetNode.dataset && targetNode.dataset.mwShortsStableSelector) || '');
    try {
      const resolution = resolveShortsStableBlurTarget(targetNode, healSrc);
      if (resolution && resolution.target && resolution.target.isConnected) {
        // Prefer stable container only when it already carries the blurred stamp
        // (or is the same node). Avoid redirecting reveal onto an unblurred shell.
        if (
          resolution.target === targetNode ||
          String(resolution.target.dataset && resolution.target.dataset.mwModerated || '') === 'blurred'
        ) {
          healTarget = resolution.target;
          selectorUsed = resolution.selectorUsed || selectorUsed;
        }
      }
    } catch (e) {}

    if (String(healTarget.dataset.mwModerated || '') !== 'blurred') {
      healTarget = targetNode;
    }
    if (!healTarget.isConnected) return false;
    if (findRevealOverlayForElement(healTarget, healSrc)) return true;

    const healCategory = category || String((healTarget.dataset && healTarget.dataset.mwCategory) || 'flagged');
    const healItemId = itemId || String((healTarget.dataset && healTarget.dataset.mwItemId) || '');

    // Owner-token refresh closes first-entry / node-swap timing gaps that cause
    // createRevealOverlay to defer or return without attaching reveal UI.
    setShortsBlurContextForNode(
      healTarget,
      healSrc,
      healCategory,
      healItemId,
      null,
      selectorUsed || null,
      'heal_reveal_pairing:' + (reason || 'unknown')
    );
    // Clear stale defer/mismatch latches so frozen createRevealOverlay can retry now.
    try {
      healTarget.dataset.mwOwnerMismatchCount = '0';
      healTarget.dataset.mwOwnerMismatchRetryScheduled = 'false';
      healTarget.dataset.mwOwnerDeferCount = '0';
      healTarget.dataset.mwOwnerDeferScheduled = 'false';
    } catch (e) {}

    createRevealOverlay(healTarget, healSrc, healCategory, healItemId, false);
    const attached =
      !!findRevealOverlayForElement(healTarget, healSrc) ||
      !!findRevealOverlayForElement(targetNode, healSrc);

    if (attached) {
      logShortsHealthEvent(
        'shorts_reveal_pairing_heal_success',
        'reason=' + (reason || 'unknown') +
        ' targetNodeId=' + getDiagNodeId(healTarget) +
        ' src=' + healSrc.substring(0, 180)
      );
      warnActiveShortsRevealPairingDiag(
        'reveal_pairing_heal_success',
        {
          reason: String(reason || 'unknown'),
          failClass: 'healed',
          targetNodeId: getDiagNodeId(healTarget),
          targetTag: String(healTarget.tagName || 'none'),
          mwModerated: 'blurred',
          hasComputedBlur: true,
          overlayExpected: true,
          overlayPresent: true,
          overlayAttached: true,
          overlayVisible: true,
          overlayAnchored: true,
          ownerTokenPresent: true,
          elementOwnerTokenPresent: true,
          ownerTokensMatch: true,
          contextSrcKey: getDiagItemKey(healSrc),
        },
        { throttleMs: 800 }
      );
    } else {
      const gap = classifyActiveShortsRevealGap(healTarget, getDiagOverlayState(healTarget), {
        reason: 'reveal_pairing_heal_failed:' + (reason || 'unknown'),
        src: healSrc,
        hasComputedBlur: true,
        overlayExpected: true,
        overlayAnchored: false,
      });
      warnActiveShortsRevealPairingDiag('reveal_pairing_heal_failed', gap, { throttleMs: 800 });
    }
    return attached;
  }

  function runShortsHealthHealForContainer(container, reason) {
    if (!container || container.nodeType !== 1) return;
    const context = shortsBlurContextByContainer.get(container);
    if (!context || !context.src) return;
    const targetNode = context.targetNode && context.targetNode.nodeType === 1 ? context.targetNode : null;
    // Stale identity guard (swipe + epoch races). URL mismatch clears ownership;
    // epoch mismatch skips heal without unblurring valid positives.
    if (isShortsHealthContextStale(context, targetNode)) {
      logShortsHealthEvent(
        'shorts_health_stale_skip',
        'reason=' + (reason || 'unknown') +
        ' containerNodeId=' + getDiagNodeId(container) +
        ' targetNodeId=' + getDiagNodeId(targetNode) +
        ' contextShortsUrlId=' + String(context.shortsUrlId || 'none') +
        ' liveShortsUrlId=' + String(getCurrentShortsUrlId() || 'none') +
        ' pageEpoch=' + String(state.pageEpoch || 0) +
        ' stampedEpoch=' + String((targetNode && targetNode.dataset && targetNode.dataset.mwPageEpoch) || 'none')
      );
      const liveId = getCurrentShortsUrlId() || '';
      // Only clear ownership on Shorts id swap. Epoch mismatch: skip heal, do not
      // unblur (prevents FN clears of still-valid positives after nav epoch churn).
      if (context.shortsUrlId && liveId && String(context.shortsUrlId) !== String(liveId)) {
        try {
          clearShortsOwnedBlurAndOverlayByContext(context, 'shorts_health_stale_url');
        } catch (e) {}
        deleteShortsBlurContextEntry(container);
      }
      return;
    }
    const connected = !!(targetNode && targetNode.isConnected);
    const nodeComputed = getDiagComputedBlurState(targetNode);
    const nodeFilterLower = String(nodeComputed.filter || '').toLowerCase();
    const nodeBackdropLower = String(nodeComputed.backdropFilter || '').toLowerCase();
    const hasComputedBlur = (
      nodeFilterLower.indexOf('blur(') !== -1 ||
      nodeBackdropLower.indexOf('blur(') !== -1
    );
    const revealed = isRevealedForSource(context.src, targetNode);
    const moderatedBlurred = !!(targetNode && targetNode.dataset && targetNode.dataset.mwModerated === 'blurred');
    const overlayExpected = !revealed && moderatedBlurred;
    const overlayState = getDiagOverlayState(targetNode);
    const overlayPresent = !overlayExpected || (overlayState.overlayAttached && overlayState.overlayVisible);
    const healthy = connected && !revealed && moderatedBlurred && hasComputedBlur && overlayPresent;

    let parentNode = null;
    if (targetNode && targetNode.parentElement && targetNode.parentElement.nodeType === 1) {
      parentNode = targetNode.parentElement;
    } else if (container.parentElement && container.parentElement.nodeType === 1) {
      parentNode = container.parentElement;
    }
    let replacementVideo = null;
    if (container && typeof container.querySelector === 'function') {
      replacementVideo = container.querySelector('video.html5-main-video, video');
    }
    if (!replacementVideo && parentNode && typeof parentNode.querySelector === 'function') {
      replacementVideo = parentNode.querySelector('video.html5-main-video, video');
    }
    const replacementId = replacementVideo ? getDiagNodeId(replacementVideo) : 'none';
    const replacementHtml5Main = !!(replacementVideo && isHtml5MainVideoNode(replacementVideo));
    const replacementBlurred = !!(replacementVideo && isDiagBlurActiveOnNode(replacementVideo));
    const replacementComputed = getDiagComputedBlurState(replacementVideo);

    logShortsHealthEvent(
      'shorts_health_check',
      'reason=' + (reason || 'unknown') +
      ' healthy=' + healthy +
      ' containerNodeId=' + getDiagNodeId(container) +
      ' targetNodeId=' + getDiagNodeId(targetNode) +
      ' nodeTagName=' + String(targetNode && targetNode.tagName ? targetNode.tagName : 'none') +
      ' connected=' + connected +
      ' revealed=' + revealed +
      ' moderatedBlurred=' + moderatedBlurred +
      ' hasComputedBlur=' + hasComputedBlur +
      ' overlayExpected=' + overlayExpected +
      ' overlayAttached=' + overlayState.overlayAttached +
      ' overlayVisible=' + overlayState.overlayVisible +
      ' nodeComputedFilter=' + String(nodeComputed.filter || '').substring(0, 120) +
      ' nodeComputedBackdrop=' + String(nodeComputed.backdropFilter || '').substring(0, 120) +
      ' parentNodeId=' + (parentNode ? getDiagNodeId(parentNode) : 'none') +
      ' replacementVideoNodeId=' + replacementId +
      ' replacementTagName=' + String(replacementVideo && replacementVideo.tagName ? replacementVideo.tagName : 'none') +
      ' replacementComputedFilter=' + String(replacementComputed.filter || '').substring(0, 120) +
      ' replacementComputedBackdrop=' + String(replacementComputed.backdropFilter || '').substring(0, 120) +
      ' replacementVideoHtml5Main=' + replacementHtml5Main +
      ' replacementVideoBlurred=' + replacementBlurred +
      ' contextSrc=' + String(context.src || '').substring(0, 180) +
      ' contextItemId=' + (context.itemId || 'none')
    );
    // Diagnostics-only: classify blur-without-reveal before heal mutates state.
    if (!healthy && overlayExpected && !revealed) {
      const liveOverlay = findRevealOverlayForElement(targetNode, context.src || '');
      const gap = classifyActiveShortsRevealGap(targetNode, overlayState, {
        reason: 'shorts_health_check:' + (reason || 'unknown'),
        src: context.src || '',
        context: context,
        hasComputedBlur: hasComputedBlur,
        overlayExpected: true,
        overlayAnchored: !!(
          liveOverlay &&
          liveOverlay.isConnected &&
          String((liveOverlay.dataset && liveOverlay.dataset.mwNodeId) || '') === getDiagNodeId(targetNode)
        ),
      });
      warnActiveShortsRevealPairingDiag('blur_without_reveal', gap, { throttleMs: 1500, force: false });
    }
    if (healthy) return;
    // Card was manually revealed — its unblurred state is intentional.
    // All sub-paths already check reveal state, but exiting here prevents
    // burning through the heal attempt window on every interval tick.
    if (revealed) return;

    const now = Date.now();
    const healState = getShortsHealthHealState(container);
    if (!healState) return;
    if (healState.giveupUntil && now < healState.giveupUntil) {
      logShortsHealthEvent(
        'shorts_health_heal_giveup',
        'reason=giveup_window_active' +
        ' containerNodeId=' + getDiagNodeId(container) +
        ' attemptsInWindow=' + healState.attemptsInWindow +
        ' giveupRemainingMs=' + (healState.giveupUntil - now) +
        ' contextSrc=' + String(context.src || '').substring(0, 180)
      );
      return;
    }
    if (!healState.windowStartAt || (now - healState.windowStartAt) > SHORTS_HEALTH_HEAL_WINDOW_MS) {
      healState.windowStartAt = now;
      healState.attemptsInWindow = 0;
    }
    if (healState.attemptsInWindow >= SHORTS_HEALTH_HEAL_MAX_ATTEMPTS) {
      healState.giveupUntil = now + SHORTS_HEALTH_HEAL_GIVEUP_MS;
      healState.windowStartAt = now;
      healState.attemptsInWindow = 0;
      logShortsHealthEvent(
        'shorts_health_heal_giveup',
        'reason=max_attempts_window' +
        ' containerNodeId=' + getDiagNodeId(container) +
        ' giveupMs=' + SHORTS_HEALTH_HEAL_GIVEUP_MS +
        ' contextSrc=' + String(context.src || '').substring(0, 180)
      );
      return;
    }
    if (healState.lastAttemptAt && (now - healState.lastAttemptAt) < SHORTS_HEALTH_HEAL_COOLDOWN_MS) {
      return;
    }

    healState.lastAttemptAt = now;
    healState.attemptsInWindow += 1;
    const attemptNumber = healState.attemptsInWindow;
    logShortsHealthEvent(
      'shorts_health_heal_attempt',
      'reason=' + (reason || 'unknown') +
      ' attempt=' + attemptNumber +
      ' attemptMax=' + SHORTS_HEALTH_HEAL_MAX_ATTEMPTS +
      ' windowMs=' + SHORTS_HEALTH_HEAL_WINDOW_MS +
      ' containerNodeId=' + getDiagNodeId(container) +
      ' targetNodeId=' + getDiagNodeId(targetNode) +
      ' contextSrc=' + String(context.src || '').substring(0, 180) +
      ' contextItemId=' + (context.itemId || 'none')
    );

    let healTriggered = false;
    const relatedNodeId = getDiagNodeId(targetNode || container);
    const healReason = 'shorts_health_unhealthy:' + (reason || 'unknown');
    healTriggered = reattachShortsBlurForInsertedNode(container, healReason, relatedNodeId);
    if (!healTriggered && targetNode && targetNode.nodeType === 1) {
      healTriggered = reattachShortsBlurForInsertedNode(targetNode, healReason, relatedNodeId);
    }
    if (!healTriggered && replacementVideo && String(replacementVideo.tagName || '').toUpperCase() === 'VIDEO') {
      healTriggered = maybeReattachShortsBlurForVideoNode(replacementVideo, healReason, relatedNodeId);
    }
    if (!healTriggered && targetNode && String(targetNode.tagName || '').toUpperCase() === 'VIDEO') {
      healTriggered = maybeReattachShortsBlurForVideoNode(targetNode, healReason, relatedNodeId);
    }
    if (!healTriggered) {
      const healTarget = (
        (replacementVideo && replacementVideo.nodeType === 1 && replacementVideo.isConnected ? replacementVideo : null) ||
        (targetNode && targetNode.nodeType === 1 ? targetNode : null) ||
        container
      );
      if (healTarget && healTarget.nodeType === 1 && context.src) {
        applyBlur(
          healTarget,
          context.src,
          context.category || 'flagged',
          context.blurPx || CONFIG.blurStrength,
          context.itemId || ''
        );
        healTriggered = true;
      }
    }

    let refreshedContext = shortsBlurContextByContainer.get(container) || context;
    let refreshedTarget = (
      refreshedContext &&
      refreshedContext.targetNode &&
      refreshedContext.targetNode.nodeType === 1
    ) ? refreshedContext.targetNode : targetNode;
    // Surgical reveal pairing: blur present, reveal missing → refresh owner context +
    // force createRevealOverlay on the stable/live target (active Shorts only).
    if (
      refreshedTarget &&
      refreshedTarget.isConnected &&
      String(refreshedTarget.dataset && refreshedTarget.dataset.mwModerated || '') === 'blurred' &&
      !isRevealedForSource(refreshedContext && refreshedContext.src, refreshedTarget) &&
      !findRevealOverlayForElement(refreshedTarget, (refreshedContext && refreshedContext.src) || context.src || '')
    ) {
      const revealHealed = healActiveShortsRevealPairing(
        refreshedTarget,
        (refreshedContext && refreshedContext.src) || context.src || '',
        (refreshedContext && refreshedContext.category) || context.category || 'flagged',
        (refreshedContext && refreshedContext.itemId) || context.itemId || '',
        'health_heal:' + (reason || 'unknown')
      );
      if (revealHealed) {
        healTriggered = true;
      }
      refreshedContext = shortsBlurContextByContainer.get(container) || refreshedContext;
      refreshedTarget = (
        refreshedContext &&
        refreshedContext.targetNode &&
        refreshedContext.targetNode.nodeType === 1 &&
        refreshedContext.targetNode.isConnected
      ) ? refreshedContext.targetNode : refreshedTarget;
    }
    const refreshedConnected = !!(refreshedTarget && refreshedTarget.isConnected);
    const refreshedComputed = getDiagComputedBlurState(refreshedTarget);
    const refreshedFilter = String(refreshedComputed.filter || '').toLowerCase();
    const refreshedBackdrop = String(refreshedComputed.backdropFilter || '').toLowerCase();
    const refreshedHasBlur = (
      refreshedFilter.indexOf('blur(') !== -1 ||
      refreshedBackdrop.indexOf('blur(') !== -1
    );
    const refreshedRevealed = isRevealedForSource(refreshedContext && refreshedContext.src, refreshedTarget);
    const refreshedModerated = !!(
      refreshedTarget &&
      refreshedTarget.dataset &&
      refreshedTarget.dataset.mwModerated === 'blurred'
    );
    const refreshedOverlayExpected = !refreshedRevealed && refreshedModerated;
    const refreshedOverlayState = getDiagOverlayState(refreshedTarget);
    const refreshedOverlayPresent = !refreshedOverlayExpected || (refreshedOverlayState.overlayAttached && refreshedOverlayState.overlayVisible);
    const healed = (
      healTriggered &&
      refreshedConnected &&
      !refreshedRevealed &&
      refreshedModerated &&
      refreshedHasBlur &&
      refreshedOverlayPresent
    );
    if (healed) {
      healState.attemptsInWindow = 0;
      healState.windowStartAt = now;
      logShortsHealthEvent(
        'shorts_health_heal_success',
        'reason=' + (reason || 'unknown') +
        ' attempt=' + attemptNumber +
        ' containerNodeId=' + getDiagNodeId(container) +
        ' targetNodeId=' + getDiagNodeId(refreshedTarget) +
        ' contextSrc=' + String((refreshedContext && refreshedContext.src) || context.src || '').substring(0, 180)
      );
      return;
    }
    if (healState.attemptsInWindow >= SHORTS_HEALTH_HEAL_MAX_ATTEMPTS) {
      const giveupNow = Date.now();
      healState.giveupUntil = giveupNow + SHORTS_HEALTH_HEAL_GIVEUP_MS;
      healState.windowStartAt = giveupNow;
      healState.attemptsInWindow = 0;
      logShortsHealthEvent(
        'shorts_health_heal_giveup',
        'reason=max_attempts_after_attempt' +
        ' containerNodeId=' + getDiagNodeId(container) +
        ' giveupMs=' + SHORTS_HEALTH_HEAL_GIVEUP_MS +
        ' contextSrc=' + String((refreshedContext && refreshedContext.src) || context.src || '').substring(0, 180)
      );
    }
  }

  function diagScheduleBlurredNodePresenceChecks(node, src, itemId) {
    if (!isShortsModeActive()) return;
    if (!SHORTS_HEALTH_HEAL_ENABLED) return;
    if (!node || node.nodeType !== 1) return;
    logShortsHealthEvent(
      'shorts_health_schedule',
      'nodeId=' + getDiagNodeId(node) +
      ' src=' + String(src || '').substring(0, 180) +
      ' itemId=' + (itemId || 'none')
    );
    maybeStartShortsHealthHealInterval('schedule_blur_check');
  }

  function attachDiagBlurredNodeParentObserver(node, src, itemId) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    if (!node || node.nodeType !== 1) return;
    const parent = node.parentElement;
    const nodeId = getDiagNodeId(node);
    if (!parent || parent.nodeType !== 1) {
      diagShortsTimeline(
        'parent_observer_skip',
        'reason=no_parent nodeId=' + nodeId + ' src=' + String(src || '').substring(0, 180)
      );
      return;
    }
    const parentId = getDiagNodeId(parent);
    const existing = diagShortsBlurParentObserverByNode.get(node);
    if (existing && existing.observer && existing.parent === parent) {
      diagShortsTimeline(
        'parent_observer_reused',
        'nodeId=' + nodeId + ' parentNodeId=' + parentId + ' itemId=' + (itemId || 'none')
      );
      return;
    }
    if (existing && existing.observer) {
      try {
        existing.observer.disconnect();
      } catch (e) {}
    }
    const observer = new MutationObserver(function(mutations) {
      for (let i = 0; i < mutations.length; i += 1) {
        const mutation = mutations[i];
        if (!mutation || mutation.type !== 'childList') continue;
        for (let r = 0; r < mutation.removedNodes.length; r += 1) {
          const removedNode = mutation.removedNodes[r];
          if (!removedNode || removedNode.nodeType !== 1) continue;
          diagLogImgRemoved(removedNode, 'parent_observer_removed', nodeId, src, itemId);
        }
        for (let a = 0; a < mutation.addedNodes.length; a += 1) {
          const addedNode = mutation.addedNodes[a];
          if (!addedNode || addedNode.nodeType !== 1) continue;
          reattachShortsBlurForInsertedNode(addedNode, 'parent_observer_added', nodeId);
          diagLogVideoInserted(addedNode, 'parent_observer_added', nodeId, src, itemId);
        }
      }
      if (!node.isConnected) {
        diagShortsTimeline(
          'blurred_node_detached',
          'nodeId=' + nodeId +
          ' tagName=' + String(node.tagName || 'unknown') +
          ' parentNodeId=' + parentId +
          ' isConnected=false' +
          ' src=' + String(src || '').substring(0, 180) +
          ' itemId=' + (itemId || 'none')
        );
      }
    });
    observer.observe(parent, { childList: true, subtree: true });
    diagShortsBlurParentObserverByNode.set(node, { observer: observer, parent: parent });
    diagShortsTimeline(
      'parent_observer_attached',
      'nodeId=' + nodeId +
      ' parentNodeId=' + parentId +
      ' parentChain=' + getDiagParentChain(node, 3) +
      ' src=' + String(src || '').substring(0, 180) +
      ' itemId=' + (itemId || 'none')
    );
  }

  function diagLogBlurAppliedNodeDetails(node, src, category, itemId, selectorUsed) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    if (!node || node.nodeType !== 1) return;
    const nodeId = getDiagNodeId(node);
    const normalizedSrc = normalizeUrl(src || '');
    const srcKey = normalizedSrc || String(src || '');
    const previousNodeId = srcKey ? (diagShortsLastBlurNodeIdBySrc[srcKey] || '') : '';
    if (srcKey) {
      diagShortsLastBlurNodeIdBySrc[srcKey] = nodeId;
    }
    const classList = getDiagClassList(node);
    const dataset = getDiagDatasetSnapshot(node);
    const parentChain = getDiagParentChain(node, 3);
    const html5MainVideo = isHtml5MainVideoNode(node);
    const computed = getDiagComputedBlurState(node);
    const inlineFilter = String(node.style.getPropertyValue('filter') || node.style.filter || '');
    const inlineBackdrop = String(node.style.getPropertyValue('backdrop-filter') || '');
    if (html5MainVideo) {
      diagShortsBlurredHtml5MainVideoNodeIds.add(nodeId);
    }
    if (previousNodeId && previousNodeId !== nodeId) {
      diagShortsTimeline(
        'blur_reattached',
        'srcKey=' + String(srcKey).substring(0, 180) +
        ' oldNodeId=' + previousNodeId +
        ' newNodeId=' + nodeId +
        ' transition=' + previousNodeId + '->' + nodeId +
        ' selector=' + (selectorUsed || (node.dataset && node.dataset.mwShortsStableSelector) || 'none') +
        ' itemId=' + (itemId || 'none')
      );
    }
    diagShortsTimeline(
      'blur_applied',
      'nodeId=' + nodeId +
      ' tagName=' + String(node.tagName || 'unknown') +
      ' classList=' + String(classList || '').substring(0, 200) +
      ' dataset=' + dataset +
      ' parentChain=' + parentChain +
      ' connected=' + (!!node.isConnected) +
      ' selector=' + (selectorUsed || (node.dataset && node.dataset.mwShortsStableSelector) || 'none') +
      ' inlineFilter=' + String(inlineFilter || '').substring(0, 120) +
      ' inlineBackdrop=' + String(inlineBackdrop || '').substring(0, 120) +
      ' computedFilter=' + String(computed.filter || '').substring(0, 120) +
      ' computedBackdrop=' + String(computed.backdropFilter || '').substring(0, 120) +
      ' html5MainVideo=' + html5MainVideo +
      ' src=' + String(src || '').substring(0, 180) +
      ' category=' + (category || 'flagged') +
      ' itemId=' + (itemId || 'none')
    );
    if (html5MainVideo) {
      diagShortsTimeline(
        'blur_attached_html5_main_video',
        'nodeId=' + nodeId +
        ' src=' + String(src || '').substring(0, 180) +
        ' itemId=' + (itemId || 'none')
      );
    }
    attachDiagBlurredNodeParentObserver(node, src, itemId);
  }

  function countBlurredNodesForItemKey(src) {
    if (!src) return 0;
    let count = 0;
    const nodes = document.querySelectorAll('[data-mw-src]');
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!node || node.nodeType !== 1) continue;
      if ((node.dataset && node.dataset.mwSrc) !== src) continue;
      const inlineFilter = String(node.style.getPropertyValue('filter') || node.style.filter || '').toLowerCase();
      const inlineBackdrop = String(node.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
      if (
        inlineFilter.includes('blur(') ||
        inlineBackdrop.includes('blur(') ||
        node.dataset.mwModerated === 'blurred' ||
        node.dataset.mwModerated === 'softblur' ||
        node.classList.contains('mw-blurred') ||
        node.classList.contains('mw-softblur')
      ) {
        count += 1;
      }
    }
    return count;
  }

  function logRevealHittestSnapshot(overlay, btn, overlayId, phase, event) {
    if (!overlay || !btn) return;
    let overlayComputed = null;
    let buttonComputed = null;
    let buttonRect = { x: 0, y: 0, width: 0, height: 0 };
    try {
      overlayComputed = window.getComputedStyle(overlay);
    } catch (e) {}
    try {
      buttonComputed = window.getComputedStyle(btn);
    } catch (e) {}
    try {
      buttonRect = btn.getBoundingClientRect();
    } catch (e) {}
    console.log(
      '[DIAG][HITTEST] overlay_style',
      'overlayId=' + (overlayId || 'unknown'),
      'phase=' + (phase || 'unknown'),
      'z-index=' + (overlayComputed ? overlayComputed.zIndex : 'n/a'),
      'position=' + (overlayComputed ? overlayComputed.position : 'n/a'),
      'pointer-events=' + (overlayComputed ? overlayComputed.pointerEvents : 'n/a'),
      'opacity=' + (overlayComputed ? overlayComputed.opacity : 'n/a')
    );
    console.log(
      '[DIAG][HITTEST] button_style',
      'overlayId=' + (overlayId || 'unknown'),
      'phase=' + (phase || 'unknown'),
      'z-index=' + (buttonComputed ? buttonComputed.zIndex : 'n/a'),
      'position=' + (buttonComputed ? buttonComputed.position : 'n/a'),
      'pointer-events=' + (buttonComputed ? buttonComputed.pointerEvents : 'n/a'),
      'opacity=' + (buttonComputed ? buttonComputed.opacity : 'n/a'),
      'rect=' + Math.round(buttonRect.x) + ',' + Math.round(buttonRect.y) + ',' + Math.round(buttonRect.width) + 'x' + Math.round(buttonRect.height)
    );
    if (event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      let topElement = null;
      try {
        topElement = document.elementFromPoint(event.clientX, event.clientY);
      } catch (e) {}
      console.log(
        '[DIAG][HITTEST] elementFromPoint=' + getDiagTargetDescriptor(topElement),
        'overlayId=' + (overlayId || 'unknown'),
        'x=' + event.clientX,
        'y=' + event.clientY
      );
    }
  }

  function ensureRevealDocClickCapture() {
    if (window.__MW_REVEAL_DOC_CAPTURE__) return;
    window.__MW_REVEAL_DOC_CAPTURE__ = true;
    document.addEventListener('click', function(e) {
      const target = e && e.target && e.target.nodeType === 1 ? e.target : null;
      const targetOverlay = target && typeof target.closest === 'function' ? target.closest('.mw-reveal-overlay') : null;
      let pointElement = null;
      try {
        if (Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
          pointElement = document.elementFromPoint(e.clientX, e.clientY);
        }
      } catch (err) {}
      const pointOverlay = pointElement && typeof pointElement.closest === 'function' ? pointElement.closest('.mw-reveal-overlay') : null;
      const overlay = targetOverlay || pointOverlay;
      if (!overlay) return;
      const overlayId = overlay.dataset && overlay.dataset.mwOverlayId ? overlay.dataset.mwOverlayId : 'unknown';
      console.log(
        '[DIAG][REVEAL_EVT] doc_click_capture',
        'hit=' + (targetOverlay ? 'target_overlay' : 'point_overlay'),
        'overlayId=' + overlayId,
        'target=' + getDiagTargetDescriptor(target),
        'x=' + (Number.isFinite(e.clientX) ? e.clientX : 'n/a'),
        'y=' + (Number.isFinite(e.clientY) ? e.clientY : 'n/a')
      );
      const button = overlay.querySelector ? overlay.querySelector('.mw-reveal-btn') : null;
      if (button && button.nodeType === 1) {
        logRevealHittestSnapshot(overlay, button, overlayId, 'doc_click_capture', e);
      }
    }, true);
  }

  // Document-level geometric tap interceptor.
  // The per-card anchor guard (pointer-events:none on the card <a>) cannot defeat
  // YouTube home-feed cards whose navigation anchor lives in a Shadow DOM
  // (yt-lockup-view-model) — closest()/querySelector() cannot reach it, so the
  // native WKWebView link tap fires and navigates instead of revealing.
  // This interceptor works purely on geometry at the document capture phase, which
  // runs BEFORE any shadow-DOM target handler or native link activation. It only
  // acts when a tap lands on a VISIBLE .mw-reveal-btn, so it is a no-op for every
  // other tap and cannot regress scrolling, Shorts, or normal navigation.
  function ensureRevealTapInterceptor() {
    if (window.__MW_REVEAL_TAP_INTERCEPTOR__) return;
    window.__MW_REVEAL_TAP_INTERCEPTOR__ = true;
    var pendingBtn = null;
    var startX = 0;
    var startY = 0;
    var lastFireAt = 0;

    var findRevealBtnAtPoint = function(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      var btns = document.querySelectorAll('.mw-reveal-btn');
      for (var i = 0; i < btns.length; i += 1) {
        var b = btns[i];
        if (!b || b.nodeType !== 1 || !b.isConnected) continue;
        var overlay = (typeof b.closest === 'function') ? b.closest('.mw-reveal-overlay') : null;
        if (!overlay || !overlay.isConnected) continue;
        var overlayStyle = null;
        try { overlayStyle = window.getComputedStyle(overlay); } catch (e) {}
        if (
          overlayStyle &&
          (
            overlayStyle.display === 'none' ||
            overlayStyle.visibility === 'hidden' ||
            Number(overlayStyle.opacity) === 0
          )
        ) continue;
        var anchor = overlay.__mwAnchorTarget || null;
        if (anchor && anchor.nodeType === 1 && String((anchor.dataset && anchor.dataset.mwModerated) || '') !== 'blurred') {
          continue;
        }
        var st = null;
        try { st = window.getComputedStyle(b); } catch (e) {}
        if (st && (st.display === 'none' || st.visibility === 'hidden' || st.pointerEvents === 'none' || Number(st.opacity) === 0)) continue;
        var r = null;
        try { r = b.getBoundingClientRect(); } catch (e) { continue; }
        if (!r || r.width < 1 || r.height < 1) continue;
        var pad = 6; // fat-finger tolerance
        if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) {
          return b;
        }
      }
      return null;
    };

    var fireReveal = function(btn, phase) {
      if (!btn) return;
      lastFireAt = Date.now();
      window.__MW_REVEAL_SYNTHETIC__ = true;
      try {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: true, view: window }));
      } catch (e) {
        try { btn.click(); } catch (e2) {}
      }
      window.__MW_REVEAL_SYNTHETIC__ = false;
      console.log('[DIAG][HOME_FEED_REVEAL] interceptor_fired', 'phase=' + String(phase || 'unknown'));
    };

    var onTouchStart = function(e) {
      var t = e && e.touches && e.touches[0];
      if (!t) { pendingBtn = null; return; }
      var btn = findRevealBtnAtPoint(t.clientX, t.clientY);
      if (!btn) { pendingBtn = null; return; }
      pendingBtn = btn;
      startX = t.clientX;
      startY = t.clientY;
      // Suppress the native anchor tap at the earliest possible point.
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    var onTouchEnd = function(e) {
      if (!pendingBtn) return;
      var btn = pendingBtn;
      pendingBtn = null;
      var t = e && e.changedTouches && e.changedTouches[0];
      if (t) {
        if (Math.abs(t.clientX - startX) > 14 || Math.abs(t.clientY - startY) > 14) return; // moved → scroll
        if (!findRevealBtnAtPoint(t.clientX, t.clientY)) return; // released off the button
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      fireReveal(btn, 'touchend');
    };

    var onClick = function(e) {
      if (window.__MW_REVEAL_SYNTHETIC__) return; // our own dispatch → let it reach the button
      var btn = findRevealBtnAtPoint(e.clientX, e.clientY);
      if (!btn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (Date.now() - lastFireAt < 400) return; // debounce same-gesture native click
      fireReveal(btn, 'click');
    };

    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    document.addEventListener('click', onClick, { capture: true });
    window.__MW_REVEAL_TAP_HANDLERS__ = { touchstart: onTouchStart, touchend: onTouchEnd, click: onClick };
    console.log('[DIAG][HOME_FEED_REVEAL] interceptor_installed');
  }

  function ensureRevealPortal() {
    let portal = document.getElementById(REVEAL_PORTAL_ID);
    if (portal) return portal;
    portal = document.createElement('div');
    portal.id = REVEAL_PORTAL_ID;
    portal.style.cssText = [
      'position: fixed',
      'inset: 0',
      'z-index: 2147483647',
      'pointer-events: none',
      'overflow: hidden',
      'filter: none',
      '-webkit-filter: none',
      'backdrop-filter: none',
      '-webkit-backdrop-filter: none',
    ].join(';');
    (document.documentElement || document.body || document.documentElement).appendChild(portal);
    console.log('[DIAG][REVEAL_UI] portal_created');
    return portal;
  }

  function setRevealOverlayAnchorTarget(overlay, element, reason) {
    if (!overlay || overlay.nodeType !== 1) return;
    const nextTarget = (element && element.nodeType === 1) ? element : null;
    const previousTarget = (overlay.__mwAnchorTarget && overlay.__mwAnchorTarget.nodeType === 1)
      ? overlay.__mwAnchorTarget
      : null;
    overlay.__mwAnchorTarget = nextTarget;
    if (nextTarget) {
      overlay.dataset.mwNodeId = getDiagNodeId(nextTarget);
    }
    if (DIAG_YT_BLUR && previousTarget !== nextTarget) {
      console.log(
        '[DIAG][REVEAL_POS] anchor_bound',
        'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
        'reason=' + (reason || 'unknown'),
        'prevNode=' + getDiagNodeId(previousTarget),
        'nextNode=' + getDiagNodeId(nextTarget),
        'src=' + String((overlay.dataset && overlay.dataset.mwFor) || '').substring(0, 180)
      );
    }
  }

  function getRevealOverlayDebugId(overlay) {
    if (!overlay || overlay.nodeType !== 1) return 'unknown';
    return String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown');
  }

  function getRevealOverlaySrc(overlay) {
    if (!overlay || overlay.nodeType !== 1) return '';
    return String((overlay.dataset && overlay.dataset.mwFor) || '');
  }

  function isPortalRevealOverlay(overlay) {
    if (!overlay || overlay.nodeType !== 1) return false;
    const parent = overlay.parentElement;
    return !!(parent && parent.nodeType === 1 && String(parent.id || '') === REVEAL_PORTAL_ID);
  }

  function shouldUsePortalRevealOverlayForNode(node) {
    if (!node || node.nodeType !== 1) return false;
    return false;
  }

  function getPreferredNonShortsOverlayContainer(node) {
    if (!node || node.nodeType !== 1) return null;
    const card = findNonShortsReattachCardNode(node);
    let cursor = node;
    for (let i = 0; i < 10 && cursor; i += 1) {
      if (cursor === document.body || cursor === document.documentElement) break;
      const tag = String(cursor.tagName || '').toLowerCase();
      const nid = String(cursor.id || '').toLowerCase();
      if (
        nid === 'thumbnail' ||
        tag === 'ytd-thumbnail' ||
        tag === 'ytm-thumbnail' ||
        tag === 'ytd-rich-item-renderer' ||
        tag === 'ytd-video-renderer' ||
        tag === 'ytd-compact-video-renderer'
      ) {
        return cursor;
      }
      if (card && cursor === card) return cursor;
      cursor = cursor.parentElement;
    }
    return node.parentElement || null;
  }

  function resolveNonShortsRevealOverlayAnchor(overlay) {
    if (!overlay || overlay.nodeType !== 1 || !overlay.isConnected) return null;
    const overlayNodeId = String((overlay.dataset && overlay.dataset.mwNodeId) || '');
    const overlaySrc = String((overlay.dataset && overlay.dataset.mwFor) || '');
    const overlayIdentity = getRevealOverlayIdentityKey(overlaySrc);
    const searchRoots = [];
    const card = findNonShortsReattachCardNode(overlay);
    if (card && card.nodeType === 1) searchRoots.push(card);
    const parent = overlay.parentElement;
    if (parent && parent.nodeType === 1 && searchRoots.indexOf(parent) === -1) searchRoots.push(parent);
    searchRoots.push(document);

    let best = null;
    let bestScore = -1;
    for (let r = 0; r < searchRoots.length; r += 1) {
      const root = searchRoots[r];
      if (!root || typeof root.querySelectorAll !== 'function') continue;
      const candidates = root.querySelectorAll('[data-mw-moderated="blurred"]');
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        if (!candidate || candidate.nodeType !== 1 || !candidate.isConnected) continue;
        const nodeIdMatch = !!(overlayNodeId && getDiagNodeId(candidate) === overlayNodeId);
        const identityMatch = doesRevealOverlayIdentityMatch(candidate, overlayIdentity);
        if (!nodeIdMatch && !identityMatch) continue;
        if (!isAuthoritativeHardBlur(candidate)) continue;
        const container = getPreferredNonShortsOverlayContainer(candidate);
        let score = nodeIdMatch ? 100 : 10;
        if (container) {
          const ctag = String(container.tagName || '').toLowerCase();
          const cid = String(container.id || '').toLowerCase();
          if (cid === 'thumbnail' || ctag === 'ytd-thumbnail' || ctag === 'ytm-thumbnail') score += 4;
          if (ctag === 'ytd-rich-item-renderer' || ctag === 'ytd-video-renderer' || ctag === 'ytd-compact-video-renderer') score += 2;
        }
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
    }
    if (!best) return null;
    const stableContainer = getPreferredNonShortsOverlayContainer(best);
    if (stableContainer && stableContainer.nodeType === 1) {
      try {
        const pos = String(window.getComputedStyle(stableContainer).position || '');
        if (!pos || pos === 'static') {
          stableContainer.style.setProperty('position', 'relative', 'important');
        }
      } catch (e) {}
    }
    return best;
  }

  function resolveRevealOverlayAnchorTarget(overlay) {
    if (!overlay || overlay.nodeType !== 1) return null;
    const bound = (
      overlay.__mwAnchorTarget &&
      overlay.__mwAnchorTarget.nodeType === 1 &&
      overlay.__mwAnchorTarget.isConnected
    ) ? overlay.__mwAnchorTarget : null;
    if (bound) return bound;
    if (isPortalRevealOverlay(overlay)) {
      const portalMode = String((overlay.dataset && overlay.dataset.mwPortalMode) || '');
      if (portalMode === 'shorts' || (portalMode !== 'non_shorts' && isShortsModeActive())) {
        return resolveShortsRevealOverlayAnchor(overlay);
      }
      const nonShortsFallback = resolveNonShortsRevealOverlayAnchor(overlay);
      if (nonShortsFallback) {
        setRevealOverlayAnchorTarget(overlay, nonShortsFallback, 'portal_non_shorts_fallback_resolve');
        return nonShortsFallback;
      }
      return null;
    }
    if (!isPortalRevealOverlay(overlay) && !isShortsModeActive()) {
      const fallback = resolveNonShortsRevealOverlayAnchor(overlay);
      if (fallback) {
        setRevealOverlayAnchorTarget(overlay, fallback, 'non_shorts_fallback_resolve');
        return fallback;
      }
    }
    return null;
  }

  function getRevealOverlayIdentityKey(src) {
    const normalized = normalizeUrl(String(src || '')) || '';
    const itemKey = getDiagItemKey(normalized || String(src || ''));
    return {
      src: String(src || ''),
      normalizedSrc: normalized,
      itemKey: String(itemKey || 'unknown'),
    };
  }

  function getAuthoritativeIdentityForNode(node) {
    if (!node || node.nodeType !== 1) {
      return { authoritative: false, itemKey: 'unknown', hardSrc: '' };
    }
    const authoritative = isAuthoritativeHardBlur(node);
    const itemKey = String((node.dataset && node.dataset.mwHardBlurItemKey) || 'unknown');
    const hardSrc = String((node.dataset && node.dataset.mwHardBlurSrc) || '');
    return { authoritative: !!authoritative, itemKey: itemKey, hardSrc: hardSrc };
  }

  function doesRevealOverlayIdentityMatch(anchorNode, overlayIdentity) {
    if (!anchorNode || anchorNode.nodeType !== 1) return false;
    const auth = getAuthoritativeIdentityForNode(anchorNode);
    if (!auth.authoritative) return false;
    const overlayItemKey = String(overlayIdentity && overlayIdentity.itemKey ? overlayIdentity.itemKey : 'unknown');
    const overlayNormSrc = String(overlayIdentity && overlayIdentity.normalizedSrc ? overlayIdentity.normalizedSrc : '');
    if (overlayItemKey && overlayItemKey !== 'unknown' && auth.itemKey && auth.itemKey !== 'unknown') {
      return overlayItemKey === auth.itemKey;
    }
    const authHardSrc = normalizeUrl(auth.hardSrc || '') || '';
    if (overlayNormSrc && authHardSrc) return overlayNormSrc === authHardSrc;
    const anchorSrc = normalizeUrl(String((anchorNode.dataset && anchorNode.dataset.mwSrc) || '')) || '';
    if (overlayNormSrc && anchorSrc) return overlayNormSrc === anchorSrc;
    return false;
  }

  function isRevealOverlayScopeValid(overlay, anchorNode) {
    if (!overlay || overlay.nodeType !== 1 || !overlay.isConnected) return false;
    if (!anchorNode || anchorNode.nodeType !== 1 || !anchorNode.isConnected) return false;
    if (isPortalRevealOverlay(overlay)) {
      const portalMode = String((overlay.dataset && overlay.dataset.mwPortalMode) || '');
      if (portalMode === 'shorts') return true;
      if (portalMode === 'non_shorts') return true;
      return isShortsModeActive();
    }
    const card = findNonShortsReattachCardNode(anchorNode);
    if (card && card.nodeType === 1) {
      return !!card.contains(overlay);
    }
    return !!(overlay.parentElement && overlay.parentElement.contains(anchorNode));
  }

  function enforceRevealOverlayVisibilityGuard(overlay, anchorHint, phase) {
    if (!overlay || overlay.nodeType !== 1) return false;
    const overlayId = getRevealOverlayDebugId(overlay);
    const overlaySrc = getRevealOverlaySrc(overlay);
    const overlayIdentity = getRevealOverlayIdentityKey(overlaySrc);
    const portalOverlay = isPortalRevealOverlay(overlay);
    const anchor = (anchorHint && anchorHint.nodeType === 1 && anchorHint.isConnected)
      ? anchorHint
      : resolveRevealOverlayAnchorTarget(overlay);

    let rejectReason = '';
    if (!anchor) {
      rejectReason = 'no_anchor';
    } else {
      // FREEZE-OVERRIDE: Active Shorts blur often lands via flash/migrate paths that
      // stamp mwModerated=blurred without mwHardBlur. Guard used to strip the reveal
      // as not_authoritative → blur-without-reveal (device intermittent). Fail-closed:
      // if still blurred on Shorts, promote authority and keep the reveal paired.
      const portalMode = String((overlay.dataset && overlay.dataset.mwPortalMode) || '');
      const shortsPortal =
        portalOverlay &&
        (portalMode === 'shorts' || (portalMode !== 'non_shorts' && isShortsModeActive()));
      const anchorBlurred = String((anchor.dataset && anchor.dataset.mwModerated) || '') === 'blurred';
      if (shortsPortal && anchorBlurred && !isAuthoritativeHardBlur(anchor)) {
        try {
          markAuthoritativeHardBlur(anchor, overlaySrc || (anchor.dataset && anchor.dataset.mwSrc) || '');
        } catch (e) {}
      }

      const auth = getAuthoritativeIdentityForNode(anchor);
      if (!auth.authoritative) {
        // Still fail-closed for shorts portal if live blur is present.
        if (shortsPortal && anchorBlurred) {
          rejectReason = '';
        } else {
          rejectReason = 'not_authoritative_blur';
        }
      } else if (!doesRevealOverlayIdentityMatch(anchor, overlayIdentity)) {
        // On Shorts, identity can churn (poster→blob) while still the same positive.
        // Prefer keep+rebind over destroying the only reveal escape hatch.
        if (shortsPortal && anchorBlurred) {
          try {
            if (overlaySrc) overlay.dataset.mwFor = String(anchor.dataset.mwSrc || overlaySrc);
            setRevealOverlayAnchorTarget(overlay, anchor, 'shorts_identity_rebind');
          } catch (e) {}
          rejectReason = '';
        } else {
          rejectReason = 'identity_mismatch';
        }
      } else if (!isRevealOverlayScopeValid(overlay, anchor)) {
        rejectReason = 'scope_mismatch';
      } else if (portalOverlay) {
        const ctx = getShortsBlurContextForNode(anchor);
        const token = String((overlay.dataset && overlay.dataset.mwShortsOwnerToken) || '');
        if (
          (portalMode === 'shorts' || (portalMode !== 'non_shorts' && isShortsModeActive())) &&
          (!ctx || !ctx.ownerToken || !token || token !== String(ctx.ownerToken || ''))
        ) {
          // FREEZE-OVERRIDE: realign tokens instead of removing reveal (orphan blur).
          if (shortsPortal && anchorBlurred) {
            try {
              if (ctx && ctx.ownerToken) {
                overlay.dataset.mwShortsOwnerToken = String(ctx.ownerToken);
                anchor.dataset.mwShortsOwnerToken = String(ctx.ownerToken);
                anchor.dataset.mwOverlayOwnerToken = String(ctx.ownerToken);
              } else if (token) {
                // Keep overlay token; force context to match when possible.
                setShortsBlurContextForNode(
                  anchor,
                  overlaySrc || (anchor.dataset && anchor.dataset.mwSrc) || '',
                  (anchor.dataset && anchor.dataset.mwCategory) || 'flagged',
                  (anchor.dataset && anchor.dataset.mwItemId) || '',
                  null,
                  (anchor.dataset && anchor.dataset.mwShortsStableSelector) || null,
                  'visibility_guard_token_realign'
                );
              }
            } catch (e) {}
            rejectReason = '';
            console.log(
              '[DIAG][REVEAL_UI] shorts_owner_realign',
              'overlayId=' + overlayId,
              'phase=' + String(phase || 'unknown')
            );
          } else {
            rejectReason = 'shorts_owner_mismatch';
          }
        }
      }
    }

    if (!rejectReason) {
      console.log(
        '[DIAG][REVEAL_UI] visibility_guard_allow',
        'overlayId=' + overlayId,
        'phase=' + String(phase || 'unknown'),
        'portal=' + String(!!portalOverlay),
        'itemKey=' + String(overlayIdentity.itemKey || 'unknown')
      );
      return true;
    }

    // Recovery: for non-portal (card) overlays, attempt to survive DOM recycling
    // before falling through to DOM removal.
    if (!portalOverlay && anchor) {
      if (rejectReason === 'identity_mismatch') {
        const rAuth = getAuthoritativeIdentityForNode(anchor);
        if (rAuth.authoritative && rAuth.hardSrc && rAuth.itemKey && rAuth.itemKey !== 'unknown') {
          try {
            overlay.dataset.mwFor = rAuth.hardSrc;
            setRevealOverlayAnchorTarget(overlay, anchor, 'identity_readopt');
          } catch (e) {}
          if (!isRevealOverlayScopeValid(overlay, anchor)) {
            const rParent = resolveNonShortsRevealOverlayParent(anchor) || anchor.parentElement;
            if (rParent && rParent.nodeType === 1) {
              try { rParent.appendChild(overlay); } catch (e) {}
            }
          }
          if (isRevealOverlayScopeValid(overlay, anchor)) {
            positionNonShortsRevealOverlay(overlay, anchor, 'identity_readopt');
            try { overlay.style.display = ''; overlay.style.pointerEvents = ''; } catch (e) {}
            if (DIAG_YT_BLUR) {
              console.log(
                '[DIAG][REVEAL_UI] identity_readopted',
                'overlayId=' + overlayId,
                'newKey=' + rAuth.itemKey,
                'phase=' + String(phase || 'unknown')
              );
            }
            return true;
          }
        }
      } else if (rejectReason === 'scope_mismatch') {
        const rAuth = getAuthoritativeIdentityForNode(anchor);
        if (rAuth.authoritative) {
          const rParent = resolveNonShortsRevealOverlayParent(anchor) || anchor.parentElement;
          if (rParent && rParent.nodeType === 1) {
            try { rParent.appendChild(overlay); } catch (e) {}
            if (isRevealOverlayScopeValid(overlay, anchor)) {
              positionNonShortsRevealOverlay(overlay, anchor, 'scope_reparent');
              try { overlay.style.display = ''; overlay.style.pointerEvents = ''; } catch (e) {}
              if (DIAG_YT_BLUR) {
                console.log(
                  '[DIAG][REVEAL_UI] scope_reparented',
                  'overlayId=' + overlayId,
                  'phase=' + String(phase || 'unknown')
                );
              }
              return true;
            }
          }
        }
      }
    }

    console.log(
      '[DIAG][REVEAL_UI] visibility_guard_reject',
      'overlayId=' + overlayId,
      'phase=' + String(phase || 'unknown'),
      'portal=' + String(!!portalOverlay),
      'reason=' + rejectReason,
      'src=' + String(overlaySrc || '').substring(0, 160)
    );

    try {
      overlay.style.display = 'none';
      overlay.style.pointerEvents = 'none';
    } catch (e) {}
    try {
      if (anchor && anchor.nodeType === 1 && anchor.isConnected) {
        const overlayNodeId = String((overlay.dataset && overlay.dataset.mwNodeId) || '');
        if (overlayNodeId && overlayNodeId === getDiagNodeId(anchor)) {
          anchor.dataset.mwHasOverlay = 'false';
          anchor.dataset.mwOverlayOwnerToken = '';
        }
      }
    } catch (e) {}

    if (portalOverlay) {
      if (overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
      }
      console.log(
        '[DIAG][REVEAL_UI] portal_overlay_removed',
        'overlayId=' + overlayId,
        'reason=' + rejectReason
      );
      return false;
    }

    if (overlay.parentElement) {
      overlay.parentElement.removeChild(overlay);
    }
    console.log(
      '[DIAG][REVEAL_UI] card_overlay_hidden',
      'overlayId=' + overlayId,
      'reason=' + rejectReason
    );
    return false;
  }

  function enforceRevealOverlayVisibilityGuardGlobal(reason) {
    const now = Date.now();
    const lastAt = Number(timerState.revealVisibilityGuardAt || 0);
    if (Number.isFinite(lastAt) && now - lastAt < 120) return;
    timerState.revealVisibilityGuardAt = now;
    const overlays = document.querySelectorAll('.mw-reveal-overlay');
    for (let i = 0; i < overlays.length; i += 1) {
      const overlay = overlays[i];
      if (!overlay || overlay.nodeType !== 1 || !overlay.isConnected) continue;
      enforceRevealOverlayVisibilityGuard(overlay, null, 'global:' + String(reason || 'unknown'));
    }
  }

  function resolveShortsRevealOverlayAnchor(overlay) {
    if (!overlay || overlay.nodeType !== 1) return null;
    const src = String((overlay.dataset && overlay.dataset.mwFor) || '');
    const normalizedSrc = normalizeUrl(src || '');
    if (src && isSafeResolvedActive(src)) {
      if (DIAG_YT_BLUR) {
        console.log(
          '[MW-MVP-SHORTS-REVEAL-ANCHOR] reject_safe_resolved',
          'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
          'src=' + String(src || '').substring(0, 180)
        );
      }
      return null;
    }
    const boundAnchor = (
      overlay.__mwAnchorTarget &&
      overlay.__mwAnchorTarget.nodeType === 1 &&
      overlay.__mwAnchorTarget.isConnected
    ) ? overlay.__mwAnchorTarget : null;
    if (boundAnchor) {
      const boundLooksBlurred = isAuthoritativeHardBlur(boundAnchor);
      const boundMatchesSrc = !!(
        (src && boundAnchor.dataset && boundAnchor.dataset.mwSrc === src) ||
        (normalizedSrc && doesShortsContainerMatchSrc(boundAnchor, normalizedSrc))
      );
      if (boundLooksBlurred && boundMatchesSrc) return boundAnchor;
      if (DIAG_YT_BLUR) {
        console.log(
          '[MW-MVP-SHORTS-REVEAL-ANCHOR] reject_bound_anchor',
          'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
          'src=' + String(src || '').substring(0, 180),
          'boundNode=' + getDiagNodeId(boundAnchor),
          'boundBlurred=' + String(!!boundLooksBlurred),
          'boundMatchesSrc=' + String(!!boundMatchesSrc)
        );
      }
      return null;
    }

    const activeContainer = getActiveShortsPlayerContainer();
    if (activeContainer && activeContainer.isConnected && doesShortsContainerMatchSrc(activeContainer, normalizedSrc)) {
      const activeContext = getShortsBlurContextForNode(activeContainer);
      const activeContextSrc = normalizeUrl(String(activeContext && activeContext.src ? activeContext.src : '')) || '';
      const overlayContextSrc = normalizeUrl(src || '') || '';
      const contextMatches = !!(activeContext && activeContextSrc && overlayContextSrc && activeContextSrc === overlayContextSrc);
      if (contextMatches) return activeContainer;
      if (DIAG_YT_BLUR) {
        console.log(
          '[MW-MVP-SHORTS-REVEAL-ANCHOR] reject_active_container_context_mismatch',
          'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
          'src=' + String(src || '').substring(0, 180),
          'activeNode=' + getDiagNodeId(activeContainer),
          'hasContext=' + String(!!activeContext),
          'contextMatches=' + String(!!contextMatches)
        );
      }
    }

    const blurredNodes = document.querySelectorAll('[data-mw-moderated="blurred"][data-mw-src]');
    for (let i = 0; i < blurredNodes.length; i += 1) {
      const candidate = blurredNodes[i];
      if (!candidate || candidate.nodeType !== 1 || !candidate.isConnected) continue;
      if (candidate.dataset && candidate.dataset.mwSrc === src) return candidate;
    }

    return null;
  }

  function getVisibleViewportRect(rect, viewportWidth, viewportHeight) {
    const clippedLeft = Math.max(0, Math.min(viewportWidth, Number(rect.left) || 0));
    const clippedTop = Math.max(0, Math.min(viewportHeight, Number(rect.top) || 0));
    const clippedRight = Math.max(0, Math.min(viewportWidth, Number(rect.right) || 0));
    const clippedBottom = Math.max(0, Math.min(viewportHeight, Number(rect.bottom) || 0));
    const visibleWidth = Math.max(0, clippedRight - clippedLeft);
    const visibleHeight = Math.max(0, clippedBottom - clippedTop);
    return {
      left: clippedLeft,
      top: clippedTop,
      right: clippedRight,
      bottom: clippedBottom,
      width: visibleWidth,
      height: visibleHeight,
    };
  }

  function positionShortsRevealOverlay(overlay, element, reason) {
    if (!overlay) return false;
    if (!element || !element.isConnected || typeof element.getBoundingClientRect !== 'function') {
      overlay.style.display = 'none';
      setRevealOverlayAnchorTarget(overlay, null, 'position_invalid_anchor');
      scheduleShortsRevealOverlayRetry(overlay, 'missing_or_disconnected_anchor');
      if (DIAG_YT_BLUR) {
        console.log(
          '[DIAG][REVEAL_POS] hidden',
          'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
          'reason=' + (reason || 'unknown'),
          'hideReason=missing_or_disconnected_anchor'
        );
      }
      return false;
    }
    let rect = null;
    try {
      rect = element.getBoundingClientRect();
    } catch (e) {
      rect = null;
    }
    if (!rect) {
      overlay.style.display = 'none';
      return false;
    }
    const badge = overlay.querySelector('span');
    const btn = overlay.querySelector('.mw-reveal-btn');
    const viewportWidth = Math.max(window.innerWidth || 0, 1);
    const viewportHeight = Math.max(window.innerHeight || 0, 1);
    const visibleRect = getVisibleViewportRect(rect, viewportWidth, viewportHeight);
    // FREEZE-OVERRIDE: during swipe, rect can be <16px briefly. Hiding the button
    // made blur look reveal-less. Fall back to viewport center so a tap path always
    // exists, then keep retrying for correct placement.
    let placeRect = visibleRect;
    let usedViewportFallback = false;
    if (visibleRect.width < 16 || visibleRect.height < 16) {
      usedViewportFallback = true;
      placeRect = {
        left: 0,
        top: 0,
        width: viewportWidth,
        height: viewportHeight,
        right: viewportWidth,
        bottom: viewportHeight,
      };
      scheduleShortsRevealOverlayRetry(overlay, 'anchor_not_visible_fallback_center');
      if (DIAG_YT_BLUR) {
        console.log(
          '[DIAG][REVEAL_POS] viewport_fallback',
          'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
          'reason=' + (reason || 'unknown'),
          'anchorRect=' + Math.round(rect.left) + ',' + Math.round(rect.top) + ',' + Math.round(rect.width) + 'x' + Math.round(rect.height)
        );
      }
    }
    overlay.style.display = 'flex';
    if (!usedViewportFallback) overlay.dataset.mwPosRetryCount = '0';
    const centerX = Math.max(24, Math.min(viewportWidth - 24, Math.round(placeRect.left + (placeRect.width / 2))));
    const centerY = Math.max(28, Math.min(viewportHeight - 28, Math.round(placeRect.top + (placeRect.height / 2))));
    if (badge && badge.nodeType === 1) {
      badge.style.position = 'absolute';
      badge.style.left = Math.max(8, Math.min(viewportWidth - 100, Math.round(placeRect.left + 8))) + 'px';
      badge.style.top = Math.max(8, Math.min(viewportHeight - 28, Math.round(placeRect.top + 8))) + 'px';
    }
    if (btn && btn.nodeType === 1) {
      btn.style.position = 'absolute';
      btn.style.left = centerX + 'px';
      btn.style.top = centerY + 'px';
      btn.style.transform = 'translate(-50%, -50%)';
      btn.style.pointerEvents = 'auto';
      btn.style.zIndex = '2147483647';
    }
    const portalMode = String((overlay.dataset && overlay.dataset.mwPortalMode) || '');
    if (DIAG_YT_BLUR) {
      console.log(
        '[DIAG][REVEAL_POS] placed',
        'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
        'portal_mode=' + (portalMode || (isShortsModeActive() ? 'shorts' : 'unknown')),
        'reason=' + (reason || 'unknown'),
        'anchorNode=' + getDiagNodeId(element),
        'anchorRect=' + Math.round(rect.left) + ',' + Math.round(rect.top) + ',' + Math.round(rect.width) + 'x' + Math.round(rect.height),
        'visibleRect=' + Math.round(visibleRect.left) + ',' + Math.round(visibleRect.top) + ',' + Math.round(visibleRect.width) + 'x' + Math.round(visibleRect.height),
        'button=' + centerX + ',' + centerY
      );
    }
    return true;
  }

  function repositionAllShortsRevealOverlays(reason) {
    if (!isShortsModeActive()) return;
    const portal = document.getElementById(REVEAL_PORTAL_ID);
    if (!portal || typeof portal.querySelectorAll !== 'function') return;
    const overlays = portal.querySelectorAll('.mw-reveal-overlay');
    for (let i = 0; i < overlays.length; i += 1) {
      const overlay = overlays[i];
      if (!overlay || !overlay.isConnected) continue;
      const overlaySrc = String((overlay.dataset && overlay.dataset.mwFor) || '');
      const anchor = resolveShortsRevealOverlayAnchor(overlay);
      if (!anchor) {
        const safeResolved = !!(overlaySrc && isSafeResolvedActive(overlaySrc));
        let hasLiveBlurForSrc = false;
        if (!safeResolved && overlaySrc) {
          const blurredNodes = document.querySelectorAll('[data-mw-moderated="blurred"][data-mw-src]');
          for (let j = 0; j < blurredNodes.length; j += 1) {
            const candidate = blurredNodes[j];
            if (!candidate || candidate.nodeType !== 1 || !candidate.isConnected) continue;
            if (candidate.dataset && candidate.dataset.mwSrc === overlaySrc) {
              hasLiveBlurForSrc = true;
              break;
            }
          }
        }
        if (safeResolved || !hasLiveBlurForSrc) {
          const overlayId = String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown');
          if (overlay.parentElement) {
            overlay.parentElement.removeChild(overlay);
          }
          console.log(
            '[DIAG][REVEAL_UI] portal_orphan_removed',
            'reason=' + (safeResolved ? 'safe_resolved' : 'no_live_blur'),
            'overlayId=' + overlayId,
            'src=' + String(overlaySrc || '').substring(0, 180)
          );
          continue;
        }
        overlay.style.display = 'none';
        scheduleShortsRevealOverlayRetry(overlay, 'anchor_resolve_failed');
        continue;
      }
      if (!enforceRevealOverlayVisibilityGuard(overlay, anchor, 'shorts_reposition:' + String(reason || 'unknown'))) {
        continue;
      }
      setRevealOverlayAnchorTarget(overlay, anchor, 'reposition:' + (reason || 'unknown'));
      positionShortsRevealOverlay(overlay, anchor, reason || 'reposition');
    }
  }

  function scheduleShortsRevealOverlayReposition(reason) {
    if (timerState.paused || timerState.teardownDone) return;
    if (!isShortsModeActive()) return;
    timerState.revealOverlayLastReason = reason || 'unknown';
    if (timerState.revealOverlayRepositionRaf) return;
    if (typeof window.requestAnimationFrame !== 'function') {
      repositionAllShortsRevealOverlays(timerState.revealOverlayLastReason || 'sync');
      return;
    }
    timerState.revealOverlayRepositionRaf = window.requestAnimationFrame(function() {
      timerState.revealOverlayRepositionRaf = null;
      const runReason = timerState.revealOverlayLastReason || 'raf';
      timerState.revealOverlayLastReason = '';
      repositionAllShortsRevealOverlays(runReason);
    });
  }

  function scheduleShortsRevealOverlayRetry(overlay, reason) {
    if (!overlay || overlay.nodeType !== 1) return;
    if (timerState.paused || timerState.teardownDone) return;
    if (!isShortsModeActive()) return;
    const retryCountRaw = Number(overlay.dataset.mwPosRetryCount || '0');
    const retryCount = Number.isFinite(retryCountRaw) ? retryCountRaw : 0;
    if (retryCount >= 40) return;
    overlay.dataset.mwPosRetryCount = String(retryCount + 1);
    // Per-overlay timer: a single global timeout dropped retries during swipe churn.
    if (overlay.__mwPosRetryTimer) return;
    overlay.__mwPosRetryTimer = setTimeout(function() {
      overlay.__mwPosRetryTimer = null;
      scheduleShortsRevealOverlayReposition('retry:' + (reason || 'unknown'));
    }, 100);
  }

  function cancelShortsRevealOverlayReposition(reason) {
    if (timerState.revealOverlayRepositionRaf && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(timerState.revealOverlayRepositionRaf);
    }
    if (timerState.nonShortsRevealOverlayRepositionRaf && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(timerState.nonShortsRevealOverlayRepositionRaf);
    }
    timerState.revealOverlayRepositionRaf = null;
    timerState.nonShortsRevealOverlayRepositionRaf = null;
    timerState.revealOverlayLastReason = '';
    timerState.nonShortsRevealOverlayLastReason = '';
    clearNamedTimeout('revealOverlayRetryTimeout', reason || 'cancel');
    if (DIAG_YT_BLUR) {
      console.log(
        '[DIAG][REVEAL_POS] cancel',
        'reason=' + (reason || 'unknown')
      );
    }
  }

  function ensureRevealOverlayPositionListeners() {
    if (timerState.revealOverlayScrollHandler && timerState.revealOverlayResizeHandler) return;
    timerState.revealOverlayScrollHandler = function() {
      ensureRevealPortal();
      if (isShortsModeActive()) {
        scheduleShortsRevealOverlayReposition('window_scroll');
      } else {
        scheduleNonShortsRevealOverlayReposition('window_scroll');
      }
    };
    timerState.revealOverlayResizeHandler = function() {
      ensureRevealPortal();
      if (isShortsModeActive()) {
        scheduleShortsRevealOverlayReposition('window_resize');
      } else {
        scheduleNonShortsRevealOverlayReposition('window_resize');
      }
    };
    window.addEventListener('scroll', timerState.revealOverlayScrollHandler, { passive: true });
    window.addEventListener('resize', timerState.revealOverlayResizeHandler, { passive: true });
    window.addEventListener('orientationchange', timerState.revealOverlayResizeHandler);
  }

  function diagShortsRecycleLog(node, field, prevSrc, nextSrc) {
    if (!isShortsModeActive()) return;
    if (!node || node.nodeType !== 1) return;
    const prev = String(prevSrc || '');
    const next = String(nextSrc || '');
    if (!prev || !next || prev === next) return;
    console.log(
      '[DIAG][SHORTS_RECYCLE]',
      'node=' + getDiagNodeId(node),
      'field=' + (field || 'src'),
      'prevSrc=' + prev.substring(0, 180),
      'nextSrc=' + next.substring(0, 180),
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch
    );
  }

  function hasParentChangedSinceBlur(node) {
    const baseline = diagNodeParentAtBlur.get(node);
    if (!baseline) return false;
    return baseline.parent !== (node.parentElement || null);
  }

  function diagNodeLifecycleLog(action, node, extra) {
    if (!DIAG_YT_BLUR) return;
    if (!node || node.nodeType !== 1) return;
    const source = getDiagSourceFields(node);
    console.log(
      '[MW-YT][DIAG][NODE]',
      'action=' + action,
      'nodeId=' + getDiagNodeId(node),
      'tag=' + (node.tagName || 'unknown'),
      'rect=' + getDiagRect(node),
      'currentSrc=' + String(source.currentSrc || '').substring(0, 160),
      'poster=' + String(source.poster || '').substring(0, 160),
      'connected=' + (!!node.isConnected),
      'parentChanged=' + hasParentChangedSinceBlur(node),
      extra || ''
    );
  }

  function diagScanRunLog(fnName, element, src, queued, extra) {
    if (!DIAG_YT_BLUR) return;
    if (!element || element.nodeType !== 1) return;
    const normalizedSrc = normalizeUrl(src || '');
    console.log(
      '[MW-YT][DIAG][SCAN]',
      'fn=' + fnName,
      'nodeId=' + getDiagNodeId(element),
      'tag=' + (element.tagName || 'unknown'),
      'hint=' + describeElementHint(element),
      'connected=' + (!!element.isConnected),
      'queued=' + (queued === true),
      'scanned=' + (normalizedSrc ? state.scanned.has(normalizedSrc) : false),
      'src=' + String(src || '').substring(0, 160),
      extra || ''
    );
  }

  function diagSoftBlurLog(action, element, src, extra) {
    if (!DIAG_YT_BLUR) return;
    if (!element || element.nodeType !== 1) return;
    console.log(
      '[MW-YT][DIAG][SOFTBLUR]',
      'action=' + action,
      'nodeId=' + getDiagNodeId(element),
      'tag=' + (element.tagName || 'unknown'),
      'hint=' + describeElementHint(element),
      'connected=' + (!!element.isConnected),
      'src=' + String(src || '').substring(0, 160),
      extra || ''
    );
  }

  function findRevealOverlayForElement(node, src) {
    if (!node || node.nodeType !== 1) return null;
    const nodeId = getDiagNodeId(node);
    const shortsMode = isShortsModeActive();
    const portal = document.getElementById(REVEAL_PORTAL_ID);
    if (portal && typeof portal.querySelectorAll === 'function') {
      const overlays = portal.querySelectorAll('.mw-reveal-overlay');
      for (let i = 0; i < overlays.length; i += 1) {
        const overlay = overlays[i];
        if (!overlay || !overlay.isConnected) continue;
        const portalMode = String((overlay.dataset && overlay.dataset.mwPortalMode) || '');
        if (overlay.dataset.mwNodeId === nodeId) return overlay;
        if (src && overlay.dataset.mwFor === src && (shortsMode || portalMode === 'shorts')) return overlay;
      }
    }
    const parents = [];
    if (node.parentElement) {
      parents.push(node.parentElement);
    }
    const baseline = diagNodeParentAtBlur.get(node);
    if (baseline && baseline.parent && baseline.parent.nodeType === 1 && parents.indexOf(baseline.parent) === -1) {
      parents.push(baseline.parent);
    }
    for (let p = 0; p < parents.length; p += 1) {
      const parent = parents[p];
      if (!parent || typeof parent.querySelectorAll !== 'function') continue;
      const overlays = parent.querySelectorAll('.mw-reveal-overlay');
      for (let i = 0; i < overlays.length; i += 1) {
        const overlay = overlays[i];
        if (!overlay || !overlay.isConnected) continue;
        if (overlay.dataset.mwNodeId === nodeId) return overlay;
        if (!shortsMode && src && overlay.dataset.mwFor === src && isAuthoritativeHardBlur(node)) return overlay;
      }
    }
    // Card-level fallback: catches overlays re-parented to a higher ancestor during guard
    // recovery so we don't create a duplicate instead of finding the existing one.
    if (!shortsMode) {
      const cardFallback = findNonShortsReattachCardNode(node);
      if (cardFallback && typeof cardFallback.querySelectorAll === 'function') {
        const cardOverlays = cardFallback.querySelectorAll('.mw-reveal-overlay');
        for (let i = 0; i < cardOverlays.length; i += 1) {
          const overlay = cardOverlays[i];
          if (!overlay || !overlay.isConnected) continue;
          if (overlay.dataset.mwNodeId === nodeId) return overlay;
          if (src && overlay.dataset.mwFor === src && isAuthoritativeHardBlur(node)) return overlay;
        }
      }
    }
    return null;
  }

  function resolveNonShortsRevealOverlayParent(node) {
    if (!node || node.nodeType !== 1) return null;
    const immediateParent = node.parentElement;
    if (!immediateParent) return null;

    // Prefer the tightest thumbnail-media container first so overlay centering remains
    // anchored to the visual image box even when card wrappers mutate on scroll/hover.
    const card = findNonShortsReattachCardNode(node);
    const pickTightestContainer = function(startNode) {
      const candidates = [];
      let cursor = startNode;
      for (let depth = 0; depth < 9 && cursor; depth += 1) {
        if (cursor === document.body || cursor === document.documentElement) break;
        const tag = String(cursor.tagName || '').toLowerCase();
        const nodeId = String(cursor.id || '').toLowerCase();
        const looksLikeThumb =
          nodeId === 'thumbnail' ||
          tag === 'ytd-thumbnail' ||
          tag === 'ytm-thumbnail' ||
          tag === 'yt-image' ||
          tag === 'yt-img-shadow';
        if (looksLikeThumb && cursor.isConnected) {
          try {
            const rect = cursor.getBoundingClientRect();
            const width = Number(rect && rect.width) || 0;
            const height = Number(rect && rect.height) || 0;
            if (width >= 32 && height >= 32) {
              candidates.push({ node: cursor, area: width * height });
            }
          } catch (e) {}
        }
        if (card && cursor === card) break;
        cursor = cursor.parentElement;
      }
      if (!candidates.length) return null;
      candidates.sort(function(a, b) { return a.area - b.area; });
      return candidates[0].node || null;
    };
    const tightest = pickTightestContainer(node);
    if (tightest) return tightest;

    let thumbCursor = immediateParent;
    for (let i = 0; i < 8 && thumbCursor; i += 1) {
      if (thumbCursor === document.body || thumbCursor === document.documentElement) break;
      if (card && thumbCursor === card) break;
      const tag = String(thumbCursor.tagName || '').toLowerCase();
      const nid = String(thumbCursor.id || '').toLowerCase();
      if (
        nid === 'thumbnail' ||
        tag === 'ytm-thumbnail' ||
        tag === 'yt-image' ||
        tag === 'yt-img-shadow'
      ) {
        if (thumbCursor.isConnected) return thumbCursor;
        break;
      }
      thumbCursor = thumbCursor.parentElement;
    }

    const looksLikeStableContainer = function(candidate) {
      if (!candidate || candidate.nodeType !== 1 || !candidate.isConnected) return false;
      let display = '';
      try {
        display = String(window.getComputedStyle(candidate).display || '');
      } catch (e) {
        display = '';
      }
      if (display === 'contents') return false;
      try {
        if (typeof candidate.getBoundingClientRect !== 'function') return false;
        const rect = candidate.getBoundingClientRect();
        const width = Number(rect && rect.width) || 0;
        const height = Number(rect && rect.height) || 0;
        return width >= 32 && height >= 32;
      } catch (e) {
        return false;
      }
    };

    if (looksLikeStableContainer(immediateParent)) return immediateParent;
    let cursor = immediateParent.parentElement;
    for (let i = 0; i < 8 && cursor; i += 1) {
      if (cursor === document.body || cursor === document.documentElement) break;
      if (looksLikeStableContainer(cursor)) return cursor;
      cursor = cursor.parentElement;
    }
    return immediateParent;
  }

  function positionNonShortsRevealOverlay(overlay, anchor, reason) {
    if (!overlay || overlay.nodeType !== 1 || !overlay.isConnected) return false;
    if (isPortalRevealOverlay(overlay)) return false;
    const target = (
      anchor &&
      anchor.nodeType === 1 &&
      anchor.isConnected &&
      typeof anchor.getBoundingClientRect === 'function'
    ) ? anchor : resolveRevealOverlayAnchorTarget(overlay);
    if (!target || !target.isConnected || typeof target.getBoundingClientRect !== 'function') return false;
    const parent = overlay.parentElement;
    if (!parent || !parent.isConnected || typeof parent.getBoundingClientRect !== 'function') return false;
    let parentRect = null;
    let anchorRect = null;
    try {
      parentRect = parent.getBoundingClientRect();
      anchorRect = target.getBoundingClientRect();
    } catch (e) {
      return false;
    }
    if (!parentRect || !anchorRect) return false;
    const width = Math.max(0, Number(anchorRect.width) || 0);
    const height = Math.max(0, Number(anchorRect.height) || 0);
    if (width < 16 || height < 16) return false;
    const left = Math.round((Number(anchorRect.left) || 0) - (Number(parentRect.left) || 0));
    const top = Math.round((Number(anchorRect.top) || 0) - (Number(parentRect.top) || 0));
    overlay.style.position = 'absolute';
    overlay.style.inset = 'auto';
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
    overlay.style.width = Math.round(width) + 'px';
    overlay.style.height = Math.round(height) + 'px';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.pointerEvents = 'none';
    const button = overlay.querySelector('.mw-reveal-btn');
    if (button && button.nodeType === 1) {
      button.style.position = 'relative';
      button.style.left = 'auto';
      button.style.top = 'auto';
      button.style.transform = 'none';
      button.style.margin = 'auto';
      button.style.pointerEvents = 'auto';
    }
    console.log(
      '[MW-REVEAL-POSITION] non_shorts_center',
      'overlayId=' + getRevealOverlayDebugId(overlay),
      'reason=' + String(reason || 'unknown'),
      'anchor=' + getDiagNodeId(target),
      'parent=' + getDiagNodeId(parent),
      'rect=' + Math.round(width) + 'x' + Math.round(height) + '@' + left + ',' + top
    );
    return true;
  }

  function repositionAllNonShortsRevealOverlays(reason) {
    if (isShortsModeActive()) return;
    const overlays = document.querySelectorAll('.mw-reveal-overlay');
    for (let i = 0; i < overlays.length; i += 1) {
      const overlay = overlays[i];
      if (!overlay || overlay.nodeType !== 1 || !overlay.isConnected) continue;
      const portalMode = String((overlay.dataset && overlay.dataset.mwPortalMode) || '');
      if (portalMode === 'shorts') continue;
      const anchor = resolveRevealOverlayAnchorTarget(overlay);
      if (!anchor || !anchor.isConnected) continue;
      if (!enforceRevealOverlayVisibilityGuard(overlay, anchor, 'non_shorts_reposition:' + String(reason || 'unknown'))) {
        continue;
      }
      positionNonShortsRevealOverlay(overlay, anchor, reason || 'non_shorts_reposition');
    }
  }

  function scheduleNonShortsRevealOverlayReposition(reason) {
    if (timerState.paused || timerState.teardownDone) return;
    if (isShortsModeActive()) return;
    timerState.nonShortsRevealOverlayLastReason = reason || 'unknown';
    if (timerState.nonShortsRevealOverlayRepositionRaf) return;
    if (typeof window.requestAnimationFrame !== 'function') {
      repositionAllNonShortsRevealOverlays(timerState.nonShortsRevealOverlayLastReason || 'sync');
      return;
    }
    timerState.nonShortsRevealOverlayRepositionRaf = window.requestAnimationFrame(function() {
      timerState.nonShortsRevealOverlayRepositionRaf = null;
      const runReason = timerState.nonShortsRevealOverlayLastReason || 'raf';
      timerState.nonShortsRevealOverlayLastReason = '';
      repositionAllNonShortsRevealOverlays(runReason);
      if (typeof window.requestAnimationFrame === 'function' && !timerState.paused && !timerState.teardownDone && !isShortsModeActive()) {
        window.requestAnimationFrame(function() {
          window.requestAnimationFrame(function() {
            if (timerState.paused || timerState.teardownDone || isShortsModeActive()) return;
            repositionAllNonShortsRevealOverlays(runReason + ':followup2');
          });
        });
      }
    });
  }

  function getDiagOverlayState(node) {
    if (!node || node.nodeType !== 1) {
      return { hasOverlayFlag: false, overlayAttached: false, overlayVisible: false };
    }
    const overlay = findRevealOverlayForElement(node, node.dataset ? node.dataset.mwSrc || '' : '');
    return {
      hasOverlayFlag: node.dataset.mwHasOverlay === 'true',
      overlayAttached: !!(overlay && overlay.isConnected),
      overlayVisible: !!(overlay && overlay.style.display !== 'none'),
    };
  }

  function removeRevealOverlay(node, src, reason) {
    if (!node || node.nodeType !== 1) return false;
    const overlay = findRevealOverlayForElement(node, src || node.dataset.mwSrc || '');
    if (overlay && overlay.parentElement) {
      const overlayId = overlay.dataset && overlay.dataset.mwOverlayId ? overlay.dataset.mwOverlayId : 'unknown';
      if (overlay.__mwAnchorGuard && overlay.__mwAnchorGuard.nodeType === 1) {
        overlay.__mwAnchorGuard.style.pointerEvents = overlay.__mwAnchorGuardPE || '';
        overlay.__mwAnchorGuard = null;
      }
      overlay.parentElement.removeChild(overlay);
      console.log(
        '[DIAG][REVEAL_UI] overlay_removed',
        'overlayId=' + overlayId,
        'reason=' + (reason || 'unknown'),
        'node=' + getDiagNodeId(node)
      );
      if (DIAG_YT_BLUR) {
        console.log(
          '[MW-YT][DIAG][OVERLAY]',
          'action=remove',
          'reason=' + (reason || 'unknown'),
          'nodeId=' + getDiagNodeId(node),
          'overlayNodeId=' + (overlay.dataset.mwNodeId || 'n/a')
        );
      }
      node.dataset.mwHasOverlay = 'false';
      node.dataset.mwOverlayOwnerToken = '';
      return true;
    }
    node.dataset.mwHasOverlay = 'false';
    node.dataset.mwOverlayOwnerToken = '';
    return false;
  }

  function diagBlurStateLog(action, element, src, extra) {
    if (!DIAG_YT_BLUR) return;
    if (!element || element.nodeType !== 1) return;
    const overlayState = getDiagOverlayState(element);
    const normalizedSrc = normalizeUrl(src || element.dataset.mwSrc || '');
    console.log(
      '[MW-YT][DIAG][BLUR]',
      'action=' + action,
      'nodeId=' + getDiagNodeId(element),
      'tag=' + (element.tagName || 'unknown'),
      'src=' + String(src || '').substring(0, 160),
      'normalizedSrc=' + String(normalizedSrc || '').substring(0, 160),
      'scanned=' + (normalizedSrc ? state.scanned.has(normalizedSrc) : false),
      'moderated=' + (element.dataset.mwModerated || ''),
      'hasOverlayFlag=' + overlayState.hasOverlayFlag,
      'overlayAttached=' + overlayState.overlayAttached,
      'overlayVisible=' + overlayState.overlayVisible,
      'filter=' + String(element.style.getPropertyValue('filter') || element.style.filter || '').substring(0, 80),
      'webkit=' + String(element.style.getPropertyValue('-webkit-filter') || '').substring(0, 80),
      'backdrop=' + String(element.style.getPropertyValue('backdrop-filter') || '').substring(0, 80),
      extra || ''
    );
  }

  function diagShortsBlurStackLog(action, element, src, extra) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    if (!element || element.nodeType !== 1) return;
    let computedFilter = '';
    let computedOpacity = '';
    try {
      const computed = window.getComputedStyle(element);
      computedFilter = computed ? computed.filter || '' : '';
      computedOpacity = computed ? computed.opacity || '' : '';
    } catch (e) {}
    console.log(
      '[MW-YT][DIAG][BLUR_STACK]',
      'action=' + action,
      'nodeId=' + getDiagNodeId(element),
      'tag=' + (element.tagName || 'unknown'),
      'src=' + String(src || '').substring(0, 160),
      'computedFilter=' + String(computedFilter || '').substring(0, 120),
      'computedOpacity=' + String(computedOpacity || '').substring(0, 40),
      'inlineFilter=' + String(element.style.getPropertyValue('filter') || element.style.filter || '').substring(0, 120),
      'inlineBackdrop=' + String(element.style.getPropertyValue('backdrop-filter') || '').substring(0, 120),
      extra || ''
    );
  }

  function diagMutationScheduleLog(action, node, reason, queued) {
    if (!DIAG_YT_BLUR) return;
    if (!node || node.nodeType !== 1) return;
    const source = getDiagSourceFields(node);
    console.log(
      '[MW-YT][DIAG][MUT_SCHED]',
      'action=' + action,
      'reason=' + (reason || 'unknown'),
      'nodeId=' + getDiagNodeId(node),
      'tag=' + (node.tagName || 'unknown'),
      'queued=' + (queued === true),
      'queueSize=' + mutationScanQueue.length,
      'currentSrc=' + String(source.currentSrc || '').substring(0, 160),
      'poster=' + String(source.poster || '').substring(0, 160)
    );
  }

  function diagFailCaseLog(caseId, element, src, extra) {
    if (!DIAG_YT_BLUR) return;
    if (!element || element.nodeType !== 1) return;
    const overlayState = getDiagOverlayState(element);
    const normalizedSrc = normalizeUrl(src || element.dataset.mwSrc || '');
    console.warn(
      '[MW-YT][DIAG][CASE]',
      'case=' + caseId,
      'nodeId=' + getDiagNodeId(element),
      'tag=' + (element.tagName || 'unknown'),
      'src=' + String(src || '').substring(0, 160),
      'normalizedSrc=' + String(normalizedSrc || '').substring(0, 160),
      'scanned=' + (normalizedSrc ? state.scanned.has(normalizedSrc) : false),
      'overlayAttached=' + overlayState.overlayAttached,
      extra || ''
    );
  }

  // ==================== URL UTILITIES ====================

  function normalizeUrl(url) {
    if (!url) return null;
    let normalized = url.trim();
    if (normalized.startsWith('//')) normalized = 'https:' + normalized;
    if (!normalized.startsWith('http') && !normalized.startsWith('data:')) return null;
    return normalized;
  }

  function extractBgImageUrl(element) {
    try {
      const style = window.getComputedStyle(element);
      const bgImage = style.backgroundImage;
      if (!bgImage || bgImage === 'none') return null;
      
      const match = bgImage.match(/url\\(["']?([^"')]+)["']?\\)/);
      if (match && match[1]) {
        return normalizeUrl(match[1]);
      }
    } catch (e) {}
    return null;
  }

  // ==================== SIZE & VISIBILITY CHECK ====================

  /**
   * Get element dimensions
   */
  function getElementDimensions(element) {
    try {
      const rect = element.getBoundingClientRect();
      const width = rect.width || element.naturalWidth || element.offsetWidth || 0;
      const height = rect.height || element.naturalHeight || element.offsetHeight || 0;
      return { width, height };
    } catch (e) {
      return { width: 0, height: 0 };
    }
  }

  /**
   * Check if image is too small (fail-open for avatars/icons)
   * Images smaller than 80x80 are skipped
   */
  function isTinyImage(element) {
    const { width, height } = getElementDimensions(element);
    return width < CONFIG.minImageSize || height < CONFIG.minImageSize;
  }

  function isLikelyAvatarLike(element) {
    try {
      const haystack = [
        element.getAttribute('class') || '',
        element.getAttribute('id') || '',
        element.getAttribute('alt') || '',
        element.getAttribute('aria-label') || '',
      ].join(' ').toLowerCase();
      return /avatar|profile|pfp|logo|icon/.test(haystack);
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if element is visible in or near viewport
   */
  function isElementVisible(element) {
    try {
      const { width, height } = getElementDimensions(element);
      
      if (width < CONFIG.minImageSize || height < CONFIG.minImageSize) {
        return false;
      }
      
      const rect = element.getBoundingClientRect();
      const buffer = 300;
      return (
        rect.top < window.innerHeight + buffer &&
        rect.bottom > -buffer &&
        rect.left < window.innerWidth + buffer &&
        rect.right > -buffer
      );
    } catch (e) {
      return false;
    }
  }

  // ==================== BLUR MANAGEMENT ====================

  /**
   * Apply soft blur (semantic delay) - light blur while waiting for result
   * After CONFIG.semanticDelayMs, if no result, keep soft blur only
   */
  function clearAllBlurAndOverlay(element, src, reason, nextModeratedState) {
    if (!element || element.nodeType !== 1) return false;
    let changed = false;
    try {
      const beforeFilter = String(element.style.getPropertyValue('filter') || element.style.filter || '').toLowerCase();
      const beforeWebkit = String(element.style.getPropertyValue('-webkit-filter') || '').toLowerCase();
      const beforeBackdrop = String(element.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
      const beforeWebkitBackdrop = String(element.style.getPropertyValue('-webkit-backdrop-filter') || '').toLowerCase();
      if (
        beforeFilter.includes('blur(') ||
        beforeWebkit.includes('blur(') ||
        beforeBackdrop.includes('blur(') ||
        beforeWebkitBackdrop.includes('blur(')
      ) {
        changed = true;
      }
      if (
        element.classList.contains('mw-softblur') ||
        element.classList.contains('mw-blurred') ||
        element.dataset.mwModerated === 'blurred' ||
        element.dataset.mwModerated === 'softblur' ||
        element.dataset.mwHasOverlay === 'true'
      ) {
        changed = true;
      }
      element.style.removeProperty('filter');
      element.style.removeProperty('-webkit-filter');
      element.style.removeProperty('backdrop-filter');
      element.style.removeProperty('-webkit-backdrop-filter');
      element.style.removeProperty('opacity');
      element.classList.remove('mw-softblur');
      element.classList.remove('mw-blurred');
      const removedOverlay = removeRevealOverlay(element, src || element.dataset.mwSrc || '', reason || 'clear_all');
      if (removedOverlay) changed = true;
      element.dataset.mwHasOverlay = 'false';
      if (element.__mwDeferTimerId) { clearTimeout(element.__mwDeferTimerId); element.__mwDeferTimerId = null; }
      if (element.__mwMismatchTimerId) { clearTimeout(element.__mwMismatchTimerId); element.__mwMismatchTimerId = null; }
      if (nextModeratedState) {
        element.dataset.mwModerated = nextModeratedState;
      }
      element.dataset.mwPreblurClear = 'true';
      element.dataset.mwOverlayOwnerToken = '';
      element.dataset.mwShortsOwnerToken = '';
      clearAuthoritativeHardBlur(element);
      if (isShortsModeActive()) {
        clearShortsBlurContextForNode(element, reason || 'clear_all');
      }
    } catch (e) {}
    return changed;
  }

  function isAuthoritativeHardBlur(node) {
    if (!node || node.nodeType !== 1) return false;
    return !!(
      (node.dataset && node.dataset.mwHardBlur === '1') ||
      (node.dataset && node.dataset.mwModerated === 'blurred') ||
      (node.classList && node.classList.contains('mw-blurred'))
    );
  }

  function markAuthoritativeHardBlur(node, src) {
    if (!node || node.nodeType !== 1) return;
    try {
      node.dataset.mwHardBlur = '1';
      node.dataset.mwHardBlurItemKey = getDiagItemKey(src || (node.dataset && node.dataset.mwSrc) || '');
      node.dataset.mwHardBlurSrc = normalizeUrl(src || (node.dataset && node.dataset.mwSrc) || '') || '';
      node.dataset.mwHardBlurEpoch = String(state.pageEpoch || 0);
      node.dataset.mwHardBlurNav = String(NAV_ID || 'none');
    } catch (e) {}
  }

  function clearAuthoritativeHardBlur(node) {
    if (!node || node.nodeType !== 1) return;
    try {
      node.dataset.mwHardBlur = '0';
      node.dataset.mwHardBlurItemKey = '';
      node.dataset.mwHardBlurSrc = '';
      node.dataset.mwHardBlurEpoch = '';
      node.dataset.mwHardBlurNav = '';
    } catch (e) {}
  }

  function applySoftBlur(element, src, itemId) {
    diagBlurStateLog('applySoftBlur.enter', element, src, 'itemId=' + (itemId || 'none'));
    // Check persistence: if user revealed this, don't blur
    if (isRevealedForSource(src, element)) {
      diagSoftBlurLog('apply_skip', element, src, 'reason=revealed_set itemId=' + (itemId || 'none'));
      return;
    }
    if (element.dataset.mwModerated === 'blurred') {
      diagSoftBlurLog('apply_skip', element, src, 'reason=already_blurred itemId=' + (itemId || 'none'));
      return; // Already hard blurred
    }
    if (element.dataset.mwPreblurClear === 'true') {
      diagSoftBlurLog('apply_skip', element, src, 'reason=preblur_cleared itemId=' + (itemId || 'none'));
      return; // Already cleared due to prior safe decision
    }
    // FREEZE-OVERRIDE (MVP polish): never soft-preblur on YouTube / Shorts / exit windows.
    // Soft is reveal-less partial blur — Phase 0 failure on home after first-entry Shorts exit.
    if (shouldSkipSoftPreblur()) {
      diagSoftBlurLog(
        'apply_skip',
        element,
        src,
        'reason=soft_preblur_disabled_mvp itemId=' + (itemId || 'none')
      );
      return;
    }
    
    try {
      if (isShortsModeActive()) {
        removeRevealOverlay(element, src, 'applySoftBlur_preclear_overlay');
      }
      element.style.filter = 'blur(' + CONFIG.softBlurStrength + 'px)';
      element.style.transition = 'filter 0.2s ease';
      element.dataset.mwModerated = 'softblur';
      element.dataset.mwSrc = src;
      element.dataset.mwItemId = itemId || '';
      clearAuthoritativeHardBlur(element);
      element.classList.add('mw-softblur');
      diagSoftBlurLog(
        'apply',
        element,
        src,
        'itemId=' + (itemId || 'none') + ' state=' + (element.dataset.mwModerated || 'none')
      );
      diagBlurStateLog('applySoftBlur.applied', element, src, 'itemId=' + (itemId || 'none'));
      
      if (CONFIG.debug) {
        console.log('[MW] soft blur applied:', src.substring(0, 50));
      }
    } catch (e) {}
  }

  /**
   * Remove all blur (after safe result)
   */
  function removeSoftBlur(element, src) {
    let removed = false;
    try {
      // FREEZE-OVERRIDE: additive Flash Shield resolution before the frozen safe-clear path.
      if (CONFIG.flashShieldV1) {
        clearFlashShieldResolution(element, 'safe');
      }
      const shortsMode = isShortsModeActive();
      const srcForClear = src || element.dataset.mwSrc || '';
      if (shortsMode) {
        const stableResolution = resolveShortsStableBlurTarget(element, srcForClear);
        diagLogShortsTargetResolution('removeSoftBlur', element, srcForClear, stableResolution);
        const stableTarget = stableResolution && stableResolution.target ? stableResolution.target : null;
        if (stableTarget && stableTarget.isConnected) {
          element = stableTarget;
        }
      }
      diagBlurStateLog('removeSoftBlur.enter', element, src, '');
      const overlay = findRevealOverlayForElement(element, srcForClear);
      const overlayId = overlay && overlay.dataset ? overlay.dataset.mwOverlayId || 'none' : 'none';
      const beforeState = element.dataset.mwModerated || '';
      const beforeFilter = element.style.getPropertyValue('filter') || element.style.filter || '';
      const beforeHasBlur = beforeFilter.toLowerCase().includes('blur(');
      if (shortsMode) {
        removed = clearAllBlurAndOverlay(element, srcForClear, 'removeSoftBlur_safe', 'safe');
      } else if (element.dataset.mwModerated === 'softblur' || element.classList.contains('mw-softblur')) {
        element.style.filter = 'none';
        element.dataset.mwModerated = 'safe';
        clearAuthoritativeHardBlur(element);
        element.classList.remove('mw-softblur');
        element.dataset.mwPreblurClear = 'true';
        element.dataset.mwPreblurClear = 'true';
        removed = true;
        
      if (CONFIG.debug) {
        console.log('[MW] soft blur removed (safe):', src.substring(0, 50));
      }
      }
      if (shortsMode && element.dataset.mwModerated !== 'blurred') {
        removeRevealOverlay(element, srcForClear, 'removeSoftBlur_safe');
      }
      console.log(
        '[MW][JSBlur][AutoRemoveCheck]',
        'src=' + String(src || '').substring(0, 120),
        'beforeState=' + beforeState,
        'beforeHasBlur=' + beforeHasBlur,
        'afterState=' + (element.dataset.mwModerated || ''),
        'afterFilter=' + (element.style.getPropertyValue('filter') || element.style.filter || ''),
        'removed=' + removed
      );
      console.log(
        '[DIAG][BLUR] remove',
        'itemKey=' + getDiagItemKey(src || element.dataset.mwSrc || ''),
        'node=' + getDiagNodeId(element),
        'overlayId=' + overlayId,
        'reason=removeSoftBlur',
        'removed=' + removed
      );
      diagBlurStateLog('removeSoftBlur.exit', element, src, 'removed=' + removed + ' beforeState=' + beforeState);
    } catch (e) {}
    return removed;
  }

  // Marks elements that had pre-scan blur so we don't reapply soft blur on requeue.
  function clearPreBlur(element) {
    try {
      element.dataset.mwPreblurClear = 'true';
      const filter = element.style.getPropertyValue('filter') || element.style.filter || '';
      if (!filter || filter.toLowerCase().includes('blur(')) {
        element.style.filter = 'none';
      }
    } catch (e) {}
  }

  function clearPreBlur(element) {
    try {
      element.dataset.mwPreblurClear = 'true';
      const filter = element.style.getPropertyValue('filter') || element.style.filter || '';
      if (!filter || filter.toLowerCase().includes('blur(')) {
        element.style.filter = 'none';
      }
    } catch (e) {}
  }

  const FORCE_UNSAFE_CATEGORIES = new Set([
    'swimwear',
    'shirtless',
    'shirtless_male',
    'bikini',
    'swim_trunks',
    'sports_bra',
    'thirst',
  ]);

  function isExplicitUnsafeLabel(label) {
    return label === 'porn' || label === 'hentai';
  }

  function normalizePolicyCategory(label) {
    return String(label || '').trim().toLowerCase();
  }

  function isMvpAllowedCategory(label) {
    const raw = normalizePolicyCategory(label);
    // FREEZE-OVERRIDE (accuracy): include sexy so dial thr on suggestive content
    // is not flattened to binary porn/hentai-only. Swimwear family still allowed.
    return (
      FORCE_UNSAFE_CATEGORIES.has(raw) ||
      isExplicitUnsafeLabel(raw) ||
      raw === 'sexy' ||
      raw === 'suggestive' ||
      raw === 'partial_nudity'
    );
  }

  function applyFailOpenAndModePolicy(rawShouldBlur, rawCategory, predictedLabel, isErrorResult) {
    const normalizedCategory = normalizePolicyCategory(rawCategory);
    const normalizedPredicted = normalizePolicyCategory(predictedLabel);
    const enabledAndActive = CONFIG.enabled && CONFIG.sensitivity > 0;

    if (isErrorResult) {
      if (CONFIG.failClosed && enabledAndActive) {
        return { shouldBlur: true, reason: 'failClosed/' + normalizedCategory };
      }
      return { shouldBlur: false, reason: 'failOpen/' + normalizedCategory };
    }

    if (CONFIG.blockingMode === 'mvp') {
      const categoryAllowed = isMvpAllowedCategory(normalizedCategory);
      const predictedAllowed = isMvpAllowedCategory(normalizedPredicted);
      if (!!rawShouldBlur && !categoryAllowed && !predictedAllowed) {
        return { shouldBlur: false, reason: 'mvp_filter/' + (normalizedCategory || normalizedPredicted || 'unknown') };
      }
    }

    return { shouldBlur: !!rawShouldBlur, reason: null };
  }

  function applyAnatomicalThreshold(shouldApplyBlur, predictedLabel, unsafeScores, forceUnsafe) {
    const normalizedPredicted = normalizePolicyCategory(predictedLabel);
    if (!shouldApplyBlur || forceUnsafe) {
      return { shouldBlur: !!shouldApplyBlur, reason: null };
    }
    if (
      normalizedPredicted !== 'sexy' &&
      normalizedPredicted !== 'porn' &&
      normalizedPredicted !== 'hentai'
    ) {
      return { shouldBlur: !!shouldApplyBlur, reason: null };
    }

    const thrTable = effectiveThresholds || getThresholdsForLevel(CONFIG.sensitivity || 0);
    const dialThr =
      normalizedPredicted === 'sexy'
        ? Number(thrTable.sexy)
        : normalizedPredicted === 'hentai'
          ? Number(thrTable.hentai)
          : Number(thrTable.porn);
    // FREEZE-OVERRIDE (accuracy): never raise the bar above the dial thr.
    // Old fixed 0.60 floor made Maximum≈Strict≈binary (scores 0.2–0.59 unblurred).
    const keepFloor = Math.min(
      Number(CONFIG.anatomicalThreshold) || 0.6,
      Number.isFinite(dialThr) ? dialThr : 0.6
    );

    const score =
      normalizedPredicted === 'sexy'
        ? unsafeScores.sexy
        : normalizedPredicted === 'hentai'
          ? unsafeScores.hentai
          : unsafeScores.porn;
    if (score === null || !Number.isFinite(score)) {
      if (CONFIG.failClosed && CONFIG.enabled && CONFIG.sensitivity > 0) {
        return { shouldBlur: true, reason: normalizedPredicted + '_scoreNaN/failClosed' };
      }
      return { shouldBlur: false, reason: normalizedPredicted + '_scoreNaN/failOpen' };
    }

    if (score < keepFloor) {
      return {
        shouldBlur: false,
        reason: normalizedPredicted + '<anatomicalFloor thr=' + keepFloor + ' dial=' + dialThr,
      };
    }

    return { shouldBlur: true, reason: null };
  }

  // Active Shorts FP guard — DIAGNOSTICS by default (decision veto OFF).
  // When ACTIVE_SHORTS_FP_GUARD_DECISION_ENABLED is false, never suppresses blur;
  // only logs would-suppress for accuracy forensics vs MVPcandidate1-baseline.
  function applyActiveShortsFalsePositiveGuard(shouldApplyBlur, predictedLabel, unsafeScores, decisionReason) {
    if (!isShortsModeActive() || !shouldApplyBlur) {
      return { shouldBlur: !!shouldApplyBlur, reason: decisionReason || null, wouldSuppress: false, suppressReason: null };
    }
    const dialThr = getActiveShortsThresholds();
    const floorThr = ACTIVE_SHORTS_FP_FLOOR_DIAG_ONLY;
    const porn = toFiniteNumber(unsafeScores && unsafeScores.porn);
    const sexy = toFiniteNumber(unsafeScores && unsafeScores.sexy);
    const hentai = toFiniteNumber(unsafeScores && unsafeScores.hentai);
    const maxExplicit = Math.max(porn === null ? 0 : porn, hentai === null ? 0 : hentai);
    const sexyScore = sexy === null ? 0 : sexy;
    const label = normalizePolicyCategory(predictedLabel);

    let suppressReason = null;
    if (maxExplicit >= Math.max(floorThr.porn, 0.8) || sexyScore >= Math.max(floorThr.sexy, 0.85)) {
      suppressReason = null;
    } else if (label === 'sexy' || label === 'thirst' || label === 'swimwear' || label === 'shirtless' ||
        label === 'shirtless_male' || label === 'bikini' || label === 'sports_bra' || label === 'swim_trunks') {
      if (sexyScore < floorThr.sexy && maxExplicit < floorThr.porn) {
        suppressReason = 'shorts_fp_guard_weak_suggestive';
      }
    } else if (label === 'porn' || label === 'hentai') {
      if (maxExplicit < floorThr.porn) {
        suppressReason = 'shorts_fp_guard_weak_explicit';
      }
    } else if (maxExplicit < floorThr.porn && sexyScore < floorThr.sexy) {
      suppressReason = 'shorts_fp_guard_below_floor';
    }

    if (suppressReason) {
      console.warn(
        '[MW-ACTIVE-SHORTS-ACCURACY-DIAG]',
        'event=fp_floor_would_suppress',
        'decisionEnabled=' + String(ACTIVE_SHORTS_FP_GUARD_DECISION_ENABLED),
        'suppressReason=' + suppressReason,
        'label=' + label,
        'porn=' + String(porn),
        'sexy=' + String(sexy),
        'hentai=' + String(hentai),
        'dialThr=' + JSON.stringify(dialThr),
        'floorThr=' + JSON.stringify(floorThr),
        'priorReason=' + String(decisionReason || 'none')
      );
    }

    if (ACTIVE_SHORTS_FP_GUARD_DECISION_ENABLED && suppressReason) {
      return { shouldBlur: false, reason: suppressReason, wouldSuppress: true, suppressReason: suppressReason };
    }
    return {
      shouldBlur: true,
      reason: decisionReason || null,
      wouldSuppress: !!suppressReason,
      suppressReason: suppressReason,
    };
  }

  function isShortsHealthContextStale(context, targetNode) {
    if (!context) return true;
    const liveId = getCurrentShortsUrlId() || '';
    // Swipe identity mismatch only — do NOT clear positives based on score floors
    // (that recreated FN regression after fe3a1c28).
    if (context.shortsUrlId && liveId && String(context.shortsUrlId) !== String(liveId)) {
      return true;
    }
    if (targetNode && targetNode.dataset) {
      const stampedEpoch = String(targetNode.dataset.mwPageEpoch || '');
      if (stampedEpoch && stampedEpoch !== String(state.pageEpoch || 0)) {
        return true;
      }
    }
    return false;
  }

  function isMvpBlurAuthorized(element, src, itemKey, mvpProof, callerContext) {
    if (!CONFIG.mvpPositiveCardOwnershipV1) return true;
    if (isShortsModeActive()) return true;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return true;
    const diagCtx = String(callerContext || 'unknown');
    const diagNodeId = getDiagNodeId(element);
    const deny = function(reason) {
      console.log(
        '[MW-MVP-AUTHZ-BLUR-DENY]',
        'reason=' + reason,
        'caller=' + diagCtx,
        'nodeId=' + diagNodeId,
        'itemKey=' + String(itemKey || 'unknown'),
        'src=' + String(src || '').substring(0, 120)
      );
      return false;
    };
    const allow = function(reason) {
      console.log(
        '[MW-MVP-AUTHZ-BLUR-ALLOW]',
        'reason=' + reason,
        'caller=' + diagCtx,
        'nodeId=' + diagNodeId,
        'itemKey=' + String(itemKey || 'unknown'),
        'src=' + String(src || '').substring(0, 120)
      );
      return true;
    };
    if (isMvpStreamingUrlSrc(src)) {
      console.log(
        '[MW-MVP-STREAMING-IDENTITY-REJECTED]',
        'caller=' + diagCtx,
        'nodeId=' + diagNodeId,
        'src=' + String(src || '').substring(0, 120)
      );
      return deny('streaming_url');
    }
    // ---- Shorts shelf branch ------------------------------------------------
    // Handles img elements inside ytm-shorts-lockup-view-model on the main feed.
    // Active Shorts (isShortsModeActive=true) already exited above.
    // Regular cards do not have ytm-shorts-lockup-view-model as an ancestor.
    const shortsShelfLockup = (
      !isShortsModeActive() &&
      typeof element.closest === 'function'
    ) ? element.closest('ytm-shorts-lockup-view-model') : null;
    if (shortsShelfLockup) {
      const shelfAnchor = typeof shortsShelfLockup.querySelector === 'function'
        ? shortsShelfLockup.querySelector('a[href^="/shorts/"]')
        : null;
      const shelfRawHref = String(
        (shelfAnchor && shelfAnchor.getAttribute && shelfAnchor.getAttribute('href')) || ''
      );
      const shelfHrefMatch = shelfRawHref.match(/\\/shorts\\/([^/?#]+)/);
      const shelfId = shelfHrefMatch ? shelfHrefMatch[1] : 'unknown';
      if (!itemKey || itemKey === 'unknown') {
        console.log('[MW-MVP-SHORTS-SHELF-AUTHZ-DENY] item_key_unknown',
          'caller=' + diagCtx, 'nodeId=' + diagNodeId);
        return deny('shorts_shelf_item_key_unknown');
      }
      if (shelfId === 'unknown') {
        console.log('[MW-MVP-SHORTS-SHELF-AUTHZ-DENY] href_unknown',
          'caller=' + diagCtx, 'nodeId=' + diagNodeId, 'lockupNodeId=' + getDiagNodeId(shortsShelfLockup));
        return deny('shorts_shelf_href_unknown');
      }
      if (itemKey !== shelfId) {
        console.log('[MW-MVP-SHORTS-SHELF-AUTHZ-DENY] id_mismatch',
          'caller=' + diagCtx, 'nodeId=' + diagNodeId,
          'itemKey=' + String(itemKey || 'unknown'), 'shelfId=' + shelfId);
        return deny('shorts_shelf_id_mismatch');
      }
      if (mvpProof === 'classifier_positive') {
        console.log('[MW-MVP-SHORTS-SHELF-AUTHZ-ALLOW] classifier_positive',
          'caller=' + diagCtx, 'nodeId=' + diagNodeId, 'itemKey=' + String(itemKey || 'unknown'));
        return allow('shorts_shelf_classifier_positive');
      }
      const shelfOwned = !!(
        shortsShelfLockup.dataset &&
        shortsShelfLockup.dataset.mwShortsShelfOwned === '1' &&
        shortsShelfLockup.dataset.mwShortsShelfItemKey === itemKey
      );
      if (shelfOwned) {
        console.log('[MW-MVP-SHORTS-SHELF-AUTHZ-ALLOW] owned',
          'caller=' + diagCtx, 'nodeId=' + diagNodeId, 'itemKey=' + String(itemKey || 'unknown'));
        return allow('shorts_shelf_owned');
      }
      return deny('shorts_shelf_no_proof');
    }
    // ---- end Shorts shelf branch --------------------------------------------
    const card = (typeof element.closest === 'function')
      ? (element.closest(NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR) || element.closest(NON_SHORTS_REATTACH_CARD_SELECTOR))
      : null;
    if (!card) {
      if (mvpProof === 'classifier_positive') return allow('classifier_positive');
      if (mvpProof === 'card_blurred') return allow('card_blurred_no_boundary');
      return deny('no_card_boundary');
    }
    const hrefKey = getMvpCardHrefItemKey(card);
    if (hrefKey === 'unknown') return deny('href_key_unknown');
    if (!itemKey || itemKey === 'unknown') return deny('item_key_unknown');
    if (itemKey !== hrefKey) {
      console.log(
        '[MW-MVP-NEGATIVE-PROTECTED]',
        'caller=' + diagCtx,
        'nodeId=' + diagNodeId,
        'cardNodeId=' + getDiagNodeId(card),
        'hrefKey=' + hrefKey,
        'itemKey=' + String(itemKey || 'unknown')
      );
      return deny('item_href_mismatch');
    }
    if (isMvpPositiveCardOwned(card, hrefKey, itemKey)) return allow('owned_card');
    if (mvpProof === 'classifier_positive') return allow('classifier_positive');
    if (mvpProof === 'card_blurred') {
      if (isMvpStreamingUrlSrc(src)) return deny('card_blurred_streaming_src');
      if (!itemKey || itemKey === 'unknown') return deny('card_blurred_unknown_item');
      if (hrefKey === 'unknown') return deny('card_blurred_unknown_href');
      if (itemKey !== hrefKey) return deny('card_blurred_key_mismatch');
      return allow('card_blurred_continuity');
    }
    console.log(
      '[MW-MVP-NEGATIVE-PROTECTED]',
      'caller=' + diagCtx,
      'nodeId=' + diagNodeId,
      'cardNodeId=' + getDiagNodeId(card),
      'hrefKey=' + hrefKey,
      'itemKey=' + String(itemKey || 'unknown'),
      'proof=' + String(mvpProof || 'none')
    );
    return deny('no_ownership_no_proof');
  }

  /**
   * Apply hard blur (for unsafe content)
   * Uses !important to override site styles on iOS
   */
  function applyBlur(element, src, category, blurStrengthPx, itemId, _mvpProof) {
    if (!isVisualModerationActive()) return;
    // Check persistence
    if (isRevealedForSource(src, element)) return;
    if (!isMvpBlurAuthorized(element, src, getDiagItemKey(src), _mvpProof || 'none', 'applyBlur')) return;
    const shortsMode = isShortsModeActive();
    let shortsStableSelectorUsed = '';
    if (shortsMode) {
      const stableResolution = resolveShortsStableBlurTarget(element, src);
      diagLogShortsTargetResolution('applyBlur', element, src, stableResolution);
      const stableTarget = stableResolution && stableResolution.target ? stableResolution.target : null;
      if (stableTarget && stableTarget.isConnected) {
        if (stableTarget !== element) {
          try {
            element.classList.remove('mw-softblur');
            element.classList.remove('mw-blurred');
            element.style.removeProperty('filter');
            element.style.removeProperty('-webkit-filter');
            element.style.removeProperty('backdrop-filter');
            element.style.removeProperty('-webkit-backdrop-filter');
            element.dataset.mwPreblurClear = 'true';
          } catch (e) {}
        }
        element = stableTarget;
        shortsStableSelectorUsed = stableResolution.selectorUsed || '';
        if (shortsStableSelectorUsed) {
          element.dataset.mwShortsStableSelector = shortsStableSelectorUsed;
        }
      }
      if (isRevealedForSource(src, element)) return;
      const alreadyFilter = String(element.style.getPropertyValue('filter') || element.style.filter || '').toLowerCase();
      const alreadyBackdrop = String(element.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
      const alreadyHardBlurred =
        element.dataset.mwModerated === 'blurred' &&
        (alreadyFilter.includes('blur(') || alreadyBackdrop.includes('blur('));
      if (alreadyHardBlurred) {
        setShortsBlurContextForNode(
          element,
          src,
          category || 'flagged',
          itemId,
          IS_YOUTUBE ? 40 : Math.min(CONFIG.blurStrength || 30, 20),
          shortsStableSelectorUsed,
          'applyBlur_already_hard_blurred'
        );
        if (!findRevealOverlayForElement(element, src) && element.isConnected) {
          // Owner-context refresh + createRevealOverlay (same surgical heal as health cycle).
          healActiveShortsRevealPairing(
            element,
            src,
            category || 'flagged',
            itemId || '',
            'applyBlur_already_hard_blurred'
          );
        }
        // Diagnostics-only: capture residual blur-without-reveal after heal attempt.
        if (element.isConnected && !findRevealOverlayForElement(element, src)) {
          scheduleActiveShortsRevealPairingBurst(
            element,
            src,
            category || 'flagged',
            itemId || '',
            'applyBlur_already_hard_blurred_orphan'
          );
          const residualOverlayState = getDiagOverlayState(element);
          const residualGap = classifyActiveShortsRevealGap(element, residualOverlayState, {
            reason: 'applyBlur_already_hard_blurred_no_reveal',
            src: src,
            context: getShortsBlurContextForNode(element),
            hasComputedBlur: true,
            overlayExpected: true,
            overlayAnchored: false,
          });
          warnActiveShortsRevealPairingDiag('blur_without_reveal_after_apply', residualGap, {
            throttleMs: 800,
          });
        }
        diagScheduleBlurredNodePresenceChecks(element, src, itemId);
        return;
      }
    }
    const desiredBlur = blurStrengthPx || CONFIG.blurStrength || 30;
    const blurPx = IS_YOUTUBE ? 40 : Math.min(desiredBlur, 20);
    
    try {
      diagBlurStateLog(
        'applyBlur.enter',
        element,
        src,
        'itemId=' + (itemId || 'N/A') + ' category=' + (category || 'flagged')
      );
      diagNodeParentAtBlur.set(element, { parent: element.parentElement || null });
      diagNodeLifecycleLog('applyBlur', element, 'src=' + String(src || '').substring(0, 120));
      if (shortsMode) {
        diagShortsBlurStackLog('hard_before_clear', element, src, 'itemId=' + (itemId || 'N/A'));
        element.classList.remove('mw-softblur');
        element.style.removeProperty('filter');
        element.style.removeProperty('-webkit-filter');
        element.style.removeProperty('backdrop-filter');
        element.style.removeProperty('-webkit-backdrop-filter');
        diagShortsBlurStackLog('hard_after_clear', element, src, 'itemId=' + (itemId || 'N/A'));
      }
      if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
        console.log(
          '[DIAG][MVP_ITEM_CHAIN] stage=blur_target_resolved',
          'itemId=' + (itemId || 'none'),
          'itemKey=' + getDiagItemKey(src),
          'nodeId=' + getDiagNodeId(element),
          'sourceType=' + String((element.dataset && element.dataset.mwSourceType) || 'unknown'),
          'connected=' + String(!!element.isConnected)
        );
      }
      // Force blur with !important for iOS WebKit
      element.style.setProperty('filter', 'blur(' + blurPx + 'px)', 'important');
      element.style.setProperty('-webkit-filter', 'blur(' + blurPx + 'px)', 'important');
      element.style.setProperty('backdrop-filter', 'blur(' + blurPx + 'px)', 'important');
      element.style.setProperty('-webkit-backdrop-filter', 'blur(' + blurPx + 'px)', 'important');
      element.style.transition = 'filter 0.3s ease';
      element.dataset.mwModerated = 'blurred';
      element.dataset.mwCategory = category || 'flagged';
      element.dataset.mwSrc = src;
      element.dataset.mwItemId = itemId || '';
      markAuthoritativeHardBlur(element, src);
      if (_mvpProof === 'classifier_positive' && !shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
        const ownershipCard = getOwnedCardContainerFromNode(element);
        if (ownershipCard) {
          applyOwnedPositiveCardClass(ownershipCard, getDiagItemKey(src), 'classifier_positive');
        }
      }
      if (CONFIG.mvpPositiveCardOwnershipV1 && (_mvpProof === 'classifier_positive') && !shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
        const _mvpCard = typeof element.closest === 'function'
          ? (element.closest(NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR) || element.closest(NON_SHORTS_REATTACH_CARD_SELECTOR))
          : null;
        if (_mvpCard) {
          const _mvpHrefKey = getMvpCardHrefItemKey(_mvpCard);
          const _mvpItemKey = getDiagItemKey(src);
          if (_mvpHrefKey !== 'unknown' && _mvpHrefKey === _mvpItemKey) {
            stampMvpPositiveCardOwnership(_mvpCard, _mvpItemKey, _mvpHrefKey, state.pageEpoch, 'applyBlur_classifier_positive');
            installMvpCardObserver(_mvpCard);
          }
        }
        // Shorts shelf ownership stamp — must happen before createRevealOverlay
        const _shelfLockup = typeof element.closest === 'function'
          ? element.closest('ytm-shorts-lockup-view-model')
          : null;
        if (_shelfLockup) {
          const _shelfItemKey = getDiagItemKey(src);
          _shelfLockup.dataset.mwShortsShelfOwned = '1';
          _shelfLockup.dataset.mwShortsShelfItemKey = _shelfItemKey;
          _shelfLockup.dataset.mwShortsShelfAt = String(Date.now());
          installShortsShelfLockupObserver(_shelfLockup);
          console.log(
            '[MW-MVP-SHORTS-SHELF-STAMPED]',
            'nodeId=' + getDiagNodeId(element),
            'lockupNodeId=' + getDiagNodeId(_shelfLockup),
            'itemKey=' + _shelfItemKey
          );
        }
      }
      element.classList.remove('mw-softblur');
      element.classList.add('mw-blurred');
      rememberNonShortsReattachContext(
        element,
        src,
        category || 'flagged',
        itemId || '',
        blurPx,
        'applyBlur'
      );
      if (
        !shortsMode &&
        isYouTubeMainPageThumbnailSurfaceUrl(window.location.href) &&
        String(element.dataset.mwSourceType || '') === 'img'
      ) {
        console.log(
          '[DIAG][MVP_NON_SHORTS] thumbnail_blurred',
          'nodeId=' + getDiagNodeId(element),
          'itemId=' + (itemId || 'none'),
          'src=' + String(src || '').substring(0, 180),
          'category=' + String(category || 'flagged')
        );
      }
      if (shortsMode && !shortsStableSelectorUsed && element.dataset.mwShortsStableSelector) {
        shortsStableSelectorUsed = element.dataset.mwShortsStableSelector;
      }
      if (shortsMode) {
        setShortsBlurContextForNode(
          element,
          src,
          category || 'flagged',
          itemId,
          blurPx,
          shortsStableSelectorUsed,
          'applyBlur'
        );
        diagScheduleBlurredNodePresenceChecks(element, src, itemId);
      }
      diagLogBlurAppliedNodeDetails(element, src, category, itemId, shortsStableSelectorUsed);
      
      state.blurred.add(src);
      state.stats.blurred++;
      const containsOverlay = !!(typeof element.querySelector === 'function' && element.querySelector('.mw-reveal-overlay'));
      if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
        console.log(
          '[DIAG][MVP_REVEAL_PATH] reveal_create_attempt',
          'itemId=' + (itemId || 'none'),
          'itemKey=' + getDiagItemKey(src),
          'sourceType=' + String(element.dataset.mwSourceType || 'unknown'),
          'suppressionExpected=' + String(shouldDisableRevealUiForMvpMainPageSurface()),
          'nodeId=' + getDiagNodeId(element)
        );
      }
      
      createRevealOverlay(element, src, category, itemId);
      if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
        const _shelfLockupForDiag = typeof element.closest === 'function'
          ? element.closest('ytm-shorts-lockup-view-model')
          : null;
        if (_shelfLockupForDiag) {
          const overlayAfterCreate = findRevealOverlayForElement(element, src);
          console.log(
            '[MW-MVP-SHORTS-SHELF-OVERLAY-CREATED]',
            'nodeId=' + getDiagNodeId(element),
            'overlayPresent=' + String(!!overlayAfterCreate),
            'itemKey=' + getDiagItemKey(src)
          );
        }
        // FREEZE-OVERRIDE (reveal pairing): first YouTube entry / cold lifecycle
        // rescan can leave hard blur without reveal on the first feed thumb.
        if (element.isConnected && !findRevealOverlayForElement(element, src)) {
          scheduleNonShortsRevealPairingBurst(
            element,
            src,
            category || 'flagged',
            itemId || '',
            'applyBlur_post_create_orphan'
          );
          console.warn(
            '[DIAG][REVEAL_UI] non_shorts_blur_without_reveal_after_apply',
            'itemId=' + (itemId || 'none'),
            'itemKey=' + getDiagItemKey(src),
            'nodeId=' + getDiagNodeId(element)
          );
        }
      }
      if (shortsMode && element.isConnected && !findRevealOverlayForElement(element, src)) {
        healActiveShortsRevealPairing(
          element,
          src,
          category || 'flagged',
          itemId || '',
          'applyBlur_post_create'
        );
      }
      if (shortsMode && element.isConnected && !findRevealOverlayForElement(element, src)) {
        // Variable device orphan: schedule fail-closed pairing burst (home Shorts exit
        // and swipe races often miss the first createRevealOverlay only).
        scheduleActiveShortsRevealPairingBurst(
          element,
          src,
          category || 'flagged',
          itemId || '',
          'applyBlur_post_create_orphan'
        );
        const postCreateOverlayState = getDiagOverlayState(element);
        const postCreateGap = classifyActiveShortsRevealGap(element, postCreateOverlayState, {
          reason: 'applyBlur_post_create_no_reveal',
          src: src,
          context: getShortsBlurContextForNode(element),
          hasComputedBlur: true,
          overlayExpected: true,
          overlayAnchored: false,
        });
        warnActiveShortsRevealPairingDiag('blur_without_reveal_after_apply', postCreateGap, {
          throttleMs: 800,
        });
      }
      const parentContainsOverlay = !!(element.parentElement && typeof element.parentElement.querySelector === 'function' && element.parentElement.querySelector('.mw-reveal-overlay'));
      console.log(
        '[DIAG][BLUR_LAYER] apply',
        'targetNode=' + getDiagNodeId(element),
        'containsOverlay=' + containsOverlay,
        'parentContainsOverlay=' + parentContainsOverlay
      );
      const overlayAfterApply = findRevealOverlayForElement(element, src);
      console.log(
        '[DIAG][BLUR] apply',
        'itemKey=' + getDiagItemKey(src),
        'node=' + getDiagNodeId(element),
        'overlayId=' + (overlayAfterApply && overlayAfterApply.dataset ? overlayAfterApply.dataset.mwOverlayId || 'none' : 'none'),
        'itemId=' + (itemId || 'none')
      );
      if (shortsMode) {
        diagShortsBlurStackLog('hard_after_apply', element, src, 'itemId=' + (itemId || 'N/A'));
      }
      const appliedFilter = element.style.getPropertyValue('filter') || element.style.filter || '';
      const filterPriority = element.style.getPropertyPriority('filter') || 'none';
      console.log(
        '[MW][JSBlur][Apply]',
        'itemId=' + (itemId || 'N/A'),
        'src=' + String(src || '').substring(0, 120),
        'filter=' + appliedFilter,
        'priority=' + filterPriority
      );
      diagBlurStateLog('applyBlur.exit', element, src, 'itemId=' + (itemId || 'N/A') + ' category=' + (category || 'flagged'));
      console.log('[MW] applied blur [' + category + '] itemId=' + (itemId || 'N/A') + ':', src.substring(0, 60));
    } catch (e) {
      console.error('[MW] Failed to apply blur:', e.message);
      state.stats.errors++;
    }
  }

  function removeBlur(element, src, options) {
    try {
      const keepOverlay = !!(options && options.keepOverlay);
      const shortsMode = isShortsModeActive();
      if (shortsMode) {
        const stableResolution = resolveShortsStableBlurTarget(element, src);
        diagLogShortsTargetResolution('removeBlur', element, src, stableResolution);
        const stableTarget = stableResolution && stableResolution.target ? stableResolution.target : null;
        if (stableTarget && stableTarget.isConnected) {
          element = stableTarget;
        }
      }
      diagBlurStateLog('removeBlur.enter', element, src, '');
      const overlay = findRevealOverlayForElement(element, src);
      const overlayId = overlay && overlay.dataset ? overlay.dataset.mwOverlayId || 'none' : 'none';
      diagNodeLifecycleLog(
        'removeBlur',
        element,
        'src=' + String(src || '').substring(0, 120) +
        ' overlayFound=' + (!!overlay) +
        ' overlayConnected=' + (!!overlay?.isConnected)
      );
      console.log(
        '[DIAG][BLUR] remove',
        'itemKey=' + getDiagItemKey(src),
        'node=' + getDiagNodeId(element),
        'overlayId=' + overlayId,
        'reason=removeBlur'
      );
      if (shortsMode) {
        if (keepOverlay) {
          element.style.removeProperty('filter');
          element.style.removeProperty('-webkit-filter');
          element.style.removeProperty('backdrop-filter');
          element.style.removeProperty('-webkit-backdrop-filter');
          element.classList.remove('mw-softblur');
          element.classList.remove('mw-blurred');
          element.dataset.mwModerated = 'revealed';
          clearAuthoritativeHardBlur(element);
          element.dataset.mwPreblurClear = 'true';
          clearShortsBlurContextForNode(element, 'removeBlur_reveal_keepOverlay');
        } else {
          clearAllBlurAndOverlay(element, src, 'removeBlur_reveal', 'revealed');
        }
        // C2c: a reveal must also clear same-src residue stamps on sibling
        // nodes in the same stable container (e.g. the <video> that first
        // held blur before ownership migrated to the frame). A leftover
        // 'blurred' stamp matches the Flash Shield veil CSS
        // (video:not([data-mw-moderated="safe"]):not(...revealed)...) and can
        // visually re-blur a Short the user just revealed. Scoped fail-closed:
        // same container AND identical mwSrc only — different-src nodes keep
        // their blur untouched.
        try {
          const residueScope = (element.closest && element.closest(SHORTS_STABLE_CONTAINER_TAG_SELECTOR)) || element;
          const residueNodes = residueScope && typeof residueScope.querySelectorAll === 'function'
            ? residueScope.querySelectorAll('[data-mw-moderated="blurred"]')
            : [];
          for (let i = 0; i < residueNodes.length; i += 1) {
            const residue = residueNodes[i];
            if (!residue || residue === element || residue.nodeType !== 1) continue;
            const residueSrc = String((residue.dataset && residue.dataset.mwSrc) || '');
            if (!residueSrc || !src || residueSrc !== src) continue;
            residue.dataset.mwModerated = 'revealed';
            residue.style.removeProperty('filter');
            residue.style.removeProperty('-webkit-filter');
            residue.style.removeProperty('backdrop-filter');
            residue.style.removeProperty('-webkit-backdrop-filter');
            residue.classList.remove('mw-softblur');
            residue.classList.remove('mw-blurred');
            console.log(
              '[DIAG][BLUR] residue_stamp_revealed',
              'itemKey=' + getDiagItemKey(src),
              'node=' + getDiagNodeId(residue),
              'reason=removeBlur_same_src_residue'
            );
          }
        } catch (e) {}
      } else {
        element.style.removeProperty('filter');
        element.style.removeProperty('-webkit-filter');
        element.style.removeProperty('backdrop-filter');
        element.style.removeProperty('-webkit-backdrop-filter');
        element.style.filter = 'none';
        element.dataset.mwModerated = 'revealed';
        clearAuthoritativeHardBlur(element);
        element.dataset.mwPreblurClear = 'true';
        element.classList.remove('mw-softblur');
        element.classList.remove('mw-blurred');
      }
      markRevealedForSource(src, element, 'removeBlur');
      
      if (shortsMode) {
        if (!keepOverlay) {
          removeRevealOverlay(element, src, 'removeBlur_reveal');
        }
      } else {
        removeRevealOverlay(element, src, 'removeBlur_reveal');
      }

      diagBlurStateLog('removeBlur.exit', element, src, 'overlayFound=' + (!!overlay));
      console.log('[MW] blur removed:', src.substring(0, 60));
    } catch (e) {}
  }

  function clearElementBlur(element) {
    if (!element) return;
    try {
      const shortsMode = isShortsModeActive();
      const srcForClear = element.dataset.mwSrc || '';
      if (shortsMode) {
        const stableResolution = resolveShortsStableBlurTarget(element, srcForClear);
        diagLogShortsTargetResolution('clearElementBlur', element, srcForClear, stableResolution);
        const stableTarget = stableResolution && stableResolution.target ? stableResolution.target : null;
        if (stableTarget && stableTarget.isConnected) {
          element = stableTarget;
        }
      }
      diagBlurStateLog('clearElementBlur.enter', element, srcForClear, '');
      const overlay = findRevealOverlayForElement(element, srcForClear);
      const overlayId = overlay && overlay.dataset ? overlay.dataset.mwOverlayId || 'none' : 'none';
      diagNodeLifecycleLog(
        'clearElementBlur',
        element,
        'overlayFound=' + (!!overlay) +
        ' overlayConnected=' + (!!overlay?.isConnected)
      );
      console.log(
        '[DIAG][BLUR] remove',
        'itemKey=' + getDiagItemKey(srcForClear),
        'node=' + getDiagNodeId(element),
        'overlayId=' + overlayId,
        'reason=clearElementBlur'
      );
      if (shortsMode) {
        clearAllBlurAndOverlay(element, srcForClear, 'clearElementBlur_safe', 'safe');
      } else {
        element.style.filter = 'none';
        element.dataset.mwModerated = 'safe';
        clearAuthoritativeHardBlur(element);
      }
      element.dataset.mwRevealed = 'false';
      element.dataset.mwPreblurClear = 'true';
      element.classList.remove('mw-softblur');
      element.classList.remove('mw-blurred');
      if (shortsMode) {
        removeRevealOverlay(element, srcForClear, 'clearElementBlur_safe');
      } else if (overlay) {
        overlay.style.display = 'none';
      }
      diagBlurStateLog('clearElementBlur.exit', element, srcForClear, 'overlayFound=' + (!!overlay));
    } catch (e) {}
  }

  function createRevealOverlay(element, src, category, itemId, allowShortsReresolve) {
    if (!isVisualModerationActive()) return;
    const shortsMode = isShortsModeActive();
    const usePortalOverlay = shortsMode || shouldUsePortalRevealOverlayForNode(element);
    if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
      console.log(
        '[DIAG][MVP_ITEM_CHAIN] stage=reveal_attempt',
        'itemId=' + (itemId || 'none'),
        'itemKey=' + getDiagItemKey(src),
        'nodeId=' + getDiagNodeId(element),
        'sourceType=' + String((element.dataset && element.dataset.mwSourceType) || 'unknown')
      );
    }
    if (shouldDisableRevealUiForMvpMainPageSurface()) {
      removeRevealOverlay(element, src, 'mvp_main_page_reveal_ui_disabled');
      element.dataset.mwHasOverlay = 'false';
      console.log(
        '[DIAG][REVEAL_UI] suppressed_mvp_main_page_surface',
        'itemKey=' + getDiagItemKey(src),
        'navId=' + NAV_ID,
        'pageEpoch=' + state.pageEpoch,
        'url=' + window.location.href
      );
      console.log(
        '[DIAG][MVP_REVEAL_PATH] reveal_suppressed',
        'itemId=' + (itemId || 'none'),
        'itemKey=' + getDiagItemKey(src),
        'suppressed=true',
        'reason=mvp_main_page_reveal_ui_disabled',
        'nodeId=' + getDiagNodeId(element),
        'hasOverlayFlag=' + String(element.dataset.mwHasOverlay === 'true')
      );
      if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
        console.log(
          '[DIAG][MVP_ITEM_CHAIN] stage=reveal_skip',
          'itemId=' + (itemId || 'none'),
          'itemKey=' + getDiagItemKey(src),
          'reason=mvp_main_page_reveal_ui_disabled',
          'nodeId=' + getDiagNodeId(element)
        );
      }
      return;
    }
    const allowReresolve = shortsMode && allowShortsReresolve !== false;
    if (shortsMode) {
      const stableResolution = resolveShortsStableBlurTarget(element, src);
      diagLogShortsTargetResolution('createRevealOverlay', element, src, stableResolution);
      const stableTarget = stableResolution && stableResolution.target ? stableResolution.target : null;
      if (stableTarget && stableTarget !== element && stableTarget.isConnected) {
        // FREEZE-OVERRIDE: when blur residue sits on the video (or other leaf) and the
        // stable reel frame is unstamped, migrate blur onto the frame before redirecting.
        // Historical dead-end: recurse with allowReresolve=false hit mwModerated!=='blurred'
        // and removed any overlay → orphan blur with no reveal until health heal ran.
        const sourceBlurred = String((element.dataset && element.dataset.mwModerated) || '') === 'blurred';
        const targetBlurred = String((stableTarget.dataset && stableTarget.dataset.mwModerated) || '') === 'blurred';
        if (sourceBlurred && !targetBlurred) {
          const desiredBlur = CONFIG.blurStrength || 30;
          const resolvedBlurPx = IS_YOUTUBE ? 40 : Math.min(desiredBlur, 20);
          const resolvedSelector = stableResolution && stableResolution.selectorUsed
            ? stableResolution.selectorUsed
            : '';
          diagShortsBlurStackLog('overlay_redirect_migrate_before', stableTarget, src, 'from=' + getDiagNodeId(element));
          stableTarget.classList.remove('mw-softblur');
          stableTarget.style.removeProperty('filter');
          stableTarget.style.removeProperty('-webkit-filter');
          stableTarget.style.removeProperty('backdrop-filter');
          stableTarget.style.removeProperty('-webkit-backdrop-filter');
          stableTarget.style.setProperty('filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
          stableTarget.style.setProperty('-webkit-filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
          stableTarget.style.setProperty('backdrop-filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
          stableTarget.style.setProperty('-webkit-backdrop-filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
          stableTarget.style.transition = 'filter 0.3s ease';
          stableTarget.dataset.mwModerated = 'blurred';
          stableTarget.dataset.mwCategory = category || element.dataset.mwCategory || 'flagged';
          stableTarget.dataset.mwSrc = src;
          stableTarget.dataset.mwItemId = itemId || element.dataset.mwItemId || '';
          if (resolvedSelector) stableTarget.dataset.mwShortsStableSelector = resolvedSelector;
          stableTarget.classList.add('mw-blurred');
          markAuthoritativeHardBlur(stableTarget, src);
          setShortsBlurContextForNode(
            stableTarget,
            src,
            category || element.dataset.mwCategory || 'flagged',
            itemId || element.dataset.mwItemId || '',
            resolvedBlurPx,
            resolvedSelector || null,
            'overlay_redirect_migrate'
          );
          diagNodeParentAtBlur.set(stableTarget, { parent: stableTarget.parentElement || null });
          diagShortsBlurStackLog('overlay_redirect_migrate_after', stableTarget, src, 'from=' + getDiagNodeId(element));
        }
        createRevealOverlay(stableTarget, src, category, itemId, false);
        return;
      }
    }
    if (!shortsMode && CONFIG.mvpPositiveCardOwnershipV1 && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
      // Authorization gate for overlay creation.
      // Fast path: an authoritative hard-blur stamp proves isMvpBlurAuthorized already ran
      // and passed at applyBlur time. This is the common case and avoids redundant work.
      // Slow path: if the stamp is absent (e.g. overlay heal on a <video> node that never
      // carried the stamp), fall back to the full isMvpBlurAuthorized check — now backed by
      // the more robust getMvpCardHrefItemKey that resolves home-feed yt-lockup-view-model
      // cards. This keeps negative-content protection intact rather than blindly bypassing it.
      if (!isAuthoritativeHardBlur(element)) {
        var overlayProof = 'none';
        if (!isMvpBlurAuthorized(element, src, getDiagItemKey(src), overlayProof, 'createRevealOverlay')) {
          return;
        }
      }
    }
    const attemptShortsReresolve = function(reason) {
      if (!allowReresolve) return false;
      const resolvedTargetInfo = resolveShortsStableBlurTarget(element, src);
      diagLogShortsTargetResolution('createRevealOverlay_reresolve:' + (reason || 'unknown'), element, src, resolvedTargetInfo);
      const resolvedTarget = resolvedTargetInfo && resolvedTargetInfo.target ? resolvedTargetInfo.target : null;
      const resolvedSelector = resolvedTargetInfo && resolvedTargetInfo.selectorUsed ? resolvedTargetInfo.selectorUsed : '';
      if (!resolvedTarget || resolvedTarget === element || !resolvedTarget.isConnected) return false;
      if (DIAG_YT_BLUR) {
        console.log(
          '[MW-YT][DIAG][OVERLAY]',
          'action=reresolve_target',
          'reason=' + (reason || 'unknown'),
          'fromNodeId=' + getDiagNodeId(element),
          'toNodeId=' + getDiagNodeId(resolvedTarget),
          'selector=' + (resolvedSelector || 'none'),
          'src=' + String(src || '').substring(0, 120)
        );
      }
      if (resolvedTarget.dataset.mwModerated !== 'blurred') {
        const desiredBlur = CONFIG.blurStrength || 30;
        const resolvedBlurPx = IS_YOUTUBE ? 40 : Math.min(desiredBlur, 20);
        diagShortsBlurStackLog('overlay_reresolve_before_clear', resolvedTarget, src, 'reason=' + (reason || 'unknown'));
        resolvedTarget.classList.remove('mw-softblur');
        resolvedTarget.style.removeProperty('filter');
        resolvedTarget.style.removeProperty('-webkit-filter');
        resolvedTarget.style.removeProperty('backdrop-filter');
        resolvedTarget.style.removeProperty('-webkit-backdrop-filter');
        diagShortsBlurStackLog('overlay_reresolve_after_clear', resolvedTarget, src, 'reason=' + (reason || 'unknown'));
        resolvedTarget.style.setProperty('filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
        resolvedTarget.style.setProperty('-webkit-filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
        resolvedTarget.style.setProperty('backdrop-filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
        resolvedTarget.style.setProperty('-webkit-backdrop-filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
        resolvedTarget.style.transition = 'filter 0.3s ease';
        resolvedTarget.dataset.mwModerated = 'blurred';
        resolvedTarget.dataset.mwCategory = category || 'flagged';
        resolvedTarget.dataset.mwSrc = src;
        resolvedTarget.dataset.mwItemId = itemId || '';
        resolvedTarget.dataset.mwShortsStableSelector = resolvedSelector || '';
        resolvedTarget.classList.add('mw-blurred');
        setShortsBlurContextForNode(
          resolvedTarget,
          src,
          category || 'flagged',
          itemId,
          resolvedBlurPx,
          resolvedSelector,
          'overlay_reresolve'
        );
        diagNodeParentAtBlur.set(resolvedTarget, { parent: resolvedTarget.parentElement || null });
        diagShortsBlurStackLog('overlay_reresolve_after_apply', resolvedTarget, src, 'reason=' + (reason || 'unknown'));
        diagLogBlurAppliedNodeDetails(resolvedTarget, src, category, itemId, resolvedSelector);
      }
      createRevealOverlay(resolvedTarget, src, category, itemId, false);
      return true;
    };
    diagBlurStateLog(
      'createRevealOverlay.enter',
      element,
      src,
      'itemId=' + (itemId || 'N/A') + ' category=' + (category || 'flagged')
    );
    diagNodeLifecycleLog(
      'createRevealOverlay.enter',
      element,
      'src=' + String(src || '').substring(0, 120) +
      ' hasOverlay=' + (element.dataset.mwHasOverlay === 'true')
    );
    ensureRevealDocClickCapture();
    ensureRevealTapInterceptor();
    if (element.dataset.mwModerated !== 'blurred') {
      removeRevealOverlay(element, src, 'createRevealOverlay_not_blurred');
      if (DIAG_YT_BLUR) {
        diagFailCaseLog(
          'overlay_without_blurred_state',
          element,
          src,
          'mwModerated=' + (element.dataset.mwModerated || 'none')
        );
      }
      return;
    }
    let shortsOwnerToken = '';
    if (shortsMode) {
      const activeContext = getShortsBlurContextForNode(element);
      const activeOwnerToken = activeContext && activeContext.ownerToken ? String(activeContext.ownerToken) : '';
      const elementOwnerToken = String(element.dataset.mwShortsOwnerToken || '');
      if (activeOwnerToken && elementOwnerToken && activeOwnerToken === elementOwnerToken) {
        // Happy path: tokens already agree.
        element.dataset.mwOwnerMismatchCount = '0';
        element.dataset.mwOwnerMismatchRetryScheduled = 'false';
        element.dataset.mwOwnerDeferCount = '0';
        element.dataset.mwOwnerDeferScheduled = 'false';
        shortsOwnerToken = activeOwnerToken;
      } else if (activeOwnerToken && !elementOwnerToken) {
        // Context token ready but not yet stamped on element (first-entry timing gap).
        element.dataset.mwShortsOwnerToken = activeOwnerToken;
        element.dataset.mwOwnerMismatchCount = '0';
        element.dataset.mwOwnerMismatchRetryScheduled = 'false';
        element.dataset.mwOwnerDeferCount = '0';
        element.dataset.mwOwnerDeferScheduled = 'false';
        shortsOwnerToken = activeOwnerToken;
      } else if (!activeOwnerToken && !elementOwnerToken) {
        // Neither token is ready — context has not been initialized for this element yet.
        // Try an immediate force-init first: in the common case (stableTarget redirected
        // from applyBlur) the container IS resolvable right now, so this costs 0ms.
        // Never call clearAllBlurAndOverlay here — blur must survive until context is ready.
        element.dataset.mwOwnerMismatchCount = '0';
        element.dataset.mwOwnerMismatchRetryScheduled = 'false';
        const existingShortsSelector = String(element.dataset.mwShortsStableSelector || '');
        setShortsBlurContextForNode(element, src, category || 'flagged', itemId, null, existingShortsSelector || null, 'createRevealOverlay_force_context');
        const forcedContext = getShortsBlurContextForNode(element);
        const forcedToken = forcedContext && forcedContext.ownerToken ? String(forcedContext.ownerToken) : '';
        const forcedElementToken = String(element.dataset.mwShortsOwnerToken || '');
        if (forcedToken && forcedElementToken && forcedToken === forcedElementToken) {
          // Immediate force-init succeeded — proceed with no latency.
          element.dataset.mwOwnerDeferCount = '0';
          element.dataset.mwOwnerDeferScheduled = 'false';
          shortsOwnerToken = forcedToken;
        } else {
          // Container not yet resolvable: defer briefly, then fail-closed to pairing burst.
          const deferCountRaw = Number(element.dataset.mwOwnerDeferCount || '0');
          const deferCount = Number.isFinite(deferCountRaw) ? deferCountRaw : 0;
          if (deferCount < 6) {
            element.dataset.mwOwnerDeferCount = String(deferCount + 1);
            if (element.dataset.mwOwnerDeferScheduled !== 'true') {
              element.dataset.mwOwnerDeferScheduled = 'true';
              element.__mwDeferTimerId = setTimeout(function() {
                element.__mwDeferTimerId = null;
                if (!isVisualModerationActive()) return;
                if (!element || element.nodeType !== 1 || !element.isConnected) return;
                if (element.dataset) element.dataset.mwOwnerDeferScheduled = 'false';
                if (String(element.dataset.mwModerated || '') !== 'blurred') return;
                createRevealOverlay(element, src, category, itemId, false);
              }, 50);
            }
            if (DIAG_YT_BLUR) {
              console.log(
                '[DIAG][REVEAL_OWNER] context_defer_scheduled',
                'node=' + getDiagNodeId(element),
                'deferCount=' + deferCount,
                'src=' + String(src || '').substring(0, 180)
              );
            }
            return;
          }
          // FREEZE-OVERRIDE: do NOT leave orphan blur. Force a provisional owner token
          // and continue into overlay create; pairing burst covers residual races.
          element.dataset.mwOwnerDeferCount = '0';
          element.dataset.mwOwnerDeferScheduled = 'false';
          try {
            setShortsBlurContextForNode(
              element,
              src,
              category || 'flagged',
              itemId,
              null,
              String(element.dataset.mwShortsStableSelector || '') || null,
              'createRevealOverlay_defer_exhausted_force'
            );
          } catch (e) {}
          const exhaustedCtx = getShortsBlurContextForNode(element);
          const exhaustedToken = exhaustedCtx && exhaustedCtx.ownerToken ? String(exhaustedCtx.ownerToken) : '';
          if (exhaustedToken) {
            element.dataset.mwShortsOwnerToken = exhaustedToken;
            shortsOwnerToken = exhaustedToken;
          } else {
            // Last resort provisional token so overlay attach is not blocked.
            const provisional = 'shorts_owner|provisional|' + getDiagNodeId(element) + '|' + String(src || '').substring(0, 64);
            element.dataset.mwShortsOwnerToken = provisional;
            shortsOwnerToken = provisional;
          }
          console.warn(
            '[DIAG][REVEAL_OWNER] context_force_proceed',
            'node=' + getDiagNodeId(element),
            'token=' + String(shortsOwnerToken || '').substring(0, 120),
            'src=' + String(src || '').substring(0, 180)
          );
          scheduleActiveShortsRevealPairingBurst(element, src, category, itemId, 'context_defer_exhausted');
          // Fall through to overlay creation with provisional/forced token.
        }
      } else {
        // Both tokens present but different — video transitioned mid-blur.
        const mismatchCountRaw = Number(element.dataset.mwOwnerMismatchCount || '0');
        const mismatchCount = Number.isFinite(mismatchCountRaw) ? mismatchCountRaw : 0;
        if (mismatchCount < 1) {
          element.dataset.mwOwnerMismatchCount = '1';
          if (element.dataset.mwOwnerMismatchRetryScheduled !== 'true') {
            element.dataset.mwOwnerMismatchRetryScheduled = 'true';
            element.__mwMismatchTimerId = setTimeout(function() {
              element.__mwMismatchTimerId = null;
              if (!isVisualModerationActive()) return;
              if (!element || element.nodeType !== 1 || !element.isConnected) return;
              if (element.dataset) {
                element.dataset.mwOwnerMismatchRetryScheduled = 'false';
              }
              if (String(element.dataset.mwModerated || '') !== 'blurred') return;
              createRevealOverlay(element, src, category, itemId, false);
            }, 120);
          }
          if (DIAG_YT_BLUR) {
            console.log(
              '[DIAG][REVEAL_OWNER] mismatch_retry_scheduled',
              'node=' + getDiagNodeId(element),
              'active=' + String(activeOwnerToken || '').substring(0, 120),
              'element=' + String(elementOwnerToken || '').substring(0, 120),
              'src=' + String(src || '').substring(0, 180)
            );
          }
          return;
        }
        // FREEZE-OVERRIDE (fail-closed): never unblur a positive on owner-token mismatch.
        // Align element token to the live active context (or provisional) and attach reveal.
        element.dataset.mwOwnerMismatchCount = '0';
        element.dataset.mwOwnerMismatchRetryScheduled = 'false';
        if (activeOwnerToken) {
          element.dataset.mwShortsOwnerToken = activeOwnerToken;
          shortsOwnerToken = activeOwnerToken;
        } else {
          try {
            setShortsBlurContextForNode(
              element,
              src,
              category || 'flagged',
              itemId,
              null,
              String(element.dataset.mwShortsStableSelector || '') || null,
              'createRevealOverlay_mismatch_force'
            );
          } catch (e) {}
          const fixed = getShortsBlurContextForNode(element);
          shortsOwnerToken = fixed && fixed.ownerToken ? String(fixed.ownerToken) : String(element.dataset.mwShortsOwnerToken || '');
          if (shortsOwnerToken) element.dataset.mwShortsOwnerToken = shortsOwnerToken;
        }
        console.warn(
          '[DIAG][REVEAL_OWNER] mismatch_force_align',
          'node=' + getDiagNodeId(element),
          'token=' + String(shortsOwnerToken || '').substring(0, 120)
        );
        scheduleActiveShortsRevealPairingBurst(element, src, category, itemId, 'owner_token_mismatch');
        // Fall through — do not clearAllBlurAndOverlay.
      }
    }
    if (DIAG_YT_BLUR && element.dataset.mwModerated !== 'blurred') {
      diagFailCaseLog(
        'overlay_without_blurred_state',
        element,
        src,
        'mwModerated=' + (element.dataset.mwModerated || 'none')
      );
    }
    const existingOverlay = findRevealOverlayForElement(element, src);
    if (existingOverlay) {
      element.dataset.mwHasOverlay = 'true';
      if (shortsMode) {
        const existingOwnerToken = String(existingOverlay.dataset.mwShortsOwnerToken || '');
        if (!shortsOwnerToken || existingOwnerToken !== shortsOwnerToken) {
          // FAIL-CLOSED (C2b): an overlay bookkeeping mismatch must never
          // unblur a positive. Discard the stale overlay (dead instance /
          // node-id collision / prior Short) and rebuild a fresh one for the
          // still-blurred element. Recursion is bounded: with the stale
          // overlay removed, the retry cannot re-enter this branch.
          try {
            if (existingOverlay.parentElement) {
              existingOverlay.parentElement.removeChild(existingOverlay);
            }
          } catch (e) {}
          element.dataset.mwHasOverlay = 'false';
          console.log(
            '[DIAG][REVEAL_UI] overlay_replaced_stale_owner',
            'node=' + getDiagNodeId(element),
            'existingToken=' + existingOwnerToken.substring(0, 120),
            'currentToken=' + String(shortsOwnerToken || '').substring(0, 120)
          );
          createRevealOverlay(element, src, category, itemId, false);
          return;
        }
      }
      existingOverlay.dataset.mwFor = src;
      existingOverlay.dataset.mwNodeId = getDiagNodeId(element);
      if (shortsMode && shortsOwnerToken) {
        existingOverlay.dataset.mwShortsOwnerToken = shortsOwnerToken;
        element.dataset.mwOverlayOwnerToken = shortsOwnerToken;
      }
      existingOverlay.style.pointerEvents = 'none';
      existingOverlay.style.display = 'flex';
      if (usePortalOverlay) {
        setRevealOverlayAnchorTarget(existingOverlay, element, 'existing_overlay');
        const portal = ensureRevealPortal();
        existingOverlay.dataset.mwPortalMode = 'shorts';
        if (portal && existingOverlay.parentElement !== portal) {
          portal.appendChild(existingOverlay);
        }
        if (portal) {
          const activeOverlays = portal.querySelectorAll('.mw-reveal-overlay');
          for (let i = 0; i < activeOverlays.length; i += 1) {
            const active = activeOverlays[i];
            if (!active || active === existingOverlay) continue;
            if (active.parentElement) {
              active.parentElement.removeChild(active);
            }
          }
        }
        positionShortsRevealOverlay(existingOverlay, element, 'existing_overlay');
        scheduleShortsRevealOverlayReposition('existing_overlay');
        console.log('[DIAG][REVEAL_UI] portal_update', 'portal_mode=shorts', 'itemKey=' + getDiagItemKey(src));
      } else {
        const nonShortsOverlayParent = resolveNonShortsRevealOverlayParent(element) || element.parentElement;
        if (nonShortsOverlayParent) {
          try {
            const parentPos = window.getComputedStyle(nonShortsOverlayParent).position;
            if (parentPos === 'static') {
              nonShortsOverlayParent.style.position = 'relative';
            }
          } catch (e) {}
          if (existingOverlay.parentElement !== nonShortsOverlayParent) {
            nonShortsOverlayParent.appendChild(existingOverlay);
          }
        }
        setRevealOverlayAnchorTarget(existingOverlay, element, 'existing_overlay');
        existingOverlay.style.cssText = [
          'position: absolute',
          'inset: 0',
          'display: flex',
          'align-items: center',
          'justify-content: center',
          'background: rgba(0, 0, 0, 0.06)',
          'z-index: 9998',
          'cursor: default',
          'pointer-events: none',
        ].join(';');
        const existingButton = existingOverlay.querySelector ? existingOverlay.querySelector('.mw-reveal-btn') : null;
        if (existingButton && existingButton.nodeType === 1) {
          existingButton.textContent = 'Reveal';
          existingButton.style.cssText = [
            'background: rgba(255,255,255,0.15)',
            'backdrop-filter: blur(20px) saturate(180%)',
            '-webkit-backdrop-filter: blur(20px) saturate(180%)',
            'border: 1px solid rgba(255,255,255,0.35)',
            'border-radius: 20px',
            'box-shadow: 0 2px 16px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.25)',
            'color: rgba(255,255,255,0.92)',
            'font-size: 13px',
            'font-weight: 600',
            'letter-spacing: 0.04em',
            'padding: 8px 20px',
            'text-shadow: 0 1px 4px rgba(0,0,0,0.5)',
            'cursor: pointer',
            'pointer-events: auto',
            'max-width: calc(100% - 16px)',
            'box-sizing: border-box',
            'white-space: nowrap',
            'overflow: hidden',
            'text-overflow: ellipsis',
          ].join(';');
        }
        positionNonShortsRevealOverlay(existingOverlay, element, 'existing_overlay');
        scheduleNonShortsRevealOverlayReposition('existing_overlay');
      }
      enforceRevealOverlayVisibilityGuard(existingOverlay, element, 'createRevealOverlay_reuse');
      return;
    }
    if (element.dataset.mwHasOverlay === 'true') {
      element.dataset.mwHasOverlay = 'false';
    }
    if (!element.isConnected) {
      if (attemptShortsReresolve('disconnected')) return;
      diagNodeLifecycleLog('createRevealOverlay.skip_disconnected', element, '');
      diagLog(
        'overlay-disconnected',
        'overlay-skip hasParent=' + (!!element.parentElement) +
        ' connected=false tag=' + (element.tagName || 'unknown') +
        ' srcType=' + (element.dataset.mwSourceType || 'unknown') +
        ' hint=' + describeElementHint(element)
      );
      if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
        console.log(
          '[DIAG][MVP_ITEM_CHAIN] stage=reveal_skip',
          'itemId=' + (itemId || 'none'),
          'itemKey=' + getDiagItemKey(src),
          'reason=disconnected',
          'nodeId=' + getDiagNodeId(element)
        );
      }
      return;
    }
    const parent = element.parentElement;
    if (!shortsMode && !parent) {
      if (attemptShortsReresolve('missing_parent')) return;
      diagNodeLifecycleLog('createRevealOverlay.skip_no_parent', element, '');
      diagLog(
        'overlay-no-parent',
        'overlay-skip hasParent=false connected=' + (!!element.isConnected) +
        ' tag=' + (element.tagName || 'unknown') +
        ' srcType=' + (element.dataset.mwSourceType || 'unknown') +
        ' hint=' + describeElementHint(element)
      );
      console.log(
        '[DIAG][MVP_ITEM_CHAIN] stage=reveal_skip',
        'itemId=' + (itemId || 'none'),
        'itemKey=' + getDiagItemKey(src),
        'reason=no_parent',
        'nodeId=' + getDiagNodeId(element)
      );
      return;
    }
    const overlayParent = usePortalOverlay ? ensureRevealPortal() : (resolveNonShortsRevealOverlayParent(element) || parent);
    if (!overlayParent) return;
    const overlayCountBefore = document.querySelectorAll('.mw-reveal-overlay').length;
    const itemKey = getDiagItemKey(src);
    let parentLooksBlurred = false;
    try {
      const parentInlineFilter = String(overlayParent.style.getPropertyValue('filter') || overlayParent.style.filter || '').toLowerCase();
      const parentInlineBackdrop = String(overlayParent.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
      parentLooksBlurred =
        parentInlineFilter.includes('blur(') ||
        parentInlineBackdrop.includes('blur(') ||
        overlayParent.classList.contains('mw-blurred') ||
        overlayParent.classList.contains('mw-softblur') ||
        overlayParent.dataset.mwModerated === 'blurred' ||
        overlayParent.dataset.mwModerated === 'softblur';
    } catch (e) {}
    console.log(
      '[DIAG][REVEAL_LAYER] overlay_parent=' + getDiagTargetDescriptor(overlayParent),
      'blurred_parent=' + parentLooksBlurred,
      'parentNode=' + getDiagNodeId(overlayParent),
      'targetNode=' + getDiagNodeId(element)
    );
    if (!usePortalOverlay) {
      const parentPos = window.getComputedStyle(overlayParent).position;
      if (parentPos === 'static') {
        overlayParent.style.position = 'relative';
      }
    }
    
    const overlay = document.createElement('div');
    diagRevealOverlaySeq += 1;
    const overlayId = 'mwov_' + Date.now().toString(36) + '_' + diagRevealOverlaySeq;
    overlay.className = 'mw-reveal-overlay';
    overlay.dataset.mwFor = src;
    overlay.dataset.mwNodeId = getDiagNodeId(element);
    if (usePortalOverlay) {
      overlay.dataset.mwPortalMode = 'shorts';
    }
    if (shortsMode && shortsOwnerToken) {
      overlay.dataset.mwShortsOwnerToken = shortsOwnerToken;
      element.dataset.mwOverlayOwnerToken = shortsOwnerToken;
    }
    overlay.dataset.mwOverlayId = overlayId;
    setRevealOverlayAnchorTarget(overlay, element, 'overlay_created');
    overlay.style.cssText = [
      usePortalOverlay ? 'position: fixed' : 'position: absolute',
      'inset: 0',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      usePortalOverlay ? 'background: transparent' : (shortsMode ? 'background: rgba(0, 0, 0, 0.15)' : 'background: rgba(0, 0, 0, 0.06)'),
      usePortalOverlay ? 'z-index: auto' : 'z-index: 9998',
      'cursor: default',
      'pointer-events: none',
    ].join(';');
    console.log(
      '[DIAG][REVEAL_UI] created',
      'overlayId=' + overlayId,
      'itemKey=' + itemKey,
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch
    );
    if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
      console.log(
        '[DIAG][MVP_ITEM_CHAIN] stage=reveal_created',
        'itemId=' + (itemId || 'none'),
        'itemKey=' + itemKey,
        'nodeId=' + getDiagNodeId(element),
        'overlayId=' + overlayId
      );
    }
    if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
      console.log(
        '[DIAG][MVP_NON_SHORTS] reveal_control_created',
        'overlayId=' + overlayId,
        'targetNode=' + getDiagNodeId(element),
        'itemKey=' + itemKey,
        'pageEpoch=' + state.pageEpoch
      );
    }
    
    const btn = document.createElement('button');
    btn.className = 'mw-reveal-btn';
    btn.textContent = 'Reveal';
    btn.style.cssText = [
      'background: rgba(255,255,255,0.15)',
      'backdrop-filter: blur(20px) saturate(180%)',
      '-webkit-backdrop-filter: blur(20px) saturate(180%)',
      'border: 1px solid rgba(255,255,255,0.35)',
      'border-radius: 20px',
      'box-shadow: 0 2px 16px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.25)',
      'color: rgba(255,255,255,0.92)',
      'font-size: 13px',
      'font-weight: 600',
      'letter-spacing: 0.04em',
      'padding: 8px 20px',
      'text-shadow: 0 1px 4px rgba(0,0,0,0.5)',
      'cursor: pointer',
      'pointer-events: auto',
      'max-width: calc(100% - 16px)',
      'box-sizing: border-box',
      'white-space: nowrap',
      'overflow: hidden',
      'text-overflow: ellipsis',
    ].join(';');

    overlay.addEventListener('click', function(e) {
      let overlayComputed = null;
      try {
        overlayComputed = window.getComputedStyle(overlay);
      } catch (err) {}
      console.log(
        '[DIAG][REVEAL_EVT] overlay_click',
        'overlayId=' + overlayId,
        'target=' + getDiagTargetDescriptor(e.target),
        'x/y=' + (Number.isFinite(e.clientX) ? e.clientX : 'n/a') + '/' + (Number.isFinite(e.clientY) ? e.clientY : 'n/a'),
        'pointerEvents=' + (overlayComputed ? overlayComputed.pointerEvents : 'n/a')
      );
      if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
        console.log(
          '[DIAG][MVP_REVEAL_PATH] tap_received',
          'channel=overlay',
          'overlayId=' + overlayId,
          'itemKey=' + itemKey
        );
      }
      logRevealHittestSnapshot(overlay, btn, overlayId, 'overlay_click', e);
    });
    console.log('[DIAG][REVEAL_UI] bind_overlay', 'overlayId=' + overlayId);
    
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      // overlay.__mwAnchorTarget is kept current by setRevealOverlayAnchorTarget every
      // time the overlay is reattached to a recycled card node (homepage infinite scroll
      // recycles ytm-rich-item-renderer DOM nodes, making the original closure element
      // stale and disconnected). We check data-mw-moderated so a recycled-but-connected
      // node that now holds a different (non-blurred) video is not used as the target.
      const anchorLive = overlay.__mwAnchorTarget;
      let liveElement = (
        anchorLive && anchorLive.nodeType === 1 &&
        anchorLive.isConnected &&
        String((anchorLive.dataset && anchorLive.dataset.mwModerated) || '') === 'blurred'
      ) ? anchorLive : null;
      if (!liveElement) {
        const srcStr = String(src || '');
        const blurredAll = document.querySelectorAll('[data-mw-moderated="blurred"]');
        for (let _bi = 0; _bi < blurredAll.length; _bi++) {
          const _bc = blurredAll[_bi];
          if (_bc && _bc.isConnected && String((_bc.dataset && _bc.dataset.mwSrc) || '') === srcStr) {
            liveElement = _bc;
            if (anchorLive && anchorLive.nodeType === 1) {
              setRevealOverlayAnchorTarget(overlay, _bc, 'click_dom_search');
            }
            break;
          }
        }
      }
      if (!liveElement) liveElement = element;
      const portalMode = String((overlay.dataset && overlay.dataset.mwPortalMode) || '');
      console.log(
        '[DIAG][REVEAL_EVT] button_click',
        'overlayId=' + overlayId,
        'portal_mode=' + (portalMode || (shortsMode ? 'shorts' : 'none')),
        'target=' + getDiagTargetDescriptor(e.target)
      );
      if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
        console.log(
          '[DIAG][MVP_REVEAL_PATH] tap_received',
          'channel=button',
          'portal_mode=' + (portalMode || 'none'),
          'overlayId=' + overlayId,
          'itemKey=' + itemKey
        );
      }
      logRevealHittestSnapshot(overlay, btn, overlayId, 'button_click', e);
      const revealMeta = getRevealMetaForSource(src, liveElement);
      const revealAllowed = !revealMeta.meta;
      const revealGateReason = revealAllowed ? 'not_revealed' : 'already_revealed_reblur_path';
      console.log(
        '[DIAG][REVEAL_EVT] reveal_allowed=' + revealAllowed,
        'reason=' + revealGateReason,
        'overlayId=' + overlayId,
        'itemKey=' + itemKey,
        'revealKey=' + revealMeta.key
      );

      if (!revealAllowed) {
        // Re-blur
        const sinceRevealMs = revealMeta.meta ? (Date.now() - Number(revealMeta.meta.revealedAt || Date.now())) : null;
        unmarkRevealedForSource(src, liveElement, 'manual_hide');
        applyBlur(liveElement, src, category, CONFIG.blurStrength, itemId);
        btn.textContent = '👁 Reveal';
        overlay.style.display = 'flex';
        console.log(
          '[DIAG][REVEAL_EVT] reblur_applied',
          'overlayId=' + overlayId,
          'itemKey=' + itemKey,
          'revealKey=' + revealMeta.key,
          'reblur_reason=manual_hide',
          'sinceRevealMs=' + (sinceRevealMs === null ? 'n/a' : String(sinceRevealMs))
        );
      } else {
        // Reveal and trigger feedback
        const beforeBlurCount = countBlurredNodesForItemKey(src);
        console.log(
          '[DIAG][REVEAL_EVT] reveal_apply_start',
          'overlayId=' + overlayId,
          'itemKey=' + itemKey,
          'beforeBlurCount=' + beforeBlurCount
        );
        const revealApplied = markRevealedForSource(src, liveElement, 'manual_reveal');
        // Shorts MVP: a single tap should fully reveal and clear the overlay
        // to avoid a second tap requirement on active shorts.
        removeBlur(liveElement, src, { keepOverlay: false });
        // Remove the owned-card CSS class so the "filter: blur(40px) !important"
        // rule on .mw-owned-positive-card no longer overrides the reveal.
        // applyOwnedSafeCardClass guards against Shorts/non-main-page internally.
        const revealOwnerCard = getOwnedCardContainerFromNode(liveElement);
        if (revealOwnerCard) {
          applyOwnedSafeCardClass(revealOwnerCard, 'manual_reveal');
        }
        const afterBlurCount = countBlurredNodesForItemKey(src);
        const removedBlurCount = beforeBlurCount > afterBlurCount ? (beforeBlurCount - afterBlurCount) : 0;
        console.log(
          '[DIAG][REVEAL_EVT] reveal_apply_done',
          'overlayId=' + overlayId,
          'itemKey=' + itemKey,
          'removedBlurCount=' + removedBlurCount,
          'revealKey=' + revealApplied.key,
          'holdMs=' + String(revealApplied.holdMs || 0)
        );
        
        // Keep second-tap playback clear on YouTube main-page MVP surfaces by skipping
        // immediate label/correction UI that can steal the next user tap.
        const suppressImmediateLabelUi =
          !shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href);
        if (!suppressImmediateLabelUi) {
          // POST a label request message so the host can open the labeling modal
          var labelItemId = itemId || liveElement.dataset.mwItemId || 'unknown_' + Date.now();
          var mwModelVersion = liveElement.dataset.mwModelVersion || null;
          var mwDecisionReason = liveElement.dataset.mwDecisionReason || null;
          var mwNsfwRisk = toFiniteNumber(liveElement.dataset.mwNsfwRisk);
          var mwPersonPresent = liveElement.dataset.mwPersonPresent === '1';
          var mwSkinRatio = toFiniteNumber(liveElement.dataset.mwSkinRatio);
          var mwThirstScore = toFiniteNumber(liveElement.dataset.mwThirstScore);
          var mwSkinThreshold = toFiniteNumber(liveElement.dataset.mwSkinThreshold);
          var mwGrayMin = toFiniteNumber(liveElement.dataset.mwGrayZoneMin);
          var mwGrayMax = toFiniteNumber(liveElement.dataset.mwGrayZoneMax);
          var mwExplicitOverride = toFiniteNumber(liveElement.dataset.mwExplicitOverride);
          var mwImageWidth = toFiniteNumber(liveElement.dataset.mwImageWidth);
          var mwImageHeight = toFiniteNumber(liveElement.dataset.mwImageHeight);
          var mwHost = liveElement.dataset.mwHost || null;
          var labelRequest = {
            type: 'gc-label-request',
            requestId: 'r_' + Date.now().toString(36),
            itemId: labelItemId,
            src: src,
            pageUrl: window.location.href,
            platform: PLATFORM,
            modelPrediction: {
              category: category,
              confidence: toFiniteNumber(liveElement.dataset.mwConfidence),
              model_version: mwModelVersion,
              thresholds: {
                nsfw_gray_zone_min: mwGrayMin,
                nsfw_gray_zone_max: mwGrayMax,
                explicit_override: mwExplicitOverride,
                skin_ratio: mwSkinThreshold,
              },
              predictions: {
                nsfwRisk: mwNsfwRisk,
                personPresent: mwPersonPresent,
                skinRatio: mwSkinRatio,
                thirstScore: mwThirstScore,
              },
              decision_reason: mwDecisionReason,
              image_width: mwImageWidth,
              image_height: mwImageHeight,
              host: mwHost,
              timestamp: Date.now(),
            }
          };
          console.log('[MW] posting gc-label-request', labelItemId);
          postToHost(labelRequest);
          
          // Show brief correction overlay
          showCorrectionOverlay(element, src, category, labelItemId);
        }
      }
    });
    console.log('[DIAG][REVEAL_UI] bind_button', 'overlayId=' + overlayId);
    // iOS touch capture: fire reveal via touchend so YouTube card/anchor
    // touchstart handlers cannot intercept the tap before our click fires.
    // This fixes home-feed regular video and all Shorts-shelf thumbnails where
    // ytm-rich-item-renderer / <a href="/shorts/..."> consume the touch first.
    var _mwBtnTouchX = 0, _mwBtnTouchY = 0;
    btn.addEventListener('touchstart', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var t = e.touches && e.touches[0];
      _mwBtnTouchX = t ? t.clientX : 0;
      _mwBtnTouchY = t ? t.clientY : 0;
    }, { passive: false });
    btn.addEventListener('touchend', function(e) {
      var t = e.changedTouches && e.changedTouches[0];
      if (t) {
        var dx = Math.abs(t.clientX - _mwBtnTouchX);
        var dy = Math.abs(t.clientY - _mwBtnTouchY);
        if (dx > 12 || dy > 12) return;
      }
      e.preventDefault();
      e.stopPropagation();
      btn.dispatchEvent(new MouseEvent('click', { bubbles: false, cancelable: true, view: window }));
    }, { passive: false });
    overlay.dataset.mwRevealHandlersBound = 'true';
    
    overlay.appendChild(btn);
    if (shortsMode) {
      const activeOverlays = overlayParent.querySelectorAll('.mw-reveal-overlay');
      for (let i = 0; i < activeOverlays.length; i += 1) {
        const active = activeOverlays[i];
        if (!active || active === overlay) continue;
        if (active.parentElement) {
          active.parentElement.removeChild(active);
        }
      }
      positionShortsRevealOverlay(overlay, element, 'overlay_created');
      scheduleShortsRevealOverlayReposition('overlay_created');
      console.log('[DIAG][REVEAL_UI] portal_update', 'portal_mode=shorts', 'itemKey=' + itemKey);
    }
    overlayParent.appendChild(overlay);
    if (!shortsMode) {
      ensureRevealOverlayPositionListeners();
      positionNonShortsRevealOverlay(overlay, element, 'overlay_created');
      scheduleNonShortsRevealOverlayReposition('overlay_created');
      // Disable the nearest <a> ancestor so WKWebView's native link-tap pipeline
      // cannot intercept touches meant for the reveal button. Covers both regular
      // video cards (<a href="/watch?v=...">) and Shorts shelf (<a href="/shorts/...">).
      // The anchor is restored in removeRevealOverlay when the overlay is torn down.
      var _anchorGuard = (typeof overlayParent.closest === 'function')
        ? overlayParent.closest('a[href]')
        : null;
      if (!_anchorGuard && typeof element.closest === 'function') {
        _anchorGuard = element.closest('a[href]');
      }
      var _cardForGuard = (typeof element.closest === 'function')
        ? (element.closest('yt-lockup-view-model') ||
           element.closest('ytm-rich-item-renderer') ||
           element.closest('ytd-rich-item-renderer') ||
           element.closest('ytm-compact-video-renderer') ||
           element.closest('ytm-video-with-context-renderer'))
        : null;
      if (_cardForGuard) {
        console.log(
          '[DIAG][HOME_FEED_REVEAL] card_detected',
          'cardTag=' + String(_cardForGuard.tagName || '').toLowerCase(),
          'cardNodeId=' + getDiagNodeId(_cardForGuard),
          'itemKey=' + itemKey,
          'ancestorAnchorFound=' + String(!!_anchorGuard)
        );
      }
      if (!_anchorGuard && _cardForGuard && typeof _cardForGuard.querySelector === 'function') {
        // Fallback for home-feed ytm-rich-item-renderer / yt-lockup-view-model where the
        // <a> navigation anchor is not an ancestor of the thumbnail but lives as a
        // sibling or child within the card. Search the nearest card container.
        _anchorGuard = _cardForGuard.querySelector('a[href*="/watch"], a[href*="/shorts/"]');
        // Open Shadow DOM attempt (closed roots return null → harmless).
        if (!_anchorGuard && _cardForGuard.shadowRoot && typeof _cardForGuard.shadowRoot.querySelector === 'function') {
          _anchorGuard = _cardForGuard.shadowRoot.querySelector('a[href*="/watch"], a[href*="/shorts/"]');
        }
        console.log(
          '[DIAG][HOME_FEED_REVEAL] anchor_guard_fallback',
          'cardNodeId=' + getDiagNodeId(_cardForGuard),
          'anchorFound=' + String(!!_anchorGuard),
          'viaShadow=' + String(!!(_anchorGuard && _cardForGuard.shadowRoot && _cardForGuard.shadowRoot.contains && _cardForGuard.shadowRoot.contains(_anchorGuard)))
        );
      }
      if (_anchorGuard && _anchorGuard.nodeType === 1) {
        overlay.__mwAnchorGuard = _anchorGuard;
        overlay.__mwAnchorGuardPE = String(_anchorGuard.style.pointerEvents || '');
        _anchorGuard.style.pointerEvents = 'none';
      }
    }
    element.dataset.mwHasOverlay = 'true';
    if (!enforceRevealOverlayVisibilityGuard(overlay, element, 'createRevealOverlay_created')) {
      return;
    }
    const overlayCountAfter = document.querySelectorAll('.mw-reveal-overlay').length;
    console.log(
      '[DIAG][REVEAL_UI] overlay_count_before=' + overlayCountBefore,
      'overlay_count_after=' + overlayCountAfter,
      'overlayId=' + overlayId
    );
    logRevealHittestSnapshot(overlay, btn, overlayId, 'created', null);
    if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
      var overlayStyle = null;
      var overlayRect = null;
      try {
        overlayStyle = window.getComputedStyle(overlay);
      } catch (e) {}
      try {
        overlayRect = overlay.getBoundingClientRect();
      } catch (e) {}
      console.log(
        '[DIAG][MVP_REVEAL_PATH] reveal_dom_state',
        'itemId=' + (itemId || 'none'),
        'itemKey=' + itemKey,
        'suppressed=false',
        'overlayPresent=' + String(!!overlay),
        'overlayConnected=' + String(!!overlay.isConnected),
        'overlayDisplay=' + (overlayStyle ? overlayStyle.display : 'n/a'),
        'overlayVisibility=' + (overlayStyle ? overlayStyle.visibility : 'n/a'),
        'overlayOpacity=' + (overlayStyle ? overlayStyle.opacity : 'n/a'),
        'overlayZ=' + (overlayStyle ? overlayStyle.zIndex : 'n/a'),
        'overlayPointer=' + (overlayStyle ? overlayStyle.pointerEvents : 'n/a'),
        'overlayRect=' + (overlayRect ? (Math.round(overlayRect.width) + 'x' + Math.round(overlayRect.height)) : 'n/a'),
        'parentConnected=' + String(!!(overlayParent && overlayParent.isConnected)),
        'handlersBound=' + String(overlay.dataset.mwRevealHandlersBound === 'true')
      );
    }
    diagBlurStateLog(
      'createRevealOverlay.exit',
      element,
      src,
      'itemId=' + (itemId || 'N/A') + ' category=' + (category || 'flagged')
    );
    diagNodeLifecycleLog(
      'createRevealOverlay.attached_target',
      element,
      'src=' + String(src || '').substring(0, 120) +
      ' overlayConnected=' + (!!overlay.isConnected)
    );
    diagNodeLifecycleLog(
      'createRevealOverlay.attached_overlay',
      overlay,
      'forNodeId=' + getDiagNodeId(element)
    );
  }

  /**
   * Show brief "Correct?" overlay after reveal to encourage feedback
   */
  function showCorrectionOverlay(element, src, category, itemId) {
    const parent = element.parentElement;
    if (!parent) return;
    
    // Create a small non-intrusive overlay
    const correctionDiv = document.createElement('div');
    correctionDiv.className = 'mw-correction-overlay';
    correctionDiv.style.cssText = [
      'position: absolute',
      'bottom: 8px',
      'right: 8px',
      'background: rgba(0, 0, 0, 0.85)',
      'color: white',
      'padding: 6px 10px',
      'border-radius: 6px',
      'font-size: 11px',
      'display: flex',
      'gap: 8px',
      'align-items: center',
      'z-index: 10000',
      'transition: opacity 0.3s ease',
    ].join(';');
    
    correctionDiv.innerHTML = \`
      <span>Was this correct?</span>
      <button class="mw-correct-btn" data-correct="true" style="background: #22c55e; border: none; padding: 4px 8px; border-radius: 4px; color: white; cursor: pointer;">👍</button>
      <button class="mw-correct-btn" data-correct="false" style="background: #ef4444; border: none; padding: 4px 8px; border-radius: 4px; color: white; cursor: pointer;">👎</button>
    \`;
    
    // Handle feedback clicks
    correctionDiv.querySelectorAll('.mw-correct-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const isCorrect = this.dataset.correct === 'true';
        
        // Post correction event
        var correctionEvent = {
          type: 'gc-correction-feedback',
          itemId: itemId,
          src: src,
          originalCategory: category,
          wasCorrect: isCorrect,
          timestamp: Date.now(),
          platform: PLATFORM,
        };
        console.log('[MW] posting correction feedback:', isCorrect ? 'correct' : 'incorrect');
        postToHost(correctionEvent);
        
        // Remove the overlay
        correctionDiv.style.opacity = '0';
        setTimeout(() => correctionDiv.remove(), 300);
      });
    });
    
    parent.appendChild(correctionDiv);
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      if (correctionDiv.parentElement) {
        correctionDiv.style.opacity = '0';
        setTimeout(() => correctionDiv.remove(), 300);
      }
    }, 5000);
  }

  // ==================== POSTMESSAGE PROTOCOL ====================

  /**
   * Send a batch of items to the host for moderation
   * Includes security nonce for response validation
   */
  function sendModerationRequest(items) {
    if (items.length === 0) return;
    
    const requestId = generateRequestId();
    const timestamp = Date.now();
    const sovereignId = [
      getSovereignNavToken(),
      String(state.pageEpoch || 0),
      String(getCurrentShortsUrlId() || 'none'),
    ].join('|');
    if (isShortsModeActive()) {
      console.log(
        '[DIAG][SHORTS_SCAN] scanBatch_start',
        'requestId=' + requestId,
        'itemCount=' + items.length
      );
      if (diagLastShortsScanBatchStartAt > 0) {
        console.log(
          '[DIAG][SHORTS_SCAN] delta_since_last_scan=' + (timestamp - diagLastShortsScanBatchStartAt) + 'ms',
          'requestId=' + requestId
        );
      }
      diagLastShortsScanBatchStartAt = timestamp;
      diagScanBatchStartAtByRequestId.set(requestId, timestamp);
    }
    
    const message = {
      type: 'gc-moderation-request',
      requestId: requestId,
      items: items.map(item => ({
        itemId: item.itemId,
        src: item.src,
        sourceType: item.sourceType,
        width: item.width,
        height: item.height,
      })),
      thresholds: getRequestThresholdsForSurface(),
      pageEpoch: state.pageEpoch,
      sovereignId: sovereignId,
      nonce: CONFIG.nonce,
      timestamp: timestamp,
    };

    // Store pending request for timeout handling
    const timeoutId = setTimeout(() => {
      handleRequestTimeout(requestId);
    }, CONFIG.requestTimeout);

    state.pendingRequests.set(requestId, {
      items: items,
      pageEpoch: state.pageEpoch,
      sovereignId: sovereignId,
      timestamp: timestamp,
      timeoutId: timeoutId,
      state: 'waitingForHost',
    });

    state.stats.requestsSent++;
    warnProfileOriginShortsDiag(
      'moderation_request_sent',
      'requestId=' + requestId +
      ' itemCount=' + items.length +
      ' sourceTypes=' + items.map(item => item.sourceType || 'unknown').join(',').substring(0, 160) +
      ' sovereignId=' + String(sovereignId || 'none').substring(0, 220) +
      ' thresholds=' + JSON.stringify(getRequestThresholdsForSurface()),
      { throttleMs: 0, force: isShortsModeActive() }
    );

    // Shorts reliability fallback: mirror requests into legacy queue so host probe
    // can recover when postMessage events are dropped during rapid in-app nav churn.
    if (isShortsModeActive()) {
      try {
        window.__MW_LEGACY_QUEUE_PRODUCER__ = 'shorts_mirror';
        if (!Array.isArray(window.__GC_SCAN_QUEUE__)) {
          window.__GC_SCAN_QUEUE__ = [];
        }
        const legacyQueue = window.__GC_SCAN_QUEUE__;
        if (Array.isArray(legacyQueue)) {
          const cappedItems = items.slice(0, 5).map(item => ({
            itemId: item.itemId,
            src: item.src,
            sourceType: item.sourceType,
            width: item.width,
            height: item.height,
            thresholds: getRequestThresholdsForSurface(),
            requestId: requestId,
            pageEpoch: state.pageEpoch,
            sovereignId: sovereignId,
            nonce: CONFIG.nonce,
            timestamp: timestamp,
          }));
          for (let i = 0; i < cappedItems.length; i += 1) {
            legacyQueue.push(cappedItems[i]);
          }
          if (legacyQueue.length > 40) {
            legacyQueue.splice(0, legacyQueue.length - 40);
          }
          if (CONFIG.debug) {
            console.log('[MW][LegacyMirror] queued', cappedItems.length, 'items', 'requestId=' + requestId);
          }
        }
      } catch (e) {}
    }
    
    console.log('[MW] request sent', requestId, 'items=' + items.length, items.map(i => i.src.substring(0, 40)));
    console.log(
      '[MW][REQ] MW_REQ_SENT',
      'requestId=' + requestId,
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch,
      'noncePrefix=' + NONCE_PREFIX,
      'items=' + items.length,
    );
    postToHost({
      type: 'MW_REQ_SENT',
      requestId: requestId,
      navId: NAV_ID,
      pageEpoch: state.pageEpoch,
      sovereignId: sovereignId,
      noncePrefix: NONCE_PREFIX,
      itemCount: items.length,
      timestamp: timestamp,
    });
    console.log('[MW] waiting response', requestId, 'ts=' + timestamp);
    
    postToHost(message);
  }

  function cleanupRejectedOrTimedOutRequest(requestId, reason) {
    if (!isShortsModeActive()) return;
    diagScanBatchStartAtByRequestId.delete(requestId);
    const pendingRequest = state.pendingRequests.get(requestId);
    if (!pendingRequest || !Array.isArray(pendingRequest.items)) return;
    let cleanedElements = 0;
    pendingRequest.items.forEach(item => {
      const element = state.elements.get(item.itemId);
      if (element && element.isConnected) {
        const removed = removeSoftBlur(element, item.src);
        if (removed) cleanedElements += 1;
      }
      findAndRemoveSoftBlur(item.src);
      clearPendingItem(item.itemId, reason || 'request_reject_cleanup');
    });
    state.pendingRequests.delete(requestId);
    if (DIAG_YT_BLUR) {
      console.warn(
        '[MW-YT][DIAG][REJECT_CLEANUP]',
        'requestId=' + requestId,
        'reason=' + (reason || 'unknown'),
        'items=' + pendingRequest.items.length,
        'cleanedElements=' + cleanedElements,
        'url=' + window.location.href
      );
    }
  }

  /**
   * Handle timeout for pending request
   * FAIL-OPEN by default: Do NOT apply blur on timeout
   */
  function handleRequestTimeout(requestId) {
    const pendingRequest = state.pendingRequests.get(requestId);
    if (!pendingRequest) return;
    if (pendingRequest.state === 'handled') return;
    diagScanBatchStartAtByRequestId.delete(requestId);
    if (Number.isFinite(pendingRequest.pageEpoch) && pendingRequest.pageEpoch !== state.pageEpoch) {
      logShortsScanSkip('epoch_mismatch', null, 'request:' + String(requestId || 'none'), 'timeout');
      cleanupRejectedOrTimedOutRequest(requestId, 'timeout_epoch_mismatch');
      return;
    }
    
    pendingRequest.state = 'timeout';
    
    console.log('[MW] timeout', requestId, 'items=' + pendingRequest.items.length);
    console.warn(
      '[MW][REQ] MW_REQ_TIMEOUT',
      'requestId=' + requestId,
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch,
      'noncePrefix=' + NONCE_PREFIX,
      'items=' + pendingRequest.items.length,
    );
    postToHost({
      type: 'MW_REQ_TIMEOUT',
      requestId: requestId,
      navId: NAV_ID,
      pageEpoch: state.pageEpoch,
      sovereignId: String(pendingRequest.sovereignId || ''),
      noncePrefix: NONCE_PREFIX,
      itemCount: pendingRequest.items.length,
      timestamp: Date.now(),
    });
    state.stats.timeouts += pendingRequest.items.length;
    
    const timeoutPolicy = applyFailOpenAndModePolicy(false, 'timeout', 'timeout', true);
    if (CONFIG.debug) {
      console.log(
        '[MW-DIAG][INJECT] source=timeout',
        'requestId=' + requestId,
        'policy=' + (timeoutPolicy.shouldBlur ? 'failClosed_blur' : 'failOpen_safe'),
        'reason=' + (timeoutPolicy.reason || 'none')
      );
    }
    if (timeoutPolicy.shouldBlur) {
      console.log('[MW] FAIL-CLOSED: Applying blur to timed-out items');
      pendingRequest.items.forEach(item => {
        clearPendingItem(item.itemId, 'timeout_failClosed');
        const element = state.elements.get(item.itemId);
        if (element && element.isConnected) {
          applyBlur(element, item.src, 'timeout', CONFIG.blurStrength, item.itemId);
        }
        state.scanned.add(item.src);
      });
    } else {
      // FAIL-OPEN: Remove soft blur, mark as safe
      console.log('[MW] FAIL-OPEN: Removing soft blur for timed-out items');
      pendingRequest.items.forEach(item => {
        clearPendingItem(item.itemId, 'timeout_failOpen');
        const element = state.elements.get(item.itemId);
        if (element && element.isConnected) {
          removeSoftBlur(element, item.src);
          element.dataset.mwModerated = 'timeout-safe';
        }
        markSafeResolved(item.src);
        // Don't add to scanned so they can be retried later
      });
    }
    
    state.pendingRequests.delete(requestId);
  }

  /**
   * Process results from host
   * Validates nonce before processing to prevent spoofing
   * Implements HIGH-CONFIDENCE BYPASS and ANATOMICAL LOGIC
   */
  function handleModerationResult(message) {
    try {
      const { requestId, results, nonce } = message;
      const resultEpoch = Number.isFinite(message.pageEpoch) ? Number(message.pageEpoch) : null;
      const expectedNoncePrefix = String(CONFIG.nonce || '').substring(0, 6);
      const receivedNoncePrefix = String(nonce || 'none').substring(0, 6);
      const stickyShortsMode = isYouTubeShortsUrl(window.location.href);
      const relaxedYouTubeEpochMode = isYouTubeDomainUrl(window.location.href);
      if (resultEpoch !== null && resultEpoch !== state.pageEpoch && !relaxedYouTubeEpochMode) {
        diagEpochBypassCounters.epoch_bypass_blocked += 1;
        diagLogEpochBypass(
          'epoch_bypass_blocked',
          'result_epoch_mismatch_non_youtube',
          resultEpoch,
          state.pageEpoch,
          window.location.href
        );
        state.stats.staleEpochDiscarded++;
        logShortsScanSkip('epoch_mismatch', null, 'request:' + String(requestId || 'none'), 'result');
        if (DIAG_YT_BLUR) {
          diagEpochCounters.staleInjectedDiscardCount += 1;
          console.warn(
            '[MW-YT][DIAG][EPOCH][INJECT]',
            'action=stale_injected_discard',
            'count=' + diagEpochCounters.staleInjectedDiscardCount,
            'requestId=' + requestId,
            'resultEpoch=' + resultEpoch,
            'activeEpoch=' + state.pageEpoch,
            'url=' + window.location.href
          );
        }
        console.warn(
          '[MW][RejectResult]',
          'reason=epoch',
          'requestId=' + requestId,
          'expectedNonce=' + expectedNoncePrefix,
          'gotNonce=' + receivedNoncePrefix,
          'resultEpoch=' + resultEpoch,
          'activeEpoch=' + state.pageEpoch
        );
        cleanupRejectedOrTimedOutRequest(requestId, 'reject_epoch');
        return;
      }
      if (resultEpoch !== null && resultEpoch !== state.pageEpoch && relaxedYouTubeEpochMode) {
        diagEpochBypassCounters.epoch_bypass_allowed += 1;
        diagLogEpochBypass(
          'epoch_bypass_allowed',
          'result_epoch_mismatch_youtube_relaxed',
          resultEpoch,
          state.pageEpoch,
          window.location.href
        );
        if (DIAG_YT_BLUR) {
          console.log(
            '[MW-YT][DIAG][EPOCH][INJECT]',
            'action=stale_injected_bypass_youtube',
            'requestId=' + requestId,
            'resultEpoch=' + resultEpoch,
            'activeEpoch=' + state.pageEpoch,
            'scope=' + (stickyShortsMode ? 'shorts' : 'youtube'),
            'url=' + window.location.href
          );
        }
      }
      
      if (!requestId || !Array.isArray(results)) {
        console.log('[MW] Invalid result message:', message);
        return;
      }
      
      // SECURITY: Validate nonce
      if (nonce !== CONFIG.nonce) {
        state.stats.nonceRejected++;
        logShortsScanSkip('nonce_mismatch', null, 'request:' + String(requestId || 'none'), 'result');
        console.warn(
          '[MW][RejectResult]',
          'reason=nonce',
          'requestId=' + requestId,
          'expectedNonce=' + expectedNoncePrefix,
          'gotNonce=' + receivedNoncePrefix,
          'resultEpoch=' + (resultEpoch === null ? 'none' : resultEpoch),
          'activeEpoch=' + state.pageEpoch
        );
        cleanupRejectedOrTimedOutRequest(requestId, 'reject_nonce');
        return;
      }
      
      const pendingRequest = state.pendingRequests.get(requestId);
      if (pendingRequest) {
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.state = 'handled';
        state.pendingRequests.delete(requestId);
      }
      
      state.stats.responsesReceived++;
      console.log('[MW] received result', requestId, 'count=' + results.length);
      warnProfileOriginShortsDiag(
        'moderation_result_received',
        'requestId=' + requestId +
        ' resultCount=' + results.length +
        ' resultEpoch=' + (resultEpoch === null ? 'none' : resultEpoch) +
        ' activeEpoch=' + state.pageEpoch,
        { throttleMs: 0, force: isShortsModeActive() }
      );
      if (isShortsModeActive()) {
        const startedAt = diagScanBatchStartAtByRequestId.get(requestId);
        if (Number.isFinite(startedAt)) {
          const elapsed = Date.now() - startedAt;
          console.log(
            '[DIAG][SHORTS_SCAN] scanBatch_end',
            'requestId=' + requestId,
            'elapsed=' + elapsed + 'ms'
          );
          diagScanBatchStartAtByRequestId.delete(requestId);
        } else {
          console.log(
            '[DIAG][SHORTS_SCAN] scanBatch_end',
            'requestId=' + requestId,
            'elapsed=unknown'
          );
        }
      }
      
      results.forEach(result => {
      const {
        itemId,
        src,
        shouldBlur,
        category,
        confidence,
        reason,
        model_version,
        thresholds,
        decision_reason,
        image_width,
        image_height,
        host,
        ts,
        diagnostics,
      } = result;
      const rawPredictions = result && typeof result === 'object'
        ? (result.predictions || result.scores || result.probabilities || null)
        : null;
      const normalizedPredictions = normalizePredictionObject(rawPredictions);
      if (!predictionKeysLogged) {
        predictionKeysLogged = true;
        const keys = rawPredictions && typeof rawPredictions === 'object' ? Object.keys(rawPredictions) : [];
        console.log('[MW] prediction keys:', keys.length ? keys.join(',') : '(none)');
      }
      const rawCategory = normalizePolicyCategory(category);
      const normalizedCategory = normalizeLabel(category);
      const topPrediction = getTopPredictionLabel(normalizedPredictions);
      const unsafeScores = {
        porn: toFiniteNumber(normalizedPredictions.porn),
        sexy: toFiniteNumber(normalizedPredictions.sexy),
        hentai: toFiniteNumber(normalizedPredictions.hentai),
      };
      const diagnosticsObj = diagnostics && typeof diagnostics === 'object' ? diagnostics : null;
      const thresholdObj = thresholds && typeof thresholds === 'object' ? thresholds : null;
      const diagnosticNsfwRisk = toFiniteNumber(diagnosticsObj?.nsfwRisk);
      const diagnosticSkinRatio = toFiniteNumber(diagnosticsObj?.skinRatio);
      const diagnosticThirstScore = toFiniteNumber(diagnosticsObj?.thirstScore);
      const diagnosticPersonPresent = diagnosticsObj?.personPresent === true || diagnosticsObj?.personPresent === 'true';
      const hostDecisionReason = typeof decision_reason === 'string' ? decision_reason : '';
      const hostGrayMin = toFiniteNumber(thresholdObj?.nsfwGrayZoneMin);
      const hostGrayMax = toFiniteNumber(thresholdObj?.nsfwGrayZoneMax);
      const hostExplicitOverride = toFiniteNumber(thresholdObj?.explicitOverride);
      const hostSkinThreshold = toFiniteNumber(thresholdObj?.skinRatio);
      const hostImageWidth = toFiniteNumber(image_width) ?? toFiniteNumber(diagnosticsObj?.imageWidth);
      const hostImageHeight = toFiniteNumber(image_height) ?? toFiniteNumber(diagnosticsObj?.imageHeight);
      const hostName = (typeof host === 'string' && host) ? host : (typeof diagnosticsObj?.host === 'string' ? diagnosticsObj.host : '');
      const strongestUnsafeLabel = Object.entries(unsafeScores)
        .reduce(function(best, entry) {
          var label = entry[0];
          var score = entry[1];
          if (score === null) return best;
          if (!best || score > best.score) return { label: label, score: score };
          return best;
        }, null);
      const predictedLabel = TRACE_UNSAFE_LABELS.has(normalizedCategory)
        ? normalizedCategory
        : ((strongestUnsafeLabel && strongestUnsafeLabel.label) || topPrediction.label || normalizedCategory || 'unknown');
      // Baseline parity: dial thresholds only (no Shorts elevated floors on decision thr).
      const surfaceThresholds = effectiveThresholds;
      const thresholdUsed = Object.prototype.hasOwnProperty.call(surfaceThresholds, predictedLabel)
        ? surfaceThresholds[predictedLabel]
        : null;
      const predictionScore = toFiniteNumber(normalizedPredictions[predictedLabel]);
      const confidenceScore = toFiniteNumber(confidence);
      const labelScoreUsed = predictionScore !== null
        ? predictionScore
        : (TRACE_UNSAFE_LABELS.has(predictedLabel) ? confidenceScore : null);
      const thresholdComparable = thresholdUsed !== null && labelScoreUsed !== null;
      const thresholdHit = thresholdComparable ? (labelScoreUsed > thresholdUsed) : null;
      
      console.log('[MW] scan result itemId=' + itemId, 'src=' + (src || '').substring(0, 50), 'blur=' + shouldBlur, 'cat=' + category, 'conf=' + (confidence || 0).toFixed(2), 'reason=' + (reason || ''));
      const countKey = predictedLabel || 'unknown';
      state.stats.classificationCounts[countKey] = (state.stats.classificationCounts[countKey] || 0) + 1;
      
      // Find the element for this item
      const element = state.elements.get(itemId);
      const pendingItem = state.pending.get(itemId);
      lastShieldTarget = {
        itemId: itemId,
        src: src,
        normalizedCategory: normalizedCategory,
        predictedLabel: predictedLabel,
        predictions: normalizedPredictions,
        element: element && element.isConnected ? element : null,
        sourceType: (pendingItem && pendingItem.sourceType) || (element && element.dataset?.mwSourceType) || 'unknown',
        timestamp: Date.now(),
      };
      
      // Clear any pending blur timer (semantic delay)
      if (pendingItem && pendingItem.blurTimer) {
        clearTimeout(pendingItem.blurTimer);
      }
      
      clearPendingItem(itemId, 'result');
      const resultSourceType = String(
        (pendingItem && pendingItem.sourceType) ||
        (element && element.dataset && element.dataset.mwSourceType) ||
        ''
      );
      // FREEZE-OVERRIDE (lifecycle): model_not_ready / non-final host lag must NOT
      // enter scanned dedupe or clear soft pre-blur — that was cold-start "no blur".
      // FREEZE-OVERRIDE (accuracy): Active Shorts uncertain/empty frames + provisional
      // posters are also non-final so a later decoded frame can correct FP/FN.
      const isUncertainShortsCategory =
        rawCategory === 'shorts_uncertain_input' ||
        rawCategory === 'shorts_scan_miss_uncertain' ||
        rawCategory === 'shorts_scan_error_uncertain' ||
        normalizedCategory === 'shorts_uncertain_input' ||
        String(hostDecisionReason || '').indexOf('shorts_uncertain') === 0;
      // FREEZE-OVERRIDE (accuracy): ALL Active Shorts poster verdicts are provisional
      // until a decoded video-frame finalizes. Poster hard-blur was a sticky FP source
      // (sports thumbs / suggestive covers) that never got corrected when frame failed.
      const isProvisionalPosterPending =
        isShortsModeActive() &&
        resultSourceType === 'video-poster' &&
        element &&
        element.dataset &&
        String(element.dataset.mwShortsFrameOk || '') !== '1';
      const isNonFinalPendingResult =
        rawCategory === 'model_not_ready' ||
        normalizedCategory === 'model_not_ready' ||
        hostDecisionReason === 'model_not_ready' ||
        reason === 'model_not_ready' ||
        isUncertainShortsCategory ||
        isProvisionalPosterPending;
      const shouldCacheScannedSrc = !(
        rawCategory === 'safe_epoch_stale' ||
        rawCategory === 'safe_sovereign_stale' ||
        isNonFinalPendingResult
      );
      if (shouldCacheScannedSrc) {
        state.scanned.add(src);
      } else {
        clearElementScanDedupeMarkers(element, isNonFinalPendingResult ? 'model_not_ready' : 'stale_safe_result');
      }

      if (isNonFinalPendingResult) {
        if (element && element.isConnected && !isShortsModeActive()) {
          // Keep soft pre-blur on main surfaces; do not mark safe; wait for model_ready flush.
          try {
            const pendingSrc = src || getBloomGuardMarkedNodeSrc(element) || '';
            if (pendingSrc) applySoftBlur(element, pendingSrc, itemId);
            element.dataset.mwDecisionReason = 'model_not_ready_pending';
          } catch (e) {}
          console.log(
            '[DIAG][COLD_START]',
            'event=model_not_ready_keep_soft',
            'itemId=' + String(itemId || 'none'),
            'src=' + String(src || '').substring(0, 80)
          );
          return;
        }
        // Active Shorts: provisional poster or uncertain frame — do not hard-finalize.
        if (element && element.isConnected && isShortsModeActive()) {
          try {
            element.dataset.mwDecisionReason = isUncertainShortsCategory
              ? 'shorts_uncertain_provisional'
              : (shouldBlur ? 'shorts_poster_provisional_positive' : 'shorts_poster_provisional_safe');
            // Soft pre-protect only (no hard blur / reveal ownership from poster).
            if (shouldBlur && isProvisionalPosterPending) {
              const softSrc = src || getBloomGuardMarkedNodeSrc(element) || '';
              if (softSrc) applySoftBlur(element, softSrc, itemId);
            }
            // Uncertain / pending poster: keep Flash veil path + schedule one frame pipeline.
            if (isUncertainShortsCategory || isProvisionalPosterPending) {
              scheduleActiveShortsFrameRetry(
                element.tagName && String(element.tagName).toUpperCase() === 'VIDEO'
                  ? element
                  : (element.querySelector && element.querySelector('video')) || element,
                getShortsFrameScanKey(
                  element.tagName && String(element.tagName).toUpperCase() === 'VIDEO'
                    ? element
                    : (element.querySelector && element.querySelector('video')) || element
                ),
                isUncertainShortsCategory ? 'uncertain_sample' : 'poster_provisional'
              );
            }
          } catch (e) {}
          console.log(
            '[DIAG][SHORTS_ACCURACY]',
            'event=non_final_sample',
            'sourceType=' + resultSourceType,
            'category=' + String(rawCategory || ''),
            'hostShouldBlur=' + String(!!shouldBlur),
            'itemId=' + String(itemId || 'none')
          );
          // Uncertain / provisional: never hard-finalize here — frame authority only.
          return;
        } else {
          return;
        }
      }
      
      // Check if result came fast enough to skip blur (semantic delay saved)
      const wasInSoftBlur = element && element.dataset.mwModerated === 'softblur';
      
      // ======== Neutral fast-pass removed (strict mode) ========

      
      // ======== DECISION (home dial thr + Active Shorts host OR dial) ========
      // FREEZE-OVERRIDE (accuracy): dial-only override of host caused Active Shorts FNs.
      // NSFWJS often returns 0/tiny scores on all channels; treating that as "has scores"
      // then dialAnyHit=false wiped host swimwear/thirst/segmentation positives.
      // Active Shorts: host positive OR dial thr hit. Anatomical must not unblur host positives.
      let shouldApplyBlur = shouldBlur;
      let decisionReason = hostDecisionReason || reason || '';
      const forceUnsafe = FORCE_UNSAFE_CATEGORIES.has(rawCategory);
      const shortsDecision = isShortsModeActive();
      const thrTable = shortsDecision ? getActiveShortsThresholds() : surfaceThresholds;
      const pornScoreN = unsafeScores.porn;
      const sexyScoreN = unsafeScores.sexy;
      const hentaiScoreN = unsafeScores.hentai;
      const maxUnsafeScore = Math.max(
        pornScoreN === null ? 0 : pornScoreN,
        sexyScoreN === null ? 0 : sexyScoreN,
        hentaiScoreN === null ? 0 : hentaiScoreN
      );
      // Ignore noise-zero prediction bags (0,0,0) — those are not real thr signals.
      const hasMeaningfulScores = maxUnsafeScore > 0.02;
      const dialAnyHit =
        (pornScoreN !== null && pornScoreN > Number(thrTable.porn)) ||
        (sexyScoreN !== null && sexyScoreN > Number(thrTable.sexy)) ||
        (hentaiScoreN !== null && hentaiScoreN > Number(thrTable.hentai));

      // FREEZE-OVERRIDE (accuracy): Active Shorts sample authority.
      // Once a decoded video-frame succeeded, ignore later poster verdicts for this node
      // (poster FP/FN must not override a real frame). Frame results always apply.
      if (
        shortsDecision &&
        element &&
        element.dataset &&
        element.dataset.mwShortsFrameOk === '1' &&
        resultSourceType === 'video-poster'
      ) {
        console.log(
          '[DIAG][SHORTS_ACCURACY]',
          'event=ignore_poster_after_frame',
          'itemId=' + String(itemId || 'none'),
          'hostShouldBlur=' + String(!!shouldBlur)
        );
        return;
      }
      if (shortsDecision && resultSourceType === 'video-frame' && element && element.dataset) {
        // Final non-uncertain frame result → authority for this short identity.
        try {
          markActiveShortsFrameSuccess(
            element.tagName && String(element.tagName).toUpperCase() === 'VIDEO'
              ? element
              : (element.querySelector && element.querySelector('video')) || element,
            getShortsFrameScanKey(
              element.tagName && String(element.tagName).toUpperCase() === 'VIDEO'
                ? element
                : (element.querySelector && element.querySelector('video')) || element
            )
          );
        } catch (e) {
          try {
            element.dataset.mwShortsFrameOk = '1';
            element.dataset.mwShortsAwaitingFrame = '0';
            const sid = getCurrentShortsUrlId() || '';
            if (sid) element.dataset.mwShortsSettledId = sid;
          } catch (e2) {}
        }
      }

      if (shortsDecision) {
        // FREEZE-OVERRIDE (accuracy): Active Shorts MVP decision — channel-evidence first.
        // Consistent rule for every short (battery + accuracy):
        //   hard blur only when NSFWJS porn/hentai/sexy channels clear a Shorts bar.
        // FPs cut: unconfirmed swimwear/thirst, thirst-alone, weak sexy, empty frames.
        // FNs protected: explicit porn/hentai over dial thr; strong sexy; zero-bag
        //   ONLY for explicit porn/hentai host labels (not swimwear/thirst).
        const pornD = pornScoreN === null ? 0 : pornScoreN;
        const sexyD = sexyScoreN === null ? 0 : sexyScoreN;
        const hentaiD = hentaiScoreN === null ? 0 : hentaiScoreN;
        const sexyFloor = Math.max(Number(thrTable.sexy) || 0, 0.70);
        const dialOnlyStrong =
          (pornD > Number(thrTable.porn)) ||
          (hentaiD > Number(thrTable.hentai)) ||
          (sexyD > Math.max(Number(thrTable.sexy) || 0, 0.72));
        // Channel confirmation only — thirst/skin alone never hard-blurs Active Shorts.
        const hostConfirmed =
          (pornD > Number(thrTable.porn)) ||
          (hentaiD > Number(thrTable.hentai)) ||
          (sexyD > sexyFloor);
        const rawLabel = normalizePolicyCategory(rawCategory || predictedLabel || '');
        const isExplicitHostLabel =
          rawLabel === 'porn' ||
          rawLabel === 'hentai' ||
          normalizePolicyCategory(predictedLabel || '') === 'porn' ||
          normalizePolicyCategory(predictedLabel || '') === 'hentai';
        const isUncertainCat =
          rawCategory === 'shorts_uncertain_input' ||
          rawCategory === 'shorts_scan_miss_uncertain' ||
          rawCategory === 'shorts_scan_error_uncertain' ||
          String(hostDecisionReason || '').indexOf('shorts_uncertain') === 0 ||
          String(hostDecisionReason || '').indexOf('no_force_blur') !== -1;

        if (isUncertainCat) {
          // Empty/uncertain sample: never host-OR hard blur (Flash/retry only).
          shouldApplyBlur = false;
          decisionReason = 'shorts_uncertain_no_hard_blur';
        } else if (shouldBlur && !hasMeaningfulScores && isExplicitHostLabel) {
          // Zero-bag explicit host positive only (not swimwear/thirst zero bags).
          shouldApplyBlur = true;
          decisionReason = hostDecisionReason || reason || 'host_blur_zero_bag_explicit_shorts';
        } else if (shouldBlur && !hasMeaningfulScores) {
          shouldApplyBlur = false;
          decisionReason = 'shorts_zero_bag_non_explicit_suppressed';
        } else if (shouldBlur && forceUnsafe) {
          // Swimwear/thirst family: require NSFWJS channel confirmation.
          if (hostConfirmed || dialOnlyStrong) {
            shouldApplyBlur = true;
            decisionReason = hostConfirmed
              ? 'host_force_unsafe_confirmed_shorts'
              : 'shorts_dial_only_strong';
          } else {
            shouldApplyBlur = false;
            decisionReason = 'shorts_force_unsafe_unconfirmed_fp';
          }
        } else if (shouldBlur) {
          // Host blur without force-unsafe: need channel confirmation or strong dial.
          if (hostConfirmed || dialOnlyStrong) {
            shouldApplyBlur = true;
            decisionReason = hostConfirmed ? 'host_confirmed_shorts' : 'shorts_dial_only_strong';
          } else {
            shouldApplyBlur = false;
            decisionReason = 'shorts_weak_host_suppressed_fp';
          }
        } else if (dialOnlyStrong) {
          shouldApplyBlur = true;
          decisionReason = 'shorts_dial_only_strong';
        } else if (dialAnyHit) {
          shouldApplyBlur = false;
          decisionReason = 'shorts_dial_only_weak_suppressed';
        } else {
          shouldApplyBlur = false;
          decisionReason = 'shorts_safe_host_and_dial';
        }
      } else if (hasMeaningfulScores) {
        // Home: dial thr primary; keep force-unsafe host positives (swimwear family).
        shouldApplyBlur = !!dialAnyHit || (!!shouldBlur && forceUnsafe);
        decisionReason = dialAnyHit
          ? (thresholdHit ? (predictedLabel + '>=thr') : 'dial_any_channel_hit')
          : (shouldBlur && forceUnsafe
              ? 'forceUnsafeCategory/' + rawCategory
              : 'dial_all_channels_below');
      } else if (forceUnsafe && shouldBlur) {
        shouldApplyBlur = true;
        decisionReason = 'forceUnsafeCategory/' + rawCategory;
      } else if (thresholdComparable) {
        shouldApplyBlur = !!thresholdHit;
        decisionReason = thresholdHit ? (predictedLabel + '>=thr') : (predictedLabel + '<thr');
      } else if (thresholdUsed !== null && labelScoreUsed === null) {
        shouldApplyBlur = false;
        decisionReason = 'NaN/default';
      } else {
        shouldApplyBlur = !!shouldBlur;
        decisionReason = decisionReason || (shouldBlur ? 'host_blur' : 'host_safe');
      }

      // Anatomical softens dial-only hits; never unblur host-positive Active Shorts.
      const skipAnatomicalForHostShortsPositive = shortsDecision && !!shouldBlur && !!shouldApplyBlur;
      if (!skipAnatomicalForHostShortsPositive) {
        const anatomicalDecision = applyAnatomicalThreshold(
          shouldApplyBlur,
          predictedLabel || '',
          unsafeScores,
          forceUnsafe,
        );
        shouldApplyBlur = anatomicalDecision.shouldBlur;
        if (anatomicalDecision.reason) {
          decisionReason = anatomicalDecision.reason;
          if (CONFIG.debug) {
            const scoreUsed = predictedLabel === 'sexy' ? unsafeScores.sexy : unsafeScores.porn;
            console.log('[MW] ANATOMICAL LOGIC:', decisionReason, 'label=' + predictedLabel, 'score=' + String(scoreUsed), 'thr=' + CONFIG.anatomicalThreshold);
          }
        }
      }
      
      // FAIL-OPEN: Handle errors gracefully
      const errorCategory = rawCategory || normalizedCategory;
      const isError = errorCategory === 'error' || errorCategory === 'timeout' || errorCategory === 'error_fail_closed';
      const policyDecision = applyFailOpenAndModePolicy(
        shouldApplyBlur,
        rawCategory,
        predictedLabel,
        isError
      );
      shouldApplyBlur = policyDecision.shouldBlur;
      if (policyDecision.reason) {
        decisionReason = policyDecision.reason;
      }

      // FREEZE-OVERRIDE (accuracy): Active Shorts FP guard.
      // - Host positives (shouldBlur): NEVER suppress (protects FNs / zero bags).
      // - Dial-only hits (!shouldBlur && dialAnyHit): allow mild floor suppress for FPs
      //   (borderline sexy over dial thr on safe-ish frames).
      let shortsFpDecision = {
        shouldBlur: !!shouldApplyBlur,
        reason: decisionReason || null,
        wouldSuppress: false,
        suppressReason: null,
      };
      if (shortsDecision && shouldApplyBlur && !shouldBlur && dialAnyHit) {
        // Inline dial-only floor check (host positives never enter this branch).
        const floorThr = ACTIVE_SHORTS_FP_FLOOR_DIAG_ONLY;
        const porn = pornScoreN === null ? 0 : pornScoreN;
        const sexy = sexyScoreN === null ? 0 : sexyScoreN;
        const hentai = hentaiScoreN === null ? 0 : hentaiScoreN;
        const maxExplicit = Math.max(porn, hentai);
        const label = normalizePolicyCategory(predictedLabel);
        let dialOnlySuppress = null;
        if (maxExplicit >= Math.max(floorThr.porn, 0.8) || sexy >= Math.max(floorThr.sexy, 0.85)) {
          dialOnlySuppress = null;
        } else if (
          label === 'sexy' || label === 'thirst' || label === 'swimwear' || label === 'shirtless' ||
          label === 'shirtless_male' || label === 'bikini' || label === 'sports_bra' || label === 'swim_trunks' ||
          label === 'suggestive'
        ) {
          if (sexy < floorThr.sexy && maxExplicit < floorThr.porn) {
            dialOnlySuppress = 'shorts_dial_only_fp_guard_weak_suggestive';
          }
        } else if (label === 'porn' || label === 'hentai') {
          if (maxExplicit < floorThr.porn) {
            dialOnlySuppress = 'shorts_dial_only_fp_guard_weak_explicit';
          }
        } else if (maxExplicit < floorThr.porn && sexy < floorThr.sexy) {
          dialOnlySuppress = 'shorts_dial_only_fp_guard_below_floor';
        }
        if (dialOnlySuppress) {
          shouldApplyBlur = false;
          decisionReason = dialOnlySuppress;
          shortsFpDecision = {
            shouldBlur: false,
            reason: dialOnlySuppress,
            wouldSuppress: true,
            suppressReason: dialOnlySuppress,
          };
          console.warn(
            '[MW-ACTIVE-SHORTS-ACCURACY-DIAG]',
            'event=dial_only_fp_suppressed',
            'label=' + label,
            'porn=' + String(porn),
            'sexy=' + String(sexy),
            'hentai=' + String(hentai),
            'floorThr=' + JSON.stringify(floorThr)
          );
        } else {
          shortsFpDecision = applyActiveShortsFalsePositiveGuard(
            shouldApplyBlur,
            predictedLabel,
            unsafeScores,
            decisionReason
          );
        }
      } else {
        shortsFpDecision = applyActiveShortsFalsePositiveGuard(
          shouldApplyBlur,
          predictedLabel,
          unsafeScores,
          decisionReason
        );
        // FREEZE-OVERRIDE (accuracy): Do NOT re-force shouldApplyBlur=true on host positives.
        // That path undid Shorts host-confirm / forceUnsafe FP cuts (swimwear/thirst FPs).
        // Trust the Active Shorts decision block above; only apply diag-only guard side effects
        // for non-Shorts (or when the guard itself mutates shouldBlur while decision-enabled).
        if (!shortsDecision) {
          shouldApplyBlur = shortsFpDecision.shouldBlur;
          if (shortsFpDecision.reason && shortsFpDecision.reason !== decisionReason) {
            decisionReason = shortsFpDecision.reason;
          }
        }
        // shortsDecision: keep shouldApplyBlur from the Shorts channel-evidence block.
      }
      
      const dialActive = CONFIG.enabled && CONFIG.sensitivity > 0;
      const sexyScoreForAction = unsafeScores.sexy || 0;
      const pornScoreForAction = unsafeScores.porn || 0;
      const hardBlurOverride = (predictedLabel === 'porn' && pornScoreForAction > 0.8) ||
        (predictedLabel === 'sexy' && sexyScoreForAction > 0.8);
      const dynamicBlurCandidate = rawCategory === 'swimwear' || (predictedLabel === 'sexy' && sexyScoreForAction < 0.8);
      let finalBlur = CONFIG.forcedBlur || (shouldApplyBlur && dialActive);
      const flashPositive = CONFIG.flashShieldV1 && shouldApplyBlur;
      if (isShortsModeActive()) {
        console.warn(
          '[MW-ACTIVE-SHORTS-ACCURACY-DIAG]',
          'event=verdict',
          'itemId=' + String(itemId || 'none'),
          'predicted=' + String(predictedLabel || 'unknown'),
          'hostShouldBlur=' + String(!!shouldBlur),
          'shouldApplyBlur=' + String(!!shouldApplyBlur),
          'finalBlur=' + String(!!finalBlur),
          'flashPositive=' + String(!!flashPositive),
          'porn=' + String(unsafeScores.porn),
          'sexy=' + String(unsafeScores.sexy),
          'hentai=' + String(unsafeScores.hentai),
          'dialThr=' + JSON.stringify(getActiveShortsThresholds()),
          'thresholdUsed=' + String(thresholdUsed === null ? 'n/a' : thresholdUsed),
          'labelScore=' + String(labelScoreUsed === null ? 'n/a' : labelScoreUsed),
          'thresholdHit=' + String(thresholdHit),
          'anatomicalThr=' + String(CONFIG.anatomicalThreshold),
          'fpWouldSuppress=' + String(!!shortsFpDecision.wouldSuppress),
          'fpSuppressReason=' + String(shortsFpDecision.suppressReason || 'none'),
          'decisionReason=' + String(decisionReason || 'none'),
          'sensitivity=' + String(CONFIG.sensitivity),
          'url=' + String(window.location.href || '').substring(0, 160)
        );
      }
      // FREEZE-OVERRIDE: hard overrides remain owned by the main dial on home/results.
      // FREEZE-OVERRIDE (accuracy / Active Shorts): do NOT re-force finalBlur on Shorts
      // after channel-evidence decision — score>0.8 override reintroduced sports/dance FPs
      // and undid sacc2/sacc3 host-confirm cuts. Flash-only positives still use applyFlashShieldPositive.
      if (hardBlurOverride && dialActive && !isShortsModeActive()) {
        finalBlur = true;
        decisionReason = (decisionReason ? decisionReason + '/' : '') + 'hard_blur';
      } else if (dynamicBlurCandidate) {
        decisionReason = (decisionReason ? decisionReason + '/' : '') + 'dynamic_blur';
      }
      if (DEBUG_SKIP_DOMAIN_BLUR && !CONFIG.forcedBlur) {
        if (finalBlur) state.stats.blurSkippedByKillSwitch++;
        finalBlur = false;
        decisionReason = 'kill-switch/youtube-domain';
      }
      if (CONFIG.debug) {
        console.log('[MW][Decision] itemId=' + itemId, 'src=' + (src || '').substring(0, 60), 'finalBlur=' + finalBlur, 'reason=' + decisionReason);
        console.log(
          '[MW-DIAG][INJECT] source=item_policy',
          'itemId=' + itemId,
          'finalBlur=' + finalBlur,
          'reason=' + (decisionReason || 'none'),
          'predicted=' + (predictedLabel || 'unknown'),
          'cat=' + (normalizedCategory || 'unknown'),
          'threshold=' + (thresholdUsed === null ? 'n/a' : String(thresholdUsed)),
          'score=' + (labelScoreUsed === null ? 'n/a' : String(labelScoreUsed))
        );
      }
      const dims = element ? getElementDimensions(element) : { width: 0, height: 0 };
      
      if (element && element.isConnected) {
        try {
          element.dataset.mwConfidence = String(toFiniteNumber(confidence) ?? 0);
          element.dataset.mwDecisionReason = String(decisionReason || '');
          // FREEZE-OVERRIDE (accuracy): stamp blur authority for dial reeval / Shorts FP control.
          element.dataset.mwHostBlur = shouldBlur ? '1' : '0';
          element.dataset.mwForceUnsafe = forceUnsafe ? '1' : '0';
          element.dataset.mwDialOnlyBlur =
            (!shouldBlur && !!finalBlur && String(decisionReason || '').indexOf('dial_only') !== -1)
              ? '1'
              : ((!shouldBlur && !!finalBlur && String(decisionReason || '').indexOf('dial') !== -1) ? '1' : '0');
          if (String(decisionReason || '').indexOf('shorts_dial_only_strong') === 0) {
            element.dataset.mwDialOnlyBlur = '1';
          }
          if (
            String(rawCategory || '').indexOf('shorts_uncertain') === 0 ||
            String(decisionReason || '').indexOf('shorts_uncertain') !== -1 ||
            String(hostDecisionReason || '').indexOf('shorts_uncertain') !== -1
          ) {
            element.dataset.mwProvisionalUncertain = finalBlur ? '1' : '0';
          } else if (finalBlur && resultSourceType === 'video-frame') {
            element.dataset.mwProvisionalUncertain = '0';
          }
          element.dataset.mwModelVersion = String(model_version || '');
          element.dataset.mwNsfwRisk = String(diagnosticNsfwRisk ?? '');
          element.dataset.mwPersonPresent = diagnosticPersonPresent ? '1' : '0';
          element.dataset.mwSkinRatio = String(diagnosticSkinRatio ?? '');
          element.dataset.mwThirstScore = String(diagnosticThirstScore ?? '');
          element.dataset.mwSkinThreshold = String(hostSkinThreshold ?? '');
          element.dataset.mwGrayZoneMin = String(hostGrayMin ?? '');
          element.dataset.mwGrayZoneMax = String(hostGrayMax ?? '');
          element.dataset.mwExplicitOverride = String(hostExplicitOverride ?? '');
          element.dataset.mwImageWidth = String(hostImageWidth ?? dims.width ?? '');
          element.dataset.mwImageHeight = String(hostImageHeight ?? dims.height ?? '');
          element.dataset.mwHost = String(hostName || '');
          element.dataset.mwTimestamp = String(toFiniteNumber(ts) ?? Date.now());
          // Active Shorts stale/FP heal uses these stamps (no sacred body edits).
          element.dataset.mwPageEpoch = String(state.pageEpoch || 0);
          if (unsafeScores.porn !== null) element.dataset.mwPornScore = String(unsafeScores.porn);
          if (unsafeScores.sexy !== null) element.dataset.mwSexyScore = String(unsafeScores.sexy);
          if (unsafeScores.hentai !== null) element.dataset.mwHentaiScore = String(unsafeScores.hentai);
        } catch (e) {}
        const preDecisionState = element.dataset.mwModerated || '';
        const preDecisionFilter = element.style.getPropertyValue('filter') || element.style.filter || '';
        const preDecisionHasBlur = preDecisionFilter.toLowerCase().includes('blur(');
        const mvpMainSurface = !isShortsModeActive() && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href);
        if (mvpMainSurface && shouldBlur) {
          console.log(
            '[DIAG][MVP_REVEAL_PATH] result_apply_blur_positive',
            'itemId=' + (itemId || 'none'),
            'itemKey=' + getDiagItemKey(src),
            'sourceType=' + ((pendingItem && pendingItem.sourceType) || (element.dataset && element.dataset.mwSourceType) || 'unknown'),
            'hostShouldBlur=' + String(!!shouldBlur),
            'finalBlur=' + String(!!finalBlur),
            'decisionReason=' + (decisionReason || 'none'),
            'pageEpoch=' + state.pageEpoch,
            'navId=' + NAV_ID
          );
        }
        if (finalBlur) {
          diagLogApplyByItemId(
            itemId,
            src,
            element,
            'applyPath=item_identity sourceType=' + ((pendingItem && pendingItem.sourceType) || (element.dataset && element.dataset.mwSourceType) || 'unknown')
          );
          console.log(
            '[MW][JSBlur] applied reason=' + (decisionReason || 'unknown'),
            'src=' + String(src || '').substring(0, 120),
            'itemId=' + String(itemId || ''),
          );
          clearSafeResolved(src);
          logBlurTraceOncePerElement({
            urlPrefix: (src || '').substring(0, 60),
            width: dims.width,
            height: dims.height,
            predictedLabel: predictedLabel,
            labelScoreUsed: labelScoreUsed,
            thresholdUsed: thresholdUsed,
            decisionReason: decisionReason,
          });
          // Apply strong blur
          applyBlur(element, src, predictedLabel || category || 'flagged', CONFIG.blurStrength, itemId, 'classifier_positive');
        // FREEZE-OVERRIDE: additive Flash-only positive branch; frozen applyBlur is untouched.
        } else if (flashPositive) {
          applyFlashShieldPositive(
            element,
            src,
            predictedLabel || category || 'flagged',
            itemId
          );
        } else {
          if (preDecisionState === 'blurred' || element.classList.contains('mw-blurred') || preDecisionHasBlur) {
            console.log(
              '[MW][JSBlur][SafeOnPreviouslyBlurred]',
              'itemId=' + (itemId || 'N/A'),
              'src=' + String(src || '').substring(0, 120),
              'decisionReason=' + (decisionReason || 'none'),
              'state=' + preDecisionState,
              'hasBlurFilter=' + preDecisionHasBlur
            );
          }
          markSafeResolved(src);
          // Remove soft blur if result is safe
          removeSoftBlur(element, src);
          // FREEZE-OVERRIDE (accuracy): dial-down / thr re-eval must clear HARD blur too.
          // removeSoftBlur alone left hard-blurred positives stuck → dial felt binary.
          if (
            preDecisionState === 'blurred' ||
            element.classList.contains('mw-blurred') ||
            preDecisionHasBlur ||
            String(element.dataset.mwModerated || '') === 'blurred'
          ) {
            try {
              clearAllBlurAndOverlay(element, src, 'classifier_safe_or_dial_below:' + (decisionReason || 'safe'), 'safe');
            } catch (e) {}
          }
          if (mvpMainSurface) {
            const safeCard = getOwnedCardContainerFromNode(element);
            if (safeCard) {
              applyOwnedSafeCardClass(safeCard, 'classifier_safe');
            }
          }
          if (wasInSoftBlur && !finalBlur) {
            state.stats.semanticDelaySaved++;
          }
        }
        const postDecisionOverlay = findRevealOverlayForElement(element, src);
        const postDecisionFilter = element.style.getPropertyValue('filter') || element.style.filter || '';
        warnProfileOriginShortsDiag(
          'verdict_blur_reveal_outcome',
          'itemId=' + String(itemId || 'none') +
          ' sourceType=' + ((pendingItem && pendingItem.sourceType) || (element.dataset && element.dataset.mwSourceType) || 'unknown') +
          ' shouldBlur=' + String(!!shouldBlur) +
          ' finalBlur=' + String(!!finalBlur) +
          ' flashPositive=' + String(!!flashPositive) +
          ' category=' + String(category || 'unknown') +
          ' predicted=' + String(predictedLabel || 'unknown') +
          ' confidence=' + String(confidenceScore === null ? 'none' : confidenceScore) +
          ' decisionReason=' + String(decisionReason || 'none') +
          ' elementState=' + String(element.dataset.mwModerated || 'none') +
          ' hasBlurFilter=' + String(postDecisionFilter.toLowerCase().includes('blur(')) +
          ' revealPresent=' + String(!!postDecisionOverlay) +
          ' elementNodeId=' + getDiagNodeId(element),
          { throttleMs: 0, force: isShortsModeActive() }
        );
      }
      
      // Also find any other elements with the same src
      if (finalBlur) {
        clearSafeResolved(src);
        findAndBlur(src, predictedLabel || category, CONFIG.blurStrength, true, itemId);
      // FREEZE-OVERRIDE: additive fan-out for duplicate media nodes carrying the same source.
      } else if (flashPositive) {
        clearSafeResolved(src);
        findAndApplyFlashShieldPositive(
          src,
          predictedLabel || category || 'flagged',
          itemId
        );
      } else {
        markSafeResolved(src);
        // Remove soft blur from all matching elements
        findAndRemoveSoftBlur(src);
      }
      });
      if (DEBUG_SKIP_DOMAIN_BLUR) {
        console.log('[MW] classification counts (kill-switch active):', JSON.stringify(state.stats.classificationCounts), 'blurSkipped=' + state.stats.blurSkippedByKillSwitch);
      }
      enforceRevealOverlayVisibilityGuardGlobal('moderation_result');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.error('[MW][InjectError]', message);
    }
  }

  /**
   * Find and blur all elements matching a src
   */
  function findAndBlur(src, category, blurStrengthPx, shouldBlur, originItemId) {
    if (!isVisualModerationActive()) return;
    if (!shouldBlur) return;
    if (isRevealedForSource(src, null)) return;
    
    try {
      let fanoutCandidates = 0;
      let fanoutApplied = 0;
      let fanoutRecycled = 0;
      let fanoutNewlyDiscovered = 0;
      const trackFanoutNode = function(node) {
        if (!node || node.nodeType !== 1) return;
        fanoutCandidates += 1;
        const normalizedSrc = normalizeUrl(src || '') || String(src || '');
        const previousSrc = normalizeUrl(node.dataset && node.dataset.mwLastScanSrc ? node.dataset.mwLastScanSrc : '') || '';
        if (previousSrc && normalizedSrc && previousSrc !== normalizedSrc) {
          fanoutRecycled += 1;
        }
        if (!diagApplySeenNodes.has(node)) {
          fanoutNewlyDiscovered += 1;
          diagApplySeenNodes.add(node);
        }
      };

      // Images
      document.querySelectorAll('img').forEach(img => {
        if ((img.src === src || img.dataset.mwOrigSrc === src) && !isRevealedForSource(src, img)) {
          trackFanoutNode(img);
          if (img.dataset.mwModerated === 'blurred' && !isRevealedForSource(src, img) && isShortsModeActive()) {
            if (!findRevealOverlayForElement(img, src) && img.isConnected) {
              createRevealOverlay(img, src, category);
            }
            return;
          }
          if (img.dataset.mwModerated !== 'blurred' && !isRevealedForSource(src, img)) {
            applyBlur(img, src, category, blurStrengthPx);
            fanoutApplied += 1;
          }
        }
      });
      
      // Video posters
      document.querySelectorAll('video').forEach(video => {
        if ((video.poster === src || video.dataset.mwOrigPoster === src) && !isRevealedForSource(src, video)) {
          trackFanoutNode(video);
          if (video.dataset.mwModerated === 'blurred' && !isRevealedForSource(src, video) && isShortsModeActive()) {
            if (!findRevealOverlayForElement(video, src) && video.isConnected) {
              createRevealOverlay(video, src, category);
            }
            return;
          }
          if (video.dataset.mwModerated !== 'blurred' && !isRevealedForSource(src, video)) {
            applyBlur(video, src, category, blurStrengthPx);
            fanoutApplied += 1;
          }
        }
      });
      
      // Background images
      document.querySelectorAll('[data-mw-bg-src]').forEach(el => {
        if (el.dataset.mwBgSrc === src && !isRevealedForSource(src, el)) {
          trackFanoutNode(el);
          if (el.dataset.mwModerated === 'blurred' && !isRevealedForSource(src, el) && isShortsModeActive()) {
            if (!findRevealOverlayForElement(el, src) && el.isConnected) {
              createRevealOverlay(el, src, category);
            }
            return;
          }
          if (el.dataset.mwModerated !== 'blurred' && !isRevealedForSource(src, el)) {
            applyBlur(el, src, category, blurStrengthPx);
            fanoutApplied += 1;
          }
        }
      });
      diagApplyCounters.apply_by_src_fanout += 1;
      console.log(
        '[DIAG][APPLY_PROVENANCE]',
        'apply_by_src_fanout',
        'count=' + diagApplyCounters.apply_by_src_fanout,
        'originItemId=' + (originItemId || 'none'),
        'src=' + String(src || '').substring(0, 180),
        'fanoutCandidates=' + fanoutCandidates,
        'fanoutApplied=' + fanoutApplied,
        'fanoutRecycled=' + fanoutRecycled,
        'fanoutNewlyDiscovered=' + fanoutNewlyDiscovered,
        'navId=' + NAV_ID,
        'pageEpoch=' + state.pageEpoch,
        'urlFamily=' + getDiagUrlFamily(window.location.href)
      );
    } catch (e) {}
  }

  function findAndApplyFlashShieldPositive(src, category, itemId) {
    if (!CONFIG.flashShieldV1 || isRevealedForSource(src, null)) return;
    try {
      document.querySelectorAll('img, video, [data-mw-bg-src]').forEach(function(node) {
        const matches = (
          node.dataset.mwSrc === src ||
          node.dataset.mwBgSrc === src ||
          node.dataset.mwOrigSrc === src ||
          node.dataset.mwOrigPoster === src ||
          node.src === src ||
          node.poster === src
        );
        if (!matches || isRevealedForSource(src, node)) return;
        applyFlashShieldPositive(node, src, category, itemId);
      });
    } catch (e) {}
  }

  /**
   * Find and remove soft blur from all elements matching a src
   */
  function findAndRemoveSoftBlur(src) {
    try {
      let attempts = 0;
      let removedCount = 0;
      let overlayAttachedCount = 0;
      let overlayAttachedWithoutRemovalCount = 0;
      document.querySelectorAll('[data-mw-src="' + src + '"]').forEach(el => {
        attempts += 1;
        const overlayState = getDiagOverlayState(el);
        if (overlayState.overlayAttached) overlayAttachedCount += 1;
        const removed = removeSoftBlur(el, src);
        if (removed) removedCount += 1;
        if (!removed && overlayState.overlayAttached) {
          overlayAttachedWithoutRemovalCount += 1;
        }
        diagSoftBlurLog(
          'find_remove_candidate',
          el,
          src,
          'via=data-mw-src removed=' + removed + ' overlayAttached=' + overlayState.overlayAttached
        );
      });
      
      document.querySelectorAll('img').forEach(img => {
        if (img.src === src || img.dataset.mwOrigSrc === src) {
          attempts += 1;
          const overlayState = getDiagOverlayState(img);
          if (overlayState.overlayAttached) overlayAttachedCount += 1;
          const removed = removeSoftBlur(img, src);
          if (removed) removedCount += 1;
          if (!removed && overlayState.overlayAttached) {
            overlayAttachedWithoutRemovalCount += 1;
          }
          diagSoftBlurLog(
            'find_remove_candidate',
            img,
            src,
            'via=img_match removed=' + removed + ' overlayAttached=' + overlayState.overlayAttached
          );
        }
      });
      if (isShortsModeActive()) {
        document.querySelectorAll('video').forEach(video => {
          if (video.poster === src || video.dataset.mwOrigPoster === src || video.dataset.mwSrc === src) {
            attempts += 1;
            const overlayState = getDiagOverlayState(video);
            if (overlayState.overlayAttached) overlayAttachedCount += 1;
            const removed = removeSoftBlur(video, src);
            if (removed) removedCount += 1;
            if (!removed && overlayState.overlayAttached) {
              overlayAttachedWithoutRemovalCount += 1;
            }
            diagSoftBlurLog(
              'find_remove_candidate',
              video,
              src,
              'via=video_match removed=' + removed + ' overlayAttached=' + overlayState.overlayAttached
            );
          }
        });
        document.querySelectorAll('[data-mw-bg-src]').forEach(el => {
          if (el.dataset.mwBgSrc === src) {
            attempts += 1;
            const overlayState = getDiagOverlayState(el);
            if (overlayState.overlayAttached) overlayAttachedCount += 1;
            const removed = removeSoftBlur(el, src);
            if (removed) removedCount += 1;
            if (!removed && overlayState.overlayAttached) {
              overlayAttachedWithoutRemovalCount += 1;
            }
            diagSoftBlurLog(
              'find_remove_candidate',
              el,
              src,
              'via=bg_match removed=' + removed + ' overlayAttached=' + overlayState.overlayAttached
            );
          }
        });
      }
      if (DIAG_YT_BLUR) {
        let videoMatches = 0;
        let bgMatches = 0;
        document.querySelectorAll('video').forEach(video => {
          if (video.poster === src || video.dataset.mwOrigPoster === src || video.dataset.mwSrc === src) {
            videoMatches += 1;
          }
        });
        document.querySelectorAll('[data-mw-bg-src]').forEach(el => {
          if (el.dataset.mwBgSrc === src) {
            bgMatches += 1;
          }
        });
        console.log(
          '[MW-YT][DIAG][SOFTBLUR]',
          'action=find_remove_summary',
          'src=' + String(src || '').substring(0, 160),
          'attempts=' + attempts,
          'removed=' + removedCount,
          'overlayAttached=' + overlayAttachedCount,
          'overlayAttachedWithoutRemoval=' + overlayAttachedWithoutRemovalCount,
          'videoMatches=' + videoMatches,
          'bgMatches=' + bgMatches
        );
      }
    } catch (e) {}
  }

  // ==================== MESSAGE LISTENER ====================

  const onModerationResultEvent = function(event) {
    const message = readHostEventPayload(event);
    if (!message || typeof message !== 'object') return;
    
    if (message.type === 'gc-moderation-result') {
      handleModerationResult(message);
    }
  };
  window.addEventListener('message', onModerationResultEvent);
  window.addEventListener('messageFromNative', onModerationResultEvent);

  // ==================== BATCH QUEUE MANAGEMENT ====================

  function flushBatchQueue() {
    if (batchQueue.length === 0) return;
    
    const itemsToSend = batchQueue.splice(0, CONFIG.batchSize);
    if (isShortsModeActive()) {
      const discoveredItems = itemsToSend.map(item => ({
        itemId: item.itemId,
        src: String(item.src || '').substring(0, 180),
        sourceType: item.sourceType || 'unknown',
      }));
      console.log(
        '[DIAG][SHORTS_SCAN] discovered',
        'count=' + discoveredItems.length,
        'items=' + JSON.stringify(discoveredItems)
      );
    }
    sendModerationRequest(itemsToSend);
    
    // If more items remain, schedule another flush
    if (batchQueue.length > 0) {
      batchTimer = setTimeout(flushBatchQueue, CONFIG.batchDelay);
    } else {
      batchTimer = null;
    }
  }

  function queueForScan(src, element, sourceType) {
    const url = normalizeUrl(src);
    if (!url) {
      state.stats.skipped++;
      logShortsScanSkip('invalid_url', null, src, sourceType);
      return false;
    }
    
    // Skip tiny data URLs
    if (url.startsWith('data:') && url.length < 1000) {
      state.stats.skipped++;
      logShortsScanSkip('tiny_data_url', null, url, sourceType);
      return false;
    }
    
    // FAIL-OPEN: Skip tiny images (< 80x80)
    if (isTinyImage(element)) {
      state.stats.skippedTiny++;
      logShortsScanSkip('tinyExcluded', null, url, sourceType);
      if (CONFIG.debug) {
        console.log('[MW] skipped tiny image (fail-open, <80x80):', url.substring(0, 50));
      }
      return false;
    }

    // Conservative skip for obvious avatars/icons/logos (fail-open).
    if (isLikelyAvatarLike(element)) {
      state.stats.skipped++;
      logShortsScanSkip('avatar_like', null, url, sourceType);
      if (CONFIG.debug) {
        console.log('[MW] skipped avatar-like element:', url.substring(0, 50));
      }
      return false;
    }

    if (isShortsModeActive()) {
      const currentShortsUrlId = getCurrentShortsUrlId();
      const sourceVideoId = getYouTubeAssetVideoId(url);
      if (
        currentShortsUrlId &&
        sourceVideoId &&
        sourceVideoId !== currentShortsUrlId &&
        sourceType !== 'video-frame'
      ) {
        state.stats.skipped++;
        logShortsScanSkip('shorts_non_active_video_asset', null, url, sourceType);
        return false;
      }
    }
    
    // Skip already processed
    if (state.scanned.has(url)) {
      logShortsScanSkip('cache_scanned', null, url, sourceType);
      return false;
    }
    
    // Skip if already revealed by user (persistence)
    if (isRevealedForSource(url, element)) {
      logShortsScanSkip('revealed_persistence', null, url, sourceType);
      return false;
    }
    
    if (state.pending.size >= MAX_PENDING_ITEMS || batchQueue.length >= MAX_BATCH_QUEUE_ITEMS) {
      state.stats.skippedQueueCap++;
      logShortsScanSkip('queue_cap', null, url, sourceType);
      return false;
    }
    if (!allowPerSecond(rateLimiter.enqueue, MAX_ENQUEUE_PER_SEC)) {
      state.stats.skippedRateLimited++;
      logShortsScanSkip('rate_limit', null, url, sourceType);
      return false;
    }

    const existingPendingId = state.pendingBySrc.get(url);
    if (existingPendingId) {
      const existingPending = state.pending.get(existingPendingId);
      if (existingPending && existingPending.src === url) {
        logShortsScanSkip('pending_duplicate_src', existingPendingId, url, sourceType);
        return false;
      }
      state.pendingBySrc.delete(url);
    }
    
    const itemId = generateItemId();
    const { width, height } = getElementDimensions(element);
    
    // Store element reference
    state.elements.set(itemId, element);
    element.dataset.mwSourceType = sourceType || 'unknown';
    
    // Phase 0 MVP: never soft-preblur on YouTube. Queue scans without painting
    // reveal-less partial blur (first-entry Shorts → home was a common failure).
    if (shouldSkipSoftPreblur()) {
      try { removeSoftBlur(element, url); } catch (e) {}
      if (CONFIG.debug) {
        console.log(
          '[DIAG][SHORTS_PREBLUR]',
          'action=skip_preblur',
          'itemId=' + itemId,
          'reason=mvp_no_soft_youtube',
          'sourceType=' + String(sourceType || 'unknown'),
          'url=' + String(url).substring(0, 180)
        );
      }
    } else {
      applySoftBlur(element, url, itemId);
    }
    const blurTimer = null;
    
    state.pending.set(itemId, {
      element: element,
      src: url,
      sourceType: sourceType,
      timestamp: Date.now(),
      state: 'pending',
      blurTimer: blurTimer,
    });
    state.pendingBySrc.set(url, itemId);
    
    // Add to batch queue with dimensions
    batchQueue.push({
      itemId: itemId,
      src: url,
      sourceType: sourceType,
      width: width,
      height: height,
    });
    
    // Schedule batch flush
    if (!batchTimer) {
      batchTimer = setTimeout(flushBatchQueue, CONFIG.batchDelay);
    }
    
    if (CONFIG.debug) {
      console.log('[MW] queued [' + sourceType + '] itemId=' + itemId + ' (' + width + 'x' + height + '):', url.substring(0, 70));
    }
    
    return true;
  }

  // ==================== VIEWPORT OPTIMIZATION (IntersectionObserver) ====================

  /**
   * Set up IntersectionObserver to only scan images currently visible
   */
  function setupViewportObserver() {
    if (!('IntersectionObserver' in window)) return null;
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Element is now visible - scan it
          const element = entry.target;
          if (element.dataset.mwViewportQueued !== 'true') {
            element.dataset.mwViewportQueued = 'true';
            queueMutationScan(element, 'viewport_intersection');
          }
        }
      });
    }, { 
      rootMargin: '200px',
      threshold: 0.01 
    });
    
    return observer;
  }

  /**
   * Add element to viewport observer
   */
  function observeForViewport(element) {
    if (state.viewportObserver && element.nodeType === 1) {
      state.viewportObserver.observe(element);
    }
  }

  // ==================== SCANNING FUNCTIONS ====================

  function scanImgElement(img) {
    let src = img.src ||
              img.dataset.src ||
              img.dataset.lazySrc ||
              img.dataset.thumbSrc ||
              img.getAttribute('data-src') ||
              img.getAttribute('data-lazy-src') ||
              img.getAttribute('data-thumb');
    
    // Handle srcset
    if (!src && img.srcset) {
      const parts = img.srcset.split(',');
      if (parts.length > 0) {
        src = parts[0].trim().split(' ')[0];
      }
    }
    
    if (!src) {
      state.stats.skipped++;
      diagScanRunLog('scanImgElement', img, '', false, 'reason=no_src');
      return;
    }
    const prevSrc = img.dataset.mwLastScanSrc || '';
    diagShortsRecycleLog(img, 'src', prevSrc, src);
    if (img.dataset.mwScanned === 'true' && img.dataset.mwLastScanSrc === src) {
      diagScanRunLog('scanImgElement', img, src, false, 'reason=duplicate_src');
      return;
    }
    
    img.dataset.mwScanned = 'true';
    img.dataset.mwLastScanSrc = src;
    img.dataset.mwOrigSrc = src;
    
    const queued = queueForScan(src, img, 'img');
    diagScanRunLog('scanImgElement', img, src, queued, 'sourceType=img');
    if (queued) {
      state.stats.imgTags++;
    }
  }

  const SHORTS_FRAME_CAPTURE_MAX_EDGE = 512;
  const SHORTS_FRAME_CAPTURE_JPEG_QUALITY = 0.72;

  function logScanSourceFallback(reason, videoNodeId, videoCurrentSrc, extraDetails) {
    diagScanSourceCounters.scan_source_fallback_reason += 1;
    const details =
      'count=' + diagScanSourceCounters.scan_source_fallback_reason +
      ' reason=' + (reason || 'unknown') +
      ' itemIdentity=' + (videoNodeId || 'unknown') +
      ' sourceType=video-poster' +
      ' currentSrc=' + String(videoCurrentSrc || '').substring(0, 180) +
      (extraDetails ? (' ' + extraDetails) : '');
    diagLogScanSource('fallback_reason', details);
    diagLogScanSource('scan_source_fallback_reason', details);
  }

  function isActiveVisibleShortsVideo(video) {
    if (!isShortsModeActive()) return false;
    if (!video || video.nodeType !== 1 || !video.isConnected) return false;
    if (!isElementVisible(video)) return false;
    const activeContainer = getActiveShortsPlayerContainer();
    if (!activeContainer || !activeContainer.isConnected) return false;
    const localContainer = getShortsCardOrPlayerContainerFromNode(video);
    if (activeContainer === video) return true;
    if (typeof activeContainer.contains === 'function' && activeContainer.contains(video)) return true;
    if (localContainer && localContainer.isConnected) {
      if (localContainer === activeContainer) return true;
      if (typeof localContainer.contains === 'function' && localContainer.contains(activeContainer)) return true;
      if (typeof activeContainer.contains === 'function' && activeContainer.contains(localContainer)) return true;
    }
    return false;
  }

  function getShortsFrameScanKey(video) {
    const source = getDiagSourceFields(video);
    const shortsUrlId = getCurrentShortsUrlId() || 'none';
    const normalizedCurrent = normalizeUrl(source.currentSrc || '') || String(source.currentSrc || '');
    const normalizedPoster = normalizeUrl(source.poster || '') || String(source.poster || '');
    return (
      shortsUrlId + '|' +
      String(normalizedCurrent || '').substring(0, 180) + '|' +
      String(normalizedPoster || '').substring(0, 180)
    );
  }

  // FREEZE-OVERRIDE (accuracy): miss-until-scrollback — first entry often samples poster
  // before the video has pixels. Bound retries for a decoded frame; poster is provisional.
  const SHORTS_FRAME_RETRY_DELAYS_MS = [200, 500, 1000, 1800];
  const shortsFrameRetryTimers = new WeakMap(); // video -> timeout id
  const shortsFrameRetryCounts = new WeakMap(); // video -> attempts for current key

  function isRetriableShortsFrameFailure(reason) {
    const r = String(reason || '');
    return (
      r === 'video_not_ready' ||
      r === 'video_dimensions_unavailable' ||
      r === 'frame_data_too_small' ||
      r === 'draw_image_failed'
    );
  }

  function clearShortsFrameRetry(video) {
    if (!video) return;
    try {
      const tid = shortsFrameRetryTimers.get(video);
      if (tid) {
        clearTimeout(tid);
        shortsFrameRetryTimers.delete(video);
      }
    } catch (e) {}
  }

  function scheduleActiveShortsFrameRetry(video, frameKey, reason) {
    if (!video || !video.isConnected || !isShortsModeActive()) return;
    if (!isActiveVisibleShortsVideo(video)) return;
    const key = String(frameKey || getShortsFrameScanKey(video) || '');
    const prevCount = Number(shortsFrameRetryCounts.get(video) || 0);
    if (prevCount >= SHORTS_FRAME_RETRY_DELAYS_MS.length) {
      console.log(
        '[DIAG][SHORTS_FRAME_RETRY]',
        'event=exhausted',
        'reason=' + String(reason || 'unknown'),
        'key=' + key.substring(0, 120)
      );
      return;
    }
    // Allow a new capture attempt: clear one-shot stamp so scanVideoPoster retries frame.
    try {
      if (video.dataset.mwLastShortsFrameAttemptKey === key) {
        video.dataset.mwLastShortsFrameAttemptKey = '';
      }
      video.dataset.mwShortsAwaitingFrame = '1';
    } catch (e) {}
    clearShortsFrameRetry(video);
    const delay = SHORTS_FRAME_RETRY_DELAYS_MS[prevCount];
    shortsFrameRetryCounts.set(video, prevCount + 1);
    const tid = setTimeout(function() {
      shortsFrameRetryTimers.delete(video);
      if (timerState.paused || timerState.teardownDone || !isShortsModeActive()) return;
      if (!video || !video.isConnected || !isActiveVisibleShortsVideo(video)) return;
      const liveKey = getShortsFrameScanKey(video);
      if (key && liveKey && key !== liveKey) {
        // Identity moved on — reset budget for the new short.
        shortsFrameRetryCounts.delete(video);
        return;
      }
      console.log(
        '[DIAG][SHORTS_FRAME_RETRY]',
        'event=fire',
        'attempt=' + (prevCount + 1),
        'delayMs=' + delay,
        'reason=' + String(reason || 'unknown'),
        'readyState=' + String(video.readyState)
      );
      try {
        scanVideoPoster(video);
      } catch (e) {}
    }, delay);
    shortsFrameRetryTimers.set(video, tid);
    console.log(
      '[DIAG][SHORTS_FRAME_RETRY]',
      'event=scheduled',
      'attempt=' + (prevCount + 1),
      'delayMs=' + delay,
      'reason=' + String(reason || 'unknown')
    );
  }

  function markActiveShortsFrameSuccess(video, frameKey) {
    clearShortsFrameRetry(video);
    try {
      shortsFrameRetryCounts.delete(video);
      video.dataset.mwShortsAwaitingFrame = '0';
      video.dataset.mwShortsFrameOk = '1';
      if (frameKey) video.dataset.mwLastShortsFrameSuccessKey = frameKey;
      const settledId = getCurrentShortsUrlId() || '';
      if (settledId) {
        video.dataset.mwShortsSettledId = settledId;
      }
    } catch (e) {}
  }

  // Battery: each short gets one final frame pipeline. After frameOk+settledId match,
  // skip re-capture/re-queue unless identity changes or dial forces rescan.
  function isActiveShortsFrameSettled(video) {
    if (!video || !video.dataset) return false;
    if (String(video.dataset.mwShortsFrameOk || '') !== '1') return false;
    const settledId = String(video.dataset.mwShortsSettledId || '');
    const liveId = getCurrentShortsUrlId() || '';
    if (!settledId || !liveId || settledId !== liveId) return false;
    return true;
  }

  function resetActiveShortsScanStateForIdentityChange(video, reason) {
    if (!video || !video.dataset) return;
    try {
      clearShortsFrameRetry(video);
      shortsFrameRetryCounts.delete(video);
      video.dataset.mwShortsFrameOk = '0';
      video.dataset.mwShortsAwaitingFrame = '0';
      video.dataset.mwLastShortsFrameAttemptKey = '';
      video.dataset.mwLastShortsFrameSuccessKey = '';
      video.dataset.mwShortsSettledId = '';
      video.dataset.mwPosterScanned = 'false';
      video.dataset.mwLastPoster = '';
      video.dataset.mwScanned = 'false';
      video.dataset.mwLastScanSrc = '';
      video.dataset.mwProvisionalUncertain = '0';
      // Drop prior short's hard/soft ownership so new short is classified cleanly.
      if (
        String(video.dataset.mwModerated || '') === 'blurred' ||
        String(video.dataset.mwModerated || '') === 'softblur' ||
        String(video.dataset.mwModerated || '') === 'revealed'
      ) {
        const srcClear = String(video.dataset.mwSrc || video.poster || video.src || '');
        try {
          clearAllBlurAndOverlay(video, srcClear, 'shorts_identity_change:' + (reason || 'unknown'), 'safe');
        } catch (e2) {}
      }
      console.log(
        '[DIAG][SHORTS_ACCURACY]',
        'event=identity_scan_reset',
        'reason=' + String(reason || 'unknown'),
        'node=' + getDiagNodeId(video),
        'liveId=' + String(getCurrentShortsUrlId() || 'none')
      );
    } catch (e) {}
  }

  function tryCaptureActiveShortsVideoFrame(video) {
    if (!video || video.nodeType !== 1 || !video.isConnected) {
      return { ok: false, reason: 'invalid_video_node' };
    }
    const readyState = Number.isFinite(video.readyState) ? video.readyState : 0;
    if (readyState < 2) {
      return { ok: false, reason: 'video_not_ready', readyState: readyState };
    }
    const sourceWidth = Math.max(0, Number(video.videoWidth) || 0);
    const sourceHeight = Math.max(0, Number(video.videoHeight) || 0);
    if (sourceWidth < 2 || sourceHeight < 2) {
      return { ok: false, reason: 'video_dimensions_unavailable', width: sourceWidth, height: sourceHeight };
    }

    const maxEdge = SHORTS_FRAME_CAPTURE_MAX_EDGE;
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const captureWidth = Math.max(1, Math.round(sourceWidth * scale));
    const captureHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = captureWidth;
    canvas.height = captureHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return { ok: false, reason: 'canvas_context_unavailable' };
    }

    try {
      ctx.drawImage(video, 0, 0, captureWidth, captureHeight);
    } catch (err) {
      return {
        ok: false,
        reason: 'draw_image_failed',
        error: (err && err.message) ? String(err.message) : String(err || ''),
      };
    }

    let dataUrl = '';
    try {
      dataUrl = canvas.toDataURL('image/jpeg', SHORTS_FRAME_CAPTURE_JPEG_QUALITY);
    } catch (err) {
      return {
        ok: false,
        reason: 'to_data_url_failed',
        error: (err && err.message) ? String(err.message) : String(err || ''),
      };
    }
    if (!dataUrl || dataUrl.length < 1000) {
      return {
        ok: false,
        reason: 'frame_data_too_small',
        dataLength: dataUrl ? dataUrl.length : 0,
      };
    }

    return {
      ok: true,
      src: dataUrl,
      width: captureWidth,
      height: captureHeight,
      readyState: readyState,
    };
  }

  function scanVideoPoster(video) {
    const videoNodeId = getDiagNodeId(video);
    const videoCurrentSrc = String((video && video.currentSrc) || (video && video.src) || '').substring(0, 180);
    const activeShortsVideo = isActiveVisibleShortsVideo(video);
    const shortsFrameKey = activeShortsVideo ? getShortsFrameScanKey(video) : '';
    if (activeShortsVideo) {
      diagLogScanSource(
        'active_shorts_detected',
        'itemIdentity=' + videoNodeId +
        ' sourceType=video-frame' +
        ' active=true' +
        ' frameKey=' + String(shortsFrameKey || '').substring(0, 180) +
        ' currentSrc=' + videoCurrentSrc
      );
      // Reset retry budget + scan markers when the active Short identity changes.
      if (
        (video.dataset.mwLastShortsFrameSuccessKey &&
          video.dataset.mwLastShortsFrameSuccessKey !== shortsFrameKey) ||
        (video.dataset.mwShortsSettledId &&
          getCurrentShortsUrlId() &&
          video.dataset.mwShortsSettledId !== getCurrentShortsUrlId())
      ) {
        resetActiveShortsScanStateForIdentityChange(video, 'frame_key_or_id_changed');
      }
      // Battery preserve: one finalized frame verdict per short identity.
      if (isActiveShortsFrameSettled(video)) {
        diagScanRunLog(
          'scanVideoPoster',
          video,
          '',
          false,
          'reason=frame_settled_battery_skip id=' + String(video.dataset.mwShortsSettledId || '')
        );
        return;
      }
      if (video.dataset.mwLastShortsFrameAttemptKey !== shortsFrameKey) {
        video.dataset.mwLastShortsFrameAttemptKey = shortsFrameKey;
        const frameCapture = tryCaptureActiveShortsVideoFrame(video);
        if (frameCapture.ok && frameCapture.src) {
          // New frame data URL always re-queues (bypass stale poster safe).
          try { state.scanned.delete(frameCapture.src); } catch (e) {}
          const queuedFrame = queueForScan(frameCapture.src, video, 'video-frame');
          if (queuedFrame) {
            // FREEZE-OVERRIDE (accuracy+battery): do NOT mark frameOk on queue.
            // Frame authority only after a final host result (non-uncertain).
            // Mark pending so we do not re-capture every mutation tick.
            try {
              video.dataset.mwShortsAwaitingFrame = '1';
              clearShortsFrameRetry(video);
            } catch (e) {}
            diagScanSourceCounters.video_frame_scan_used += 1;
            diagLogScanSource(
              'video_frame_scan_used',
              'count=' + diagScanSourceCounters.video_frame_scan_used +
              ' itemIdentity=' + videoNodeId +
              ' sourceType=video-frame' +
              ' used=true' +
              ' reason=active_shorts_frame_capture' +
              ' capture=' + frameCapture.width + 'x' + frameCapture.height +
              ' readyState=' + frameCapture.readyState +
              ' currentSrc=' + videoCurrentSrc
            );
            diagScanRunLog(
              'scanVideoPoster',
              video,
              frameCapture.src,
              true,
              'sourceType=video-frame capture=' + frameCapture.width + 'x' + frameCapture.height
            );
            state.stats.videoPosters++;
            return;
          }
          logScanSourceFallback(
            'frame_queue_rejected',
            videoNodeId,
            videoCurrentSrc,
            'sourceType=video-frame capture=' + frameCapture.width + 'x' + frameCapture.height
          );
          scheduleActiveShortsFrameRetry(video, shortsFrameKey, 'frame_queue_rejected');
        } else {
          logScanSourceFallback(
            frameCapture.reason || 'frame_capture_failed',
            videoNodeId,
            videoCurrentSrc,
            'sourceType=video-frame'
          );
          // FREEZE-OVERRIDE (accuracy): do not lock out retries on not-ready video.
          // Clear one-shot stamp so scheduled retries can re-enter this branch.
          if (isRetriableShortsFrameFailure(frameCapture.reason)) {
            try { video.dataset.mwLastShortsFrameAttemptKey = ''; } catch (e) {}
            scheduleActiveShortsFrameRetry(video, shortsFrameKey, frameCapture.reason || 'frame_capture_failed');
          }
        }
      } else if (video.dataset.mwShortsFrameOk === '1') {
        diagScanRunLog('scanVideoPoster', video, '', false, 'reason=frame_already_succeeded_for_active_key');
      } else {
        // Attempt stamped but no final frameOk yet — keep retrying if budget remains.
        scheduleActiveShortsFrameRetry(video, shortsFrameKey, 'attempt_stamped_awaiting_success');
        diagScanRunLog('scanVideoPoster', video, '', false, 'reason=frame_attempt_pending_retry');
      }
    }
    const poster = video.poster ||
                   video.dataset.poster ||
                   video.getAttribute('data-poster');
    
    if (!poster) {
      const posterMissingFallbackReason = activeShortsVideo
        ? 'poster_missing_after_frame_path'
        : 'poster_missing_no_frame_scan';
      logScanSourceFallback(
        posterMissingFallbackReason,
        videoNodeId,
        videoCurrentSrc,
        'sourceType=video-poster'
      );
      const frameUnusedReason = activeShortsVideo
        ? 'poster_missing_after_frame_path'
        : 'poster_missing_frame_scan_unavailable';
      diagLogScanSource(
        'video_frame_scan_used',
        'count=' + diagScanSourceCounters.video_frame_scan_used +
        ' itemIdentity=' + videoNodeId +
        ' sourceType=video-frame' +
        ' used=false' +
        ' reason=' + frameUnusedReason
      );
      diagScanRunLog('scanVideoPoster', video, '', false, 'reason=no_poster');
      if (isShortsModeActive()) {
        const source = getDiagSourceFields(video);
        diagFailCaseLog(
          'video_without_poster_not_scanned',
          video,
          source.currentSrc || '',
          'posterMissing=true'
        );
      }
      return;
    }
    const prevPoster = video.dataset.mwLastPoster || '';
    diagShortsRecycleLog(video, 'poster', prevPoster, poster);
    if (video.dataset.mwPosterScanned === 'true' && video.dataset.mwLastPoster === poster) {
      diagScanRunLog('scanVideoPoster', video, poster, false, 'reason=duplicate_poster');
      return;
    }
    
    video.dataset.mwPosterScanned = 'true';
    video.dataset.mwLastPoster = poster;
    video.dataset.mwOrigPoster = poster;
    diagScanSourceCounters.poster_scan_used += 1;
    diagLogScanSource(
      'poster_scan_used',
      'count=' + diagScanSourceCounters.poster_scan_used +
      ' itemIdentity=' + videoNodeId +
      ' sourceType=video-poster' +
      ' src=' + String(poster || '').substring(0, 180) +
      ' currentSrc=' + videoCurrentSrc
    );
    diagLogScanSource(
      'video_frame_scan_used',
      'count=' + diagScanSourceCounters.video_frame_scan_used +
      ' itemIdentity=' + videoNodeId +
      ' sourceType=video-frame' +
      ' used=false' +
      ' reason=' + (activeShortsVideo ? 'poster_fallback' : 'poster_available_prefers_poster')
    );
    if (isShortsModeActive()) {
      console.log(
        '[DIAG][VIDEO] using_thumbnail_only',
        'src=' + String(poster || '').substring(0, 180)
      );
    }
    // FREEZE-OVERRIDE (accuracy): poster-only is provisional on active Shorts until
    // a decoded frame succeeds (scroll-back catch was a new frame data URL).
    if (activeShortsVideo && video.dataset.mwShortsFrameOk !== '1') {
      try { video.dataset.mwShortsAwaitingFrame = '1'; } catch (e) {}
      scheduleActiveShortsFrameRetry(video, shortsFrameKey, 'poster_provisional');
    }
    
    const queued = queueForScan(poster, video, 'video-poster');
    diagScanRunLog('scanVideoPoster', video, poster, queued, 'sourceType=video-poster');
    if (queued) {
      state.stats.videoPosters++;
    }
  }

  function scanBgImage(element) {
    const bgUrl = extractBgImageUrl(element);
    if (!bgUrl) {
      return;
    }
    const prevBg = element.dataset.mwLastBg || '';
    diagShortsRecycleLog(element, 'bg', prevBg, bgUrl);
    if (element.dataset.mwBgScanned === 'true' && element.dataset.mwLastBg === bgUrl) {
      diagScanRunLog('scanBgImage', element, bgUrl, false, 'reason=duplicate_bg');
      return;
    }
    
    element.dataset.mwBgScanned = 'true';
    element.dataset.mwLastBg = bgUrl;
    element.dataset.mwBgSrc = bgUrl;
    
    const queued = queueForScan(bgUrl, element, 'bg-image');
    diagScanRunLog('scanBgImage', element, bgUrl, queued, 'sourceType=bg-image');
    if (queued) {
      state.stats.bgImages++;
    }
  }

  function scanShadowRoot(shadowRoot) {
    if (!shadowRoot) return;
    
    console.log('[MW] Scanning Shadow DOM');
    state.stats.shadowDom++;
    
    try {
      shadowRoot.querySelectorAll('img').forEach(scanImgElement);
      shadowRoot.querySelectorAll('video').forEach(scanVideoPoster);
      const allowHeavySweep = allowShortsHeavyScanSweep('scanShadowRoot');
      if (allowHeavySweep) {
        shadowRoot.querySelectorAll('*').forEach(el => {
          scanBgImage(el);
          if (el.shadowRoot) {
            scanShadowRoot(el.shadowRoot);
          }
        });
      }
      
      setupMutationObserver(shadowRoot);
    } catch (e) {
      console.error('[MW] Shadow DOM scan error:', e.message);
    }
  }

  function scanNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (!allowPerSecond(rateLimiter.scanNode, MAX_SCAN_NODE_PER_SEC)) {
      state.stats.skippedRateLimited++;
      logShortsScanSkip('scan_node_rate_limit', null, 'node:' + getDiagNodeId(node), 'node');
      return;
    }
    
    const tagName = node.tagName?.toUpperCase();
    
    if (tagName === 'IMG') {
      scanImgElement(node);
    } else if (tagName === 'VIDEO') {
      scanVideoPoster(node);
    }
    
    scanBgImage(node);
    
    if (node.shadowRoot) {
      scanShadowRoot(node.shadowRoot);
    }
    
    try {
      node.querySelectorAll('img').forEach(scanImgElement);
      node.querySelectorAll('video').forEach(scanVideoPoster);
      const allowHeavySweep = allowShortsHeavyScanSweep('scanNode');
      if (allowHeavySweep) {
        node.querySelectorAll('*').forEach(el => {
          scanBgImage(el);
          if (el.shadowRoot) {
            scanShadowRoot(el.shadowRoot);
          }
        });
      }
    } catch (e) {}
  }

  function scanFullPage() {
    if (!CONFIG.scanEnabled) {
      console.log('[MW] Scanning disabled (sensitivity: ' + CONFIG.sensitivity + ')');
      return;
    }
    if (isShortsModeActive()) {
      console.log(
        '[DIAG][SHORTS_SCAN] discovery_run',
        'navId=' + NAV_ID,
        'pageEpoch=' + state.pageEpoch,
        'url=' + window.location.href,
        'reason=scanFullPage'
      );
    }
    
    console.log('[MW] ========== FULL PAGE SCAN ==========');
    scanNode(document.body);
    console.log('[MW] Stats:', JSON.stringify(state.stats));
  }

  // ==================== MUTATION OBSERVER ====================

  /**
   * YouTube-specific selectors for aggressive thumbnail scanning
   */
  const YOUTUBE_SELECTORS = [
    'ytd-thumbnail',
    'ytd-thumbnail img',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-shelf-renderer',
    '#thumbnail',
    '#thumbnail img',
    '.yt-core-image',
    'yt-image',
    'yt-img-shadow',
    '.ytd-thumbnail img',
    '.video-thumb',
    'img[src*="ytimg.com"]',
    'img[src*="ggpht.com"]',
  ];

  /**
   * Check if we're on YouTube
   */
  function isYouTube() {
    return window.location.hostname.includes('youtube.com') || 
           window.location.hostname.includes('youtu.be');
  }

  /**
   * Scan YouTube-specific thumbnail elements aggressively
   */
  function scanYouTubeThumbnails() {
    if (!isYouTube()) return;
    if (isShortsModeActive()) {
      console.log(
        '[DIAG][SHORTS_SCAN] discovery_run',
        'navId=' + NAV_ID,
        'pageEpoch=' + state.pageEpoch,
        'url=' + window.location.href,
        'reason=scanYouTubeThumbnails'
      );
    }
    
    console.log('[MW] === YOUTUBE THUMBNAIL SCAN ===');
    
    YOUTUBE_SELECTORS.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          // Find all img elements within or the element itself
          if (el.tagName === 'IMG') {
            scanImgElement(el);
          } else {
            el.querySelectorAll('img').forEach(scanImgElement);
          }
        });
      } catch (e) {}
    });
  }

  function scanActiveShortsPlayerContainer(reason) {
    try { clearStaleShortsRevealMarkersOnSwipe('scan_active:' + (reason || 'unknown')); } catch (e) {}
    if (!isVisualModerationActive()) {
      warnProfileOriginShortsDiag(
        'discovery_blocked',
        'reason=visual_moderation_inactive trigger=' + (reason || 'unknown') +
        ' scanEnabled=' + String(!!CONFIG.scanEnabled) +
        ' enabled=' + String(!!CONFIG.enabled) +
        ' flashShieldV1=' + String(!!CONFIG.flashShieldV1),
        { throttleMs: 2500 }
      );
      warnActiveShortsModeGapDiag('scan_blocked_visual_moderation_inactive:' + (reason || 'unknown'));
      return false;
    }
    if (!isShortsModeActive()) {
      warnProfileOriginShortsDiag(
        'discovery_blocked',
        'reason=shorts_mode_inactive trigger=' + (reason || 'unknown'),
        { throttleMs: 2500 }
      );
      // Critical profile-origin signal: player DOM may already be present while URL
      // is still /@channel/shorts (mode gate false → no adaptive watch / no force seed).
      warnActiveShortsModeGapDiag('scan_blocked_shorts_mode_inactive:' + (reason || 'unknown'));
      return false;
    }
    refreshAdaptiveShortsOverlayWatch('scanActiveShortsPlayerContainer:' + (reason || 'unknown'));
    const candidateInfo = getAdaptiveActiveShortsCandidateIdentity();
    warnProfileOriginShortsDiag(
      'discovery_run',
      'reason=' + (reason || 'unknown') +
      ' candidateIdentity=' + String(candidateInfo.identity || 'none').substring(0, 240) +
      ' contentIdentity=' + String(candidateInfo.contentIdentity || 'none').substring(0, 220) +
      ' containerNodeId=' + getDiagNodeId(candidateInfo.container) +
      ' mediaNodeId=' + getDiagNodeId(candidateInfo.mediaNode),
      { throttleMs: 1000 }
    );
    console.log(
      '[DIAG][SHORTS_SCAN] discovery_run',
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch,
      'url=' + window.location.href,
      'reason=' + (reason || 'unknown')
    );
    const container = getActiveShortsPlayerContainer();
    if (!container || !container.isConnected) {
      if (DIAG_YT_BLUR) {
        console.log(
          '[MW-YT][DIAG][SHORTS_TARGET]',
          'action=scan_skip_no_container',
          'reason=' + (reason || 'unknown')
        );
      }
      warnActiveShortsRevealPairingDiag(
        'discovery_no_container',
        {
          reason: String(reason || 'unknown'),
          failClass: 'no_active_container',
          overlayExpected: false,
          overlayPresent: false,
          overlayAttached: false,
          overlayVisible: false,
          overlayAnchored: false,
          hasComputedBlur: false,
        },
        { throttleMs: 1500 }
      );
      return false;
    }
    const discoveredItems = collectShortsDiscoveryItems(container);
    warnProfileOriginShortsDiag(
      'discovery_items',
      'reason=' + (reason || 'unknown') +
      ' count=' + discoveredItems.length +
      ' items=' + JSON.stringify(discoveredItems).substring(0, 900),
      { throttleMs: 1000 }
    );
    if (!discoveredItems || discoveredItems.length === 0) {
      postActiveShortsTransitionDiag('discovery_zero_items', {
        reason: String(reason || 'unknown'),
        containerNodeId: getDiagNodeId(container),
        containerTag: String(container.tagName || 'unknown'),
      });
    }
    console.log(
      '[DIAG][SHORTS_SCAN] discovered',
      'count=' + discoveredItems.length,
      'items=' + JSON.stringify(discoveredItems)
    );
    if (DIAG_YT_BLUR) {
      console.log(
        '[MW-YT][DIAG][SHORTS_TARGET]',
        'action=scan_container',
        'reason=' + (reason || 'unknown'),
        'nodeId=' + getDiagNodeId(container),
        'tag=' + (container.tagName || 'unknown')
      );
    }
    scanNode(container);
    return true;
  }

  function scheduleYouTubeScan(reason) {
    if (!isShortsModeActive()) {
      warnProfileOriginShortsDiag(
        'schedule_youtube_scan_blocked',
        'reason=shorts_mode_inactive trigger=' + (reason || 'unknown'),
        { throttleMs: 2500 }
      );
      return;
    }
    if (timerState.paused || timerState.teardownDone) return;
    clearNamedTimeout('youtubeMutationScanTimeout', 'reschedule');
    timerState.youtubeMutationScanTimeout = setTimeout(() => {
      if (timerState.paused || timerState.teardownDone) return;
      refreshAdaptiveShortsOverlayWatch('scheduleYouTubeScan:' + (reason || 'mutation'));
      if (DIAG_YT_BLUR) {
        console.log(
          '[MW-YT][DIAG][MUT_ATTR]',
          'action=scheduled_scan',
          'reason=' + (reason || 'mutation'),
          'url=' + window.location.href
        );
      }
      const allowHeavySweep = allowShortsHeavyScanSweep('scheduleYouTubeScan:' + (reason || 'mutation'));
      scanActiveShortsPlayerContainer('scheduled:' + (reason || 'mutation'));
      if (allowHeavySweep) {
        scanYouTubeThumbnails();
      } else if (DIAG_YT_BLUR) {
        console.log(
          '[MW-YT][DIAG][MUT_ATTR]',
          'action=skip_heavy_thumbnail_sweep',
          'reason=' + (reason || 'mutation')
        );
      }
    }, 120);
    timerLog('start', 'youtubeMutationScanTimeout:' + (reason || 'mutation'));
  }

  function setupMutationObserver(root) {
    const observerRootNodeId = getDiagNodeId(root);
    let shortsAttrMode = reevaluateShortsObserverMode(
      'setupMutationObserver',
      window.location.href,
      {
        forceLog: true,
        extra: 'rootNode=' + observerRootNodeId + ' existingObservers=' + state.mutationObservers.length,
      }
    ).mode;
    const observeAttributes = isYouTube();
    const attributeFilter = observeAttributes
      ? ['src', 'srcset', 'poster', 'data-src', 'data-lazy-src', 'style', 'class', 'aria-hidden', 'aria-current', 'hidden', 'selected', 'is-active', 'data-video-id', 'data-item-id', 'data-id', 'data-index']
      : ['src', 'srcset', 'poster', 'data-src', 'data-lazy-src', 'style'];
    const observer = new MutationObserver(mutations => {
      if (timerState.paused) return;
      if (!CONFIG.scanEnabled && !CONFIG.flashShieldV1) return;
      
      let hasYouTubeChanges = false;
      shortsAttrMode = reevaluateShortsObserverMode('mutation_batch', window.location.href).mode;
      
      for (const mutation of mutations) {
        mutation.removedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          pruneDisconnectedPending('mutation_removed');
          if (isYouTube() && !isShortsModeActive()) {
            reapplyOwnedContainerBlurFromMutationNode(mutation.target, 'mutation_removed');
          }
          if (isYouTube() && isRelevantShortsContainerNode(node)) {
            shortsAttrMode = reevaluateShortsObserverMode(
              'youtube_container_removed',
              window.location.href,
              {
                extra: 'rootNode=' + observerRootNodeId + ' containerNode=' + getDiagNodeId(node),
              }
            ).mode;
            refreshAdaptiveShortsOverlayWatch('container_removed');
          }
        });
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          markFlashShieldCandidates(node);
          if (isShortsModeActive()) markFlashShieldShortsCandidate();
          if (isYouTube() && !isShortsModeActive()) {
            reapplyOwnedContainerBlurFromMutationNode(node, 'mutation_added');
          }
          if (isYouTube() && isRelevantShortsContainerNode(node)) {
            shortsAttrMode = reevaluateShortsObserverMode(
              'youtube_container_added',
              window.location.href,
              {
                extra: 'rootNode=' + observerRootNodeId + ' containerNode=' + getDiagNodeId(node),
              }
            ).mode;
            hasYouTubeChanges = true;
            refreshAdaptiveShortsOverlayWatch('container_added');
          }
          if (shortsAttrMode) {
            reattachShortsBlurForInsertedNode(node, 'global_mutation_added', null);
            if (DIAG_YT_BLUR) {
              diagLogVideoInserted(node, 'global_mutation_added', null, '', '');
            }
          }
          
          // Check if this is a YouTube thumbnail element
          if (isYouTube()) {
            const el = node;
            const tagName = el.tagName ? el.tagName.toLowerCase() : '';
            
            // YouTube-specific: immediately scan ytd-* elements
            if (tagName.startsWith('ytd-') ||
                tagName === 'yt-image' ||
                el.id === 'thumbnail' ||
                el.classList?.contains('yt-core-image')) {
              hasYouTubeChanges = true;
            }
          }
          if (isYouTube() && !isShortsModeActive()) {
            if (String(node.tagName || '').toUpperCase() === 'VIDEO') {
              diagNonShortsReattach(node, 'mutation_added:video');
            }
            if (typeof node.querySelectorAll === 'function') {
              node.querySelectorAll('video').forEach(videoNode => {
                diagNonShortsReattach(videoNode, 'mutation_added:descendant_video');
              });
            }
          }
          
          // Add to viewport observer for lazy scanning
          observeForViewport(node);
          queueMutationScan(node, 'mutation_added');
        });
        
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          const attr = mutation.attributeName || '';
          if (CONFIG.flashShieldV1 && target && target.nodeType === 1) {
            markFlashShieldCandidates(target);
            if (isShortsModeActive()) markFlashShieldShortsCandidate();
          }
          if (
            isYouTube() &&
            !isShortsModeActive() &&
            target &&
            target.nodeType === 1 &&
            String(target.tagName || '').toUpperCase() === 'VIDEO' &&
            (
              attr === 'src' ||
              attr === 'poster' ||
              attr === 'style' ||
              attr === 'class' ||
              attr === 'aria-hidden' ||
              attr === 'aria-current' ||
              attr === 'hidden'
            )
          ) {
            diagNonShortsReattach(target, 'attr:' + attr);
            reapplyOwnedContainerBlurFromMutationNode(target, 'mutation_attr:' + attr);
          }
          if (
            isYouTube() &&
            target &&
            target.nodeType === 1 &&
            shouldReevaluateShortsModeOnContainerAttribute(target, attr)
          ) {
            shortsAttrMode = reevaluateShortsObserverMode(
              'youtube_container_attr:' + attr,
              window.location.href,
              {
                extra: 'rootNode=' + observerRootNodeId + ' containerNode=' + getDiagNodeId(target),
              }
            ).mode;
            refreshAdaptiveShortsOverlayWatch('container_attr:' + attr);
          }
          if (!shortsAttrMode || target.nodeType !== 1) {
            continue;
          }
          if (DIAG_YT_BLUR) {
            const srcFields = getDiagSourceFields(target);
            console.log(
              '[MW-YT][DIAG][MUT_ATTR]',
              'action=attribute_hit',
              'attr=' + attr,
              'nodeId=' + getDiagNodeId(target),
              'tag=' + (target.tagName || 'unknown'),
              'currentSrc=' + String(srcFields.currentSrc || '').substring(0, 160),
              'poster=' + String(srcFields.poster || '').substring(0, 160)
            );
            if (String(target.tagName || '').toUpperCase() === 'VIDEO') {
              diagShortsSwapMarker(
                target,
                'attr:' + attr,
                false,
                false,
                'awaiting_immediate_swap_path'
              );
            }
          }
          if (String(target.tagName || '').toUpperCase() === 'VIDEO') {
            maybeReattachShortsBlurForVideoNode(target, 'attr:' + attr, null);
          }
          const shortsStructuralAttrSignal = (
            attr === 'aria-hidden' ||
            attr === 'aria-current' ||
            attr === 'hidden' ||
            attr === 'selected' ||
            attr === 'is-active' ||
            attr === 'class' ||
            attr.indexOf('data-') === 0
          );
          const hasShortsContainer = !!getShortsCardOrPlayerContainerFromNode(target);
          const shouldQueueAttrScan = (
            attr === 'src' ||
            attr === 'srcset' ||
            attr === 'poster' ||
            attr === 'data-src' ||
            attr === 'data-lazy-src' ||
            attr === 'style' ||
            (shortsAttrMode && shortsStructuralAttrSignal && hasShortsContainer)
          );
          if (DIAG_YT_BLUR) {
            console.log(
              '[MW-YT][DIAG][MUT_ATTR]',
              'action=scan_schedule_decision',
              'attr=' + attr,
              'nodeId=' + getDiagNodeId(target),
              'scheduled=' + shouldQueueAttrScan,
              'shortsStructural=' + shortsStructuralAttrSignal,
              'hasShortsContainer=' + hasShortsContainer
            );
          }
          if (shouldQueueAttrScan) {
            queueMutationScan(target, 'attr:' + attr);
            hasYouTubeChanges = true;
            const shortsContainer = getShortsCardOrPlayerContainerFromNode(target);
            if (shortsContainer && shortsContainer !== target) {
              queueMutationScan(shortsContainer, 'attr_container:' + attr);
            }
          }
        }
      }
      
      enforceRevealOverlayVisibilityGuardGlobal('mutation_batch');
      if (!isShortsModeActive() && hasYouTubeChanges) {
        warnProfileOriginShortsDiag(
          'mutation_youtube_changes_non_shorts_mode',
          'shortsAttrMode=' + String(!!shortsAttrMode) +
          ' hasYouTubeChanges=' + String(!!hasYouTubeChanges),
          { throttleMs: 2500 }
        );
        scheduleNonShortsRevealOverlayReposition('mutation');
      }
      if (shortsAttrMode && hasYouTubeChanges) {
        scheduleShortsRevealOverlayReposition('mutation');
        scheduleYouTubeScan('mutation');
      }
    });
    if (observeAttributes) {
      diagLogObserverMode(
        shortsAttrMode,
        'observer_observe_attributes_on',
        window.location.href,
        'rootNode=' + observerRootNodeId + ' attributeFilter=' + attributeFilter.join(',')
      );
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: attributeFilter,
      });
    } else {
      diagLogObserverMode(
        shortsAttrMode,
        'observer_observe_attributes_off',
        window.location.href,
        'rootNode=' + observerRootNodeId
      );
      observer.observe(root, { childList: true, subtree: true, attributes: false });
    }
    state.mutationObservers.push(observer);
    return observer;
  }

  // ==================== YOUTUBE SCROLL HANDLER ====================
  
  /**
   * Handle YouTube infinite scroll - rescan on scroll
   */
  function setupYouTubeScrollHandler() {
    if (!isYouTube()) return;
    let lastScrollY = 0;

    timerState.youtubeScrollHandler = () => {
      if (timerState.paused) return;
      scheduleShortsRevealOverlayReposition('youtube_scroll');
      const currentScrollY = window.scrollY;
      const scrollDelta = Math.abs(currentScrollY - lastScrollY);
      
      // Only trigger if scrolled significantly
      if (scrollDelta > 200) {
        lastScrollY = currentScrollY;

        clearNamedTimeout('youtubeScrollTimeout', 'reschedule');
        timerState.youtubeScrollTimeout = setTimeout(() => {
          console.log('[MW] YouTube scroll detected - rescanning thumbnails');
          scanYouTubeThumbnails();
        }, 150);
        timerLog('start', 'youtubeScrollTimeout');
      }
    };

    window.addEventListener('scroll', timerState.youtubeScrollHandler, { passive: true });
    
    console.log('[MW] YouTube scroll handler initialized');
  }

  // ==================== LEGACY QUEUE SUPPORT ====================
  
  // Keep legacy queues for backward compatibility with polling approach
  window.__MW_LEGACY_QUEUE_PRODUCER__ = 'disabled';
  window.__GC_SCAN_QUEUE__ = window.__GC_SCAN_QUEUE__ || [];
  window.__GC_SCAN_RESULTS__ = window.__GC_SCAN_RESULTS__ || [];
  
  // Poll legacy results queue (fallback if postMessage doesn't work)
  function processLegacyResults() {
    if (!isVisualModerationActive()) {
      if (window.__GC_SCAN_RESULTS__ && window.__GC_SCAN_RESULTS__.length > 0) {
        window.__GC_SCAN_RESULTS__.splice(0, window.__GC_SCAN_RESULTS__.length);
      }
      return;
    }
    if (!window.__GC_SCAN_RESULTS__ || window.__GC_SCAN_RESULTS__.length === 0) {
      return;
    }
    
    const results = window.__GC_SCAN_RESULTS__.splice(0, window.__GC_SCAN_RESULTS__.length);
    
    results.forEach(result => {
      const { src, shouldBlur, category, blurStrengthPx, nonce, pageEpoch, epoch } = result;
      
      // SECURITY: Validate nonce if provided
      if (nonce && nonce !== CONFIG.nonce) {
        console.warn('[MW] NONCE MISMATCH in legacy result - rejecting:', src.substring(0, 50));
        state.stats.nonceRejected++;
        return;
      }
      
      console.log('[MW] legacy result:', src.substring(0, 50), '-> blur:', shouldBlur, 'cat:', category);
      
      const rawCategory = normalizePolicyCategory(category);
      const normalizedCategory = normalizeLabel(category);
      // FREEZE-OVERRIDE (lifecycle): pending model must not finalize as safe/scanned.
      if (rawCategory === 'model_not_ready' || normalizedCategory === 'model_not_ready') {
        clearElementScanDedupeMarkers(null, 'legacy_model_not_ready');
        return;
      }
      state.scanned.add(src);
      const errorCategory = rawCategory || normalizedCategory;
      const isError = errorCategory === 'error' || errorCategory === 'timeout' || errorCategory === 'error_fail_closed';
      const policyDecision = applyFailOpenAndModePolicy(!!shouldBlur, rawCategory, rawCategory, isError);
      let shouldApplyBlur = CONFIG.forcedBlur || (policyDecision.shouldBlur && CONFIG.enabled && CONFIG.sensitivity > 0);
      const hasEpoch = Number.isFinite(pageEpoch) || Number.isFinite(epoch);
      console.log(
        '[MW][LegacyResult][Decision]',
        'src=' + String(src || '').substring(0, 120),
        'applyBlur=' + shouldApplyBlur,
        'hasNonce=' + (!!nonce),
        'hasEpoch=' + hasEpoch
      );
      if (shouldApplyBlur && isSafeResolvedActive(src)) {
        shouldApplyBlur = false;
        if (CONFIG.debug) {
          console.log('[MW] legacy policy decision: safe_resolved_ignore_legacy src=' + src.substring(0, 60));
        }
      }
      if (CONFIG.debug && policyDecision.reason) {
        console.log('[MW] legacy policy decision:', policyDecision.reason, 'src=' + src.substring(0, 60));
      }

      if (shouldApplyBlur) {
        findAndBlur(src, category, blurStrengthPx, true);
      } else {
        // Remove soft blur for safe results
        findAndRemoveSoftBlur(src);
      }

      // Always resolve pending items for this src and cancel semantic-delay timers.
      for (const [itemId, pending] of state.pending.entries()) {
        if (pending.src !== src) continue;
        if (pending.blurTimer) clearTimeout(pending.blurTimer);
        const el = pending.element;
        if (!shouldApplyBlur && el && el.isConnected) {
          removeSoftBlur(el, src);
          el.dataset.mwModerated = 'safe';
          markSafeResolved(src);
        }
        if (shouldApplyBlur && el && el.isConnected) {
          diagLogApplyByItemId(
            itemId,
            src,
            el,
            'applyPath=item_identity_legacy sourceType=' + (pending.sourceType || 'unknown')
          );
          applyBlur(el, src, category, blurStrengthPx, itemId, 'classifier_positive');
          clearSafeResolved(src);
      }
        clearPendingItem(itemId, 'legacy_result');
      }
    });
    enforceRevealOverlayVisibilityGuardGlobal('legacy_results');
  }

  function startLegacyResultsPoll(reason) {
    if (timerState.legacyResultsInterval || timerState.paused) return;
    if (isShortsModeActive()) {
      if (DIAG_YT_BLUR) {
        console.log(
          '[MW-YT][DIAG][POLL]',
          'path=legacyResultsInterval',
          'mode=disabled_in_shorts',
          'reason=' + (reason || 'init'),
          'url=' + window.location.href
        );
      }
      return;
    }
    if (DIAG_YT_BLUR) {
      console.log(
        '[MW-YT][DIAG][POLL]',
        'path=legacyResultsInterval',
        'mode=enabled',
        'reason=' + (reason || 'init'),
        'url=' + window.location.href
      );
    }
    timerState.legacyResultsInterval = setInterval(processLegacyResults, LEGACY_RESULTS_POLL_MS);
    timerLog('start', 'legacyResultsInterval:' + reason);
  }

  function countActiveTimerHandles() {
    let count = 0;
    if (timerState.legacyResultsInterval) count++;
    if (timerState.urlChangeInterval) count++;
    if (timerState.youtubePeriodicInterval) count++;
    if (timerState.shortsHealthHealInterval) count++;
    if (timerState.debugSummaryInterval) count++;
    if (timerState.mainScrollTimeout) count++;
    if (timerState.youtubeScrollTimeout) count++;
    if (timerState.youtubeMutationScanTimeout) count++;
    if (timerState.revealOverlayRepositionRaf) count++;
    if (timerState.nonShortsRevealOverlayRepositionRaf) count++;
    if (adaptiveShortsWatchState.pendingRescanTimer) count++;
    if (adaptiveShortsWatchState.observer) count++;
    count += timerState.initialTimeouts.length;
    if (batchTimer) count++;
    state.pendingRequests.forEach(req => { if (req && req.timeoutId) count++; });
    state.pending.forEach(item => { if (item && item.blurTimer) count++; });
    return count;
  }

  function startDebugSummary(reason) {
    if (!CONFIG.debug || timerState.paused || timerState.debugSummaryInterval) return;
    timerState.debugSummaryInterval = setInterval(function() {
      cleanupExpiredSafeResolved();
      pruneDisconnectedPending('debug_summary');
      console.log(
        '[MW][Summary]',
        'pending=' + state.pending.size,
        'blurred=' + state.blurred.size,
        'safeResolved=' + state.safeResolved.size,
        'activeTimers=' + countActiveTimerHandles()
      );
    }, 5000);
    timerLog('start', 'debugSummaryInterval:' + reason);
  }

  function startDiagHeartbeat(reason) {
    if (!DIAG_ENABLED || timerState.paused || timerState.diagHeartbeatInterval) return;
    diagPrevRequests = state.stats.requestsSent;
    diagPrevResponses = state.stats.responsesReceived;
    timerState.diagHeartbeatInterval = setInterval(function() {
      const nowReq = state.stats.requestsSent;
      const nowRes = state.stats.responsesReceived;
      const deltaReq = nowReq - diagPrevRequests;
      const deltaRes = nowRes - diagPrevResponses;
      diagPrevRequests = nowReq;
      diagPrevResponses = nowRes;
      diagLog(
        'heartbeat',
        'stats queued=' + batchQueue.length +
        ' pending=' + state.pending.size +
        ' batch=' + batchQueue.length +
        ' sentΔ=' + deltaReq +
        ' recvΔ=' + deltaRes +
        ' totalSent=' + nowReq +
        ' totalRecv=' + nowRes
      );
    }, 5000);
    timerLog('start', 'diagHeartbeat:' + reason);
  }

  function stopDiagHeartbeat(reason) {
    if (!timerState.diagHeartbeatInterval) return;
    clearInterval(timerState.diagHeartbeatInterval);
    timerState.diagHeartbeatInterval = null;
    timerLog('stop', 'diagHeartbeat:' + reason);
  }

  // ==================== INITIALIZATION ====================

  // Inject CSS
  if (!document.getElementById('mw-moderation-styles')) {
    const style = document.createElement('style');
    style.id = 'mw-moderation-styles';
    style.textContent = \`
      .mw-reveal-overlay {
        position: absolute !important;
        inset: 0 !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        background: rgba(0, 0, 0, 0.25) !important;
        z-index: 9998 !important;
        pointer-events: none !important;
      }
      #mw-reveal-portal .mw-reveal-overlay {
        background: transparent !important;
      }
      .mw-reveal-btn {
        z-index: 9999 !important;
        pointer-events: auto !important;
      }
      [data-mw-moderated="blurred"] {
        transition: filter 0.3s ease !important;
      }
      .mw-softblur {
        transition: filter 0.2s ease !important;
      }
      .mw-correction-overlay {
        pointer-events: auto !important;
      }
      ytd-thumbnail, ytd-rich-item-renderer, yt-img-shadow, #shorts-player,
      [class*="DivVideoContainer"], [class*="DivPlayerContainer"], .video-card {
        position: relative !important;
      }
    \`;
    document.head.appendChild(style);
    console.log('[MW] CSS styles injected');
  }

  // Expose targeted rescan hooks for the host (NativeWebViewBrowser)
  window.__MW_SCAN_FULL__ = scanFullPage;
  window.__MW_SCAN_YT__ = scanYouTubeThumbnails;
  window.__MW_SYNC_HOST_CONTEXT__ = function(payload) {
    try {
      const nextEpochRaw = payload && Number(payload.pageEpoch);
      const nextEpoch = Number.isFinite(nextEpochRaw) ? Math.max(1, Math.floor(nextEpochRaw)) : null;
      const reason = payload && payload.reason ? String(payload.reason) : 'host_context_sync';
      if (!nextEpoch) {
        return 'ERR_BAD_EPOCH';
      }
      const previousEpoch = Number.isFinite(state.pageEpoch) ? Number(state.pageEpoch) : 0;
      if (previousEpoch === nextEpoch) {
        console.log(
          '[DIAG][EPOCH_SYNC]',
          'action=epoch_sync_nochange',
          'prevEpoch=' + previousEpoch,
          'nextEpoch=' + nextEpoch,
          'reason=' + reason,
          'navId=' + NAV_ID,
          'url=' + window.location.href
        );
        return 'OK_NO_CHANGE';
      }

      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
      batchQueue = [];
      state.pendingRequests.forEach(req => {
        if (req && req.timeoutId) clearTimeout(req.timeoutId);
      });
      state.pendingRequests.clear();
      state.pending.forEach((_item, itemId) => clearPendingItem(itemId, 'host_epoch_resync'));
      state.pendingBySrc.clear();

      state.pageEpoch = nextEpoch;
      console.log(
        '[DIAG][EPOCH_SYNC]',
        'action=epoch_resynced',
        'prevEpoch=' + previousEpoch,
        'nextEpoch=' + nextEpoch,
        'reason=' + reason,
        'navId=' + NAV_ID,
        'url=' + window.location.href
      );
      return 'OK_EPOCH_RESYNCED';
    } catch (e) {
      return 'ERR:' + String(e);
    }
  };
  window.__MW_SHORTS_REENTRY_REFRESH__ = function(reason) {
    try {
      return refreshShortsFreshnessOnReentry(reason || 'host_shorts_reentry', { force: true }) ? 'OK' : 'SKIP';
    } catch (e) {
      return 'ERR';
    }
  };
  window.__MW_FORCE_FIRST_ENTRY_REQUEST__ = function(reason) {
    try {
      return forceFirstEntryModerationRequest(reason || 'host_force_first_entry');
    } catch (e) {
      return 'ERR';
    }
  };
  window.__MW_CLEAR_STALE_OWNERSHIP__ = function(reason) {
    try {
      return clearStaleOwnedLifecycleMarkers(reason || 'host_lifecycle_boundary');
    } catch (e) {
      return 'ERR:' + String(e);
    }
  };

  // FREEZE-OVERRIDE (lifecycle): host page-load / refresh rediscovery.
  // Clears scan dedupe and re-queues candidates without touching sacred applyBlur.
  window.__MW_LIFECYCLE_RESCAN__ = function(reason) {
    try {
      const tag = String(reason || 'lifecycle_rescan');
      let cleared = 0;
      try {
        cleared = state.scanned.size;
        state.scanned.clear();
      } catch (e) {}
      try {
        // Re-queue model_not_ready soft nodes explicitly.
        document.querySelectorAll('[data-mw-decision-reason="model_not_ready_pending"],.mw-softblur,[data-mw-moderated="softblur"]').forEach(function(node) {
          if (!node || node.nodeType !== 1) return;
          try {
            clearElementScanDedupeMarkers(node, 'lifecycle_rescan');
            const src = getBloomGuardMarkedNodeSrc(node);
            // Phase 0: do not re-paint soft. Clear residual soft if present on YouTube.
            if (src && shouldSkipSoftPreblur()) {
              try { clearAllBlurAndOverlay(node, src, 'lifecycle_rescan_clear_soft', 'safe'); } catch (eClr) {}
            }
          } catch (e2) {}
        });
      } catch (e) {}
      if (CONFIG.scanEnabled) {
        try { scanFullPage(); } catch (e) {}
        try { if (isYouTube()) scanYouTubeThumbnails(); } catch (e) {}
        try {
          if (isShortsModeActive()) scanActiveShortsPlayerContainer('lifecycle_rescan:' + tag);
        } catch (e) {}
      }
      try {
        if (!isShortsModeActive()) {
          try { scrubPartialBlurAfterShortsExit('lifecycle_rescan:' + tag); } catch (eScrub) {}
          healNonShortsHardPositiveMissingReveals('lifecycle_rescan:' + tag);
          try { enforceMainSurfaceBlurRevealInvariant('lifecycle_rescan:' + tag); } catch (eEnf) {}
        }
      } catch (e) {}
      console.log(
        '[DIAG][LIFECYCLE_RESCAN]',
        'reason=' + tag,
        'clearedDedupe=' + cleared,
        'url=' + String(window.location.href || '').substring(0, 120)
      );
      return 'OK:cleared=' + cleared;
    } catch (e) {
      return 'ERR:' + String(e && e.message ? e.message : e);
    }
  };

  // FREEZE-OVERRIDE (lifecycle): host calls this when NSFWJS becomes ready so
  // cold-start model_not_ready soft-blur thumbs get a real scan pass.
  window.__MW_COLD_START_FLUSH__ = function(reason) {
    try {
      const tag = String(reason || 'host_model_ready');
      let clearedDedupe = 0;
      try {
        // Allow re-queue of every previously seen src (pending or error paths).
        clearedDedupe = state.scanned.size;
        state.scanned.clear();
      } catch (e) {}
      try {
        document.querySelectorAll('[data-mw-decision-reason="model_not_ready_pending"]').forEach(function(node) {
          if (!node || node.nodeType !== 1) return;
          try {
            const src = getBloomGuardMarkedNodeSrc(node);
            clearElementScanDedupeMarkers(node, 'cold_start_flush');
            // Phase 0: clear soft residue; do not re-apply soft while model warms.
            if (src && shouldSkipSoftPreblur()) {
              try { clearAllBlurAndOverlay(node, src, 'cold_start_flush_clear_soft', 'safe'); } catch (eClr) {}
            }
          } catch (e2) {}
        });
      } catch (e) {}
      if (CONFIG.scanEnabled) {
        try { scanFullPage(); } catch (e) {}
        try { if (isYouTube()) scanYouTubeThumbnails(); } catch (e) {}
      }
      try {
        if (!isShortsModeActive()) {
          try { scrubPartialBlurAfterShortsExit('cold_start_flush:' + tag); } catch (eScrub) {}
          healNonShortsHardPositiveMissingReveals('cold_start_flush:' + tag);
        }
      } catch (e) {}
      console.log(
        '[DIAG][COLD_START]',
        'event=flush',
        'reason=' + tag,
        'clearedDedupe=' + clearedDedupe,
        'url=' + String(window.location.href || '').substring(0, 120)
      );
      return 'OK:cleared=' + clearedDedupe;
    } catch (e) {
      return 'ERR:' + String(e && e.message ? e.message : e);
    }
  };

  // FREEZE-OVERRIDE (lifecycle): after Active Shorts exit, rehydrate home/results
  // top-of-feed. Clear partial soft blur first; re-scan without soft preblur in
  // the suppress window; repair hard positives' reveals.
  window.__MW_HOME_FEED_HEAL__ = function(reason) {
    try {
      const tag = String(reason || 'home_feed_heal');
      if (isShortsModeActive()) return 'SKIP_SHORTS';
      try {
        // Drop only residual flash shorts overlays if any reappeared.
        document.querySelectorAll('.' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS).forEach(function(node) {
          if (node && node.parentElement) node.parentElement.removeChild(node);
        });
      } catch (e) {}
      try {
        setOverlayEnabled(false, 'home_feed_heal:' + tag);
      } catch (e) {}
      // Kill reveal-less partial soft blur before and after rediscovery scan.
      try { scrubPartialBlurAfterShortsExit('heal_before:' + tag); } catch (e) {}
      try {
        if (CONFIG.scanEnabled) {
          scanFullPage();
          if (isYouTube()) scanYouTubeThumbnails();
        }
      } catch (e) {}
      try { scrubPartialBlurAfterShortsExit('heal_after_scan:' + tag); } catch (e) {}
      try {
        repairNonShortsBlurRevealInvariant('home_feed_heal:' + tag);
      } catch (e) {}
      try {
        healNonShortsHardPositiveMissingReveals('home_feed_heal:' + tag);
      } catch (e) {}
      try {
        enforceMainSurfaceBlurRevealInvariant('home_feed_heal:' + tag);
      } catch (e) {}
      console.log('[DIAG][HOME_FEED_HEAL]', 'reason=' + tag, 'softSuppressed=' + String(isSoftPreblurSuppressed()), 'url=' + String(window.location.href || '').substring(0, 120));
      return 'OK';
    } catch (e) {
      return 'ERR';
    }
  };


  // Track SPA URL transitions for lifecycle diagnostics and epoch handling.
  let lastUrl = window.location.href;

  // Set up observers
  setupMutationObserver(document.body);
  state.viewportObserver = setupViewportObserver();
  
  // YouTube-specific: Set up scroll handler for infinite scroll
  setupYouTubeScrollHandler();
  refreshAdaptiveShortsOverlayWatch('init');

  function scheduleInitTimeout(label, fn, delayMs) {
    const id = setTimeout(() => {
      timerState.initialTimeouts = timerState.initialTimeouts.filter(t => t !== id);
      if (timerState.paused || timerState.teardownDone) return;
      fn();
    }, delayMs);
    timerState.initialTimeouts.push(id);
    timerLog('start', label + ':' + delayMs + 'ms');
  }

  // Initial scan – run immediately to pre-blur anything already in the DOM.
  scanFullPage();
  if (isYouTube()) {
    scheduleInitTimeout('initialYouTubeScan', scanYouTubeThumbnails, 200);
  }
  // Also rescan on load to catch late resources without delaying first blur.
  if (document.readyState !== 'complete') {
    const onLoadScan = () => {
      if (timerState.teardownDone) return;
      diagLogLifecycleSnapshot('page_load_end', 'window_load_event', lastUrl, window.location.href);
      scanFullPage();
      if (isYouTube()) {
        scheduleInitTimeout('loadYouTubeScan', scanYouTubeThumbnails, 200);
        const shelfOwnedCards = document.querySelectorAll('.' + OWNED_POSITIVE_CARD_CLASS);
        for (let i = 0; i < shelfOwnedCards.length; i += 1) {
          const card = shelfOwnedCards[i];
          if (!card || card.nodeType !== 1) continue;
          if (!isShortsShelfOwnedCard(card)) continue;
          reapplyOwnedContainerBlur(card, 'event:load');
          console.log(
            '[MW-SHORTS-SHELF] lifecycle_reapply',
            'event=load',
            'cardNodeId=' + getDiagNodeId(card)
          );
        }
      }
    };
    window.addEventListener('load', onLoadScan);
  } else {
    diagLogLifecycleSnapshot('page_load_end', 'document_ready_complete', lastUrl, window.location.href);
  }

  // Periodic rescans (more aggressive for YouTube)
  const isYT = isYouTube();
  scheduleInitTimeout('initialFullScan', scanFullPage, 500);
  scheduleInitTimeout('initialFullScan', scanFullPage, 1500);
  scheduleInitTimeout('initialFullScan', scanFullPage, 3000);
  
  if (isYT) {
    scheduleInitTimeout('initialYouTubeScan', scanYouTubeThumbnails, 800);
    scheduleInitTimeout('initialYouTubeScan', scanYouTubeThumbnails, 2000);
    scheduleInitTimeout('initialYouTubeScan', scanYouTubeThumbnails, 4000);
    scheduleInitTimeout('initialYouTubeScan', scanYouTubeThumbnails, 6000);
  }

  function startYouTubePeriodicScan(reason) {
    if (!isYT || timerState.paused || timerState.youtubePeriodicInterval) return;
    timerState.youtubePeriodicInterval = setInterval(scanYouTubeThumbnails, 5000);
    timerLog('start', 'youtubePeriodicInterval:' + reason);
  }

  // Scroll-triggered rescans
  timerState.mainScrollHandler = () => {
    if (timerState.paused) return;
    if (isShortsModeActive()) {
      scheduleShortsRevealOverlayReposition('main_scroll');
    } else {
      scheduleNonShortsRevealOverlayReposition('main_scroll');
    }
    clearNamedTimeout('mainScrollTimeout', 'reschedule');
    timerState.mainScrollTimeout = setTimeout(() => {
      scanFullPage();
      if (isYouTube()) {
        scanYouTubeThumbnails();
      }
    }, 150);
    timerLog('start', 'mainScrollTimeout');
  };
  window.addEventListener('scroll', timerState.mainScrollHandler, { passive: true });

  ensureSensitivityToggle();
  ensureRevealOverlayPositionListeners();
  ensureNonShortsReattachListeners();

  // SPA navigation detection
  // FREEZE-OVERRIDE (reveal pairing): only strip overlays that belong to the wrong
  // surface. Previous code removed EVERY non-portal reveal when entering Shorts —
  // that orphaned hard-blurred results/home/watch thumbs still in the DOM
  // (Results → Active Shorts → exit = blur with no reveal).
  function isRevealOverlayUnderShortsShell(overlay) {
    if (!overlay || overlay.nodeType !== 1) return false;
    try {
      if (typeof overlay.closest === 'function') {
        if (
          overlay.closest(
            '#shorts-player, ytm-reel-video-renderer, ytd-reel-video-renderer,' +
            'ytm-shorts-player-page, ytd-shorts, #shorts-inner-container, #shorts-container'
          )
        ) {
          return true;
        }
      }
      // Anchor target may sit under the reel even when overlay was reparented.
      const nodeId = String((overlay.dataset && overlay.dataset.mwNodeId) || '');
      if (nodeId) {
        const anchor = document.querySelector('[data-mw-node-id="' + nodeId + '"]');
        if (anchor && typeof anchor.closest === 'function') {
          if (
            anchor.closest(
              '#shorts-player, ytm-reel-video-renderer, ytd-reel-video-renderer,' +
              'ytm-shorts-player-page, ytd-shorts, #shorts-inner-container'
            )
          ) {
            return true;
          }
        }
      }
    } catch (e) {}
    return false;
  }

  function sweepOrphanedModeOverlays(reason) {
    try {
      const inShortsMode = isShortsModeActive();
      const allOverlays = document.querySelectorAll('.mw-reveal-overlay');
      let removed = 0;
      let preservedMain = 0;
      for (let i = 0; i < allOverlays.length; i += 1) {
        const ov = allOverlays[i];
        if (!ov || !ov.isConnected) continue;
        const isPortal = !!(ov.parentElement && String(ov.parentElement.id || '') === REVEAL_PORTAL_ID);
        const portalMode = String((ov.dataset && ov.dataset.mwPortalMode) || '');
        if (inShortsMode && !isPortal) {
          // Entering Shorts: only strip inline overlays that live under the Shorts shell.
          // Keep home/results/watch reveals so exit cannot leave orphan blur.
          if (!isRevealOverlayUnderShortsShell(ov)) {
            preservedMain += 1;
            continue;
          }
          if (ov.parentElement) ov.parentElement.removeChild(ov);
          removed += 1;
        } else if (!inShortsMode && isPortal) {
          // Leaving Shorts: drop Shorts portal overlays only (never non_shorts portal).
          if (portalMode === 'non_shorts') {
            preservedMain += 1;
            continue;
          }
          if (ov.parentElement) ov.parentElement.removeChild(ov);
          removed += 1;
        }
      }
      if (removed > 0 || preservedMain > 0) {
        console.log(
          '[DIAG][OVERLAY_SWEEP] mode_transition_sweep',
          'reason=' + (reason || 'unknown'),
          'removed=' + removed,
          'preservedMain=' + preservedMain,
          'shortsMode=' + inShortsMode
        );
      }
    } catch (e) {}
  }

  // FREEZE-OVERRIDE: Active Shorts exit must not leave a frosted/white home surface.
  // YouTube often keeps #shorts-player mounted under home. Flash shorts overlays
  // (absolute inset 0, z-index huge) + full-page mw-blur-overlay + veil stamps
  // then look like "page not loading" or mass thumbnail blur.
  function performShortsExitSurfaceCleanup(reason) {
    const tag = String(reason || 'leave_shorts');
    let removedFlashOverlays = 0;
    let clearedVeilMarks = 0;
    let clearedPlayerResidue = 0;
    try {
      // 0) Nuclear partial-blur scrub: soft + filter-only + hard-without-reveal on main surfaces.
      // Must run even if Shorts mode is still flaky (player mounted under home/results).
      try { scrubPartialBlurAfterShortsExit('shorts_exit:' + tag); } catch (e) {}

      // 1) Never leave the fullscreen inject overlay armed on home/results.
      try {
        setOverlayEnabled(false, 'shorts_exit:' + tag);
      } catch (e) {}

      // 2) Kill adaptive shorts watch / health heal so they don't re-stamp residue.
      try {
        stopAdaptiveShortsOverlayWatch('shorts_exit:' + tag);
      } catch (e) {}
      try {
        stopShortsHealthHealInterval('shorts_exit:' + tag);
      } catch (e) {}

      // 3) Remove frosted Shorts player overlays (these are the white-screen culprit).
      document.querySelectorAll('.' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS).forEach(function(node) {
        if (node && node.parentElement) {
          try {
            node.parentElement.removeChild(node);
            removedFlashOverlays += 1;
          } catch (e) {}
        }
      });

      // 4) Clear flash/veil marks on the still-mounted Shorts player shell.
      document.querySelectorAll(
        '#shorts-player [data-mw-veil="1"],' +
        '#shorts-player [data-mw-flash-frame="1"],' +
        '#shorts-player [data-mw-flash-positive="1"],' +
        'ytm-reel-video-renderer[data-mw-flash-frame="1"],' +
        'ytd-reel-video-renderer[data-mw-flash-frame="1"],' +
        'ytm-reel-video-renderer [data-mw-veil="1"],' +
        'ytd-reel-video-renderer [data-mw-veil="1"]'
      ).forEach(function(node) {
        if (!node || node.nodeType !== 1) return;
        try {
          if (node.dataset.mwVeil === '1') {
            node.removeAttribute('data-mw-veil');
            clearedVeilMarks += 1;
          }
          if (node.dataset.mwFlashFrame === '1') {
            node.removeAttribute('data-mw-flash-frame');
            clearedVeilMarks += 1;
          }
          if (node.dataset.mwFlashPositive === '1') {
            node.removeAttribute('data-mw-flash-positive');
          }
          node.removeAttribute('data-mw-flash-identity');
        } catch (e) {}
      });

      // 5) Clear hard/soft blur residue that only belongs to the active Shorts player.
      // Do NOT touch main-feed owned positives (repairNonShorts handles those carefully).
      document.querySelectorAll(
        '#shorts-player video, #shorts-player img, #shorts-player .mw-blurred, #shorts-player .mw-softblur,' +
        '#shorts-player [data-mw-moderated="blurred"], #shorts-player [data-mw-moderated="softblur"],' +
        'ytm-reel-video-renderer video, ytd-reel-video-renderer video,' +
        'ytm-reel-video-renderer.mw-blurred, ytd-reel-video-renderer.mw-blurred'
      ).forEach(function(node) {
        if (!node || node.nodeType !== 1 || !node.isConnected) return;
        // Skip if this node is also a main-feed thumbnail card (rare dual match).
        try {
          if (typeof node.closest === 'function') {
            if (node.closest('ytm-rich-item-renderer, ytd-rich-item-renderer, ytm-video-with-context-renderer, ytd-video-renderer, ytm-compact-video-renderer')) {
              return;
            }
          }
        } catch (e) {}
        try {
          const src = getBloomGuardMarkedNodeSrc(node);
          if (clearAllBlurAndOverlay(node, src, 'shorts_exit_player_residue:' + tag, 'safe')) {
            clearedPlayerResidue += 1;
          } else {
            node.style.removeProperty('filter');
            node.style.removeProperty('-webkit-filter');
            node.style.removeProperty('backdrop-filter');
            node.style.removeProperty('-webkit-backdrop-filter');
            node.classList.remove('mw-blurred');
            node.classList.remove('mw-softblur');
            node.removeAttribute('data-mw-moderated');
            clearedPlayerResidue += 1;
          }
        } catch (e) {}
      });

      // 6) Portal: clear Shorts portal overlays only (preserve any non_shorts portal kids).
      try {
        const portal = document.getElementById(REVEAL_PORTAL_ID);
        if (portal) {
          const kids = portal.querySelectorAll('.mw-reveal-overlay, .mw-reveal-btn');
          for (let pi = 0; pi < kids.length; pi += 1) {
            const kid = kids[pi];
            if (!kid) continue;
            const mode = String((kid.dataset && kid.dataset.mwPortalMode) || '');
            // Empty mode defaults to shorts (historical portal overlays).
            if (mode === 'non_shorts') continue;
            try {
              if (kid.parentElement) kid.parentElement.removeChild(kid);
            } catch (eKid) {}
          }
        }
      } catch (e) {}

      // 7) Universal main-surface blur↔reveal invariant (home/results/watch/feed/channel).
      // Must recreate missing reveals on hard positives; clear unauthorized residue.
      repairNonShortsBlurRevealInvariant('shorts_exit_cleanup:' + tag);
      try { healNonShortsHardPositiveMissingReveals('shorts_exit_cleanup:' + tag); } catch (e) {}
      try { enforceMainSurfaceBlurRevealInvariant('shorts_exit_cleanup:' + tag); } catch (e) {}
      // 8) Final partial scrub — mutation/scan races can re-soft after step 7.
      try { scrubPartialBlurAfterShortsExit('shorts_exit_final:' + tag); } catch (e) {}
    } catch (e) {}
    console.log(
      '[DIAG][SHORTS_EXIT_CLEANUP]',
      'reason=' + tag,
      'removedFlashOverlays=' + removedFlashOverlays,
      'clearedVeilMarks=' + clearedVeilMarks,
      'clearedPlayerResidue=' + clearedPlayerResidue,
      'softSuppressed=' + String(isSoftPreblurSuppressed()),
      'url=' + String(window.location.href || '').substring(0, 160)
    );
    return {
      removedFlashOverlays: removedFlashOverlays,
      clearedVeilMarks: clearedVeilMarks,
      clearedPlayerResidue: clearedPlayerResidue,
    };
  }

  try {
    window.__MW_SHORTS_EXIT_CLEANUP__ = function(reason) {
      return performShortsExitSurfaceCleanup(reason || 'host_shorts_exit');
    };
  } catch (e) {}

  function getBloomGuardMarkedNodeSrc(node) {
    if (!node || node.nodeType !== 1) return '';
    const source = getDiagSourceFields(node);
    return normalizeUrl(
      node.dataset.mwSrc ||
      source.currentSrc ||
      source.poster ||
      (node.getAttribute && (
        node.getAttribute('src') ||
        node.getAttribute('poster') ||
        node.getAttribute('data-src') ||
        node.getAttribute('data-lazy-src') ||
        ''
      )) ||
      ''
    ) || String(node.dataset.mwSrc || source.currentSrc || source.poster || '');
  }

  function hasBloomGuardBlurResidue(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      const filter = String(node.style.getPropertyValue('filter') || node.style.filter || '').toLowerCase();
      const webkitFilter = String(node.style.getPropertyValue('-webkit-filter') || '').toLowerCase();
      const backdrop = String(node.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
      const webkitBackdrop = String(node.style.getPropertyValue('-webkit-backdrop-filter') || '').toLowerCase();
      return (
        filter.includes('blur(') ||
        webkitFilter.includes('blur(') ||
        backdrop.includes('blur(') ||
        webkitBackdrop.includes('blur(') ||
        node.classList.contains('mw-blurred') ||
        node.classList.contains('mw-softblur') ||
        node.dataset.mwModerated === 'blurred' ||
        node.dataset.mwModerated === 'softblur' ||
        node.dataset.mwVeil === '1'
      );
    } catch (e) {
      return false;
    }
  }

  // FREEZE-OVERRIDE (reveal pairing): hard positive with blur but no reveal is a
  // Phase 0 failure. Authoritative hard-blur stamps skip ownership re-check so
  // Results/Watch recycle cannot leave orphan blur after Shorts exit.
  function nodeHasHardPositiveBlurStamp(node, src) {
    if (!node || node.nodeType !== 1) return false;
    try {
      if (node.dataset.mwHardBlur === '1') return true;
      if (typeof isAuthoritativeHardBlur === 'function' && isAuthoritativeHardBlur(node)) return true;
      const moderated = String(node.dataset.mwModerated || '');
      const filter = String(node.style.getPropertyValue('filter') || node.style.filter || '').toLowerCase();
      const hasFilterBlur = filter.includes('blur(');
      if (moderated === 'blurred' && (node.classList.contains('mw-blurred') || hasFilterBlur) && src) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  function canHealHardPositiveReveal(node, src, itemKey, caller) {
    if (!node || !src) return false;
    // Authoritative stamp already passed ownership at applyBlur time.
    if (typeof isAuthoritativeHardBlur === 'function' && isAuthoritativeHardBlur(node)) {
      return true;
    }
    if (node.dataset && node.dataset.mwHardBlur === '1') return true;
    try {
      return isMvpBlurAuthorized(node, src, itemKey, 'card_blurred', caller || 'heal_reveal');
    } catch (e) {
      return false;
    }
  }

  function forceCreateRevealForHardPositive(node, src, reason) {
    if (!node || !src || !node.isConnected) return false;
    if (isRevealedForSource(src, node)) return false;
    if (findRevealOverlayForElement(node, src)) return true;
    try {
      const parent = node.parentElement;
      if (parent && parent.nodeType === 1) {
        const pos = window.getComputedStyle(parent).position;
        if (pos === 'static') parent.style.position = 'relative';
      }
    } catch (ePos) {}
    // Ensure moderated + authoritative stamps so createRevealOverlay will attach
    // (auth gate short-circuits on authoritative hard blur).
    try {
      if (String(node.dataset.mwModerated || '') !== 'blurred') {
        node.dataset.mwModerated = 'blurred';
      }
      if (!node.classList.contains('mw-blurred')) node.classList.add('mw-blurred');
      if (typeof markAuthoritativeHardBlur === 'function') {
        markAuthoritativeHardBlur(node, src);
      } else {
        node.dataset.mwHardBlur = '1';
        node.dataset.mwHardBlurItemKey = getDiagItemKey(src);
        node.dataset.mwHardBlurSrc = String(src || '').substring(0, 240);
      }
    } catch (e2) {}
    const itemKey = getDiagItemKey(src);
    createRevealOverlay(
      node,
      src,
      node.dataset.mwCategory || 'flagged',
      node.dataset.mwItemId || itemKey,
      false
    );
    if (findRevealOverlayForElement(node, src)) return true;
    scheduleNonShortsRevealPairingBurst(
      node,
      src,
      node.dataset.mwCategory || 'flagged',
      node.dataset.mwItemId || itemKey,
      reason || 'force_create_reveal'
    );
    return !!findRevealOverlayForElement(node, src);
  }

  // Runs on home/results/watch/feed/channel after Shorts exit and lifecycle heals.
  function enforceMainSurfaceBlurRevealInvariant(reason) {
    if (isShortsModeActive()) return;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return;
    try {
      const nodes = document.querySelectorAll(
        '[data-mw-moderated="blurred"],.mw-blurred,[data-mw-hard-blur="1"]'
      );
      let repaired = 0;
      let cleared = 0;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (!node || node.nodeType !== 1 || !node.isConnected) continue;
        // Skip active Shorts shell if still mounted under home.
        try {
          if (typeof node.closest === 'function' && node.closest('#shorts-player, ytm-reel-video-renderer[selected]')) {
            continue;
          }
        } catch (eSkip) {}
        const src = getBloomGuardMarkedNodeSrc(node);
        if (!src) {
          if (hasBloomGuardBlurResidue(node)) {
            try {
              if (clearAllBlurAndOverlay(node, '', 'enforce_no_src:' + (reason || ''), 'safe')) cleared += 1;
            } catch (e) {}
          }
          continue;
        }
        if (isRevealedForSource(src, node)) continue;
        const itemKey = getDiagItemKey(src);
        const hard = nodeHasHardPositiveBlurStamp(node, src);
        if (hard && canHealHardPositiveReveal(node, src, itemKey, 'enforce_main_surface')) {
          if (!findRevealOverlayForElement(node, src)) {
            if (forceCreateRevealForHardPositive(node, src, 'enforce:' + (reason || 'unknown'))) {
              repaired += 1;
            }
          }
          continue;
        }
        // Unauthorized / incomplete blur residue → clear (no orphan partial blur).
        if (hasBloomGuardBlurResidue(node) && !hard) {
          try {
            if (clearAllBlurAndOverlay(node, src, 'enforce_clear_orphan:' + (reason || ''), 'safe')) {
              cleared += 1;
            }
          } catch (e) {}
        } else if (hard && !canHealHardPositiveReveal(node, src, itemKey, 'enforce_deny')) {
          // Hard stamp but no longer authorized (identity recycle) → clear.
          try {
            if (clearAllBlurAndOverlay(node, src, 'enforce_stale_hard:' + (reason || ''), 'safe')) {
              cleared += 1;
            }
          } catch (e) {}
        }
      }
      if (repaired || cleared) {
        console.log(
          '[DIAG][LIFECYCLE_REPAIR] enforce_main_surface_blur_reveal',
          'reason=' + (reason || 'unknown'),
          'repaired=' + repaired,
          'cleared=' + cleared,
          'url=' + String(window.location.href || '').substring(0, 160)
        );
      }
    } catch (e) {}
  }

  // FREEZE-OVERRIDE (reveal pairing): only recreate missing reveals on hard
  // positives. Never clears soft pre-blur (used by cold-start / lifecycle rescan).
  function healNonShortsHardPositiveMissingReveals(reason) {
    if (isShortsModeActive()) return;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return;
    try {
      const nodes = document.querySelectorAll(
        '[data-mw-moderated="blurred"],.mw-blurred,[data-mw-hard-blur="1"]'
      );
      let revealRepaired = 0;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (!node || node.nodeType !== 1 || !node.isConnected) continue;
        const src = getBloomGuardMarkedNodeSrc(node);
        if (!src) continue;
        const itemKey = getDiagItemKey(src);
        if (!nodeHasHardPositiveBlurStamp(node, src)) continue;
        if (!canHealHardPositiveReveal(node, src, itemKey, 'heal_hard_positive_reveal')) continue;
        if (findRevealOverlayForElement(node, src)) continue;
        if (forceCreateRevealForHardPositive(node, src, 'heal_hard_positive:' + (reason || 'unknown'))) {
          revealRepaired += 1;
        }
      }
      if (revealRepaired > 0) {
        console.log(
          '[DIAG][LIFECYCLE_REPAIR] heal_hard_positive_missing_reveals',
          'reason=' + (reason || 'unknown'),
          'revealRepaired=' + revealRepaired,
          'url=' + window.location.href
        );
      }
    } catch (e) {}
  }

  function repairNonShortsBlurRevealInvariant(reason) {
    if (isShortsModeActive()) return;
    if (!isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) return;
    try {
      const nodes = document.querySelectorAll(
        '[data-mw-moderated="blurred"],[data-mw-moderated="softblur"],.mw-blurred,.mw-softblur,[data-mw-veil="1"]'
      );
      let cleared = 0;
      let revealRepaired = 0;
      let preserved = 0;
      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        if (!node || node.nodeType !== 1 || !node.isConnected) continue;
        if (!hasBloomGuardBlurResidue(node)) continue;

        const src = getBloomGuardMarkedNodeSrc(node);
        const itemKey = getDiagItemKey(src);
        const hasHardPositiveStamp = nodeHasHardPositiveBlurStamp(node, src);

        if (hasHardPositiveStamp && src && canHealHardPositiveReveal(node, src, itemKey, 'shorts_exit_invariant_repair')) {
          if (!findRevealOverlayForElement(node, src)) {
            if (forceCreateRevealForHardPositive(node, src, 'repair_invariant:' + (reason || 'unknown'))) {
              revealRepaired += 1;
            } else {
              preserved += 1;
            }
          } else {
            preserved += 1;
          }
          continue;
        }

        if (node.dataset.mwVeil === '1') {
          node.removeAttribute('data-mw-veil');
        }
        if (clearAllBlurAndOverlay(node, src, reason || 'shorts_exit_invariant_repair', 'safe')) {
          cleared += 1;
        }
      }
      if (cleared || revealRepaired || preserved) {
        console.log(
          '[DIAG][LIFECYCLE_REPAIR] non_shorts_blur_reveal_invariant',
          'reason=' + (reason || 'unknown'),
          'cleared=' + cleared,
          'revealRepaired=' + revealRepaired,
          'preserved=' + preserved,
          'url=' + window.location.href
        );
      }
    } catch (e) {}
  }

  function cleanupBloomGuardVisualModeration(reason) {
    const cleanupReason = reason || 'off_mode_cleanup';
    let clearedNodes = 0;
    let removedOverlays = 0;
    try {
      offModeVisualCleanupActive = true;
      CONFIG.enabled = false;
      CONFIG.scanEnabled = false;
      CONFIG.flashShieldV1 = false;
      flashShieldShortsVerdictMemory.clear();
      document.documentElement.classList.remove(FLASH_SHIELD_CLASS);
      stopFlashShieldRuntime();
      disableFlashShieldRuntime();

      document.querySelectorAll('.mw-reveal-overlay,.mw-reveal-btn,#' + REVEAL_PORTAL_ID + ',.' + FLASH_SHIELD_SHORTS_OVERLAY_CLASS).forEach(function(node) {
        if (node && node.parentElement) {
          node.parentElement.removeChild(node);
          removedOverlays += 1;
        }
      });

      document.querySelectorAll('.' + OWNED_POSITIVE_CARD_CLASS + ',.' + OWNED_SAFE_CARD_CLASS + ',[data-mw-owned-positive="1"],[data-mw-owned-safe="1"]').forEach(function(card) {
        if (!card || card.nodeType !== 1) return;
        try {
          card.classList.remove(OWNED_POSITIVE_CARD_CLASS);
          card.classList.remove(OWNED_SAFE_CARD_CLASS);
          card.removeAttribute('data-mw-owned-positive');
          card.removeAttribute('data-mw-owned-safe');
          card.removeAttribute('data-mw-owned-item-key');
          card.removeAttribute('data-mw-owned-href-key');
          card.removeAttribute('data-mw-owned-epoch');
        } catch (e) {}
      });

      document.querySelectorAll(
        '[data-mw-moderated],[data-mw-veil="1"],[data-mw-flash-frame="1"],[data-mw-flash-positive="1"],[data-mw-hard-blur="1"],[data-mw-has-overlay="true"],.mw-blurred,.mw-softblur'
      ).forEach(function(node) {
        if (!node || node.nodeType !== 1) return;
        try {
          const src = getBloomGuardMarkedNodeSrc(node);
          if (clearAllBlurAndOverlay(node, src, cleanupReason, 'safe')) {
            clearedNodes += 1;
          }
          node.removeAttribute('data-mw-veil');
          node.removeAttribute('data-mw-flash-frame');
          node.removeAttribute('data-mw-flash-positive');
          node.removeAttribute('data-mw-hard-blur');
          node.removeAttribute('data-mw-hard-blur-src');
          node.removeAttribute('data-mw-hard-blur-item-key');
          node.removeAttribute('data-mw-hard-blur-epoch');
          node.removeAttribute('data-mw-category');
          node.removeAttribute('data-mw-src');
          node.removeAttribute('data-mw-item-id');
          node.removeAttribute('data-mw-overlay-owner-token');
          node.removeAttribute('data-mw-shorts-owner-token');
          node.removeAttribute('data-mw-shorts-stable-selector');
          node.removeAttribute('data-mw-has-overlay');
          node.setAttribute('data-mw-moderated', 'safe');
          clearShortsBlurContextForNode(node, cleanupReason);
        } catch (e) {}
      });

      state.pendingRequests.forEach(function(req) {
        if (req && req.timeoutId) clearTimeout(req.timeoutId);
      });
      state.pendingRequests.clear();
      state.pending.forEach(function(item) {
        if (item && item.blurTimer) clearTimeout(item.blurTimer);
      });
      state.pending.clear();
      state.pendingBySrc.clear();
      state.scanned.clear();
      state.elements.clear();
      state.blurred.clear();
      mutationScanQueue.length = 0;
      mutationScanSet.clear();
      batchQueue = [];
      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
      if (mutationScanTimer) {
        clearTimeout(mutationScanTimer);
        mutationScanTimer = null;
      }
    } catch (e) {}
    console.log(
      '[DIAG][OFF_MODE] visual_cleanup',
      'reason=' + cleanupReason,
      'clearedNodes=' + clearedNodes,
      'removedOverlays=' + removedOverlays
    );
    // Recreate floating dial so user can turn protection back on without host UI.
    try { ensureSensitivityToggle(); } catch (eTogOff) {}
    return 'OK_OFF_MODE_CLEANUP';
  }

  const checkUrlChange = () => {
    // Cheap re-seat if YouTube SPA wiped body-mounted controls.
    try { ensureSensitivityToggle(); } catch (eTogUrl) {}
    if (window.location.href !== lastUrl) {
      const previousUrl = lastUrl;
      const nextUrl = window.location.href;
      console.log('[MW] SPA navigation detected:', previousUrl, '->', nextUrl);
      diagLogLifecycleSnapshot('url_change', 'spa_detected', previousUrl, nextUrl);
      const previousIsYouTube = isYouTubeDomainUrl(previousUrl);
      const nextIsYouTube = isYouTubeDomainUrl(nextUrl);
      if (previousIsYouTube && !nextIsYouTube) {
        diagLogLifecycleSnapshot('leave_youtube', 'spa_detected', previousUrl, nextUrl);
      } else if (!previousIsYouTube && nextIsYouTube) {
        diagLogLifecycleSnapshot('return_to_youtube', 'spa_detected', previousUrl, nextUrl);
      }
      const observerModeResult = reevaluateShortsObserverMode('url_change', nextUrl, {
        forceLog: true,
        extra: 'previousUrl=' + previousUrl,
      });
      lastUrl = nextUrl;
      const holdEpoch = isYouTubeShortsUrl(previousUrl) && isYouTubeShortsUrl(nextUrl);
      if (!holdEpoch) {
        state.pageEpoch += 1;
        if (CONFIG.debug) {
          console.log('[MW][Epoch] incremented pageEpoch=' + state.pageEpoch);
        }
        if (DIAG_YT_BLUR) {
          diagEpochCounters.epochIncrementedCount += 1;
          console.log(
            '[MW-YT][DIAG][EPOCH][INJECT]',
            'action=epoch_incremented',
            'count=' + diagEpochCounters.epochIncrementedCount,
            'pageEpoch=' + state.pageEpoch,
            'prevUrl=' + previousUrl,
            'nextUrl=' + nextUrl
          );
        }
      } else if (DIAG_YT_BLUR) {
        diagEpochCounters.epochHeldCount += 1;
        console.log(
          '[MW-YT][DIAG][EPOCH][INJECT]',
          'action=epoch_held',
          'count=' + diagEpochCounters.epochHeldCount,
          'pageEpoch=' + state.pageEpoch,
          'prevUrl=' + previousUrl,
          'nextUrl=' + nextUrl
        );
      }
      // FREEZE-OVERRIDE: treat pure /shorts/* AND profile/channel shorts routes as
      // Active Shorts surfaces so first-entry exit always runs full cleanup.
      const previousIsShorts =
        isYouTubeShortsUrl(previousUrl) || isProfileOrChannelShortsRoute(previousUrl);
      const nextIsShorts =
        isYouTubeShortsUrl(nextUrl) || isProfileOrChannelShortsRoute(nextUrl);
      if (previousIsShorts !== nextIsShorts) {
        sweepOrphanedModeOverlays(nextIsShorts ? 'enter_shorts' : 'leave_shorts');
        if (previousIsShorts && !nextIsShorts) {
          // Immediate aggressive cleanup (flash overlays + player residue + portal + partials).
          performShortsExitSurfaceCleanup('leave_shorts_immediate');
          // FREEZE-OVERRIDE (lifecycle): multi-pass exit polish for first-entry and all exits.
          // YouTube top-row often paints after 400ms–5s; soft is disabled on YT so re-scan
          // cannot re-fog, but filter residue + hard-without-reveal still need scrub/heal.
          const runExitPolishPass = function(passTag) {
            try { performShortsExitSurfaceCleanup(passTag); } catch (e1) {}
            try {
              if (typeof window.__MW_HOME_FEED_HEAL__ === 'function') {
                window.__MW_HOME_FEED_HEAL__(passTag);
              }
            } catch (e2) {}
            try { scrubPartialBlurAfterShortsExit(passTag); } catch (e3) {}
            try { healNonShortsHardPositiveMissingReveals(passTag); } catch (e4) {}
            try { repairNonShortsBlurRevealInvariant(passTag); } catch (e5) {}
            try { enforceMainSurfaceBlurRevealInvariant(passTag); } catch (e6) {}
          };
          scheduleInitTimeout('shortsExitInvariantRepair', function() {
            runExitPolishPass('leave_shorts_250ms');
          }, 250);
          scheduleInitTimeout('shortsExitHomeHeal', function() {
            runExitPolishPass('leave_shorts_800ms');
          }, 800);
          scheduleInitTimeout('shortsExitInvariantRepair', function() {
            try {
              if (CONFIG.scanEnabled) {
                try { state.scanned.clear(); } catch (e) {}
                scanFullPage();
                if (isYouTube()) scanYouTubeThumbnails();
              }
            } catch (e) {}
            runExitPolishPass('leave_shorts_1000ms');
          }, 1000);
          scheduleInitTimeout('shortsExitHomeHeal', function() {
            runExitPolishPass('leave_shorts_1500ms');
          }, 1500);
          scheduleInitTimeout('shortsExitHomeHeal', function() {
            runExitPolishPass('leave_shorts_2800ms');
          }, 2800);
          scheduleInitTimeout('shortsExitHomeHeal', function() {
            runExitPolishPass('leave_shorts_5000ms');
          }, 5000);
          scheduleInitTimeout('shortsExitHomeHeal', function() {
            runExitPolishPass('leave_shorts_8000ms');
          }, 8000);
        }
      }
      if (previousIsShorts || nextIsShorts) {
        resetShortsBlurContext('url_change');
      }
      if (nextIsShorts) {
        if (!previousIsShorts) {
          refreshShortsFreshnessOnReentry('url_change_return_to_shorts', { force: true, resetContext: false });
        } else {
          refreshAdaptiveShortsOverlayWatch('url_change');
        }
        scheduleShortsRevealOverlayReposition('url_change_shorts');
      } else {
        stopAdaptiveShortsOverlayWatch('url_change_non_shorts');
        // Leaving any Shorts-related surface (including first-entry): always scrub partials
        // even when previousIsShorts detection missed a transient URL.
        if (previousIsShorts || isYouTubeShortsUrl(previousUrl)) {
          try { scrubPartialBlurAfterShortsExit('url_change_non_shorts_guard'); } catch (eG) {}
        }
      }
      if (observerModeResult.transitioned && observerModeResult.mode) {
        scheduleYouTubeScan('url_change_mode_on');
      }

      if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
      }
      if (mutationScanTimer) {
        clearTimeout(mutationScanTimer);
        mutationScanTimer = null;
      }
      mutationScanQueue.length = 0;
      mutationScanSet.clear();
      batchQueue = [];
      state.pendingRequests.forEach(req => {
        if (req && req.timeoutId) clearTimeout(req.timeoutId);
      });
      state.pendingRequests.clear();
      state.pending.forEach((_item, itemId) => clearPendingItem(itemId, 'spa_epoch_reset'));
      state.pendingBySrc.clear();
      // Clear scanned state for fresh scan
      state.scanned.clear();
      state.elements.clear();
      // blurred is a stats-only tracker; reset it each navigation so it
      // reflects only the current page rather than accumulating all time.
      state.blurred.clear();
      // Cap revealed state to prevent unbounded growth over very long sessions.
      // Only fires when the user has manually revealed 400+ items in one session.
      if (state.revealed.size > 400) {
        state.revealed.clear();
        state.revealedMeta.clear();
      }
      scheduleInitTimeout('spaFullScan', scanFullPage, 300);
      if (isYouTube()) {
        scheduleInitTimeout('spaYouTubeScan', scanYouTubeThumbnails, 500);
      }
    }
  };

  function startUrlChangePoll(reason) {
    if (timerState.urlChangeInterval || timerState.paused) return;
    timerState.urlChangeInterval = setInterval(checkUrlChange, URL_CHANGE_POLL_MS);
    timerLog('start', 'urlChangeInterval:' + reason);
  }

  function stopFlashShieldRuntime() {
    if (timerState.shortsVeilTimeoutTimer) {
      clearTimeout(timerState.shortsVeilTimeoutTimer);
      timerState.shortsVeilTimeoutTimer = null;
      timerState.shortsVeilTimeoutIdentity = '';
    }
    if (timerState.flashShieldInterval) {
      clearInterval(timerState.flashShieldInterval);
      timerState.flashShieldInterval = null;
    }
    if (timerState.flashShieldRafId) {
      cancelAnimationFrame(timerState.flashShieldRafId);
      timerState.flashShieldRafId = null;
    }
    if (timerState.flashShieldBurstRafId) {
      cancelAnimationFrame(timerState.flashShieldBurstRafId);
      timerState.flashShieldBurstRafId = null;
    }
    if (timerState.flashShieldObserver) {
      try { timerState.flashShieldObserver.disconnect(); } catch (e) {}
      timerState.flashShieldObserver = null;
    }
  }

  function startFlashShieldRuntime() {
    if (!CONFIG.flashShieldV1 || timerState.teardownDone) return;
    try {
      if (window.__MW_FLASH_BOOTSTRAP__ && typeof window.__MW_FLASH_BOOTSTRAP__.disconnect === 'function') {
        window.__MW_FLASH_BOOTSTRAP__.disconnect();
      }
      ensureFlashShieldStyle();
      document.documentElement.classList.add(FLASH_SHIELD_CLASS);
      markFlashShieldCandidates(document);
      markFlashShieldShortsCandidate();
      scheduleFlashShieldShortsBurst('runtime_start');

      if (!timerState.flashShieldInterval) {
        let ticks = 0;
        timerState.flashShieldInterval = setInterval(function() {
          ticks += 1;
          if (!CONFIG.flashShieldV1 || timerState.teardownDone || ticks > 10) {
            if (timerState.flashShieldInterval) clearInterval(timerState.flashShieldInterval);
            timerState.flashShieldInterval = null;
            return;
          }
          markFlashShieldCandidates(document);
          markFlashShieldShortsCandidate();
          healFlashShieldReveal('interval');
        }, 1200);
      }

      const settleStartedAt = Date.now();
      const settle = function() {
        if (!CONFIG.flashShieldV1 || timerState.teardownDone) {
          timerState.flashShieldRafId = null;
          return;
        }
        markFlashShieldCandidates(document);
        markFlashShieldShortsCandidate();
        if (Date.now() - settleStartedAt < 2500) {
          timerState.flashShieldRafId = requestAnimationFrame(settle);
        } else {
          timerState.flashShieldRafId = null;
        }
      };
      if (!timerState.flashShieldRafId) {
        timerState.flashShieldRafId = requestAnimationFrame(settle);
      }

      if (!timerState.flashShieldObserver && typeof MutationObserver !== 'undefined') {
        let burstUntil = 0;
        const burst = function() {
          if (!CONFIG.flashShieldV1 || timerState.teardownDone) {
            timerState.flashShieldBurstRafId = null;
            return;
          }
          markFlashShieldCandidates(document);
          markFlashShieldShortsCandidate();
          if (Date.now() < burstUntil) {
            timerState.flashShieldBurstRafId = requestAnimationFrame(burst);
          } else {
            timerState.flashShieldBurstRafId = null;
          }
        };
        timerState.flashShieldObserver = new MutationObserver(function() {
          if (!CONFIG.flashShieldV1 || timerState.teardownDone) return;
          burstUntil = Date.now() + 600;
          markFlashShieldShortsCandidate();
          scheduleFlashShieldShortsBurst('runtime_mutation');
          if (!timerState.flashShieldBurstRafId) {
            timerState.flashShieldBurstRafId = requestAnimationFrame(burst);
          }
        });
        timerState.flashShieldObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['src', 'poster', 'aria-hidden', 'selected', 'is-active'],
        });
      }
    } catch (e) {}
  }

  function stopManagedTimers(reason) {
    stopAdaptiveShortsOverlayWatch('stopManagedTimers:' + (reason || 'unknown'));
    clearNamedInterval('legacyResultsInterval', reason);
    clearNamedInterval('urlChangeInterval', reason);
    clearNamedInterval('youtubePeriodicInterval', reason);
    stopShortsHealthHealInterval(reason);
    clearNamedInterval('debugSummaryInterval', reason);
    clearNamedTimeout('mainScrollTimeout', reason);
    clearNamedTimeout('youtubeScrollTimeout', reason);
    clearNamedTimeout('youtubeMutationScanTimeout', reason);
    clearNamedTimeout('revealOverlayRetryTimeout', reason);
    clearNamedTimeout('shortsVeilTimeoutTimer', reason);
    timerState.shortsVeilTimeoutIdentity = '';
    cancelShortsRevealOverlayReposition(reason || 'stopManagedTimers');
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
      timerLog('stop', 'batchTimer:' + reason);
    }
    if (mutationScanTimer) {
      clearTimeout(mutationScanTimer);
      mutationScanTimer = null;
      timerLog('stop', 'mutationScanTimer:' + reason);
    }
    mutationScanQueue.length = 0;
    mutationScanSet.clear();
    timerState.initialTimeouts.forEach(t => clearTimeout(t));
    timerState.initialTimeouts = [];
    state.pendingRequests.forEach(req => {
      if (req && req.timeoutId) clearTimeout(req.timeoutId);
    });
    state.pending.forEach(item => {
      if (item && item.blurTimer) clearTimeout(item.blurTimer);
    });
    state.pendingBySrc.clear();
    cleanupExpiredSafeResolved();
    pruneDisconnectedPending('stopManagedTimers');
    stopDiagHeartbeat(reason);
  }

  function startManagedTimers(reason) {
    if (timerState.paused || timerState.teardownDone) return;
    refreshAdaptiveShortsOverlayWatch('startManagedTimers:' + (reason || 'unknown'));
    startLegacyResultsPoll(reason);
    startUrlChangePoll(reason);
    startYouTubePeriodicScan(reason);
    maybeStartShortsHealthHealInterval(reason);
    startDebugSummary(reason);
    startDiagHeartbeat(reason);
  }

  function pauseManagedTimers(reason) {
    if (timerState.paused) return;
    timerState.paused = true;
    stopManagedTimers(reason || 'pause');
  }

  function resumeManagedTimers(reason) {
    if (!timerState.paused) return;
    timerState.paused = false;
    startManagedTimers(reason || 'resume');
  }

  function teardownManagedScheduling(reason) {
    if (timerState.teardownDone) return;
    timerState.teardownDone = true;
    pauseManagedTimers(reason || 'teardown');
    stopAdaptiveShortsOverlayWatch('teardown:' + (reason || 'unknown'));
    stopFlashShieldRuntime();
    if (timerState.mainScrollHandler) {
      window.removeEventListener('scroll', timerState.mainScrollHandler);
      timerState.mainScrollHandler = null;
    }
    if (timerState.youtubeScrollHandler) {
      window.removeEventListener('scroll', timerState.youtubeScrollHandler);
      timerState.youtubeScrollHandler = null;
    }
    if (timerState.revealOverlayScrollHandler) {
      window.removeEventListener('scroll', timerState.revealOverlayScrollHandler);
      timerState.revealOverlayScrollHandler = null;
    }
    if (timerState.revealOverlayResizeHandler) {
      window.removeEventListener('resize', timerState.revealOverlayResizeHandler);
      window.removeEventListener('orientationchange', timerState.revealOverlayResizeHandler);
      timerState.revealOverlayResizeHandler = null;
    }
    if (state.viewportObserver && typeof state.viewportObserver.disconnect === 'function') {
      state.viewportObserver.disconnect();
      state.viewportObserver = null;
    }
    state.mutationObservers.forEach(observer => {
      try { observer.disconnect(); } catch (e) {}
    });
    state.mutationObservers = [];
    if (window.__MW_BLUR_HEAL_OBSERVER__) {
      try { window.__MW_BLUR_HEAL_OBSERVER__.disconnect(); } catch (e) {}
      window.__MW_BLUR_HEAL_OBSERVER__ = null;
    }
    if (window.__MW_REVEAL_TAP_HANDLERS__) {
      try {
        const h = window.__MW_REVEAL_TAP_HANDLERS__;
        document.removeEventListener('touchstart', h.touchstart, { capture: true });
        document.removeEventListener('touchend', h.touchend, { capture: true });
        document.removeEventListener('click', h.click, { capture: true });
      } catch (e) {}
      window.__MW_REVEAL_TAP_HANDLERS__ = null;
      window.__MW_REVEAL_TAP_INTERCEPTOR__ = false;
    }
    window.__MW_ACTIVE__ = false;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      resumeManagedTimers('visibility_visible');
      refreshShortsFreshnessOnReentry('visibility_visible');
      scheduleShortsRevealOverlayReposition('visibility_visible');
      return;
    }
    pauseManagedTimers('visibility_hidden');
  });
  window.addEventListener('pageshow', () => {
    refreshShortsFreshnessOnReentry('pageshow');
    scheduleShortsRevealOverlayReposition('pageshow');
  });
  window.addEventListener('beforeunload', () => teardownManagedScheduling('beforeunload'));
  window.addEventListener('pagehide', () => teardownManagedScheduling('pagehide'));
  window.__MW_TEARDOWN__ = function(reason) {
    teardownManagedScheduling(reason || 'host_teardown');
  };
  window.__MW_OFF_MODE_CLEANUP__ = function(reason) {
    try {
      cleanupBloomGuardVisualModeration(reason || 'host_off_mode');
      teardownManagedScheduling(reason || 'host_off_mode');
      try { ensureSensitivityToggle(); } catch (eT) {}
      return 'OK_OFF_MODE_CLEANUP';
    } catch (e) {
      return 'ERR:' + String(e);
    }
  };

  // Host reinject while instance still marked active (or after Off latch): re-arm
  // without rebinding every listener (full IIFE already ran once).
  window.__MW_RESUME_AFTER_REINJECT__ = function(opts) {
    try {
      const o = opts || {};
      const level = Math.min(4, Math.max(0, Math.round(Number(o.sensitivity) || 0)));
      if (o.flashShieldV1 === true) CONFIG.flashShieldV1 = true;
      if (o.flashShieldV1 === false) CONFIG.flashShieldV1 = false;
      offModeVisualCleanupActive = false;
      if (timerState.teardownDone) {
        timerState.teardownDone = false;
        timerState.paused = false;
      }
      window.__MW_ACTIVE__ = true;
      if (level <= 0 && o.enabled !== true) {
        CONFIG.sensitivity = 0;
        CONFIG.enabled = false;
        CONFIG.scanEnabled = !!CONFIG.flashShieldV1;
        try { ensureSensitivityToggle(); } catch (e0) {}
        return 'OK_RESUME_OFF';
      }
      // Reuse dial On path (reeval + Shorts frame or full scan) without thr table changes.
      applySensitivityLevel(level > 0 ? level : 2, 'host_reinject_resume');
      try { startManagedTimers('host_reinject_resume'); } catch (e1) {}
      try { ensureSensitivityToggle(); } catch (e2) {}
      return 'OK_RESUME_ON';
    } catch (e) {
      return 'ERR:' + String(e && e.message ? e.message : e);
    }
  };

  window.__MW_FLASH_SHIELD_SET__ = function(enabled) {
    try {
      if (offModeVisualCleanupActive) return 'SKIP_OFF_MODE';
      CONFIG.flashShieldV1 = !!enabled;
      CONFIG.scanEnabled = CONFIG.enabled || CONFIG.flashShieldV1;
      if (window.__MW_FLASH_BOOTSTRAP__ && typeof window.__MW_FLASH_BOOTSTRAP__.setEnabled === 'function') {
        window.__MW_FLASH_BOOTSTRAP__.setEnabled(CONFIG.flashShieldV1);
      }
      if (CONFIG.flashShieldV1) {
        startFlashShieldRuntime();
        scanFullPage();
      } else {
        stopFlashShieldRuntime();
        disableFlashShieldRuntime();
      }
      return 'OK';
    } catch (e) {
      return 'ERR:' + String(e);
    }
  };

  // Stale-portal hygiene: the reveal portal is parented to documentElement and
  // survives re-injection (only Off-mode cleanup removes it). This instance owns
  // no overlays yet, so any overlay found in the portal now belongs to a dead
  // instance. Left in place, its stale owner token can collide with this
  // instance's node ids and trip createRevealOverlay's existing_owner_mismatch
  // path, which unblurs a valid positive. Blur stamps are untouched here; the
  // heal/repair paths recreate paired reveals for surviving blur.
  (function purgeStalePortalOverlaysOnInit() {
    try {
      const portal = document.getElementById(REVEAL_PORTAL_ID);
      if (!portal) return;
      const staleOverlays = portal.querySelectorAll('.mw-reveal-overlay');
      let removed = 0;
      for (let i = 0; i < staleOverlays.length; i += 1) {
        const overlay = staleOverlays[i];
        if (overlay && overlay.parentElement) {
          overlay.parentElement.removeChild(overlay);
          removed += 1;
        }
      }
      if (removed > 0) {
        console.log('[DIAG][REVEAL_UI] init_stale_portal_purge', 'removed=' + removed);
      }
    } catch (e) {}
  })();

  hydrateRevealStateFromStorage();
  startManagedTimers('init');
  if (CONFIG.flashShieldV1) startFlashShieldRuntime();

  // Expose debug API
  window.__MW_DEBUG__ = {
    state: state,
    config: CONFIG,
    platform: PLATFORM,
    scanAll: scanFullPage,
    stats: () => state.stats,
    pending: () => state.pending,
    pendingRequests: () => state.pendingRequests,
    batchQueue: () => batchQueue,
    revealed: () => state.revealed,
    setForcedBlur: (enabled) => { 
      CONFIG.forcedBlur = enabled; 
      console.log('[MW] Forced blur:', enabled);
      if (enabled) {
        console.log('[MW] DEV MODE: All images will be blurred without AI scan');
        scanFullPage();
      }
    },
  };

  console.log('[MW] Initialization complete. Call window.__MW_DEBUG__.stats() for stats.');
  return 'MW_INJECTED';
})();
`;
}
