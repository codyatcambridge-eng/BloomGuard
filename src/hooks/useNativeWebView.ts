import { useState, useCallback, useRef, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
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
}

export const useNativeWebView = (options: UseNativeWebViewOptions = {}) => {
  const {
    onLoadStart,
    onLoadEnd,
    onLoadError,
    onUrlChange,
    onNavigationRequest,
    onClose,
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

  // Set up event listeners
  useEffect(() => {
    if (!isNative || listenersSetupRef.current) return;
    listenersSetupRef.current = true;

    // URL change listener
    InAppBrowser.addListener('urlChangeEvent', (event) => {
      const url = event.url;
      console.log('[NativeWebView] URL changed:', url);
      
      setState(prev => ({ ...prev, currentUrl: url }));
      onUrlChange?.(url);
      
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

    // Page load complete listener
    InAppBrowser.addListener('browserPageLoaded', () => {
      console.log('[NativeWebView] Page loaded');
      setState(prev => ({ ...prev, isLoading: false, error: null }));
      if (state.currentUrl) {
        onLoadEnd?.(state.currentUrl);
      }
    });

    // Close listener
    InAppBrowser.addListener('closeEvent', () => {
      console.log('[NativeWebView] Browser closed');
      setState(prev => ({ ...prev, isOpen: false }));
      onClose?.();
    });

    return () => {
      InAppBrowser.removeAllListeners();
      listenersSetupRef.current = false;
    };
  }, [isNative, onUrlChange, onLoadEnd, onClose, state.currentUrl]);

  // Open URL in native WebView
  const open = useCallback(async (url: string, inApp: boolean = true) => {
    if (!isNative) {
      console.log('[NativeWebView] Not running natively, falling back to window.open');
      window.open(url, '_blank');
      return false;
    }

    // Check if navigation should be blocked
    if (onNavigationRequest && !onNavigationRequest(url)) {
      console.log('[NativeWebView] Navigation blocked by handler:', url);
      return false;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));
    onLoadStart?.(url);

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
      
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to open WebView';
      console.error('[NativeWebView] Open error:', error);
      setState(prev => ({ ...prev, isLoading: false, error: errorMsg }));
      onLoadError?.(url, errorMsg);
      return false;
    }
  }, [isNative, onLoadStart, onLoadError, onNavigationRequest]);

  // Close the WebView
  const close = useCallback(async () => {
    if (!isNative) return;
    
    try {
      await InAppBrowser.close();
      setState(prev => ({ ...prev, isOpen: false }));
      historyStackRef.current = [];
      historyIndexRef.current = -1;
    } catch (error) {
      console.error('[NativeWebView] Close error:', error);
    }
  }, [isNative]);

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

  // Execute JavaScript in the WebView
  const executeScript = useCallback(async (script: string): Promise<string | null> => {
    if (!isNative) return null;
    
    try {
      await InAppBrowser.executeScript({ code: script });
      return 'executed';
    } catch (error) {
      console.error('[NativeWebView] ExecuteScript error:', error);
      return null;
    }
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
    executeScript,
  };
};
