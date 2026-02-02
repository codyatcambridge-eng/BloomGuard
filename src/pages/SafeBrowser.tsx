import { useState, useRef, useEffect, useCallback } from "react";
import { Globe, ArrowLeft, ArrowRight, RotateCcw, Shield, AlertTriangle, Lock, Home, Scan, Loader2, Search } from "lucide-react";
import { useContentProtection } from "@/hooks/useContentProtection";
import { useSettings } from "@/hooks/useSettings";
import { useDeviceId } from "@/hooks/useDeviceId";
import { supabase } from "@/integrations/supabase/client";
import { FallbackModeUI } from "@/components/browser/FallbackModeUI";
import { ReaderModeView } from "@/components/browser/ReaderModeView";
import { SafeBrowserHomepage } from "@/components/browser/SafeBrowserHomepage";
import { SearchResultsView } from "@/components/browser/SearchResultsView";
import { PDFViewer } from "@/components/browser/PDFViewer";
import { PreviewModeView } from "@/components/browser/PreviewModeView";
import { FullFailureView } from "@/components/browser/FullFailureView";

type BrowserView = 'home' | 'search' | 'browse' | 'blocked' | 'fallback' | 'reader' | 'pdf' | 'preview' | 'failure';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
}

// Sites known to block iframes
const KNOWN_IFRAME_BLOCKERS = [
  'google.com',
  'youtube.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'linkedin.com',
  'github.com',
  'amazon.com',
  'ebay.com',
  'reddit.com',
  'netflix.com',
  'spotify.com',
  'apple.com',
  'microsoft.com',
];

interface ReaderContent {
  content: string;
  previewHtml?: string;
  images: string[];
  title: string;
  description?: string;
  sourceUrl: string;
}

interface PDFContent {
  pdfUrl: string;
  title: string;
  sourceUrl: string;
}

