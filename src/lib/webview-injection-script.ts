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
    const SHORTS_PROBE_PREFIX = '[DIAG][SHORTS_PROBE]';
    const previousShortsProbeGenerationSeq = Number(window.__MW_SHORTS_PROBE_GEN_SEQ__ || 0);
    const shortsProbeGenerationSeq = Number.isFinite(previousShortsProbeGenerationSeq) ? (previousShortsProbeGenerationSeq + 1) : 1;
    window.__MW_SHORTS_PROBE_GEN_SEQ__ = shortsProbeGenerationSeq;
    const SHORTS_PROBE_GENERATION_ID = 'g' + shortsProbeGenerationSeq + '_' + Date.now().toString(36);
    function logShortsProbe(eventName, details) {
      if (!isYouTubeShortsUrl(window.location.href)) return;
      console.log(
        SHORTS_PROBE_PREFIX,
        'event=' + (eventName || 'unknown'),
        'generationId=' + SHORTS_PROBE_GENERATION_ID,
        details || ''
      );
    }
  
  // ==================== INITIALIZATION ====================
  
  // Prevent double injection
  logShortsProbe(
    'generation_attempt',
    'url=' + window.location.href +
    ' navId=' + String(window.__MW_NAV_ID__ || 'none') +
    ' pageEpoch=' + (Number.isFinite(${pageEpoch}) ? ${pageEpoch} : 'none')
  );
  if (window.__MW_ACTIVE__) {
    const reinjectShortsVideoId = getCurrentShortsUrlId() || 'none';
    const existingRevealOverlay = document.getElementById('mw-reveal-overlay');
    const existingOverlayVideoId = resolveRevealOverlayShortsVideoId(existingRevealOverlay);
    if (
      existingRevealOverlay &&
      reinjectShortsVideoId !== 'none' &&
      existingOverlayVideoId === reinjectShortsVideoId
    ) {
      logShortsProbe(
        'reinject_abort_overlay_stable',
        'url=' + window.location.href +
        ' shortsUrlId=' + reinjectShortsVideoId +
        ' overlayVideoId=' + existingOverlayVideoId
      );
      return 'MW_REINJECT_ABORT_OVERLAY_STABLE';
    }
    logShortsProbe(
      'generation_skip_already_active',
      'url=' + window.location.href +
      ' navId=' + String(window.__MW_NAV_ID__ || 'none') +
      ' pageEpoch=' + (Number.isFinite(${pageEpoch}) ? ${pageEpoch} : 'none') +
      ' activeGenerationId=' + String(window.__MW_SHORTS_PROBE_ACTIVE_GENERATION_ID__ || 'none')
    );
    console.log('[MW] Already injected, skipping');
    try {
      if (window.__MW_BLUR_OVERLAY_API__ && typeof window.__MW_BLUR_OVERLAY_API__.sendReady === 'function') {
        window.__MW_BLUR_OVERLAY_API__.sendReady('reinject');
      }
    } catch (e) {}
    return 'MW_ALREADY_ACTIVE';
  }
  window.__MW_ACTIVE__ = true;
  window.__MW_SHORTS_PROBE_ACTIVE_GENERATION_ID__ = SHORTS_PROBE_GENERATION_ID;
  logShortsProbe(
    'generation_attach',
    'url=' + window.location.href +
    ' navId=' + String(window.__MW_NAV_ID__ || 'none') +
    ' pageEpoch=' + (Number.isFinite(${pageEpoch}) ? ${pageEpoch} : 'none')
  );
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
  const LAYER_GLOBAL_BLUR_Z = 2147483646;
  const LAYER_REVEAL_PORTAL_Z = 2147483647;
  const DOM_OVERLAY_ENABLED = true;
  const HARD_GLASS_BACKDROP_FILTER = 'blur(20px) brightness(0.8)';
  const HARD_GLASS_BACKGROUND = 'rgba(255, 255, 255, 0.1)';
  const REVEAL_TRANSITION_CSS = 'filter 0.3s ease-in-out, opacity 0.3s ease-in-out';
  const REVEAL_TRANSITION_MS = 300;

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
      'z-index: ' + String(LAYER_GLOBAL_BLUR_Z) + ' !important;',
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

  function computeSovereignId(pageEpochHint) {
    const normalizedEpoch = Number.isFinite(pageEpochHint)
      ? Number(pageEpochHint)
      : (
          Number.isFinite(window.__MW_HOST_PAGE_EPOCH__)
            ? Number(window.__MW_HOST_PAGE_EPOCH__)
            : (Number.isFinite(CONFIG.pageEpoch) ? Number(CONFIG.pageEpoch) : null)
        );
    const shortsVideoId = getCurrentShortsUrlId() || 'none';
    const currentNavId = String(window.__MW_NAV_ID__ || 'none');
    return currentNavId +
      '|' + String(normalizedEpoch === null ? 'none' : normalizedEpoch) +
      '|' + shortsVideoId;
  }

  function parseSovereignId(value) {
    const serialized = String(value || '');
    const parts = serialized.split('|');
    return {
      navId: parts[0] || 'none',
      pageEpoch: parts[1] || 'none',
      videoId: parts[2] || 'none',
    };
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
    const readyReason = reason || 'ready';
    const readyPageEpoch = Number.isFinite(window.__MW_HOST_PAGE_EPOCH__)
      ? Number(window.__MW_HOST_PAGE_EPOCH__)
      : (Number.isFinite(CONFIG.pageEpoch) ? Number(CONFIG.pageEpoch) : null);
    const readyHostNavId = Number.isFinite(window.__MW_HOST_NAV_ID__)
      ? Number(window.__MW_HOST_NAV_ID__)
      : null;
    const readyActiveInstanceId = Number.isFinite(window.__MW_ACTIVE_INSTANCE_ID__)
      ? Number(window.__MW_ACTIVE_INSTANCE_ID__)
      : null;
    const shortsVideoId = getCurrentShortsUrlId() || 'none';
    const currentNavId = String(window.__MW_NAV_ID__ || 'none');
    const sovereignId = computeSovereignId(readyPageEpoch);
    logShortsProbe(
      'mw_blur_ready_emit',
      'reason=' + readyReason +
      ' navId=' + currentNavId +
      ' pageEpoch=' + (readyPageEpoch === null ? 'none' : readyPageEpoch) +
      ' hostPageEpoch=' + String(window.__MW_HOST_PAGE_EPOCH__ || 'none') +
      ' shortsUrlId=' + shortsVideoId +
      ' sovereignId=' + sovereignId
    );
    postToHost({
      type: 'MW_BLUR_READY',
      reason: readyReason,
      url: window.location.href,
      navId: currentNavId,
      hostNavId: readyHostNavId,
      pageEpoch: readyPageEpoch,
      hostActiveInstanceId: readyActiveInstanceId,
      shortsUrlId: shortsVideoId,
      sovereignId: sovereignId,
      timestamp: Date.now(),
    });
  }

  function emitJsOverlayStateSignal(jsBlurApplied, jsRevealApplied, reason, src) {
    if (!isShortsModeActive()) return;
    try {
      postToHost({
        type: 'MW_JS_REVEAL_STATE',
        jsBlurApplied: jsBlurApplied === true,
        jsRevealApplied: jsRevealApplied === true,
        reason: reason || 'unknown',
        src: String(src || '').substring(0, 220),
        navId: String(window.__MW_NAV_ID__ || NAV_ID || 'none'),
        pageEpoch: Number.isFinite(state.pageEpoch) ? Number(state.pageEpoch) : null,
        shortsUrlId: getCurrentShortsUrlId() || 'none',
        sovereignId: computeSovereignId(state.pageEpoch),
        timestamp: Date.now(),
      });
    } catch (e) {}
  }

  function getShortsRevealSetKeys(videoId) {
    const normalizedId = String(videoId || '').trim();
    if (!normalizedId || normalizedId === 'none') return [];
    return [normalizedId, 'shorts_video:' + normalizedId];
  }

  function hasRevealLockForShortsVideoId(videoId) {
    if (!isShortsModeActive()) return false;
    const revealedSet = window.__MW_REVEALED_SET__;
    if (!revealedSet || typeof revealedSet.has !== 'function') return false;
    const revealKeys = getShortsRevealSetKeys(videoId);
    for (let i = 0; i < revealKeys.length; i += 1) {
      if (revealedSet.has(revealKeys[i])) return true;
    }
    return false;
  }

  function isCurrentShortsVideoRevealed() {
    if (!isShortsModeActive()) return false;
    const shortsVideoId = getCurrentShortsUrlId() || 'none';
    if (!shortsVideoId || shortsVideoId === 'none') return false;
    return hasRevealLockForShortsVideoId(shortsVideoId);
  }

  function stopForceRevealEnforcement(reason) {
    if (forceRevealEnforcementState.observer) {
      try {
        forceRevealEnforcementState.observer.disconnect();
      } catch (e) {}
      forceRevealEnforcementState.observer = null;
    }
    if (forceRevealEnforcementState.intervalId) {
      clearInterval(forceRevealEnforcementState.intervalId);
      forceRevealEnforcementState.intervalId = null;
    }
    if (forceRevealEnforcementState.timeoutId) {
      clearTimeout(forceRevealEnforcementState.timeoutId);
      forceRevealEnforcementState.timeoutId = null;
    }
    forceRevealEnforcementState.active = false;
    forceRevealEnforcementState.videoId = 'none';
    forceRevealEnforcementState.expiresAt = 0;
    forceRevealEnforcementState.reason = reason || 'stopped';
    forceRevealEnforcementState.source = 'none';
  }

  function forceRemoveRevealOverlayNode(overlay) {
    if (!overlay || overlay.nodeType !== 1) return false;
    try {
      if (overlay.__mwRevealDeferredRemovalTimer) {
        clearTimeout(overlay.__mwRevealDeferredRemovalTimer);
        overlay.__mwRevealDeferredRemovalTimer = null;
      }
    } catch (e) {}
    try {
      setRevealOverlayBlurState(overlay, false);
      overlay.style.display = 'none';
      overlay.dataset.blurred = 'false';
    } catch (e) {}
    if (overlay.parentElement) {
      overlay.parentElement.removeChild(overlay);
      return true;
    }
    return false;
  }

  function isNodeBlurredForRevealEnforcement(node) {
    if (!node || node.nodeType !== 1) return false;
    const inlineFilter = String(node.style.getPropertyValue('filter') || node.style.filter || '').toLowerCase();
    const inlineBackdrop = String(node.style.getPropertyValue('backdrop-filter') || '').toLowerCase();
    let computedFilter = '';
    let computedBackdrop = '';
    try {
      const computed = window.getComputedStyle(node);
      computedFilter = String((computed && computed.filter) || '').toLowerCase();
      computedBackdrop = String((computed && computed.backdropFilter) || '').toLowerCase();
    } catch (e) {}
    return (
      inlineFilter.indexOf('blur(') !== -1 ||
      inlineBackdrop.indexOf('blur(') !== -1 ||
      computedFilter.indexOf('blur(') !== -1 ||
      computedBackdrop.indexOf('blur(') !== -1 ||
      node.classList.contains('mw-blurred') ||
      node.classList.contains('mw-softblur') ||
      node.dataset.mwModerated === 'blurred' ||
      node.dataset.mwModerated === 'softblur'
    );
  }

  function clearNodeBlurForRevealEnforcement(node, revealKey) {
    if (!node || node.nodeType !== 1) return false;
    const hadBlur = isNodeBlurredForRevealEnforcement(node);
    try {
      node.style.setProperty('filter', 'none', 'important');
      node.style.setProperty('-webkit-filter', 'none', 'important');
      node.style.removeProperty('backdrop-filter');
      node.style.removeProperty('-webkit-backdrop-filter');
      node.style.removeProperty('background');
      node.style.removeProperty('opacity');
      node.classList.remove('mw-softblur');
      node.classList.remove('mw-blurred');
      node.dataset.mwModerated = 'revealed';
      node.dataset.mwHasOverlay = 'false';
      node.dataset.mwPreblurClear = 'true';
      setElementRevealMarker(node, true, revealKey);
    } catch (e) {}
    return hadBlur;
  }

  function collectForceRevealTargets(videoId) {
    const targets = [];
    const seen = new WeakSet();
    const addTarget = function(node) {
      if (!node || node.nodeType !== 1 || !node.isConnected) return;
      if (seen.has(node)) return;
      seen.add(node);
      targets.push(node);
    };

    const activeContainer = getActiveShortsPlayerContainer();
    const stableResolution = resolveShortsStableBlurTarget(activeContainer, '');
    const stableTarget = (
      stableResolution &&
      stableResolution.target &&
      stableResolution.target.isConnected
    ) ? stableResolution.target : (
      activeContainer && activeContainer.isConnected ? activeContainer : null
    );
    addTarget(stableTarget);

    if (stableTarget && typeof stableTarget.querySelector === 'function') {
      addTarget(stableTarget.querySelector('video.html5-main-video, video'));
      addTarget(stableTarget.querySelector('video'));
    }

    if (videoId && videoId !== 'none') {
      try {
        const scopedVideos = document.querySelectorAll(
          '[data-video-id="' + videoId + '"], [data-item-id="' + videoId + '"], #shorts-player video, video.html5-main-video'
        );
        for (let i = 0; i < scopedVideos.length; i += 1) {
          addTarget(scopedVideos[i]);
        }
      } catch (e) {}
    }

    return targets;
  }

  function runForceRevealEnforcementPass(reason) {
    if (!forceRevealEnforcementState.active) return false;
    if (Date.now() > forceRevealEnforcementState.expiresAt) {
      stopForceRevealEnforcement('expired:' + (reason || 'pass'));
      return false;
    }
    if (!isShortsModeActive()) return false;
    const activeVideoId = getCurrentShortsUrlId() || 'none';
    if (!activeVideoId || activeVideoId === 'none') return false;
    if (activeVideoId !== forceRevealEnforcementState.videoId) return false;

    const revealKey = 'shorts_video:' + activeVideoId;
    state.revealed.add(revealKey);
    state.revealed.add(activeVideoId);

    let removedAnyBlur = false;
    let removedAnyOverlay = false;

    const overlays = document.querySelectorAll('.mw-reveal-overlay, #mw-reveal-overlay');
    for (let i = 0; i < overlays.length; i += 1) {
      const overlay = overlays[i];
      if (!overlay || !overlay.isConnected) continue;
      const overlayVideoId = String(
        (overlay.dataset && overlay.dataset.mwShortsVideoId) ||
        resolveRevealOverlayShortsVideoId(overlay) ||
        'none'
      );
      const isCurrentOverlay = (
        overlayVideoId === activeVideoId ||
        overlayVideoId === 'none'
      );
      if (!isCurrentOverlay) continue;
      if (forceRemoveRevealOverlayNode(overlay)) {
        removedAnyOverlay = true;
      }
    }

    const targets = collectForceRevealTargets(activeVideoId);
    for (let i = 0; i < targets.length; i += 1) {
      const target = targets[i];
      if (!target || !target.isConnected) continue;
      const targetSrc = String(
        (target.dataset && target.dataset.mwSrc) ||
        ('shorts://video/' + activeVideoId + '#force_reveal_enforcement')
      );
      if (clearNodeBlurForRevealEnforcement(target, revealKey)) {
        removedAnyBlur = true;
      }
      const overlay = findRevealOverlayForElement(target, targetSrc);
      if (overlay && forceRemoveRevealOverlayNode(overlay)) {
        removedAnyOverlay = true;
      }
      if (target.tagName !== 'VIDEO' && typeof target.querySelector === 'function') {
        const nestedVideo = target.querySelector('video.html5-main-video, video');
        if (nestedVideo && clearNodeBlurForRevealEnforcement(nestedVideo, revealKey)) {
          removedAnyBlur = true;
        }
      }
    }

    if (removedAnyBlur || removedAnyOverlay) {
      console.log('[REVEAL_ENFORCED] Actively removing blur due to Hard Lock.');
      emitJsOverlayStateSignal(
        false,
        true,
        'force_reveal_enforcement:' + (reason || 'unknown'),
        'shorts://video/' + activeVideoId
      );
      return true;
    }
    return false;
  }

  function startForceRevealEnforcement(videoId, reason, source) {
    if (!isShortsModeActive()) return 'SKIP_NOT_SHORTS';
    const resolvedVideoId = String(videoId || getCurrentShortsUrlId() || 'none').trim() || 'none';
    if (!resolvedVideoId || resolvedVideoId === 'none') return 'SKIP_NO_VIDEO';
    stopForceRevealEnforcement('restart');
    forceRevealEnforcementState.active = true;
    forceRevealEnforcementState.videoId = resolvedVideoId;
    forceRevealEnforcementState.reason = reason || 'hard_reveal_lock';
    forceRevealEnforcementState.source = source || 'host';
    forceRevealEnforcementState.expiresAt = Date.now() + FORCE_REVEAL_ENFORCEMENT_WINDOW_MS;

    const root = document.body || document.documentElement;
    if (root) {
      const observer = new MutationObserver(function() {
        runForceRevealEnforcementPass('mutation');
      });
      forceRevealEnforcementState.observer = observer;
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: FORCE_REVEAL_ENFORCEMENT_ATTRIBUTE_FILTER,
      });
    }
    forceRevealEnforcementState.intervalId = setInterval(function() {
      runForceRevealEnforcementPass('interval');
    }, FORCE_REVEAL_ENFORCEMENT_INTERVAL_MS);
    forceRevealEnforcementState.timeoutId = setTimeout(function() {
      stopForceRevealEnforcement('window_complete');
    }, FORCE_REVEAL_ENFORCEMENT_WINDOW_MS);
    runForceRevealEnforcementPass('start');
    return 'STARTED';
  }

  function handleBlurCommand(message) {
    if (!message || typeof message !== 'object') return false;
    if (message.type === 'MW_SHIELD_ACTION') {
      handleShieldAction(message.action);
      return true;
    }
    if (message.type === 'MW_FORCE_REVEAL_ENFORCEMENT') {
      const fromSovereign = typeof message.sovereignId === 'string'
        ? (String(message.sovereignId).split('|')[2] || '')
        : '';
      const requestedVideoId = (
        typeof message.videoId === 'string' &&
        String(message.videoId || '').trim() &&
        String(message.videoId || '').trim() !== 'none'
      ) ? String(message.videoId).trim() : (
        fromSovereign && fromSovereign !== 'none'
          ? fromSovereign
          : (getCurrentShortsUrlId() || 'none')
      );
      const startResult = startForceRevealEnforcement(
        requestedVideoId,
        String(message.reason || 'hard_reveal_lock'),
        String(message.source || 'host'),
      );
      if (CONFIG.debug || DIAG_YT_BLUR) {
        console.log(
          '[DIAG][REVEAL_LOCK]',
          'action=force_reveal_enforcement_start',
          'videoId=' + (requestedVideoId || 'none'),
          'result=' + startResult,
          'reason=' + String(message.reason || 'hard_reveal_lock')
        );
      }
      return true;
    }
    if (!DOM_OVERLAY_ENABLED) return false;
    if (message.type === 'MW_BLUR_STATE') {
      if (CONFIG.debug) {
        console.log('[MW-DIAG][INJECT] source=overlay_state_message', 'enabled=' + (!!message.enabled), 'reason=' + (message.reason || 'state'));
      }
      if (!message.enabled && isCurrentShortsVideoRevealed()) {
        if (CONFIG.debug) {
          console.log(
            '[MW-DIAG][INJECT] source=overlay_state_message',
            'action=ignore_disable_for_revealed_shorts',
            'reason=' + (message.reason || 'state'),
            'shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
          );
        }
        return true;
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
  
  const existingRevealSet = (
    window.__MW_REVEALED_SET__ &&
    typeof window.__MW_REVEALED_SET__.add === 'function' &&
    typeof window.__MW_REVEALED_SET__.has === 'function'
  ) ? window.__MW_REVEALED_SET__ : null;
  const state = {
    pageEpoch: Number.isFinite(window.__MW_HOST_PAGE_EPOCH__)
      ? Number(window.__MW_HOST_PAGE_EPOCH__)
      : (Number.isFinite(CONFIG.pageEpoch) ? Number(CONFIG.pageEpoch) : 1),
    scanned: new Set(),
    pending: new Map(), // itemId -> { element, src, sourceType, requestId, timestamp, state, blurTimer }
    pendingBySrc: new Map(), // src -> itemId (dedupe)
    pendingRequests: new Map(), // requestId -> { items, timestamp, timeoutId, state }
    safeResolved: new Set(), // src values resolved as safe to suppress legacy re-blur
    safeResolvedAt: new Map(), // src -> timestamp (bounded/ttl for legacy suppression)
    blurred: new Set(),
    revealed: existingRevealSet || new Set(), // Tracks URLs that user has manually revealed
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
  window.__MW_REVEALED_SET__ = state.revealed;

  function getShortsRevealVideoIdFromSrc(src) {
    const rawSrc = String(src || '');
    if (!rawSrc) return 'none';
    const shortsSchemePrefix = 'shorts://video/';
    if (rawSrc.toLowerCase().indexOf(shortsSchemePrefix) === 0) {
      const rawVideoId = String(rawSrc.substring(shortsSchemePrefix.length) || '').split(/[/?#]/)[0];
      if (!rawVideoId) return 'none';
      try {
        return decodeURIComponent(rawVideoId.trim());
      } catch (e) {
        return rawVideoId.trim();
      }
    }
    const normalized = normalizeUrl(rawSrc) || rawSrc;
    if (!normalized) return 'none';
    try {
      const parsed = new URL(normalized, window.location.href);
      const queryId = parsed.searchParams.get('v');
      if (queryId) return queryId;
      const pathname = String(parsed.pathname || '');
      const shortsSplit = pathname.split('/shorts/');
      if (shortsSplit.length > 1) {
        const candidate = String(shortsSplit[1] || '').split(/[/?#]/)[0];
        if (candidate) return candidate;
      }
      const viSplit = pathname.split('/vi/');
      if (viSplit.length > 1) {
        const candidate = String(viSplit[1] || '').split('/')[0];
        if (candidate) return candidate;
      }
      const viWebpSplit = pathname.split('/vi_webp/');
      if (viWebpSplit.length > 1) {
        const candidate = String(viWebpSplit[1] || '').split('/')[0];
        if (candidate) return candidate;
      }
    } catch (e) {}
    return 'none';
  }

  function getRevealPersistenceKeys(src, element) {
    const keys = [];
    const normalizedSrc = normalizeUrl(src || '') || String(src || '');
    if (isShortsModeActive()) {
      const srcVideoId = getShortsRevealVideoIdFromSrc(normalizedSrc);
      const activeVideoId = getCurrentShortsUrlId() || 'none';
      const resolvedVideoId = srcVideoId !== 'none' ? srcVideoId : activeVideoId;
      if (resolvedVideoId && resolvedVideoId !== 'none') {
        keys.push('shorts_video:' + resolvedVideoId);
        keys.push(resolvedVideoId);
      } else {
        const sovereignId = computeSovereignId(state.pageEpoch);
        if (sovereignId && sovereignId !== 'none|none|none') {
          keys.push('shorts_sovereign:' + sovereignId);
        }
      }
    } else if (normalizedSrc) {
      keys.push('src:' + normalizedSrc);
    }
    if (
      element &&
      element.dataset &&
      typeof element.dataset.mwRevealKey === 'string' &&
      element.dataset.mwRevealKey
    ) {
      keys.push(element.dataset.mwRevealKey);
    }
    return Array.from(new Set(keys.filter(Boolean)));
  }

  function hasRevealPersistence(src, element) {
    const keys = getRevealPersistenceKeys(src, element);
    for (let i = 0; i < keys.length; i += 1) {
      if (state.revealed.has(keys[i])) return true;
    }
    return false;
  }

  function setElementRevealMarker(element, revealed, preferredKey) {
    if (!element || !element.dataset) return;
    element.dataset.mwRevealed = revealed ? 'true' : 'false';
    if (revealed) {
      const key = preferredKey || '';
      if (key) {
        element.dataset.mwRevealKey = key;
      }
    } else {
      element.dataset.mwRevealKey = '';
    }
  }

  function markRevealPersistence(src, element) {
    const keys = getRevealPersistenceKeys(src, element);
    keys.forEach(function(key) {
      state.revealed.add(key);
    });
    if (element) {
      setElementRevealMarker(element, true, keys[0] || '');
    }
    return keys;
  }

  function clearRevealPersistence(src, element) {
    const keys = getRevealPersistenceKeys(src, element);
    keys.forEach(function(key) {
      state.revealed.delete(key);
    });
    if (element) {
      setElementRevealMarker(element, false, '');
    }
    return keys;
  }

  function ensureRevealMarkerForElement(element, src) {
    if (!element || !element.dataset) return false;
    if (!hasRevealPersistence(src, element)) return false;
    const keys = getRevealPersistenceKeys(src, element);
    setElementRevealMarker(element, true, keys[0] || '');
    return true;
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
      clearRevealPersistence(target.src, element);
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
  const initialHostNavId = Number.isFinite(window.__MW_HOST_NAV_ID__)
    ? Number(window.__MW_HOST_NAV_ID__)
    : null;
  let NAV_ID = initialHostNavId !== null
    ? initialHostNavId
    : (window.__MW_NAV_ID__ || ('mw_' + Date.now().toString(36)));
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
    revealOverlayRepositionRaf: null,
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

  function pruneDisconnectedPending(reason) {
    const toClear = [];
    state.pending.forEach(function(pending, itemId) {
      if (!pending || !pending.element || !pending.element.isConnected) {
        toClear.push(itemId);
      }
    });
    toClear.forEach(function(itemId) { clearPendingItem(itemId, reason || 'disconnected'); });
  }

  function readHostContextIdentity() {
    const hostNavId = Number.isFinite(window.__MW_HOST_NAV_ID__)
      ? Number(window.__MW_HOST_NAV_ID__)
      : null;
    const hostPageEpoch = Number.isFinite(window.__MW_HOST_PAGE_EPOCH__)
      ? Number(window.__MW_HOST_PAGE_EPOCH__)
      : null;
    return {
      hostNavId: hostNavId,
      hostPageEpoch: hostPageEpoch,
    };
  }

  function resetTransientModerationState(reason, options) {
    const opts = options || {};
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
    state.pendingRequests.forEach(function(req) {
      if (req && req.timeoutId) clearTimeout(req.timeoutId);
    });
    state.pendingRequests.clear();
    state.pending.forEach(function(_item, itemId) {
      clearPendingItem(itemId, reason || 'context_sync_reset');
    });
    state.pendingBySrc.clear();
    diagScanBatchStartAtByRequestId.clear();
    if (opts.clearScanState === true) {
      state.scanned.clear();
      state.elements.clear();
    }
  }

  function syncActiveContextFromHost(reason, options) {
    const opts = options || {};
    const identity = readHostContextIdentity();
    const previousNavId = NAV_ID;
    const previousPageEpoch = state.pageEpoch;
    let navChanged = false;
    let epochChanged = false;

    if (identity.hostNavId !== null && String(identity.hostNavId) !== String(NAV_ID)) {
      NAV_ID = identity.hostNavId;
      window.__MW_NAV_ID__ = NAV_ID;
      navChanged = true;
    }

    if (identity.hostPageEpoch !== null && identity.hostPageEpoch !== state.pageEpoch) {
      state.pageEpoch = identity.hostPageEpoch;
      CONFIG.pageEpoch = identity.hostPageEpoch;
      epochChanged = true;
    }

    const contextChanged = navChanged || epochChanged;
    if (contextChanged && opts.resetTransientState !== false) {
      resetTransientModerationState('host_context_sync_' + (reason || 'unknown'), {
        clearScanState: opts.clearScanState === true,
      });
    }

    if (contextChanged) {
      console.log(
        '[DIAG][HOST_CONTEXT_SYNC]',
        'action=applied',
        'reason=' + (reason || 'unknown'),
        'oldNavId=' + String(previousNavId || 'none'),
        'newNavId=' + String(NAV_ID || 'none'),
        'oldPageEpoch=' + String(previousPageEpoch || 'none'),
        'newPageEpoch=' + String(state.pageEpoch || 'none'),
        'hostNavId=' + String(identity.hostNavId === null ? 'none' : identity.hostNavId),
        'hostPageEpoch=' + String(identity.hostPageEpoch === null ? 'none' : identity.hostPageEpoch),
        'url=' + window.location.href
      );
    }

    return {
      contextChanged: contextChanged,
      navChanged: navChanged,
      epochChanged: epochChanged,
      hostNavId: identity.hostNavId,
      hostPageEpoch: identity.hostPageEpoch,
    };
  }

  window.__MW_ACTIVE_CONTEXT_API__ = {
    applyHostContextSync: function(reason) {
      return syncActiveContextFromHost(reason || 'host_api', {
        resetTransientState: true,
        clearScanState: true,
      });
    },
    getContext: function() {
      const identity = readHostContextIdentity();
      return {
        navId: NAV_ID,
        pageEpoch: state.pageEpoch,
        hostNavId: identity.hostNavId,
        hostPageEpoch: identity.hostPageEpoch,
      };
    },
  };

  syncActiveContextFromHost('inject_bootstrap', { resetTransientState: false });

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
    if (isShortsModeActive()) {
      emitJsOverlayStateSignal(false, isCurrentShortsVideoRevealed(), 'reset_state', '');
    }
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
  const SHORTS_ACTIVE_RENDERER_SELECTOR = [
    'ytm-reel-video-renderer[selected]',
    'ytm-reel-video-renderer[is-active]',
    'ytm-reel-video-renderer[aria-hidden="false"]',
    'ytm-reel-video-renderer[aria-current="true"]',
    'ytm-shorts-lockup-view-model[selected]',
    'ytm-shorts-lockup-view-model[is-active]',
    'ytm-shorts-lockup-view-model[aria-hidden="false"]',
    'ytm-shorts-lockup-view-model[aria-current="true"]',
    'ytm-shorts-lockup-view-model-v2[selected]',
    'ytm-shorts-lockup-view-model-v2[is-active]',
    'ytm-shorts-lockup-view-model-v2[aria-hidden="false"]',
    'ytm-shorts-lockup-view-model-v2[aria-current="true"]',
    'ytd-reel-video-renderer[is-active]',
    'ytd-reel-video-renderer[aria-hidden="false"]',
    'ytd-reel-video-renderer[aria-current="true"]',
  ].join(', ');
  const SHORTS_STABLE_CONTAINER_SELECTORS = [
    '#shorts-player ytm-reel-video-renderer[selected]',
    '#shorts-player ytm-reel-video-renderer[is-active]',
    '#shorts-player ytm-reel-video-renderer[aria-hidden="false"]',
    '#shorts-player ytm-reel-video-renderer[aria-current="true"]',
    '#shorts-player ytm-shorts-lockup-view-model[selected]',
    '#shorts-player ytm-shorts-lockup-view-model[is-active]',
    '#shorts-player ytm-shorts-lockup-view-model[aria-hidden="false"]',
    '#shorts-player ytm-shorts-lockup-view-model[aria-current="true"]',
    '#shorts-player ytm-shorts-lockup-view-model-v2[selected]',
    '#shorts-player ytm-shorts-lockup-view-model-v2[is-active]',
    '#shorts-player ytm-shorts-lockup-view-model-v2[aria-hidden="false"]',
    '#shorts-player ytm-shorts-lockup-view-model-v2[aria-current="true"]',
    '#shorts-player ytd-reel-video-renderer[is-active]',
    '#shorts-player ytd-reel-video-renderer[aria-hidden="false"]',
    '#shorts-player ytd-reel-video-renderer[aria-current="true"]',
    'ytm-shorts-lockup-view-model[selected]',
    'ytm-shorts-lockup-view-model[is-active]',
    'ytm-shorts-lockup-view-model[aria-hidden="false"]',
    'ytm-shorts-lockup-view-model[aria-current="true"]',
    'ytm-shorts-lockup-view-model-v2[selected]',
    'ytm-shorts-lockup-view-model-v2[is-active]',
    'ytm-shorts-lockup-view-model-v2[aria-hidden="false"]',
    'ytm-shorts-lockup-view-model-v2[aria-current="true"]',
    'ytd-reel-video-renderer[is-active]',
    'ytd-reel-video-renderer[aria-hidden="false"]',
    'ytd-reel-video-renderer[aria-current="true"]',
    'ytm-reel-video-renderer[selected]',
    'ytm-reel-video-renderer[is-active]',
    'ytm-reel-video-renderer[aria-hidden="false"]',
    'div#player-container',
    '#player-container',
    '#shorts-player ytm-shorts-lockup-view-model-v2',
    '#shorts-player ytm-shorts-lockup-view-model',
    '#shorts-player ytm-reel-video-renderer',
    '#shorts-player ytd-reel-video-renderer',
    'ytm-shorts-lockup-view-model-v2',
    'ytm-shorts-lockup-view-model',
    '#shorts-player',
  ];
  const SHORTS_STABLE_CONTAINER_TAG_SELECTOR = 'ytm-reel-video-renderer, ytd-reel-video-renderer, ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, #shorts-player, #player-container, div#player-container';
  const SHORTS_FALLBACK_VIDEO_SELECTOR = [
    '#shorts-player video.html5-main-video',
    '#shorts-player video',
    '#shorts-player ytm-shorts-lockup-view-model-v2 video.html5-main-video',
    '#shorts-player ytm-shorts-lockup-view-model-v2 video',
    '#shorts-player ytm-shorts-lockup-view-model video.html5-main-video',
    '#shorts-player ytm-shorts-lockup-view-model video',
    'ytd-reel-video-renderer[is-active] video.html5-main-video',
    'ytd-reel-video-renderer[is-active] video',
    'ytd-reel-video-renderer[aria-hidden="false"] video',
    'ytd-reel-video-renderer[aria-current="true"] video',
    'ytm-shorts-lockup-view-model-v2[selected] video',
    'ytm-shorts-lockup-view-model-v2[is-active] video',
    'ytm-shorts-lockup-view-model-v2[aria-hidden="false"] video',
    'ytm-shorts-lockup-view-model-v2[aria-current="true"] video',
    'ytm-shorts-lockup-view-model[selected] video',
    'ytm-shorts-lockup-view-model[is-active] video',
    'ytm-shorts-lockup-view-model[aria-hidden="false"] video',
    'ytm-shorts-lockup-view-model[aria-current="true"] video',
    'ytm-reel-video-renderer[selected] video',
    'ytm-reel-video-renderer[is-active] video',
    'ytm-reel-video-renderer[aria-hidden="false"] video',
    'div#player-container video.html5-main-video',
    'div#player-container video',
    '#player-container video.html5-main-video',
    '#player-container video',
    'video.html5-main-video',
    'video',
  ].join(', ');
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
  const SHORTS_ANCHOR_SYNC_COOLDOWN_MS = 80;
  const SHORTS_REVEAL_WATCH_TIMEOUT_MS = 12000;
  const FORCE_REVEAL_ENFORCEMENT_WINDOW_MS = 2000;
  const FORCE_REVEAL_ENFORCEMENT_INTERVAL_MS = 200;
  const REVEAL_INTERACTION_LOCK_MS = 300;
  const TIMEOUT_SAFE_FAILURE_UI_LOCK_MS = 2000;
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
  const SHORTS_REVEAL_WATCH_ATTRIBUTE_FILTER = [
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
  const SHORTS_ANCHOR_ATTRIBUTE_FILTER = [
    'v',
    'data-video-id',
  ];
  const FORCE_REVEAL_ENFORCEMENT_ATTRIBUTE_FILTER = [
    'style',
    'class',
    'data-mw-moderated',
    'data-mw-revealed',
    'data-blurred',
  ];
  let shortsBlurContextByContainer = new WeakMap();
  let shortsBlurContextCount = 0;
  let shortsHealthStateByContainer = new WeakMap();
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
  const shortsAnchorObserverState = {
    observer: null,
    rootNode: null,
    rootNodeId: 'none',
    lastSignature: '',
    lastSyncAt: 0,
  };
  const shortsReentryState = {
    lastRefreshAt: 0,
    lastReason: 'none',
  };
  const shortsRevealWatchState = {
    observer: null,
    timeoutId: null,
    active: false,
    key: '',
    startedAt: 0,
    reason: 'none',
    attempts: 0,
  };
  const forceRevealEnforcementState = {
    observer: null,
    intervalId: null,
    timeoutId: null,
    active: false,
    videoId: 'none',
    reason: 'none',
    source: 'none',
    expiresAt: 0,
  };
  const revealInteractionLockState = {
    until: 0,
    reason: 'none',
  };
  const timeoutSafeFailureUiLockState = {
    until: 0,
    reason: 'none',
    shortsVideoId: 'none',
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
      var path = String(parsed.pathname || '').toLowerCase();
      return (
        (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') &&
        path.indexOf('/shorts') === 0
      );
    } catch (e) {
      return false;
    }
  }

  function isYouTubeShortsRelatedUrl(value) {
    if (!value) return false;
    try {
      var parsed = new URL(value, window.location.href);
      var host = String(parsed.hostname || '').toLowerCase();
      var path = String(parsed.pathname || '').toLowerCase();
      return (
        (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') &&
        /(^|[/])shorts([/]|$)/.test(path)
      );
    } catch (e) {
      return false;
    }
  }

  function isMobileYouTubeShortsUrl(value) {
    if (!value) return false;
    try {
      var parsed = new URL(value, window.location.href);
      var host = String(parsed.hostname || '').toLowerCase();
      return host === 'm.youtube.com' && String(parsed.pathname || '').toLowerCase().indexOf('/shorts') === 0;
    } catch (e) {
      return false;
    }
  }

  function isShortsModeActive() {
    return isYouTubeShortsUrl(window.location.href);
  }

  function getDiagUrlFamily(value) {
    if (!value) return 'unknown';
    if (isYouTubeShortsUrl(value)) return 'youtube_shorts';
    if (isYouTubeShortsRelatedUrl(value)) return 'youtube_shorts_related';
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

  function getRevealShortsVideoId(src) {
    const fromSrc = getShortsRevealVideoIdFromSrc(src || '');
    if (fromSrc && fromSrc !== 'none') return fromSrc;
    const activeVideoId = getCurrentShortsUrlId() || 'none';
    return activeVideoId || 'none';
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
    const fallbackVideo = document.querySelector(SHORTS_FALLBACK_VIDEO_SELECTOR);
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
      return !!element.closest('#shorts-player, #player-container, ytm-reel-video-renderer, ytd-reel-video-renderer, ytm-shorts-lockup-view-model');
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

  function stopShortsAnchorObserver(reason) {
    const hadObserver = !!shortsAnchorObserverState.observer;
    if (shortsAnchorObserverState.observer) {
      try { shortsAnchorObserverState.observer.disconnect(); } catch (e) {}
      shortsAnchorObserverState.observer = null;
    }
    shortsAnchorObserverState.rootNode = null;
    shortsAnchorObserverState.rootNodeId = 'none';
    shortsAnchorObserverState.lastSignature = '';
    shortsAnchorObserverState.lastSyncAt = 0;
    if (hadObserver) {
      logShortsProbe(
        'shorts_anchor_observer_stop',
        'reason=' + (reason || 'unknown')
      );
    }
  }

  function resolveShortsAnchorRoot() {
    const shortsContainer = document.getElementById('shorts-container');
    if (shortsContainer && shortsContainer.isConnected) return shortsContainer;
    const shortsPlayer = document.getElementById('shorts-player');
    if (shortsPlayer && shortsPlayer.isConnected) return shortsPlayer;
    const activeRenderer = document.querySelector(SHORTS_ACTIVE_RENDERER_SELECTOR);
    if (activeRenderer && activeRenderer.isConnected) return activeRenderer;
    const playerContainer = document.querySelector('div#player-container, #player-container');
    if (playerContainer && playerContainer.isConnected) return playerContainer;
    return null;
  }

  function readShortsAnchorSignature(root) {
    const anchorRoot = (root && root.nodeType === 1) ? root : resolveShortsAnchorRoot();
    if (!anchorRoot) return '';

    const activeRenderer = (
      anchorRoot.matches && anchorRoot.matches('ytm-reel-video-renderer, ytd-reel-video-renderer')
    )
      ? anchorRoot
      : (anchorRoot.querySelector &&
          anchorRoot.querySelector(SHORTS_ACTIVE_RENDERER_SELECTOR)) || null;
    const reelRoot = activeRenderer || anchorRoot;
    const attrV = reelRoot.getAttribute ? reelRoot.getAttribute('v') : '';
    const dataVideoId = reelRoot.getAttribute ? reelRoot.getAttribute('data-video-id') : '';
    const dataItemId = reelRoot.getAttribute ? reelRoot.getAttribute('data-item-id') : '';
    const dataId = reelRoot.getAttribute ? reelRoot.getAttribute('data-id') : '';
    const shortsUrlId = getCurrentShortsUrlId() || '';
    let queryV = '';
    try {
      const parsed = new URL(window.location.href);
      queryV = String(parsed.searchParams.get('v') || '');
    } catch (e) {}
    const resolvedId = attrV || dataVideoId || dataItemId || dataId || shortsUrlId || queryV || 'none';
    return [
      resolvedId,
      shortsUrlId || 'none',
      String(window.location.href || ''),
      getDiagNodeId(reelRoot),
    ].join('|');
  }

  function forceShortsAnchorIdentitySync(reason, details) {
    const activeUrl = window.location.href;
    if (!isYouTubeShortsUrl(activeUrl)) return;
    if (!isShortsModeActive()) return;
    const now = Date.now();
    if ((now - shortsAnchorObserverState.lastSyncAt) < SHORTS_ANCHOR_SYNC_COOLDOWN_MS) return;
    shortsAnchorObserverState.lastSyncAt = now;
    const syncResult = syncActiveContextFromHost('shorts_anchor_observer:' + (reason || 'unknown'), {
      resetTransientState: true,
      clearScanState: false,
    });
    resetShortsBlurContext('shorts_anchor_observer');
    refreshShortsFreshnessOnReentry('shorts_anchor_observer', { force: true, resetContext: false });
    scheduleShortsRevealOverlayReposition('shorts_anchor_observer');
    sendBlurReady('shorts_anchor_observer:' + (reason || 'unknown'));
    logShortsProbe(
      'shorts_anchor_identity_sync',
      'reason=' + (reason || 'unknown') +
      ' hostNavId=' + String(syncResult.hostNavId === null ? 'none' : syncResult.hostNavId) +
      ' hostPageEpoch=' + String(syncResult.hostPageEpoch === null ? 'none' : syncResult.hostPageEpoch) +
      ' details=' + String(details || '').substring(0, 180)
    );
  }

  function installShortsAnchorObserver(reason) {
    const activeUrl = window.location.href;
    if (!isYouTubeShortsUrl(activeUrl)) {
      stopShortsAnchorObserver('url_not_shorts:' + (reason || 'unknown'));
      return false;
    }
    const host = String(window.location.hostname || '').toLowerCase();
    if (host !== 'm.youtube.com') {
      stopShortsAnchorObserver('host_not_mobile:' + (reason || 'unknown'));
      return false;
    }
    if (!isShortsModeActive()) {
      stopShortsAnchorObserver('not_shorts:' + (reason || 'unknown'));
      return false;
    }
    const root = resolveShortsAnchorRoot();
    if (!root || !root.isConnected) {
      stopShortsAnchorObserver('no_root:' + (reason || 'unknown'));
      return false;
    }
    if (shortsAnchorObserverState.observer && shortsAnchorObserverState.rootNode === root) {
      return true;
    }

    stopShortsAnchorObserver('refresh:' + (reason || 'unknown'));
    shortsAnchorObserverState.rootNode = root;
    shortsAnchorObserverState.rootNodeId = getDiagNodeId(root);
    shortsAnchorObserverState.lastSignature = readShortsAnchorSignature(root);

    const observer = new MutationObserver(function(mutations) {
      if (!isYouTubeShortsUrl(window.location.href)) return;
      if (timerState.paused || timerState.teardownDone || !isShortsModeActive()) return;
      const previousSignature = shortsAnchorObserverState.lastSignature || '';
      let sawIdentityAttrChange = false;
      for (let i = 0; i < mutations.length; i += 1) {
        const mutation = mutations[i];
        if (mutation.type !== 'attributes') continue;
        const attrName = String(mutation.attributeName || '');
        if (!attrName) continue;
        if (attrName === 'v' || attrName === 'data-video-id') {
          sawIdentityAttrChange = true;
          break;
        }
      }
      if (!sawIdentityAttrChange) return;
      const nextSignature = readShortsAnchorSignature(shortsAnchorObserverState.rootNode || root);
      if (nextSignature === previousSignature) return;
      shortsAnchorObserverState.lastSignature = nextSignature;
      forceShortsAnchorIdentitySync(
        'identity_attr_change',
        'prev=' + String(previousSignature || 'none').substring(0, 180) +
        ' next=' + String(nextSignature || 'none').substring(0, 180)
      );
      scanActiveShortsPlayerContainer('shorts_anchor_observer');
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: SHORTS_ANCHOR_ATTRIBUTE_FILTER,
    });
    shortsAnchorObserverState.observer = observer;
    logShortsProbe(
      'shorts_anchor_observer_start',
      'reason=' + (reason || 'unknown') +
      ' rootNodeId=' + shortsAnchorObserverState.rootNodeId +
      ' signature=' + String(shortsAnchorObserverState.lastSignature || 'none').substring(0, 180)
    );
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
      shortsUrlId: getCurrentShortsUrlId(),
      lastReattachAt: (existing && existing.lastReattachAt) || 0,
      lastReattachVideoId: (existing && existing.lastReattachVideoId) || '',
    };
    setShortsBlurContextEntry(container, context);
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
    shortsBlurContextByContainer = new WeakMap();
    shortsBlurContextCount = 0;
    shortsHealthStateByContainer = new WeakMap();
    stopShortsHealthHealInterval('context_reset');
    if (DIAG_YT_BLUR) {
      diagShortsTimeline(
        'shorts_blur_context_reset',
        'reason=' + (reason || 'unknown') +
        ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
      );
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
    if (hasRevealPersistence(context.src, videoNode) || videoNode.dataset.mwRevealed === 'true') {
      ensureRevealMarkerForElement(videoNode, context.src);
      diagShortsSwapMarker(videoNode, reason || 'unknown', true, false, 'revealed');
      return false;
    }
    const now = Date.now();
    if (context.updatedAt && (now - context.updatedAt) > SHORTS_SWAP_REATTACH_WINDOW_MS) {
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
    const revealed = !!(
      (context.src && hasRevealPersistence(context.src, targetNode)) ||
      (targetNode && targetNode.dataset && targetNode.dataset.mwRevealed === 'true')
    );
    if (revealed && targetNode) {
      ensureRevealMarkerForElement(targetNode, context.src);
    }
    const moderatedBlurred = !!(targetNode && targetNode.dataset && targetNode.dataset.mwModerated === 'blurred');
    const overlayExpected = !revealed && moderatedBlurred;
    const overlayState = getDiagOverlayState(targetNode);
    const overlayPresent = !overlayExpected || overlayState.overlayAttached;
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
    const refreshedRevealed = !!(
      (refreshedContext && refreshedContext.src && hasRevealPersistence(refreshedContext.src, refreshedTarget)) ||
      (refreshedTarget && refreshedTarget.dataset && refreshedTarget.dataset.mwRevealed === 'true')
    );
    if (refreshedRevealed && refreshedTarget) {
      ensureRevealMarkerForElement(refreshedTarget, refreshedContext && refreshedContext.src ? refreshedContext.src : '');
    }
    const refreshedModerated = !!(
      refreshedTarget &&
      refreshedTarget.dataset &&
      refreshedTarget.dataset.mwModerated === 'blurred'
    );
    const refreshedOverlayExpected = !refreshedRevealed && refreshedModerated;
    const refreshedOverlayState = getDiagOverlayState(refreshedTarget);
    const refreshedOverlayPresent = !refreshedOverlayExpected || refreshedOverlayState.overlayAttached;
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

  function getBlurredNodeIdsForItemKey(src, limit) {
    const ids = [];
    if (!src) return ids;
    const max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 20;
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
        ids.push(getDiagNodeId(node));
        if (ids.length >= max) break;
      }
    }
    return ids;
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
    if (portal) {
      portal.style.setProperty('z-index', String(LAYER_REVEAL_PORTAL_Z), 'important');
      portal.style.setProperty('pointer-events', 'none', 'important');
      return portal;
    }
    portal = document.createElement('div');
    portal.id = REVEAL_PORTAL_ID;
    portal.style.cssText = [
      'position: fixed',
      'inset: 0',
      'z-index: ' + String(LAYER_REVEAL_PORTAL_Z),
      'pointer-events: none',
      'overflow: hidden',
      'filter: none',
      '-webkit-filter: none',
      'backdrop-filter: none',
      '-webkit-backdrop-filter: none',
    ].join(';');
    portal.style.setProperty('z-index', String(LAYER_REVEAL_PORTAL_Z), 'important');
    portal.style.setProperty('pointer-events', 'none', 'important');
    (document.documentElement || document.body || document.documentElement).appendChild(portal);
    console.log('[DIAG][REVEAL_UI] portal_created');
    return portal;
  }

  function isRevealWatchNodeVisible(node) {
    if (!node || node.nodeType !== 1 || !node.isConnected) return false;
    let rect = null;
    let style = null;
    try {
      rect = node.getBoundingClientRect();
    } catch (e) {}
    try {
      style = window.getComputedStyle(node);
    } catch (e) {}
    if (!rect || rect.width < 2 || rect.height < 2) return false;
    if (!style) return true;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const opacity = Number(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0.02) return false;
    const ariaHidden = node.getAttribute ? String(node.getAttribute('aria-hidden') || '').toLowerCase() : '';
    if (ariaHidden === 'true') return false;
    if (typeof node.closest === 'function') {
      const hiddenAncestor = node.closest('[aria-hidden="true"], [hidden]');
      if (hiddenAncestor) return false;
    }
    return true;
  }

  function isRevealWatchVideoVisible(video) {
    if (!isRevealWatchNodeVisible(video)) return false;
    let rect = null;
    try {
      rect = video.getBoundingClientRect();
    } catch (e) {}
    if (!rect) return true;
    const centerX = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    const centerY = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
    let top = null;
    try {
      top = document.elementFromPoint(centerX, centerY);
    } catch (e) {}
    if (!top || top.nodeType !== 1) return true;
    return (
      top === video ||
      (typeof video.contains === 'function' && video.contains(top)) ||
      (typeof top.contains === 'function' && top.contains(video))
    );
  }

  function findActiveHunterShortsContainer(reason) {
    if (!isShortsModeActive()) return null;
    const activeContainer = getActiveShortsPlayerContainer();
    if (activeContainer && activeContainer.isConnected) {
      const activeVideo = typeof activeContainer.querySelector === 'function'
        ? activeContainer.querySelector('video.html5-main-video, video')
        : null;
      if ((activeVideo && isRevealWatchVideoVisible(activeVideo)) || isRevealWatchNodeVisible(activeContainer)) {
        return activeContainer;
      }
    }

    const selectorSet = new Set([
      ...SHORTS_STABLE_CONTAINER_SELECTORS,
      ...SHORTS_STABLE_CONTAINER_TAG_SELECTOR.split(',').map(selector => selector.trim()).filter(Boolean),
    ]);
    const selectorList = Array.from(selectorSet);
    for (let i = 0; i < selectorList.length; i += 1) {
      const selector = selectorList[i];
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (e) {
        continue;
      }
      for (let j = 0; j < nodes.length; j += 1) {
        const node = nodes[j];
        if (!node || !node.isConnected) continue;
        const ariaHidden = node.getAttribute ? String(node.getAttribute('aria-hidden') || '').toLowerCase() : '';
        if (ariaHidden === 'true') continue;
        const nodeVideo = typeof node.querySelector === 'function'
          ? node.querySelector('video.html5-main-video, video')
          : null;
        if ((nodeVideo && isRevealWatchVideoVisible(nodeVideo)) || isRevealWatchNodeVisible(node)) {
          return node;
        }
      }
    }

    let videos = [];
    try {
      videos = Array.from(document.querySelectorAll(SHORTS_FALLBACK_VIDEO_SELECTOR));
    } catch (e) {}
    for (let i = 0; i < videos.length; i += 1) {
      const video = videos[i];
      if (!video || !video.isConnected || !isRevealWatchVideoVisible(video)) continue;
      const container =
        getShortsCardOrPlayerContainerFromNode(video) ||
        (typeof video.closest === 'function' ? video.closest(SHORTS_STABLE_CONTAINER_TAG_SELECTOR) : null) ||
        video;
      if (container && container.isConnected) {
        return container;
      }
    }
    if (DIAG_YT_BLUR) {
      console.log(
        '[MW-YT][DIAG][SHORTS_TARGET]',
        'action=active_hunter_no_container',
        'reason=' + (reason || 'unknown')
      );
    }
    return null;
  }

  function stopShortsRevealWatch(reason) {
    const hadObserver = !!shortsRevealWatchState.observer;
    if (shortsRevealWatchState.observer) {
      try { shortsRevealWatchState.observer.disconnect(); } catch (e) {}
      shortsRevealWatchState.observer = null;
    }
    if (shortsRevealWatchState.timeoutId) {
      clearTimeout(shortsRevealWatchState.timeoutId);
      shortsRevealWatchState.timeoutId = null;
    }
    if (!shortsRevealWatchState.active && !hadObserver) return;
    logShortsProbe(
      'reveal_watch_stop',
      'reason=' + (reason || 'unknown') +
      ' key=' + (shortsRevealWatchState.key || 'none') +
      ' attempts=' + shortsRevealWatchState.attempts
    );
    shortsRevealWatchState.active = false;
    shortsRevealWatchState.key = '';
    shortsRevealWatchState.startedAt = 0;
    shortsRevealWatchState.reason = reason || 'stopped';
    shortsRevealWatchState.attempts = 0;
  }

  function ensureActiveHunterOverlay(reason) {
    if (!isShortsModeActive()) return false;
    const target = findActiveHunterShortsContainer(reason);
    if (!target || !target.isConnected) return false;
    const shortsUrlId = getCurrentShortsUrlId() || 'none';
    const fallbackSrc = String(
      (target.dataset && target.dataset.mwSrc) ||
      ('shorts://video/' + shortsUrlId + '#active_hunter')
    );
    const fallbackCategory = String(
      (target.dataset && target.dataset.mwCategory) ||
      'shorts_active_hunter'
    );
    const fallbackItemId = String((target.dataset && target.dataset.mwItemId) || '');
    applyBlur(target, fallbackSrc, fallbackCategory, CONFIG.blurStrength, fallbackItemId);
    let overlay = findRevealOverlayForElement(target, fallbackSrc);
    if (!overlay || !overlay.isConnected) {
      createRevealOverlay(target, fallbackSrc, fallbackCategory, fallbackItemId);
      overlay = findRevealOverlayForElement(target, fallbackSrc);
    }
    if (!overlay || !overlay.isConnected) return false;
    setRevealOverlayBlurState(overlay, true);
    overlay.style.display = 'flex';
    scheduleShortsRevealOverlayReposition('active_hunter:' + (reason || 'unknown'));
    return true;
  }

  function runShortsRevealWatchPass(reason) {
    if (!shortsRevealWatchState.active) return false;
    if (!isShortsModeActive()) {
      stopShortsRevealWatch('left_shorts');
      return false;
    }
    shortsRevealWatchState.attempts += 1;
    const passReason = 'active_hunter:' + (reason || 'mutation');
    const ensured = ensureTapToRevealOverlay(passReason);
    if (ensured) {
      stopShortsRevealWatch('ensured');
      return true;
    }
    const mounted = ensureActiveHunterOverlay(reason || 'mutation');
    if (mounted) {
      stopShortsRevealWatch('active_hunter_overlay');
      return true;
    }
    return false;
  }

  function startShortsRevealWatch(reason, opts) {
    const options = opts && typeof opts === 'object' ? opts : {};
    if (!isShortsModeActive()) return 'SKIP_NOT_SHORTS';
    const normalizedReason = String(reason || 'active_hunter');
    const watchKey = String(
      options.key ||
      computeSovereignId(state.pageEpoch) ||
      (getCurrentShortsUrlId() || 'none')
    );
    const force = options.force === true;
    if (shortsRevealWatchState.active && shortsRevealWatchState.key === watchKey && !force) {
      runShortsRevealWatchPass('dedupe:' + normalizedReason);
      return 'ALREADY_ACTIVE';
    }

    stopShortsRevealWatch('restart');
    const root = document.body || document.documentElement;
    if (!root) return 'NO_ROOT';

    shortsRevealWatchState.active = true;
    shortsRevealWatchState.key = watchKey;
    shortsRevealWatchState.startedAt = Date.now();
    shortsRevealWatchState.reason = normalizedReason;
    shortsRevealWatchState.attempts = 0;

    const observer = new MutationObserver(function() {
      if (timerState.paused || timerState.teardownDone || !shortsRevealWatchState.active) return;
      runShortsRevealWatchPass('mutation');
    });
    shortsRevealWatchState.observer = observer;
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: SHORTS_REVEAL_WATCH_ATTRIBUTE_FILTER,
    });
    shortsRevealWatchState.timeoutId = setTimeout(function() {
      stopShortsRevealWatch('timeout');
    }, SHORTS_REVEAL_WATCH_TIMEOUT_MS);

    logShortsProbe(
      'reveal_watch_start',
      'reason=' + normalizedReason +
      ' key=' + watchKey +
      ' timeoutMs=' + SHORTS_REVEAL_WATCH_TIMEOUT_MS
    );
    runShortsRevealWatchPass('start');
    return 'STARTED';
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

  function setRevealOverlayActionContext(overlay, element, src, category, itemId) {
    if (!overlay || overlay.nodeType !== 1) return null;
    const target = (element && element.nodeType === 1) ? element : null;
    const nextSrc = String(src || '');
    const shortsVideoId = getRevealShortsVideoId(nextSrc);
    const context = {
      element: target,
      src: nextSrc,
      category: String(category || 'flagged'),
      itemId: String(itemId || ''),
      itemKey: getDiagItemKey(nextSrc),
    };
    overlay.__mwRevealContext = context;
    overlay.dataset.mwFor = nextSrc;
    if (shortsVideoId && shortsVideoId !== 'none') {
      overlay.dataset.mwShortsVideoId = shortsVideoId;
    } else {
      overlay.dataset.mwShortsVideoId = '';
    }
    if (target) {
      overlay.dataset.mwNodeId = getDiagNodeId(target);
    }
    return context;
  }

  function getRevealOverlayActionContext(overlay) {
    if (!overlay || overlay.nodeType !== 1) {
      return { element: null, src: '', category: 'flagged', itemId: '', itemKey: getDiagItemKey('') };
    }
    const stored = (
      overlay.__mwRevealContext &&
      typeof overlay.__mwRevealContext === 'object'
    ) ? overlay.__mwRevealContext : null;
    const src = String(
      (stored && typeof stored.src === 'string' && stored.src) ||
      (overlay.dataset && overlay.dataset.mwFor) ||
      ''
    );
    let element = (
      stored &&
      stored.element &&
      stored.element.nodeType === 1 &&
      stored.element.isConnected
    ) ? stored.element : null;
    if (!element) {
      const anchor = resolveShortsRevealOverlayAnchor(overlay);
      if (anchor && anchor.nodeType === 1 && anchor.isConnected) {
        element = anchor;
      }
    }
    const category = String(
      (stored && typeof stored.category === 'string' && stored.category) ||
      (element && element.dataset ? element.dataset.mwCategory : '') ||
      'flagged'
    );
    const itemId = String(
      (stored && typeof stored.itemId === 'string' && stored.itemId) ||
      (element && element.dataset ? element.dataset.mwItemId : '') ||
      ''
    );
    return {
      element: element,
      src: src,
      category: category,
      itemId: itemId,
      itemKey: getDiagItemKey(src),
    };
  }

  function findShortsRevealOverlayByVideoId(videoId) {
    const normalizedVideoId = String(videoId || '');
    if (!normalizedVideoId || normalizedVideoId === 'none') return null;
    const portal = document.getElementById(REVEAL_PORTAL_ID);
    if (!portal || typeof portal.querySelectorAll !== 'function') return null;
    const overlays = portal.querySelectorAll('.mw-reveal-overlay');
    for (let i = 0; i < overlays.length; i += 1) {
      const overlay = overlays[i];
      if (!overlay || !overlay.isConnected) continue;
      if (String((overlay.dataset && overlay.dataset.mwShortsVideoId) || '') === normalizedVideoId) {
        return overlay;
      }
    }
    return null;
  }

  function resolveRevealOverlayShortsVideoId(overlay) {
    if (!overlay || overlay.nodeType !== 1) return 'none';
    const datasetVideoId = String((overlay.dataset && overlay.dataset.mwShortsVideoId) || '');
    if (datasetVideoId && datasetVideoId !== 'none') return datasetVideoId;
    const overlaySrc = String((overlay.dataset && overlay.dataset.mwFor) || '');
    const parsedFromSrc = getRevealShortsVideoId(overlaySrc);
    return parsedFromSrc && parsedFromSrc !== 'none' ? parsedFromSrc : 'none';
  }

  function ensurePrimaryShortsRevealOverlayId(overlay, videoIdHint) {
    if (!overlay || overlay.nodeType !== 1) return;
    if (!isShortsModeActive()) return;
    overlay.id = 'mw-reveal-overlay';
    const resolvedVideoId = String(videoIdHint || getCurrentShortsUrlId() || resolveRevealOverlayShortsVideoId(overlay) || 'none');
    if (resolvedVideoId !== 'none' && overlay.dataset) {
      overlay.dataset.mwShortsVideoId = resolvedVideoId;
    }
  }

  function getTimeoutSafeFailureUiLockRemainingMs(videoIdHint) {
    const remainingMs = Math.max(0, timeoutSafeFailureUiLockState.until - Date.now());
    if (remainingMs <= 0) return 0;
    const requestedVideoId = String(videoIdHint || getCurrentShortsUrlId() || 'none');
    const lockedVideoId = String(timeoutSafeFailureUiLockState.shortsVideoId || 'none');
    if (lockedVideoId === 'none' || requestedVideoId === 'none') return 0;
    if (lockedVideoId !== requestedVideoId) return 0;
    return remainingMs;
  }

  function applyRevealUiLock(lockReason, durationMs, videoIdHint) {
    if (!isShortsModeActive()) return 0;
    const lockMs = Number.isFinite(durationMs) && durationMs > 0
      ? Math.max(1, Math.round(durationMs))
      : TIMEOUT_SAFE_FAILURE_UI_LOCK_MS;
    const lockVideoId = String(videoIdHint || getCurrentShortsUrlId() || 'none');
    if (!lockVideoId || lockVideoId === 'none') return 0;
    const nextUntil = Date.now() + lockMs;
    if (nextUntil > timeoutSafeFailureUiLockState.until) {
      timeoutSafeFailureUiLockState.until = nextUntil;
    }
    timeoutSafeFailureUiLockState.reason = lockReason || 'timeout_safe_failure';
    timeoutSafeFailureUiLockState.shortsVideoId = lockVideoId;
    const overlay = document.getElementById('mw-reveal-overlay');
    if (overlay && overlay.nodeType === 1) {
      ensurePrimaryShortsRevealOverlayId(overlay, lockVideoId);
      overlay.dataset.mwUiLockUntil = String(timeoutSafeFailureUiLockState.until);
      overlay.dataset.mwUiLockReason = timeoutSafeFailureUiLockState.reason;
      overlay.dataset.mwUiLockVideoId = lockVideoId;
    }
    if (DIAG_YT_BLUR) {
      console.log(
        '[DIAG][REVEAL_UI_LOCK]',
        'action=applied',
        'reason=' + (lockReason || 'timeout_safe_failure'),
        'videoId=' + lockVideoId,
        'durationMs=' + lockMs
      );
    }
    return lockMs;
  }

  function shouldBlockRevealOverlayMutation(commandName, videoIdHint) {
    if (!isShortsModeActive()) return false;
    const activeVideoId = String(videoIdHint || getCurrentShortsUrlId() || 'none');
    if (!activeVideoId || activeVideoId === 'none') return false;
    const overlay = document.getElementById('mw-reveal-overlay');
    if (!overlay || overlay.nodeType !== 1 || !overlay.isConnected) return false;
    const overlayVideoId = resolveRevealOverlayShortsVideoId(overlay);
    if (overlayVideoId === 'none' || overlayVideoId !== activeVideoId) return false;
    const remainingMs = getTimeoutSafeFailureUiLockRemainingMs(activeVideoId);
    if (remainingMs <= 0) return false;
    if (DIAG_YT_BLUR) {
      console.log(
        '[DIAG][REVEAL_UI_LOCK]',
        'action=block_overlay_mutation',
        'command=' + (commandName || 'unknown'),
        'videoId=' + activeVideoId,
        'remainingMs=' + remainingMs,
        'reason=' + (timeoutSafeFailureUiLockState.reason || 'none')
      );
    }
    return true;
  }

  function setRevealOverlayTimeoutSafeFailureState(overlay, enabled) {
    if (!overlay || overlay.nodeType !== 1) return;
    const active = enabled === true;
    overlay.dataset.mwTimeoutSafeFailure = active ? 'true' : 'false';
    if (active) {
      overlay.style.setProperty('z-index', String(LAYER_REVEAL_PORTAL_Z), 'important');
    }
    const btn = typeof overlay.querySelector === 'function'
      ? overlay.querySelector('.mw-reveal-btn, .mw-reveal-button')
      : null;
    if (btn && btn.nodeType === 1) {
      if (active) {
        btn.style.setProperty('z-index', String(LAYER_REVEAL_PORTAL_Z), 'important');
      } else {
        btn.style.removeProperty('z-index');
      }
    }
  }

  function tryReuseShortsVideoRevealOverlay(element, src, category, itemId, reason) {
    if (!isShortsModeActive()) return null;
    if (!element || element.nodeType !== 1 || !element.isConnected) return null;
    const shortsVideoId = getRevealShortsVideoId(src);
    if (!shortsVideoId || shortsVideoId === 'none') return null;
    const overlay = findShortsRevealOverlayByVideoId(shortsVideoId);
    if (!overlay || !overlay.isConnected) return null;
    ensurePrimaryShortsRevealOverlayId(overlay, shortsVideoId);

    setRevealOverlayActionContext(overlay, element, src, category, itemId);
    setRevealOverlayAnchorTarget(overlay, element, reason || 'shorts_video_reuse');
    setRevealOverlayBlurState(overlay, true);
    setRevealOverlayTimeoutSafeFailureState(
      overlay,
      normalizePolicyCategory(category) === 'timeout',
    );
    overlay.style.display = 'flex';
    overlay.classList.add('mw-shorts-blur-container');
    const btn = typeof overlay.querySelector === 'function'
      ? overlay.querySelector('.mw-reveal-btn, .mw-reveal-button')
      : null;
    if (btn && btn.nodeType === 1) {
      btn.textContent = 'Tap to Reveal';
    }
    positionShortsRevealOverlay(overlay, element, reason || 'shorts_video_reuse');
    scheduleShortsRevealOverlayReposition(reason || 'shorts_video_reuse');
    return overlay;
  }

  function resolveShortsRevealOverlayAnchor(overlay) {
    if (!overlay || overlay.nodeType !== 1) return null;
    const src = String((overlay.dataset && overlay.dataset.mwFor) || '');
    const normalizedSrc = normalizeUrl(src || '');
    const boundAnchor = (
      overlay.__mwAnchorTarget &&
      overlay.__mwAnchorTarget.nodeType === 1 &&
      overlay.__mwAnchorTarget.isConnected
    ) ? overlay.__mwAnchorTarget : null;
    if (boundAnchor) return boundAnchor;

    const activeContainer = getActiveShortsPlayerContainer();
    if (activeContainer && activeContainer.isConnected && doesShortsContainerMatchSrc(activeContainer, normalizedSrc)) {
      return activeContainer;
    }

    const blurredNodes = document.querySelectorAll('[data-mw-moderated="blurred"][data-mw-src]');
    for (let i = 0; i < blurredNodes.length; i += 1) {
      const candidate = blurredNodes[i];
      if (!candidate || candidate.nodeType !== 1 || !candidate.isConnected) continue;
      if (candidate.dataset && candidate.dataset.mwSrc === src) return candidate;
    }

    if (activeContainer && activeContainer.isConnected) {
      return activeContainer;
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

  function shouldDeferRevealOverlayHide(overlay, reason) {
    if (!overlay || overlay.nodeType !== 1) return false;
    if (overlay.dataset && overlay.dataset.blurred === 'false') return false;
    const remainingMs = getRevealInteractionLockRemainingMs();
    if (remainingMs <= 0) return false;
    overlay.style.display = 'flex';
    scheduleShortsRevealOverlayReposition('lock_defer_hide:' + (reason || 'unknown'));
    if (DIAG_YT_BLUR) {
      console.log(
        '[DIAG][REVEAL_LOCK]',
        'action=defer_hide',
        'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
        'reason=' + (reason || 'unknown'),
        'remainingMs=' + remainingMs,
        'lockReason=' + (revealInteractionLockState.reason || 'none')
      );
    }
    return true;
  }

  function positionShortsRevealOverlay(overlay, element, reason) {
    if (!overlay) return false;
    if (!element || !element.isConnected || typeof element.getBoundingClientRect !== 'function') {
      if (shouldDeferRevealOverlayHide(overlay, 'missing_anchor:' + (reason || 'unknown'))) {
        return true;
      }
      overlay.style.display = 'none';
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
      if (shouldDeferRevealOverlayHide(overlay, 'missing_rect:' + (reason || 'unknown'))) {
        return true;
      }
      overlay.style.display = 'none';
      return false;
    }
    const badge = overlay.querySelector('span');
    const btn = overlay.querySelector('.mw-reveal-btn');
    const viewportWidth = Math.max(window.innerWidth || 0, 1);
    const viewportHeight = Math.max(window.innerHeight || 0, 1);
    const isBlurredContainer = overlay.dataset && overlay.dataset.blurred !== 'false';
    if (!isBlurredContainer) {
      overlay.style.display = 'none';
      return false;
    }
    const visibleRect = getVisibleViewportRect(rect, viewportWidth, viewportHeight);
    if (visibleRect.width < 16 || visibleRect.height < 16) {
      if (shouldDeferRevealOverlayHide(overlay, 'anchor_not_visible:' + (reason || 'unknown'))) {
        return true;
      }
      overlay.style.display = 'none';
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
      const anchor = resolveShortsRevealOverlayAnchor(overlay);
      if (!anchor) {
        overlay.style.display = 'none';
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

  function cancelShortsRevealOverlayReposition(reason) {
    if (!timerState.revealOverlayRepositionRaf) return;
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(timerState.revealOverlayRepositionRaf);
    }
    timerState.revealOverlayRepositionRaf = null;
    timerState.revealOverlayLastReason = '';
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
    const shortsVideoId = shortsMode
      ? getRevealShortsVideoId(src || (node.dataset ? node.dataset.mwSrc || '' : ''))
      : 'none';
    if (shortsMode) {
      const portal = document.getElementById(REVEAL_PORTAL_ID);
      if (portal && typeof portal.querySelectorAll === 'function') {
        const overlays = portal.querySelectorAll('.mw-reveal-overlay');
        for (let i = 0; i < overlays.length; i += 1) {
          const overlay = overlays[i];
          if (!overlay || !overlay.isConnected) continue;
          if (overlay.dataset.mwNodeId === nodeId) return overlay;
          if (src && overlay.dataset.mwFor === src) return overlay;
          if (shortsVideoId !== 'none' && overlay.dataset.mwShortsVideoId === shortsVideoId) return overlay;
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
        if (!shortsMode && src && overlay.dataset.mwFor === src) return overlay;
      }
    }
    return null;
  }

  function markRevealInteractionLock(reason) {
    const nextUntil = Date.now() + REVEAL_INTERACTION_LOCK_MS;
    if (nextUntil > revealInteractionLockState.until) {
      revealInteractionLockState.until = nextUntil;
    }
    revealInteractionLockState.reason = reason || 'interaction';
  }

  function getRevealInteractionLockRemainingMs() {
    return Math.max(0, revealInteractionLockState.until - Date.now());
  }

  function removeRevealOverlayNodeWithLock(overlay, reason) {
    if (!overlay || overlay.nodeType !== 1) return false;
    const parent = overlay.parentElement;
    if (!parent) return false;
    const remainingMs = getRevealInteractionLockRemainingMs();
    if (remainingMs > 0) {
      if (!overlay.__mwRevealDeferredRemovalTimer) {
        overlay.__mwRevealDeferredRemovalTimer = setTimeout(function() {
          overlay.__mwRevealDeferredRemovalTimer = null;
          removeRevealOverlayNodeWithLock(overlay, (reason || 'unknown') + '_deferred');
        }, remainingMs);
      }
      if (DIAG_YT_BLUR) {
        console.log(
          '[DIAG][REVEAL_LOCK]',
          'action=defer_remove',
          'overlayId=' + String((overlay.dataset && overlay.dataset.mwOverlayId) || 'unknown'),
          'reason=' + (reason || 'unknown'),
          'remainingMs=' + remainingMs,
          'lockReason=' + (revealInteractionLockState.reason || 'none')
        );
      }
      return false;
    }
    if (overlay.__mwRevealDeferredRemovalTimer) {
      clearTimeout(overlay.__mwRevealDeferredRemovalTimer);
      overlay.__mwRevealDeferredRemovalTimer = null;
    }
    if (parent) {
      parent.removeChild(overlay);
      return true;
    }
    return false;
  }

  function setRevealOverlayBlurState(overlay, blurred) {
    if (!overlay || overlay.nodeType !== 1) return;
    const nextBlurred = blurred ? 'true' : 'false';
    overlay.classList.add('mw-shorts-blur-container');
    overlay.dataset.blurred = nextBlurred;
    overlay.style.setProperty('--mw-reveal-button-opacity', blurred ? '1' : '0');
    overlay.style.pointerEvents = blurred ? 'auto' : 'none';
    const btn = typeof overlay.querySelector === 'function'
      ? overlay.querySelector('.mw-reveal-button, .mw-reveal-btn')
      : null;
    if (btn && btn.nodeType === 1) {
      btn.style.opacity = 'var(--mw-reveal-button-opacity)';
      btn.style.pointerEvents = blurred ? 'auto' : 'none';
      btn.style.display = blurred ? 'flex' : 'none';
    }
    if (!blurred) {
      overlay.style.display = 'none';
    }
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
      const remainingLockMs = getRevealInteractionLockRemainingMs();
      if (remainingLockMs > 0) {
        removeRevealOverlayNodeWithLock(overlay, reason || 'removeRevealOverlay');
        return false;
      }
      const overlayId = overlay.dataset && overlay.dataset.mwOverlayId ? overlay.dataset.mwOverlayId : 'unknown';
      setRevealOverlayBlurState(overlay, false);
      const removed = removeRevealOverlayNodeWithLock(overlay, reason || 'removeRevealOverlay');
      if (!removed) {
        return false;
      }
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
   * Animate reveal so blur removal does not snap on/off.
   */
  function animateRevealTransition(element) {
    if (!element || element.nodeType !== 1) return;
    try {
      element.style.setProperty('transition', REVEAL_TRANSITION_CSS, 'important');
      element.style.setProperty('opacity', '0.82', 'important');
      const runReveal = function() {
        try {
          element.style.setProperty('filter', 'none', 'important');
          element.style.setProperty('-webkit-filter', 'none', 'important');
          element.style.removeProperty('backdrop-filter');
          element.style.removeProperty('-webkit-backdrop-filter');
          element.style.removeProperty('background');
          element.style.setProperty('opacity', '1', 'important');
        } catch (e) {}
      };
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(runReveal);
      } else {
        setTimeout(runReveal, 0);
      }
    } catch (e) {}
  }

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
      element.style.removeProperty('background');
      element.classList.remove('mw-softblur');
      element.classList.remove('mw-blurred');
      const removedOverlay = removeRevealOverlay(element, src || element.dataset.mwSrc || '', reason || 'clear_all');
      if (removedOverlay) changed = true;
      element.dataset.mwHasOverlay = 'false';
      if (nextModeratedState) {
        element.dataset.mwModerated = nextModeratedState;
      }
      element.dataset.mwPreblurClear = 'true';
      if (isShortsModeActive()) {
        clearShortsBlurContextForNode(element, reason || 'clear_all');
      }
      if (changed) {
        const srcForSignal = src || element.dataset.mwSrc || '';
        const preserveRevealSignal = isShortsModeActive() && (
          hasRevealPersistence(srcForSignal, element) ||
          isCurrentShortsVideoRevealed()
        );
        if (preserveRevealSignal) {
          ensureRevealMarkerForElement(element, srcForSignal);
        }
        emitJsOverlayStateSignal(false, preserveRevealSignal, 'clear_blur_overlay', srcForSignal);
      }
    } catch (e) {}
    return changed;
  }

  /**
   * Apply soft blur (semantic delay) - light blur while waiting for result
   * After CONFIG.semanticDelayMs, if no result, keep soft blur only
   */
  function applySoftBlur(element, src, itemId) {
    diagBlurStateLog('applySoftBlur.enter', element, src, 'itemId=' + (itemId || 'none'));
    // Check persistence: if user revealed this, don't blur
    if (hasRevealPersistence(src, element)) {
      ensureRevealMarkerForElement(element, src);
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
      const revealedMasterState = shortsMode && (
        hasRevealPersistence(srcForClear, element) ||
        element.dataset.mwRevealed === 'true'
      );
      if (revealedMasterState) {
        ensureRevealMarkerForElement(element, srcForClear);
        diagSoftBlurLog('remove_skip', element, srcForClear, 'reason=revealed_master_state');
        diagBlurStateLog('removeSoftBlur.skip_revealed', element, srcForClear, '');
        return false;
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
    const shortsMode = isShortsModeActive();
    const activeShortsVideoId = shortsMode ? (getCurrentShortsUrlId() || 'none') : 'none';
    if (shortsMode && hasRevealLockForShortsVideoId(activeShortsVideoId)) {
      if (element && element.nodeType === 1) {
        const revealKey = activeShortsVideoId !== 'none'
          ? 'shorts_video:' + activeShortsVideoId
          : '';
        if (revealKey) {
          state.revealed.add(revealKey);
          state.revealed.add(activeShortsVideoId);
        }
        setElementRevealMarker(element, true, revealKey);
      }
      console.log(
        '[REVEAL_BLOCK] Skipping blur application because video is in revealed set.',
        'videoId=' + activeShortsVideoId,
        'itemId=' + (itemId || 'none')
      );
      return;
    }

    // Check persistence
    if (hasRevealPersistence(src, element)) {
      ensureRevealMarkerForElement(element, src);
      return;
    }
    if (element.dataset.mwRevealed === 'true') {
      markRevealPersistence(src, element);
      return;
    }
    
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
            element.style.removeProperty('background');
            element.style.removeProperty('opacity');
            element.dataset.mwPreblurClear = 'true';
          } catch (e) {}
        }
        element = stableTarget;
        shortsStableSelectorUsed = stableResolution.selectorUsed || '';
        if (shortsStableSelectorUsed) {
          element.dataset.mwShortsStableSelector = shortsStableSelectorUsed;
        }
      }
      if (element.dataset.mwRevealed === 'true') {
        markRevealPersistence(src, element);
        return;
      }
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
        if (element.isConnected) {
          if (shouldBlockRevealOverlayMutation('applyBlur_already_hard_blurred', activeShortsVideoId)) {
            diagScheduleBlurredNodePresenceChecks(element, src, itemId);
            emitJsOverlayStateSignal(true, false, 'apply_blur_overlay_lock', src);
            return;
          }
          const existingOverlay = findRevealOverlayForElement(element, src);
          if (existingOverlay && existingOverlay.isConnected) {
            setRevealOverlayActionContext(existingOverlay, element, src, category, itemId);
            ensurePrimaryShortsRevealOverlayId(existingOverlay, activeShortsVideoId);
            setRevealOverlayTimeoutSafeFailureState(
              existingOverlay,
              normalizePolicyCategory(category) === 'timeout',
            );
            setRevealOverlayBlurState(existingOverlay, true);
            existingOverlay.style.display = 'flex';
          } else {
            const reusedOverlay = tryReuseShortsVideoRevealOverlay(
              element,
              src,
              category,
              itemId,
              'applyBlur_already_hard_blurred_reuse',
            );
            if (!reusedOverlay) {
              createRevealOverlay(element, src, category, itemId, false);
            }
          }
        }
        diagScheduleBlurredNodePresenceChecks(element, src, itemId);
        emitJsOverlayStateSignal(true, false, 'apply_blur_already_present', src);
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
        element.style.removeProperty('background');
        element.style.removeProperty('opacity');
        diagShortsBlurStackLog('hard_after_clear', element, src, 'itemId=' + (itemId || 'N/A'));
      }
      // Frosted-glass hard blur treatment.
      element.style.setProperty('filter', 'blur(' + blurPx + 'px) brightness(0.8)', 'important');
      element.style.setProperty('-webkit-filter', 'blur(' + blurPx + 'px) brightness(0.8)', 'important');
      element.style.setProperty('backdrop-filter', HARD_GLASS_BACKDROP_FILTER, 'important');
      element.style.setProperty('-webkit-backdrop-filter', HARD_GLASS_BACKDROP_FILTER, 'important');
      element.style.setProperty('background', HARD_GLASS_BACKGROUND, 'important');
      element.style.setProperty('transition', REVEAL_TRANSITION_CSS, 'important');
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
      const overlayMutationLocked = shortsMode && shouldBlockRevealOverlayMutation('applyBlur', activeShortsVideoId);
      if (!overlayMutationLocked) {
        let overlayHandledByReuse = false;
        if (shortsMode && element.isConnected) {
          const reusedOverlay = tryReuseShortsVideoRevealOverlay(
            element,
            src,
            category,
            itemId,
            'applyBlur_video_overlay_reuse',
          );
          if (reusedOverlay && reusedOverlay.isConnected) {
            overlayHandledByReuse = true;
          }
        }
        if (!overlayHandledByReuse) {
          createRevealOverlay(element, src, category, itemId);
          if (shortsMode && element.isConnected && !findRevealOverlayForElement(element, src)) {
            createRevealOverlay(element, src, category, itemId, false);
          }
        }
        if (shortsMode) {
          startShortsRevealWatch('apply_blur:' + String(itemId || 'none'), { force: false });
        }
      } else {
        emitJsOverlayStateSignal(true, false, 'apply_blur_overlay_lock', src);
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
      if (shortsMode) {
        const currentVideoId = getCurrentShortsUrlId() || 'none';
        if (currentVideoId !== 'none' && state.revealed.has(currentVideoId)) {
          const revealKey = 'shorts_video:' + currentVideoId;
          state.revealed.add(revealKey);
          setElementRevealMarker(element, true, revealKey);
          if (overlayAfterApply && overlayAfterApply.isConnected) {
            setRevealOverlayBlurState(overlayAfterApply, false);
            overlayAfterApply.style.display = 'none';
          }
          clearNodeBlurForRevealEnforcement(element, revealKey);
          element.style.filter = 'none';
          element.style.setProperty('filter', 'none', 'important');
          element.style.setProperty('-webkit-filter', 'none', 'important');
          const activeVideoNode = element.tagName === 'VIDEO'
            ? element
            : (
              typeof element.querySelector === 'function'
                ? element.querySelector('video.html5-main-video, video')
                : null
            );
          if (activeVideoNode && activeVideoNode.nodeType === 1) {
            clearNodeBlurForRevealEnforcement(activeVideoNode, revealKey);
            activeVideoNode.style.filter = 'none';
            activeVideoNode.style.setProperty('filter', 'none', 'important');
            activeVideoNode.style.setProperty('-webkit-filter', 'none', 'important');
          }
          console.log('[REVEAL_ENFORCED] Actively removing blur due to Hard Lock.');
        }
      }
      emitJsOverlayStateSignal(true, false, 'apply_blur', src);
      diagBlurStateLog('applyBlur.exit', element, src, 'itemId=' + (itemId || 'N/A') + ' category=' + (category || 'flagged'));
      console.log('[MW] applied blur [' + category + '] itemId=' + (itemId || 'N/A') + ':', src.substring(0, 60));
    } catch (e) {
      console.error('[MW] Failed to apply blur:', e.message);
      state.stats.errors++;
    }
  }

  function removeBlur(element, src) {
    if (!element || element.nodeType !== 1) return false;
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
      if (!element || element.nodeType !== 1 || !element.isConnected) return false;
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
      animateRevealTransition(element);
      if (shortsMode) {
        setTimeout(function() {
          const stillRevealed = hasRevealPersistence(src, element) || element.dataset.mwRevealed === 'true';
          if (!stillRevealed) return;
          clearAllBlurAndOverlay(element, src, 'removeBlur_reveal', 'revealed');
        }, REVEAL_TRANSITION_MS);
      } else {
        element.dataset.mwModerated = 'revealed';
        element.dataset.mwPreblurClear = 'true';
        element.classList.remove('mw-softblur');
      }
      // Add to revealed set for persistence (Shorts uses video/sovereign identity).
      markRevealPersistence(src, element);
      
      if (shortsMode) {
        removeRevealOverlay(element, src, 'removeBlur_reveal');
      } else if (overlay) {
        overlay.style.display = 'none';
      }
      
      diagBlurStateLog('removeBlur.exit', element, src, 'overlayFound=' + (!!overlay));
      console.log('[MW] blur removed:', src.substring(0, 60));
      emitJsOverlayStateSignal(false, true, 'remove_blur', src);
      return true;
    } catch (e) {}
    return false;
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
        element.style.setProperty('filter', 'none', 'important');
        element.style.setProperty('-webkit-filter', 'none', 'important');
        element.style.removeProperty('backdrop-filter');
        element.style.removeProperty('-webkit-backdrop-filter');
        element.style.removeProperty('background');
        element.style.removeProperty('opacity');
        element.dataset.mwModerated = 'safe';
      }
      element.dataset.mwRevealed = hasRevealPersistence(srcForClear, element) ? 'true' : 'false';
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
        resolvedTarget.style.removeProperty('background');
        resolvedTarget.style.removeProperty('opacity');
        diagShortsBlurStackLog('overlay_reresolve_after_clear', resolvedTarget, src, 'reason=' + (reason || 'unknown'));
        resolvedTarget.style.setProperty('filter', 'blur(' + resolvedBlurPx + 'px) brightness(0.8)', 'important');
        resolvedTarget.style.setProperty('-webkit-filter', 'blur(' + resolvedBlurPx + 'px) brightness(0.8)', 'important');
        resolvedTarget.style.setProperty('backdrop-filter', HARD_GLASS_BACKDROP_FILTER, 'important');
        resolvedTarget.style.setProperty('-webkit-backdrop-filter', HARD_GLASS_BACKDROP_FILTER, 'important');
        resolvedTarget.style.setProperty('background', HARD_GLASS_BACKGROUND, 'important');
        resolvedTarget.style.setProperty('transition', REVEAL_TRANSITION_CSS, 'important');
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
    const existingOverlay = findRevealOverlayForElement(element, src);
    if (existingOverlay) {
      element.dataset.mwHasOverlay = 'true';
      if (shortsMode && element.dataset.mwModerated !== 'blurred') {
        removeRevealOverlay(element, src, 'createRevealOverlay_existing_not_blurred');
        return;
      }
      setRevealOverlayActionContext(existingOverlay, element, src, category, itemId);
      if (shortsMode) {
        ensurePrimaryShortsRevealOverlayId(existingOverlay, getCurrentShortsUrlId() || 'none');
      }
      setRevealOverlayTimeoutSafeFailureState(
        existingOverlay,
        normalizePolicyCategory(category) === 'timeout',
      );
      existingOverlay.style.pointerEvents = 'auto';
      existingOverlay.style.display = 'flex';
      existingOverlay.classList.add('mw-shorts-blur-container');
      setRevealOverlayBlurState(existingOverlay, true);
      const existingBtn = typeof existingOverlay.querySelector === 'function'
        ? existingOverlay.querySelector('.mw-reveal-btn, .mw-reveal-button')
        : null;
      if (existingBtn && existingBtn.nodeType === 1) {
        existingBtn.textContent = 'Tap to Reveal';
      }
      if (shortsMode) {
        setRevealOverlayAnchorTarget(existingOverlay, element, 'existing_overlay');
        const reboundAnchor = resolveShortsRevealOverlayAnchor(existingOverlay);
        logShortsProbe(
          'reveal_overlay_rebind',
          'overlayId=' + String((existingOverlay.dataset && existingOverlay.dataset.mwOverlayId) || 'unknown') +
          ' closureNodeId=' + getDiagNodeId(element) +
          ' closureSrc=' + String(src || '').substring(0, 180) +
          ' overlayNodeId=' + String((existingOverlay.dataset && existingOverlay.dataset.mwNodeId) || 'none') +
          ' overlayFor=' + String((existingOverlay.dataset && existingOverlay.dataset.mwFor) || '').substring(0, 180) +
          ' resolvedAnchorNodeId=' + getDiagNodeId(reboundAnchor) +
          ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
        );
        const portal = ensureRevealPortal();
        if (portal && existingOverlay.parentElement !== portal) {
          portal.appendChild(existingOverlay);
        }
        if (portal) {
          const activeOverlays = portal.querySelectorAll('.mw-reveal-overlay');
          for (let i = 0; i < activeOverlays.length; i += 1) {
            const active = activeOverlays[i];
            if (!active || active === existingOverlay) continue;
            removeRevealOverlayNodeWithLock(active, 'createRevealOverlay_existing_overlay_prune');
          }
        }
        positionShortsRevealOverlay(existingOverlay, element, 'existing_overlay');
        scheduleShortsRevealOverlayReposition('existing_overlay');
        console.log('[DIAG][REVEAL_UI] portal_update', 'itemKey=' + getDiagItemKey(src));
      }
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
    overlay.className = 'mw-reveal-overlay mw-shorts-blur-container';
    if (shortsMode) {
      ensurePrimaryShortsRevealOverlayId(overlay, getCurrentShortsUrlId() || 'none');
    }
    overlay.dataset.mwOverlayId = overlayId;
    setRevealOverlayActionContext(overlay, element, src, category, itemId);
    setRevealOverlayTimeoutSafeFailureState(
      overlay,
      normalizePolicyCategory(category) === 'timeout',
    );
    setRevealOverlayAnchorTarget(overlay, element, 'overlay_created');
    logShortsProbe(
      'reveal_overlay_create',
      'overlayId=' + overlayId +
      ' closureNodeId=' + getDiagNodeId(element) +
      ' closureSrc=' + String(src || '').substring(0, 180) +
      ' overlayNodeId=' + String((overlay.dataset && overlay.dataset.mwNodeId) || 'none') +
      ' overlayFor=' + String((overlay.dataset && overlay.dataset.mwFor) || '').substring(0, 180) +
      ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
    );
    overlay.style.cssText = [
      shortsMode ? 'position: fixed' : 'position: absolute',
      'inset: 0',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      shortsMode ? 'background: transparent' : 'background: rgba(0, 0, 0, 0.3)',
      shortsMode ? ('z-index: ' + String(LAYER_REVEAL_PORTAL_Z)) : 'z-index: 9998',
      'cursor: default',
      'pointer-events: auto',
    ].join(';');
    console.log(
      '[DIAG][REVEAL_UI] created',
      'overlayId=' + overlayId,
      'itemKey=' + itemKey,
      'navId=' + NAV_ID,
      'pageEpoch=' + state.pageEpoch
    );
    
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
    btn.className = 'mw-reveal-btn mw-reveal-button';
    btn.type = 'button';
    btn.textContent = 'Tap to Reveal';
    btn.style.cssText = [
      'display: inline-flex',
      'align-items: center',
      'justify-content: center',
      'min-width: 134px',
      'min-height: 38px',
      'padding: 10px 18px',
      'border-radius: 999px',
      'border: 1px solid rgba(255, 255, 255, 0.42)',
      'background: rgba(255, 255, 255, 0.2)',
      'color: rgba(255, 255, 255, 0.98)',
      'font-family: "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      'font-size: 13px',
      'font-weight: 600',
      'letter-spacing: 0.01em',
      'line-height: 1',
      'white-space: nowrap',
      'box-shadow: 0 8px 20px rgba(0, 0, 0, 0.24)',
      'backdrop-filter: blur(12px)',
      '-webkit-backdrop-filter: blur(12px)',
      'cursor: pointer',
      'z-index: 2',
      'pointer-events: auto',
      'transition: opacity 0.2s ease, transform 0.2s ease, background-color 0.2s ease',
    ].join(';');

    const lockRevealInteraction = function(lockReason) {
      markRevealInteractionLock((lockReason || 'interaction') + ':' + overlayId);
    };
    overlay.addEventListener('pointerdown', function() { lockRevealInteraction('overlay_pointerdown'); }, true);
    overlay.addEventListener('mousedown', function() { lockRevealInteraction('overlay_mousedown'); }, true);
    overlay.addEventListener('touchstart', function() { lockRevealInteraction('overlay_touchstart'); }, { passive: true, capture: true });
    btn.addEventListener('pointerdown', function() { lockRevealInteraction('button_pointerdown'); }, true);
    btn.addEventListener('mousedown', function() { lockRevealInteraction('button_mousedown'); }, true);
    btn.addEventListener('touchstart', function() { lockRevealInteraction('button_touchstart'); }, { passive: true, capture: true });

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
      lockRevealInteraction('button_click');
      console.log(
        '[DIAG][REVEAL_EVT] button_click',
        'overlayId=' + overlayId,
        'target=' + getDiagTargetDescriptor(e.target)
      );
      logRevealHittestSnapshot(overlay, btn, overlayId, 'button_click', e);
      const actionContext = getRevealOverlayActionContext(overlay);
      let clickElement = actionContext.element;
      const clickSrc = String(actionContext.src || '');
      const clickCategory = String(actionContext.category || 'flagged');
      const clickItemId = String(actionContext.itemId || '');
      const clickItemKey = String(actionContext.itemKey || getDiagItemKey(clickSrc));
      const resolvedAnchorAtClick = resolveShortsRevealOverlayAnchor(overlay);
      if (resolvedAnchorAtClick && resolvedAnchorAtClick.nodeType === 1 && resolvedAnchorAtClick.isConnected) {
        clickElement = resolvedAnchorAtClick;
      }
      if (clickElement && clickSrc) {
        setRevealOverlayActionContext(overlay, clickElement, clickSrc, clickCategory, clickItemId);
      }
      logShortsProbe(
        'reveal_click_target',
        'overlayId=' + overlayId +
        ' actionNodeId=' + getDiagNodeId(clickElement) +
        ' actionSrc=' + String(clickSrc || '').substring(0, 180) +
        ' overlayNodeId=' + String((overlay.dataset && overlay.dataset.mwNodeId) || 'none') +
        ' overlayFor=' + String((overlay.dataset && overlay.dataset.mwFor) || '').substring(0, 180) +
        ' resolvedAnchorNodeId=' + getDiagNodeId(resolvedAnchorAtClick) +
        ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
      );
      if (!clickSrc) {
        console.warn('[DIAG][REVEAL_EVT] missing_click_src', 'overlayId=' + overlayId);
        return;
      }
      const revealAllowed = !hasRevealPersistence(clickSrc, clickElement);
      const revealGateReason = revealAllowed ? 'not_revealed' : 'already_revealed_reblur_path';
      console.log(
        '[DIAG][REVEAL_EVT] reveal_allowed=' + revealAllowed,
        'reason=' + revealGateReason,
        'overlayId=' + overlayId,
        'itemKey=' + clickItemKey
      );
      
      if (hasRevealPersistence(clickSrc, clickElement)) {
        // Re-blur
        clearRevealPersistence(clickSrc, clickElement);
        if (clickElement && clickElement.nodeType === 1) {
          applyBlur(clickElement, clickSrc, clickCategory, CONFIG.blurStrength, clickItemId);
        }
        btn.textContent = 'Tap to Reveal';
        setRevealOverlayBlurState(overlay, true);
        overlay.style.display = 'flex';
      } else {
        // Reveal and trigger feedback
        const beforeBlurCount = countBlurredNodesForItemKey(clickSrc);
        console.log(
          '[DIAG][REVEAL_EVT] reveal_apply_start',
          'overlayId=' + overlayId,
          'itemKey=' + clickItemKey,
          'beforeBlurCount=' + beforeBlurCount
        );
        const revealDeadlineAt = Date.now() + 200;
        const attemptRevealCommit = function(attemptReason) {
          let resolvedClickElement = clickElement;
          const resolvedAnchorAtAttempt = resolveShortsRevealOverlayAnchor(overlay);
          if (resolvedAnchorAtAttempt && resolvedAnchorAtAttempt.nodeType === 1 && resolvedAnchorAtAttempt.isConnected) {
            resolvedClickElement = resolvedAnchorAtAttempt;
          }
          if (!(resolvedClickElement && resolvedClickElement.nodeType === 1 && resolvedClickElement.isConnected)) {
            if (Date.now() < revealDeadlineAt) {
              setRevealOverlayBlurState(overlay, true);
              overlay.style.display = 'flex';
              btn.textContent = 'Tap to Reveal';
              setTimeout(function() {
                attemptRevealCommit('retry_missing_target');
              }, 40);
              return;
            }
            console.warn(
              '[DIAG][REVEAL_EVT] reveal_apply_abort_missing_target',
              'overlayId=' + overlayId,
              'itemKey=' + clickItemKey,
              'attempt=' + (attemptReason || 'unknown')
            );
            setRevealOverlayBlurState(overlay, true);
            overlay.style.display = 'flex';
            btn.textContent = 'Tap to Reveal';
            return;
          }
          clickElement = resolvedClickElement;
          setRevealOverlayActionContext(overlay, resolvedClickElement, clickSrc, clickCategory, clickItemId);
          const removed = removeBlur(resolvedClickElement, clickSrc);
          if (!removed) {
            if (Date.now() < revealDeadlineAt) {
              setRevealOverlayBlurState(overlay, true);
              overlay.style.display = 'flex';
              btn.textContent = 'Tap to Reveal';
              setTimeout(function() {
                attemptRevealCommit('retry_remove_failed');
              }, 40);
              return;
            }
            console.warn(
              '[DIAG][REVEAL_EVT] reveal_apply_abort_remove_failed',
              'overlayId=' + overlayId,
              'itemKey=' + clickItemKey,
              'attempt=' + (attemptReason || 'unknown')
            );
            setRevealOverlayBlurState(overlay, true);
            overlay.style.display = 'flex';
            btn.textContent = 'Tap to Reveal';
            return;
          }
          setRevealOverlayBlurState(overlay, false);
          emitJsOverlayStateSignal(false, true, 'reveal_button_success', clickSrc);
          const currentSovereignId = computeSovereignId(state.pageEpoch);
          postToHost({
            type: 'MW_USER_REVEAL_REQUEST',
            sovereignId: currentSovereignId,
            pageEpoch: state.pageEpoch,
            navId: NAV_ID,
            timestamp: Date.now(),
          });
          console.log(
            '[MW][SYNC] reveal_request',
            'sovereignId=' + (currentSovereignId || 'none'),
            'navId=' + NAV_ID,
            'pageEpoch=' + state.pageEpoch
          );
          btn.textContent = 'Hide';
          const afterBlurCount = countBlurredNodesForItemKey(clickSrc);
          const removedBlurCount = beforeBlurCount > afterBlurCount ? (beforeBlurCount - afterBlurCount) : 0;
          const remainingBlurNodeIds = getBlurredNodeIdsForItemKey(clickSrc, 24);
          console.log(
            '[DIAG][REVEAL_EVT] reveal_apply_done',
            'overlayId=' + overlayId,
            'itemKey=' + clickItemKey,
            'removedBlurCount=' + removedBlurCount
          );
          logShortsProbe(
            'reveal_post_blur_state',
            'overlayId=' + overlayId +
            ' clickedSrc=' + String(clickSrc || '').substring(0, 180) +
            ' clickedNodeId=' + getDiagNodeId(clickElement) +
            ' remainingBlurCount=' + remainingBlurNodeIds.length +
            ' remainingBlurNodeIds=' + (remainingBlurNodeIds.length ? remainingBlurNodeIds.join('|') : 'none') +
            ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
          );

          // POST a label request message so the host can open the labeling modal
          var labelElement = clickElement && clickElement.nodeType === 1 ? clickElement : null;
          var labelDataset = labelElement && labelElement.dataset ? labelElement.dataset : {};
          var labelItemId = clickItemId || labelDataset.mwItemId || 'unknown_' + Date.now();
          var mwModelVersion = labelDataset.mwModelVersion || null;
          var mwDecisionReason = labelDataset.mwDecisionReason || null;
          var mwNsfwRisk = toFiniteNumber(labelDataset.mwNsfwRisk);
          var mwPersonPresent = labelDataset.mwPersonPresent === '1';
          var mwSkinRatio = toFiniteNumber(labelDataset.mwSkinRatio);
          var mwThirstScore = toFiniteNumber(labelDataset.mwThirstScore);
          var mwSkinThreshold = toFiniteNumber(labelDataset.mwSkinThreshold);
          var mwGrayMin = toFiniteNumber(labelDataset.mwGrayZoneMin);
          var mwGrayMax = toFiniteNumber(labelDataset.mwGrayZoneMax);
          var mwExplicitOverride = toFiniteNumber(labelDataset.mwExplicitOverride);
          var mwImageWidth = toFiniteNumber(labelDataset.mwImageWidth);
          var mwImageHeight = toFiniteNumber(labelDataset.mwImageHeight);
          var mwHost = labelDataset.mwHost || null;
          var labelRequest = {
            type: 'gc-label-request',
            requestId: 'r_' + Date.now().toString(36),
            itemId: labelItemId,
            src: clickSrc,
            pageUrl: window.location.href,
            platform: PLATFORM,
            modelPrediction: {
              category: clickCategory,
              confidence: toFiniteNumber(labelDataset.mwConfidence),
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
          if (labelElement) {
            showCorrectionOverlay(labelElement, clickSrc, clickCategory, labelItemId);
          }
        };
        attemptRevealCommit('initial');
      }
    });
    console.log('[DIAG][REVEAL_UI] bind_button', 'overlayId=' + overlayId);
    
    overlay.appendChild(btn);
    setRevealOverlayBlurState(overlay, true);
    if (shortsMode) {
      const activeOverlays = overlayParent.querySelectorAll('.mw-reveal-overlay');
      for (let i = 0; i < activeOverlays.length; i += 1) {
        const active = activeOverlays[i];
        if (!active || active === overlay) continue;
        removeRevealOverlayNodeWithLock(active, 'createRevealOverlay_new_overlay_prune');
      }
      positionShortsRevealOverlay(overlay, element, 'overlay_created');
      scheduleShortsRevealOverlayReposition('overlay_created');
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
    const contextSync = syncActiveContextFromHost('request_preflight', {
      resetTransientState: true,
      clearScanState: false,
    });
    if (contextSync.contextChanged) {
      if (isShortsModeActive()) {
        logShortsScanSkip('context_resync_drop_batch', null, 'request_batch', 'preflight');
      }
      items.forEach(function(item) {
        if (item && item.itemId) {
          clearPendingItem(item.itemId, 'context_resync_drop_batch');
        }
      });
      scheduleInitTimeout('contextResyncFullScan', scanFullPage, 80);
      if (isYouTube()) {
        scheduleYouTubeScan('context_resync_preflight');
      }
      return;
    }
    
    const requestId = generateRequestId();
    const timestamp = Date.now();
    const requestSovereignId = computeSovereignId(state.pageEpoch);
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
      sovereignId: requestSovereignId,
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
      sovereignId: requestSovereignId,
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
      'sovereignId=' + requestSovereignId,
    );
    logShortsProbe(
      'mw_req_sent',
      'requestId=' + requestId +
      ' navId=' + NAV_ID +
      ' pageEpoch=' + state.pageEpoch +
      ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none') +
      ' sovereignId=' + requestSovereignId +
      ' itemCount=' + items.length +
      ' itemIds=' + items.map(item => String(item.itemId || 'none')).join(',')
    );
    postToHost({
      type: 'MW_REQ_SENT',
      requestId: requestId,
      navId: NAV_ID,
      pageEpoch: state.pageEpoch,
      sovereignId: requestSovereignId,
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
      sovereignId: pendingRequest.sovereignId || computeSovereignId(state.pageEpoch),
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
    } else if (isShortsModeActive()) {
      // Shorts timeout fallback: keep content protected and always provide reveal UI.
      console.warn('[MW] TIMEOUT SAFE-FAILURE: Applying fallback blur + reveal UI');
      pendingRequest.items.forEach(item => {
        clearPendingItem(item.itemId, 'timeout_safeFailure');
        const element = state.elements.get(item.itemId);
        const revealed = hasRevealPersistence(item.src, element);
        if (revealed || (element && element.dataset && element.dataset.mwRevealed === 'true')) {
          ensureRevealMarkerForElement(element, item.src);
          logShortsProbe(
            'timeout_safe_failure_skip_revealed',
            'requestId=' + String(requestId || 'none') +
            ' itemId=' + String(item.itemId || 'none') +
            ' src=' + String(item.src || '').substring(0, 180)
          );
          return;
        }
        if (element && element.isConnected) {
          applyBlur(element, item.src, 'timeout', CONFIG.blurStrength, item.itemId);
        } else {
          if (!hasRevealPersistence(item.src, null)) {
            findAndBlur(item.src, 'timeout', CONFIG.blurStrength, true, item.itemId);
          }
        }
      });
      const ensured = ensureTapToRevealOverlay('request_timeout_safe_failure');
      if (!ensured) {
        startShortsRevealWatch('request_timeout_safe_failure', {
          force: true,
          key: pendingRequest.sovereignId || computeSovereignId(state.pageEpoch),
          videoId: getCurrentShortsUrlId() || 'none',
        });
      }
    } else {
      // Non-Shorts FAIL-OPEN: remove soft blur, mark as safe.
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
      const resultSovereignId = typeof message.sovereignId === 'string' ? message.sovereignId : '';
      const expectedNoncePrefix = String(CONFIG.nonce || '').substring(0, 6);
      const receivedNoncePrefix = String(nonce || 'none').substring(0, 6);
      const stickyShortsMode = isYouTubeShortsUrl(window.location.href);
      const stickyShortsRelatedMode = isYouTubeShortsRelatedUrl(window.location.href);
      const relaxedYouTubeEpochMode = isYouTubeDomainUrl(window.location.href) && !stickyShortsMode && !stickyShortsRelatedMode;
      const requestIdLabel = typeof requestId === 'string' ? requestId : 'none';
      const resultCount = Array.isArray(results) ? results.length : 0;
      const itemIdsPreview = Array.isArray(results)
        ? results
            .slice(0, 6)
            .map(result => String(result && result.itemId ? result.itemId : 'none'))
            .join(',')
        : 'none';
      const hasPendingRequestAtEntry = requestIdLabel !== 'none' && state.pendingRequests.has(requestIdLabel);
      const pendingRequestAtEntry = requestIdLabel !== 'none' ? state.pendingRequests.get(requestIdLabel) : null;
      const expectedSovereignId = pendingRequestAtEntry && typeof pendingRequestAtEntry.sovereignId === 'string'
        ? pendingRequestAtEntry.sovereignId
        : '';
      const currentSovereignId = computeSovereignId(state.pageEpoch);
      let epochBypassState = 'none';
      logShortsProbe(
        'result_identity_enter',
        'requestId=' + requestIdLabel +
        ' resultCount=' + resultCount +
        ' itemIds=' + itemIdsPreview +
        ' resultEpoch=' + (resultEpoch === null ? 'none' : resultEpoch) +
        ' currentPageEpoch=' + state.pageEpoch +
        ' hasPendingRequest=' + hasPendingRequestAtEntry +
        ' resultSovereignId=' + (resultSovereignId || 'none') +
        ' expectedSovereignId=' + (expectedSovereignId || 'none') +
        ' currentSovereignId=' + currentSovereignId +
        ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
      );
      if (resultEpoch !== null && resultEpoch !== state.pageEpoch && !relaxedYouTubeEpochMode) {
        const rejectReason = stickyShortsMode
          ? 'result_epoch_mismatch_shorts_strict'
          : stickyShortsRelatedMode
            ? 'result_epoch_mismatch_shorts_related_strict'
          : 'result_epoch_mismatch_non_youtube';
        epochBypassState = 'blocked_non_youtube';
        logShortsProbe(
          'result_epoch_gate',
          'requestId=' + requestIdLabel +
          ' gate=' + epochBypassState +
          ' resultEpoch=' + resultEpoch +
          ' currentPageEpoch=' + state.pageEpoch +
          ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
        );
        diagEpochBypassCounters.epoch_bypass_blocked += 1;
        diagLogEpochBypass(
          'epoch_bypass_blocked',
          rejectReason,
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
        epochBypassState = 'allowed_youtube_relaxed';
        logShortsProbe(
          'result_epoch_gate',
          'requestId=' + requestIdLabel +
          ' gate=' + epochBypassState +
          ' resultEpoch=' + resultEpoch +
          ' currentPageEpoch=' + state.pageEpoch +
          ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
        );
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
        logShortsProbe(
          'result_nonce_reject',
          'requestId=' + requestIdLabel +
          ' expectedNonce=' + expectedNoncePrefix +
          ' gotNonce=' + receivedNoncePrefix +
          ' resultEpoch=' + (resultEpoch === null ? 'none' : resultEpoch) +
          ' currentPageEpoch=' + state.pageEpoch +
          ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
        );
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

      if (stickyShortsMode) {
        const missingSovereign = !resultSovereignId;
        const pendingMismatch = !!expectedSovereignId && resultSovereignId !== expectedSovereignId;
        const currentMismatch = !!resultSovereignId && resultSovereignId !== currentSovereignId;
        const expectedSovereignParts = parseSovereignId(expectedSovereignId);
        const resultSovereignParts = parseSovereignId(resultSovereignId);
        const allowNavShiftForSameVideo = (
          pendingMismatch &&
          !currentMismatch &&
          expectedSovereignParts.videoId !== 'none' &&
          expectedSovereignParts.videoId === resultSovereignParts.videoId
        );
        if (allowNavShiftForSameVideo) {
          logShortsProbe(
            'result_sovereign_accept_nav_shift',
            'requestId=' + requestIdLabel +
            ' expected=' + (expectedSovereignId || 'none') +
            ' result=' + (resultSovereignId || 'none') +
            ' current=' + currentSovereignId
          );
          const ensuredOnNavShift = ensureTapToRevealOverlay('result_sovereign_nav_shift_accept');
          if (!ensuredOnNavShift) {
            const navShiftSovereign = resultSovereignId || expectedSovereignId || currentSovereignId;
            const navShiftVideoId = parseSovereignId(navShiftSovereign).videoId;
            startShortsRevealWatch('result_sovereign_nav_shift_accept', {
              force: false,
              key: navShiftSovereign || currentSovereignId,
              videoId: navShiftVideoId || getCurrentShortsUrlId() || 'none',
            });
          }
        }
        if (missingSovereign || (pendingMismatch && !allowNavShiftForSameVideo) || currentMismatch) {
          logShortsProbe(
            'result_sovereign_reject',
            'requestId=' + requestIdLabel +
            ' missing=' + missingSovereign +
            ' pendingMismatch=' + pendingMismatch +
            ' currentMismatch=' + currentMismatch +
            ' resultSovereignId=' + (resultSovereignId || 'none') +
            ' expectedSovereignId=' + (expectedSovereignId || 'none') +
            ' currentSovereignId=' + currentSovereignId
          );
          state.stats.staleEpochDiscarded++;
          console.warn(
            '[MW][RejectResult]',
            'reason=sovereign',
            'requestId=' + requestIdLabel,
            'resultSovereignId=' + (resultSovereignId || 'none'),
            'expectedSovereignId=' + (expectedSovereignId || 'none'),
            'currentSovereignId=' + currentSovereignId,
          );
          cleanupRejectedOrTimedOutRequest(requestId, 'reject_sovereign');
          return;
        }
      }

      const pendingRequest = pendingRequestAtEntry || state.pendingRequests.get(requestId);
      if (pendingRequest) {
        clearTimeout(pendingRequest.timeoutId);
        pendingRequest.state = 'handled';
        state.pendingRequests.delete(requestId);
      }
      
      state.stats.responsesReceived++;
      logShortsProbe(
        'result_identity_accept',
        'requestId=' + requestIdLabel +
        ' hasPendingRequest=' + hasPendingRequestAtEntry +
        ' epochBypass=' + epochBypassState +
        ' resultCount=' + resultCount +
        ' resultSovereignId=' + (resultSovereignId || 'none') +
        ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
      );
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
      const activeShortsVideoIdForDecision = isShortsModeActive()
        ? (getCurrentShortsUrlId() || 'none')
        : 'none';
      const hardRevealVideoLock = (
        finalBlur &&
        activeShortsVideoIdForDecision !== 'none' &&
        hasRevealLockForShortsVideoId(activeShortsVideoIdForDecision)
      );
      if (hardRevealVideoLock) {
        finalBlur = false;
        decisionReason = (decisionReason ? decisionReason + '/' : '') + 'revealed_video_lock';
        if (element && element.nodeType === 1) {
          const revealKey = 'shorts_video:' + activeShortsVideoIdForDecision;
          state.revealed.add(revealKey);
          state.revealed.add(activeShortsVideoIdForDecision);
          setElementRevealMarker(element, true, revealKey);
        }
        console.log(
          '[REVEAL_BLOCK] Skipping blur application because video is in revealed set.',
          'videoId=' + activeShortsVideoIdForDecision,
          'itemId=' + String(itemId || 'none')
        );
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
      logShortsProbe(
        'result_apply_decision',
        'requestId=' + requestIdLabel +
        ' itemId=' + String(itemId || 'none') +
        ' src=' + String(src || '').substring(0, 180) +
        ' finalBlur=' + finalBlur +
        ' hasElement=' + (!!(element && element.isConnected)) +
        ' elementNodeId=' + getDiagNodeId(element) +
        ' resultEpoch=' + (resultEpoch === null ? 'none' : resultEpoch) +
        ' currentPageEpoch=' + state.pageEpoch +
        ' epochBypass=' + epochBypassState +
        ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
      );
      
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
    if (hasRevealPersistence(src, null)) return;
    
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
        if ((img.src === src || img.dataset.mwOrigSrc === src) && !hasRevealPersistence(src, img)) {
          trackFanoutNode(img);
          if (img.dataset.mwModerated === 'blurred' && img.dataset.mwRevealed !== 'true' && isShortsModeActive()) {
            if (!findRevealOverlayForElement(img, src) && img.isConnected) {
              createRevealOverlay(img, src, category);
            }
            return;
          }
          if (img.dataset.mwModerated !== 'blurred' && img.dataset.mwRevealed !== 'true') {
            applyBlur(img, src, category, blurStrengthPx);
            fanoutApplied += 1;
          }
        }
      });
      
      // Video posters
      document.querySelectorAll('video').forEach(video => {
        if ((video.poster === src || video.dataset.mwOrigPoster === src) && !hasRevealPersistence(src, video)) {
          trackFanoutNode(video);
          if (video.dataset.mwModerated === 'blurred' && video.dataset.mwRevealed !== 'true' && isShortsModeActive()) {
            if (!findRevealOverlayForElement(video, src) && video.isConnected) {
              createRevealOverlay(video, src, category);
            }
            return;
          }
          if (video.dataset.mwModerated !== 'blurred' && video.dataset.mwRevealed !== 'true') {
            applyBlur(video, src, category, blurStrengthPx);
            fanoutApplied += 1;
          }
        }
      });
      
      // Background images
      document.querySelectorAll('[data-mw-bg-src]').forEach(el => {
        if (el.dataset.mwBgSrc === src && !hasRevealPersistence(src, el)) {
          trackFanoutNode(el);
          if (el.dataset.mwModerated === 'blurred' && el.dataset.mwRevealed !== 'true' && isShortsModeActive()) {
            if (!findRevealOverlayForElement(el, src) && el.isConnected) {
              createRevealOverlay(el, src, category);
            }
            return;
          }
          if (el.dataset.mwModerated !== 'blurred' && el.dataset.mwRevealed !== 'true') {
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

  const previousShortsProbeResultListenerSeq = Number(window.__MW_SHORTS_PROBE_RESULT_LISTENER_SEQ__ || 0);
  const shortsProbeResultListenerSeq = Number.isFinite(previousShortsProbeResultListenerSeq)
    ? (previousShortsProbeResultListenerSeq + 1)
    : 1;
  window.__MW_SHORTS_PROBE_RESULT_LISTENER_SEQ__ = shortsProbeResultListenerSeq;
  const SHORTS_PROBE_RESULT_LISTENER_ID = 'rl' + shortsProbeResultListenerSeq;
  logShortsProbe(
    'result_listener_attach',
    'listenerId=' + SHORTS_PROBE_RESULT_LISTENER_ID +
    ' navId=' + String(window.__MW_NAV_ID__ || 'none') +
    ' pageEpoch=' + (Number.isFinite(state.pageEpoch) ? state.pageEpoch : 'none') +
    ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
  );

  const onModerationResultEvent = function(event) {
    const message = readHostEventPayload(event);
    if (!message || typeof message !== 'object') return;
    
    if (message.type === 'gc-moderation-result') {
      const requestId = typeof message.requestId === 'string' ? message.requestId : 'none';
      const resultEpoch = Number.isFinite(message.pageEpoch) ? Number(message.pageEpoch) : null;
      const resultCount = Array.isArray(message.results) ? message.results.length : 0;
      const itemPreview = Array.isArray(message.results)
        ? message.results
            .slice(0, 5)
            .map(result => String(result && result.itemId ? result.itemId : 'none'))
            .join(',')
        : 'none';
      logShortsProbe(
        'result_listener_handle_entry',
        'listenerId=' + SHORTS_PROBE_RESULT_LISTENER_ID +
        ' requestId=' + requestId +
        ' resultEpoch=' + (resultEpoch === null ? 'none' : resultEpoch) +
        ' currentPageEpoch=' + state.pageEpoch +
        ' hasPendingRequest=' + state.pendingRequests.has(requestId) +
        ' resultCount=' + resultCount +
        ' itemIds=' + itemPreview +
        ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
      );
      handleModerationResult(message);
    }
  };
  window.addEventListener('message', onModerationResultEvent);
  window.addEventListener('messageFromNative', onModerationResultEvent);

  // ==================== BATCH QUEUE MANAGEMENT ====================

  function collectCurrentShortsMatchTokens() {
    const tokens = new Set();
    const shortsUrlId = getCurrentShortsUrlId();
    if (shortsUrlId && shortsUrlId !== 'none') {
      tokens.add(shortsUrlId);
    }
    const candidateNodes = [];
    const activeContainer = getActiveShortsPlayerContainer();
    if (activeContainer && activeContainer.nodeType === 1) {
      candidateNodes.push(activeContainer);
      if (typeof activeContainer.querySelector === 'function') {
        const nested = activeContainer.querySelector('ytd-reel-video-renderer, ytm-reel-video-renderer');
        if (nested && nested.nodeType === 1) {
          candidateNodes.push(nested);
        }
      }
    }
    for (let i = 0; i < candidateNodes.length; i += 1) {
      const node = candidateNodes[i];
      if (!node || !node.getAttribute) continue;
      const attrs = ['v', 'data-video-id', 'data-item-id', 'data-id'];
      for (let j = 0; j < attrs.length; j += 1) {
        const value = String(node.getAttribute(attrs[j]) || '').trim();
        if (value && value !== 'none' && value.length >= 4) {
          tokens.add(value);
        }
      }
    }
    return Array.from(tokens);
  }

  function countTrustedOrMatchingShortsItems(items, matchTokens) {
    if (!Array.isArray(items) || items.length === 0) return 0;
    return items.reduce(function(count, item) {
      if (!item) return count;
      const sourceType = String(item.sourceType || '');
      if (sourceType === 'video-frame') return count + 1;
      const src = String(item.src || '');
      for (let i = 0; i < matchTokens.length; i += 1) {
        const token = String(matchTokens[i] || '');
        if (token && src.indexOf(token) !== -1) {
          return count + 1;
        }
      }
      return count;
    }, 0);
  }

  function resolveActiveShortsVideoForForcedCapture() {
    const activeContainer = getActiveShortsPlayerContainer();
    if (activeContainer && activeContainer.isConnected) {
      const tagName = String(activeContainer.tagName || '').toUpperCase();
      if (tagName === 'VIDEO') return activeContainer;
      if (typeof activeContainer.querySelector === 'function') {
        const fromContainer = activeContainer.querySelector('video.html5-main-video, video');
        if (fromContainer && fromContainer.isConnected) {
          return fromContainer;
        }
      }
    }
    const fallbackVideo = document.querySelector(SHORTS_FALLBACK_VIDEO_SELECTOR);
    if (fallbackVideo && fallbackVideo.isConnected) return fallbackVideo;
    return null;
  }

  function buildForcedShortsFrameItem(reason, matchTokens) {
    const videoNode = resolveActiveShortsVideoForForcedCapture();
    if (!videoNode) {
      console.log(
        '[DIAG][SHORTS_SCAN] force_frame_capture',
        'reason=' + (reason || 'unknown'),
        'result=failed',
        'error=no_video_node',
        'matchTokens=' + (matchTokens.length ? matchTokens.join(',') : 'none')
      );
      return null;
    }

    const frameCapture = tryCaptureActiveShortsVideoFrame(videoNode);
    if (!frameCapture.ok || !frameCapture.src) {
      console.log(
        '[DIAG][SHORTS_SCAN] force_frame_capture',
        'reason=' + (reason || 'unknown'),
        'result=failed',
        'error=' + String(frameCapture.reason || 'capture_failed'),
        'readyState=' + String(frameCapture.readyState || 'n/a'),
        'matchTokens=' + (matchTokens.length ? matchTokens.join(',') : 'none')
      );
      return null;
    }

    const frameSrc = frameCapture.src;
    const existingPendingId = state.pendingBySrc.get(frameSrc);
    if (existingPendingId) {
      const existingPending = state.pending.get(existingPendingId);
      if (existingPending) {
        const existingDims = getElementDimensions(existingPending.element || videoNode);
        return {
          itemId: existingPendingId,
          src: existingPending.src,
          sourceType: existingPending.sourceType || 'video-frame',
          width: existingDims.width,
          height: existingDims.height,
        };
      }
      state.pendingBySrc.delete(frameSrc);
    }

    const itemId = generateItemId();
    const sourceType = 'video-frame';
    const width = Math.max(1, Number(frameCapture.width) || getElementDimensions(videoNode).width || 1);
    const height = Math.max(1, Number(frameCapture.height) || getElementDimensions(videoNode).height || 1);
    videoNode.dataset.mwSourceType = sourceType;
    state.elements.set(itemId, videoNode);
    applySoftBlur(videoNode, frameSrc, itemId);
    state.pending.set(itemId, {
      element: videoNode,
      src: frameSrc,
      sourceType: sourceType,
      timestamp: Date.now(),
      state: 'pending',
      blurTimer: null,
    });
    state.pendingBySrc.set(frameSrc, itemId);
    state.stats.videoPosters++;
    diagScanSourceCounters.video_frame_scan_used += 1;
    console.log(
      '[DIAG][SHORTS_SCAN] force_frame_capture',
      'reason=' + (reason || 'unknown'),
      'result=queued',
      'itemId=' + itemId,
      'capture=' + width + 'x' + height,
      'matchTokens=' + (matchTokens.length ? matchTokens.join(',') : 'none')
    );
    return {
      itemId: itemId,
      src: frameSrc,
      sourceType: sourceType,
      width: width,
      height: height,
    };
  }

  function flushBatchQueue() {
    if (batchQueue.length === 0) return;
    
    const itemsToSend = batchQueue.splice(0, CONFIG.batchSize);
    if (isShortsModeActive()) {
      const matchTokens = collectCurrentShortsMatchTokens();
      const matchingBefore = countTrustedOrMatchingShortsItems(itemsToSend, matchTokens);
      if (matchingBefore <= 0) {
        const forcedFrameItem = buildForcedShortsFrameItem('pre_request_zero_match', matchTokens);
        if (forcedFrameItem) {
          itemsToSend.push(forcedFrameItem);
        }
      }
      const matchingAfter = countTrustedOrMatchingShortsItems(itemsToSend, matchTokens);
      const discoveredItems = itemsToSend.map(item => ({
        itemId: item.itemId,
        src: String(item.src || '').substring(0, 180),
        sourceType: item.sourceType || 'unknown',
      }));
      console.log(
        '[DIAG][SHORTS_SCAN] discovered',
        'count=' + discoveredItems.length,
        'matching=' + matchingAfter,
        'matchTokens=' + (matchTokens.length ? matchTokens.join(',') : 'none'),
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
    if (hasRevealPersistence(url, element)) {
      ensureRevealMarkerForElement(element, url);
      logShortsScanSkip('revealed_persistence', null, url, sourceType);
      return false;
    }
    if (element.dataset.mwRevealed === 'true') {
      markRevealPersistence(url, element);
      logShortsProbe(
        'queue_skip_mwRevealed_dataset',
        'nodeId=' + getDiagNodeId(element) +
        ' src=' + String(url || '').substring(0, 180) +
        ' previousSrc=' + String(element.dataset.mwLastScanSrc || element.dataset.mwSrc || '').substring(0, 180) +
        ' shortsUrlId=' + (getCurrentShortsUrlId() || 'none')
      );
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

  let primaryMutationObserverBootstrapped = false;

  function bootstrapPrimaryMutationObserver(reason) {
    if (primaryMutationObserverBootstrapped) return true;
    const root = document.body || document.documentElement;
    if (!root) {
      console.log('[MW][Observer] bootstrap_deferred', 'reason=' + (reason || 'unknown'));
      return false;
    }
    const observer = setupMutationObserver(root);
    if (!observer) return false;
    primaryMutationObserverBootstrapped = true;
    return true;
  }

  function setupMutationObserver(root) {
    if (!root || (
      root.nodeType !== 1 &&
      root.nodeType !== 9 &&
      root.nodeType !== 11
    )) {
      console.log('[MW][Observer] setup_skipped_invalid_root');
      return null;
    }
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
          
          // Add to viewport observer for lazy scanning
          observeForViewport(node);
          queueMutationScan(node, 'mutation_added');
        });
        
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          const attr = mutation.attributeName || '';
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
        background: rgba(255, 255, 255, 0.06) !important;
        z-index: 9998 !important;
        pointer-events: auto !important;
      }
      .mw-shorts-blur-container {
        --mw-reveal-button-opacity: 0;
      }
      .mw-shorts-blur-container[data-mw-timeout-safe-failure="true"] {
        z-index: 2147483647 !important;
      }
      .mw-shorts-blur-container[data-mw-timeout-safe-failure="true"] .mw-reveal-btn,
      .mw-shorts-blur-container[data-mw-timeout-safe-failure="true"] .mw-reveal-button {
        z-index: 2147483647 !important;
      }
      .mw-shorts-blur-container[data-blurred="true"] {
        --mw-reveal-button-opacity: 1;
        pointer-events: auto !important;
      }
      .mw-shorts-blur-container[data-blurred="true"] .mw-reveal-button {
        display: flex !important;
      }
      .mw-shorts-blur-container[data-blurred="false"] .mw-reveal-button {
        display: none !important;
      }
      .mw-shorts-blur-container[data-blurred="false"] {
        pointer-events: none !important;
      }
      .mw-reveal-button {
        opacity: var(--mw-reveal-button-opacity, 0) !important;
        transition: opacity 180ms ease, transform 180ms ease !important;
      }
      .mw-reveal-btn,
      .mw-reveal-button {
        z-index: 9999 !important;
        pointer-events: auto !important;
        border-radius: 999px !important;
        border: 1px solid rgba(255, 255, 255, 0.4) !important;
        background: rgba(255, 255, 255, 0.2) !important;
        color: rgba(255, 255, 255, 0.98) !important;
        font-family: "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        font-weight: 600 !important;
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.24) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
      }
      [data-mw-moderated="blurred"] {
        transition: filter 0.3s ease-in-out, opacity 0.3s ease-in-out !important;
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

  function ensureTapToRevealOverlay(reason) {
    const normalizedReason = String(reason || 'host_force_reveal_ui');
    const isActiveHunterReason = normalizedReason.indexOf('active_hunter') === 0;
    const isTimeoutSafeFailureReason = normalizedReason.indexOf('timeout_safe_failure') !== -1;
    try {
      if (isShortsModeActive() && !isActiveHunterReason) {
        startShortsRevealWatch(normalizedReason, { force: false });
      }
      let shownCount = 0;
      let createdCount = 0;
      if (isShortsModeActive()) {
        let activeShortsTarget = getActiveShortsPlayerContainer();
        if (!activeShortsTarget || !activeShortsTarget.isConnected) {
          activeShortsTarget = findActiveHunterShortsContainer('ensure_immediate_reveal_ui');
        }
        const activeStableResolution = resolveShortsStableBlurTarget(activeShortsTarget, '');
        const immediateTarget = (
          activeStableResolution &&
          activeStableResolution.target &&
          activeStableResolution.target.isConnected
        ) ? activeStableResolution.target : (
          activeShortsTarget && activeShortsTarget.isConnected ? activeShortsTarget : null
        );
        if (immediateTarget && immediateTarget.nodeType === 1) {
          const inlineFilter = String(
            immediateTarget.style.getPropertyValue('filter') || immediateTarget.style.filter || ''
          ).toLowerCase();
          const inlineBackdrop = String(
            immediateTarget.style.getPropertyValue('backdrop-filter') || ''
          ).toLowerCase();
          let computedFilter = '';
          let computedBackdrop = '';
          try {
            const computed = window.getComputedStyle(immediateTarget);
            computedFilter = String((computed && computed.filter) || '').toLowerCase();
            computedBackdrop = String((computed && computed.backdropFilter) || '').toLowerCase();
          } catch (e) {}
          const targetBlurred = (
            immediateTarget.dataset.mwModerated === 'blurred' ||
            immediateTarget.classList.contains('mw-blurred') ||
            inlineFilter.includes('blur(') ||
            inlineBackdrop.includes('blur(') ||
            computedFilter.includes('blur(') ||
            computedBackdrop.includes('blur(')
          );
          if (targetBlurred) {
            const shortsUrlId = getCurrentShortsUrlId() || 'none';
            const immediateSrc = String(
              (immediateTarget.dataset && immediateTarget.dataset.mwSrc) ||
              ('shorts://video/' + shortsUrlId + '#ensure_reveal_ui_immediate')
            );
            const immediateCategory = String(
              (immediateTarget.dataset && immediateTarget.dataset.mwCategory) ||
              'shorts_live_blur'
            );
            const immediateItemId = String(
              (immediateTarget.dataset && immediateTarget.dataset.mwItemId) || ''
            );
            let immediateOverlay = findRevealOverlayForElement(immediateTarget, immediateSrc);
            if (!immediateOverlay || !immediateOverlay.isConnected) {
              createRevealOverlay(immediateTarget, immediateSrc, immediateCategory, immediateItemId);
              immediateOverlay = findRevealOverlayForElement(immediateTarget, immediateSrc);
              if (immediateOverlay && immediateOverlay.isConnected) {
                createdCount += 1;
              }
            } else {
              shownCount += 1;
            }
            if (immediateOverlay && immediateOverlay.isConnected) {
              setRevealOverlayBlurState(immediateOverlay, true);
              setRevealOverlayTimeoutSafeFailureState(immediateOverlay, isTimeoutSafeFailureReason);
              immediateOverlay.style.display = 'flex';
            }
          }
        }
      }
      const candidates = document.querySelectorAll('[data-mw-moderated="blurred"], .mw-blurred');
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        if (!candidate || !candidate.isConnected) continue;
        const src = String((candidate.dataset && candidate.dataset.mwSrc) || '');
        if (!src) continue;
        const category = String((candidate.dataset && candidate.dataset.mwCategory) || 'flagged');
        const itemId = String((candidate.dataset && candidate.dataset.mwItemId) || '');
        let overlay = findRevealOverlayForElement(candidate, src);
        if (!overlay || !overlay.isConnected) {
          createRevealOverlay(candidate, src, category, itemId);
          overlay = findRevealOverlayForElement(candidate, src);
          if (overlay && overlay.isConnected) {
            createdCount += 1;
          }
        } else {
          shownCount += 1;
        }
        if (overlay && overlay.isConnected) {
          setRevealOverlayBlurState(overlay, true);
          setRevealOverlayTimeoutSafeFailureState(overlay, isTimeoutSafeFailureReason);
          overlay.style.display = 'flex';
        }
      }

      if (shownCount + createdCount <= 0 && isShortsModeActive()) {
        let activeContainer = getActiveShortsPlayerContainer();
        if (!activeContainer || !activeContainer.isConnected) {
          activeContainer = findActiveHunterShortsContainer('ensure_fallback');
        }
        if (!activeContainer || !activeContainer.isConnected) {
          const aggressiveShortsSelectors = [
            'ytd-reel-video-renderer[is-active]',
            'ytd-reel-video-renderer[aria-hidden="false"]',
            'ytd-reel-video-renderer[aria-current="true"]',
            'ytm-reel-video-renderer[is-active]',
            'ytm-reel-video-renderer[aria-hidden="false"]',
            'ytm-reel-video-renderer[aria-current="true"]',
            'ytm-shorts-lockup-view-model[is-active]',
            'ytm-shorts-lockup-view-model[aria-hidden="false"]',
            'ytm-shorts-lockup-view-model[aria-current="true"]',
            'ytm-shorts-lockup-view-model-v2[is-active]',
            'ytm-shorts-lockup-view-model-v2[aria-hidden="false"]',
            'ytm-shorts-lockup-view-model-v2[aria-current="true"]',
            'div#player-container',
            '#player-container',
            '#shorts-player',
          ];
          for (let i = 0; i < aggressiveShortsSelectors.length; i += 1) {
            const candidate = document.querySelector(aggressiveShortsSelectors[i]);
            if (candidate && candidate.isConnected) {
              activeContainer = candidate;
              break;
            }
          }
        }
        const stableTarget = resolveShortsStableBlurTarget(activeContainer, '');
        const fallbackTarget = (
          stableTarget &&
          stableTarget.target &&
          stableTarget.target.isConnected
        ) ? stableTarget.target : (
          activeContainer && activeContainer.isConnected ? activeContainer : null
        );
        if (fallbackTarget && fallbackTarget.nodeType === 1) {
          const shortsUrlId = getCurrentShortsUrlId() || 'none';
          const fallbackSrc = String(
            (fallbackTarget.dataset && fallbackTarget.dataset.mwSrc) ||
            ('shorts://video/' + shortsUrlId + '#id_mismatch_fallback')
          );
          const fallbackCategory = String(
            (fallbackTarget.dataset && fallbackTarget.dataset.mwCategory) ||
            'shorts_mismatch_hold'
          );
          const fallbackItemId = String((fallbackTarget.dataset && fallbackTarget.dataset.mwItemId) || '');
          applyBlur(fallbackTarget, fallbackSrc, fallbackCategory, CONFIG.blurStrength, fallbackItemId);
          let fallbackOverlay = findRevealOverlayForElement(fallbackTarget, fallbackSrc);
          if (!fallbackOverlay || !fallbackOverlay.isConnected) {
            createRevealOverlay(fallbackTarget, fallbackSrc, fallbackCategory, fallbackItemId);
            fallbackOverlay = findRevealOverlayForElement(fallbackTarget, fallbackSrc);
          }
          if (fallbackOverlay && fallbackOverlay.isConnected) {
            setRevealOverlayBlurState(fallbackOverlay, true);
            setRevealOverlayTimeoutSafeFailureState(fallbackOverlay, isTimeoutSafeFailureReason);
            fallbackOverlay.style.display = 'flex';
            createdCount += 1;
          }
        }
      }

      const didEnsure = shownCount + createdCount > 0;
      if (didEnsure) {
        if (isTimeoutSafeFailureReason) {
          applyRevealUiLock(
            'ensure_timeout_safe_failure:' + normalizedReason,
            TIMEOUT_SAFE_FAILURE_UI_LOCK_MS,
            getCurrentShortsUrlId() || 'none',
          );
        }
        if (!isActiveHunterReason) {
          stopShortsRevealWatch('ensure_success');
        }
        scheduleShortsRevealOverlayReposition('ensure_reveal_ui:' + normalizedReason);
        console.log(
          '[DIAG][REVEAL_UI] ensure',
          'reason=' + normalizedReason,
          'shown=' + shownCount,
          'created=' + createdCount,
          'result=ensured'
        );
        return true;
      }
      console.log(
        '[DIAG][REVEAL_UI] ensure',
        'reason=' + normalizedReason,
        'shown=' + shownCount,
        'created=' + createdCount,
        'result=no_target'
      );
      if (isShortsModeActive() && !isActiveHunterReason) {
        startShortsRevealWatch('ensure_no_target:' + normalizedReason, { force: false });
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // Expose targeted rescan hooks for the host (NativeWebViewBrowser)
  window.__MW_SCAN_FULL__ = scanFullPage;
  window.__MW_SCAN_YT__ = scanYouTubeThumbnails;
  window.__MW_ENSURE_REVEAL_UI__ = ensureTapToRevealOverlay;
  window.__MW_START_REVEAL_WATCH__ = function(reason, opts) {
    try {
      return startShortsRevealWatch(reason || 'host_start_reveal_watch', opts || {});
    } catch (e) {
      return 'ERR';
    }
  };
  window.__MW_STOP_REVEAL_WATCH__ = function(reason) {
    try {
      stopShortsRevealWatch(reason || 'host_stop_reveal_watch');
      return 'OK';
    } catch (e) {
      return 'ERR';
    }
  };
  window.__MW_APPLY_REVEAL_UI_LOCK__ = function(reason, durationMs, videoId) {
    try {
      return applyRevealUiLock(reason || 'host_reveal_ui_lock', durationMs, videoId);
    } catch (e) {
      return 0;
    }
  };
  window.__MW_SHORTS_REENTRY_REFRESH__ = function(reason) {
    try {
      return refreshShortsFreshnessOnReentry(reason || 'host_shorts_reentry', { force: true }) ? 'OK' : 'SKIP';
    } catch (e) {
      return 'ERR';
    }
  };

  function scheduleInitTimeout(label, fn, delayMs) {
    const id = setTimeout(() => {
      timerState.initialTimeouts = timerState.initialTimeouts.filter(t => t !== id);
      if (timerState.paused || timerState.teardownDone) return;
      fn();
    }, delayMs);
    timerState.initialTimeouts.push(id);
    timerLog('start', label + ':' + delayMs + 'ms');
  }

  // Set up observers before any initial scan scheduling.
  if (!bootstrapPrimaryMutationObserver('init')) {
    const onDomReadyForObserver = function() {
      if (timerState.teardownDone) return;
      bootstrapPrimaryMutationObserver('dom_content_loaded');
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', onDomReadyForObserver, { once: true });
    } else {
      scheduleInitTimeout('observerBootstrapRetry', onDomReadyForObserver, 60);
    }
  }
  installShortsAnchorObserver('init');
  state.viewportObserver = setupViewportObserver();
  
  // YouTube-specific: Set up scroll handler for infinite scroll
  setupYouTubeScrollHandler();
  refreshAdaptiveShortsOverlayWatch('init');

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

  // SPA navigation detection
  let lastUrl = window.location.href;
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
      const hostContextSync = syncActiveContextFromHost('url_change_detected', {
        resetTransientState: true,
        clearScanState: false,
      });
      const hostEpochAuthoritative = hostContextSync.hostPageEpoch !== null;
      if (!holdEpoch && !hostEpochAuthoritative) {
        state.pageEpoch += 1;
        CONFIG.pageEpoch = state.pageEpoch;
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
      } else if (!holdEpoch && hostEpochAuthoritative && DIAG_YT_BLUR) {
        diagEpochCounters.epochHeldCount += 1;
        console.log(
          '[MW-YT][DIAG][EPOCH][INJECT]',
          'action=epoch_host_authoritative',
          'count=' + diagEpochCounters.epochHeldCount,
          'pageEpoch=' + state.pageEpoch,
          'hostPageEpoch=' + hostContextSync.hostPageEpoch,
          'prevUrl=' + previousUrl,
          'nextUrl=' + nextUrl
        );
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
        installShortsAnchorObserver('url_change');
        if (!previousIsShorts) {
          refreshShortsFreshnessOnReentry('url_change_return_to_shorts', { force: true, resetContext: false });
        } else {
          refreshAdaptiveShortsOverlayWatch('url_change');
        }
        scheduleShortsRevealOverlayReposition('url_change_shorts');
      } else {
        stopShortsAnchorObserver('url_change_non_shorts');
        stopAdaptiveShortsOverlayWatch('url_change_non_shorts');
        stopShortsRevealWatch('url_change_non_shorts');
      }
      if (observerModeResult.transitioned && observerModeResult.mode) {
        scheduleYouTubeScan('url_change_mode_on');
      }

      resetTransientModerationState('spa_epoch_reset');
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
    stopShortsAnchorObserver('stopManagedTimers:' + (reason || 'unknown'));
    stopAdaptiveShortsOverlayWatch('stopManagedTimers:' + (reason || 'unknown'));
    stopShortsRevealWatch('stopManagedTimers:' + (reason || 'unknown'));
    stopForceRevealEnforcement('stopManagedTimers:' + (reason || 'unknown'));
    clearNamedInterval('legacyResultsInterval', reason);
    clearNamedInterval('urlChangeInterval', reason);
    clearNamedInterval('youtubePeriodicInterval', reason);
    stopShortsHealthHealInterval(reason);
    clearNamedInterval('debugSummaryInterval', reason);
    clearNamedTimeout('mainScrollTimeout', reason);
    clearNamedTimeout('youtubeScrollTimeout', reason);
    clearNamedTimeout('youtubeMutationScanTimeout', reason);
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
    installShortsAnchorObserver('startManagedTimers:' + (reason || 'unknown'));
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
    stopShortsAnchorObserver('teardown:' + (reason || 'unknown'));
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
    window.__MW_ACTIVE_CONTEXT_API__ = null;
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
