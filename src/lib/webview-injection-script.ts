/**
 * WebView Injection Script for Image Moderation
 * Enhanced for YouTube, Shadow DOM, background-images, lazy-loading, and video posters
 * 
 * Features:
 * 1. Watch for new images using MutationObserver (including Shadow DOM)
 * 2. Detect background-image CSS on elements
 * 3. Detect video poster frames and preview thumbnails
 * 4. Handle lazy-loaded content (data-src, srcset, loading="lazy")
 * 5. Send images to the main app for moderation via postMessage
 * 6. Apply blur and reveal toggle based on moderation results
 */

export interface InjectionConfig {
  sensitivity: number; // 0-4
  blurStrength: number; // px
  enabled: boolean;
}

/**
 * Generate the JavaScript code to inject into WebView
 */
export function generateModerationScript(config: InjectionConfig): string {
  return `
(function() {
  // Prevent double injection
  if (window.__GOODCREATION_MODERATION_ACTIVE__) return;
  window.__GOODCREATION_MODERATION_ACTIVE__ = true;

  const CONFIG = {
    sensitivity: ${config.sensitivity},
    blurStrength: ${config.blurStrength},
    enabled: ${config.enabled},
    minImageSize: 40,
    scanDelay: 50,
    maxConcurrent: 6,
    debugMode: true,
  };

  // Track moderation state
  const moderationState = {
    scanned: new Set(),
    blurred: new Set(),
    revealed: new Set(),
    pending: new Set(),
    queue: [],
    processing: 0,
    stats: {
      imgsScanned: 0,
      bgImagesScanned: 0,
      videoPostersScanned: 0,
      shadowDomScanned: 0,
      skipped: 0,
      blurred: 0,
    }
  };

  // Logging helper with categories
  function log(category, msg, ...args) {
    if (!CONFIG.debugMode) return;
    const prefix = '[GoodCreation:' + category + ']';
    console.log(prefix, msg, ...args);
  }

  // Extract URL from background-image CSS
  function extractBgImageUrl(element) {
    const style = window.getComputedStyle(element);
    const bgImage = style.backgroundImage;
    if (!bgImage || bgImage === 'none') return null;
    
    // Extract URL from url("...") or url('...')
    const match = bgImage.match(/url\\(["']?([^"')]+)["']?\\)/);
    if (match && match[1] && match[1].startsWith('http')) {
      return match[1];
    }
    return null;
  }

  // Check if element is visible and large enough
  function isElementVisible(element) {
    const rect = element.getBoundingClientRect();
    const width = rect.width || element.offsetWidth || element.clientWidth;
    const height = rect.height || element.offsetHeight || element.clientHeight;
    
    if (width < CONFIG.minImageSize || height < CONFIG.minImageSize) {
      return false;
    }
    
    // Check if in viewport (with buffer)
    const buffer = 500;
    const inViewport = (
      rect.top < window.innerHeight + buffer &&
      rect.bottom > -buffer &&
      rect.left < window.innerWidth + buffer &&
      rect.right > -buffer
    );
    
    return inViewport;
  }

  // Create reveal overlay for blurred elements
  function createRevealOverlay(element, src) {
    // Check if already has overlay
    if (element.dataset.gcHasOverlay === 'true') return;
    
    const overlay = document.createElement('div');
    overlay.className = 'gc-blur-overlay';
    overlay.dataset.gcSrc = src;
    overlay.style.cssText = \`
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.3);
      z-index: 9998;
      cursor: pointer;
    \`;
    
    const button = document.createElement('button');
    button.className = 'gc-reveal-btn';
    button.innerHTML = '👁 Reveal';
    button.style.cssText = \`
      background: rgba(0, 0, 0, 0.85);
      color: white;
      border: 2px solid rgba(255, 255, 255, 0.3);
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      backdrop-filter: blur(4px);
      transition: all 0.2s ease;
      z-index: 9999;
    \`;
    
    button.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      toggleReveal(element, src);
    });
    
    overlay.appendChild(button);
    
    // Ensure parent has position
    const parent = element.parentElement;
    if (parent) {
      const parentStyle = window.getComputedStyle(parent);
      if (parentStyle.position === 'static') {
        parent.style.position = 'relative';
      }
      parent.appendChild(overlay);
      element.dataset.gcHasOverlay = 'true';
    }
  }

  // Toggle reveal state
  function toggleReveal(element, src) {
    if (moderationState.revealed.has(src)) {
      // Re-blur
      moderationState.revealed.delete(src);
      applyBlurToElement(element, src);
      log('reveal', 'Re-blurred:', src.substring(0, 60));
    } else {
      // Reveal
      moderationState.revealed.add(src);
      removeBlurFromElement(element, src);
      log('reveal', 'Revealed:', src.substring(0, 60));
    }
  }

  // Apply blur to any element (img, video, div with bg)
  function applyBlurToElement(element, src) {
    if (moderationState.revealed.has(src)) return;
    
    element.style.filter = \`blur(\${CONFIG.blurStrength}px)\`;
    element.style.transition = 'filter 0.3s ease';
    element.dataset.gcModerated = 'blurred';
    element.dataset.gcBlurredSrc = src;
    
    createRevealOverlay(element, src);
    
    // Update overlay button text
    const parent = element.parentElement;
    const overlay = parent?.querySelector('.gc-blur-overlay');
    const btn = overlay?.querySelector('.gc-reveal-btn');
    if (btn) {
      btn.innerHTML = '👁 Reveal';
      btn.style.display = 'block';
      overlay.style.display = 'flex';
    }
    
    moderationState.blurred.add(src);
    moderationState.stats.blurred++;
    log('blur', 'Applied blur:', src.substring(0, 60));
  }

  // Remove blur from element
  function removeBlurFromElement(element, src) {
    element.style.filter = 'none';
    element.dataset.gcModerated = 'revealed';
    
    const parent = element.parentElement;
    const overlay = parent?.querySelector('.gc-blur-overlay');
    const btn = overlay?.querySelector('.gc-reveal-btn');
    if (btn) {
      btn.innerHTML = '🔒 Hide';
    }
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Send image to main app for scanning
  function requestScan(src, sourceType) {
    if (!src) return false;
    
    // Normalize URL
    if (src.startsWith('//')) {
      src = 'https:' + src;
    }
    
    if (!src.startsWith('http')) {
      log('skip', 'Non-HTTP URL:', src.substring(0, 40));
      moderationState.stats.skipped++;
      return false;
    }
    
    // Skip data URLs and tiny base64
    if (src.startsWith('data:')) {
      if (src.length < 1000) {
        log('skip', 'Tiny data URL');
        moderationState.stats.skipped++;
        return false;
      }
    }
    
    if (moderationState.scanned.has(src)) {
      log('skip', 'Already scanned:', src.substring(0, 40));
      return false;
    }
    if (moderationState.pending.has(src)) {
      log('skip', 'Already pending:', src.substring(0, 40));
      return false;
    }
    
    moderationState.pending.add(src);
    moderationState.queue.push({ src, sourceType });
    log('queue', 'Queued [' + sourceType + ']:', src.substring(0, 60));
    
    processQueue();
    return true;
  }

  // Process scan queue with concurrency limit
  function processQueue() {
    while (
      moderationState.processing < CONFIG.maxConcurrent &&
      moderationState.queue.length > 0
    ) {
      const item = moderationState.queue.shift();
      if (item) {
        moderationState.processing++;
        
        const message = {
          type: 'scan',
          src: item.src,
          sourceType: item.sourceType,
        };
        
        // Send to parent app via postMessage
        try {
          window.webkit?.messageHandlers?.ModerationBridge?.postMessage(message);
        } catch (e) {}
        
        // Also try Android bridge
        try {
          if (window.ModerationBridge?.scan) {
            window.ModerationBridge.scan(item.src);
          }
        } catch (e) {}
        
        // Fallback: send via window.postMessage for InAppBrowser
        try {
          window.parent?.postMessage({
            type: 'gc-moderation-request',
            action: 'scan',
            src: item.src,
            sourceType: item.sourceType,
          }, '*');
        } catch (e) {}
        
        log('scan', 'Sent for scan [' + item.sourceType + ']:', item.src.substring(0, 60));
      }
    }
  }

  // Find all elements with a specific src (including Shadow DOM)
  function findElementsBySrc(src, root = document) {
    const elements = [];
    
    // Regular img tags
    try {
      const imgs = root.querySelectorAll('img');
      imgs.forEach(img => {
        if (img.src === src || img.dataset.gcOriginalSrc === src) {
          elements.push(img);
        }
      });
    } catch (e) {}
    
    // Video posters
    try {
      const videos = root.querySelectorAll('video');
      videos.forEach(video => {
        if (video.poster === src || video.dataset.gcOriginalPoster === src) {
          elements.push(video);
        }
      });
    } catch (e) {}
    
    // Background images
    try {
      const allElements = root.querySelectorAll('*');
      allElements.forEach(el => {
        if (el.dataset.gcBgSrc === src) {
          elements.push(el);
        }
      });
    } catch (e) {}
    
    // Check Shadow DOMs
    try {
      const allElements = root.querySelectorAll('*');
      allElements.forEach(el => {
        if (el.shadowRoot) {
          const shadowElements = findElementsBySrc(src, el.shadowRoot);
          elements.push(...shadowElements);
        }
      });
    } catch (e) {}
    
    return elements;
  }

  // Handle moderation results from main app
  function handleModerationResult(data) {
    const { src, shouldBlur, category, confidence } = data;
    
    moderationState.scanned.add(src);
    moderationState.pending.delete(src);
    moderationState.processing = Math.max(0, moderationState.processing - 1);
    
    log('result', 'Got result for:', src.substring(0, 50), '-> blur:', shouldBlur, 'cat:', category);
    
    if (shouldBlur && CONFIG.enabled && CONFIG.sensitivity > 0) {
      // Find all elements with this src (including Shadow DOM)
      const elements = findElementsBySrc(src);
      log('result', 'Found', elements.length, 'elements to blur');
      elements.forEach(el => applyBlurToElement(el, src));
    }
    
    processQueue();
  }

  // Listen for results from main app
  window.addEventListener('message', function(event) {
    if (event.data?.type === 'gc-moderation-result') {
      handleModerationResult(event.data);
    }
    
    if (event.data?.type === 'gc-update-config') {
      Object.assign(CONFIG, event.data.config);
      log('config', 'Config updated:', CONFIG);
    }
  });

  // ===== SCAN FUNCTIONS =====

  // Scan an img element
  function scanImgElement(img) {
    // Get actual source (handle lazy loading)
    let src = img.src || 
              img.dataset.src || 
              img.dataset.lazySrc ||
              img.dataset.thumbSrc ||
              img.getAttribute('data-src') ||
              img.getAttribute('data-lazy-src');
    
    // Handle srcset
    if (!src && img.srcset) {
      const srcsetParts = img.srcset.split(',');
      if (srcsetParts.length > 0) {
        src = srcsetParts[0].trim().split(' ')[0];
      }
    }
    
    if (!src) {
      log('skip', 'No src for img:', img.className);
      moderationState.stats.skipped++;
      return;
    }
    
    // Skip already scanned
    if (img.dataset.gcScanned === 'true') return;
    
    // Check size
    if (!isElementVisible(img)) {
      // Still mark for later
      img.addEventListener('load', function() {
        setTimeout(() => scanImgElement(img), 100);
      }, { once: true });
      return;
    }
    
    img.dataset.gcScanned = 'true';
    img.dataset.gcOriginalSrc = src;
    
    if (requestScan(src, 'img')) {
      moderationState.stats.imgsScanned++;
    }
  }

  // Scan video poster
  function scanVideoPoster(video) {
    const poster = video.poster || 
                   video.dataset.poster ||
                   video.getAttribute('data-poster');
    
    if (!poster) return;
    if (video.dataset.gcPosterScanned === 'true') return;
    
    video.dataset.gcPosterScanned = 'true';
    video.dataset.gcOriginalPoster = poster;
    
    if (requestScan(poster, 'video-poster')) {
      moderationState.stats.videoPostersScanned++;
    }
  }

  // Scan background-image CSS
  function scanBackgroundImage(element) {
    if (element.dataset.gcBgScanned === 'true') return;
    
    const bgUrl = extractBgImageUrl(element);
    if (!bgUrl) return;
    
    if (!isElementVisible(element)) return;
    
    element.dataset.gcBgScanned = 'true';
    element.dataset.gcBgSrc = bgUrl;
    
    if (requestScan(bgUrl, 'bg-image')) {
      moderationState.stats.bgImagesScanned++;
    }
  }

  // Scan Shadow DOM
  function scanShadowRoot(shadowRoot) {
    if (!shadowRoot) return;
    
    log('shadow', 'Scanning Shadow DOM');
    
    // Scan images
    try {
      const imgs = shadowRoot.querySelectorAll('img');
      imgs.forEach(img => scanImgElement(img));
    } catch (e) {}
    
    // Scan videos
    try {
      const videos = shadowRoot.querySelectorAll('video');
      videos.forEach(video => scanVideoPoster(video));
    } catch (e) {}
    
    // Scan background images
    try {
      const elements = shadowRoot.querySelectorAll('*');
      elements.forEach(el => scanBackgroundImage(el));
    } catch (e) {}
    
    // Nested Shadow DOMs
    try {
      const elements = shadowRoot.querySelectorAll('*');
      elements.forEach(el => {
        if (el.shadowRoot) {
          scanShadowRoot(el.shadowRoot);
          moderationState.stats.shadowDomScanned++;
        }
      });
    } catch (e) {}
    
    // Set up observer for this shadow root
    observeNode(shadowRoot);
  }

  // Scan a node and all its children
  function scanNode(node) {
    if (!node || node.nodeType !== 1) return;
    
    // Direct element checks
    if (node.tagName === 'IMG') {
      scanImgElement(node);
    } else if (node.tagName === 'VIDEO') {
      scanVideoPoster(node);
    }
    
    // Background image
    scanBackgroundImage(node);
    
    // Check for Shadow DOM
    if (node.shadowRoot) {
      scanShadowRoot(node.shadowRoot);
      moderationState.stats.shadowDomScanned++;
    }
    
    // Scan children
    try {
      // Images
      const imgs = node.querySelectorAll('img');
      imgs.forEach(img => scanImgElement(img));
      
      // Videos
      const videos = node.querySelectorAll('video');
      videos.forEach(video => scanVideoPoster(video));
      
      // All elements for bg images and shadow DOM
      const allElements = node.querySelectorAll('*');
      allElements.forEach(el => {
        scanBackgroundImage(el);
        if (el.shadowRoot) {
          scanShadowRoot(el.shadowRoot);
          moderationState.stats.shadowDomScanned++;
        }
      });
    } catch (e) {}
  }

  // Full page scan
  function scanAllContent() {
    if (!CONFIG.enabled || CONFIG.sensitivity === 0) {
      log('scan', 'Scanning disabled (sensitivity: ' + CONFIG.sensitivity + ')');
      return;
    }
    
    log('scan', 'Starting full page scan...');
    
    // Scan document body
    scanNode(document.body);
    
    // YouTube-specific containers
    const ytContainers = [
      'ytd-app',
      'ytd-browse',
      'ytd-watch-flexy',
      'ytd-search',
      'ytd-rich-grid-renderer',
      'ytd-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-rich-item-renderer',
      'ytd-thumbnail',
      'ytd-shorts',
      'ytm-shorts-lockup-view-model',
    ];
    
    ytContainers.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => scanNode(el));
      } catch (e) {}
    });
    
    log('scan', 'Scan complete. Stats:', JSON.stringify(moderationState.stats));
  }

  // ===== MUTATION OBSERVER =====

  function observeNode(root) {
    const observer = new MutationObserver(function(mutations) {
      if (!CONFIG.enabled || CONFIG.sensitivity === 0) return;
      
      mutations.forEach(function(mutation) {
        // Added nodes
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;
          setTimeout(() => scanNode(node), CONFIG.scanDelay);
        });
        
        // Attribute changes
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          const attr = mutation.attributeName;
          
          // src changes on images
          if (attr === 'src' && target.tagName === 'IMG') {
            target.dataset.gcScanned = 'false';
            setTimeout(() => scanImgElement(target), CONFIG.scanDelay);
          }
          
          // srcset changes
          if (attr === 'srcset' && target.tagName === 'IMG') {
            target.dataset.gcScanned = 'false';
            setTimeout(() => scanImgElement(target), CONFIG.scanDelay);
          }
          
          // poster changes on videos
          if (attr === 'poster' && target.tagName === 'VIDEO') {
            target.dataset.gcPosterScanned = 'false';
            setTimeout(() => scanVideoPoster(target), CONFIG.scanDelay);
          }
          
          // data-src lazy loading
          if (attr === 'data-src' || attr === 'data-lazy-src') {
            target.dataset.gcScanned = 'false';
            setTimeout(() => scanImgElement(target), CONFIG.scanDelay);
          }
          
          // style changes (for background-image)
          if (attr === 'style') {
            target.dataset.gcBgScanned = 'false';
            setTimeout(() => scanBackgroundImage(target), CONFIG.scanDelay);
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

  // Start main observer
  observeNode(document.body);

  // ===== INITIALIZATION =====

  // Initial scan
  if (document.readyState === 'complete') {
    scanAllContent();
  } else {
    window.addEventListener('load', scanAllContent);
  }

  // Delayed scans for lazy content
  setTimeout(scanAllContent, 500);
  setTimeout(scanAllContent, 1500);
  setTimeout(scanAllContent, 3000);
  setTimeout(scanAllContent, 6000);

  // Scroll-based scanning for infinite scroll
  let scrollTimer;
  window.addEventListener('scroll', function() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(scanAllContent, 300);
  }, { passive: true });

  // Intersection observer for lazy-loaded images
  if ('IntersectionObserver' in window) {
    const lazyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setTimeout(() => scanNode(entry.target), 100);
        }
      });
    }, { rootMargin: '200px' });
    
    // Observe all images
    document.querySelectorAll('img').forEach(img => lazyObserver.observe(img));
    
    // Re-observe on mutations
    const mutationObserver = new MutationObserver(() => {
      document.querySelectorAll('img').forEach(img => lazyObserver.observe(img));
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  log('init', 'GoodCreation moderation initialized', CONFIG);
  log('init', 'Platform:', navigator.userAgent.substring(0, 50));

  // Expose API for debugging
  window.__GC_MODERATION__ = {
    state: moderationState,
    config: CONFIG,
    scanAll: scanAllContent,
    toggleReveal: toggleReveal,
    stats: () => moderationState.stats,
    findBySrc: findElementsBySrc,
  };
})();
`;
}

