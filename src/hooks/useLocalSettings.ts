import { useState, useEffect, useCallback, useRef } from 'react';
import { generateNonce, TriggerConfig } from '@/lib/moderation-request-utils';
import {
  readDevSegmentationSignalOverride,
  resolveSegmentationSignal,
  type SegmentationSignalResolution,
} from '@/lib/segmentation-signal';

export type BlurLevel = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
export type AISensitivity = 'relaxed' | 'moderate' | 'strict';
export type BlurMode = 'strict' | 'balanced' | 'minimal';

/**
 * Blur dial levels (0-4)
 * 0 = Off (no moderation)
 * 1 = Relaxed (only explicit)
 * 2 = Moderate (explicit + suggestive)
 * 3 = Strict (all questionable)
 * 4 = Maximum (aggressive filtering)
 */
export type BlurDialLevel = 0 | 1 | 2 | 3 | 4;

/**
 * MVP Blocking mode
 * 'mvp' = Only shirtless and swimwear trigger auto-blur
 * 'full' = All categories can trigger based on sensitivity
 */
export type BlockingMode = 'mvp' | 'full';

export interface LocalProtectionSettings {
  shield_active: boolean;
  isEnhancedVisibility: boolean;
  blur_level: BlurLevel;
  ai_sensitivity: AISensitivity;
  block_adult_sites: boolean;
  block_social_media: boolean;
  auto_scan_images: boolean;
  show_scan_notifications: boolean;
  // Granular controls
  blur_dial: BlurDialLevel;
  blur_strength_px: number; // 0-50px
  fail_closed: boolean; // Blur on timeout/error
  debug_mode: boolean;
  diag_youtube_shorts: boolean;
  // MVP settings
  blocking_mode: BlockingMode;
  prototype_mode: boolean; // Show labeling UI on reveal
  // Page-level overlay policy tuning
  hard_overlay_confidence_threshold: number;
  soft_overlay_ratio_threshold: number;
  soft_overlay_min_hits: number;
  blur_mode: BlurMode;
  // Stage-B segmentation controls
  enableSegmentationSignal: boolean;
  segmentationGrayZoneOnly: boolean;
  segmentationThrottleMs: number;
  segmentationMaxInputPx: number;
  segmentationCacheTtlMs: number;
  segmentationSkinRatioRelaxed: number;
  segmentationSkinRatioMedium: number;
  segmentationSkinRatioStrict: number;
  // Flash Shield V1 - independent pre-paint frosted veil (strictly separate from blur_dial / main moderation)
  flash_shield_enabled: boolean;
}

const SETTINGS_KEY = 'iron_watch_local_settings';

const DEFAULT_SETTINGS: LocalProtectionSettings = {
  shield_active: true,
  isEnhancedVisibility: false,
  blur_level: 'HIGH',
  ai_sensitivity: 'moderate',
  block_adult_sites: true,
  block_social_media: false,
  auto_scan_images: true,
  show_scan_notifications: true,
  blur_dial: 2,
  blur_strength_px: 24,
  fail_closed: false, // Fail-open by default to reduce over-blurring from transient scan failures
  debug_mode: false,
  diag_youtube_shorts: false,
  // MVP: Only block shirtless and swimwear
  blocking_mode: 'mvp',
  prototype_mode: false,
  hard_overlay_confidence_threshold: 0.85,
  soft_overlay_ratio_threshold: 0.5,
  soft_overlay_min_hits: 4,
  blur_mode: 'balanced',
  // Segmentation defaults:
  // - enabled in dev only
  // - gray-zone only by default for MVP-safe perf
  enableSegmentationSignal: !!import.meta.env.DEV,
  segmentationGrayZoneOnly: true,
  segmentationThrottleMs: 800,
  segmentationMaxInputPx: 256,
  segmentationCacheTtlMs: 20_000,
  segmentationSkinRatioRelaxed: 0.28,
  segmentationSkinRatioMedium: 0.22,
  segmentationSkinRatioStrict: 0.16,
  // Flash Shield: independent frosted pre-paint veil (default on for safety)
  flash_shield_enabled: true,
};

