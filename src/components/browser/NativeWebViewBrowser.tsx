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
import { getInjectionReadinessVerdict } from '@/lib/injection-readiness';
import {
  isProtectionOffState,
  shouldInjectForProtection,
  shouldRunFlashShield,
  shouldRunRuntimeModeration,
} from '@/lib/protection-mode';
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

// Profile/channel Shorts tab routes (player may be active while URL is not /shorts/ID).
// Keep separate from isYouTubeShortsUrl so getUrlFamily / main-surface logic stays feed-safe.
const isYouTubeProfileOrChannelShortsRoute = (value?: string): boolean => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (!(host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com')) {
      return false;
    }
    const path = parsed.pathname || '/';
    return (
      /^\/@[^/]+\/shorts(?:\/|$)/i.test(path) ||
      /^\/channel\/[^/]+\/shorts(?:\/|$)/i.test(path) ||
      /^\/c\/[^/]+\/shorts(?:\/|$)/i.test(path)
    );
  } catch {
    return false;
  }
};

// Host lifecycle surface for first-entry / reentry / force-seed / sticky Shorts epoch grace.
// Closes SKIP_NOT_SHORTS on profile-origin active Shorts without widening home/feed family.
const isHostActiveShortsLifecycleUrl = (value?: string): boolean => {
  return isYouTubeShortsUrl(value) || isYouTubeProfileOrChannelShortsRoute(value);
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
const SHORTS_READY_DEDUPE_WINDOW_MS = 1200;
const SHORTS_ACK_NO_REQ_RECOVER_DELAY_MS = 350;
const SHORTS_FIRST_ENTRY_LATCH_MS = 1500;
const SHORTS_FIRST_ENTRY_FORCE_RETRY_COOLDOWN_MS = 240;
const SHORTS_FIRST_ENTRY_FORCE_MAX_ATTEMPTS = 3;
const SHORTS_READY_BOOTSTRAP_REASONS = new Set([
  'init',
  'ping',
  'reinject',
  'load',
  'pageshow',
  'visibility',
  'pushstate',
  'replacestate',
  'popstate',
  'hashchange',
]);

const getUrlFamily = (value?: string) => {
  if (!value) return 'unknown';
  if (isYouTubeShortsUrl(value)) return 'youtube_shorts';
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

const isBootstrapBlankUrl = (value?: string): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '' || normalized === 'about:blank' || normalized.startsWith('about:blank');
};

const getYouTubeShortsId = (value?: string): string => {
  if (!value) return 'none';
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const shortsIndex = segments.indexOf('shorts');
    if (shortsIndex !== -1 && segments[shortsIndex + 1]) {
      return segments[shortsIndex + 1];
    }
    const videoQuery = parsed.searchParams.get('v');
    if (videoQuery) return videoQuery;
  } catch {
    return 'none';
  }
  return 'none';
};

const getSovereignIdForContext = (value?: string, navId?: number, pageEpoch?: number): string => {
  const safeNavId = Number.isFinite(navId) ? Number(navId) : 0;
  const safeEpoch = Number.isFinite(pageEpoch) ? Number(pageEpoch) : 0;
  const shortsId = getYouTubeShortsId(value);
  return `${safeNavId}|${safeEpoch}|${shortsId}`;
};

