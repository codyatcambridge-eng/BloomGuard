import { useState, useCallback, useRef, useEffect } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { InAppBrowser, OpenWebViewOptions, ToolBarType, BackgroundColor } from '@capgo/inappbrowser';

// Page-wide flash guard must remain off; per-element blur handles safety.
const FLASH_GUARD_ENABLED = false;
const FLASH_GUARD_DIAG_VISUAL = false; // Keep DIAG visuals off as a safeguard.
const FLASH_GUARD_DIAG_VISUAL_MS = 1500;
const FLASH_GUARD_PROOF_MS = 2000;

const FLASH_GUARD_SCRIPT = `(() => {
  const HOST_ID = 'mw-shadow-veil-host';
  const BASE_BG = 'transparent';
  const DIAG_ON = ${FLASH_GUARD_DIAG_VISUAL ? 'true' : 'false'};
  const DIAG_MS = ${FLASH_GUARD_DIAG_VISUAL_MS};

  const existed = typeof window.__MW_FLASH_GUARD__ === 'object';
  let api = existed ? window.__MW_FLASH_GUARD__ : null;
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:1;';
    document.documentElement.appendChild(host);
  }

  let shadow = host.shadowRoot || null;
  let veil = (api && api._veil) || null;
  if (!shadow && !veil) {
    try { shadow = host.attachShadow({ mode: 'closed' }); } catch (e) { shadow = null; }
  }
  if (!veil && shadow) {
    veil = document.createElement('div');
    veil.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:' + BASE_BG,
      'backdrop-filter:blur(20px)',
      '-webkit-backdrop-filter:blur(20px)',
      'transition:opacity 120ms ease',
      'opacity:1'
    ].join('!important;') + '!important;';
    shadow.appendChild(veil);
  }

  if (!api || typeof api !== 'object') {
    api = { state: 'on', lastReason: 'boot' } as any;
  }

  api.set = (state, reason) => {
    const on = !!state;
    api.state = on ? 'on' : 'off';
    api.lastReason = reason || 'unknown';
    if (!veil) return;
    veil.style.opacity = on ? '1' : '0';
    veil.style.pointerEvents = on ? 'auto' : 'none';
    host.dataset.reason = api.lastReason;
  };

  api.inspect = () => {
    const cs = veil ? getComputedStyle(veil) : null;
    return {
      present: !!veil,
      display: cs?.display || null,
      opacity: cs?.opacity || null,
      zIndex: cs?.zIndex || null,
      pointerEvents: cs?.pointerEvents || null,
      hostAttached: !!host?.parentElement,
      hostZ: host?.style?.zIndex || null,
      hostOpacity: host?.style?.opacity || null,
      state: api.state,
      lastReason: api.lastReason,
    };
  };

  api._veil = veil;

  if (!api.__handlersAttached) {
    const handler = (event) => {
      const payload = event?.data || event?.detail || {};
      if (!payload || typeof payload !== 'object') return;
      if (payload.type !== 'MW_FLASH_GUARD') return;
      api.set(!!payload.enabled, payload.reason || 'command');
    };
    window.addEventListener('message', handler, true);
    window.addEventListener('messageFromNative', handler as any, true);
    api.__handlersAttached = true;
  }

  if (DIAG_ON && !api.__diagPeeked && veil) {
    api.__diagPeeked = true;
    const diagBg = BASE_BG;
    veil.style.background = diagBg;
    veil.style.opacity = '0.9';
    setTimeout(() => {
      veil.style.background = BASE_BG;
      veil.style.opacity = '1';
      api.__diagPeeked = false;
    }, DIAG_MS);
  }

  window.__MW_FLASH_GUARD__ = api;
  api.set(true, 'boot');

  return JSON.stringify({
    installed: typeof window.__MW_FLASH_GUARD__ === 'object',
    existed,
    guardPresent: !!veil,
    state: api.state,
    snapshot: api.inspect(),
  });
})();`;

const FLASH_GUARD_PROOF_SCRIPT = `(() => {
  const HOST_ID = 'mw-shadow-veil-host';
  const BASE_BG = 'transparent';
  const BLUE_TINT = 'transparent';

  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;opacity:1;';
    document.documentElement.appendChild(host);
  }

  let shadow = host.shadowRoot;
  if (!shadow) {
    try { shadow = host.attachShadow({ mode: 'closed' }); } catch (e) { shadow = null; }
  }

  let veil = shadow ? shadow.firstChild : null;
  if (!veil && shadow) {
    veil = document.createElement('div');
    shadow.appendChild(veil);
  }

  const element = veil instanceof HTMLElement ? veil : null;

  if (element) {
    element.style.cssText = [
      'position:fixed',
      'inset:0',
      'background:' + BLUE_TINT,
      'backdrop-filter:blur(20px)',
      '-webkit-backdrop-filter:blur(20px)',
      'opacity:0.95',
      'visibility:visible',
      'z-index:2147483647',
      'pointer-events:none',
      'transition:none'
    ].join('!important;') + '!important;';

    setTimeout(() => {
      element.style.background = BASE_BG;
      element.style.opacity = '1';
      element.style.visibility = 'visible';
      element.style.zIndex = '2147483647';
      element.style.pointerEvents = 'none';
    }, ${FLASH_GUARD_PROOF_MS});
  }

  const cs = element ? getComputedStyle(element) : null;
  return {
    guardPresent: !!element,
    hostPresent: !!host,
    style: {
      display: cs?.display || null,
      opacity: cs?.opacity || null,
      zIndex: cs?.zIndex || null,
      visibility: cs?.visibility || null,
    },
    documentReadyState: document.readyState,
    locationHref: location.href,
  };
})();`;

