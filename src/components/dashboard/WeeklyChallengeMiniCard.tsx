/**
 * Weekly Challenge Mini Card
 * 
 * Compact display of current weekly challenge progress.
 */

import { cn } from '@/lib/utils';
import { Target, ChevronRight } from 'lucide-react';
import { getChallengeById } from '@/logic/challengeCatalog';

interface WeeklyChallengeMiniCardProps {
  challengeId: string | null;
  progress: number;
  target: number;
  onTap?: () => void;
  className?: string;
}

export function WeeklyChallengeMiniCard({
  challengeId,
  progress,
  target,
  onTap,
  className,
}: WeeklyChallengeMiniCardProps) {
  const challenge = challengeId ? getChallengeById(challengeId) : null;
  const progressPercent = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
  const isComplete = progress >= target;

  // Placeholder when no challenge is active
  if (!challenge) {
    return (
      <div 
        className={cn(
          'p-4 rounded-xl',
          'bg-cathedral-deep/50 border border-silver/10',
          'flex items-center justify-between',
          className
        )}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-silver/10 flex items-center justify-center">
            <Target className="w-5 h-5 text-silver/50" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              Weekly Challenge
            </p>
            <p className="text-xs text-silver/50">
              No challenge active
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={onTap}
      className={cn(
        'w-full p-4 rounded-xl text-left',
        'transition-all duration-200 active:scale-[0.98]',
        isComplete 
          ? 'bg-gold/10 border border-gold/30'
          : 'bg-cathedral-deep/50 border border-silver/10 hover:border-silver/30',
        className
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center',
            isComplete ? 'bg-gold/20' : 'bg-techBlue/20'
          )}>
            <Target className={cn(
              'w-5 h-5',
              isComplete ? 'text-gold' : 'text-techBlue'
            )} />
          </div>
          <div>
            <p className={cn(
              'text-sm font-medium',
              isComplete ? 'text-gold' : 'text-foreground'
            )}>
              {challenge.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {isComplete ? 'Complete!' : `${progress}/${target}`}
            </p>
          </div>
        </div>
        
        <ChevronRight className="w-4 h-4 text-silver/50" />
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-cathedral-dark overflow-hidden">
        <div 
          className={cn(
            'h-full rounded-full transition-all duration-500',
            isComplete ? 'bg-gold' : 'bg-techBlue'
          )}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {isComplete && (
        <p className="text-xs text-gold mt-2 font-display">
          That was a win.
        </p>
      )}
    </button>
  );
}
