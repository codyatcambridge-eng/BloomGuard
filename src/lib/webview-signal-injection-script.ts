export interface SignalInjectionConfig {
  sensitivity: number;
  enabled: boolean;
  debug?: boolean;
  nonce: string;
}

function getSignalThresholds(dialLevel: number): { porn: number; sexy: number; hentai: number } {
  switch (dialLevel) {
    case 0: return { porn: 1.1, sexy: 1.1, hentai: 1.1 };
    case 1: return { porn: 0.7, sexy: 0.85, hentai: 0.7 };
    case 2: return { porn: 0.5, sexy: 0.65, hentai: 0.5 };
    case 3: return { porn: 0.3, sexy: 0.45, hentai: 0.3 };
    case 4: return { porn: 0.15, sexy: 0.25, hentai: 0.15 };
    default: return { porn: 0.3, sexy: 0.45, hentai: 0.3 };
  }
}

export function generateModerationSignalScript(config: SignalInjectionConfig): string {
  const nonce = config.nonce || `n_${Math.random().toString(36).slice(2, 10)}`;
  const thresholds = getSignalThresholds(config.sensitivity);

  return `
(function() {
  'use strict';

  var ENABLED = ${config.enabled};
  var DEBUG = ${config.debug ? 'true' : 'false'};
  var NONCE = '${nonce}';
  var THRESHOLDS = ${JSON.stringify(thresholds)};
  var SCAN_INTERVAL_MS = 1200;
  var MIN_DIMENSION = 50;
  var NAV_ID = (window.__MW_NAV_ID__ || ('mw_sig_' + Date.now().toString(36)));
  var PAGE_URL = (window.location && window.location.href) ? window.location.href : 'unknown';
  var state = window.__MW_SIGNAL_STATE__;

  if (!state) {
    state = {
      seen: new Set(),
      queue: [],
      flushTimer: null,
      scanTimer: null,
      scheduled: false
    };
    window.__MW_SIGNAL_STATE__ = state;
  }

  function nowTs() { return Date.now(); }
  function requestId() { return 'r_' + Math.random().toString(36).slice(2, 9) + '_' + nowTs().toString(36); }
  function itemId() { return 'i_' + Math.random().toString(36).slice(2, 9); }

  function log() {
    if (!DEBUG) return;
    try { console.log.apply(console, arguments); } catch (e) {}
  }

  function logTimer(action, name) {
    log('[MW-Signal][Timer]', action, name, 'navId=' + NAV_ID, 'url=' + PAGE_URL);
  }

  function postToHost(message) {
    try { window.postMessage(message, '*'); } catch (e) {}
    try { if (window.parent && window.parent !== window) window.parent.postMessage(message, '*'); } catch (e) {}
  }

  function ensureLegacyQueue(item) {
    try {
      if (!window.__GC_SCAN_QUEUE__) window.__GC_SCAN_QUEUE__ = [];
      window.__GC_SCAN_QUEUE__.push({
        src: item.src,
        thresholds: THRESHOLDS,
        itemId: item.itemId,
        sourceType: item.sourceType
      });
    } catch (e) {}
  }

  function resolveSrc(img) {
    return img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
  }

  function enqueueImage(img) {
    if (!ENABLED || !img) return;
    var src = resolveSrc(img);
    if (!src) return;
    if (src.indexOf('data:') === 0 && src.length < 512) return;
    if (state.seen.has(src)) return;

    var w = img.naturalWidth || img.width || 0;
    var h = img.naturalHeight || img.height || 0;
    if (w > 0 && h > 0 && (w < MIN_DIMENSION || h < MIN_DIMENSION)) return;

    state.seen.add(src);
    state.queue.push({
      itemId: itemId(),
      src: src,
      sourceType: 'img',
      width: w,
      height: h
    });
  }

  function flushQueue() {
    state.flushTimer = null;
    if (!ENABLED || state.queue.length === 0) return;

    var items = state.queue.splice(0, 10);
    var msg = {
      type: 'gc-moderation-request',
      requestId: requestId(),
      items: items,
      thresholds: THRESHOLDS,
      nonce: NONCE,
      timestamp: nowTs()
    };
    postToHost(msg);
    for (var i = 0; i < items.length; i += 1) {
      ensureLegacyQueue(items[i]);
    }
    log('[MW-Signal] posted request', msg.requestId, 'items=' + items.length);
  }

  function scheduleFlush() {
    if (state.flushTimer) return;
    state.flushTimer = setTimeout(flushQueue, 80);
  }

  function collectImages() {
    if (!ENABLED) return;
    var images = document.querySelectorAll('img');
    for (var i = 0; i < images.length; i += 1) {
      enqueueImage(images[i]);
    }
    if (state.queue.length > 0) {
      scheduleFlush();
    }
  }

  function scheduleCollect() {
    if (state.scheduled) return;
    state.scheduled = true;
    var t = setTimeout(function() {
      state.scheduled = false;
      collectImages();
    }, 120);
    state.collectTimer = t;
  }

  function stopScanTimer(reason) {
    if (state.scanTimer) {
      clearInterval(state.scanTimer);
      state.scanTimer = null;
      logTimer('stop', 'scanTimer:' + reason);
    }
  }

  function startScanTimer(reason) {
    if (state.scanTimer || !ENABLED || document.visibilityState !== 'visible') return;
    state.scanTimer = setInterval(collectImages, SCAN_INTERVAL_MS);
    logTimer('start', 'scanTimer:' + reason);
  }

  function teardown(reason) {
    stopScanTimer(reason || 'teardown');
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
      logTimer('stop', 'flushTimer:' + (reason || 'teardown'));
    }
    if (state.collectTimer) {
      clearTimeout(state.collectTimer);
      state.collectTimer = null;
      logTimer('stop', 'collectTimer:' + (reason || 'teardown'));
    }
    window.removeEventListener('scroll', scheduleCollect);
    window.removeEventListener('load', scheduleCollect);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
    window.__MW_SIGNAL_ACTIVE__ = false;
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      startScanTimer('visible');
      scheduleCollect();
      return;
    }
    stopScanTimer('hidden');
  }

  function onBeforeUnload() { teardown('beforeunload'); }
  function onPageHide() { teardown('pagehide'); }

  function install() {
    if (window.__MW_SIGNAL_ACTIVE__) {
      log('[MW-Signal] already installed');
      return;
    }
    window.__MW_SIGNAL_ACTIVE__ = true;

    scheduleCollect();
    startScanTimer('install');
    window.addEventListener('scroll', scheduleCollect, { passive: true });
    window.addEventListener('load', scheduleCollect);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    window.__MW_SIGNAL_TEARDOWN__ = teardown;
    log('[MW-Signal] installed');
  }

  install();
})();
`;
}
