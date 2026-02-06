/**
 * Strength Points Card
 * 
 * Shows today's SP and total SP with visual emphasis.
 * Uses design tokens for consistent styling.
 */

import { cn } from '@/lib/utils';
import { Zap, TrendingUp } from 'lucide-react';
import { tokens } from '@/ui/tokens';
import { getAnimationClass } from '@/ui/theme';

interface StrengthPointsCardProps {
  todaySP: number;
  totalSP: number;
  className?: string;
}

export function StrengthPointsCard({
  todaySP,
  totalSP,
  className,
}: StrengthPointsCardProps) {
  // Determine if user earned SP today (show celebration)
  const hasEarnedToday = todaySP > 0;

  return (
    <div 
      className={cn(
        'p-4 rounded-xl',
        'bg-gradient-to-br from-gold/10 via-cathedral-deep to-cathedral-deep',
        'border border-gold/20',
        className
      )}
    >
      <div className="flex items-center justify-between">
        {/* Today's SP */}
        <div className="flex items-center gap-3">
          <div 
            className={cn(
              'w-12 h-12 rounded-xl bg-gold/20 flex items-center justify-center',
              hasEarnedToday && getAnimationClass('animate-glow-pulse')
            )}
            style={{ minWidth: tokens.minTouchTarget, minHeight: tokens.minTouchTarget }}
          >
            <Zap className="w-6 h-6 text-gold" />
          </div>
          <div>
            <p className="font-display text-2xl text-gold">
              +{todaySP}
            </p>
            <p className="text-xs text-muted-foreground">
              SP Today
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="h-12 w-px bg-silver/20" />

        {/* Total SP */}
        <div className="flex items-center gap-3">
          <div>
            <p className="font-display text-2xl text-foreground text-right">
              {totalSP.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground text-right">
              Total SP
            </p>
          </div>
          <div 
            className="w-11 h-11 rounded-lg bg-silver/10 flex items-center justify-center"
            style={{ minWidth: tokens.minTouchTarget, minHeight: tokens.minTouchTarget }}
          >
            <TrendingUp className="w-5 h-5 text-silver" />
          </div>
        </div>
      </div>

      {/* Motivational message */}
      <p className="text-center text-xs text-gold/70 mt-3 font-display tracking-wide">
        Delay is power.
      </p>
    </div>
  );
}
