/**
 * Degraded Mode Banner
 * 
 * Shows when user is in degraded mode after high-risk unlock.
 * UI-layer only - does not modify blur engine.
 */

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Shield, X } from 'lucide-react';

interface DegradedModeBannerProps {
  degradedModeUntil: number | null;
  onDismiss?: () => void;
  className?: string;
}

export function DegradedModeBanner({
  degradedModeUntil,
  onDismiss,
  className,
}: DegradedModeBannerProps) {
  const [remainingMinutes, setRemainingMinutes] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!degradedModeUntil) {
      setIsVisible(false);
      return;
    }

    const updateRemaining = () => {
      const now = Date.now();
      const remaining = Math.max(0, degradedModeUntil - now);
      const minutes = Math.ceil(remaining / 60000);
      
      setRemainingMinutes(minutes);
      setIsVisible(remaining > 0);
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 10000); // Update every 10s

    return () => clearInterval(interval);
  }, [degradedModeUntil]);

  if (!isVisible) return null;

  return (
    <div 
      className={cn(
        'fixed top-0 left-0 right-0 z-50',
        'bg-gradient-to-r from-cathedral-dark via-cathedral-deep to-cathedral-dark',
        'border-b border-silver/20',
        'px-4 py-3',
        'animate-in slide-in-from-top duration-300',
        className
      )}
    >
      <div className="flex items-center justify-between max-w-lg mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-techBlue/20 flex items-center justify-center">
            <Shield className="w-4 h-4 text-techBlue" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">
              Shield engaged.
            </p>
            <p className="text-xs text-muted-foreground">
              Degraded Mode: {remainingMinutes}m
            </p>
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-2 rounded-lg hover:bg-silver/10 transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Hook to check if currently in degraded mode
 */
export function useIsDegradedMode(degradedModeUntil: number | null): boolean {
  const [isDegraded, setIsDegraded] = useState(false);

  useEffect(() => {
    if (!degradedModeUntil) {
      setIsDegraded(false);
      return;
    }

    const checkDegraded = () => {
      setIsDegraded(Date.now() < degradedModeUntil);
    };

    checkDegraded();
    const interval = setInterval(checkDegraded, 5000);

    return () => clearInterval(interval);
  }, [degradedModeUntil]);

  return isDegraded;
}

/**
 * CSS class to apply degraded mode effects
 * Apply to root container when in degraded mode
 */
export const DEGRADED_MODE_CLASS = 'degraded-mode';

/**
 * Degraded mode CSS (add to global styles)
 * 
 * .degraded-mode {
 *   filter: grayscale(0.5);
 * }
 * .degraded-mode img,
 * .degraded-mode video {
 *   filter: grayscale(0.7) brightness(0.9);
 * }
 */
