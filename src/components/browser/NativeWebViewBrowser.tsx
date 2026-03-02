import { useState, useCallback, useEffect, useRef } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import LabelListener from '@/components/browser/LabelListener';
import {
  Shield,
  AlertTriangle,
  Loader2,
  Globe,
} from 'lucide-react';
import { useNativeWebView } from '@/hooks/useNativeWebView';
import { useContentProtection } from '@/hooks/useContentProtection';
import { useSettings } from '@/hooks/useSettings';
import { useLocalSettings } from '@/hooks/useLocalSettings';
import { useDeviceId } from '@/hooks/useDeviceId';
import { useBrowserNavigation } from '@/hooks/useBrowserNavigation';
import { useCapacitor } from '@/hooks/useCapacitor';
import { useModerationBridge } from '@/hooks/useModerationBridge';
import { supabase } from '@/integrations/supabase/client';
import { generateModerationScript } from '@/lib/webview-injection-script';
import {
  isValidModerationRequest,
  createResultMessage,
  createBlurOverlayStateMessage,
  isBlurOverlayReadyMessage,
  isSensitivityUpdateMessage,
  escapeForJs,
  mapModerationCategoryToSeverity,
  type ModerationSeverity,
  type ModerationRequestMessage,
} from '@/lib/moderation-request-utils';
import {
  startScanning as startNativeContentFilter,
  stopScanning as stopNativeContentFilter,
  setNSFWSignal as pushNativeNsfwSignal,
  onRiskDecision as onNativeRiskDecision,
  type NsfwProbabilities,
} from '@/plugins/ContentFilter';
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
import { BlurShieldOverlay } from './BlurShieldOverlay';
import { toast } from 'sonner';

const YOUTUBE_HOST_PATTERNS = ['youtube.com', 'youtu.be', 'ytimg.com'];
const isYouTubeUrl = (value?: string) => {
  if (!value) return false;
  const lower = value.toLowerCase();
  for (let i = 0; i < YOUTUBE_HOST_PATTERNS.length; i++) {
    if (lower.includes(YOUTUBE_HOST_PATTERNS[i])) {
      return true;
    }
  }
  return false;
};

const isYouTubeDomainUrl = (value?: string) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  } catch {
    return false;
  }
};

const isYouTubeShortsUrl = (value?: string) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') && parsed.pathname.startsWith('/shorts');
  } catch {
    return false;
  }
};