const FLASH_GUARD_PROBE_SCRIPT = `(() => {
  const api = window.__MW_FLASH_GUARD__;
  const host = document.getElementById('mw-shadow-veil-host');
  const veil = host?.shadowRoot?.firstChild;
  const cs = veil ? getComputedStyle(veil) : null;
  return {
    existed: !!api,
    guardPresent: !!veil,
    state: api?.state || null,
    lastReason: api?.lastReason || null,
    style: {
      display: cs?.display || null,
      opacity: cs?.opacity || null,
      zIndex: cs?.zIndex || null,
      pointerEvents: cs?.pointerEvents || null,
    },
    host: {
      attached: !!host?.parentElement,
      zIndex: host?.style?.zIndex || null,
      opacity: host?.style?.opacity || null,
    }
  };
})();`;

export type WebViewEvent =
  | 'loadstart'
  | 'loadstop'
  | 'loaderror'
  | 'beforeload'
  | 'message'
  | 'navigation'
  | 'close';

export interface WebViewState {
  isOpen: boolean;
  currentUrl: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string | null;
}

export interface WebViewNavigationEvent {
  url: string;
  type: 'navigation' | 'redirect';
}

export interface UseNativeWebViewOptions {
  onLoadStart?: (url: string) => void;
  onLoadEnd?: (url: string) => void;
  onLoadError?: (url: string, error: string) => void;
  onUrlChange?: (url: string) => void;
  onNavigationRequest?: (url: string) => Promise<boolean> | boolean; // Return false to block navigation
  onClose?: () => void;
  onMessageFromWebview?: (payload: unknown) => void;
  onActiveInstanceIdChange?: (activeInstanceId: number | null) => void;
  getListenerDiagContext?: () => {
    navId?: number | null;
    url?: string;
    activeInstanceId?: number | null;
  };
}

