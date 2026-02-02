import { useState, useRef, useEffect, useCallback } from "react";
import { AlertTriangle, Shield, Loader2 } from "lucide-react";
import { useContentProtection } from "@/hooks/useContentProtection";
import { useSettings } from "@/hooks/useSettings";
import { useDeviceId } from "@/hooks/useDeviceId";
import { useBrowserNavigation, BrowserView } from "@/hooks/useBrowserNavigation";
import { supabase } from "@/integrations/supabase/client";
import { FallbackModeUI } from "@/components/browser/FallbackModeUI";
import { ReaderModeView } from "@/components/browser/ReaderModeView";
import { SafeBrowserHomepage } from "@/components/browser/SafeBrowserHomepage";
import { SearchResultsView } from "@/components/browser/SearchResultsView";
import { PDFViewer } from "@/components/browser/PDFViewer";
import { PreviewModeView } from "@/components/browser/PreviewModeView";
import { FullFailureView } from "@/components/browser/FullFailureView";
import { YouTubePreviewView } from "@/components/browser/YouTubePreviewView";
import { SocialPreviewView, SocialPlatform } from "@/components/browser/SocialPreviewView";
import { BrowserHeader } from "@/components/browser/BrowserHeader";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
}

// Sites known to block iframes
const KNOWN_IFRAME_BLOCKERS = [
  'google.com', 'youtube.com', 'facebook.com', 'twitter.com', 'x.com',
  'instagram.com', 'linkedin.com', 'github.com', 'amazon.com', 'ebay.com',
  'reddit.com', 'netflix.com', 'spotify.com', 'apple.com', 'microsoft.com',
  'tiktok.com', 'pinterest.com', 'tumblr.com', 'snapchat.com',
];

