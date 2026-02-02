/**
 * Hook for managing trigger blocklist settings
 * 
 * Stores user preferences for which content triggers are active.
 * Persists to localStorage.
 */

import { useState, useEffect, useCallback } from 'react';
import { 
  TRIGGER_GROUPS, 
  getAllTriggerItems, 
  getDefaultEnabledTriggers,
  TriggerCategory 
} from '@/lib/trigger-categories';

const TRIGGER_SETTINGS_KEY = 'mw_trigger_settings';

export interface TriggerSettings {
  triggers: Record<string, boolean>;
  prototypeMode: boolean;
  prototypeConsent: boolean; // Global consent for image uploads
}

const DEFAULT_SETTINGS: TriggerSettings = {
  triggers: getDefaultEnabledTriggers(),
  prototypeMode: false,
  prototypeConsent: false,
};

export const useTriggerSettings = () => {
  const [settings, setSettings] = useState<TriggerSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(TRIGGER_SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge with defaults to handle new triggers
        setSettings({
          ...DEFAULT_SETTINGS,
          ...parsed,
          triggers: {
            ...DEFAULT_SETTINGS.triggers,
            ...parsed.triggers,
          },
        });
      }
    } catch (e) {
      console.error('[TriggerSettings] Failed to load:', e);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage
  const saveSettings = useCallback((newSettings: TriggerSettings) => {
    try {
      localStorage.setItem(TRIGGER_SETTINGS_KEY, JSON.stringify(newSettings));
      setSettings(newSettings);
    } catch (e) {
      console.error('[TriggerSettings] Failed to save:', e);
    }
  }, []);

  // Toggle a single trigger
  const toggleTrigger = useCallback((triggerId: string) => {
    const newSettings = {
      ...settings,
      triggers: {
        ...settings.triggers,
        [triggerId]: !settings.triggers[triggerId],
      },
    };
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  // Set trigger value
  const setTrigger = useCallback((triggerId: string, enabled: boolean) => {
    const newSettings = {
      ...settings,
      triggers: {
        ...settings.triggers,
        [triggerId]: enabled,
      },
    };
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  // Toggle all triggers in a group
  const toggleGroup = useCallback((groupId: TriggerCategory) => {
    const group = TRIGGER_GROUPS.find(g => g.id === groupId);
    if (!group) return;

    // Check if any are enabled
    const anyEnabled = group.items.some(item => settings.triggers[item.id]);
    const allEnabled = group.items.every(item => settings.triggers[item.id]);

    // If all enabled, disable all. Otherwise enable all.
    const newValue = !allEnabled;

    const newTriggers = { ...settings.triggers };
    group.items.forEach(item => {
      newTriggers[item.id] = newValue;
    });

    const newSettings = { ...settings, triggers: newTriggers };
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  // Get state of a group (all, some, none)
  const getGroupState = useCallback((groupId: TriggerCategory): 'all' | 'some' | 'none' => {
    const group = TRIGGER_GROUPS.find(g => g.id === groupId);
    if (!group) return 'none';

    const enabledCount = group.items.filter(item => settings.triggers[item.id]).length;
    if (enabledCount === 0) return 'none';
    if (enabledCount === group.items.length) return 'all';
    return 'some';
  }, [settings.triggers]);

  // Get enabled triggers for injection config
  const getEnabledTriggers = useCallback((): Record<string, boolean> => {
    return { ...settings.triggers };
  }, [settings.triggers]);

  // Get enabled category IDs (for MVP: just shirtless and swimwear if their items are enabled)
  const getEnabledCategories = useCallback((): TriggerCategory[] => {
    const categories: TriggerCategory[] = [];
    
    TRIGGER_GROUPS.forEach(group => {
      const hasAnyEnabled = group.items.some(item => settings.triggers[item.id]);
      if (hasAnyEnabled) {
        categories.push(group.id);
      }
    });
    
    return categories;
  }, [settings.triggers]);

  // Set prototype mode
  const setPrototypeMode = useCallback((enabled: boolean) => {
    const newSettings = { ...settings, prototypeMode: enabled };
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  // Set prototype consent
  const setPrototypeConsent = useCallback((consent: boolean) => {
    const newSettings = { ...settings, prototypeConsent: consent };
    saveSettings(newSettings);
  }, [settings, saveSettings]);

  // Reset to defaults
  const resetToDefaults = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
  }, [saveSettings]);

  return {
    triggers: settings.triggers,
    prototypeMode: settings.prototypeMode,
    prototypeConsent: settings.prototypeConsent,
    isLoaded,
    toggleTrigger,
    setTrigger,
    toggleGroup,
    getGroupState,
    getEnabledTriggers,
    getEnabledCategories,
    setPrototypeMode,
    setPrototypeConsent,
    resetToDefaults,
  };
};
