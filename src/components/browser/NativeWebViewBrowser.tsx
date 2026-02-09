import { useState, useCallback, useEffect, useRef } from 'react';
import LabelListener from '@/components/browser/LabelListener';
import { Shield, AlertTriangle, Loader2, Globe } from 'lucide-react';
import { useNativeWebView } from '@/hooks/useNativeWebView';
import { useContentProtection } from '@/hooks/useContentProtection';
import { useSettings } from '@/hooks/useSettings';
import { useLocalSettings } from '@/hooks/useLocalSettings';
import { useDeviceId } from '@/hooks/useDeviceId';
import { useBrowserNavigation, BrowserView } from '@/hooks/useBrowserNavigation';
import { useCapacitor } from '@/hooks/useCapacitor';
import { useModerationBridge } from '@/hooks/useModerationBridge';
import { supabase } from '@/integrations/supabase/client';
import { generateModerationScript } from '@/lib/webview-injection-script';
import { 
  isValidModerationRequest, 
  createResultMessage,
  createBlurOverlayStateMessage,
  isBlurOverlayReadyMessage,
  escapeForJs,
  type ModerationRequestMessage,
} from '@/lib/moderation-request-utils';
import { BrowserHeader } from './BrowserHeader';
import { SafeBrowserHomepage } from './SafeBrowserHomepage';
import { SearchResultsView } from './SearchResultsView';
import { FallbackModeUI } from './FallbackModeUI';
import { ReaderModeView } from './ReaderModeView';
import { PreviewModeView } from './PreviewModeView';
import { FullFailureView } from './FullFailureView';
import { PDFViewer } from './PDFViewer';
import { YouTubePreviewView } from './YouTubePreviewView';
import { SocialPreviewView, SocialPlatform } from './SocialPreviewView';
import { ExternalLinkWarning } from './ExternalLinkWarning';
import { AIStatusBar } from './AIStatusBar';
import { toast } from 'sonner';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
}

interface ReaderContent {
  content: string;
  previewHtml?: string;
  images: string[];
  title: string;
  description?: string;
  sourceUrl: string;
}

interface PDFContent {
  pdfUrl: string;
  title: string;
  sourceUrl: string;
}

interface YouTubeContent {
  videoId: string;
  title: string;
  channelName: string;
  description: string;
  thumbnailUrl: string;
  sourceUrl: string;
}

interface SocialContent {
  platform: SocialPlatform;
  contentId: string;
  title: string;
  author: string;
  description: string;
  thumbnailUrl: string;
  sourceUrl: string;
}

/**
 * NativeWebViewBrowser - Unified browser component
 * Uses native WebView on mobile, fallback modes on web
 * Social platforms load fully in WebView (not preview mode)
 */
