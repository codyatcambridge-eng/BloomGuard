/**
 * WebView Injection Script for Image Moderation
 * 
 * This script runs INSIDE the WebView and handles:
 * 1. Image detection (img tags, background-images, video posters)
 * 2. Shadow DOM traversal for YouTube/TikTok
 * 3. Dynamic content via MutationObserver
 * 4. Communication with native app via postMessage protocol
 * 5. Blur application and reveal toggles
 * 6. Fail-closed policy (blur on timeout/error)
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
  failClosed?: boolean; // Blur on timeout/error (default: true)
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
  const failClosed = config.failClosed !== false; // Default true
  
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
  console.log('[MW] injected - Moderation Script v2.1');
  console.log('[MW] Sensitivity:', ${config.sensitivity});
  console.log('[MW] Blur Strength:', ${config.blurStrength}, 'px');
  console.log('[MW] Enabled:', ${config.enabled});
  console.log('[MW] Forced Blur:', ${config.forcedBlur || false});
  console.log('[MW] Fail-Closed:', ${failClosed});
  console.log('[MW] Nonce:', '${nonce.substring(0, 10)}...');
  console.log('[MW] URL:', window.location.href);
  console.log('[MW] ========================================');

  const CONFIG = {
    sensitivity: ${config.sensitivity},
    blurStrength: ${config.blurStrength},
    softBlurStrength: 8, // NEW: Soft blur for semantic delay
    enabled: ${config.enabled},
    forcedBlur: ${config.forcedBlur || false},
    failClosed: ${failClosed},
    debug: ${config.debug || false},
    nonce: '${nonce}',
    minImageSize: 40,
    minImageSizeYouTube: 60, // NEW: Skip tiny images on YouTube (avatars/icons)
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
    pending: new Map(), // itemId -> { element, src, sourceType, requestId, timestamp, state }
    pendingRequests: new Map(), // requestId -> { items, timestamp, timeoutId, state }
    blurred: new Set(),
    revealed: new Set(),
    elements: new Map(), // itemId -> element
    stats: {
      imgTags: 0,
      bgImages: 0,
      videoPosters: 0,
      shadowDom: 0,
      skipped: 0,
      skippedTiny: 0, // NEW: Track tiny image skips
      blurred: 0,
      timeouts: 0,
      errors: 0,
      requestsSent: 0,
      responsesReceived: 0,
      nonceRejected: 0,
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

  // ==================== VISIBILITY CHECK ====================

  function isElementVisible(element) {
    try {
      const rect = element.getBoundingClientRect();
      const width = rect.width || element.offsetWidth || 0;
      const height = rect.height || element.offsetHeight || 0;
      
      // NEW: Use platform-specific minimum size
      const minSize = IS_YOUTUBE ? CONFIG.minImageSizeYouTube : CONFIG.minImageSize;
      
      if (width < minSize || height < minSize) {
        return false;
      }
      
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

  // NEW: Check if image is too small (for YouTube skip)
  function isTinyImage(element) {
    if (!IS_YOUTUBE) return false;
    
    try {
      const rect = element.getBoundingClientRect();
      const width = rect.width || element.naturalWidth || element.offsetWidth || 0;
      const height = rect.height || element.naturalHeight || element.offsetHeight || 0;
      
      // Skip if either dimension is less than 60px (avatars, icons)
      if (width < 60 || height < 60) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  // ==================== BLUR MANAGEMENT ====================

  // NEW: Apply soft blur (semantic delay) - light blur while waiting for result
  function applySoftBlur(element, src, itemId) {
    if (state.revealed.has(src)) return;
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

  // NEW: Remove soft blur (after safe result)
  function removeSoftBlur(element, src) {
    try {
      if (element.dataset.mwModerated === 'softblur') {
        element.style.filter = 'none';
        element.dataset.mwModerated = 'safe';
        element.classList.remove('mw-softblur');
        
        if (CONFIG.debug) {
          console.log('[MW] soft blur removed (safe):', src.substring(0, 50));
        }
      }
    } catch (e) {}
  }

  function applyBlur(element, src, category, blurStrengthPx, itemId) {
    if (state.revealed.has(src)) return;
    
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
      
      createRevealOverlay(element, src, category);
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
      element.classList.remove('mw-softblur');
      
      const overlay = element.parentElement?.querySelector('.mw-reveal-overlay');
      if (overlay) {
        overlay.style.display = 'none';
      }
      
      console.log('[MW] blur removed:', src.substring(0, 60));
    } catch (e) {}
  }

  function createRevealOverlay(element, src, category) {
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
        state.revealed.delete(src);
        applyBlur(element, src, category, CONFIG.blurStrength);
        btn.textContent = '👁 Reveal';
        overlay.style.display = 'flex';
      } else {
        state.revealed.add(src);
        removeBlur(element, src);
        btn.textContent = '🔒 Hide';
        
        // POST a label request message so the host can open the labeling modal
        var itemId = element.dataset.mwItemId || 'unknown_' + Date.now();
        var labelRequest = {
          type: 'gc-label-request',
          requestId: 'r_' + Date.now().toString(36),
          itemId: itemId,
          src: src,
          pageUrl: window.location.href,
          platform: PLATFORM,
          modelPrediction: { category: category, confidence: null }
        };
        console.log('[MW] posting gc-label-request', itemId);
        window.postMessage(labelRequest, '*');
        // Also post to parent if in iframe
        if (window.parent && window.parent !== window) {
          try { window.parent.postMessage(labelRequest, '*'); } catch(err) {}
        }
      }
    });
    
    overlay.appendChild(btn);
    parent.appendChild(overlay);
    element.dataset.mwHasOverlay = 'true';
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
   * FAIL-CLOSED: Apply blur to all items when timeout occurs
   */
  function handleRequestTimeout(requestId) {
    const pendingRequest = state.pendingRequests.get(requestId);
    if (!pendingRequest) return;
    if (pendingRequest.state === 'handled') return;
    
    pendingRequest.state = 'timeout';
    
    console.log('[MW] timeout', requestId, 'items=' + pendingRequest.items.length);
    state.stats.timeouts += pendingRequest.items.length;
    
    // FAIL-CLOSED: Blur items on timeout if policy is enabled
    if (CONFIG.failClosed && CONFIG.enabled && CONFIG.sensitivity > 0) {
      console.log('[MW] FAIL-CLOSED: Applying blur to timed-out items');
      pendingRequest.items.forEach(item => {
        const element = state.elements.get(item.itemId);
        if (element && element.isConnected) {
          applyBlur(element, item.src, 'timeout', CONFIG.blurStrength, item.itemId);
        }
        state.pending.delete(item.itemId);
        // Add to scanned so we don't retry immediately
        state.scanned.add(item.src);
      });
    } else {
      // Mark items as failed but don't blur - also remove soft blur
      pendingRequest.items.forEach(item => {
        const element = state.elements.get(item.itemId);
        if (element && element.isConnected) {
          removeSoftBlur(element, item.src);
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
      const { itemId, src, shouldBlur, category, confidence } = result;
      
      console.log('[MW] scan result itemId=' + itemId, 'src=' + (src || '').substring(0, 50), 'blur=' + shouldBlur, 'cat=' + category);
      
      // Find the element for this item
      const element = state.elements.get(itemId);
      state.pending.delete(itemId);
      state.scanned.add(src);
      
      // Handle errors with fail-closed if enabled
      const isError = category === 'error' || category === 'timeout';
      let shouldApplyBlur = shouldBlur;
      
      if (isError && CONFIG.failClosed && CONFIG.enabled && CONFIG.sensitivity > 0) {
        shouldApplyBlur = true;
        console.log('[MW] FAIL-CLOSED: Error result, applying blur');
      }
      
      // Apply blur based on result or forced blur mode
      const finalBlur = CONFIG.forcedBlur || (shouldApplyBlur && CONFIG.enabled && CONFIG.sensitivity > 0);
      
      if (element && element.isConnected) {
        if (finalBlur) {
          // Apply strong blur
          applyBlur(element, src, category || 'flagged', CONFIG.blurStrength, itemId);
        } else {
          // NEW: Remove soft blur if result is safe
          removeSoftBlur(element, src);
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
          if (img.dataset.mwModerated !== 'blurred') {
            applyBlur(img, src, category, blurStrengthPx);
          }
        }
      });
      
      // Video posters
      document.querySelectorAll('video').forEach(video => {
        if ((video.poster === src || video.dataset.mwOrigPoster === src) && !state.revealed.has(src)) {
          if (video.dataset.mwModerated !== 'blurred') {
            applyBlur(video, src, category, blurStrengthPx);
          }
        }
      });
      
      // Background images
      document.querySelectorAll('[data-mw-bg-src]').forEach(el => {
        if (el.dataset.mwBgSrc === src && !state.revealed.has(src)) {
          if (el.dataset.mwModerated !== 'blurred') {
            applyBlur(el, src, category, blurStrengthPx);
          }
        }
      });
    } catch (e) {}
  }

  // NEW: Find and remove soft blur from all elements matching a src
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
    
    // NEW: Skip tiny images on YouTube (avatars, icons)
    if (IS_YOUTUBE && isTinyImage(element)) {
      state.stats.skippedTiny++;
      if (CONFIG.debug) {
        console.log('[MW] skipped tiny YouTube image:', url.substring(0, 50));
      }
      return false;
    }
    
    // Skip already processed
    if (state.scanned.has(url)) {
      return false;
    }
    
    // Skip if already pending
    for (const [itemId, pending] of state.pending.entries()) {
      if (pending.src === url) {
        return false;
      }
    }
    
    const itemId = generateItemId();
    
    // Store element reference
    state.elements.set(itemId, element);
    state.pending.set(itemId, {
      element: element,
      src: url,
      sourceType: sourceType,
      timestamp: Date.now(),
      state: 'pending',
    });
    
    // NEW: Apply soft blur immediately on YouTube (semantic delay)
    if (IS_YOUTUBE && CONFIG.enabled && CONFIG.sensitivity > 0) {
      applySoftBlur(element, url, itemId);
    }
    
    // Add to batch queue
    batchQueue.push({
      itemId: itemId,
      src: url,
      sourceType: sourceType,
    });
    
    // Schedule batch flush
    if (!batchTimer) {
      batchTimer = setTimeout(flushBatchQueue, CONFIG.batchDelay);
    }
    
    if (CONFIG.debug) {
      console.log('[MW] queued [' + sourceType + '] itemId=' + itemId + ':', url.substring(0, 70));
    }
    
    return true;
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

  // ==================== INTERSECTION OBSERVER ====================

  function setupIntersectionObserver() {
    if (!('IntersectionObserver' in window)) return;
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setTimeout(() => scanNode(entry.target), 30);
        }
      });
    }, { rootMargin: '200px' });
    
    document.querySelectorAll('img, video').forEach(el => {
      observer.observe(el);
    });
    
    const mutationObs = new MutationObserver(() => {
      document.querySelectorAll('img, video').forEach(el => {
        observer.observe(el);
      });
    });
    mutationObs.observe(document.body, { childList: true, subtree: true });
    
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
  setupIntersectionObserver();

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
    isYouTube: IS_YOUTUBE,
    scanAll: scanFullPage,
    stats: () => state.stats,
    pending: () => state.pending,
    pendingRequests: () => state.pendingRequests,
    batchQueue: () => batchQueue,
    setForcedBlur: (enabled) => { 
      CONFIG.forcedBlur = enabled; 
      console.log('[MW] Forced blur:', enabled);
      if (enabled) {
        console.log('[MW] DEV MODE: All images will be blurred without AI scan');
        scanFullPage();
      }
    },
    setFailClosed: (enabled) => {
      CONFIG.failClosed = enabled;
      console.log('[MW] Fail-closed:', enabled);
    },
    setDebug: (enabled) => { CONFIG.debug = enabled; console.log('[MW] Debug mode:', enabled); },
    getNonce: () => CONFIG.nonce,
  };

  console.log('[MW] Moderation fully initialized');
  console.log('[MW] Debug API at window.__MW_DEBUG__');
  console.log('[MW] Toggle forced blur: window.__MW_DEBUG__.setForcedBlur(true)');
  console.log('[MW] Toggle fail-closed: window.__MW_DEBUG__.setFailClosed(true/false)');
})();
`;
}

/**
 * Generate CSS styles for moderation UI (legacy export)
 */
export function generateModerationStyles(): string {
  return `
<style id="mw-moderation-styles">
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
    background: rgba(0, 0, 0, 0.9) !important;
    color: white !important;
    border: 2px solid rgba(255, 255, 255, 0.4) !important;
    padding: 10px 20px !important;
    border-radius: 8px !important;
    cursor: pointer !important;
    font-size: 14px !important;
    font-weight: bold !important;
    z-index: 9999 !important;
  }
  
  [data-mw-moderated="blurred"] {
    transition: filter 0.3s ease !important;
  }
  
  .mw-softblur {
    transition: filter 0.2s ease !important;
  }
  
  ytd-thumbnail,
  ytd-rich-item-renderer,
  yt-img-shadow,
  #shorts-player,
  [class*="DivVideoContainer"],
  [class*="DivPlayerContainer"],
  .video-card {
    position: relative !important;
  }
</style>
`;
}
