/**
 * Share Card Component
 * 
 * Render-only card displaying safe stats for sharing.
 * Contains NO explicit content or browsing info.
 */

import { Shield, Flame, Target, Trophy } from 'lucide-react';
import { RankId } from '@/models/UserProgress';
import { getRankById } from '@/logic/rank';
import { 
  WeeklyChallengeType, 
  WEEKLY_CHALLENGES,
  getChallengeProgressPercent,
} from '@/logic/challengeEngine';
import { cn } from '@/lib/utils';

interface ShareCardProps {
  // Safe stats only - no browsing/content data
  currentRank: RankId;
  shieldStreakDays: number;
  strengthStreakDays: number;
  totalSP: number;
  weeklyChallengeId: WeeklyChallengeType | null;
  weeklyProgress: Record<string, number>;
  className?: string;
}

export const ShareCard = ({
  currentRank,
  shieldStreakDays,
  strengthStreakDays,
  totalSP,
  weeklyChallengeId,
  weeklyProgress,
  className,
}: ShareCardProps) => {
  const rank = getRankById(currentRank);
  const challenge = weeklyChallengeId ? WEEKLY_CHALLENGES[weeklyChallengeId] : null;
  const challengePercent = weeklyChallengeId 
    ? getChallengeProgressPercent(weeklyChallengeId, weeklyProgress) 
    : 0;
  
  return (
    <div 
      className={cn(
        "w-80 bg-gradient-to-br from-obsidian via-obsidian-light to-obsidian",
        "border border-gold/30 rounded-xl overflow-hidden",
        "shadow-2xl shadow-obsidian/50",
        className
      )}
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-gold/20 to-accent-amber/10 px-4 py-3 border-b border-gold/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-gold" />
            <span className="font-display text-gold text-sm">CHAMP</span>
          </div>
          <span className="text-xs text-silver/60">Discipline Tracker</span>
        </div>
      </div>
      
      {/* Rank Badge */}
      <div className="px-4 py-4 flex items-center justify-center">
        <div className={cn(
          "w-20 h-20 rounded-full flex items-center justify-center",
          "bg-gradient-to-br from-gold/30 to-accent-amber/10",
          "border-2 border-gold/40"
        )}>
          <div className="text-center">
            <Trophy className="w-8 h-8 text-gold mx-auto mb-1" />
            <span className="text-xs font-display text-gold">{rank.name}</span>
          </div>
        </div>
      </div>
      
      {/* Stats Grid */}
      <div className="px-4 pb-2 grid grid-cols-2 gap-3">
        {/* Shield Streak */}
        <div className="bg-obsidian-light/50 rounded-lg p-3 text-center border border-silver/10">
          <Shield className="w-4 h-4 text-silver mx-auto mb-1" />
          <div className="text-xl font-display text-foreground">{shieldStreakDays}</div>
          <div className="text-[10px] text-muted-foreground">Shield Days</div>
        </div>
        
        {/* Strength Streak */}
        <div className="bg-obsidian-light/50 rounded-lg p-3 text-center border border-silver/10">
          <Flame className="w-4 h-4 text-accent-amber mx-auto mb-1" />
          <div className="text-xl font-display text-foreground">{strengthStreakDays}</div>
          <div className="text-[10px] text-muted-foreground">Growth Days</div>
        </div>
      </div>
      
      {/* Total SP */}
      <div className="px-4 pb-3">
        <div className="bg-gradient-to-r from-gold/10 to-transparent rounded-lg p-3 text-center border border-gold/20">
          <div className="text-2xl font-display text-gold">{totalSP.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">Strength Points</div>
        </div>
      </div>
      
      {/* Weekly Challenge */}
      {challenge && (
        <div className="px-4 pb-3">
          <div className="bg-obsidian-light/30 rounded-lg p-3 border border-silver/10">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Target className="w-3 h-3 text-silver" />
                <span className="text-xs text-silver">{challenge.name}</span>
              </div>
              <span className="text-xs font-display text-gold">{challengePercent}%</span>
            </div>
            <div className="h-1.5 bg-obsidian rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-gold to-accent-amber rounded-full transition-all"
                style={{ width: `${challengePercent}%` }}
              />
            </div>
          </div>
        </div>
      )}
      
      {/* Footer Message */}
      <div className="px-4 py-3 bg-obsidian-light/30 border-t border-silver/10">
        <p className="text-xs text-center text-silver/70 italic">
          "You trained discipline."
        </p>
      </div>
    </div>
  );
};
