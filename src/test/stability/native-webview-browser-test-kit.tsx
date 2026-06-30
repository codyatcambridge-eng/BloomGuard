import React from 'react';
import { vi } from 'vitest';

export const nativeBrowserHarness = vi.hoisted(() => {
  const executeScriptCalls: string[] = [];
  const postMessageCalls: unknown[] = [];
  const clearCacheCalls: unknown[] = [];
  const refreshClicks: string[] = [];
  const lifecycleLog: string[] = [];

  const nativeState = {
    isOpen: true,
    currentUrl: 'https://www.youtube.com/watch?v=initial',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    error: null as string | null,
  };

  const browserHeaderProps = { current: null as any };
  const nativeOptions = { current: null as any };

  const reload = vi.fn(async () => {
    lifecycleLog.push('reload:start');
    const beforeReload = nativeOptions.current?.onBeforeReload;
    if (typeof beforeReload === 'function') {
      lifecycleLog.push('reload:preflight');
      await beforeReload(nativeState.currentUrl);
    }
    lifecycleLog.push('reload:done');
    nativeState.isLoading = true;
  });

  const executeScript = vi.fn(async (script: string) => {
    executeScriptCalls.push(script);
    return 'OK';
  });

  const postMessageToWebView = vi.fn(async (detail: Record<string, unknown>) => {
    postMessageCalls.push(detail);
    return true;
  });

  const clearCache = vi.fn((payload: unknown) => {
    clearCacheCalls.push(payload);
  });

  const reset = () => {
    executeScriptCalls.length = 0;
    postMessageCalls.length = 0;
    clearCacheCalls.length = 0;
    refreshClicks.length = 0;
    lifecycleLog.length = 0;
    browserHeaderProps.current = null;
    nativeOptions.current = null;
    nativeState.isOpen = true;
    nativeState.currentUrl = 'https://www.youtube.com/watch?v=initial';
    nativeState.isLoading = false;
    nativeState.canGoBack = false;
    nativeState.canGoForward = false;
    nativeState.error = null;
    reload.mockClear();
    executeScript.mockClear();
    postMessageToWebView.mockClear();
    clearCache.mockClear();
  };

  return {
    executeScriptCalls,
    postMessageCalls,
    clearCacheCalls,
    refreshClicks,
    lifecycleLog,
    nativeState,
    browserHeaderProps,
    nativeOptions,
    reload,
    executeScript,
    postMessageToWebView,
    clearCache,
    reset,
  };
});

vi.mock('@/hooks/useCapacitor', () => ({
  useCapacitor: () => ({ isNative: true }),
}));

vi.mock('@/hooks/useContentProtection', () => ({
  useContentProtection: () => ({
    checkBlockedSite: vi.fn(async () => null),
    isChecking: false,
  }),
}));

vi.mock('@/hooks/useDeviceId', () => ({
  useDeviceId: () => 'device-test-id',
}));

vi.mock('@/hooks/useGateRuntime', () => ({
  useGateRuntime: () => ({
    effectiveShieldState: {
      shieldEnabled: true,
      passActive: false,
      passEndsAt: null,
      passRemainingSeconds: 0,
      cooldownActive: false,
      cooldownEndsAt: null,
      cooldownRemainingSeconds: 0,
      status: 'shield_on',
      statusLabel: 'Shield active',
    },
  }),
}));

