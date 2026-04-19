import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useDeviceId } from './useDeviceId';

export type BlurLevel = 'OFF' | 'LOW' | 'HIGH';

export interface ProtectionSettings {
  shield_active: boolean;
  blur_sensitivity: BlurLevel;
  block_adult_sites: boolean;
  block_social_media: boolean;
  block_ads: boolean;
}

const DEFAULT_SETTINGS: ProtectionSettings = {
  shield_active: true,
  blur_sensitivity: 'HIGH',
  block_adult_sites: true,
  block_social_media: false,
  block_ads: true,
};

export const useSettings = () => {
  const deviceId = useDeviceId();
  const [settings, setSettings] = useState<ProtectionSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  // Map blur level to database sensitivity
  const blurToSensitivity = (blur: BlurLevel): string => {
    switch (blur) {
      case 'OFF': return 'relaxed';
      case 'LOW': return 'moderate';
      case 'HIGH': return 'strict';
    }
  };

  const sensitivityToBlur = (sensitivity: string): BlurLevel => {
    switch (sensitivity) {
      case 'relaxed': return 'OFF';
      case 'moderate': return 'LOW';
      case 'strict': 
      default: return 'HIGH';
    }
  };

  useEffect(() => {
    if (!deviceId) return;
    loadSettings();
  }, [deviceId]);

  const loadSettings = async () => {
    if (!deviceId) return;
    
    setIsLoading(true);
    const { data, error } = await supabase
      .from('user_protection_settings')
      .select('*')
      .eq('device_id', deviceId)
      .maybeSingle();

    if (error) {
      console.error('Error loading settings:', error);
    } else if (data) {
      setSettings({
        shield_active: data.shield_active,
        blur_sensitivity: sensitivityToBlur(data.blur_sensitivity),
        block_adult_sites: data.block_adult_sites,
        block_social_media: data.block_social_media,
        block_ads: data.block_ads,
      });
    } else {
      // Create default settings for this device
      await saveSettings(DEFAULT_SETTINGS);
    }
    setIsLoading(false);
  };

  const saveSettings = useCallback(async (newSettings: ProtectionSettings) => {
    if (!deviceId) return;

    const dbSettings = {
      device_id: deviceId,
      shield_active: newSettings.shield_active,
      blur_sensitivity: blurToSensitivity(newSettings.blur_sensitivity),
      block_adult_sites: newSettings.block_adult_sites,
      block_social_media: newSettings.block_social_media,
      block_ads: newSettings.block_ads,
    };

    const { error } = await supabase
      .from('user_protection_settings')
      .upsert(dbSettings, { onConflict: 'device_id' });

    if (error) {
      console.error('Error saving settings:', error);
    } else {
      setSettings(newSettings);
    }
  }, [deviceId]);

  const updateSetting = useCallback(async <K extends keyof ProtectionSettings>(
    key: K,
    value: ProtectionSettings[K]
  ) => {
    const newSettings = { ...settings, [key]: value };
    await saveSettings(newSettings);
  }, [settings, saveSettings]);

  return {
    settings,
    isLoading,
    updateSetting,
    saveSettings,
    deviceId,
  };
};
