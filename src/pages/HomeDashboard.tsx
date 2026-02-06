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
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useStrengthPoints } from '@/hooks/useStrengthPoints';
import { LegacyTree } from '@/components/ui/LegacyTree';
import {
  RankHeaderCard,
  StreakRow,
  StrengthPointsCard,
  QuickWinCTA,
  WeeklyChallengeMiniCard,
  StatsMiniRow,
} from '@/components/dashboard';
import { toast } from '@/hooks/use-toast';

const HomeDashboard = () => {
  const stats = useDashboardStats();
  const { recordAction } = useStrengthPoints();
  const [isQuickWinActive, setIsQuickWinActive] = useState(false);

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

  if (stats.isLoading) {
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
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-gold/5 via-transparent to-transparent blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 px-5 pt-10 pb-2 text-center">
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

        {/* === SECTION 5: Stats Mini Row === */}
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
    </div>
  );
};

export default HomeDashboard;
