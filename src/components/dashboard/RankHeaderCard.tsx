/**
 * Rank Header Card
 * 
 * Shows current rank, shield status, and next unlock progress.
 * Top of dashboard hierarchy.
 */

import { cn } from '@/lib/utils';
import { Shield, Crown } from 'lucide-react';
import { RankProgress, getRankById } from '@/logic/rank';
import { NextUnlockProgressBar } from './NextUnlockProgressBar';

interface RankHeaderCardProps {
  rankProgress: RankProgress | null;
  shieldActive?: boolean;
  className?: string;
}

export function RankHeaderCard({
  rankProgress,
  shieldActive = true,
  className,
}: RankHeaderCardProps) {
  const currentRank = rankProgress?.currentRank ?? getRankById('STONE');
  const nextRank = rankProgress?.nextRank;

  return (
    <div 
      className={cn(
        'relative overflow-hidden rounded-2xl',
        'bg-gradient-to-br from-cathedral-deep via-cathedral-dark to-cathedral-deep',
        'border border-silver/10',
        'p-5',
        className
      )}
    >
      {/* Rank glow effect */}
      <div 
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          background: `radial-gradient(circle at 50% 0%, ${currentRank.glowColor}, transparent 70%)`,
        }}
      />

      {/* Shield Status */}
      <div className="relative flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div 
            className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              shieldActive ? 'bg-techBlue/20' : 'bg-silver/10'
            )}
          >
            <Shield 
              className={cn(
                'w-5 h-5',
                shieldActive ? 'text-techBlue' : 'text-silver/50'
              )} 
            />
          </div>
          <div>
            <p className={cn(
              'text-sm font-medium',
              shieldActive ? 'text-techBlue' : 'text-muted-foreground'
            )}>
              {shieldActive ? 'Shield engaged.' : 'Shield inactive'}
            </p>
            <p className="text-xs text-muted-foreground">
              Protection active
            </p>
          </div>
        </div>

        {/* Current Rank Badge */}
        <div 
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ 
            backgroundColor: `${currentRank.color}20`,
            borderColor: currentRank.color,
            borderWidth: '1px',
          }}
        >
          <Crown className="w-4 h-4" style={{ color: currentRank.color }} />
          <span 
            className="text-sm font-display tracking-wide"
            style={{ color: currentRank.color }}
          >
            {currentRank.name}
          </span>
        </div>
      </div>

      {/* Next Unlock Progress */}
      {nextRank && rankProgress && (
        <NextUnlockProgressBar
          currentRank={currentRank}
          nextRank={nextRank}
          spProgress={rankProgress.spProgress}
          daysProgress={rankProgress.daysProgress}
          spToNext={rankProgress.spToNextRank}
          daysToNext={rankProgress.daysToNextRank}
        />
      )}

      {/* Max rank message */}
      {!nextRank && (
        <div className="text-center py-2">
          <p className="text-sm text-gold font-display">
            Maximum rank achieved
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            You trained discipline. Now help others.
          </p>
        </div>
      )}
    </div>
  );
}