export const useLocalSettings = () => {
  const [settings, setSettings] = useState<LocalProtectionSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [segmentationSignalResolution, setSegmentationSignalResolution] = useState<SegmentationSignalResolution>(() => (
    resolveSegmentationSignal({
      isDevBuild: !!import.meta.env.DEV,
      defaultEnabled: DEFAULT_SETTINGS.enableSegmentationSignal,
      hasPersistedValue: false,
      persistedValue: null,
      devOverrideValue: null,
    })
  ));
  
  // Per-session nonce for security - generated once per app session
  const sessionNonceRef = useRef<string>(generateNonce());

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      let parsedSettings: Partial<LocalProtectionSettings> = {};
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
          parsedSettings = parsed as Partial<LocalProtectionSettings>;
        }
      }

      const hasPersistedSegmentationSignal =
        typeof parsedSettings.enableSegmentationSignal === 'boolean';
      const persistedSegmentationSignal = hasPersistedSegmentationSignal
        ? parsedSettings.enableSegmentationSignal
        : null;
      const devOverrideValue = readDevSegmentationSignalOverride();
      const resolvedSignal = resolveSegmentationSignal({
        isDevBuild: !!import.meta.env.DEV,
        defaultEnabled: DEFAULT_SETTINGS.enableSegmentationSignal,
        hasPersistedValue: hasPersistedSegmentationSignal,
        persistedValue: persistedSegmentationSignal,
        devOverrideValue,
      });
      const hydratedSettings: LocalProtectionSettings = {
        ...DEFAULT_SETTINGS,
        ...parsedSettings,
        enableSegmentationSignal: resolvedSignal.enabled,
      };

      if (
        import.meta.env.DEV &&
        resolvedSignal.autoHealed &&
        hasPersistedSegmentationSignal &&
        persistedSegmentationSignal === false &&
        devOverrideValue !== false
      ) {
        console.warn(
          '[LocalSettings][StageB] enableSegmentationSignal persisted false in DEV; auto-healing to true',
        );
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(hydratedSettings));
      }

      setSegmentationSignalResolution(resolvedSignal);
      setSettings(hydratedSettings);
    } catch (error) {
      console.error('Failed to load local settings:', error);
    }
    setIsLoaded(true);
  }, []);

  // Save settings to localStorage
  const saveSettings = useCallback((newSettings: LocalProtectionSettings) => {
    try {
      const persistedSegmentationSignal =
        typeof newSettings.enableSegmentationSignal === 'boolean'
          ? newSettings.enableSegmentationSignal
          : null;
      const resolvedSignal = resolveSegmentationSignal({
        isDevBuild: !!import.meta.env.DEV,
        defaultEnabled: DEFAULT_SETTINGS.enableSegmentationSignal,
        hasPersistedValue: persistedSegmentationSignal !== null,
        persistedValue: persistedSegmentationSignal,
        devOverrideValue: readDevSegmentationSignalOverride(),
      });
      const normalizedSettings: LocalProtectionSettings = {
        ...newSettings,
        enableSegmentationSignal: resolvedSignal.enabled,
      };

      if (
        import.meta.env.DEV &&
        resolvedSignal.autoHealed &&
        newSettings.enableSegmentationSignal === false &&
        resolvedSignal.devOverrideValue !== false
      ) {
        console.warn('[LocalSettings][StageB] enableSegmentationSignal forced on in DEV (auto-heal)');
      }

      localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizedSettings));
      setSegmentationSignalResolution(resolvedSignal);
      setSettings(normalizedSettings);
    } catch (error) {
      console.error('Failed to save local settings:', error);
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const enabled = settings.isEnhancedVisibility === true;
    document.documentElement.classList.toggle('mw-large-text', enabled);
    document.body.classList.toggle('mw-large-text', enabled);
  }, [settings.isEnhancedVisibility]);

  // Update a single setting
  const updateSetting = useCallback(<K extends keyof LocalProtectionSettings>(
    key: K,
    value: LocalProtectionSettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  // Reset to defaults
  const resetSettings = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
  }, [saveSettings]);

  // Get AI thresholds based on sensitivity
  const getAIThresholds = useCallback(() => {
    switch (settings.ai_sensitivity) {
      case 'relaxed':
        return { porn: 0.8, sexy: 0.85, hentai: 0.8 };
      case 'moderate':
        return { porn: 0.5, sexy: 0.6, hentai: 0.5 };
      case 'strict':
      default:
        return { porn: 0.3, sexy: 0.4, hentai: 0.3 };
    }
  }, [settings.ai_sensitivity]);

  // Get blur amount in pixels based on level (legacy)
  const getBlurAmount = useCallback(() => {
    switch (settings.blur_level) {
      case 'OFF': return 0;
      case 'LOW': return 8;
      case 'MEDIUM': return 16;
      case 'HIGH': return 32;
    }
  }, [settings.blur_level]);

  // Get blur strength from new dial setting
  const getBlurStrength = useCallback(() => {
    return settings.blur_strength_px;
  }, [settings.blur_strength_px]);

  // Get sensitivity thresholds from blur dial (0-4)
  const getDialThresholds = useCallback(() => {
    switch (settings.blur_dial) {
      case 0: return { porn: 1.1, sexy: 1.1, hentai: 1.1 }; // Off
      case 1: return { porn: 0.7, sexy: 0.85, hentai: 0.7 }; // Relaxed
      case 2: return { porn: 0.5, sexy: 0.65, hentai: 0.5 }; // Moderate
      case 3: return { porn: 0.3, sexy: 0.45, hentai: 0.3 }; // Strict
      case 4: return { porn: 0.15, sexy: 0.25, hentai: 0.15 }; // Maximum
      default: return { porn: 0.3, sexy: 0.45, hentai: 0.3 };
    }
  }, [settings.blur_dial]);

  // Check if moderation is enabled
  const isModerationEnabled = useCallback(() => {
    return settings.shield_active && settings.blur_dial > 0;
  }, [settings.shield_active, settings.blur_dial]);

  // Get the current session nonce
  const getNonce = useCallback((): string => {
    return sessionNonceRef.current;
  }, []);

  // Get moderation config for WebView injection (with nonce and triggers)
  const getModerationConfig = useCallback((triggers?: TriggerConfig) => {
    return {
      sensitivity: settings.blur_dial,
      blurStrength: settings.blur_strength_px,
      enabled: settings.shield_active && settings.blur_dial > 0,
      forcedBlur: false,
      failClosed: settings.fail_closed,
      debug: settings.debug_mode,
      nonce: sessionNonceRef.current,
      blockingMode: settings.blocking_mode,
      prototypeMode: settings.prototype_mode,
      triggers: triggers || {},
      segmentation: {
        enabled: segmentationSignalResolution.enabled,
        grayZoneOnly: settings.segmentationGrayZoneOnly,
        throttleMs: settings.segmentationThrottleMs,
        maxInputPx: settings.segmentationMaxInputPx,
        cacheTtlMs: settings.segmentationCacheTtlMs,
        skinRatioThresholds: {
          relaxed: settings.segmentationSkinRatioRelaxed,
          medium: settings.segmentationSkinRatioMedium,
          strict: settings.segmentationSkinRatioStrict,
        },
      },
      // Flash Shield V1: independent pre-paint frosted veil. Strictly separate from blur_dial.
      flashShieldV1: settings.flash_shield_enabled === true,
    };
  }, [
    settings.shield_active,
    settings.blur_dial,
    settings.blur_strength_px,
    settings.fail_closed,
    settings.debug_mode,
    settings.blocking_mode,
    settings.prototype_mode,
    segmentationSignalResolution.enabled,
    settings.segmentationGrayZoneOnly,
    settings.segmentationThrottleMs,
    settings.segmentationMaxInputPx,
    settings.segmentationCacheTtlMs,
    settings.segmentationSkinRatioRelaxed,
    settings.segmentationSkinRatioMedium,
    settings.segmentationSkinRatioStrict,
    settings.flash_shield_enabled,
  ]);

  const getSegmentationConfig = useCallback(() => {
    return {
      enabled: segmentationSignalResolution.enabled,
      grayZoneOnly: settings.segmentationGrayZoneOnly,
      throttleMs: settings.segmentationThrottleMs,
      maxInputPx: settings.segmentationMaxInputPx,
      cacheTtlMs: settings.segmentationCacheTtlMs,
      skinRatioThresholds: {
        relaxed: settings.segmentationSkinRatioRelaxed,
        medium: settings.segmentationSkinRatioMedium,
        strict: settings.segmentationSkinRatioStrict,
      },
    };
  }, [
    segmentationSignalResolution.enabled,
    settings.segmentationGrayZoneOnly,
    settings.segmentationThrottleMs,
    settings.segmentationMaxInputPx,
    settings.segmentationCacheTtlMs,
    settings.segmentationSkinRatioRelaxed,
    settings.segmentationSkinRatioMedium,
    settings.segmentationSkinRatioStrict,
  ]);

  // Check if a category should be blocked based on MVP mode
  const shouldBlockCategory = useCallback((category: string): boolean => {
    if (!settings.shield_active || settings.blur_dial === 0) return false;
    
    // In MVP mode, only block shirtless and swimwear
    if (settings.blocking_mode === 'mvp') {
      const mvpCategories = ['shirtless', 'swimwear', 'shirtless_male', 'bikini', 'swim_trunks'];
      return mvpCategories.some(c => category.toLowerCase().includes(c));
    }
    
    // Full mode - block based on sensitivity
    return true;
  }, [settings.shield_active, settings.blur_dial, settings.blocking_mode]);

  return {
    settings,
    isLoaded,
    updateSetting,
    saveSettings,
    resetSettings,
    getAIThresholds,
    getBlurAmount,
    getBlurStrength,
    getDialThresholds,
    isModerationEnabled,
    getModerationConfig,
    getSegmentationConfig,
    segmentationSignalResolution,
    getNonce,
    shouldBlockCategory,
  };
};
