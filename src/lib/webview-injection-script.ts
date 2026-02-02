/**
 * WebView Injection Script for Image Moderation
 * This script is injected into the native WebView to:
 * 1. Watch for new images using MutationObserver
 * 2. Send images to the main app for moderation via postMessage
 * 3. Apply blur and reveal toggle based on moderation results
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
    minImageSize: 50,
    scanDelay: 100,
    maxConcurrent: 4,
  };

  // Track moderation state
  const moderationState = {
    scanned: new Set(),
    blurred: new Set(),
    revealed: new Set(),
    pending: new Set(),
    queue: [],
    processing: 0,
  };

  // Logging helper
  function log(msg, ...args) {
    console.log('[GoodCreation]', msg, ...args);
  }

  // Create reveal button for blurred images
  function createRevealButton(img) {
    const wrapper = document.createElement('div');
    wrapper.className = 'gc-blur-wrapper';
    wrapper.style.cssText = 'position: relative; display: inline-block;';
    
    const button = document.createElement('button');
    button.className = 'gc-reveal-btn';
    button.innerHTML = '👁 Reveal';
    button.style.cssText = \`
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 9999;
      background: rgba(0, 0, 0, 0.8);
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: bold;
      backdrop-filter: blur(4px);
      transition: all 0.2s ease;
    \`;
    
    button.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      toggleReveal(img);
    });
    
    return { wrapper, button };
  }

  // Toggle reveal state
  function toggleReveal(img) {
    const src = img.dataset.gcOriginalSrc || img.src;
    
    if (moderationState.revealed.has(src)) {
      // Re-blur
      moderationState.revealed.delete(src);
      applyBlur(img);
      log('Re-blurred:', src.substring(0, 50));
    } else {
      // Reveal
      moderationState.revealed.add(src);
      removeBlur(img);
      log('Revealed:', src.substring(0, 50));
    }
  }

  // Apply blur to image
  function applyBlur(img) {
    const src = img.dataset.gcOriginalSrc || img.src;
    
    if (moderationState.revealed.has(src)) return;
    
    img.style.filter = \`blur(\${CONFIG.blurStrength}px)\`;
    img.style.transition = 'filter 0.3s ease';
    img.dataset.gcModerated = 'blurred';
    
    // Add or show reveal button
    let wrapper = img.closest('.gc-blur-wrapper');
    if (!wrapper) {
      const parent = img.parentElement;
      if (parent) {
        const { wrapper: newWrapper, button } = createRevealButton(img);
        parent.insertBefore(newWrapper, img);
        newWrapper.appendChild(img);
        newWrapper.appendChild(button);
        wrapper = newWrapper;
      }
    }
    
    const btn = wrapper?.querySelector('.gc-reveal-btn');
    if (btn) {
      btn.style.display = 'block';
      btn.innerHTML = '👁 Reveal';
    }
    
    moderationState.blurred.add(src);
    log('Blurred image:', src.substring(0, 50));
  }

  // Remove blur from image
  function removeBlur(img) {
    img.style.filter = 'none';
    img.dataset.gcModerated = 'revealed';
    
    const wrapper = img.closest('.gc-blur-wrapper');
    const btn = wrapper?.querySelector('.gc-reveal-btn');
    if (btn) {
      btn.innerHTML = '🔒 Hide';
    }
  }

  // Send image to main app for scanning
  function requestScan(src) {
    if (!src || !src.startsWith('http')) return;
    if (moderationState.scanned.has(src)) return;
    if (moderationState.pending.has(src)) return;
    
    moderationState.pending.add(src);
    moderationState.queue.push(src);
    processQueue();
  }

  // Process scan queue with concurrency limit
  function processQueue() {
    while (
      moderationState.processing < CONFIG.maxConcurrent &&
      moderationState.queue.length > 0
    ) {
      const src = moderationState.queue.shift();
      if (src) {
        moderationState.processing++;
        
        // Send to parent app via postMessage
        window.webkit?.messageHandlers?.ModerationBridge?.postMessage({
          type: 'scan',
          src: src,
        });
        
        // Also try Android bridge
        if (window.ModerationBridge?.scan) {
          window.ModerationBridge.scan(src);
        }
        
        // Fallback: send via window.postMessage for InAppBrowser
        window.parent?.postMessage({
          type: 'gc-moderation-request',
          action: 'scan',
          src: src,
        }, '*');
      }
    }
  }

  // Handle moderation results from main app
  function handleModerationResult(data) {
    const { src, shouldBlur, category, confidence } = data;
    
    moderationState.scanned.add(src);
    moderationState.pending.delete(src);
    moderationState.processing = Math.max(0, moderationState.processing - 1);
    
    if (shouldBlur && CONFIG.enabled && CONFIG.sensitivity > 0) {
      // Find all images with this src
      const images = document.querySelectorAll(\`img[src="\${src}"], img[data-gc-original-src="\${src}"]\`);
      images.forEach(img => applyBlur(img));
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
      log('Config updated:', CONFIG);
    }
  });

  // Scan a single image element
  function scanImage(img) {
    if (!img.src || !img.src.startsWith('http')) return;
    if (img.dataset.gcScanned === 'true') return;
    if (img.width < CONFIG.minImageSize || img.height < CONFIG.minImageSize) return;
    
    img.dataset.gcScanned = 'true';
    img.dataset.gcOriginalSrc = img.src;
    
    requestScan(img.src);
  }

  // Scan all images on page
  function scanAllImages() {
    if (!CONFIG.enabled || CONFIG.sensitivity === 0) return;
    
    const images = document.querySelectorAll('img');
    images.forEach(img => {
      // Handle lazy-loaded images
      if (img.complete && img.naturalWidth > 0) {
        scanImage(img);
      } else {
        img.addEventListener('load', function() {
          scanImage(img);
        }, { once: true });
      }
    });
  }

  // Watch for dynamic content with MutationObserver
  const observer = new MutationObserver(function(mutations) {
    if (!CONFIG.enabled || CONFIG.sensitivity === 0) return;
    
    mutations.forEach(function(mutation) {
      // Check added nodes
      mutation.addedNodes.forEach(function(node) {
        if (node.nodeType !== 1) return;
        
        // Direct image
        if (node.tagName === 'IMG') {
          setTimeout(() => scanImage(node), CONFIG.scanDelay);
        }
        
        // Images inside added node
        if (node.querySelectorAll) {
          const images = node.querySelectorAll('img');
          images.forEach(img => {
            setTimeout(() => scanImage(img), CONFIG.scanDelay);
          });
        }
      });
      
      // Check for src changes
      if (mutation.type === 'attributes' && mutation.attributeName === 'src') {
        const target = mutation.target;
        if (target.tagName === 'IMG') {
          target.dataset.gcScanned = 'false';
          setTimeout(() => scanImage(target), CONFIG.scanDelay);
        }
      }
    });
  });

  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset'],
  });

  // Initial scan
  if (document.readyState === 'complete') {
    scanAllImages();
  } else {
    window.addEventListener('load', scanAllImages);
  }

  // Also scan after a delay for lazy-loaded content
  setTimeout(scanAllImages, 1000);
  setTimeout(scanAllImages, 3000);

  // Handle infinite scroll patterns
  let scrollTimer;
  window.addEventListener('scroll', function() {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(scanAllImages, 500);
  }, { passive: true });

  log('Moderation script initialized', CONFIG);

  // Expose API for debugging
  window.__GC_MODERATION__ = {
    state: moderationState,
    config: CONFIG,
    scanAll: scanAllImages,
    toggleReveal: toggleReveal,
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
  .gc-blur-wrapper {
    position: relative;
    display: inline-block;
  }
  
  .gc-reveal-btn {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 9999;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: bold;
    backdrop-filter: blur(4px);
    transition: all 0.2s ease;
    white-space: nowrap;
  }
  
  .gc-reveal-btn:hover {
    background: rgba(0, 0, 0, 0.9);
    transform: translate(-50%, -50%) scale(1.05);
  }
  
  .gc-reveal-btn:active {
    transform: translate(-50%, -50%) scale(0.95);
  }
  
  img[data-gc-moderated="blurred"] {
    transition: filter 0.3s ease;
  }
</style>
`;
}
