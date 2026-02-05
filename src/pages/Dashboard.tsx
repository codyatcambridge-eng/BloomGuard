import { Shield, Globe, Users, FileText, Settings as SettingsIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { useStrengthPoints } from "@/hooks/useStrengthPoints";
import { StreakDisplay } from "@/components/dashboard/StreakDisplay";
import { RankProgressCard } from "@/components/dashboard/RankProgressCard";
import { DailyActionsCard } from "@/components/dashboard/DailyActionsCard";
import { useEffect } from "react";

const Dashboard = () => {
  const navigate = useNavigate();
  const { settings, isLoaded: settingsLoaded } = useLocalSettings();
  const { 
    streaks, 
    rankProgress, 
    todaySP, 
    todayResistance, 
    todayGrowth,
    recordAction,
    markShieldActive,
    isLoaded: spLoaded,
  } = useStrengthPoints();

  // Sync shield status with SP system
  useEffect(() => {
    if (settingsLoaded && spLoaded) {
      markShieldActive(settings.shield_active);
    }
  }, [settings.shield_active, settingsLoaded, spLoaded, markShieldActive]);

  const quickActions = [
    { path: "/browser", icon: Globe, label: "Safe Browser", color: "text-aqua" },
    { path: "/accountability", icon: Users, label: "Partners", color: "text-gold" },
    { path: "/logs", icon: FileText, label: "Logs", color: "text-silver" },
    { path: "/settings", icon: SettingsIcon, label: "Settings", color: "text-aqua" },
  ];

  return (
    <div className="min-h-screen pb-24 warroom-bg relative overflow-hidden">
      {/* Atmospheric overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-aqua/5 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[300px] bg-gradient-to-tr from-cathedral-deep/40 via-transparent to-transparent" />
        <div className="absolute top-1/3 right-0 w-[300px] h-[400px] bg-gradient-to-l from-primary/20 via-transparent to-transparent" />
      </div>

      {/* Header */}
      <header className="relative z-10 px-4 pt-8 pb-4 border-b border-silver/20">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-aqua drop-shadow-[0_0_10px_hsl(180_100%_50%/0.5)]" />
          <div>
            <h1 className="font-display text-2xl tracking-wider">MIRACLE WORKER</h1>
            <p className="text-xs text-silver uppercase tracking-widest">
              {settings.shield_active ? 'Shield Active' : 'Shield Inactive'}
            </p>
          </div>
        </div>
      </header>

      <main className="relative z-10 px-4 space-y-5 py-5">
        {/* Dual Streak Display */}
        <section>
          <h2 className="font-display text-xs tracking-widest text-silver mb-3">
            YOUR STREAKS
          </h2>
          <StreakDisplay streaks={streaks} />
        </section>

        {/* Rank Progress */}
        {rankProgress && (
          <section>
            <h2 className="font-display text-xs tracking-widest text-silver mb-3">
              RANK PROGRESS
            </h2>
            <RankProgressCard progress={rankProgress} todaySP={todaySP} />
          </section>
        )}

        {/* Daily Actions */}
        <section>
          <DailyActionsCard 
            onRecordAction={recordAction}
            todayResistance={todayResistance}
            todayGrowth={todayGrowth}
          />
        </section>

        {/* Quick Actions */}
        <section>
          <h2 className="font-display text-xs tracking-widest text-silver mb-3">
            QUICK ACTIONS
          </h2>
          <div className="grid grid-cols-4 gap-2">
            {quickActions.map(({ path, icon: Icon, label, color }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="cathedral-card flex flex-col items-center gap-2 py-4 hover:border-aqua/50 transition-all"
              >
                <Icon className={`w-6 h-6 ${color}`} />
                <span className="font-display text-[10px] tracking-wider text-foreground">
                  {label.toUpperCase()}
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
