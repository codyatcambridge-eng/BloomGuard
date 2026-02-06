import { Shield, Flame, Clock, Zap, Star, Target, Dumbbell, BookOpen, Heart, MessageCircle, Play } from "lucide-react";
import { useStrengthPoints } from "@/hooks/useStrengthPoints";
import { CathedralCard } from "@/components/ui/CathedralCard";
import { StreakCard } from "@/components/ui/StreakCard";
import { LegacyTree } from "@/components/ui/LegacyTree";
import { StatRow } from "@/components/ui/StatRow";
import { NEXT_MOVE_OPTIONS } from "@/logic/recovery";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Target,
  Dumbbell,
  BookOpen,
  Heart,
  MessageCircle,
};

const Growth = () => {
  const { 
    streaks, 
    totalSP, 
    todaySP,
    todayResistance,
    todayGrowth,
    isLoaded,
    recordAction,
  } = useStrengthPoints();

  // Calculate weekly SP (placeholder - would need transaction history)
  const weekSP = todaySP * 3; // Placeholder calculation
  
  // Placeholder stats
  const timeShielded = 95;
  const growthActivities = 21;
  const positiveImpacts = 8;
  const panicButtonUses = 6;

  const handleToolkitAction = (actionId: string, points: number) => {
    // Map recovery next moves to SP actions
    const actionMap: Record<string, string> = {
      'QUICK_WIN_10': 'DAILY_CHECK_IN',
      'WORKOUT': 'REPLACEMENT_ACTION',
      'JOURNAL': 'REFLECTION_LOGGED',
      'DEVOTIONAL': 'GOAL_REVIEWED',
      'TEXT_BUDDY': 'ACCOUNTABILITY_MESSAGE',
    };
    
    const spAction = actionMap[actionId];
    if (spAction) {
      recordAction(spAction as any);
    }
    
    toast({
      title: `+${points} SP`,
      description: 'Growth action logged!',
      duration: 2000,
    });
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen pb-24 warroom-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 warroom-bg relative overflow-hidden">
      {/* Golden beam accent */}
      <div className="golden-beam" />
      
      {/* Atmospheric overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[500px] bg-gradient-to-b from-gold/5 via-transparent to-transparent blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 px-5 pt-10 pb-4 text-center">
        <div className="flex items-center justify-center gap-3">
          <span className="text-gold/40">◆</span>
          <h1 className="font-display text-3xl text-gold tracking-wider">
            Growth
          </h1>
          <span className="text-gold/40">◆</span>
        </div>
      </header>

      <main className="relative z-10 px-4 space-y-5 pb-6">
        {/* Legacy Tree - Hero Element */}
        <section className="flex flex-col items-center py-6">
          <LegacyTree size="large" glowIntensity="high" />
        </section>

        {/* SP Stats */}
        <section className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Star className="w-5 h-5 text-gold" />
            <p className="font-display text-2xl text-gold">+{weekSP} SP This Week</p>
          </div>
          <p className="font-display text-3xl text-foreground">+{totalSP.toLocaleString()} SP Total</p>
        </section>

        {/* Dual Streak Cards */}
        <section className="grid grid-cols-2 gap-3">
          <StreakCard type="shield" days={streaks.shieldStreak} />
          <StreakCard type="strength" days={streaks.strengthStreak} />
        </section>

        {/* Growth Toolkit */}
        <CathedralCard>
          <h3 className="font-display text-sm text-gold mb-4 text-center tracking-wider">
            GROWTH TOOLKIT
          </h3>
          <div className="space-y-2">
            {NEXT_MOVE_OPTIONS.map((option) => {
              const Icon = ICON_MAP[option.icon] ?? Target;
              
              return (
                <button
                  key={option.id}
                  onClick={() => handleToolkitAction(option.id, option.points)}
                  className={cn(
                    'w-full flex items-center gap-4 p-3 rounded-xl',
                    'border border-silver/10 bg-cathedral-deep/30',
                    'hover:border-gold/30 hover:bg-cathedral-deep/50',
                    'transition-all duration-200 active:scale-[0.98]',
                    'text-left'
                  )}
                >
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-silver/10 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-silver" />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {option.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gold">+{option.points}</span>
                    <Play className="w-4 h-4 text-silver/50" />
                  </div>
                </button>
              );
            })}
          </div>
        </CathedralCard>

        {/* Detailed Stats */}
        <CathedralCard>
          <div className="grid grid-cols-2 gap-x-6">
            <StatRow 
              icon={Clock} 
              label="Time Shielded" 
              value={`${timeShielded} Min`}
              iconColor="text-tech-blue"
              valueColor="text-tech-blue"
            />
            <StatRow 
              icon={Zap} 
              label="Growth Activities" 
              value={`${growthActivities}x`}
              iconColor="text-gold"
              valueColor="text-gold"
            />
            <StatRow 
              icon={Shield} 
              label="Panic Button" 
              value={`${panicButtonUses}x`}
              iconColor="text-tech-blue"
              valueColor="text-tech-blue"
            />
            <StatRow 
              icon={Target} 
              label="Positive Impacts" 
              value={`${positiveImpacts}x`}
              iconColor="text-gold"
              valueColor="text-gold"
            />
          </div>
        </CathedralCard>

        {/* Today's Summary */}
        <CathedralCard variant="gold">
          <h3 className="font-display text-sm text-gold mb-3 text-center">Today's Progress</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="font-display text-2xl text-gold">+{todaySP}</p>
              <p className="text-xs text-silver">SP Earned</p>
            </div>
            <div>
              <p className="font-display text-2xl text-flame">{todayResistance}</p>
              <p className="text-xs text-silver">Resisted</p>
            </div>
            <div>
              <p className="font-display text-2xl text-tech-blue">{todayGrowth}</p>
              <p className="text-xs text-silver">Growth Acts</p>
            </div>
          </div>
        </CathedralCard>
      </main>
    </div>
  );
};

export default Growth;
