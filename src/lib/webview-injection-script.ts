/**
 * WebView Injection Script for Image Moderation
 * Enhanced for YouTube Shorts, TikTok, Shadow DOM, and dynamic content
 * 
 * Features:
 * 1. MutationObserver for new images and dynamic content
 * 2. Shadow DOM traversal (YouTube, TikTok use custom elements)
 * 3. Background-image CSS detection
 * 4. Video poster and preview thumbnails
 * 5. Lazy-loaded content (data-src, srcset, loading="lazy")
 * 6. IntersectionObserver for viewport-based scanning
 * 7. Platform-specific selectors (YouTube, TikTok, Instagram)
 * 8. Comprehensive logging for debugging
 */

export interface InjectionConfig {
  sensitivity: number; // 0-4 blur dial
  blurStrength: number; // px
  enabled: boolean;
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
  return `
(function() {
  'use strict';
  
  // ==================== INITIALIZATION ====================
  
  // Prevent double injection
  if (window.__GC_MODERATION_ACTIVE__) {
    console.log('[GC:init] Already injected, skipping');
    return;
  }
  window.__GC_MODERATION_ACTIVE__ = true;
  
  console.log('[GC:init] ========================================');
  console.log('[GC:init] GoodCreation Moderation Script Starting');
  console.log('[GC:init] Sensitivity:', ${config.sensitivity});
  console.log('[GC:init] Blur Strength:', ${config.blurStrength}, 'px');
  console.log('[GC:init] Enabled:', ${config.enabled});
  console.log('[GC:init] URL:', window.location.href);
  console.log('[GC:init] ========================================');

  const CONFIG = {
    sensitivity: ${config.sensitivity},
    blurStrength: ${config.blurStrength},
    enabled: ${config.enabled},
    minImageSize: 50,
    scanDelay: 100,
    maxConcurrent: 4,
    pollInterval: 200,
    maxPollTime: 30000,
  };

  // Threshold mappings for blur dial levels
  const THRESHOLDS = {
    0: { porn: 1.1, sexy: 1.1, hentai: 1.1 },
    1: { porn: 0.7, sexy: 0.85, hentai: 0.7 },
    2: { porn: 0.5, sexy: 0.65, hentai: 0.5 },
    3: { porn: 0.3, sexy: 0.45, hentai: 0.3 },
    4: { porn: 0.15, sexy: 0.25, hentai: 0.15 },
  };

  // Moderation state tracking
  const state = {
    scanned: new Set(),
    pending: new Set(),
    blurred: new Set(),
    revealed: new Set(),
    queue: [],
    processing: 0,
    messageId: 0,
    pendingScans: new Map(), // messageId -> { src, resolve }
    stats: {
      imgTags: 0,
      bgImages: 0,
      videoPosters: 0,
      shadowDom: 0,
      skipped: 0,
      blurred: 0,
      errors: 0,
    },
  };

  // ==================== LOGGING ====================

  function log(category, message, ...args) {
    const prefix = '[GC:' + category + ']';
    console.log(prefix, message, ...args);
  }

  function logStats() {
    console.log('[GC:stats]', JSON.stringify(state.stats));
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
  log('init', 'Detected platform:', PLATFORM);

  // Platform-specific selectors for containers that hold images
  const PLATFORM_SELECTORS = {
    'youtube': [
      'ytd-app', 'ytd-browse', 'ytd-watch-flexy', 'ytd-search',
      'ytd-rich-grid-renderer', 'ytd-video-renderer', 'ytd-compact-video-renderer',
      'ytd-rich-item-renderer', 'ytd-thumbnail', 'ytd-playlist-thumbnail',
      'ytd-channel-renderer', 'yt-img-shadow', 'yt-image',
    ],
    'youtube-shorts': [
      'ytd-app', 'ytd-shorts', 'ytd-reel-video-renderer', 'ytd-reel-item-renderer',
      'ytm-shorts-lockup-view-model', 'ytm-reel-item-renderer',
      'shorts-player', 'ytm-shorts', '#shorts-container',
      'yt-img-shadow', 'yt-image', 'ytd-thumbnail',
    ],
    'tiktok': [
      '[data-e2e="recommend-list-item-container"]', '.tiktok-feed-item',
      '.video-feed-item', '.video-card', '.user-avatar',
      '[class*="DivVideoContainer"]', '[class*="DivPlayerContainer"]',
      '[class*="ImgAvatar"]', '[class*="ImgPoster"]',
      '.tiktok-avatar', '.author-card', '.video-infos-container',
    ],
    'instagram': [
      'article', '.x1lliihq', '._aagv', '._aarf', '._aagw',
      '[data-testid="post-container"]', '.x1n2onr6',
    ],
    'twitter': [
      '[data-testid="tweet"]', '[data-testid="tweetPhoto"]',
      '.css-1dbjc4n', 'article',
    ],
    'facebook': [
      '[data-pagelet]', '.x1lliihq', '.xu06os2',
    ],
    'generic': [],
  };

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
    } catch (e) {
      log('error', 'Failed to extract bg image:', e.message);
    }
    return null;
  }

  // ==================== VISIBILITY CHECK ====================

  function isElementVisible(element) {
    try {
      const rect = element.getBoundingClientRect();
      const width = rect.width || element.offsetWidth || 0;
      const height = rect.height || element.offsetHeight || 0;
      
      // Skip tiny elements
      if (width < CONFIG.minImageSize || height < CONFIG.minImageSize) {
        return false;
      }
      
      // Check if in or near viewport
      const buffer = 500;
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

  function applyBlur(element, src, category) {
    if (state.revealed.has(src)) return;
    
    try {
      element.style.filter = 'blur(' + CONFIG.blurStrength + 'px)';
      element.style.transition = 'filter 0.3s ease';
      element.dataset.gcModerated = 'blurred';
      element.dataset.gcCategory = category || 'flagged';
      element.dataset.gcSrc = src;
      
      state.blurred.add(src);
      state.stats.blurred++;
      
      createRevealOverlay(element, src, category);
      log('blur', 'Applied blur [' + category + ']:', src.substring(0, 60));
    } catch (e) {
      log('error', 'Failed to apply blur:', e.message);
    }
  }

  function removeBlur(element, src) {
    try {
      element.style.filter = 'none';
      element.dataset.gcModerated = 'revealed';
      
      const overlay = element.parentElement?.querySelector('.gc-reveal-overlay');
      if (overlay) {
        overlay.style.display = 'none';
      }
      
      log('reveal', 'Blur removed:', src.substring(0, 60));
    } catch (e) {
      log('error', 'Failed to remove blur:', e.message);
    }
  }

  function createRevealOverlay(element, src, category) {
    if (element.dataset.gcHasOverlay === 'true') return;
    
    const parent = element.parentElement;
    if (!parent) return;
    
    // Ensure parent is positioned
    const parentPos = window.getComputedStyle(parent).position;
    if (parentPos === 'static') {
      parent.style.position = 'relative';
    }
    
    const overlay = document.createElement('div');
    overlay.className = 'gc-reveal-overlay';
    overlay.dataset.gcFor = src;
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
      'background: rgba(0,0,0,0.7)',
      'color: #ff6b6b',
      'padding: 2px 8px',
      'border-radius: 4px',
      'font-size: 11px',
      'font-weight: bold',
    ].join(';');
    badge.textContent = (category || 'flagged').toUpperCase();
    overlay.appendChild(badge);
    
    const btn = document.createElement('button');
    btn.className = 'gc-reveal-btn';
    btn.textContent = '👁 Reveal';
    btn.style.cssText = [
      'background: rgba(0, 0, 0, 0.85)',
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
        applyBlur(element, src, category);
        btn.textContent = '👁 Reveal';
        overlay.style.display = 'flex';
      } else {
        // Reveal
        state.revealed.add(src);
        removeBlur(element, src);
        btn.textContent = '🔒 Hide';
      }
    });
    
    overlay.appendChild(btn);
    parent.appendChild(overlay);
    element.dataset.gcHasOverlay = 'true';
  }

  // ==================== SCAN REQUEST ====================

  function requestScan(src, sourceType) {
    const url = normalizeUrl(src);
    if (!url) {
      state.stats.skipped++;
      return false;
    }
    
    // Skip data URLs that are too small
    if (url.startsWith('data:') && url.length < 1000) {
      log('skip', 'Tiny data URL');
      state.stats.skipped++;
      return false;
    }
    
    // Skip already processed
    if (state.scanned.has(url) || state.pending.has(url)) {
      return false;
    }
    
    state.pending.add(url);
    state.queue.push({ src: url, sourceType });
    
    log('queue', '[' + sourceType + '] Queued:', url.substring(0, 70));
    processQueue();
    return true;
  }

  // ==================== QUEUE PROCESSING ====================

  function processQueue() {
    while (state.processing < CONFIG.maxConcurrent && state.queue.length > 0) {
      const item = state.queue.shift();
      if (!item) continue;
      
      state.processing++;
      sendScanRequest(item.src, item.sourceType);
    }
  }

  // ==================== COMMUNICATION WITH NATIVE APP ====================
  
  // Store pending scan callbacks
  function sendScanRequest(src, sourceType) {
    const msgId = ++state.messageId;
    
    const message = {
      type: 'gc-moderation-request',
      action: 'scan',
      messageId: msgId,
      src: src,
      sourceType: sourceType,
      thresholds: THRESHOLDS[CONFIG.sensitivity] || THRESHOLDS[3],
    };
    
    // Store for result matching
    state.pendingScans.set(msgId, { src, sourceType });
    
    log('scan', 'Sending scan request #' + msgId + ':', src.substring(0, 60));
    
    // Try multiple communication channels
    
    // 1. iOS WKWebView messageHandlers
    try {
      if (window.webkit?.messageHandlers?.ModerationBridge) {
        window.webkit.messageHandlers.ModerationBridge.postMessage(message);
        log('comm', 'Sent via webkit messageHandlers');
      }
    } catch (e) {}
    
    // 2. Android JavaScriptInterface
    try {
      if (window.ModerationBridge?.scan) {
        window.ModerationBridge.scan(JSON.stringify(message));
        log('comm', 'Sent via Android bridge');
      }
    } catch (e) {}
    
    // 3. window.postMessage (for InAppBrowser)
    try {
      window.postMessage(message, '*');
      log('comm', 'Sent via postMessage');
    } catch (e) {}
    
    // 4. Parent frame postMessage
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, '*');
        log('comm', 'Sent via parent.postMessage');
      }
    } catch (e) {}
    
    // Timeout fallback - mark as safe after delay if no response
    setTimeout(() => {
      if (state.pendingScans.has(msgId)) {
        log('timeout', 'No response for #' + msgId + ', marking safe');
        handleModerationResult({
          messageId: msgId,
          src: src,
          shouldBlur: false,
          category: 'timeout',
          confidence: 0,
        });
      }
    }, 10000);
  }

  // ==================== RESULT HANDLING ====================

  function handleModerationResult(data) {
    const { src, shouldBlur, category, confidence, messageId } = data;
    
    // Clean up pending state
    if (messageId) {
      state.pendingScans.delete(messageId);
    }
    
    state.scanned.add(src);
    state.pending.delete(src);
    state.processing = Math.max(0, state.processing - 1);
    
    log('result', 'Got result:', src.substring(0, 50), '-> blur:', shouldBlur, 'cat:', category, 'conf:', (confidence * 100).toFixed(1) + '%');
    
    if (shouldBlur && CONFIG.enabled && CONFIG.sensitivity > 0) {
      // Find and blur all matching elements
      const elements = findElementsBySrc(src);
      log('result', 'Found', elements.length, 'elements to blur');
      
      elements.forEach(el => applyBlur(el, src, category));
    }
    
    // Continue processing queue
    processQueue();
  }

  // Listen for results from the native app
  window.addEventListener('message', function(event) {
    try {
      const data = event.data;
      
      if (data?.type === 'gc-moderation-result') {
        handleModerationResult(data);
      }
      
      if (data?.type === 'gc-update-config') {
        Object.assign(CONFIG, data.config);
        log('config', 'Config updated:', CONFIG);
      }
    } catch (e) {
      log('error', 'Message handler error:', e.message);
    }
  });

  // Expose result handler for native callbacks
  window.__GC_MODERATION_RESULT__ = handleModerationResult;

  // ==================== ELEMENT FINDING ====================

  function findElementsBySrc(src, root = document) {
    const elements = [];
    
    try {
      // Images
      root.querySelectorAll('img').forEach(img => {
        if (img.src === src || img.dataset.gcOrigSrc === src) {
          elements.push(img);
        }
      });
      
      // Video posters
      root.querySelectorAll('video').forEach(video => {
        if (video.poster === src || video.dataset.gcOrigPoster === src) {
          elements.push(video);
        }
      });
      
      // Background images
      root.querySelectorAll('[data-gc-bg-src]').forEach(el => {
        if (el.dataset.gcBgSrc === src) {
          elements.push(el);
        }
      });
      
      // Shadow DOMs
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          elements.push(...findElementsBySrc(src, el.shadowRoot));
        }
      });
    } catch (e) {
      log('error', 'findElementsBySrc error:', e.message);
    }
    
    return elements;
  }

  // ==================== SCANNING FUNCTIONS ====================

  function scanImgElement(img) {
    if (img.dataset.gcScanned === 'true') return;
    
    // Get source (handle lazy loading patterns)
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
      log('skip', 'No src on img:', img.className || img.id || 'unknown');
      state.stats.skipped++;
      return;
    }
    
    if (!isElementVisible(img)) {
      // Schedule re-scan when loaded
      img.addEventListener('load', () => {
        setTimeout(() => scanImgElement(img), 100);
      }, { once: true });
      return;
    }
    
    img.dataset.gcScanned = 'true';
    img.dataset.gcOrigSrc = src;
    
    if (requestScan(src, 'img')) {
      state.stats.imgTags++;
    }
  }

  function scanVideoPoster(video) {
    if (video.dataset.gcPosterScanned === 'true') return;
    
    const poster = video.poster ||
                   video.dataset.poster ||
                   video.getAttribute('data-poster');
    
    if (!poster) return;
    
    video.dataset.gcPosterScanned = 'true';
    video.dataset.gcOrigPoster = poster;
    
    if (requestScan(poster, 'video-poster')) {
      state.stats.videoPosters++;
    }
  }

  function scanBgImage(element) {
    if (element.dataset.gcBgScanned === 'true') return;
    
    const bgUrl = extractBgImageUrl(element);
    if (!bgUrl) return;
    
    if (!isElementVisible(element)) return;
    
    element.dataset.gcBgScanned = 'true';
    element.dataset.gcBgSrc = bgUrl;
    
    if (requestScan(bgUrl, 'bg-image')) {
      state.stats.bgImages++;
    }
  }

  function scanShadowRoot(shadowRoot) {
    if (!shadowRoot) return;
    
    log('shadow', 'Scanning Shadow DOM');
    state.stats.shadowDom++;
    
    try {
      // Scan all images
      shadowRoot.querySelectorAll('img').forEach(scanImgElement);
      
      // Scan videos
      shadowRoot.querySelectorAll('video').forEach(scanVideoPoster);
      
      // Scan bg images
      shadowRoot.querySelectorAll('*').forEach(scanBgImage);
      
      // Recurse into nested shadow roots
      shadowRoot.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) {
          scanShadowRoot(el.shadowRoot);
        }
      });
      
      // Observe shadow root for changes
      setupMutationObserver(shadowRoot);
    } catch (e) {
      log('error', 'Shadow DOM scan error:', e.message);
    }
  }

  function scanNode(node) {
    if (!node || node.nodeType !== 1) return;
    
    const tagName = node.tagName?.toUpperCase();
    
    // Direct element scan
    if (tagName === 'IMG') {
      scanImgElement(node);
    } else if (tagName === 'VIDEO') {
      scanVideoPoster(node);
    }
    
    // Background image
    scanBgImage(node);
    
    // Shadow DOM
    if (node.shadowRoot) {
      scanShadowRoot(node.shadowRoot);
    }
    
    // Scan children
    try {
      node.querySelectorAll('img').forEach(scanImgElement);
      node.querySelectorAll('video').forEach(scanVideoPoster);
      node.querySelectorAll('*').forEach(el => {
        scanBgImage(el);
        if (el.shadowRoot) {
          scanShadowRoot(el.shadowRoot);
        }
      });
    } catch (e) {
      log('error', 'scanNode error:', e.message);
    }
  }

  function scanFullPage() {
    if (!CONFIG.enabled || CONFIG.sensitivity === 0) {
      log('scan', 'Scanning disabled (sensitivity: ' + CONFIG.sensitivity + ')');
      return;
    }
    
    log('scan', '========== FULL PAGE SCAN ==========');
    log('scan', 'Platform:', PLATFORM);
    
    // Scan document body
    scanNode(document.body);
    
    // Platform-specific containers
    const selectors = PLATFORM_SELECTORS[PLATFORM] || [];
    selectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(scanNode);
      } catch (e) {}
    });
    
    log('scan', '========== SCAN COMPLETE ==========');
    logStats();
  }

  // ==================== MUTATION OBSERVER ====================

  function setupMutationObserver(root) {
    const observer = new MutationObserver(mutations => {
      if (!CONFIG.enabled || CONFIG.sensitivity === 0) return;
      
      mutations.forEach(mutation => {
        // Handle added nodes
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          setTimeout(() => scanNode(node), CONFIG.scanDelay);
        });
        
        // Handle attribute changes
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          const attr = mutation.attributeName;
          
          if (attr === 'src' && target.tagName === 'IMG') {
            target.dataset.gcScanned = 'false';
            setTimeout(() => scanImgElement(target), CONFIG.scanDelay);
          }
          
          if (attr === 'srcset' && target.tagName === 'IMG') {
            target.dataset.gcScanned = 'false';
            setTimeout(() => scanImgElement(target), CONFIG.scanDelay);
          }
          
          if (attr === 'poster' && target.tagName === 'VIDEO') {
            target.dataset.gcPosterScanned = 'false';
            setTimeout(() => scanVideoPoster(target), CONFIG.scanDelay);
          }
          
          if (attr === 'data-src' || attr === 'data-lazy-src') {
            target.dataset.gcScanned = 'false';
            setTimeout(() => scanImgElement(target), CONFIG.scanDelay);
          }
          
          if (attr === 'style') {
            target.dataset.gcBgScanned = 'false';
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
          setTimeout(() => scanNode(entry.target), 50);
        }
      });
    }, { rootMargin: '300px' });
    
    // Observe all images and videos
    document.querySelectorAll('img, video').forEach(el => {
      observer.observe(el);
    });
    
    // Re-observe on DOM changes
    const mutationObs = new MutationObserver(() => {
      document.querySelectorAll('img, video').forEach(el => {
        observer.observe(el);
      });
    });
    mutationObs.observe(document.body, { childList: true, subtree: true });
    
    return observer;
  }

  // ==================== INITIALIZATION ====================

  // Set up main observer
  setupMutationObserver(document.body);
  
  // Set up intersection observer
  setupIntersectionObserver();

  // Initial scan
  if (document.readyState === 'complete') {
    scanFullPage();
  } else {
    window.addEventListener('load', scanFullPage);
  }

  // Periodic rescans for dynamic content
  setTimeout(scanFullPage, 500);
  setTimeout(scanFullPage, 1500);
  setTimeout(scanFullPage, 3000);
  setTimeout(scanFullPage, 5000);
  setTimeout(scanFullPage, 10000);

  // Scroll-triggered rescans
  let scrollTimer;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(scanFullPage, 200);
  }, { passive: true });

  // Expose API for debugging
  window.__GC_MODERATION__ = {
    state: state,
    config: CONFIG,
    platform: PLATFORM,
    scanAll: scanFullPage,
    scanNode: scanNode,
    stats: () => state.stats,
    findBySrc: findElementsBySrc,
    thresholds: THRESHOLDS,
  };

  log('init', 'GoodCreation moderation fully initialized');
  log('init', 'Debug API available at window.__GC_MODERATION__');
})();
`;
}

