/**
 * Rank Header Card
 * 
 * Shows current rank, shield status, and next unlock progress.
 * Top of dashboard hierarchy.
 * 
 * Uses rank-based theming from ui/theme.ts
 */

import { cn } from '@/lib/utils';
import { Shield, Crown } from 'lucide-react';
import { RankProgress, getRankById } from '@/logic/rank';
import { NextUnlockProgressBar } from './NextUnlockProgressBar';
import { getThemeForRank, getAnimationClass } from '@/ui/theme';
import { tokens } from '@/ui/tokens';

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
  const theme = getThemeForRank(currentRank.id);

  return (
    <div 
      className={cn(
        'relative overflow-hidden rounded-2xl',
        theme.cardClass,
        'p-5',
        className
      )}
      style={{ minHeight: tokens.minTouchTarget }}
    >
      {/* Rank glow effect - respects theme intensity */}
      {theme.glowOpacity > 0 && (
        <div 
          className={cn(
            "absolute inset-0 pointer-events-none",
            getAnimationClass('animate-pulse-gold')
          )}
          style={{
            background: `radial-gradient(circle at 50% 0%, ${currentRank.glowColor}, transparent 70%)`,
            opacity: theme.glowOpacity,
          }}
        />
      )}

      {/* Shield Status */}
      <div className="relative flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div 
            className={cn(
              'w-11 h-11 rounded-xl flex items-center justify-center',
              shieldActive ? 'bg-techBlue/20' : 'bg-silver/10'
            )}
            style={{ minWidth: tokens.minTouchTarget, minHeight: tokens.minTouchTarget }}
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
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg',
            theme.badgeClass
          )}
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
          <p className={cn('text-sm font-display', theme.headerColor)}>
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
