/**
 * Next Unlock Progress Bar
 * 
 * Shows progress toward next rank with SP and days indicators.
 */

import { cn } from '@/lib/utils';
import { Rank } from '@/logic/rank';

interface NextUnlockProgressBarProps {
  currentRank: Rank;
  nextRank: Rank;
  spProgress: number;
  daysProgress: number;
  spToNext: number;
  daysToNext: number;
  className?: string;
}

export function NextUnlockProgressBar({
  currentRank,
  nextRank,
  spProgress,
  daysProgress,
  spToNext,
  daysToNext,
  className,
}: NextUnlockProgressBarProps) {
  // Use the higher of the two progress values for the main bar
  const overallProgress = Math.max(spProgress, daysProgress);

  return (
    <div className={cn('space-y-3', className)}>
      {/* Label */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Next: <span style={{ color: nextRank.color }}>{nextRank.name}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {overallProgress}%
        </span>
      </div>

      {/* Main progress bar */}
      <div className="relative h-2 rounded-full bg-cathedral-deep overflow-hidden">
        {/* Background glow */}
        <div 
          className="absolute inset-0 opacity-30"
          style={{
            background: `linear-gradient(90deg, ${currentRank.color}40, ${nextRank.color}40)`,
          }}
        />
        
        {/* Progress fill */}
        <div 
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{
            width: `${overallProgress}%`,
            background: `linear-gradient(90deg, ${currentRank.color}, ${nextRank.color})`,
          }}
        />
      </div>

      {/* Requirements */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1">
          <span className="text-gold">{spToNext}</span>
          <span className="text-muted-foreground">SP needed</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-techBlue">{daysToNext}</span>
          <span className="text-muted-foreground">days needed</span>
        </div>
      </div>
    </div>
  );
}