export const useNativeWebView = (options: UseNativeWebViewOptions = {}) => {
  const {
    onLoadStart,
    onLoadEnd,
    onLoadError,
    onUrlChange,
    onNavigationRequest,
    onClose,
    onMessageFromWebview,
    onActiveInstanceIdChange,
    getListenerDiagContext,
  } = options;

  const [state, setState] = useState<WebViewState>({
    isOpen: false,
    currentUrl: '',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
  });

  const isNative = Capacitor.isNativePlatform();
  const historyStackRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const listenersSetupRef = useRef(false);
  const executeChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const executeShapeLogAtRef = useRef(0);
  const executeFallbackLogAtRef = useRef(0);
  const currentUrlRef = useRef('');
  const isOpenRef = useRef(false);
  const instanceSeqRef = useRef(0);
  const activeInstanceIdRef = useRef<number | null>(null);
  const openCountRef = useRef(0);
  const closeCountRef = useRef(0);
  const executeScript60sWindowStartRef = useRef(0);
  const executeScript60sCountRef = useRef(0);
  const flashDiagLogAtRef = useRef(0);
  const listenerAttachSeqRef = useRef(0);
  const listenerHandlesRef = useRef<PluginListenerHandle[]>([]);
  const listenerOwnerRef = useRef<{ navId: number | null; instanceId: number | null }>({
    navId: null,
    instanceId: null,
  });
  const [listenersAttached, setListenersAttached] = useState(false);
  const listenersAttachedRef = useRef(false);
  const onLoadStartRef = useRef(onLoadStart);
  const onLoadEndRef = useRef(onLoadEnd);
  const onLoadErrorRef = useRef(onLoadError);
  const onUrlChangeRef = useRef(onUrlChange);
  const onNavigationRequestRef = useRef(onNavigationRequest);
  const onCloseRef = useRef(onClose);
  const onMessageFromWebviewRef = useRef(onMessageFromWebview);
  const onActiveInstanceIdChangeRef = useRef(onActiveInstanceIdChange);
  const getListenerDiagContextRef = useRef(getListenerDiagContext);
  const pageLoadErrorRecoveryRef = useRef<{ url: string; count: number; at: number }>({
    url: '',
    count: 0,
    at: 0,
  });
  const flashGuardInstalledRef = useRef(false);
  const presentAfterLoadWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PRESENT_AFTER_LOAD_WATCHDOG_MS = 2600;
  const NAVIGATION_GUARD_TIMEOUT_MS = 1500;

  useEffect(() => {
    onLoadStartRef.current = onLoadStart;
    onLoadEndRef.current = onLoadEnd;
    onLoadErrorRef.current = onLoadError;
    onUrlChangeRef.current = onUrlChange;
    onNavigationRequestRef.current = onNavigationRequest;
    onCloseRef.current = onClose;
    onMessageFromWebviewRef.current = onMessageFromWebview;
    onActiveInstanceIdChangeRef.current = onActiveInstanceIdChange;
    getListenerDiagContextRef.current = getListenerDiagContext;
  }, [
    onLoadStart,
    onLoadEnd,
    onLoadError,
    onUrlChange,
    onNavigationRequest,
    onClose,
    onMessageFromWebview,
    onActiveInstanceIdChange,
    getListenerDiagContext,
  ]);

  const clearPresentAfterLoadWatchdog = useCallback(() => {
    if (!presentAfterLoadWatchdogTimerRef.current) return;
    clearTimeout(presentAfterLoadWatchdogTimerRef.current);
    presentAfterLoadWatchdogTimerRef.current = null;
  }, []);

  const ensureBrowserPresented = useCallback(async (reason: string, urlHint?: string): Promise<boolean> => {
    if (!isNative) return false;
    try {
      await InAppBrowser.show();
      console.log(
        '[DIAG][WEBVIEW_PRESENT]',
        'action=show_ok',
        'reason=' + reason,
        'url=' + (urlHint || currentUrlRef.current || 'unknown'),
        'activeInstanceId=' + (activeInstanceIdRef.current ?? 'none'),
      );
      return true;
    } catch (error) {
      console.warn(
        '[DIAG][WEBVIEW_PRESENT]',
        'action=show_failed',
        'reason=' + reason,
        'url=' + (urlHint || currentUrlRef.current || 'unknown'),
        'activeInstanceId=' + (activeInstanceIdRef.current ?? 'none'),
        error,
      );
      return false;
    }
  }, [isNative]);

  const armPresentAfterLoadWatchdog = useCallback((url: string) => {
    clearPresentAfterLoadWatchdog();
    presentAfterLoadWatchdogTimerRef.current = setTimeout(() => {
      if (!isOpenRef.current) return;
      console.warn(
        '[NativeWebView][Lifecycle] present-after-load watchdog fired; forcing show',
        'url=' + url,
        'timeoutMs=' + PRESENT_AFTER_LOAD_WATCHDOG_MS,
      );
      void ensureBrowserPresented('watchdog_timeout', url);
    }, PRESENT_AFTER_LOAD_WATCHDOG_MS);
  }, [clearPresentAfterLoadWatchdog, ensureBrowserPresented]);

  const markClosed = useCallback((reason: string) => {
    clearPresentAfterLoadWatchdog();
    const previousId = activeInstanceIdRef.current;
    if (previousId == null) return;
    closeCountRef.current += 1;
    console.log(
      '[NativeWebView][Lifecycle]',
      'closeCount=' + closeCountRef.current,
      'closedInstanceId=' + previousId,
      'activeInstanceId=none',
      'reason=' + reason,
    );
    activeInstanceIdRef.current = null;
    onActiveInstanceIdChangeRef.current?.(null);
    isOpenRef.current = false;
  }, [clearPresentAfterLoadWatchdog]);

  const readListenerDiagContext = useCallback(() => {
    const context = getListenerDiagContextRef.current?.();
    const navId = context && typeof context.navId === 'number' && Number.isFinite(context.navId)
      ? context.navId
      : null;
    const hostInstanceId = context && typeof context.activeInstanceId === 'number' && Number.isFinite(context.activeInstanceId)
      ? context.activeInstanceId
      : null;
    const url =
      (context && typeof context.url === 'string' && context.url) ||
      currentUrlRef.current ||
      'unknown';
    const hookInstanceId = activeInstanceIdRef.current;
    const instanceId = hookInstanceId ?? hostInstanceId;
    return {
      navId,
      url,
      activeInstanceId: instanceId,
      hookActiveInstanceId: hookInstanceId,
      browserActiveInstanceId: hostInstanceId,
    };
  }, []);

  const setListenersAttachedState = useCallback((attached: boolean) => {
    if (listenersAttachedRef.current === attached) return;
    listenersAttachedRef.current = attached;
    setListenersAttached(attached);
  }, []);

  const logChurnDiag = useCallback((
    action: string,
    reason: string,
    stackTag: string,
    listenerKey?: string,
  ) => {
    const context = readListenerDiagContext();
    console.log(
      '[DIAG][CHURN]',
      'action=' + action,
      'reason=' + reason,
      'stack=' + stackTag,
      'listenerKey=' + (listenerKey || 'none'),
      'navId=' + (context.navId ?? 'unknown'),
      'url=' + context.url,
      'activeInstanceId=' + (context.activeInstanceId ?? 'none'),
      'hookActiveInstanceId=' + (context.hookActiveInstanceId ?? 'none'),
      'browserActiveInstanceId=' + (context.browserActiveInstanceId ?? 'none'),
    );
  }, [readListenerDiagContext]);

  const flashDiagLog = useCallback((...args: unknown[]) => {
    const now = Date.now();
    if (now - flashDiagLogAtRef.current < 250) return;
    flashDiagLogAtRef.current = now;
    console.log('[FlashShield][DIAG]', ...args);
  }, []);

  const runFlashGuardDiagProof = useCallback(
    async (tag: string) => {
      if (!FLASH_GUARD_ENABLED) return null;
      if (!isNative || !isOpenRef.current) {
        flashDiagLog('proof skipped', tag, 'native=', isNative, 'open=', isOpenRef.current);
        return null;
      }
      try {
        const proof = await InAppBrowser.executeScript({ code: FLASH_GUARD_PROOF_SCRIPT });
        const payload =
          typeof proof === 'string'
            ? proof
            : (proof as { result?: unknown; data?: unknown }).result ??
              (proof as { result?: unknown; data?: unknown }).data;
        let parsed: unknown = payload;
        if (typeof payload === 'string') {
          try {
            parsed = JSON.parse(payload);
          } catch {
            parsed = { raw: payload };
          }
        }
        flashDiagLog('proof', tag, parsed);
        return parsed as Record<string, unknown>;
      } catch (error) {
        console.debug('[FlashShield][DIAG] proof failed', tag, error);
        return null;
      }
    },
    [isNative, flashDiagLog],
  );

  const installFlashGuard = useCallback(async (): Promise<boolean> => {
    if (!FLASH_GUARD_ENABLED) {
      flashGuardInstalledRef.current = false;
      return false;
    }
    // Re-install on every navigation because document reloads drop the injected guard.
    if (!isNative || !isOpenRef.current) {
      flashDiagLog('install skipped: native=', isNative, 'open=', isOpenRef.current);
      return false;
    }
    try {
      flashDiagLog('install: begin probe');
      const installResult = await InAppBrowser.executeScript({ code: FLASH_GUARD_SCRIPT });
      const payload =
        typeof installResult === 'string'
          ? installResult
          : (installResult as { result?: unknown; data?: unknown }).result ??
            (installResult as { result?: unknown; data?: unknown }).data;
      let parsed: { installed?: boolean; existed?: boolean; guardPresent?: boolean; state?: string } = {};
      if (typeof payload === 'string') {
        try {
          parsed = JSON.parse(payload);
        } catch {
          parsed = {};
        }
      } else if (payload && typeof payload === 'object') {
        parsed = payload as typeof parsed;
      }
      flashGuardInstalledRef.current = !!parsed.installed || !!parsed.guardPresent;
      flashDiagLog('install: result', {
        installed: parsed.installed ?? false,
        existed: parsed.existed ?? false,
        guardPresent: parsed.guardPresent ?? false,
        state: parsed.state ?? null,
      });
      return flashGuardInstalledRef.current;
    } catch (error) {
      console.debug('[FlashShield][DIAG] install failed', error);
      flashGuardInstalledRef.current = false;
      return false;
    }
  }, [isNative, flashDiagLog]);

  const probeFlashGuard = useCallback(
    async (tag: string) => {
      if (!FLASH_GUARD_ENABLED) return null;
      if (!isNative || !isOpenRef.current) {
        flashDiagLog('probe skipped', tag, 'native=', isNative, 'open=', isOpenRef.current);
        return null;
      }
      try {
        const probe = await InAppBrowser.executeScript({ code: FLASH_GUARD_PROBE_SCRIPT });
        const payload =
          typeof probe === 'string'
            ? probe
            : (probe as { result?: unknown; data?: unknown }).result ??
              (probe as { result?: unknown; data?: unknown }).data;
        let parsed: unknown = payload;
        if (typeof payload === 'string') {
          try {
            parsed = JSON.parse(payload);
          } catch {
            parsed = { raw: payload };
          }
        }
        flashDiagLog('probe', tag, parsed);
        return parsed as Record<string, unknown>;
      } catch (error) {
        console.debug('[FlashShield][DIAG] probe failed', tag, error);
        return null;
      }
    },
    [isNative, flashDiagLog],
  );

  const setFlashGuardState = useCallback(
    async (enabled: boolean, reason: string) => {
      if (!FLASH_GUARD_ENABLED) return;
      if (!isNative || !isOpenRef.current) {
        flashDiagLog('toggle skipped', reason, 'native=', isNative, 'open=', isOpenRef.current);
        return;
      }
      const ensured = await installFlashGuard();
      if (!ensured) {
        flashDiagLog('toggle skipped: install failed', reason);
        return;
      }
      const safeReason = reason.replace(/'/g, "\\'");
      const code = `(() => {\n        const api = window.__MW_FLASH_GUARD__;\n        const host = document.getElementById('mw-shadow-veil-host');\n        const veil = host?.shadowRoot?.firstChild;\n        if (!api) return { ok: false, reason: 'no_api' };\n        api.set(${enabled ? 'true' : 'false'}, '${safeReason}');\n        const cs = veil ? getComputedStyle(veil) : null;\n        return {\n          ok: true,\n          state: api.state,\n          lastReason: api.lastReason,\n          guardPresent: !!veil,\n          style: {\n            display: cs?.display || null,\n            opacity: cs?.opacity || null,\n            zIndex: cs?.zIndex || null,\n            pointerEvents: cs?.pointerEvents || null,\n          }\n        };\n      })();`;
      try {
        const toggleResult = await InAppBrowser.executeScript({ code });
        const payload =
          typeof toggleResult === 'string'
            ? toggleResult
            : (toggleResult as { result?: unknown; data?: unknown }).result ??
              (toggleResult as { result?: unknown; data?: unknown }).data;
        let parsed: unknown = payload;
        if (typeof payload === 'string') {
          try {
            parsed = JSON.parse(payload);
          } catch {
            parsed = { raw: payload };
          }
        }
        flashDiagLog('toggle', enabled ? 'on' : 'off', reason, parsed);
        if (reason?.toLowerCase().includes('manual')) {
          void runFlashGuardDiagProof('manual_toggle');
        }
      } catch (error) {
        console.debug('[FlashShield][DIAG] FlashGuard toggle failed', reason, error);
      }
    },
    [isNative, installFlashGuard, flashDiagLog, runFlashGuardDiagProof],
  );

  // Set up event listeners
  useEffect(() => {
    if (!isNative || listenersSetupRef.current) return;
    listenersSetupRef.current = true;
    let disposed = false;
    listenerHandlesRef.current = [];

    const addListener = InAppBrowser.addListener as unknown as (
      eventName: string,
      listener: (event: unknown) => void,
    ) => Promise<PluginListenerHandle>;

    const attachListener = async (
      eventName: string,
      listener: (event: unknown) => void,
      stackTag: string,
    ) => {
      const listenerKey = eventName + ':' + (++listenerAttachSeqRef.current);
      logChurnDiag('addListener_call', 'setup', stackTag, listenerKey);
      try {
        const handle = await addListener(eventName, listener);
        if (disposed) {
          await handle.remove().catch(() => undefined);
          logChurnDiag('addListener_disposed', 'setup_disposed', stackTag, listenerKey);
          return;
        }
        listenerHandlesRef.current.push(handle);
        logChurnDiag('addListener_attached', 'setup_complete', stackTag, listenerKey);
      } catch (error) {
        console.error('[NativeWebView] Failed to add listener:', eventName, error);
        logChurnDiag('addListener_failed', 'setup_error', stackTag, listenerKey);
      }
    };

    const attachAllListeners = async () => {
      logChurnDiag('attach_begin', 'setup_start', 'useNativeWebView.listeners.setup');

      await attachListener('urlChangeEvent', (event) => {
        const payload = event as { url?: string };
        const url = payload.url || '';
        console.log('[NativeWebView] URL changed:', url);
        currentUrlRef.current = url;
        onUrlChangeRef.current?.(url);

        const context = readListenerDiagContext();
        listenerOwnerRef.current = {
          navId: context.navId,
          instanceId: context.activeInstanceId,
        };
        logChurnDiag('urlChangeEvent', 'event_received', 'useNativeWebView.listeners.urlChangeEvent');

        setState(prev => ({ ...prev, currentUrl: url }));

        // Update history
        if (historyIndexRef.current === historyStackRef.current.length - 1) {
          historyStackRef.current.push(url);
          historyIndexRef.current++;
        } else {
          // User navigated from middle of history
          historyStackRef.current = historyStackRef.current.slice(0, historyIndexRef.current + 1);
          historyStackRef.current.push(url);
          historyIndexRef.current = historyStackRef.current.length - 1;
        }

        // Update navigation state
        setState(prev => ({
          ...prev,
          canGoBack: historyIndexRef.current > 0,
          canGoForward: historyIndexRef.current < historyStackRef.current.length - 1,
        }));

        if (FLASH_GUARD_ENABLED) {
          void probeFlashGuard('url_change');
          void installFlashGuard().then((installed) => {
            flashDiagLog('url_change install complete', installed);
            void probeFlashGuard('url_change_post_install');
          });
          void runFlashGuardDiagProof('url_change_force');
        }
      }, 'useNativeWebView.listeners.urlChangeEvent');

      await attachListener('browserPageLoaded', () => {
        console.log('[NativeWebView] Page loaded');
        void ensureBrowserPresented('browserPageLoaded', currentUrlRef.current || pageLoadErrorRecoveryRef.current.url);
        clearPresentAfterLoadWatchdog();
        pageLoadErrorRecoveryRef.current = {
          url: currentUrlRef.current || pageLoadErrorRecoveryRef.current.url,
          count: 0,
          at: Date.now(),
        };
        setState(prev => ({ ...prev, isLoading: false, error: null }));
        if (FLASH_GUARD_ENABLED) {
          void (async () => {
            await probeFlashGuard('load_end_pre_toggle');
            await setFlashGuardState(false, 'load_end');
            await probeFlashGuard('load_end_post_toggle');
          })();
        }
        if (currentUrlRef.current) {
          onLoadEndRef.current?.(currentUrlRef.current);
        }
      }, 'useNativeWebView.listeners.browserPageLoaded');

      await attachListener('pageLoadError', () => {
        clearPresentAfterLoadWatchdog();
        const failedUrl = currentUrlRef.current || '';
        const now = Date.now();
        const previous = pageLoadErrorRecoveryRef.current;
        const isSameBurst = previous.url === failedUrl && (now - previous.at) < 15000;
        const attempts = isSameBurst ? previous.count : 0;
        if (attempts < 1 && isOpenRef.current) {
          pageLoadErrorRecoveryRef.current = {
            url: failedUrl,
            count: attempts + 1,
            at: now,
          };
          void InAppBrowser.reload()
            .then(() => {
              setState(prev => ({ ...prev, isLoading: true, error: null }));
              void setFlashGuardState(true, 'reload_after_error');
            })
            .catch(() => {
              setState(prev => ({ ...prev, isLoading: false, error: 'pageLoadError' }));
              onLoadErrorRef.current?.(failedUrl, 'pageLoadError');
            });
          return;
        }

        pageLoadErrorRecoveryRef.current = {
          url: failedUrl,
          count: attempts,
          at: now,
        };
        setState(prev => ({ ...prev, isLoading: false, error: 'pageLoadError' }));
        onLoadErrorRef.current?.(failedUrl, 'pageLoadError');
      }, 'useNativeWebView.listeners.pageLoadError');

      await attachListener('closeEvent', () => {
        console.log('[NativeWebView] Browser closed');
        clearPresentAfterLoadWatchdog();
        markClosed('closeEvent');
        flashGuardInstalledRef.current = false;
        setState(prev => ({ ...prev, isOpen: false }));
        onCloseRef.current?.();
      }, 'useNativeWebView.listeners.closeEvent');

      await attachListener('messageFromWebview', (event) => {
        const payload = (
          event &&
          typeof event === 'object' &&
          'detail' in event &&
          (event as { detail?: unknown }).detail !== undefined
        )
          ? (event as { detail?: unknown }).detail
          : event;
        onMessageFromWebviewRef.current?.(payload);
      }, 'useNativeWebView.listeners.messageFromWebview');

      if (disposed) return;
      setListenersAttachedState(true);
      const context = readListenerDiagContext();
      listenerOwnerRef.current = {
        navId: context.navId,
        instanceId: context.activeInstanceId,
      };
      logChurnDiag('attach_complete', 'all_listeners_attached', 'useNativeWebView.listeners.setup');
    };

    void attachAllListeners();

    return () => {
      disposed = true;
      setListenersAttachedState(false);
      const stackTag = 'useNativeWebView.listeners.cleanup';
      const handles = listenerHandlesRef.current;
      listenerHandlesRef.current = [];
      handles.forEach((handle) => {
        void handle.remove().catch(() => undefined);
      });
      const context = readListenerDiagContext();
      const owner = listenerOwnerRef.current;
      logChurnDiag('cleanup', 'cleanup_begin', stackTag);
      const sameNav = owner.navId !== null && context.navId !== null && owner.navId === context.navId;
      const sameInstance =
        owner.instanceId !== null &&
        context.activeInstanceId !== null &&
        owner.instanceId === context.activeInstanceId;
      console.log(
        '[DIAG][CHURN]',
        'action=cleanup_owner_check',
        'reason=before_removeAllListeners',
        'stack=' + stackTag,
        'ownerNavId=' + (owner.navId ?? 'none'),
        'ownerActiveInstanceId=' + (owner.instanceId ?? 'none'),
        'contextNavId=' + (context.navId ?? 'none'),
        'contextActiveInstanceId=' + (context.activeInstanceId ?? 'none'),
        'isOpen=' + isOpenRef.current,
      );
      if (sameNav && sameInstance) {
        logChurnDiag('removeAllListeners_call', 'cleanup_same_owner', stackTag);
        InAppBrowser.removeAllListeners();
      } else {
        logChurnDiag('removeAllListeners_skip', 'cleanup_owner_mismatch', stackTag);
      }
      listenersSetupRef.current = false;
    };
  }, [
    isNative,
    markClosed,
    clearPresentAfterLoadWatchdog,
    setFlashGuardState,
    probeFlashGuard,
    installFlashGuard,
    runFlashGuardDiagProof,
    flashDiagLog,
    ensureBrowserPresented,
    setListenersAttachedState,
    readListenerDiagContext,
    logChurnDiag,
  ]);

  // Open URL in native WebView
  const open = useCallback(async (url: string, inApp: boolean = true) => {
    if (!isNative) {
      console.log('[NativeWebView] Not running natively, falling back to window.open');
      window.open(url, '_blank');
      return false;
    }

    // Check if navigation should be blocked
    if (onNavigationRequestRef.current) {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      const timeoutGuard = new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(
            '[NativeWebView][Lifecycle] navigation guard timed out; continuing fail-open',
            'url=' + url,
            'timeoutMs=' + NAVIGATION_GUARD_TIMEOUT_MS,
          );
          resolve(true);
        }, NAVIGATION_GUARD_TIMEOUT_MS);
      });
      const navigationGuard = Promise.resolve(onNavigationRequestRef.current(url))
        .then((result) => result !== false)
        .catch((error) => {
          console.warn('[NativeWebView][Lifecycle] navigation guard error; continuing fail-open', error);
          return true;
        });
      const allowed = await Promise.race([navigationGuard, timeoutGuard]);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (!allowed) {
        console.log('[NativeWebView] Navigation blocked by handler:', url);
        return false;
      }
    }

    if (isOpenRef.current) {
      console.log('[NativeWebView][Lifecycle] open requested while active; closing existing instance first');
      clearPresentAfterLoadWatchdog();
      try {
        await InAppBrowser.close();
      } catch {
        // Ignore close race while reopening.
      }
      markClosed('reopen_before_open');
      setState(prev => ({ ...prev, isOpen: false }));
      flashGuardInstalledRef.current = false;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));
    onLoadStartRef.current?.(url);
    pageLoadErrorRecoveryRef.current = { url, count: 0, at: Date.now() };
    void setFlashGuardState(true, 'nav_start');

    try {
      const options: OpenWebViewOptions = {
        url,
        // Present immediately for reliability; waiting for page load can leave the browser hidden.
        isPresentAfterPageLoad: false,
        preventDeeplink: false,
        closeModal: true,
        closeModalTitle: 'Close',
        closeModalDescription: 'Return to GoodCreation Browser?',
        closeModalOk: 'Close',
        closeModalCancel: 'Cancel',
        toolbarType: inApp ? ToolBarType.NAVIGATION : ToolBarType.BLANK,
        toolbarColor: '#0f1419',
        backgroundColor: BackgroundColor.WHITE,
        visibleTitle: true,
        showArrow: true,
        showReloadButton: true,
      };

      await InAppBrowser.openWebView(options);
      await ensureBrowserPresented('open_success', url);
      await installFlashGuard();

      historyStackRef.current = [url];
      historyIndexRef.current = 0;

      setState(prev => ({
        ...prev,
        isOpen: true,
        currentUrl: url,
        canGoBack: false,
        canGoForward: false,
      }));
      currentUrlRef.current = url;
      isOpenRef.current = true;
      const instanceId = ++instanceSeqRef.current;
      activeInstanceIdRef.current = instanceId;
      onActiveInstanceIdChangeRef.current?.(instanceId);
      const context = readListenerDiagContext();
      listenerOwnerRef.current = {
        navId: context.navId,
        instanceId,
      };
      openCountRef.current += 1;
      executeScript60sWindowStartRef.current = Date.now();
      executeScript60sCountRef.current = 0;
      console.log(
        '[NativeWebView][Lifecycle]',
        'openCount=' + openCountRef.current,
        'closeCount=' + closeCountRef.current,
        'activeInstanceId=' + instanceId,
        'url=' + url,
      );
      logChurnDiag('open', 'open_success', 'useNativeWebView.open');
      armPresentAfterLoadWatchdog(url);

      return true;
    } catch (error) {
      clearPresentAfterLoadWatchdog();
      const errorMsg = error instanceof Error ? error.message : 'Failed to open WebView';
      console.error('[NativeWebView] Open error:', error);
      setState(prev => ({ ...prev, isLoading: false, error: errorMsg }));
      onLoadErrorRef.current?.(url, errorMsg);
      return false;
    }
  }, [isNative, installFlashGuard, markClosed, setFlashGuardState, readListenerDiagContext, logChurnDiag, armPresentAfterLoadWatchdog, clearPresentAfterLoadWatchdog, ensureBrowserPresented]);

  // Close the WebView
  const close = useCallback(async () => {
    if (!isNative) return;

    try {
      clearPresentAfterLoadWatchdog();
      await InAppBrowser.close();
      markClosed('close()');
      flashGuardInstalledRef.current = false;
      setState(prev => ({ ...prev, isOpen: false }));
      historyStackRef.current = [];
      historyIndexRef.current = -1;
    } catch (error) {
      console.error('[NativeWebView] Close error:', error);
    }
  }, [isNative, markClosed, clearPresentAfterLoadWatchdog]);

  useEffect(() => {
    return () => {
      clearPresentAfterLoadWatchdog();
      if (!isNative || !isOpenRef.current) return;
      InAppBrowser.close()
        .catch(() => undefined)
        .finally(() => markClosed('hook_unmount'));
    };
  }, [isNative, markClosed, clearPresentAfterLoadWatchdog]);

  // Navigate back in WebView history
  const goBack = useCallback(async () => {
    if (!isNative || historyIndexRef.current <= 0) return false;

    try {
      historyIndexRef.current--;
      const prevUrl = historyStackRef.current[historyIndexRef.current];

      if (prevUrl) {
        await InAppBrowser.setUrl({ url: prevUrl });
        setState(prev => ({
          ...prev,
          currentUrl: prevUrl,
          canGoBack: historyIndexRef.current > 0,
          canGoForward: historyIndexRef.current < historyStackRef.current.length - 1,
        }));
        return true;
      }
    } catch (error) {
      console.error('[NativeWebView] GoBack error:', error);
    }
    return false;
  }, [isNative]);

  // Navigate forward in WebView history
  const goForward = useCallback(async () => {
    if (!isNative || historyIndexRef.current >= historyStackRef.current.length - 1) return false;

    try {
      historyIndexRef.current++;
      const nextUrl = historyStackRef.current[historyIndexRef.current];

      if (nextUrl) {
        await InAppBrowser.setUrl({ url: nextUrl });
        setState(prev => ({
          ...prev,
          currentUrl: nextUrl,
          canGoBack: historyIndexRef.current > 0,
          canGoForward: historyIndexRef.current < historyStackRef.current.length - 1,
        }));
        return true;
      }
    } catch (error) {
      console.error('[NativeWebView] GoForward error:', error);
    }
    return false;
  }, [isNative]);

  // Reload current page
  const reload = useCallback(async () => {
    if (!isNative || !state.currentUrl) return;

    try {
      await InAppBrowser.reload();
      setState(prev => ({ ...prev, isLoading: true }));
      void setFlashGuardState(true, 'manual_reload');
    } catch (error) {
      console.error('[NativeWebView] Reload error:', error);
    }
  }, [isNative, state.currentUrl, setFlashGuardState]);

  // Set URL without full navigation (for redirects)
  const setUrl = useCallback(async (url: string) => {
    if (!isNative) return;

    try {
      await InAppBrowser.setUrl({ url });
      setState(prev => ({ ...prev, currentUrl: url, isLoading: true }));
      void setFlashGuardState(true, 'set_url');
    } catch (error) {
      console.error('[NativeWebView] SetUrl error:', error);
    }
  }, [isNative, setFlashGuardState]);

  const postMessageToWebView = useCallback(async (detail: Record<string, unknown>): Promise<boolean> => {
    if (!isNative) return false;
    try {
      await InAppBrowser.postMessage({ detail });
      return true;
    } catch (error) {
      console.error('[NativeWebView] postMessage error:', error);
      return false;
    }
  }, [isNative]);

  // Execute JavaScript in the WebView
  const executeScript = useCallback(async (script: string): Promise<string | null> => {
    if (!isNative) return null;

    const run = async (): Promise<string | null> => {
      try {
        const now = Date.now();
        if (executeScript60sWindowStartRef.current === 0) {
          executeScript60sWindowStartRef.current = now;
        }
        executeScript60sCountRef.current += 1;
        const elapsed = now - executeScript60sWindowStartRef.current;
        if (elapsed >= 60000) {
          console.log(
            '[NativeWebView][Metrics]',
            'executeScript60sCount=' + executeScript60sCountRef.current,
            'activeInstanceId=' + (activeInstanceIdRef.current ?? 'none'),
            'url=' + (currentUrlRef.current || 'unknown'),
          );
          executeScript60sWindowStartRef.current = now;
          executeScript60sCountRef.current = 0;
        }

        const raw = await InAppBrowser.executeScript({ code: script }) as unknown;
        if (typeof raw === 'string') return raw;
        if (raw && typeof raw === 'object') {
          const obj = raw as { result?: unknown; data?: unknown };
          if (typeof obj.result === 'string') return obj.result;
          if (typeof obj.data === 'string') return obj.data;

          const now = Date.now();
          if (now - executeFallbackLogAtRef.current > 5000) {
            executeFallbackLogAtRef.current = now;
            console.debug('[NativeWebView][ExecuteScript] fallback_return executed');
          }
          if (now - executeShapeLogAtRef.current > 5000) {
            executeShapeLogAtRef.current = now;
            console.debug(
              '[NativeWebView] ExecuteScript non-string payload shape',
              'type=' + typeof raw,
              'keys=' + Object.keys(obj).slice(0, 6).join(','),
            );
          }
          return 'executed';
        }
        return null;
      } catch (error) {
        console.error('[NativeWebView] ExecuteScript error:', error);
        return null;
      }
    };

    // Serialize bridge evaluations so WebView executeScript calls never overlap.
    const next = executeChainRef.current.then(run, run);
    executeChainRef.current = next.then(() => undefined, () => undefined);
    return next;
  }, [isNative]);

  return {
    isNative,
    state,
    listenersAttached,
    open,
    close,
    goBack,
    goForward,
    reload,
    setUrl,
    postMessageToWebView,
    executeScript,
    setFlashGuardState,
  };
};
