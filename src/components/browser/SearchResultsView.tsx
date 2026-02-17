import { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowLeft, Search, Loader2, Shield, AlertTriangle, Eye, EyeOff, ExternalLink, Globe, RefreshCw } from "lucide-react";
import { useOnDeviceModeration, ModerationResult } from "@/hooks/useOnDeviceModeration";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { useLocalBlocklist } from "@/hooks/useLocalBlocklist";
import { toast } from "sonner";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
}

interface SearchResultsViewProps {
  query: string;
  results: SearchResult[];
  isLoading: boolean;
  error: string | null;
  onBack: () => void;
  onNavigate: (url: string) => void;
  onNewSearch: (query: string) => void;
}

export const SearchResultsView = ({
  query,
  results,
  isLoading,
  error,
  onBack,
  onNavigate,
  onNewSearch,
}: SearchResultsViewProps) => {
  const [newQuery, setNewQuery] = useState(query);
  const [imageResults, setImageResults] = useState<Map<string, ModerationResult>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [revealedImages, setRevealedImages] = useState<Set<string>>(new Set());

  const { isReady: aiReady, classifyImage, modelState } = useOnDeviceModeration();
  const { settings, getAIThresholds, getBlurAmount, isModerationEnabled, isRevealAllowed } = useLocalSettings();
  const { isBlocked } = useLocalBlocklist();

  const blurAmount = getBlurAmount();
  const thresholds = getAIThresholds();
  const revealAllowed = isRevealAllowed();
  const shouldEnforceAdultBlock = isModerationEnabled() && settings.block_adult_sites === true;

  // Extract all unique thumbnails
  const thumbnails = useMemo(() => {
    return [...new Set(results.filter(r => r.thumbnail).map(r => r.thumbnail!))];
  }, [results]);

  // Scan thumbnails with on-device AI
  const scanThumbnails = useCallback(async () => {
    if (!aiReady || thumbnails.length === 0) return;

    console.log('[SearchResults] Starting thumbnail scan:', { count: thumbnails.length });
    setIsScanning(true);
    setScannedCount(0);

    const newResults = new Map<string, ModerationResult>();

    for (let i = 0; i < thumbnails.length; i++) {
      try {
        const result = await classifyImage(thumbnails[i], thresholds);
        if (result) {
          newResults.set(thumbnails[i], result);
          if (result.shouldBlur) {
            console.log('[SearchResults] Thumbnail flagged:', {
              index: i,
              class: result.dominantClass,
              confidence: result.confidence.toFixed(2),
            });
          }
        }
        setScannedCount(i + 1);
      } catch (error) {
        console.error('[SearchResults] Error scanning thumbnail:', error);
      }
    }

    setImageResults(newResults);
    setIsScanning(false);

    const blurredCount = [...newResults.values()].filter(r => r.shouldBlur).length;
    if (settings.show_scan_notifications && blurredCount > 0) {
      toast.warning(`${blurredCount} thumbnail(s) blurred for your protection`, {
        duration: 3000,
        icon: <Shield className="w-4 h-4" />,
      });
    }
  }, [aiReady, thumbnails, classifyImage, thresholds, settings.show_scan_notifications]);

  // Auto-scan when AI is ready and results change
  useEffect(() => {
    if (aiReady && settings.auto_scan_images && thumbnails.length > 0 && !isScanning) {
      scanThumbnails();
    }
  }, [aiReady, settings.auto_scan_images, thumbnails.length, scanThumbnails, isScanning]);

  const toggleImageReveal = useCallback((src: string) => {
    if (!revealAllowed) return;
    setRevealedImages(prev => {
      const next = new Set(prev);
      if (next.has(src)) {
        next.delete(src);
      } else {
        next.add(src);
      }
      return next;
    });
  }, [revealAllowed]);

  const shouldBlurImage = useCallback((src: string): boolean => {
    if (blurAmount === 0) return false;
    const result = imageResults.get(src);
    if (result?.shouldBlur !== true) return false;
    if (!revealAllowed) return true;
    return !revealedImages.has(src);
  }, [imageResults, revealedImages, blurAmount, revealAllowed]);

  const handleResultClick = useCallback((url: string) => {
    if (shouldEnforceAdultBlock) {
      const blockResult = isBlocked(url);
      if (blockResult.blocked) {
        toast.error(`Blocked: ${blockResult.domain} (${blockResult.category})`, {
          duration: 3000,
          icon: <AlertTriangle className="w-4 h-4" />,
        });
        console.log('[SearchResults] Blocked navigation:', { url, ...blockResult });
        return;
      }
    }
    
    console.log('[SearchResults] Navigating to:', url);
    onNavigate(url);
  }, [isBlocked, onNavigate, shouldEnforceAdultBlock]);

  const handleNewSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (newQuery.trim() && newQuery.trim() !== query) {
      setImageResults(new Map());
      setRevealedImages(new Set());
      onNewSearch(newQuery.trim());
    }
  };

  const extractDomain = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Search Header */}
      <header className="px-4 py-3 border-b border-border bg-card sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors border border-border rounded"
            aria-label="Back to homepage"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          
          {/* Search Form */}
          <form onSubmit={handleNewSearch} className="flex-1 flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={newQuery}
                onChange={(e) => setNewQuery(e.target.value)}
                className="w-full bg-input border border-silver/30 rounded-full pl-10 pr-4 py-2 text-sm text-foreground focus:outline-none focus:border-aqua transition-colors"
                placeholder="Search..."
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 bg-aqua text-accent-foreground font-display text-xs tracking-wider rounded-full hover:bg-aqua/90 transition-colors disabled:opacity-50"
            >
              SEARCH
            </button>
          </form>
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <Shield className={`w-3 h-3 ${modelState === 'ready' ? 'text-green-500' : 'text-muted-foreground'}`} />
            <span>
              {results.length} result{results.length !== 1 ? 's' : ''} for "{query}"
            </span>
          </div>
          
          {thumbnails.length > 0 && (
            <div className="flex items-center gap-2">
              {isScanning ? (
                <span className="flex items-center gap-1 text-aqua">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Scanning {scannedCount}/{thumbnails.length}
                </span>
              ) : (
                <>
                  <span>{imageResults.size}/{thumbnails.length} scanned</span>
                  {aiReady && imageResults.size < thumbnails.length && (
                    <button
                      onClick={scanThumbnails}
                      className="flex items-center gap-1 text-aqua hover:underline"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Scan
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Results */}
      <main className="flex-1 overflow-auto pb-20">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-aqua animate-spin mb-4" />
            <p className="text-muted-foreground font-display">SEARCHING...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 px-6">
            <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
            <p className="text-destructive font-display mb-2">SEARCH FAILED</p>
            <p className="text-sm text-muted-foreground text-center">{error}</p>
            <button
              onClick={onBack}
              className="mt-6 px-6 py-2 border border-silver/30 text-silver hover:text-foreground transition-colors font-display text-sm"
            >
              GO BACK
            </button>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6">
            <Search className="w-12 h-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground font-display">NO RESULTS FOUND</p>
            <p className="text-sm text-muted-foreground mt-2">Try a different search term</p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto px-4 py-4">
            {results.map((result, idx) => {
              const domain = extractDomain(result.url);
              const isBlockedSite = shouldEnforceAdultBlock ? isBlocked(result.url).blocked : false;
              const hasThumb = !!result.thumbnail;
              const thumbBlurred = hasThumb && shouldBlurImage(result.thumbnail!);
              const thumbResult = hasThumb ? imageResults.get(result.thumbnail!) : null;
              const isRevealed = hasThumb && revealedImages.has(result.thumbnail!);

              return (
                <article 
                  key={`${result.url}-${idx}`}
                  className={`mb-6 p-4 bg-card border border-border rounded-lg hover:border-silver/50 transition-colors ${isBlockedSite ? 'opacity-60' : ''}`}
                >
                  <div className="flex gap-4">
                    {/* Thumbnail */}
                    {hasThumb && (
                      <div className="relative w-24 h-24 flex-shrink-0 bg-muted rounded overflow-hidden">
                        <img
                          src={result.thumbnail}
                          alt=""
                          className="w-full h-full object-cover"
                          style={thumbBlurred ? { filter: `blur(${blurAmount}px)` } : {}}
                          loading="lazy"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                        
                        {/* Blurred overlay */}
                        {revealAllowed && thumbBlurred && !isRevealed && (
                          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleImageReveal(result.thumbnail!);
                              }}
                              className="p-1.5 bg-muted rounded text-xs flex items-center gap-1"
                            >
                              <Eye className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                        
                        {/* Revealed but flagged */}
                        {revealAllowed && thumbResult?.shouldBlur && isRevealed && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleImageReveal(result.thumbnail!);
                            }}
                            className="absolute top-1 right-1 p-1 bg-background/80 rounded-full"
                          >
                            <EyeOff className="w-3 h-3" />
                          </button>
                        )}
                        
                        {/* Safe badge */}
                        {thumbResult && !thumbResult.shouldBlur && (
                          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-green-600/90 rounded text-[8px] text-white font-display">
                            SAFE
                          </div>
                        )}
                      </div>
                    )}

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Domain */}
                      <div className="flex items-center gap-2 mb-1">
                        <Globe className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground truncate">{domain}</span>
                        {isBlockedSite && (
                          <span className="px-1.5 py-0.5 bg-destructive/20 text-destructive text-[10px] font-display rounded">
                            BLOCKED
                          </span>
                        )}
                      </div>
                      
                      {/* Title */}
                      <button
                        onClick={() => handleResultClick(result.url)}
                        className="text-left w-full group"
                        disabled={isBlockedSite}
                      >
                        <h3 className="text-base font-medium text-aqua group-hover:underline line-clamp-2">
                          {result.title}
                        </h3>
                      </button>
                      
                      {/* Snippet */}
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {result.snippet}
                      </p>
                      
                      {/* Actions */}
                      {!isBlockedSite && (
                        <button
                          onClick={() => handleResultClick(result.url)}
                          className="mt-2 text-xs text-silver hover:text-foreground transition-colors flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open in Safe Browser
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="px-4 py-3 border-t border-border bg-card">
        <div className="max-w-2xl mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Shield className="w-3 h-3 text-aqua" />
            <span>Results filtered • Images moderated</span>
          </div>
          <span>
            Blur: {settings.blur_level} | AI: {settings.ai_sensitivity}
          </span>
        </div>
      </footer>
    </div>
  );
};
