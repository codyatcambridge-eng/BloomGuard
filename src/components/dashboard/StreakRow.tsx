/**
 * Streak Row
 * 
 * Side-by-side display of Shield and Strength streaks.
 */

import { cn } from '@/lib/utils';
import { Shield, Flame } from 'lucide-react';

interface StreakRowProps {
  shieldStreak: number;
  strengthStreak: number;
  className?: string;
}

export function StreakRow({
  shieldStreak,
  strengthStreak,
  className,
}: StreakRowProps) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      {/* Shield Streak */}
      <div className="flex items-center gap-3 p-4 rounded-xl bg-cathedral-deep/50 border border-silver/10">
        <div className="w-10 h-10 rounded-lg bg-techBlue/20 flex items-center justify-center">
          <Shield className="w-5 h-5 text-techBlue" />
        </div>
        <div>
          <p className="font-display text-xl text-foreground">
            {shieldStreak}
          </p>
          <p className="text-xs text-muted-foreground">
            Shield Days
          </p>
        </div>
      </div>

      {/* Strength Streak */}
      <div className="flex items-center gap-3 p-4 rounded-xl bg-cathedral-deep/50 border border-silver/10">
        <div className="w-10 h-10 rounded-lg bg-flame/20 flex items-center justify-center">
          <Flame className="w-5 h-5 text-flame" />
        </div>
        <div>
          <p className="font-display text-xl text-foreground">
            {strengthStreak}
          </p>
          <p className="text-xs text-muted-foreground">
            Strength Days
          </p>
        </div>
      </div>
    </div>
  );
}
