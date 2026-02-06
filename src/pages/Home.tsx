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
    <div className="min-h-screen pb-24 warroom-bg relative overflow-hidden">
      {/* Golden beam accent */}
      <div className="golden-beam" />
      
      {/* Atmospheric overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-gold/5 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[300px] bg-gradient-to-tr from-cathedral-deep/40 via-transparent to-transparent" />
      </div>

      {/* Header */}
      <header className="relative z-10 px-5 pt-10 pb-4 text-center">
        <h1 className="font-display text-3xl text-gold tracking-wider mb-1">
          Miracle Worker
        </h1>
        <p className="text-sm text-silver tracking-wide">
          Welcome Back, Champion!
        </p>
      </header>

      <main className="relative z-10 px-4 space-y-5 pb-6">
        {/* Legacy Tree Hero */}
        <section className="flex flex-col items-center py-4">
          <LegacyTree size="medium" glowIntensity="medium" />
          <div className="flex items-center gap-2 mt-4">
            <span className="text-silver text-sm">◆</span>
            <h2 className="font-display text-lg text-gold tracking-wider">Legacy Tree</h2>
            <span className="text-silver text-sm">◆</span>
          </div>
        </section>

        {/* Dual Streak Cards */}
        <section className="grid grid-cols-2 gap-3">
          <StreakCard type="shield" days={streaks.shieldStreak} />
          <StreakCard type="strength" days={streaks.strengthStreak} />
        </section>

        {/* Stats Grid */}
        <section className="grid grid-cols-2 gap-3">
          <CathedralCard className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gold/20 flex items-center justify-center">
              <Star className="w-4 h-4 text-gold" />
            </div>
            <div>
              <p className="text-xs text-silver">Today's SP</p>
              <p className="font-display text-xl text-gold">+{todaySP}</p>
            </div>
          </CathedralCard>
          
          <CathedralCard className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-flame/20 flex items-center justify-center">
              <XCircle className="w-4 h-4 text-flame" />
            </div>
            <div>
              <p className="text-xs text-silver">Urges Resisted</p>
              <p className="font-display text-xl text-flame">{todayResistance}</p>
            </div>
          </CathedralCard>
          
          <CathedralCard className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-techBlue/20 flex items-center justify-center">
              <Clock className="w-4 h-4 text-tech-blue" />
            </div>
            <div>
              <p className="text-xs text-silver">Minutes Reclaimed</p>
              <p className="font-display text-xl text-tech-blue">{minutesReclaimed} Min</p>
            </div>
          </CathedralCard>
          
          <CathedralCard className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-gold" />
              <p className="text-xs text-silver">Next Unlock</p>
            </div>
            <p className="text-xs text-gold font-display">{nextUnlock.name}</p>
            <ProgressBar 
              value={nextUnlock.current} 
              max={nextUnlock.target} 
              showValues={true}
              variant="gold"
            />
          </CathedralCard>
        </section>

        {/* Weekly Challenge & Start Win */}
        <section className="grid grid-cols-2 gap-3">
          <CathedralCard className="flex flex-col">
            <h3 className="font-display text-sm text-gold mb-2">Weekly Challenge</h3>
            <p className="text-xs text-silver mb-3">{weeklyChallenge.label}</p>
            <p className="font-display text-2xl text-gold mb-3">
              {weeklyChallenge.current} / {weeklyChallenge.total}
            </p>
            <PrimaryButton 
              variant="silver" 
              className="mt-auto w-full text-center justify-center"
              onClick={() => navigate('/growth')}
            >
              View Progress
            </PrimaryButton>
          </CathedralCard>
          
          <CathedralCard variant="gold" className="flex flex-col">
            <h3 className="font-display text-sm text-gold mb-2">Start a 10-Minute Win</h3>
            <p className="text-xs text-silver mb-3">Quick victory for a stronger day</p>
            <div className="flex-1" />
            <PrimaryButton 
              variant="gold" 
              className="w-full flex items-center justify-center gap-2"
              onClick={handleStartWin}
            >
              <Play className="w-4 h-4" />
              Begin Now
            </PrimaryButton>
          </CathedralCard>
        </section>
      </main>
    </div>
  );
};

export default Home;
