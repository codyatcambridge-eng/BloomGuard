/**
 * Quick Win CTA
 * 
 * Primary action button for starting a 10-minute focus session.
 */

import { cn } from '@/lib/utils';
import { Play, Clock } from 'lucide-react';

interface QuickWinCTAProps {
  onStart: () => void;
  isActive?: boolean;
  className?: string;
}

export function QuickWinCTA({
  onStart,
  isActive = false,
  className,
}: QuickWinCTAProps) {
  return (
    <button
      onClick={onStart}
      disabled={isActive}
      className={cn(
        'w-full flex items-center justify-between p-5 rounded-2xl',
        'transition-all duration-300 active:scale-[0.98]',
        isActive
          ? 'bg-techBlue/20 border border-techBlue/30'
          : 'bg-gradient-to-r from-gold/20 via-gold/10 to-gold/20 border border-gold/30 hover:border-gold/50',
        className
      )}
    >
      <div className="flex items-center gap-4">
        <div 
          className={cn(
            'w-14 h-14 rounded-xl flex items-center justify-center',
            isActive ? 'bg-techBlue/30' : 'bg-gold/20'
          )}
        >
          {isActive ? (
            <Clock className="w-7 h-7 text-techBlue animate-pulse" />
          ) : (
            <Play className="w-7 h-7 text-gold" />
          )}
        </div>
        <div className="text-left">
          <p className={cn(
            'font-display text-lg tracking-wide',
            isActive ? 'text-techBlue' : 'text-gold'
          )}>
            {isActive ? 'Session Active' : 'Start a 10-Minute Win'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isActive ? 'Focus in progress...' : 'Quick discipline training'}
          </p>
        </div>
      </div>

      {!isActive && (
        <div className="flex items-center gap-1 text-gold">
          <span className="text-sm font-display">+8 SP</span>
        </div>
      )}
    </button>
  );
}
