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
  enableShortsHealthHeal?: boolean;
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

export interface ShortsContinuityGraceInput {
  isHomeShortsShelfVideo: boolean;
  isTransitionChurnReason: boolean;
  hasTransientIdentityOrContextGap: boolean;
  elapsedSinceAuthoritativeBlurMs: number;
  graceWindowMs: number;
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

export function shouldPreserveShortsContinuityBlur(input: ShortsContinuityGraceInput): boolean {
  if (!input || typeof input !== 'object') return false;
  if (!input.isHomeShortsShelfVideo) return false;
  if (!input.isTransitionChurnReason) return false;
  if (!input.hasTransientIdentityOrContextGap) return false;
  const elapsed = Number(input.elapsedSinceAuthoritativeBlurMs);
  if (!Number.isFinite(elapsed) || elapsed < 0) return false;
  const graceWindowMs = Math.max(0, Number(input.graceWindowMs) || 0);
  return elapsed <= graceWindowMs;
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
    forcedBlur: ${config.forcedBlur || false},
    failClosed: ${failClosed},
    debug: ${config.debug || false},
    nonce: '${nonce}',
    blockingMode: '${config.blockingMode || 'mvp'}',
    pageEpoch: ${pageEpoch},
    diagYouTubeShorts: ${config.diagYouTubeShorts ? 'true' : 'false'},
    enableShortsHealthHeal: ${config.enableShortsHealthHeal ? 'true' : 'false'},
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

  // Routes diagnostic console.log lines through the native bridge so they appear
  // in Xcode's debugger console (not just Safari Web Inspector).
  function mwDiagLog() {
    console.log.apply(console, arguments);
    try {
      var msg = Array.prototype.slice.call(arguments).join(' ');
      postToHost({ type: 'MW_DIAG_LOG', msg: msg });
      if (msg.indexOf('[MW-FLICKER]') !== -1 &&
          window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.blurDiagnostics) {
        window.webkit.messageHandlers.blurDiagnostics.postMessage(msg);
      }
    } catch (e) {}
  }

  mwDiagLog('[Spoon1] startup_diag_marker');
  mwDiagLog('[Sun22] startup_diag_marker');
  mwDiagLog('[Jesus22] startup_diag_marker');

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
    console.log('[MW] Filter Intensity set to', normalized, 'label=' + getSensitivityLabel(normalized), 'reason=' + (reason || 'toggle'));
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
  
  const persistedNonShortsReattachContext = (function() {
    if (window.__MW_NON_SHORTS_REATTACH_CONTEXT__ && typeof window.__MW_NON_SHORTS_REATTACH_CONTEXT__.forEach === 'function') {
      return window.__MW_NON_SHORTS_REATTACH_CONTEXT__;
    }
    window.__MW_NON_SHORTS_REATTACH_CONTEXT__ = new Map();
    return window.__MW_NON_SHORTS_REATTACH_CONTEXT__;
  })();
  const persistedMainSurfaceLaneByNode = (function() {
    if (window.__MW_MAIN_SURFACE_LANE_BY_NODE__ && typeof window.__MW_MAIN_SURFACE_LANE_BY_NODE__.get === 'function') {
      return window.__MW_MAIN_SURFACE_LANE_BY_NODE__;
    }
    window.__MW_MAIN_SURFACE_LANE_BY_NODE__ = new WeakMap();
    return window.__MW_MAIN_SURFACE_LANE_BY_NODE__;
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
    const shortsId =
      getYouTubeAssetVideoId(normalizedSrc) ||
      extractShortsIdFromUrl(normalizedSrc) ||
      getCurrentShortsUrlId() ||
      '';
    if (shortsId) {
      return {
        key: 'shorts:' + shortsId,
        normalizedSrc: normalizedSrc,
        shortsId: shortsId,
        holdMs: SHORTS_REVEAL_HOLD_MS,
      };
    }
    return {
      key: 'src:' + normalizedSrc,
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

  function isRevealedForSource(src, element) {
    const resolved = getRevealMetaForSource(src, element);
    if (resolved.meta) return true;
    const scope = resolved.scope;
    const normalizedSrc = scope.normalizedSrc;
    if (state.revealed.has(scope.key)) return true;
    if (normalizedSrc && state.revealed.has(normalizedSrc)) return true;
    if (element && element.dataset && element.dataset.mwRevealed === 'true') {
      const elementKey = String(element.dataset.mwRevealKey || '');
      if (elementKey) {
        if (getRevealMetaByKey(elementKey)) return true;
        if (state.revealed.has(elementKey)) return true;
      } else if (normalizedSrc && state.revealed.has(normalizedSrc)) {
        return true;
      }
      // Stale dataset marker, clear it so expired reveal can re-enter blur flow.
      element.dataset.mwRevealed = 'false';
      element.dataset.mwRevealKey = '';
      element.dataset.mwRevealedAt = '';
      element.dataset.mwRevealExpiresAt = '';
    }
    return false;
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
    revealOverlayRetryTimeout: null,
    revealOverlayLastReason: '',
    revealOverlayScrollHandler: null,
    revealOverlayResizeHandler: null,
    debugSummaryInterval: null,
    diagHeartbeatInterval: null,
    shortsHealthHealInterval: null,
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
  const shortsAuthoritativeBlurAtByNode = new WeakMap();
  const shortsAuthoritativeBlurAtByAnchor = new WeakMap();
  const SHORTS_STABLE_CONTAINER_SELECTORS = [
    '#shorts-player ytm-reel-video-renderer[aria-hidden="false"]',
    '#shorts-player ytm-reel-video-renderer[selected]',
    '#shorts-player ytm-reel-video-renderer[is-active]',
    '#shorts-player ytm-reel-video-renderer',
    '#shorts-player',
  ];
  const SHORTS_STABLE_CONTAINER_TAG_SELECTOR = 'ytm-reel-video-renderer, ytm-shorts-lockup-view-model, #shorts-player';
  const SHORTS_SWAP_REATTACH_WINDOW_MS = 2600;
  const SHORTS_HEALTH_HEAL_COOLDOWN_MS = 1500;
  const SHORTS_HEALTH_HEAL_MAX_ATTEMPTS = 5;
  const SHORTS_HEALTH_HEAL_WINDOW_MS = 30000;
  const SHORTS_HEALTH_HEAL_GIVEUP_MS = 30000;
  const SHORTS_HEALTH_HEAL_INTERVAL_MS = 2000;
  const SHORTS_HEALTH_HEAL_ENABLED = CONFIG.enableShortsHealthHeal === true;
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

  function isShortsModeActive() {
    return isYouTubeShortsUrl(window.location.href);
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
      return path === '/' || path.indexOf('/feed') === 0 || path.indexOf('/results') === 0;
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
    if (!isShortsModeActive()) return;
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
      logAdaptiveShortsEvent(
        'targeted_rescan_triggered',
        'reason=' + (reason || 'unknown') +
        ' identity=' + String(liveIdentity || 'none').substring(0, 220) +
        ' containerNodeId=' + getDiagNodeId(liveCandidate.container)
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
      stopAdaptiveShortsOverlayWatch('inactive:' + (reason || 'unknown'));
      return false;
    }
    const root = resolveAdaptiveShortsWatchRoot();
    if (!root || !root.isConnected) {
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
    // Also re-blur img elements (e.g. Shorts home shelf card thumbnails) that were
    // previously flagged but whose blur was dropped by virtual-scroll remove/re-insert.
    const imgs = diagCollectDescendantTagNodes(node, 'img');
    for (let j = 0; j < imgs.length; j += 1) {
      const img = imgs[j];
      if (!img || img.nodeType !== 1) continue;
      if (isAdaptiveOverlayNode(img)) continue;
      if (!img.isConnected) continue;
      const imgSrc = normalizeUrl(img.src || img.dataset.src || '') ||
                     (img.src || img.dataset.src || '');
      if (!imgSrc) continue;
      if (!state.blurred.has(imgSrc)) continue;
      if (isRevealedForSource(imgSrc, img)) continue;
      if (img.dataset.mwModerated === 'blurred' &&
          (img.style.getPropertyValue('filter') || img.style.filter || '').toLowerCase().includes('blur(')) {
        continue;
      }
      const reattachCategory = String((img.dataset && img.dataset.mwCategory) || 'flagged');
      const reattachBlurPx = Number((img.dataset && img.dataset.mwBlurStrength) || '') || CONFIG.blurStrength;
      mwDiagLog(
        '[MW-FLICKER][REATTACH_IMG] Shorts shelf img re-blurred on node insert',
        'node=' + getDiagNodeId(img),
        'src=' + imgSrc.substring(0, 120),
        'reason=' + (reason || 'unknown'),
        'category=' + reattachCategory,
        'blurPx=' + reattachBlurPx,
        'connected=' + img.isConnected
      );
      applyBlur(img, imgSrc, reattachCategory, reattachBlurPx, null);
      reattached = true;
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
    '#content',
  ].join(',');
  const NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR = [
    'ytm-rich-item-renderer',
    'ytm-video-with-context-renderer',
    'ytm-compact-video-renderer',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-grid-video-renderer',
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
  const SHORTS_CONTINUITY_GRACE_WINDOW_MS = 1200;
  const MAIN_SURFACE_LANE_FLIP_WINDOW_MS = 4000;
  const REGULAR_MAIN_LANE_FLIP_GHOST_QUARANTINE_MS = 2600;

  function isNonShortsYouTubeReattachContext() {
    return isYouTube() && !isShortsModeActive();
  }

  function getMonotonicNowMs() {
    try {
      const now = Number(performance.now());
      if (Number.isFinite(now) && now >= 0) return now;
    } catch (e) {}
    return Date.now();
  }

  function shouldPreserveShortsContinuityBlurLocal(input) {
    if (!input || typeof input !== 'object') return false;
    if (!input.isHomeShortsShelfVideo) return false;
    if (!input.isTransitionChurnReason) return false;
    if (!input.hasTransientIdentityOrContextGap) return false;
    const elapsed = Number(input.elapsedSinceAuthoritativeBlurMs);
    if (!Number.isFinite(elapsed) || elapsed < 0) return false;
    const graceWindowMs = Math.max(0, Number(input.graceWindowMs) || 0);
    return elapsed <= graceWindowMs;
  }

  function rememberShortsAuthoritativeBlurMoment(videoNode, anchorNode) {
    const now = getMonotonicNowMs();
    if (videoNode && videoNode.nodeType === 1) {
      shortsAuthoritativeBlurAtByNode.set(videoNode, now);
    }
    if (anchorNode && anchorNode.nodeType === 1) {
      shortsAuthoritativeBlurAtByAnchor.set(anchorNode, now);
    }
  }

  function getShortsAuthoritativeBlurAgeMs(videoNode, anchorNode) {
    const now = getMonotonicNowMs();
    let latestAt = -1;
    if (videoNode && videoNode.nodeType === 1) {
      const nodeAt = Number(shortsAuthoritativeBlurAtByNode.get(videoNode));
      if (Number.isFinite(nodeAt)) latestAt = Math.max(latestAt, nodeAt);
    }
    if (anchorNode && anchorNode.nodeType === 1) {
      const anchorAt = Number(shortsAuthoritativeBlurAtByAnchor.get(anchorNode));
      if (Number.isFinite(anchorAt)) latestAt = Math.max(latestAt, anchorAt);
    }
    if (!Number.isFinite(latestAt) || latestAt < 0) return Number.POSITIVE_INFINITY;
    return Math.max(0, now - latestAt);
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
    // Depth 16 covers the deepest observed YouTube mobile DOM card nesting (was 10,
    // increased to catch cards nested inside rich-grid-renderer layouts).
    for (let depth = 0; depth < 16 && cursor; depth += 1) {
      if (isNonShortsStrongCardNode(cursor)) return cursor;
      const nodeId = String(cursor.id || '').toLowerCase();
      if (nodeId === 'content') {
        cursor = cursor.parentElement || null;
        continue;
      }
      const tagName = String(cursor.tagName || '').toLowerCase();
      if (
        tagName === 'ytm-rich-grid-renderer' ||
        tagName === 'ytd-rich-section-renderer' ||
        (cursor.hasAttribute && cursor.hasAttribute('data-context-item-id'))
      ) {
        cursor = cursor.parentElement || null;
        continue;
      }
      if (typeof cursor.querySelectorAll === 'function') {
        const shortsLockups = cursor.querySelectorAll('ytm-shorts-lockup-view-model');
        const shortsAnchors = cursor.querySelectorAll('a[href*="/shorts/"]');
        if (shortsLockups.length < 1 && shortsAnchors.length < 1) {
          const watchAnchors = cursor.querySelectorAll('a[href*="/watch"]');
          if (watchAnchors.length === 1) return cursor;
          if (watchAnchors.length > 1) {
            const videoIdSet = new Set();
            for (let i = 0; i < watchAnchors.length; i += 1) {
              const href = String(
                (watchAnchors[i].getAttribute && watchAnchors[i].getAttribute('href')) ||
                (watchAnchors[i].href) ||
                ''
              );
              const m = href.match(/[?&]v=([^&/#]+)/);
              videoIdSet.add(m ? m[1] : href);
            }
            if (videoIdSet.size === 1) return cursor;
          }
        }
      }
      cursor = cursor.parentElement || null;
    }
    return null;
  }

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
    const nearestRegularCardNode = (
      typeof videoNode.closest === 'function'
        ? (videoNode.closest(NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR) || findRegularMainCardFallbackNode(videoNode))
        : null
    );
    const nearestRegularCardNodeId = nearestRegularCardNode ? getDiagNodeId(nearestRegularCardNode) : 'none';
    const nearestShortsLockupNodeId = directShortsLockupNode ? getDiagNodeId(directShortsLockupNode) : 'none';
    let continuityAnchorNode = directShortsAnchorNode || null;
    const hasDirectShortsLockupOnNodePath = !!directShortsLockupNode;
    const hasDirectShortsAnchorOnNodePath = (
      !!directShortsAnchorNode &&
      extractShortsIdFromHrefValue(directShortsAnchorHref) !== 'unknown'
    );
    let viaCardShortsLink = false;
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
      viaCardShortsLink = !!shortsAnchor;
      if (shortsAnchor) continuityAnchorNode = shortsAnchor;
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
    if (isMainSurfaceUrl && isHomeShortsShelfVideo) {
      postNonShortsTransitionDiag('classify_shorts_true_source', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        cardNodeId: cardNodeId,
        marker: 'MW-FLICKER-CLASSIFY-SHORTS-TRUE-SOURCE-V1',
        hasDirectShortsLockupOnNodePath: !!hasDirectShortsLockupOnNodePath,
        hasDirectShortsAnchorOnNodePath: !!hasDirectShortsAnchorOnNodePath,
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        derivedAnchorItemKey: String(derivedAnchorItemKey || 'unknown'),
        nearbyShortsAnchorId: String(nearbyShortsAnchorId || 'unknown'),
      });
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
    let laneFlipShortsToRegularUnknownIdentity = false;
    if (isMainSurfaceUrl) {
      const currentLaneCandidate = (
        isHomeShortsShelfVideo
          ? 'shorts'
          : (regularPathQuarantinePassed ? 'regular' : 'unknown')
      );
      const identityAmbiguous = !!(
        (
          (hasDirectShortsLockupOnNodePath || hasDirectShortsAnchorOnNodePath || viaCardShortsLink) &&
          nearestRegularCardNodeId !== 'none'
        ) ||
        (
          strictContinuityItemKey &&
          strictContinuityItemKey !== 'unknown' &&
          nearbyShortsAnchorId &&
          nearbyShortsAnchorId !== 'unknown' &&
          strictContinuityItemKey !== nearbyShortsAnchorId
        ) ||
        (
          derivedAnchorItemKey &&
          derivedAnchorItemKey !== 'unknown' &&
          reattachItemKey &&
          reattachItemKey !== 'unknown' &&
          derivedAnchorItemKey !== reattachItemKey
        )
      );
      if (identityAmbiguous) {
        postNonShortsTransitionDiag('identity_split_candidate', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-FLICKER-IDENTITY-SPLIT-CANDIDATE-V1',
          nearestRegularCardNodeId: String(nearestRegularCardNodeId || 'none'),
          nearestShortsLockupNodeId: String(nearestShortsLockupNodeId || 'none'),
          viaLockup: !!hasDirectShortsLockupOnNodePath,
          viaDirectShortsAnchor: !!hasDirectShortsAnchorOnNodePath,
          viaCardShortsLink: !!viaCardShortsLink,
          strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
          nearbyShortsAnchorId: String(nearbyShortsAnchorId || 'unknown'),
          derivedAnchorItemKey: String(derivedAnchorItemKey || 'unknown'),
          currentLaneCandidate: String(currentLaneCandidate || 'unknown'),
        });
      }
      const nextLane = currentLaneCandidate;
      const nowMs = Date.now();
      const previousLaneState = persistedMainSurfaceLaneByNode.get(videoNode) || null;
      const isShortWindowFlip = !!(
        previousLaneState &&
        Number.isFinite(previousLaneState.seenAt) &&
        (nowMs - Number(previousLaneState.seenAt || 0)) <= MAIN_SURFACE_LANE_FLIP_WINDOW_MS
      );
      if (
        previousLaneState &&
        previousLaneState.lane &&
        previousLaneState.lane !== nextLane &&
        previousLaneState.lane !== 'unknown' &&
        nextLane !== 'unknown' &&
        isShortWindowFlip
      ) {
        laneFlipShortsToRegularUnknownIdentity = !!(
          previousLaneState.lane === 'shorts' &&
          nextLane === 'regular' &&
          (!strictContinuityItemKey || strictContinuityItemKey === 'unknown')
        );
        postNonShortsTransitionDiag('lane_flip_same_node', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-FLICKER-LANE-FLIP-SAME-NODE-V1',
          prevLane: String(previousLaneState.lane || 'unknown'),
          nextLane: String(nextLane || 'unknown'),
          prevReason: String(previousLaneState.reason || 'unknown'),
          nextReason: String(reason || 'unknown'),
          prevStrictKey: String(previousLaneState.strictContinuityItemKey || 'unknown'),
          nextStrictKey: String(strictContinuityItemKey || 'unknown'),
          prevCardNodeId: String(previousLaneState.cardNodeId || 'none'),
          nextCardNodeId: String(cardNodeId || 'none'),
          prevNearbyShortsAnchorId: String(previousLaneState.nearbyShortsAnchorId || 'unknown'),
          nextNearbyShortsAnchorId: String(nearbyShortsAnchorId || 'unknown'),
        });
      }
      persistedMainSurfaceLaneByNode.set(videoNode, {
        lane: nextLane,
        reason: String(reason || 'unknown'),
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        cardNodeId: String(cardNodeId || 'none'),
        nearbyShortsAnchorId: String(nearbyShortsAnchorId || 'unknown'),
        seenAt: nowMs,
      });
    }

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
    let shortsItemKeyLookupMiss = false;
    let regularItemKeyLookupMiss = false;
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
    if (isMainSurfaceUrl && isHomeShortsShelfVideo) {
      const shortsCardBoundaryCandidate = (
        card ||
        (typeof videoNode.closest === 'function' ? videoNode.closest(NON_SHORTS_REATTACH_STRONG_CARD_SELECTOR) : null) ||
        findRegularMainCardFallbackNode(videoNode)
      );
      const shortsCardBoundaryCandidateId = shortsCardBoundaryCandidate ? getDiagNodeId(shortsCardBoundaryCandidate) : 'none';
      const shortsCardBoundaryFound = !!shortsCardBoundaryCandidate;
      const shortsCardBoundaryRejectedReason = (
        !shortsCardBoundaryFound
          ? 'no_card_boundary'
          : (cardNodeId === 'none'
              ? 'candidate_not_selected'
              : (shortsCardBoundaryCandidateId !== cardNodeId ? 'candidate_mismatch' : 'none'))
      );
      postNonShortsTransitionDiag('shorts_card_boundary_lookup_result', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-FLICKER-SHORTS-CARD-BOUNDARY-LOOKUP-RESULT-V1',
        cardNodeIdCandidate: String(shortsCardBoundaryCandidateId || 'none'),
        cardBoundaryFound: !!shortsCardBoundaryFound,
        cardBoundaryRejectedReason: String(shortsCardBoundaryRejectedReason || 'none'),
        isHomeShortsShelfVideo: !!isHomeShortsShelfVideo,
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
      });
    }
    if (!contextNode && strictContinuityItemKey && strictContinuityItemKey !== 'unknown') {
      const remembered = findNonShortsReattachContextByItemKey(strictContinuityItemKey, cardNodeId);
      if (
        isMainSurfaceUrl &&
        isHomeShortsShelfVideo &&
        (!remembered || !remembered.entry)
      ) {
        shortsItemKeyLookupMiss = true;
        postNonShortsTransitionDiag('shorts_itemkey_lookup_miss', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          cardNodeId: cardNodeId,
          marker: 'MW-FLICKER-SHORTS-ITEMKEY-LOOKUP-MISS-V1',
          strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
          nearbyShortsAnchorId: String(nearbyShortsAnchorId || 'unknown'),
          reattachItemKey: String(reattachItemKey || 'unknown'),
        });
      }
      if (
        isMainSurfaceUrl &&
        !isHomeShortsShelfVideo &&
        regularPathQuarantinePassed &&
        (!remembered || !remembered.entry)
      ) {
        regularItemKeyLookupMiss = true;
      }
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
    if (
      isMainSurfaceUrl &&
      !isHomeShortsShelfVideo &&
      regularPathQuarantinePassed &&
      !contextData
    ) {
      let regularMissType = 'card_found_no_blurred_context';
      if (cardNodeId === 'none') {
        regularMissType = 'no_card_boundary';
      } else if (!strictContinuityItemKey || strictContinuityItemKey === 'unknown') {
        regularMissType = 'strict_key_unknown';
      } else if (regularItemKeyLookupMiss) {
        regularMissType = 'strict_key_known_context_map_miss';
      }
      postNonShortsTransitionDiag('regular_context_lookup_miss', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-FLICKER-REGULAR-CONTEXT-LOOKUP-MISS-V1',
        cardNodeId: String(cardNodeId || 'none'),
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        missType: String(regularMissType || 'card_found_no_blurred_context'),
      });
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
    const normalizedNodeDatasetSrc = normalizeUrl(String((videoNode.dataset && videoNode.dataset.mwSrc) || '')) || '';
    const hardBlurSrcPresentInBlurredSetEarly = !!(
      hardBlurSrc &&
      state.blurred &&
      typeof state.blurred.has === 'function' &&
      state.blurred.has(hardBlurSrc)
    );
    if (
      regularPathQuarantinePassed &&
      !contextData &&
      hardBlurSrc &&
      (
        hasAuthoritativeBlur ||
        hardBlurSrcPresentInBlurredSetEarly
      ) &&
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
    const hardSrcMatchesCurrentExact = !!(
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
    if (isHomeShortsShelfVideo && hasAuthoritativeBlur) {
      rememberShortsAuthoritativeBlurMoment(videoNode, continuityAnchorNode);
    }
    const shortsAuthoritativeBlurAgeMs = isHomeShortsShelfVideo
      ? getShortsAuthoritativeBlurAgeMs(videoNode, continuityAnchorNode)
      : Number.POSITIVE_INFINITY;
    const shortsTransientIdentityOrContextGap = !!(
      !contextData &&
      (!strictIdentityKnown || (!normalizedPoster && !normalizedCurrent))
    );
    const shortsContinuityGraceActive = shouldPreserveShortsContinuityBlurLocal({
      isHomeShortsShelfVideo: !!isHomeShortsShelfVideo,
      isTransitionChurnReason: !!isTransitionChurnReason,
      hasTransientIdentityOrContextGap: !!shortsTransientIdentityOrContextGap,
      elapsedSinceAuthoritativeBlurMs: shortsAuthoritativeBlurAgeMs,
      graceWindowMs: SHORTS_CONTINUITY_GRACE_WINDOW_MS,
    });
    const hardSrcMatchesCurrent = !!(
      hardSrcMatchesCurrentExact ||
      (
        shortsContinuityGraceActive &&
        !!hardBlurSrc &&
        !normalizedPoster &&
        !normalizedCurrent
      )
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
    const preserveShortsHardBlurDuringGraceWindow = !!(
      isHomeShortsShelfVideo &&
      shortsContinuityGraceActive &&
      hardItemKeyKnown
    );
    const failClosedRegularLaneFlipGhostBlur = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      laneFlipShortsToRegularUnknownIdentity &&
      !contextData &&
      isTransitionChurnReason &&
      hasAuthoritativeBlur &&
      hardItemKeyKnown &&
      (!strictIdentityKnown || strictContinuityItemKey === 'unknown')
    );
    const hardBlurSrcMatchesNodeDatasetSrc = !!(
      hardBlurSrc &&
      normalizedNodeDatasetSrc &&
      hardBlurSrc === normalizedNodeDatasetSrc
    );
    const hardBlurSrcPresentInBlurredSet = !!(
      hardBlurSrc &&
      state.blurred &&
      typeof state.blurred.has === 'function' &&
      state.blurred.has(hardBlurSrc)
    );
    const regularPositiveContinuitySignal = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      hardBlurSrcPresentInBlurredSet &&
      (hardSrcMatchesCurrentExact || hardBlurSrcMatchesNodeDatasetSrc)
    );
    const contextDataItemKey = getDiagItemKey(String((contextData && contextData.src) || ''));
    const contextDataItemKeyKnown = !!(contextDataItemKey && contextDataItemKey !== 'unknown');
    const contextDataMatchesStrictKey = !!(
      strictIdentityKnown &&
      contextDataItemKeyKnown &&
      String(strictContinuityItemKey || 'unknown') === String(contextDataItemKey || 'unknown')
    );
    const contextDataMatchesHardKey = !!(
      hardItemKeyKnown &&
      contextDataItemKeyKnown &&
      String(hardBlurItemKey || 'unknown') === String(contextDataItemKey || 'unknown')
    );
    const regularContextFailClosedUnproven = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      !!contextData &&
      !regularPositiveContinuitySignal &&
      (
        String(contextKind || 'none') === 'itemkey_global' ||
        String(contextKind || 'none') === 'src_match'
      ) &&
      !contextDataMatchesStrictKey &&
      !contextDataMatchesHardKey
    );
    if (regularContextFailClosedUnproven) {
      console.log(
        '[MW-MVP-REGULAR-NEGATIVE-FAIL-CLOSED-V1] context_blocked_unproven',
        'reason=' + String(reason || 'unknown'),
        'nodeId=' + String(videoNodeId || 'none'),
        'contextKind=' + String(contextKind || 'none'),
        'contextItemKey=' + String(contextDataItemKey || 'unknown'),
        'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
        'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown')
      );
      postNonShortsTransitionDiag('regular_context_fail_closed_unproven', {
        reason: String(reason || 'unknown'),
        nodeId: String(videoNodeId || 'none'),
        marker: 'MW-MVP-REGULAR-NEGATIVE-FAIL-CLOSED-V1',
        contextKind: String(contextKind || 'none'),
        contextItemKey: String(contextDataItemKey || 'unknown'),
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
      });
      contextData = null;
      contextKind = 'none';
      contextNode = null;
    }
    const regularNuclearClearVetoByPositiveContinuity = !!(
      hasAuthoritativeBlur &&
      regularPositiveContinuitySignal
    );
    const regularVideoTransitionUnresolvedGhost = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      !contextData &&
      (!strictIdentityKnown || strictContinuityItemKey === 'unknown') &&
      isTransitionChurnReason &&
      (String(cardNodeId || 'none') === 'none') &&
      (hasAuthoritativeBlur || hasIncidentalBlur) &&
      !regularNuclearClearVetoByPositiveContinuity
    );
    const regularUnresolvedGhostState = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      !contextData &&
      (!strictIdentityKnown || strictContinuityItemKey === 'unknown') &&
      String(cardNodeId || 'none') === 'none' &&
      isTransitionChurnReason &&
      !regularNuclearClearVetoByPositiveContinuity
    );
    const regularGhostSeenEpoch = Number(
      (videoNode && videoNode.dataset && videoNode.dataset.mwRegularGhostSeenEpoch) || 0
    );
    const regularGhostSeenThisEpoch = !!(
      Number.isFinite(regularGhostSeenEpoch) &&
      regularGhostSeenEpoch > 0 &&
      regularGhostSeenEpoch === CONFIG.pageEpoch
    );
    const regularLaneFlipGhostQuarantineActive = !!(
      regularUnresolvedGhostState &&
      videoNode.dataset &&
      Number(videoNode.dataset.mwRegularLaneFlipGhostQuarantineUntil || 0) > Date.now()
    );
    const regularGhostEpochBypassActive = !!(
      regularUnresolvedGhostState &&
      regularGhostSeenThisEpoch
    );
    let blockRegularFallbackNow = !!(
      regularVideoTransitionUnresolvedGhost ||
      regularLaneFlipGhostQuarantineActive ||
      regularGhostEpochBypassActive
    );
    const regularStrongOwnershipResolved = !!(
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      !!contextData &&
      strictIdentityKnown &&
      String(cardNodeId || 'none') !== 'none' &&
      (
        contextKind === 'card_blurred' ||
        contextKind === 'itemkey_global' ||
        contextKind === 'itemkey_card' ||
        contextKind === 'regular_main_preclear_card_recovery'
      )
    );
    if (
      videoNode &&
      videoNode.dataset &&
      Number(videoNode.dataset.mwRegularLaneFlipGhostQuarantineUntil || 0) > 0 &&
      !regularLaneFlipGhostQuarantineActive
    ) {
      videoNode.dataset.mwRegularLaneFlipGhostQuarantineUntil = '0';
    }
    if (
      regularStrongOwnershipResolved &&
      videoNode &&
      videoNode.dataset &&
      Number(videoNode.dataset.mwRegularGhostSeenEpoch || 0) > 0
    ) {
      videoNode.dataset.mwRegularGhostSeenEpoch = '0';
      videoNode.dataset.mwRegularLaneFlipGhostQuarantineUntil = '0';
    }
    if (
      hasAuthoritativeBlur &&
      !contextData &&
      !hardKeyMatchesStrict &&
      !hardSrcMatchesCurrent &&
      !regularPositiveContinuitySignal &&
      !holdBlurDuringUnresolvedTransition &&
      !preserveShortsHardBlurDuringResolvedContinuity &&
      !preserveShortsHardBlurDuringGraceWindow
    ) {
      if (
        isNodeClassificationLocked(videoNode, reason) &&
        !regularVideoTransitionUnresolvedGhost &&
        !failClosedRegularLaneFlipGhostBlur &&
        !regularLaneFlipGhostQuarantineActive &&
        !regularGhostEpochBypassActive
      ) {
        mwDiagLog('[MW-PERSIST][PROVENANCE-BLOCKED] hard_blur_provenance_mismatch suppressed — classification locked',
          'reason=' + String(reason || 'unknown'),
          'node=' + videoNodeId,
          'hardBlurItemKey=' + String(hardBlurItemKey || ''),
          'strictContinuityItemKey=' + String(strictContinuityItemKey || ''),
          'classifiedEpoch=' + String((videoNode.dataset && videoNode.dataset.mwClassifiedEpoch) || '0'),
          'pageEpoch=' + String(CONFIG.pageEpoch)
        );
      } else {
      if (regularVideoTransitionUnresolvedGhost) {
        // Nuclear MVP guard for regular video-thumbnail transitions:
        // if ownership is unresolved, force-clear stale blur carry-over immediately.
        mwDiagLog(
          '[MW-MVP-REGULAR-VIDEO-THUMB-NEGATIVE-NUCLEAR-V1] forcing_provenance_clear_unresolved_transition_ghost',
          'reason=' + String(reason || 'unknown'),
          'node=' + videoNodeId,
          'cardNodeId=' + String(cardNodeId || 'none'),
          'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
          'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown')
        );
        postNonShortsTransitionDiag('regular_video_thumb_negative_nuclear_provenance_clear', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-MVP-REGULAR-VIDEO-THUMB-NEGATIVE-NUCLEAR-V1',
          cardNodeId: String(cardNodeId || 'none'),
          hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
          strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        });
        if (videoNode && videoNode.dataset) {
          videoNode.dataset.mwRegularLaneFlipGhostQuarantineUntil =
            String(Date.now() + REGULAR_MAIN_LANE_FLIP_GHOST_QUARANTINE_MS);
          videoNode.dataset.mwRegularGhostSeenEpoch = String(CONFIG.pageEpoch);
        }
        blockRegularFallbackNow = true;
      } else if (failClosedRegularLaneFlipGhostBlur) {
        // Protect regular-main negatives from inheriting stale Shorts blur when the
        // same node flips lanes and strict identity is unresolved.
        mwDiagLog(
          '[MW-MVP-REGULAR-THUMB-LANE-FLIP-FAIL-CLOSED-V1] forcing_provenance_clear_on_lane_flip_unknown_identity',
          'reason=' + String(reason || 'unknown'),
          'node=' + videoNodeId,
          'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
          'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown')
        );
        postNonShortsTransitionDiag('regular_main_lane_flip_fail_closed_provenance_clear', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-MVP-REGULAR-THUMB-LANE-FLIP-FAIL-CLOSED-V1',
          hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
          strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        });
        if (videoNode && videoNode.dataset) {
          videoNode.dataset.mwRegularLaneFlipGhostQuarantineUntil =
            String(Date.now() + REGULAR_MAIN_LANE_FLIP_GHOST_QUARANTINE_MS);
          videoNode.dataset.mwRegularGhostSeenEpoch = String(CONFIG.pageEpoch);
        }
        blockRegularFallbackNow = true;
      } else if (regularLaneFlipGhostQuarantineActive) {
        mwDiagLog(
          '[MW-MVP-REGULAR-THUMB-LANE-FLIP-FAIL-CLOSED-V1] forcing_provenance_clear_in_active_quarantine',
          'reason=' + String(reason || 'unknown'),
          'node=' + videoNodeId,
          'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
          'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown')
        );
        postNonShortsTransitionDiag('regular_main_lane_flip_quarantine_provenance_clear', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-MVP-REGULAR-THUMB-LANE-FLIP-FAIL-CLOSED-V1',
          hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
          strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        });
        blockRegularFallbackNow = true;
      } else if (regularGhostEpochBypassActive) {
        mwDiagLog(
          '[MW-MVP-REGULAR-THUMB-LANE-FLIP-FAIL-CLOSED-V1] forcing_provenance_clear_in_epoch_guard',
          'reason=' + String(reason || 'unknown'),
          'node=' + videoNodeId,
          'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
          'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
          'ghostEpoch=' + String(CONFIG.pageEpoch)
        );
        postNonShortsTransitionDiag('regular_main_lane_flip_epoch_guard_provenance_clear', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-MVP-REGULAR-THUMB-LANE-FLIP-FAIL-CLOSED-V1',
          hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
          strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
          ghostEpoch: Number(CONFIG.pageEpoch || 0),
        });
        blockRegularFallbackNow = true;
      }
      if (isMainSurfaceUrl && !isHomeShortsShelfVideo && regularPathQuarantinePassed) {
        postNonShortsTransitionDiag('regular_provenance_clear_source', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-FLICKER-REGULAR-PROVENANCE-CLEAR-SOURCE-V1',
          previousHardBlurItemKey: String(hardBlurItemKey || 'unknown'),
          currentStrictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
          previousSrc: String(hardBlurSrc || ''),
          currentSrc: String(normalizedPoster || normalizedCurrent || (videoNode.dataset && videoNode.dataset.mwSrc) || ''),
          nearbyShortsAnchorId: String(nearbyShortsAnchorId || 'unknown'),
          wasPreviouslyRegularPreserved: !!preserveCardBlurContinuityAfterNearbyShortsGuard,
        });
      }
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
      }
    } else if ((preserveShortsHardBlurDuringResolvedContinuity || preserveShortsHardBlurDuringGraceWindow) && hasAuthoritativeBlur) {
      console.log(
        '[MW-MVP-SHORTS-CONTINUITY-GUARD-V1] preserve_hard_blur_during_churn',
        'reason=' + String(reason || 'unknown'),
        'nodeId=' + String(videoNodeId || 'none'),
        'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
        'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
        'graceActive=' + String(!!preserveShortsHardBlurDuringGraceWindow),
        'graceAgeMs=' + String(Math.round(shortsAuthoritativeBlurAgeMs || 0))
      );
      postNonShortsTransitionDiag('shorts_preserve_hard_blur_during_churn', {
        reason: String(reason || 'unknown'),
        nodeId: String(videoNodeId || 'none'),
        marker: 'MW-MVP-SHORTS-CONTINUITY-GUARD-V1',
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
        graceActive: !!preserveShortsHardBlurDuringGraceWindow,
        graceAgeMs: Number.isFinite(shortsAuthoritativeBlurAgeMs) ? Math.round(shortsAuthoritativeBlurAgeMs) : -1,
      });
    }
    if (
      isMainSurfaceUrl &&
      regularPathQuarantinePassed &&
      !isHomeShortsShelfVideo &&
      !contextData &&
      !hasAuthoritativeBlur &&
      state.blurred &&
      state.blurred.size > 0
    ) {
      const resolvedUrl = normalizedPoster || normalizedCurrent || String((videoNode.dataset && videoNode.dataset.mwSrc) || '');
      const fallbackHasHardIdentityProof = !!(
        (
          strictIdentityKnown &&
          hardItemKeyKnown &&
          strictContinuityItemKey === hardBlurItemKey
        ) ||
        (
          !!resolvedUrl &&
          !!hardBlurSrc &&
          hardBlurSrc === resolvedUrl
        )
      );
      if (
        resolvedUrl &&
        state.blurred.has(resolvedUrl) &&
        fallbackHasHardIdentityProof &&
        !blockRegularFallbackNow
      ) {
        contextKind = 'state_blurred_fallback';
        contextData = {
          src: resolvedUrl,
          category: String((videoNode.dataset && videoNode.dataset.mwCategory) || 'flagged'),
          itemId: String((videoNode.dataset && videoNode.dataset.mwItemId) || reattachItemId || ''),
          blurPx: IS_YOUTUBE ? 40 : Math.min(CONFIG.blurStrength || 30, 20),
        };
        console.log(
          '[MW-FLICKER-STATE-BLURRED-FALLBACK-V1] state_blurred_fallback_hit',
          'reason=' + String(reason || 'unknown'),
          'nodeId=' + videoNodeId,
          'resolvedUrl=' + String(resolvedUrl || '').substring(0, 180)
        );
        postNonShortsTransitionDiag('state_blurred_fallback', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-FLICKER-STATE-BLURRED-FALLBACK-V1',
          resolvedUrl: String(resolvedUrl || '').substring(0, 180),
        });
      } else if (
        resolvedUrl &&
        state.blurred.has(resolvedUrl) &&
        fallbackHasHardIdentityProof &&
        blockRegularFallbackNow
      ) {
        console.log(
          '[MW-MVP-REGULAR-STATE-FALLBACK-BLOCKED-LANE-FLIP-QUARANTINE-V1] state_blurred_fallback_blocked_lane_flip_quarantine',
          'reason=' + String(reason || 'unknown'),
          'nodeId=' + videoNodeId,
          'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
          'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
          'resolvedUrl=' + String(resolvedUrl || '').substring(0, 180)
        );
        postNonShortsTransitionDiag('state_blurred_fallback_blocked_lane_flip_quarantine', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-MVP-REGULAR-STATE-FALLBACK-BLOCKED-LANE-FLIP-QUARANTINE-V1',
          strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
          hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
          byEpochGuard: !!regularGhostEpochBypassActive,
          byQuarantine: !!regularLaneFlipGhostQuarantineActive,
        });
      } else if (resolvedUrl && state.blurred.has(resolvedUrl) && !fallbackHasHardIdentityProof) {
        console.log(
          '[MW-MVP-REGULAR-STATE-FALLBACK-BLOCKED-UNPROVEN-V1] state_blurred_fallback_blocked_unproven',
          'reason=' + String(reason || 'unknown'),
          'nodeId=' + videoNodeId,
          'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown'),
          'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
          'resolvedUrl=' + String(resolvedUrl || '').substring(0, 180),
          'hardSrcMatchesResolved=' + String(!!(hardBlurSrc && hardBlurSrc === resolvedUrl))
        );
        postNonShortsTransitionDiag('state_blurred_fallback_blocked_unproven', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-MVP-REGULAR-STATE-FALLBACK-BLOCKED-UNPROVEN-V1',
          strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
          hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
          hardSrcMatchesResolved: !!(hardBlurSrc && hardBlurSrc === resolvedUrl),
        });
      }
    }
    let activeVideoBlurred = hasAuthoritativeBlur || hasIncidentalBlur;
    const preexistingOverlayInDeadEnd = !!(
      isMainSurfaceUrl &&
      isHomeShortsShelfVideo &&
      !contextData &&
      strictContinuityItemKey &&
      strictContinuityItemKey !== 'unknown' &&
      shortsItemKeyLookupMiss &&
      findRevealOverlayForElement(
        videoNode,
        String((videoNode.dataset && videoNode.dataset.mwSrc) || normalizedPoster || normalizedCurrent || '')
      )
    );
    const shortsNoContextLocalBlurHold = !!(
      isMainSurfaceUrl &&
      isHomeShortsShelfVideo &&
      !contextData &&
      strictContinuityItemKey &&
      strictContinuityItemKey !== 'unknown' &&
      shortsItemKeyLookupMiss &&
      !hasAuthoritativeBlur &&
      hasIncidentalBlur &&
      !preexistingOverlayInDeadEnd
    );
    if (shortsNoContextLocalBlurHold) {
      markAuthoritativeHardBlur(
        videoNode,
        String((videoNode.dataset && videoNode.dataset.mwSrc) || normalizedPoster || normalizedCurrent || '')
      );
      if (videoNode.dataset) {
        videoNode.dataset.mwHardBlurItemKey = String(strictContinuityItemKey || 'unknown');
      }
      hasAuthoritativeBlur = isAuthoritativeHardBlur(videoNode);
      activeVideoBlurred = hasAuthoritativeBlur || hasIncidentalBlur;
    } else if (
      activeVideoBlurred &&
      !hasAuthoritativeBlur &&
      !contextData &&
      !preserveShortsHardBlurDuringGraceWindow &&
      !regularPositiveContinuitySignal
    ) {
      if (isMainSurfaceUrl && !isHomeShortsShelfVideo && regularPathQuarantinePassed) {
        postNonShortsTransitionDiag('regular_provenance_clear_source', {
          reason: String(reason || 'unknown'),
          nodeId: videoNodeId,
          marker: 'MW-FLICKER-REGULAR-PROVENANCE-CLEAR-SOURCE-V1',
          previousHardBlurItemKey: String(hardBlurItemKey || 'unknown'),
          currentStrictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
          previousSrc: String(hardBlurSrc || ''),
          currentSrc: String(normalizedPoster || normalizedCurrent || (videoNode.dataset && videoNode.dataset.mwSrc) || ''),
          nearbyShortsAnchorId: String(nearbyShortsAnchorId || 'unknown'),
          wasPreviouslyRegularPreserved: !!preserveCardBlurContinuityAfterNearbyShortsGuard,
        });
      }
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
    } else if (
      activeVideoBlurred &&
      !hasAuthoritativeBlur &&
      !contextData &&
      preserveShortsHardBlurDuringGraceWindow
    ) {
      console.log(
        '[MW-MVP-SHORTS-CONTINUITY-GUARD-V1] preserve_incidental_blur_during_grace',
        'reason=' + String(reason || 'unknown'),
        'nodeId=' + String(videoNodeId || 'none'),
        'graceAgeMs=' + String(Math.round(shortsAuthoritativeBlurAgeMs || 0))
      );
    } else if (
      activeVideoBlurred &&
      !hasAuthoritativeBlur &&
      !contextData &&
      regularPositiveContinuitySignal
    ) {
      console.log(
        '[MW-MVP-REGULAR-THUMB-CONTINUITY-V2] preserve_incidental_blur_positive_continuity_signal',
        'reason=' + String(reason || 'unknown'),
        'nodeId=' + String(videoNodeId || 'none'),
        'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
        'strictContinuityItemKey=' + String(strictContinuityItemKey || 'unknown')
      );
      postNonShortsTransitionDiag('regular_main_preserve_incidental_blur_positive_continuity_signal', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-MVP-REGULAR-THUMB-CONTINUITY-V2',
        hardBlurItemKey: String(hardBlurItemKey || 'unknown'),
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
      });
    }
    if (activeVideoBlurred && hasAuthoritativeBlur) {
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
        videoNode.dataset.mwClassifiedEpoch = String(CONFIG.pageEpoch);
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
      applyBlur(videoNode, contextSrc, contextCategory, contextBlurStrength, contextItemId);
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
      !blockRegularFallbackNow &&
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
      !blockRegularFallbackNow &&
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
    const revealFallbackHasAnchoredOverlayProof = !!(
      videoOverlay &&
      videoOverlay.isConnected &&
      String((videoOverlay.dataset && videoOverlay.dataset.mwNodeId) || '') === videoNodeId &&
      overlayForItemKey &&
      overlayForItemKey !== 'unknown'
    );
    const revealFallbackHasExplicitUserIntent = !!isUserRevealIntentReason;
    const revealFallbackHasTrustedAutoIntent = !!(
      (pendingRevealActive || videoLikelyPlaying) &&
      revealFallbackHasAnchoredOverlayProof
    );
    const unresolvedOwnershipAtPlayIntent = !!(
      revealFallbackScopeEligible &&
      !blockRegularFallbackNow &&
      !contextData &&
      !hasAuthoritativeBlur &&
      !regularPositiveContinuitySignal &&
      !isNodeClassificationLocked(videoNode, reason) &&
      strictContinuityUnknown &&
      (reattachItemKey === 'unknown') &&
      (revealFallbackHasExplicitUserIntent || revealFallbackHasTrustedAutoIntent)
    );
    const shouldApplyRevealFallback = !!(
      unresolvedOwnershipAtPlayIntent &&
      ((videoOverlay && videoOverlay.isConnected) || hasResidualInlineBlur || hasResidualBlurClass)
    );
    if (
      isMainSurfaceUrl &&
      isHomeShortsShelfVideo &&
      !contextData &&
      !revealFallbackScopeEligible &&
      (isUserRevealIntentReason || pendingRevealActive || videoLikelyPlaying)
    ) {
      postNonShortsTransitionDiag('no_context_decision', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-FLICKER-NO-CONTEXT-DECISION-V1',
        cardNodeId: cardNodeId,
        strictContinuityItemKey: String(strictContinuityItemKey || 'unknown'),
        nearbyShortsAnchorId: String(nearbyShortsAnchorId || 'unknown'),
        reattachItemKey: String(reattachItemKey || 'unknown'),
        revealFallbackScopeEligible: !!revealFallbackScopeEligible,
        activeVideoBlurred: !!activeVideoBlurred,
        authoritativeBlur: !!hasAuthoritativeBlur,
        overlayPresent: !!videoOverlay,
        contextSize: Number((state.nonShortsReattachContext && state.nonShortsReattachContext.size) || 0),
      });
      // MVP: hold with soft blur while context is still resolving — prevents the
      // ~600ms flash between first loadeddata (no context yet) and second loadeddata
      // (authoritative context arrives). applyBlur() on the next event will replace this.
      if (reasonText === 'event:loadeddata' && !activeVideoBlurred && videoNode.isConnected) {
        videoNode.style.filter = 'blur(' + CONFIG.softBlurStrength + 'px)';
        videoNode.style.webkitFilter = 'blur(' + CONFIG.softBlurStrength + 'px)';
        videoNode.classList.add('mw-softblur');
        if (videoNode.dataset) videoNode.dataset.mwModerated = 'softblur';
        // Stamp authoritative hard blur so isNodeClassificationLocked can protect this
        // node via the mwHardBlurEpoch path even without a full applyBlur() call.
        markAuthoritativeHardBlur(videoNode, String((videoNode.dataset && videoNode.dataset.mwSrc) || ''));
        if (videoNode.dataset) videoNode.dataset.mwHardBlurItemKey = String(strictContinuityItemKey || 'unknown');
        mwDiagLog('[MW-FLICKER][NO-CONTEXT-HOLD] soft blur applied + authoritative stamp', 'nodeId=' + videoNodeId, 'key=' + String(strictContinuityItemKey || 'unknown'), 'hardBlurEpoch=' + String(CONFIG.pageEpoch));
      }
    }
    if (
      revealFallbackScopeEligible &&
      !contextData &&
      strictContinuityUnknown &&
      (reattachItemKey === 'unknown') &&
      !revealFallbackHasExplicitUserIntent &&
      (pendingRevealActive || videoLikelyPlaying) &&
      !revealFallbackHasTrustedAutoIntent
    ) {
      console.log(
        '[MW-MVP-REGULAR-REVEAL-FALLBACK-BLOCKED-STALE-INTENT-V1] reveal_fallback_blocked_stale_intent',
        'reason=' + String(reason || 'unknown'),
        'nodeId=' + videoNodeId,
        'pendingRevealActive=' + String(!!pendingRevealActive),
        'videoLikelyPlaying=' + String(!!videoLikelyPlaying),
        'overlayAnchoredProof=' + String(!!revealFallbackHasAnchoredOverlayProof)
      );
      postNonShortsTransitionDiag('reveal_fallback_blocked_stale_intent', {
        reason: String(reason || 'unknown'),
        nodeId: videoNodeId,
        marker: 'MW-MVP-REGULAR-REVEAL-FALLBACK-BLOCKED-STALE-INTENT-V1',
        pendingRevealActive: !!pendingRevealActive,
        videoLikelyPlaying: !!videoLikelyPlaying,
        overlayAnchoredProof: !!revealFallbackHasAnchoredOverlayProof,
      });
    }
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

  function runShortsHealthHealForContainer(container, reason) {
    if (!container || container.nodeType !== 1) return;
    const context = shortsBlurContextByContainer.get(container);
    if (!context || !context.src) return;
    const targetNode = context.targetNode && context.targetNode.nodeType === 1 ? context.targetNode : null;
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
    if (healthy) return;

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

    const refreshedContext = shortsBlurContextByContainer.get(container) || context;
    const refreshedTarget = (
      refreshedContext &&
      refreshedContext.targetNode &&
      refreshedContext.targetNode.nodeType === 1
    ) ? refreshedContext.targetNode : targetNode;
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

  function resolveRevealOverlayAnchorTarget(overlay) {
    if (!overlay || overlay.nodeType !== 1) return null;
    const bound = (
      overlay.__mwAnchorTarget &&
      overlay.__mwAnchorTarget.nodeType === 1 &&
      overlay.__mwAnchorTarget.isConnected
    ) ? overlay.__mwAnchorTarget : null;
    if (bound) return bound;
    if (isPortalRevealOverlay(overlay) && isShortsModeActive()) {
      return resolveShortsRevealOverlayAnchor(overlay);
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
      const auth = getAuthoritativeIdentityForNode(anchor);
      if (!auth.authoritative) {
        rejectReason = 'not_authoritative_blur';
      } else if (!doesRevealOverlayIdentityMatch(anchor, overlayIdentity)) {
        rejectReason = 'identity_mismatch';
      } else if (!isRevealOverlayScopeValid(overlay, anchor)) {
        rejectReason = 'scope_mismatch';
      } else if (portalOverlay) {
        const ctx = getShortsBlurContextForNode(anchor);
        const token = String((overlay.dataset && overlay.dataset.mwShortsOwnerToken) || '');
        if (!ctx || !ctx.ownerToken || !token || token !== String(ctx.ownerToken || '')) {
          rejectReason = 'shorts_owner_mismatch';
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
    if (visibleRect.width < 16 || visibleRect.height < 16) {
      overlay.style.display = 'none';
      setRevealOverlayAnchorTarget(overlay, null, 'position_anchor_not_visible');
      scheduleShortsRevealOverlayRetry(overlay, 'anchor_not_visible');
      if (DIAG_YT_BLUR) {
        console.log(
          '[DIAG][REVEAL_POS] hidden',
          'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
          'reason=' + (reason || 'unknown'),
          'hideReason=anchor_not_visible',
          'anchorRect=' + Math.round(rect.left) + ',' + Math.round(rect.top) + ',' + Math.round(rect.width) + 'x' + Math.round(rect.height)
        );
      }
      return false;
    }
    overlay.style.display = 'flex';
    overlay.dataset.mwPosRetryCount = '0';
    const centerX = Math.max(24, Math.min(viewportWidth - 24, Math.round(visibleRect.left + (visibleRect.width / 2))));
    const centerY = Math.max(28, Math.min(viewportHeight - 28, Math.round(visibleRect.top + (visibleRect.height / 2))));
    if (badge && badge.nodeType === 1) {
      badge.style.position = 'absolute';
      badge.style.left = Math.max(8, Math.min(viewportWidth - 100, Math.round(visibleRect.left + 8))) + 'px';
      badge.style.top = Math.max(8, Math.min(viewportHeight - 28, Math.round(visibleRect.top + 8))) + 'px';
    }
    if (btn && btn.nodeType === 1) {
      btn.style.position = 'absolute';
      btn.style.left = centerX + 'px';
      btn.style.top = centerY + 'px';
      btn.style.transform = 'translate(-50%, -50%)';
    }
    if (DIAG_YT_BLUR) {
      console.log(
        '[DIAG][REVEAL_POS] placed',
        'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
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
    if (retryCount >= 24) return;
    overlay.dataset.mwPosRetryCount = String(retryCount + 1);
    if (timerState.revealOverlayRetryTimeout) return;
    timerState.revealOverlayRetryTimeout = setTimeout(function() {
      timerState.revealOverlayRetryTimeout = null;
      scheduleShortsRevealOverlayReposition('retry:' + (reason || 'unknown'));
    }, 120);
  }

  function cancelShortsRevealOverlayReposition(reason) {
    if (timerState.revealOverlayRepositionRaf && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(timerState.revealOverlayRepositionRaf);
    }
    timerState.revealOverlayRepositionRaf = null;
    timerState.revealOverlayLastReason = '';
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
      scheduleShortsRevealOverlayReposition('window_scroll');
    };
    timerState.revealOverlayResizeHandler = function() {
      scheduleShortsRevealOverlayReposition('window_resize');
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
    if (shortsMode) {
      const portal = document.getElementById(REVEAL_PORTAL_ID);
      if (portal && typeof portal.querySelectorAll === 'function') {
        const overlays = portal.querySelectorAll('.mw-reveal-overlay');
        for (let i = 0; i < overlays.length; i += 1) {
          const overlay = overlays[i];
          if (!overlay || !overlay.isConnected) continue;
          if (overlay.dataset.mwNodeId === nodeId) return overlay;
          if (src && overlay.dataset.mwFor === src) return overlay;
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
        if (!shortsMode && src && overlay.dataset.mwFor === src && isAuthoritativeHardBlur(node)) return overlay;
      }
    }
    return null;
  }

  function resolveNonShortsRevealOverlayParent(node) {
    if (!node || node.nodeType !== 1) return null;
    const immediateParent = node.parentElement;
    if (!immediateParent) return null;

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
  // Classification Persistence: hard blur is terminal within a page epoch.
  // Only a user-reveal action or node destruction can clear it.
  function isNodeClassificationLocked(element, reason) {
    if (!element || !element.dataset) return false;
    if (!element.isConnected) return false; // node destroyed — lock lifted
    const isUserReveal = typeof reason === 'string' && (
      reason.indexOf('reveal') !== -1 ||
      reason.indexOf('user_intent') !== -1
    );
    const isSafeDecontaminate = typeof reason === 'string' &&
      reason.indexOf('safe_decontaminate') !== -1;
    const isRegularVideoThumbGhostDecontaminate = typeof reason === 'string' &&
      reason.indexOf('regular_video_transition_ghost_decontaminate') !== -1;
    if (isUserReveal) return false; // user action always wins
    if (isSafeDecontaminate) return false; // safe mismatch cleanup must be allowed
    if (isRegularVideoThumbGhostDecontaminate) return false; // unresolved regular-video ghost clear must be allowed
    // Path A: fully classified via applyBlur (mwModerated=blurred + epoch stamp)
    const state = String(element.dataset.mwModerated || '');
    // softblur is a provisional hold — scan result hasn't arrived yet. Never lock
    // these nodes: if scan returns safe, clearAllBlurAndOverlay must be able to clear.
    if (state === 'softblur') return false;
    if (state === 'blurred') {
      const classifiedEpoch = Number(element.dataset.mwClassifiedEpoch || 0);
      if (classifiedEpoch > 0 && classifiedEpoch === CONFIG.pageEpoch) return true;
    }
    // Path B: authoritative hard blur tracked via markAuthoritativeHardBlur (covers
    // nodes promoted from incidental/softblur without going through applyBlur)
    const hardBlur = String(element.dataset.mwHardBlur || '') === '1';
    if (hardBlur) {
      const hardBlurEpoch = Number(element.dataset.mwHardBlurEpoch || 0);
      if (hardBlurEpoch > 0 && hardBlurEpoch === CONFIG.pageEpoch) return true;
    }
    // Same-nav continuity lock: protect proven-positive thumbnails during SPA epoch churn.
    if (hardBlur) {
      const hardBlurNav = String(element.dataset.mwHardBlurNav || 'none');
      const currentNav = String(NAV_ID || 'none');
      const hardBlurSrc = normalizeUrl(String(element.dataset.mwHardBlurSrc || '')) || '';
      const nodeSrc = normalizeUrl(String(element.dataset.mwSrc || '')) || '';
      const srcContinuity = !!(hardBlurSrc && nodeSrc && hardBlurSrc === nodeSrc);
      const hardBlurSrcInBlurredSet = !!(
        hardBlurSrc &&
        state.blurred &&
        typeof state.blurred.has === 'function' &&
        state.blurred.has(hardBlurSrc)
      );
      if (hardBlurNav === currentNav && srcContinuity && hardBlurSrcInBlurredSet) {
        return true;
      }
    }
    return false;
  }

  function clearAllBlurAndOverlay(element, src, reason, nextModeratedState) {
    if (!element || element.nodeType !== 1) return false;
    if (isNodeClassificationLocked(element, reason)) {
      mwDiagLog('[MW-PERSIST] clearAllBlurAndOverlay blocked — classification locked', 'reason=' + String(reason || ''), 'node=' + getDiagNodeId(element));
      return false;
    }
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
      element.dataset.mwPreblurClear = 'true';
      element.dataset.mwOverlayOwnerToken = '';
      element.dataset.mwShortsOwnerToken = '';
      element.dataset.mwHardBlur = '0';
      element.dataset.mwHardBlurItemKey = '';
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
      if (isYouTubeMainPageShortsShelfVideoNode(node)) {
        rememberShortsAuthoritativeBlurMoment(node, null);
      }
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
      shortsAuthoritativeBlurAtByNode.delete(node);
    } catch (e) {}
  }

  // Shorts fail-closed guard: ownership churn may invalidate reveal UI identity,
  // but must not clear established blur on the active node.
  function quarantineShortsRevealOverlay(node, src, reason) {
    if (!node || node.nodeType !== 1) return;
    try {
      const overlay = findRevealOverlayForElement(node, src || (node.dataset && node.dataset.mwSrc) || '');
      if (overlay && overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
      }
      node.dataset.mwHasOverlay = 'false';
      node.dataset.mwOverlayOwnerToken = '';
      node.dataset.mwOwnerMismatchRetryScheduled = 'false';
      console.log(
        '[DIAG][REVEAL_UI] shorts_overlay_quarantined',
        'node=' + getDiagNodeId(node),
        'reason=' + String(reason || 'unknown'),
        'moderated=' + String(node.dataset.mwModerated || 'none'),
        'hardBlur=' + String(node.dataset.mwHardBlur || '0')
      );
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
    if (isRevealedForSource(src, element)) return;
    
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
          createRevealOverlay(element, src, category, itemId, false);
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
      // Force blur with !important for iOS WebKit.
      // Zero any existing transition first so a re-apply after reveal doesn't
      // animate in over 300ms (which would leave content briefly visible).
      element.style.setProperty('transition', 'none', 'important');
      element.style.setProperty('filter', 'blur(' + blurPx + 'px)', 'important');
      element.style.setProperty('-webkit-filter', 'blur(' + blurPx + 'px)', 'important');
      element.style.setProperty('backdrop-filter', 'blur(' + blurPx + 'px)', 'important');
      element.style.setProperty('-webkit-backdrop-filter', 'blur(' + blurPx + 'px)', 'important');
      // Re-enable smooth transition for future user-reveal animation after one paint frame.
      // removeProperty clears the 'none !important' override so it doesn't permanently
      // suppress future transitions; then we set the non-important value for the reveal.
      requestAnimationFrame(function() {
        try {
          element.style.removeProperty('transition');
          element.style.transition = 'filter 0.3s ease';
        } catch (_e) {}
      });
      element.dataset.mwModerated = 'blurred';
      element.dataset.mwClassifiedEpoch = String(CONFIG.pageEpoch);
      element.dataset.mwCategory = category || 'flagged';
      element.dataset.mwSrc = src;
      element.dataset.mwItemId = itemId || '';
      markAuthoritativeHardBlur(element, src);
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
    const shortsMode = isShortsModeActive();
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
        resolvedTarget.style.setProperty('transition', 'none', 'important');
        resolvedTarget.style.setProperty('filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
        resolvedTarget.style.setProperty('-webkit-filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
        resolvedTarget.style.setProperty('backdrop-filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
        resolvedTarget.style.setProperty('-webkit-backdrop-filter', 'blur(' + resolvedBlurPx + 'px)', 'important');
        requestAnimationFrame(function() {
          try {
            resolvedTarget.style.removeProperty('transition');
            resolvedTarget.style.transition = 'filter 0.3s ease';
          } catch (_e) {}
        });
        resolvedTarget.dataset.mwModerated = 'blurred';
        resolvedTarget.dataset.mwClassifiedEpoch = String(CONFIG.pageEpoch);
        resolvedTarget.dataset.mwCategory = category || 'flagged';
        resolvedTarget.dataset.mwSrc = src;
        resolvedTarget.dataset.mwItemId = itemId || '';
        resolvedTarget.dataset.mwShortsStableSelector = resolvedSelector || '';
        markAuthoritativeHardBlur(resolvedTarget, src);
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
      if (!activeOwnerToken || !elementOwnerToken || activeOwnerToken !== elementOwnerToken) {
        const mismatchCountRaw = Number(element.dataset.mwOwnerMismatchCount || '0');
        const mismatchCount = Number.isFinite(mismatchCountRaw) ? mismatchCountRaw : 0;
        if (mismatchCount < 1) {
          element.dataset.mwOwnerMismatchCount = '1';
          if (element.dataset.mwOwnerMismatchRetryScheduled !== 'true') {
            element.dataset.mwOwnerMismatchRetryScheduled = 'true';
            setTimeout(function() {
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
        element.dataset.mwOwnerMismatchCount = '0';
        element.dataset.mwOwnerMismatchRetryScheduled = 'false';
        quarantineShortsRevealOverlay(
          element,
          src || (activeContext && activeContext.src) || '',
          'createRevealOverlay_owner_mismatch'
        );
        return;
      }
      element.dataset.mwOwnerMismatchCount = '0';
      element.dataset.mwOwnerMismatchRetryScheduled = 'false';
      shortsOwnerToken = activeOwnerToken;
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
          quarantineShortsRevealOverlay(element, src, 'createRevealOverlay_existing_owner_mismatch');
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
      if (shortsMode) {
        setRevealOverlayAnchorTarget(existingOverlay, element, 'existing_overlay');
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
            }
          }
        }
        positionShortsRevealOverlay(existingOverlay, element, 'existing_overlay');
        scheduleShortsRevealOverlayReposition('existing_overlay');
        console.log('[DIAG][REVEAL_UI] portal_update', 'itemKey=' + getDiagItemKey(src));
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
          'background: rgba(0, 0, 0, 0.3)',
          'z-index: 9998',
          'cursor: default',
          'pointer-events: none',
        ].join(';');
        const existingButton = existingOverlay.querySelector ? existingOverlay.querySelector('.mw-reveal-btn') : null;
        if (existingButton && existingButton.nodeType === 1) {
          existingButton.style.pointerEvents = 'auto';
          existingButton.style.position = '';
          existingButton.style.left = '';
          existingButton.style.top = '';
          existingButton.style.right = '';
          existingButton.style.bottom = '';
          existingButton.style.transform = '';
        }
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
    const overlayParent = shortsMode ? ensureRevealPortal() : (resolveNonShortsRevealOverlayParent(element) || parent);
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
    if (shortsMode && shortsOwnerToken) {
      overlay.dataset.mwShortsOwnerToken = shortsOwnerToken;
      element.dataset.mwOverlayOwnerToken = shortsOwnerToken;
    }
    overlay.dataset.mwOverlayId = overlayId;
    setRevealOverlayAnchorTarget(overlay, element, 'overlay_created');
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
    btn.textContent = isRevealedForSource(src, element) ? '🔒 Hide' : '👁 Reveal';
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
      console.log(
        '[DIAG][REVEAL_EVT] button_click',
        'overlayId=' + overlayId,
        'target=' + getDiagTargetDescriptor(e.target)
      );
      if (!shortsMode && isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)) {
        console.log(
          '[DIAG][MVP_REVEAL_PATH] tap_received',
          'channel=button',
          'overlayId=' + overlayId,
          'itemKey=' + itemKey
        );
      }
      logRevealHittestSnapshot(overlay, btn, overlayId, 'button_click', e);
      const revealMeta = getRevealMetaForSource(src, element);
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
        unmarkRevealedForSource(src, element, 'manual_hide');
        applyBlur(element, src, category, CONFIG.blurStrength, itemId);
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
        const revealApplied = markRevealedForSource(src, element, 'manual_reveal');
        // Shorts MVP: a single tap should fully reveal and clear the overlay
        // to avoid a second tap requirement on active shorts.
        removeBlur(element, src, { keepOverlay: false });
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
      }
    });
    console.log('[DIAG][REVEAL_UI] bind_button', 'overlayId=' + overlayId);
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
      console.log('[DIAG][REVEAL_UI] portal_update', 'itemKey=' + itemKey);
    }
    overlayParent.appendChild(overlay);
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
      thresholds: effectiveThresholds,
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
            thresholds: effectiveThresholds,
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
      const shouldCacheScannedSrc = !(rawCategory === 'safe_epoch_stale' || rawCategory === 'safe_sovereign_stale');
      if (shouldCacheScannedSrc) {
        state.scanned.add(src);
      } else {
        clearElementScanDedupeMarkers(element, 'stale_safe_result');
      }
      
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
          const normalizedSafeResultSrc = normalizeUrl(String(src || '')) || '';
          const hardBlurActive = String((element.dataset && element.dataset.mwHardBlur) || '') === '1';
          const hardBlurSrc = normalizeUrl(String((element.dataset && element.dataset.mwHardBlurSrc) || '')) || '';
          const hardBlurItemKey = String((element.dataset && element.dataset.mwHardBlurItemKey) || 'unknown');
          const safeResultItemKey = getDiagItemKey(normalizedSafeResultSrc || String(src || ''));
          const safeResultHardBlurMismatch = !!(
            !isShortsModeActive() &&
            isYouTubeMainPageThumbnailSurfaceUrl(window.location.href) &&
            hardBlurActive &&
            (
              (normalizedSafeResultSrc && hardBlurSrc && hardBlurSrc !== normalizedSafeResultSrc) ||
              (
                safeResultItemKey &&
                safeResultItemKey !== 'unknown' &&
                hardBlurItemKey &&
                hardBlurItemKey !== 'unknown' &&
                hardBlurItemKey !== safeResultItemKey
              )
            )
          );
          if (safeResultHardBlurMismatch) {
            const decontaminateReason = 'result_safe_decontaminate_stale_hard_blur_mismatch';
            const decontaminateCleared = clearAllBlurAndOverlay(
              element,
              normalizedSafeResultSrc || src,
              decontaminateReason,
              'safe'
            );
            console.log(
              '[MW-MVP-REGULAR-SAFE-DECONTAMINATE-V1] safe_result_decontaminate_hard_mismatch',
              'itemId=' + String(itemId || 'none'),
              'nodeId=' + getDiagNodeId(element),
              'cleared=' + String(!!decontaminateCleared),
              'hardBlurItemKey=' + String(hardBlurItemKey || 'unknown'),
              'safeResultItemKey=' + String(safeResultItemKey || 'unknown'),
              'hardBlurSrc=' + String(hardBlurSrc || '').substring(0, 120),
              'safeResultSrc=' + String(normalizedSafeResultSrc || '').substring(0, 120)
            );
          }
          if (wasInSoftBlur && !finalBlur) {
            state.stats.semanticDelaySaved++;
          }
        }
      }
      
      // Also find any other elements with the same src
      if (finalBlur) {
        clearSafeResolved(src);
        findAndBlur(src, predictedLabel || category, CONFIG.blurStrength, true, itemId);
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
      // Re-apply blur to recycled DOM nodes (virtual-scroll removes/re-adds elements).
      // When the URL was previously blurred but the new element has no blur markers,
      // apply blur immediately without re-scanning to close the visibility gap.
      if (
        !isShortsModeActive() &&
        state.blurred.has(url) &&
        element &&
        element.nodeType === 1 &&
        element.isConnected &&
        !isRevealedForSource(url, element) &&
        element.dataset.mwModerated !== 'blurred'
      ) {
        // Fresh DOM node from virtual-scroll rehide: dataset fields will be empty so
        // the fallbacks (CONFIG.blurStrength / 'flagged') are used.  The category is
        // display/logging-only; the important thing is that blur strength matches CONFIG.
        const reattachCategory = String((element.dataset && element.dataset.mwCategory) || 'flagged');
        const reattachBlurPx = Number((element.dataset && element.dataset.mwBlurStrength) || '') || CONFIG.blurStrength;
        mwDiagLog(
          '[MW-FLICKER][VSCROLL_REBLUR] virtual-scroll node needs re-blur',
          'src=' + url.substring(0, 120),
          'node=' + getDiagNodeId(element),
          'sourceType=' + (sourceType || 'unknown'),
          'category=' + reattachCategory,
          'blurPx=' + reattachBlurPx,
          'moderated=' + (element.dataset.mwModerated || 'none'),
          'connected=' + element.isConnected
        );
        applyBlur(element, url, reattachCategory, reattachBlurPx, null);
        logShortsScanSkip('cache_scanned_reblur_applied', null, url, sourceType);
      }
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
    
    // On Shorts, avoid pre-blur before verdict to prevent false first-entry blur.
    // We only blur once moderation returns a positive result.
    const shortsMode = isShortsModeActive();
    if (shortsMode) {
      removeSoftBlur(element, url);
      if (CONFIG.debug) {
        console.log(
          '[DIAG][SHORTS_PREBLUR]',
          'action=skip_preblur',
          'itemId=' + itemId,
          'sourceType=' + String(sourceType || 'unknown'),
          'url=' + String(url).substring(0, 180)
        );
      }
    } else {
      // Non-Shorts keeps pre-blur to minimize flashes.
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
          } else {
            mwDiagLog('[MW-FLICKER][VIEWPORT] re-entry blocked by mwViewportQueued guard — node=' + (element.dataset.mwNodeId || element.tagName || 'unknown') + ' src=' + String(element.src || element.dataset.mwLastScanSrc || '').substring(0, 80));
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
    // Node recycled with new content: clear stale moderation markers so the new src
    // gets a fresh scan and soft blur is not blocked by a prior safe decision.
    if (img.dataset.mwOrigSrc && img.dataset.mwOrigSrc !== src) {
      mwDiagLog(
        '[MW-FLICKER][RECYCLE] img node recycled - stale markers cleared',
        'node=' + getDiagNodeId(img),
        'prevSrc=' + img.dataset.mwOrigSrc.substring(0, 120),
        'newSrc=' + src.substring(0, 120),
        'wasModerated=' + (img.dataset.mwModerated || 'none'),
        'wasScanned=' + (img.dataset.mwScanned || 'false')
      );
      img.dataset.mwModerated = '';
      img.dataset.mwScanned = 'false';
      img.dataset.mwPreblurClear = '';
      img.dataset.mwViewportQueued = '';
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
      if (video.dataset.mwLastShortsFrameAttemptKey !== shortsFrameKey) {
        video.dataset.mwLastShortsFrameAttemptKey = shortsFrameKey;
        const frameCapture = tryCaptureActiveShortsVideoFrame(video);
        if (frameCapture.ok && frameCapture.src) {
          const queuedFrame = queueForScan(frameCapture.src, video, 'video-frame');
          if (queuedFrame) {
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
        } else {
          logScanSourceFallback(
            frameCapture.reason || 'frame_capture_failed',
            videoNodeId,
            videoCurrentSrc,
            'sourceType=video-frame'
          );
        }
      } else {
        diagScanRunLog('scanVideoPoster', video, '', false, 'reason=frame_attempt_already_done_for_active_key');
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
    refreshAdaptiveShortsOverlayWatch('scanActiveShortsPlayerContainer:' + (reason || 'unknown'));
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
      if (!CONFIG.enabled || CONFIG.sensitivity === 0) return;
      
      let hasYouTubeChanges = false;
      shortsAttrMode = reevaluateShortsObserverMode('mutation_batch', window.location.href).mode;
      
      for (const mutation of mutations) {
        mutation.removedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          pruneDisconnectedPending('mutation_removed');
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
          
          // Privacy by Default: soft-blur img/video on DOM entry before scan completes.
          // Prevents flash of unblurred content during the scan latency window.
          // Skips nodes already classified, user-revealed, or in Shorts mode (handled separately).
          if (
            node.isConnected &&
            node.nodeType === 1 &&
            !isShortsModeActive() &&
            isYouTubeMainPageThumbnailSurfaceUrl(window.location.href)
          ) {
            const _tag = String(node.tagName || '').toLowerCase();
            const _state = String((node.dataset && node.dataset.mwModerated) || '');
            if ((_tag === 'img' || _tag === 'video') && _state === '' && _state !== 'revealed') {
              node.style.filter = 'blur(' + CONFIG.softBlurStrength + 'px)';
              node.style.webkitFilter = 'blur(' + CONFIG.softBlurStrength + 'px)';
              node.classList.add('mw-softblur');
              node.dataset.mwModerated = 'softblur';
            }
          }
          // Add to viewport observer for lazy scanning
          observeForViewport(node);
          queueMutationScan(node, 'mutation_added');
        });
        
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          const attr = mutation.attributeName || '';
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
            if (
              (attr === 'src' || attr === 'poster') &&
              state.blurred &&
              state.blurred.size > 0
            ) {
              const prevSrc = normalizeUrl(
                String(target.dataset.mwLastScanSrc || target.dataset.mwSrc || target.dataset.mwOrigSrc || '')
              ) || '';
              if (prevSrc && state.blurred.has(prevSrc)) {
                const newAttrRaw = attr === 'src'
                  ? String(target.src || target.getAttribute('src') || '')
                  : String(target.getAttribute('poster') || '');
                const newAttrSrc = normalizeUrl(newAttrRaw) || '';
                if (newAttrSrc) {
                  applySoftBlur(target, newAttrSrc, String((target.dataset && target.dataset.mwItemId) || ''));
                  console.log(
                    '[MW-FLICKER-VIDEO-PREBLUR-V1] pre_blur_on_attr_src',
                    'attr=' + attr,
                    'nodeId=' + getDiagNodeId(target),
                    'prevSrc=' + String(prevSrc || '').substring(0, 100),
                    'newSrc=' + String(newAttrSrc || '').substring(0, 100)
                  );
                }
              }
            }
            diagNonShortsReattach(target, 'attr:' + attr);
          }
          // Non-Shorts YouTube: when img src changes in-place, clear stale scan markers
          // so the recycled node gets a fresh scan with soft blur applied immediately.
          if (
            isYouTube() &&
            !isShortsModeActive() &&
            target &&
            target.nodeType === 1 &&
            String(target.tagName || '').toUpperCase() === 'IMG' &&
            attr === 'src'
          ) {
            const newSrc = target.src || '';
            const lastScanSrc = target.dataset.mwLastScanSrc || '';
            if (newSrc && lastScanSrc && lastScanSrc !== newSrc) {
              mwDiagLog(
                '[MW-FLICKER][SRC_SWAP] in-place img src changed - scan markers cleared',
                'node=' + getDiagNodeId(target),
                'prevSrc=' + lastScanSrc.substring(0, 120),
                'newSrc=' + newSrc.substring(0, 120),
                'wasModerated=' + (target.dataset.mwModerated || 'none'),
                'connected=' + target.isConnected
              );
              target.dataset.mwScanned = 'false';
              target.dataset.mwLastScanSrc = '';
              target.dataset.mwPreblurClear = '';
              target.dataset.mwOrigSrc = '';
              target.dataset.mwModerated = '';
              target.dataset.mwViewportQueued = '';
              queueMutationScan(target, 'attr:src_img_changed');
            }
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
          diagLogApplyByItemId(
            itemId,
            src,
            el,
            'applyPath=item_identity_legacy sourceType=' + (pending.sourceType || 'unknown')
          );
          applyBlur(el, src, category, blurStrengthPx, itemId);
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
    scheduleShortsRevealOverlayReposition('main_scroll');
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
  const checkUrlChange = () => {
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
      const previousIsShorts = isYouTubeShortsUrl(previousUrl);
      const nextIsShorts = isYouTubeShortsUrl(nextUrl);
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
      // Bound blur ownership to the active surface after SPA URL transitions.
      // Without this, stale src-based blur memory can reattach onto unrelated cards.
      cleanupExpiredSafeResolved();
      state.safeResolved.clear();
      state.safeResolvedAt.clear();
      state.blurred.clear();
      if (state.nonShortsReattachContext && typeof state.nonShortsReattachContext.clear === 'function') {
        state.nonShortsReattachContext.clear();
      }
      if (state.regularMainCardBlurLatch && typeof state.regularMainCardBlurLatch.clear === 'function') {
        state.regularMainCardBlurLatch.clear();
      }
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
