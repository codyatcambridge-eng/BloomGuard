import { Shield, Flame } from "lucide-react";
import { cn } from "@/lib/utils";

interface StreakCardProps {
  type: "shield" | "strength";
  days: number;
  className?: string;
}

export const StreakCard = ({ type, days, className }: StreakCardProps) => {
  const isShield = type === "shield";
  
  return (
    <div 
      className={cn(
        "cathedral-card flex items-center gap-3 p-4",
        className
      )}
    >
      <div 
        className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center",
          isShield 
            ? "bg-techBlue/20 border border-techBlue/30" 
            : "bg-flame/20 border border-flame/30"
        )}
      >
        {isShield ? (
          <Shield className="w-5 h-5 text-tech-blue" />
        ) : (
          <Flame className="w-5 h-5 text-flame" />
        )}
      </div>
      <div>
        <p className="text-xs text-silver tracking-wide">
          {isShield ? "Shield Streak" : "Strength Streak"}
        </p>
        <p className={cn(
          "font-display text-xl",
          isShield ? "text-tech-blue" : "text-flame"
        )}>
          {days} Days
        </p>
      </div>
    </div>
  );
};
