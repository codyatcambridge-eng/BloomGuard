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
import { useLocalSettings } from '@/hooks/useLocalSettings';
import { useDeviceId } from '@/hooks/useDeviceId';
import { useBrowserNavigation } from '@/hooks/useBrowserNavigation';
import { useCapacitor } from '@/hooks/useCapacitor';
import { useModerationBridge } from '@/hooks/useModerationBridge';
import { useGateRuntime } from '@/hooks/useGateRuntime';
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
    const path = String(parsed.pathname || '').toLowerCase();
    return (
      (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') &&
      path.startsWith('/shorts')
    );
  } catch {
    return false;
  }
};

const normalizePathname = (value: string): string => {
  if (!value) return '/';
  const trimmed = value.replace(/\/+$/, '');
  return trimmed || '/';
};

const isLivePlayerView = (value?: string) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'youtube.com' && host !== 'www.youtube.com' && host !== 'm.youtube.com') {
      return false;
    }
    const normalizedPath = normalizePathname(String(parsed.pathname || ''));
    return /^\/shorts\/[^/?#]+$/i.test(normalizedPath);
  } catch {
    return false;
  }
};

const hasSameUrlOriginAndPath = (left?: string, right?: string): boolean => {
  if (!left || !right) return false;
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return (
      leftUrl.origin === rightUrl.origin &&
      normalizePathname(String(leftUrl.pathname || '')) === normalizePathname(String(rightUrl.pathname || ''))
    );
  } catch {
    return false;
  }
};

const isYouTubeShortsRelatedUrl = (value?: string) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const path = String(parsed.pathname || '').toLowerCase();
    return (
      (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') &&
      /(^|[/])shorts([/]|$)/.test(path)
    );
  } catch {
    return false;
  }
};

