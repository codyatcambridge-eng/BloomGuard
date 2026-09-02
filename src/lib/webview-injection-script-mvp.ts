/**
 * BloomGuard MVP WebView Injection Script
 * Production-ready implementation for:
 * - Home page + Results + Profile thumbnail blur/reveal
 * - Active video frame protection
 * - Shorts first-entry flash shield (100-200ms bounded veil)
 * - Stable reveal event handling
 * - Fail-open blur policy
 */

import type { ModerationConfig } from './moderation-request-utils';
import { escapeForJs } from './moderation-request-utils';

export interface WebViewInjectionScriptOptions {
  config: ModerationConfig;
  onReady?: () => void;
  onResult?: (requestId: string, results: any[]) => void;
}

export function generateMVPInjectionScript(config: ModerationConfig): string {
  const nonce = config.nonce || 'default-nonce';
  const sensitivity = config.sensitivity ?? 2;
  const blurStrength = config.blurStrength ?? 24;
  const failClosed = config.failClosed ?? false;
  const blockingMode = config.blockingMode ?? 'mvp';

  const script = `
(function() {
  'use strict';

  // ============================================================================
  // CONFIGURATION
  // ============================================================================

  const CONFIG = {
    nonce: '${escapeForJs(nonce)}',
    sensitivity: ${sensitivity},
    blurStrength: ${blurStrength},
    failClosed: ${failClosed},
    blockingMode: '${blockingMode}',
    debug: ${config.debug ?? false},
  };

  const CONSTANTS = {
    SHORTS_FLASH_SHIELD_MS: 150,
    SHORTS_FIRST_ENTRY_GRACE_MS: 1500,
    REVEAL_BUTTON_SIZE: 64,
    BATCH_DELAY_MS: 80,
    SCAN_THROTTLE_MS: 250,
    REQUEST_TIMEOUT_MS: 8000,
  };

  // ============================================================================
  // STATE
  // ============================================================================

  let state = {
    isInjected: true,
    ready: false,
    scanning: false,
    pendingRequests: new Map(),
    shortsFlashShieldActive: false,
    shortsFlashShieldTimers: [],
    lastBatchAt: 0,
    queuedElements: new Set(),
    scanTimer: null,
  };

  // MVP categories only
  const mvpCategories = ['shirtless', 'swimwear', 'shirtless_male', 'bikini', 'swim_trunks'];

  function shouldBlurForMvp(category) {
    if (!category || typeof category !== 'string') return false;
    return mvpCategories.some(c => category.toLowerCase().includes(c));
  }

  function getThresholds() {
    switch (CONFIG.sensitivity) {
      case 0: return { porn: 1.1, sexy: 1.1, hentai: 1.1 };
      case 1: return { porn: 0.7, sexy: 0.85, hentai: 0.7 };
      case 2: return { porn: 0.5, sexy: 0.65, hentai: 0.5 };
      case 3: return { porn: 0.3, sexy: 0.45, hentai: 0.3 };
      case 4: return { porn: 0.15, sexy: 0.25, hentai: 0.15 };
      default: return { porn: 0.5, sexy: 0.65, hentai: 0.5 };
    }
  }

  // ============================================================================
  // BLUR OVERLAY SYSTEM
  // ============================================================================

  const BlurOverlay = {
    create(src, sourceType) {
      const id = 'mw-blur-' + Math.random().toString(36).slice(2, 9);
      const blurPx = CONFIG.blurStrength;

      const overlay = document.createElement('div');
      overlay.id = id;
      overlay.className = 'mw-blur-overlay';
      overlay.dataset.mwSrc = src;
      overlay.dataset.mwFor = src;
      overlay.dataset.mwSourceType = sourceType || 'unknown';

      overlay.style.cssText = [
        'position: absolute',
        'top: 0',
        'left: 0',
        'width: 100%',
        'height: 100%',
        'backdrop-filter: blur(' + blurPx + 'px)',
        '-webkit-backdrop-filter: blur(' + blurPx + 'px)',
        'background: rgba(0, 0, 0, 0.1)',
        'z-index: 1000',
        'pointer-events: none',
        'transition: opacity 200ms ease',
        'opacity: 1',
      ].join(' !important; ') + ' !important;';

      // Reveal button with proper capture handling
      const revealBtn = document.createElement('button');
      revealBtn.className = 'mw-reveal-button';
      revealBtn.setAttribute('aria-label', 'Reveal image');
      revealBtn.innerHTML = '👁️ Reveal';

      revealBtn.style.cssText = [
        'position: absolute',
        'top: 50%',
        'left: 50%',
        'transform: translate(-50%, -50%)',
        'width: ' + CONSTANTS.REVEAL_BUTTON_SIZE + 'px',
        'height: ' + CONSTANTS.REVEAL_BUTTON_SIZE + 'px',
        'border-radius: 32px',
        'background: rgba(255, 255, 255, 0.9)',
        'border: 2px solid rgba(0, 0, 0, 0.2)',
        'font-size: 14px',
        'font-weight: 600',
        'cursor: pointer',
        'z-index: 1001',
        'pointer-events: auto',
        'display: flex',
        'align-items: center',
        'justify-content: center',
        'box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15)',
        'transition: all 150ms ease',
      ].join(' !important; ') + ' !important;';

      const handleReveal = (e) => {
        e.stopPropagation();
        e.preventDefault();
        e.stopImmediatePropagation();
        BlurOverlay.remove(overlay);
      };

      // Capture phase to intercept before YouTube handlers
      revealBtn.addEventListener('click', handleReveal, { capture: true });
      revealBtn.addEventListener('pointerdown', handleReveal, { capture: true });
      revealBtn.addEventListener('touchstart', handleReveal, { capture: true });

      overlay.appendChild(revealBtn);
      return overlay;
    },

    attach(element, overlay) {
      if (!element || !overlay || !element.parentElement) return false;
      element.parentElement.style.position = 'relative';
      element.parentElement.appendChild(overlay);
      return true;
    },

    remove(overlay) {
      if (!overlay) return;
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      setTimeout(() => {
        if (overlay.parentElement) overlay.remove();
      }, 200);
    },
  };

  // ============================================================================
  // SHORTS FLASH SHIELD
  // ============================================================================

  const ShortsFlashShield = {
    arm(duration) {
      duration = duration || CONSTANTS.SHORTS_FLASH_SHIELD_MS;

      if (state.shortsFlashShieldActive) {
        ShortsFlashShield.extend(duration);
        return;
      }

      state.shortsFlashShieldActive = true;

      const veil = document.createElement('div');
      veil.id = 'mw-shorts-flash-shield';
      veil.style.cssText = [
        'position: fixed',
        'top: 0',
        'left: 0',
        'width: 100vw',
        'height: 100vh',
        'background: rgba(0, 0, 0, 0.8)',
        'z-index: 999999',
        'pointer-events: none',
        'opacity: 1',
        'transition: opacity 150ms ease',
      ].join(' !important; ') + ' !important;';

      document.body.appendChild(veil);

      const timerId = setTimeout(() => {
        ShortsFlashShield.disarm();
      }, duration);

      state.shortsFlashShieldTimers.push(timerId);
    },

    extend(additionalMs) {
      state.shortsFlashShieldTimers.forEach(t => clearTimeout(t));
      state.shortsFlashShieldTimers = [];
      ShortsFlashShield.disarm();
      ShortsFlashShield.arm(additionalMs);
    },

    disarm() {
      const veil = document.getElementById('mw-shorts-flash-shield');
      if (veil) {
        veil.style.opacity = '0';
        setTimeout(() => veil.remove(), 150);
      }
      state.shortsFlashShieldActive = false;
      state.shortsFlashShieldTimers = [];
    },
  };

  // ============================================================================
  // SCANNER
  // ============================================================================

  const Scanner = {
    queue(element, sourceType) {
      if (!element || element.nodeType !== 1) return;
      const src = element.src || element.dataset.src || element.poster || '';
      if (!src) return;
      state.queuedElements.add({ element, src, sourceType: sourceType || 'unknown' });
      Scanner.scheduleFlush();
    },

    scheduleFlush() {
      if (state.scanTimer) return;
      const now = Date.now();
      const timeSinceLastBatch = now - state.lastBatchAt;
      const delay = Math.max(0, CONSTANTS.BATCH_DELAY_MS - timeSinceLastBatch);

      state.scanTimer = setTimeout(() => {
        state.scanTimer = null;
        Scanner.flush();
      }, delay);
    },

    flush() {
      if (state.scanning || state.queuedElements.size === 0) return;

      state.scanning = true;
      state.lastBatchAt = Date.now();

      const batch = Array.from(state.queuedElements);
      state.queuedElements.clear();

      const requestId = 'req-' + Math.random().toString(36).slice(2, 9);
      const items = batch.map(item => ({
        itemId: item.element.id || Math.random().toString(36).slice(2, 9),
        src: item.src,
        sourceType: item.sourceType,
        width: item.element.width || item.element.offsetWidth || 0,
        height: item.element.height || item.element.offsetHeight || 0,
      }));

      const request = {
        type: 'MW_MODERATION_REQUEST',
        requestId,
        items,
        nonce: CONFIG.nonce,
        thresholds: getThresholds(),
      };

      state.pendingRequests.set(requestId, {
        items: batch,
        sentAt: Date.now(),
      });

      window.postMessage(request, '*');

      const timeoutId = setTimeout(() => {
        if (state.pendingRequests.has(requestId)) {
          state.pendingRequests.delete(requestId);
          state.scanning = false;
        }
      }, CONSTANTS.REQUEST_TIMEOUT_MS);

      state.pendingRequests.get(requestId).timeoutId = timeoutId;
    },
  };

  // ============================================================================
  // RESULT HANDLER
  // ============================================================================

  const ResultHandler = {
    handle(requestId, results) {
      const pending = state.pendingRequests.get(requestId);
      if (!pending) return;

      clearTimeout(pending.timeoutId);
      state.pendingRequests.delete(requestId);

      results.forEach(result => {
        const { src, category, shouldBlur, sourceType } = result;
        const item = pending.items.find(i => i.src === src);

        if (!item) return;

        const isMvpBlur = CONFIG.blockingMode === 'mvp' ?
          (shouldBlur && shouldBlurForMvp(category)) :
          shouldBlur;

        if (isMvpBlur) {
          ResultHandler.blur(item.element, src, item.sourceType);
        }
      });

      state.scanning = false;
    },

    blur(element, src, sourceType) {
      if (!element || !element.parentElement) return;

      const overlay = BlurOverlay.create(src, sourceType);
      BlurOverlay.attach(element, overlay);
      element.dataset.mwBlurred = 'true';
    },
  };

  // ============================================================================
  // PAGE SCANNER
  // ============================================================================

  const PageScanner = {
    imageSelectors: [
      'img[src]:not([src=""])',
      '.yt-thumbnail img',
      '.search-result img',
    ],

    videoSelectors: [
      'video[poster]',
      'video[src]',
    ],

    start() {
      PageScanner.scan();

      const observer = new MutationObserver(() => {
        PageScanner.scan();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setInterval(() => {
        PageScanner.scan();
      }, 2000);
    },

    scan() {
      // Scan images
      this.imageSelectors.forEach(selector => {
        try {
          document.querySelectorAll(selector).forEach(img => {
            if (!img.dataset.mwScanned && img.src) {
              img.dataset.mwScanned = 'true';
              Scanner.queue(img, 'thumbnail');
            }
          });
        } catch (e) {
          // Ignore invalid selectors
        }
      });

      // Scan videos
      this.videoSelectors.forEach(selector => {
        try {
          document.querySelectorAll(selector).forEach(video => {
            if (!video.dataset.mwScanned && (video.src || video.poster)) {
              video.dataset.mwScanned = 'true';
              Scanner.queue(video, 'video');
            }
          });
        } catch (e) {
          // Ignore invalid selectors
        }
      });
    },
  };

  // ============================================================================
  // MESSAGE HANDLER
  // ============================================================================

  const MessageHandler = {
    init() {
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'MW_MODERATION_READY') {
          state.ready = true;
          PageScanner.start();
          return;
        }

        if (msg.type === 'MW_MODERATION_RESULT' && msg.requestId) {
          ResultHandler.handle(msg.requestId, msg.results || []);
          return;
        }

        if (msg.type === 'MW_SHORTS_FLASH_SHIELD') {
          if (msg.action === 'arm') {
            ShortsFlashShield.arm(msg.duration);
          } else if (msg.action === 'disarm') {
            ShortsFlashShield.disarm();
          }
          return;
        }
      });

      window.postMessage({
        type: 'MW_INJECTED_ACK',
        nonce: CONFIG.nonce,
        url: window.location.href,
      }, '*');
    },
  };

  // ============================================================================
  // START
  // ============================================================================

  if (!window.__MW_INJECTED__) {
    window.__MW_INJECTED__ = true;
    MessageHandler.init();
    return 'MW_INJECTION_OK';
  }

  return 'MW_ALREADY_ACTIVE';
})();
  `.trim();

  return script;
}