/**
 * Generate CSS styles for moderation UI
 */
export function generateModerationStyles(): string {
  return `
<style id="gc-moderation-styles">
  .gc-blur-overlay {
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    background: rgba(0, 0, 0, 0.2) !important;
    z-index: 9998 !important;
    pointer-events: auto !important;
  }
  
  .gc-reveal-btn {
    background: rgba(0, 0, 0, 0.85) !important;
    color: white !important;
    border: 2px solid rgba(255, 255, 255, 0.3) !important;
    padding: 10px 20px !important;
    border-radius: 8px !important;
    cursor: pointer !important;
    font-size: 14px !important;
    font-weight: bold !important;
    backdrop-filter: blur(4px) !important;
    transition: all 0.2s ease !important;
    z-index: 9999 !important;
    white-space: nowrap !important;
  }
  
  .gc-reveal-btn:hover {
    background: rgba(0, 0, 0, 0.95) !important;
    transform: scale(1.05) !important;
  }
  
  .gc-reveal-btn:active {
    transform: scale(0.95) !important;
  }
  
  [data-gc-moderated="blurred"] {
    transition: filter 0.3s ease !important;
  }
  
  /* YouTube-specific fixes */
  ytd-thumbnail, ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer {
    position: relative !important;
  }
</style>
`;
}