const getYouTubeShortsId = (value?: string): string => {
  if (!value) return 'none';
  try {
    const parsed = new URL(value);
    const match = String(parsed.pathname || '').match(/\/shorts\/([^/?#]+)/i);
    if (match && match[1]) return match[1];
  } catch {
    return 'none';
  }
  return 'none';
};

const parseSovereignId = (value?: string): { navId: string; pageEpoch: string; videoId: string } => {
  const serialized = typeof value === 'string' ? value : '';
  const [navId = 'none', pageEpoch = 'none', videoId = 'none'] = serialized.split('|');
  return {
    navId: navId || 'none',
    pageEpoch: pageEpoch || 'none',
    videoId: videoId || 'none',
  };
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

const SHORTS_LEGACY_FALLBACK_ENTRY_PROBE_MS = 2500;
const SHORTS_LEGACY_FALLBACK_TIMEOUT_PROBE_MS = 8000;
const SHORTS_LEGACY_FALLBACK_REQ_GRACE_MS = 2500;
const SHORTS_LEGACY_FALLBACK_MAX_PROBE_MS = 9000;
const SHORTS_LEGACY_FALLBACK_MAX_POLLS = 6;

const getUrlFamily = (value?: string) => {
  if (!value) return 'unknown';
  if (isYouTubeShortsUrl(value)) return 'youtube_shorts';
  if (isYouTubeShortsRelatedUrl(value)) return 'youtube_shorts_related';
  if (isYouTubeDomainUrl(value)) {
    try {
      const parsed = new URL(value);
      return parsed.hostname.toLowerCase() === 'm.youtube.com' ? 'youtube_mobile' : 'youtube';
    } catch {
      return 'youtube';
    }
  }
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
};

const getCacheDomainContext = (value?: string): string => {
  if (!value) return 'unknown';
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
};

const getCacheFamilyContext = (value?: string): string => {
  const domain = getCacheDomainContext(value);
  if (domain === 'm.youtube.com') return 'youtube_mobile';
  if (domain === 'youtube.com' || domain === 'www.youtube.com') return 'youtube_www';
  if (domain.endsWith('youtube.com') || domain.endsWith('youtu.be') || domain.endsWith('ytimg.com')) {
    return 'youtube_other';
  }
  return domain || 'unknown';
};

const isYouTubeFamilyContext = (family: string): boolean => {
  return family === 'youtube_www' || family === 'youtube_mobile' || family === 'youtube_other';
};

const isThumbnailLikeSourceType = (sourceType: string): boolean => {
  return sourceType === 'bg-image' || sourceType === 'img' || sourceType === 'thumbnail' || sourceType === 'video-poster';
};

const isMismatchToleratedSourceType = (sourceType: string): boolean => {
  return sourceType === 'bg-image' || sourceType === 'img';
};

const isSecondaryShortsSourceType = (sourceType: string): boolean => {
  return sourceType === 'bg-image' || sourceType === 'img' || sourceType === 'thumbnail' || sourceType === 'video-poster';
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

interface ShortsOverlayPendingState {
  sovereignId: string;
  hasBlurSignal: boolean;
  jsBlurApplied: boolean;
  jsRevealApplied: boolean;
  hasModerationResult: boolean;
  fallbackRevealEnsured: boolean;
  result: 'BLUR' | 'CLEAR' | null;
  startedAt: number;
}

interface StableInjectionState {
  key: string;
  url: string;
  navId: number;
  pageEpoch: number;
  shortsVideoId: string;
  reasons: string[];
  scheduledAt: number;
}

/**
 * NativeWebViewBrowser - Unified browser component
 * Uses native WebView on mobile, fallback modes on web
 * Social platforms load fully in WebView (not preview mode)
 */
export const NativeWebViewBrowser = () => {
  const { isNative } = useCapacitor();
  // Enable page-wide DOM blur/overlay bridge in addition to per-element blur.
  const ENABLE_DOM_BLUR = true;
  const ENABLE_SIGNAL_PIPELINE = true;
  const browserMainRef = useRef<HTMLElement | null>(null);
  const hostLayerDiagLogAtRef = useRef(0);
  const topLayerLabelRef = useRef('none');
  const [diagTopLayerLabel, setDiagTopLayerLabel] = useState('none');
  const [showDiagLayerBadge, setShowDiagLayerBadge] = useState(false);
  
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
  const {
    settings: localSettings,
    isLoaded: settingsLoaded,
    getModerationConfig,
    getNonce,
    updateSetting,
  } = useLocalSettings();
  const { effectiveShieldState } = useGateRuntime();
  const deviceId = useDeviceId();
  const effectiveShieldEnabled = effectiveShieldState.shieldEnabled;
  const isRuntimeModerationEnabled = effectiveShieldEnabled && localSettings.blur_dial > 0;

  // Central blur source-of-truth with hysteresis to avoid flicker.
  const blurStateRef = useRef<{ enabled: boolean; reason: string; timestamp: number }>({
    enabled: false,
    reason: 'init',
    timestamp: Date.now(),
  });
  const blurReadyRef = useRef(false);
  const blurReadyBurstRef = useRef<{ navId: number; pageEpoch: number; url: string; at: number }>({
    navId: 0,
    pageEpoch: 0,
    url: '',
    at: 0,
  });
  const blurPendingRef = useRef<{ enabled: boolean; reason: string; timestamp: number } | null>(null);
  const blurRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const overlayLiftHandshakeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const overlayLiftHandshakeUntilRef = useRef(0);
  const overlayLastSyncedEnabledRef = useRef(false);
  const blurSignalRef = useRef({ unsafeStreak: 0, safeStreak: 0 });
  const [blurSyncVersion, setBlurSyncVersion] = useState(0);
  const riskDecisionListenerRef = useRef<PluginListenerHandle | null>(null);
  const lastNsfwSignalAtRef = useRef(0);
  const nativeSignalPushUnsupportedRef = useRef(false);
  const webViewPageEpochRef = useRef(0);
  const stageBFlagDiagEpochRef = useRef<string | null>(null);
  const shortsScanDiagRef = useRef<{ lastScanBatchStartAt: number }>({ lastScanBatchStartAt: 0 });
  const shortsLegacyFallbackRef = useRef<{
    untilMs: number;
    reason: string;
    lastReqSentAt: number;
    lastReqTimeoutAt: number;
  }>({
    untilMs: 0,
    reason: 'idle',
    lastReqSentAt: 0,
    lastReqTimeoutAt: 0,
  });
  const shortsModeActiveRef = useRef(false);
  const shortsReentryRefreshRef = useRef<{ navId: number; url: string; at: number }>({
    navId: 0,
    url: '',
    at: 0,
  });
  const legacyPollSelfDisabledContextRef = useRef<string | null>(null);
  const shortsRelatedLegacyPollContextRef = useRef<string | null>(null);
  const shortsOverlayPendingRef = useRef<ShortsOverlayPendingState | null>(null);
  const shortsOverlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shortsMatchingRetryRef = useRef<{
    needsMatchingScan: boolean;
    pendingSovereignId: string;
    attemptedSovereignId: string;
    timer: NodeJS.Timeout | null;
  }>({
    needsMatchingScan: false,
    pendingSovereignId: '',
    attemptedSovereignId: '',
    timer: null,
  });
  const lastShortsBlurSignalRef = useRef<{ sovereignId: string; at: number }>({
    sovereignId: '',
    at: 0,
  });
  const lastShortsBlurReadyVideoRef = useRef<{ videoId: string; at: number }>({
    videoId: 'none',
    at: 0,
  });
  const [shortsLegacyFallbackVersion, setShortsLegacyFallbackVersion] = useState(0);
  const [shortsRelatedLegacyPollVersion, setShortsRelatedLegacyPollVersion] = useState(0);

  const UNSAFE_STREAK_REQUIRED = 2;
  const SAFE_STREAK_REQUIRED = 2;
  const PENDING_REINJECT_WINDOW_MS = 1500;
  const STABLE_INJECTION_DEBOUNCE_MS = 300;
  const STABLE_INJECTION_SHORTS_DEBOUNCE_MS = 600;
  const BLUR_READY_PING_SUPPRESS_MS = 400;
  const OVERLAY_LIFT_HANDSHAKE_MS = 50;
  const SHORTS_OVERLAY_ATOMIC_TIMEOUT_MS = 1200;
  const SHORTS_MATCHING_RETRY_DELAY_MS = 800;
  const SHORTS_NAV_GRACE_MS = 200;
  const isDebugMode = localSettings.debug_mode === true;
  const debugLog = useCallback((...args: unknown[]) => {
    if (!isDebugMode) return;
    console.log(...args);
  }, [isDebugMode]);

  const getSovereignIdForContext = useCallback((
    urlHint?: string,
    navIdHint?: number,
    pageEpochHint?: number,
  ) => {
    const resolvedUrl = urlHint || currentUrlRef.current || '';
    const resolvedNavId = Number.isFinite(navIdHint) ? Number(navIdHint) : (activeNavIdRef.current || 0);
    const resolvedEpoch = Number.isFinite(pageEpochHint) ? Number(pageEpochHint) : (webViewPageEpochRef.current || 0);
    const shortsUrlId = getYouTubeShortsId(resolvedUrl);
    return String(resolvedNavId) + '|' + String(resolvedEpoch) + '|' + (shortsUrlId || 'none');
  }, []);

  const isGraceEpochAcceptedForActiveShortsVideo = useCallback((
    messageEpoch: number | null,
    activeEpoch: number,
    activeUrl: string,
    messageSovereignId?: string,
  ) => {
    if (messageEpoch === null || messageEpoch === activeEpoch) return true;
    if (messageEpoch !== (activeEpoch - 1)) return false;
    if (!isYouTubeShortsUrl(activeUrl)) return false;
    const activeVideoId = getYouTubeShortsId(activeUrl);
    const messageVideoId = parseSovereignId(messageSovereignId).videoId;
    const videoMatch = (
      activeVideoId !== 'none' &&
      messageVideoId !== 'none' &&
      activeVideoId === messageVideoId
    );
    if (!videoMatch) return false;
    console.log(`⚡️ [log] - [SYNC] Grace-period result accepted for Epoch ${messageEpoch}`);
    return true;
  }, []);

  const armShortsLegacyFallbackProbe = useCallback((reason: string, durationMs: number) => {
    const boundedDuration = Math.max(200, Math.floor(durationMs));
    const now = Date.now();
    const state = shortsLegacyFallbackRef.current;
    const nextUntil = now + boundedDuration;
    if (nextUntil <= state.untilMs && state.reason === reason) {
      return;
    }
    state.untilMs = Math.max(state.untilMs, nextUntil);
    state.reason = reason;
    console.log(
      '[MW-Host][ShortsFallback] probe_arm',
      'reason=' + reason,
      'durationMs=' + boundedDuration,
      'untilMs=' + state.untilMs,
      'navId=' + activeNavIdRef.current,
    );
    setShortsLegacyFallbackVersion(v => v + 1);
  }, []);

  const disarmShortsLegacyFallbackProbe = useCallback((reason: string) => {
    const state = shortsLegacyFallbackRef.current;
    if (state.untilMs <= 0) return;
    state.untilMs = 0;
    state.reason = reason;
    console.log(
      '[MW-Host][ShortsFallback] probe_disarm',
      'reason=' + reason,
      'navId=' + activeNavIdRef.current,
    );
    setShortsLegacyFallbackVersion(v => v + 1);
  }, []);

  const queueCurrentBlurState = useCallback((reason: string) => {
    blurPendingRef.current = {
      enabled: blurStateRef.current.enabled,
      reason,
      timestamp: Date.now(),
    };
    setBlurSyncVersion(v => v + 1);
  }, []);

  const cancelOverlayLiftHandshakeWindow = useCallback((reason: string) => {
    const hadTimer = !!overlayLiftHandshakeTimerRef.current;
    const hadWindow = overlayLiftHandshakeUntilRef.current > 0;
    if (overlayLiftHandshakeTimerRef.current) {
      clearTimeout(overlayLiftHandshakeTimerRef.current);
      overlayLiftHandshakeTimerRef.current = null;
    }
    overlayLiftHandshakeUntilRef.current = 0;
    if (!hadTimer && !hadWindow) return;
    console.log(
      '[DIAG][OVERLAY_HANDSHAKE]',
      'action=cancel_window',
      'reason=' + reason,
    );
  }, []);

  const resetOverlayLiftHandshakeState = useCallback((reason: string) => {
    cancelOverlayLiftHandshakeWindow(reason + '_window');
    overlayLastSyncedEnabledRef.current = false;
    console.log(
      '[DIAG][OVERLAY_HANDSHAKE]',
      'action=reset_state',
      'reason=' + reason,
    );
  }, [cancelOverlayLiftHandshakeWindow]);

  const scheduleOverlayLiftHandshakeRetry = useCallback((delayMs: number, reason: string) => {
    const normalizedDelay = Math.max(1, Math.round(delayMs));
    if (overlayLiftHandshakeTimerRef.current) return;
    overlayLiftHandshakeTimerRef.current = setTimeout(() => {
      overlayLiftHandshakeTimerRef.current = null;
      setBlurSyncVersion(v => v + 1);
    }, normalizedDelay);
    console.log(
      '[DIAG][OVERLAY_HANDSHAKE]',
      'action=schedule_retry',
      'reason=' + reason,
      'delayMs=' + normalizedDelay,
    );
  }, []);

  const isShortsAtomicActive = useCallback(() => {
    const activeUrl = currentUrlRef.current || '';
    return isYouTubeShortsUrl(activeUrl);
  }, []);

  const setCentralBlurState = useCallback((enabled: boolean, reason: string) => {
    if (enabled && isShortsAtomicActive()) {
      console.log(
        '[DIAG][SHORTS_ATOMIC]',
        'action=skip_central_blur_enable',
        'reason=' + reason,
        'url=' + (currentUrlRef.current || 'unknown'),
      );
      return;
    }
    const prev = blurStateRef.current;
    if (prev.enabled === enabled && prev.reason === reason) return;

    blurStateRef.current = {
      enabled,
      reason,
      timestamp: Date.now(),
    };
    console.log(
      '[DIAG][OVERLAY_HOST_STATE]',
      'enabled=' + enabled,
      'reason=' + reason,
      'prevEnabled=' + prev.enabled,
      'prevReason=' + prev.reason,
    );
    queueCurrentBlurState(reason);
  }, [queueCurrentBlurState, isShortsAtomicActive]);

  const hardResetOverlayHostState = useCallback((reason: string) => {
    const prev = blurStateRef.current;
    const nextState = {
      enabled: false,
      reason,
      timestamp: Date.now(),
    };
    blurStateRef.current = nextState;
    blurPendingRef.current = nextState;
    setBlurSyncVersion(v => v + 1);
    console.log(
      '[DIAG][OVERLAY_HOST_STATE]',
      'enabled=false',
      'reason=' + reason,
      'prevEnabled=' + prev.enabled,
      'prevReason=' + prev.reason,
      'force=true',
    );
  }, []);

  const unwrapIncomingMessagePayload = useCallback((payload: unknown): unknown => {
    if (!payload || typeof payload !== 'object') return payload;
    const withDetail = payload as { detail?: unknown };
    if (typeof withDetail.detail === 'object' && withDetail.detail !== null) {
      return withDetail.detail;
    }
    if (Object.keys(payload).length === 1 && 'detail' in withDetail) {
      return withDetail.detail;
    }
    return payload;
  }, []);

  const tryHandlePersistentRevealRequest = useCallback((
    rawPayload: unknown,
    source: 'capgo' | 'window',
  ): boolean => {
    const message = unwrapIncomingMessagePayload(rawPayload);
    if (!message || typeof message !== 'object') return false;
    const typedMessage = message as Record<string, unknown>;
    if (typedMessage.type !== 'MW_USER_REVEAL_REQUEST') return false;
    const messageSovereignId = typeof typedMessage.sovereignId === 'string'
      ? typedMessage.sovereignId
      : 'none';
    console.log(
      '[MW-Host][Reveal] MW_USER_REVEAL_REQUEST',
      'source=' + source,
      'sovereignId=' + messageSovereignId,
      'navId=' + activeNavIdRef.current,
      'pageEpoch=' + webViewPageEpochRef.current,
    );
    setCentralBlurState(false, 'user_reveal_request');
    return true;
  }, [setCentralBlurState, unwrapIncomingMessagePayload]);

  const clearShortsOverlayAtomicTimeout = useCallback(() => {
    if (!shortsOverlayTimeoutRef.current) return;
    clearTimeout(shortsOverlayTimeoutRef.current);
    shortsOverlayTimeoutRef.current = null;
  }, []);

  const clearShortsMatchingRetryTimer = useCallback(() => {
    const retryState = shortsMatchingRetryRef.current;
    if (!retryState.timer) return;
    clearTimeout(retryState.timer);
    retryState.timer = null;
  }, []);

  const hasEffectiveShortsBlurSignal = useCallback((pending: ShortsOverlayPendingState | null): boolean => {
    if (!pending) return false;
    if (pending.jsRevealApplied && !pending.jsBlurApplied) return false;
    return pending.hasBlurSignal || pending.jsBlurApplied;
  }, []);

  const resetShortsOverlayCoordinator = useCallback((reason: string) => {
    clearShortsOverlayAtomicTimeout();
    clearShortsMatchingRetryTimer();
    const retryState = shortsMatchingRetryRef.current;
    retryState.needsMatchingScan = false;
    retryState.pendingSovereignId = '';
    retryState.attemptedSovereignId = '';
    const pending = shortsOverlayPendingRef.current;
    if (!pending) return;
    shortsOverlayPendingRef.current = null;
    console.log(
      '[DIAG][SHORTS_ATOMIC]',
      'action=reset',
      'reason=' + reason,
      'sovereignId=' + pending.sovereignId,
      'hasBlurSignal=' + pending.hasBlurSignal,
      'jsBlurApplied=' + pending.jsBlurApplied,
      'jsRevealApplied=' + pending.jsRevealApplied,
      'effectiveBlurSignal=' + hasEffectiveShortsBlurSignal(pending),
      'hasModerationResult=' + pending.hasModerationResult,
      'result=' + (pending.result || 'none'),
    );
  }, [clearShortsOverlayAtomicTimeout, clearShortsMatchingRetryTimer, hasEffectiveShortsBlurSignal]);

  const armShortsOverlayAtomicTimeout = useCallback((sovereignId: string, startedAtMs?: number) => {
    clearShortsOverlayAtomicTimeout();
    const normalizedStartAt = (
      typeof startedAtMs === 'number' &&
      Number.isFinite(startedAtMs) &&
      startedAtMs > 0
    ) ? Number(startedAtMs) : Date.now();
    const elapsedMs = Math.max(0, Date.now() - normalizedStartAt);
    const delayMs = Math.max(0, SHORTS_OVERLAY_ATOMIC_TIMEOUT_MS - elapsedMs);
    shortsOverlayTimeoutRef.current = setTimeout(() => {
      const pending = shortsOverlayPendingRef.current;
      if (!pending || pending.sovereignId !== sovereignId) return;
      console.log(
        '[DIAG][SHORTS_ATOMIC]',
        'action=timeout_release',
        'sovereignId=' + sovereignId,
        'hasBlurSignal=' + pending.hasBlurSignal,
        'jsBlurApplied=' + pending.jsBlurApplied,
        'jsRevealApplied=' + pending.jsRevealApplied,
        'effectiveBlurSignal=' + hasEffectiveShortsBlurSignal(pending),
        'hasModerationResult=' + pending.hasModerationResult,
        'result=' + (pending.result || 'none'),
        'timeoutMs=' + SHORTS_OVERLAY_ATOMIC_TIMEOUT_MS,
        'elapsedMs=' + (Date.now() - pending.startedAt),
      );
      queueCurrentBlurState('shorts_atomic_timeout_release');
    }, delayMs);
  }, [SHORTS_OVERLAY_ATOMIC_TIMEOUT_MS, clearShortsOverlayAtomicTimeout, hasEffectiveShortsBlurSignal, queueCurrentBlurState]);

  const markShortsOverlayBlurSignal = useCallback((
    sovereignId: string,
    signalReason: string,
    preserveStartedAtMs?: number,
  ) => {
    if (!sovereignId) return;
    const now = Date.now();
    const shouldPreserveWindow = (
      typeof preserveStartedAtMs === 'number' &&
      Number.isFinite(preserveStartedAtMs) &&
      preserveStartedAtMs > 0
    );
    const preservedStartedAt = shouldPreserveWindow ? Number(preserveStartedAtMs) : now;
    let pending = shortsOverlayPendingRef.current;
    if (!pending || pending.sovereignId !== sovereignId) {
      pending = {
        sovereignId,
        hasBlurSignal: false,
        jsBlurApplied: false,
        jsRevealApplied: false,
        hasModerationResult: false,
        fallbackRevealEnsured: false,
        result: null,
        startedAt: preservedStartedAt,
      };
      shortsOverlayPendingRef.current = pending;
      armShortsOverlayAtomicTimeout(sovereignId, preservedStartedAt);
    }
    pending.hasBlurSignal = true;
    lastShortsBlurSignalRef.current = {
      sovereignId,
      at: pending.startedAt,
    };
    console.log(
      '[DIAG][SHORTS_ATOMIC]',
      'action=mark_blur_signal',
      'reason=' + signalReason,
      'sovereignId=' + sovereignId,
      'preserveWindow=' + (shouldPreserveWindow ? 'true' : 'false'),
      'jsBlurApplied=' + pending.jsBlurApplied,
      'jsRevealApplied=' + pending.jsRevealApplied,
      'effectiveBlurSignal=' + hasEffectiveShortsBlurSignal(pending),
      'hasModerationResult=' + pending.hasModerationResult,
      'result=' + (pending.result || 'none'),
    );
    if (pending.hasModerationResult && hasEffectiveShortsBlurSignal(pending)) {
      clearShortsOverlayAtomicTimeout();
      queueCurrentBlurState('shorts_atomic_both_ready_from_blur_signal');
    }
  }, [armShortsOverlayAtomicTimeout, clearShortsOverlayAtomicTimeout, hasEffectiveShortsBlurSignal, queueCurrentBlurState]);

  const markShortsOverlayJsState = useCallback((
    sovereignId: string,
    jsBlurApplied: boolean,
    jsRevealApplied: boolean,
    signalReason: string,
  ) => {
    if (!sovereignId) return;
    const activeUrl = currentUrlRef.current || '';
    const activeSovereignId = getSovereignIdForContext(activeUrl);
    if (activeSovereignId && sovereignId !== activeSovereignId) {
      console.log(
        '[DIAG][SHORTS_ATOMIC]',
        'action=ignore_stale_js_state',
        'reason=' + signalReason,
        'sovereignId=' + sovereignId,
        'activeSovereignId=' + activeSovereignId,
      );
      return;
    }
    const now = Date.now();
    let pending = shortsOverlayPendingRef.current;
    if (!pending || pending.sovereignId !== sovereignId) {
      pending = {
        sovereignId,
        hasBlurSignal: false,
        jsBlurApplied: false,
        jsRevealApplied: false,
        hasModerationResult: false,
        fallbackRevealEnsured: false,
        result: null,
        startedAt: now,
      };
      shortsOverlayPendingRef.current = pending;
      armShortsOverlayAtomicTimeout(sovereignId, now);
    }
    pending.jsBlurApplied = jsBlurApplied;
    pending.jsRevealApplied = jsRevealApplied;
    if (jsBlurApplied && !jsRevealApplied) {
      pending.hasBlurSignal = true;
      lastShortsBlurSignalRef.current = {
        sovereignId,
        at: pending.startedAt,
      };
    }
    if (jsRevealApplied) {
      pending.hasBlurSignal = false;
    }
    const effectiveBlurSignal = hasEffectiveShortsBlurSignal(pending);
    console.log(
      '[DIAG][SHORTS_ATOMIC]',
      'action=mark_js_state',
      'reason=' + signalReason,
      'sovereignId=' + sovereignId,
      'jsBlurApplied=' + pending.jsBlurApplied,
      'jsRevealApplied=' + pending.jsRevealApplied,
      'hasBlurSignal=' + pending.hasBlurSignal,
      'effectiveBlurSignal=' + effectiveBlurSignal,
      'hasModerationResult=' + pending.hasModerationResult,
      'result=' + (pending.result || 'none'),
    );
    if (pending.hasModerationResult && effectiveBlurSignal) {
      clearShortsOverlayAtomicTimeout();
      queueCurrentBlurState('shorts_atomic_both_ready_from_js_state');
      return;
    }
    queueCurrentBlurState('shorts_atomic_js_state_update');
  }, [
    armShortsOverlayAtomicTimeout,
    clearShortsOverlayAtomicTimeout,
    getSovereignIdForContext,
    hasEffectiveShortsBlurSignal,
    queueCurrentBlurState,
  ]);

  const markShortsOverlayModerationResult = useCallback((
    sovereignId: string,
    result: 'BLUR' | 'CLEAR',
    decisionReason: string,
    softHits = 0,
  ) => {
    if (!sovereignId) return;
    const now = Date.now();
    const activeUrl = currentUrlRef.current || '';
    const activeSovereignId = getSovereignIdForContext(activeUrl);
    const isActiveSovereign = sovereignId === activeSovereignId;
    const effectiveResult = result;
    const effectiveDecisionReason = decisionReason;
    if (effectiveResult === 'CLEAR' && !isActiveSovereign) {
      console.log(
        '[DIAG][SHORTS_ATOMIC]',
        'action=ignore_stale_clear',
        'reason=' + effectiveDecisionReason,
        'sovereignId=' + sovereignId,
        'activeSovereignId=' + activeSovereignId,
      );
      return;
    }
    let pending = shortsOverlayPendingRef.current;
    if (!pending || pending.sovereignId !== sovereignId) {
      pending = {
        sovereignId,
        hasBlurSignal: false,
        jsBlurApplied: false,
        jsRevealApplied: false,
        hasModerationResult: false,
        fallbackRevealEnsured: false,
        result: null,
        startedAt: now,
      };
      shortsOverlayPendingRef.current = pending;
      armShortsOverlayAtomicTimeout(sovereignId);
    }
    pending.hasModerationResult = true;
    pending.result = effectiveResult;
    console.log(
      '[DIAG][SHORTS_ATOMIC]',
      'action=mark_moderation_result',
      'reason=' + effectiveDecisionReason,
      'sovereignId=' + sovereignId,
      'result=' + effectiveResult,
      'softHits=' + softHits,
      'hasBlurSignal=' + pending.hasBlurSignal,
      'jsBlurApplied=' + pending.jsBlurApplied,
      'jsRevealApplied=' + pending.jsRevealApplied,
      'effectiveBlurSignal=' + hasEffectiveShortsBlurSignal(pending),
    );
    if (effectiveResult === 'CLEAR') {
      setCentralBlurState(false, 'shorts_atomic_force_clear:' + effectiveDecisionReason);
      pending.hasBlurSignal = false;
      pending.jsBlurApplied = false;
      pending.jsRevealApplied = false;
      clearShortsOverlayAtomicTimeout();
      queueCurrentBlurState('shorts_atomic_force_clear');
      return;
    }
    if (hasEffectiveShortsBlurSignal(pending)) {
      clearShortsOverlayAtomicTimeout();
      queueCurrentBlurState('shorts_atomic_both_ready_from_moderation');
    }
  }, [
    armShortsOverlayAtomicTimeout,
    clearShortsOverlayAtomicTimeout,
    getSovereignIdForContext,
    hasEffectiveShortsBlurSignal,
    queueCurrentBlurState,
    setCentralBlurState,
  ]);

  const processModerationSafetySignal = useCallback((isUnsafe: boolean, reason: string) => {
    const activeUrl = currentUrlRef.current || '';
    if (isYouTubeShortsUrl(activeUrl)) {
      debugLog(
        '[MW-DIAG][HOST] hysteresis skip=shorts_atomic',
        'reason=' + reason,
        'url=' + (activeUrl || 'unknown'),
      );
      return;
    }
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
  }, [setCentralBlurState, debugLog]);

  useEffect(() => {
    if (isRuntimeModerationEnabled) return;
    blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
    setCentralBlurState(false, effectiveShieldEnabled ? 'moderation_disabled' : 'shield_pass_active');
  }, [isRuntimeModerationEnabled, effectiveShieldEnabled, setCentralBlurState]);

  const pushNativeSignalCapped = useCallback(async (probs: Partial<NsfwProbabilities>) => {
    if (nativeSignalPushUnsupportedRef.current) return;
    const now = Date.now();
    if (now - lastNsfwSignalAtRef.current < 500) return; // max 2 FPS
    lastNsfwSignalAtRef.current = now;
    try {
      await pushNativeNsfwSignal(probs);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: unknown }).code === 'UNIMPLEMENTED'
      ) {
        nativeSignalPushUnsupportedRef.current = true;
      }
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
  const pendingReinjectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stableInjectionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stableInjectionPendingRef = useRef<StableInjectionState | null>(null);
  const lastStableInjectionRef = useRef<{ key: string; at: number }>({
    key: '',
    at: 0,
  });
  const navigationSeqRef = useRef(0);
  const activeNavIdRef = useRef(0);
  const currentUrlRef = useRef('');
  const webViewActiveInstanceIdRef = useRef<number | null>(null);
  const webViewListenersAttachedRef = useRef(false);
  const pendingReinjectRef = useRef<{
    active: boolean;
    navId: number;
    pageEpoch: number;
    urlFamily: string;
    reason: string;
    enteredAt: number;
  } | null>(null);
  const diagYtBlurEpochRef = useRef({
    staleHostRejectCount: 0,
    epochHeldCount: 0,
    epochIncrementedCount: 0,
  });
  const messageFromWebViewHandlerRef = useRef<((payload: unknown) => void) | null>(null);
  useEffect(() => {
    return () => {
      messageFromWebViewHandlerRef.current = null;
    };
  }, []);
  
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

  useEffect(() => {
    console.log('[DIAG][BROWSER] mount component=NativeWebViewBrowser');
    try {
      const enabled = window.localStorage?.getItem('MW_DIAG_LAYER_BADGE') === '1';
      setShowDiagLayerBadge(enabled);
    } catch {
      setShowDiagLayerBadge(false);
    }
    return () => {
      console.log('[DIAG][BROWSER] unmount component=NativeWebViewBrowser');
    };
  }, []);

  useEffect(() => {
    console.log('[DIAG][BROWSER] platform isNative=' + isNative);
  }, [isNative]);

  // Utility functions
  const toDiagUrl = useCallback((input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) return 'empty';
    try {
      const normalized = trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;
      const parsed = new URL(normalized);
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return trimmed.slice(0, 120);
    }
  }, []);

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

  const logHostLayerDiagnostics = useCallback((reason: string) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const now = Date.now();
    if (now - hostLayerDiagLogAtRef.current < 250) return;
    hostLayerDiagLogAtRef.current = now;

    const containerRect = browserMainRef.current?.getBoundingClientRect();
    const containerWidth = Math.round(containerRect?.width || 0);
    const containerHeight = Math.round(containerRect?.height || 0);
    const hasNonZeroContainer = containerWidth > 0 && containerHeight > 0;
    console.log(
      '[DIAG][HOST_LAYOUT]',
      'reason=' + reason,
      'container=' + containerWidth + 'x' + containerHeight,
      'nonZero=' + hasNonZeroContainer,
      'view=' + currentView,
    );

    const x = Math.max(0, Math.min(window.innerWidth - 1, Math.floor(window.innerWidth / 2)));
    const y = Math.max(0, Math.min(window.innerHeight - 1, Math.floor(window.innerHeight / 2)));
    const stack = document.elementsFromPoint(x, y) as HTMLElement[];
    const top = stack[0];
    if (!top) return;

    const topStyle = window.getComputedStyle(top);
    const topClass = typeof top.className === 'string'
      ? top.className.trim().replace(/\s+/g, '.').slice(0, 80)
      : '';
    const topLabel = `${top.tagName.toLowerCase()}#${top.id || 'none'}.${topClass || 'none'}`;
    if (topLayerLabelRef.current !== topLabel) {
      topLayerLabelRef.current = topLabel;
      setDiagTopLayerLabel(topLabel);
    }

    let highestElement: HTMLElement | null = null;
    let highestZ = Number.NEGATIVE_INFINITY;
    stack.slice(0, 10).forEach((el) => {
      const z = Number.parseInt(window.getComputedStyle(el).zIndex || '', 10);
      if (Number.isFinite(z) && z > highestZ) {
        highestZ = z;
        highestElement = el;
      }
    });

    const covering = stack.find((el) => {
      const cs = window.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const opacity = Number.parseFloat(cs.opacity || '1');
      if (!Number.isFinite(opacity) || opacity <= 0.01) return false;
      const rect = el.getBoundingClientRect();
      const fillsViewport = rect.width >= window.innerWidth * 0.95 && rect.height >= window.innerHeight * 0.95;
      const positioned = cs.position === 'fixed' || cs.position === 'absolute';
      return fillsViewport && positioned;
    });

    console.log(
      '[DIAG][HOST_LAYER]',
      'reason=' + reason,
      'top=' + topLabel,
      'topZ=' + (topStyle.zIndex || 'auto'),
      'topOpacity=' + (topStyle.opacity || '1'),
      'topVisibility=' + (topStyle.visibility || 'visible'),
      'highestZ=' + (highestElement ? highestZ : 'none'),
      'highestZTag=' + (highestElement ? highestElement.tagName.toLowerCase() : 'none'),
      'fullscreenCover=' + (covering ? 'yes' : 'no'),
    );
  }, [currentView]);

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
    if (localSettings.block_adult_sites) {
      const result = await checkBlockedSite(url, deviceId);
      if (result?.isBlocked) {
        console.log(
          '[DIAG][SHIELD_STATE]',
          'blocked=true',
          'category=' + String(result.category || 'blocked'),
          'domain=' + domain,
        );
        setBlockedReason(result.reason);
        setBlockedCategory(result.category || 'blocked');
        navigate('blocked', '', url);
        await logEvent('blocked', domain, 'blocked');
        return false;
      }
    }
    
    // All navigation allowed in native WebView (including social platforms)
    return true;
  }, [localSettings.block_adult_sites, checkBlockedSite, deviceId, navigate, logEvent]);

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

  const clearPendingReinjectTimer = useCallback(() => {
    if (!pendingReinjectTimerRef.current) return;
    clearTimeout(pendingReinjectTimerRef.current);
    pendingReinjectTimerRef.current = null;
  }, []);

  const clearStableInjectionTimer = useCallback((reason: string) => {
    if (!stableInjectionTimerRef.current) return;
    clearTimeout(stableInjectionTimerRef.current);
    stableInjectionTimerRef.current = null;
    console.log(
      '[DIAG][INJECT_STABLE]',
      'action=timer_cleared',
      'reason=' + reason,
      'navId=' + activeNavIdRef.current,
      'url=' + (currentUrlRef.current || 'unknown'),
    );
  }, []);

  const logSafeResetDiag = useCallback((
    event: 'safe_reset_deferred' | 'pending_reinject_enter' | 'pending_reinject_exit',
    reason: string,
    urlHint?: string,
  ) => {
    const diagUrl = urlHint || currentUrlRef.current || 'unknown';
    const pending = pendingReinjectRef.current;
    const urlFamily = getCacheFamilyContext(diagUrl);
    console.log(
      '[DIAG][SAFE_RESET]',
      'event=' + event,
      'reason=' + reason,
      'navId=' + activeNavIdRef.current,
      'pageEpoch=' + webViewPageEpochRef.current,
      'urlFamily=' + urlFamily,
      'activeInstanceId=' + (webViewActiveInstanceIdRef.current ?? 'none'),
      'pending=' + (pending?.active ? 'true' : 'false'),
    );
  }, []);

  const exitPendingReinject = useCallback((reason: string, urlHint?: string) => {
    const pending = pendingReinjectRef.current;
    if (!pending?.active) return;
    clearPendingReinjectTimer();
    pendingReinjectRef.current = null;
    logSafeResetDiag('pending_reinject_exit', reason, urlHint);
  }, [clearPendingReinjectTimer, logSafeResetDiag]);

  const enterPendingReinject = useCallback((reason: string, urlHint?: string) => {
    const targetUrl = urlHint || currentUrlRef.current || '';
    const targetFamily = getCacheFamilyContext(targetUrl);
    const pendingNavId = activeNavIdRef.current;
    clearPendingReinjectTimer();
    pendingReinjectRef.current = {
      active: true,
      navId: pendingNavId,
      pageEpoch: webViewPageEpochRef.current,
      urlFamily: targetFamily,
      reason,
      enteredAt: Date.now(),
    };
    logSafeResetDiag('pending_reinject_enter', reason, targetUrl);
    pendingReinjectTimerRef.current = setTimeout(() => {
      const pending = pendingReinjectRef.current;
      if (!pending?.active || pending.navId !== pendingNavId) return;
      pendingReinjectRef.current = null;
      pendingReinjectTimerRef.current = null;
      logSafeResetDiag('pending_reinject_exit', reason + '_timeout', targetUrl);
      setCentralBlurState(false, 'url_change_safe_reset_pending_timeout');
    }, PENDING_REINJECT_WINDOW_MS);
  }, [clearPendingReinjectTimer, logSafeResetDiag, setCentralBlurState, PENDING_REINJECT_WINDOW_MS]);

  const logLifecycleSnapshot = useCallback((event: string, urlHint?: string, reason?: string) => {
    const currentUrl = urlHint || currentUrlRef.current || 'unknown';
    const activeTimerNames: string[] = [];
    if (loadEndInjectTimerRef.current) activeTimerNames.push('loadEndInjectTimer');
    if (blurRetryTimerRef.current) activeTimerNames.push('blurRetryTimer');
    if (overlayLiftHandshakeTimerRef.current) activeTimerNames.push('overlayLiftHandshakeTimer');
    if (blurPendingRef.current) activeTimerNames.push('blurPendingState');
    const overlayState = blurStateRef.current;
    console.log(
      '[DIAG][LIFECYCLE_SNAPSHOT]',
      'event=' + event,
      'reason=' + (reason || 'none'),
      'activeTimers=' + activeTimerNames.length,
      'activeTimerNames=' + (activeTimerNames.length ? activeTimerNames.join(',') : 'none'),
      'listenerStatus=' + webViewListenersAttachedRef.current,
      'activeInstanceId=' + (webViewActiveInstanceIdRef.current ?? 'none'),
      'navId=' + activeNavIdRef.current,
      'pageEpoch=' + webViewPageEpochRef.current,
      'currentUrl=' + toDiagUrl(currentUrl),
      'urlFamily=' + getUrlFamily(currentUrl),
      'overlayHostState=' + (overlayState.enabled ? 'enabled' : 'disabled'),
      'overlayReason=' + overlayState.reason,
      'overlayReady=' + blurReadyRef.current,
      'moderationEnabled=' + isRuntimeModerationEnabled,
    );
  }, [isRuntimeModerationEnabled, toDiagUrl]);

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
    shortsRelatedLegacyPollContextRef.current = null;
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

    const previousFamily = getCacheFamilyContext(previousUrl);
    const nextFamily = getCacheFamilyContext(url);
    const previousIsYouTubeFamily = isYouTubeFamilyContext(previousFamily);
    const nextIsYouTubeFamily = isYouTubeFamilyContext(nextFamily);
    let cacheFlushReason: string | null = null;

    if (previousUrl && previousIsYouTubeFamily && !nextIsYouTubeFamily) {
      cacheFlushReason = 'leave_youtube_family';
      logLifecycleSnapshot('leave_youtube', url, reason);
    } else if (previousUrl && !previousIsYouTubeFamily && nextIsYouTubeFamily) {
      cacheFlushReason = 'return_to_youtube_family';
      logLifecycleSnapshot('return_to_youtube', url, reason);
    } else if (
      previousUrl &&
      previousFamily !== nextFamily &&
      (
        (previousFamily === 'youtube_www' && nextFamily === 'youtube_mobile') ||
        (previousFamily === 'youtube_mobile' && nextFamily === 'youtube_www')
      )
    ) {
      cacheFlushReason = 'youtube_www_mobile_context_change';
      logLifecycleSnapshot('youtube_context_change', url, reason);
    }

    if (cacheFlushReason) {
      moderationBridge.clearCache({
        reason: cacheFlushReason,
        previousFamily,
        nextFamily,
        navId: activeNavIdRef.current,
        pageEpoch: webViewPageEpochRef.current,
      });
    }

    if (url) {
      currentUrlRef.current = url;
    }
  }, [logLifecycleSnapshot, moderationBridge]);

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
    if (!isRuntimeModerationEnabled) {
      console.log('[MW-Bridge] Moderation disabled, skipping injection');
      return;
    }

    const targetUrl = urlHint || currentUrlRef.current || '';
    const navId = activeNavIdRef.current || 0;
    const shortsProbeActive = isYouTubeShortsUrl(targetUrl);
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
      if (shortsProbeActive) {
        console.log(
          '[DIAG][SHORTS_PROBE]',
          'event=host_inject_skip',
          'navId=' + navId,
          'hostPageEpoch=' + webViewPageEpochRef.current,
          'reason=' + reason,
          'url=' + toDiagUrl(targetUrl || 'unknown'),
          'skipCount=' + duplicateInjectionSkipsRef.current,
        );
      }
      return;
    }

    injectionInFlightRef.current = true;
    if (shortsProbeActive) {
      console.log(
        '[DIAG][SHORTS_PROBE]',
        'event=host_inject_attempt',
        'navId=' + navId,
        'hostPageEpoch=' + webViewPageEpochRef.current,
        'reason=' + reason,
        'url=' + toDiagUrl(targetUrl || 'unknown'),
      );
    }
    console.log(
      '[DIAG][INJECT] start',
      'reason=' + reason,
      'navId=' + navId,
      'url=' + (targetUrl || 'unknown'),
    );
    const activeInstanceId = (
      typeof webViewActiveInstanceIdRef.current === 'number' &&
      Number.isFinite(webViewActiveInstanceIdRef.current)
    ) ? webViewActiveInstanceIdRef.current : null;
    const hostContextSyncScript = `
      (function() {
        try {
          window.__MW_ACTIVE_INSTANCE_ID__ = ${activeInstanceId === null ? 'null' : String(activeInstanceId)};
          window.__MW_HOST_NAV_ID__ = ${navId};
          window.__MW_HOST_PAGE_EPOCH__ = ${webViewPageEpochRef.current};
          if (
            window.__MW_ACTIVE_CONTEXT_API__ &&
            typeof window.__MW_ACTIVE_CONTEXT_API__.applyHostContextSync === 'function'
          ) {
            try {
              window.__MW_ACTIVE_CONTEXT_API__.applyHostContextSync('host_context_sync');
            } catch (contextSyncError) {}
          }
          return 'OK';
        } catch (e) {
          return 'ERR';
        }
      })();
    `;
    console.log(
      '[DIAG][INJECT] host_context_sync',
      'reason=' + reason,
      'navId=' + navId,
      'pageEpoch=' + webViewPageEpochRef.current,
      'activeInstanceId=' + (activeInstanceId ?? 'none'),
      'url=' + (targetUrl || 'unknown'),
    );
    const config = {
      ...getModerationConfig(),
      enabled: isRuntimeModerationEnabled,
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
    const combinedInjectionScript = hostContextSyncScript + '\n' + mainScript;
    try {
      const injectResult = await scriptExecutor(combinedInjectionScript);
      if (shortsProbeActive) {
        const resultRaw = injectResult === undefined
          ? 'undefined'
          : injectResult === null
            ? 'null'
            : String(injectResult);
        const resultClass = resultRaw === 'MW_ALREADY_ACTIVE'
          ? 'MW_ALREADY_ACTIVE'
          : resultRaw === 'OK'
            ? 'OK'
            : 'OTHER';
        console.log(
          '[DIAG][SHORTS_PROBE]',
          'event=host_inject_result',
          'navId=' + navId,
          'hostPageEpoch=' + webViewPageEpochRef.current,
          'reason=' + reason,
          'url=' + toDiagUrl(targetUrl || 'unknown'),
          'resultClass=' + resultClass,
          'resultRaw=' + resultRaw.substring(0, 160),
        );
      }
      injectionDoneRef.current = true;
      lastInjectedUrlRef.current = targetUrl;
      lastInjectionAtRef.current = Date.now();
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
      console.log(
        '[DIAG][INJECT] success',
        'reason=' + reason,
        'navId=' + navId,
        'url=' + (targetUrl || 'unknown'),
      );
      exitPendingReinject('inject_success', targetUrl);
    } catch (error) {
      console.error('[MW-Bridge] Moderation script injection failed:', error);
      if (shortsProbeActive) {
        console.log(
          '[DIAG][SHORTS_PROBE]',
          'event=host_inject_error',
          'navId=' + navId,
          'hostPageEpoch=' + webViewPageEpochRef.current,
          'reason=' + reason,
          'url=' + toDiagUrl(targetUrl || 'unknown'),
          'message=' + (error instanceof Error ? error.message : String(error)),
        );
      }
      console.log(
        '[DIAG][INJECT] error',
        'reason=' + reason,
        'navId=' + navId,
        'url=' + (targetUrl || 'unknown'),
        'message=' + (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      injectionInFlightRef.current = false;
    }
  }, [ENABLE_SIGNAL_PIPELINE, settingsLoaded, isRuntimeModerationEnabled, getModerationConfig, localSettings.diag_youtube_shorts, exitPendingReinject, toDiagUrl]);

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
      console.log('[DIAG][LOAD] stage=start url=' + toDiagUrl(url));
      console.log('[Browser] ======= LOAD START =======');
      console.log('[Browser] URL:', url);
      markNavigation('onLoadStart', url);
      teardownWebViewScheduling('navigation_start', url).catch(() => undefined);
      logHostLayerDiagnostics('load_start');
      setIsLoading(true);
      clearLoadEndInjectTimer();
      injectionDoneRef.current = false;
      injectionInFlightRef.current = false;
      blurReadyRef.current = false;
      resetOverlayLiftHandshakeState('navigation_load_start');
      resetShortsOverlayCoordinator('navigation_load_start');
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      const canDeferLoadStartReset =
        pendingReinjectRef.current?.active === true &&
        isYouTubeFamilyContext(getCacheFamilyContext(url));
      if (canDeferLoadStartReset) {
        logSafeResetDiag('safe_reset_deferred', 'navigation_load_start_pending_reinject', url);
        queueCurrentBlurState('navigation_load_start_deferred');
      } else {
        exitPendingReinject('navigation_load_start', url);
        setCentralBlurState(false, 'navigation_load_start');
      }
      setFlashGuardState?.(true, 'navigation_start');
      // Early request goes through stable scheduler to avoid churn bursts.
      scheduleStableInjection('onLoadStart', url);
    },
    onLoadEnd: async (url) => {
      console.log('[DIAG][LOAD] stage=success url=' + toDiagUrl(url));
      console.log('[Browser] ======= LOAD END =======');
      console.log('[Browser] URL:', url);
      logLifecycleSnapshot('page_load_end', url, 'onLoadEnd');
      logHostLayerDiagnostics('load_end');
      setIsLoading(false);
      setFlashGuardState?.(false, 'load_end');
      if (!ENABLE_SIGNAL_PIPELINE) return;
      
      // Inject moderation script after page fully loads
      if (!injectionDoneRef.current) {
        // Small delay to ensure DOM is ready
        clearLoadEndInjectTimer();
        loadEndInjectTimerRef.current = setTimeout(() => {
          scheduleStableInjection('onLoadEnd', url);
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
      console.log('[DIAG][LOAD] stage=error url=' + toDiagUrl(url) + ' error=' + String(error));
      console.error('[Browser] ======= LOAD ERROR =======');
      console.error('[Browser] URL:', url);
      console.error('[Browser] Error:', error);
      logHostLayerDiagnostics('load_error');
      setIsLoading(false);
      setFlashGuardState?.(true, 'load_error');
      clearLoadEndInjectTimer();
      injectionDoneRef.current = false;
      injectionInFlightRef.current = false;
      exitPendingReinject('load_error', url);
      setFallbackUrl(url);
      navigate('fallback', '', url);
    },
    onUrlChange: (url) => {
      const previousUrl = currentUrlRef.current || webViewState.currentUrl || '';
      const previousFamily = getCacheFamilyContext(previousUrl);
      const nextFamily = getCacheFamilyContext(url);
      const deferReason = `youtube_internal_nav_${previousFamily}_to_${nextFamily}`;
      const nextIsShorts = isYouTubeShortsUrl(url);
      const nextIsLivePlayer = isLivePlayerView(url);
      const nextIsShortsProfileSurface = getUrlFamily(url) === 'youtube_shorts_related' && !nextIsLivePlayer;
      const shouldSkipHardResetForProfileReveal =
        nextIsShortsProfileSurface &&
        hasSameUrlOriginAndPath(previousUrl, url);
      const shouldDeferSafeReset =
        !nextIsShorts &&
        !!previousUrl &&
        isRuntimeModerationEnabled &&
        isYouTubeFamilyContext(previousFamily) &&
        isYouTubeFamilyContext(nextFamily);
      console.log('[Browser] ======= URL CHANGE =======');
      console.log('[Browser] New URL:', url);
      console.log('[DIAG][LOAD] stage=url_change url=' + toDiagUrl(url));
      markNavigation('onUrlChange', url);
      logLifecycleSnapshot('url_change', url, 'onUrlChange');
      logHostLayerDiagnostics('url_change');
      setUrlInput(url);
      navigate('browse', url, url);
      // Reset injection for new page navigation
      clearLoadEndInjectTimer();
      injectionDoneRef.current = false;
      injectionInFlightRef.current = false;
      blurReadyRef.current = false;
      resetOverlayLiftHandshakeState('url_change');
      resetShortsOverlayCoordinator('url_change');
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      if (shouldSkipHardResetForProfileReveal) {
        console.log(
          '[DIAG][OVERLAY_HOST_STATE]',
          'action=skip_hard_reset',
          'reason=profile_soft_url_change',
          'prevUrl=' + (previousUrl || 'unknown'),
          'nextUrl=' + (url || 'unknown'),
        );
      } else {
        hardResetOverlayHostState('url_change_hard_reset');
      }
      if (nextIsShorts) {
        exitPendingReinject(`shorts_nav_reset_${previousFamily}_to_${nextFamily}`, url);
        setCentralBlurState(false, 'nav_reset');
      } else if (shouldDeferSafeReset) {
        logSafeResetDiag('safe_reset_deferred', deferReason, url);
        enterPendingReinject(deferReason, url);
        queueCurrentBlurState('url_change_safe_reset_deferred');
      } else {
        exitPendingReinject(`context_exit_${previousFamily}_to_${nextFamily}`, url);
        setCentralBlurState(false, 'url_change_safe_reset');
      }
      scheduleStableInjection('onUrlChange', url);
    },
    onNavigationRequest: handleNavigationRequest,
    onClose: () => {
      console.log('[Browser] ======= WEBVIEW CLOSED =======');
      teardownWebViewScheduling('webview_closed', webViewState.currentUrl).catch(() => undefined);
      clearLoadEndInjectTimer();
      exitPendingReinject('webview_closed', webViewState.currentUrl || currentUrlRef.current || '');
      moderationBridge.clearCache({
        reason: 'webview_closed',
        previousFamily: getCacheFamilyContext(webViewState.currentUrl || currentUrlRef.current || ''),
        nextFamily: 'none',
        navId: activeNavIdRef.current,
        pageEpoch: webViewPageEpochRef.current,
      });
      injectionDoneRef.current = false;
      injectionInFlightRef.current = false;
      blurReadyRef.current = false;
      resetOverlayLiftHandshakeState('webview_closed');
      resetShortsOverlayCoordinator('webview_closed');
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
      if (tryHandlePersistentRevealRequest(payload, 'capgo')) {
        return;
      }
      messageFromWebViewHandlerRef.current?.(payload);
    },
    onActiveInstanceIdChange: (activeInstanceId) => {
      const previousInstanceId = webViewActiveInstanceIdRef.current;
      webViewActiveInstanceIdRef.current = activeInstanceId;
      if (previousInstanceId === activeInstanceId) return;
      blurReadyRef.current = false;
      resetOverlayLiftHandshakeState('active_instance_change');
      resetShortsOverlayCoordinator('active_instance_change');
      blurReadyBurstRef.current = {
        navId: 0,
        pageEpoch: 0,
        url: '',
        at: 0,
      };
      queueCurrentBlurState('active_instance_id_change');
      console.log(
        '[DIAG][BLUR_READY_GATE]',
        'action=instance_change_reset',
        'prevActiveInstanceId=' + (previousInstanceId ?? 'none'),
        'nextActiveInstanceId=' + (activeInstanceId ?? 'none'),
        'navId=' + (activeNavIdRef.current || 0),
        'url=' + (currentUrlRef.current || 'unknown'),
      );
    },
    getListenerDiagContext: getWebViewListenerDiagContext,
  });

  const requestShortsReentryRefresh = useCallback(async (
    reason: string,
    urlHint?: string,
    force?: boolean,
  ) => {
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    const activeUrl = urlHint || webViewState.currentUrl || currentUrlRef.current || '';
    if (!isYouTubeShortsUrl(activeUrl)) return;
    const navId = activeNavIdRef.current || 0;
    const now = Date.now();
    const previous = shortsReentryRefreshRef.current;
    if (
      !force &&
      previous.navId === navId &&
      previous.url === activeUrl &&
      (now - previous.at) < 1800
    ) {
      console.log(
        '[DIAG][SHORTS_REENTRY][HOST]',
        'action=skip_duplicate',
        'reason=' + reason,
        'navId=' + navId,
        'url=' + toDiagUrl(activeUrl),
      );
      return;
    }

    shortsReentryRefreshRef.current = {
      navId,
      url: activeUrl,
      at: now,
    };

    const safeReason = escapeForJs(reason || 'host_shorts_reentry');
    const result = await executeScript(`
      (function() {
        try {
          if (typeof window.__MW_SHORTS_REENTRY_REFRESH__ !== 'function') return 'NO_HOOK';
          return window.__MW_SHORTS_REENTRY_REFRESH__('${safeReason}');
        } catch (e) {
          return 'ERR:' + String(e);
        }
      })();
    `);
    console.log(
      '[DIAG][SHORTS_REENTRY][HOST]',
      'action=requested',
      'reason=' + reason,
      'navId=' + navId,
      'url=' + toDiagUrl(activeUrl),
      'result=' + String(result || 'null'),
    );
  }, [isNative, webViewState.isOpen, webViewState.currentUrl, executeScript, toDiagUrl]);

  const ensureShortsRevealUi = useCallback(async (
    reason: string,
    requestId: string,
    sovereignId: string,
    videoId: string,
    mismatchedCount: number,
  ) => {
    if (!isNative || !webViewState.isOpen || !executeScript) {
      console.log(
        '[DIAG][SHORTS_ATOMIC]',
        'action=id_mismatch_reveal_ui',
        'requestId=' + requestId,
        'sovereignId=' + sovereignId,
        'videoId=' + videoId,
        'mismatchedCount=' + mismatchedCount,
        'result=no_execute_script',
      );
      return;
    }
    const safeReason = escapeForJs(reason || 'id_mismatch_fallback');
    const safeSovereignId = escapeForJs(sovereignId || 'none');
    const safeVideoId = escapeForJs(videoId || 'none');
    const isTimeoutSafeFailure = String(reason || '').indexOf('timeout_safe_failure') !== -1;
    const ensureResult = await executeScript(`
      (function() {
        try {
          var ensured = false;
          if (typeof window.__MW_START_REVEAL_WATCH__ === 'function') {
            try {
              window.__MW_START_REVEAL_WATCH__('${safeReason}', {
                key: '${safeSovereignId}',
                force: true,
                videoId: '${safeVideoId}'
              });
            } catch (watchErr) {}
          }
          if (typeof window.__MW_ENSURE_REVEAL_UI__ === 'function') {
            ensured = !!window.__MW_ENSURE_REVEAL_UI__('${safeReason}');
          } else if (typeof window.__MW_SCAN_FULL__ === 'function') {
            window.__MW_SCAN_FULL__();
            ensured = false;
          } else if (window.__MW_DEBUG__ && typeof window.__MW_DEBUG__.scanAll === 'function') {
            window.__MW_DEBUG__.scanAll();
            ensured = false;
          }
          if (${isTimeoutSafeFailure ? 'true' : 'false'} && typeof window.__MW_APPLY_REVEAL_UI_LOCK__ === 'function') {
            try {
              window.__MW_APPLY_REVEAL_UI_LOCK__('timeout_safe_failure:${safeReason}', 2000, '${safeVideoId}');
            } catch (lockErr) {}
          }
          return ensured;
        } catch (e) {
          return false;
        }
      })();
    `);
    const ensureResultLabel = ensureResult === null || typeof ensureResult === 'undefined'
      ? 'null'
      : String(ensureResult);
    console.log(
      '[DIAG][SHORTS_ATOMIC]',
      'action=id_mismatch_reveal_ui',
      'reason=' + reason,
      'requestId=' + requestId,
      'sovereignId=' + sovereignId,
      'videoId=' + videoId,
      'mismatchedCount=' + mismatchedCount,
      'result=' + String(ensureResult === true),
      'raw=' + ensureResultLabel,
    );
  }, [isNative, webViewState.isOpen, executeScript]);

  const scheduleShortsMatchingRetryScan = useCallback((
    requestId: string,
    sovereignId: string,
    videoId: string,
    mismatchedCount: number,
  ) => {
    if (!sovereignId) return;
    const retryState = shortsMatchingRetryRef.current;
    if (retryState.attemptedSovereignId === sovereignId) {
      console.log(
        '[DIAG][SHORTS_ATOMIC]',
        'action=retry_scan_skip',
        'reason=already_attempted_for_sovereign',
        'requestId=' + requestId,
        'sovereignId=' + sovereignId,
        'videoId=' + videoId,
      );
      return;
    }

    retryState.needsMatchingScan = true;
    retryState.pendingSovereignId = sovereignId;
    clearShortsMatchingRetryTimer();
    retryState.timer = setTimeout(() => {
      retryState.timer = null;
      const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
      const activeSovereignId = getSovereignIdForContext(
        activeUrl,
        activeNavIdRef.current,
        webViewPageEpochRef.current,
      );
      const shouldAbort =
        !retryState.needsMatchingScan ||
        retryState.pendingSovereignId !== sovereignId ||
        !isYouTubeShortsUrl(activeUrl) ||
        activeSovereignId !== sovereignId;
      if (shouldAbort) {
        retryState.needsMatchingScan = false;
        if (retryState.pendingSovereignId === sovereignId) {
          retryState.pendingSovereignId = '';
        }
        console.log(
          '[DIAG][SHORTS_ATOMIC]',
          'action=retry_scan_skip',
          'reason=context_changed',
          'requestId=' + requestId,
          'targetSovereignId=' + sovereignId,
          'activeSovereignId=' + activeSovereignId,
          'activeUrl=' + (activeUrl || 'unknown'),
        );
        return;
      }

      retryState.needsMatchingScan = false;
      retryState.pendingSovereignId = '';
      retryState.attemptedSovereignId = sovereignId;

      void (async () => {
        try {
          console.log(
            '[DIAG][SHORTS_ATOMIC]',
            'action=retry_scan_fire',
            'requestId=' + requestId,
            'sovereignId=' + sovereignId,
            'videoId=' + videoId,
            'mismatchedCount=' + mismatchedCount,
            'delayMs=' + SHORTS_MATCHING_RETRY_DELAY_MS,
          );
          await requestShortsReentryRefresh('id_mismatch_retry_scan', activeUrl, true);
          if (!executeScript) {
            console.log(
              '[DIAG][SHORTS_ATOMIC]',
              'action=retry_scan_result',
              'requestId=' + requestId,
              'result=no_execute_script',
            );
            return;
          }
          const safeSovereignId = escapeForJs(sovereignId || 'none');
          const safeVideoId = escapeForJs(videoId || 'none');
          const retryResult = await executeScript(`
            (function() {
              try {
                var actions = [];
                if (typeof window.__MW_START_REVEAL_WATCH__ === 'function') {
                  var watchResult = window.__MW_START_REVEAL_WATCH__('id_mismatch_retry_scan', {
                    key: '${safeSovereignId}',
                    force: true,
                    videoId: '${safeVideoId}'
                  });
                  actions.push('REVEAL_WATCH:' + String(watchResult || 'unknown'));
                }
                if (typeof window.__MW_SCAN_FULL__ === 'function') {
                  window.__MW_SCAN_FULL__();
                  actions.push('SCAN_FULL');
                }
                if (typeof window.__MW_SCAN_YT__ === 'function') {
                  window.__MW_SCAN_YT__();
                  actions.push('SCAN_YT');
                } else if (window.__MW_DEBUG__ && typeof window.__MW_DEBUG__.scanAll === 'function') {
                  window.__MW_DEBUG__.scanAll();
                  actions.push('DEBUG_SCAN_ALL');
                }
                var videoCount = 0;
                var imgCount = 0;
                try {
                  var videos = document.querySelectorAll('video');
                  videoCount = videos.length;
                  for (var i = 0; i < videos.length; i += 1) {
                    var video = videos[i];
                    if (!video || !video.isConnected) continue;
                    try { video.dispatchEvent(new Event('loadedmetadata')); } catch (e1) {}
                    try { video.dispatchEvent(new Event('loadeddata')); } catch (e2) {}
                    try { video.dispatchEvent(new Event('canplay')); } catch (e3) {}
                  }
                } catch (probeError) {}
                try {
                  imgCount = document.querySelectorAll('img').length;
                } catch (imgError) {}
                actions.push('DOM_REPROBE:v=' + videoCount + ',img=' + imgCount);
                if (typeof window.__MW_ENSURE_REVEAL_UI__ === 'function') {
                  var revealResult = window.__MW_ENSURE_REVEAL_UI__('id_mismatch_retry_scan');
                  var revealResultLabel = (
                    revealResult === null ||
                    typeof revealResult === 'undefined'
                  ) ? 'null' : String(revealResult);
                  actions.push('REVEAL_UI:' + revealResultLabel);
                }
                return actions.join('|') || 'NO_SCAN_HOOK';
              } catch (e) {
                return 'ERR:' + String(e);
              }
            })();
          `);
          console.log(
            '[DIAG][SHORTS_ATOMIC]',
            'action=retry_scan_result',
            'requestId=' + requestId,
            'sovereignId=' + sovereignId,
            'result=' + String(retryResult || 'null'),
          );
        } catch (error) {
          console.warn(
            '[DIAG][SHORTS_ATOMIC]',
            'action=retry_scan_error',
            'requestId=' + requestId,
            'sovereignId=' + sovereignId,
            'message=' + (error instanceof Error ? error.message : String(error)),
          );
        }
      })();
    }, SHORTS_MATCHING_RETRY_DELAY_MS);

    console.log(
      '[DIAG][SHORTS_ATOMIC]',
      'action=retry_scan_scheduled',
      'requestId=' + requestId,
      'sovereignId=' + sovereignId,
      'videoId=' + videoId,
      'mismatchedCount=' + mismatchedCount,
      'delayMs=' + SHORTS_MATCHING_RETRY_DELAY_MS,
      'needsMatchingScan=' + retryState.needsMatchingScan,
    );
  }, [
    SHORTS_MATCHING_RETRY_DELAY_MS,
    clearShortsMatchingRetryTimer,
    executeScript,
    getSovereignIdForContext,
    requestShortsReentryRefresh,
    webViewState.currentUrl,
  ]);

  useEffect(() => {
    currentUrlRef.current = webViewState.currentUrl || '';
  }, [webViewState.currentUrl]);

  useEffect(() => {
    const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
    const inShorts = isYouTubeShortsUrl(activeUrl);
    const wasInShorts = shortsModeActiveRef.current;
    shortsModeActiveRef.current = inShorts;
    if (inShorts && !wasInShorts) {
      const sinceLastReq = Date.now() - shortsLegacyFallbackRef.current.lastReqSentAt;
      if (sinceLastReq > SHORTS_LEGACY_FALLBACK_REQ_GRACE_MS) {
        armShortsLegacyFallbackProbe('shorts_entry_uncertain', SHORTS_LEGACY_FALLBACK_ENTRY_PROBE_MS);
      }
      void requestShortsReentryRefresh('shorts_entry_transition', activeUrl, true);
      return;
    }
    if (!inShorts && wasInShorts) {
      disarmShortsLegacyFallbackProbe('shorts_exit');
    }
  }, [webViewState.currentUrl, armShortsLegacyFallbackProbe, disarmShortsLegacyFallbackProbe, requestShortsReentryRefresh]);

  useEffect(() => {
    if (!webViewState.isOpen) return;
    const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
    if (!isYouTubeShortsUrl(activeUrl)) return;
    void requestShortsReentryRefresh('webview_open_shorts', activeUrl, false);
  }, [webViewState.isOpen, webViewState.currentUrl, requestShortsReentryRefresh]);

  useEffect(() => {
    webViewListenersAttachedRef.current = webViewListenersAttached;
  }, [webViewListenersAttached]);

  useEffect(() => {
    console.log(
      '[DIAG][SHIELD_STATE]',
      'shieldEnabled=' + effectiveShieldEnabled,
      'runtimeModeration=' + isRuntimeModerationEnabled,
      'blurDial=' + localSettings.blur_dial,
      'currentView=' + currentView,
      'webViewOpen=' + webViewState.isOpen,
    );
  }, [
    effectiveShieldEnabled,
    isRuntimeModerationEnabled,
    localSettings.blur_dial,
    currentView,
    webViewState.isOpen,
  ]);

  const probeWebViewOverlayState = useCallback(async (reason: string) => {
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    const payload = await executeScript(`
      (function() {
        try {
          var overlay = document.getElementById('mw-blur-overlay');
          var overlayStyle = overlay ? window.getComputedStyle(overlay) : null;
          var x = Math.max(0, Math.min(window.innerWidth - 1, Math.floor(window.innerWidth / 2)));
          var y = Math.max(0, Math.min(window.innerHeight - 1, Math.floor(window.innerHeight / 2)));
          var top = document.elementFromPoint(x, y);
          var topStyle = top ? window.getComputedStyle(top) : null;
          var topClass = top && typeof top.className === 'string' ? top.className.trim().replace(/\\s+/g, '.').slice(0, 80) : '';
          return JSON.stringify({
            overlayPresent: !!overlay,
            overlayEnabled: !!(overlay && overlay.classList.contains('mw-enabled')),
            overlayDisplay: overlayStyle ? overlayStyle.display : null,
            overlayOpacity: overlayStyle ? overlayStyle.opacity : null,
            overlayVisibility: overlayStyle ? overlayStyle.visibility : null,
            viewport: { width: window.innerWidth, height: window.innerHeight },
            top: top ? {
              tag: top.tagName ? String(top.tagName).toLowerCase() : 'unknown',
              id: top.id || null,
              className: topClass || null,
              zIndex: topStyle ? topStyle.zIndex : null,
              opacity: topStyle ? topStyle.opacity : null,
              visibility: topStyle ? topStyle.visibility : null
            } : null
          });
        } catch (e) {
          return JSON.stringify({ error: String(e) });
        }
      })();
    `);
    console.log(
      '[DIAG][WEBVIEW_LAYER]',
      'reason=' + reason,
      'payload=' + String(payload || 'null'),
    );
  }, [isNative, webViewState.isOpen, executeScript]);

  useEffect(() => {
    if (currentView !== 'browse') return;
    logHostLayerDiagnostics('browse_view_active');
    void probeWebViewOverlayState('browse_view_active');
  }, [currentView, webViewState.isOpen, logHostLayerDiagnostics, probeWebViewOverlayState]);

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
    const moderationEnabled = isRuntimeModerationEnabled;
    const gate =
      settingsLoaded &&
      isNative &&
      webViewState.isOpen &&
      moderationEnabled;

    if (!gate) {
      console.log(
            '[MW][NativeScan] stop gate=' +
          JSON.stringify({
            settingsLoaded,
            isNative,
            webViewOpen: webViewState.isOpen,
            moderationEnabled,
            shieldActive: effectiveShieldEnabled,
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
              shieldActive: effectiveShieldEnabled,
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
            shieldActive: effectiveShieldEnabled,
            blurDialActive: localSettings.blur_dial > 0,
          }),
      );
      riskDecisionListenerRef.current?.remove();
      riskDecisionListenerRef.current = null;
      stopNativeContentFilter().catch(() => undefined);
    };
  }, [settingsLoaded, isNative, webViewState.isOpen, debugLog, isDebugMode, isRuntimeModerationEnabled, effectiveShieldEnabled, localSettings.blur_dial, localSettings.blocking_mode]);

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

  const getStableInjectionKey = useCallback((urlHint?: string) => {
    const resolvedUrl = urlHint || webViewState.currentUrl || currentUrlRef.current || '';
    const navId = activeNavIdRef.current || 0;
    const pageEpoch = webViewPageEpochRef.current || 0;
    const activeInstanceId = (
      typeof webViewActiveInstanceIdRef.current === 'number' &&
      Number.isFinite(webViewActiveInstanceIdRef.current)
    ) ? webViewActiveInstanceIdRef.current : 0;
    const urlFamily = getUrlFamily(resolvedUrl);
    const shortsVideoId = getYouTubeShortsId(resolvedUrl);
    return [
      String(activeInstanceId),
      String(navId),
      String(pageEpoch),
      String(urlFamily || 'unknown'),
      String(shortsVideoId || 'none'),
    ].join('|');
  }, [webViewState.currentUrl]);

  const getStableInjectionDebounceMs = useCallback((urlHint?: string) => {
    const resolvedUrl = urlHint || webViewState.currentUrl || currentUrlRef.current || '';
    return getUrlFamily(resolvedUrl) === 'youtube_shorts'
      ? STABLE_INJECTION_SHORTS_DEBOUNCE_MS
      : STABLE_INJECTION_DEBOUNCE_MS;
  }, [STABLE_INJECTION_SHORTS_DEBOUNCE_MS, STABLE_INJECTION_DEBOUNCE_MS, webViewState.currentUrl]);

  const scheduleStableInjection = useCallback((reason: string, urlHint?: string) => {
    if (!ENABLE_SIGNAL_PIPELINE) return;
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    if (!settingsLoaded || !isRuntimeModerationEnabled) return;
    if (!webViewListenersAttachedRef.current) return;

    const targetUrl = urlHint || webViewState.currentUrl || currentUrlRef.current || 'about:blank';
    const nextState: StableInjectionState = {
      key: getStableInjectionKey(targetUrl),
      url: targetUrl,
      navId: activeNavIdRef.current || 0,
      pageEpoch: webViewPageEpochRef.current || 0,
      shortsVideoId: getYouTubeShortsId(targetUrl) || 'none',
      reasons: [reason || 'stable_inject'],
      scheduledAt: Date.now(),
    };
    const pending = stableInjectionPendingRef.current;
    if (pending && pending.key === nextState.key && pending.url === nextState.url) {
      const mergedReasons = pending.reasons.slice();
      if (!mergedReasons.includes(reason)) mergedReasons.push(reason);
      stableInjectionPendingRef.current = {
        ...pending,
        reasons: mergedReasons,
        scheduledAt: Date.now(),
      };
    } else {
      stableInjectionPendingRef.current = nextState;
    }
    clearStableInjectionTimer('reschedule');
    const debounceMs = getStableInjectionDebounceMs(targetUrl);
    stableInjectionTimerRef.current = setTimeout(() => {
      stableInjectionTimerRef.current = null;
      const pendingState = stableInjectionPendingRef.current;
      if (!pendingState) return;
      stableInjectionPendingRef.current = null;
      const activeUrl = webViewState.currentUrl || currentUrlRef.current || pendingState.url || 'about:blank';
      const activeKey = getStableInjectionKey(activeUrl);
      if (activeKey !== pendingState.key) {
        console.log(
          '[DIAG][INJECT_STABLE]',
          'action=requeue_context_shift',
          'reason=' + pendingState.reasons.join('+'),
          'pendingKey=' + pendingState.key,
          'activeKey=' + activeKey,
          'navId=' + activeNavIdRef.current,
          'url=' + activeUrl,
        );
        scheduleStableInjection('context_shift:' + (pendingState.reasons[0] || 'unknown'), activeUrl);
        return;
      }
      const now = Date.now();
      const last = lastStableInjectionRef.current;
      const activeDebounceMs = getStableInjectionDebounceMs(activeUrl);
      if (last.key === activeKey && (now - last.at) < activeDebounceMs) {
        console.log(
          '[DIAG][INJECT_STABLE]',
          'action=skip_recent_same_key',
          'reason=' + pendingState.reasons.join('+'),
          'key=' + activeKey,
          'deltaMs=' + (now - last.at),
          'debounceMs=' + activeDebounceMs,
        );
        return;
      }
      const mergedReason = pendingState.reasons.join('+') || 'stable_inject';
      console.log(
        '[DIAG][INJECT_STABLE]',
        'action=fire',
        'reason=' + mergedReason,
        'key=' + activeKey,
        'navId=' + activeNavIdRef.current,
        'pageEpoch=' + webViewPageEpochRef.current,
        'url=' + activeUrl,
      );
      void (async () => {
        await injectModerationScript(executeScript, mergedReason, activeUrl);
        if (ENABLE_DOM_BLUR) {
          const activeVideoId = getYouTubeShortsId(activeUrl) || 'none';
          const lastReadyShorts = lastShortsBlurReadyVideoRef.current;
          const suppressPing =
            getUrlFamily(activeUrl) === 'youtube_shorts' &&
            activeVideoId !== 'none' &&
            lastReadyShorts.videoId === activeVideoId &&
            (Date.now() - lastReadyShorts.at) <= BLUR_READY_PING_SUPPRESS_MS;
          if (suppressPing) {
            console.log(
              '[DIAG][INJECT_STABLE]',
              'action=suppress_ping_recent_blur_ready',
              'reason=' + mergedReason,
              'videoId=' + activeVideoId,
              'deltaMs=' + (Date.now() - lastReadyShorts.at),
              'windowMs=' + BLUR_READY_PING_SUPPRESS_MS,
            );
          } else {
            await requestBlurHandshake('stable_inject:' + mergedReason);
          }
        }
        lastStableInjectionRef.current = {
          key: activeKey,
          at: Date.now(),
        };
      })().catch((error) => {
        console.warn(
          '[DIAG][INJECT_STABLE]',
          'action=fire_error',
          'reason=' + mergedReason,
          'message=' + (error instanceof Error ? error.message : String(error)),
        );
      });
    }, debounceMs);
    console.log(
      '[DIAG][INJECT_STABLE]',
      'action=scheduled',
      'reason=' + reason,
      'debounceMs=' + debounceMs,
      'key=' + (stableInjectionPendingRef.current?.key || nextState.key),
      'navId=' + (stableInjectionPendingRef.current?.navId || nextState.navId),
      'url=' + (stableInjectionPendingRef.current?.url || nextState.url),
    );
  }, [
    ENABLE_SIGNAL_PIPELINE,
    ENABLE_DOM_BLUR,
    BLUR_READY_PING_SUPPRESS_MS,
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    executeScript,
    settingsLoaded,
    isRuntimeModerationEnabled,
    getStableInjectionKey,
    getStableInjectionDebounceMs,
    clearStableInjectionTimer,
    injectModerationScript,
    requestBlurHandshake,
  ]);

  const shouldHoldShortsOverlaySync = useCallback(() => {
    const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
    if (getUrlFamily(activeUrl) !== 'youtube_shorts') return false;
    const pending = shortsOverlayPendingRef.current;
    if (!pending) return false;
    const activeSovereignId = getSovereignIdForContext(activeUrl);
    if (pending.sovereignId !== activeSovereignId) return false;
    const readyToCommit = hasEffectiveShortsBlurSignal(pending) && pending.hasModerationResult;
    if (readyToCommit) return false;
    const timedOut = (Date.now() - pending.startedAt) >= SHORTS_OVERLAY_ATOMIC_TIMEOUT_MS;
    return !timedOut;
  }, [SHORTS_OVERLAY_ATOMIC_TIMEOUT_MS, webViewState.currentUrl, getSovereignIdForContext, hasEffectiveShortsBlurSignal]);

  const flushBlurStateToWebView = useCallback(async () => {
    if (!ENABLE_DOM_BLUR) return;
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    if (!blurReadyRef.current) return;
    const pending = blurPendingRef.current || blurStateRef.current;
    const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
    const activeUrlFamily = getUrlFamily(activeUrl);
    const overlayLiftHandshakeMs = activeUrlFamily === 'youtube_shorts'
      ? 0
      : OVERLAY_LIFT_HANDSHAKE_MS;
    const holdShortsOverlaySync = shouldHoldShortsOverlaySync();
    if (holdShortsOverlaySync && pending.enabled) {
      const pendingShorts = shortsOverlayPendingRef.current;
      if (pendingShorts) {
        console.log(
          '[DIAG][SHORTS_ATOMIC]',
          'action=hold_overlay_sync',
          'sovereignId=' + pendingShorts.sovereignId,
          'hasBlurSignal=' + pendingShorts.hasBlurSignal,
          'jsBlurApplied=' + pendingShorts.jsBlurApplied,
          'jsRevealApplied=' + pendingShorts.jsRevealApplied,
          'effectiveBlurSignal=' + hasEffectiveShortsBlurSignal(pendingShorts),
          'hasModerationResult=' + pendingShorts.hasModerationResult,
          'result=' + (pendingShorts.result || 'none'),
        );
      }
      return;
    }
    if (holdShortsOverlaySync && !pending.enabled) {
      const pendingShorts = shortsOverlayPendingRef.current;
      if (pendingShorts) {
        console.log(
          '[DIAG][SHORTS_ATOMIC]',
          'action=bypass_hold_for_clear',
          'reason=' + pending.reason,
          'sovereignId=' + pendingShorts.sovereignId,
          'hasBlurSignal=' + pendingShorts.hasBlurSignal,
          'jsBlurApplied=' + pendingShorts.jsBlurApplied,
          'jsRevealApplied=' + pendingShorts.jsRevealApplied,
          'effectiveBlurSignal=' + hasEffectiveShortsBlurSignal(pendingShorts),
          'hasModerationResult=' + pendingShorts.hasModerationResult,
          'result=' + (pendingShorts.result || 'none'),
        );
      }
    }
    if (!holdShortsOverlaySync) {
      if (activeUrlFamily === 'youtube_shorts') {
        const pendingShorts = shortsOverlayPendingRef.current;
        const activeSovereignId = getSovereignIdForContext(activeUrl);
        const timedOutWithoutResult = !!pendingShorts &&
          pendingShorts.sovereignId === activeSovereignId &&
          hasEffectiveShortsBlurSignal(pendingShorts) &&
          !pendingShorts.hasModerationResult &&
          (Date.now() - pendingShorts.startedAt) >= SHORTS_OVERLAY_ATOMIC_TIMEOUT_MS;
        if (timedOutWithoutResult && !pendingShorts.fallbackRevealEnsured) {
          pendingShorts.fallbackRevealEnsured = true;
          const fallbackVideoId = parseSovereignId(pendingShorts.sovereignId).videoId;
          console.warn(
            '[DIAG][SHORTS_ATOMIC]',
            'action=timeout_safe_failure_reveal_ui',
            'sovereignId=' + pendingShorts.sovereignId,
            'videoId=' + fallbackVideoId,
            'elapsedMs=' + (Date.now() - pendingShorts.startedAt),
          );
          void ensureShortsRevealUi(
            'shorts_atomic_timeout_safe_failure',
            'timeout_' + pendingShorts.startedAt.toString(36),
            pendingShorts.sovereignId,
            fallbackVideoId,
            0,
          );
        }
      }
    }

    if (pending.enabled) {
      cancelOverlayLiftHandshakeWindow('state_enable_or_hold_release');
    } else {
      const now = Date.now();
      const needsLiftHandshake = overlayLastSyncedEnabledRef.current;
      if (needsLiftHandshake && overlayLiftHandshakeMs > 0 && overlayLiftHandshakeUntilRef.current === 0) {
        overlayLiftHandshakeUntilRef.current = now + overlayLiftHandshakeMs;
        scheduleOverlayLiftHandshakeRetry(overlayLiftHandshakeMs, 'disable_prepare');
        console.log(
          '[DIAG][OVERLAY_HANDSHAKE]',
          'action=hold_before_disable',
          'reason=' + pending.reason,
          'windowMs=' + overlayLiftHandshakeMs,
        );
        void requestBlurHandshake('overlay_lift_prepare:' + pending.reason).catch(() => undefined);
        return;
      }
      if (overlayLiftHandshakeMs > 0 && overlayLiftHandshakeUntilRef.current > now) {
        const remainingMs = Math.max(1, overlayLiftHandshakeUntilRef.current - now);
        scheduleOverlayLiftHandshakeRetry(remainingMs, 'disable_wait');
        console.log(
          '[DIAG][OVERLAY_HANDSHAKE]',
          'action=hold_in_progress',
          'reason=' + pending.reason,
          'remainingMs=' + remainingMs,
        );
        return;
      }
      cancelOverlayLiftHandshakeWindow('disable_ready_commit');
    }

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
    overlayLastSyncedEnabledRef.current = pending.enabled;
    return;
  }, [
    ENABLE_DOM_BLUR,
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    executeScript,
    shouldHoldShortsOverlaySync,
    hasEffectiveShortsBlurSignal,
    SHORTS_OVERLAY_ATOMIC_TIMEOUT_MS,
    OVERLAY_LIFT_HANDSHAKE_MS,
    cancelOverlayLiftHandshakeWindow,
    scheduleOverlayLiftHandshakeRetry,
    requestBlurHandshake,
    getSovereignIdForContext,
    ensureShortsRevealUi,
  ]);

  const syncOverlayState = useCallback(async (reason: string) => {
    queueCurrentBlurState(reason);
    await flushBlurStateToWebView();
  }, [queueCurrentBlurState, flushBlurStateToWebView]);

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
      void syncOverlayState('host_visible_resync');
    };

    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ENABLE_DOM_BLUR, isNative, webViewState.isOpen, requestBlurHandshake, syncOverlayState]);

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
      resetOverlayLiftHandshakeState('settings_reinject');
      resetShortsOverlayCoordinator('settings_reinject');
    }

    console.log(
      '[DIAG][ORDER]',
      'step=listeners_attached',
      'name=stableInjection',
      'navId=' + activeNavIdRef.current,
      'url=' + urlHint,
      'listenersAttached=' + webViewListenersAttached,
    );
    scheduleStableInjection('settings_loaded_reinject_or_urlchange', urlHint);
  }, [
    ENABLE_SIGNAL_PIPELINE,
    ENABLE_DOM_BLUR,
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    executeScript,
    webViewListenersAttached,
    resetShortsOverlayCoordinator,
    resetOverlayLiftHandshakeState,
    scheduleStableInjection,
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
    scheduleStableInjection('settings_loaded_reinject', urlHint);
  }, [
    ENABLE_SIGNAL_PIPELINE,
    settingsLoaded,
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    executeScript,
    scheduleStableInjection,
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
      clearPendingReinjectTimer();
      clearStableInjectionTimer('unmount_cleanup');
      stableInjectionPendingRef.current = null;
      pendingReinjectRef.current = null;
      clearShortsOverlayAtomicTimeout();
      clearShortsMatchingRetryTimer();
      if (blurRetryTimerRef.current) {
        clearTimeout(blurRetryTimerRef.current);
      }
      resetOverlayLiftHandshakeState('unmount_cleanup');
    };
  }, [
    clearLoadEndInjectTimer,
    clearPendingReinjectTimer,
    clearStableInjectionTimer,
    clearShortsOverlayAtomicTimeout,
    clearShortsMatchingRetryTimer,
    resetOverlayLiftHandshakeState,
  ]);

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
    const { requestId, items, thresholds } = request;
    const requestEpoch = Number.isFinite(request.pageEpoch) ? Number(request.pageEpoch) : null;
    const requestSovereignId = typeof request.sovereignId === 'string' ? request.sovereignId : '';
    const activeEpoch = webViewPageEpochRef.current;
    const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
    const activeSovereignId = getSovereignIdForContext(activeUrl, activeNavIdRef.current, activeEpoch);
    let effectiveRequestSovereignId = requestSovereignId;
    const stickyShortsMode = isYouTubeShortsUrl(activeUrl);
    const livePlayerView = isLivePlayerView(activeUrl);
    const isShortsAtomic = stickyShortsMode;
    const stickyShortsRelatedMode = getUrlFamily(activeUrl) === 'youtube_shorts_related';
    const relaxedYouTubeEpochMode = isYouTubeDomainUrl(activeUrl) && !stickyShortsMode && !stickyShortsRelatedMode;
    const requestEpochAccepted = isGraceEpochAcceptedForActiveShortsVideo(
      requestEpoch,
      activeEpoch,
      activeUrl,
      requestSovereignId,
    );
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const disarmFlashShield = (reason: string, diagLabel?: string) => {
      if (isShortsAtomic) return;
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      setFlashGuardState?.(false, reason);
      if (diagLabel) {
        flashLog(diagLabel);
      }
    };

    if (isShortsAtomic) {
      flashLog('skip arm via moderation_request shorts_atomic');
    } else {
      setFlashGuardState?.(true, 'moderation_request');
      flashLog('armed via moderation_request');
      timeoutId = setTimeout(() => {
        setFlashGuardState?.(false, 'moderation_request_timeout');
        flashLog('timeout -> disarm');
        timeoutId = null;
      }, 8000);
    }
    
    if (pendingRequestsRef.current.has(requestId)) {
      console.log('[MW-Host] Duplicate request ignored:', requestId);
      disarmFlashShield('moderation_duplicate_request', 'disarm duplicate request');
      return;
    }
    pendingRequestsRef.current.add(requestId);

    if (requestEpoch !== null && !requestEpochAccepted && !relaxedYouTubeEpochMode) {
      const rejectReason = stickyShortsMode
        ? 'request_epoch_mismatch_shorts_strict'
        : stickyShortsRelatedMode
          ? 'request_epoch_mismatch_shorts_related_strict'
        : 'request_epoch_mismatch_non_youtube';
      console.warn(
        '[DIAG][EPOCH_BYPASS]',
        'epoch_bypass_blocked',
        'reason=' + rejectReason,
        'navId=' + activeNavIdRef.current,
        'requestPageEpoch=' + requestEpoch,
        'currentPageEpoch=' + activeEpoch,
        'urlFamily=' + getUrlFamily(activeUrl),
        'url=' + (activeUrl || 'unknown'),
      );
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
        const staleMessage = createResultMessage(
          requestId,
          staleResults,
          nonce,
          requestEpoch ?? undefined,
          requestSovereignId || undefined,
        );
        await postMessageToWebView(staleMessage as unknown as Record<string, unknown>);
      } catch {
        // Fail-open by design for stale requests.
      }

      pendingRequestsRef.current.delete(requestId);
      disarmFlashShield('moderation_epoch_stale', 'disarm stale epoch');
      return;
    }
    if (stickyShortsMode && requestSovereignId && requestSovereignId !== activeSovereignId) {
      const requestSovereign = parseSovereignId(requestSovereignId);
      const activeSovereign = parseSovereignId(activeSovereignId);
      const navIdChanged = requestSovereign.navId !== activeSovereign.navId;
      const sameVideoId = (
        requestSovereign.videoId !== 'none' &&
        requestSovereign.videoId === activeSovereign.videoId
      );
      if (navIdChanged && sameVideoId) {
        effectiveRequestSovereignId = activeSovereignId;
        console.info(
          '[DIAG][SHORTS_ATOMIC]',
          'action=accept_stale_sovereign_video_match',
          'requestId=' + requestId,
          'requestSovereignId=' + requestSovereignId,
          'activeSovereignId=' + activeSovereignId,
          'requestNavId=' + requestSovereign.navId,
          'activeNavId=' + activeSovereign.navId,
          'videoId=' + requestSovereign.videoId,
          'navId=' + activeNavIdRef.current,
          'pageEpoch=' + activeEpoch,
          'url=' + (activeUrl || 'unknown'),
        );
      } else {
        console.warn(
          '[DIAG][SHORTS_ATOMIC]',
          'action=reject_stale_sovereign',
          'requestId=' + requestId,
          'requestSovereignId=' + requestSovereignId,
          'activeSovereignId=' + activeSovereignId,
          'navId=' + activeNavIdRef.current,
          'pageEpoch=' + activeEpoch,
          'url=' + (activeUrl || 'unknown'),
        );
        const staleResults = items.map(item => ({
          itemId: item.itemId,
          src: item.src,
          shouldBlur: false,
          category: 'safe_sovereign_stale',
          confidence: 0,
          severity: 'safe' as ModerationSeverity,
        }));
        try {
          const staleMessage = createResultMessage(
            requestId,
            staleResults,
            nonce,
            requestEpoch ?? undefined,
            requestSovereignId,
          );
          await postMessageToWebView(staleMessage as unknown as Record<string, unknown>);
        } catch {
          // Fail-open by design for stale requests.
        }
        pendingRequestsRef.current.delete(requestId);
        disarmFlashShield('moderation_sovereign_stale', 'disarm stale sovereign');
        return;
      }
    }
    if (requestEpoch !== null && !requestEpochAccepted && relaxedYouTubeEpochMode) {
      console.log(
        '[DIAG][EPOCH_BYPASS]',
        'epoch_bypass_allowed',
        'reason=request_epoch_mismatch_youtube_relaxed',
        'navId=' + activeNavIdRef.current,
        'requestPageEpoch=' + requestEpoch,
        'currentPageEpoch=' + activeEpoch,
        'urlFamily=' + getUrlFamily(activeUrl),
        'url=' + (activeUrl || 'unknown'),
      );
      if (isDiagYtBlurEnabledForUrl(activeUrl)) {
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
    const shortsAtomicVideoId = stickyShortsMode ? parseSovereignId(activeSovereignId).videoId : 'none';
    const enforceShortsAtomicVideoMatch = stickyShortsMode && shortsAtomicVideoId !== 'none';
    const hasTrustedLivePlayerFrameTruth = (
      stickyShortsMode &&
      livePlayerView &&
      enforceShortsAtomicVideoMatch &&
      items.some(item => {
        const sourceType = typeof item.sourceType === 'string' ? item.sourceType : 'unknown';
        return sourceType === 'video-frame';
      })
    );
    const shortsAtomicEligibleItemIds = new Set<string>();
    const mismatchedThumbnailItemIds: string[] = [];
    const mismatchedThumbnailSourceTypes: string[] = [];
    let ignoredMismatchBySovereignTruthCount = 0;
    
    // Process each item using the moderation bridge
    for (const item of items) {
      const itemSourceType = typeof item.sourceType === 'string' ? item.sourceType : 'unknown';
      const trustAsCurrentVideoFrame = itemSourceType === 'video-frame';
      const srcMatchesCurrentVideo = (
        !enforceShortsAtomicVideoMatch ||
        trustAsCurrentVideoFrame ||
        item.src.includes(shortsAtomicVideoId)
      );
      if (
        stickyShortsMode &&
        enforceShortsAtomicVideoMatch &&
        trustAsCurrentVideoFrame &&
        !item.src.includes(shortsAtomicVideoId)
      ) {
        console.log(
          '[DIAG][SHORTS_ATOMIC]',
          'action=id_match_bypass',
          'reason=video_frame_trusted',
          'requestId=' + requestId,
          'itemId=' + item.itemId,
          'sourceType=' + itemSourceType,
          'videoId=' + shortsAtomicVideoId,
        );
      }
      if (stickyShortsMode && enforceShortsAtomicVideoMatch && !srcMatchesCurrentVideo) {
        const ignoreSecondaryMismatch =
          hasTrustedLivePlayerFrameTruth &&
          isSecondaryShortsSourceType(itemSourceType);
        if (ignoreSecondaryMismatch) {
          ignoredMismatchBySovereignTruthCount += 1;
          results.push({
            itemId: item.itemId,
            src: item.src,
            shouldBlur: false,
            category: 'shorts_mismatch_ignored_video_frame_truth',
            confidence: 0,
            severity: 'safe',
            decision_reason: 'video_frame_sovereign_truth',
            ts: Date.now(),
          });
          console.log(
            '[DIAG][SHORTS_ATOMIC]',
            'action=id_mismatch_ignored_video_frame_truth',
            'requestId=' + requestId,
            'itemId=' + item.itemId,
            'sourceType=' + itemSourceType,
            'videoId=' + shortsAtomicVideoId,
            'livePlayer=' + (livePlayerView ? 1 : 0),
          );
          continue;
        }
        mismatchedThumbnailItemIds.push(item.itemId);
        mismatchedThumbnailSourceTypes.push(itemSourceType);
        results.push({
          itemId: item.itemId,
          src: item.src,
          shouldBlur: true,
          category: 'shorts_mismatch_hold',
          confidence: 1,
          severity: 'hard',
          decision_reason: 'id_mismatch_fallback',
          ts: Date.now(),
        });
        continue;
      }
      if (stickyShortsMode && enforceShortsAtomicVideoMatch) {
        shortsAtomicEligibleItemIds.add(item.itemId);
      }
      try {
        const scanResult = await moderationBridge.scanImage(item.src, thresholds, {
          requestId,
          itemId: item.itemId,
          navId: activeNavIdRef.current,
          pageEpoch: requestEpoch ?? activeEpoch,
          sourceType: itemSourceType,
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
    const hardThresholdCandidates = [thresholds?.porn, thresholds?.hentai].filter(
      (value): value is number =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1,
    );
    const hardSensitivityThreshold = hardThresholdCandidates.length > 0
      ? Math.min(...hardThresholdCandidates)
      : hardConfThreshold;

    const overlaySourceResults = (
      stickyShortsMode && enforceShortsAtomicVideoMatch
    )
      ? results.filter(item => shortsAtomicEligibleItemIds.has(item.itemId))
      : results;
    const itemSizeById = new Map(request.items.map(item => [item.itemId, item]));
    const getSourceTypeForResult = (itemId: string): string => {
      const requestItem = itemSizeById.get(itemId);
      return typeof requestItem?.sourceType === 'string' ? requestItem.sourceType : 'unknown';
    };
    const videoFrameSourceResults = overlaySourceResults.filter(
      item => getSourceTypeForResult(item.itemId) === 'video-frame',
    );
    const hasVideoFrameSafeResult = videoFrameSourceResults.some(item => !item.shouldBlur);
    const hasVideoFrameUnsafeResult = videoFrameSourceResults.some(item => item.shouldBlur);
    const videoFrameSafeOverrideActive = hasVideoFrameSafeResult && !hasVideoFrameUnsafeResult;
    if (stickyShortsMode && videoFrameSafeOverrideActive) {
      console.log(
        '[DIAG][SHORTS_ATOMIC]',
        'action=video_frame_clear_override',
        'requestId=' + requestId,
        'videoFrameCount=' + videoFrameSourceResults.length,
        'nonVideoCount=' + Math.max(overlaySourceResults.length - videoFrameSourceResults.length, 0),
      );
    }
    const scanSummarySourceResults = videoFrameSafeOverrideActive
      ? overlaySourceResults.filter(item => !isThumbnailLikeSourceType(getSourceTypeForResult(item.itemId)))
      : overlaySourceResults;
    const mismatchedThumbnailCount = mismatchedThumbnailItemIds.length;
    const mismatchedVideoFrameCount = mismatchedThumbnailSourceTypes.filter(
      sourceType => sourceType === 'video-frame',
    ).length;
    const onlyToleratedMismatchSources = (
      mismatchedThumbnailSourceTypes.length > 0 &&
      mismatchedThumbnailSourceTypes.every(sourceType => isMismatchToleratedSourceType(sourceType))
    );
    const videoFrameMissingForMismatch = videoFrameSourceResults.length === 0;
    const shouldSafetyBlurForMismatch = (
      stickyShortsMode &&
      enforceShortsAtomicVideoMatch &&
      !hasTrustedLivePlayerFrameTruth &&
      overlaySourceResults.length === 0 &&
      results.length > 0 &&
      (videoFrameMissingForMismatch || mismatchedVideoFrameCount > 0) &&
      !onlyToleratedMismatchSources
    );
    if (stickyShortsMode && mismatchedThumbnailCount > 0) {
      const mismatchedPreview = mismatchedThumbnailItemIds.slice(0, 8).join(',');
      const mismatchedExtra = Math.max(mismatchedThumbnailItemIds.length - 8, 0);
      const mismatchedSourcePreview = mismatchedThumbnailSourceTypes.slice(0, 8).join(',');
      const mismatchedSourceExtra = Math.max(mismatchedThumbnailSourceTypes.length - 8, 0);
      console.log(
        '[DIAG][SHORTS_ATOMIC]',
        'action=batch_id_mismatch',
        'requestId=' + requestId,
        'sovereignId=' + activeSovereignId,
        'videoId=' + shortsAtomicVideoId,
        'mismatchedCount=' + mismatchedThumbnailCount,
        'eligibleCount=' + overlaySourceResults.length,
        'videoFrameMissing=' + videoFrameMissingForMismatch,
        'mismatchedVideoFrame=' + mismatchedVideoFrameCount,
        'ignoredByVideoTruth=' + ignoredMismatchBySovereignTruthCount,
        'onlyToleratedMismatch=' + onlyToleratedMismatchSources,
        'safetyBlur=' + shouldSafetyBlurForMismatch,
        'itemIds=' + (mismatchedPreview || 'none') + (mismatchedExtra > 0 ? ',+' + mismatchedExtra : ''),
        'sourceTypes=' + (mismatchedSourcePreview || 'none') + (mismatchedSourceExtra > 0 ? ',+' + mismatchedSourceExtra : ''),
      );
    }
    if (stickyShortsMode && overlaySourceResults.length > 0) {
      const retryState = shortsMatchingRetryRef.current;
      const matchingSovereignId = effectiveRequestSovereignId || activeSovereignId;
      if (retryState.needsMatchingScan && retryState.pendingSovereignId === matchingSovereignId) {
        retryState.needsMatchingScan = false;
        retryState.pendingSovereignId = '';
        clearShortsMatchingRetryTimer();
        console.log(
          '[DIAG][SHORTS_ATOMIC]',
          'action=retry_scan_cancel',
          'reason=matching_items_arrived',
          'requestId=' + requestId,
          'sovereignId=' + matchingSovereignId,
          'eligibleCount=' + overlaySourceResults.length,
        );
      }
    }

    const eligibleResults = scanSummarySourceResults.filter(item => {
      const requestItem = itemSizeById.get(item.itemId);
      if (!requestItem) return true;
      const width = typeof requestItem.width === 'number' ? requestItem.width : 0;
      const height = typeof requestItem.height === 'number' ? requestItem.height : 0;
      if (width <= 0 || height <= 0) return true;
      return width >= tinyDimensionThreshold && height >= tinyDimensionThreshold;
    });
    const denominator = eligibleResults.length > 0 ? eligibleResults.length : scanSummarySourceResults.length;
    const tinyExcludedCount = Math.max(scanSummarySourceResults.length - eligibleResults.length, 0);
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
    const hardSensitivityHits = hardResults.filter(item => item.confidence > hardSensitivityThreshold);
    const hardStrongHits = hardResults.filter(item => item.confidence >= hardConfThreshold);
    const hardLowHits = hardResults.filter(item => item.confidence >= modePolicy.hardMultiConfFloor);
    const hardUnsafeMaxConf = hardResults.reduce((max, item) => Math.max(max, item.confidence), 0);

    const softResults = eligibleResults.filter(item => item.shouldBlur && item.severity === 'soft');
    const softSensitivityHits = softResults.filter(item => item.confidence > hardSensitivityThreshold);
    const softQualifiedHits = softResults.filter(item => item.confidence >= softConfidenceFloor);
    const softUnsafeMaxConf = softResults.reduce((max, item) => Math.max(max, item.confidence), 0);
    const softRatio = denominator > 0 ? softQualifiedHits.length / denominator : 0;
    const shortsSoftThresholdBypassFloor = 0.60;
    const shortsSoftOnlySexyHit = (
      stickyShortsMode &&
      hardSensitivityHits.length === 0 &&
      softSensitivityHits.length > 0 &&
      softSensitivityHits.every(item => item.category.toLowerCase() === 'sexy')
    );
    const shortsSoftOnlyLowConfidenceBypass = (
      shortsSoftOnlySexyHit &&
      softUnsafeMaxConf < shortsSoftThresholdBypassFloor
    );
    if (shortsSoftOnlyLowConfidenceBypass) {
      console.log(
        '[DIAG][SHORTS_ATOMIC]',
        'action=soft_hit_fullscreen_bypass',
        'requestId=' + requestId,
        'softMax=' + softUnsafeMaxConf.toFixed(3),
        'floor=' + shortsSoftThresholdBypassFloor.toFixed(2),
      );
    }
    const thresholdHit =
      hardUnsafeMaxConf > hardSensitivityThreshold ||
      (
        stickyShortsMode &&
        softUnsafeMaxConf > hardSensitivityThreshold &&
        !shortsSoftOnlyLowConfidenceBypass
      );
    const thresholdHitAllowedForHost = thresholdHit && livePlayerView;
    if (thresholdHit && !thresholdHitAllowedForHost) {
      console.log(
        '[DIAG][OVERLAY_HOST_STATE]',
        'action=threshold_hit_bypassed_non_live_player',
        'requestId=' + requestId,
        'url=' + (activeUrl || 'unknown'),
        'hardMax=' + hardUnsafeMaxConf.toFixed(3),
        'hardThr=' + hardSensitivityThreshold.toFixed(3),
      );
    }

    const hardOverlayDecision =
      thresholdHitAllowedForHost ||
      hardStrongHits.length >= 1 ||
      hardLowHits.length >= modePolicy.hardMultiMinHits;
    const softOverlayDecision =
      modePolicy.allowSoftOverlay &&
      softQualifiedHits.length >= softMinHits &&
      softRatio >= softRatioThreshold;
    const holdForMismatchedThumbnails = shouldSafetyBlurForMismatch;
    if (holdForMismatchedThumbnails) {
      console.log(
        '[DIAG][SHORTS_ATOMIC]',
        'action=id_mismatch_fallback_to_standard_blur',
        'requestId=' + requestId,
        'sovereignId=' + activeSovereignId,
        'videoId=' + shortsAtomicVideoId,
        'mismatchedCount=' + mismatchedThumbnailCount,
        'videoFrameMissing=' + videoFrameMissingForMismatch,
        'mismatchedVideoFrame=' + mismatchedVideoFrameCount,
      );
      void ensureShortsRevealUi(
        'id_mismatch_fallback',
        requestId,
        effectiveRequestSovereignId || activeSovereignId,
        shortsAtomicVideoId,
        mismatchedThumbnailCount,
      );
      scheduleShortsMatchingRetryScan(
        requestId,
        effectiveRequestSovereignId || activeSovereignId,
        shortsAtomicVideoId,
        mismatchedThumbnailCount,
      );
    }

    const effectiveHardOverlayDecision = hardOverlayDecision;
    let overlayDecision = effectiveHardOverlayDecision;
    let decisionReason = 'no_hard_signal';
    if (holdForMismatchedThumbnails) {
      overlayDecision = true;
      decisionReason = 'id_mismatch_fallback';
    } else if (thresholdHitAllowedForHost) {
      decisionReason = 'threshold_hit';
    } else if (thresholdHit) {
      decisionReason = 'threshold_hit_non_live_bypass';
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
          return new URL(activeUrl).hostname;
        } catch {
          return (activeUrl || '').replace(/^https?:\/\//, '').split('/')[0] || 'unknown';
        }
      })();
      console.log(
        `[MW-Host][ScanSummary] url=${shortUrl} req=${requestId} total=${results.length} eligible=${denominator} tinyExcluded=${tinyExcludedCount} hardHits=${hardSensitivityHits.length} softHits=${softSensitivityHits.length} safeHits=${Math.max(denominator - hardSensitivityHits.length - softSensitivityHits.length, 0)} hardMax=${hardUnsafeMaxConf.toFixed(3)} hardThr=${hardSensitivityThreshold.toFixed(3)} softMax=${softUnsafeMaxConf.toFixed(3)} softRatio=${softRatio.toFixed(3)} videoFrameSafe=${hasVideoFrameSafeResult ? 1 : 0} videoFrameUnsafe=${hasVideoFrameUnsafeResult ? 1 : 0} videoFrameOverride=${videoFrameSafeOverrideActive ? 1 : 0} mismatchSafety=${holdForMismatchedThumbnails ? 1 : 0} livePlayer=${livePlayerView ? 1 : 0} mode=${blurMode} decision=${overlayDecision ? 'ON' : 'OFF'} reason=${decisionReason}`
      );
    }

    const resultSovereignId = stickyShortsMode
      ? (effectiveRequestSovereignId || activeSovereignId)
      : '';
    if (stickyShortsMode && resultSovereignId) {
      markShortsOverlayModerationResult(
        resultSovereignId,
        overlayDecision ? 'BLUR' : 'CLEAR',
        decisionReason,
        softSensitivityHits.length,
      );
    }

    // No host-level fullscreen blur/hysteresis in Shorts atomic mode.
    if (isShortsAtomic) {
      debugLog(
        '[MW-DIAG][HOST] shorts_atomic_fullscreen_blur_disabled',
        'requestId=' + requestId,
        'decision=' + (overlayDecision ? 'BLUR' : 'CLEAR'),
        'reason=' + decisionReason,
      );
    } else if (effectiveHardOverlayDecision) {
      // Hysteresis is based on hard conditions only.
      processModerationSafetySignal(true, `moderation_request_hard:${decisionReason}`);
    } else {
      processModerationSafetySignal(false, 'moderation_request_no_hard');
    }

    // Optional strict mode: temporary page-level soft confirmation (no hysteresis stickiness).
    if (!isShortsAtomic && !effectiveHardOverlayDecision) {
      if (softOverlayDecision) {
        setCentralBlurState(true, 'moderation_request_soft_policy');
      } else if (blurStateRef.current.reason.startsWith('moderation_request_soft_')) {
        setCentralBlurState(false, 'moderation_request_soft_cleared');
      }
    }

    debugLog(
      '[MW-DIAG][HOST] decision source=' + (overlayDecision ? 'overlay_on' : 'overlay_off'),
      'reason=' + decisionReason,
      'hardDecision=' + effectiveHardOverlayDecision,
      'softDecision=' + softOverlayDecision,
      'hardHits=' + hardSensitivityHits.length,
      'hardStrong=' + hardStrongHits.length,
      'hardLow=' + hardLowHits.length,
      'softQualified=' + softQualifiedHits.length,
      'domOverlay=' + (ENABLE_DOM_BLUR ? 'on' : 'off'),
      'epoch=' + (requestEpoch ?? activeEpoch),
    );
    
    // Post results back to the WebView with nonce for security
    console.log('[MW-Host] posting results back', requestId, 'count=' + results.length, 'nonce=' + nonce.substring(0, 10));
    
    try {
      const resultMessage = createResultMessage(
        requestId,
        results,
        nonce,
        requestEpoch ?? undefined,
        resultSovereignId || undefined,
      );
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
    disarmFlashShield('moderation_results', 'disarm after results');
  }, [
    moderationBridge,
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
    getSovereignIdForContext,
    clearShortsMatchingRetryTimer,
    markShortsOverlayModerationResult,
    processModerationSafetySignal,
    ensureShortsRevealUi,
    scheduleShortsMatchingRetryScan,
    setCentralBlurState,
    setFlashGuardState,
    flashLog,
    isGraceEpochAcceptedForActiveShortsVideo,
  ]);

  /**
   * Handle messages from WebView via Capgo `messageFromWebview`.
   * Keep window.postMessage listener as fallback for non-Capgo contexts.
   */
  useEffect(() => {
    if (!ENABLE_SIGNAL_PIPELINE) return;
    const sessionNonce = getNonce();

    const handleIncomingMessage = async (rawPayload: unknown, source: 'capgo' | 'window') => {
      const message = unwrapIncomingMessagePayload(rawPayload);
      if (!message || typeof message !== 'object') return;
      if (tryHandlePersistentRevealRequest(message, source)) {
        return;
      }

      const typedMessage = message as Record<string, unknown>;
      const markShortsRelatedLegacyPollContextReady = (
        reason: string,
        activeUrl: string,
        activeEpoch: number,
        messageEpoch: number | null,
      ) => {
        if (getUrlFamily(activeUrl) !== 'youtube_shorts_related') return;
        if (messageEpoch === null || messageEpoch !== activeEpoch) return;
        const contextKey = String(activeNavIdRef.current) + ':' + String(activeEpoch);
        if (shortsRelatedLegacyPollContextRef.current === contextKey) return;
        shortsRelatedLegacyPollContextRef.current = contextKey;
        console.log(
          '[DIAG][LEGACY_POLL_GATE]',
          'action=context_ready',
          'reason=' + reason,
          'navId=' + activeNavIdRef.current,
          'pageEpoch=' + activeEpoch,
          'url=' + (activeUrl || 'unknown'),
          'source=' + source,
        );
        setShortsRelatedLegacyPollVersion(v => v + 1);
      };
      if (typedMessage.type === 'MW_INJECTED_ACK') {
        console.log(
          '[MW-Host][ACK] MW_INJECTED_ACK',
          'source=' + source,
          'navId=' + String(typedMessage.navId ?? 'none'),
          'pageEpoch=' + String(typedMessage.pageEpoch ?? 'none'),
          'noncePrefix=' + String(typedMessage.noncePrefix ?? 'none'),
          'url=' + String(typedMessage.url ?? 'unknown'),
        );
        console.log(
          '[DIAG][INJECT] ack_received',
          'source=' + source,
          'navId=' + String(typedMessage.navId ?? 'none'),
          'pageEpoch=' + String(typedMessage.pageEpoch ?? 'none'),
          'url=' + String(typedMessage.url ?? 'unknown'),
        );
        return;
      }
      if (typedMessage.type === 'MW_REQ_SENT') {
        const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
        const activeEpoch = webViewPageEpochRef.current;
        const messageEpoch = (
          typeof typedMessage.pageEpoch === 'number' && Number.isFinite(typedMessage.pageEpoch)
        ) ? Number(typedMessage.pageEpoch) : null;
        const messageSovereignId = typeof typedMessage.sovereignId === 'string'
          ? typedMessage.sovereignId
          : '';
        const isActiveEpochMessage = isGraceEpochAcceptedForActiveShortsVideo(
          messageEpoch,
          activeEpoch,
          activeUrl,
          messageSovereignId,
        );
        markShortsRelatedLegacyPollContextReady('mw_req_sent', activeUrl, activeEpoch, messageEpoch);
        if (isYouTubeShortsUrl(activeUrl) && isActiveEpochMessage) {
          shortsLegacyFallbackRef.current.lastReqSentAt = Date.now();
          disarmShortsLegacyFallbackProbe('req_sent');
        } else if (isYouTubeShortsUrl(activeUrl) && !isActiveEpochMessage) {
          console.log(
            '[DIAG][REQ_EPOCH_GATE]',
            'action=ignore_stale_req_sent',
            'messageEpoch=' + messageEpoch,
            'activeEpoch=' + activeEpoch,
            'navId=' + activeNavIdRef.current,
            'url=' + (activeUrl || 'unknown'),
          );
        }
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
        const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
        const activeEpoch = webViewPageEpochRef.current;
        const messageEpoch = (
          typeof typedMessage.pageEpoch === 'number' && Number.isFinite(typedMessage.pageEpoch)
        ) ? Number(typedMessage.pageEpoch) : null;
        const messageSovereignId = typeof typedMessage.sovereignId === 'string'
          ? typedMessage.sovereignId
          : '';
        const isActiveEpochMessage = isGraceEpochAcceptedForActiveShortsVideo(
          messageEpoch,
          activeEpoch,
          activeUrl,
          messageSovereignId,
        );
        if (isYouTubeShortsUrl(activeUrl) && isActiveEpochMessage) {
          shortsLegacyFallbackRef.current.lastReqTimeoutAt = Date.now();
          armShortsLegacyFallbackProbe('req_timeout', SHORTS_LEGACY_FALLBACK_TIMEOUT_PROBE_MS);
        } else if (isYouTubeShortsUrl(activeUrl) && !isActiveEpochMessage) {
          console.log(
            '[DIAG][REQ_EPOCH_GATE]',
            'action=ignore_stale_req_timeout',
            'messageEpoch=' + messageEpoch,
            'activeEpoch=' + activeEpoch,
            'navId=' + activeNavIdRef.current,
            'url=' + (activeUrl || 'unknown'),
          );
        }
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

      if (typedMessage.type === 'MW_JS_REVEAL_STATE') {
        const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
        const activeEpoch = webViewPageEpochRef.current;
        const messageEpoch = (
          typeof typedMessage.pageEpoch === 'number' && Number.isFinite(typedMessage.pageEpoch)
        ) ? Number(typedMessage.pageEpoch) : null;
        const messageSovereignId = typeof typedMessage.sovereignId === 'string'
          ? typedMessage.sovereignId
          : getSovereignIdForContext(activeUrl);
        const isActiveEpochMessage = isGraceEpochAcceptedForActiveShortsVideo(
          messageEpoch,
          activeEpoch,
          activeUrl,
          messageSovereignId,
        );
        if (!isYouTubeShortsUrl(activeUrl) || !isActiveEpochMessage) {
          console.log(
            '[DIAG][SHORTS_ATOMIC]',
            'action=ignore_stale_js_state_message',
            'messageEpoch=' + messageEpoch,
            'activeEpoch=' + activeEpoch,
            'messageSovereignId=' + (messageSovereignId || 'none'),
            'activeSovereignId=' + getSovereignIdForContext(activeUrl),
          );
          return;
        }
        const jsBlurApplied = typedMessage.jsBlurApplied === true;
        const jsRevealApplied = typedMessage.jsRevealApplied === true;
        const signalReason = String(typedMessage.reason || 'js_state');
        markShortsOverlayJsState(
          messageSovereignId,
          jsBlurApplied,
          jsRevealApplied,
          signalReason,
        );
        return;
      }

      if (ENABLE_DOM_BLUR && isBlurOverlayReadyMessage(message)) {
        const now = Date.now();
        const activeNavId = activeNavIdRef.current || 0;
        const activeEpoch = webViewPageEpochRef.current || 0;
        const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
        const activeUrlFamily = getUrlFamily(activeUrl);
        const readyEpoch = (
          typeof typedMessage.pageEpoch === 'number' && Number.isFinite(typedMessage.pageEpoch)
        ) ? Number(typedMessage.pageEpoch) : null;
        const readyHostNavId = (
          typeof typedMessage.hostNavId === 'number' && Number.isFinite(typedMessage.hostNavId)
        ) ? Number(typedMessage.hostNavId) : null;
        const readyReason = String(typedMessage.reason || 'ready');
        const readyUrl = String(typedMessage.url || activeUrl || 'unknown');
        const readySovereignId = typeof typedMessage.sovereignId === 'string'
          ? typedMessage.sovereignId
          : getSovereignIdForContext(readyUrl, activeNavId, readyEpoch ?? activeEpoch);
        const readyTimestamp = (
          typeof typedMessage.timestamp === 'number' && Number.isFinite(typedMessage.timestamp)
        ) ? Number(typedMessage.timestamp) : null;
        const readySignalAgeMs = readyTimestamp === null ? null : (now - readyTimestamp);
        const withinShortsNavGrace =
          activeUrlFamily === 'youtube_shorts' &&
          readyHostNavId !== null &&
          readyHostNavId === (activeNavId - 1) &&
          readySignalAgeMs !== null &&
          readySignalAgeMs >= 0 &&
          readySignalAgeMs <= SHORTS_NAV_GRACE_MS;
        const staleEpoch = readyEpoch !== null && readyEpoch !== activeEpoch;
        const staleNav =
          readyHostNavId !== null &&
          readyHostNavId !== activeNavId &&
          !withinShortsNavGrace;
        if (withinShortsNavGrace) {
          console.log(
            '[DIAG][BLUR_READY_GATE]',
            'action=shorts_nav_grace_accept',
            'reason=' + readyReason,
            'messageHostNavId=' + (readyHostNavId ?? 'none'),
            'activeNavId=' + activeNavId,
            'signalAgeMs=' + (readySignalAgeMs ?? 'none'),
            'graceMs=' + SHORTS_NAV_GRACE_MS,
            'url=' + readyUrl,
          );
        }
        if (staleEpoch || staleNav) {
          console.log(
            '[DIAG][BLUR_READY_GATE]',
            'action=blocked_stale',
            'reason=' + readyReason,
            'messageEpoch=' + (readyEpoch ?? 'none'),
            'activeEpoch=' + activeEpoch,
            'messageHostNavId=' + (readyHostNavId ?? 'none'),
            'activeNavId=' + activeNavId,
            'messageTimestamp=' + (readyTimestamp ?? 'none'),
            'signalAgeMs=' + (readySignalAgeMs ?? 'none'),
            'withinShortsNavGrace=' + withinShortsNavGrace,
            'shortsGraceMs=' + SHORTS_NAV_GRACE_MS,
            'staleEpoch=' + staleEpoch,
            'staleNav=' + staleNav,
            'url=' + readyUrl,
          );
          return;
        }
        if (activeUrlFamily === 'youtube_shorts' && readySovereignId) {
          const lastShortsBlurSignal = lastShortsBlurSignalRef.current;
          const sameSovereignReplaceState = (
            readyReason === 'replaceState' &&
            lastShortsBlurSignal.sovereignId === readySovereignId &&
            (now - lastShortsBlurSignal.at) < SHORTS_OVERLAY_ATOMIC_TIMEOUT_MS
          );
          if (sameSovereignReplaceState) {
            console.log(
              '[DIAG][BLUR_READY_GATE]',
              'action=replace_state_preserve_atomic_window',
              'reason=' + readyReason,
              'sovereignId=' + readySovereignId,
              'lastSignalAgeMs=' + (now - lastShortsBlurSignal.at),
            );
          }
          markShortsOverlayBlurSignal(
            readySovereignId,
            readyReason,
            sameSovereignReplaceState ? lastShortsBlurSignal.at : undefined,
          );
        }
        if (activeUrlFamily === 'youtube_shorts') {
          const sovereignVideoId = parseSovereignId(readySovereignId).videoId;
          const readyShortsVideoId = sovereignVideoId !== 'none'
            ? sovereignVideoId
            : (getYouTubeShortsId(readyUrl) || 'none');
          if (readyShortsVideoId !== 'none') {
            lastShortsBlurReadyVideoRef.current = {
              videoId: readyShortsVideoId,
              at: now,
            };
          }
        }
        const lastReady = blurReadyBurstRef.current;
        const duplicateBurst = (
          blurReadyRef.current &&
          lastReady.navId === activeNavId &&
          lastReady.pageEpoch === activeEpoch &&
          lastReady.url === readyUrl &&
          now - lastReady.at < 400
        );
        if (duplicateBurst) {
          console.log(
            '[DIAG][BLUR_READY_GATE]',
            'action=dedupe_burst',
            'reason=' + readyReason,
            'navId=' + activeNavId,
            'pageEpoch=' + activeEpoch,
            'url=' + readyUrl,
          );
          if (activeUrlFamily === 'youtube_shorts') {
            void syncOverlayState('shorts_dedupe_burst_resync:' + readyReason);
          }
          return;
        }
        blurReadyBurstRef.current = {
          navId: activeNavId,
          pageEpoch: activeEpoch,
          url: readyUrl,
          at: now,
        };
        blurReadyRef.current = true;
        console.log('[MW-Host] Blur overlay READY:', readyReason, readyUrl);
        await syncOverlayState('webview_ready_sync');
        return;
      }

      if (typedMessage.type === 'gc-label-request' && source === 'capgo') {
        // Forward to app window listeners (Prototype Label modal) without re-posting to webview.
        window.dispatchEvent(new MessageEvent('message', { data: typedMessage }));
        return;
      }

      if (typedMessage.type === 'gc-correction-feedback') {
        console.log('[MW-Host] correction feedback received');
        return;
      }

      if (isValidModerationRequest(message)) {
        if (message.nonce !== sessionNonce) {
          console.warn('[MW-Host] NONCE MISMATCH - rejecting request:', message.requestId, 'source=' + source);
          console.warn('[MW-Host] Expected:', sessionNonce.substring(0, 10), 'Got:', (message.nonce || 'none').substring(0, 10));
          return;
        }
        const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
        const activeEpoch = webViewPageEpochRef.current;
        const messageEpoch = (
          typeof message.pageEpoch === 'number' && Number.isFinite(message.pageEpoch)
        ) ? Number(message.pageEpoch) : null;
        const isActiveEpochMessage = isGraceEpochAcceptedForActiveShortsVideo(
          messageEpoch,
          activeEpoch,
          activeUrl,
          message.sovereignId,
        );
        markShortsRelatedLegacyPollContextReady('request_received', activeUrl, activeEpoch, messageEpoch);
        if (isYouTubeShortsUrl(activeUrl) && isActiveEpochMessage) {
          shortsLegacyFallbackRef.current.lastReqSentAt = Date.now();
          disarmShortsLegacyFallbackProbe('request_received');
        } else if (isYouTubeShortsUrl(activeUrl) && !isActiveEpochMessage) {
          console.log(
            '[DIAG][REQ_EPOCH_GATE]',
            'action=ignore_stale_request_received',
            'messageEpoch=' + messageEpoch,
            'activeEpoch=' + activeEpoch,
            'navId=' + activeNavIdRef.current,
            'url=' + (activeUrl || 'unknown'),
          );
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

      if (isSensitivityUpdateMessage(message)) {
        const level = Math.max(0, Math.min(4, Math.round(message.level)));
        if (level !== localSettings.blur_dial) {
          console.log('[MW-Host] Received sensitivity update from page:', level, message.reason || 'overlay_toggle');
          updateSetting('blur_dial', level);
        }
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
      if (tryHandlePersistentRevealRequest(event.data, 'window')) {
        return;
      }
      void handleIncomingMessage(event.data, 'window');
    };

    window.addEventListener('message', handleWindowMessage);
    return () => {
      window.removeEventListener('message', handleWindowMessage);
    };
  }, [
    ENABLE_SIGNAL_PIPELINE,
    ENABLE_DOM_BLUR,
    processModerationRequest,
    moderationBridge,
    postMessageToWebView,
    getNonce,
    syncOverlayState,
    getSovereignIdForContext,
    markShortsOverlayBlurSignal,
    markShortsOverlayJsState,
    armShortsLegacyFallbackProbe,
    disarmShortsLegacyFallbackProbe,
    unwrapIncomingMessagePayload,
    tryHandlePersistentRevealRequest,
    webViewState.currentUrl,
    setCentralBlurState,
    isGraceEpochAcceptedForActiveShortsVideo,
  ]);

  /**
   * Fallback: Poll for moderation requests from legacy global queue
   * This is used when postMessage doesn't work reliably
   */
  useEffect(() => {
    if (!ENABLE_SIGNAL_PIPELINE || !isNative || !webViewState.isOpen || !isRuntimeModerationEnabled) {
      return;
    }
    if (!webViewListenersAttached) {
      const diagUrl = webViewState.currentUrl || currentUrlRef.current || 'unknown';
      console.log(
        '[DIAG][CHURN_WINDOW]',
        'action=legacyPoll_blocked',
        'reason=listeners_not_attached',
        'stack=NativeWebViewBrowser.legacyPoll',
        'navId=' + activeNavIdRef.current,
        'url=' + diagUrl,
      );
      return;
    }
    const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
    const activeUrlFamily = getUrlFamily(activeUrl);
    const stickyShortsMode = activeUrlFamily === 'youtube_shorts';
    const isShortsRelatedContext = activeUrlFamily === 'youtube_shorts_related';
    const isNonShortsYouTubeContext = isYouTubeDomainUrl(activeUrl) && !stickyShortsMode;
    const activeContextKey = String(activeNavIdRef.current) + ':' + String(webViewPageEpochRef.current);
    if (isShortsRelatedContext && shortsRelatedLegacyPollContextRef.current !== activeContextKey) {
      console.log(
        '[DIAG][LEGACY_POLL_GATE]',
        'action=defer',
        'reason=shorts_related_waiting_fresh_context',
        'navId=' + activeNavIdRef.current,
        'pageEpoch=' + webViewPageEpochRef.current,
        'url=' + (activeUrl || 'unknown'),
      );
      return;
    }
    const pollContextKey = String(activeNavIdRef.current) + ':' + getUrlFamily(activeUrl);
    if (isNonShortsYouTubeContext && legacyPollSelfDisabledContextRef.current === pollContextKey) {
      return;
    }
    const hasActiveShortsProbe = shortsLegacyFallbackRef.current.untilMs > Date.now();
    if (stickyShortsMode && !hasActiveShortsProbe) {
      console.log(
        '[MW-Host][ShortsFallback] skip_legacy_poll',
        'reason=probe_inactive',
        'navId=' + activeNavIdRef.current,
        'url=' + (activeUrl || 'unknown'),
      );
      return;
    }

    console.log(
      '[MW-Host] Starting adaptive legacy queue polling (fallback)...',
      'scope=' + (stickyShortsMode ? 'shorts_probe' : 'default'),
    );
    const MIN_POLL_MS = 300;
    const MAX_POLL_MS = 3000;
    const EMPTY_BACKOFF_MS = 250;
    const HIDDEN_POLL_MS = 2000;
    const IDLE_EMPTY_POLLS = 10;
    const IDLE_NO_ACTIVITY_MS = 15000;
    const IDLE_MIN_POLL_MS = 2000;
    const IDLE_MAX_POLL_MS = 5000;
    const IDLE_BACKOFF_MS = 500;
    const PROFILE_DECISION_ON_POLL_MS = 5000;
    const LEGACY_EMPTY_REASONS = new Set([
      'queue_empty',
      'legacy_empty_literal',
      'queue_empty_after_parse',
      'queue_missing',
    ]);
    let pollDelayMs = MIN_POLL_MS;
    let cancelled = false;
    let pollTimer: NodeJS.Timeout | null = null;
    let pollInFlight = false;
    let consecutiveEmptyPolls = 0;
    let lastActivityAt = Date.now();
    let lastEmptyPollReason = 'none';
    let lastProducerMode = 'unknown';
    let lastPollStatus = 'unknown';
    let idleMode = false;
    let idlePollMs = IDLE_MIN_POLL_MS;
    const shortsProbeDeadlineMs = stickyShortsMode
      ? Math.min(shortsLegacyFallbackRef.current.untilMs, Date.now() + SHORTS_LEGACY_FALLBACK_MAX_PROBE_MS)
      : 0;
    let shortsProbePollCount = 0;

    const deactivateShortsProbe = (reason: string) => {
      if (!stickyShortsMode) return;
      shortsLegacyFallbackRef.current.untilMs = 0;
      shortsLegacyFallbackRef.current.reason = reason;
      console.log(
        '[MW-Host][ShortsFallback] probe_stop',
        'reason=' + reason,
        'polls=' + shortsProbePollCount,
        'lastEmpty=' + lastEmptyPollReason,
        'producer=' + lastProducerMode,
        'navId=' + activeNavIdRef.current,
      );
    };

    const isProfileDecisionOnContext = (pollUrl: string): boolean => {
      const overlayReason = blurStateRef.current.reason || '';
      const hostDecisionOn = blurStateRef.current.enabled && overlayReason.startsWith('moderation_request_');
      return (
        getUrlFamily(pollUrl) === 'youtube_shorts_related' &&
        !isLivePlayerView(pollUrl) &&
        hostDecisionOn
      );
    };

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
      console.log(
        '[MW-Host][Timer] start',
        'name=legacyPollTimer',
        'delayMs=' + delayMs,
        'navId=' + activeNavIdRef.current,
        'listenersAttached=' + webViewListenersAttached,
        'url=' + (webViewState.currentUrl || 'unknown'),
      );
      console.log(
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
        lastProducerMode = 'unknown';
        lastPollStatus = 'unknown';
        // Get and clear pending requests from WebView's global queue
        const getQueueScript = `
          (function() {
            var queue = window.__GC_SCAN_QUEUE__;
            var producerMode = typeof window.__MW_LEGACY_QUEUE_PRODUCER__ === 'string'
              ? window.__MW_LEGACY_QUEUE_PRODUCER__
              : 'unknown';
            if (!Array.isArray(queue) || queue.length === 0) {
              return JSON.stringify({
                status: 'EMPTY',
                reason: Array.isArray(queue) ? 'queue_empty' : 'queue_missing',
                queueLength: Array.isArray(queue) ? queue.length : 0,
                producerMode: producerMode,
              });
            }
            var items = queue.splice(0, 5);
            return JSON.stringify({
              status: 'ITEMS',
              items: items,
              queueLength: queue.length,
              producerMode: producerMode,
            });
          })();
        `;
        
        const result = await executeScript(getQueueScript);
        const diagUrl = webViewState.currentUrl || currentUrlRef.current || '';
        const resultTypeLabel = result === undefined ? 'undefined' : typeof result;
        const previewValue = result === undefined ? 'undefined' : result === null ? 'null' : String(result);
        logYouTubeDiag(
          'legacyPoll',
          'legacy-poll type=' + resultTypeLabel +
          ' isUndefined=' + (result === undefined) +
          ' isEMPTY=' + (result === 'EMPTY') +
          ' preview=' + previewValue.substring(0, 24) +
          ' url=' + (diagUrl || 'unknown'),
          diagUrl
        );

        if (!result || result === 'null') {
          lastEmptyPollReason = 'null_or_empty_result';
          logYouTubeDiag(
            'emptyPollReason',
            'empty_poll_reason=' + lastEmptyPollReason +
            ' navId=' + activeNavIdRef.current +
            ' url=' + (diagUrl || 'unknown'),
            diagUrl
          );
          return false;
        }

        let parsedPayload: unknown = null;
        try {
          parsedPayload = JSON.parse(result);
        } catch (e) {
          if (result === 'EMPTY') {
            lastEmptyPollReason = 'legacy_empty_literal';
            logYouTubeDiag(
              'emptyPollReason',
              'empty_poll_reason=' + lastEmptyPollReason +
              ' navId=' + activeNavIdRef.current +
              ' url=' + (diagUrl || 'unknown'),
              diagUrl
            );
          }
          return false;
        }

        let items: Array<Record<string, unknown>> = [];
        if (Array.isArray(parsedPayload)) {
          lastPollStatus = parsedPayload.length > 0 ? 'ITEMS' : 'EMPTY';
          items = parsedPayload as Array<Record<string, unknown>>;
        } else if (parsedPayload && typeof parsedPayload === 'object') {
          const payloadRecord = parsedPayload as {
            status?: unknown;
            reason?: unknown;
            items?: unknown;
            queueLength?: unknown;
            producerMode?: unknown;
          };
          const status = String(payloadRecord.status || '').toUpperCase();
          lastPollStatus = status || 'unknown';
          const reason = String(payloadRecord.reason || '');
          const producerMode = String(payloadRecord.producerMode || 'unknown');
          lastProducerMode = producerMode;
          if (status === 'EMPTY') {
            lastEmptyPollReason = reason || 'queue_empty';
            logYouTubeDiag(
              'emptyPollReason',
              'empty_poll_reason=' + lastEmptyPollReason +
              ' producer=' + producerMode +
              ' queueLength=' + String(payloadRecord.queueLength ?? 'unknown') +
              ' navId=' + activeNavIdRef.current +
              ' url=' + (diagUrl || 'unknown'),
              diagUrl
            );
            return false;
          }
          if (status === 'ITEMS' && Array.isArray(payloadRecord.items)) {
            items = payloadRecord.items as Array<Record<string, unknown>>;
          }
        }

        if (!Array.isArray(items) || items.length === 0) {
          lastEmptyPollReason = 'queue_empty_after_parse';
          logYouTubeDiag(
            'emptyPollReason',
            'empty_poll_reason=' + lastEmptyPollReason +
            ' navId=' + activeNavIdRef.current +
            ' url=' + (diagUrl || 'unknown'),
            diagUrl
          );
          return false;
        }
        lastEmptyPollReason = 'none';
        
        console.log('[MW-Host] Legacy poll: found', items.length, 'items in queue');
        
        // Process each scan request
        for (const item of items) {
          const src = typeof item.src === 'string' ? item.src : '';
          const thresholds = item.thresholds;
          
          if (!src) continue;
          
          console.log('[MW-Host] Legacy processing:', src.substring(0, 60));
          
          const scanResult = await moderationBridge.scanImage(src, thresholds, {
            requestId: 'legacy_poll',
            itemId: typeof item.itemId === 'string' ? item.itemId : 'legacy_item',
            navId: activeNavIdRef.current,
            pageEpoch: webViewPageEpochRef.current,
            sourceType: typeof item.sourceType === 'string' ? item.sourceType : 'unknown',
          });
          
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
      if (stickyShortsMode) {
        if (Date.now() >= shortsProbeDeadlineMs) {
          deactivateShortsProbe('probe_deadline_elapsed');
          return;
        }
        if (shortsProbePollCount >= SHORTS_LEGACY_FALLBACK_MAX_POLLS) {
          deactivateShortsProbe('probe_max_polls_reached');
          return;
        }
      }
      const hadWork = await pollForRequests();
      if (stickyShortsMode) {
        shortsProbePollCount += 1;
        if (document.visibilityState !== 'visible') {
          pollDelayMs = HIDDEN_POLL_MS;
        } else if (hadWork) {
          lastActivityAt = Date.now();
          consecutiveEmptyPolls = 0;
          lastEmptyPollReason = 'none';
          pollDelayMs = MIN_POLL_MS;
        } else {
          const isLegacyEmpty = LEGACY_EMPTY_REASONS.has(lastEmptyPollReason);
          if (isLegacyEmpty && lastProducerMode === 'disabled') {
            deactivateShortsProbe('producer_disabled_empty');
            return;
          }
          pollDelayMs = Math.min(pollDelayMs + EMPTY_BACKOFF_MS, MAX_POLL_MS);
        }
        if (Date.now() >= shortsProbeDeadlineMs) {
          deactivateShortsProbe('probe_deadline_elapsed');
          return;
        }
        if (shortsProbePollCount >= SHORTS_LEGACY_FALLBACK_MAX_POLLS) {
          deactivateShortsProbe('probe_max_polls_reached');
          return;
        }
        scheduleNextPoll(pollDelayMs);
        return;
      }
      if (document.visibilityState !== 'visible') {
        pollDelayMs = HIDDEN_POLL_MS;
      } else if (hadWork) {
        lastActivityAt = Date.now();
        consecutiveEmptyPolls = 0;
        lastEmptyPollReason = 'none';
        exitIdleMode('request');
        pollDelayMs = MIN_POLL_MS;
      } else {
        const shouldSelfDisableNonShortsLegacyPoll =
          isNonShortsYouTubeContext &&
          lastPollStatus === 'EMPTY' &&
          lastEmptyPollReason === 'queue_empty' &&
          lastProducerMode === 'disabled';
        if (shouldSelfDisableNonShortsLegacyPoll) {
          legacyPollSelfDisabledContextRef.current = pollContextKey;
          cancelled = true;
          console.log(
            '[DIAG][LEGACY_POLL_SELF_DISABLE]',
            'scope=non_shorts_youtube',
            'reason=empty_queue_disabled_producer',
            'status=' + lastPollStatus,
            'emptyReason=' + lastEmptyPollReason,
            'producer=' + lastProducerMode,
            'navId=' + activeNavIdRef.current,
            'url=' + (activeUrl || 'unknown'),
          );
          return;
        }
        consecutiveEmptyPolls += 1;
        maybeEnterIdleMode();
        if (idleMode) {
          idlePollMs = Math.min(idlePollMs + IDLE_BACKOFF_MS, IDLE_MAX_POLL_MS);
          pollDelayMs = idlePollMs;
        } else {
          pollDelayMs = Math.min(pollDelayMs + EMPTY_BACKOFF_MS, MAX_POLL_MS);
        }
      }
      const pollUrl = webViewState.currentUrl || currentUrlRef.current || activeUrl;
      const shouldThrottleProfileDecisionOnPoll = isProfileDecisionOnContext(pollUrl);
      if (shouldThrottleProfileDecisionOnPoll && pollDelayMs < PROFILE_DECISION_ON_POLL_MS) {
        pollDelayMs = PROFILE_DECISION_ON_POLL_MS;
        console.log(
          '[DIAG][LEGACY_POLL_THROTTLE]',
          'action=profile_decision_on',
          'delayMs=' + pollDelayMs,
          'overlayReason=' + blurStateRef.current.reason,
          'url=' + (pollUrl || 'unknown'),
        );
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
    const initialPollDelayMs = isProfileDecisionOnContext(activeUrl)
      ? PROFILE_DECISION_ON_POLL_MS
      : MIN_POLL_MS;
    scheduleNextPoll(initialPollDelayMs);

    return () => {
      cancelled = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
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
  }, [
    ENABLE_SIGNAL_PIPELINE,
    isNative,
    webViewState.isOpen,
    webViewListenersAttached,
    isRuntimeModerationEnabled,
    executeScript,
    moderationBridge,
    localSettings.blur_strength_px,
    webViewState.currentUrl,
    shortsLegacyFallbackVersion,
    shortsRelatedLegacyPollVersion,
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
    console.log('[DIAG][NAV_REQUEST] source=search target=' + toDiagUrl(targetUrl));
    
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
  }, [navigate, logEvent, isNative, openWebView, isUrlInput, toDiagUrl]);

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
    console.log('[DIAG][NAV_REQUEST] source=form target=' + toDiagUrl(normalizedUrl));
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
    if (localSettings.block_adult_sites) {
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
  }, [urlInput, localSettings.block_adult_sites, checkBlockedSite, deviceId, isNative, openWebView, handleSearch, navigate, logEvent, isUrlInput, toDiagUrl]);

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
      resetOverlayLiftHandshakeState('manual_reload');
      resetShortsOverlayCoordinator('manual_reload');
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setCentralBlurState(false, 'manual_reload');
      return;
    }
  }, [readerContent, currentView, searchQuery, isNative, webViewState.isOpen, handleReaderMode, handleSearch, webViewReload, setCentralBlurState, resetShortsOverlayCoordinator, resetOverlayLiftHandshakeState]);

  const handleHome = useCallback(async () => {
    teardownWebViewScheduling('home_reset', webViewState.currentUrl).catch(() => undefined);
    const currentFamily = getCacheFamilyContext(webViewState.currentUrl || currentUrlRef.current || '');
    if (isNative && webViewState.isOpen) {
      await closeWebView();
    }
    exitPendingReinject('home_reset', webViewState.currentUrl || currentUrlRef.current || '');
    moderationBridge.clearCache({
      reason: 'home_reset',
      previousFamily: currentFamily,
      nextFamily: 'home',
      navId: activeNavIdRef.current,
      pageEpoch: webViewPageEpochRef.current,
    });
    injectionDoneRef.current = false;
    blurReadyRef.current = false;
    resetOverlayLiftHandshakeState('home_reset');
    resetShortsOverlayCoordinator('home_reset');
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
  }, [isNative, webViewState.isOpen, webViewState.currentUrl, closeWebView, goHome, moderationBridge, setCentralBlurState, teardownWebViewScheduling, exitPendingReinject, resetShortsOverlayCoordinator, resetOverlayLiftHandshakeState]);

  // Manual scan trigger for current page
  const handleScanPage = useCallback(async () => {
    if (!isNative || !isRuntimeModerationEnabled) {
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
  }, [isNative, isRuntimeModerationEnabled, executeScript]);

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
          isProtected={effectiveShieldEnabled}
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
      {showDiagLayerBadge && (
        <div className="fixed right-2 top-2 z-[70] rounded bg-black/80 px-2 py-1 text-[10px] text-white pointer-events-none">
          TOP {diagTopLayerLabel}
        </div>
      )}
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
        isProtected={effectiveShieldEnabled}
        modeLabel={getModeLabel()}
        modeColor={getModeColor()}
      />
      
      {/* AI Moderation Status Bar - shown during browse mode */}
      {currentView === 'browse' && isRuntimeModerationEnabled && (
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

      <main ref={browserMainRef} className="flex-1 relative pb-16">
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
