import { useState, useEffect, useCallback } from 'react';

export type BlurLevel = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';
export type AISensitivity = 'relaxed' | 'moderate' | 'strict';

export interface LocalProtectionSettings {
  shield_active: boolean;
  blur_level: BlurLevel;
  ai_sensitivity: AISensitivity;
  block_adult_sites: boolean;
  block_social_media: boolean;
  auto_scan_images: boolean;
  show_scan_notifications: boolean;
}

const SETTINGS_KEY = 'iron_watch_local_settings';

const DEFAULT_SETTINGS: LocalProtectionSettings = {
  shield_active: true,
  blur_level: 'HIGH',
  ai_sensitivity: 'strict',
  block_adult_sites: true,
  block_social_media: false,
  auto_scan_images: true,
  show_scan_notifications: true,
};

export const useLocalSettings = () => {
  const [settings, setSettings] = useState<LocalProtectionSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      }
    } catch (error) {
      console.error('Failed to load local settings:', error);
    }
    setIsLoaded(true);
  }, []);

  // Save settings to localStorage
  const saveSettings = useCallback((newSettings: LocalProtectionSettings) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
      setSettings(newSettings);
    } catch (error) {
      console.error('Failed to save local settings:', error);
    }
  }, []);

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

  // Get blur amount in pixels based on level
  const getBlurAmount = useCallback(() => {
    switch (settings.blur_level) {
      case 'OFF': return 0;
      case 'LOW': return 8;
      case 'MEDIUM': return 16;
      case 'HIGH': return 32;
    }
  }, [settings.blur_level]);

  return {
    settings,
    isLoaded,
    updateSetting,
    saveSettings,
    resetSettings,
    getAIThresholds,
    getBlurAmount,
  };
};