const parseSovereignId = (value?: string): { navId: number | null; pageEpoch: number | null; videoId: string } => {
  const raw = String(value || '').trim();
  if (!raw) {
    return { navId: null, pageEpoch: null, videoId: 'none' };
  }
  const parts = raw.split('|');
  const navId = Number.isFinite(Number(parts[0])) ? Number(parts[0]) : null;
  const pageEpoch = Number.isFinite(Number(parts[1])) ? Number(parts[1]) : null;
  const fallbackVideo = parts.length >= 3 && parts[2] ? parts[2] : '';
  const parsedVideo = getYouTubeShortsId(raw);
  return {
    navId,
    pageEpoch,
    videoId: parsedVideo !== 'none' ? parsedVideo : (fallbackVideo || 'none'),
  };
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
  // Enable page-wide DOM blur/overlay bridge in addition to per-element blur.
  const ENABLE_DOM_BLUR = true;
  const ENABLE_SIGNAL_PIPELINE = true;
  const browserMainRef = useRef<HTMLElement | null>(null);
  const hostLayerDiagLogAtRef = useRef(0);
  const topLayerLabelRef = useRef('none');
  const [diagTopLayerLabel, setDiagTopLayerLabel] = useState('none');
  const [showDiagLayerBadge, setShowDiagLayerBadge] = useState(false);
  const launchStateNormalizedRef = useRef(false);
  
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
  const protectionModeState = {
    effectiveShieldEnabled,
    blurDial: localSettings.blur_dial,
    flashShieldEnabled: localSettings.flash_shield_enabled === true,
  };
  const isProtectionOff = isProtectionOffState(protectionModeState);
  const isRuntimeModerationEnabled = shouldRunRuntimeModeration(protectionModeState);
  const isFlashShieldEnabled = shouldRunFlashShield(protectionModeState);
  const shouldInjectModeration = shouldInjectForProtection(protectionModeState);

  // Central blur source-of-truth with hysteresis to avoid flicker.
  const blurStateRef = useRef<{ enabled: boolean; reason: string; timestamp: number }>({
    enabled: false,
    reason: 'init',
    timestamp: Date.now(),
  });
  const blurReadyRef = useRef(false);
  const blurReadyDedupeRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const blurPendingRef = useRef<{ enabled: boolean; reason: string; timestamp: number } | null>(null);
  const blurRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const blurSignalRef = useRef({ unsafeStreak: 0, safeStreak: 0 });
  const [blurSyncVersion, setBlurSyncVersion] = useState(0);
  const riskDecisionListenerRef = useRef<PluginListenerHandle | null>(null);
  const lastNsfwSignalAtRef = useRef(0);
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
  const shortsReqSeenEpochRef = useRef<number | null>(null);
  const shortsScopedReqSeenRef = useRef<{ epoch: number; videoId: string; at: number } | null>(null);
  const shortsAckNoReqRecoverEpochRef = useRef<number | null>(null);
  const shortsAckNoReqRecoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const shortsFirstEntryLatchRef = useRef<{
    armed: boolean;
    epoch: number;
    videoId: string;
    untilMs: number;
    armedAt: number;
    reentryRequested: boolean;
    forceRequested: boolean;
    forceAttemptCount: number;
    forceLastAt: number;
    reason: string;
  }>({
    armed: false,
    epoch: 0,
    videoId: 'none',
    untilMs: 0,
    armedAt: 0,
    reentryRequested: false,
    forceRequested: false,
    forceAttemptCount: 0,
    forceLastAt: 0,
    reason: 'idle',
  });
  const legacyPollSelfDisabledContextRef = useRef<string | null>(null);
  const [shortsLegacyFallbackVersion, setShortsLegacyFallbackVersion] = useState(0);

  const UNSAFE_STREAK_REQUIRED = 2;
  const SAFE_STREAK_REQUIRED = 2;
  const PENDING_REINJECT_WINDOW_MS = 1500;
  const isDebugMode = localSettings.debug_mode === true;
  const debugLog = useCallback((...args: unknown[]) => {
    if (!isDebugMode) return;
    console.log(...args);
  }, [isDebugMode]);

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

  const disarmShortsFirstEntryLatch = useCallback((reason: string) => {
    const state = shortsFirstEntryLatchRef.current;
    if (!state.armed) return;
    const armedForMs = Math.max(0, Date.now() - state.armedAt);
    console.log(
      '[MW-Host][ShortsEntryLatch] disarm',
      'reason=' + reason,
      'epoch=' + state.epoch,
      'videoId=' + state.videoId,
      'armedForMs=' + armedForMs,
      'reentryRequested=' + state.reentryRequested,
      'forceRequested=' + state.forceRequested,
      'forceAttemptCount=' + state.forceAttemptCount,
      'navId=' + activeNavIdRef.current,
    );
    shortsFirstEntryLatchRef.current = {
      armed: false,
      epoch: 0,
      videoId: 'none',
      untilMs: 0,
      armedAt: 0,
      reentryRequested: false,
      forceRequested: false,
      forceAttemptCount: 0,
      forceLastAt: 0,
      reason,
    };
  }, []);

  const armShortsFirstEntryLatch = useCallback((reason: string, urlHint?: string) => {
    const activeUrl = urlHint || webViewState.currentUrl || currentUrlRef.current || '';
    if (!isYouTubeShortsUrl(activeUrl)) return false;
    const videoId = getYouTubeShortsId(activeUrl);
    if (!videoId || videoId === 'none') return false;
    const epoch = webViewPageEpochRef.current || 0;
    if (!Number.isFinite(epoch) || epoch <= 0) return false;
    const state = shortsFirstEntryLatchRef.current;
    const now = Date.now();
    if (
      state.armed &&
      state.epoch === epoch &&
      state.videoId === videoId &&
      state.untilMs > now
    ) {
      return true;
    }
    shortsFirstEntryLatchRef.current = {
      armed: true,
      epoch,
      videoId,
      untilMs: now + SHORTS_FIRST_ENTRY_LATCH_MS,
      armedAt: now,
      reentryRequested: false,
      forceRequested: false,
      forceAttemptCount: 0,
      forceLastAt: 0,
      reason,
    };
    console.log(
      '[MW-Host][ShortsEntryLatch] arm',
      'reason=' + reason,
      'epoch=' + epoch,
      'videoId=' + videoId,
      'untilMs=' + (now + SHORTS_FIRST_ENTRY_LATCH_MS),
      'navId=' + activeNavIdRef.current,
      'url=' + (activeUrl || 'unknown'),
    );
    return true;
  }, []);

  const getActiveShortsFirstEntryLatch = useCallback((urlHint?: string) => {
    const activeUrl = urlHint || webViewState.currentUrl || currentUrlRef.current || '';
    const state = shortsFirstEntryLatchRef.current;
    if (!state.armed) return null;
    if (!isYouTubeShortsUrl(activeUrl)) {
      disarmShortsFirstEntryLatch('left_shorts');
      return null;
    }
    const liveEpoch = webViewPageEpochRef.current || 0;
    const liveVideoId = getYouTubeShortsId(activeUrl);
    const now = Date.now();
    if (
      state.untilMs <= now ||
      state.epoch !== liveEpoch ||
      state.videoId !== liveVideoId
    ) {
      disarmShortsFirstEntryLatch('expired_or_context_changed');
      return null;
    }
    return state;
  }, [disarmShortsFirstEntryLatch]);

  const markShortsFirstEntryReentryRequested = useCallback((reason: string, urlHint?: string) => {
    const state = getActiveShortsFirstEntryLatch(urlHint);
    if (!state) return false;
    if (state.reentryRequested) {
      console.log(
        '[MW-Host][ShortsEntryLatch] skip_reentry',
        'reason=' + reason,
        'epoch=' + state.epoch,
        'videoId=' + state.videoId,
        'navId=' + activeNavIdRef.current,
      );
      return false;
    }
    state.reentryRequested = true;
    return true;
  }, [getActiveShortsFirstEntryLatch]);

  const markShortsFirstEntryForceRequested = useCallback((
    reason: string,
    urlHint?: string,
    opts?: { allowRetry?: boolean },
  ) => {
    const state = getActiveShortsFirstEntryLatch(urlHint);
    if (!state) return false;
    const now = Date.now();
    const allowRetry = opts?.allowRetry === true;
    if (state.forceAttemptCount >= SHORTS_FIRST_ENTRY_FORCE_MAX_ATTEMPTS) {
      console.log(
        '[MW-Host][ShortsEntryLatch] skip_force',
        'reason=' + reason,
        'retry=' + (allowRetry ? '1' : '0'),
        'mode=max_attempts',
        'epoch=' + state.epoch,
        'videoId=' + state.videoId,
        'attempts=' + state.forceAttemptCount,
        'navId=' + activeNavIdRef.current,
      );
      return false;
    }
    if (!allowRetry && state.forceRequested) {
      console.log(
        '[MW-Host][ShortsEntryLatch] skip_force',
        'reason=' + reason,
        'retry=0',
        'mode=already_requested',
        'epoch=' + state.epoch,
        'videoId=' + state.videoId,
        'attempts=' + state.forceAttemptCount,
        'navId=' + activeNavIdRef.current,
      );
      return false;
    }
    if (
      allowRetry &&
      state.forceAttemptCount > 0 &&
      (now - state.forceLastAt) < SHORTS_FIRST_ENTRY_FORCE_RETRY_COOLDOWN_MS
    ) {
      console.log(
        '[MW-Host][ShortsEntryLatch] skip_force',
        'reason=' + reason,
        'retry=1',
        'mode=cooldown',
        'cooldownMs=' + SHORTS_FIRST_ENTRY_FORCE_RETRY_COOLDOWN_MS,
        'sinceLastMs=' + (now - state.forceLastAt),
        'epoch=' + state.epoch,
        'videoId=' + state.videoId,
        'attempts=' + state.forceAttemptCount,
        'navId=' + activeNavIdRef.current,
      );
      return false;
    }
    state.forceRequested = true;
    state.forceAttemptCount += 1;
    state.forceLastAt = now;
    return true;
  }, [getActiveShortsFirstEntryLatch]);

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
    console.log(
      '[DIAG][OVERLAY_HOST_STATE]',
      'enabled=' + enabled,
      'reason=' + reason,
      'prevEnabled=' + prev.enabled,
      'prevReason=' + prev.reason,
    );
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

  useEffect(() => {
    if (isRuntimeModerationEnabled) return;
    blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
    setCentralBlurState(false, effectiveShieldEnabled ? 'moderation_disabled' : 'shield_pass_active');
  }, [isRuntimeModerationEnabled, effectiveShieldEnabled, setCentralBlurState]);

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
  const noHookFallbackRecoverKeysRef = useRef<Set<string>>(new Set());
  const didInjectAfterSettingsLoadedRef = useRef(false);
  /** One-shot cold-start rescan after NSFWJS becomes ready for this webview open. */
  const didColdStartModelFlushRef = useRef(false);
  /**
   * FREEZE-OVERRIDE (lifecycle): port of phase0-freeze-rc1 / 1220acc9 recoveryNonce.
   * Bumping re-arms ColdStartDriver (cold open, dead-script after background, refresh).
   */
  const [recoveryNonce, setRecoveryNonce] = useState(0);
  const nonBootstrapAckObservedRef = useRef(false);
  const epochContextCurrentRef = useRef(false);
  const relaxedEpochBypassHookStableRef = useRef(false);
  const loadEndInjectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingReinjectTimerRef = useRef<NodeJS.Timeout | null>(null);
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

  const resetInjectionReadiness = useCallback((reason: string) => {
    injectionDoneRef.current = false;
    nonBootstrapAckObservedRef.current = false;
    epochContextCurrentRef.current = false;
    relaxedEpochBypassHookStableRef.current = false;
    blurReadyRef.current = false;
    blurReadyDedupeRef.current = { key: '', at: 0 };
    console.log(
      '[DIAG][INJECT] readiness_reset',
      'reason=' + reason,
      'navId=' + activeNavIdRef.current,
      'pageEpoch=' + webViewPageEpochRef.current,
    );
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

  // Defensive launch normalization: startup must land on home unless there is
  // an active, meaningful search/navigation state to preserve.
  useEffect(() => {
    if (launchStateNormalizedRef.current) return;
    launchStateNormalizedRef.current = true;
    const staleSearchLaunch =
      currentView === 'search' &&
      !isSearching &&
      searchResults.length === 0 &&
      !String(searchQuery || '').trim();
    const staleNonHomeLaunch =
      currentView !== 'home' &&
      !String(currentUrl || '').trim() &&
      !isSearching &&
      !String(searchQuery || '').trim();
    if (!staleSearchLaunch && !staleNonHomeLaunch) return;
    console.log(
      '[DIAG][BROWSER] normalize_launch to_home',
      'reason=' + (staleSearchLaunch ? 'stale_search_to_home' : 'stale_non_home_to_home'),
      'currentView=' + currentView
    );
    setSearchError(null);
    setUrlInput('');
    goHome();
  }, [currentView, currentUrl, isSearching, searchResults.length, searchQuery, goHome]);

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
      // Keep the current blur state on timeout to avoid fail-open races when reinjection is delayed.
      queueCurrentBlurState('url_change_safe_reset_pending_timeout');
    }, PENDING_REINJECT_WINDOW_MS);
  }, [clearPendingReinjectTimer, logSafeResetDiag, queueCurrentBlurState, PENDING_REINJECT_WINDOW_MS]);

  const logLifecycleSnapshot = useCallback((event: string, urlHint?: string, reason?: string) => {
    const currentUrl = urlHint || currentUrlRef.current || 'unknown';
    const activeTimerNames: string[] = [];
    if (loadEndInjectTimerRef.current) activeTimerNames.push('loadEndInjectTimer');
    if (blurRetryTimerRef.current) activeTimerNames.push('blurRetryTimer');
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

  // FREEZE-OVERRIDE (lifecycle): force inject-side rediscovery after load/refresh/
  // already-active inject. Does not touch sacred blur/reveal bodies — only scan queue.
  const requestLifecycleRescan = useCallback(async (
    scriptExecutor: ((script: string) => Promise<string | null>) | undefined,
    reason: string,
  ) => {
    if (!scriptExecutor) return;
    const safeReason = escapeForJs(reason || 'lifecycle_rescan');
    try {
      const result = await scriptExecutor(`
        (function() {
          try {
            if (typeof window.__MW_LIFECYCLE_RESCAN__ === 'function') {
              return String(window.__MW_LIFECYCLE_RESCAN__('${safeReason}') || 'NO_HOOK');
            }
            if (typeof window.__MW_COLD_START_FLUSH__ === 'function') {
              return String(window.__MW_COLD_START_FLUSH__('${safeReason}') || 'NO_HOOK');
            }
            if (typeof window.__MW_SCAN_FULL__ === 'function') window.__MW_SCAN_FULL__();
            if (typeof window.__MW_SCAN_YT__ === 'function') window.__MW_SCAN_YT__();
            return 'FALLBACK_SCAN';
          } catch (e) {
            return 'ERR:' + String(e && e.message ? e.message : e);
          }
        })();
      `);
      console.log(
        '[DIAG][LIFECYCLE_RESCAN][HOST]',
        'reason=' + reason,
        'result=' + String(result || 'null'),
        'navId=' + activeNavIdRef.current,
        'modelReady=' + String(!!moderationBridge.isReady),
      );
    } catch (error) {
      console.warn(
        '[DIAG][LIFECYCLE_RESCAN][HOST]',
        'reason=' + reason,
        'error=' + (error instanceof Error ? error.message : String(error)),
      );
    }
  }, [moderationBridge.isReady]);

  const scheduleLifecycleRescanBurst = useCallback((
    scriptExecutor: ((script: string) => Promise<string | null>) | undefined,
    reason: string,
  ) => {
    if (!scriptExecutor) return;
    // Immediate + delayed passes — refresh/first-entry DOM paints late.
    void requestLifecycleRescan(scriptExecutor, reason + '_t0');
    window.setTimeout(() => {
      void requestLifecycleRescan(scriptExecutor, reason + '_t300');
    }, 300);
    window.setTimeout(() => {
      void requestLifecycleRescan(scriptExecutor, reason + '_t800');
    }, 800);
    window.setTimeout(() => {
      void requestLifecycleRescan(scriptExecutor, reason + '_t1500');
    }, 1500);
  }, [requestLifecycleRescan]);

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
    if (!shouldInjectModeration) {
      console.log('[MW-Bridge] Moderation and Flash Shield disabled, skipping injection');
      return;
    }

    const targetUrl = urlHint || currentUrlRef.current || '';
    const navId = activeNavIdRef.current || 0;
    if (isBootstrapBlankUrl(targetUrl)) {
      console.log(
        '[DIAG][INJECT] bootstrap_skip',
        'reason=' + reason,
        'navId=' + navId,
        'pageEpoch=' + webViewPageEpochRef.current,
        'url=' + (targetUrl || 'about:blank'),
      );
      return;
    }
    const now = Date.now();
    // FREEZE-OVERRIDE (lifecycle): do not skip reinject while readiness never ACKed.
    // Cold YouTube launch often reinjects within 2s before MW_INJECTED_ACK lands.
    const readinessAlive =
      nonBootstrapAckObservedRef.current === true || blurReadyRef.current === true;
    const recentlyInjectedSameUrl =
      injectionDoneRef.current &&
      readinessAlive &&
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
        'readinessAlive=' + readinessAlive,
      );
      // FREEZE-OVERRIDE (lifecycle): even on inject dedupe, force rediscovery so
      // refresh/load-end late thumbs are not left unscanned.
      if (recentlyInjectedSameUrl && !injectionInFlightRef.current) {
        void requestLifecycleRescan(scriptExecutor, 'inject_dedupe_rescan:' + reason);
      }
      return;
    }

    injectionInFlightRef.current = true;
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
    const escapedReason = escapeForJs(reason || 'unknown');
    const hostContextSyncScript = `
      (function() {
        try {
          window.__MW_ACTIVE_INSTANCE_ID__ = ${activeInstanceId === null ? 'null' : String(activeInstanceId)};
          window.__MW_HOST_NAV_ID__ = ${navId};
          window.__MW_HOST_PAGE_EPOCH__ = ${webViewPageEpochRef.current};
          var syncResult = 'NO_HOOK';
          if (typeof window.__MW_SYNC_HOST_CONTEXT__ === 'function') {
            syncResult = window.__MW_SYNC_HOST_CONTEXT__({
              navId: ${navId},
              pageEpoch: ${webViewPageEpochRef.current},
              reason: '${escapedReason}'
            });
          }
          return JSON.stringify({
            hostContext: 'OK',
            syncResult: String(syncResult || 'NO_HOOK'),
            navId: ${navId},
            pageEpoch: ${webViewPageEpochRef.current}
          });
        } catch (e) {
          return JSON.stringify({
            hostContext: 'ERR',
            error: String(e)
          });
        }
      })();
    `;
    const hostContextSyncResult = await scriptExecutor(hostContextSyncScript);
    let syncResult = 'NO_HOOK';
    try {
      const parsed = JSON.parse(String(hostContextSyncResult || '{}')) as { syncResult?: string };
      syncResult = String(parsed.syncResult || 'NO_HOOK');
    } catch {
      syncResult = String(hostContextSyncResult || 'NO_HOOK');
    }
    const syncApplied = syncResult === 'OK_EPOCH_RESYNCED' || syncResult === 'OK_NO_CHANGE';
    console.log(
      '[DIAG][INJECT] host_context_sync',
      'reason=' + reason,
      'navId=' + navId,
      'pageEpoch=' + webViewPageEpochRef.current,
      'activeInstanceId=' + (activeInstanceId ?? 'none'),
      'syncResult=' + syncResult,
      'url=' + (targetUrl || 'unknown'),
    );
    if (syncApplied) {
      epochContextCurrentRef.current = true;
      relaxedEpochBypassHookStableRef.current =
        nonBootstrapAckObservedRef.current && epochContextCurrentRef.current;
      console.log(
        '[DIAG][EPOCH_SYNC][HOST]',
        'action=sync_applied_awaiting_readiness',
        'reason=' + reason,
        'syncResult=' + syncResult,
        'navId=' + navId,
        'pageEpoch=' + webViewPageEpochRef.current,
        'url=' + (targetUrl || 'unknown'),
      );
      // FREEZE-OVERRIDE (lifecycle): epoch sync alone left refresh/first-paint
      // thumbs unscanned until a later mutation. Force rediscovery.
      void requestLifecycleRescan(scriptExecutor, 'sync_applied_rescan:' + reason);
      return;
    }
    const config = {
      ...getModerationConfig(),
      enabled: isRuntimeModerationEnabled,
      scanEnabled: shouldInjectModeration,
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
    const noHookFallbackKey = [
      String(navId),
      String(webViewPageEpochRef.current),
      String(targetUrl || 'unknown'),
    ].join('|');
    const markNoHookRecoveryAttempt = () => {
      const attemptedRecoveries = noHookFallbackRecoverKeysRef.current;
      if (attemptedRecoveries.has(noHookFallbackKey)) return false;
      attemptedRecoveries.add(noHookFallbackKey);
      if (attemptedRecoveries.size > 256) {
        attemptedRecoveries.clear();
        attemptedRecoveries.add(noHookFallbackKey);
      }
      return true;
    };
    try {
      const injectResult = await scriptExecutor(mainScript);
      const injectResultText = String(injectResult || '');
      const alreadyActive = injectResultText.includes('MW_ALREADY_ACTIVE');
      if (alreadyActive) {
        if (syncResult === 'NO_HOOK') {
          if (markNoHookRecoveryAttempt()) {
            const teardownResult = await scriptExecutor(`
              (function() {
                try {
                  if (typeof window.__MW_TEARDOWN__ !== 'function') return 'NO_TEARDOWN';
                  window.__MW_TEARDOWN__('host_no_hook_recover');
                  return 'TEARDOWN_OK';
                } catch (e) {
                  return 'TEARDOWN_ERR:' + String(e);
                }
              })();
            `);
            const teardownText = String(teardownResult || 'null');
            console.warn(
              '[DIAG][INJECT] no_hook_active_recover',
              'reason=' + reason,
              'navId=' + navId,
              'pageEpoch=' + webViewPageEpochRef.current,
              'url=' + (targetUrl || 'unknown'),
              'teardown=' + teardownText,
            );
            if (teardownText === 'TEARDOWN_OK') {
              const reinjectResult = await scriptExecutor(mainScript);
              const reinjectText = String(reinjectResult || '');
              if (!reinjectText.includes('MW_ALREADY_ACTIVE')) {
                console.log(
                  '[DIAG][INJECT] no_hook_active_recover_success',
                  'reason=' + reason,
                  'navId=' + navId,
                  'pageEpoch=' + webViewPageEpochRef.current,
                  'url=' + (targetUrl || 'unknown'),
                  'readiness=awaiting_ack',
                );
                return;
              }
            }
          } else {
            console.log(
              '[DIAG][INJECT] no_hook_active_recover_dedup_skip',
              'reason=' + reason,
              'navId=' + navId,
              'pageEpoch=' + webViewPageEpochRef.current,
              'url=' + (targetUrl || 'unknown'),
            );
          }
        }
        console.warn(
          '[DIAG][INJECT] skipped_already_active',
          'reason=' + reason,
          'navId=' + navId,
          'pageEpoch=' + webViewPageEpochRef.current,
          'url=' + (targetUrl || 'unknown'),
        );
        // FREEZE-OVERRIDE (lifecycle): MW_ALREADY_ACTIVE on load-end/refresh must
        // still rediscover thumbs (DOM often painted after first inject).
        lastInjectedUrlRef.current = targetUrl;
        lastInjectionAtRef.current = Date.now();
        void requestLifecycleRescan(scriptExecutor, 'already_active_rescan:' + reason);
        return;
      }
      if (syncResult === 'NO_HOOK') {
        if (markNoHookRecoveryAttempt()) {
          const teardownResult = await scriptExecutor(`
            (function() {
              try {
                if (typeof window.__MW_TEARDOWN__ !== 'function') return 'NO_TEARDOWN';
                window.__MW_TEARDOWN__('host_no_hook_recover');
                return 'TEARDOWN_OK';
              } catch (e) {
                return 'TEARDOWN_ERR:' + String(e);
              }
            })();
          `);
          const teardownText = String(teardownResult || 'null');
          console.warn(
            '[DIAG][INJECT] no_hook_active_recover',
            'reason=' + reason,
            'navId=' + navId,
            'pageEpoch=' + webViewPageEpochRef.current,
            'url=' + (targetUrl || 'unknown'),
            'mode=fallback_no_return',
            'teardown=' + teardownText,
          );
          try {
            await scriptExecutor(mainScript);
            console.log(
              '[DIAG][INJECT] no_hook_active_recover_success',
              'reason=' + reason,
              'navId=' + navId,
              'pageEpoch=' + webViewPageEpochRef.current,
              'url=' + (targetUrl || 'unknown'),
              'mode=fallback_no_return',
              'readiness=awaiting_ack',
            );
            return;
          } catch (reinjectError) {
            console.warn(
              '[DIAG][INJECT] no_hook_active_recover_reinject_error',
              'reason=' + reason,
              'navId=' + navId,
              'pageEpoch=' + webViewPageEpochRef.current,
              'url=' + (targetUrl || 'unknown'),
              'mode=fallback_no_return',
              'message=' + (reinjectError instanceof Error ? reinjectError.message : String(reinjectError)),
            );
          }
        }
      }
      console.log(
        '[MW-Inject][InjectedDispatch]',
        'navId=' + navId,
        'reason=' + reason,
        'targetUrl=' + (targetUrl || 'unknown'),
        'readiness=awaiting_ack',
      );
      console.log(
        '[DIAG][INJECT] dispatch',
        'reason=' + reason,
        'navId=' + navId,
        'pageEpoch=' + webViewPageEpochRef.current,
        'url=' + (targetUrl || 'unknown'),
      );
      console.log(
        '[DIAG][INJECT] dispatch_awaiting_readiness',
        'reason=' + reason,
        'navId=' + navId,
        'url=' + (targetUrl || 'unknown'),
      );
      lastInjectedUrlRef.current = targetUrl;
      lastInjectionAtRef.current = Date.now();
      // FREEZE-OVERRIDE (lifecycle): fresh inject often lands before thumbs paint.
      // Burst rescan covers first YouTube entry + browser refresh regain.
      scheduleLifecycleRescanBurst(scriptExecutor, 'post_inject:' + reason);
    } catch (error) {
      console.error('[MW-Bridge] Moderation script injection failed:', error);
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
  }, [
    ENABLE_SIGNAL_PIPELINE,
    settingsLoaded,
    isRuntimeModerationEnabled,
    shouldInjectModeration,
    getModerationConfig,
    localSettings.diag_youtube_shorts,
    exitPendingReinject,
    requestLifecycleRescan,
    scheduleLifecycleRescanBurst,
  ]);

  const getWebViewListenerDiagContext = useCallback(() => {
    return {
      navId: activeNavIdRef.current || null,
      url: currentUrlRef.current || '',
      activeInstanceId: webViewActiveInstanceIdRef.current,
    };
  }, []);

  const clearStaleOwnershipAtBoundary = useCallback(async (
    scriptExecutor: ((script: string) => Promise<string | null>) | undefined,
    reason: string,
    urlHint?: string,
  ) => {
    if (!scriptExecutor) return;
    const targetUrl = String(urlHint || currentUrlRef.current || '');
    const family = getCacheFamilyContext(targetUrl);
    if (!isYouTubeFamilyContext(family)) return;
    const safeReason = escapeForJs(reason || 'host_boundary');
    try {
      const result = await scriptExecutor(`
        (function() {
          try {
            if (typeof window.__MW_CLEAR_STALE_OWNERSHIP__ !== 'function') return 'NO_HOOK';
            return window.__MW_CLEAR_STALE_OWNERSHIP__('${safeReason}');
          } catch (e) {
            return 'ERR:' + String(e);
          }
        })();
      `);
      console.log(
        '[DIAG][OWNERSHIP_BOUNDARY_CLEAR]',
        'reason=' + reason,
        'family=' + family,
        'url=' + (targetUrl || 'unknown'),
        'result=' + String(result || 'null'),
      );
    } catch (error) {
      console.warn(
        '[DIAG][OWNERSHIP_BOUNDARY_CLEAR]',
        'reason=' + reason,
        'family=' + family,
        'url=' + (targetUrl || 'unknown'),
        'result=EXEC_ERROR',
        'message=' + (error instanceof Error ? error.message : String(error)),
      );
    }
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
      const skipBootstrapLoadStart = isBootstrapBlankUrl(url);
      if (skipBootstrapLoadStart) {
        console.log(
          '[DIAG][LOAD] bootstrap_blank_skip',
          'stage=onLoadStart',
          'url=' + toDiagUrl(url),
          'navId=' + activeNavIdRef.current,
          'pageEpoch=' + webViewPageEpochRef.current,
        );
      } else {
        markNavigation('onLoadStart', url);
        moderationNavGenerationRef.current += 1;
      }
      logHostLayerDiagnostics('load_start');
      setIsLoading(true);
      clearLoadEndInjectTimer();
      injectionInFlightRef.current = false;
      resetInjectionReadiness('navigation_load_start');
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
      // Teardown first, then inject to avoid __MW_ACTIVE__ races.
      if (!skipBootstrapLoadStart && executeScript) {
        void (async () => {
          await clearStaleOwnershipAtBoundary(executeScript, 'onLoadStart', url);
          await teardownWebViewScheduling('navigation_start', url).catch(() => undefined);
          await injectModerationScript(executeScript, 'onLoadStart', url);
        })();
      }
    },
    onLoadEnd: async (url) => {
      console.log('[DIAG][LOAD] stage=success url=' + toDiagUrl(url));
      console.log('[Browser] ======= LOAD END =======');
      console.log('[Browser] URL:', url);
      const skipBootstrapLoadEnd = isBootstrapBlankUrl(url);
      if (skipBootstrapLoadEnd) {
        console.log(
          '[DIAG][LOAD] bootstrap_blank_skip',
          'stage=onLoadEnd',
          'url=' + toDiagUrl(url),
          'navId=' + activeNavIdRef.current,
          'pageEpoch=' + webViewPageEpochRef.current,
        );
      }
      logLifecycleSnapshot('page_load_end', url, 'onLoadEnd');
      logHostLayerDiagnostics('load_end');
      setIsLoading(false);
      setFlashGuardState?.(false, 'load_end');
      if (!ENABLE_SIGNAL_PIPELINE) return;
      if (skipBootstrapLoadEnd) return;
      
      // FREEZE-OVERRIDE (lifecycle): always reinject-or-rescan after load end.
      // Prior gate (`if (!injectionDone)`) skipped load-end when early onLoadStart
      // inject already set done → refresh regained only after slow mutations.
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
        // Explicit rescan burst even if inject short-circuited to already-active.
        scheduleLifecycleRescanBurst(executeScript, 'onLoadEnd:' + (url || 'unknown'));
        loadEndInjectTimerRef.current = null;
      }, 80);
      console.log(
        '[MW-Host][Timer] start',
        'name=loadEndInjectTimer',
        'navId=' + activeNavIdRef.current,
        'url=' + (url || 'unknown'),
      );
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
      injectionInFlightRef.current = false;
      resetInjectionReadiness('load_error');
      exitPendingReinject('load_error', url);
      setFallbackUrl(url);
      navigate('fallback', '', url);
    },
    onUrlChange: (url) => {
      const previousUrl = currentUrlRef.current || webViewState.currentUrl || '';
      const previousFamily = getCacheFamilyContext(previousUrl);
      const nextFamily = getCacheFamilyContext(url);
      const previousShortsId = getYouTubeShortsId(previousUrl);
      const nextShortsId = getYouTubeShortsId(url);
      const shortsIdChanged =
        isYouTubeShortsUrl(previousUrl) &&
        isYouTubeShortsUrl(url) &&
        previousShortsId !== nextShortsId;
      const deferReason = `youtube_internal_nav_${previousFamily}_to_${nextFamily}`;
      const shouldDeferSafeReset =
        !!previousUrl &&
        isRuntimeModerationEnabled &&
        isYouTubeFamilyContext(previousFamily) &&
        isYouTubeFamilyContext(nextFamily) &&
        !shortsIdChanged;
      console.log('[Browser] ======= URL CHANGE =======');
      console.log('[Browser] New URL:', url);
      console.log('[DIAG][LOAD] stage=url_change url=' + toDiagUrl(url));
      markNavigation('onUrlChange', url);
      moderationNavGenerationRef.current += 1;
      logLifecycleSnapshot('url_change', url, 'onUrlChange');
      logHostLayerDiagnostics('url_change');
      setUrlInput(url);
      navigate('browse', url, url);
      // Reset injection for new page navigation
      clearLoadEndInjectTimer();
      injectionInFlightRef.current = false;
      resetInjectionReadiness('url_change');
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      if (shortsIdChanged && executeScript) {
        const safeReason = escapeForJs('shorts_url_change_hard_reset');
        void executeScript(`
          (function() {
            try {
              if (typeof window.__MW_SHORTS_REENTRY_REFRESH__ !== 'function') return 'NO_HOOK';
              return window.__MW_SHORTS_REENTRY_REFRESH__('${safeReason}');
            } catch (e) {
              return 'ERR:' + String(e);
            }
          })();
        `).catch(() => undefined);
      }
      if (isHostActiveShortsLifecycleUrl(url)) {
        const sinceLastReq = Date.now() - shortsLegacyFallbackRef.current.lastReqSentAt;
        if (sinceLastReq > SHORTS_LEGACY_FALLBACK_REQ_GRACE_MS || shortsIdChanged) {
          armShortsLegacyFallbackProbe(
            isYouTubeProfileOrChannelShortsRoute(url)
              ? 'shorts_url_change_uncertain_profile_origin'
              : 'shorts_url_change_uncertain',
            SHORTS_LEGACY_FALLBACK_ENTRY_PROBE_MS,
          );
        }
      }
      if (shouldDeferSafeReset) {
        logSafeResetDiag('safe_reset_deferred', deferReason, url);
        enterPendingReinject(deferReason, url);
        queueCurrentBlurState('url_change_safe_reset_deferred');
      } else {
        exitPendingReinject(`context_exit_${previousFamily}_to_${nextFamily}`, url);
        setCentralBlurState(false, 'url_change_safe_reset');
      }
      if (executeScript && isYouTubeFamilyContext(previousFamily) && isYouTubeFamilyContext(nextFamily)) {
        void clearStaleOwnershipAtBoundary(
          executeScript,
          `onUrlChange_${previousFamily}_to_${nextFamily}`,
          url,
        );
      }
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
      injectionInFlightRef.current = false;
      resetInjectionReadiness('webview_closed');
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
  const executeScriptRef = useRef(executeScript);

  const requestShortsReentryRefresh = useCallback(async (
    reason: string,
    urlHint?: string,
    force?: boolean,
  ): Promise<string> => {
    if (!isNative || !webViewState.isOpen || !executeScript) return 'SKIP_HOST';
    const activeUrl = urlHint || webViewState.currentUrl || currentUrlRef.current || '';
    // FREEZE-OVERRIDE: profile/channel Shorts lifecycle (not pure /shorts) must not SKIP_NOT_SHORTS.
    if (!isHostActiveShortsLifecycleUrl(activeUrl)) return 'SKIP_NOT_SHORTS';
    if (isYouTubeProfileOrChannelShortsRoute(activeUrl)) {
      console.warn(
        '[DIAG][SHORTS_REENTRY][HOST]',
        'action=profile_origin_lifecycle_gate',
        'reason=' + reason,
        'url=' + toDiagUrl(activeUrl),
      );
    }
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
      return 'SKIP_DUPLICATE';
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
    const resultToken = result === null || typeof result === 'undefined'
      ? 'null'
      : String(result);
    console.log(
      '[DIAG][SHORTS_REENTRY][HOST]',
      'action=requested',
      'reason=' + reason,
      'navId=' + navId,
      'url=' + toDiagUrl(activeUrl),
      'profileOrigin=' + String(isYouTubeProfileOrChannelShortsRoute(activeUrl)),
      'result=' + resultToken,
    );
    return resultToken;
  }, [isNative, webViewState.isOpen, webViewState.currentUrl, executeScript, toDiagUrl]);

  const forceFirstEntryShortsRequest = useCallback(async (
    reason: string,
    urlHint?: string,
  ): Promise<string> => {
    if (!isNative || !webViewState.isOpen || !executeScript) return 'SKIP_HOST';
    const activeUrl = urlHint || webViewState.currentUrl || currentUrlRef.current || '';
    // FREEZE-OVERRIDE: allow force-seed on profile/channel Shorts routes.
    if (!isHostActiveShortsLifecycleUrl(activeUrl)) return 'SKIP_NOT_SHORTS';
    const navId = activeNavIdRef.current || 0;
    const safeReason = escapeForJs(reason || 'host_force_first_entry');
    const result = await executeScript(`
      (function() {
        try {
          if (typeof window.__MW_FORCE_FIRST_ENTRY_REQUEST__ !== 'function') return 'NO_HOOK';
          return window.__MW_FORCE_FIRST_ENTRY_REQUEST__('${safeReason}');
        } catch (e) {
          return 'ERR:' + String(e);
        }
      })();
    `);
    const resultToken = result === null || typeof result === 'undefined'
      ? 'null'
      : String(result);
    console.warn(
      '[DIAG][SHORTS_REENTRY][HOST]',
      'action=force_first_entry_request',
      'reason=' + reason,
      'navId=' + navId,
      'url=' + toDiagUrl(activeUrl),
      'profileOrigin=' + String(isYouTubeProfileOrChannelShortsRoute(activeUrl)),
      'result=' + resultToken,
    );
    return resultToken;
  }, [isNative, webViewState.isOpen, webViewState.currentUrl, executeScript, toDiagUrl]);

  const isShortsScopedReqSatisfiedForEpoch = useCallback((
    epoch: number,
    urlHint?: string,
  ): boolean => {
    const activeUrl = urlHint || webViewState.currentUrl || currentUrlRef.current || '';
    // Pure /shorts/ID only — profile routes lack a stable video id in the path.
    if (!isYouTubeShortsUrl(activeUrl)) return false;
    const activeVideoId = getYouTubeShortsId(activeUrl);
    if (!activeVideoId || activeVideoId === 'none') return false;
    const scoped = shortsScopedReqSeenRef.current;
    if (!scoped) return false;
    return scoped.epoch === epoch && scoped.videoId === activeVideoId;
  }, [webViewState.currentUrl]);

  useEffect(() => {
    currentUrlRef.current = webViewState.currentUrl || '';
  }, [webViewState.currentUrl]);

  useEffect(() => {
    const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
    // FREEZE-OVERRIDE: treat profile/channel Shorts routes as lifecycle entry surface.
    const inShorts = isHostActiveShortsLifecycleUrl(activeUrl);
    const wasInShorts = shortsModeActiveRef.current;
    shortsModeActiveRef.current = inShorts;
    if (inShorts && !wasInShorts) {
      const entryReason = isYouTubeProfileOrChannelShortsRoute(activeUrl)
        ? 'shorts_entry_transition_profile_origin'
        : 'shorts_entry_transition';
      if (isYouTubeProfileOrChannelShortsRoute(activeUrl)) {
        console.warn(
          '[DIAG][SHORTS_REENTRY][HOST]',
          'action=profile_origin_entry_transition',
          'url=' + toDiagUrl(activeUrl),
        );
      }
      armShortsFirstEntryLatch(entryReason, activeUrl);
      const sinceLastReq = Date.now() - shortsLegacyFallbackRef.current.lastReqSentAt;
      if (sinceLastReq > SHORTS_LEGACY_FALLBACK_REQ_GRACE_MS) {
        armShortsLegacyFallbackProbe('shorts_entry_uncertain', SHORTS_LEGACY_FALLBACK_ENTRY_PROBE_MS);
      }
      if (markShortsFirstEntryReentryRequested(entryReason, activeUrl)) {
        void requestShortsReentryRefresh(entryReason, activeUrl, true)
          .then((resultToken) => {
            if (
              resultToken === 'null' ||
              resultToken === 'NO_HOOK' ||
              resultToken === 'SKIP' ||
              resultToken.startsWith('ERR')
            ) {
              if (markShortsFirstEntryForceRequested(entryReason + '_force_seed', activeUrl)) {
                void forceFirstEntryShortsRequest(entryReason + '_force_seed', activeUrl);
              }
            }
          })
          .catch(() => undefined);
      }
      return;
    }
    if (!inShorts && wasInShorts) {
      disarmShortsLegacyFallbackProbe('shorts_exit');
      disarmShortsFirstEntryLatch('shorts_exit');
      // FREEZE-OVERRIDE: host-side exit cleanup so frosted/white home after Shorts
      // is cleared even if inject SPA poll is delayed.
      if (executeScript) {
        void executeScript(`
          (function() {
            try {
              if (typeof window.__MW_SHORTS_EXIT_CLEANUP__ === 'function') {
                var r = window.__MW_SHORTS_EXIT_CLEANUP__('host_shorts_exit');
                return typeof r === 'string' ? r : JSON.stringify(r || {});
              }
              return 'NO_HOOK';
            } catch (e) {
              return 'ERR:' + String(e && e.message ? e.message : e);
            }
          })();
        `).then((result) => {
          console.log('[DIAG][SHORTS_EXIT][HOST] cleanup_result=' + String(result || 'null'));
        }).catch((error) => {
          console.warn('[DIAG][SHORTS_EXIT][HOST] cleanup_error', error);
        });
        // Second pass after YouTube finishes swapping the feed DOM.
        window.setTimeout(() => {
          if (!executeScript) return;
          void executeScript(`
            (function() {
              try {
                if (typeof window.__MW_SHORTS_EXIT_CLEANUP__ === 'function') {
                  return JSON.stringify(window.__MW_SHORTS_EXIT_CLEANUP__('host_shorts_exit_400ms') || {});
                }
                return 'NO_HOOK';
              } catch (e) {
                return 'ERR';
              }
            })();
          `).catch(() => undefined);
        }, 400);
        // FREEZE-OVERRIDE (lifecycle): third pass + home feed heal — top thumbs
        // often still painting after 400ms (void/frost residual bug).
        window.setTimeout(() => {
          if (!executeScript) return;
          void executeScript(`
            (function() {
              try {
                var out = {};
                if (typeof window.__MW_SHORTS_EXIT_CLEANUP__ === 'function') {
                  out.cleanup = window.__MW_SHORTS_EXIT_CLEANUP__('host_shorts_exit_1000ms') || {};
                }
                if (typeof window.__MW_HOME_FEED_HEAL__ === 'function') {
                  out.heal = window.__MW_HOME_FEED_HEAL__('host_shorts_exit_1000ms');
                }
                return JSON.stringify(out);
              } catch (e) {
                return 'ERR';
              }
            })();
          `).catch(() => undefined);
        }, 1000);
        window.setTimeout(() => {
          if (!executeScript) return;
          void executeScript(`
            (function() {
              try {
                if (typeof window.__MW_HOME_FEED_HEAL__ === 'function') {
                  return String(window.__MW_HOME_FEED_HEAL__('host_shorts_exit_1500ms') || 'NO_HOOK');
                }
                return 'NO_HOOK';
              } catch (e) {
                return 'ERR';
              }
            })();
          `).catch(() => undefined);
        }, 1500);
      }
    }
  }, [
    webViewState.currentUrl,
    armShortsLegacyFallbackProbe,
    disarmShortsLegacyFallbackProbe,
    armShortsFirstEntryLatch,
    disarmShortsFirstEntryLatch,
    markShortsFirstEntryReentryRequested,
    markShortsFirstEntryForceRequested,
    requestShortsReentryRefresh,
    forceFirstEntryShortsRequest,
    toDiagUrl,
    executeScript,
  ]);

  useEffect(() => {
    if (!webViewState.isOpen) return;
    const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
    if (!isHostActiveShortsLifecycleUrl(activeUrl)) return;
    const openReason = isYouTubeProfileOrChannelShortsRoute(activeUrl)
      ? 'webview_open_shorts_profile_origin'
      : 'webview_open_shorts';
    armShortsFirstEntryLatch(openReason, activeUrl);
    if (markShortsFirstEntryReentryRequested(openReason, activeUrl)) {
      void requestShortsReentryRefresh(openReason, activeUrl, false)
        .then((resultToken) => {
          if (
            resultToken === 'null' ||
            resultToken === 'NO_HOOK' ||
            resultToken === 'SKIP' ||
            resultToken.startsWith('ERR')
          ) {
            if (markShortsFirstEntryForceRequested(openReason + '_force_seed', activeUrl)) {
              void forceFirstEntryShortsRequest(openReason + '_force_seed', activeUrl);
            }
          }
        })
        .catch(() => undefined);
    }
  }, [
    webViewState.isOpen,
    webViewState.currentUrl,
    armShortsFirstEntryLatch,
    markShortsFirstEntryReentryRequested,
    markShortsFirstEntryForceRequested,
    requestShortsReentryRefresh,
    forceFirstEntryShortsRequest,
  ]);

  useEffect(() => {
    webViewListenersAttachedRef.current = webViewListenersAttached;
  }, [webViewListenersAttached]);

  useEffect(() => {
    executeScriptRef.current = executeScript;
  }, [executeScript]);

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

  // FREEZE-OVERRIDE (accuracy): push dial live into the active injection + flush
  // thr-keyed caches. Without this, MW_ALREADY_ACTIVE reinject left old thr and
  // Relaxed looked identical to Maximum.
  const lastAppliedDialRef = useRef<number | null>(null);
  useEffect(() => {
    if (!settingsLoaded || !isNative || !webViewState.isOpen || !executeScript) return;
    const level = localSettings.blur_dial;
    // Skip re-fire for the same level; reset when webview closes so reopen re-applies.
    if (lastAppliedDialRef.current === level) return;
    lastAppliedDialRef.current = level;
    moderationBridge.clearCache({
      reason: 'blur_dial_change_' + level,
      previousFamily: 'dial',
      nextFamily: 'dial_' + level,
    });
    void executeScript(`
      (function() {
        try {
          if (typeof window.__MW_APPLY_SENSITIVITY__ === 'function') {
            return window.__MW_APPLY_SENSITIVITY__(${level}, 'host_dial_slider');
          }
          window.postMessage({
            type: 'MW_BLUR_COMMAND',
            command: 'SET_SENSITIVITY',
            level: ${level},
            reason: 'host_dial_slider',
            timestamp: Date.now()
          }, '*');
          return 'POSTED';
        } catch (e) {
          return 'ERR:' + String(e && e.message ? e.message : e);
        }
      })();
    `).then((result) => {
      console.log(
        '[DIAG][DIAL]',
        'action=apply_sensitivity',
        'level=' + level,
        'result=' + String(result || 'null'),
      );
    }).catch((error) => {
      console.warn('[DIAG][DIAL] apply_sensitivity_error', error);
    });
  }, [
    settingsLoaded,
    isNative,
    webViewState.isOpen,
    executeScript,
    localSettings.blur_dial,
    // Intentionally omit moderationBridge object identity — only dial should re-fire.
    moderationBridge.clearCache,
  ]);

  useEffect(() => {
    if (!webViewState.isOpen) {
      lastAppliedDialRef.current = null;
    }
  }, [webViewState.isOpen]);

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

  // FREEZE-OVERRIDE (lifecycle): port of 1220acc9 forceWebViewRescan.
  // Prefer __MW_LIFECYCLE_RESCAN__ (HEAD) so soft-protect + dedupe clear stay intact.
  const forceWebViewRescan = useCallback(async (reason: string) => {
    if (!ENABLE_DOM_BLUR) return;
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    try {
      await requestLifecycleRescan(executeScript, 'force_rescan:' + reason);
      console.log(
        '[MW-Host][ForceRescan]',
        'reason=' + reason,
        'navId=' + activeNavIdRef.current,
      );
    } catch {
      /* next probe/heartbeat tick will retry */
    }
  }, [ENABLE_DOM_BLUR, isNative, webViewState.isOpen, executeScript, requestLifecycleRescan]);

  const flushBlurStateToWebView = useCallback(async () => {
    if (!ENABLE_DOM_BLUR) return;
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    if (!blurReadyRef.current) return;

    const pending = blurPendingRef.current || blurStateRef.current;
    const hostState = blurStateRef.current;
    console.log(
      '[DIAG][HOST_OVERLAY_FLUSH]',
      'overlayHostState=' + (hostState.enabled ? 'enabled' : 'disabled'),
      'overlayReason=' + hostState.reason,
      'flushEnabled=' + pending.enabled,
      'flushReason=' + pending.reason,
      'navId=' + activeNavIdRef.current,
      'pageEpoch=' + activePageEpochRef.current,
      'url=' + (webViewState.currentUrl || currentUrlRef.current || 'unknown'),
    );
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

  const probeInjectedScriptLiveness = useCallback(async (source: string): Promise<boolean> => {
    if (!isNative || !webViewState.isOpen || !executeScript) return false;
    const expectedEpoch = webViewPageEpochRef.current;
    const result = await executeScript(`
      (function() {
        try {
          var state = window.__MW_DEBUG__ && window.__MW_DEBUG__.state;
          var pageEpoch = state && Number.isFinite(Number(state.pageEpoch)) ? Number(state.pageEpoch) : null;
          return JSON.stringify({
            active: window.__MW_ACTIVE__ === true,
            hasSyncHook: typeof window.__MW_SYNC_HOST_CONTEXT__ === 'function',
            pageEpoch: pageEpoch,
            url: window.location.href
          });
        } catch (e) {
          return JSON.stringify({ active: false, error: String(e) });
        }
      })();
    `);
    try {
      const parsed = JSON.parse(String(result || '{}')) as {
        active?: boolean;
        hasSyncHook?: boolean;
        pageEpoch?: number | null;
        url?: string;
      };
      const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
      const verdict = getInjectionReadinessVerdict(
        {
          type: 'MW_INJECTED_ACK',
          pageEpoch: parsed.pageEpoch,
          url: parsed.url,
          timestamp: Date.now(),
        },
        {
          activeUrl,
          activePageEpoch: expectedEpoch,
        },
      );
      const alive = parsed.active === true && parsed.hasSyncHook === true && verdict.accepted;
      console.log(
        '[DIAG][INJECT] liveness_probe',
        'source=' + source,
        'alive=' + alive,
        'reason=' + verdict.reason,
        'active=' + String(parsed.active === true),
        'hasSyncHook=' + String(parsed.hasSyncHook === true),
        'pageEpoch=' + String(parsed.pageEpoch ?? 'none'),
        'expectedEpoch=' + expectedEpoch,
        'url=' + String(parsed.url || 'unknown'),
      );
      return alive;
    } catch {
      console.log('[DIAG][INJECT] liveness_probe_parse_error', 'source=' + source, 'result=' + String(result || 'null'));
      return false;
    }
  }, [isNative, webViewState.isOpen, webViewState.currentUrl, executeScript]);

  useEffect(() => {
    if (!ENABLE_DOM_BLUR) return;
    if (!isNative || !webViewState.isOpen) return;
    if (!blurReadyRef.current) return;
    flushBlurStateToWebView();
  }, [ENABLE_DOM_BLUR, blurSyncVersion, isNative, webViewState.isOpen, flushBlurStateToWebView]);

  // FREEZE-OVERRIDE (lifecycle): port ColdStartDriver from MVPCANDIDATE77 / 1220acc9.
  // Bounded heartbeat re-drives inject until blur handshake proves life (~15s cap).
  // Re-armed by recoveryNonce (foreground dead / refresh). Host-only; no sacred blur bodies.
  useEffect(() => {
    if (!ENABLE_SIGNAL_PIPELINE) return;
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    if (!settingsLoaded || !isRuntimeModerationEnabled || !webViewListenersAttached) return;

    let cancelled = false;
    let ticks = 0;
    if (ENABLE_DOM_BLUR) blurReadyRef.current = false;

    const tick = async () => {
      if (cancelled) return;
      if (blurReadyRef.current) return;
      if (ticks >= 12) return; // ~15s safety cap at 1.2s interval
      ticks += 1;

      let urlHint = webViewState.currentUrl || currentUrlRef.current || '';
      if (isBootstrapBlankUrl(urlHint)) {
        try {
          const raw = await executeScript(
            '(function(){try{return JSON.stringify(window.location.href);}catch(e){return "";}})();',
          );
          let real = '';
          try {
            real = String(JSON.parse(String(raw || '""')) || '');
          } catch {
            real = String(raw || '').replace(/^"|"$/g, '');
          }
          if (real && !isBootstrapBlankUrl(real)) urlHint = real;
        } catch {
          /* retry next tick */
        }
      }
      if (cancelled || isBootstrapBlankUrl(urlHint)) return;

      // Epoch-sync-only must not block a real injection attempt.
      injectionDoneRef.current = false;
      console.log(
        '[MW-Inject][ColdStartDriver]',
        'tick=' + ticks,
        'recoveryNonce=' + recoveryNonce,
        'navId=' + activeNavIdRef.current,
        'url=' + urlHint.substring(0, 80),
      );
      await injectModerationScript(executeScript, 'cold_start_driver', urlHint);
      if (ENABLE_DOM_BLUR) await requestBlurHandshake('cold_start_driver');
    };

    const timer = window.setInterval(() => {
      if (cancelled || blurReadyRef.current || ticks >= 12) {
        window.clearInterval(timer);
        return;
      }
      void tick();
    }, 1200);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    ENABLE_SIGNAL_PIPELINE,
    ENABLE_DOM_BLUR,
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    executeScript,
    settingsLoaded,
    isRuntimeModerationEnabled,
    webViewListenersAttached,
    injectModerationScript,
    requestBlurHandshake,
    recoveryNonce,
  ]);

  // FREEZE-OVERRIDE (lifecycle): P3 foreground / inactivity recovery (1220acc9).
  // Long background can purge WebView JS or restale YouTube DOM (~1h+ shelf-life bug).
  // Alive → lifecycle rescan; dead → recoveryNonce re-arms ColdStartDriver.
  useEffect(() => {
    if (!ENABLE_DOM_BLUR) return;
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    if (!settingsLoaded || !isRuntimeModerationEnabled || !webViewListenersAttached) return;

    const FOREGROUND_PROBE_TIMEOUT_MS = 1200;
    const FOREGROUND_RECOVERY_MIN_INTERVAL_MS = 4000;

    let probing = false;
    let cancelled = false;
    let lastProbeAt = 0;

    const probeAndRecover = async (trigger: string) => {
      if (cancelled || probing) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastProbeAt < FOREGROUND_RECOVERY_MIN_INTERVAL_MS) return;
      lastProbeAt = now;
      probing = true;
      try {
        // Prefer handshake proof of life (epoch can drift after long suspend).
        blurReadyRef.current = false;
        await requestBlurHandshake('foreground_liveness_probe:' + trigger);
        const deadline = Date.now() + FOREGROUND_PROBE_TIMEOUT_MS;
        while (!cancelled && !blurReadyRef.current && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (cancelled) return;

        if (blurReadyRef.current) {
          await forceWebViewRescan('foreground_alive:' + trigger);
          queueCurrentBlurState('host_visible_resync');
          await flushBlurStateToWebView();
        } else {
          // Fallback probe (sync hook + active flag) before declaring dead.
          const probeAlive = await probeInjectedScriptLiveness('foreground_fallback:' + trigger);
          if (probeAlive) {
            blurReadyRef.current = true;
            await forceWebViewRescan('foreground_probe_alive:' + trigger);
            return;
          }
          console.log(
            '[MW-Host][ForegroundRecovery] script_dead reinjecting',
            'trigger=' + trigger,
            'navId=' + activeNavIdRef.current,
          );
          resetInjectionReadiness('foreground_dead:' + trigger);
          setRecoveryNonce((n) => n + 1);
        }
      } finally {
        probing = false;
      }
    };

    const onVisible = () => {
      void probeAndRecover('visibilitychange');
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [
    ENABLE_DOM_BLUR,
    isNative,
    webViewState.isOpen,
    executeScript,
    settingsLoaded,
    isRuntimeModerationEnabled,
    webViewListenersAttached,
    requestBlurHandshake,
    forceWebViewRescan,
    queueCurrentBlurState,
    flushBlurStateToWebView,
    probeInjectedScriptLiveness,
    resetInjectionReadiness,
  ]);

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
    if (isBootstrapBlankUrl(urlHint)) {
      console.log(
        '[DIAG][CHURN_WINDOW]',
        'action=reinjectTimer_skip_bootstrap_blank',
        'reason=bootstrap_blank_active_url',
        'stack=NativeWebViewBrowser.reinjectTimer',
        'navId=' + activeNavIdRef.current,
        'url=' + urlHint,
      );
      return;
    }

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
    didColdStartModelFlushRef.current = false;
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

  // FREEZE-OVERRIDE (lifecycle): when NSFWJS becomes ready, flush inject scan
  // dedupe and force a full/YouTube rescan so cold-start thumbs get real verdicts.
  useEffect(() => {
    if (!ENABLE_SIGNAL_PIPELINE) return;
    if (!isNative || !webViewState.isOpen || !executeScript) return;
    if (!moderationBridge.isReady) {
      didColdStartModelFlushRef.current = false;
      return;
    }
    if (didColdStartModelFlushRef.current) return;
    const urlHint = webViewState.currentUrl || currentUrlRef.current || '';
    if (!urlHint || isBootstrapBlankUrl(urlHint)) return;
    if (!isYouTubeDomainUrl(urlHint) && !isYouTubeUrl(urlHint)) {
      // Still flush once per open when model becomes ready on any page.
    }
    didColdStartModelFlushRef.current = true;
    console.log(
      '[DIAG][COLD_START][HOST]',
      'action=model_ready_flush',
      'url=' + toDiagUrl(urlHint),
      'navId=' + activeNavIdRef.current,
    );
    void executeScript(`
      (function() {
        try {
          if (typeof window.__MW_COLD_START_FLUSH__ === 'function') {
            return String(window.__MW_COLD_START_FLUSH__('host_model_ready') || 'NO_HOOK');
          }
          if (typeof window.__MW_SCAN_FULL__ === 'function') window.__MW_SCAN_FULL__();
          if (typeof window.__MW_SCAN_YT__ === 'function') window.__MW_SCAN_YT__();
          return 'FALLBACK_SCAN';
        } catch (e) {
          return 'ERR:' + String(e && e.message ? e.message : e);
        }
      })();
    `).then((result) => {
      console.log('[DIAG][COLD_START][HOST] flush_result=' + String(result || 'null'));
    }).catch((error) => {
      console.warn('[DIAG][COLD_START][HOST] flush_error', error);
    });
  }, [
    ENABLE_SIGNAL_PIPELINE,
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    executeScript,
    moderationBridge.isReady,
    toDiagUrl,
  ]);

  useEffect(() => {
    if (!settingsLoaded || !isNative || !webViewState.isOpen || !executeScript) return;
    if (!isProtectionOff) return;

    didInjectAfterSettingsLoadedRef.current = false;
    resetInjectionReadiness('protection_off');
    blurPendingRef.current = null;
    blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
    setCentralBlurState(false, 'protection_off');

    let cancelled = false;
    const cleanupTimers: ReturnType<typeof setTimeout>[] = [];
    const runOffCleanup = (delayMs: number) => {
      if (cancelled) return;
      void executeScript(`
        (function() {
          try {
            if (typeof window.__MW_OFF_MODE_CLEANUP__ === 'function') {
              return window.__MW_OFF_MODE_CLEANUP__('host_protection_off_${delayMs}ms');
            }
            document.documentElement.classList.remove('mw-flash-shield-on');
            document.querySelectorAll('.mw-reveal-overlay,.mw-reveal-btn,#mw-reveal-portal,.mw-flash-shorts-overlay').forEach(function(node) {
              if (node && node.parentElement) node.parentElement.removeChild(node);
            });
            document.querySelectorAll('[data-mw-veil="1"]').forEach(function(node) {
              node.removeAttribute('data-mw-veil');
            });
            document.querySelectorAll('[data-mw-flash-frame="1"]').forEach(function(node) {
              node.removeAttribute('data-mw-flash-frame');
            });
            document.querySelectorAll('[data-mw-flash-positive="1"]').forEach(function(node) {
              node.removeAttribute('data-mw-flash-positive');
            });
            document.querySelectorAll('[data-mw-moderated],.mw-blurred,.mw-softblur,[data-mw-hard-blur="1"],[data-mw-has-overlay="true"]').forEach(function(node) {
              if (!node || node.nodeType !== 1) return;
              try {
                node.style.removeProperty('filter');
                node.style.removeProperty('-webkit-filter');
                node.style.removeProperty('backdrop-filter');
                node.style.removeProperty('-webkit-backdrop-filter');
                node.classList.remove('mw-blurred');
                node.classList.remove('mw-softblur');
                node.setAttribute('data-mw-moderated', 'safe');
                node.setAttribute('data-mw-has-overlay', 'false');
                node.removeAttribute('data-mw-hard-blur');
              } catch (e) {}
            });
            return 'OK_FALLBACK_OFF_CLEANUP';
          } catch (e) {
            return 'ERR:' + String(e);
          }
        })();
      `).then((result) => {
        console.log('[DIAG][OFF_MODE] cleanup_result=' + String(result || 'null') + ' delayMs=' + delayMs);
      }).catch((error) => {
        console.warn('[DIAG][OFF_MODE] cleanup_error', error);
      });
    };

    [0, 150, 500, 1000].forEach((delayMs) => {
      if (delayMs === 0) {
        runOffCleanup(delayMs);
        return;
      }
      cleanupTimers.push(setTimeout(() => runOffCleanup(delayMs), delayMs));
    });

    return () => {
      cancelled = true;
      cleanupTimers.forEach((timer) => clearTimeout(timer));
    };
  }, [
    settingsLoaded,
    isNative,
    webViewState.isOpen,
    executeScript,
    isProtectionOff,
    resetInjectionReadiness,
    setCentralBlurState,
  ]);

  useEffect(() => {
    if (!settingsLoaded || !isNative || !webViewState.isOpen || !executeScript) return;
    const enabled = isFlashShieldEnabled;
    void (async () => {
      const result = await executeScript(`
        (function() {
          try {
            if (typeof window.__MW_FLASH_SHIELD_SET__ === 'function') {
              return window.__MW_FLASH_SHIELD_SET__(${enabled ? 'true' : 'false'});
            }
            if (window.__MW_FLASH_BOOTSTRAP__ && typeof window.__MW_FLASH_BOOTSTRAP__.setEnabled === 'function') {
              window.__MW_FLASH_BOOTSTRAP__.setEnabled(${enabled ? 'true' : 'false'});
              return 'BOOTSTRAP_ONLY';
            }
            return 'NO_HOOK';
          } catch (e) {
            return 'ERR:' + String(e);
          }
        })();
      `);
      if (enabled && String(result || '').includes('NO_HOOK')) {
        await injectModerationScript(
          executeScript,
          'flash_shield_live_enable',
          webViewState.currentUrl || currentUrlRef.current || '',
        );
      }
    })();
  }, [
    settingsLoaded,
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    executeScript,
    injectModerationScript,
    isFlashShieldEnabled,
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
      pendingReinjectRef.current = null;
      if (shortsAckNoReqRecoverTimerRef.current) {
        clearTimeout(shortsAckNoReqRecoverTimerRef.current);
        shortsAckNoReqRecoverTimerRef.current = null;
      }
      disarmShortsFirstEntryLatch('component_unmount');
      if (blurRetryTimerRef.current) {
        clearTimeout(blurRetryTimerRef.current);
      }
    };
  }, [clearLoadEndInjectTimer, clearPendingReinjectTimer, disarmShortsFirstEntryLatch]);

  // ==================== MODERATION MESSAGE HANDLING ====================
  // 
  // We use a hybrid approach for WebView <-> Host communication:
  // 1. Primary: window.postMessage from WebView -> window.addEventListener('message') in host
  // 2. Fallback: Polling global queues via executeScript (for browsers that don't support postMessage)
  //
  // Host -> WebView: executeScript to call window.postMessage inside the page
  // ==================== 

  const pendingRequestsRef = useRef<Set<string>>(new Set());
  const moderationNavGenerationRef = useRef(0);
  const isGraceEpochAcceptedForActiveShortsVideo = useCallback((
    messageEpoch: number | null,
    activeEpoch: number,
    activeUrl: string,
    messageSovereignId?: string,
  ) => {
    if (messageEpoch === null) return true;
    // Profile-origin Shorts share active-Shorts epoch grace with pure /shorts.
    if (!isHostActiveShortsLifecycleUrl(activeUrl)) {
      return messageEpoch === activeEpoch;
    }

    const activeSovereign = parseSovereignId(
      getSovereignIdForContext(activeUrl, activeNavIdRef.current, activeEpoch),
    );
    const messageSovereign = parseSovereignId(messageSovereignId);
    const activeVideoId = activeSovereign.videoId;
    const messageVideoId = messageSovereign.videoId;
    const messageHasValidNav = Number.isFinite(messageSovereign.navId);
    const activeHasValidNav = Number.isFinite(activeSovereign.navId);

    if (messageEpoch === activeEpoch) {
      if (activeVideoId !== 'none' && messageVideoId !== 'none' && activeVideoId !== messageVideoId) {
        return false;
      }
      if (messageHasValidNav && activeHasValidNav && messageSovereign.navId !== activeSovereign.navId) {
        return false;
      }
      return true;
    }

    if (messageEpoch !== (activeEpoch - 1)) return false;
    return (
      activeVideoId !== 'none' &&
      messageVideoId !== 'none' &&
      activeVideoId === messageVideoId
    );
  }, []);

  const doesSovereignContextMatchWhenPresent = useCallback((
    requestSovereignId?: string,
    activeSovereignId?: string,
  ): boolean => {
    if (!requestSovereignId) return true;
    const requestSovereign = parseSovereignId(requestSovereignId);
    const activeSovereign = parseSovereignId(activeSovereignId);
    const requestNavKnown = Number.isFinite(requestSovereign.navId);
    const activeNavKnown = Number.isFinite(activeSovereign.navId);
    if (requestNavKnown && activeNavKnown && requestSovereign.navId !== activeSovereign.navId) {
      return false;
    }
    if (
      requestSovereign.videoId !== 'none' &&
      activeSovereign.videoId !== 'none' &&
      requestSovereign.videoId !== activeSovereign.videoId
    ) {
      return false;
    }
    return true;
  }, []);

  const isShortsMessageEligibleForFirstEntryState = useCallback((
    messageEpoch: number | null,
    activeEpoch: number,
    activeUrl: string,
    messageSovereignId?: string,
  ): boolean => {
    if (!isHostActiveShortsLifecycleUrl(activeUrl)) return false;
    if (messageEpoch === null || messageEpoch !== activeEpoch) return false;
    const activeSovereignId = getSovereignIdForContext(activeUrl, activeNavIdRef.current, activeEpoch);
    return doesSovereignContextMatchWhenPresent(messageSovereignId, activeSovereignId);
  }, [doesSovereignContextMatchWhenPresent]);
  
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
    const requestSovereignId = typeof request.sovereignId === 'string' ? request.sovereignId : '';
    const activeEpoch = webViewPageEpochRef.current;
    const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
    const activeSovereignId = getSovereignIdForContext(activeUrl, activeNavIdRef.current, activeEpoch);
    const stickyShortsMode = isHostActiveShortsLifecycleUrl(activeUrl);
    const relaxedYouTubeEpochMode = isYouTubeDomainUrl(activeUrl) && !stickyShortsMode;
    const isActiveEpochRequest = isGraceEpochAcceptedForActiveShortsVideo(
      requestEpoch,
      activeEpoch,
      activeUrl,
      requestSovereignId,
    );
    const isWithinRelaxedEpochWindow = (
      requestEpoch !== null &&
      (requestEpoch === activeEpoch || requestEpoch === (activeEpoch - 1))
    );
    const sovereignMatchesActiveWhenPresent = doesSovereignContextMatchWhenPresent(
      requestSovereignId,
      activeSovereignId,
    );
    const guardedRelaxedEpochBypassAllowed = (
      relaxedYouTubeEpochMode &&
      isWithinRelaxedEpochWindow &&
      sovereignMatchesActiveWhenPresent &&
      relaxedEpochBypassHookStableRef.current
    );
    const requestNavIdAtStart = activeNavIdRef.current || 0;
    const requestGenerationAtStart = moderationNavGenerationRef.current;
    
    if (pendingRequestsRef.current.has(requestId)) {
      console.log('[MW-Host] Duplicate request ignored:', requestId);
      return;
    }
    pendingRequestsRef.current.add(requestId);

    const isRequestContextStale = () => {
      const liveNavId = activeNavIdRef.current || 0;
      const liveGeneration = moderationNavGenerationRef.current;
      return (
        !pendingRequestsRef.current.has(requestId) ||
        liveNavId !== requestNavIdAtStart ||
        liveGeneration !== requestGenerationAtStart
      );
    };
    const hardKillStaleRequest = (stage: string): boolean => {
      if (!isRequestContextStale()) return false;
      const liveNavId = activeNavIdRef.current || 0;
      const liveGeneration = moderationNavGenerationRef.current;
      const wasPending = pendingRequestsRef.current.delete(requestId);
      console.warn(
        '[DIAG][SHORTS_ATOMIC]',
        'action=hard_kill_stale_request',
        'stage=' + stage,
        'requestId=' + requestId,
        'requestNavId=' + requestNavIdAtStart,
        'activeNavId=' + liveNavId,
        'requestGeneration=' + requestGenerationAtStart,
        'activeGeneration=' + liveGeneration,
        'wasPending=' + (wasPending ? 'true' : 'false'),
        'url=' + (webViewState.currentUrl || currentUrlRef.current || 'unknown'),
      );
      clearTimeout(timeoutId);
      setFlashGuardState?.(false, 'moderation_hard_kill_stale');
      flashLog('disarm hard-killed stale request');
      return true;
    };
    if (hardKillStaleRequest('after_add')) {
      return;
    }

    if (requestEpoch !== null && !isActiveEpochRequest && !guardedRelaxedEpochBypassAllowed) {
      const rejectReason = stickyShortsMode
        ? 'request_epoch_mismatch_shorts_strict'
        : (relaxedYouTubeEpochMode
          ? 'request_epoch_mismatch_youtube_guarded_blocked'
          : 'request_epoch_mismatch_non_youtube');
      console.warn(
        '[DIAG][EPOCH_BYPASS]',
        'epoch_bypass_blocked',
        'reason=' + rejectReason,
        'navId=' + activeNavIdRef.current,
        'requestPageEpoch=' + requestEpoch,
        'currentPageEpoch=' + activeEpoch,
        'withinWindow=' + isWithinRelaxedEpochWindow,
        'sovereignMatch=' + sovereignMatchesActiveWhenPresent,
        'hookStable=' + relaxedEpochBypassHookStableRef.current,
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
    if (stickyShortsMode && requestSovereignId && requestSovereignId !== activeSovereignId) {
      const requestSovereign = parseSovereignId(requestSovereignId);
      const activeSovereign = parseSovereignId(activeSovereignId);
      const navIdChanged = requestSovereign.navId !== activeSovereign.navId;
      if (navIdChanged) {
        console.warn(
          '[DIAG][SHORTS_ATOMIC]',
          'action=hard_kill_stale_request_nav_mismatch',
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
        pendingRequestsRef.current.delete(requestId);
        clearTimeout(timeoutId);
        setFlashGuardState?.(false, 'moderation_sovereign_nav_stale');
        flashLog('disarm stale nav mismatch');
        shortsLegacyFallbackRef.current.lastReqSentAt = 0;
        void requestShortsReentryRefresh('hard_kill_nav_mismatch_recover', activeUrl, true)
          .then((resultToken) => {
            if (
              resultToken === 'null' ||
              resultToken === 'NO_HOOK' ||
              resultToken === 'SKIP' ||
              resultToken.startsWith('ERR')
            ) {
              if (markShortsFirstEntryForceRequested(
                'hard_kill_nav_mismatch_force_seed',
                activeUrl,
                { allowRetry: true },
              )) {
                void forceFirstEntryShortsRequest('hard_kill_nav_mismatch_force_seed', activeUrl);
              }
            }
          })
          .catch(() => undefined);
        armShortsLegacyFallbackProbe(
          'hard_kill_nav_mismatch_recover',
          SHORTS_LEGACY_FALLBACK_ENTRY_PROBE_MS,
        );
        return;
      }
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
        const staleMessage = createResultMessage(requestId, staleResults, nonce, requestEpoch ?? undefined);
        await postMessageToWebView(staleMessage as unknown as Record<string, unknown>);
      } catch {
        // Fail-open by design for stale requests.
      }
      pendingRequestsRef.current.delete(requestId);
      clearTimeout(timeoutId);
      setFlashGuardState?.(false, 'moderation_sovereign_stale');
      flashLog('disarm stale sovereign');
      return;
    }
    if (requestEpoch !== null && requestEpoch !== activeEpoch && guardedRelaxedEpochBypassAllowed) {
      console.log(
        '[DIAG][EPOCH_BYPASS]',
        'epoch_bypass_allowed',
        'reason=request_epoch_mismatch_youtube_guarded',
        'navId=' + activeNavIdRef.current,
        'requestPageEpoch=' + requestEpoch,
        'currentPageEpoch=' + activeEpoch,
        'withinWindow=' + isWithinRelaxedEpochWindow,
        'sovereignMatch=' + sovereignMatchesActiveWhenPresent,
        'hookStable=' + relaxedEpochBypassHookStableRef.current,
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
      sourceType?: string;
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
      if (hardKillStaleRequest('scan_loop_pre_item:' + String(item.itemId || 'none'))) {
        return;
      }
      try {
        const scanResult = await moderationBridge.scanImage(item.src, thresholds, {
          requestId,
          itemId: item.itemId,
          navId: activeNavIdRef.current,
          pageEpoch: requestEpoch ?? activeEpoch,
          sourceType: item.sourceType,
        });
        
        if (scanResult) {
          const decisionReason = scanResult.decisionReason || scanResult.reason;
          const isActiveShortsVideoFrame = stickyShortsMode && item.sourceType === 'video-frame';
          const isUnknownInputNoPixels = decisionReason === 'unknown_input_no_pixels' || scanResult.reason === 'unknown_input';
          // FREEZE-OVERRIDE (accuracy): do NOT force-hard-blur empty/uncertain Shorts frames.
          // That was a major sticky FP source (safe content blurred until swipe-away).
          // Signal provisional category so inject schedules frame retry without host-OR hard blur.
          const isShortsUncertainSample = isActiveShortsVideoFrame && isUnknownInputNoPixels;
          const categoryConfidence = Object.entries(scanResult.predictions || {}).reduce((matched, [label, value]) => {
            if (matched >= 0) return matched;
            return label.toLowerCase() === scanResult.category.toLowerCase() ? value : -1;
          }, -1);
          const effectiveConfidence = categoryConfidence >= 0 ? categoryConfidence : scanResult.confidence;
          const finalShouldBlur = isShortsUncertainSample ? false : scanResult.shouldBlur;
          const finalCategory = isShortsUncertainSample ? 'shorts_uncertain_input' : scanResult.category;
          const finalSeverity: ModerationSeverity = isShortsUncertainSample
            ? 'safe'
            : (scanResult.severity || mapModerationCategoryToSeverity(scanResult.category));
          const finalConfidence = isShortsUncertainSample ? 0 : effectiveConfidence;
          const finalDecisionReason = isShortsUncertainSample
            ? 'shorts_uncertain_no_force_blur:' + String(decisionReason || 'unknown')
            : decisionReason;

          if (isShortsUncertainSample) {
            console.log(
              '[MW-Host][ShortsUncertain]',
              'itemId=' + item.itemId,
              'sourceType=' + String(item.sourceType || 'unknown'),
              'reason=' + String(decisionReason || 'unknown'),
              'action=no_force_blur_retry',
            );
          }
          results.push({
            itemId: item.itemId,
            src: item.src,
            sourceType: item.sourceType,
            shouldBlur: finalShouldBlur,
            category: finalCategory,
            confidence: finalConfidence,
            severity: finalSeverity,
            predictions: scanResult.predictions,
            model_version: scanResult.modelVersion,
            thresholds: scanResult.thresholdsUsed,
            decision_reason: finalDecisionReason,
            image_width: typeof scanResult.diagnostics?.imageWidth === 'number' ? scanResult.diagnostics.imageWidth : item.width,
            image_height: typeof scanResult.diagnostics?.imageHeight === 'number' ? scanResult.diagnostics.imageHeight : item.height,
            host: typeof scanResult.diagnostics?.host === 'string' ? scanResult.diagnostics.host : (() => {
              try { return new URL(item.src).hostname; } catch { return undefined; }
            })(),
            ts: Date.now(),
            diagnostics: scanResult.diagnostics,
          });
          console.log('[MW-Host] scan result', item.itemId, ':', finalCategory, 'blur=' + finalShouldBlur, 'conf=' + finalConfidence.toFixed(3));
        } else {
          // FREEZE-OVERRIDE (accuracy): Shorts scan miss → fail-open + retry, not force blur FP.
          const isShortsFrameMiss = stickyShortsMode && item.sourceType === 'video-frame';
          const shouldBlurOnFailure = localSettings.fail_closed === true;
          const finalShouldBlur = isShortsFrameMiss ? false : shouldBlurOnFailure;
          const finalCategory = isShortsFrameMiss
            ? 'shorts_scan_miss_uncertain'
            : (shouldBlurOnFailure ? 'error_fail_closed' : 'error');
          const finalConfidence = isShortsFrameMiss
            ? 0
            : (shouldBlurOnFailure ? 1 : 0);
          const finalSeverity: ModerationSeverity = isShortsFrameMiss
            ? 'safe'
            : (shouldBlurOnFailure ? 'hard' : 'safe');
          const finalDecisionReason = isShortsFrameMiss
            ? 'shorts_scan_miss_no_force_blur'
            : undefined;
          if (isShortsFrameMiss) {
            console.log(
              '[MW-Host][ShortsUncertain]',
              'itemId=' + item.itemId,
              'sourceType=' + String(item.sourceType || 'unknown'),
              'reason=no_scan_result',
              'action=no_force_blur_retry',
            );
          }
          results.push({
            itemId: item.itemId,
            src: item.src,
            sourceType: item.sourceType,
            shouldBlur: finalShouldBlur,
            category: finalCategory,
            confidence: finalConfidence,
            severity: finalSeverity,
            decision_reason: finalDecisionReason,
          });
          console.log('[MW-Host] scan result', item.itemId, ':', finalCategory, 'blur=' + finalShouldBlur);
        }
        if (hardKillStaleRequest('scan_loop_post_item:' + String(item.itemId || 'none'))) {
          return;
        }
      } catch (error) {
        // FREEZE-OVERRIDE (accuracy): Shorts scan error → fail-open + retry, not force blur FP.
        const isShortsFrameErr = stickyShortsMode && item.sourceType === 'video-frame';
        const shouldBlurOnFailure = localSettings.fail_closed === true;
        const finalShouldBlur = isShortsFrameErr ? false : shouldBlurOnFailure;
        const finalCategory = isShortsFrameErr
          ? 'shorts_scan_error_uncertain'
          : (shouldBlurOnFailure ? 'error_fail_closed' : 'error');
        const finalConfidence = isShortsFrameErr
          ? 0
          : (shouldBlurOnFailure ? 1 : 0);
        const finalSeverity: ModerationSeverity = isShortsFrameErr
          ? 'safe'
          : (shouldBlurOnFailure ? 'hard' : 'safe');
        const finalDecisionReason = isShortsFrameErr
          ? 'shorts_scan_error_no_force_blur'
          : undefined;
        console.log('[MW-Host] scan error', item.itemId, ':', error);
        if (isShortsFrameErr) {
          console.log(
            '[MW-Host][ShortsUncertain]',
            'itemId=' + item.itemId,
            'sourceType=' + String(item.sourceType || 'unknown'),
            'reason=scan_error',
            'action=no_force_blur_retry',
          );
        }
        results.push({
          itemId: item.itemId,
          src: item.src,
          sourceType: item.sourceType,
          shouldBlur: finalShouldBlur,
          category: finalCategory,
          confidence: finalConfidence,
          severity: finalSeverity,
          decision_reason: finalDecisionReason,
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
    const shortsAnyShouldBlurHit = stickyShortsMode && eligibleResults.some(item => item.shouldBlur);
    const nonShortsMainThumbAnyShouldBlurHit = (() => {
      if (stickyShortsMode) return false;
      try {
        const parsed = new URL(currentUrl || '');
        const host = parsed.hostname.toLowerCase();
        const path = parsed.pathname || '/';
        const isMYouTube = host === 'm.youtube.com';
        const isMainSurface = path === '/' || path.startsWith('/results') || path.startsWith('/feed');
        if (!isMYouTube || !isMainSurface || isYouTubeShortsUrl(currentUrl)) return false;
      } catch {
        return false;
      }
      return eligibleResults.some(item => {
        if (!item.shouldBlur) return false;
        const sourceType = String(item.sourceType || '').toLowerCase();
        return sourceType === '' || sourceType === 'img' || sourceType === 'video-poster';
      });
    })();

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
    } else if (shortsAnyShouldBlurHit) {
      overlayDecision = true;
      decisionReason = 'shorts_item_blur_hit';
    } else if (nonShortsMainThumbAnyShouldBlurHit) {
      decisionReason = 'main_page_item_blur_hit';
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

    const shouldTreatAsUnsafe = hardOverlayDecision || shortsAnyShouldBlurHit;
    // Preserve existing hard-only behavior outside Shorts; Shorts treat any shouldBlur hit as unsafe.
    if (shouldTreatAsUnsafe) {
      const unsafeReason = hardOverlayDecision
        ? `moderation_request_hard:${decisionReason}`
        : (shortsAnyShouldBlurHit
          ? 'moderation_request_shorts_item_blur'
          : 'moderation_request_non_shorts_hard');
      processModerationSafetySignal(true, unsafeReason);
    } else {
      processModerationSafetySignal(false, 'moderation_request_no_hard');
    }

    // Optional strict mode: temporary page-level soft confirmation (no hysteresis stickiness).
    if (!shouldTreatAsUnsafe) {
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
      'mainThumbAnyShouldBlur=' + nonShortsMainThumbAnyShouldBlurHit,
      'domOverlay=' + (ENABLE_DOM_BLUR ? 'on' : 'off'),
      'epoch=' + (requestEpoch ?? activeEpoch),
    );
    if (hardKillStaleRequest('pre_post_results')) {
      return;
    }
    
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
    doesSovereignContextMatchWhenPresent,
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
        const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
        const ackUrl = String(typedMessage.url || activeUrl || '');
        if (isBootstrapBlankUrl(ackUrl)) {
          console.log(
            '[DIAG][INJECT] ack_ignored_bootstrap_blank',
            'source=' + source,
            'navId=' + String(typedMessage.navId ?? 'none'),
            'pageEpoch=' + String(typedMessage.pageEpoch ?? 'none'),
            'url=' + String(typedMessage.url ?? 'unknown'),
          );
          return;
        }
        nonBootstrapAckObservedRef.current = true;
        const ackEpoch = (
          typeof typedMessage.pageEpoch === 'number' && Number.isFinite(typedMessage.pageEpoch)
        ) ? Number(typedMessage.pageEpoch) : null;
        const activeEpoch = webViewPageEpochRef.current;
        if (ackEpoch !== null && ackEpoch === activeEpoch) {
          epochContextCurrentRef.current = true;
        }
        relaxedEpochBypassHookStableRef.current =
          nonBootstrapAckObservedRef.current && epochContextCurrentRef.current;
        const readinessVerdict = getInjectionReadinessVerdict(typedMessage, {
          activeUrl,
          activePageEpoch: activeEpoch,
        });
        if (readinessVerdict.accepted) {
          injectionDoneRef.current = true;
          lastInjectedUrlRef.current = activeUrl;
          lastInjectionAtRef.current = Date.now();
          exitPendingReinject('readiness_ack', activeUrl);
          // FREEZE-OVERRIDE (lifecycle): first-entry ACK often arrives before thumbs
          // paint; burst rescan closes cold YouTube "no blur" window.
          if (executeScript) {
            scheduleLifecycleRescanBurst(executeScript, 'ack_accepted');
          }
        }
        console.log(
          '[MW-Host][ACK] MW_INJECTED_ACK',
          'source=' + source,
          'navId=' + String(typedMessage.navId ?? 'none'),
          'pageEpoch=' + String(typedMessage.pageEpoch ?? 'none'),
          'noncePrefix=' + String(typedMessage.noncePrefix ?? 'none'),
          'hookStable=' + relaxedEpochBypassHookStableRef.current,
          'readiness=' + readinessVerdict.reason,
          'injectionDone=' + String(injectionDoneRef.current),
          'url=' + String(typedMessage.url ?? 'unknown'),
        );
        console.log(
          '[DIAG][INJECT] ack_received',
          'source=' + source,
          'navId=' + String(typedMessage.navId ?? 'none'),
          'pageEpoch=' + String(typedMessage.pageEpoch ?? 'none'),
          'url=' + String(typedMessage.url ?? 'unknown'),
        );
        if (isYouTubeShortsUrl(ackUrl) && ackEpoch !== null && ackEpoch === activeEpoch) {
          armShortsFirstEntryLatch('ack_received', ackUrl);
          if (shortsAckNoReqRecoverTimerRef.current) {
            clearTimeout(shortsAckNoReqRecoverTimerRef.current);
            shortsAckNoReqRecoverTimerRef.current = null;
          }
          shortsAckNoReqRecoverTimerRef.current = setTimeout(() => {
            void (async () => {
            const latestUrl = webViewState.currentUrl || currentUrlRef.current || '';
            const latestEpoch = webViewPageEpochRef.current;
            if (!isYouTubeShortsUrl(latestUrl)) return;
            if (latestEpoch !== ackEpoch) return;
            if (
              shortsReqSeenEpochRef.current === ackEpoch &&
              isShortsScopedReqSatisfiedForEpoch(ackEpoch, latestUrl)
            ) {
              return;
            }
            if (shortsAckNoReqRecoverEpochRef.current === ackEpoch) return;
            shortsAckNoReqRecoverEpochRef.current = ackEpoch;
            shortsLegacyFallbackRef.current.lastReqSentAt = 0;
            console.warn(
              '[DIAG][SHORTS_REENTRY][HOST]',
              'action=ack_no_req_recover',
              'reason=ack_without_active_epoch_req',
              'navId=' + activeNavIdRef.current,
              'pageEpoch=' + ackEpoch,
              'scopedReqSeen=' + isShortsScopedReqSatisfiedForEpoch(ackEpoch, latestUrl),
              'url=' + (latestUrl || 'unknown'),
            );
            let reentryResult = 'SKIP_LATCH';
            if (markShortsFirstEntryReentryRequested('first_entry_ack_no_req', latestUrl)) {
              reentryResult = await requestShortsReentryRefresh('first_entry_ack_no_req', latestUrl, true);
            }
            if (
              reentryResult === 'SKIP_LATCH' ||
              reentryResult === 'null' ||
              reentryResult === 'NO_HOOK' ||
              reentryResult === 'SKIP' ||
              reentryResult.startsWith('ERR')
            ) {
              if (markShortsFirstEntryForceRequested(
                'ack_no_req_force_seed',
                latestUrl,
                { allowRetry: true },
              )) {
                await forceFirstEntryShortsRequest('ack_no_req_force_seed', latestUrl);
              }
            }
            armShortsLegacyFallbackProbe('first_entry_ack_no_req', SHORTS_LEGACY_FALLBACK_ENTRY_PROBE_MS);
            })();
          }, SHORTS_ACK_NO_REQ_RECOVER_DELAY_MS);
        }
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
        const isShortsFirstEntryEligible = isShortsMessageEligibleForFirstEntryState(
          messageEpoch,
          activeEpoch,
          activeUrl,
          messageSovereignId,
        );
        if (isYouTubeShortsUrl(activeUrl) && isActiveEpochMessage) {
          if (isShortsFirstEntryEligible) {
            const activeVideoId = getYouTubeShortsId(activeUrl);
            const messageVideoId = parseSovereignId(messageSovereignId).videoId;
            if (
              activeVideoId !== 'none' &&
              messageVideoId !== 'none' &&
              activeVideoId === messageVideoId
            ) {
              shortsScopedReqSeenRef.current = {
                epoch: activeEpoch,
                videoId: activeVideoId,
                at: Date.now(),
              };
              disarmShortsFirstEntryLatch('scoped_req_sent');
            }
            shortsReqSeenEpochRef.current = activeEpoch;
            shortsLegacyFallbackRef.current.lastReqSentAt = Date.now();
            disarmShortsLegacyFallbackProbe('req_sent');
          } else {
            const activeSovereignId = getSovereignIdForContext(activeUrl, activeNavIdRef.current, activeEpoch);
            const parsedMessageSovereign = parseSovereignId(messageSovereignId);
            const parsedActiveSovereign = parseSovereignId(activeSovereignId);
            console.log(
              '[DIAG][SHORTS_FIRST_ENTRY_GATE]',
              'action=ignore_req_sent_for_latch',
              'messageEpoch=' + String(messageEpoch ?? 'none'),
              'activeEpoch=' + String(activeEpoch),
              'messageNavId=' + String(parsedMessageSovereign.navId ?? 'none'),
              'activeNavId=' + String(parsedActiveSovereign.navId ?? 'none'),
              'messageVideoId=' + String(parsedMessageSovereign.videoId || 'none'),
              'activeVideoId=' + String(parsedActiveSovereign.videoId || 'none'),
              'url=' + (activeUrl || 'unknown'),
            );
          }
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

      if (ENABLE_DOM_BLUR && isBlurOverlayReadyMessage(message)) {
        const activeUrl = webViewState.currentUrl || currentUrlRef.current || '';
        const readyUrl = String(typedMessage.url || activeUrl || '');
        if (isBootstrapBlankUrl(readyUrl)) {
          console.log(
            '[MW-Host] Blur overlay READY: bootstrap_blank_ignore',
            String(typedMessage.reason || 'ready'),
            readyUrl,
          );
          return;
        }
        const shortsReadyContext =
          isHostActiveShortsLifecycleUrl(activeUrl) || isHostActiveShortsLifecycleUrl(readyUrl);
        if (shortsReadyContext) {
          const readyKey = [
            String(activeNavIdRef.current),
            String(webViewPageEpochRef.current),
            getYouTubeShortsId(readyUrl || activeUrl),
          ].join('|');
          const now = Date.now();
          const prevReady = blurReadyDedupeRef.current;
          if (prevReady.key === readyKey && (now - prevReady.at) < SHORTS_READY_DEDUPE_WINDOW_MS) {
            console.log('[MW-Host] Blur overlay READY: duplicate_skip', String(typedMessage.reason || 'ready'), readyUrl);
            return;
          }
          blurReadyDedupeRef.current = { key: readyKey, at: now };

          const readyReason = String(typedMessage.reason || '').toLowerCase();
          const skipNoReqRecovery = SHORTS_READY_BOOTSTRAP_REASONS.has(readyReason);
          const sinceLastReq = Date.now() - shortsLegacyFallbackRef.current.lastReqSentAt;
          if (!skipNoReqRecovery && sinceLastReq > SHORTS_LEGACY_FALLBACK_REQ_GRACE_MS) {
            if (markShortsFirstEntryReentryRequested('blur_ready_without_req', readyUrl || activeUrl)) {
              void requestShortsReentryRefresh('blur_ready_without_req', readyUrl || activeUrl, false);
            }
            armShortsLegacyFallbackProbe('blur_ready_without_req', SHORTS_LEGACY_FALLBACK_ENTRY_PROBE_MS);
          }
        }
        const readinessVerdict = getInjectionReadinessVerdict(typedMessage, {
          activeUrl,
          activePageEpoch: webViewPageEpochRef.current,
        });
        if (readinessVerdict.accepted) {
          injectionDoneRef.current = true;
          lastInjectedUrlRef.current = activeUrl;
          lastInjectionAtRef.current = Date.now();
          exitPendingReinject('readiness_blur_ready', activeUrl);
        }
        blurReadyRef.current = true;
        console.log(
          '[MW-Host] Blur overlay READY:',
          String(typedMessage.reason || 'ready'),
          String(typedMessage.url || ''),
          'readiness=' + readinessVerdict.reason,
          'injectionDone=' + String(injectionDoneRef.current),
        );
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
        const isShortsFirstEntryEligible = isShortsMessageEligibleForFirstEntryState(
          messageEpoch,
          activeEpoch,
          activeUrl,
          message.sovereignId,
        );
        if (isYouTubeShortsUrl(activeUrl) && isActiveEpochMessage) {
          if (isShortsFirstEntryEligible) {
            const activeVideoId = getYouTubeShortsId(activeUrl);
            const messageVideoId = parseSovereignId(message.sovereignId).videoId;
            if (
              activeVideoId !== 'none' &&
              messageVideoId !== 'none' &&
              activeVideoId === messageVideoId
            ) {
              shortsScopedReqSeenRef.current = {
                epoch: activeEpoch,
                videoId: activeVideoId,
                at: Date.now(),
              };
              disarmShortsFirstEntryLatch('scoped_request_received');
            }
            shortsReqSeenEpochRef.current = activeEpoch;
            shortsLegacyFallbackRef.current.lastReqSentAt = Date.now();
            disarmShortsLegacyFallbackProbe('request_received');
          } else {
            const activeSovereignId = getSovereignIdForContext(activeUrl, activeNavIdRef.current, activeEpoch);
            const parsedMessageSovereign = parseSovereignId(message.sovereignId);
            const parsedActiveSovereign = parseSovereignId(activeSovereignId);
            console.log(
              '[DIAG][SHORTS_FIRST_ENTRY_GATE]',
              'action=ignore_request_for_latch',
              'messageEpoch=' + String(messageEpoch ?? 'none'),
              'activeEpoch=' + String(activeEpoch),
              'messageNavId=' + String(parsedMessageSovereign.navId ?? 'none'),
              'activeNavId=' + String(parsedActiveSovereign.navId ?? 'none'),
              'messageVideoId=' + String(parsedMessageSovereign.videoId || 'none'),
              'activeVideoId=' + String(parsedActiveSovereign.videoId || 'none'),
              'url=' + (activeUrl || 'unknown'),
            );
          }
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
    moderationBridge,
    postMessageToWebView,
    getNonce,
    queueCurrentBlurState,
    flushBlurStateToWebView,
    requestShortsReentryRefresh,
    forceFirstEntryShortsRequest,
    isShortsScopedReqSatisfiedForEpoch,
    armShortsLegacyFallbackProbe,
    disarmShortsLegacyFallbackProbe,
    armShortsFirstEntryLatch,
    disarmShortsFirstEntryLatch,
    markShortsFirstEntryReentryRequested,
    markShortsFirstEntryForceRequested,
    isGraceEpochAcceptedForActiveShortsVideo,
    isShortsMessageEligibleForFirstEntryState,
    webViewState.currentUrl,
  ]);

  /**
   * Fallback: Poll for moderation requests from legacy global queue
   * This is used when postMessage doesn't work reliably
   */
  useEffect(() => {
    if (!ENABLE_SIGNAL_PIPELINE || !isNative || !webViewState.isOpen || !shouldInjectModeration) {
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
    const stickyShortsMode = isHostActiveShortsLifecycleUrl(activeUrl);
    const isNonShortsYouTubeContext = isYouTubeDomainUrl(activeUrl) && !stickyShortsMode;
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
      const runScript = executeScriptRef.current;
      if (!runScript) return false;
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
        
        const result = await runScript(getQueueScript);
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
              await runScript(pushResultScript);
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
    shouldInjectModeration,
    moderationBridge,
    localSettings.blur_strength_px,
    webViewState.currentUrl,
    shortsLegacyFallbackVersion,
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
      // FREEZE-OVERRIDE (lifecycle): P4 refresh recovery (1220acc9) + life1 no-pre-teardown.
      // Refs alone are not reactive — recoveryNonce re-arms ColdStartDriver after reload.
      resetInjectionReadiness('manual_reload_preflight');
      blurSignalRef.current = { unsafeStreak: 0, safeStreak: 0 };
      setFlashGuardState?.(true, 'manual_reload_preflight');
      console.log(
        '[DIAG][LIFECYCLE][HOST]',
        'action=manual_reload',
        'recoveryNonce_bump=1',
        'url=' + toDiagUrl(webViewState.currentUrl || currentUrlRef.current || ''),
        'navId=' + activeNavIdRef.current,
      );
      await webViewReload();
      // After reload document is empty of inject — re-arm heartbeat even if onLoadStart races.
      injectionDoneRef.current = false;
      blurReadyRef.current = false;
      setRecoveryNonce((n) => n + 1);
      return;
    }
  }, [
    readerContent,
    currentView,
    searchQuery,
    isNative,
    webViewState.isOpen,
    webViewState.currentUrl,
    handleReaderMode,
    handleSearch,
    webViewReload,
    resetInjectionReadiness,
    setFlashGuardState,
    toDiagUrl,
  ]);

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
    resetInjectionReadiness('home_reset');
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
  }, [isNative, webViewState.isOpen, webViewState.currentUrl, closeWebView, goHome, moderationBridge, setCentralBlurState, teardownWebViewScheduling, exitPendingReinject, resetInjectionReadiness]);

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