export const NativeWebViewBrowser = () => {
  const { isNative, platform } = useCapacitor();
  
  const [urlInput, setUrlInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingReader, setIsLoadingReader] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  // Content states
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [readerContent, setReaderContent] = useState<ReaderContent | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [pdfContent, setPdfContent] = useState<PDFContent | null>(null);
  const [youtubeContent, setYoutubeContent] = useState<YouTubeContent | null>(null);
  const [socialContent, setSocialContent] = useState<SocialContent | null>(null);
  const [failureError, setFailureError] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState('');
  const [blockedCategory, setBlockedCategory] = useState('');
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  
  // External link warning
  const [externalWarningUrl, setExternalWarningUrl] = useState<string | null>(null);
  
  // Hooks
  const { checkBlockedSite, isChecking } = useContentProtection();
  const { settings } = useSettings();
  const { settings: localSettings, getModerationConfig, isModerationEnabled, getNonce } = useLocalSettings();
  const deviceId = useDeviceId();

  // Central blur source-of-truth with hysteresis to avoid flicker.
  const blurStateRef = useRef<{ enabled: boolean; reason: string; timestamp: number }>({
    enabled: false,
    reason: 'init',
    timestamp: Date.now(),
  });
  const blurReadyRef = useRef(false);
  const blurPendingRef = useRef<{ enabled: boolean; reason: string; timestamp: number } | null>(null);
  const blurRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const blurSignalRef = useRef({ unsafeStreak: 0, safeStreak: 0 });
  const [blurSyncVersion, setBlurSyncVersion] = useState(0);

  const UNSAFE_STREAK_REQUIRED = 2;
  const SAFE_STREAK_REQUIRED = 2;

  const queueCurrentBlurState = useCallback((reason: string) => {
    blurPendingRef.current = {
      enabled: blurStateRef.current.enabled,
      reason,
      timestamp: Date.now(),
    };
    setBlurSyncVersion(v => v + 1);
  }, []);

  const setCentralBlurState = useCallback((enabled: boolean, reason: string) => {
    const prev = blurStateRef.current;
    if (prev.enabled === enabled && prev.reason === reason) return;

    blurStateRef.current = {
      enabled,
      reason,
      timestamp: Date.now(),
    };
    queueCurrentBlurState(reason);
  }, [queueCurrentBlurState]);

  const processModerationSafetySignal = useCallback((isUnsafe: boolean, reason: string) => {
    const signal = blurSignalRef.current;
    if (isUnsafe) {
      signal.unsafeStreak += 1;
      signal.safeStreak = 0;
      if (signal.unsafeStreak >= UNSAFE_STREAK_REQUIRED) {
        setCentralBlurState(true, reason);
      }
      return;
    }

    signal.safeStreak += 1;
    signal.unsafeStreak = 0;
    if (signal.safeStreak >= SAFE_STREAK_REQUIRED) {
      setCentralBlurState(false, reason);
    }
  }, [setCentralBlurState]);
  
  // Moderation bridge for AI image scanning
  const moderationBridge = useModerationBridge({
    onImageBlurred: (src, result) => {
      console.log('[Browser] Image blurred:', src.substring(0, 50), result.category);
      processModerationSafetySignal(true, 'image_blurred');
      if (localSettings.show_scan_notifications) {
        toast.info(`Image blurred: ${result.category}`, {
          duration: 2000,
        });
      }
    },
    onScanComplete: (stats) => {
      console.log('[Browser] Scan complete:', stats);
      processModerationSafetySignal(stats.blurred > 0, stats.blurred > 0 ? 'scan_complete_unsafe' : 'scan_complete_safe');
      if (localSettings.show_scan_notifications && stats.blurred > 0) {
        toast.success(`Scanned ${stats.total} images, ${stats.blurred} blurred`, {
          duration: 3000,
        });
      }
    },
  });
  
  // Track if moderation script was injected
  const injectionDoneRef = useRef(false);
  
  const {
    currentView,
    currentUrl,
    displayUrl,
    navigate,
    goBack: navGoBack,
    goForward: navGoForward,
    goHome,
    canGoBack: navCanGoBack,
    canGoForward: navCanGoForward,
    getModeLabel,
    getModeColor,
  } = useBrowserNavigation();

  // Utility functions
  const normalizeUrl = (input: string): string => {
    let normalized = input.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    return normalized;
  };

  const extractDomain = (urlString: string): string => {
    try {
      const urlObj = new URL(normalizeUrl(urlString));
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return urlString.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
  };

  const isPdfUrl = (urlString: string): boolean => {
    return urlString.toLowerCase().endsWith('.pdf');
  };

  const logEvent = useCallback(async (eventType: string, domain: string, action: string) => {
    if (!deviceId) return;
    try {
      await supabase.from('content_moderation_logs').insert({
        device_id: deviceId,
        content_type: 'website',
        url: domain,
        classification: eventType,
        action_taken: action,
        confidence: 1.0,
      });
    } catch (error) {
      console.error('[Browser] Failed to log event:', error);
    }
  }, [deviceId]);

  // Native WebView handlers
  const handleNavigationRequest = useCallback(async (url: string): Promise<boolean> => {
    const domain = extractDomain(url);
    
    // Check blocklist
    if (settings.block_adult_sites) {
      const result = await checkBlockedSite(url, deviceId);
      if (result?.isBlocked) {
        setBlockedReason(result.reason);
        setBlockedCategory(result.category || 'blocked');
        navigate('blocked', '', url);
        await logEvent('blocked', domain, 'blocked');
        return false;
      }
    }
    
    // All navigation allowed in native WebView (including social platforms)
    return true;
  }, [settings, checkBlockedSite, deviceId, navigate, logEvent]);

  // Inject moderation script into WebView
  const injectModerationScript = useCallback(async (scriptExecutor: (script: string) => Promise<string | null>) => {
    if (!isModerationEnabled()) {
      console.log('[MW-Bridge] Moderation disabled, skipping injection');
      return;
    }
    
    const config = getModerationConfig();
    console.log('[MW-Bridge] Injecting moderation script with config:', config);
    
    // Inject the main moderation script (includes CSS)
    const mainScript = generateModerationScript(config);
    try {
      await scriptExecutor(mainScript);

      // YouTube-specific hardening: Robust MutationObserver targeting specific YouTube selectors
      // Detects .yt-core-image, ytd-thumbnail img, #thumbnail img and sends to ModerationBridge
      const ytObserverScript = `
        (function() {
          'use strict';
          try {
            if (window.__GC_YT_ROBUST_OBSERVER__) return 'ALREADY_INSTALLED';
            window.__GC_YT_ROBUST_OBSERVER__ = true;

            // YouTube-specific selectors to target
            var YT_SELECTORS = [
              '.yt-core-image',
              'ytd-thumbnail img',
              '#thumbnail img',
              'yt-img-shadow img',
              'ytd-rich-item-renderer img',
              'ytd-video-renderer img',
              'ytd-compact-video-renderer img',
              'ytd-grid-video-renderer img',
              'img[src*="ytimg.com"]',
              'img[src*="ggpht.com"]'
            ];

            // Track processed images to avoid duplicates
            var processedSrcs = new Set();
            var pendingQueue = [];
            var flushTimer = null;

            // Check if element is visible in viewport (with 300px buffer)
            function isInViewport(el) {
              try {
                var rect = el.getBoundingClientRect();
                return (
                  rect.top < window.innerHeight + 300 &&
                  rect.bottom > -300 &&
                  rect.left < window.innerWidth + 300 &&
                  rect.right > -300 &&
                  rect.width > 50 && rect.height > 50
                );
              } catch (e) { return false; }
            }

            // Extract src from element
            function getSrc(el) {
              return el.src || el.dataset.src || el.dataset.lazySrc || el.getAttribute('data-src') || '';
            }

            // Queue image for moderation scan
            function queueImage(el) {
              var src = getSrc(el);
              if (!src || src.startsWith('data:') && src.length < 500) return;
              if (processedSrcs.has(src)) return;
              if (el.dataset.mwYtQueued === 'true') return;
              
              // Mark as queued
              el.dataset.mwYtQueued = 'true';
              processedSrcs.add(src);
              
              // Add to pending queue with element reference
              pendingQueue.push({ src: src, el: el });
              
              // Debounce flush
              if (!flushTimer) {
                flushTimer = setTimeout(flushQueue, 50);
              }
            }

            // Flush queue - send to ModerationBridge via internal script
            function flushQueue() {
              flushTimer = null;
              if (pendingQueue.length === 0) return;
              
              var items = pendingQueue.splice(0, 10); // Process 10 at a time
              
              console.log('[MW-YT-Observer] Flushing', items.length, 'YouTube images to scanner');
              
              // Trigger the main moderation script's scan on these elements
              items.forEach(function(item) {
                try {
                  // Force rescan by clearing mwScanned flag
                  if (item.el && item.el.dataset) {
                    item.el.dataset.mwScanned = 'false';
                  }
                } catch (e) {}
              });
              
              // Call the main scanner
              if (typeof window.__MW_SCAN_YT__ === 'function') {
                window.__MW_SCAN_YT__();
              } else if (typeof window.__MW_SCAN_FULL__ === 'function') {
                window.__MW_SCAN_FULL__();
              }
              
              // Continue if more items
              if (pendingQueue.length > 0) {
                flushTimer = setTimeout(flushQueue, 100);
              }
            }

            // Scan all YouTube images currently in DOM
            function scanAllYouTubeImages() {
              YT_SELECTORS.forEach(function(selector) {
                try {
                  document.querySelectorAll(selector).forEach(function(el) {
                    if (el.tagName === 'IMG' && isInViewport(el)) {
                      queueImage(el);
                    }
                  });
                } catch (e) {}
              });
            }

            // IntersectionObserver for viewport detection
            var viewportObserver = null;
            if ('IntersectionObserver' in window) {
              viewportObserver = new IntersectionObserver(function(entries) {
                entries.forEach(function(entry) {
                  if (entry.isIntersecting) {
                    var el = entry.target;
                    if (el.tagName === 'IMG') {
                      queueImage(el);
                    }
                  }
                });
              }, { rootMargin: '300px', threshold: 0.01 });
            }

            // Observe an element for viewport entry
            function observeElement(el) {
              if (viewportObserver && el.tagName === 'IMG') {
                viewportObserver.observe(el);
              }
            }

            // MutationObserver for DOM changes
            var mutationObserver = new MutationObserver(function(mutations) {
              var foundNewImages = false;
              
              mutations.forEach(function(mutation) {
                // Check added nodes
                mutation.addedNodes.forEach(function(node) {
                  if (node.nodeType !== 1) return;
                  
                  var el = node;
                  var tagName = el.tagName ? el.tagName.toUpperCase() : '';
                  
                  // Direct IMG element
                  if (tagName === 'IMG') {
                    observeElement(el);
                    if (isInViewport(el)) {
                      queueImage(el);
                      foundNewImages = true;
                    }
                  }
                  
                  // YouTube container elements - scan their children
                  if (tagName.startsWith('YTD-') || 
                      tagName === 'YT-IMAGE' || 
                      tagName === 'YT-IMG-SHADOW' ||
                      el.id === 'thumbnail' ||
                      el.classList.contains('yt-core-image')) {
                    try {
                      el.querySelectorAll('img').forEach(function(img) {
                        observeElement(img);
                        if (isInViewport(img)) {
                          queueImage(img);
                          foundNewImages = true;
                        }
                      });
                    } catch (e) {}
                  }
                  
                  // Generic: scan all img descendants
                  try {
                    el.querySelectorAll && el.querySelectorAll('img').forEach(function(img) {
                      observeElement(img);
                    });
                  } catch (e) {}
                });
                
                // Attribute changes (src, data-src)
                if (mutation.type === 'attributes') {
                  var target = mutation.target;
                  var attr = mutation.attributeName;
                  if (target.tagName === 'IMG' && (attr === 'src' || attr === 'data-src' || attr === 'srcset')) {
                    // Reset processed state for this element
                    target.dataset.mwYtQueued = 'false';
                    target.dataset.mwScanned = 'false';
                    var src = getSrc(target);
                    if (src) processedSrcs.delete(src);
                    if (isInViewport(target)) {
                      queueImage(target);
                      foundNewImages = true;
                    }
                  }
                }
              });
              
              // If new images found, also trigger a full YT scan after a delay
              if (foundNewImages) {
                setTimeout(scanAllYouTubeImages, 200);
              }
            });

            // Start observing
            if (document.body) {
              mutationObserver.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'data-src', 'srcset', 'data-lazy-src']
              });
              
              // Initial scan
              scanAllYouTubeImages();
              
              // Periodic rescans for lazy-loaded content
              setInterval(scanAllYouTubeImages, 2000);
              
              // Scroll handler for infinite scroll
              var scrollTimer = null;
              var lastScrollY = 0;
              window.addEventListener('scroll', function() {
                var delta = Math.abs(window.scrollY - lastScrollY);
                if (delta > 100) {
                  lastScrollY = window.scrollY;
                  if (scrollTimer) clearTimeout(scrollTimer);
                  scrollTimer = setTimeout(scanAllYouTubeImages, 100);
                }
              }, { passive: true });
              
              console.log('[MW-YT-Observer] Robust YouTube MutationObserver installed');
              return 'OK';
            }
            return 'NO_BODY';
          } catch (e) {
            console.error('[MW-YT-Observer] Error:', e);
            return 'ERR:' + (e && e.message ? e.message : 'unknown');
          }
        })();
      `;
      await scriptExecutor(ytObserverScript);

      injectionDoneRef.current = true;
      console.log('[MW-Bridge] Moderation script injected successfully');
    } catch (error) {
      console.error('[MW-Bridge] Moderation script injection failed:', error);
    }
  }, [isModerationEnabled, getModerationConfig]);

  const {
    state: webViewState,
    open: openWebView,
    close: closeWebView,
    goBack: webViewGoBack,
    goForward: webViewGoForward,
    reload: webViewReload,
    executeScript,
  } = useNativeWebView({
    onLoadStart: (url) => {
      console.log('[Browser] ======= LOAD START =======');
      console.log('[Browser] URL:', url);
      setIsLoading(true);
      injectionDoneRef.current = false;
      blurReadyRef.current = false;
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'navigation_load_start');
    },
    onLoadEnd: async (url) => {
      console.log('[Browser] ======= LOAD END =======');
      console.log('[Browser] URL:', url);
      setIsLoading(false);
      
      // Inject moderation script after page fully loads
      if (!injectionDoneRef.current) {
        // Small delay to ensure DOM is ready
        setTimeout(async () => {
          await injectModerationScript(executeScript);
          await executeScript(`
            (function() {
              try {
                window.postMessage({ type: 'MW_BLUR_COMMAND', command: 'PING', timestamp: Date.now(), reason: 'host_onLoadEnd' }, '*');
                return 'OK';
              } catch (e) {
                return 'ERR';
              }
            })();
          `);
        }, 500);
      }
    },
    onLoadError: (url, error) => {
      console.error('[Browser] ======= LOAD ERROR =======');
      console.error('[Browser] URL:', url);
      console.error('[Browser] Error:', error);
      setIsLoading(false);
      injectionDoneRef.current = false;
      setFallbackUrl(url);
      navigate('fallback', '', url);
    },
    onUrlChange: (url) => {
      console.log('[Browser] ======= URL CHANGE =======');
      console.log('[Browser] New URL:', url);
      setUrlInput(url);
      navigate('browse', url, url);
      // Reset injection for new page navigation
      injectionDoneRef.current = false;
      blurReadyRef.current = false;
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'url_change_safe_reset');
    },
    onNavigationRequest: handleNavigationRequest,
    onClose: () => {
      console.log('[Browser] ======= WEBVIEW CLOSED =======');
      moderationBridge.clearCache();
      injectionDoneRef.current = false;
      blurReadyRef.current = false;
      blurPendingRef.current = null;
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'webview_closed');
      navigate('home', '', '');
    },
  });

  const requestBlurHandshake = useCallback(async (source: string) => {
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    await executeScript(`
      (function() {
        try {
          window.postMessage({ type: 'MW_BLUR_COMMAND', command: 'PING', reason: '${escapeForJs(source)}', timestamp: Date.now() }, '*');
          return 'OK';
        } catch (e) {
          return 'ERR';
        }
      })();
    `);
  }, [isNative, webViewState.isOpen, executeScript]);

  const flushBlurStateToWebView = useCallback(async (attempt: number = 0) => {
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    if (!blurReadyRef.current) return;

    const pending = blurPendingRef.current || blurStateRef.current;
    const stateMessage = createBlurOverlayStateMessage(pending.enabled, pending.reason);
    const escapedMessage = escapeForJs(JSON.stringify(stateMessage));

    const script = `
      (function() {
        try {
          var msg = JSON.parse('${escapedMessage}');
          window.postMessage(msg, '*');
          return 'OK';
        } catch (e) {
          return 'ERR';
        }
      })();
    `;

    const result = await executeScript(script);
    if (result) {
      blurPendingRef.current = null;
      return;
    }

    if (attempt >= 3) {
      return;
    }

    if (blurRetryTimerRef.current) {
      clearTimeout(blurRetryTimerRef.current);
    }
    blurRetryTimerRef.current = setTimeout(() => {
      flushBlurStateToWebView(attempt + 1);
    }, Math.min(200 * (attempt + 1), 1000));
  }, [isNative, webViewState.isOpen, executeScript]);

  useEffect(() => {
    if (!isNative || !webViewState.isOpen) return;
    if (!blurReadyRef.current) return;
    flushBlurStateToWebView();
  }, [blurSyncVersion, isNative, webViewState.isOpen, flushBlurStateToWebView]);

  useEffect(() => {
    if (!isNative || !webViewState.isOpen) return;

    const onVisible = () => {
      requestBlurHandshake('host_visible');
      queueCurrentBlurState('host_visible_resync');
      flushBlurStateToWebView();
    };

    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isNative, webViewState.isOpen, requestBlurHandshake, queueCurrentBlurState, flushBlurStateToWebView]);

  useEffect(() => {
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    if (!webViewState.currentUrl) return;

    blurReadyRef.current = false;

    const reinjectAndPing = async () => {
      await injectModerationScript(executeScript);
      await requestBlurHandshake('url_change_reinject');
    };

    const timer = setTimeout(reinjectAndPing, 250);
    return () => clearTimeout(timer);
  }, [
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    executeScript,
    injectModerationScript,
    requestBlurHandshake,
  ]);

  useEffect(() => {
    if (!isNative || !webViewState.isOpen) return;
    const timer = setInterval(() => {
      if (!blurReadyRef.current) {
        requestBlurHandshake('ready_poll');
      }
    }, 800);
    return () => clearInterval(timer);
  }, [isNative, webViewState.isOpen, requestBlurHandshake]);

  useEffect(() => {
    return () => {
      if (blurRetryTimerRef.current) {
        clearTimeout(blurRetryTimerRef.current);
      }
    };
  }, []);

  // ==================== MODERATION MESSAGE HANDLING ====================
  // 
  // We use a hybrid approach for WebView <-> Host communication:
  // 1. Primary: window.postMessage from WebView -> window.addEventListener('message') in host
  // 2. Fallback: Polling global queues via executeScript (for browsers that don't support postMessage)
  //
  // Host -> WebView: executeScript to call window.postMessage inside the page
  // ==================== 

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingRequestsRef = useRef<Set<string>>(new Set());
  
  /**
   * Process a moderation request from the WebView
   * Uses the new postMessage protocol with requestId/itemId tracking
   */
  const processModerationRequest = useCallback(async (request: ModerationRequestMessage, nonce: string) => {
    const { requestId, items, thresholds } = request;
    
    if (pendingRequestsRef.current.has(requestId)) {
      console.log('[MW-Host] Duplicate request ignored:', requestId);
      return;
    }
    pendingRequestsRef.current.add(requestId);
    
    const startTime = performance.now();
    console.log('[MW-Host] request received', requestId, 'items=' + items.length);
    items.forEach(item => {
      console.log('[MW-Host]   -', item.itemId, '[' + item.sourceType + ']:', item.src.substring(0, 60));
    });
    
    console.log('[MW-Host] calling scanBatch', requestId, 'itemCount=' + items.length);
    
    const results: Array<{
      itemId: string;
      src: string;
      shouldBlur: boolean;
      category: string;
      confidence: number;
    }> = [];
    
    // Process each item using the moderation bridge
    for (const item of items) {
      try {
        const scanResult = await moderationBridge.scanImage(item.src, thresholds);
        
        if (scanResult) {
          results.push({
            itemId: item.itemId,
            src: item.src,
            shouldBlur: scanResult.shouldBlur,
            category: scanResult.category,
            confidence: scanResult.confidence,
          });
          console.log('[MW-Host] scan result', item.itemId, ':', scanResult.category, 'blur=' + scanResult.shouldBlur);
        } else {
          results.push({
            itemId: item.itemId,
            src: item.src,
            shouldBlur: false,
            category: 'error',
            confidence: 0,
          });
          console.log('[MW-Host] scan result', item.itemId, ': error (no result)');
        }
      } catch (error) {
        console.log('[MW-Host] scan error', item.itemId, ':', error);
        results.push({
          itemId: item.itemId,
          src: item.src,
          shouldBlur: false,
          category: 'error',
          confidence: 0,
        });
      }
    }
    
    const elapsedMs = performance.now() - startTime;
    console.log('[MW-Host] scan complete', requestId, 'elapsed=' + elapsedMs.toFixed(0) + 'ms');

    const hasUnsafe = results.some(item => item.shouldBlur);
    processModerationSafetySignal(hasUnsafe, hasUnsafe ? 'moderation_request_unsafe' : 'moderation_request_safe');
    
    // Post results back to the WebView with nonce for security
    console.log('[MW-Host] posting results back', requestId, 'count=' + results.length, 'nonce=' + nonce.substring(0, 10));
    
    if (executeScript) {
      try {
        const resultMessage = createResultMessage(requestId, results, nonce);
        const messageJson = JSON.stringify(resultMessage);
        // Escape for safe injection
        const escapedJson = messageJson
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'")
          .replace(/</g, '\\u003c')
          .replace(/>/g, '\\u003e');
        
        const postResultScript = `
          (function() {
            try {
              var msg = JSON.parse('${escapedJson}');
              window.postMessage(msg, '*');
              console.log('[MW] Host posted result:', '${requestId}');
              return 'OK';
            } catch (e) {
              console.error('[MW] Failed to parse result:', e);
              return 'ERROR: ' + e.message;
            }
          })();
        `;
        
        await executeScript(postResultScript);
        console.log('[MW-Host] Results posted successfully for', requestId);
      } catch (error) {
        console.log('[MW-Host] Failed to post results:', error);
        
        // Fallback: Push to legacy results queue
        try {
          for (const result of results) {
            const escapedSrc = escapeForJs(result.src);
            const pushLegacyScript = `
              (function() {
                if (!window.__GC_SCAN_RESULTS__) window.__GC_SCAN_RESULTS__ = [];
                window.__GC_SCAN_RESULTS__.push({
                  src: '${escapedSrc}',
                  shouldBlur: ${result.shouldBlur},
                  category: '${result.category}',
                  confidence: ${result.confidence},
                  blurStrengthPx: ${localSettings.blur_strength_px || 16}
                });
                return 'OK';
              })();
            `;
            await executeScript(pushLegacyScript);
          }
          console.log('[MW-Host] Results pushed to legacy queue for', requestId);
        } catch (legacyError) {
          console.log('[MW-Host] Legacy fallback also failed:', legacyError);
        }
      }
    }
    
    pendingRequestsRef.current.delete(requestId);
  }, [moderationBridge, executeScript, localSettings.blur_strength_px, processModerationSafetySignal]);

  /**
   * Handle messages from WebView via window.postMessage
   * This is the primary communication channel
   */
  useEffect(() => {
    // Get session nonce from local settings hook
    const sessionNonce = getNonce();
    
    const handleMessage = async (event: MessageEvent) => {
      const message = event.data;

      if (isBlurOverlayReadyMessage(message)) {
        blurReadyRef.current = true;
        console.log('[MW-Host] Blur overlay READY:', message.reason || 'ready', message.url || '');
        queueCurrentBlurState('webview_ready_sync');
        await flushBlurStateToWebView();
        return;
      }
      
      // Handle new postMessage protocol with nonce validation
      if (isValidModerationRequest(message)) {
        // Validate nonce
        if (message.nonce !== sessionNonce) {
          console.warn('[MW-Host] NONCE MISMATCH - rejecting request:', message.requestId);
          console.warn('[MW-Host] Expected:', sessionNonce.substring(0, 10), 'Got:', (message.nonce || 'none').substring(0, 10));
          return;
        }
        console.log('[MW-Host] Received postMessage request:', message.requestId, 'nonce valid');
        await processModerationRequest(message, message.nonce);
        return;
      }
      
      // Handle legacy format (backward compatibility)
      if (message?.type === 'gc-moderation-request' && message?.action === 'scan') {
        console.log('[MW-Host] Received legacy moderation request via postMessage');
        const result = await moderationBridge.handleWebViewMessage(message);
        
        if (result && executeScript) {
          const escapedSrc = escapeForJs(result.src);
          const messageId = (result as any).messageId || 0;
          const responseScript = `
            (function() {
              if (window.__GC_MODERATION_RESULT__) {
                window.__GC_MODERATION_RESULT__({
                  messageId: ${messageId},
                  src: '${escapedSrc}',
                  shouldBlur: ${result.shouldBlur},
                  category: '${result.category}',
                  confidence: ${result.confidence}
                });
              }
              window.postMessage({
                type: 'gc-moderation-result',
                messageId: ${messageId},
                src: '${escapedSrc}',
                shouldBlur: ${result.shouldBlur},
                category: '${result.category}',
                confidence: ${result.confidence}
              }, '*');
            })();
          `;
          try {
            await executeScript(responseScript);
            console.log('[MW-Host] Sent legacy moderation result for:', escapedSrc.substring(0, 50));
          } catch (error) {
            console.debug('[MW-Host] Failed to send legacy moderation result:', error);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [processModerationRequest, moderationBridge, executeScript, getNonce, queueCurrentBlurState, flushBlurStateToWebView]);

  /**
   * Fallback: Poll for moderation requests from legacy global queue
   * This is used when postMessage doesn't work reliably
   */
  useEffect(() => {
    if (!isNative || !webViewState.isOpen || !isModerationEnabled()) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    console.log('[MW-Host] Starting legacy queue polling (fallback)...');

    const pollForRequests = async () => {
      if (!executeScript) return;
      
      try {
        // Get and clear pending requests from WebView's global queue
        const getQueueScript = `
          (function() {
            if (!window.__GC_SCAN_QUEUE__ || window.__GC_SCAN_QUEUE__.length === 0) {
              return 'EMPTY';
            }
            var items = window.__GC_SCAN_QUEUE__.splice(0, 5);
            return JSON.stringify(items);
          })();
        `;
        
        const result = await executeScript(getQueueScript);
        
        if (!result || result === 'EMPTY' || result === 'null') {
          return;
        }
        
        let items;
        try {
          items = JSON.parse(result);
        } catch (e) {
          return;
        }
        
        if (!Array.isArray(items) || items.length === 0) {
          return;
        }
        
        console.log('[MW-Host] Legacy poll: found', items.length, 'items in queue');
        
        // Process each scan request
        for (const item of items) {
          const { src, thresholds } = item;
          
          if (!src) continue;
          
          console.log('[MW-Host] Legacy processing:', src.substring(0, 60));
          
          const scanResult = await moderationBridge.scanImage(src, thresholds);
          
          if (scanResult) {
            console.log('[MW-Host] Legacy scan result:', scanResult.shouldBlur, scanResult.category);
            
            // Push result back to WebView's results queue
            const escapedSrc = escapeForJs(src);
            const pushResultScript = `
              (function() {
                if (!window.__GC_SCAN_RESULTS__) window.__GC_SCAN_RESULTS__ = [];
                window.__GC_SCAN_RESULTS__.push({
                  src: '${escapedSrc}',
                  shouldBlur: ${scanResult.shouldBlur},
                  category: '${scanResult.category}',
                  confidence: ${scanResult.confidence},
                  blurStrengthPx: ${localSettings.blur_strength_px || 16}
                });
                return 'OK';
              })();
            `;
            
            try {
              await executeScript(pushResultScript);
              console.log('[MW-Host] Legacy result pushed for:', src.substring(0, 50));
            } catch (e) {
              console.debug('[MW-Host] Failed to push legacy result:', e);
            }
          }
        }
      } catch (e) {
        // Polling errors are expected and ignored in some cases
        console.debug('[MW-Host] Legacy poll error:', e);
      }
    };

    // Start polling at 200ms intervals (less aggressive since postMessage is primary)
    pollIntervalRef.current = setInterval(pollForRequests, 200);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isNative, webViewState.isOpen, isModerationEnabled, executeScript, moderationBridge, localSettings.blur_strength_px]);

  // Search handler - redirects to Google search immediately
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;
    
    console.log('[Browser] Starting search:', query);
    
    // Build Google search URL
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
    
    // IMMEDIATELY set view to browse and navigate - fail-open approach
    navigate('browse', searchUrl, searchUrl);
    setUrlInput(searchUrl);
    setIsLoading(true);
    
    await logEvent('search', query, 'google_redirect');
    
    // Open in native WebView or fallback
    if (isNative) {
      try {
        const success = await openWebView(searchUrl, true);
        if (success) {
          await logEvent('allowed', 'google.com', 'native-webview');
        } else {
          setFallbackUrl(searchUrl);
          navigate('fallback', '', searchUrl);
          await logEvent('fallback', 'google.com', 'webview-failed');
        }
      } catch (error) {
        console.error('[Browser] WebView open error:', error);
        setFallbackUrl(searchUrl);
        setFailureError(error instanceof Error ? error.message : 'Failed to load search');
        navigate('failure', '', searchUrl);
        await logEvent('error', 'google.com', 'webview-error');
      }
    } else {
      // On web, use fallback modes
      setFallbackUrl(searchUrl);
      navigate('fallback', '', searchUrl);
      await logEvent('fallback', 'google.com', 'web-platform');
    }
    
    setIsLoading(false);
  }, [navigate, logEvent, isNative, openWebView]);

  /**
   * Determine if input is a URL vs search query
   * URLs: contain domain TLDs (.com, .org, etc), protocol prefixes, or IP addresses
   * Searches: everything else
   */
  const isUrlInput = useCallback((input: string): boolean => {
    const trimmed = input.trim().toLowerCase();
    
    // Protocol prefix means it's definitely a URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return true;
    }
    
    // Has spaces without protocol = search query
    if (trimmed.includes(' ')) {
      return false;
    }
    
    // Common TLDs pattern - if it ends with these, it's a URL
    const tldPattern = /\.(com|org|net|edu|gov|io|co|app|dev|me|tv|info|biz|xyz|ai|uk|de|fr|jp|cn|ru|br|in|au|ca|es|it|nl|pl|kr|se|no|fi|dk|ch|at|be|cz|gr|hu|ie|pt|ro|sk|za|nz|sg|hk|tw|my|th|ph|vn|id)(\/.*)?(#.*)?$/i;
    if (tldPattern.test(trimmed)) {
      return true;
    }
    
    // Contains a dot followed by path = likely URL
    if (/\.\w+\//.test(trimmed)) {
      return true;
    }
    
    // IP address pattern
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/.test(trimmed)) {
      return true;
    }
    
    // localhost
    if (trimmed.startsWith('localhost')) {
      return true;
    }
    
    // Everything else is a search
    return false;
  }, []);

  // Main navigation handler - immediately navigate to browse view (fail-open)
  const handleNavigate = useCallback(async (targetUrl?: string, e?: React.FormEvent) => {
    e?.preventDefault();
    
    const urlToNavigate = targetUrl || urlInput;
    if (!urlToNavigate.trim()) return;

    // Check if it's a search query or URL
    if (!isUrlInput(urlToNavigate)) {
      handleSearch(urlToNavigate);
      return;
    }

    // Normalize URL immediately (add https:// if missing)
    const normalizedUrl = normalizeUrl(urlToNavigate);
    const domain = extractDomain(urlToNavigate);
    setUrlInput(normalizedUrl);

    // Reset states
    setReaderContent(null);
    setReaderError(null);
    setPdfContent(null);
    setYoutubeContent(null);
    setSocialContent(null);
    setFailureError(null);

    // IMMEDIATELY set view to browse - fail-open approach
    // Moderation runs in background via injection script
    navigate('browse', normalizedUrl, normalizedUrl);
    setIsLoading(true);

    // Check blocklist asynchronously (non-blocking)
    if (settings.block_adult_sites) {
      checkBlockedSite(normalizedUrl, deviceId).then(result => {
        if (result?.isBlocked) {
          setBlockedReason(result.reason);
          setBlockedCategory(result.category || 'blocked');
          navigate('blocked', '', normalizedUrl);
          logEvent('blocked', domain, 'blocked');
          setIsLoading(false);
        }
      }).catch(err => {
        console.warn('[Browser] Blocklist check failed (fail-open):', err);
      });
    }

    // Handle PDFs
    if (isPdfUrl(normalizedUrl)) {
      setFallbackUrl(normalizedUrl);
      navigate('fallback', '', normalizedUrl);
      await logEvent('pdf_detected', domain, 'pdf');
      setIsLoading(false);
      return;
    }

    // Open in native WebView (for all sites including social platforms)
    if (isNative) {
      try {
        const success = await openWebView(normalizedUrl, true);
        if (success) {
          await logEvent('allowed', domain, 'native-webview');
        } else {
          // WebView failed to open - only then show fallback
          setFallbackUrl(normalizedUrl);
          navigate('fallback', '', normalizedUrl);
          await logEvent('fallback', domain, 'webview-failed');
        }
      } catch (error) {
        // Network/WebView error - show failure only for actual errors
        console.error('[Browser] WebView open error:', error);
        setFallbackUrl(normalizedUrl);
        setFailureError(error instanceof Error ? error.message : 'Failed to load page');
        navigate('failure', '', normalizedUrl);
        await logEvent('error', domain, 'webview-error');
      }
    } else {
      // On web, use fallback modes for all navigation
      setFallbackUrl(normalizedUrl);
      navigate('fallback', '', normalizedUrl);
      await logEvent('fallback', domain, 'web-platform');
    }
    
    setIsLoading(false);
  }, [urlInput, settings, checkBlockedSite, deviceId, isNative, openWebView, handleSearch, navigate, logEvent, isUrlInput]);

  // Reader Mode handler
  const handleReaderMode = useCallback(async () => {
    if (!fallbackUrl) {
      console.error('[Browser] No fallback URL');
      return;
    }

    console.log('[Browser] Opening Reader Mode for:', fallbackUrl);
    setIsLoadingReader(true);
    setReaderError(null);
    setPdfContent(null);
    setYoutubeContent(null);
    setSocialContent(null);
    setFailureError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('proxy-reader', {
        body: { url: fallbackUrl }
      });

      if (error) throw new Error(error.message || 'Failed to connect to reader service');

      const domain = extractDomain(fallbackUrl);

      // Handle PDF
      if (data?.isPdf && data?.data) {
        setPdfContent({
          pdfUrl: data.data.pdfUrl,
          title: data.data.title,
          sourceUrl: fallbackUrl,
        });
        navigate('pdf', '', fallbackUrl);
        await logEvent('pdf_mode', domain, 'opened');
        return;
      }

      // Handle social platform metadata
      if (data?.isSocialPlatform && data?.data) {
        const platformData = data.data;
        
        if (data.isYouTube || platformData.platform === 'youtube') {
          setYoutubeContent({
            videoId: platformData.videoId || platformData.contentId,
            title: platformData.title,
            channelName: platformData.channelName || platformData.author,
            description: platformData.description,
            thumbnailUrl: platformData.thumbnailUrl,
            sourceUrl: fallbackUrl,
          });
          navigate('youtube', '', fallbackUrl);
          await logEvent('youtube_preview', domain, `video:${platformData.videoId || platformData.contentId}`);
          return;
        }
        
        setSocialContent({
          platform: platformData.platform as SocialPlatform,
          contentId: platformData.contentId,
          title: platformData.title,
          author: platformData.author,
          description: platformData.description,
          thumbnailUrl: platformData.thumbnailUrl,
          sourceUrl: fallbackUrl,
        });
        navigate('social', '', fallbackUrl);
        await logEvent(`${platformData.platform}_preview`, domain, `content:${platformData.contentId}`);
        return;
      }

      // Legacy YouTube handling
      if (data?.isYouTube && data?.data) {
        setYoutubeContent({
          videoId: data.data.videoId,
          title: data.data.title,
          channelName: data.data.channelName,
          description: data.data.description,
          thumbnailUrl: data.data.thumbnailUrl,
          sourceUrl: fallbackUrl,
        });
        navigate('youtube', '', fallbackUrl);
        await logEvent('youtube_preview', domain, `video:${data.data.videoId}`);
        return;
      }

      // Handle regular content
      if (data?.success && data?.data) {
        const contentData = data.data;
        
        if (data.readerModeFailed) {
          if (contentData.previewHtml && contentData.previewHtml.length > 100) {
            setReaderContent({
              content: '',
              previewHtml: contentData.previewHtml,
              images: contentData.images || [],
              title: contentData.title || domain,
              description: contentData.description,
              sourceUrl: fallbackUrl,
            });
            navigate('preview', '', fallbackUrl);
            await logEvent('preview_mode', domain, 'opened');
            return;
          }
          
          setFailureError('No readable content could be extracted from this page.');
          navigate('failure', '', fallbackUrl);
          await logEvent('full_failure', domain, 'no-content');
          return;
        }
        
        if (!contentData.content || contentData.content.trim().length < 50) {
          if (contentData.previewHtml && contentData.previewHtml.length > 100) {
            setReaderContent({
              content: '',
              previewHtml: contentData.previewHtml,
              images: contentData.images || [],
              title: contentData.title || domain,
              description: contentData.description,
              sourceUrl: fallbackUrl,
            });
            navigate('preview', '', fallbackUrl);
            await logEvent('preview_mode', domain, 'fallback');
            return;
          }
          
          setFailureError('No readable content found on this page.');
          navigate('failure', '', fallbackUrl);
          await logEvent('full_failure', domain, 'short-content');
          return;
        }

        setReaderContent({
          content: contentData.content,
          previewHtml: contentData.previewHtml,
          images: contentData.images || [],
          title: contentData.title || domain,
          description: contentData.description,
          sourceUrl: fallbackUrl,
        });
        navigate('reader', '', fallbackUrl);
        await logEvent('reader_mode', domain, 'opened');
      } else {
        setFailureError(data?.error || 'Failed to load content');
        navigate('failure', '', fallbackUrl);
        await logEvent('full_failure', domain, 'api-error');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Reader Mode failed';
      console.error('[Browser] Reader mode exception:', error);
      setFailureError(errorMsg);
      navigate('failure', '', fallbackUrl);
      await logEvent('reader_mode_error', extractDomain(fallbackUrl), 'failed');
    } finally {
      setIsLoadingReader(false);
    }
  }, [fallbackUrl, navigate, logEvent]);

  // Navigation handlers
  const handleGoBack = useCallback(async () => {
    if (['reader', 'preview', 'youtube', 'social', 'pdf', 'failure'].includes(currentView)) {
      setReaderContent(null);
      setPdfContent(null);
      setYoutubeContent(null);
      setSocialContent(null);
      setFailureError(null);
      navigate('fallback', '', fallbackUrl);
      return;
    }
    
    if (currentView === 'search') {
      goHome();
      setSearchResults([]);
      setSearchQuery('');
      setUrlInput('');
      return;
    }

    if (currentView === 'browse' && isNative && webViewState.isOpen) {
      const success = await webViewGoBack();
      if (!success) {
        await closeWebView();
        goHome();
      }
      return;
    }
    
    if (!navGoBack()) {
      goHome();
    }
  }, [currentView, fallbackUrl, isNative, webViewState.isOpen, navigate, navGoBack, goHome, webViewGoBack, closeWebView]);

  const handleGoForward = useCallback(async () => {
    if (currentView === 'browse' && isNative && webViewState.isOpen) {
      await webViewGoForward();
      return;
    }
    navGoForward();
  }, [currentView, isNative, webViewState.isOpen, navGoForward, webViewGoForward]);

  const handleRefresh = useCallback(async () => {
    if (readerContent) {
      handleReaderMode();
      return;
    }
    if (currentView === 'search' && searchQuery) {
      handleSearch(searchQuery);
      return;
    }
    if (currentView === 'browse' && isNative && webViewState.isOpen) {
      await webViewReload();
      // Reset injection flag to re-inject moderation script
      injectionDoneRef.current = false;
      blurReadyRef.current = false;
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'manual_reload');
      return;
    }
  }, [readerContent, currentView, searchQuery, isNative, webViewState.isOpen, handleReaderMode, handleSearch, webViewReload, setCentralBlurState]);

  const handleHome = useCallback(async () => {
    if (isNative && webViewState.isOpen) {
      await closeWebView();
    }
    moderationBridge.clearCache();
    injectionDoneRef.current = false;
    blurReadyRef.current = false;
    blurPendingRef.current = null;
    blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
    setCentralBlurState(false, 'home_reset');
    setReaderContent(null);
    setPdfContent(null);
    setYoutubeContent(null);
    setSocialContent(null);
    setFailureError(null);
    setSearchResults([]);
    setSearchQuery('');
    setUrlInput('');
    setFallbackUrl('');
    goHome();
  }, [isNative, webViewState.isOpen, closeWebView, goHome, moderationBridge, setCentralBlurState]);

  // Manual scan trigger for current page
  const handleScanPage = useCallback(async () => {
    if (!isNative || !isModerationEnabled()) {
      setIsScanning(true);
      setTimeout(() => setIsScanning(false), 500);
      return;
    }
    
    setIsScanning(true);
    
    // Inject a script to re-scan all images
    const rescanScript = `
      if (typeof window.__MW_SCAN_FULL__ === 'function') {
        window.__MW_SCAN_FULL__();
        'Scan triggered';
      } else if (window.__MW_DEBUG__ && typeof window.__MW_DEBUG__.scanAll === 'function') {
        window.__MW_DEBUG__.scanAll();
        'Scan triggered';
      } else {
        'Moderation not active';
      }
    `;
    
    try {
      await executeScript(rescanScript);
      console.log('[Browser] Manual scan triggered');
    } catch (error) {
      console.error('[Browser] Manual scan failed:', error);
    }
    
    setTimeout(() => setIsScanning(false), 1500);
  }, [isNative, isModerationEnabled, executeScript]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleNavigate(urlInput);
  };

  const handleOpenExternal = useCallback((url: string, eventType: string = 'external_click') => {
    // Show warning before opening external links
    setExternalWarningUrl(url);
  }, []);

  const confirmExternalOpen = useCallback((url: string) => {
    logEvent('external_click', extractDomain(url), 'opened');
    window.open(url, '_blank', 'noopener,noreferrer');
    setExternalWarningUrl(null);
  }, [logEvent]);

  const handleOpenInWebView = useCallback(async (url: string) => {
    if (isNative) {
      await openWebView(url, true);
      navigate('browse', url, url);
      await logEvent('webview_open', extractDomain(url), 'opened');
    } else {
      // On web, open externally with warning
      setExternalWarningUrl(url);
    }
  }, [isNative, openWebView, navigate, logEvent]);

  // Render special views
  if (currentView === 'youtube' && youtubeContent) {
    return (
      <>
        <YouTubePreviewView
          videoId={youtubeContent.videoId}
          title={youtubeContent.title}
          channelName={youtubeContent.channelName}
          description={youtubeContent.description}
          thumbnailUrl={youtubeContent.thumbnailUrl}
          sourceUrl={youtubeContent.sourceUrl}
          onBack={handleGoBack}
          onOpenExternal={() => isNative 
            ? handleOpenInWebView(youtubeContent.sourceUrl)
            : handleOpenExternal(youtubeContent.sourceUrl, 'youtube_external_click')
          }
        />
        <ExternalLinkWarning
          isOpen={!!externalWarningUrl}
          url={externalWarningUrl || ''}
          onConfirm={() => externalWarningUrl && confirmExternalOpen(externalWarningUrl)}
          onClose={() => setExternalWarningUrl(null)}
        />
      </>
    );
  }

  if (currentView === 'social' && socialContent) {
    return (
      <>
        <SocialPreviewView
          platform={socialContent.platform}
          title={socialContent.title}
          author={socialContent.author}
          description={socialContent.description}
          thumbnailUrl={socialContent.thumbnailUrl}
          sourceUrl={socialContent.sourceUrl}
          contentId={socialContent.contentId}
          onBack={handleGoBack}
          onOpenExternal={() => isNative
            ? handleOpenInWebView(socialContent.sourceUrl)
            : handleOpenExternal(socialContent.sourceUrl, `${socialContent.platform}_external_click`)
          }
        />
        <ExternalLinkWarning
          isOpen={!!externalWarningUrl}
          url={externalWarningUrl || ''}
          onConfirm={() => externalWarningUrl && confirmExternalOpen(externalWarningUrl)}
          onClose={() => setExternalWarningUrl(null)}
        />
      </>
    );
  }

  if (currentView === 'pdf' && pdfContent) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <BrowserHeader
          currentView={currentView}
          displayUrl={displayUrl}
          urlInput={urlInput}
          onUrlChange={setUrlInput}
          onSubmit={handleFormSubmit}
          onBack={handleGoBack}
          onForward={handleGoForward}
          onRefresh={handleRefresh}
          onHome={handleHome}
          canGoBack={true}
          canGoForward={navCanGoForward}
          isLoading={isLoading}
          isProtected={settings.shield_active}
          modeLabel="PDF Viewer"
          modeColor="text-blue-500"
        />
        <div className="flex-1">
          <PDFViewer
            pdfUrl={pdfContent.pdfUrl}
            title={pdfContent.title}
            onOpenExternal={() => handleOpenExternal(pdfContent.sourceUrl)}
          />
        </div>
      </div>
    );
  }

  if (currentView === 'preview' && readerContent?.previewHtml) {
    return (
      <PreviewModeView
        previewHtml={readerContent.previewHtml}
        images={readerContent.images}
        title={readerContent.title}
        description={readerContent.description}
        sourceUrl={readerContent.sourceUrl}
        onBack={handleGoBack}
        onOpenExternal={() => handleOpenExternal(readerContent.sourceUrl)}
      />
    );
  }

  if (currentView === 'failure') {
    return (
      <FullFailureView
        sourceUrl={fallbackUrl}
        error={failureError || 'This site cannot be rendered safely.'}
        onBack={handleGoBack}
        onRetry={handleReaderMode}
      />
    );
  }

  if (currentView === 'reader' && readerContent) {
    return (
      <ReaderModeView
        content={readerContent.content}
        images={readerContent.images}
        title={readerContent.title}
        sourceUrl={readerContent.sourceUrl}
        onBack={handleGoBack}
      />
    );
  }

  if (currentView === 'search') {
    return (
      <SearchResultsView
        query={searchQuery}
        results={searchResults}
        isLoading={isSearching}
        error={searchError}
        onBack={handleHome}
        onNavigate={(resultUrl) => {
          setUrlInput(resultUrl);
          handleNavigate(resultUrl);
        }}
        onNewSearch={handleSearch}
      />
    );
  }

  // Main browser view
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Global label listener for prototype mode */}
      <LabelListener />
      <BrowserHeader
        currentView={currentView}
        displayUrl={displayUrl}
        urlInput={urlInput}
        onUrlChange={setUrlInput}
        onSubmit={handleFormSubmit}
        onBack={handleGoBack}
        onForward={handleGoForward}
        onRefresh={handleRefresh}
        onHome={handleHome}
        onScan={currentView === 'browse' ? handleScanPage : undefined}
        canGoBack={navCanGoBack || currentView !== 'home'}
        canGoForward={navCanGoForward}
        isLoading={isLoading || isChecking || webViewState.isLoading}
        isScanning={isScanning}
        isProtected={settings.shield_active}
        modeLabel={getModeLabel()}
        modeColor={getModeColor()}
      />
      
      {/* AI Moderation Status Bar - shown during browse mode */}
      {currentView === 'browse' && isModerationEnabled() && (
        <AIStatusBar
          modelState={moderationBridge.modelState}
          isScanning={moderationBridge.isScanning || isScanning}
          scannedCount={moderationBridge.scannedCount}
          totalCount={moderationBridge.scannedCount + moderationBridge.pendingCount}
          blurredCount={moderationBridge.blurredCount}
          safeCount={moderationBridge.scannedCount - moderationBridge.blurredCount}
          onScan={handleScanPage}
          compact
        />
      )}

      <main className="flex-1 relative pb-16">
        {currentView === 'blocked' ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 bg-gradient-to-b from-destructive/10 to-background">
            <div className="text-center max-w-sm">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-destructive/20 flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-destructive" />
              </div>
              <h2 className="font-display text-2xl tracking-wider text-destructive mb-2">
                SITE BLOCKED
              </h2>
              <p className="text-sm text-muted-foreground mb-4">{blockedReason}</p>
              <div className="inline-block px-4 py-2 bg-destructive/10 border border-destructive/30 text-destructive text-xs font-display tracking-wider">
                CATEGORY: {blockedCategory.toUpperCase()}
              </div>
              <p className="text-xs text-silver mt-6">
                This site has been blocked by GoodCreation protection.
              </p>
              <button
                onClick={handleHome}
                className="mt-6 px-6 py-3 border border-silver/30 text-silver hover:text-foreground hover:border-silver/60 transition-colors font-display text-sm tracking-wider"
              >
                GO HOME
              </button>
            </div>
          </div>
        ) : currentView === 'fallback' ? (
          <FallbackModeUI
            url={fallbackUrl}
            onReaderMode={handleReaderMode}
            onHome={handleHome}
            isLoading={isLoadingReader}
            error={readerError}
          />
        ) : currentView === 'browse' ? (
          // Native WebView is handled externally - show placeholder when WebView is open
          isNative && webViewState.isOpen ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background">
              <div className="text-center">
                <Loader2 className="w-8 h-8 mx-auto mb-3 text-aqua animate-spin" />
                <p className="text-sm text-muted-foreground font-display tracking-wider">
                  BROWSING IN WEBVIEW
                </p>
                <p className="text-xs text-silver mt-2 max-w-xs mx-auto truncate px-4">
                  {webViewState.currentUrl}
                </p>
              </div>
            </div>
          ) : (
            // Web fallback message
            <div className="absolute inset-0 flex items-center justify-center p-6 bg-background">
              <div className="text-center max-w-md">
                <Globe className="w-16 h-16 mx-auto mb-4 text-aqua" />
                <h2 className="font-display text-xl tracking-wider mb-3">
                  NATIVE WEBVIEW REQUIRED
                </h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Full browser functionality requires the native mobile app. 
                  Use Reader Mode to view content on web.
                </p>
                <button
                  onClick={() => {
                    setFallbackUrl(currentUrl);
                    navigate('fallback', '', currentUrl);
                  }}
                  className="px-6 py-3 bg-aqua text-accent-foreground font-display text-sm tracking-wider hover:bg-aqua/90 transition-colors"
                >
                  USE READER MODE
                </button>
              </div>
            </div>
          )
        ) : (
          <SafeBrowserHomepage onSearch={handleSearch} isSearching={isSearching} />
        )}

        {/* Only show loading overlay for home view - browse view loads in background */}
        {isLoading && currentView === 'home' && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
            <div className="text-center">
              <Shield className="w-12 h-12 mx-auto mb-3 text-aqua animate-pulse" />
              <p className="text-sm text-muted-foreground font-display tracking-wider">LOADING...</p>
            </div>
          </div>
        )}
      </main>

      {/* External link warning modal */}
      <ExternalLinkWarning
        isOpen={!!externalWarningUrl}
        url={externalWarningUrl || ''}
        onConfirm={() => externalWarningUrl && confirmExternalOpen(externalWarningUrl)}
        onClose={() => setExternalWarningUrl(null)}
      />
    </div>
  );
};
