import { useState, useEffect, useCallback, useRef } from 'react';

export interface LocalModerationLog {
  id: string;
  timestamp: string;
  type: 'navigation' | 'image_scan' | 'block' | 'blur';
  url?: string;
  domain?: string;
  classification?: string;
  action: string;
  details?: string;
}

const LOGS_KEY = 'iron_watch_local_logs';
const MAX_LOGS = 1000;

export const useLocalLogs = () => {
  const [logs, setLogs] = useState<LocalModerationLog[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  // Load logs from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOGS_KEY);
      if (stored) {
        setLogs(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load local logs:', error);
    }
    setIsLoaded(true);
  }, []);

  // Debounced save to localStorage
  const saveLogs = useCallback((newLogs: LocalModerationLog[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(LOGS_KEY, JSON.stringify(newLogs));
      } catch (error) {
        console.error('Failed to save local logs:', error);
      }
    }, 500);
  }, []);

  // Add a log entry
  const addLog = useCallback((log: Omit<LocalModerationLog, 'id' | 'timestamp'>) => {
    const newLog: LocalModerationLog = {
      ...log,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    setLogs(prev => {
      const updated = [newLog, ...prev].slice(0, MAX_LOGS);
      saveLogs(updated);
      return updated;
    });

    return newLog;
  }, [saveLogs]);

  // Log a navigation event
  const logNavigation = useCallback((url: string, domain: string) => {
    return addLog({
      type: 'navigation',
      url,
      domain,
      action: 'navigated',
    });
  }, [addLog]);

  // Log a blocked site
  const logBlock = useCallback((url: string, domain: string, category: string) => {
    return addLog({
      type: 'block',
      url,
      domain,
      classification: category,
      action: 'blocked',
      details: `Site blocked: ${category}`,
    });
  }, [addLog]);

  // Log an image scan
  const logImageScan = useCallback((url: string, classification: string, action: 'allowed' | 'blurred' | 'blocked') => {
    return addLog({
      type: 'image_scan',
      url,
      classification,
      action,
      details: `Image ${action}: ${classification}`,
    });
  }, [addLog]);

  // Log a blur event
  const logBlur = useCallback((url: string, classification: string, confidence: number) => {
    return addLog({
      type: 'blur',
      url,
      classification,
      action: 'blurred',
      details: `Confidence: ${(confidence * 100).toFixed(1)}%`,
    });
  }, [addLog]);

  // Clear all logs
  const clearLogs = useCallback(() => {
    setLogs([]);
    try {
      localStorage.removeItem(LOGS_KEY);
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
  }, []);

  // Export logs as JSON
  const exportLogs = useCallback(() => {
    return JSON.stringify(logs, null, 2);
  }, [logs]);

  // Get logs filtered by type
  const getLogsByType = useCallback((type: LocalModerationLog['type']) => {
    return logs.filter(log => log.type === type);
  }, [logs]);

  // Get today's stats
  const getTodayStats = useCallback(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = logs.filter(log => log.timestamp.startsWith(today));
    
    return {
      total: todayLogs.length,
      navigations: todayLogs.filter(l => l.type === 'navigation').length,
      blocks: todayLogs.filter(l => l.type === 'block').length,
      blurs: todayLogs.filter(l => l.type === 'blur').length,
      imageScans: todayLogs.filter(l => l.type === 'image_scan').length,
    };
  }, [logs]);

  return {
    logs,
    isLoaded,
    addLog,
    logNavigation,
    logBlock,
    logImageScan,
    logBlur,
    clearLogs,
    exportLogs,
    getLogsByType,
    getTodayStats,
  };
};
