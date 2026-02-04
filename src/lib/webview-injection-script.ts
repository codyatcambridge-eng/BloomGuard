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
}

/**
 * Category thresholds based on blur dial (0-4)
 */
export function getCategoryThresholds(dialLevel: number): { porn: number; sexy: number; hentai: number } {
  switch (dialLevel) {
    case 0: return { porn: 1.1, sexy: 1.1, hentai: 1.1 }; // Off
    case 1: return { porn: 0.7, sexy: 0.85, hentai: 0.7 }; // Relaxed
    case 2: return { porn: 0.5, sexy: 0.65, hentai: 0.5 }; // Moderate
    case 3: return { porn: 0.3, sexy: 0.45, hentai: 0.3 }; // Strict
    case 4: return { porn: 0.15, sexy: 0.25, hentai: 0.15 }; // Maximum
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
  
  return `
(function() {
  'use strict';
  
  // ==================== INITIALIZATION ====================
  
  // Prevent double injection
  if (window.__MW_ACTIVE__) {
    console.log('[MW] Already injected, skipping');
    return;
  }
  window.__MW_ACTIVE__ = true;
  
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
    minImageSize: 50, // Minimum image dimension (fail-open below this)
    semanticDelayMs: 150, // Delay before applying blur
    scanDelay: 50,
    batchSize: 5,
    batchDelay: 100,
    requestTimeout: 8000,
  };

  // Threshold mappings for blur dial levels
  const THRESHOLDS = {
    0: { porn: 1.1, sexy: 1.1, hentai: 1.1 },
    1: { porn: 0.7, sexy: 0.85, hentai: 0.7 },
    2: { porn: 0.5, sexy: 0.65, hentai: 0.5 },
    3: { porn: 0.3, sexy: 0.45, hentai: 0.3 },
    4: { porn: 0.15, sexy: 0.25, hentai: 0.15 },
  };

  // ==================== REQUEST ID GENERATION ====================
  
  function generateRequestId() {
    return 'r_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36);
  }

  function generateItemId() {
    return 'i_' + Math.random().toString(36).slice(2, 9);
  }

  // ==================== STATE MANAGEMENT ====================
  
  const state = {
    scanned: new Set(),
    pending: new Map(), // itemId -> { element, src, sourceType, requestId, timestamp, state, blurTimer }
    pendingRequests: new Map(), // requestId -> { items, timestamp, timeoutId, state }
    blurred: new Set(),
    revealed: new Set(), // Tracks URLs that user has manually revealed
    elements: new Map(), // itemId -> element
    viewportObserver: null, // IntersectionObserver for viewport optimization
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
    },
  };

  // Batch queue for collecting items before sending request
  let batchQueue = [];
  let batchTimer = null;

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
   * Images smaller than 50x50 are skipped
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
   * After CONFIG.semanticDelayMs, if no result, upgrade to full blur
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
      if (element.dataset.mwModerated === 'softblur' || element.classList.contains('mw-softblur')) {
        element.style.filter = 'none';
        element.dataset.mwModerated = 'safe';
        element.classList.remove('mw-softblur');
        
        if (CONFIG.debug) {
          console.log('[MW] soft blur removed (safe):', src.substring(0, 50));
        }
      }
    } catch (e) {}
  }

  /**
   * Apply hard blur (for unsafe content)
   */
  function applyBlur(element, src, category, blurStrengthPx, itemId) {
    // Check persistence
    if (state.revealed.has(src)) return;
    if (element.dataset.mwRevealed === 'true') return;
    
    const blurPx = blurStrengthPx || CONFIG.blurStrength;
    
    try {
      element.style.filter = 'blur(' + blurPx + 'px)';
      element.style.transition = 'filter 0.3s ease';
      element.dataset.mwModerated = 'blurred';
      element.dataset.mwCategory = category || 'flagged';
      element.dataset.mwSrc = src;
      element.dataset.mwItemId = itemId || '';
      element.classList.remove('mw-softblur');
      
      state.blurred.add(src);
      state.stats.blurred++;
      
      createRevealOverlay(element, src, category, itemId);
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
        window.postMessage(labelRequest, '*');
        
        // Also post to parent if in iframe
        if (window.parent && window.parent !== window) {
          try { window.parent.postMessage(labelRequest, '*'); } catch(err) {}
        }
        
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
        window.postMessage(correctionEvent, '*');
        if (window.parent && window.parent !== window) {
          try { window.parent.postMessage(correctionEvent, '*'); } catch(err) {}
        }
        
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
      nonce: CONFIG.nonce,
      timestamp: timestamp,
    };

    // Store pending request for timeout handling
    const timeoutId = setTimeout(() => {
      handleRequestTimeout(requestId);
    }, CONFIG.requestTimeout);

    state.pendingRequests.set(requestId, {
      items: items,
      timestamp: timestamp,
      timeoutId: timeoutId,
      state: 'waitingForHost',
    });

    state.stats.requestsSent++;
    
    console.log('[MW] request sent', requestId, 'items=' + items.length, items.map(i => i.src.substring(0, 40)));
    console.log('[MW] waiting response', requestId, 'ts=' + timestamp);
    
    // Post to parent (host app)
    window.postMessage(message, '*');
    
    // Also try posting to parent window if in iframe
    if (window.parent && window.parent !== window) {
      try {
        window.parent.postMessage(message, '*');
      } catch (e) {}
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
    
    pendingRequest.state = 'timeout';
    
    console.log('[MW] timeout', requestId, 'items=' + pendingRequest.items.length);
    state.stats.timeouts += pendingRequest.items.length;
    
    // FAIL-OPEN: Remove soft blur, don't apply hard blur (unless failClosed explicitly set)
    if (CONFIG.failClosed && CONFIG.enabled && CONFIG.sensitivity > 0) {
      console.log('[MW] FAIL-CLOSED: Applying blur to timed-out items');
      pendingRequest.items.forEach(item => {
        const element = state.elements.get(item.itemId);
        if (element && element.isConnected) {
          applyBlur(element, item.src, 'timeout', CONFIG.blurStrength, item.itemId);
        }
        state.pending.delete(item.itemId);
        state.scanned.add(item.src);
      });
    } else {
      // FAIL-OPEN: Remove soft blur, mark as safe
      console.log('[MW] FAIL-OPEN: Removing soft blur for timed-out items');
      pendingRequest.items.forEach(item => {
        const element = state.elements.get(item.itemId);
        if (element && element.isConnected) {
          removeSoftBlur(element, item.src);
          element.dataset.mwModerated = 'timeout-safe';
        }
        state.pending.delete(item.itemId);
        // Don't add to scanned so they can be retried later
      });
    }
    
    state.pendingRequests.delete(requestId);
  }

  /**
   * Process results from host
   * Validates nonce before processing to prevent spoofing
   */
  function handleModerationResult(message) {
    const { requestId, results, nonce } = message;
    
    if (!requestId || !Array.isArray(results)) {
      console.log('[MW] Invalid result message:', message);
      return;
    }
    
    // SECURITY: Validate nonce
    if (nonce !== CONFIG.nonce) {
      console.warn('[MW] NONCE MISMATCH - rejecting result:', requestId);
      console.warn('[MW] Expected:', CONFIG.nonce.substring(0, 10), 'Got:', (nonce || 'none').substring(0, 10));
      state.stats.nonceRejected++;
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
      
      console.log('[MW] scan result itemId=' + itemId, 'src=' + (src || '').substring(0, 50), 'blur=' + shouldBlur, 'cat=' + category, 'reason=' + (reason || ''));
      
      // Find the element for this item
      const element = state.elements.get(itemId);
      const pendingItem = state.pending.get(itemId);
      
      // Clear any pending blur timer (semantic delay)
      if (pendingItem && pendingItem.blurTimer) {
        clearTimeout(pendingItem.blurTimer);
      }
      
      state.pending.delete(itemId);
      state.scanned.add(src);
      
      // Check if result came fast enough to skip blur (semantic delay saved)
      const wasInSoftBlur = element && element.dataset.mwModerated === 'softblur';
      
      // FAIL-OPEN: Handle errors gracefully
      const isError = category === 'error' || category === 'timeout';
      let shouldApplyBlur = shouldBlur;
      
      if (isError) {
        // FAIL-OPEN: Don't blur on error (unless failClosed explicitly set)
        if (CONFIG.failClosed && CONFIG.enabled && CONFIG.sensitivity > 0) {
          shouldApplyBlur = true;
          console.log('[MW] FAIL-CLOSED: Error result, applying blur');
        } else {
          shouldApplyBlur = false;
          console.log('[MW] FAIL-OPEN: Error result, not blurring');
        }
      }
      
      // Apply blur based on result or forced blur mode
      const finalBlur = CONFIG.forcedBlur || (shouldApplyBlur && CONFIG.enabled && CONFIG.sensitivity > 0);
      
      if (element && element.isConnected) {
        if (finalBlur) {
          // Apply strong blur
          applyBlur(element, src, category || 'flagged', CONFIG.blurStrength, itemId);
        } else {
          // Remove soft blur if result is safe
          removeSoftBlur(element, src);
          if (wasInSoftBlur && !finalBlur) {
            state.stats.semanticDelaySaved++;
          }
        }
      }
      
      // Also find any other elements with the same src
      if (finalBlur) {
        findAndBlur(src, category, CONFIG.blurStrength, true);
      } else {
        // Remove soft blur from all matching elements
        findAndRemoveSoftBlur(src);
      }
    });
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

  window.addEventListener('message', function(event) {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    
    if (message.type === 'gc-moderation-result') {
      handleModerationResult(message);
    }
  });

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
    
    // FAIL-OPEN: Skip tiny images (< 50x50)
    if (isTinyImage(element)) {
      state.stats.skippedTiny++;
      if (CONFIG.debug) {
        console.log('[MW] skipped tiny image (fail-open):', url.substring(0, 50));
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
    
    // Skip if already pending
    for (const [itemId, pending] of state.pending.entries()) {
      if (pending.src === url) {
        return false;
      }
    }
    
    const itemId = generateItemId();
    const { width, height } = getElementDimensions(element);
    
    // Store element reference
    state.elements.set(itemId, element);
    
    // SEMANTIC DELAY: Apply soft blur immediately, then wait for result
    // If result comes within semanticDelayMs as "safe", blur is never applied
    if (CONFIG.enabled && CONFIG.sensitivity > 0) {
      applySoftBlur(element, url, itemId);
    }
    
    // Set up a timer to upgrade to hard blur if no result within semanticDelayMs
    // (This is a secondary safeguard; the main timeout is CONFIG.requestTimeout)
    const blurTimer = setTimeout(() => {
      const pending = state.pending.get(itemId);
      if (pending && pending.state === 'pending') {
        // Still pending after semantic delay - soft blur remains
        // Hard blur will only be applied when result comes back as unsafe
        // or on final timeout (if failClosed is true)
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
            setTimeout(() => scanNode(element), 30);
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
    if (img.dataset.mwScanned === 'true') return;
    
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
    
    img.dataset.mwScanned = 'true';
    img.dataset.mwOrigSrc = src;
    
    if (queueForScan(src, img, 'img')) {
      state.stats.imgTags++;
    }
  }

  function scanVideoPoster(video) {
    if (video.dataset.mwPosterScanned === 'true') return;
    
    const poster = video.poster ||
                   video.dataset.poster ||
                   video.getAttribute('data-poster');
    
    if (!poster) return;
    
    video.dataset.mwPosterScanned = 'true';
    video.dataset.mwOrigPoster = poster;
    
    if (queueForScan(poster, video, 'video-poster')) {
      state.stats.videoPosters++;
    }
  }

  function scanBgImage(element) {
    if (element.dataset.mwBgScanned === 'true') return;
    
    const bgUrl = extractBgImageUrl(element);
    if (!bgUrl) return;
    
    element.dataset.mwBgScanned = 'true';
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

  function setupMutationObserver(root) {
    const observer = new MutationObserver(mutations => {
      if (!CONFIG.enabled || CONFIG.sensitivity === 0) return;
      
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          // Add to viewport observer for lazy scanning
          observeForViewport(node);
          setTimeout(() => scanNode(node), CONFIG.scanDelay);
        });
        
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          const attr = mutation.attributeName;
          
          if ((attr === 'src' || attr === 'srcset') && target.tagName === 'IMG') {
            target.dataset.mwScanned = 'false';
            setTimeout(() => scanImgElement(target), CONFIG.scanDelay);
          }
          
          if (attr === 'poster' && target.tagName === 'VIDEO') {
            target.dataset.mwPosterScanned = 'false';
            setTimeout(() => scanVideoPoster(target), CONFIG.scanDelay);
          }
          
          if (attr === 'data-src' || attr === 'data-lazy-src') {
            target.dataset.mwScanned = 'false';
            setTimeout(() => scanImgElement(target), CONFIG.scanDelay);
          }
          
          if (attr === 'style') {
            target.dataset.mwBgScanned = 'false';
            setTimeout(() => scanBgImage(target), CONFIG.scanDelay);
          }
        }
      });
    });
    
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'poster', 'data-src', 'data-lazy-src', 'data-thumb', 'style'],
    });
    
    return observer;
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
      const { src, shouldBlur, category, blurStrengthPx, nonce } = result;
      
      // SECURITY: Validate nonce if provided
      if (nonce && nonce !== CONFIG.nonce) {
        console.warn('[MW] NONCE MISMATCH in legacy result - rejecting:', src.substring(0, 50));
        state.stats.nonceRejected++;
        return;
      }
      
      console.log('[MW] legacy result:', src.substring(0, 50), '-> blur:', shouldBlur, 'cat:', category);
      
      state.scanned.add(src);
      
      const shouldApplyBlur = CONFIG.forcedBlur || (shouldBlur && CONFIG.enabled && CONFIG.sensitivity > 0);
      
      if (shouldApplyBlur) {
        findAndBlur(src, category, blurStrengthPx, true);
        
        // Also check pending items
        for (const [itemId, pending] of state.pending.entries()) {
          if (pending.src === src) {
            const el = pending.element;
            if (el && el.isConnected) {
              applyBlur(el, src, category, blurStrengthPx, itemId);
            }
            state.pending.delete(itemId);
            break;
          }
        }
      } else {
        // Remove soft blur for safe results
        findAndRemoveSoftBlur(src);
      }
    });
  }

  // Poll for legacy results
  setInterval(processLegacyResults, 100);

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

  // Set up observers
  setupMutationObserver(document.body);
  state.viewportObserver = setupViewportObserver();

  // Initial scan
  if (document.readyState === 'complete') {
    scanFullPage();
  } else {
    window.addEventListener('load', scanFullPage);
  }

  // Periodic rescans
  setTimeout(scanFullPage, 500);
  setTimeout(scanFullPage, 1500);
  setTimeout(scanFullPage, 3000);

  // Scroll-triggered rescans
  let scrollTimer;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(scanFullPage, 150);
  }, { passive: true });

  // SPA navigation detection
  let lastUrl = window.location.href;
  const checkUrlChange = () => {
    if (window.location.href !== lastUrl) {
      console.log('[MW] SPA navigation detected:', lastUrl, '->', window.location.href);
      lastUrl = window.location.href;
      // Clear scanned state for fresh scan
      state.scanned.clear();
      state.elements.clear();
      setTimeout(scanFullPage, 300);
    }
  };
  setInterval(checkUrlChange, 500);

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
})();
`;
}
