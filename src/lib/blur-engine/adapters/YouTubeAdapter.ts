const SELECTORS = [
  'ytd-shorts',
  'ytd-reel-video-renderer',
  'ytd-thumbnail',
  '#shorts-player',
  '.shorts-player-container',
  '.shorts-shelf-item',
  '.reel-video-player-container',
];

export function getYouTubeAdapterScript(): string {
  const selectors = JSON.stringify(SELECTORS);
  return `
    ;(function() {
      if (!IS_YOUTUBE) return;

      const SELECTORS = ${selectors};
      const THROTTLE_MS = 250;
      const IMAGE_VIDEO_SELECTOR = 'img, video';
      const REPOSITION_DEBOUNCE_MS = 150;

      const queued = new Set();
      let flushTimer = null;
      let lastFlushAt = 0;
      let repositionTimer = null;

      const matchesSelector = (element) => {
        if (!element || element.nodeType !== 1) return false;
        return SELECTORS.some(selector => element.closest(selector));
      };

      const scheduleFlush = () => {
        if (flushTimer) return;
        const now = Date.now();
        const wait = Math.max(0, THROTTLE_MS - (now - lastFlushAt));
        flushTimer = setTimeout(() => {
          flushTimer = null;
          lastFlushAt = Date.now();
          flushQueue();
        }, wait);
      };

      const flushQueue = () => {
        queued.forEach(node => {
          if (!node.isConnected) return;
          if (node.tagName === 'IMG') {
            scanImgElement(node);
          } else if (node.tagName === 'VIDEO') {
            scanVideoPoster(node);
          }
        });
        queued.clear();
        scheduleReposition();
      };

      const handleNode = (node) => {
        if (!(node instanceof Element)) return;
        if (matchesSelector(node)) {
          if (node.tagName === 'IMG' || node.tagName === 'VIDEO') {
            queued.add(node);
          }
        }
        node.querySelectorAll(IMAGE_VIDEO_SELECTOR).forEach(child => {
          if (matchesSelector(child)) {
            queued.add(child);
          }
        });
        if (queued.size > 0) {
          scheduleFlush();
        }
      };

      const escapeAttribute = (value) => {
        if (!value) return null;
        if (window.CSS && typeof CSS.escape === 'function') {
          return CSS.escape(value);
        }
        return String(value).replace(/["\\]/g, '\\$&');
      };

      const findElementBySrc = (src) => {
        const escaped = escapeAttribute(src);
        if (!escaped) return null;
        const selectors = [
          '[data-mw-src="' + escaped + '"]',
          'img[src="' + escaped + '"]',
          'video[src="' + escaped + '"]',
        ];
        for (const selector of selectors) {
          const found = document.querySelector(selector);
          if (found) return found;
        }
        return null;
      };

      const scheduleReposition = () => {
        if (repositionTimer || timerState.paused || timerState.teardownDone) return;
        repositionTimer = setTimeout(() => {
          repositionTimer = null;
          repositionShortsRevealButtons();
        }, REPOSITION_DEBOUNCE_MS);
      };

      const repositionShortsRevealButtons = () => {
        if (timerState.paused || timerState.teardownDone) return;
        document.querySelectorAll('.mw-reveal-overlay').forEach(overlay => {
          if (overlay.dataset.mwAdapterRepositioned === 'true') return;
          const target = overlay.dataset.mwFor;
          const candidate = findElementBySrc(target) || overlay.previousElementSibling;
          const container = candidate?.closest('.reel-video-player-container, .shorts-player-container');
          if (!container) return;
          container.appendChild(overlay);
          overlay.dataset.mwAdapterRepositioned = 'true';
        });
      };

      const observer = new MutationObserver(mutations => {
        if (timerState.paused || timerState.teardownDone) return;
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => handleNode(node));
        });
      });

      const start = () => {
        if (!document.body) {
          document.addEventListener('DOMContentLoaded', start, { once: true });
          return;
        }
        observer.observe(document.body, { childList: true, subtree: true });
        document.querySelectorAll(IMAGE_VIDEO_SELECTOR).forEach(node => {
          handleNode(node);
        });
        scheduleReposition();
      };

      start();
    })();
  `;
}
