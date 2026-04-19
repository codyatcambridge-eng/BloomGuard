import { useState, useEffect, useCallback } from 'react';
import { 
  SPTransaction, 
  SPAction, 
  createTransaction, 
  calculateTotalPoints,
  calculateTodayPoints,
  getTodayResistanceCount,
  getTodayGrowthCount,
  getActionMessage,
  calculateDailyAverage,
} from '@/lib/points';
import { 
  calculateRankProgress, 
  checkForRankUp, 
  RankProgress,
  Rank,
} from '@/lib/ranks';
import { toast } from '@/hooks/use-toast';

const STORAGE_KEY = 'miracle_worker_sp_data';

export interface StreakData {
  shieldStreak: number;          // Days with shield active, no overrides
  strengthStreak: number;        // Days with at least one growth action (survives slips)
  lastShieldActiveDate: string | null;
  lastStrengthActionDate: string | null;
  longestShieldStreak: number;
  longestStrengthStreak: number;
  totalDaysActive: number;       // Total days using the app
  firstActiveDate: string | null;
}

export interface SPData {
  transactions: SPTransaction[];
  streaks: StreakData;
  highestRankAchieved: string;
}

const DEFAULT_STREAKS: StreakData = {
  shieldStreak: 0,
  strengthStreak: 0,
  lastShieldActiveDate: null,
  lastStrengthActionDate: null,
  longestShieldStreak: 0,
  longestStrengthStreak: 0,
  totalDaysActive: 0,
  firstActiveDate: null,
};

const DEFAULT_DATA: SPData = {
  transactions: [],
  streaks: DEFAULT_STREAKS,
  highestRankAchieved: 'initiate',
};

