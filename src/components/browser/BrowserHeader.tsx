import { useState } from "react";
import { 
  ArrowLeft, 
  ArrowRight, 
  RotateCcw, 
  Home, 
  Shield, 
  Lock, 
  Search, 
  Globe, 
  Loader2,
  Scan 
} from "lucide-react";
import { BrowserView } from "@/hooks/useBrowserNavigation";

interface BrowserHeaderProps {
  currentView: BrowserView;
  displayUrl: string;
  urlInput: string;
  onUrlChange: (url: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onHome: () => void;
  onScan?: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading?: boolean;
  isScanning?: boolean;
  isProtected?: boolean;
  modeLabel?: string;
  modeColor?: string;
}

export const BrowserHeader = ({
  currentView,
  displayUrl,
  urlInput,
  onUrlChange,
  onSubmit,
  onBack,
  onForward,
  onRefresh,
  onHome,
  onScan,
  canGoBack,
  canGoForward,
  isLoading = false,
  isScanning = false,
  isProtected = true,
  modeLabel = '',
  modeColor = 'text-muted-foreground',
}: BrowserHeaderProps) => {
  const isHome = currentView === 'home';
  const isBrowsing = currentView === 'browse';
  const isSearch = currentView === 'search';

  return (
    <header className="sticky top-0 z-50 px-3 pt-6 pb-3 border-b border-border bg-card">
      {/* Title Bar */}
      <div className="flex items-center gap-2 mb-3">
        <Shield className="w-6 h-6 text-aqua" />
        <h1 className="font-display text-lg tracking-wider">GoodCreation.net</h1>
        {isProtected && (
          <div className="ml-auto flex items-center gap-1 text-aqua">
            <Lock className="w-3 h-3" />
            <span className="text-xs font-display">PROTECTED</span>
          </div>
        )}
      </div>
      
      {/* URL Bar */}
      <form onSubmit={onSubmit} className="flex gap-2">
        <div className="flex-1 relative">
          {isHome || isSearch ? (
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          ) : (
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          )}
          <input
            type="text"
            value={urlInput}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder={isHome || isSearch ? "Search or enter URL (Safe Browser)" : "Enter URL..."}
            className="w-full bg-input border border-silver/30 rounded-sm pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua transition-colors"
          />
          {isLoading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-aqua animate-spin" />
          )}
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2.5 bg-aqua text-accent-foreground font-display text-xs tracking-wider hover:bg-aqua/90 transition-colors disabled:opacity-50"
        >
          GO
        </button>
      </form>

      {/* Navigation Controls */}
      <div className="flex gap-2 mt-2">
        <button
          onClick={onBack}
          disabled={!canGoBack}
          className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-30"
          title="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onForward}
          disabled={!canGoForward}
          className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-30"
          title="Forward"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={onRefresh}
          disabled={isHome || isLoading}
          className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-30"
          title="Refresh"
        >
          <RotateCcw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={onHome}
          className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20"
          title="Home"
        >
          <Home className="w-4 h-4" />
        </button>
        {onScan && (
          <button
            onClick={onScan}
            disabled={!isBrowsing || isScanning}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-30 flex items-center gap-1"
            title="Scan page for inappropriate images"
          >
            {isScanning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Scan className="w-4 h-4" />
            )}
            <span className="text-xs">SCAN</span>
          </button>
        )}
      </div>
      
      {/* Mode/URL Status Bar */}
      {!isHome && displayUrl && (
        <div className="mt-2 px-3 py-1.5 bg-muted/50 rounded-sm text-xs flex items-center gap-2">
          <span className="text-aqua">🔒</span>
          {modeLabel && currentView !== 'browse' && (
            <span className={`font-display ${modeColor}`}>
              [{modeLabel}]
            </span>
          )}
          <span className="text-muted-foreground truncate flex-1">{displayUrl}</span>
        </div>
      )}
    </header>
  );
};
