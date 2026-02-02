import { useState, useRef, useEffect, useCallback } from "react";
import { Globe, ArrowLeft, ArrowRight, RotateCcw, Shield, AlertTriangle, Lock, Home, Scan, Loader2 } from "lucide-react";
import { useContentProtection } from "@/hooks/useContentProtection";
import { useSettings } from "@/hooks/useSettings";
import { useDeviceId } from "@/hooks/useDeviceId";
import { supabase } from "@/integrations/supabase/client";
import { FallbackModeUI } from "@/components/browser/FallbackModeUI";
import { ReaderModeView } from "@/components/browser/ReaderModeView";

const HOMEPAGE = "https://www.google.com";

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
  images: string[];
  title: string;
  sourceUrl: string;
}

const SafeBrowser = () => {
  const [url, setUrl] = useState(HOMEPAGE);
  const [displayUrl, setDisplayUrl] = useState(HOMEPAGE);
  const [currentUrl, setCurrentUrl] = useState("");
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedReason, setBlockedReason] = useState("");
  const [blockedCategory, setBlockedCategory] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [hasNavigated, setHasNavigated] = useState(false);
  
  // Fallback mode state
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState("");
  const [isLoadingReader, setIsLoadingReader] = useState(false);
  const [readerContent, setReaderContent] = useState<ReaderContent | null>(null);
  const [iframeLoadFailed, setIframeLoadFailed] = useState(false);
  
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

  const handleNavigate = useCallback(async (targetUrl?: string, e?: React.FormEvent) => {
    e?.preventDefault();
    
    const urlToNavigate = targetUrl || url;
    if (!urlToNavigate.trim()) return;

    // Reset states
    setIsLoading(true);
    setIsBlocked(false);
    setIsFallbackMode(false);
    setReaderContent(null);
    setIframeLoadFailed(false);
    
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
        setIsBlocked(true);
        setBlockedReason(result.reason);
        setBlockedCategory(result.category || 'blocked');
        setCurrentUrl('');
        await logEvent('blocked', domain, 'blocked');
        setIsLoading(false);
        return;
      }
    }

    // Check if site is known to block iframes
    if (isKnownBlocker(normalizedUrl)) {
      console.log('[SafeBrowser] Known iframe blocker detected:', domain);
      setFallbackUrl(normalizedUrl);
      setIsFallbackMode(true);
      setCurrentUrl('');
      await logEvent('fallback', domain, 'iframe-blocked');
      setIsLoading(false);
      return;
    }

    // Site is allowed - try to navigate
    setCurrentUrl(normalizedUrl);
    setHasNavigated(true);
    await logEvent('allowed', domain, 'allowed');
    
    // Set a timeout to detect load failures
    loadTimeoutRef.current = setTimeout(() => {
      // If still loading after 8 seconds, might be blocked
      if (iframeRef.current) {
        try {
          // Try to access iframe content - will fail if blocked
          const doc = iframeRef.current.contentDocument;
          if (!doc || !doc.body || doc.body.innerHTML === '') {
            console.log('[SafeBrowser] Iframe appears empty, switching to fallback');
            setFallbackUrl(normalizedUrl);
            setIsFallbackMode(true);
            setCurrentUrl('');
          }
        } catch (error) {
          // Cross-origin error means it loaded something
          console.log('[SafeBrowser] Cross-origin frame detected - content loaded');
        }
      }
      setIsLoading(false);
    }, 8000);
    
    setIsLoading(false);
  }, [url, settings, checkBlockedSite, deviceId]);

  // Detect iframe load errors
  const handleIframeError = useCallback(() => {
    console.log('[SafeBrowser] Iframe load error detected');
    setIframeLoadFailed(true);
    
    if (currentUrl) {
      setFallbackUrl(currentUrl);
      setIsFallbackMode(true);
      setCurrentUrl('');
    }
  }, [currentUrl]);

  // Handle iframe load success
  const handleIframeLoad = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }
    
    // Check if the iframe actually loaded content
    setTimeout(() => {
      if (iframeRef.current) {
        try {
          const doc = iframeRef.current.contentDocument;
          // If we can access the document and it's empty, switch to fallback
          if (doc && (!doc.body || doc.body.innerHTML.trim() === '')) {
            console.log('[SafeBrowser] Iframe loaded but empty');
            if (currentUrl) {
              setFallbackUrl(currentUrl);
              setIsFallbackMode(true);
              setCurrentUrl('');
            }
          }
        } catch (error) {
          // Cross-origin error is expected for sites that load properly
          console.log('[SafeBrowser] Cross-origin frame - content loaded successfully');
        }
      }
    }, 1000);
  }, [currentUrl]);

  // Auto-navigate to homepage on mount
  useEffect(() => {
    if (!hasNavigated) {
      handleNavigate(HOMEPAGE);
    }
  }, [hasNavigated, handleNavigate]);

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
      setIsFallbackMode(true);
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
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.location.reload();
    }
  };

  const handleHome = () => {
    setReaderContent(null);
    setIsFallbackMode(false);
    setUrl(HOMEPAGE);
    setDisplayUrl(HOMEPAGE);
    handleNavigate(HOMEPAGE);
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

  // Fetch content for Reader Mode
  const handleReaderMode = async () => {
    if (!fallbackUrl) return;

    setIsLoadingReader(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('proxy-reader', {
        body: { url: fallbackUrl }
      });

      if (error) {
        console.error('[SafeBrowser] Reader mode error:', error);
        throw new Error(error.message);
      }

      if (data?.success && data?.data) {
        setReaderContent({
          content: data.data.content,
          images: data.data.images || [],
          title: data.data.title || extractDomain(fallbackUrl),
          sourceUrl: fallbackUrl,
        });
        
        // Log reader mode usage
        await logEvent('reader_mode', extractDomain(fallbackUrl), 'opened');
      } else {
        throw new Error(data?.error || 'Failed to load content');
      }
    } catch (error) {
      console.error('[SafeBrowser] Failed to load reader mode:', error);
      // Could show error toast here
    } finally {
      setIsLoadingReader(false);
    }
  };

  const handleReaderBack = () => {
    setReaderContent(null);
    setIsFallbackMode(true);
  };

  // Show Reader Mode view
  if (readerContent) {
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
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter URL or search..."
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
            disabled={!currentUrl && !readerContent}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-50"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleGoForward}
            disabled={!currentUrl}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-50"
            title="Forward"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleRefresh}
            disabled={!currentUrl && !readerContent}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-50"
            title="Refresh"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={handleHome}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20"
            title="Home (Google)"
          >
            <Home className="w-4 h-4" />
          </button>
          <button
            onClick={handleScanPage}
            disabled={!currentUrl || isScanning}
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
        {(currentUrl || fallbackUrl) && (
          <div className="mt-2 px-3 py-1.5 bg-muted/50 rounded-sm text-xs text-muted-foreground truncate flex items-center gap-1">
            <span className="text-aqua">🔒</span>
            {isFallbackMode && <span className="text-amber-500">[Reader Available]</span>}
            {displayUrl}
          </div>
        )}
      </header>

      {/* Content Area */}
      <main className="flex-1 relative pb-16">
        {isBlocked ? (
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
        ) : isFallbackMode ? (
          // Fallback Mode - Site can't load in iframe
          <FallbackModeUI
            url={fallbackUrl}
            onReaderMode={handleReaderMode}
            onHome={handleHome}
            isLoading={isLoadingReader}
          />
        ) : currentUrl ? (
          // Iframe for allowed sites - with full browser permissions
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
          // Empty state / Loading homepage
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center">
              <Globe className="w-16 h-16 mx-auto mb-4 text-silver/30" />
              <p className="text-sm text-muted-foreground">
                Loading...
              </p>
              <p className="text-xs text-silver mt-2">
                All sites are checked against the blocklist
              </p>
            </div>
          </div>
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