export function useStrengthPoints() {
  const [data, setData] = useState<SPData>(DEFAULT_DATA);
  const [isLoaded, setIsLoaded] = useState(false);
  const [rankProgress, setRankProgress] = useState<RankProgress | null>(null);

  // Load data from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setData({ ...DEFAULT_DATA, ...parsed });
      }
    } catch (error) {
      console.error('Failed to load SP data:', error);
    }
    setIsLoaded(true);
  }, []);

  // Calculate rank progress whenever data changes
  useEffect(() => {
    if (!isLoaded) return;
    
    const totalSP = calculateTotalPoints(data.transactions);
    const totalDays = data.streaks.totalDaysActive;
    const progress = calculateRankProgress(totalSP, totalDays);
    setRankProgress(progress);
  }, [data, isLoaded]);

  // Save data to localStorage
  const saveData = useCallback((newData: SPData) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
      setData(newData);
    } catch (error) {
      console.error('Failed to save SP data:', error);
    }
  }, []);

  // Update streaks based on today's activity
  const updateStreaks = useCallback((currentData: SPData, isShieldActive: boolean): StreakData => {
    const today = new Date().toISOString().split('T')[0];
    const streaks = { ...currentData.streaks };
    
    // Initialize first active date
    if (!streaks.firstActiveDate) {
      streaks.firstActiveDate = today;
    }
    
    // Check if this is a new day
    const isNewDay = streaks.lastShieldActiveDate !== today || streaks.lastStrengthActionDate !== today;
    
    if (isNewDay) {
      // Calculate days since first active
      const firstDate = new Date(streaks.firstActiveDate);
      const todayDate = new Date(today);
      const diffTime = Math.abs(todayDate.getTime() - firstDate.getTime());
      streaks.totalDaysActive = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }
    
    // Update Shield Streak
    if (isShieldActive) {
      if (streaks.lastShieldActiveDate === today) {
        // Already counted today
      } else {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        if (streaks.lastShieldActiveDate === yesterdayStr) {
          // Consecutive day
          streaks.shieldStreak += 1;
        } else if (!streaks.lastShieldActiveDate) {
          // First day
          streaks.shieldStreak = 1;
        } else {
          // Streak broken, restart
          streaks.shieldStreak = 1;
        }
        
        streaks.lastShieldActiveDate = today;
        streaks.longestShieldStreak = Math.max(streaks.longestShieldStreak, streaks.shieldStreak);
      }
    }
    
    return streaks;
  }, []);

  // Record an action and earn points
  const recordAction = useCallback((action: SPAction, description?: string) => {
    const transaction = createTransaction(action, description);
    const previousSP = calculateTotalPoints(data.transactions);
    const previousDays = data.streaks.totalDaysActive;
    
    const newTransactions = [...data.transactions, transaction];
    const newSP = calculateTotalPoints(newTransactions);
    
    // Update strength streak for growth actions
    const today = new Date().toISOString().split('T')[0];
    const newStreaks = { ...data.streaks };
    
    const growthActions: SPAction[] = [
      'DAILY_CHECK_IN',
      'ACCOUNTABILITY_MESSAGE',
      'REFLECTION_LOGGED',
      'GOAL_REVIEWED',
      'IMMEDIATE_RESISTANCE',
      'COOLDOWN_COMPLETED',
      'REPLACEMENT_ACTION',
    ];
    
    if (growthActions.includes(action)) {
      if (newStreaks.lastStrengthActionDate !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        if (newStreaks.lastStrengthActionDate === yesterdayStr || !newStreaks.lastStrengthActionDate) {
          newStreaks.strengthStreak += 1;
        }
        // Note: Strength streak survives slips - we don't reset it
        
        newStreaks.lastStrengthActionDate = today;
        newStreaks.longestStrengthStreak = Math.max(newStreaks.longestStrengthStreak, newStreaks.strengthStreak);
      }
      
      // Initialize first active date
      if (!newStreaks.firstActiveDate) {
        newStreaks.firstActiveDate = today;
      }
      
      // Update total days
      const firstDate = new Date(newStreaks.firstActiveDate);
      const todayDate = new Date(today);
      const diffTime = Math.abs(todayDate.getTime() - firstDate.getTime());
      newStreaks.totalDaysActive = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }
    
    const newData: SPData = {
      ...data,
      transactions: newTransactions,
      streaks: newStreaks,
    };
    
    // Check for rank up
    const newRank = checkForRankUp(previousSP, previousDays, newSP, newStreaks.totalDaysActive);
    if (newRank) {
      newData.highestRankAchieved = newRank.id;
      toast({
        title: `🏆 ${newRank.name} Unlocked!`,
        description: newRank.unlockMessage,
        duration: 5000,
      });
    }
    
    saveData(newData);
    
    // Show action feedback
    const message = getActionMessage(action);
    toast({
      title: `+${transaction.points} SP`,
      description: message,
      duration: 2000,
    });
    
    return transaction;
  }, [data, saveData]);

  // Mark shield as active for today (called by protection system)
  const markShieldActive = useCallback((isActive: boolean) => {
    const newStreaks = updateStreaks(data, isActive);
    
    if (JSON.stringify(newStreaks) !== JSON.stringify(data.streaks)) {
      saveData({
        ...data,
        streaks: newStreaks,
      });
    }
  }, [data, updateStreaks, saveData]);

  // Break the shield streak (called when override happens)
  const breakShieldStreak = useCallback(() => {
    const newStreaks = {
      ...data.streaks,
      shieldStreak: 0,
    };
    
    saveData({
      ...data,
      streaks: newStreaks,
    });
    
    // Note: We don't break strength streak - it survives slips!
    toast({
      title: "Shield streak reset",
      description: "Your Strength streak continues. Get back up, warrior.",
      duration: 3000,
    });
  }, [data, saveData]);

  // Get computed values
  const totalSP = calculateTotalPoints(data.transactions);
  const todaySP = calculateTodayPoints(data.transactions);
  const dailyAverage = calculateDailyAverage(data.transactions);
  const todayResistance = getTodayResistanceCount(data.transactions);
  const todayGrowth = getTodayGrowthCount(data.transactions);

  return {
    // Data
    transactions: data.transactions,
    streaks: data.streaks,
    rankProgress,
    isLoaded,
    
    // Computed values
    totalSP,
    todaySP,
    dailyAverage,
    todayResistance,
    todayGrowth,
    
    // Actions
    recordAction,
    markShieldActive,
    breakShieldStreak,
  };
}
