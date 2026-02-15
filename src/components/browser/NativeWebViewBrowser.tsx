import { useState, useCallback, useEffect, useRef } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import LabelListener from '@/components/browser/LabelListener';
import { Shield, AlertTriangle, Loader2, Globe } from 'lucide-react';
import { useNativeWebView } from '@/hooks/useNativeWebView';
import { useContentProtection } from '@/hooks/useContentProtection';
import { useSettings } from '@/hooks/useSettings';
import { useLocalSettings } from '@/hooks/useLocalSettings';
import { useDeviceId } from '@/hooks/useDeviceId';
import { useLocalBlocklist } from '@/hooks/useLocalBlocklist';
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
  const { isNative } = useCapacitor();
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
  const { isBlocked: isLocallyBlocked } = useLocalBlocklist();
  const { settings } = useSettings();
  const {
    settings: localSettings,
    isLoaded: settingsLoaded,
    getModerationConfig,
    isModerationEnabled,
    getNonce,
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
  const ackDiagSeenRef = useRef<Set<string>>(new Set());
  const readyDiagSeenRef = useRef<Set<string>>(new Set());
  const modernHealthDiagSeenRef = useRef<Set<string>>(new Set());
  const modernAckRef = useRef<{ at: number; epoch: number | null }>({ at: 0, epoch: null });
  const modernReadyRef = useRef<{ at: number; epoch: number | null }>({ at: 0, epoch: null });
  const modernHealthyRef = useRef(false);
  const modernTransportActiveUntilRef = useRef(0);
  const modernTransportReasonRef = useRef('none');
  const legacyPollSuppressedUntilRef = useRef(0);
  const legacyPollSuppressionReasonRef = useRef('none');
  const legacyExecBackoffUntilRef = useRef(0);
  const legacyExecBackoffMsRef = useRef(300);
  const legacyPollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const legacyPollOwnerRef = useRef('');
  const legacyPollGenerationRef = useRef(0);
  const legacyPollInFlightRef = useRef(false);
  const legacyExecRecentAtRef = useRef<number[]>([]);
  const legacyExecCooldownUntilRef = useRef(0);
  const legacyPollCrashCooldownUntilRef = useRef(0);
  const legacyLastExecuteAtRef = useRef(0);
  const crashReinjectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const crashReinjectEpochRef = useRef<number | null>(null);
  const [nativeScanProfile, setNativeScanProfile] = useState<'balanced' | 'video_boost'>('balanced');
  const resultQueueRef = useRef<Array<{
    requestId: string;
    payload: Record<string, unknown>;
    queuedAt: number;
    attempts: number;
  }>>([]);
  const resultQueueFlushTimerRef = useRef<NodeJS.Timeout | null>(null);
  const resultQueueFlushCountRef = useRef(0);
  const domainAdultContextRef = useRef(false);
  const nativeScanSessionRef = useRef<{
    running: boolean;
    profile: 'balanced' | 'video_boost' | null;
    configKey: string;
    lastRestartAt: number;
    pendingRestartTimer: NodeJS.Timeout | null;
  }>({
    running: false,
    profile: null,
    configKey: '',
    lastRestartAt: 0,
    pendingRestartTimer: null,
  });
  const videoBoostRef = useRef<{ active: boolean; minHoldTimer: NodeJS.Timeout | null; idleTimer: NodeJS.Timeout | null; lastOnAt: number; lastOffAt: number }>({
    active: false,
    minHoldTimer: null,
    idleTimer: null,
    lastOnAt: 0,
    lastOffAt: 0,
  });

  const UNSAFE_STREAK_REQUIRED = 2;
  const SAFE_STREAK_REQUIRED = 2;
  const MODERN_STALE_MS = 15000;
  const MODERN_LEGACY_SUPPRESS_MS = 12000;
  const MODERN_TRANSPORT_SUPPRESS_MS = 18000;
  const LEGACY_EXEC_BACKOFF_MAX_MS = 4000;
  const VIDEO_BOOST_FPS = 2.0;
  const VIDEO_BALANCED_FPS = 1.0;
  const VIDEO_MIN_ON_MS = 4000;
  const VIDEO_MIN_OFF_MS = 2500;
  const VIDEO_IDLE_RESET_MS = 7000;
  const NATIVE_SCAN_RESTART_DEBOUNCE_MS = 3500;
  const isDebugMode = localSettings.debug_mode === true;
  const ENABLE_DOM_BLUR =
    (localSettings.prototype_mode === true || localSettings.kid_safe_profile === true) &&
    import.meta.env.VITE_ENABLE_DOM_BLUR_OVERLAY === 'true';
  const isRevealAllowed = useCallback(() => {
    if (localSettings.prototype_mode !== true) return false;
    if (localSettings.blur_mode === 'strict') return false;
    return true;
  }, [localSettings.prototype_mode, localSettings.blur_mode]);
  const debugLog = useCallback((...args: unknown[]) => {
    if (!isDebugMode) return;
    console.log(...args);
  }, [isDebugMode]);

  const normalizeShouldBlur = useCallback((value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
      const lowered = value.trim().toLowerCase();
      return lowered === '1' || lowered === 'true';
    }
    return false;
  }, []);

  const normalizeSeverity = useCallback((severity: unknown, category: string): ModerationSeverity => {
    const normalized = String(severity || '').trim().toLowerCase();
    if (normalized === 'hard' || normalized === 'soft' || normalized === 'safe') {
      return normalized as ModerationSeverity;
    }
    return mapModerationCategoryToSeverity(category);
  }, []);

  const markModernTransportActive = useCallback((reason: string, sourceEpoch?: number) => {
    const now = Date.now();
    const activeEpoch = webViewPageEpochRef.current;
    if (Number.isFinite(sourceEpoch) && Number(sourceEpoch) !== activeEpoch) return;
    modernTransportActiveUntilRef.current = Math.max(
      modernTransportActiveUntilRef.current,
      now + MODERN_TRANSPORT_SUPPRESS_MS,
    );
    modernTransportReasonRef.current = reason;
    legacyPollSuppressedUntilRef.current = Math.max(
      legacyPollSuppressedUntilRef.current,
      modernTransportActiveUntilRef.current,
    );
    legacyPollSuppressionReasonRef.current = 'modern_transport:' + reason;
    if (isDebugMode) {
      console.log(
        '[MW-DIAG][HOST][ModernTransport]',
        'activeUntil=' + modernTransportActiveUntilRef.current,
        'reason=' + modernTransportReasonRef.current,
      );
    }
  }, [MODERN_TRANSPORT_SUPPRESS_MS, isDebugMode]);

  const resetModernHealthForNavigation = useCallback((reason: string) => {
    modernAckRef.current = { at: 0, epoch: null };
    modernReadyRef.current = { at: 0, epoch: null };
    modernHealthyRef.current = false;
    modernTransportActiveUntilRef.current = 0;
    modernTransportReasonRef.current = reason;
    legacyPollSuppressedUntilRef.current = 0;
    legacyPollSuppressionReasonRef.current = reason;
    legacyExecBackoffUntilRef.current = 0;
    legacyExecBackoffMsRef.current = 300;
    if (legacyPollTimerRef.current) {
      clearTimeout(legacyPollTimerRef.current);
      legacyPollTimerRef.current = null;
    }
    legacyPollOwnerRef.current = '';
    legacyPollInFlightRef.current = false;
    legacyExecRecentAtRef.current = [];
    legacyExecCooldownUntilRef.current = 0;
    legacyPollCrashCooldownUntilRef.current = 0;
    legacyLastExecuteAtRef.current = 0;
    crashReinjectEpochRef.current = null;
    if (crashReinjectTimerRef.current) {
      clearTimeout(crashReinjectTimerRef.current);
      crashReinjectTimerRef.current = null;
    }
    if (resultQueueFlushTimerRef.current) {
      clearTimeout(resultQueueFlushTimerRef.current);
      resultQueueFlushTimerRef.current = null;
    }
    resultQueueRef.current = [];
    resultQueueFlushCountRef.current = 0;
  }, []);

  const evaluateModernHealth = useCallback((reason: string) => {
    const now = Date.now();
    const activeNavId = activeNavIdRef.current;
    const activeEpoch = webViewPageEpochRef.current;
    const ack = modernAckRef.current;
    const ready = modernReadyRef.current;
    const ackAgeMs = ack.at > 0 ? now - ack.at : -1;
    const readyAgeMs = ready.at > 0 ? now - ready.at : -1;
    const ackFresh = ack.epoch === activeEpoch && ackAgeMs >= 0 && ackAgeMs <= MODERN_STALE_MS;
    const readyFresh = ready.epoch === activeEpoch && readyAgeMs >= 0 && readyAgeMs <= MODERN_STALE_MS;
    const transportActive = now < modernTransportActiveUntilRef.current;
    const nextHealthy = ackFresh && readyFresh;
    const prevHealthy = modernHealthyRef.current;

    modernHealthyRef.current = nextHealthy;
    if (nextHealthy || transportActive) {
      const suppressUntil = nextHealthy
        ? now + MODERN_LEGACY_SUPPRESS_MS
        : modernTransportActiveUntilRef.current;
      legacyPollSuppressedUntilRef.current = Math.max(
        legacyPollSuppressedUntilRef.current,
        suppressUntil,
      );
      legacyPollSuppressionReasonRef.current = nextHealthy ? reason : ('modern_transport:' + modernTransportReasonRef.current);
    } else if (prevHealthy && !nextHealthy && !transportActive) {
      legacyPollSuppressedUntilRef.current = 0;
      legacyPollSuppressionReasonRef.current = reason;
    }

    const diagKey = activeNavId + '|' + activeEpoch;
    const hasSignalAges = ackAgeMs >= 0 || readyAgeMs >= 0;
    if (isDebugMode && hasSignalAges && !modernHealthDiagSeenRef.current.has(diagKey)) {
      modernHealthDiagSeenRef.current.add(diagKey);
      console.log(
        '[MW-DIAG][HOST][ModernHealth]',
        'activeNavId=' + activeNavId,
        'activePageEpoch=' + activeEpoch,
        'ackAgeMs=' + ackAgeMs,
        'readyAgeMs=' + readyAgeMs,
        'transportActive=' + transportActive,
        'transportUntil=' + modernTransportActiveUntilRef.current,
        'modernHealthy=' + nextHealthy,
        'legacyPollingSuppressedUntil=' + legacyPollSuppressedUntilRef.current,
        'reason=' + legacyPollSuppressionReasonRef.current,
      );
    }
  }, [MODERN_STALE_MS, MODERN_LEGACY_SUPPRESS_MS, isDebugMode]);

  const clearVideoBoostTimers = useCallback(() => {
    if (videoBoostRef.current.minHoldTimer) {
      clearTimeout(videoBoostRef.current.minHoldTimer);
      videoBoostRef.current.minHoldTimer = null;
    }
    if (videoBoostRef.current.idleTimer) {
      clearTimeout(videoBoostRef.current.idleTimer);
      videoBoostRef.current.idleTimer = null;
    }
  }, []);

  const setVideoBoost = useCallback((enabled: boolean, reason: string) => {
    clearVideoBoostTimers();
    const now = Date.now();
    const active = videoBoostRef.current.active;
    if (enabled) {
      if (active) {
        videoBoostRef.current.idleTimer = setTimeout(() => {
          setVideoBoost(false, 'idle_timeout');
        }, VIDEO_IDLE_RESET_MS);
        return;
      }
      const sinceOff = now - videoBoostRef.current.lastOffAt;
      const waitMs = Math.max(0, VIDEO_MIN_OFF_MS - Math.max(sinceOff, 0));
      if (waitMs > 0) {
        videoBoostRef.current.minHoldTimer = setTimeout(() => {
          setVideoBoost(true, 'min_off_elapsed');
        }, waitMs);
        return;
      }
      videoBoostRef.current.active = true;
      videoBoostRef.current.lastOnAt = now;
      setNativeScanProfile(prev => {
        if (prev === 'video_boost') {
          console.log('[MW-Host][VideoBoost] suppressed', 'reason=same_config', 'profile=video_boost');
          return prev;
        }
        return 'video_boost';
      });
      console.log('[MW-Host][VideoBoost] on', 'fps=' + VIDEO_BOOST_FPS, 'preset=strict', 'reason=' + reason);
      videoBoostRef.current.idleTimer = setTimeout(() => {
        setVideoBoost(false, 'idle_timeout');
      }, VIDEO_IDLE_RESET_MS);
      return;
    }

    if (!active) {
      setNativeScanProfile(prev => {
        if (prev === 'balanced') {
          console.log('[MW-Host][VideoBoost] suppressed', 'reason=same_config', 'profile=balanced');
          return prev;
        }
        return 'balanced';
      });
      return;
    }
    const sinceOn = now - videoBoostRef.current.lastOnAt;
    const waitMs = Math.max(0, VIDEO_MIN_ON_MS - Math.max(sinceOn, 0));
    if (waitMs > 0) {
      videoBoostRef.current.minHoldTimer = setTimeout(() => {
        setVideoBoost(false, 'min_on_elapsed');
      }, waitMs);
      return;
    }
    videoBoostRef.current.active = false;
    videoBoostRef.current.lastOffAt = now;
    setNativeScanProfile(prev => {
      if (prev === 'balanced') {
        console.log('[MW-Host][VideoBoost] suppressed', 'reason=same_config', 'profile=balanced');
        return prev;
      }
      return 'balanced';
    });
    console.log('[MW-Host][VideoBoost] off', 'fps=' + VIDEO_BALANCED_FPS, 'preset=balanced', 'reason=' + reason);
  }, [VIDEO_BALANCED_FPS, VIDEO_BOOST_FPS, VIDEO_IDLE_RESET_MS, VIDEO_MIN_OFF_MS, VIDEO_MIN_ON_MS, clearVideoBoostTimers]);

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
  
  // Track if moderation script was injected
  const injectionDoneRef = useRef(false);
  const injectionInFlightRef = useRef(false);
  const lastInjectedUrlRef = useRef('');
  const lastInjectionAtRef = useRef(0);
  const duplicateInjectionSkipsRef = useRef(0);
  const didInjectAfterSettingsLoadedRef = useRef(false);
  const loadEndInjectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const navigationSeqRef = useRef(0);
  const activeNavIdRef = useRef(0);
  const currentUrlRef = useRef('');
  const messageFromWebViewHandlerRef = useRef<((payload: unknown) => void) | null>(null);
  
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

  const resolveBlockDecision = useCallback(async (url: string) => {
    const local = isLocallyBlocked(url);
    const localCategory = local.category || null;
    const localAdult = local.blocked && localCategory === 'adult';

    if (local.blocked && settings.block_adult_sites) {
      return {
        isBlocked: true,
        category: localCategory,
        reason: `This site is blocked under the "${localCategory || 'blocked'}" category.`,
        isAdultDomain: localAdult,
      };
    }

    if (!settings.block_adult_sites) {
      return {
        isBlocked: false,
        category: null,
        reason: '',
        isAdultDomain: localAdult,
      };
    }

    const timeoutMs = 1200;
    const remote = await Promise.race([
      checkBlockedSite(url, deviceId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    const remoteBlocked = !!remote?.isBlocked;
    const remoteCategory = remote?.category || null;
    const remoteAdult = remoteBlocked && remoteCategory === 'adult';

    return {
      isBlocked: remoteBlocked,
      category: remoteCategory,
      reason: remote?.reason || 'This site is blocked.',
      isAdultDomain: localAdult || remoteAdult,
    };
  }, [isLocallyBlocked, settings.block_adult_sites, checkBlockedSite, deviceId]);

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
    const decision = await resolveBlockDecision(url);
    domainAdultContextRef.current = decision.isAdultDomain;
    if (decision.isBlocked) {
      setBlockedReason(decision.reason);
      setBlockedCategory(decision.category || 'blocked');
      navigate('blocked', '', url);
      await logEvent('blocked', domain, 'blocked');
      return false;
    }
    
    // All navigation allowed in native WebView (including social platforms)
    return true;
  }, [navigate, logEvent, resolveBlockDecision]);

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
    navigationSeqRef.current += 1;
    activeNavIdRef.current = navigationSeqRef.current;
    webViewPageEpochRef.current = activeNavIdRef.current;
    resetModernHealthForNavigation('nav:' + reason);
    setVideoBoost(false, 'navigation_change');
    console.log(
      '[MW-Inject][Nav]',
      'navId=' + activeNavIdRef.current,
      'reason=' + reason,
      'targetUrl=' + (url || 'unknown'),
    );
  }, [resetModernHealthForNavigation, setVideoBoost]);

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
      enableVideoFrameSnapshots:
        (localSettings.prototype_mode === true || localSettings.kid_safe_profile === true) &&
        import.meta.env.VITE_ENABLE_VIDEO_FRAME_SNAPSHOTS === 'true',
      kidSafeProfile: localSettings.kid_safe_profile === true,
      domainContextAdult: domainAdultContextRef.current === true,
      pageEpoch: webViewPageEpochRef.current,
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
      await scriptExecutor(mainScript);
      injectionDoneRef.current = true;
      lastInjectedUrlRef.current = targetUrl;
      lastInjectionAtRef.current = Date.now();
      console.log(
        '[MW-Inject][InjectedDispatch]',
        'navId=' + navId,
        'reason=' + reason,
        'targetUrl=' + (targetUrl || 'unknown'),
      );
    } catch (error) {
      console.error('[MW-Bridge] Moderation script injection failed:', error);
    } finally {
      injectionInFlightRef.current = false;
    }
  }, [ENABLE_SIGNAL_PIPELINE, settingsLoaded, isModerationEnabled, getModerationConfig, localSettings.prototype_mode, localSettings.kid_safe_profile]);

  const {
    state: webViewState,
    open: openWebView,
    close: closeWebView,
    goBack: webViewGoBack,
    goForward: webViewGoForward,
    reload: webViewReload,
    postMessageToWebView,
    executeScript,
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
      resetModernHealthForNavigation('load_start');
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'navigation_load_start');
    },
    onLoadEnd: async (url) => {
      console.log('[Browser] ======= LOAD END =======');
      console.log('[Browser] URL:', url);
      setIsLoading(false);
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
        }, 500);
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
      clearLoadEndInjectTimer();
      const loweredError = String(error || '').toLowerCase();
      const crashSignal =
        loweredError.includes('pageloaderror') ||
        loweredError.includes('webprocess') ||
        loweredError.includes('web process') ||
        loweredError.includes('terminated') ||
        loweredError.includes('crash');
      if (crashSignal) {
        modernHealthyRef.current = false;
        modernAckRef.current = { at: 0, epoch: webViewPageEpochRef.current };
        modernReadyRef.current = { at: 0, epoch: webViewPageEpochRef.current };
        legacyPollSuppressedUntilRef.current = 0;
        legacyPollSuppressionReasonRef.current = 'webprocess_crash';
        const crashCooldownUntil = Date.now() + 5000;
        legacyExecBackoffUntilRef.current = crashCooldownUntil;
        legacyExecCooldownUntilRef.current = crashCooldownUntil;
        legacyPollCrashCooldownUntilRef.current = crashCooldownUntil;
        legacyPollInFlightRef.current = false;
        legacyExecRecentAtRef.current = [];
        legacyLastExecuteAtRef.current = 0;
        if (legacyPollTimerRef.current) {
          clearTimeout(legacyPollTimerRef.current);
          legacyPollTimerRef.current = null;
          console.log(
            '[MW-Host][Timer] stop',
            'name=legacyPollTimer',
            'navId=' + activeNavIdRef.current,
            'url=' + (url || 'unknown'),
            'reason=webprocess_crash',
          );
        }
        legacyPollOwnerRef.current = '';
        injectionDoneRef.current = false;
        injectionInFlightRef.current = false;
        blurReadyRef.current = false;
        if (crashReinjectTimerRef.current) {
          clearTimeout(crashReinjectTimerRef.current);
          crashReinjectTimerRef.current = null;
        }
        if (crashReinjectEpochRef.current !== webViewPageEpochRef.current) {
          crashReinjectEpochRef.current = webViewPageEpochRef.current;
          const backoffMs = 900;
          crashReinjectTimerRef.current = setTimeout(() => {
            crashReinjectTimerRef.current = null;
            if (!executeScript || !webViewState.isOpen) return;
            injectModerationScript(executeScript, 'webprocess_crash_reinject', url).catch(() => undefined);
            evaluateModernHealth('webprocess_crash_reinject');
            console.log(
              '[MW-Host][CrashRecovery] reinject_attempt',
              'activeNavId=' + activeNavIdRef.current,
              'activePageEpoch=' + webViewPageEpochRef.current,
              'backoffMs=' + backoffMs,
            );
          }, backoffMs);
          console.log(
            '[MW-Host][CrashRecovery] detected',
            'activeNavId=' + activeNavIdRef.current,
            'activePageEpoch=' + webViewPageEpochRef.current,
            'action=single_reinject_scheduled',
          );
        }
      }
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
      resetModernHealthForNavigation('url_change');
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'url_change_safe_reset');
    },
    onNavigationRequest: handleNavigationRequest,
    onClose: () => {
      console.log('[Browser] ======= WEBVIEW CLOSED =======');
      teardownWebViewScheduling('webview_closed', webViewState.currentUrl).catch(() => undefined);
      clearLoadEndInjectTimer();
      moderationBridge.clearCache();
      injectionDoneRef.current = false;
      injectionInFlightRef.current = false;
      blurReadyRef.current = false;
      blurPendingRef.current = null;
      resetModernHealthForNavigation('webview_closed');
      setVideoBoost(false, 'webview_closed');
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'webview_closed');
      navigate('home', '', '');
    },
    onMessageFromWebview: (payload) => {
      if (isDebugMode) {
        console.log('[MW-Host][Capgo] messageFromWebview received');
      }
      messageFromWebViewHandlerRef.current?.(payload);
    },
  });

  useEffect(() => {
    currentUrlRef.current = webViewState.currentUrl || '';
  }, [webViewState.currentUrl]);

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

  const stopNativeScanSession = useCallback((reason: string) => {
    const session = nativeScanSessionRef.current;
    if (session.pendingRestartTimer) {
      clearTimeout(session.pendingRestartTimer);
      session.pendingRestartTimer = null;
    }
    riskDecisionListenerRef.current?.remove();
    riskDecisionListenerRef.current = null;
    if (!session.running) return;
    session.running = false;
    session.profile = null;
    session.configKey = '';
    console.log('[MW][NativeScan] stop', 'reason=' + reason);
    stopNativeContentFilter().catch(() => undefined);
  }, []);

  const syncNativeScanSession = useCallback(async (reason: string) => {
    const moderationEnabled = isModerationEnabled();
    const gate =
      settingsLoaded &&
      isNative &&
      webViewState.isOpen &&
      moderationEnabled &&
      localSettings.shield_active &&
      localSettings.blur_dial > 0;

    if (!gate) {
      stopNativeScanSession('gate_false:' + reason);
      return;
    }

    const desiredPreset = nativeScanProfile === 'video_boost' ? 'strict' : 'balanced';
    const desiredFps = nativeScanProfile === 'video_boost' ? VIDEO_BOOST_FPS : VIDEO_BALANCED_FPS;
    const kidMode = localSettings.kid_safe_profile === true;
    const allowRevealDuringHardBlur = isRevealAllowed() && !kidMode;
    const desiredConfigKey = `${desiredPreset}|${desiredFps}|${isDebugMode ? 1 : 0}|${allowRevealDuringHardBlur ? 1 : 0}|${kidMode ? 1 : 0}`;
    const session = nativeScanSessionRef.current;

    if (session.running && session.configKey === desiredConfigKey) {
      console.log('[MW-Host][VideoBoost] suppressed', 'reason=same_config', 'config=' + desiredConfigKey);
      return;
    }

    const now = Date.now();
    const sinceRestartMs = now - session.lastRestartAt;
    if (session.running && sinceRestartMs < NATIVE_SCAN_RESTART_DEBOUNCE_MS) {
      const waitMs = Math.max(50, NATIVE_SCAN_RESTART_DEBOUNCE_MS - sinceRestartMs);
      if (!session.pendingRestartTimer) {
        session.pendingRestartTimer = setTimeout(() => {
          nativeScanSessionRef.current.pendingRestartTimer = null;
          syncNativeScanSession('debounce_flush').catch(() => undefined);
        }, waitMs);
      }
      console.log('[MW-Host][VideoBoost] suppressed', 'reason=debounce', 'waitMs=' + waitMs, 'config=' + desiredConfigKey);
      return;
    }

    if (session.running) {
      riskDecisionListenerRef.current?.remove();
      riskDecisionListenerRef.current = null;
      await stopNativeContentFilter().catch(() => undefined);
      session.running = false;
      session.profile = null;
      session.configKey = '';
    }

    try {
      console.log('[MW][NativeScan] start', 'reason=' + reason, 'preset=' + desiredPreset, 'fps=' + desiredFps);
      const startPayload = await startNativeContentFilter({
        preset: desiredPreset,
        kidMode,
        debug: isDebugMode,
        fps: desiredFps,
        allowRevealDuringHardBlur,
      });
      console.debug('[ContentFilter] startScanning resolved', startPayload);
      riskDecisionListenerRef.current = await onNativeRiskDecision((decision) => {
        console.debug('[ContentFilter] decision', decision.state, decision.riskScore);
      });
      session.running = true;
      session.profile = nativeScanProfile;
      session.configKey = desiredConfigKey;
      session.lastRestartAt = Date.now();
    } catch (error) {
      console.debug('[ContentFilter] setup failed', error);
    }
  }, [
    settingsLoaded,
    isNative,
    webViewState.isOpen,
    isModerationEnabled,
    localSettings.shield_active,
    localSettings.blur_dial,
    localSettings.kid_safe_profile,
    nativeScanProfile,
    VIDEO_BOOST_FPS,
    VIDEO_BALANCED_FPS,
    isDebugMode,
    isRevealAllowed,
    NATIVE_SCAN_RESTART_DEBOUNCE_MS,
    stopNativeScanSession,
  ]);

  useEffect(() => {
    syncNativeScanSession('state_change').catch(() => undefined);
  }, [syncNativeScanSession]);

  useEffect(() => {
    return () => {
      stopNativeScanSession('effect_unmount');
    };
  }, [stopNativeScanSession]);

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
    injectModerationScript,
    requestBlurHandshake,
    clearLoadEndInjectTimer,
  ]);

  useEffect(() => {
    if (webViewState.isOpen) return;
    didInjectAfterSettingsLoadedRef.current = false;
  }, [webViewState.isOpen]);

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
      if (blurRetryTimerRef.current) {
        clearTimeout(blurRetryTimerRef.current);
      }
      if (crashReinjectTimerRef.current) {
        clearTimeout(crashReinjectTimerRef.current);
        crashReinjectTimerRef.current = null;
      }
      clearVideoBoostTimers();
    };
  }, [clearLoadEndInjectTimer, clearVideoBoostTimers]);

  // ==================== MODERATION MESSAGE HANDLING ====================
  // 
  // We use a hybrid approach for WebView <-> Host communication:
  // 1. Primary: window.postMessage from WebView -> window.addEventListener('message') in host
  // 2. Fallback: Polling global queues via executeScript (for browsers that don't support postMessage)
  //
  // Host -> WebView: executeScript to call window.postMessage inside the page
  // ==================== 

  const pendingRequestsRef = useRef<Set<string>>(new Set());
  const flushQueuedResultMessages = useCallback(async (reason: string) => {
    if (resultQueueRef.current.length === 0) return;
    const pending = [...resultQueueRef.current];
    resultQueueRef.current = [];
    let delivered = 0;
    let failed = 0;

    for (const entry of pending) {
      try {
        const posted = await postMessageToWebView(entry.payload);
        if (posted) {
          delivered += 1;
          markModernTransportActive('result_queue_flush', Number(entry.payload.pageEpoch));
        } else {
          failed += 1;
          entry.attempts += 1;
          resultQueueRef.current.push(entry);
        }
      } catch {
        failed += 1;
        entry.attempts += 1;
        resultQueueRef.current.push(entry);
      }
    }

    resultQueueFlushCountRef.current += 1;
    console.log(
      '[MW-Host][ResultQueue] flush',
      'reason=' + reason,
      'flushCount=' + resultQueueFlushCountRef.current,
      'attempted=' + pending.length,
      'delivered=' + delivered,
      'failed=' + failed,
      'queuedResultsCount=' + resultQueueRef.current.length,
    );

    if (resultQueueRef.current.length > 0 && !resultQueueFlushTimerRef.current) {
      resultQueueFlushTimerRef.current = setTimeout(() => {
        resultQueueFlushTimerRef.current = null;
        flushQueuedResultMessages('retry_timer').catch(() => undefined);
      }, 250);
    }
  }, [postMessageToWebView, markModernTransportActive]);

  const scheduleResultQueueFlush = useCallback((reason: string) => {
    if (resultQueueFlushTimerRef.current) return;
    resultQueueFlushTimerRef.current = setTimeout(() => {
      resultQueueFlushTimerRef.current = null;
      flushQueuedResultMessages(reason).catch(() => undefined);
    }, 100);
  }, [flushQueuedResultMessages]);

  const postModerationResultToWebView = useCallback(async (
    requestId: string,
    payload: Record<string, unknown>,
    requestEpoch: number | null,
  ) => {
    try {
      const posted = await postMessageToWebView(payload);
      console.log(
        '[MW-Host][ResultDelivery]',
        'requestId=' + requestId,
        'delivered_to_js=' + posted,
        'queuedResultsCount=' + resultQueueRef.current.length,
      );
      if (posted) {
        markModernTransportActive('result_posted', requestEpoch ?? undefined);
        return true;
      }
    } catch (error) {
      console.log('[MW-Host] Failed to post results via postMessage:', error);
    }

    resultQueueRef.current.push({
      requestId,
      payload,
      queuedAt: Date.now(),
      attempts: 1,
    });
    console.warn(
      '[MW-Host][ResultQueue] queued',
      'requestId=' + requestId,
      'queuedResultsCount=' + resultQueueRef.current.length,
    );
    scheduleResultQueueFlush('delivery_failed');
    return false;
  }, [postMessageToWebView, markModernTransportActive, scheduleResultQueueFlush]);
  
  /**
   * Process a moderation request from the WebView
   * Uses the new postMessage protocol with requestId/itemId tracking
   */
  const processModerationRequest = useCallback(async (request: ModerationRequestMessage, nonce: string) => {
    const { requestId, items, thresholds } = request;
    const requestEpoch = Number.isFinite(request.pageEpoch) ? Number(request.pageEpoch) : null;
    const activeEpoch = webViewPageEpochRef.current;
    
    if (pendingRequestsRef.current.has(requestId)) {
      console.log('[MW-Host] Duplicate request ignored:', requestId);
      return;
    }
    pendingRequestsRef.current.add(requestId);

    if (requestEpoch !== null && requestEpoch !== activeEpoch) {
      debugLog(
        '[MW-Host][Epoch] stale request ignored',
        'req=' + requestId,
        'requestEpoch=' + requestEpoch,
        'activeEpoch=' + activeEpoch,
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
        await postModerationResultToWebView(
          requestId,
          staleMessage as unknown as Record<string, unknown>,
          requestEpoch,
        );
      } catch {
        // Fail-open by design for stale requests.
      }

      pendingRequestsRef.current.delete(requestId);
      return;
    }

    markModernTransportActive('request_received', requestEpoch ?? activeEpoch);
    
    const startTime = performance.now();
    console.log('[MW-Host] request received', requestId, 'items=' + items.length, 'epoch=' + (requestEpoch ?? 'n/a'));
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
    }> = [];
    
    // Process each item using the moderation bridge
    for (const item of items) {
      try {
        const scanResult = await moderationBridge.scanImage(item.src, thresholds);
        
        if (scanResult) {
          const categoryConfidence = Object.entries(scanResult.predictions || {}).reduce((matched, [label, value]) => {
            if (matched >= 0) return matched;
            return label.toLowerCase() === scanResult.category.toLowerCase() ? value : -1;
          }, -1);
          const effectiveConfidence = categoryConfidence >= 0 ? categoryConfidence : scanResult.confidence;
          const normalizedShouldBlur = normalizeShouldBlur(scanResult.shouldBlur);
          const normalizedSeverity = normalizeSeverity(scanResult.severity, scanResult.category);
          results.push({
            itemId: item.itemId,
            src: item.src,
            shouldBlur: normalizedShouldBlur,
            category: scanResult.category,
            confidence: effectiveConfidence,
            severity: normalizedSeverity,
            predictions: scanResult.predictions,
          });
          console.log('[MW-Host] scan result', item.itemId, ':', scanResult.category, 'blur=' + normalizedShouldBlur, 'conf=' + effectiveConfidence.toFixed(3), 'severity=' + normalizedSeverity);
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

    const normalizedResults = eligibleResults.map((item) => {
      const normalizedShouldBlur = normalizeShouldBlur(item.shouldBlur);
      const normalizedSeverity = normalizeSeverity(item.severity, item.category);
      return {
        ...item,
        shouldBlur: normalizedShouldBlur,
        severity: normalizedSeverity,
      };
    });

    const hardResults = normalizedResults.filter(item => item.shouldBlur && item.severity === 'hard');
    const hardStrongHits = hardResults.filter(item => item.confidence >= hardConfThreshold);
    const hardLowHits = hardResults.filter(item => item.confidence >= modePolicy.hardMultiConfFloor);
    const hardAnyHits = hardResults.length;
    const hardUnsafeMaxConf = hardResults.reduce((max, item) => Math.max(max, item.confidence), 0);

    const softResults = normalizedResults.filter(item => item.shouldBlur && item.severity === 'soft');
    const softQualifiedHits = softResults.filter(item => item.confidence >= softConfidenceFloor);
    const softRatio = denominator > 0 ? softQualifiedHits.length / denominator : 0;

    const hardOverlayDecision =
      hardAnyHits > 0 ||
      hardUnsafeMaxConf >= hardConfThreshold ||
      hardStrongHits.length >= 1 ||
      hardLowHits.length >= modePolicy.hardMultiMinHits;
    const softOverlayDecision =
      modePolicy.allowSoftOverlay &&
      softQualifiedHits.length >= softMinHits &&
      softRatio >= softRatioThreshold;

    let overlayDecision = hardOverlayDecision;
    let decisionReason = 'no_hard_signal';
    if (hardAnyHits > 0) {
      decisionReason = 'hard_signal_present';
    } else if (hardUnsafeMaxConf >= hardConfThreshold) {
      decisionReason = 'hard_threshold_hit';
    } else if (hardStrongHits.length > 0) {
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
        `[MW-Host][ScanSummary] url=${shortUrl} req=${requestId} total=${results.length} eligible=${denominator} tinyExcluded=${tinyExcludedCount} hardHits=${hardAnyHits} hardStrongHits=${hardStrongHits.length} softHits=${softQualifiedHits.length} safeHits=${Math.max(denominator - hardAnyHits - softQualifiedHits.length, 0)} hardMax=${hardUnsafeMaxConf.toFixed(3)} softMax=${softQualifiedHits.reduce((max, item) => Math.max(max, item.confidence), 0).toFixed(3)} softRatio=${softRatio.toFixed(3)} anyHard=${hardAnyHits > 0} mode=${blurMode} decision=${overlayDecision ? 'ON' : 'OFF'} reason=${decisionReason}`
      );
      console.log(
        '[MW-DIAG][HOST][NormalizedSummary]',
        'req=' + requestId,
        'hardHits=' + hardAnyHits,
        'hardMax=' + hardUnsafeMaxConf.toFixed(3),
        'anyHard=' + (hardAnyHits > 0),
        'decision=' + (overlayDecision ? 'ON' : 'OFF'),
        'reason=' + decisionReason,
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
      await postModerationResultToWebView(
        requestId,
        resultMessage as unknown as Record<string, unknown>,
        requestEpoch,
      );
    } catch (error) {
      console.log('[MW-Host] Failed to post results via postMessage:', error);
    }
    
    pendingRequestsRef.current.delete(requestId);
  }, [
    moderationBridge,
    postMessageToWebView,
    postModerationResultToWebView,
    debugLog,
    isDebugMode,
    localSettings.hard_overlay_confidence_threshold,
    localSettings.soft_overlay_ratio_threshold,
    localSettings.soft_overlay_min_hits,
    localSettings.blur_mode,
    localSettings.prototype_mode,
    localSettings.show_scan_notifications,
    currentUrl,
    processModerationSafetySignal,
    setCentralBlurState,
    markModernTransportActive,
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
        const ackNavId = String(typedMessage.navId ?? 'none');
        const ackEpochNum = Number(typedMessage.pageEpoch);
        const ackEpoch = String(typedMessage.pageEpoch ?? 'none');
        const ackKey = ackNavId + '|' + ackEpoch;
        if (isDebugMode && !ackDiagSeenRef.current.has(ackKey)) {
          ackDiagSeenRef.current.add(ackKey);
          console.log(
            '[MW-Host][ACK]',
            'navId=' + ackNavId,
            'pageEpoch=' + ackEpoch,
            'url=' + String(typedMessage.url ?? 'unknown'),
            'source=' + source,
          );
        }
        console.log(
          '[MW-Host][ACK] MW_INJECTED_ACK',
          'source=' + source,
          'navId=' + String(typedMessage.navId ?? 'none'),
          'pageEpoch=' + String(typedMessage.pageEpoch ?? 'none'),
          'noncePrefix=' + String(typedMessage.noncePrefix ?? 'none'),
          'url=' + String(typedMessage.url ?? 'unknown'),
        );
        if (Number.isFinite(ackEpochNum) && ackEpochNum === webViewPageEpochRef.current) {
          modernAckRef.current = { at: Date.now(), epoch: ackEpochNum };
          evaluateModernHealth('ack_active_epoch');
        }
        return;
      }
      if (typedMessage.type === 'MW_REQ_SENT') {
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

      if (isBlurOverlayReadyMessage(message)) {
        const readyEpochNum = Number(typedMessage.pageEpoch);
        if (Number.isFinite(readyEpochNum) && readyEpochNum === webViewPageEpochRef.current) {
          modernReadyRef.current = { at: Date.now(), epoch: readyEpochNum };
          evaluateModernHealth('ready_active_epoch');
        }
        const readyNavId = String(activeNavIdRef.current || 'none');
        const readyEpoch = String(webViewPageEpochRef.current || 'none');
        const readyKey = readyNavId + '|' + readyEpoch;
        if (isDebugMode && !readyDiagSeenRef.current.has(readyKey)) {
          readyDiagSeenRef.current.add(readyKey);
          console.log(
            '[MW-Host][READY]',
            'navId=' + readyNavId,
            'pageEpoch=' + readyEpoch,
            'reason=' + String(typedMessage.reason || 'ready'),
            'url=' + String(typedMessage.url || 'unknown'),
          );
        }
        if (ENABLE_DOM_BLUR) {
          blurReadyRef.current = true;
          console.log('[MW-Host] Blur overlay READY:', String(typedMessage.reason || 'ready'), String(typedMessage.url || ''));
          queueCurrentBlurState('webview_ready_sync');
          await flushBlurStateToWebView();
        }
        return;
      }

      if (typedMessage.type === 'MW_VIDEO_ACTIVITY') {
        const state = String(typedMessage.state || '');
        if (state === 'playing') {
          setVideoBoost(true, 'video_playing');
        } else if (state === 'paused' || state === 'ended') {
          setVideoBoost(false, 'video_paused_or_ended');
        }
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
        await processModerationRequest(message, message.nonce);
        return;
      }
      
      if (typedMessage.type === 'gc-moderation-request' && typedMessage.action === 'scan') {
        console.log('[MW-Host] Received legacy moderation request via postMessage');
        const result = await moderationBridge.handleWebViewMessage(message);
        
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
  }, [ENABLE_SIGNAL_PIPELINE, ENABLE_DOM_BLUR, isDebugMode, processModerationRequest, moderationBridge, postMessageToWebView, getNonce, queueCurrentBlurState, flushBlurStateToWebView, evaluateModernHealth, setVideoBoost]);

  /**
   * Fallback: Poll for moderation requests from legacy global queue
   * This is used when postMessage doesn't work reliably
   */
  useEffect(() => {
    if (!ENABLE_SIGNAL_PIPELINE || !isNative || !webViewState.isOpen || !isModerationEnabled()) {
      return;
    }

    console.log('[MW-Host] Starting adaptive legacy queue polling (fallback)...');
    const MIN_POLL_MS = 300;
    const MAX_POLL_MS = 3000;
    const UNKNOWN_MIN_POLL_MS = 1500;
    const UNKNOWN_MAX_POLL_MS = 12000;
    const EMPTY_BACKOFF_MS = 250;
    const HIDDEN_POLL_MS = 2000;
    const IDLE_EMPTY_POLLS = 10;
    const IDLE_NO_ACTIVITY_MS = 15000;
    const IDLE_MIN_POLL_MS = 2000;
    const IDLE_MAX_POLL_MS = 5000;
    const IDLE_BACKOFF_MS = 500;
    const LEGACY_EXEC_MIN_INTERVAL_MS = 1200;
    const LEGACY_EXEC_BURST_WINDOW_MS = 15000;
    const LEGACY_EXEC_BURST_MAX = 14;
    const LEGACY_EXEC_COOLDOWN_MS = 8000;
    const navIdAtStart = activeNavIdRef.current;
    const epochAtStart = webViewPageEpochRef.current;
    legacyPollGenerationRef.current += 1;
    const pollOwner = `${navIdAtStart}|${epochAtStart}|${legacyPollGenerationRef.current}`;
    legacyPollOwnerRef.current = pollOwner;
    let pollDelayMs = MIN_POLL_MS;
    let cancelled = false;
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

    const hasPollOwnership = () => legacyPollOwnerRef.current === pollOwner;

    const recordLegacyExec = () => {
      const now = Date.now();
      legacyLastExecuteAtRef.current = now;
      legacyExecRecentAtRef.current = legacyExecRecentAtRef.current
        .filter((ts) => now - ts <= LEGACY_EXEC_BURST_WINDOW_MS)
        .concat(now);
    };

    const scheduleNextPoll = (delayMs: number) => {
      if (cancelled) return;
      if (!hasPollOwnership()) return;
      if (legacyPollTimerRef.current) {
        clearTimeout(legacyPollTimerRef.current);
      }
      legacyPollTimerRef.current = setTimeout(runPollLoop, delayMs);
      console.log(
        '[MW-Host][Timer] start',
        'name=legacyPollTimer',
        'delayMs=' + delayMs,
        'navId=' + activeNavIdRef.current,
        'url=' + (webViewState.currentUrl || 'unknown'),
      );
    };

    const pollForRequests = async (): Promise<boolean> => {
      if (!executeScript) return false;
      if (!hasPollOwnership()) return false;
      if (legacyPollInFlightRef.current) return false;
      evaluateModernHealth('legacy_poll_tick');
      const now = Date.now();
      if (now < legacyPollCrashCooldownUntilRef.current) {
        return false;
      }
      const transportActive = now < modernTransportActiveUntilRef.current;
      const suppressLegacy =
        now < legacyPollSuppressedUntilRef.current &&
        (modernHealthyRef.current || transportActive);
      if (suppressLegacy) {
        return false;
      }
      if (now < legacyExecBackoffUntilRef.current || now < legacyExecCooldownUntilRef.current) {
        return false;
      }
      const sinceLastExec = now - legacyLastExecuteAtRef.current;
      if (legacyLastExecuteAtRef.current > 0 && sinceLastExec < LEGACY_EXEC_MIN_INTERVAL_MS) {
        return false;
      }
      const recentExecs = legacyExecRecentAtRef.current.filter((ts) => now - ts <= LEGACY_EXEC_BURST_WINDOW_MS);
      legacyExecRecentAtRef.current = recentExecs;
      if (recentExecs.length >= LEGACY_EXEC_BURST_MAX) {
        legacyExecCooldownUntilRef.current = now + LEGACY_EXEC_COOLDOWN_MS;
        return false;
      }
      legacyPollInFlightRef.current = true;
      
      try {
        if (!hasPollOwnership()) return false;
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
        
        recordLegacyExec();
        const result = await executeScript(getQueueScript);
        legacyExecBackoffMsRef.current = 300;
        legacyExecBackoffUntilRef.current = 0;
        
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
        
        console.log('[MW-Host] Legacy poll: found', items.length, 'items in queue');
        const resultsToPush: Array<{
          src: string;
          shouldBlur: boolean;
          category: string;
          confidence: number;
          blurStrengthPx: number;
        }> = [];

        // Process each scan request
        for (const item of items) {
          const { src, thresholds } = item;
          
          if (!src) continue;
          
          console.log('[MW-Host] Legacy processing:', src.substring(0, 60));
          
          const scanResult = await moderationBridge.scanImage(src, thresholds);
          
          if (scanResult) {
            console.log('[MW-Host] Legacy scan result:', scanResult.shouldBlur, scanResult.category);
            resultsToPush.push({
              src,
              shouldBlur: !!scanResult.shouldBlur,
              category: String(scanResult.category || 'neutral'),
              confidence: Number(scanResult.confidence || 0),
              blurStrengthPx: localSettings.blur_strength_px || 16,
            });
          }
        }
        if (resultsToPush.length > 0) {
          const payload = escapeForJs(JSON.stringify(resultsToPush));
          const pushResultScript = `
            (function() {
              if (!window.__GC_SCAN_RESULTS__) window.__GC_SCAN_RESULTS__ = [];
              var items = JSON.parse('${payload}');
              if (Array.isArray(items) && items.length > 0) {
                for (var i = 0; i < items.length; i++) {
                  window.__GC_SCAN_RESULTS__.push(items[i]);
                }
              }
              return 'OK';
            })();
          `;
          try {
            recordLegacyExec();
            await executeScript(pushResultScript);
            legacyExecBackoffMsRef.current = 300;
            legacyExecBackoffUntilRef.current = 0;
            console.log('[MW-Host] Legacy results pushed count=' + resultsToPush.length);
          } catch (e) {
            console.debug('[MW-Host] Failed to push legacy results batch:', e);
            legacyExecBackoffUntilRef.current = Date.now() + legacyExecBackoffMsRef.current;
            legacyExecBackoffMsRef.current = Math.min(legacyExecBackoffMsRef.current * 2, LEGACY_EXEC_BACKOFF_MAX_MS);
          }
        }
        return true;
      } catch (e) {
        // Polling errors are expected and ignored in some cases
        console.debug('[MW-Host] Legacy poll error:', e);
        legacyExecBackoffUntilRef.current = Date.now() + legacyExecBackoffMsRef.current;
        legacyExecBackoffMsRef.current = Math.min(legacyExecBackoffMsRef.current * 2, LEGACY_EXEC_BACKOFF_MAX_MS);
        return false;
      } finally {
        legacyPollInFlightRef.current = false;
      }
    };

    const runPollLoop = async () => {
      if (cancelled) return;
      if (!hasPollOwnership()) return;
      evaluateModernHealth('legacy_poll_loop');
      const now = Date.now();
      if (now < legacyPollCrashCooldownUntilRef.current) {
        const waitMs = Math.max(UNKNOWN_MIN_POLL_MS, legacyPollCrashCooldownUntilRef.current - now);
        scheduleNextPoll(waitMs);
        return;
      }
      const transportActive = now < modernTransportActiveUntilRef.current;
      const suppressLegacy =
        now < legacyPollSuppressedUntilRef.current &&
        (modernHealthyRef.current || transportActive);
      if (suppressLegacy) {
        const waitMs = Math.max(1200, legacyPollSuppressedUntilRef.current - now);
        scheduleNextPoll(waitMs);
        return;
      }
      const hadWork = await pollForRequests();
      const hasModernSignal = modernAckRef.current.at > 0 || modernReadyRef.current.at > 0;
      if (document.visibilityState !== 'visible') {
        pollDelayMs = HIDDEN_POLL_MS;
      } else if (hadWork) {
        lastActivityAt = Date.now();
        consecutiveEmptyPolls = 0;
        exitIdleMode('request');
        pollDelayMs = hasModernSignal ? MIN_POLL_MS : UNKNOWN_MIN_POLL_MS;
      } else {
        consecutiveEmptyPolls += 1;
        maybeEnterIdleMode();
        if (idleMode) {
          idlePollMs = Math.min(idlePollMs + IDLE_BACKOFF_MS, IDLE_MAX_POLL_MS);
          pollDelayMs = idlePollMs;
        } else if (!hasModernSignal) {
          const baseline = Math.max(pollDelayMs + EMPTY_BACKOFF_MS, Math.floor(Math.max(UNKNOWN_MIN_POLL_MS, pollDelayMs) * 1.8));
          pollDelayMs = Math.min(baseline, UNKNOWN_MAX_POLL_MS);
        } else {
          pollDelayMs = Math.min(pollDelayMs + EMPTY_BACKOFF_MS, MAX_POLL_MS);
        }
      }
      scheduleNextPoll(pollDelayMs);
    };
    const initialDelay = (modernAckRef.current.at > 0 || modernReadyRef.current.at > 0) ? MIN_POLL_MS : UNKNOWN_MIN_POLL_MS;
    scheduleNextPoll(initialDelay);

    return () => {
      cancelled = true;
      if (hasPollOwnership()) {
        legacyPollOwnerRef.current = '';
      }
      if (legacyPollTimerRef.current) {
        clearTimeout(legacyPollTimerRef.current);
        legacyPollTimerRef.current = null;
        console.log(
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
  }, [ENABLE_SIGNAL_PIPELINE, isNative, webViewState.isOpen, isModerationEnabled, executeScript, moderationBridge, localSettings.blur_strength_px, webViewState.currentUrl, evaluateModernHealth, LEGACY_EXEC_BACKOFF_MAX_MS]);

  // Search handler - redirects to Google search immediately
  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) return;
    
    console.log('[Browser] Starting search:', query);
    
    // Build Google search URL
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
    domainAdultContextRef.current = false;
    
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

    const preflight = await resolveBlockDecision(normalizedUrl);
    domainAdultContextRef.current = preflight.isAdultDomain;
    if (preflight.isBlocked) {
      setBlockedReason(preflight.reason);
      setBlockedCategory(preflight.category || 'blocked');
      navigate('blocked', '', normalizedUrl);
      await logEvent('blocked', domain, 'blocked');
      return;
    }

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
  }, [urlInput, isNative, openWebView, handleSearch, navigate, logEvent, isUrlInput, resolveBlockDecision]);

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
      resetModernHealthForNavigation('manual_reload');
      setVideoBoost(false, 'manual_reload');
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'manual_reload');
      return;
    }
  }, [readerContent, currentView, searchQuery, isNative, webViewState.isOpen, handleReaderMode, handleSearch, webViewReload, setCentralBlurState, resetModernHealthForNavigation, setVideoBoost]);

  const handleHome = useCallback(async () => {
    teardownWebViewScheduling('home_reset', webViewState.currentUrl).catch(() => undefined);
    if (isNative && webViewState.isOpen) {
      await closeWebView();
    }
    moderationBridge.clearCache();
    injectionDoneRef.current = false;
    blurReadyRef.current = false;
    blurPendingRef.current = null;
    resetModernHealthForNavigation('home_reset');
    setVideoBoost(false, 'home_reset');
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
    domainAdultContextRef.current = false;
    goHome();
  }, [isNative, webViewState.isOpen, webViewState.currentUrl, closeWebView, goHome, moderationBridge, setCentralBlurState, teardownWebViewScheduling, resetModernHealthForNavigation, setVideoBoost]);

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