vi.mock('@/hooks/useLocalSettings', () => ({
  useLocalSettings: () => ({
    settings: {
      shield_active: true,
      isEnhancedVisibility: false,
      blur_level: 'HIGH',
      ai_sensitivity: 'moderate',
      block_adult_sites: true,
      block_social_media: false,
      auto_scan_images: true,
      show_scan_notifications: true,
      blur_dial: 3,
      blur_strength_px: 28,
      fail_closed: false,
      debug_mode: false,
      diag_youtube_shorts: true,
      blocking_mode: 'mvp',
      prototype_mode: false,
      hard_overlay_confidence_threshold: 0.85,
      soft_overlay_ratio_threshold: 0.5,
      soft_overlay_min_hits: 4,
      blur_mode: 'balanced',
      enableSegmentationSignal: true,
      segmentationGrayZoneOnly: true,
      segmentationThrottleMs: 800,
      segmentationMaxInputPx: 256,
      segmentationCacheTtlMs: 20_000,
      segmentationSkinRatioRelaxed: 0.28,
      segmentationSkinRatioMedium: 0.22,
      segmentationSkinRatioStrict: 0.16,
      flash_shield_enabled: false,
    },
    isLoaded: true,
    getModerationConfig: () => ({
      sensitivity: 3,
      blurStrength: 28,
      enabled: true,
      scanEnabled: true,
      flashShieldV1: false,
      forcedBlur: false,
      failClosed: false,
      debug: false,
      nonce: 'test-nonce',
      blockingMode: 'mvp',
      prototypeMode: false,
      pageEpoch: 91,
      diagYouTubeShorts: true,
      enableShortsHealthHeal: true,
    }),
    getNonce: () => 'test-nonce',
    updateSetting: vi.fn(),
  }),
}));

vi.mock('@/hooks/useBrowserNavigation', () => ({
  useBrowserNavigation: () => ({
    currentView: 'browse',
    currentUrl: nativeBrowserHarness.nativeState.currentUrl,
    displayUrl: nativeBrowserHarness.nativeState.currentUrl,
    navigate: vi.fn(),
    goBack: vi.fn(),
    goForward: vi.fn(),
    goHome: vi.fn(),
    canGoBack: nativeBrowserHarness.nativeState.canGoBack,
    canGoForward: nativeBrowserHarness.nativeState.canGoForward,
    getModeLabel: () => 'GoodCreation.net',
    getModeColor: () => 'text-muted-foreground',
    setDisplayUrl: vi.fn(),
  }),
}));

vi.mock('@/hooks/useModerationBridge', () => ({
  useModerationBridge: () => ({
    isReady: true,
    isScanning: false,
    scannedCount: 0,
    blurredCount: 0,
    pendingCount: 0,
    lastScanTime: 0,
    error: null,
    modelState: 'ready',
    config: {},
    scanImage: vi.fn(),
    scanBatch: vi.fn(),
    queueScan: vi.fn(),
    handleWebViewMessage: vi.fn(),
    getResult: vi.fn(),
    clearCache: nativeBrowserHarness.clearCache,
    getInjectionConfig: vi.fn(),
  }),
}));

vi.mock('@/hooks/useNativeWebView', () => ({
  useNativeWebView: (options: Record<string, unknown> = {}) => {
    nativeBrowserHarness.nativeOptions.current = options;
    return {
      state: nativeBrowserHarness.nativeState,
      listenersAttached: false,
      open: vi.fn(async () => true),
      close: vi.fn(async () => true),
      goBack: vi.fn(async () => true),
      goForward: vi.fn(async () => true),
      reload: nativeBrowserHarness.reload,
      postMessageToWebView: nativeBrowserHarness.postMessageToWebView,
      executeScript: nativeBrowserHarness.executeScript,
      setFlashGuardState: vi.fn(),
    };
  },
}));

vi.mock('@/components/browser/BrowserHeader', () => ({
  BrowserHeader: (props: Record<string, unknown>) => {
    nativeBrowserHarness.browserHeaderProps.current = props;
    return React.createElement(
      'button',
      {
        type: 'button',
        'data-testid': 'browser-refresh',
        onClick: () => {
          nativeBrowserHarness.refreshClicks.push('refresh');
          (props as { onRefresh?: () => void }).onRefresh?.();
        },
      },
      'refresh',
    );
  },
}));

vi.mock('@/components/browser/BlurShieldOverlay', () => ({
  BlurShieldOverlay: () => null,
}));

vi.mock('@/components/browser/AIStatusBar', () => ({
  AIStatusBar: () => null,
}));

vi.mock('@/components/browser/LabelListener', () => ({
  default: () => null,
}));

export function resetNativeBrowserHarness(): void {
  nativeBrowserHarness.reset();
}

