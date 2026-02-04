import { useState, useCallback, useRef } from 'react';

export type BrowserView = 
  | 'home' 
  | 'search' 
  | 'browse' 
  | 'blocked' 
  | 'fallback' 
  | 'reader' 
  | 'pdf' 
  | 'preview' 
  | 'failure' 
  | 'youtube' 
  | 'social';

interface HistoryEntry {
  view: BrowserView;
  url: string;
  displayUrl: string;
  timestamp: number;
}

interface UseBrowserNavigationOptions {
  maxHistorySize?: number;
}

export const useBrowserNavigation = (options: UseBrowserNavigationOptions = {}) => {
  const { maxHistorySize = 50 } = options;
  
  const [currentView, setCurrentView] = useState<BrowserView>('home');
  const [currentUrl, setCurrentUrl] = useState('');
  const [displayUrl, setDisplayUrl] = useState('');
  
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef(-1);
  const isNavigatingRef = useRef(false);

  // Add entry to history
  const pushHistory = useCallback((view: BrowserView, url: string, display: string) => {
    // Don't add if we're navigating through history
    if (isNavigatingRef.current) {
      isNavigatingRef.current = false;
      return;
    }
    
    // Remove forward history if we're not at the end
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }
    
    // Add new entry
    historyRef.current.push({
      view,
      url,
      displayUrl: display,
      timestamp: Date.now(),
    });
    
    // Trim history if too long
    if (historyRef.current.length > maxHistorySize) {
      historyRef.current = historyRef.current.slice(-maxHistorySize);
    }
    
    historyIndexRef.current = historyRef.current.length - 1;
  }, [maxHistorySize]);

  // Navigate to a view
  const navigate = useCallback((view: BrowserView, url: string = '', display: string = '') => {
    const finalDisplay = display || url;
    
    setCurrentView(view);
    setCurrentUrl(url);
    setDisplayUrl(finalDisplay);
    
    // Only push to history for meaningful views
    if (view !== 'blocked') {
      pushHistory(view, url, finalDisplay);
    }
    
    console.log('[Navigation] Navigate:', { view, url: url.slice(0, 50) });
  }, [pushHistory]);

  // Go back in history
  const goBack = useCallback((): boolean => {
    if (historyIndexRef.current > 0) {
      isNavigatingRef.current = true;
      historyIndexRef.current--;
      const entry = historyRef.current[historyIndexRef.current];
      
      setCurrentView(entry.view);
      setCurrentUrl(entry.url);
      setDisplayUrl(entry.displayUrl);
      
      console.log('[Navigation] Back:', { view: entry.view, index: historyIndexRef.current });
      return true;
    }
    return false;
  }, []);

  // Go forward in history
  const goForward = useCallback((): boolean => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      isNavigatingRef.current = true;
      historyIndexRef.current++;
      const entry = historyRef.current[historyIndexRef.current];
      
      setCurrentView(entry.view);
      setCurrentUrl(entry.url);
      setDisplayUrl(entry.displayUrl);
      
      console.log('[Navigation] Forward:', { view: entry.view, index: historyIndexRef.current });
      return true;
    }
    return false;
  }, []);

  // Go home
  const goHome = useCallback(() => {
    navigate('home', '', '');
  }, [navigate]);

  // Check if can go back/forward
  const canGoBack = historyIndexRef.current > 0;
  const canGoForward = historyIndexRef.current < historyRef.current.length - 1;

  // Get current mode label for display
  const getModeLabel = useCallback((): string => {
    switch (currentView) {
      case 'home': return 'Home';
      case 'search': return 'Search Results';
      case 'browse': return 'GoodCreation';
      case 'blocked': return 'Blocked';
      case 'fallback': return 'Fallback Mode';
      case 'reader': return 'Reader Mode';
      case 'pdf': return 'PDF Viewer';
      case 'preview': return 'Preview Mode';
      case 'failure': return 'Cannot Load';
      case 'youtube': return 'YouTube Preview';
      case 'social': return 'Social Preview';
      default: return '';
    }
  }, [currentView]);

  // Get mode color for UI
  const getModeColor = useCallback((): string => {
    switch (currentView) {
      case 'reader': return 'text-aqua';
      case 'preview': return 'text-amber-500';
      case 'youtube': return 'text-red-500';
      case 'social': return 'text-pink-500';
      case 'blocked': return 'text-destructive';
      case 'failure': return 'text-destructive';
      case 'fallback': return 'text-amber-500';
      default: return 'text-muted-foreground';
    }
  }, [currentView]);

  return {
    currentView,
    currentUrl,
    displayUrl,
    navigate,
    goBack,
    goForward,
    goHome,
    canGoBack,
    canGoForward,
    getModeLabel,
    getModeColor,
    setDisplayUrl,
  };
};
