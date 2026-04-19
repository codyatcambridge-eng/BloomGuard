/**
 * Challenges Screen
 * Weekly challenge selection, progress, and history
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ArrowLeft, Trophy, RefreshCw, Share2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { CathedralCard } from '@/components/ui/CathedralCard';
import { ChallengeCard, RewardModal } from '@/components/challenge';
import {
  WeeklyChallengeType,
  WEEKLY_CHALLENGES,
  getChallengeProgress,
  claimChallengeReward,
  initializeWeeklyChallenge,
  WeeklyStats,
} from '@/logic/challengeEngine';
import { getCurrentWeekISO } from '@/logic/dateUtils';
import { loadUserProgress, updateUserProgress } from '@/storage/userRepo';
import { getTriggerEvents, getFocusSessions } from '@/storage/eventsRepo';
import { UserProgress } from '@/models/UserProgress';

export default function ChallengesScreen() {
  const navigate = useNavigate();
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats | null>(null);
  const [showRewardModal, setShowRewardModal] = useState(false);
  const [pendingReward, setPendingReward] = useState<{
    challengeType: WeeklyChallengeType;
    spAwarded: number;
    badgeUnlocked: string;
  } | null>(null);
  
  // Load progress and compute weekly stats
  useEffect(() => {
    const load = async () => {
      const userProgress = await loadUserProgress();
      setProgress(userProgress);
      
      // Compute weekly stats from events
      const currentWeek = getCurrentWeekISO();
      const weekStart = getWeekStartTimestamp(currentWeek);
      const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
      
      const triggers = await getTriggerEvents(weekStart, weekEnd);
      const sessions = await getFocusSessions(weekStart, weekEnd);
      
      const stats: WeeklyStats = {
        overridesCount: triggers.filter(t => t.outcome === 'PARTNER_OVERRIDE').length,
        triggerAttempts: triggers.length,
        resistedCount: triggers.filter(t => t.outcome === 'RESISTED').length,
        focusMinutes: sessions.filter(s => s.completed).reduce((sum, s) => sum + s.durationMinutes, 0),
        recoveriesCompleted: triggers.filter(t => t.recoveryCompleted).length,
        protectedDays: userProgress.weeklyProgress['PROTECTED_DAY_NO_UNLOCK'] ?? 0,
      };
      
      setWeeklyStats(stats);
      
      // Initialize challenge if needed
      if (!userProgress.weeklyChallengeId || userProgress.weeklyChallengeWeekISO !== currentWeek) {
        const updates = initializeWeeklyChallenge(userProgress, stats);
        const updated = await updateUserProgress(updates);
        setProgress(updated);
      }
    };
    
    load();
  }, []);
  
  // Helper to get week start timestamp
  const getWeekStartTimestamp = (weekISO: string): number => {
    // weekISO format: "2026-W06"
    const [year, weekNum] = weekISO.split('-W').map(Number);
    const jan1 = new Date(year, 0, 1);
    const jan1Day = jan1.getDay();
    const daysToMonday = jan1Day === 0 ? 1 : (jan1Day === 1 ? 0 : 8 - jan1Day);
    const firstMonday = new Date(year, 0, 1 + daysToMonday);
    firstMonday.setDate(firstMonday.getDate() + (weekNum - 1) * 7);
    firstMonday.setHours(0, 0, 0, 0);
    return firstMonday.getTime();
  };
  
  // Get current challenge progress
  const challengeProgress = useMemo(() => {
    if (!progress) return null;
    return getChallengeProgress(progress);
  }, [progress]);
  
  // Handle reward claim
  const handleClaimReward = useCallback(async () => {
    if (!progress || !challengeProgress) return;
    
    const result = claimChallengeReward(progress, challengeProgress.challengeId);
    if (!result) return;
    
    // Update progress with reward claimed
    const updated = await updateUserProgress({
      totalSP: progress.totalSP + result.spAwarded,
      spToday: progress.spToday + result.spAwarded,
      weeklyProgress: result.weeklyProgress,
      badges: [...progress.badges, result.badgeUnlocked],
    });
    
    setProgress(updated);
    
    // Show reward modal
    setPendingReward({
      challengeType: challengeProgress.challengeId,
      spAwarded: result.spAwarded,
      badgeUnlocked: result.badgeUnlocked,
    });
    setShowRewardModal(true);
  }, [progress, challengeProgress]);
  
  // Close reward modal
  const handleCloseRewardModal = useCallback(() => {
    setShowRewardModal(false);
    setPendingReward(null);
  }, []);
  
  if (!progress) {
    return (
      <div className="min-h-screen bg-obsidian flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-gold animate-spin" />
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-obsidian text-foreground pb-20">
      {/* Header */}
      <div className="bg-obsidian-light/50 border-b border-silver/10 px-4 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(-1)}
            className="text-silver hover:text-foreground"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="font-display text-lg text-foreground">Weekly Challenges</h1>
            <p className="text-xs text-muted-foreground">Train discipline. Earn rewards.</p>
          </div>
        </div>
      </div>
      
      <div className="p-4 space-y-4">
        {/* Current Challenge */}
        <section>
          <h2 className="text-sm text-silver mb-3 flex items-center gap-2">
            <Trophy className="w-4 h-4" />
            This Week's Challenge
          </h2>
          
          {challengeProgress ? (
            <ChallengeCard
              challengeType={challengeProgress.challengeId}
              current={challengeProgress.current}
              completed={challengeProgress.completed}
              rewardClaimed={challengeProgress.rewardClaimed}
              weekISO={challengeProgress.weekISO}
              onClaimReward={handleClaimReward}
            />
          ) : (
            <CathedralCard className="p-4 text-center">
              <p className="text-silver">Loading challenge...</p>
            </CathedralCard>
          )}
        </section>
        
        {/* Available Challenges Preview */}
        <section>
          <h2 className="text-sm text-silver mb-3">All Challenge Types</h2>
          <div className="space-y-3">
            {Object.values(WEEKLY_CHALLENGES).map((challenge) => (
              <CathedralCard 
                key={challenge.id}
                className="p-3 flex items-center gap-3"
                variant={challengeProgress?.challengeId === challenge.id ? 'gold' : 'default'}
              >
                <div className="w-8 h-8 rounded-lg bg-silver/10 flex items-center justify-center">
                  <Trophy className="w-4 h-4 text-silver" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-display text-foreground truncate">
                    {challenge.name}
                  </h3>
                  <p className="text-xs text-muted-foreground truncate">
                    {challenge.goalDescription}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-sm font-display text-gold">+{challenge.spReward}</div>
                  <div className="text-[10px] text-muted-foreground">SP</div>
                </div>
              </CathedralCard>
            ))}
          </div>
        </section>
        
        {/* Share Button */}
        <Button
          variant="outline"
          className="w-full mt-4 border-silver/30 text-silver hover:text-foreground"
          onClick={() => navigate('/share-card')}
        >
          <Share2 className="w-4 h-4 mr-2" />
          View Share Card
        </Button>
        
        {/* Empowering Message */}
        <p className="text-center text-xs text-muted-foreground italic pt-4">
          "Delay is power. Each challenge shapes your strength."
        </p>
      </div>
      
      {/* Reward Modal */}
      {pendingReward && (
        <RewardModal
          open={showRewardModal}
          onClose={handleCloseRewardModal}
          challengeType={pendingReward.challengeType}
          spAwarded={pendingReward.spAwarded}
          badgeUnlocked={pendingReward.badgeUnlocked}
        />
      )}
    </div>
  );
}
