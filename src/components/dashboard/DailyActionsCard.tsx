import { Target, Dumbbell, BookOpen, MessageCircle } from "lucide-react";
import { SPAction } from "@/lib/points";

interface DailyActionsCardProps {
  onRecordAction: (action: SPAction, description?: string) => void;
  todayResistance: number;
  todayGrowth: number;
}

export function DailyActionsCard({ 
  onRecordAction, 
  todayResistance, 
  todayGrowth 
}: DailyActionsCardProps) {
  const quickActions = [
    {
      action: 'DAILY_CHECK_IN' as SPAction,
      icon: Target,
      label: 'Check In',
      points: 5,
      color: 'text-aqua',
    },
    {
      action: 'REFLECTION_LOGGED' as SPAction,
      icon: BookOpen,
      label: 'Reflect',
      points: 10,
      color: 'text-gold',
    },
    {
      action: 'ACCOUNTABILITY_MESSAGE' as SPAction,
      icon: MessageCircle,
      label: 'Connect',
      points: 8,
      color: 'text-silver',
    },
    {
      action: 'GOAL_REVIEWED' as SPAction,
      icon: Dumbbell,
      label: 'Train',
      points: 3,
      color: 'text-aqua',
    },
  ];

  return (
    <div className="cathedral-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xs tracking-widest text-muted-foreground">
          DAILY ACTIONS
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-aqua">{todayResistance} resistance</span>
          <span className="text-gold">{todayGrowth} growth</span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {quickActions.map(({ action, icon: Icon, label, points, color }) => (
          <button
            key={action}
            onClick={() => onRecordAction(action)}
            className="flex flex-col items-center gap-2 p-3 rounded-lg bg-cathedral-deep/50 border border-silver/10 hover:border-aqua/30 transition-all active:scale-95"
          >
            <Icon className={`w-5 h-5 ${color}`} />
            <span className="text-xs text-foreground">{label}</span>
            <span className="text-xs text-gold">+{points}</span>
          </button>
        ))}
      </div>

      <p className="text-xs text-center text-muted-foreground">
        Tap to log your daily disciplines and earn SP
      </p>
    </div>
  );
}
