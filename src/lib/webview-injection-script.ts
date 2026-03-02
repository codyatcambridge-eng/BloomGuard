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
  pageEpoch?: number;
  diagYouTubeShorts?: boolean;
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
  anatomicalThreshold: number;
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
  if (input.predictedLabel !== 'sexy' && input.predictedLabel !== 'porn') {
    return { shouldBlur: !!input.shouldApplyBlur, reason: null };
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
  console.log('[MW] Sensitivity:', ${config.sensitivity});
  console.log('[MW] Blur Strength:', CLAMPED_BLUR_STRENGTH, 'px', '(requested:', REQUESTED_BLUR_STRENGTH + 'px)');
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
    forcedBlur: ${config.forcedBlur || false},
    failClosed: ${failClosed},
    debug: ${config.debug || false},
    nonce: '${nonce}',
    blockingMode: '${config.blockingMode || 'mvp'}',
    pageEpoch: ${pageEpoch},
    diagYouTubeShorts: ${config.diagYouTubeShorts ? 'true' : 'false'},
    minImageSize: 80, // Minimum image dimension (fail-open below this - 80x80)
    semanticDelayMs: 0, // Apply blur immediately; no delay to avoid flash of unblurred content
    // Neutral fast-pass removed for strict/YouTube mode
    anatomicalThreshold: 0.60, // Sexy/Porn must be > this to maintain blur
    scanDelay: 50,
    batchSize: 5,
    batchDelay: 100,
    requestTimeout: 8000,
  };

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
  let effectiveThresholds = getThresholdsForLevel(CONFIG.sensitivity);
  const HEURISTIC_CACHE_KEY = 'mw_heuristic_cache';
  const HEURISTIC_CACHE_LIMIT = 32;
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
  const DOM_OVERLAY_ENABLED = false;

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

  function setOverlayEnabled(enabled, reason) {
    const prevEnabled = !!overlayState.enabled;
    const nextEnabled = DOM_OVERLAY_ENABLED ? !!enabled : false;
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
    0: { background: 'rgba(148,163,184,0.85)', border: 'rgba(148,163,184,0.9)' },
    1: { background: 'rgba(16,185,129,0.9)', border: 'rgba(16,185,129,1)' },
    2: { background: 'rgba(234,179,8,0.9)', border: 'rgba(234,179,8,1)' },
    3: { background: 'rgba(249,115,22,0.95)', border: 'rgba(249,115,22,1)' },
    4: { background: 'rgba(239,68,68,0.95)', border: 'rgba(239,68,68,1)' },
  };
  const SENSITIVITY_TOGGLE_ID = 'mw-sensitivity-toggle';
  const SENSITIVITY_TOGGLE_STYLE_ID = 'mw-sensitivity-toggle-style';

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
    button.setAttribute('aria-label', 'Shield sensitivity: ' + getSensitivityLabel(level));
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
      " } ";
    (document.head || document.documentElement || document.body || document.documentElement).appendChild(style);
  }

  function ensureSensitivityToggle() {
    ensureSensitivityToggleStyle();
    if (document.getElementById(SENSITIVITY_TOGGLE_ID)) return;
    const hostRoot = document.body || document.documentElement;
    if (!hostRoot) {
      requestAnimationFrame(ensureSensitivityToggle);
      return;
    }
    const button = document.createElement('button');
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

  function applySensitivityLevel(level, reason) {
    const normalized = Math.min(4, Math.max(0, Math.round(level)));
    if (normalized === CONFIG.sensitivity && (normalized > 0) === CONFIG.enabled) {
      return;
    }
    CONFIG.sensitivity = normalized;
    CONFIG.enabled = normalized > 0;
    effectiveThresholds = getThresholdsForLevel(normalized);
    const toggle = document.getElementById(SENSITIVITY_TOGGLE_ID);
    if (toggle) {
      updateSensitivityToggleButton(toggle);
    }
    console.log('[MW] Sensitivity dial set to', normalized, 'label=' + getSensitivityLabel(normalized), 'reason=' + (reason || 'toggle'));
    if (CONFIG.enabled) {
      scanFullPage();
      if (isYouTube()) {
        scanYouTubeThumbnails();
      }
    }
    postToHost({
      type: 'MW_SENSITIVITY_UPDATE',
      level: normalized,
      reason: reason || 'overlay_toggle',
      timestamp: Date.now(),
    });
  }

  function sendBlurReady(reason) {
    if (!DOM_OVERLAY_ENABLED) return;
    postToHost({
      type: 'MW_BLUR_READY',
      reason: reason || 'ready',
      url: window.location.href,
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

    return false;
  }

  if (DOM_OVERLAY_ENABLED && !window.__MW_BLUR_LISTENER__) {
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
      state.revealed.delete(target.src);
      element.dataset.mwRevealed = 'false';
      clearSafeResolved(target.src);
      applyBlur(element, target.src, target.normalizedCategory || target.predictedLabel || 'flagged', CLAMPED_BLUR_STRENGTH, target.itemId);
      return;
    }
    if (action === 'false_positive') {
      markSafeResolved(target.src);
      removeBlur(element, target.src);
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
    youtubeMutationScanTimeout: null,
    debugSummaryInterval: null,
    diagHeartbeatInterval: null,
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
    '#shorts-player ytm-reel-video-renderer[aria-hidden="false"]',
    '#shorts-player ytm-reel-video-renderer[selected]',
    '#shorts-player ytm-reel-video-renderer[is-active]',
    '#shorts-player ytm-reel-video-renderer',
    '#shorts-player',
  ];
  const SHORTS_STABLE_CONTAINER_TAG_SELECTOR = 'ytm-reel-video-renderer, ytm-shorts-lockup-view-model, #shorts-player';
  const SHORTS_SWAP_REATTACH_WINDOW_MS = 2600;
  let shortsBlurContextByContainer = new WeakMap();
  let lastActiveShortsContainer = null;
  let lastShortsUrlId = '';
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

  function isShortsModeActive() {
    return isMobileYouTubeShortsUrl(window.location.href);
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

  function getShortsCardOrPlayerContainerFromNode(node) {
    if (!isShortsModeActive()) return null;
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
    if (!isShortsModeActive()) return null;
    for (let i = 0; i < SHORTS_STABLE_CONTAINER_SELECTORS.length; i += 1) {
      const found = document.querySelector(SHORTS_STABLE_CONTAINER_SELECTORS[i]);
      if (found && found.isConnected) return found;
    }
    const fallbackVideo = document.querySelector('#shorts-player video, ytm-reel-video-renderer video, video');
    if (fallbackVideo && fallbackVideo.isConnected) {
      const fallbackContainer = getShortsCardOrPlayerContainerFromNode(fallbackVideo);
      return fallbackContainer || fallbackVideo;
    }
    return null;
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

  function doesShortsContainerMatchContext(container, normalizedSrc) {
    if (!container || container.nodeType !== 1) return false;
    const context = shortsBlurContextByContainer.get(container);
    if (!context || !context.src) return false;
    if (!normalizedSrc) return true;
    const contextSrc = normalizeUrl(context.src || '');
    if (contextSrc && contextSrc === normalizedSrc) return true;
    const contextTarget = context.targetNode && context.targetNode.nodeType === 1 ? context.targetNode : null;
    if (!contextTarget || !contextTarget.dataset) return false;
    const targetSrc = normalizeUrl(contextTarget.dataset.mwSrc || '');
    const targetOrigSrc = normalizeUrl(contextTarget.dataset.mwOrigSrc || '');
    const targetOrigPoster = normalizeUrl(contextTarget.dataset.mwOrigPoster || '');
    return (
      targetSrc === normalizedSrc ||
      targetOrigSrc === normalizedSrc ||
      targetOrigPoster === normalizedSrc
    );
  }

  function shortsContainerMatchesSrcOrContext(container, normalizedSrc) {
    return (
      doesShortsContainerMatchSrc(container, normalizedSrc) ||
      doesShortsContainerMatchContext(container, normalizedSrc)
    );
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
        if (closest && closest.isConnected && shortsContainerMatchesSrcOrContext(closest, normalizedSrc)) {
          return { target: closest, selectorUsed: 'closest:' + selector };
        }
      }
      const walked = findStableShortsContainerByParentWalk(node);
      if (walked.target && shortsContainerMatchesSrcOrContext(walked.target, normalizedSrc)) {
        return walked;
      }
    }
    const baseline = node ? diagNodeParentAtBlur.get(node) : null;
    const baselineParent = baseline && baseline.parent ? baseline.parent : null;
    if (baselineParent && baselineParent.nodeType === 1 && typeof baselineParent.closest === 'function') {
      for (let i = 0; i < SHORTS_STABLE_CONTAINER_SELECTORS.length; i += 1) {
        const selector = SHORTS_STABLE_CONTAINER_SELECTORS[i];
        const closest = baselineParent.closest(selector);
        if (closest && closest.isConnected && shortsContainerMatchesSrcOrContext(closest, normalizedSrc)) {
          return { target: closest, selectorUsed: 'baseline_closest:' + selector };
        }
      }
      const walkedBaseline = findStableShortsContainerByParentWalk(baselineParent);
      if (walkedBaseline.target && shortsContainerMatchesSrcOrContext(walkedBaseline.target, normalizedSrc)) {
        return walkedBaseline;
      }
    }
    if (node && node.nodeType === 1 && node.isConnected) {
      for (let i = 0; i < SHORTS_STABLE_CONTAINER_SELECTORS.length; i += 1) {
        const selector = SHORTS_STABLE_CONTAINER_SELECTORS[i];
        const found = document.querySelector(selector);
        if (found && found.isConnected && shortsContainerMatchesSrcOrContext(found, normalizedSrc)) {
          return { target: found, selectorUsed: 'query:' + selector };
        }
      }
      const activeContainer = getActiveShortsPlayerContainer();
      if (activeContainer && activeContainer.isConnected && shortsContainerMatchesSrcOrContext(activeContainer, normalizedSrc)) {
        return { target: activeContainer, selectorUsed: 'active_container' };
      }
      const localContainer = getShortsCardOrPlayerContainerFromNode(node);
      if (localContainer && localContainer.isConnected && shortsContainerMatchesSrcOrContext(localContainer, normalizedSrc)) {
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

  function getShortsStableEntityNode(node, src) {
    if (!isShortsModeActive()) return null;
    const stableResolution = resolveShortsStableBlurTarget(
      node,
      src || (node && node.dataset ? node.dataset.mwSrc || '' : '')
    );
    const stableTarget = stableResolution && stableResolution.target ? stableResolution.target : null;
    if (stableTarget && stableTarget.nodeType === 1 && stableTarget.isConnected) return stableTarget;
    const contextContainer = getShortsBlurContextContainerForNode(node);
    if (contextContainer && contextContainer.nodeType === 1) return contextContainer;
    return node && node.nodeType === 1 ? node : null;
  }

  function getShortsStableEntityKey(node, src) {
    if (!isShortsModeActive()) return '';
    const entityNode = getShortsStableEntityNode(node, src);
    if (!entityNode) return '';
    const shortsUrlId = getCurrentShortsUrlId() || 'none';
    return 'shorts:' + shortsUrlId + '|node:' + getDiagNodeId(entityNode);
  }

  function getShortsRevealOverlayKey(node, src) {
    if (!isShortsModeActive()) return '';
    const normalizedSrc = normalizeUrl(src || (node && node.dataset ? node.dataset.mwSrc || '' : '')) || '';
    const entityKey = getShortsStableEntityKey(node, normalizedSrc);
    if (!entityKey || !normalizedSrc) return '';
    return 'nav:' + NAV_ID + '|entity:' + entityKey + '|src:' + normalizedSrc;
  }

  function setShortsBlurContextForNode(node, src, category, itemId, blurPx, selectorUsed, reason) {
    if (!isShortsModeActive()) return;
    const container = getShortsBlurContextContainerForNode(node);
    if (!container || container.nodeType !== 1) return;
    const existing = shortsBlurContextByContainer.get(container) || {};
    const updatedAt = Date.now();
    const entityKey = getShortsStableEntityKey(container, src || (node && node.dataset ? node.dataset.mwSrc || '' : ''));
    const context = {
      src: src || '',
      category: category || 'flagged',
      itemId: itemId || '',
      blurPx: Number.isFinite(blurPx) ? blurPx : (CONFIG.blurStrength || 30),
      selectorUsed: selectorUsed || '',
      entityKey: entityKey || '',
      targetNode: node || null,
      targetTagName: String(node && node.tagName ? node.tagName : ''),
      targetNodeId: getDiagNodeId(node),
      updatedAt: updatedAt,
      shortsUrlId: getCurrentShortsUrlId(),
      lastReattachAt: existing.lastReattachAt || 0,
      lastReattachVideoId: existing.lastReattachVideoId || '',
    };
    shortsBlurContextByContainer.set(container, context);
    if (node && node.dataset) {
      node.dataset.mwShortsEntityKey = context.entityKey || '';
    }
    if (container && container.dataset) {
      container.dataset.mwShortsEntityKey = context.entityKey || '';
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
        ' selectorUsed=' + (selectorUsed || 'none') +
        ' entityKey=' + (context.entityKey || 'none') +
        ' shortsUrlId=' + (context.shortsUrlId || 'none')
      );
    }
  }

  function clearShortsBlurContextForNode(node, reason) {
    if (!isShortsModeActive()) return;
    const container = getShortsBlurContextContainerForNode(node);
    if (!container || container.nodeType !== 1) return;
    const existing = shortsBlurContextByContainer.get(container);
    if (!existing) return;
    shortsBlurContextByContainer.delete(container);
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
    shortsBlurContextByContainer = new WeakMap();
    if (DIAG_YT_BLUR) {
      diagShortsTimeline(
        'shorts_blur_context_reset',
        'reason=' + (reason || 'unknown') +
        ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
      );
    }
  }

  function collectBlurredShortsSrcsForContainer(container) {
    const srcMap = {};
    if (!container || container.nodeType !== 1) return srcMap;
    const candidates = [container];
    if (typeof container.querySelectorAll === 'function') {
      container.querySelectorAll('[data-mw-moderated="blurred"], .mw-blurred').forEach(function(node) {
        candidates.push(node);
      });
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const node = candidates[i];
      if (!node || node.nodeType !== 1) continue;
      if (node.dataset && node.dataset.mwRevealed === 'true') continue;
      const source = getDiagSourceFields(node);
      const src = normalizeUrl(
        (node.dataset && (node.dataset.mwSrc || node.dataset.mwOrigSrc || node.dataset.mwOrigPoster)) ||
        source.poster ||
        source.currentSrc ||
        ''
      ) || '';
      if (src) {
        srcMap[src] = true;
      }
    }
    return srcMap;
  }

  function collectBlurredShortsOverlayKeysForContainer(container) {
    const keyMap = {};
    if (!container || container.nodeType !== 1) return keyMap;
    const candidates = [container];
    if (typeof container.querySelectorAll === 'function') {
      container.querySelectorAll('[data-mw-moderated="blurred"], .mw-blurred').forEach(function(node) {
        candidates.push(node);
      });
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const node = candidates[i];
      if (!node || node.nodeType !== 1) continue;
      if (node.dataset && node.dataset.mwRevealed === 'true') continue;
      const source = getDiagSourceFields(node);
      const src = normalizeUrl(
        (node.dataset && (node.dataset.mwSrc || node.dataset.mwOrigSrc || node.dataset.mwOrigPoster)) ||
        source.poster ||
        source.currentSrc ||
        ''
      ) || '';
      const overlayKey = getShortsRevealOverlayKey(node, src);
      if (overlayKey) {
        keyMap[overlayKey] = true;
      }
    }
    return keyMap;
  }

  function clearShortsContainerBlurArtifacts(container, reason) {
    if (!container || container.nodeType !== 1) return 0;
    const candidates = [container];
    if (typeof container.querySelectorAll === 'function') {
      container.querySelectorAll('[data-mw-src], [data-mw-moderated], .mw-blurred, .mw-softblur').forEach(function(node) {
        candidates.push(node);
      });
    }
    let clearedCount = 0;
    for (let i = 0; i < candidates.length; i += 1) {
      const node = candidates[i];
      if (!node || node.nodeType !== 1) continue;
      const hasMwState = !!(
        (node.dataset && (node.dataset.mwSrc || node.dataset.mwModerated || node.dataset.mwHasOverlay === 'true')) ||
        (node.classList && (node.classList.contains('mw-blurred') || node.classList.contains('mw-softblur')))
      );
      if (!hasMwState) continue;
      const source = getDiagSourceFields(node);
      const srcForClear = normalizeUrl(
        (node.dataset && (node.dataset.mwSrc || node.dataset.mwOrigSrc || node.dataset.mwOrigPoster)) ||
        source.poster ||
        source.currentSrc ||
        ''
      ) || '';
      const changed = clearAllBlurAndOverlay(node, srcForClear, reason || 'shorts_transition_cleanup', 'safe');
      if (node.dataset) {
        node.dataset.mwHasOverlay = 'false';
        node.dataset.mwModerated = 'safe';
        node.dataset.mwSrc = '';
        node.dataset.mwItemId = '';
        node.dataset.mwCategory = '';
        node.dataset.mwShortsStableSelector = '';
        node.dataset.mwShortsEntityKey = '';
      }
      if (changed) clearedCount += 1;
    }
    return clearedCount;
  }

  function cleanupShortsRevealCarryover(reason, forceRun) {
    const activeShortsMode = isShortsModeActive();
    const activeContainer = activeShortsMode ? getActiveShortsPlayerContainer() : null;
    const previousContainer = lastActiveShortsContainer;
    const currentShortsUrlId = activeShortsMode ? getCurrentShortsUrlId() : '';
    const previousShortsUrlId = lastShortsUrlId;
    if (!forceRun && !activeShortsMode) {
      lastActiveShortsContainer = null;
      lastShortsUrlId = '';
      return;
    }
    const activeChanged = !!(previousContainer && activeContainer && previousContainer !== activeContainer);
    const shortsUrlChanged = !!(previousShortsUrlId && currentShortsUrlId && previousShortsUrlId !== currentShortsUrlId);
    const shouldTransitionCleanup = !!(forceRun || activeChanged || shortsUrlChanged);
    if (!shouldTransitionCleanup) {
      if (activeContainer) lastActiveShortsContainer = activeContainer;
      if (currentShortsUrlId) lastShortsUrlId = currentShortsUrlId;
    }

    let clearedNodes = 0;
    if (shouldTransitionCleanup && previousContainer && previousContainer !== activeContainer) {
      clearedNodes = clearShortsContainerBlurArtifacts(
        previousContainer,
        'shorts_transition_cleanup:' + (reason || 'unknown')
      );
    }

    const keepSrcMap = collectBlurredShortsSrcsForContainer(activeContainer);
    const keepOverlayKeyMap = collectBlurredShortsOverlayKeysForContainer(activeContainer);
    let removedOverlays = 0;
    const portal = document.getElementById(REVEAL_PORTAL_ID);
    if (portal && typeof portal.querySelectorAll === 'function') {
      const overlays = portal.querySelectorAll('.mw-reveal-overlay');
      for (let i = 0; i < overlays.length; i += 1) {
        const overlay = overlays[i];
        if (!overlay || overlay.nodeType !== 1) continue;
        const overlayNavId = overlay.dataset && overlay.dataset.mwNavId ? overlay.dataset.mwNavId : '';
        const overlayShortsUrlId = overlay.dataset && overlay.dataset.mwShortsUrlId ? overlay.dataset.mwShortsUrlId : '';
        const overlayKey = overlay.dataset && overlay.dataset.mwOverlayKey ? overlay.dataset.mwOverlayKey : '';
        const overlaySrc = normalizeUrl(
          overlay.dataset && overlay.dataset.mwFor ? overlay.dataset.mwFor : ''
        ) || '';
        const overlayTarget = overlay.__mwTargetNode && overlay.__mwTargetNode.nodeType === 1 ? overlay.__mwTargetNode : null;
        const overlayTargetBlurred = !!(
          overlayTarget &&
          overlayTarget.isConnected &&
          (
            (overlayTarget.dataset && overlayTarget.dataset.mwModerated === 'blurred') ||
            (overlayTarget.classList && overlayTarget.classList.contains('mw-blurred'))
          )
        );
        const navMismatch = !!(overlayNavId && overlayNavId !== String(NAV_ID));
        const shortsUrlMismatch = !!(
          currentShortsUrlId &&
          overlayShortsUrlId &&
          overlayShortsUrlId !== currentShortsUrlId
        );
        const disconnectedTarget = !!(overlayTarget && !overlayTarget.isConnected);
        const nonBlurredTarget = !!(overlayTarget && overlayTarget.isConnected && !overlayTargetBlurred);
        const keepByOverlayKey = !!(overlayKey && keepOverlayKeyMap[overlayKey]);
        const keepBySrc = !!(overlaySrc && keepSrcMap[overlaySrc]);
        if (!navMismatch && !shortsUrlMismatch && !disconnectedTarget && !nonBlurredTarget && (keepByOverlayKey || (!overlayKey && keepBySrc))) {
          continue;
        }
        let teardownReason = 'shorts_transition_cleanup:' + (reason || 'unknown');
        if (navMismatch) teardownReason = 'nav_change';
        else if (shortsUrlMismatch) teardownReason = 'shorts_url_change';
        else if (disconnectedTarget) teardownReason = 'target_disconnected';
        else if (nonBlurredTarget) teardownReason = 'target_not_blurred';
        else if (overlayKey && !keepByOverlayKey) teardownReason = 'overlay_key_not_active';
        else if (overlaySrc && !keepBySrc) teardownReason = 'src_not_active';
        const overlayId = overlay.dataset && overlay.dataset.mwOverlayId ? overlay.dataset.mwOverlayId : 'unknown';
        if (overlay.parentElement) {
          overlay.parentElement.removeChild(overlay);
          removedOverlays += 1;
          console.log(
            '[DIAG][REVEAL_UI] overlay_removed',
            'overlayId=' + overlayId,
            'reason=' + teardownReason,
            'overlayKey=' + (overlayKey || 'none'),
            'node=' + (overlay.dataset && overlay.dataset.mwNodeId ? overlay.dataset.mwNodeId : 'n/a')
          );
          if (DIAG_YT_BLUR) {
            diagShortsTimeline(
              'overlay_teardown',
              'reason=' + teardownReason +
              ' overlayId=' + overlayId +
              ' overlayKey=' + (overlayKey || 'none') +
              ' navId=' + NAV_ID +
              ' shortsUrlId=' + (currentShortsUrlId || 'none') +
              ' nodeId=' + (overlay.dataset && overlay.dataset.mwNodeId ? overlay.dataset.mwNodeId : 'n/a') +
              ' src=' + String(overlaySrc || '').substring(0, 180)
            );
          }
        }
      }
    }

    console.log(
      '[DIAG][REVEAL_UI] transition_cleanup',
      'reason=' + (reason || 'unknown'),
      'navId=' + NAV_ID,
      'shortKey=' + (currentShortsUrlId || 'none'),
      'activeContainer=' + getDiagNodeId(activeContainer),
      'previousContainer=' + getDiagNodeId(previousContainer),
      'clearedNodes=' + clearedNodes,
      'removedOverlays=' + removedOverlays
    );

    lastActiveShortsContainer = activeContainer || null;
    lastShortsUrlId = currentShortsUrlId || '';
  }

  function diagShortsSwapMarker(videoNode, reason, immediateAttempted, immediateApplied, deferredReason, extras) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    const resolvedVideoNode = extras && extras.resolvedVideoNode && extras.resolvedVideoNode.nodeType === 1
      ? extras.resolvedVideoNode
      : null;
    const effectiveNode = resolvedVideoNode || (videoNode && videoNode.nodeType === 1 ? videoNode : null);
    const container = (
      extras && extras.contextContainer && extras.contextContainer.nodeType === 1
        ? extras.contextContainer
        : getShortsBlurContextContainerForNode(effectiveNode)
    );
    const context = container ? shortsBlurContextByContainer.get(container) : null;
    const blurredNode = context && context.targetNode && context.targetNode.nodeType === 1 ? context.targetNode : null;
    const computed = getDiagComputedBlurState(effectiveNode);
    const source = getDiagSourceFields(effectiveNode);
    const visible = (
      computed.display !== 'none' &&
      computed.visibility !== 'hidden' &&
      computed.opacity !== '0'
    );
    const skippedAlreadyBlurred = !!(extras && extras.skippedAlreadyBlurred);
    const resolvedSelectorUsed = extras && extras.resolvedSelectorUsed ? extras.resolvedSelectorUsed : 'none';
    console.log(
      '[DIAG][SHORTS_SWAP]',
      'reason=' + (reason || 'unknown'),
      'videoNodeId=' + getDiagNodeId(effectiveNode),
      'videoTag=' + String(effectiveNode && effectiveNode.tagName ? effectiveNode.tagName : 'unknown'),
      'videoVisible=' + visible,
      'videoConnected=' + (!!(effectiveNode && effectiveNode.isConnected)),
      'videoClass=' + String(getDiagClassList(effectiveNode) || '').substring(0, 140),
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
      'resolvedVideoNodeId=' + getDiagNodeId(resolvedVideoNode),
      'resolvedVideoTagName=' + String(resolvedVideoNode && resolvedVideoNode.tagName ? resolvedVideoNode.tagName : 'none'),
      'resolvedSelectorUsed=' + resolvedSelectorUsed,
      'skippedAlreadyBlurred=' + skippedAlreadyBlurred,
      'deferredReason=' + (deferredReason || 'none')
    );
  }

  function isShortsSwapVisibleNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const computed = getDiagComputedBlurState(node);
    if (
      computed.display === 'none' ||
      computed.visibility === 'hidden' ||
      computed.opacity === '0'
    ) {
      return false;
    }
    try {
      if (typeof node.getBoundingClientRect === 'function') {
        const rect = node.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      }
    } catch (e) {}
    return true;
  }

  function resolveVideoNodeWithinShortsContainer(container, selectorPrefix) {
    const base = selectorPrefix || 'container';
    if (
      !container ||
      container.nodeType !== 1 ||
      !container.isConnected ||
      typeof container.querySelector !== 'function'
    ) {
      return { videoNode: null, selectorUsed: base + ':none' };
    }
    const html5MainVideo = container.querySelector('video.html5-main-video');
    if (html5MainVideo && html5MainVideo.nodeType === 1 && html5MainVideo.isConnected) {
      return { videoNode: html5MainVideo, selectorUsed: base + ':video.html5-main-video' };
    }
    if (typeof container.querySelectorAll !== 'function') {
      return { videoNode: null, selectorUsed: base + ':video:none' };
    }
    const videos = container.querySelectorAll('video');
    let firstConnected = null;
    for (let i = 0; i < videos.length; i += 1) {
      const video = videos[i];
      if (!video || video.nodeType !== 1 || !video.isConnected) continue;
      if (!firstConnected) firstConnected = video;
      if (isShortsSwapVisibleNode(video)) {
        return { videoNode: video, selectorUsed: base + ':video:first_visible' };
      }
    }
    if (firstConnected) {
      return { videoNode: firstConnected, selectorUsed: base + ':video:first_connected' };
    }
    return { videoNode: null, selectorUsed: base + ':video:none' };
  }

  function resolveShortsSwapReattachTarget(node) {
    const unresolved = {
      videoNode: null,
      contextContainer: null,
      context: null,
      selectorUsed: 'none',
    };
    if (!isShortsModeActive() || !node || node.nodeType !== 1) return unresolved;
    const candidates = [];
    function pushCandidate(container, label) {
      if (!container || container.nodeType !== 1 || !container.isConnected) return;
      for (let i = 0; i < candidates.length; i += 1) {
        if (candidates[i].container === container) return;
      }
      candidates.push({ container: container, label: label });
    }
    const activeContainer = getActiveShortsPlayerContainer();
    if (activeContainer) {
      pushCandidate(
        activeContainer,
        isShortsSwapVisibleNode(activeContainer) ? 'active_visible_reel' : 'active_reel'
      );
    }
    const localContainer = getShortsCardOrPlayerContainerFromNode(node);
    if (localContainer) {
      pushCandidate(localContainer, 'mutation_local_container');
    }
    if (String(node.tagName || '').toUpperCase() === 'YTM-REEL-VIDEO-RENDERER') {
      pushCandidate(node, 'mutation_reel_renderer');
    }
    let fallbackContextResult = null;
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const context = shortsBlurContextByContainer.get(candidate.container);
      if (!context || !context.src) continue;
      const resolvedVideo = resolveVideoNodeWithinShortsContainer(candidate.container, candidate.label);
      if (!resolvedVideo.videoNode) {
        if (!fallbackContextResult) {
          fallbackContextResult = {
            videoNode: null,
            contextContainer: candidate.container,
            context: context,
            selectorUsed: resolvedVideo.selectorUsed || (candidate.label + ':video:none'),
          };
        }
        continue;
      }
      return {
        videoNode: resolvedVideo.videoNode,
        contextContainer: candidate.container,
        context: context,
        selectorUsed: resolvedVideo.selectorUsed || (candidate.label + ':video:none'),
      };
    }
    if (String(node.tagName || '').toUpperCase() === 'VIDEO') {
      const directContainer = getShortsBlurContextContainerForNode(node);
      const directContext = directContainer ? shortsBlurContextByContainer.get(directContainer) : null;
      if (directContainer && directContext && directContext.src) {
        return {
          videoNode: node,
          contextContainer: directContainer,
          context: directContext,
          selectorUsed: 'mutation_target:video',
        };
      }
    }
    if (fallbackContextResult) {
      return fallbackContextResult;
    }
    return unresolved;
  }

  function maybeReattachShortsBlurForVideoNode(node, reason, relatedBlurNodeId) {
    if (!isShortsModeActive()) return false;
    if (!node || node.nodeType !== 1) return false;
    const resolved = resolveShortsSwapReattachTarget(node);
    const videoNode = resolved.videoNode;
    const container = resolved.contextContainer;
    const context = resolved.context;
    const selectorUsed = resolved.selectorUsed || 'none';
    if (!container || !context || !context.src) {
      diagShortsSwapMarker(
        node,
        reason || 'unknown',
        false,
        false,
        'missing_context',
        {
          resolvedVideoNode: videoNode,
          contextContainer: container,
          resolvedSelectorUsed: selectorUsed,
          skippedAlreadyBlurred: false,
        }
      );
      return false;
    }
    if (!videoNode || videoNode.nodeType !== 1 || String(videoNode.tagName || '').toUpperCase() !== 'VIDEO') {
      diagShortsSwapMarker(
        node,
        reason || 'unknown',
        true,
        false,
        'resolved_video_missing',
        {
          resolvedVideoNode: videoNode,
          contextContainer: container,
          resolvedSelectorUsed: selectorUsed,
          skippedAlreadyBlurred: false,
        }
      );
      return false;
    }
    const blurredNode = context.targetNode && context.targetNode.nodeType === 1 ? context.targetNode : null;
    const blurredNodeConnected = !!(blurredNode && blurredNode.isConnected);
    if (blurredNodeConnected && blurredNode === videoNode) {
      diagShortsSwapMarker(
        videoNode,
        reason || 'unknown',
        true,
        false,
        'already_blurred_target',
        {
          resolvedVideoNode: videoNode,
          contextContainer: container,
          resolvedSelectorUsed: selectorUsed,
          skippedAlreadyBlurred: true,
        }
      );
      if (DIAG_YT_BLUR) {
        diagShortsTimeline(
          'shorts_swap_reattach_skip',
          'reason=already_blurred_target' +
          ' containerNodeId=' + getDiagNodeId(container) +
          ' nodeId=' + getDiagNodeId(videoNode) +
          ' selector=' + selectorUsed
        );
      }
      return false;
    }
    if (state.revealed.has(context.src) || videoNode.dataset.mwRevealed === 'true') {
      diagShortsSwapMarker(
        videoNode,
        reason || 'unknown',
        true,
        false,
        'revealed',
        {
          resolvedVideoNode: videoNode,
          contextContainer: container,
          resolvedSelectorUsed: selectorUsed,
          skippedAlreadyBlurred: false,
        }
      );
      return false;
    }
    const now = Date.now();
    if (context.updatedAt && (now - context.updatedAt) > SHORTS_SWAP_REATTACH_WINDOW_MS) {
      shortsBlurContextByContainer.delete(container);
      diagShortsSwapMarker(
        videoNode,
        reason || 'unknown',
        true,
        false,
        'stale_context',
        {
          resolvedVideoNode: videoNode,
          contextContainer: container,
          resolvedSelectorUsed: selectorUsed,
          skippedAlreadyBlurred: false,
        }
      );
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
      shortsBlurContextByContainer.delete(container);
      diagShortsSwapMarker(
        videoNode,
        reason || 'unknown',
        true,
        false,
        'shorts_url_changed',
        {
          resolvedVideoNode: videoNode,
          contextContainer: container,
          resolvedSelectorUsed: selectorUsed,
          skippedAlreadyBlurred: false,
        }
      );
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
    const targetTagName = String(context.targetTagName || '').toUpperCase();
    const containerTagName = String(container && container.tagName ? container.tagName : '').toUpperCase();
    const targetSupportsSwapReattach =
      targetTagName === 'IMG' ||
      targetTagName === 'VIDEO' ||
      containerTagName === 'YTM-REEL-VIDEO-RENDERER' ||
      containerTagName === 'YTM-SHORTS-LOCKUP-VIEW-MODEL' ||
      (container && container.id === 'shorts-player');
    if (!targetSupportsSwapReattach) {
      diagShortsSwapMarker(
        videoNode,
        reason || 'unknown',
        true,
        false,
        'target_not_supported',
        {
          resolvedVideoNode: videoNode,
          contextContainer: container,
          resolvedSelectorUsed: selectorUsed,
          skippedAlreadyBlurred: false,
        }
      );
      if (DIAG_YT_BLUR) {
        diagShortsTimeline(
          'shorts_swap_reattach_skip',
          'reason=target_not_supported' +
          ' containerNodeId=' + getDiagNodeId(container) +
          ' targetTagName=' + (context.targetTagName || 'none') +
          ' containerTagName=' + (containerTagName || 'none') +
          ' targetNodeId=' + (context.targetNodeId || 'none')
        );
      }
      return false;
    }
    const videoNodeId = getDiagNodeId(videoNode);
    if (context.lastReattachVideoId === videoNodeId && (now - (context.lastReattachAt || 0)) < 400) {
      diagShortsSwapMarker(
        videoNode,
        reason || 'unknown',
        true,
        false,
        'duplicate_video_window',
        {
          resolvedVideoNode: videoNode,
          contextContainer: container,
          resolvedSelectorUsed: selectorUsed,
          skippedAlreadyBlurred: false,
        }
      );
      return false;
    }
    const inlineFilter = String(videoNode.style.getPropertyValue('filter') || videoNode.style.filter || '').toLowerCase();
    const inlineBackdrop = String(videoNode.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
    if (
      videoNode.dataset.mwModerated === 'blurred' &&
      (inlineFilter.includes('blur(') || inlineBackdrop.includes('blur('))
    ) {
      diagShortsSwapMarker(
        videoNode,
        reason || 'unknown',
        true,
        false,
        'video_already_blurred',
        {
          resolvedVideoNode: videoNode,
          contextContainer: container,
          resolvedSelectorUsed: selectorUsed,
          skippedAlreadyBlurred: true,
        }
      );
      return false;
    }
    diagShortsSwapMarker(
      videoNode,
      reason || 'unknown',
      true,
      true,
      '',
      {
        resolvedVideoNode: videoNode,
        contextContainer: container,
        resolvedSelectorUsed: selectorUsed,
        skippedAlreadyBlurred: false,
      }
    );
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
        ' selectorUsed=' + selectorUsed +
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
        ' selectorUsed=' + selectorUsed +
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

  function attemptImmediateShortsSwapReattach(node, reason, relatedBlurNodeId, reasonDetail) {
    if (!isShortsModeActive() || !node || node.nodeType !== 1) return false;
    let immediateAttempted = false;
    let immediateApplied = false;
    let deferredReason = 'none';
    if (reason === 'insert') {
      immediateAttempted = true;
      immediateApplied = reattachShortsBlurForInsertedNode(node, 'immediate_insert', relatedBlurNodeId || null);
      if (!immediateApplied) deferredReason = 'no_insert_video_context';
    } else {
      immediateAttempted = true;
      immediateApplied = maybeReattachShortsBlurForVideoNode(node, 'immediate_' + (reason || 'unknown'), relatedBlurNodeId || null);
      if (!immediateApplied) {
        const container = getShortsCardOrPlayerContainerFromNode(node) || getActiveShortsPlayerContainer();
        const resolved = resolveVideoNodeWithinShortsContainer(container, 'immediate_' + (reason || 'unknown'));
        const fallbackVideo = resolved && resolved.videoNode ? resolved.videoNode : null;
        if (fallbackVideo) {
          immediateApplied = maybeReattachShortsBlurForVideoNode(
            fallbackVideo,
            'immediate_' + (reason || 'unknown') + ':container',
            relatedBlurNodeId || null
          );
        } else {
          deferredReason = 'no_video_node';
        }
      }
      if (!immediateApplied && deferredReason === 'none') {
        deferredReason = 'no_context_or_target';
      }
    }
    if (DIAG_YT_BLUR) {
      diagShortsTimeline(
        'shorts_swap_immediate',
        'reason=' + (reason || 'unknown') +
        ' detail=' + (reasonDetail || 'none') +
        ' triggerNodeId=' + getDiagNodeId(node) +
        ' triggerTagName=' + String(node.tagName || 'unknown') +
        ' relatedBlurNodeId=' + (relatedBlurNodeId || 'none') +
        ' immediateAttempted=' + immediateAttempted +
        ' immediateApplied=' + immediateApplied +
        ' deferredReason=' + (immediateApplied ? 'none' : deferredReason)
      );
    }
    return immediateApplied;
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

  function diagScheduleBlurredNodePresenceChecks(node, src, itemId) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    if (!node || node.nodeType !== 1) return;
    const nodeId = getDiagNodeId(node);
    [1000, 2000].forEach(function(delayMs) {
      setTimeout(function() {
        const connected = !!(node && node.isConnected);
        const nodeComputed = getDiagComputedBlurState(node);
        let parentNode = null;
        let replacementVideo = null;
        if (node && node.parentElement && node.parentElement.nodeType === 1) {
          parentNode = node.parentElement;
          if (typeof parentNode.querySelector === 'function') {
            replacementVideo = parentNode.querySelector('video.html5-main-video, video');
          }
        }
        const replacementId = replacementVideo ? getDiagNodeId(replacementVideo) : 'none';
        const replacementHtml5Main = !!(replacementVideo && isHtml5MainVideoNode(replacementVideo));
        const replacementBlurred = !!(replacementVideo && isDiagBlurActiveOnNode(replacementVideo));
        const replacementComputed = getDiagComputedBlurState(replacementVideo);
        diagShortsTimeline(
          'blurred_node_presence_check',
          'delayMs=' + delayMs +
          ' nodeId=' + nodeId +
          ' nodeTagName=' + String(node && node.tagName ? node.tagName : 'none') +
          ' connected=' + connected +
          ' nodeComputedFilter=' + String(nodeComputed.filter || '').substring(0, 120) +
          ' nodeComputedBackdrop=' + String(nodeComputed.backdropFilter || '').substring(0, 120) +
          ' parentNodeId=' + (parentNode ? getDiagNodeId(parentNode) : 'none') +
          ' replacementVideoNodeId=' + replacementId +
          ' replacementTagName=' + String(replacementVideo && replacementVideo.tagName ? replacementVideo.tagName : 'none') +
          ' replacementComputedFilter=' + String(replacementComputed.filter || '').substring(0, 120) +
          ' replacementComputedBackdrop=' + String(replacementComputed.backdropFilter || '').substring(0, 120) +
          ' replacementVideoHtml5Main=' + replacementHtml5Main +
          ' replacementVideoBlurred=' + replacementBlurred +
          ' src=' + String(src || '').substring(0, 180) +
          ' itemId=' + (itemId || 'none')
        );
        if (
          connected &&
          node &&
          node.dataset &&
          node.dataset.mwModerated === 'blurred' &&
          String(nodeComputed.filter || '').toLowerCase().indexOf('blur(') === -1 &&
          String(nodeComputed.backdropFilter || '').toLowerCase().indexOf('blur(') === -1
        ) {
          diagShortsTimeline(
            'blur_style_missing',
            'nodeId=' + nodeId +
            ' nodeTagName=' + String(node.tagName || 'unknown') +
            ' nodeComputedFilter=' + String(nodeComputed.filter || '').substring(0, 120) +
            ' nodeComputedBackdrop=' + String(nodeComputed.backdropFilter || '').substring(0, 120) +
            ' src=' + String(src || '').substring(0, 180) +
            ' itemId=' + (itemId || 'none')
          );
        }
      }, delayMs);
    });
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
          ' wasConnected=true' +
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
      ' stableSelectorUsed=' + (selectorUsed || (node.dataset && node.dataset.mwShortsStableSelector) || 'self') +
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
    diagScheduleBlurredNodePresenceChecks(node, src, itemId);
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

  function positionShortsRevealOverlay(overlay, element) {
    if (!overlay || !element || typeof element.getBoundingClientRect !== 'function') return;
    let rect = null;
    try {
      rect = element.getBoundingClientRect();
    } catch (e) {
      rect = null;
    }
    if (!rect) return;
    const badge = overlay.querySelector('span');
    const btn = overlay.querySelector('.mw-reveal-btn');
    const viewportWidth = Math.max(window.innerWidth || 0, 1);
    const viewportHeight = Math.max(window.innerHeight || 0, 1);
    const centerX = Math.max(24, Math.min(viewportWidth - 24, Math.round(rect.left + (rect.width / 2))));
    const centerY = Math.max(28, Math.min(viewportHeight - 28, Math.round(rect.top + (rect.height / 2))));
    if (badge && badge.nodeType === 1) {
      badge.style.position = 'absolute';
      badge.style.left = Math.max(8, Math.min(viewportWidth - 100, Math.round(rect.left + 8))) + 'px';
      badge.style.top = Math.max(8, Math.min(viewportHeight - 28, Math.round(rect.top + 8))) + 'px';
    }
    if (btn && btn.nodeType === 1) {
      btn.style.position = 'absolute';
      btn.style.left = centerX + 'px';
      btn.style.top = centerY + 'px';
      btn.style.transform = 'translate(-50%, -50%)';
    }
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

  function diagShortsOverlayLifecycle(eventName, overlay, reason, node, src, extra) {
    if (!DIAG_YT_BLUR || !isShortsModeActive()) return;
    const overlayId = overlay && overlay.dataset ? (overlay.dataset.mwOverlayId || 'unknown') : 'unknown';
    const overlayKey = overlay && overlay.dataset ? (overlay.dataset.mwOverlayKey || 'none') : 'none';
    const entityKey = overlay && overlay.dataset ? (overlay.dataset.mwShortsEntityKey || 'none') : 'none';
    diagShortsTimeline(
      eventName,
      'reason=' + (reason || 'unknown') +
      ' overlayId=' + overlayId +
      ' overlayKey=' + overlayKey +
      ' entityKey=' + entityKey +
      ' navId=' + NAV_ID +
      ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none') +
      ' nodeId=' + getDiagNodeId(node) +
      ' src=' + String(src || '').substring(0, 180) +
      (extra ? ' ' + extra : '')
    );
  }

  function findRevealOverlayForElement(node, src) {
    if (!node || node.nodeType !== 1) return null;
    const nodeId = getDiagNodeId(node);
    const shortsMode = isShortsModeActive();
    const normalizedSrc = normalizeUrl(src || (node.dataset ? node.dataset.mwSrc || '' : '')) || '';
    const shortsEntityKey = shortsMode ? getShortsStableEntityKey(node, normalizedSrc) : '';
    const shortsOverlayKey = shortsMode ? getShortsRevealOverlayKey(node, normalizedSrc) : '';
    if (shortsMode) {
      const portal = document.getElementById(REVEAL_PORTAL_ID);
      if (portal && typeof portal.querySelectorAll === 'function') {
        const overlays = portal.querySelectorAll('.mw-reveal-overlay');
        for (let i = 0; i < overlays.length; i += 1) {
          const overlay = overlays[i];
          if (!overlay || !overlay.isConnected) continue;
          const overlayNavId = overlay.dataset && overlay.dataset.mwNavId ? overlay.dataset.mwNavId : '';
          if (overlayNavId && overlayNavId !== String(NAV_ID)) continue;
          const overlaySrc = normalizeUrl(overlay.dataset && overlay.dataset.mwFor ? overlay.dataset.mwFor : '') || '';
          if (shortsOverlayKey && overlay.dataset.mwOverlayKey === shortsOverlayKey) return overlay;
          if (overlay.dataset.mwNodeId === nodeId) return overlay;
          if (
            normalizedSrc &&
            shortsEntityKey &&
            overlay.dataset.mwShortsEntityKey === shortsEntityKey &&
            overlaySrc === normalizedSrc
          ) {
            return overlay;
          }
          if (normalizedSrc && !overlay.dataset.mwShortsEntityKey && overlaySrc === normalizedSrc) return overlay;
        }
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
        if (!shortsMode && normalizedSrc && (normalizeUrl(overlay.dataset.mwFor || '') || '') === normalizedSrc) return overlay;
      }
    }
    return null;
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
      const overlayKey = overlay.dataset && overlay.dataset.mwOverlayKey ? overlay.dataset.mwOverlayKey : 'none';
      const overlaySrc = normalizeUrl(overlay.dataset && overlay.dataset.mwFor ? overlay.dataset.mwFor : '') || '';
      overlay.parentElement.removeChild(overlay);
      console.log(
        '[DIAG][REVEAL_UI] overlay_removed',
        'overlayId=' + overlayId,
        'reason=' + (reason || 'unknown'),
        'overlayKey=' + overlayKey,
        'node=' + getDiagNodeId(node)
      );
      diagShortsOverlayLifecycle('overlay_teardown', overlay, reason || 'unknown', node, overlaySrc, 'via=removeRevealOverlay');
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
      return true;
    }
    node.dataset.mwHasOverlay = 'false';
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
      if (nextModeratedState) {
        element.dataset.mwModerated = nextModeratedState;
      }
      element.dataset.mwShortsEntityKey = '';
      element.dataset.mwPreblurClear = 'true';
      if (isShortsModeActive()) {
        clearShortsBlurContextForNode(element, reason || 'clear_all');
      }
    } catch (e) {}
    return changed;
  }

  function applySoftBlur(element, src, itemId) {
    diagBlurStateLog('applySoftBlur.enter', element, src, 'itemId=' + (itemId || 'none'));
    // Check persistence: if user revealed this, don't blur
    if (state.revealed.has(src)) {
      diagSoftBlurLog('apply_skip', element, src, 'reason=revealed_set itemId=' + (itemId || 'none'));
      return;
    }
    if (element.dataset.mwRevealed === 'true') {
      diagSoftBlurLog('apply_skip', element, src, 'reason=element_revealed itemId=' + (itemId || 'none'));
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
    
    try {
      if (isShortsModeActive()) {
        removeRevealOverlay(element, src, 'applySoftBlur_preclear_overlay');
      }
      element.style.filter = 'blur(' + CONFIG.softBlurStrength + 'px)';
      element.style.transition = 'filter 0.2s ease';
      element.dataset.mwModerated = 'softblur';
      element.dataset.mwSrc = src;
      element.dataset.mwItemId = itemId || '';
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
    if (normalizedPredicted !== 'sexy' && normalizedPredicted !== 'porn') {
      return { shouldBlur: !!shouldApplyBlur, reason: null };
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
        const stableEntityKey = getShortsStableEntityKey(element, src);
        if (stableEntityKey) {
          element.dataset.mwShortsEntityKey = stableEntityKey;
        }
      }
      if (element.dataset.mwRevealed === 'true') return;
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
          createRevealOverlay(element, src, category, itemId, false);
        }
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
      if (shortsMode && !shortsStableSelectorUsed && element.dataset.mwShortsStableSelector) {
        shortsStableSelectorUsed = element.dataset.mwShortsStableSelector;
      }
      if (shortsMode) {
        const stableEntityKey = getShortsStableEntityKey(element, src);
        if (stableEntityKey) {
          element.dataset.mwShortsEntityKey = stableEntityKey;
        }
        setShortsBlurContextForNode(
          element,
          src,
          category || 'flagged',
          itemId,
          blurPx,
          shortsStableSelectorUsed,
          'applyBlur'
        );
      }
      diagLogBlurAppliedNodeDetails(element, src, category, itemId, shortsStableSelectorUsed);
      
      state.blurred.add(src);
      state.stats.blurred++;
      const containsOverlay = !!(typeof element.querySelector === 'function' && element.querySelector('.mw-reveal-overlay'));
      
      createRevealOverlay(element, src, category, itemId);
      if (shortsMode && element.isConnected && !findRevealOverlayForElement(element, src)) {
        createRevealOverlay(element, src, category, itemId, false);
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

  function removeBlur(element, src) {
    try {
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
        clearAllBlurAndOverlay(element, src, 'removeBlur_reveal', 'revealed');
      } else {
        element.style.filter = 'none';
        element.dataset.mwModerated = 'revealed';
        element.dataset.mwPreblurClear = 'true';
        element.classList.remove('mw-softblur');
      }
      element.dataset.mwRevealed = 'true'; // Persistence marker
      
      // Add to revealed set for persistence
      state.revealed.add(src);
      
      if (shortsMode) {
        removeRevealOverlay(element, src, 'removeBlur_reveal');
      } else if (overlay) {
        overlay.style.display = 'none';
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
    const shortsMode = isShortsModeActive();
    const allowReresolve = shortsMode && allowShortsReresolve !== false;
    if (shortsMode) {
      const stableResolution = resolveShortsStableBlurTarget(element, src);
      diagLogShortsTargetResolution('createRevealOverlay', element, src, stableResolution);
      const stableTarget = stableResolution && stableResolution.target ? stableResolution.target : null;
      if (stableTarget && stableTarget !== element && stableTarget.isConnected) {
        createRevealOverlay(stableTarget, src, category, itemId, false);
        return;
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
    const normalizedShortsSrc = shortsMode ? (normalizeUrl(src || '') || String(src || '')) : '';
    const shortsEntityKey = shortsMode ? getShortsStableEntityKey(element, normalizedShortsSrc) : '';
    const shortsOverlayKey = shortsMode ? getShortsRevealOverlayKey(element, normalizedShortsSrc) : '';
    if (shortsMode && shortsEntityKey) {
      element.dataset.mwShortsEntityKey = shortsEntityKey;
    }
    if (shortsMode && element.dataset.mwModerated !== 'blurred') {
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
    if (DIAG_YT_BLUR && element.dataset.mwModerated !== 'blurred') {
      diagFailCaseLog(
        'overlay_without_blurred_state',
        element,
        src,
        'mwModerated=' + (element.dataset.mwModerated || 'none')
      );
    }
    let existingOverlay = findRevealOverlayForElement(element, src);
    if (shortsMode && existingOverlay && shortsOverlayKey) {
      const existingOverlayKey = existingOverlay.dataset && existingOverlay.dataset.mwOverlayKey ? existingOverlay.dataset.mwOverlayKey : '';
      if (existingOverlayKey && existingOverlayKey !== shortsOverlayKey) {
        const existingOverlayParent = existingOverlay.parentElement;
        if (existingOverlayParent) {
          existingOverlayParent.removeChild(existingOverlay);
          diagShortsOverlayLifecycle(
            'overlay_teardown',
            existingOverlay,
            'existing_key_mismatch',
            element,
            normalizedShortsSrc || src,
            'expected=' + shortsOverlayKey + ' actual=' + existingOverlayKey
          );
        }
        existingOverlay = null;
      }
    }
    if (existingOverlay) {
      element.dataset.mwHasOverlay = 'true';
      if (shortsMode && element.dataset.mwModerated !== 'blurred') {
        removeRevealOverlay(element, src, 'createRevealOverlay_existing_not_blurred');
        return;
      }
      existingOverlay.dataset.mwFor = src;
      existingOverlay.dataset.mwNodeId = getDiagNodeId(element);
      if (shortsMode) {
        existingOverlay.dataset.mwNavId = String(NAV_ID);
        existingOverlay.dataset.mwShortsUrlId = getCurrentShortsUrlId() || '';
        existingOverlay.dataset.mwShortsEntityKey = shortsEntityKey || '';
        existingOverlay.dataset.mwOverlayKey = shortsOverlayKey || '';
        existingOverlay.__mwTargetNode = element;
      }
      existingOverlay.style.pointerEvents = 'none';
      existingOverlay.style.display = 'flex';
      if (shortsMode) {
        const portal = ensureRevealPortal();
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
              diagShortsOverlayLifecycle(
                'overlay_teardown',
                active,
                'portal_singleton_replace',
                element,
                normalizedShortsSrc || src,
                'keeper=' + (existingOverlay.dataset && existingOverlay.dataset.mwOverlayId ? existingOverlay.dataset.mwOverlayId : 'unknown')
              );
            }
          }
        }
        positionShortsRevealOverlay(existingOverlay, element);
        console.log('[DIAG][REVEAL_UI] portal_update', 'itemKey=' + getDiagItemKey(src));
      }
      diagShortsOverlayLifecycle('overlay_create', existingOverlay, 'reuse_existing', element, normalizedShortsSrc || src, '');
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
      return;
    }
    const overlayParent = shortsMode ? ensureRevealPortal() : parent;
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
    if (!shortsMode) {
      const parentPos = window.getComputedStyle(parent).position;
      if (parentPos === 'static') {
        parent.style.position = 'relative';
      }
    }
    
    const overlay = document.createElement('div');
    diagRevealOverlaySeq += 1;
    const overlayId = 'mwov_' + Date.now().toString(36) + '_' + diagRevealOverlaySeq;
    overlay.className = 'mw-reveal-overlay';
    overlay.dataset.mwFor = src;
    overlay.dataset.mwNodeId = getDiagNodeId(element);
    overlay.dataset.mwOverlayId = overlayId;
    if (shortsMode) {
      overlay.dataset.mwNavId = String(NAV_ID);
      overlay.dataset.mwShortsUrlId = getCurrentShortsUrlId() || '';
      overlay.dataset.mwShortsEntityKey = shortsEntityKey || '';
      overlay.dataset.mwOverlayKey = shortsOverlayKey || '';
      overlay.__mwTargetNode = element;
    }
    overlay.style.cssText = [
      shortsMode ? 'position: fixed' : 'position: absolute',
      'inset: 0',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      shortsMode ? 'background: transparent' : 'background: rgba(0, 0, 0, 0.3)',
      shortsMode ? 'z-index: 2147483647' : 'z-index: 9998',
      'cursor: default',
      'pointer-events: none',
    ].join(';');
    console.log(
      '[DIAG][REVEAL_UI] created',
      'overlayId=' + overlayId,
      'itemKey=' + itemKey,
      'overlayKey=' + (shortsOverlayKey || 'none'),
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch
    );
    diagShortsOverlayLifecycle('overlay_create', overlay, 'created', element, normalizedShortsSrc || src, 'itemKey=' + itemKey);
    
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
      'pointer-events: none',
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
      'pointer-events: auto',
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
      logRevealHittestSnapshot(overlay, btn, overlayId, 'overlay_click', e);
    });
    console.log('[DIAG][REVEAL_UI] bind_overlay', 'overlayId=' + overlayId);
    
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log(
        '[DIAG][REVEAL_EVT] button_click',
        'overlayId=' + overlayId,
        'target=' + getDiagTargetDescriptor(e.target)
      );
      logRevealHittestSnapshot(overlay, btn, overlayId, 'button_click', e);
      const revealAllowed = !state.revealed.has(src);
      const revealGateReason = revealAllowed ? 'not_revealed' : 'already_revealed_reblur_path';
      console.log(
        '[DIAG][REVEAL_EVT] reveal_allowed=' + revealAllowed,
        'reason=' + revealGateReason,
        'overlayId=' + overlayId,
        'itemKey=' + itemKey
      );
      
      if (state.revealed.has(src)) {
        // Re-blur
        state.revealed.delete(src);
        element.dataset.mwRevealed = 'false';
        applyBlur(element, src, category, CONFIG.blurStrength, itemId);
        btn.textContent = '👁 Reveal';
        overlay.style.display = 'flex';
      } else {
        // Reveal and trigger feedback
        const beforeBlurCount = countBlurredNodesForItemKey(src);
        console.log(
          '[DIAG][REVEAL_EVT] reveal_apply_start',
          'overlayId=' + overlayId,
          'itemKey=' + itemKey,
          'beforeBlurCount=' + beforeBlurCount
        );
        state.revealed.add(src);
        element.dataset.mwRevealed = 'true'; // Persistence
        removeBlur(element, src);
        btn.textContent = '🔒 Hide';
        const afterBlurCount = countBlurredNodesForItemKey(src);
        const removedBlurCount = beforeBlurCount > afterBlurCount ? (beforeBlurCount - afterBlurCount) : 0;
        console.log(
          '[DIAG][REVEAL_EVT] reveal_apply_done',
          'overlayId=' + overlayId,
          'itemKey=' + itemKey,
          'removedBlurCount=' + removedBlurCount
        );
        
        // POST a label request message so the host can open the labeling modal
        var labelItemId = itemId || element.dataset.mwItemId || 'unknown_' + Date.now();
        var mwModelVersion = element.dataset.mwModelVersion || null;
        var mwDecisionReason = element.dataset.mwDecisionReason || null;
        var mwNsfwRisk = toFiniteNumber(element.dataset.mwNsfwRisk);
        var mwPersonPresent = element.dataset.mwPersonPresent === '1';
        var mwSkinRatio = toFiniteNumber(element.dataset.mwSkinRatio);
        var mwThirstScore = toFiniteNumber(element.dataset.mwThirstScore);
        var mwSkinThreshold = toFiniteNumber(element.dataset.mwSkinThreshold);
        var mwGrayMin = toFiniteNumber(element.dataset.mwGrayZoneMin);
        var mwGrayMax = toFiniteNumber(element.dataset.mwGrayZoneMax);
        var mwExplicitOverride = toFiniteNumber(element.dataset.mwExplicitOverride);
        var mwImageWidth = toFiniteNumber(element.dataset.mwImageWidth);
        var mwImageHeight = toFiniteNumber(element.dataset.mwImageHeight);
        var mwHost = element.dataset.mwHost || null;
        var labelRequest = {
          type: 'gc-label-request',
          requestId: 'r_' + Date.now().toString(36),
          itemId: labelItemId,
          src: src,
          pageUrl: window.location.href,
          platform: PLATFORM,
          modelPrediction: {
            category: category,
            confidence: toFiniteNumber(element.dataset.mwConfidence),
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
    });
    console.log('[DIAG][REVEAL_UI] bind_button', 'overlayId=' + overlayId);
    
    overlay.appendChild(btn);
    if (shortsMode) {
      const activeOverlays = overlayParent.querySelectorAll('.mw-reveal-overlay');
      for (let i = 0; i < activeOverlays.length; i += 1) {
        const active = activeOverlays[i];
        if (!active || active === overlay) continue;
        if (active.parentElement) {
          active.parentElement.removeChild(active);
          diagShortsOverlayLifecycle(
            'overlay_teardown',
            active,
            'portal_singleton_replace',
            element,
            normalizedShortsSrc || src,
            'keeper=' + overlayId
          );
        }
      }
      positionShortsRevealOverlay(overlay, element);
      console.log('[DIAG][REVEAL_UI] portal_update', 'itemKey=' + itemKey);
    }
    overlayParent.appendChild(overlay);
    element.dataset.mwHasOverlay = 'true';
    const overlayCountAfter = document.querySelectorAll('.mw-reveal-overlay').length;
    console.log(
      '[DIAG][REVEAL_UI] overlay_count_before=' + overlayCountBefore,
      'overlay_count_after=' + overlayCountAfter,
      'overlayId=' + overlayId
    );
    logRevealHittestSnapshot(overlay, btn, overlayId, 'created', null);
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
      thresholds: effectiveThresholds,
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
      if (resultEpoch !== null && resultEpoch !== state.pageEpoch && relaxedYouTubeEpochMode && DIAG_YT_BLUR) {
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
      const thresholdUsed = Object.prototype.hasOwnProperty.call(effectiveThresholds, predictedLabel)
        ? effectiveThresholds[predictedLabel]
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
      state.scanned.add(src);
      
      // Check if result came fast enough to skip blur (semantic delay saved)
      const wasInSoftBlur = element && element.dataset.mwModerated === 'softblur';
      
      // ======== Neutral fast-pass removed (strict mode) ========

      
      // ======== ANATOMICAL LOGIC ========
      // Only maintain blur if Sexy or Porn > 0.60
      let shouldApplyBlur = shouldBlur;
      let decisionReason = hostDecisionReason || reason || '';
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
      
      const dialActive = CONFIG.enabled && CONFIG.sensitivity > 0;
      const sexyScoreForAction = unsafeScores.sexy || 0;
      const pornScoreForAction = unsafeScores.porn || 0;
      const hardBlurOverride = (predictedLabel === 'porn' && pornScoreForAction > 0.8) ||
        (predictedLabel === 'sexy' && sexyScoreForAction > 0.8);
      const dynamicBlurCandidate = rawCategory === 'swimwear' || (predictedLabel === 'sexy' && sexyScoreForAction < 0.8);
      let finalBlur = CONFIG.forcedBlur || (shouldApplyBlur && dialActive);
      if (hardBlurOverride) {
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
        } catch (e) {}
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
          if (img.dataset.mwModerated === 'blurred' && img.dataset.mwRevealed !== 'true' && isShortsModeActive()) {
            if (!findRevealOverlayForElement(img, src) && img.isConnected) {
              createRevealOverlay(img, src, category);
            }
            return;
          }
          if (img.dataset.mwModerated !== 'blurred' && img.dataset.mwRevealed !== 'true') {
            applyBlur(img, src, category, blurStrengthPx);
          }
        }
      });
      
      // Video posters
      document.querySelectorAll('video').forEach(video => {
        if ((video.poster === src || video.dataset.mwOrigPoster === src) && !state.revealed.has(src)) {
          if (video.dataset.mwModerated === 'blurred' && video.dataset.mwRevealed !== 'true' && isShortsModeActive()) {
            if (!findRevealOverlayForElement(video, src) && video.isConnected) {
              createRevealOverlay(video, src, category);
            }
            return;
          }
          if (video.dataset.mwModerated !== 'blurred' && video.dataset.mwRevealed !== 'true') {
            applyBlur(video, src, category, blurStrengthPx);
          }
        }
      });
      
      // Background images
      document.querySelectorAll('[data-mw-bg-src]').forEach(el => {
        if (el.dataset.mwBgSrc === src && !state.revealed.has(src)) {
          if (el.dataset.mwModerated === 'blurred' && el.dataset.mwRevealed !== 'true' && isShortsModeActive()) {
            if (!findRevealOverlayForElement(el, src) && el.isConnected) {
              createRevealOverlay(el, src, category);
            }
            return;
          }
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
    
    // Skip already processed
    if (state.scanned.has(url)) {
      logShortsScanSkip('cache_scanned', null, url, sourceType);
      return false;
    }
    
    // Skip if already revealed by user (persistence)
    if (state.revealed.has(url) || element.dataset.mwRevealed === 'true') {
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
    
    // Apply soft blur immediately to prevent any flash of unblurred content.
    // Safe results will remove the blur as soon as moderation completes.
    applySoftBlur(element, url, itemId);
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

  function scanVideoPoster(video) {
    if (isShortsModeActive()) {
      console.log(
        '[DIAG][VIDEO] found video element',
        'id=' + getDiagNodeId(video),
        'readyState=' + (Number.isFinite(video.readyState) ? video.readyState : 'n/a'),
        'currentTime=' + (Number.isFinite(video.currentTime) ? video.currentTime.toFixed(3) : 'n/a')
      );
      console.log(
        '[DIAG][VIDEO] frame_capture_attempt',
        'success=false',
        'currentTime=' + (Number.isFinite(video.currentTime) ? video.currentTime.toFixed(3) : 'n/a')
      );
    }
    const poster = video.poster ||
                   video.dataset.poster ||
                   video.getAttribute('data-poster');
    
    if (!poster) {
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
    if (isShortsModeActive()) {
      console.log(
        '[DIAG][VIDEO] using_thumbnail_only',
        'src=' + String(poster || '').substring(0, 180)
      );
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
    if (!CONFIG.enabled || CONFIG.sensitivity === 0) {
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
    if (!isShortsModeActive()) return false;
    cleanupShortsRevealCarryover('scan_active_container:' + (reason || 'unknown'), false);
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
      return false;
    }
    const discoveredItems = collectShortsDiscoveryItems(container);
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
    if (!isShortsModeActive()) return;
    if (timerState.paused || timerState.teardownDone) return;
    clearNamedTimeout('youtubeMutationScanTimeout', 'reschedule');
    timerState.youtubeMutationScanTimeout = setTimeout(() => {
      if (timerState.paused || timerState.teardownDone) return;
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
    const shortsAttrMode = isShortsModeActive();
    const attributeFilter = ['src', 'srcset', 'poster', 'data-src', 'data-lazy-src', 'style'];
    const observer = new MutationObserver(mutations => {
      if (timerState.paused) return;
      if (!CONFIG.enabled || CONFIG.sensitivity === 0) return;
      
      let hasYouTubeChanges = false;
      
      for (const mutation of mutations) {
        mutation.removedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          pruneDisconnectedPending('mutation_removed');
          if (shortsAttrMode) {
            const tagName = String(node.tagName || '').toUpperCase();
            const mediaRemoved = (
              tagName === 'IMG' ||
              tagName === 'VIDEO' ||
              (typeof node.querySelector === 'function' && !!node.querySelector('img,video'))
            );
            if (mediaRemoved) {
              const removalAnchor = mutation.target && mutation.target.nodeType === 1 ? mutation.target : node;
              attemptImmediateShortsSwapReattach(removalAnchor, 'remove', getDiagNodeId(node), 'childList_removed:' + tagName.toLowerCase());
              if (DIAG_YT_BLUR) {
                diagLogImgRemoved(node, 'global_mutation_removed', getDiagNodeId(node), '', '');
              }
              hasYouTubeChanges = true;
            }
          }
        });
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          if (shortsAttrMode) {
            attemptImmediateShortsSwapReattach(node, 'insert', null, 'childList_added');
            if (DIAG_YT_BLUR) {
              diagLogVideoInserted(node, 'global_mutation_added', null, '', '');
            }
            hasYouTubeChanges = true;
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
          
          // Add to viewport observer for lazy scanning
          observeForViewport(node);
          queueMutationScan(node, 'mutation_added');
        });
        
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          const attr = mutation.attributeName || '';
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
          }
          attemptImmediateShortsSwapReattach(target, 'attr', null, attr || 'unknown_attr');
          const shouldQueueAttrScan = (
            attr === 'src' ||
            attr === 'srcset' ||
            attr === 'poster' ||
            attr === 'data-src' ||
            attr === 'data-lazy-src' ||
            attr === 'style'
          );
          if (DIAG_YT_BLUR) {
            console.log(
              '[MW-YT][DIAG][MUT_ATTR]',
              'action=scan_schedule_decision',
              'attr=' + attr,
              'nodeId=' + getDiagNodeId(target),
              'scheduled=' + shouldQueueAttrScan
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
      
      if (shortsAttrMode && hasYouTubeChanges) {
        scheduleYouTubeScan('mutation');
      }
    });
    if (shortsAttrMode) {
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: attributeFilter,
      });
    } else {
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
    if (timerState.debugSummaryInterval) count++;
    if (timerState.mainScrollTimeout) count++;
    if (timerState.youtubeScrollTimeout) count++;
    if (timerState.youtubeMutationScanTimeout) count++;
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

  // Set up observers
  setupMutationObserver(document.body);
  state.viewportObserver = setupViewportObserver();
  
  // YouTube-specific: Set up scroll handler for infinite scroll
  setupYouTubeScrollHandler();

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

  ensureSensitivityToggle();

  // SPA navigation detection
  let lastUrl = window.location.href;
  const checkUrlChange = () => {
    if (window.location.href !== lastUrl) {
      const previousUrl = lastUrl;
      const nextUrl = window.location.href;
      console.log('[MW] SPA navigation detected:', previousUrl, '->', nextUrl);
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
      if (isYouTubeShortsUrl(previousUrl) || isYouTubeShortsUrl(nextUrl)) {
        cleanupShortsRevealCarryover('url_change', true);
        resetShortsBlurContext('url_change');
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
    clearNamedTimeout('youtubeMutationScanTimeout', reason);
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
    startLegacyResultsPoll(reason);
    startUrlChangePoll(reason);
    startYouTubePeriodicScan(reason);
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
    cleanupShortsRevealCarryover('teardown', true);
    const revealPortal = document.getElementById(REVEAL_PORTAL_ID);
    if (revealPortal && revealPortal.parentElement) {
      revealPortal.parentElement.removeChild(revealPortal);
      console.log(
        '[DIAG][REVEAL_UI] portal_removed',
        'reason=' + (reason || 'teardown')
      );
    }
    lastActiveShortsContainer = null;
    lastShortsUrlId = '';
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
