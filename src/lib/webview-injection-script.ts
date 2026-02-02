/**
 * WebView Injection Script for Image Moderation
 * 
 * This script runs INSIDE the WebView and handles:
 * 1. Image detection (img tags, background-images, video posters)
 * 2. Shadow DOM traversal for YouTube/TikTok
 * 3. Dynamic content via MutationObserver
 * 4. Communication with native app via executeScript polling
 * 5. Blur application and reveal toggles
 * 
 * Communication Flow:
 * 1. Script detects images and queues them in window.__GC_SCAN_QUEUE__
 * 2. Native app polls this queue via executeScript
 * 3. Native app processes images and pushes results to window.__GC_SCAN_RESULTS__
 * 4. Script polls results and applies blurs
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
  if (window.__MW_ACTIVE__) {
    console.log('[MW] Already injected, skipping');
    return;
  }
  window.__MW_ACTIVE__ = true;
  
  console.log('[MW] ========================================');
  console.log('[MW] injected - Moderation Script Starting');
  console.log('[MW] Sensitivity:', ${config.sensitivity});
  console.log('[MW] Blur Strength:', ${config.blurStrength}, 'px');
  console.log('[MW] Enabled:', ${config.enabled});
  console.log('[MW] URL:', window.location.href);
  console.log('[MW] ========================================');

  const CONFIG = {
    sensitivity: ${config.sensitivity},
    blurStrength: ${config.blurStrength},
    enabled: ${config.enabled},
    minImageSize: 40,
    scanDelay: 50,
  };

  // Threshold mappings for blur dial levels
  const THRESHOLDS = {
    0: { porn: 1.1, sexy: 1.1, hentai: 1.1 },
    1: { porn: 0.7, sexy: 0.85, hentai: 0.7 },
    2: { porn: 0.5, sexy: 0.65, hentai: 0.5 },
    3: { porn: 0.3, sexy: 0.45, hentai: 0.3 },
    4: { porn: 0.15, sexy: 0.25, hentai: 0.15 },
  };

  // Global queues for native app communication
  // These are polled by the native app via executeScript
  window.__GC_SCAN_QUEUE__ = window.__GC_SCAN_QUEUE__ || [];
  window.__GC_SCAN_RESULTS__ = window.__GC_SCAN_RESULTS__ || [];

  // Internal state tracking
  const state = {
    scanned: new Set(),
    pending: new Set(),
    blurred: new Set(),
    revealed: new Set(),
    elements: new Map(), // src -> element[]
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
  console.log('[MW] Platform detected:', PLATFORM);

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
      
      if (width < CONFIG.minImageSize || height < CONFIG.minImageSize) {
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

  // ==================== BLUR MANAGEMENT ====================

  function applyBlur(element, src, category, blurStrengthPx) {
    if (state.revealed.has(src)) return;
    
    const blurPx = blurStrengthPx || CONFIG.blurStrength;
    
    try {
      element.style.filter = 'blur(' + blurPx + 'px)';
      element.style.transition = 'filter 0.3s ease';
      element.dataset.mwModerated = 'blurred';
      element.dataset.mwCategory = category || 'flagged';
      element.dataset.mwSrc = src;
      
      state.blurred.add(src);
      state.stats.blurred++;
      
      createRevealOverlay(element, src, category);
      console.log('[MW] applied blur [' + category + ']:', src.substring(0, 60));
    } catch (e) {
      console.error('[MW] Failed to apply blur:', e.message);
    }
  }

  function removeBlur(element, src) {
    try {
      element.style.filter = 'none';
      element.dataset.mwModerated = 'revealed';
      
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
      }
    });
    
    overlay.appendChild(btn);
    parent.appendChild(overlay);
    element.dataset.mwHasOverlay = 'true';
  }

  // ==================== SCAN QUEUE MANAGEMENT ====================

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
    
    // Skip already processed
    if (state.scanned.has(url) || state.pending.has(url)) {
      return false;
    }
    
    state.pending.add(url);
    
    // Track element for later blur application
    if (!state.elements.has(url)) {
      state.elements.set(url, []);
    }
    state.elements.get(url).push(element);
    
    // Add to global queue for native app to pick up
    window.__GC_SCAN_QUEUE__.push({
      src: url,
      sourceType: sourceType,
      thresholds: THRESHOLDS[CONFIG.sensitivity] || THRESHOLDS[3],
      timestamp: Date.now(),
    });
    
    console.log('[MW] callBridgeScan [' + sourceType + ']:', url.substring(0, 70));
    return true;
  }

  // ==================== RESULT PROCESSING ====================

  function processResults() {
    if (!window.__GC_SCAN_RESULTS__ || window.__GC_SCAN_RESULTS__.length === 0) {
      return;
    }
    
    const results = window.__GC_SCAN_RESULTS__.splice(0, window.__GC_SCAN_RESULTS__.length);
    
    results.forEach(result => {
      const { src, shouldBlur, category, blurStrengthPx } = result;
      
      console.log('[MW] scan result:', src.substring(0, 50), '-> blur:', shouldBlur, 'cat:', category);
      
      state.scanned.add(src);
      state.pending.delete(src);
      
      if (shouldBlur && CONFIG.enabled && CONFIG.sensitivity > 0) {
        const elements = state.elements.get(src) || [];
        console.log('[MW] Found', elements.length, 'elements to blur');
        
        elements.forEach(el => {
          if (el && el.isConnected) {
            applyBlur(el, src, category, blurStrengthPx);
          }
        });
        
        // Also find by src attribute in case elements changed
        findAndBlur(src, category, blurStrengthPx);
      }
    });
  }

  function findAndBlur(src, category, blurStrengthPx) {
    try {
      // Images
      document.querySelectorAll('img').forEach(img => {
        if (img.src === src && !state.revealed.has(src)) {
          applyBlur(img, src, category, blurStrengthPx);
        }
      });
      
      // Video posters
      document.querySelectorAll('video').forEach(video => {
        if (video.poster === src && !state.revealed.has(src)) {
          applyBlur(video, src, category, blurStrengthPx);
        }
      });
      
      // Background images
      document.querySelectorAll('[data-mw-bg-src]').forEach(el => {
        if (el.dataset.mwBgSrc === src && !state.revealed.has(src)) {
          applyBlur(el, src, category, blurStrengthPx);
        }
      });
    } catch (e) {}
  }

  // Poll for results from native app
  setInterval(processResults, 100);

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

  // Expose debug API
  window.__MW_DEBUG__ = {
    state: state,
    config: CONFIG,
    platform: PLATFORM,
    scanAll: scanFullPage,
    stats: () => state.stats,
    queue: () => window.__GC_SCAN_QUEUE__,
    results: () => window.__GC_SCAN_RESULTS__,
  };

  console.log('[MW] Moderation fully initialized');
  console.log('[MW] Debug API at window.__MW_DEBUG__');
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
