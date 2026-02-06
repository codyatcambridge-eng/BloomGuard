/**
 * Dashboard Stats Hook
 * 
 * Calculates stats from persisted logs for dashboard display.
 * Memoizes heavy aggregations to avoid re-query loops.
 */

import { useMemo, useEffect, useState } from 'react';
import { getTriggerEvents, getFocusSessions } from '@/storage/eventsRepo';
import { loadUserProgress } from '@/storage/userRepo';
import { UserProgress } from '@/models/UserProgress';
import { TriggerEvent } from '@/models/TriggerEvent';
import { FocusSession } from '@/models/FocusSession';
import { getWeekStartISO, getEndOfDayTs, getStartOfDayTs, getTodayISO } from '@/logic/dateUtils';
import { calculateRankProgress, RankProgress } from '@/logic/rank';

export interface DashboardStats {
  // Progress
  progress: UserProgress | null;
  rankProgress: RankProgress | null;
  
  // Streaks
  shieldStreak: number;
  strengthStreak: number;
  
  // Points
  totalSP: number;
  todaySP: number;
  
  // Weekly stats
  urgesResistedThisWeek: number;
  
  /**
   * Minutes reclaimed calculation (MVP approximation):
   * = (resisted_count * 3) + focus_session_minutes
   * 
   * Rationale: Each resisted urge saves ~3 minutes that would have been lost.
   * Focus sessions directly contribute their duration.
   * This is a motivational metric, not a precise measurement.
   */
  minutesReclaimed: number;
  
  // Challenge
  weeklyChallenge: {
    id: string | null;
    progress: number;
    target: number;
  };
  
  // Loading state
  isLoading: boolean;
}

export function useDashboardStats(): DashboardStats {
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [triggerEvents, setTriggerEvents] = useState<TriggerEvent[]>([]);
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load data once on mount
  useEffect(() => {
    let mounted = true;
    
    async function loadData() {
      try {
        const [userProgress, weekEvents, weekSessions] = await Promise.all([
          loadUserProgress(),
          loadWeekTriggerEvents(),
          loadWeekFocusSessions(),
        ]);
        
        if (mounted) {
          setProgress(userProgress);
          setTriggerEvents(weekEvents);
          setFocusSessions(weekSessions);
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Failed to load dashboard stats:', error);
        setIsLoading(false);
      }
    }
    
    loadData();
    
    return () => { mounted = false; };
  }, []);

  // Memoized calculations to avoid re-computing on every render
  const stats = useMemo((): Omit<DashboardStats, 'isLoading'> => {
    if (!progress) {
      return {
        progress: null,
        rankProgress: null,
        shieldStreak: 0,
        strengthStreak: 0,
        totalSP: 0,
        todaySP: 0,
        urgesResistedThisWeek: 0,
        minutesReclaimed: 0,
        weeklyChallenge: { id: null, progress: 0, target: 0 },
      };
    }

    // Count resisted urges this week
    const urgesResistedThisWeek = triggerEvents.filter(
      e => e.outcome === 'RESISTED'
    ).length;

    // Calculate focus session minutes
    const focusMinutes = focusSessions
      .filter(s => s.completed)
      .reduce((sum, s) => sum + s.durationMinutes, 0);

    /**
     * Minutes reclaimed = (resisted_count * 3) + focus_minutes
     * This is an MVP approximation for motivational display.
     */
    const minutesReclaimed = (urgesResistedThisWeek * 3) + focusMinutes;

    // Calculate rank progress
    // UserProgress model uses shieldStreakDays as the primary days metric
    const totalDays = progress.shieldStreakDays || 0;
    const rankProgress = calculateRankProgress(progress.totalSP, totalDays);

    // Weekly challenge progress (from weeklyProgress map)
    const challengeProgress = progress.weeklyChallengeId 
      ? (progress.weeklyProgress[progress.weeklyChallengeId] ?? 0)
      : 0;

    return {
      progress,
      rankProgress,
      shieldStreak: progress.shieldStreakDays,
      strengthStreak: progress.strengthStreakDays,
      totalSP: progress.totalSP,
      todaySP: progress.spToday,
      urgesResistedThisWeek,
      minutesReclaimed,
      weeklyChallenge: {
        id: progress.weeklyChallengeId,
        progress: challengeProgress,
        target: 5, // Default target, would come from challenge catalog
      },
    };
  }, [progress, triggerEvents, focusSessions]);

  return {
    ...stats,
    isLoading,
  };
}

// Helper to load trigger events for current week
async function loadWeekTriggerEvents(): Promise<TriggerEvent[]> {
  const weekStart = getWeekStartISO();
  const today = getTodayISO();
  const fromTs = getStartOfDayTs(weekStart);
  const toTs = getEndOfDayTs(today);
  
  return getTriggerEvents(fromTs, toTs);
}

// Helper to load focus sessions for current week
async function loadWeekFocusSessions(): Promise<FocusSession[]> {
  const weekStart = getWeekStartISO();
  const today = getTodayISO();
  const fromTs = getStartOfDayTs(weekStart);
  const toTs = getEndOfDayTs(today);
  
  return getFocusSessions(fromTs, toTs);
}
