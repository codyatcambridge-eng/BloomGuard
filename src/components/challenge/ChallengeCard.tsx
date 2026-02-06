/**
 * Challenge Card Component
 * Displays a weekly challenge with progress and status
 */

import { Shield, Zap, Target, Heart, Check, Clock } from 'lucide-react';
import { CathedralCard } from '@/components/ui/CathedralCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Badge } from '@/components/ui/badge';
import { 
  WeeklyChallengeType, 
  WeeklyChallengeDefinition,
  WEEKLY_CHALLENGES,
  getChallengeProgressPercent,
} from '@/logic/challengeEngine';
import { cn } from '@/lib/utils';

interface ChallengeCardProps {
  challengeType: WeeklyChallengeType;
  current: number;
  completed: boolean;
  rewardClaimed: boolean;
  weekISO: string;
  onClaimReward?: () => void;
  className?: string;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Shield,
  Zap,
  Target,
  Heart,
};

export const ChallengeCard = ({
  challengeType,
  current,
  completed,
  rewardClaimed,
  weekISO,
  onClaimReward,
  className,
}: ChallengeCardProps) => {
  const definition = WEEKLY_CHALLENGES[challengeType];
  
  if (!definition) return null;
  
  const Icon = iconMap[definition.icon] ?? Target;
  const progressPercent = Math.min(100, Math.round((current / definition.goal) * 100));
  
  // Format display value - handle FOCUS_KNIGHT's fractional progress
  const displayCurrent = challengeType === 'FOCUS_KNIGHT' 
    ? Math.floor(current) 
    : Math.round(current);
  
  return (
    <CathedralCard 
      variant={completed ? 'gold' : 'default'}
      className={cn('p-4 space-y-3', className)}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center",
            completed 
              ? "bg-gold/20 text-gold" 
              : "bg-silver/10 text-silver"
          )}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display text-foreground text-sm font-medium">
              {definition.name}
            </h3>
            <p className="text-xs text-muted-foreground">{weekISO}</p>
          </div>
        </div>
        
        {/* Status Badge */}
        {completed ? (
          rewardClaimed ? (
            <Badge variant="default" className="bg-gold/20 text-gold border-gold/30">
              <Check className="w-3 h-3 mr-1" />
              Claimed
            </Badge>
          ) : (
            <Badge 
              variant="default"
              className="bg-gold text-obsidian cursor-pointer hover:bg-gold/90 animate-pulse"
              onClick={onClaimReward}
            >
              Claim +{definition.spReward} SP
            </Badge>
          )
        ) : (
          <Badge variant="outline" className="text-silver border-silver/30">
            <Clock className="w-3 h-3 mr-1" />
            Active
          </Badge>
        )}
      </div>
      
      {/* Description */}
      <p className="text-sm text-silver/80">{definition.description}</p>
      
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{definition.goalDescription}</span>
          <span className={cn(
            "font-display font-medium",
            completed ? "text-gold" : "text-silver"
          )}>
            {displayCurrent} / {definition.goal}
          </span>
        </div>
        <ProgressBar 
          value={displayCurrent}
          max={definition.goal}
          variant={completed ? 'gold' : 'silver'}
          showValues={false}
        />
      </div>
      
      {/* Reward Preview */}
      {!completed && (
        <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
          <span>Reward:</span>
          <span className="text-gold font-display">+{definition.spReward} SP</span>
          <span>+</span>
          <span className="text-accent-amber">🏆 Badge</span>
        </div>
      )}
    </CathedralCard>
  );
};