/**
 * Generate CSS styles for moderation UI
 */
export function generateModerationStyles(): string {
  return `
<style id="gc-moderation-styles">
  .gc-reveal-overlay {
    position: absolute !important;
    inset: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: rgba(0, 0, 0, 0.25) !important;
    z-index: 9998 !important;
    pointer-events: auto !important;
  }
  
  .gc-reveal-btn {
    background: rgba(0, 0, 0, 0.9) !important;
    color: white !important;
    border: 2px solid rgba(255, 255, 255, 0.4) !important;
    padding: 10px 20px !important;
    border-radius: 8px !important;
    cursor: pointer !important;
    font-size: 14px !important;
    font-weight: bold !important;
    backdrop-filter: blur(4px) !important;
    transition: transform 0.2s ease !important;
    z-index: 9999 !important;
    white-space: nowrap !important;
  }
  
  .gc-reveal-btn:hover {
    transform: scale(1.05) !important;
  }
  
  .gc-reveal-btn:active {
    transform: scale(0.95) !important;
  }
  
  [data-gc-moderated="blurred"] {
    transition: filter 0.3s ease !important;
  }
  
  /* YouTube positioning fixes */
  ytd-thumbnail,
  ytd-rich-item-renderer,
  ytd-video-renderer,
  ytd-compact-video-renderer,
  ytd-reel-item-renderer,
  yt-img-shadow,
  #shorts-player {
    position: relative !important;
  }
  
  /* TikTok positioning fixes */
  [class*="DivVideoContainer"],
  [class*="DivPlayerContainer"],
  .video-card {
    position: relative !important;
  }
</style>
`;
}