// Social platforms that get special preview treatment
const SOCIAL_PLATFORMS = [
  'youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com',
  'facebook.com', 'fb.com', 'twitter.com', 'x.com',
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

interface YouTubeContent {
  videoId: string;
  title: string;
  channelName: string;
  description: string;
  thumbnailUrl: string;
  sourceUrl: string;
}

interface SocialContent {
  platform: SocialPlatform;
  contentId: string;
  title: string;
  author: string;
  description: string;
  thumbnailUrl: string;
  sourceUrl: string;
}

const SafeBrowser = () => {
  // URL input state (separate from navigation state)
  const [urlInput, setUrlInput] = useState("");
  
  // Navigation state
  const {
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
  } = useBrowserNavigation();
  
  // Loading states
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingReader, setIsLoadingReader] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  // Content states
  const [fallbackUrl, setFallbackUrl] = useState("");
  const [readerContent, setReaderContent] = useState<ReaderContent | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [pdfContent, setPdfContent] = useState<PDFContent | null>(null);
  const [youtubeContent, setYoutubeContent] = useState<YouTubeContent | null>(null);
  const [socialContent, setSocialContent] = useState<SocialContent | null>(null);
  const [failureError, setFailureError] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState("");
  const [blockedCategory, setBlockedCategory] = useState("");
  
  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  
  // Refs
  const { checkBlockedSite, isChecking } = useContentProtection();
  const { settings } = useSettings();
  const deviceId = useDeviceId();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Utility functions
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

  const isSocialPlatform = (urlString: string): boolean => {
    const domain = extractDomain(urlString);
    return SOCIAL_PLATFORMS.some(platform => 
      domain === platform || domain.endsWith('.' + platform)
    );
  };

  const getSocialPlatformName = (urlString: string): string | undefined => {
    const domain = extractDomain(urlString);
    if (domain.includes('youtube') || domain.includes('youtu.be')) return 'YouTube';
    if (domain.includes('instagram')) return 'Instagram';
    if (domain.includes('tiktok')) return 'TikTok';
    if (domain.includes('facebook') || domain.includes('fb.')) return 'Facebook';
    if (domain.includes('twitter') || domain.includes('x.com')) return 'X (Twitter)';
    return undefined;
  };

  const logEvent = useCallback(async (eventType: string, domain: string, action: string) => {
    if (!deviceId) return;
    try {
      await supabase.from('content_moderation_logs').insert({
        device_id: deviceId,
        content_type: 'website',
        url: domain,
        classification: eventType,
        action_taken: action,
        confidence: 1.0,
      });
    } catch (error) {
      console.error('[SafeBrowser] Failed to log event:', error);
    }
  }, [deviceId]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
      }
    };
  }, []);

  // Search handler
  const handleSearch = useCallback(async (query: string) => {
    console.log('[SafeBrowser] Starting search:', query);
    setSearchQuery(query);
    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);
    navigate('search', '', query);
    
    await logEvent('search', query, 'search_query');
    
    try {
      const { data, error } = await supabase.functions.invoke('web-search', {
        body: { query }
      });
      
      if (error) throw new Error(error.message || 'Search failed');
      
      if (data?.success && data?.results) {
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
  }, [navigate, logEvent]);

  // Main navigation handler
  const handleNavigate = useCallback(async (targetUrl?: string, e?: React.FormEvent) => {
    e?.preventDefault();
    
    const urlToNavigate = targetUrl || urlInput;
    if (!urlToNavigate.trim()) return;

    // Check if it's a search query
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
    setPdfContent(null);
    setYoutubeContent(null);
    setSocialContent(null);
    setFailureError(null);
    
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }
    
    const normalizedUrl = normalizeUrl(urlToNavigate);
    const domain = extractDomain(urlToNavigate);

    // Update URL bar
    setUrlInput(normalizedUrl);

    // Check if the site is blocked
    if (settings.block_adult_sites) {
      const result = await checkBlockedSite(normalizedUrl, deviceId);
      
      if (result?.isBlocked) {
        setBlockedReason(result.reason);
        setBlockedCategory(result.category || 'blocked');
        navigate('blocked', '', normalizedUrl);
        await logEvent('blocked', domain, 'blocked');
        setIsLoading(false);
        return;
      }
    }

    // Check if site is known to block iframes
    if (isKnownBlocker(normalizedUrl)) {
      console.log('[SafeBrowser] Known iframe blocker detected:', domain);
      setFallbackUrl(normalizedUrl);
      navigate('fallback', '', normalizedUrl);
      await logEvent('fallback', domain, 'iframe-blocked');
      setIsLoading(false);
      return;
    }

    // Try to load in iframe
    navigate('browse', normalizedUrl, normalizedUrl);
    await logEvent('allowed', domain, 'allowed');
    
    // Timeout to detect load failures
    loadTimeoutRef.current = setTimeout(async () => {
      if (iframeRef.current) {
        try {
          const doc = iframeRef.current.contentDocument;
          const win = iframeRef.current.contentWindow;
          const isEmpty = !doc || !doc.body || doc.body.innerHTML.trim() === '';
          const isAboutBlank = win?.location?.href === 'about:blank';
          const hasNoContent = doc?.body?.children?.length === 0;
          
          if (isEmpty || isAboutBlank || hasNoContent) {
            console.log('[SafeBrowser] Iframe empty after timeout, switching to fallback');
            await logEvent('fallback_timeout', domain, 'iframe-empty');
            setFallbackUrl(normalizedUrl);
            navigate('fallback', '', normalizedUrl);
          }
        } catch {
          console.log('[SafeBrowser] Cross-origin frame - content loaded successfully');
        }
      }
      setIsLoading(false);
    }, 10000);
    
    setIsLoading(false);
  }, [urlInput, settings, checkBlockedSite, deviceId, handleSearch, navigate, logEvent]);

  // Iframe event handlers
  const handleIframeError = useCallback(async () => {
    console.log('[SafeBrowser] Iframe load error');
    if (currentUrl) {
      const domain = extractDomain(currentUrl);
      await logEvent('iframe_error', domain, 'load-failed');
      setFallbackUrl(currentUrl);
      navigate('fallback', '', currentUrl);
    }
  }, [currentUrl, navigate, logEvent]);

  const handleIframeLoad = useCallback(async () => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }
    
    setTimeout(async () => {
      if (iframeRef.current && currentUrl) {
        try {
          const doc = iframeRef.current.contentDocument;
          const win = iframeRef.current.contentWindow;
          const isEmpty = doc && (!doc.body || doc.body.innerHTML.trim() === '');
          const isAboutBlank = win?.location?.href === 'about:blank';
          
          if (isEmpty || isAboutBlank) {
            console.log('[SafeBrowser] Iframe blocked/empty');
            const domain = extractDomain(currentUrl);
            await logEvent('iframe_blocked', domain, 'csp-violation');
            setFallbackUrl(currentUrl);
            navigate('fallback', '', currentUrl);
          }
        } catch {
          console.log('[SafeBrowser] Cross-origin frame - loaded successfully');
        }
      }
    }, 1500);
  }, [currentUrl, navigate, logEvent]);

  // Reader Mode handler
  const handleReaderMode = useCallback(async () => {
    if (!fallbackUrl) {
      console.error('[SafeBrowser] No fallback URL');
      return;
    }

    console.log('[SafeBrowser] Opening Reader Mode for:', fallbackUrl);
    setIsLoadingReader(true);
    setReaderError(null);
    setPdfContent(null);
    setYoutubeContent(null);
    setSocialContent(null);
    setFailureError(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('proxy-reader', {
        body: { url: fallbackUrl }
      });

      if (error) throw new Error(error.message || 'Failed to connect to reader service');

      const domain = extractDomain(fallbackUrl);

      // Handle PDF
      if (data?.isPdf && data?.data) {
        setPdfContent({
          pdfUrl: data.data.pdfUrl,
          title: data.data.title,
          sourceUrl: fallbackUrl,
        });
        navigate('pdf', '', fallbackUrl);
        await logEvent('pdf_mode', domain, 'opened');
        return;
      }

      // Handle social platform
      if (data?.isSocialPlatform && data?.data) {
        const platformData = data.data;
        
        if (data.isYouTube || platformData.platform === 'youtube') {
          setYoutubeContent({
            videoId: platformData.videoId || platformData.contentId,
            title: platformData.title,
            channelName: platformData.channelName || platformData.author,
            description: platformData.description,
            thumbnailUrl: platformData.thumbnailUrl,
            sourceUrl: fallbackUrl,
          });
          navigate('youtube', '', fallbackUrl);
          await logEvent('youtube_preview', domain, `video:${platformData.videoId || platformData.contentId}`);
          return;
        }
        
        setSocialContent({
          platform: platformData.platform as SocialPlatform,
          contentId: platformData.contentId,
          title: platformData.title,
          author: platformData.author,
          description: platformData.description,
          thumbnailUrl: platformData.thumbnailUrl,
          sourceUrl: fallbackUrl,
        });
        navigate('social', '', fallbackUrl);
        await logEvent(`${platformData.platform}_preview`, domain, `content:${platformData.contentId}`);
        return;
      }

      // Legacy YouTube handling
      if (data?.isYouTube && data?.data) {
        setYoutubeContent({
          videoId: data.data.videoId,
          title: data.data.title,
          channelName: data.data.channelName,
          description: data.data.description,
          thumbnailUrl: data.data.thumbnailUrl,
          sourceUrl: fallbackUrl,
        });
        navigate('youtube', '', fallbackUrl);
        await logEvent('youtube_preview', domain, `video:${data.data.videoId}`);
        return;
      }

      // Handle regular content
      if (data?.success && data?.data) {
        const contentData = data.data;
        
        // Reader Mode failed but Preview available
        if (data.readerModeFailed) {
          if (contentData.previewHtml && contentData.previewHtml.length > 100) {
            setReaderContent({
              content: '',
              previewHtml: contentData.previewHtml,
              images: contentData.images || [],
              title: contentData.title || domain,
              description: contentData.description,
              sourceUrl: fallbackUrl,
            });
            navigate('preview', '', fallbackUrl);
            await logEvent('preview_mode', domain, 'opened');
            return;
          }
          
          setFailureError('No readable content could be extracted from this page.');
          navigate('failure', '', fallbackUrl);
          await logEvent('full_failure', domain, 'no-content');
          return;
        }
        
        // Check content length
        if (!contentData.content || contentData.content.trim().length < 50) {
          if (contentData.previewHtml && contentData.previewHtml.length > 100) {
            setReaderContent({
              content: '',
              previewHtml: contentData.previewHtml,
              images: contentData.images || [],
              title: contentData.title || domain,
              description: contentData.description,
              sourceUrl: fallbackUrl,
            });
            navigate('preview', '', fallbackUrl);
            await logEvent('preview_mode', domain, 'fallback');
            return;
          }
          
          setFailureError('No readable content found on this page.');
          navigate('failure', '', fallbackUrl);
          await logEvent('full_failure', domain, 'short-content');
          return;
        }

        // Success - Reader Mode
        setReaderContent({
          content: contentData.content,
          previewHtml: contentData.previewHtml,
          images: contentData.images || [],
          title: contentData.title || domain,
          description: contentData.description,
          sourceUrl: fallbackUrl,
        });
        navigate('reader', '', fallbackUrl);
        await logEvent('reader_mode', domain, 'opened');
      } else {
        setFailureError(data?.error || 'Failed to load content');
        navigate('failure', '', fallbackUrl);
        await logEvent('full_failure', domain, 'api-error');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Reader Mode failed';
      console.error('[SafeBrowser] Reader mode exception:', error);
      setFailureError(errorMsg);
      navigate('failure', '', fallbackUrl);
      await logEvent('reader_mode_error', extractDomain(fallbackUrl), 'failed');
    } finally {
      setIsLoadingReader(false);
    }
  }, [fallbackUrl, navigate, logEvent]);

  // Navigation handlers
  const handleGoBack = useCallback(() => {
    // Special handling for content views
    if (['reader', 'preview', 'youtube', 'social', 'pdf', 'failure'].includes(currentView)) {
      setReaderContent(null);
      setPdfContent(null);
      setYoutubeContent(null);
      setSocialContent(null);
      setFailureError(null);
      navigate('fallback', '', fallbackUrl);
      return;
    }
    
    if (currentView === 'search') {
      goHome();
      setSearchResults([]);
      setSearchQuery('');
      setUrlInput('');
      return;
    }
    
    if (!goBack() && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.history.back();
    }
  }, [currentView, fallbackUrl, navigate, goBack, goHome]);

  const handleGoForward = useCallback(() => {
    if (!goForward() && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.history.forward();
    }
  }, [goForward]);

  const handleRefresh = useCallback(() => {
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
  }, [readerContent, currentView, searchQuery, handleReaderMode, handleSearch]);

  const handleHome = useCallback(() => {
    setReaderContent(null);
    setPdfContent(null);
    setYoutubeContent(null);
    setSocialContent(null);
    setFailureError(null);
    setSearchResults([]);
    setSearchQuery('');
    setUrlInput('');
    setFallbackUrl('');
    goHome();
  }, [goHome]);

  const handleScanPage = useCallback(() => {
    setIsScanning(true);
    setTimeout(() => setIsScanning(false), 1500);
  }, []);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleNavigate(urlInput);
  };

  const handleOpenExternal = useCallback((url: string, eventType: string = 'external_click') => {
    logEvent(eventType, extractDomain(url), 'opened');
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [logEvent]);

  // Render special views
  if (currentView === 'youtube' && youtubeContent) {
    return (
      <YouTubePreviewView
        videoId={youtubeContent.videoId}
        title={youtubeContent.title}
        channelName={youtubeContent.channelName}
        description={youtubeContent.description}
        thumbnailUrl={youtubeContent.thumbnailUrl}
        sourceUrl={youtubeContent.sourceUrl}
        onBack={handleGoBack}
        onOpenExternal={() => handleOpenExternal(youtubeContent.sourceUrl, 'youtube_external_click')}
      />
    );
  }

  if (currentView === 'social' && socialContent) {
    return (
      <SocialPreviewView
        platform={socialContent.platform}
        title={socialContent.title}
        author={socialContent.author}
        description={socialContent.description}
        thumbnailUrl={socialContent.thumbnailUrl}
        sourceUrl={socialContent.sourceUrl}
        contentId={socialContent.contentId}
        onBack={handleGoBack}
        onOpenExternal={() => handleOpenExternal(socialContent.sourceUrl, `${socialContent.platform}_external_click`)}
      />
    );
  }

  if (currentView === 'pdf' && pdfContent) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <BrowserHeader
          currentView={currentView}
          displayUrl={displayUrl}
          urlInput={urlInput}
          onUrlChange={setUrlInput}
          onSubmit={handleFormSubmit}
          onBack={handleGoBack}
          onForward={handleGoForward}
          onRefresh={handleRefresh}
          onHome={handleHome}
          canGoBack={true}
          canGoForward={canGoForward}
          isLoading={isLoading}
          isProtected={settings.shield_active}
          modeLabel="PDF Viewer"
          modeColor="text-blue-500"
        />
        <div className="flex-1">
          <PDFViewer
            pdfUrl={pdfContent.pdfUrl}
            title={pdfContent.title}
            onOpenExternal={() => handleOpenExternal(pdfContent.sourceUrl)}
          />
        </div>
      </div>
    );
  }

  if (currentView === 'preview' && readerContent?.previewHtml) {
    return (
      <PreviewModeView
        previewHtml={readerContent.previewHtml}
        images={readerContent.images}
        title={readerContent.title}
        description={readerContent.description}
        sourceUrl={readerContent.sourceUrl}
        onBack={handleGoBack}
        onOpenExternal={() => handleOpenExternal(readerContent.sourceUrl)}
      />
    );
  }

  if (currentView === 'failure') {
    return (
      <FullFailureView
        sourceUrl={fallbackUrl}
        error={failureError || 'This site cannot be rendered safely.'}
        onBack={handleGoBack}
        onRetry={handleReaderMode}
      />
    );
  }

  if (currentView === 'reader' && readerContent) {
    return (
      <ReaderModeView
        content={readerContent.content}
        images={readerContent.images}
        title={readerContent.title}
        sourceUrl={readerContent.sourceUrl}
        onBack={handleGoBack}
      />
    );
  }

  if (currentView === 'search') {
    return (
      <SearchResultsView
        query={searchQuery}
        results={searchResults}
        isLoading={isSearching}
        error={searchError}
        onBack={handleHome}
        onNavigate={(resultUrl) => {
          setUrlInput(resultUrl);
          handleNavigate(resultUrl);
        }}
        onNewSearch={handleSearch}
      />
    );
  }

  // Main browser view
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <BrowserHeader
        currentView={currentView}
        displayUrl={displayUrl}
        urlInput={urlInput}
        onUrlChange={setUrlInput}
        onSubmit={handleFormSubmit}
        onBack={handleGoBack}
        onForward={handleGoForward}
        onRefresh={handleRefresh}
        onHome={handleHome}
        onScan={handleScanPage}
        canGoBack={canGoBack || currentView !== 'home'}
        canGoForward={canGoForward}
        isLoading={isLoading || isChecking}
        isScanning={isScanning}
        isProtected={settings.shield_active}
        modeLabel={getModeLabel()}
        modeColor={getModeColor()}
      />

      <main className="flex-1 relative pb-16">
        {currentView === 'blocked' ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 bg-gradient-to-b from-destructive/10 to-background">
            <div className="text-center max-w-sm">
              <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-destructive/20 flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-destructive" />
              </div>
              <h2 className="font-display text-2xl tracking-wider text-destructive mb-2">
                SITE BLOCKED
              </h2>
              <p className="text-sm text-muted-foreground mb-4">{blockedReason}</p>
              <div className="inline-block px-4 py-2 bg-destructive/10 border border-destructive/30 text-destructive text-xs font-display tracking-wider">
                CATEGORY: {blockedCategory.toUpperCase()}
              </div>
              <p className="text-xs text-silver mt-6">
                This site has been blocked by Iron Watch protection.
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
          <FallbackModeUI
            url={fallbackUrl}
            onReaderMode={handleReaderMode}
            onHome={handleHome}
            isLoading={isLoadingReader}
            error={readerError}
            isSocialPlatform={isSocialPlatform(fallbackUrl)}
            platformName={getSocialPlatformName(fallbackUrl)}
          />
        ) : currentView === 'browse' && currentUrl ? (
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
          <SafeBrowserHomepage onSearch={handleSearch} isSearching={isSearching} />
        )}

        {(isLoading || isChecking) && currentView !== 'browse' && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
            <div className="text-center">
              <Shield className="w-12 h-12 mx-auto mb-3 text-aqua animate-pulse" />
              <p className="text-sm text-muted-foreground font-display tracking-wider">CHECKING SITE...</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default SafeBrowser;
