/**
 * Utility Pass Banner
 * 
 * Persistent banner shown when a utility pass is active.
 * Shows countdown timer and "End break early" button.
 */

import { Shield, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion as motionUtils } from '@/ui/motion';

interface UtilityPassBannerProps {
  remainingFormatted: string;
  onEndEarly: () => void;
  className?: string;
}

export function UtilityPassBanner({
  remainingFormatted,
  onEndEarly,
  className,
}: UtilityPassBannerProps) {
  const shouldAnimate = !motionUtils.shouldReduceMotion();

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-50',
        'bg-gradient-to-r from-techBlue/90 to-techBlue/80',
        'backdrop-blur-sm border-b border-techBlue/50',
        'px-4 py-3',
        'safe-area-top',
        shouldAnimate && 'animate-in slide-in-from-top duration-200',
        className
      )}
    >
      <div className="flex items-center justify-between max-w-md mx-auto">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-display text-white tracking-wide">
              Utility Pass active
            </p>
            <p className="text-xs text-white/80">
              Shield engaged — {remainingFormatted} remaining
            </p>
          </div>
        </div>
        
        <button
          onClick={onEndEarly}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
            'bg-white/20 hover:bg-white/30',
            'text-white text-xs font-medium',
            'transition-colors duration-200',
            'min-h-[44px] min-w-[44px]' // Touch target
          )}
          aria-label="End break early"
        >
          <X className="w-3.5 h-3.5" />
          <span>End early</span>
        </button>
      </div>
    </div>
  );
}
