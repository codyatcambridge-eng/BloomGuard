import { useState, useCallback, useRef, useEffect } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { InAppBrowser, OpenWebViewOptions, ToolBarType, BackgroundColor } from '@capgo/inappbrowser';

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
  } = options;
  const onLoadStartRef = useRef(onLoadStart);
  const onLoadEndRef = useRef(onLoadEnd);
  const onLoadErrorRef = useRef(onLoadError);
  const onUrlChangeRef = useRef(onUrlChange);
  const onNavigationRequestRef = useRef(onNavigationRequest);
  const onCloseRef = useRef(onClose);
  const onMessageFromWebviewRef = useRef(onMessageFromWebview);

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
  const executeScript10sWindowStartRef = useRef(0);
  const executeScript10sCountRef = useRef(0);
  const executeScript10sCallsiteCountsRef = useRef<Record<string, number>>({});
  const executeScript10sPeakRef = useRef(0);
  const executeScript10sAvgSamplesRef = useRef<{ total: number; samples: number }>({ total: 0, samples: 0 });
  const pageLoadErrorRecoveryRef = useRef<{ url: string; count: number; at: number }>({
    url: '',
    count: 0,
    at: 0,
  });

  const markClosed = useCallback((reason: string) => {
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
    isOpenRef.current = false;
  }, []);

  useEffect(() => {
    onLoadStartRef.current = onLoadStart;
    onLoadEndRef.current = onLoadEnd;
    onLoadErrorRef.current = onLoadError;
    onUrlChangeRef.current = onUrlChange;
    onNavigationRequestRef.current = onNavigationRequest;
    onCloseRef.current = onClose;
    onMessageFromWebviewRef.current = onMessageFromWebview;
  }, [onLoadStart, onLoadEnd, onLoadError, onUrlChange, onNavigationRequest, onClose, onMessageFromWebview]);

  // Set up event listeners
  useEffect(() => {
    if (!isNative || listenersSetupRef.current) return;
    listenersSetupRef.current = true;
    const listenerHandles: PluginListenerHandle[] = [];
    let disposed = false;

    const attachListener = async (
      eventName: string,
      handler: (event: Record<string, unknown>) => void,
    ) => {
      try {
        const handle = await InAppBrowser.addListener(eventName, handler);
        if (disposed) {
          await handle.remove();
          return;
        }
        listenerHandles.push(handle);
      } catch (error) {
        console.error('[NativeWebView] Failed to add listener:', eventName, error);
      }
    };

    void attachListener('urlChangeEvent', (event) => {
      const url = String(event.url || '');
      console.log('[NativeWebView] URL changed:', url);
      currentUrlRef.current = url;

      setState(prev => ({ ...prev, currentUrl: url }));
      onUrlChangeRef.current?.(url);

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
    });

    void attachListener('browserPageLoaded', () => {
      console.log('[NativeWebView] Page loaded');
      pageLoadErrorRecoveryRef.current = {
        url: currentUrlRef.current || pageLoadErrorRecoveryRef.current.url,
        count: 0,
        at: Date.now(),
      };
      setState(prev => ({ ...prev, isLoading: false, error: null }));
      if (currentUrlRef.current) {
        onLoadEndRef.current?.(currentUrlRef.current);
      }
    });

    void attachListener('pageLoadError', () => {
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
    });

    void attachListener('closeEvent', () => {
      console.log('[NativeWebView] Browser closed');
      markClosed('closeEvent');
      setState(prev => ({ ...prev, isOpen: false }));
      onCloseRef.current?.();
    });

    void attachListener('messageFromWebview', (event) => {
      const payload = (
        event &&
        typeof event === 'object' &&
        'detail' in event &&
        (event as { detail?: unknown }).detail !== undefined
      )
        ? (event as { detail?: unknown }).detail
        : event;
      onMessageFromWebviewRef.current?.(payload);
    });

    return () => {
      disposed = true;
      for (const handle of listenerHandles) {
        void handle.remove();
      }
      listenersSetupRef.current = false;
    };
  }, [isNative, markClosed]);

  // Open URL in native WebView
  const open = useCallback(async (url: string, inApp: boolean = true) => {
    if (!isNative) {
      console.log('[NativeWebView] Not running natively, falling back to window.open');
      window.open(url, '_blank');
      return false;
    }

    // Check if navigation should be blocked
    if (onNavigationRequestRef.current) {
      const allowed = await Promise.resolve(onNavigationRequestRef.current(url));
      if (!allowed) {
        console.log('[NativeWebView] Navigation blocked by handler:', url);
        return false;
      }
    }

    if (isOpenRef.current) {
      console.log('[NativeWebView][Lifecycle] open requested while active; closing existing instance first');
      try {
        await InAppBrowser.close();
      } catch {
        // Ignore close race while reopening.
      }
      markClosed('reopen_before_open');
      setState(prev => ({ ...prev, isOpen: false }));
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));
    onLoadStartRef.current?.(url);
    pageLoadErrorRecoveryRef.current = { url, count: 0, at: Date.now() };

    try {
      const options: OpenWebViewOptions = {
        url,
        isPresentAfterPageLoad: true,
        preventDeeplink: false,
        closeModal: true,
        closeModalTitle: 'Close',
        closeModalDescription: 'Return to GoodCreation Browser?',
        closeModalOk: 'Close',
        closeModalCancel: 'Cancel',
        toolbarType: inApp ? ToolBarType.NAVIGATION : ToolBarType.BLANK,
        toolbarColor: '#0f1419',
        backgroundColor: BackgroundColor.BLACK,
        visibleTitle: true,
        showArrow: true,
        showReloadButton: true,
      };

      await InAppBrowser.openWebView(options);
      
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
      openCountRef.current += 1;
      executeScript60sWindowStartRef.current = Date.now();
      executeScript60sCountRef.current = 0;
      executeScript10sWindowStartRef.current = Date.now();
      executeScript10sCountRef.current = 0;
      executeScript10sCallsiteCountsRef.current = {};
      executeScript10sPeakRef.current = 0;
      executeScript10sAvgSamplesRef.current = { total: 0, samples: 0 };
      console.log(
        '[NativeWebView][Lifecycle]',
        'openCount=' + openCountRef.current,
        'closeCount=' + closeCountRef.current,
        'activeInstanceId=' + instanceId,
        'url=' + url,
      );
      
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to open WebView';
      console.error('[NativeWebView] Open error:', error);
      setState(prev => ({ ...prev, isLoading: false, error: errorMsg }));
      onLoadErrorRef.current?.(url, errorMsg);
      return false;
    }
  }, [isNative, markClosed]);

  // Close the WebView
  const close = useCallback(async () => {
    if (!isNative) return;
    
    try {
      await InAppBrowser.close();
      markClosed('close()');
      setState(prev => ({ ...prev, isOpen: false }));
      historyStackRef.current = [];
      historyIndexRef.current = -1;
    } catch (error) {
      console.error('[NativeWebView] Close error:', error);
    }
  }, [isNative, markClosed]);

  useEffect(() => {
    return () => {
      if (!isNative || !isOpenRef.current) return;
      InAppBrowser.close()
        .catch(() => undefined)
        .finally(() => markClosed('hook_unmount'));
    };
  }, [isNative, markClosed]);

  // Navigate back in WebView history
  const goBack = useCallback(async () => {
    if (!isNative || historyIndexRef.current <= 0) return false;
    
    try {
      // InAppBrowser doesn't expose back/forward directly
      // We track history and reload the previous URL
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
    } catch (error) {
      console.error('[NativeWebView] Reload error:', error);
    }
  }, [isNative, state.currentUrl]);

  // Set URL without full navigation (for redirects)
  const setUrl = useCallback(async (url: string) => {
    if (!isNative) return;
    
    try {
      await InAppBrowser.setUrl({ url });
      setState(prev => ({ ...prev, currentUrl: url, isLoading: true }));
    } catch (error) {
      console.error('[NativeWebView] SetUrl error:', error);
    }
  }, [isNative]);

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
  const executeScript = useCallback(async (
    script: string,
    callsiteTag: string = 'unknown',
  ): Promise<string | null> => {
    if (!isNative) return null;

    const run = async (): Promise<string | null> => {
      try {
        const callsite = String(callsiteTag || 'unknown');
        const now = Date.now();
        if (executeScript60sWindowStartRef.current === 0) {
          executeScript60sWindowStartRef.current = now;
        }
        if (executeScript10sWindowStartRef.current === 0) {
          executeScript10sWindowStartRef.current = now;
        }
        executeScript60sCountRef.current += 1;
        executeScript10sCountRef.current += 1;
        executeScript10sCallsiteCountsRef.current[callsite] = (executeScript10sCallsiteCountsRef.current[callsite] || 0) + 1;
        const elapsed = now - executeScript60sWindowStartRef.current;
        const elapsed10s = now - executeScript10sWindowStartRef.current;
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
        if (elapsed10s >= 10000) {
          executeScript10sPeakRef.current = Math.max(executeScript10sPeakRef.current, executeScript10sCountRef.current);
          executeScript10sAvgSamplesRef.current.total += executeScript10sCountRef.current;
          executeScript10sAvgSamplesRef.current.samples += 1;
          const avg10s = executeScript10sAvgSamplesRef.current.samples > 0
            ? (executeScript10sAvgSamplesRef.current.total / executeScript10sAvgSamplesRef.current.samples)
            : 0;
          const callsites = Object.entries(executeScript10sCallsiteCountsRef.current)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([site, count]) => site + ':' + count)
            .join(',');
          console.log(
            '[MW-Host][ExecScript10s]',
            'count=' + executeScript10sCountRef.current,
            'windowMs=' + elapsed10s,
            'topCallsites=' + (callsites || 'none'),
          );
          console.log(
            '[NativeWebView][Metrics]',
            'executeScript10sCount=' + executeScript10sCountRef.current,
            'windowMs=' + elapsed10s,
            'executeScript10sPeak=' + executeScript10sPeakRef.current,
            'executeScript10sAvg=' + avg10s.toFixed(2),
            'callsites=' + (callsites || 'none'),
            'activeInstanceId=' + (activeInstanceIdRef.current ?? 'none'),
            'url=' + (currentUrlRef.current || 'unknown'),
          );
          executeScript10sWindowStartRef.current = now;
          executeScript10sCountRef.current = 0;
          executeScript10sCallsiteCountsRef.current = {};
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
    open,
    close,
    goBack,
    goForward,
    reload,
    setUrl,
    postMessageToWebView,
    executeScript,
  };
};