const isDiagYtBlurEnabledForUrl = (value?: string) => {
  if (!isYouTubeShortsUrl(value)) return false;
  if (typeof window === 'undefined') return false;
  try {
    const maybeFlag = (window as unknown as Record<string, unknown>).DIAG_YT_BLUR;
    if (maybeFlag === 1 || maybeFlag === '1') return true;
    if (window.localStorage && window.localStorage.getItem('DIAG_YT_BLUR') === '1') return true;
  } catch {
    return false;
  }
  return false;
};

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
  const { isNative } = useCapacitor();
  // Page-wide DOM blur/overlay is disabled; per-element blur remains in injection script.
  const ENABLE_DOM_BLUR = false;
  const ENABLE_SIGNAL_PIPELINE = true;
  
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
  const {
    settings: localSettings,
    isLoaded: settingsLoaded,
    getModerationConfig,
    isModerationEnabled,
    getNonce,
    updateSetting,
  } = useLocalSettings();
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
  const riskDecisionListenerRef = useRef<PluginListenerHandle | null>(null);
  const lastNsfwSignalAtRef = useRef(0);
  const webViewPageEpochRef = useRef(0);
  const stageBFlagDiagEpochRef = useRef<string | null>(null);
  const shortsScanDiagRef = useRef<{ lastScanBatchStartAt: number }>({ lastScanBatchStartAt: 0 });

  const UNSAFE_STREAK_REQUIRED = 2;
  const SAFE_STREAK_REQUIRED = 2;
  const isDebugMode = localSettings.debug_mode === true;
  const debugLog = useCallback((...args: unknown[]) => {
    if (!isDebugMode) return;
    console.log(...args);
  }, [isDebugMode]);

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
      debugLog(
        '[MW-DIAG][HOST] hysteresis signal=unsafe',
        'reason=' + reason,
        'unsafeStreak=' + signal.unsafeStreak,
        'safeStreak=' + signal.safeStreak,
      );
      if (signal.unsafeStreak >= UNSAFE_STREAK_REQUIRED) {
        setCentralBlurState(true, reason);
      }
      return;
    }

    signal.safeStreak += 1;
    signal.unsafeStreak = 0;
    debugLog(
      '[MW-DIAG][HOST] hysteresis signal=safe',
      'reason=' + reason,
      'unsafeStreak=' + signal.unsafeStreak,
      'safeStreak=' + signal.safeStreak,
    );
    if (signal.safeStreak >= SAFE_STREAK_REQUIRED) {
      setCentralBlurState(false, reason);
    }
  }, [setCentralBlurState]);

  const pushNativeSignalCapped = useCallback(async (probs: Partial<NsfwProbabilities>) => {
    const now = Date.now();
    if (now - lastNsfwSignalAtRef.current < 500) return; // max 2 FPS
    lastNsfwSignalAtRef.current = now;
    try {
      console.debug('[NSFW-Signal] pushNativeSignalCapped', probs);
      await pushNativeNsfwSignal(probs);
    } catch (error) {
      console.debug('[NSFW-Signal] push failed', error);
    }
  }, []);
  
  // Moderation bridge for AI image scanning
  const moderationBridge = useModerationBridge({
    onSignal: (probs) => {
      console.debug('[NSFW-Signal] onSignal', probs);
      pushNativeSignalCapped(probs);
    },
    onImageBlurred: (_src, result) => {
      console.debug('[Browser] Image blurred:', result.category);
      if (localSettings.show_scan_notifications) {
        toast.info(`Image blurred: ${result.category}`, {
          duration: 2000,
        });
      }
    },
    onScanComplete: (stats) => {
      console.log('[Browser] Scan complete:', stats);
      if (localSettings.show_scan_notifications && stats.blurred > 0) {
        toast.success(`Scanned ${stats.total} images, ${stats.blurred} blurred`, {
          duration: 3000,
        });
      }
    },
  });

  const scanImageRef = useRef(moderationBridge.scanImage);
  const handleWebViewMessageRef = useRef(moderationBridge.handleWebViewMessage);
  const clearModerationCacheRef = useRef(moderationBridge.clearCache);
  useEffect(() => {
    scanImageRef.current = moderationBridge.scanImage;
    handleWebViewMessageRef.current = moderationBridge.handleWebViewMessage;
    clearModerationCacheRef.current = moderationBridge.clearCache;
  }, [moderationBridge.scanImage, moderationBridge.handleWebViewMessage, moderationBridge.clearCache]);
  
  // Track if moderation script was injected
  const injectionDoneRef = useRef(false);
  const injectionInFlightRef = useRef(false);
  const lastInjectedUrlRef = useRef('');
  const lastInjectionAtRef = useRef(0);
  const duplicateInjectionSkipsRef = useRef(0);
  const didInjectAfterSettingsLoadedRef = useRef(false);
  const loadEndInjectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const transportProbeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const transportProbeIssuedAtRef = useRef(0);
  const lastDirectTransportAtRef = useRef(0);
  const legacyPollHoldUntilRef = useRef(0);
  const navigationSeqRef = useRef(0);
  const activeNavIdRef = useRef(0);
  const currentUrlRef = useRef('');
  const webViewActiveInstanceIdRef = useRef<number | null>(null);
  const [legacyPollEnabled, setLegacyPollEnabled] = useState(false);
  const legacyPollEnabledRef = useRef(false);
  const diagYtBlurEpochRef = useRef({
    staleHostRejectCount: 0,
    epochHeldCount: 0,
    epochIncrementedCount: 0,
  });
  const messageFromWebViewHandlerRef = useRef<((payload: unknown) => void) | null>(null);

  const setLegacyPollFallback = useCallback((enabled: boolean, reason: string) => {
    if (legacyPollEnabledRef.current === enabled) return;
    legacyPollEnabledRef.current = enabled;
    if (enabled) {
      legacyPollHoldUntilRef.current = Date.now() + 20000;
    }
    setLegacyPollEnabled(enabled);
    console.log(
      '[MW-Host][FallbackPoll]',
      enabled ? 'enabled' : 'disabled',
      'reason=' + reason,
      'navId=' + activeNavIdRef.current,
      'url=' + (currentUrlRef.current || 'unknown'),
    );
  }, []);

  const clearTransportProbeTimer = useCallback(() => {
    if (!transportProbeTimerRef.current) return;
    clearTimeout(transportProbeTimerRef.current);
    transportProbeTimerRef.current = null;
  }, []);

  const scheduleTransportProbe = useCallback((reason: string, targetUrl: string) => {
    clearTransportProbeTimer();
    const issuedAt = Date.now();
    transportProbeIssuedAtRef.current = issuedAt;
    transportProbeTimerRef.current = setTimeout(() => {
      transportProbeTimerRef.current = null;
      if (lastDirectTransportAtRef.current >= issuedAt) return;
      console.warn(
        '[MW-Host][Transport] probe timeout; enabling fallback poll',
        'reason=' + reason,
        'targetUrl=' + (targetUrl || 'unknown'),
        'navId=' + activeNavIdRef.current,
      );
      setLegacyPollFallback(true, 'transport_probe_timeout:' + reason);
    }, 3500);
  }, [clearTransportProbeTimer, setLegacyPollFallback]);

  const markDirectTransportHealthy = useCallback((reason: string) => {
    lastDirectTransportAtRef.current = Date.now();
    if (legacyPollEnabledRef.current && Date.now() >= legacyPollHoldUntilRef.current) {
      setLegacyPollFallback(false, 'direct_transport:' + reason);
    }
  }, [setLegacyPollFallback]);
  
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
  const clearLoadEndInjectTimer = useCallback(() => {
    if (loadEndInjectTimerRef.current) {
      clearTimeout(loadEndInjectTimerRef.current);
      console.log(
        '[MW-Host][Timer] stop',
        'name=loadEndInjectTimer',
        'navId=' + activeNavIdRef.current,
        'url=' + (lastInjectedUrlRef.current || 'unknown'),
      );
      loadEndInjectTimerRef.current = null;
    }
  }, []);

  const markNavigation = useCallback((reason: string, url: string) => {
    const previousUrl = currentUrlRef.current || '';
    const previousEpoch = webViewPageEpochRef.current || 0;
    const sameUrl = !!previousUrl && previousUrl === url;
    const holdEpoch =
      reason === 'onUrlChange' &&
      (
        sameUrl ||
        (isYouTubeShortsUrl(previousUrl) && isYouTubeShortsUrl(url))
      );
    navigationSeqRef.current += 1;
    activeNavIdRef.current = navigationSeqRef.current;
    if (!holdEpoch || previousEpoch <= 0) {
      webViewPageEpochRef.current = activeNavIdRef.current;
      if (isDiagYtBlurEnabledForUrl(url || previousUrl)) {
        diagYtBlurEpochRef.current.epochIncrementedCount += 1;
        console.log(
          '[MW-YT][DIAG][EPOCH][HOST]',
          'action=epoch_incremented',
          'count=' + diagYtBlurEpochRef.current.epochIncrementedCount,
          'reason=' + reason,
          'prevEpoch=' + previousEpoch,
          'nextEpoch=' + webViewPageEpochRef.current,
          'prevUrl=' + (previousUrl || 'unknown'),
          'nextUrl=' + (url || 'unknown'),
        );
      }
    } else if (isDiagYtBlurEnabledForUrl(url || previousUrl)) {
      diagYtBlurEpochRef.current.epochHeldCount += 1;
      console.log(
        '[MW-YT][DIAG][EPOCH][HOST]',
        'action=epoch_held',
        'count=' + diagYtBlurEpochRef.current.epochHeldCount,
        'reason=' + reason,
        'epoch=' + previousEpoch,
        'prevUrl=' + (previousUrl || 'unknown'),
        'nextUrl=' + (url || 'unknown'),
      );
    }
    console.log(
      '[MW-Inject][Nav]',
      'navId=' + activeNavIdRef.current,
      'reason=' + reason,
      'targetUrl=' + (url || 'unknown'),
    );
    if (url) {
      currentUrlRef.current = url;
    }
  }, []);

  const injectModerationScript = useCallback(async (
    scriptExecutor: (script: string) => Promise<string | null>,
    reason: string,
    urlHint?: string,
  ) => {
    if (!ENABLE_SIGNAL_PIPELINE) {
      return;
    }
    if (!settingsLoaded) {
      console.log('[MW-Inject][Gate] settings not loaded; skipping inject', 'reason=' + reason);
      return;
    }
    if (!isModerationEnabled()) {
      console.log('[MW-Bridge] Moderation disabled, skipping injection');
      return;
    }

    const targetUrl = urlHint || currentUrlRef.current || '';
    const navId = activeNavIdRef.current || 0;
    const now = Date.now();
    const recentlyInjectedSameUrl =
      injectionDoneRef.current &&
      !!targetUrl &&
      lastInjectedUrlRef.current === targetUrl &&
      now - lastInjectionAtRef.current < 2000;

    if (injectionInFlightRef.current || recentlyInjectedSameUrl) {
      duplicateInjectionSkipsRef.current += 1;
      console.log(
        '[MW-Inject][Skip]',
        'navId=' + navId,
        'reason=' + reason,
        'targetUrl=' + (targetUrl || 'unknown'),
        'skipCount=' + duplicateInjectionSkipsRef.current,
      );
      return;
    }

    injectionInFlightRef.current = true;
    const config = {
      ...getModerationConfig(),
      pageEpoch: webViewPageEpochRef.current,
      diagYouTubeShorts: localSettings.diag_youtube_shorts === true && isYouTubeUrl(targetUrl),
    };
    console.log(
      '[MW-Inject][Config]',
      'enabled=' + config.enabled,
      'sensitivity=' + config.sensitivity,
      'blockingMode=' + config.blockingMode,
      'nonce=' + String(config.nonce || '').substring(0, 10),
      'settingsLoaded=' + settingsLoaded,
      'reason=' + reason,
    );
    // Full moderation script: request scanning + host bridge + DOM blur/reveal behavior.
    const mainScript = generateModerationScript(config);
    try {
      const dispatchResult = await scriptExecutor(mainScript);
      const dispatchConfirmed =
        dispatchResult !== null &&
        String(dispatchResult).trim().length > 0;
      if (!dispatchConfirmed) {
        console.warn(
          '[DIAG][INJECT] dispatch_unconfirmed',
          'reason=' + reason,
          'navId=' + navId,
          'pageEpoch=' + webViewPageEpochRef.current,
          'url=' + (targetUrl || 'unknown'),
          'result=' + String(dispatchResult),
        );
        return;
      }
      injectionDoneRef.current = true;
      lastInjectedUrlRef.current = targetUrl;
      lastInjectionAtRef.current = Date.now();
      scheduleTransportProbe(reason, targetUrl);
      console.log(
        '[MW-Inject][InjectedDispatch]',
        'navId=' + navId,
        'reason=' + reason,
        'targetUrl=' + (targetUrl || 'unknown'),
      );
      console.log(
        '[DIAG][INJECT] dispatch',
        'reason=' + reason,
        'navId=' + navId,
        'pageEpoch=' + webViewPageEpochRef.current,
        'url=' + (targetUrl || 'unknown'),
      );
    } catch (error) {
      console.error('[MW-Bridge] Moderation script injection failed:', error);
    } finally {
      injectionInFlightRef.current = false;
    }
  }, [ENABLE_SIGNAL_PIPELINE, settingsLoaded, isModerationEnabled, getModerationConfig, scheduleTransportProbe]);

  const getWebViewListenerDiagContext = useCallback(() => {
    return {
      navId: activeNavIdRef.current || null,
      url: currentUrlRef.current || '',
      activeInstanceId: webViewActiveInstanceIdRef.current,
    };
  }, []);

  const {
    state: webViewState,
    listenersAttached: webViewListenersAttached,
    open: openWebView,
    close: closeWebView,
    goBack: webViewGoBack,
    goForward: webViewGoForward,
    reload: webViewReload,
    postMessageToWebView,
    executeScript,
    setFlashGuardState,
  } = useNativeWebView({
    onLoadStart: (url) => {
      console.log('[Browser] ======= LOAD START =======');
      console.log('[Browser] URL:', url);
      markNavigation('onLoadStart', url);
      teardownWebViewScheduling('navigation_start', url).catch(() => undefined);
      setIsLoading(true);
      clearLoadEndInjectTimer();
      injectionDoneRef.current = false;
      injectionInFlightRef.current = false;
      blurReadyRef.current = false;
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'navigation_load_start');
      clearTransportProbeTimer();
      setLegacyPollFallback(false, 'navigation_start');
      setFlashGuardState?.(true, 'navigation_start');
      // Early inject to attach per-element pre-blur before first paint.
      if (executeScript) {
        void injectModerationScript(executeScript, 'onLoadStart', url);
      }
    },
    onLoadEnd: async (url) => {
      console.log('[Browser] ======= LOAD END =======');
      console.log('[Browser] URL:', url);
      setIsLoading(false);
      setFlashGuardState?.(false, 'load_end');
      if (!ENABLE_SIGNAL_PIPELINE) return;
      
      // Inject moderation script after page fully loads
      if (!injectionDoneRef.current) {
        // Small delay to ensure DOM is ready
        clearLoadEndInjectTimer();
        loadEndInjectTimerRef.current = setTimeout(async () => {
          await injectModerationScript(executeScript, 'onLoadEnd', url);
          if (ENABLE_DOM_BLUR && executeScript) {
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
          }
          loadEndInjectTimerRef.current = null;
        }, 80);
        console.log(
          '[MW-Host][Timer] start',
          'name=loadEndInjectTimer',
          'navId=' + activeNavIdRef.current,
          'url=' + (url || 'unknown'),
        );
      }
    },
    onLoadError: (url, error) => {
      console.error('[Browser] ======= LOAD ERROR =======');
      console.error('[Browser] URL:', url);
      console.error('[Browser] Error:', error);
      setIsLoading(false);
      setFlashGuardState?.(true, 'load_error');
      clearLoadEndInjectTimer();
      clearTransportProbeTimer();
      injectionDoneRef.current = false;
      injectionInFlightRef.current = false;
      setFallbackUrl(url);
      navigate('fallback', '', url);
    },
    onUrlChange: (url) => {
      console.log('[Browser] ======= URL CHANGE =======');
      console.log('[Browser] New URL:', url);
      markNavigation('onUrlChange', url);
      setUrlInput(url);
      navigate('browse', url, url);
      // Reset injection for new page navigation
      clearLoadEndInjectTimer();
      injectionDoneRef.current = false;
      injectionInFlightRef.current = false;
      blurReadyRef.current = false;
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'url_change_safe_reset');
    },
    onNavigationRequest: handleNavigationRequest,
    onClose: () => {
      console.log('[Browser] ======= WEBVIEW CLOSED =======');
      teardownWebViewScheduling('webview_closed', webViewState.currentUrl).catch(() => undefined);
      clearLoadEndInjectTimer();
      clearTransportProbeTimer();
      setLegacyPollFallback(false, 'webview_closed');
      clearModerationCacheRef.current();
      injectionDoneRef.current = false;
      injectionInFlightRef.current = false;
      blurReadyRef.current = false;
      blurPendingRef.current = null;
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'webview_closed');
      setFlashGuardState?.(false, 'close');
      navigate('home', '', '');
    },
    onMessageFromWebview: (payload) => {
      if (isDebugMode) {
        console.log('[MW-Host][Capgo] messageFromWebview received');
      }
      messageFromWebViewHandlerRef.current?.(payload);
    },
    onActiveInstanceIdChange: (activeInstanceId) => {
      webViewActiveInstanceIdRef.current = activeInstanceId;
    },
    getListenerDiagContext: getWebViewListenerDiagContext,
  });

  useEffect(() => {
    currentUrlRef.current = webViewState.currentUrl || '';
  }, [webViewState.currentUrl]);

  const lastListenerStateRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastListenerStateRef.current === webViewListenersAttached) return;
    lastListenerStateRef.current = webViewListenersAttached;
    const diagUrl = webViewState.currentUrl || currentUrlRef.current || 'unknown';
    console.log(
      '[DIAG][CHURN]',
      'action=listener_state',
      'reason=' + (webViewListenersAttached ? 'listeners_attached' : 'listeners_detached'),
      'stack=NativeWebViewBrowser.listener_state',
      'listenerKey=messageFromWebview',
      'navId=' + activeNavIdRef.current,
      'url=' + diagUrl,
      'activeInstanceId=' + (webViewActiveInstanceIdRef.current ?? 'none'),
    );
  }, [webViewListenersAttached, webViewState.currentUrl]);

  useEffect(() => {
    if (!webViewState.isOpen) return;
    if (!webViewListenersAttached) return;
    const diagUrl = webViewState.currentUrl || currentUrlRef.current || 'unknown';
    console.log(
      '[DIAG][CHURN]',
      'action=listeners_attached_for_nav',
      'reason=nav_context_update',
      'stack=NativeWebViewBrowser.nav_listener_order',
      'listenerKey=messageFromWebview',
      'navId=' + activeNavIdRef.current,
      'url=' + diagUrl,
      'activeInstanceId=' + (webViewActiveInstanceIdRef.current ?? 'none'),
    );
  }, [webViewState.isOpen, webViewState.currentUrl, webViewListenersAttached]);

  const diagLogTimestampsRef = useRef<Record<string, number>>({});
  const diagLog = useCallback((key: string, message: string) => {
    const now = Date.now();
    const previous = diagLogTimestampsRef.current[key] || 0;
    if (now - previous < 2500) return;
    diagLogTimestampsRef.current[key] = now;
    console.log('[MW-YT][DIAG]', message);
  }, []);
  const shouldLogYouTubeDiag = useCallback((url?: string) => {
    if (localSettings.diag_youtube_shorts !== true) return false;
    const candidate = url || webViewState.currentUrl || currentUrlRef.current || '';
    return isYouTubeUrl(candidate);
  }, [localSettings.diag_youtube_shorts, webViewState.currentUrl]);
  const logYouTubeDiag = useCallback((key: string, message: string, url?: string) => {
    if (!shouldLogYouTubeDiag(url)) return;
    diagLog(key, message);
  }, [shouldLogYouTubeDiag, diagLog]);

  const flashLogLastRef = useRef(0);
  const flashLog = useCallback((msg: string) => {
    const now = Date.now();
    if (now - flashLogLastRef.current < 800) return;
    flashLogLastRef.current = now;
    console.log('[FlashShield][DIAG]', msg);
  }, []);

  const teardownWebViewScheduling = useCallback(async (reason: string, urlHint?: string) => {
    if (!isNative || !executeScript) return;
    const escapedReason = escapeForJs(reason);
    await executeScript(`
      (function() {
        try {
          if (typeof window.__MW_TEARDOWN__ === 'function') window.__MW_TEARDOWN__('${escapedReason}');
          if (typeof window.__MW_SIGNAL_TEARDOWN__ === 'function') window.__MW_SIGNAL_TEARDOWN__('${escapedReason}');
          return 'OK';
        } catch (e) {
          return 'ERR';
        }
      })();
    `);
    console.log(
      '[MW-Host][Timer] teardown',
      'reason=' + reason,
      'navId=' + activeNavIdRef.current,
      'url=' + (urlHint || webViewState.currentUrl || 'unknown'),
    );
  }, [isNative, executeScript, webViewState.currentUrl]);

  useEffect(() => {
    const moderationEnabled = isModerationEnabled();
    const gate =
      settingsLoaded &&
      isNative &&
      webViewState.isOpen &&
      moderationEnabled &&
      localSettings.shield_active &&
      localSettings.blur_dial > 0;

    if (!gate) {
      console.log(
            '[MW][NativeScan] stop gate=' +
          JSON.stringify({
            settingsLoaded,
            isNative,
            webViewOpen: webViewState.isOpen,
            moderationEnabled,
            shieldActive: localSettings.shield_active,
            blurDialActive: localSettings.blur_dial > 0,
          }),
      );
      riskDecisionListenerRef.current?.remove();
      riskDecisionListenerRef.current = null;
      stopNativeContentFilter().catch(() => undefined);
      return;
    }

    let cancelled = false;
    const attach = async () => {
      try {
        console.log(
          '[MW][NativeScan] start gate=' +
            JSON.stringify({
              settingsLoaded,
              isNative,
              webViewOpen: webViewState.isOpen,
              moderationEnabled,
              shieldActive: localSettings.shield_active,
              blurDialActive: localSettings.blur_dial > 0,
            }),
        );
        const startPayload = await startNativeContentFilter({
          preset: 'balanced',
          kidMode: false,
          debug: isDebugMode,
          fps: 1.0,
          allowRevealDuringHardBlur: false,
        });
        console.debug('[ContentFilter] startScanning resolved', startPayload);
        if (cancelled) return;
        riskDecisionListenerRef.current = await onNativeRiskDecision((decision) => {
          console.debug('[ContentFilter] decision', decision.state, decision.riskScore);
        });
      } catch (error) {
        console.debug('[ContentFilter] setup failed', error);
      }
    };
    attach();

    return () => {
      cancelled = true;
      console.log(
        '[MW][NativeScan] stop gate=' +
          JSON.stringify({
            settingsLoaded,
            isNative,
            webViewOpen: webViewState.isOpen,
            moderationEnabled,
            shieldActive: localSettings.shield_active,
            blurDialActive: localSettings.blur_dial > 0,
          }),
      );
      riskDecisionListenerRef.current?.remove();
      riskDecisionListenerRef.current = null;
      stopNativeContentFilter().catch(() => undefined);
    };
  }, [settingsLoaded, isNative, webViewState.isOpen, debugLog, isDebugMode, isModerationEnabled, localSettings.shield_active, localSettings.blur_dial, localSettings.blocking_mode]);

  const requestBlurHandshake = useCallback(async (source: string) => {
    if (!ENABLE_DOM_BLUR) return;
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
  }, [ENABLE_DOM_BLUR, isNative, webViewState.isOpen, executeScript]);

  const flushBlurStateToWebView = useCallback(async () => {
    if (!ENABLE_DOM_BLUR) return;
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

    await executeScript(script);
    blurPendingRef.current = null;
    return;
  }, [ENABLE_DOM_BLUR, isNative, webViewState.isOpen, executeScript]);

  useEffect(() => {
    if (!ENABLE_DOM_BLUR) return;
    if (!isNative || !webViewState.isOpen) return;
    if (!blurReadyRef.current) return;
    flushBlurStateToWebView();
  }, [ENABLE_DOM_BLUR, blurSyncVersion, isNative, webViewState.isOpen, flushBlurStateToWebView]);

  useEffect(() => {
    if (!ENABLE_DOM_BLUR) return;
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
  }, [ENABLE_DOM_BLUR, isNative, webViewState.isOpen, requestBlurHandshake, queueCurrentBlurState, flushBlurStateToWebView]);

  useEffect(() => {
    if (!ENABLE_SIGNAL_PIPELINE) return;
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    if (!webViewListenersAttached) {
      const diagUrl = webViewState.currentUrl || currentUrlRef.current || 'about:blank';
      console.log(
        '[DIAG][CHURN_WINDOW]',
        'action=reinjectTimer_blocked',
        'reason=listeners_not_attached',
        'stack=NativeWebViewBrowser.reinjectTimer',
        'navId=' + activeNavIdRef.current,
        'url=' + diagUrl,
      );
      return;
    }

    const urlHint = webViewState.currentUrl || currentUrlRef.current || 'about:blank';

    debugLog(
      '[MW-DIAG][HOST] pipeline state',
      'domOverlay=' + (ENABLE_DOM_BLUR ? 'on' : 'off'),
      'signalPipeline=' + (ENABLE_SIGNAL_PIPELINE ? 'on' : 'off'),
      'url=' + (urlHint || 'unknown'),
    );

    if (ENABLE_DOM_BLUR) {
      blurReadyRef.current = false;
    }

    const reinjectAndPing = async () => {
      await injectModerationScript(executeScript, 'settings_loaded_reinject_or_urlchange', urlHint);
      if (ENABLE_DOM_BLUR) {
        await requestBlurHandshake('settings_loaded_reinject_or_urlchange');
      }
    };

    console.log(
      '[DIAG][ORDER]',
      'step=listeners_attached',
      'name=reinjectTimer',
      'navId=' + activeNavIdRef.current,
      'url=' + urlHint,
      'listenersAttached=' + webViewListenersAttached,
    );
    const timer = setTimeout(reinjectAndPing, 250);
    console.log(
      '[MW-Host][Timer] start',
      'name=reinjectTimer',
      'navId=' + activeNavIdRef.current,
      'url=' + (urlHint || 'unknown'),
    );
    return () => {
      clearTimeout(timer);
      console.log(
        '[MW-Host][Timer] stop',
        'name=reinjectTimer',
        'navId=' + activeNavIdRef.current,
        'url=' + (urlHint || 'unknown'),
      );
    };
  }, [
    ENABLE_SIGNAL_PIPELINE,
    ENABLE_DOM_BLUR,
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    executeScript,
    webViewListenersAttached,
    injectModerationScript,
    requestBlurHandshake,
    clearLoadEndInjectTimer,
  ]);

  useEffect(() => {
    if (webViewState.isOpen) return;
    didInjectAfterSettingsLoadedRef.current = false;
    clearTransportProbeTimer();
    setLegacyPollFallback(false, 'webview_not_open');
  }, [webViewState.isOpen, clearTransportProbeTimer, setLegacyPollFallback]);

  useEffect(() => {
    if (!ENABLE_SIGNAL_PIPELINE) return;
    if (!settingsLoaded || !isNative || !webViewState.isOpen || !executeScript) return;
    if (didInjectAfterSettingsLoadedRef.current) return;

    const urlHint = webViewState.currentUrl || currentUrlRef.current || 'about:blank';
    didInjectAfterSettingsLoadedRef.current = true;
    console.log(
      '[MW-Inject][SettingsLoadedReinject]',
      'settingsLoaded=' + settingsLoaded,
      'isOpen=' + webViewState.isOpen,
      'url=' + urlHint.substring(0, 80),
    );
    injectModerationScript(executeScript, 'settings_loaded_reinject', urlHint).catch(() => undefined);
  }, [
    ENABLE_SIGNAL_PIPELINE,
    settingsLoaded,
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    executeScript,
    injectModerationScript,
  ]);

  useEffect(() => {
    if (!ENABLE_DOM_BLUR) return;
    if (!isNative || !webViewState.isOpen) return;
    const timer = setInterval(() => {
      if (!blurReadyRef.current) {
        requestBlurHandshake('ready_poll');
      }
    }, 800);
    return () => clearInterval(timer);
  }, [ENABLE_DOM_BLUR, isNative, webViewState.isOpen, requestBlurHandshake]);

  useEffect(() => {
    return () => {
      clearLoadEndInjectTimer();
      clearTransportProbeTimer();
      if (blurRetryTimerRef.current) {
        clearTimeout(blurRetryTimerRef.current);
      }
    };
  }, [clearLoadEndInjectTimer, clearTransportProbeTimer]);

  // ==================== MODERATION MESSAGE HANDLING ====================
  // 
  // We use a hybrid approach for WebView <-> Host communication:
  // 1. Primary: window.postMessage from WebView -> window.addEventListener('message') in host
  // 2. Fallback: Polling global queues via executeScript (for browsers that don't support postMessage)
  //
  // Host -> WebView: executeScript to call window.postMessage inside the page
  // ==================== 

  const pendingRequestsRef = useRef<Set<string>>(new Set());
  
  /**
   * Process a moderation request from the WebView
   * Uses the new postMessage protocol with requestId/itemId tracking
   */
  const processModerationRequest = useCallback(async (request: ModerationRequestMessage, nonce: string) => {
    setFlashGuardState?.(true, 'moderation_request');
    flashLog('armed via moderation_request');
    const timeoutId = setTimeout(() => {
      setFlashGuardState?.(false, 'moderation_request_timeout');
      flashLog('timeout -> disarm');
    }, 8000);

    const { requestId, items, thresholds } = request;
    const requestEpoch = Number.isFinite(request.pageEpoch) ? Number(request.pageEpoch) : null;
    const activeEpoch = webViewPageEpochRef.current;
    const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
    const stickyShortsMode = isYouTubeShortsUrl(activeUrl);
    const relaxedYouTubeEpochMode = isYouTubeDomainUrl(activeUrl);
    
    if (pendingRequestsRef.current.has(requestId)) {
      console.log('[MW-Host] Duplicate request ignored:', requestId);
      return;
    }
    pendingRequestsRef.current.add(requestId);

    if (requestEpoch !== null && requestEpoch !== activeEpoch && !relaxedYouTubeEpochMode) {
      if (stickyShortsMode) {
        console.log(
          '[DIAG][SHORTS_SCAN] skip',
          'reason=epoch_mismatch',
          'itemId=batch',
          'src=request:' + requestId,
        );
      }
      if (isDiagYtBlurEnabledForUrl(activeUrl)) {
        diagYtBlurEpochRef.current.staleHostRejectCount += 1;
        console.log(
          '[MW-YT][DIAG][EPOCH][HOST]',
          'action=stale_host_reject',
          'count=' + diagYtBlurEpochRef.current.staleHostRejectCount,
          'requestId=' + requestId,
          'requestEpoch=' + requestEpoch,
          'activeEpoch=' + activeEpoch,
          'url=' + (activeUrl || 'unknown'),
        );
      }
      debugLog(
        '[MW-Host][Epoch] stale request ignored',
        'req=' + requestId,
        'requestEpoch=' + requestEpoch,
        'activeEpoch=' + activeEpoch,
      );
      const diagUrl = webViewState.currentUrl || currentUrlRef.current || '';
      logYouTubeDiag(
        'safe_epoch_stale',
        'safe_epoch_stale requestId=' + requestId +
        ' requestEpoch=' + requestEpoch +
        ' activeEpoch=' + activeEpoch +
        ' navId=' + activeNavIdRef.current +
        ' itemCount=' + items.length +
        ' url=' + (diagUrl || 'unknown'),
        diagUrl
      );

      const staleResults = items.map(item => ({
        itemId: item.itemId,
        src: item.src,
        shouldBlur: false,
        category: 'safe_epoch_stale',
        confidence: 0,
        severity: 'safe' as ModerationSeverity,
      }));

      try {
        const staleMessage = createResultMessage(requestId, staleResults, nonce, requestEpoch ?? undefined);
        await postMessageToWebView(staleMessage as unknown as Record<string, unknown>);
      } catch {
        // Fail-open by design for stale requests.
      }

      pendingRequestsRef.current.delete(requestId);
      clearTimeout(timeoutId);
      setFlashGuardState?.(false, 'moderation_epoch_stale');
      flashLog('disarm stale epoch');
      return;
    }
    if (requestEpoch !== null && requestEpoch !== activeEpoch && relaxedYouTubeEpochMode && isDiagYtBlurEnabledForUrl(activeUrl)) {
      console.log(
        '[MW-YT][DIAG][EPOCH][HOST]',
        'action=stale_host_bypass_youtube',
        'requestId=' + requestId,
        'requestEpoch=' + requestEpoch,
        'activeEpoch=' + activeEpoch,
        'scope=' + (stickyShortsMode ? 'shorts' : 'youtube'),
        'url=' + (activeUrl || 'unknown'),
      );
    }
    
    const startTime = performance.now();
    const scanBatchStartTs = Date.now();
    if (stickyShortsMode) {
      console.log(
        '[DIAG][SHORTS_SCAN] scanBatch_start',
        'requestId=' + requestId,
        'itemCount=' + items.length,
      );
      const previousStart = shortsScanDiagRef.current.lastScanBatchStartAt;
      if (previousStart > 0) {
        console.log(
          '[DIAG][SHORTS_SCAN] delta_since_last_scan=' + (scanBatchStartTs - previousStart) + 'ms',
          'requestId=' + requestId,
        );
      }
      shortsScanDiagRef.current.lastScanBatchStartAt = scanBatchStartTs;
    }
    console.log('[MW-Host] request received', requestId, 'items=' + items.length, 'epoch=' + (requestEpoch ?? 'n/a'));
    if (import.meta.env.DEV) {
      const epochKey = String(requestEpoch ?? activeEpoch);
      if (stageBFlagDiagEpochRef.current !== epochKey) {
        stageBFlagDiagEpochRef.current = epochKey;
        console.log(
          '[MW-DIAG][StageB][Flag]',
          'pageEpoch=' + epochKey,
          'requestId=' + requestId,
          'enableSegmentationSignal=' + localSettings.enableSegmentationSignal,
          'grayZoneOnly=' + localSettings.segmentationGrayZoneOnly,
          'throttleMs=' + localSettings.segmentationThrottleMs,
          'maxInputPx=' + localSettings.segmentationMaxInputPx,
          'cacheTtlMs=' + localSettings.segmentationCacheTtlMs,
          'devBuild=' + String(!!import.meta.env.DEV),
        );
      }
    }
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
      severity: ModerationSeverity;
      predictions?: Record<string, number>;
      model_version?: string;
      thresholds?: Record<string, unknown>;
      decision_reason?: string;
      image_width?: number;
      image_height?: number;
      host?: string;
      ts?: number;
      diagnostics?: Record<string, unknown>;
    }> = [];
    
    // Process each item using the moderation bridge
    for (const item of items) {
      try {
        const scanResult = await scanImageRef.current(item.src, thresholds, {
          requestId,
          itemId: item.itemId,
          pageEpoch: requestEpoch ?? activeEpoch,
          sourceType: item.sourceType,
        });
        
        if (scanResult) {
          const categoryConfidence = Object.entries(scanResult.predictions || {}).reduce((matched, [label, value]) => {
            if (matched >= 0) return matched;
            return label.toLowerCase() === scanResult.category.toLowerCase() ? value : -1;
          }, -1);
          const effectiveConfidence = categoryConfidence >= 0 ? categoryConfidence : scanResult.confidence;
          results.push({
            itemId: item.itemId,
            src: item.src,
            shouldBlur: scanResult.shouldBlur,
            category: scanResult.category,
            confidence: effectiveConfidence,
            severity: scanResult.severity || mapModerationCategoryToSeverity(scanResult.category),
            predictions: scanResult.predictions,
            model_version: scanResult.modelVersion,
            thresholds: scanResult.thresholdsUsed,
            decision_reason: scanResult.decisionReason || scanResult.reason,
            image_width: typeof scanResult.diagnostics?.imageWidth === 'number' ? scanResult.diagnostics.imageWidth : item.width,
            image_height: typeof scanResult.diagnostics?.imageHeight === 'number' ? scanResult.diagnostics.imageHeight : item.height,
            host: typeof scanResult.diagnostics?.host === 'string' ? scanResult.diagnostics.host : (() => {
              try { return new URL(item.src).hostname; } catch { return undefined; }
            })(),
            ts: Date.now(),
            diagnostics: scanResult.diagnostics,
          });
          console.log('[MW-Host] scan result', item.itemId, ':', scanResult.category, 'blur=' + scanResult.shouldBlur, 'conf=' + effectiveConfidence.toFixed(3));
        } else {
          const shouldBlurOnFailure = localSettings.fail_closed === true;
          results.push({
            itemId: item.itemId,
            src: item.src,
            shouldBlur: shouldBlurOnFailure,
            category: shouldBlurOnFailure ? 'error_fail_closed' : 'error',
            confidence: shouldBlurOnFailure ? 1 : 0,
            severity: shouldBlurOnFailure ? 'hard' : 'safe',
          });
          console.log('[MW-Host] scan result', item.itemId, ': error (no result), failClosed=' + shouldBlurOnFailure);
        }
      } catch (error) {
        const shouldBlurOnFailure = localSettings.fail_closed === true;
        console.log('[MW-Host] scan error', item.itemId, ':', error);
        results.push({
          itemId: item.itemId,
          src: item.src,
          shouldBlur: shouldBlurOnFailure,
          category: shouldBlurOnFailure ? 'error_fail_closed' : 'error',
          confidence: shouldBlurOnFailure ? 1 : 0,
          severity: shouldBlurOnFailure ? 'hard' : 'safe',
        });
      }
    }
    
    const elapsedMs = performance.now() - startTime;
    console.log('[MW-Host] scan complete', requestId, 'elapsed=' + elapsedMs.toFixed(0) + 'ms');
    if (stickyShortsMode) {
      console.log(
        '[DIAG][SHORTS_SCAN] scanBatch_end',
        'requestId=' + requestId,
        'elapsed=' + elapsedMs.toFixed(0) + 'ms',
      );
    }

    const blurMode = localSettings.blur_mode || 'balanced';
    const modePolicy = blurMode === 'strict'
      ? {
          hardConfFloor: 0.90,
          hardMultiConfFloor: 0.80,
          hardMultiMinHits: 2,
          softConfFloor: 0.65,
          softRatioFloor: 0.35,
          softMinHits: 3,
          allowSoftOverlay: true,
        }
      : blurMode === 'minimal'
        ? {
            hardConfFloor: 0.95,
            hardMultiConfFloor: 0.90,
            hardMultiMinHits: 3,
            softConfFloor: 0.80,
            softRatioFloor: 0.75,
            softMinHits: 6,
            allowSoftOverlay: false,
          }
        : {
            hardConfFloor: 0.85,
            hardMultiConfFloor: 0.78,
            hardMultiMinHits: 2,
            softConfFloor: 0.70,
            softRatioFloor: 0.50,
            softMinHits: 4,
            allowSoftOverlay: true,
          };

    const hardThresholdBase = typeof localSettings.hard_overlay_confidence_threshold === 'number'
      ? localSettings.hard_overlay_confidence_threshold
      : modePolicy.hardConfFloor;
    const softRatioBase = typeof localSettings.soft_overlay_ratio_threshold === 'number'
      ? localSettings.soft_overlay_ratio_threshold
      : modePolicy.softRatioFloor;
    const softMinHitsBase = typeof localSettings.soft_overlay_min_hits === 'number'
      ? localSettings.soft_overlay_min_hits
      : modePolicy.softMinHits;

    const hardConfThreshold = Math.max(hardThresholdBase, modePolicy.hardConfFloor);
    const softRatioThreshold = Math.max(softRatioBase, modePolicy.softRatioFloor);
    const softMinHits = Math.max(softMinHitsBase, modePolicy.softMinHits, 2);
    const softConfidenceFloor = modePolicy.softConfFloor;
    const tinyDimensionThreshold = 80;

    const itemSizeById = new Map(request.items.map(item => [item.itemId, item]));
    const eligibleResults = results.filter(item => {
      const requestItem = itemSizeById.get(item.itemId);
      if (!requestItem) return true;
      const width = typeof requestItem.width === 'number' ? requestItem.width : 0;
      const height = typeof requestItem.height === 'number' ? requestItem.height : 0;
      if (width <= 0 || height <= 0) return true;
      return width >= tinyDimensionThreshold && height >= tinyDimensionThreshold;
    });
    const denominator = eligibleResults.length > 0 ? eligibleResults.length : results.length;
    const tinyExcludedCount = Math.max(results.length - eligibleResults.length, 0);
    if (stickyShortsMode && tinyExcludedCount > 0) {
      console.log(
        '[DIAG][SHORTS_SCAN] skip',
        'reason=tinyExcluded',
        'itemId=batch',
        'src=request:' + requestId,
        'count=' + tinyExcludedCount,
      );
    }

    const hardResults = eligibleResults.filter(item => item.shouldBlur && item.severity === 'hard');
    const hardStrongHits = hardResults.filter(item => item.confidence >= hardConfThreshold);
    const hardLowHits = hardResults.filter(item => item.confidence >= modePolicy.hardMultiConfFloor);
    const hardUnsafeMaxConf = hardResults.reduce((max, item) => Math.max(max, item.confidence), 0);

    const softResults = eligibleResults.filter(item => item.shouldBlur && item.severity === 'soft');
    const softQualifiedHits = softResults.filter(item => item.confidence >= softConfidenceFloor);
    const softRatio = denominator > 0 ? softQualifiedHits.length / denominator : 0;

    const hardOverlayDecision =
      hardStrongHits.length >= 1 ||
      hardLowHits.length >= modePolicy.hardMultiMinHits;
    const softOverlayDecision =
      modePolicy.allowSoftOverlay &&
      softQualifiedHits.length >= softMinHits &&
      softRatio >= softRatioThreshold;

    let overlayDecision = hardOverlayDecision;
    let decisionReason = 'no_hard_signal';
    if (hardStrongHits.length > 0) {
      decisionReason = 'hard_confidence_hit';
    } else if (hardLowHits.length >= modePolicy.hardMultiMinHits) {
      decisionReason = 'hard_multi_hit';
    } else if (softOverlayDecision) {
      overlayDecision = true;
      decisionReason = 'soft_ratio_hit';
    }

    const shouldDebugScanSummary = isDebugMode || localSettings.prototype_mode || localSettings.show_scan_notifications;
    if (shouldDebugScanSummary) {
      const shortUrl = (() => {
        try {
          return new URL(currentUrl).hostname;
        } catch {
          return (currentUrl || '').replace(/^https?:\/\//, '').split('/')[0] || 'unknown';
        }
      })();
      console.log(
        `[MW-Host][ScanSummary] url=${shortUrl} req=${requestId} total=${results.length} eligible=${denominator} tinyExcluded=${tinyExcludedCount} hardHits=${hardStrongHits.length} softHits=${softQualifiedHits.length} safeHits=${Math.max(denominator - hardStrongHits.length - softQualifiedHits.length, 0)} hardMax=${hardUnsafeMaxConf.toFixed(3)} softMax=${softQualifiedHits.reduce((max, item) => Math.max(max, item.confidence), 0).toFixed(3)} softRatio=${softRatio.toFixed(3)} mode=${blurMode} decision=${overlayDecision ? 'ON' : 'OFF'} reason=${decisionReason}`
      );
    }

    // Hysteresis is based on hard conditions only.
    if (hardOverlayDecision) {
      processModerationSafetySignal(true, `moderation_request_hard:${decisionReason}`);
    } else {
      processModerationSafetySignal(false, 'moderation_request_no_hard');
    }

    // Optional strict mode: temporary page-level soft confirmation (no hysteresis stickiness).
    if (!hardOverlayDecision) {
      if (softOverlayDecision) {
        setCentralBlurState(true, 'moderation_request_soft_policy');
      } else if (blurStateRef.current.reason.startsWith('moderation_request_soft_')) {
        setCentralBlurState(false, 'moderation_request_soft_cleared');
      }
    }

    debugLog(
      '[MW-DIAG][HOST] decision source=' + (overlayDecision ? 'overlay_on' : 'overlay_off'),
      'reason=' + decisionReason,
      'hardDecision=' + hardOverlayDecision,
      'softDecision=' + softOverlayDecision,
      'hardStrong=' + hardStrongHits.length,
      'hardLow=' + hardLowHits.length,
      'softQualified=' + softQualifiedHits.length,
      'domOverlay=' + (ENABLE_DOM_BLUR ? 'on' : 'off'),
      'epoch=' + (requestEpoch ?? activeEpoch),
    );
    
    // Post results back to the WebView with nonce for security
    console.log('[MW-Host] posting results back', requestId, 'count=' + results.length, 'nonce=' + nonce.substring(0, 10));
    
    try {
      const resultMessage = createResultMessage(requestId, results, nonce, requestEpoch ?? undefined);
      const posted = await postMessageToWebView(resultMessage as unknown as Record<string, unknown>);
      if (posted) {
        console.log('[MW-Host] Results posted via postMessage for', requestId);
      } else {
        console.warn('[MW-Host] Results postMessage returned false for', requestId);
      }
    } catch (error) {
      console.log('[MW-Host] Failed to post results via postMessage:', error);
    }
    
    pendingRequestsRef.current.delete(requestId);
    clearTimeout(timeoutId);
    setFlashGuardState?.(false, 'moderation_results');
    flashLog('disarm after results');
  }, [
    postMessageToWebView,
    debugLog,
    isDebugMode,
    localSettings.fail_closed,
    localSettings.hard_overlay_confidence_threshold,
    localSettings.soft_overlay_ratio_threshold,
    localSettings.soft_overlay_min_hits,
    localSettings.blur_mode,
    localSettings.prototype_mode,
    localSettings.show_scan_notifications,
    localSettings.enableSegmentationSignal,
    localSettings.segmentationGrayZoneOnly,
    localSettings.segmentationThrottleMs,
    localSettings.segmentationMaxInputPx,
    localSettings.segmentationCacheTtlMs,
    currentUrl,
    processModerationSafetySignal,
    setCentralBlurState,
    setFlashGuardState,
    flashLog,
  ]);

  /**
   * Handle messages from WebView via Capgo `messageFromWebview`.
   * Keep window.postMessage listener as fallback for non-Capgo contexts.
   */
  useEffect(() => {
    if (!ENABLE_SIGNAL_PIPELINE) return;
    const sessionNonce = getNonce();

    const unwrapPayload = (payload: unknown): unknown => {
      if (!payload || typeof payload !== 'object') return payload;
      const withDetail = payload as { detail?: unknown };
      if (typeof withDetail.detail === 'object' && withDetail.detail !== null) {
        return withDetail.detail;
      }
      if (Object.keys(payload).length === 1 && 'detail' in withDetail) {
        return withDetail.detail;
      }
      return payload;
    };

    const handleIncomingMessage = async (rawPayload: unknown, source: 'capgo' | 'window') => {
      const message = unwrapPayload(rawPayload);
      if (!message || typeof message !== 'object') return;

      const typedMessage = message as Record<string, unknown>;
      if (typedMessage.type === 'MW_INJECTED_ACK') {
        markDirectTransportHealthy('injected_ack:' + source);
        console.log(
          '[MW-Host][ACK] MW_INJECTED_ACK',
          'source=' + source,
          'navId=' + String(typedMessage.navId ?? 'none'),
          'pageEpoch=' + String(typedMessage.pageEpoch ?? 'none'),
          'noncePrefix=' + String(typedMessage.noncePrefix ?? 'none'),
          'url=' + String(typedMessage.url ?? 'unknown'),
        );
        return;
      }
      if (typedMessage.type === 'MW_REQ_SENT') {
        markDirectTransportHealthy('req_sent:' + source);
        console.log(
          '[MW-Host][REQ] MW_REQ_SENT',
          'source=' + source,
          'requestId=' + String(typedMessage.requestId ?? 'none'),
          'navId=' + String(typedMessage.navId ?? 'none'),
          'pageEpoch=' + String(typedMessage.pageEpoch ?? 'none'),
          'noncePrefix=' + String(typedMessage.noncePrefix ?? 'none'),
          'items=' + String(typedMessage.itemCount ?? '0'),
        );
        return;
      }
      if (typedMessage.type === 'MW_REQ_TIMEOUT') {
        setLegacyPollFallback(true, 'mw_req_timeout:' + source);
        console.warn(
          '[MW-Host][REQ] MW_REQ_TIMEOUT',
          'source=' + source,
          'requestId=' + String(typedMessage.requestId ?? 'none'),
          'navId=' + String(typedMessage.navId ?? 'none'),
          'pageEpoch=' + String(typedMessage.pageEpoch ?? 'none'),
          'noncePrefix=' + String(typedMessage.noncePrefix ?? 'none'),
          'items=' + String(typedMessage.itemCount ?? '0'),
        );
        return;
      }

      if (ENABLE_DOM_BLUR && isBlurOverlayReadyMessage(message)) {
        blurReadyRef.current = true;
        console.log('[MW-Host] Blur overlay READY:', String(typedMessage.reason || 'ready'), String(typedMessage.url || ''));
        queueCurrentBlurState('webview_ready_sync');
        await flushBlurStateToWebView();
        return;
      }

      if (typedMessage.type === 'gc-label-request' && source === 'capgo') {
        // Forward to app window listeners (Prototype Label modal) without re-posting to webview.
        window.dispatchEvent(new MessageEvent('message', { data: typedMessage }));
        return;
      }

      if (typedMessage.type === 'gc-correction-feedback') {
        markDirectTransportHealthy('correction_feedback:' + source);
        console.log('[MW-Host] correction feedback received');
        return;
      }
      
      if (isValidModerationRequest(message)) {
        if (message.nonce !== sessionNonce) {
          console.warn('[MW-Host] NONCE MISMATCH - rejecting request:', message.requestId, 'source=' + source);
          console.warn('[MW-Host] Expected:', sessionNonce.substring(0, 10), 'Got:', (message.nonce || 'none').substring(0, 10));
          return;
        }
        console.log(
          '[MW-Host] Received moderation request:',
          message.requestId,
          'noncePrefix=' + String(message.nonce || '').substring(0, 6),
          'pageEpoch=' + String(message.pageEpoch ?? 'none'),
          'source=' + source,
        );
        markDirectTransportHealthy('moderation_request:' + source);
        await processModerationRequest(message, message.nonce);
        return;
      }

      if (isSensitivityUpdateMessage(message)) {
        const level = Math.max(0, Math.min(4, Math.round(message.level)));
        if (level !== localSettings.blur_dial) {
          console.log('[MW-Host] Received sensitivity update from page:', level, message.reason || 'overlay_toggle');
          updateSetting('blur_dial', level);
        }
        return;
      }
      
      if (typedMessage.type === 'gc-moderation-request' && typedMessage.action === 'scan') {
        markDirectTransportHealthy('legacy_scan_request:' + source);
        console.log('[MW-Host] Received legacy moderation request via postMessage');
        const result = await handleWebViewMessageRef.current(message);
        
        if (result) {
          const rawSrc = String(result.src || '');
          const messageId = 'messageId' in result && typeof result.messageId === 'number' ? result.messageId : 0;
          try {
            await postMessageToWebView({
              type: 'gc-moderation-result',
              messageId,
              src: rawSrc,
              shouldBlur: result.shouldBlur,
              category: result.category,
              confidence: result.confidence,
            });
            console.log('[MW-Host] Sent legacy moderation result for:', rawSrc.substring(0, 50));
          } catch (error) {
            console.debug('[MW-Host] Failed to send legacy moderation result:', error);
          }
        }
      }
    };

    messageFromWebViewHandlerRef.current = (payload: unknown) => {
      void handleIncomingMessage(payload, 'capgo');
    };
    const handleWindowMessage = (event: MessageEvent) => {
      void handleIncomingMessage(event.data, 'window');
    };

    window.addEventListener('message', handleWindowMessage);
    return () => {
      messageFromWebViewHandlerRef.current = null;
      window.removeEventListener('message', handleWindowMessage);
    };
  }, [
    ENABLE_SIGNAL_PIPELINE,
    ENABLE_DOM_BLUR,
    processModerationRequest,
    postMessageToWebView,
    getNonce,
    queueCurrentBlurState,
    flushBlurStateToWebView,
    markDirectTransportHealthy,
    setLegacyPollFallback,
  ]);

  /**
   * Fallback: Poll for moderation requests from legacy global queue
   * This is used when postMessage doesn't work reliably
   */
  useEffect(() => {
    if (!ENABLE_SIGNAL_PIPELINE || !isNative || !webViewState.isOpen || !isModerationEnabled() || !legacyPollEnabled) {
      return;
    }
    if (!webViewListenersAttached) {
      const diagUrl = webViewState.currentUrl || currentUrlRef.current || 'unknown';
      debugLog(
        '[DIAG][CHURN_WINDOW]',
        'action=legacyPoll_blocked',
        'reason=listeners_not_attached',
        'stack=NativeWebViewBrowser.legacyPoll',
        'navId=' + activeNavIdRef.current,
        'url=' + diagUrl,
      );
      return;
    }

    console.log('[MW-Host] Starting adaptive legacy queue polling...');
    const MIN_POLL_MS = 300;
    const MAX_POLL_MS = 3000;
    const EMPTY_BACKOFF_MS = 250;
    const HIDDEN_POLL_MS = 2000;
    const IDLE_EMPTY_POLLS = 10;
    const IDLE_NO_ACTIVITY_MS = 15000;
    const IDLE_MIN_POLL_MS = 2000;
    const IDLE_MAX_POLL_MS = 5000;
    const IDLE_BACKOFF_MS = 500;
    let pollDelayMs = MIN_POLL_MS;
    let cancelled = false;
    let pollTimer: NodeJS.Timeout | null = null;
    let pollInFlight = false;
    let consecutiveEmptyPolls = 0;
    let lastActivityAt = Date.now();
    let idleMode = false;
    let idlePollMs = IDLE_MIN_POLL_MS;

    const exitIdleMode = (reason: string) => {
      if (!idleMode) return;
      idleMode = false;
      idlePollMs = IDLE_MIN_POLL_MS;
      pollDelayMs = MIN_POLL_MS;
      consecutiveEmptyPolls = 0;
      console.log('[MW-Host][Poll] exitingIdle', 'reason=' + reason, 'pollMs=' + pollDelayMs);
    };

    const maybeEnterIdleMode = () => {
      if (idleMode) return;
      if (document.visibilityState !== 'visible') return;
      if (consecutiveEmptyPolls < IDLE_EMPTY_POLLS) return;
      if (Date.now() - lastActivityAt < IDLE_NO_ACTIVITY_MS) return;
      idleMode = true;
      idlePollMs = IDLE_MIN_POLL_MS;
      pollDelayMs = idlePollMs;
      console.log('[MW-Host][Poll] enteringIdle', 'pollMs=' + pollDelayMs);
    };

    const onActivity = (reason: string) => {
      lastActivityAt = Date.now();
      exitIdleMode(reason);
    };

    const onScroll = () => onActivity('scroll');
    const onPopState = () => onActivity('popstate');
    const onHashChange = () => onActivity('hashchange');
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onActivity('visible');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled) return;
      if (pollTimer) {
        const diagUrl = webViewState.currentUrl || currentUrlRef.current || '';
        logYouTubeDiag(
          'legacyTimer',
          'legacy-timer timer_pending navId=' + activeNavIdRef.current +
          ' url=' + (diagUrl || 'unknown'),
          diagUrl
        );
        clearTimeout(pollTimer);
      }
      pollTimer = setTimeout(runPollLoop, delayMs);
      debugLog(
        '[MW-Host][Timer] start',
        'name=legacyPollTimer',
        'delayMs=' + delayMs,
        'navId=' + activeNavIdRef.current,
        'listenersAttached=' + webViewListenersAttached,
        'url=' + (webViewState.currentUrl || 'unknown'),
      );
      debugLog(
        '[DIAG][TIMER] start',
        'delayMs=' + delayMs,
        'navId=' + activeNavIdRef.current,
      );
    };

    const pollForRequests = async (): Promise<boolean> => {
      if (!executeScript) return false;
      if (pollInFlight) return false;
      if (!webViewListenersAttached) {
        const diagUrl = webViewState.currentUrl || currentUrlRef.current || 'unknown';
        console.warn(
          '[DIAG][CHURN_WINDOW]',
          'action=legacyPoll_execute_blocked',
          'reason=listeners_detached_before_execute',
          'stack=NativeWebViewBrowser.legacyPoll.pollForRequests',
          'navId=' + activeNavIdRef.current,
          'url=' + diagUrl,
        );
        return false;
      }
      pollInFlight = true;
      
      try {
        if (document.visibilityState !== 'visible') {
          return false;
        }
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
        const diagUrl = webViewState.currentUrl || currentUrlRef.current || '';
        const resultTypeLabel = result === undefined ? 'undefined' : typeof result;
        const previewValue = result === undefined ? 'undefined' : result === null ? 'null' : String(result);
        const trimmedResult = typeof result === 'string' ? result.trim() : '';
        const startsWithObjArr = typeof result === 'string' && trimmedResult.startsWith('[');
        logYouTubeDiag(
          'legacyPoll',
          'legacy-poll type=' + resultTypeLabel +
          ' isUndefined=' + (result === undefined) +
          ' isEMPTY=' + (result === 'EMPTY') +
          ' startsWithObjArr=' + startsWithObjArr +
          ' preview=' + previewValue.substring(0, 24) +
          ' url=' + (diagUrl || 'unknown'),
          diagUrl
        );
        
        if (!result || result === 'EMPTY' || result === 'null') {
          return false;
        }
        
        let items;
        try {
          items = JSON.parse(result);
        } catch (e) {
          return false;
        }
        
        if (!Array.isArray(items) || items.length === 0) {
          return false;
        }
        
        debugLog('[MW-Host] Legacy poll found items', 'count=' + items.length);
        
        // Process each scan request
        for (const item of items) {
          const { src, thresholds } = item;
          
          if (!src) continue;

          const scanResult = await scanImageRef.current(src, thresholds, {
            requestId: 'legacy_poll',
            itemId: typeof item.itemId === 'string' ? item.itemId : 'legacy_item',
            pageEpoch: webViewPageEpochRef.current,
            sourceType: typeof item.sourceType === 'string' ? item.sourceType : 'unknown',
          });
          
          if (scanResult) {
            debugLog(
              '[MW-Host] Legacy scan result',
              'blur=' + scanResult.shouldBlur,
              'category=' + scanResult.category,
            );
            
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
              debugLog('[MW-Host] Legacy result pushed', src.substring(0, 50));
            } catch (e) {
              console.debug('[MW-Host] Failed to push legacy result:', e);
            }
          }
        }
        return true;
      } catch (e) {
        // Polling errors are expected and ignored in some cases
        console.debug('[MW-Host] Legacy poll error:', e);
        return false;
      } finally {
        pollInFlight = false;
      }
    };

    const runPollLoop = async () => {
      if (cancelled) return;
      const hadWork = await pollForRequests();
      if (document.visibilityState !== 'visible') {
        pollDelayMs = HIDDEN_POLL_MS;
      } else if (hadWork) {
        lastActivityAt = Date.now();
        consecutiveEmptyPolls = 0;
        exitIdleMode('request');
        pollDelayMs = MIN_POLL_MS;
      } else {
        consecutiveEmptyPolls += 1;
        maybeEnterIdleMode();
        if (idleMode) {
          idlePollMs = Math.min(idlePollMs + IDLE_BACKOFF_MS, IDLE_MAX_POLL_MS);
          pollDelayMs = idlePollMs;
        } else {
          pollDelayMs = Math.min(pollDelayMs + EMPTY_BACKOFF_MS, MAX_POLL_MS);
        }
      }
      scheduleNextPoll(pollDelayMs);
    };
    console.log(
      '[DIAG][ORDER]',
      'step=listeners_attached',
      'name=legacyPollTimer',
      'navId=' + activeNavIdRef.current,
      'url=' + (webViewState.currentUrl || currentUrlRef.current || 'unknown'),
      'listenersAttached=' + webViewListenersAttached,
    );
    scheduleNextPoll(MIN_POLL_MS);

    return () => {
      cancelled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
        debugLog(
          '[MW-Host][Timer] stop',
          'name=legacyPollTimer',
          'navId=' + activeNavIdRef.current,
          'url=' + (webViewState.currentUrl || 'unknown'),
        );
      }
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    ENABLE_SIGNAL_PIPELINE,
    isNative,
    webViewState.isOpen,
    webViewListenersAttached,
    isModerationEnabled,
    executeScript,
    localSettings.blur_strength_px,
    webViewState.currentUrl,
    legacyPollEnabled,
    debugLog,
  ]);

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
    if (/^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}(:\\d+)?/.test(trimmed)) {
      return true;
    }
    
    // localhost
    if (trimmed.startsWith('localhost')) {
      return true;
    }
    
    // Everything else is a search
    return false;
  }, []);

  // Search handler - direct URLs go straight to browser; others search Google
  const handleSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    
    const targetUrl = isUrlInput(trimmed)
      ? (trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
      : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    
    console.log('[Browser] Starting navigation:', targetUrl);
    
    // IMMEDIATELY set view to browse and navigate - fail-open approach
    navigate('browse', targetUrl, targetUrl);
    setUrlInput(targetUrl);
    setIsLoading(true);
    
    await logEvent('search', trimmed, isUrlInput(trimmed) ? 'direct_url' : 'google_redirect');
    
    // Open in native WebView or fallback
    if (isNative) {
      try {
        const success = await openWebView(targetUrl, true);
        if (success) {
          await logEvent('allowed', targetUrl, 'native-webview');
        } else {
          setFallbackUrl(targetUrl);
          navigate('fallback', '', targetUrl);
          await logEvent('fallback', targetUrl, 'webview-failed');
        }
      } catch (error) {
        console.error('[Browser] WebView open error:', error);
        setFallbackUrl(targetUrl);
        setFailureError(error instanceof Error ? error.message : 'Failed to load');
        navigate('failure', '', targetUrl);
        await logEvent('error', targetUrl, 'webview-error');
      }
    } else {
      // On web, use fallback modes
      setFallbackUrl(targetUrl);
      navigate('fallback', '', targetUrl);
      await logEvent('fallback', targetUrl, 'web-platform');
    }
    
    setIsLoading(false);
  }, [navigate, logEvent, isNative, openWebView, isUrlInput]);

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
    teardownWebViewScheduling('home_reset', webViewState.currentUrl).catch(() => undefined);
    if (isNative && webViewState.isOpen) {
      await closeWebView();
    }
    clearTransportProbeTimer();
    setLegacyPollFallback(false, 'home_reset');
    clearModerationCacheRef.current();
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
  }, [
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    closeWebView,
    goHome,
    setCentralBlurState,
    teardownWebViewScheduling,
    clearTransportProbeTimer,
    setLegacyPollFallback,
  ]);

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
      {isNative && currentView === 'browse' && <BlurShieldOverlay executeScript={executeScript} />}
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
