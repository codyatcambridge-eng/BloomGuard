import { Trophy, Zap, Calendar } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { RankProgress, getProgressMessage } from "@/lib/ranks";

interface RankProgressCardProps {
  progress: RankProgress;
  todaySP: number;
}

export function RankProgressCard({ progress, todaySP }: RankProgressCardProps) {
  const { currentRank, nextRank, totalSP, spProgress, daysProgress, spToNextRank, daysToNextRank } = progress;
  const progressMessage = getProgressMessage(progress);

  return (
    <div className="cathedral-card p-5 space-y-4">
      {/* Current Rank */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div 
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ 
              background: `radial-gradient(circle, ${currentRank.glowColor}, transparent)`,
              boxShadow: `0 0 20px ${currentRank.glowColor}`,
            }}
          >
            <Trophy 
              className="w-6 h-6" 
              style={{ color: currentRank.color }}
            />
          </div>
          <div>
            <h3 
              className="font-display text-lg tracking-wider"
              style={{ color: currentRank.color }}
            >
              {currentRank.title.toUpperCase()}
            </h3>
            <p className="text-xs text-muted-foreground">
              {currentRank.description}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl text-gold">
            {totalSP}
          </p>
          <p className="text-xs text-muted-foreground">TOTAL SP</p>
        </div>
      </div>

      {/* Today's Progress */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-cathedral-deep/50 border border-silver/10">
        <Zap className="w-5 h-5 text-gold" />
        <div className="flex-1">
          <p className="text-sm text-foreground">Today's Earnings</p>
        </div>
        <p className="font-display text-lg text-gold">+{todaySP} SP</p>
      </div>

      {/* Next Rank Progress */}
      {nextRank && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-display tracking-wider text-muted-foreground">
              NEXT: {nextRank.name.toUpperCase()}
            </span>
            <span className="text-xs text-silver">
              {progress.overallProgress}%
            </span>
          </div>
          
          {/* SP Progress */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Zap className="w-3 h-3" /> Strength Points
              </span>
              <span className="text-silver">{spToNextRank} SP to go</span>
            </div>
            <Progress 
              value={spProgress} 
              className="h-2 bg-cathedral-deep"
            />
          </div>

          {/* Days Progress */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Active Days
              </span>
              <span className="text-silver">{daysToNextRank} days to go</span>
            </div>
            <Progress 
              value={daysProgress} 
              className="h-2 bg-cathedral-deep"
            />
          </div>

          {/* Encouragement */}
          <p className="text-xs text-center text-silver italic">
            {progressMessage}
          </p>
        </div>
      )}

      {/* Max Rank Achieved */}
      {!nextRank && (
        <div className="text-center py-4">
          <p className="font-display text-lg text-gold tracking-wider">
            MAXIMUM RANK ACHIEVED
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {progressMessage}
          </p>
        </div>
      )}
    </div>
  );
}
