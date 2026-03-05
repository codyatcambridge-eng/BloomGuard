import { Shield, Star, Clock, XCircle, Target, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { useStrengthPoints } from "@/hooks/useStrengthPoints";
import { CathedralCard } from "@/components/ui/CathedralCard";
import { StreakCard } from "@/components/ui/StreakCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { LegacyTree } from "@/components/ui/LegacyTree";
import { useEffect } from "react";
import { toast } from "@/hooks/use-toast";

const Home = () => {
  const navigate = useNavigate();
  const { settings, isLoaded: settingsLoaded } = useLocalSettings();
  const { 
    streaks, 
    rankProgress, 
    todaySP, 
    totalSP,
    todayResistance,
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

  // Placeholder values for features not yet implemented
  const minutesReclaimed = 96;
  const weeklyChallenge = { current: 3, total: 4, label: "Complete 4 Devotionals" };
  
  // Next unlock info from rank progress
  const nextUnlock = rankProgress?.nextRank 
    ? { name: rankProgress.nextRank.name, current: totalSP, target: rankProgress.nextRank.requiredSP }
    : { name: "Max Rank", current: totalSP, target: totalSP };

  const handleStartWin = () => {
    recordAction('DAILY_CHECK_IN', 'Started a 10-Minute Win');
    toast({
      title: "10-Minute Win Started",
      description: "Focus on something meaningful. You've got this!",
    });
  };

  return (
    <div className="min-h-screen pb-24 warroom-bg relative overflow-x-hidden flex flex-col">
      {/* Golden beam accent */}
      <div className="golden-beam" />
      
      {/* Atmospheric overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[500px] bg-gradient-to-b from-gold/10 via-transparent to-transparent blur-3xl opacity-60" />
        <div className="absolute bottom-0 left-0 w-full h-[300px] bg-gradient-to-t from-cathedral-deep via-cathedral-deep/80 to-transparent" />
      </div>

      {/* 1. HERO SECTION (Dominant Centerpiece) */}
      <section className="relative z-10 flex flex-col items-center justify-center pt-8 pb-4 min-h-[45vh]">
        {/* Header Text */}
        <div className="text-center mb-2 animate-fade-in">
          <h1 className="font-display text-3xl text-gold tracking-widest uppercase drop-shadow-md">
            Bloom Guard
          </h1>
          <div className="flex items-center justify-center gap-2 mt-1">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-gold/50" />
            <p className="text-xs text-silver tracking-[0.2em] uppercase">
              Welcome Back, Champion
            </p>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-gold/50" />
          </div>
        </div>

        {/* The Tree (Hero) */}
        <div className="flex-1 flex items-center justify-center w-full relative">
          <LegacyTree size="hero" glowIntensity="high" className="scale-110 translate-y-2" />
          
          {/* Subtle label below tree */}
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex items-center gap-2 opacity-60">
            <span className="text-gold/50 text-[10px]">◆</span>
            <span className="font-display text-xs text-gold/80 tracking-widest uppercase">Legacy Tree</span>
            <span className="text-gold/50 text-[10px]">◆</span>
          </div>
        </div>
      </section>

      {/* 2. STATS ORBIT (Secondary & Quieter) */}
      <main className="relative z-10 px-4 space-y-3">
        {/* Streaks - Visual Anchor for content */}
        <div className="grid grid-cols-2 gap-3">
          <StreakCard type="shield" days={streaks.shieldStreak} className="bg-cathedral-deep/40 border-silver/10 backdrop-blur-sm" />
          <StreakCard type="strength" days={streaks.strengthStreak} className="bg-cathedral-deep/40 border-silver/10 backdrop-blur-sm" />
        </div>

        {/* 3. PROGRESS INDICATORS (Tertiary) */}
        {/* Compact stats row */}
        <div className="grid grid-cols-2 gap-3">
          {/* Left Column: Stats */}
          <div className="space-y-2">
            <div className="flex items-center justify-between px-3 py-2 rounded-md bg-cathedral-deep/30 border border-silver/5">
              <div className="flex items-center gap-2">
                <Star className="w-3 h-3 text-gold" />
                <span className="text-[10px] text-silver uppercase tracking-wide">Today's SP</span>
              </div>
              <span className="font-display text-lg text-gold">+{todaySP}</span>
            </div>
            
            <div className="flex items-center justify-between px-3 py-2 rounded-md bg-cathedral-deep/30 border border-silver/5">
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-tech-blue" />
                <span className="text-[10px] text-silver uppercase tracking-wide">Minutes</span>
              </div>
              <span className="font-display text-lg text-tech-blue">{minutesReclaimed}</span>
            </div>
          </div>

          {/* Right Column: Next Unlock */}
          <div className="p-3 rounded-md bg-cathedral-deep/30 border border-silver/5 flex flex-col justify-center gap-1">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <Target className="w-3 h-3 text-gold" />
                <span className="text-[10px] text-silver uppercase tracking-wide">Next Rank</span>
              </div>
              <span className="text-[10px] text-gold/80">{nextUnlock.current}/{nextUnlock.target}</span>
            </div>
            <p className="text-xs text-gold font-display truncate mb-1">{nextUnlock.name}</p>
            <ProgressBar 
              value={nextUnlock.current} 
              max={nextUnlock.target} 
              showValues={false}
              variant="gold"
              className="h-1"
            />
          </div>
        </div>
        
        {/* Urges Row (Full width, very subtle) */}
        <div className="flex items-center justify-center gap-3 py-1 opacity-70">
          <XCircle className="w-3 h-3 text-flame" />
          <span className="text-xs text-silver tracking-wide">Urges Resisted Today: <span className="text-flame font-display">{todayResistance}</span></span>
        </div>

        {/* 4. PRIMARY ACTION & Weekly Challenge */}
        <div className="grid grid-cols-2 gap-3 mt-2">
          {/* Weekly Challenge (Secondary) */}
          <div 
            className="p-4 rounded-lg bg-cathedral-deep/40 border border-silver/10 relative overflow-hidden group cursor-pointer"
            onClick={() => navigate('/growth')}
          >
            <div className="absolute top-0 left-0 w-1 h-full bg-silver/20" />
            <h3 className="font-display text-xs text-silver/80 mb-1 uppercase tracking-wider">Weekly Goal</h3>
            <p className="text-[10px] text-silver/60 mb-2 truncate">{weeklyChallenge.label}</p>
            <p className="font-display text-xl text-silver group-hover:text-gold transition-colors">
              {weeklyChallenge.current} <span className="text-sm opacity-50">/ {weeklyChallenge.total}</span>
            </p>
          </div>
          
          {/* CTA (Primary) */}
          <button 
            onClick={handleStartWin}
            className="relative p-4 rounded-lg overflow-hidden group text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            {/* Background with Gold Gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-gold/20 to-cathedral-deep border border-gold/30" />
            <div className="absolute inset-0 bg-gold/5 opacity-0 group-hover:opacity-100 transition-opacity" />
            
            <div className="relative z-10">
              <h3 className="font-display text-xs text-gold mb-1 uppercase tracking-wider flex items-center gap-1">
                <Play className="w-3 h-3 fill-gold" /> Start Win
              </h3>
              <p className="text-[10px] text-gold/70 mb-2">10-Minute Focus</p>
              <span className="inline-block text-xs font-display text-cathedral-midnight bg-gold px-3 py-1 rounded-sm mt-1">
                BEGIN
              </span>
            </div>
          </button>
        </div>
      </main>
    </div>
  );
};

export default Home;
