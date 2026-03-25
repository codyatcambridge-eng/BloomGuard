import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ModerationResult {
  shouldBlur: boolean;
  classification: string;
  confidence: number;
  categories: string[];
  reason: string;
}

export interface BlockCheckResult {
  isBlocked: boolean;
  domain: string;
  category: string | null;
  reason: string;
}

export type Sensitivity = 'strict' | 'moderate' | 'relaxed';

export const useContentProtection = () => {
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moderateImage = useCallback(async (
    imageSource: string,
    sensitivity: Sensitivity = 'strict'
  ): Promise<ModerationResult | null> => {
    setIsChecking(true);
    setError(null);

    try {
      const isBase64 = imageSource.startsWith('data:');
      
      const { data, error: fnError } = await supabase.functions.invoke('moderate-image', {
        body: {
          ...(isBase64 ? { imageBase64: imageSource } : { imageUrl: imageSource }),
          sensitivity
        }
      });

      if (fnError) {
        throw new Error(fnError.message);
      }

      return data as ModerationResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to moderate image';
      setError(message);
      console.error('Image moderation error:', err);
      return null;
    } finally {
      setIsChecking(false);
    }
  }, []);

  const checkBlockedSite = useCallback(async (
    url: string,
    deviceId?: string
  ): Promise<BlockCheckResult | null> => {
    setIsChecking(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('check-blocked-site', {
        body: { url, deviceId }
      });

      if (fnError) {
        throw new Error(fnError.message);
      }

      return data as BlockCheckResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to check site';
      setError(message);
      console.error('Site check error:', err);
      return null;
    } finally {
      setIsChecking(false);
    }
  }, []);

  return {
    moderateImage,
    checkBlockedSite,
    isChecking,
    error
  };
};
