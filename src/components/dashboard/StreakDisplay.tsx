import { Shield, Zap, Flame, Trophy } from "lucide-react";
import { StreakData } from "@/hooks/useStrengthPoints";

interface StreakDisplayProps {
  streaks: StreakData;
}

export function StreakDisplay({ streaks }: StreakDisplayProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Shield Streak */}
      <div className="cathedral-card p-4 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-aqua" />
          <span className="font-display text-xs tracking-wider text-muted-foreground">
            SHIELD STREAK
          </span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-display text-3xl text-aqua drop-shadow-[0_0_10px_hsl(180_100%_50%/0.5)]">
            {streaks.shieldStreak}
          </span>
          <span className="text-xs text-muted-foreground">days</span>
        </div>
        <p className="text-xs text-muted-foreground text-center">
          No overrides
        </p>
        {streaks.longestShieldStreak > streaks.shieldStreak && (
          <p className="text-xs text-silver/60">
            Best: {streaks.longestShieldStreak}
          </p>
        )}
      </div>

      {/* Strength Streak */}
      <div className="cathedral-card p-4 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-gold" />
          <span className="font-display text-xs tracking-wider text-muted-foreground">
            STRENGTH STREAK
          </span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-display text-3xl text-gold drop-shadow-[0_0_10px_hsl(var(--gold)/0.5)]">
            {streaks.strengthStreak}
          </span>
          <span className="text-xs text-muted-foreground">days</span>
        </div>
        <p className="text-xs text-muted-foreground text-center">
          Daily growth
        </p>
        {streaks.longestStrengthStreak > streaks.strengthStreak && (
          <p className="text-xs text-silver/60">
            Best: {streaks.longestStrengthStreak}
          </p>
        )}
      </div>
    </div>
  );
}
