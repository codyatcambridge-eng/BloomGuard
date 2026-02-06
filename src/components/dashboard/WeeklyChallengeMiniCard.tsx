/**
 * Weekly Challenge Mini Card
 * 
 * Compact display of current weekly challenge progress.
 * Now integrated with challengeEngine.
 */

import { cn } from '@/lib/utils';
import { Target, ChevronRight, Shield, Zap, Heart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { 
  WeeklyChallengeType, 
  WEEKLY_CHALLENGES,
  calculateChallengeProgress,
} from '@/logic/challengeEngine';

interface WeeklyChallengeMiniCardProps {
  challengeId: string | null;
  weeklyProgress: Record<string, number>;
  onTap?: () => void;
  className?: string;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Shield,
  Zap,
  Target,
  Heart,
};

export function WeeklyChallengeMiniCard({
  challengeId,
  weeklyProgress,
  onTap,
  className,
}: WeeklyChallengeMiniCardProps) {
  const navigate = useNavigate();
  
  const challengeType = challengeId as WeeklyChallengeType | null;
  const challenge = challengeType ? WEEKLY_CHALLENGES[challengeType] : null;
  
  // Calculate progress using challengeEngine
  const progress = challengeType 
    ? calculateChallengeProgress(challengeType, weeklyProgress)
    : 0;
  const target = challenge?.goal ?? 0;
  const progressPercent = target > 0 ? Math.min(100, Math.round((progress / target) * 100)) : 0;
  const isComplete = progress >= target;
  
  const handleTap = () => {
    if (onTap) {
      onTap();
    } else {
      navigate('/challenges');
    }
  };

  // Placeholder when no challenge is active
  if (!challenge) {
    return (
      <button
        onClick={handleTap}
        className={cn(
          'w-full p-4 rounded-xl text-left',
          'bg-cathedral-deep/50 border border-silver/10',
          'flex items-center justify-between',
          'hover:border-silver/30 transition-colors',
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
              Tap to activate
            </p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-silver/50" />
      </button>
    );
  }

  const Icon = iconMap[challenge.icon] ?? Target;

  return (
    <button
      onClick={handleTap}
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
            <Icon className={cn(
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
              {isComplete ? 'Complete!' : `${Math.floor(progress)}/${target}`}
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
