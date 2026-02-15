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
  forcedBlur?: boolean; // Dev mode: blur everything
  failClosed?: boolean; // DEPRECATED: Now fail-open by default
  debug?: boolean; // Verbose logging
  nonce: string; // Security nonce for message validation
  blockingMode?: 'mvp' | 'full';
  enableVideoFrameSnapshots?: boolean;
  pageEpoch?: number;
  kidSafeProfile?: boolean;
  domainContextAdult?: boolean;
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
  domainContextAdult?: boolean;
}

export interface AnatomicalPolicyInput {
  shouldApplyBlur: boolean;
  predictedLabel: string;
  sexyScore: number | null;
  pornScore: number | null;
  anatomicalThreshold: number;
  forceUnsafe: boolean;
  failClosed: boolean;
  enabled: boolean;
  sensitivity: number;
  kidSafeProfile?: boolean;
  domainContextAdult?: boolean;
}

const MVP_UNSAFE_CATEGORIES = new Set([
  'swimwear',
  'shirtless',
  'shirtless_male',
  'bikini',
  'swim_trunks',
  'sports_bra',
]);

function normalizePolicyLabel(label: string): string {
  return String(label || '').trim().toLowerCase();
}

function isMvpAllowedPolicyLabel(label: string): boolean {
  const normalized = normalizePolicyLabel(label);
  return MVP_UNSAFE_CATEGORIES.has(normalized) || normalized === 'porn' || normalized === 'hentai';
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

  if (input.blockingMode === 'mvp' && input.domainContextAdult !== true) {
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
  if (input.predictedLabel !== 'sexy' && input.predictedLabel !== 'porn') {
    return { shouldBlur: !!input.shouldApplyBlur, reason: null };
  }
  if (input.kidSafeProfile === true && input.domainContextAdult === true) {
    return { shouldBlur: true, reason: null };
  }

  const score = input.predictedLabel === 'sexy' ? input.sexyScore : input.pornScore;
  if (score === null || !Number.isFinite(score)) {
    if (input.failClosed && input.enabled && input.sensitivity > 0) {
      return { shouldBlur: true, reason: input.predictedLabel + '_scoreNaN/failClosed' };
    }
    return { shouldBlur: false, reason: input.predictedLabel + '_scoreNaN/failOpen' };
  }

  if (score < input.anatomicalThreshold) {
    return { shouldBlur: false, reason: input.predictedLabel + '<anatomicalThreshold' };
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
  
  return `
(function() {
  'use strict';
  
  // ==================== INITIALIZATION ====================
  
  // Prevent double injection
  if (window.__MW_ACTIVE__) {
    console.log('[MW] Already injected, skipping');
    try {
      if (window.__MW_BLUR_OVERLAY_API__ && typeof window.__MW_BLUR_OVERLAY_API__.sendReady === 'function') {
        window.__MW_BLUR_OVERLAY_API__.sendReady('reinject');
      }
    } catch (e) {}
    try {
      const ackPayload = {
        type: 'MW_INJECTED_ACK',
        navId: String(window.__MW_NAV_ID__ || 'unknown'),
        pageEpoch: Number.isFinite(window.__MW_PAGE_EPOCH__) ? Number(window.__MW_PAGE_EPOCH__) : Number(${pageEpoch}),
        noncePrefix: String('${nonce}').substring(0, 6),
        url: window.location.href,
        reason: 'already_active',
        timestamp: Date.now(),
      };
      if (window.mobileApp && typeof window.mobileApp.postMessage === 'function') {
        window.mobileApp.postMessage({ detail: ackPayload });
      } else {
        window.postMessage(ackPayload, '*');
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(ackPayload, '*');
        }
      }
    } catch (e) {}
    return 'MW_ALREADY_ACTIVE';
  }
  window.__MW_ACTIVE__ = true;
  console.log('[MW-INJECT] version=${buildVersion} commit=${buildCommit}');
  
  console.log('[MW] ========================================');
  console.log('[MW] injected - Moderation Script v3.0');
  console.log('[MW] Sensitivity:', ${config.sensitivity});
  console.log('[MW] Blur Strength:', ${config.blurStrength}, 'px');
  console.log('[MW] Enabled:', ${config.enabled});
  console.log('[MW] Forced Blur:', ${config.forcedBlur || false});
  console.log('[MW] Fail-Closed:', ${failClosed}, '(default: fail-open)');
  console.log('[MW] Nonce:', '${nonce.substring(0, 10)}...');
  console.log('[MW] URL:', window.location.href);
  console.log('[MW] ========================================');

  const CONFIG = {
    sensitivity: ${config.sensitivity},
    blurStrength: ${config.blurStrength},
    softBlurStrength: 8, // Soft blur for semantic delay
    enabled: ${config.enabled},
    forcedBlur: ${config.forcedBlur || false},
    failClosed: ${failClosed},
    debug: ${config.debug || false},
    nonce: '${nonce}',
    blockingMode: '${config.blockingMode || 'mvp'}',
    enableVideoFrameSnapshots: ${config.enableVideoFrameSnapshots === true},
    kidSafeProfile: ${config.kidSafeProfile === true},
    domainContextAdult: ${config.domainContextAdult === true},
    pageEpoch: ${pageEpoch},
    minImageSize: 80, // Minimum image dimension (fail-open below this - 80x80)
    semanticDelayMs: 200, // Delay before applying blur (200ms)
    // Neutral fast-pass removed for strict/YouTube mode
    anatomicalThreshold: 0.60, // Sexy/Porn must be > this to maintain blur
    scanDelay: 50,
    batchSize: 5,
    batchDelay: 100,
    requestTimeout: 8000,
  };
  if (CONFIG.debug) {
    console.log(
      '[MW][VERSION]',
      'tag=mw_stable_blur_pipeline_v1',
      'commit=48d5a87',
      'epoch=' + CONFIG.pageEpoch
    );
  }

  // Threshold mappings for blur dial levels.
  const THRESHOLDS = {
    0: { porn: 1.1, sexy: 1.1, hentai: 1.1 },       // Off
    1: { porn: 0.7, sexy: 0.85, hentai: 0.7 },      // Relaxed
    2: { porn: 0.5, sexy: 0.65, hentai: 0.5 },      // Moderate
    3: { porn: 0.3, sexy: 0.45, hentai: 0.3 },      // Strict
    4: { porn: 0.15, sexy: 0.25, hentai: 0.15 },    // Maximum
  };
  const EFFECTIVE_THRESHOLDS = THRESHOLDS[CONFIG.sensitivity] || THRESHOLDS[3];
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
    swimwear: 'sexy',
    shirtless: 'sexy',
    shirtless_male: 'sexy',
    partial_nudity: 'sexy',
    hentai: 'hentai',
    neutral: 'neutral',
    safe: 'safe',
    drawing: 'drawing',
  };
  const TRACE_UNSAFE_LABELS = new Set(['porn', 'sexy', 'hentai']);
  const LEGACY_RESULTS_POLL_MS = 250;
  const URL_CHANGE_POLL_MS = 1200;
  console.log('[MW] Effective config:', JSON.stringify({
    blurDial: CONFIG.sensitivity,
    thresholds: EFFECTIVE_THRESHOLDS,
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
    let overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = OVERLAY_ID;
      overlay.setAttribute('aria-hidden', 'true');
      (document.body || document.documentElement).appendChild(overlay);
    }
    return overlay;
  }

  function setOverlayEnabled(enabled, reason) {
    const prevEnabled = !!overlayState.enabled;
    overlayState.enabled = !!enabled;
    overlayState.reason = reason || 'unknown';
    overlayState.updatedAt = Date.now();

    ensureOverlayStyle();
    const overlay = ensureOverlayElement();
    if (!overlay) return;

    if (overlayState.enabled) {
      overlay.classList.add('mw-enabled');
    } else {
      overlay.classList.remove('mw-enabled');
    }
    if (CONFIG.debug && prevEnabled !== overlayState.enabled) {
      console.log('[MW][Overlay] enabled=' + overlayState.enabled, 'reason=' + overlayState.reason);
    }
    if (CONFIG.debug && prevEnabled !== overlayState.enabled) {
      console.log('[MW-DIAG][INJECT] source=overlay', 'enabled=' + overlayState.enabled, 'reason=' + overlayState.reason);
    }
  }

  function sendBlurReady(reason) {
    const activeEpoch = Number.isFinite(window.__MW_PAGE_EPOCH__) ? Number(window.__MW_PAGE_EPOCH__) : Number(CONFIG.pageEpoch);
    postToHost({
      type: 'MW_BLUR_READY',
      navId: String(window.__MW_NAV_ID__ || 'unknown'),
      pageEpoch: activeEpoch,
      reason: reason || 'ready',
      timestamp: Date.now(),
    });
  }

  function handleBlurCommand(message) {
    if (!message || typeof message !== 'object') return false;

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

  if (!window.__MW_BLUR_NAV_HOOKED__) {
    window.__MW_BLUR_NAV_HOOKED__ = true;
    const rawPushState = history.pushState;
    const rawReplaceState = history.replaceState;

    history.pushState = function() {
      const result = rawPushState.apply(this, arguments);
      setTimeout(function() { sendBlurReady('pushState'); }, 0);
      return result;
    };

    history.replaceState = function() {
      const result = rawReplaceState.apply(this, arguments);
      setTimeout(function() { sendBlurReady('replaceState'); }, 0);
      return result;
    };

    window.addEventListener('popstate', function() { sendBlurReady('popstate'); });
    window.addEventListener('hashchange', function() { sendBlurReady('hashchange'); });
    window.addEventListener('pageshow', function() { sendBlurReady('pageshow'); });
    window.addEventListener('load', function() { sendBlurReady('load'); });
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) sendBlurReady('visibility');
    });
  }

  if (!window.__MW_BLUR_HEAL_OBSERVER__) {
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

  window.__MW_BLUR_OVERLAY_API__ = {
    enable: function(reason) { setOverlayEnabled(true, reason || 'api_enable'); },
    disable: function(reason) { setOverlayEnabled(false, reason || 'api_disable'); },
    setState: function(enabled, reason) { setOverlayEnabled(!!enabled, reason || 'api_state'); },
    sendReady: function(reason) { sendBlurReady(reason || 'api_ready'); },
    getState: function() { return { enabled: !!overlayState.enabled, reason: overlayState.reason, updatedAt: overlayState.updatedAt }; },
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
  };

  // Batch queue for collecting items before sending request
  let batchQueue = [];
  let batchTimer = null;
  const NAV_ID = window.__MW_NAV_ID__ || ('mw_' + Date.now().toString(36));
  window.__MW_NAV_ID__ = NAV_ID;
  window.__MW_PAGE_EPOCH__ = state.pageEpoch;
  const NONCE_PREFIX = String(CONFIG.nonce || '').substring(0, 6);
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
  const timerState = {
    legacyResultsInterval: null,
    urlChangeInterval: null,
    youtubePeriodicInterval: null,
    mainScrollTimeout: null,
    mainScrollHandler: null,
    youtubeScrollTimeout: null,
    youtubeScrollHandler: null,
    debugSummaryInterval: null,
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

  function pruneDisconnectedPending(reason) {
    const toClear = [];
    state.pending.forEach(function(pending, itemId) {
      if (!pending || !pending.element || !pending.element.isConnected) {
        toClear.push(itemId);
      }
    });
    toClear.forEach(function(itemId) { clearPendingItem(itemId, reason || 'disconnected'); });
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

  function queueMutationScan(node) {
    if (!node || node.nodeType !== 1) return;
    if (mutationScanSet.has(node)) return;
    if (mutationScanQueue.length >= MAX_MUTATION_QUEUE_ITEMS) {
      state.stats.skippedMutationQueueCap++;
      return;
    }
    mutationScanSet.add(node);
    mutationScanQueue.push(node);
    if (!mutationScanTimer) {
      mutationScanTimer = setTimeout(flushMutationScanQueue, MUTATION_SCAN_FLUSH_DELAY_MS);
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
  const ENABLE_VIDEO_FRAME_SNAPSHOTS = CONFIG.enableVideoFrameSnapshots === true;
  const VIDEO_SNAPSHOT_PER_VIDEO_MIN_INTERVAL_MS = 1800;
  const VIDEO_SNAPSHOT_GLOBAL_MIN_INTERVAL_MS = 900;
  const VIDEO_SNAPSHOT_MAX_LONG_SIDE = 192;
  const VIDEO_SNAPSHOT_JPEG_QUALITY = 0.42;
  const VIDEO_SNAPSHOT_MAX_DATA_URL_CHARS = 120000;
  const VIDEO_SNAPSHOT_SURFACE_PLATFORMS = new Set(['youtube-shorts', 'tiktok', 'instagram']);
  let videoSnapshotInFlight = false;
  let videoSnapshotLastGlobalAt = 0;
  let videoSnapshotCanvas = null;
  let videoSnapshotContext = null;
  console.log('[MW] Platform detected:', PLATFORM, 'isYouTube:', IS_YOUTUBE);
  const videoActivityState = {
    playing: false,
    lastEventAt: 0,
    lastStateSent: '',
    rapidSourceWindowStart: 0,
    rapidSourceChanges: 0,
    playbackListener: null,
  };

  function postVideoActivity(state, reason) {
    const now = Date.now();
    if (videoActivityState.lastStateSent === state && now - videoActivityState.lastEventAt < 500) return;
    videoActivityState.lastStateSent = state;
    videoActivityState.lastEventAt = now;
    postToHost({
      type: 'MW_VIDEO_ACTIVITY',
      state: state,
      reason: reason || 'none',
      timestamp: now,
    });
  }

  function queueVideoMediaTargets(video, sourceTypePrefix) {
    if (!video) return;
    const sourceType = sourceTypePrefix || 'video';
    const poster = video.poster || video.getAttribute('poster');
    if (poster) {
      queueForScan(poster, video, sourceType + '-poster');
    }
    const currentSrc = video.currentSrc || video.src;
    if (currentSrc) {
      queueForScan(currentSrc, video, sourceType + '-currentSrc');
    }
    const thumb =
      video.getAttribute('thumbnail') ||
      video.getAttribute('data-thumbnail') ||
      video.dataset.thumb ||
      video.dataset.thumbnail;
    if (thumb) {
      queueForScan(thumb, video, sourceType + '-thumbnail');
    }
    queueVideoFrameSnapshot(video, sourceType);
  }

  function isVideoSnapshotSurface(video) {
    if (VIDEO_SNAPSHOT_SURFACE_PLATFORMS.has(PLATFORM)) return true;
    if (isShortsOrReelsStyle(video)) return true;
    if (state.blurred.size > 0 || overlayState.enabled) return true;
    return false;
  }

  function isVideoSnapshotEligible(video) {
    if (!ENABLE_VIDEO_FRAME_SNAPSHOTS) return false;
    if (!video) return false;
    if (document.visibilityState !== 'visible') return false;
    if (video.paused || video.ended || video.readyState < 2) return false;
    if (videoSnapshotInFlight) return false;
    if (!isElementVisible(video)) return false;
    if (!isVideoSnapshotSurface(video)) return false;
    if (state.pending.size >= MAX_PENDING_ITEMS - 4) return false;
    if (batchQueue.length >= MAX_BATCH_QUEUE_ITEMS - 4) return false;

    const now = Date.now();
    if (now - videoSnapshotLastGlobalAt < VIDEO_SNAPSHOT_GLOBAL_MIN_INTERVAL_MS) return false;
    const lastPerVideoAt = Number(video.dataset.mwLastFrameCaptureAt || '0');
    if (now - lastPerVideoAt < VIDEO_SNAPSHOT_PER_VIDEO_MIN_INTERVAL_MS) return false;
    return true;
  }

  function getVideoSnapshotCanvas(targetWidth, targetHeight) {
    if (!videoSnapshotCanvas) {
      videoSnapshotCanvas = document.createElement('canvas');
    }
    if (videoSnapshotCanvas.width !== targetWidth) videoSnapshotCanvas.width = targetWidth;
    if (videoSnapshotCanvas.height !== targetHeight) videoSnapshotCanvas.height = targetHeight;
    if (!videoSnapshotContext) {
      videoSnapshotContext = videoSnapshotCanvas.getContext('2d', { alpha: false, willReadFrequently: false });
    }
    return videoSnapshotCanvas;
  }

  function queueVideoFrameSnapshot(video, sourceTypePrefix) {
    if (!isVideoSnapshotEligible(video)) return;

    const sourceType = sourceTypePrefix || 'video';
    const srcKey = video.currentSrc || video.src || '';
    const naturalWidth = Number(video.videoWidth || 0);
    const naturalHeight = Number(video.videoHeight || 0);
    if (naturalWidth < CONFIG.minImageSize || naturalHeight < CONFIG.minImageSize) return;

    const longSide = Math.max(naturalWidth, naturalHeight);
    const scale = longSide > VIDEO_SNAPSHOT_MAX_LONG_SIDE ? (VIDEO_SNAPSHOT_MAX_LONG_SIDE / longSide) : 1;
    const targetWidth = Math.max(1, Math.round(naturalWidth * scale));
    const targetHeight = Math.max(1, Math.round(naturalHeight * scale));

    try {
      videoSnapshotInFlight = true;
      const now = Date.now();
      const canvas = getVideoSnapshotCanvas(targetWidth, targetHeight);
      if (!canvas || !videoSnapshotContext) return;

      videoSnapshotContext.clearRect(0, 0, targetWidth, targetHeight);
      videoSnapshotContext.drawImage(video, 0, 0, targetWidth, targetHeight);
      const frameDataUrl = canvas.toDataURL('image/jpeg', VIDEO_SNAPSHOT_JPEG_QUALITY);
      if (!frameDataUrl || frameDataUrl.length > VIDEO_SNAPSHOT_MAX_DATA_URL_CHARS) return;

      if (queueForScan(frameDataUrl, video, sourceType + '-frame')) {
        videoSnapshotLastGlobalAt = now;
        video.dataset.mwLastFrameCaptureAt = String(now);
        if (srcKey) {
          video.dataset.mwLastFrameCaptureSrc = srcKey;
        }
      }
    } catch (e) {
      // Safe failure: skip frame snapshots on draw/encode errors.
    } finally {
      videoSnapshotInFlight = false;
    }
  }

  function isShortsOrReelsStyle(video) {
    const path = String(window.location.pathname || '').toLowerCase();
    if (path.includes('/shorts') || path.includes('/reel') || path.includes('/reels')) return true;
    const fullscreenElement = document.fullscreenElement;
    if (fullscreenElement && (fullscreenElement === video || (fullscreenElement.contains && fullscreenElement.contains(video)))) {
      return true;
    }
    try {
      const rect = video.getBoundingClientRect();
      const videoArea = Math.max(rect.width * rect.height, 0);
      const viewportArea = Math.max(window.innerWidth * window.innerHeight, 1);
      return videoArea >= viewportArea * 0.65;
    } catch (e) {
      return false;
    }
  }

  function noteVideoSourceChange(video, reason) {
    const now = Date.now();
    if (!videoActivityState.rapidSourceWindowStart || (now - videoActivityState.rapidSourceWindowStart) > 8000) {
      videoActivityState.rapidSourceWindowStart = now;
      videoActivityState.rapidSourceChanges = 0;
    }
    videoActivityState.rapidSourceChanges += 1;
    queueVideoMediaTargets(video, 'video-source-change');
    if (videoActivityState.rapidSourceChanges >= 3 && isShortsOrReelsStyle(video)) {
      postVideoActivity('playing', reason || 'rapid_source_change');
    }
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
  function applySoftBlur(element, src, itemId) {
    // Check persistence: if user revealed this, don't blur
    if (state.revealed.has(src)) return;
    if (element.dataset.mwRevealed === 'true') return;
    if (element.dataset.mwModerated === 'blurred') return; // Already hard blurred
    
    try {
      element.style.filter = 'blur(' + CONFIG.softBlurStrength + 'px)';
      element.style.transition = 'filter 0.2s ease';
      element.dataset.mwModerated = 'softblur';
      element.dataset.mwSrc = src;
      element.dataset.mwItemId = itemId || '';
      element.classList.add('mw-softblur');
      
      if (CONFIG.debug) {
        console.log('[MW] soft blur applied:', src.substring(0, 50));
      }
    } catch (e) {}
  }

  /**
   * Remove all blur (after safe result)
   */
  function removeSoftBlur(element, src) {
    try {
      const beforeState = element.dataset.mwModerated || '';
      const beforeFilter = element.style.getPropertyValue('filter') || element.style.filter || '';
      const beforeHasBlur = beforeFilter.toLowerCase().includes('blur(');
      if (element.dataset.mwModerated === 'softblur' || element.classList.contains('mw-softblur')) {
        element.style.filter = 'none';
        element.dataset.mwModerated = 'safe';
        element.classList.remove('mw-softblur');
        
        if (CONFIG.debug) {
          console.log('[MW] soft blur removed (safe):', src.substring(0, 50));
        }
      }
      console.log(
        '[MW][JSBlur][AutoRemoveCheck]',
        'src=' + String(src || '').substring(0, 120),
        'beforeState=' + beforeState,
        'beforeHasBlur=' + beforeHasBlur,
        'afterState=' + (element.dataset.mwModerated || ''),
        'afterFilter=' + (element.style.getPropertyValue('filter') || element.style.filter || '')
      );
    } catch (e) {}
  }

  const FORCE_UNSAFE_CATEGORIES = new Set([
    'swimwear',
    'shirtless',
    'shirtless_male',
    'bikini',
    'swim_trunks',
    'sports_bra',
  ]);

  function isExplicitUnsafeLabel(label) {
    return label === 'porn' || label === 'hentai';
  }

  function normalizePolicyCategory(label) {
    return String(label || '').trim().toLowerCase();
  }

  function isMvpAllowedCategory(label) {
    const raw = normalizePolicyCategory(label);
    return FORCE_UNSAFE_CATEGORIES.has(raw) || isExplicitUnsafeLabel(raw);
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

    if (CONFIG.blockingMode === 'mvp' && CONFIG.domainContextAdult !== true) {
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
    if (normalizedPredicted !== 'sexy' && normalizedPredicted !== 'porn') {
      return { shouldBlur: !!shouldApplyBlur, reason: null };
    }
    if (CONFIG.kidSafeProfile === true && CONFIG.domainContextAdult === true) {
      return { shouldBlur: true, reason: null };
    }

    const score = normalizedPredicted === 'sexy' ? unsafeScores.sexy : unsafeScores.porn;
    if (score === null || !Number.isFinite(score)) {
      if (CONFIG.failClosed && CONFIG.enabled && CONFIG.sensitivity > 0) {
        return { shouldBlur: true, reason: normalizedPredicted + '_scoreNaN/failClosed' };
      }
      return { shouldBlur: false, reason: normalizedPredicted + '_scoreNaN/failOpen' };
    }

    if (score < CONFIG.anatomicalThreshold) {
      return { shouldBlur: false, reason: normalizedPredicted + '<anatomicalThreshold' };
    }

    return { shouldBlur: true, reason: null };
  }

  /**
   * Apply hard blur (for unsafe content)
   * Uses !important to override site styles on iOS
   */
  function applyBlur(element, src, category, blurStrengthPx, itemId) {
    // Check persistence
    if (state.revealed.has(src)) return;
    if (element.dataset.mwRevealed === 'true') return;
    
    const blurPx = (IS_YOUTUBE ? 40 : (blurStrengthPx || CONFIG.blurStrength || 30));
    
    try {
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
      element.classList.remove('mw-softblur');
      element.classList.add('mw-blurred');
      
      state.blurred.add(src);
      state.stats.blurred++;
      
      createRevealOverlay(element, src, category, itemId);
      const appliedFilter = element.style.getPropertyValue('filter') || element.style.filter || '';
      const filterPriority = element.style.getPropertyPriority('filter') || 'none';
      console.log(
        '[MW][JSBlur][Apply]',
        'itemId=' + (itemId || 'N/A'),
        'src=' + String(src || '').substring(0, 120),
        'filter=' + appliedFilter,
        'priority=' + filterPriority
      );
      console.log('[MW] applied blur [' + category + '] itemId=' + (itemId || 'N/A') + ':', src.substring(0, 60));
    } catch (e) {
      console.error('[MW] Failed to apply blur:', e.message);
      state.stats.errors++;
    }
  }

  function removeBlur(element, src) {
    try {
      element.style.filter = 'none';
      element.dataset.mwModerated = 'revealed';
      element.dataset.mwRevealed = 'true'; // Persistence marker
      element.classList.remove('mw-softblur');
      
      // Add to revealed set for persistence
      state.revealed.add(src);
      
      const overlay = element.parentElement?.querySelector('.mw-reveal-overlay');
      if (overlay) {
        overlay.style.display = 'none';
      }
      
      console.log('[MW] blur removed:', src.substring(0, 60));
    } catch (e) {}
  }

  function createRevealOverlay(element, src, category, itemId) {
    if (element.dataset.mwHasOverlay === 'true') return;
    
    const parent = element.parentElement;
    if (!parent) return;
    
    const parentPos = window.getComputedStyle(parent).position;
    if (parentPos === 'static') {
      parent.style.position = 'relative';
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'mw-reveal-overlay';
    overlay.dataset.mwFor = src;
    overlay.style.cssText = [
      'position: absolute',
      'inset: 0',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'background: rgba(0, 0, 0, 0.3)',
      'z-index: 9998',
      'cursor: pointer',
    ].join(';');
    
    const badge = document.createElement('span');
    badge.style.cssText = [
      'position: absolute',
      'top: 8px',
      'left: 8px',
      'background: rgba(0,0,0,0.8)',
      'color: #ff6b6b',
      'padding: 3px 8px',
      'border-radius: 4px',
      'font-size: 10px',
      'font-weight: bold',
    ].join(';');
    badge.textContent = (category || 'flagged').toUpperCase();
    overlay.appendChild(badge);
    
    const btn = document.createElement('button');
    btn.className = 'mw-reveal-btn';
    btn.textContent = '👁 Reveal';
    btn.style.cssText = [
      'background: rgba(0, 0, 0, 0.9)',
      'color: white',
      'border: 2px solid rgba(255, 255, 255, 0.3)',
      'padding: 10px 20px',
      'border-radius: 8px',
      'cursor: pointer',
      'font-size: 14px',
      'font-weight: bold',
    ].join(';');
    
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      if (state.revealed.has(src)) {
        // Re-blur
        state.revealed.delete(src);
        element.dataset.mwRevealed = 'false';
        applyBlur(element, src, category, CONFIG.blurStrength, itemId);
        btn.textContent = '👁 Reveal';
        overlay.style.display = 'flex';
      } else {
        // Reveal and trigger feedback
        state.revealed.add(src);
        element.dataset.mwRevealed = 'true'; // Persistence
        removeBlur(element, src);
        btn.textContent = '🔒 Hide';
        
        // POST a label request message so the host can open the labeling modal
        var labelItemId = itemId || element.dataset.mwItemId || 'unknown_' + Date.now();
        var labelRequest = {
          type: 'gc-label-request',
          requestId: 'r_' + Date.now().toString(36),
          itemId: labelItemId,
          src: src,
          pageUrl: window.location.href,
          platform: PLATFORM,
          modelPrediction: { category: category, confidence: null }
        };
        console.log('[MW] posting gc-label-request', labelItemId);
        postToHost(labelRequest);
        
        // Show brief correction overlay
        showCorrectionOverlay(element, src, category, labelItemId);
      }
    });
    
    overlay.appendChild(btn);
    parent.appendChild(overlay);
    element.dataset.mwHasOverlay = 'true';
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
      thresholds: THRESHOLDS[CONFIG.sensitivity] || THRESHOLDS[3],
      pageEpoch: state.pageEpoch,
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
      timestamp: timestamp,
      timeoutId: timeoutId,
      state: 'waitingForHost',
    });

    state.stats.requestsSent++;
    
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
      noncePrefix: NONCE_PREFIX,
      itemCount: items.length,
      timestamp: timestamp,
    });
    console.log('[MW] waiting response', requestId, 'ts=' + timestamp);
    
    postToHost(message);
  }

  /**
   * Handle timeout for pending request
   * FAIL-OPEN by default: Do NOT apply blur on timeout
   */
  function handleRequestTimeout(requestId) {
    const pendingRequest = state.pendingRequests.get(requestId);
    if (!pendingRequest) return;
    if (pendingRequest.state === 'handled') return;
    if (Number.isFinite(pendingRequest.pageEpoch) && pendingRequest.pageEpoch !== state.pageEpoch) {
      state.pendingRequests.delete(requestId);
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
      if (resultEpoch !== null && resultEpoch !== state.pageEpoch) {
        state.stats.staleEpochDiscarded++;
        console.warn(
          '[MW][RejectResult]',
          'reason=epoch',
          'requestId=' + requestId,
          'expectedNonce=' + expectedNoncePrefix,
          'gotNonce=' + receivedNoncePrefix,
          'resultEpoch=' + resultEpoch,
          'activeEpoch=' + state.pageEpoch
        );
        return;
      }
      
      if (!requestId || !Array.isArray(results)) {
        console.log('[MW] Invalid result message:', message);
        return;
      }
      
      // SECURITY: Validate nonce
      if (nonce !== CONFIG.nonce) {
        state.stats.nonceRejected++;
        console.warn(
          '[MW][RejectResult]',
          'reason=nonce',
          'requestId=' + requestId,
          'expectedNonce=' + expectedNoncePrefix,
          'gotNonce=' + receivedNoncePrefix,
          'resultEpoch=' + (resultEpoch === null ? 'none' : resultEpoch),
          'activeEpoch=' + state.pageEpoch
        );
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
      
      results.forEach(result => {
      const { itemId, src, shouldBlur, category, confidence, reason } = result;
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
      const thresholdUsed = Object.prototype.hasOwnProperty.call(EFFECTIVE_THRESHOLDS, predictedLabel)
        ? EFFECTIVE_THRESHOLDS[predictedLabel]
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
      
      // Clear any pending blur timer (semantic delay)
      if (pendingItem && pendingItem.blurTimer) {
        clearTimeout(pendingItem.blurTimer);
      }
      
      clearPendingItem(itemId, 'result');
      state.scanned.add(src);
      
      // Check if result came fast enough to skip blur (semantic delay saved)
      const wasInSoftBlur = element && element.dataset.mwModerated === 'softblur';
      
      // ======== Neutral fast-pass removed (strict mode) ========

      
      // ======== ANATOMICAL LOGIC ========
      // Only maintain blur if Sexy or Porn > 0.60
      let shouldApplyBlur = shouldBlur;
      let decisionReason = reason || '';
      const forceUnsafe = FORCE_UNSAFE_CATEGORIES.has(rawCategory);

      // Prefer explicit threshold evaluation when label + score are available.
      // Directionality: score > threshold => blur.
      //
      // Guardrail: preserve host-safe decisions by default.
      // Only allow threshold-based escalation from safe->blur in strict/max sensitivity
      // or when failClosed is explicitly enabled.
      const allowSafeToBlurEscalation = CONFIG.failClosed || CONFIG.sensitivity >= 3;
      if (!shouldBlur && !allowSafeToBlurEscalation) {
        shouldApplyBlur = false;
        decisionReason = 'host_safe_preserved';
      } else if (forceUnsafe && shouldBlur) {
        shouldApplyBlur = true;
        decisionReason = 'forceUnsafeCategory/' + rawCategory;
      } else if (thresholdComparable) {
        shouldApplyBlur = !!thresholdHit;
        decisionReason = thresholdHit ? (predictedLabel + '>=thr') : (predictedLabel + '<thr');
      } else if (thresholdUsed !== null && labelScoreUsed === null) {
        shouldApplyBlur = false;
        decisionReason = 'NaN/default';
      }

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
      
      // Apply blur based on result or forced blur mode
      let finalBlur = CONFIG.forcedBlur || (shouldApplyBlur && CONFIG.enabled && CONFIG.sensitivity > 0);
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
        const preDecisionState = element.dataset.mwModerated || '';
        const preDecisionFilter = element.style.getPropertyValue('filter') || element.style.filter || '';
        const preDecisionHasBlur = preDecisionFilter.toLowerCase().includes('blur(');
        if (finalBlur) {
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
          applyBlur(element, src, predictedLabel || category || 'flagged', CONFIG.blurStrength, itemId);
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
          if (wasInSoftBlur && !finalBlur) {
            state.stats.semanticDelaySaved++;
          }
        }
      }
      
      // Also find any other elements with the same src
      if (finalBlur) {
        clearSafeResolved(src);
        findAndBlur(src, predictedLabel || category, CONFIG.blurStrength, true);
      } else {
        markSafeResolved(src);
        // Remove soft blur from all matching elements
        findAndRemoveSoftBlur(src);
      }
      });
      if (DEBUG_SKIP_DOMAIN_BLUR) {
        console.log('[MW] classification counts (kill-switch active):', JSON.stringify(state.stats.classificationCounts), 'blurSkipped=' + state.stats.blurSkippedByKillSwitch);
      }
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      console.error('[MW][InjectError]', message);
    }
  }

  /**
   * Find and blur all elements matching a src
   */
  function findAndBlur(src, category, blurStrengthPx, shouldBlur) {
    if (!shouldBlur) return;
    if (state.revealed.has(src)) return;
    
    try {
      // Images
      document.querySelectorAll('img').forEach(img => {
        if ((img.src === src || img.dataset.mwOrigSrc === src) && !state.revealed.has(src)) {
          if (img.dataset.mwModerated !== 'blurred' && img.dataset.mwRevealed !== 'true') {
            applyBlur(img, src, category, blurStrengthPx);
          }
        }
      });
      
      // Video posters
      document.querySelectorAll('video').forEach(video => {
        if ((video.poster === src || video.dataset.mwOrigPoster === src) && !state.revealed.has(src)) {
          if (video.dataset.mwModerated !== 'blurred' && video.dataset.mwRevealed !== 'true') {
            applyBlur(video, src, category, blurStrengthPx);
          }
        }
      });
      
      // Background images
      document.querySelectorAll('[data-mw-bg-src]').forEach(el => {
        if (el.dataset.mwBgSrc === src && !state.revealed.has(src)) {
          if (el.dataset.mwModerated !== 'blurred' && el.dataset.mwRevealed !== 'true') {
            applyBlur(el, src, category, blurStrengthPx);
          }
        }
      });
    } catch (e) {}
  }

  /**
   * Find and remove soft blur from all elements matching a src
   */
  function findAndRemoveSoftBlur(src) {
    try {
      document.querySelectorAll('[data-mw-src="' + src + '"]').forEach(el => {
        removeSoftBlur(el, src);
      });
      
      document.querySelectorAll('img').forEach(img => {
        if (img.src === src || img.dataset.mwOrigSrc === src) {
          removeSoftBlur(img, src);
        }
      });
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
      return false;
    }
    
    // Skip tiny data URLs
    if (url.startsWith('data:') && url.length < 1000) {
      state.stats.skipped++;
      return false;
    }
    
    // FAIL-OPEN: Skip tiny images (< 80x80)
    if (isTinyImage(element)) {
      state.stats.skippedTiny++;
      if (CONFIG.debug) {
        console.log('[MW] skipped tiny image (fail-open, <80x80):', url.substring(0, 50));
      }
      return false;
    }
    
    // Skip already processed
    if (state.scanned.has(url)) {
      return false;
    }
    
    // Skip if already revealed by user (persistence)
    if (state.revealed.has(url) || element.dataset.mwRevealed === 'true') {
      return false;
    }
    
    if (state.pending.size >= MAX_PENDING_ITEMS || batchQueue.length >= MAX_BATCH_QUEUE_ITEMS) {
      state.stats.skippedQueueCap++;
      return false;
    }
    if (!allowPerSecond(rateLimiter.enqueue, MAX_ENQUEUE_PER_SEC)) {
      state.stats.skippedRateLimited++;
      return false;
    }

    const existingPendingId = state.pendingBySrc.get(url);
    if (existingPendingId) {
      const existingPending = state.pending.get(existingPendingId);
      if (existingPending && existingPending.src === url) {
        return false;
      }
      state.pendingBySrc.delete(url);
    }
    
    const itemId = generateItemId();
    const { width, height } = getElementDimensions(element);
    
    // Store element reference
    state.elements.set(itemId, element);
    
    // SEMANTIC DELAY: only apply soft blur after semanticDelayMs if still pending.
    // Fast safe results will cancel this timer before any blur is shown.
    const blurTimer = setTimeout(() => {
      const pending = state.pending.get(itemId);
      if (pending && pending.state === 'pending') {
        applySoftBlur(element, url, itemId);
        if (CONFIG.debug) {
          console.log('[MW][Timer] semanticDelay fired: soft blur applied itemId=' + itemId, url.substring(0, 60));
        }
      }
    }, CONFIG.semanticDelayMs);
    
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
            queueMutationScan(element);
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
      return;
    }
    if (img.dataset.mwScanned === 'true' && img.dataset.mwLastScanSrc === src) return;
    
    img.dataset.mwScanned = 'true';
    img.dataset.mwLastScanSrc = src;
    img.dataset.mwOrigSrc = src;
    
    if (queueForScan(src, img, 'img')) {
      state.stats.imgTags++;
    }
  }

  function scanVideoPoster(video) {
    const poster = video.poster ||
                   video.dataset.poster ||
                   video.getAttribute('data-poster');
    
    if (!poster) return;
    if (video.dataset.mwPosterScanned === 'true' && video.dataset.mwLastPoster === poster) return;
    
    video.dataset.mwPosterScanned = 'true';
    video.dataset.mwLastPoster = poster;
    video.dataset.mwOrigPoster = poster;
    
    if (queueForScan(poster, video, 'video-poster')) {
      state.stats.videoPosters++;
    }
    queueVideoMediaTargets(video, 'video-scan');
  }

  function scanBgImage(element) {
    const bgUrl = extractBgImageUrl(element);
    if (!bgUrl) return;
    if (element.dataset.mwBgScanned === 'true' && element.dataset.mwLastBg === bgUrl) return;
    
    element.dataset.mwBgScanned = 'true';
    element.dataset.mwLastBg = bgUrl;
    element.dataset.mwBgSrc = bgUrl;
    
    if (queueForScan(bgUrl, element, 'bg-image')) {
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
      shadowRoot.querySelectorAll('*').forEach(el => {
        scanBgImage(el);
        if (el.shadowRoot) {
          scanShadowRoot(el.shadowRoot);
        }
      });
      
      setupMutationObserver(shadowRoot);
    } catch (e) {
      console.error('[MW] Shadow DOM scan error:', e.message);
    }
  }

  function scanNode(node) {
    if (!node || node.nodeType !== 1) return;
    if (!allowPerSecond(rateLimiter.scanNode, MAX_SCAN_NODE_PER_SEC)) {
      state.stats.skippedRateLimited++;
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
      node.querySelectorAll('*').forEach(el => {
        scanBgImage(el);
        if (el.shadowRoot) {
          scanShadowRoot(el.shadowRoot);
        }
      });
    } catch (e) {}
  }

  function scanFullPage() {
    if (!CONFIG.enabled || CONFIG.sensitivity === 0) {
      console.log('[MW] Scanning disabled (sensitivity: ' + CONFIG.sensitivity + ')');
      return;
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
    
    console.log('[MW] === YOUTUBE THUMBNAIL SCAN ===');
    
    YOUTUBE_SELECTORS.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(el => {
          // Find all img elements within or the element itself
          if (el.tagName === 'IMG') {
            scanImgElement(el);
          } else {
            // Scan all images inside YouTube components
            el.querySelectorAll('img').forEach(img => {
              scanImgElement(img);
            });
          }
        });
      } catch (e) {}
    });
  }

  function setupMutationObserver(root) {
    const observer = new MutationObserver(mutations => {
      if (timerState.paused) return;
      if (!CONFIG.enabled || CONFIG.sensitivity === 0) return;
      
      let hasYouTubeChanges = false;
      
      mutations.forEach(mutation => {
        mutation.removedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          pruneDisconnectedPending('mutation_removed');
        });
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          
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
          
          // Add to viewport observer for lazy scanning
          observeForViewport(node);
          queueMutationScan(node);
        });
        
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          const attr = mutation.attributeName;
          
          if ((attr === 'src' || attr === 'srcset') && target.tagName === 'IMG') {
            queueMutationScan(target);
          }
          
          if (attr === 'poster' && target.tagName === 'VIDEO') {
            queueMutationScan(target);
            noteVideoSourceChange(target, 'poster_change');
          }

          if (attr === 'src' && target.tagName === 'VIDEO') {
            queueMutationScan(target);
            noteVideoSourceChange(target, 'video_src_change');
          }

          if (attr === 'src' && target.tagName === 'SOURCE' && target.parentElement && target.parentElement.tagName === 'VIDEO') {
            queueMutationScan(target.parentElement);
            noteVideoSourceChange(target.parentElement, 'source_child_change');
          }
          
          if (attr === 'data-src' || attr === 'data-lazy-src') {
            queueMutationScan(target);
          }
          
          if (attr === 'style') {
            queueMutationScan(target);
          }
        }
      });
      
      // If YouTube changes detected, do a targeted rescan after a short delay
      if (hasYouTubeChanges) {
        if (!mutationScanTimer) {
          mutationScanTimer = setTimeout(flushMutationScanQueue, 100);
        }
      }
    });
    
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'poster', 'data-src', 'data-lazy-src', 'data-thumb', 'style'],
    });
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

  function hasAnyPlayingVideo() {
    const videos = document.querySelectorAll('video');
    for (const video of videos) {
      if (!video.paused && !video.ended && video.readyState > 1) return true;
    }
    return false;
  }

  function setupVideoActivityListeners() {
    if (videoActivityState.playbackListener) return;
    const onVideoEvent = function(event) {
      const target = event.target;
      if (!target || target.tagName !== 'VIDEO') return;
      const video = target;
      if (event.type === 'play' || event.type === 'playing') {
        videoActivityState.playing = true;
        queueVideoMediaTargets(video, 'video-playing');
        postVideoActivity('playing', event.type);
        return;
      }
      if (event.type === 'pause' || event.type === 'ended') {
        queueVideoMediaTargets(video, 'video-paused');
        if (!hasAnyPlayingVideo()) {
          videoActivityState.playing = false;
          postVideoActivity('paused', event.type);
        }
      }
    };
    videoActivityState.playbackListener = onVideoEvent;
    document.addEventListener('play', onVideoEvent, true);
    document.addEventListener('playing', onVideoEvent, true);
    document.addEventListener('pause', onVideoEvent, true);
    document.addEventListener('ended', onVideoEvent, true);
  }

  // ==================== LEGACY QUEUE SUPPORT ====================
  
  // Keep legacy queues for backward compatibility with polling approach
  window.__GC_SCAN_QUEUE__ = window.__GC_SCAN_QUEUE__ || [];
  window.__GC_SCAN_RESULTS__ = window.__GC_SCAN_RESULTS__ || [];
  
  // Poll legacy results queue (fallback if postMessage doesn't work)
  function processLegacyResults() {
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
      
      state.scanned.add(src);
      const rawCategory = normalizePolicyCategory(category);
      const normalizedCategory = normalizeLabel(category);
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
          applyBlur(el, src, category, blurStrengthPx, itemId);
          clearSafeResolved(src);
        }
        clearPendingItem(itemId, 'legacy_result');
      }
    });
  }

  function startLegacyResultsPoll(reason) {
    if (timerState.legacyResultsInterval || timerState.paused) return;
    timerState.legacyResultsInterval = setInterval(processLegacyResults, LEGACY_RESULTS_POLL_MS);
    timerLog('start', 'legacyResultsInterval:' + reason);
  }

  function countActiveTimerHandles() {
    let count = 0;
    if (timerState.legacyResultsInterval) count++;
    if (timerState.urlChangeInterval) count++;
    if (timerState.youtubePeriodicInterval) count++;
    if (timerState.debugSummaryInterval) count++;
    if (timerState.mainScrollTimeout) count++;
    if (timerState.youtubeScrollTimeout) count++;
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
        pointer-events: auto !important;
      }
      .mw-reveal-btn {
        z-index: 9999 !important;
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

  // Set up observers
  setupMutationObserver(document.body);
  state.viewportObserver = setupViewportObserver();
  
  // YouTube-specific: Set up scroll handler for infinite scroll
  setupYouTubeScrollHandler();
  setupVideoActivityListeners();

  function scheduleInitTimeout(label, fn, delayMs) {
    const id = setTimeout(() => {
      timerState.initialTimeouts = timerState.initialTimeouts.filter(t => t !== id);
      if (timerState.paused || timerState.teardownDone) return;
      fn();
    }, delayMs);
    timerState.initialTimeouts.push(id);
    timerLog('start', label + ':' + delayMs + 'ms');
  }

  // Initial scan
  if (document.readyState === 'complete') {
    scanFullPage();
    if (isYouTube()) {
      scheduleInitTimeout('initialYouTubeScan', scanYouTubeThumbnails, 200);
    }
  } else {
    const onLoadScan = () => {
      if (timerState.teardownDone) return;
      scanFullPage();
      if (isYouTube()) {
        scheduleInitTimeout('loadYouTubeScan', scanYouTubeThumbnails, 200);
      }
    };
    window.addEventListener('load', onLoadScan);
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

  // SPA navigation detection
  let lastUrl = window.location.href;
  const checkUrlChange = () => {
    if (window.location.href !== lastUrl) {
      console.log('[MW] SPA navigation detected:', lastUrl, '->', window.location.href);
      lastUrl = window.location.href;
      state.pageEpoch += 1;
      window.__MW_PAGE_EPOCH__ = state.pageEpoch;
      if (CONFIG.debug) {
        console.log('[MW][Epoch] incremented pageEpoch=' + state.pageEpoch);
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
      scheduleInitTimeout('spaFullScan', scanFullPage, 300);
      if (isYouTube()) {
        scheduleInitTimeout('spaYouTubeScan', scanYouTubeThumbnails, 500);
      }
    }

    if (videoActivityState.playing) {
      if (hasAnyPlayingVideo()) {
        const activeVideo = Array.from(document.querySelectorAll('video')).find(video =>
          !video.paused && !video.ended && video.readyState > 1
        );
        if (activeVideo) {
          queueVideoFrameSnapshot(activeVideo, 'video-heartbeat');
        }
        postVideoActivity('playing', 'heartbeat');
      } else {
        videoActivityState.playing = false;
        postVideoActivity('paused', 'heartbeat');
      }
    }
  };

  function startUrlChangePoll(reason) {
    if (timerState.urlChangeInterval || timerState.paused) return;
    timerState.urlChangeInterval = setInterval(checkUrlChange, URL_CHANGE_POLL_MS);
    timerLog('start', 'urlChangeInterval:' + reason);
  }

  function stopManagedTimers(reason) {
    clearNamedInterval('legacyResultsInterval', reason);
    clearNamedInterval('urlChangeInterval', reason);
    clearNamedInterval('youtubePeriodicInterval', reason);
    clearNamedInterval('debugSummaryInterval', reason);
    clearNamedTimeout('mainScrollTimeout', reason);
    clearNamedTimeout('youtubeScrollTimeout', reason);
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
  }

  function startManagedTimers(reason) {
    if (timerState.paused || timerState.teardownDone) return;
    startLegacyResultsPoll(reason);
    startUrlChangePoll(reason);
    startYouTubePeriodicScan(reason);
    startDebugSummary(reason);
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
    if (timerState.mainScrollHandler) {
      window.removeEventListener('scroll', timerState.mainScrollHandler);
      timerState.mainScrollHandler = null;
    }
    if (timerState.youtubeScrollHandler) {
      window.removeEventListener('scroll', timerState.youtubeScrollHandler);
      timerState.youtubeScrollHandler = null;
    }
    if (state.viewportObserver && typeof state.viewportObserver.disconnect === 'function') {
      state.viewportObserver.disconnect();
      state.viewportObserver = null;
    }
    state.mutationObservers.forEach(observer => {
      try { observer.disconnect(); } catch (e) {}
    });
    state.mutationObservers = [];
    if (videoActivityState.playbackListener) {
      document.removeEventListener('play', videoActivityState.playbackListener, true);
      document.removeEventListener('playing', videoActivityState.playbackListener, true);
      document.removeEventListener('pause', videoActivityState.playbackListener, true);
      document.removeEventListener('ended', videoActivityState.playbackListener, true);
      videoActivityState.playbackListener = null;
    }
    window.__MW_ACTIVE__ = false;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      resumeManagedTimers('visibility_visible');
      return;
    }
    pauseManagedTimers('visibility_hidden');
  });
  window.addEventListener('beforeunload', () => teardownManagedScheduling('beforeunload'));
  window.addEventListener('pagehide', () => teardownManagedScheduling('pagehide'));
  window.__MW_TEARDOWN__ = function(reason) {
    teardownManagedScheduling(reason || 'host_teardown');
  };

  startManagedTimers('init');

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
