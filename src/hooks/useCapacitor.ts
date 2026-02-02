import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

export interface CapacitorInfo {
  isNative: boolean;
  platform: 'ios' | 'android' | 'web';
  isIOS: boolean;
  isAndroid: boolean;
  isWeb: boolean;
}

export const useCapacitor = (): CapacitorInfo => {
  const [info, setInfo] = useState<CapacitorInfo>({
    isNative: false,
    platform: 'web',
    isIOS: false,
    isAndroid: false,
    isWeb: true,
  });

  useEffect(() => {
    const platform = Capacitor.getPlatform() as 'ios' | 'android' | 'web';
    const isNative = Capacitor.isNativePlatform();
    
    setInfo({
      isNative,
      platform,
      isIOS: platform === 'ios',
      isAndroid: platform === 'android',
      isWeb: platform === 'web',
    });
  }, []);

  return info;
};
