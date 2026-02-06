/**
 * Home Dashboard
 * 
 * Main dashboard with correct signal hierarchy:
 * 1) Top: Shield status + current rank + next unlock progress
 * 2) Middle: two streaks (side-by-side)
 * 3) Then: Today points + CTA for Quick Win
 * 4) Then: weekly challenge mini-card
 * 5) Then: small stats row (urges resisted, minutes reclaimed)
 * 
 * Renders solely from persisted progress + logs.
 * Memoized aggregations for smooth performance.
 */

import { useCallback, useState } from 'react';
import { Coffee } from 'lucide-react';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useStrengthPoints } from '@/hooks/useStrengthPoints';
import { useUtilityPass } from '@/hooks/useUtilityPass';
import {
  RankHeaderCard,
  StreakRow,
  StrengthPointsCard,
  QuickWinCTA,
  WeeklyChallengeMiniCard,
  StatsMiniRow,
} from '@/components/dashboard';
import { UtilityPassBanner, UtilityPassModal } from '@/components/utility-pass';
import { toast } from '@/hooks/use-toast';
import { DEFAULT_USER_PROGRESS } from '@/models/UserProgress';

const HomeDashboard = () => {
  const stats = useDashboardStats();
  const { recordAction } = useStrengthPoints();
  const { isActive, remainingFormatted, startPass, endPassEarly } = useUtilityPass();
  const [isQuickWinActive, setIsQuickWinActive] = useState(false);
  const [showUtilityPassModal, setShowUtilityPassModal] = useState(false);

  // Handle quick win start
  const handleQuickWinStart = useCallback(() => {
    if (isQuickWinActive) return;
    
    setIsQuickWinActive(true);
    
    toast({
      title: 'Reset. Rebuild. Return.',
      description: '10-minute focus session started',
      duration: 3000,
    });

    // Simulate 10-minute timer completion (in real app, use actual timer)
    // For now, auto-complete after a short delay for demo
    setTimeout(() => {
      setIsQuickWinActive(false);
      recordAction('DAILY_CHECK_IN'); // Use appropriate action
      
      toast({
        title: 'That was a win.',
        description: '+8 SP earned for completing focus session',
        duration: 3000,
      });
    }, 5000); // 5 seconds for demo
  }, [isQuickWinActive, recordAction]);

  // Handle weekly challenge tap
  const handleChallengeTap = useCallback(() => {
    toast({
      title: 'Weekly Challenge',
      description: 'Challenge details coming soon',
      duration: 2000,
    });
  }, []);

  // Handle utility pass completion
  const handleUtilityPassComplete = useCallback((reason: any, duration: any, gateLevel: number) => {
    startPass(reason, duration, gateLevel);
    setShowUtilityPassModal(false);
  }, [startPass]);

  if (stats.isLoading) {
    return (
      <div className="min-h-screen pb-24 warroom-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 warroom-bg relative overflow-hidden">
      {/* Utility Pass Banner (if active) */}
      {isActive && (
        <UtilityPassBanner
          remainingFormatted={remainingFormatted}
          onEndEarly={endPassEarly}
        />
      )}
      
      {/* Golden beam accent */}
      <div className="golden-beam" />
      
      {/* Atmospheric overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-gold/5 via-transparent to-transparent blur-3xl" />
      </div>

      {/* Header */}
      <header className={`relative z-10 px-5 pb-2 text-center ${isActive ? 'pt-24' : 'pt-10'}`}>
        <div className="flex items-center justify-center gap-3">
          <span className="text-gold/40">◆</span>
          <h1 className="font-display text-2xl text-gold tracking-wider">
            Miracle Worker
          </h1>
          <span className="text-gold/40">◆</span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Welcome Back, Champion
        </p>
      </header>

      <main className="relative z-10 px-4 space-y-4 pb-6">
        
        {/* === SECTION 1: Rank + Shield Status + Next Unlock === */}
        <section>
          <RankHeaderCard
            rankProgress={stats.rankProgress}
            shieldActive={true}
          />
        </section>

        {/* === SECTION 2: Dual Streaks === */}
        <section>
          <StreakRow
            shieldStreak={stats.shieldStreak}
            strengthStreak={stats.strengthStreak}
          />
        </section>

        {/* === SECTION 3: Today's Points + Quick Win CTA === */}
        <section className="space-y-3">
          <StrengthPointsCard
            todaySP={stats.todaySP}
            totalSP={stats.totalSP}
          />
          
          <QuickWinCTA
            onStart={handleQuickWinStart}
            isActive={isQuickWinActive}
          />
        </section>

        {/* === SECTION 4: Weekly Challenge === */}
        <section>
          <WeeklyChallengeMiniCard
            challengeId={stats.weeklyChallenge.id}
            weeklyProgress={stats.weeklyChallenge.weeklyProgress}
            onTap={handleChallengeTap}
          />
        </section>

        {/* === SECTION 5: Need a Break? === */}
        <section>
          <button
            onClick={() => setShowUtilityPassModal(true)}
            disabled={isActive}
            className={`w-full py-4 px-4 rounded-xl border transition-all duration-200 flex items-center justify-center gap-3 ${
              isActive 
                ? 'border-silver/20 bg-cathedral-deep/30 text-silver/50 cursor-not-allowed' 
                : 'border-silver/30 bg-cathedral-deep/50 text-silver hover:border-techBlue/50 hover:text-techBlue'
            }`}
          >
            <Coffee className="w-4 h-4" />
            <span className="font-display text-sm tracking-wider">
              {isActive ? 'Break in progress...' : 'Need a break?'}
            </span>
          </button>
        </section>

        {/* === SECTION 6: Stats Mini Row === */}
        <section className="pt-2">
          <StatsMiniRow
            urgesResisted={stats.urgesResistedThisWeek}
            minutesReclaimed={stats.minutesReclaimed}
          />
        </section>

        {/* Motivational footer */}
        <section className="pt-4 text-center">
          <p className="text-xs text-muted-foreground font-display tracking-widest">
            NO SHAME. NEXT MOVE.
          </p>
        </section>

      </main>

      {/* Utility Pass Modal */}
      <UtilityPassModal
        isOpen={showUtilityPassModal}
        onClose={() => setShowUtilityPassModal(false)}
        onComplete={handleUtilityPassComplete}
        progress={DEFAULT_USER_PROGRESS}
      />
    </div>
  );
};

export default HomeDashboard;