const SafeBrowser = () => {
  const [url, setUrl] = useState("");
  const [displayUrl, setDisplayUrl] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [currentView, setCurrentView] = useState<BrowserView>('home');
  const [blockedReason, setBlockedReason] = useState("");
  const [blockedCategory, setBlockedCategory] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  // Fallback mode state
  const [fallbackUrl, setFallbackUrl] = useState("");
  const [isLoadingReader, setIsLoadingReader] = useState(false);
  const [readerContent, setReaderContent] = useState<ReaderContent | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [pdfContent, setPdfContent] = useState<PDFContent | null>(null);
  const [failureError, setFailureError] = useState<string | null>(null);
  
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  
  const { checkBlockedSite, isChecking } = useContentProtection();
  const { settings } = useSettings();
  const deviceId = useDeviceId();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalizeUrl = (input: string): string => {
    let normalized = input.trim();
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'https://' + normalized;
    }
    return normalized;
  };

  const extractDomain = (urlString: string): string => {
    try {
      const urlObj = new URL(normalizeUrl(urlString));
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return urlString.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
  };

  const isKnownBlocker = (urlString: string): boolean => {
    const domain = extractDomain(urlString);
    return KNOWN_IFRAME_BLOCKERS.some(blocker => 
      domain === blocker || domain.endsWith('.' + blocker)
    );
  };

  const logEvent = async (eventType: string, domain: string, action: string) => {
    if (!deviceId) return;
    await supabase.from('content_moderation_logs').insert({
      device_id: deviceId,
      content_type: 'website',
      url: domain,
      classification: eventType,
      action_taken: action,
      confidence: 1.0,
    });
  };

  // Search handler
  const handleSearch = useCallback(async (query: string) => {
    console.log('[SafeBrowser] Starting search:', query);
    setSearchQuery(query);
    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);
    setCurrentView('search');
    
    // Log search event
    await logEvent('search', query, 'search_query');
    
    try {
      const { data, error } = await supabase.functions.invoke('web-search', {
        body: { query }
      });
      
      if (error) {
        console.error('[SafeBrowser] Search error:', error);
        throw new Error(error.message || 'Search failed');
      }
      
      if (data?.success && data?.results) {
        console.log('[SafeBrowser] Search results:', data.results.length);
        setSearchResults(data.results);
      } else {
        setSearchError(data?.error || 'No results found');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Search failed';
      console.error('[SafeBrowser] Search exception:', error);
      setSearchError(errorMsg);
    } finally {
      setIsSearching(false);
    }
  }, [deviceId]);

  const handleNavigate = useCallback(async (targetUrl?: string, e?: React.FormEvent) => {
    e?.preventDefault();
    
    const urlToNavigate = targetUrl || url;
    if (!urlToNavigate.trim()) return;

    // Check if it's a search query (no dots or spaces with no protocol)
    const isSearchQuery = !urlToNavigate.includes('.') || 
      (urlToNavigate.includes(' ') && !urlToNavigate.startsWith('http'));
    
    if (isSearchQuery) {
      handleSearch(urlToNavigate);
      return;
    }

    // Reset states
    setIsLoading(true);
    setReaderContent(null);
    setReaderError(null);
    
    // Clear any pending timeout
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }
    
    const normalizedUrl = normalizeUrl(urlToNavigate);
    const domain = extractDomain(urlToNavigate);

    // Update URL bar display
    setDisplayUrl(normalizedUrl);
    setUrl(normalizedUrl);

    // Check if the site is blocked
    if (settings.block_adult_sites) {
      const result = await checkBlockedSite(normalizedUrl, deviceId);
      
      if (result?.isBlocked) {
        setBlockedReason(result.reason);
        setBlockedCategory(result.category || 'blocked');
        setCurrentUrl('');
        setCurrentView('blocked');
        await logEvent('blocked', domain, 'blocked');
        setIsLoading(false);
        return;
      }
    }

    // Check if site is known to block iframes
    if (isKnownBlocker(normalizedUrl)) {
      console.log('[SafeBrowser] Known iframe blocker detected:', domain);
      setFallbackUrl(normalizedUrl);
      setCurrentUrl('');
      setCurrentView('fallback');
      await logEvent('fallback', domain, 'iframe-blocked');
      setIsLoading(false);
      return;
    }

    // Site is allowed - try to navigate
    setCurrentUrl(normalizedUrl);
    setCurrentView('browse');
    await logEvent('allowed', domain, 'allowed');
    
    // Set a timeout to detect load failures (10 seconds max)
    loadTimeoutRef.current = setTimeout(async () => {
      if (iframeRef.current) {
        try {
          const doc = iframeRef.current.contentDocument;
          const win = iframeRef.current.contentWindow;
          
          // Check multiple failure indicators
          const isEmpty = !doc || !doc.body || doc.body.innerHTML.trim() === '';
          const isAboutBlank = win?.location?.href === 'about:blank';
          const hasNoContent = doc?.body?.children?.length === 0;
          
          if (isEmpty || isAboutBlank || hasNoContent) {
            console.log('[SafeBrowser] Iframe appears empty after timeout, switching to fallback', {
              isEmpty,
              isAboutBlank,
              hasNoContent,
            });
            await logEvent('fallback_timeout', domain, 'iframe-empty');
            setFallbackUrl(normalizedUrl);
            setCurrentView('fallback');
            setCurrentUrl('');
          }
        } catch (error) {
          // Cross-origin frame - content likely loaded successfully
          console.log('[SafeBrowser] Cross-origin frame detected - assuming content loaded');
        }
      }
      setIsLoading(false);
    }, 10000); // 10 second timeout
    
    setIsLoading(false);
  }, [url, settings, checkBlockedSite, deviceId, handleSearch]);

  // Detect iframe load errors
  const handleIframeError = useCallback(async () => {
    console.log('[SafeBrowser] Iframe load error detected');
    
    if (currentUrl) {
      const domain = extractDomain(currentUrl);
      await logEvent('iframe_error', domain, 'load-failed');
      setFallbackUrl(currentUrl);
      setCurrentView('fallback');
      setCurrentUrl('');
    }
  }, [currentUrl, deviceId]);

  // Handle iframe load success - verify content actually loaded
  const handleIframeLoad = useCallback(async () => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }
    
    // Give the page a moment to render, then check content
    setTimeout(async () => {
      if (iframeRef.current && currentUrl) {
        try {
          const doc = iframeRef.current.contentDocument;
          const win = iframeRef.current.contentWindow;
          
          // Check if the iframe loaded but is empty (CSP violation or X-Frame-Options)
          const isEmpty = doc && (!doc.body || doc.body.innerHTML.trim() === '');
          const isAboutBlank = win?.location?.href === 'about:blank';
          const isBlocked = isEmpty || isAboutBlank;
          
          if (isBlocked) {
            console.log('[SafeBrowser] Iframe loaded but blocked/empty', { isEmpty, isAboutBlank });
            const domain = extractDomain(currentUrl);
            await logEvent('iframe_blocked', domain, 'csp-violation');
            setFallbackUrl(currentUrl);
            setCurrentView('fallback');
            setCurrentUrl('');
          } else {
            console.log('[SafeBrowser] Iframe loaded successfully');
          }
        } catch (error) {
          // Cross-origin frame - this is expected for successful loads
          console.log('[SafeBrowser] Cross-origin frame - content loaded successfully');
        }
      }
    }, 1500); // Wait 1.5s for content to render
  }, [currentUrl, deviceId]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
    };
  }, []);

  const handleGoBack = () => {
    if (readerContent) {
      setReaderContent(null);
      setCurrentView('fallback');
      return;
    }
    if (currentView === 'search') {
      setCurrentView('home');
      setSearchResults([]);
      setSearchQuery('');
      return;
    }
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.history.back();
    }
  };

  const handleGoForward = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.history.forward();
    }
  };

  const handleRefresh = () => {
    if (readerContent) {
      handleReaderMode();
      return;
    }
    if (currentView === 'search' && searchQuery) {
      handleSearch(searchQuery);
      return;
    }
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.location.reload();
    }
  };

  const handleHome = () => {
    setReaderContent(null);
    setCurrentView('home');
    setUrl('');
    setDisplayUrl('');
    setCurrentUrl('');
    setSearchResults([]);
    setSearchQuery('');
  };

  const handleScanPage = () => {
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
    }, 1500);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleNavigate(url);
  };

  // Fetch content for Reader Mode (with PDF and Preview fallback)
  const handleReaderMode = async () => {
    if (!fallbackUrl) {
      console.error('[SafeBrowser] No fallback URL to load');
      return;
    }

    console.log('[SafeBrowser] Opening Reader Mode for:', fallbackUrl);
    setIsLoadingReader(true);
    setReaderError(null);
    setPdfContent(null);
    setFailureError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('proxy-reader', {
        body: { url: fallbackUrl }
      });

      if (error) {
        console.error('[SafeBrowser] Edge function error:', error);
        throw new Error(error.message || 'Failed to connect to reader service');
      }

      // Handle PDF response
      if (data?.isPdf && data?.data) {
        console.log('[SafeBrowser] PDF detected');
        setPdfContent({
          pdfUrl: data.data.pdfUrl,
          title: data.data.title,
          sourceUrl: fallbackUrl,
        });
        setCurrentView('pdf');
        await logEvent('pdf_mode', extractDomain(fallbackUrl), 'opened');
        return;
      }

      if (data?.success && data?.data) {
        const contentData = data.data;
        
        // Check if Reader Mode failed but Preview is available
        if (data.readerModeFailed) {
          console.log('[SafeBrowser] Reader Mode failed, trying Preview Mode');
          
          if (contentData.previewHtml && contentData.previewHtml.length > 100) {
            setReaderContent({
              content: '',
              previewHtml: contentData.previewHtml,
              images: contentData.images || [],
              title: contentData.title || extractDomain(fallbackUrl),
              description: contentData.description,
              sourceUrl: fallbackUrl,
            });
            setCurrentView('preview');
            await logEvent('preview_mode', extractDomain(fallbackUrl), 'opened');
            return;
          } else {
            // Full failure - no readable content and no preview
            setFailureError('No readable content could be extracted from this page.');
            setCurrentView('failure');
            await logEvent('full_failure', extractDomain(fallbackUrl), 'no-content');
            return;
          }
        }
        
        // Normal Reader Mode success
        if (!contentData.content || contentData.content.trim().length < 50) {
          // Try Preview Mode as fallback
          if (contentData.previewHtml && contentData.previewHtml.length > 100) {
            console.log('[SafeBrowser] Content too short, using Preview Mode');
            setReaderContent({
              content: '',
              previewHtml: contentData.previewHtml,
              images: contentData.images || [],
              title: contentData.title || extractDomain(fallbackUrl),
              description: contentData.description,
              sourceUrl: fallbackUrl,
            });
            setCurrentView('preview');
            await logEvent('preview_mode', extractDomain(fallbackUrl), 'fallback');
            return;
          }
          
          console.warn('[SafeBrowser] No readable content found');
          setFailureError('No readable content found on this page.');
          setCurrentView('failure');
          await logEvent('full_failure', extractDomain(fallbackUrl), 'short-content');
          return;
        }

        setReaderContent({
          content: contentData.content,
          previewHtml: contentData.previewHtml,
          images: contentData.images || [],
          title: contentData.title || extractDomain(fallbackUrl),
          description: contentData.description,
          sourceUrl: fallbackUrl,
        });
        setCurrentView('reader');
        
        await logEvent('reader_mode', extractDomain(fallbackUrl), 'opened');
      } else {
        setFailureError(data?.error || 'Failed to load content');
        setCurrentView('failure');
        await logEvent('full_failure', extractDomain(fallbackUrl), 'api-error');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Reader Mode failed';
      console.error('[SafeBrowser] Reader mode exception:', error);
      setFailureError(errorMsg);
      setCurrentView('failure');
      await logEvent('reader_mode_error', extractDomain(fallbackUrl), 'failed');
    } finally {
      setIsLoadingReader(false);
    }
  };

  const handleReaderBack = () => {
    setReaderContent(null);
    setPdfContent(null);
    setFailureError(null);
    setCurrentView('fallback');
  };

  const handleOpenExternal = () => {
    window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
  };

  // Navigate from search result
  const handleSearchResultNavigate = (resultUrl: string) => {
    setUrl(resultUrl);
    handleNavigate(resultUrl);
  };

  // Show PDF view
  if (currentView === 'pdf' && pdfContent) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <header className="px-4 py-3 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <button
              onClick={handleReaderBack}
              className="p-2 text-muted-foreground hover:text-foreground transition-colors border border-border rounded"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-aqua flex-shrink-0" />
                <span className="text-xs font-display text-aqua tracking-wider">PDF VIEWER</span>
              </div>
            </div>
          </div>
        </header>
        <div className="flex-1">
          <PDFViewer
            pdfUrl={pdfContent.pdfUrl}
            title={pdfContent.title}
            onOpenExternal={handleOpenExternal}
          />
        </div>
      </div>
    );
  }

  // Show Preview Mode view
  if (currentView === 'preview' && readerContent?.previewHtml) {
    return (
      <PreviewModeView
        previewHtml={readerContent.previewHtml}
        images={readerContent.images}
        title={readerContent.title}
        description={readerContent.description}
        sourceUrl={readerContent.sourceUrl}
        onBack={handleReaderBack}
        onOpenExternal={handleOpenExternal}
      />
    );
  }

  // Show Full Failure view
  if (currentView === 'failure') {
    return (
      <FullFailureView
        sourceUrl={fallbackUrl}
        error={failureError || 'This site cannot be rendered safely.'}
        onBack={handleReaderBack}
        onRetry={handleReaderMode}
      />
    );
  }

  // Show Reader Mode view
  if (currentView === 'reader' && readerContent) {
    return (
      <ReaderModeView
        content={readerContent.content}
        images={readerContent.images}
        title={readerContent.title}
        sourceUrl={readerContent.sourceUrl}
        onBack={handleReaderBack}
      />
    );
  }

  // Show Search Results view
  if (currentView === 'search') {
    return (
      <SearchResultsView
        query={searchQuery}
        results={searchResults}
        isLoading={isSearching}
        error={searchError}
        onBack={handleHome}
        onNavigate={handleSearchResultNavigate}
        onNewSearch={handleSearch}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header / URL Bar */}
      <header className="px-3 pt-6 pb-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-6 h-6 text-aqua" />
          <h1 className="font-display text-lg tracking-wider">SAFE BROWSER</h1>
          {settings.shield_active && (
            <div className="ml-auto flex items-center gap-1 text-aqua">
              <Lock className="w-3 h-3" />
              <span className="text-xs font-display">PROTECTED</span>
            </div>
          )}
        </div>
        
        <form onSubmit={handleFormSubmit} className="flex gap-2">
          <div className="flex-1 relative">
            {currentView === 'home' ? (
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            ) : (
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            )}
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={currentView === 'home' ? "Search or enter URL..." : "Enter URL..."}
              className="w-full bg-input border border-silver/30 rounded-sm pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || isChecking}
            className="px-4 py-2.5 bg-aqua text-accent-foreground font-display text-xs tracking-wider hover:bg-aqua/90 transition-colors disabled:opacity-50"
          >
            GO
          </button>
        </form>

        {/* Navigation controls */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleGoBack}
            disabled={currentView === 'home'}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-50"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleGoForward}
            disabled={currentView !== 'browse'}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-50"
            title="Forward"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleRefresh}
            disabled={currentView === 'home'}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-50"
            title="Refresh"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={handleHome}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20"
            title="Home"
          >
            <Home className="w-4 h-4" />
          </button>
          <button
            onClick={handleScanPage}
            disabled={currentView !== 'browse' || isScanning}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-50 flex items-center gap-1"
            title="Scan page for inappropriate images"
          >
            {isScanning ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Scan className="w-4 h-4" />
            )}
            <span className="text-xs">SCAN</span>
          </button>
        </div>
        
        {/* Current URL display */}
        {(currentUrl || fallbackUrl) && currentView !== 'home' && (
          <div className="mt-2 px-3 py-1.5 bg-muted/50 rounded-sm text-xs text-muted-foreground truncate flex items-center gap-1">
            <span className="text-aqua">🔒</span>
            {currentView === 'fallback' && <span className="text-amber-500">[Reader Available]</span>}
            {displayUrl}
          </div>
        )}
      </header>

      {/* Content Area */}
      <main className="flex-1 relative pb-16">
        {currentView === 'blocked' ? (
          // Blocked Screen
          <div className="absolute inset-0 flex items-center justify-center p-6 bg-gradient-to-b from-destructive/10 to-background">
            <div className="text-center max-w-sm">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-destructive/20 flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-destructive" />
              </div>
              <h2 className="font-display text-2xl tracking-wider text-destructive mb-2">
                SITE BLOCKED
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                {blockedReason}
              </p>
              <div className="inline-block px-4 py-2 bg-destructive/10 border border-destructive/30 text-destructive text-xs font-display tracking-wider">
                CATEGORY: {blockedCategory.toUpperCase()}
              </div>
              <p className="text-xs text-silver mt-6">
                This site has been blocked by Iron Watch protection.
                <br />
                Your accountability partner has been notified.
              </p>
              <button
                onClick={handleHome}
                className="mt-6 px-6 py-3 border border-silver/30 text-silver hover:text-foreground hover:border-silver/60 transition-colors font-display text-sm tracking-wider"
              >
                GO HOME
              </button>
            </div>
          </div>
        ) : currentView === 'fallback' ? (
          // Fallback Mode - Site can't load in iframe
          <FallbackModeUI
            url={fallbackUrl}
            onReaderMode={handleReaderMode}
            onHome={handleHome}
            isLoading={isLoadingReader}
            error={readerError}
          />
        ) : currentView === 'browse' && currentUrl ? (
          // Iframe for allowed sites
          <div className="absolute inset-0 pb-16">
            <iframe
              ref={iframeRef}
              src={currentUrl}
              className="w-full h-full border-0"
              title="Safe Browser Content"
              allow="geolocation; microphone; camera; autoplay; encrypted-media; clipboard-read; clipboard-write; fullscreen; payment"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-modals allow-downloads allow-storage-access-by-user-activation"
              referrerPolicy="no-referrer-when-downgrade"
              onError={handleIframeError}
              onLoad={handleIframeLoad}
            />
            {/* Scanning overlay */}
            {isScanning && (
              <div className="absolute inset-0 bg-background/50 flex items-center justify-center pointer-events-none">
                <div className="bg-card p-4 rounded-lg border border-aqua/30 flex items-center gap-3">
                  <Loader2 className="w-5 h-5 text-aqua animate-spin" />
                  <span className="text-sm font-display">SCANNING IMAGES...</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          // Homepage
          <SafeBrowserHomepage
            onSearch={handleSearch}
            isSearching={isSearching}
          />
        )}

        {/* Loading overlay */}
        {(isLoading || isChecking) && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
            <div className="text-center">
              <Shield className="w-12 h-12 mx-auto mb-3 text-aqua animate-pulse" />
              <p className="text-sm text-muted-foreground font-display tracking-wider">
                CHECKING SITE...
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default SafeBrowser;
