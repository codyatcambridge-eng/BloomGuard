import { useState, useCallback, useEffect, useRef } from 'react';
import { Shield, AlertTriangle, Loader2, Globe } from 'lucide-react';
import { useNativeWebView } from '@/hooks/useNativeWebView';
import { useContentProtection } from '@/hooks/useContentProtection';
import { useSettings } from '@/hooks/useSettings';
import { useLocalSettings } from '@/hooks/useLocalSettings';
import { useDeviceId } from '@/hooks/useDeviceId';
import { useBrowserNavigation, BrowserView } from '@/hooks/useBrowserNavigation';
import { useCapacitor } from '@/hooks/useCapacitor';
import { useModerationBridge } from '@/hooks/useModerationBridge';
import { supabase } from '@/integrations/supabase/client';
import { generateModerationScript } from '@/lib/webview-injection-script';
import { BrowserHeader } from './BrowserHeader';
import { SafeBrowserHomepage } from './SafeBrowserHomepage';
import { SearchResultsView } from './SearchResultsView';
import { FallbackModeUI } from './FallbackModeUI';
import { ReaderModeView } from './ReaderModeView';
import { PreviewModeView } from './PreviewModeView';
import { FullFailureView } from './FullFailureView';
import { PDFViewer } from './PDFViewer';
import { YouTubePreviewView } from './YouTubePreviewView';
import { SocialPreviewView, SocialPlatform } from './SocialPreviewView';
import { ExternalLinkWarning } from './ExternalLinkWarning';
import { AIStatusBar } from './AIStatusBar';
import { toast } from 'sonner';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  thumbnail?: string;
}

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

/**
 * NativeWebViewBrowser - Unified browser component
 * Uses native WebView on mobile, fallback modes on web
 * Social platforms load fully in WebView (not preview mode)
 */
export const NativeWebViewBrowser = () => {
  const { isNative, platform } = useCapacitor();
  
  const [urlInput, setUrlInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingReader, setIsLoadingReader] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  // Content states
  const [fallbackUrl, setFallbackUrl] = useState('');
  const [readerContent, setReaderContent] = useState<ReaderContent | null>(null);
  const [readerError, setReaderError] = useState<string | null>(null);
  const [pdfContent, setPdfContent] = useState<PDFContent | null>(null);
  const [youtubeContent, setYoutubeContent] = useState<YouTubeContent | null>(null);
  const [socialContent, setSocialContent] = useState<SocialContent | null>(null);
  const [failureError, setFailureError] = useState<string | null>(null);
  const [blockedReason, setBlockedReason] = useState('');
  const [blockedCategory, setBlockedCategory] = useState('');
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  
  // External link warning
  const [externalWarningUrl, setExternalWarningUrl] = useState<string | null>(null);
  
  // Hooks
  const { checkBlockedSite, isChecking } = useContentProtection();
  const { settings } = useSettings();
  const { settings: localSettings, getModerationConfig, isModerationEnabled } = useLocalSettings();
  const deviceId = useDeviceId();
  
  // Moderation bridge for AI image scanning
  const moderationBridge = useModerationBridge({
    onImageBlurred: (src, result) => {
      console.log('[Browser] Image blurred:', src.substring(0, 50), result.category);
      if (localSettings.show_scan_notifications) {
        toast.info(`Image blurred: ${result.category}`, {
          duration: 2000,
        });
      }
    },
    onScanComplete: (stats) => {
      console.log('[Browser] Scan complete:', stats);
      if (localSettings.show_scan_notifications && stats.blurred > 0) {
        toast.success(`Scanned ${stats.total} images, ${stats.blurred} blurred`, {
          duration: 3000,
        });
      }
    },
  });
  
  // Track if moderation script was injected
  const injectionDoneRef = useRef(false);
  
  const {
    currentView,
    currentUrl,
    displayUrl,
    navigate,
    goBack: navGoBack,
    goForward: navGoForward,
    goHome,
    canGoBack: navCanGoBack,
    canGoForward: navCanGoForward,
    getModeLabel,
    getModeColor,
  } = useBrowserNavigation();

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

  const isPdfUrl = (urlString: string): boolean => {
    return urlString.toLowerCase().endsWith('.pdf');
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
      console.error('[Browser] Failed to log event:', error);
    }
  }, [deviceId]);

  // Native WebView handlers
  const handleNavigationRequest = useCallback(async (url: string): Promise<boolean> => {
    const domain = extractDomain(url);
    
    // Check blocklist
    if (settings.block_adult_sites) {
      const result = await checkBlockedSite(url, deviceId);
      if (result?.isBlocked) {
        setBlockedReason(result.reason);
        setBlockedCategory(result.category || 'blocked');
        navigate('blocked', '', url);
        await logEvent('blocked', domain, 'blocked');
        return false;
      }
    }
    
    // All navigation allowed in native WebView (including social platforms)
    return true;
  }, [settings, checkBlockedSite, deviceId, navigate, logEvent]);

  // Inject moderation script into WebView
  const injectModerationScript = useCallback(async (scriptExecutor: (script: string) => Promise<string | null>) => {
    if (!isModerationEnabled()) {
      console.log('[Browser] Moderation disabled, skipping injection');
      return;
    }
    
    const config = getModerationConfig();
    console.log('[Browser] Injecting moderation script with config:', config);
    
    // First inject CSS styles
    const cssInjection = `
      (function() {
        if (document.getElementById('gc-moderation-styles')) return;
        const style = document.createElement('style');
        style.id = 'gc-moderation-styles';
        style.textContent = \`
          .gc-reveal-overlay {
            position: absolute !important;
            inset: 0 !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            background: rgba(0, 0, 0, 0.25) !important;
            z-index: 9998 !important;
          }
          .gc-reveal-btn {
            background: rgba(0, 0, 0, 0.9) !important;
            color: white !important;
            border: 2px solid rgba(255, 255, 255, 0.4) !important;
            padding: 10px 20px !important;
            border-radius: 8px !important;
            cursor: pointer !important;
            font-size: 14px !important;
            font-weight: bold !important;
          }
          [data-gc-moderated="blurred"] { transition: filter 0.3s ease !important; }
          ytd-thumbnail, ytd-rich-item-renderer, yt-img-shadow, #shorts-player { position: relative !important; }
        \`;
        document.head.appendChild(style);
        console.log('[GC:inject] CSS styles injected');
      })();
    `;
    
    try {
      await scriptExecutor(cssInjection);
      console.log('[Browser] CSS styles injected');
    } catch (e) {
      console.warn('[Browser] CSS injection failed:', e);
    }
    
    // Then inject main moderation script
    const mainScript = generateModerationScript(config);
    try {
      await scriptExecutor(mainScript);
      injectionDoneRef.current = true;
      console.log('[Browser] Main moderation script injected successfully');
    } catch (error) {
      console.error('[Browser] Moderation script injection failed:', error);
    }
  }, [isModerationEnabled, getModerationConfig]);

  const {
    state: webViewState,
    open: openWebView,
    close: closeWebView,
    goBack: webViewGoBack,
    goForward: webViewGoForward,
    reload: webViewReload,
    executeScript,
  } = useNativeWebView({
    onLoadStart: (url) => {
      console.log('[Browser] ======= LOAD START =======');
      console.log('[Browser] URL:', url);
      setIsLoading(true);
      injectionDoneRef.current = false;
    },
    onLoadEnd: async (url) => {
      console.log('[Browser] ======= LOAD END =======');
      console.log('[Browser] URL:', url);
      setIsLoading(false);
      
      // Inject moderation script after page fully loads
      if (!injectionDoneRef.current) {
        // Small delay to ensure DOM is ready
        setTimeout(async () => {
          await injectModerationScript(executeScript);
        }, 500);
      }
    },
    onLoadError: (url, error) => {
      console.error('[Browser] ======= LOAD ERROR =======');
      console.error('[Browser] URL:', url);
      console.error('[Browser] Error:', error);
      setIsLoading(false);
      injectionDoneRef.current = false;
      setFallbackUrl(url);
      navigate('fallback', '', url);
    },
    onUrlChange: (url) => {
      console.log('[Browser] ======= URL CHANGE =======');
      console.log('[Browser] New URL:', url);
      setUrlInput(url);
      navigate('browse', url, url);
      // Reset injection for new page navigation
      injectionDoneRef.current = false;
    },
    onNavigationRequest: handleNavigationRequest,
    onClose: () => {
      console.log('[Browser] ======= WEBVIEW CLOSED =======');
      moderationBridge.clearCache();
      injectionDoneRef.current = false;
      navigate('home', '', '');
    },
  });

  // Poll for moderation requests from WebView
  // InAppBrowser doesn't support direct postMessage, so we use polling
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    if (!isNative || !webViewState.isOpen || !isModerationEnabled()) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    console.log('[Browser] Starting moderation request polling...');

    // Poll for pending scan requests from the injected script
    const pollForRequests = async () => {
      if (!executeScript) return;
      
      try {
        // Get pending requests from WebView
        const getPendingScript = `
          (function() {
            if (!window.__GC_MODERATION__) return JSON.stringify({ pending: [] });
            
            const state = window.__GC_MODERATION__.state;
            const pending = [];
            
            // Get pending items that haven't been sent yet
            state.pendingScans.forEach((item, msgId) => {
              pending.push({ messageId: msgId, src: item.src, sourceType: item.sourceType });
            });
            
            return JSON.stringify({ pending: pending.slice(0, 5) }); // Batch of 5
          })();
        `;
        
        await executeScript(getPendingScript);
        // Note: InAppBrowser executeScript doesn't return values
        // We need a different approach - modify the injection to use direct callbacks
        
      } catch (e) {
        // Polling errors are expected and ignored
      }
    };

    // Start polling at 200ms intervals
    pollIntervalRef.current = setInterval(pollForRequests, 500);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isNative, webViewState.isOpen, isModerationEnabled, executeScript]);

  // Also listen for messages via window.postMessage (works in some WebView contexts)
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'gc-moderation-request' && event.data?.action === 'scan') {
        console.log('[Browser] Received moderation request via postMessage');
        const result = await moderationBridge.handleWebViewMessage(event.data);
        
        if (result && executeScript) {
          const escapedSrc = result.src.replace(/'/g, "\\'").replace(/"/g, '\\"');
          const messageId = (result as any).messageId || 0;
          const responseScript = `
            (function() {
              if (window.__GC_MODERATION_RESULT__) {
                window.__GC_MODERATION_RESULT__({
                  messageId: ${messageId},
                  src: '${escapedSrc}',
                  shouldBlur: ${result.shouldBlur},
                  category: '${result.category}',
                  confidence: ${result.confidence}
                });
              }
              window.postMessage({
                type: 'gc-moderation-result',
                messageId: ${messageId},
                src: '${escapedSrc}',
                shouldBlur: ${result.shouldBlur},
                category: '${result.category}',
                confidence: ${result.confidence}
              }, '*');
            })();
          `;
          try {
            await executeScript(responseScript);
            console.log('[Browser] Sent moderation result for:', escapedSrc.substring(0, 50));
          } catch (error) {
            console.debug('[Browser] Failed to send moderation result:', error);
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [moderationBridge, executeScript]);

  // Search handler
  const handleSearch = useCallback(async (query: string) => {
    console.log('[Browser] Starting search:', query);
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
      console.error('[Browser] Search exception:', error);
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
    
    const normalizedUrl = normalizeUrl(urlToNavigate);
    const domain = extractDomain(urlToNavigate);
    setUrlInput(normalizedUrl);

    // Check blocklist
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

    // Handle PDFs
    if (isPdfUrl(normalizedUrl)) {
      setFallbackUrl(normalizedUrl);
      navigate('fallback', '', normalizedUrl);
      await logEvent('pdf_detected', domain, 'pdf');
      setIsLoading(false);
      return;
    }

    // Open in native WebView (for all sites including social platforms)
    if (isNative) {
      const success = await openWebView(normalizedUrl, true);
      if (success) {
        navigate('browse', normalizedUrl, normalizedUrl);
        await logEvent('allowed', domain, 'native-webview');
      } else {
        // WebView failed, offer fallback modes
        setFallbackUrl(normalizedUrl);
        navigate('fallback', '', normalizedUrl);
        await logEvent('fallback', domain, 'webview-failed');
      }
    } else {
      // On web, use fallback modes for all navigation
      setFallbackUrl(normalizedUrl);
      navigate('fallback', '', normalizedUrl);
      await logEvent('fallback', domain, 'web-platform');
    }
    
    setIsLoading(false);
  }, [urlInput, settings, checkBlockedSite, deviceId, isNative, openWebView, handleSearch, navigate, logEvent]);

  // Reader Mode handler
  const handleReaderMode = useCallback(async () => {
    if (!fallbackUrl) {
      console.error('[Browser] No fallback URL');
      return;
    }

    console.log('[Browser] Opening Reader Mode for:', fallbackUrl);
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

      // Handle social platform metadata
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
      console.error('[Browser] Reader mode exception:', error);
      setFailureError(errorMsg);
      navigate('failure', '', fallbackUrl);
      await logEvent('reader_mode_error', extractDomain(fallbackUrl), 'failed');
    } finally {
      setIsLoadingReader(false);
    }
  }, [fallbackUrl, navigate, logEvent]);

  // Navigation handlers
  const handleGoBack = useCallback(async () => {
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

    if (currentView === 'browse' && isNative && webViewState.isOpen) {
      const success = await webViewGoBack();
      if (!success) {
        await closeWebView();
        goHome();
      }
      return;
    }
    
    if (!navGoBack()) {
      goHome();
    }
  }, [currentView, fallbackUrl, isNative, webViewState.isOpen, navigate, navGoBack, goHome, webViewGoBack, closeWebView]);

  const handleGoForward = useCallback(async () => {
    if (currentView === 'browse' && isNative && webViewState.isOpen) {
      await webViewGoForward();
      return;
    }
    navGoForward();
  }, [currentView, isNative, webViewState.isOpen, navGoForward, webViewGoForward]);

  const handleRefresh = useCallback(async () => {
    if (readerContent) {
      handleReaderMode();
      return;
    }
    if (currentView === 'search' && searchQuery) {
      handleSearch(searchQuery);
      return;
    }
    if (currentView === 'browse' && isNative && webViewState.isOpen) {
      await webViewReload();
      // Reset injection flag to re-inject moderation script
      injectionDoneRef.current = false;
      return;
    }
  }, [readerContent, currentView, searchQuery, isNative, webViewState.isOpen, handleReaderMode, handleSearch, webViewReload]);

  const handleHome = useCallback(async () => {
    if (isNative && webViewState.isOpen) {
      await closeWebView();
    }
    moderationBridge.clearCache();
    injectionDoneRef.current = false;
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
  }, [isNative, webViewState.isOpen, closeWebView, goHome, moderationBridge]);

  // Manual scan trigger for current page
  const handleScanPage = useCallback(async () => {
    if (!isNative || !isModerationEnabled()) {
      setIsScanning(true);
      setTimeout(() => setIsScanning(false), 500);
      return;
    }
    
    setIsScanning(true);
    
    // Inject a script to re-scan all images
    const rescanScript = `
      if (window.__GC_MODERATION__) {
        window.__GC_MODERATION__.scanAll();
        'Scan triggered';
      } else {
        'Moderation not active';
      }
    `;
    
    try {
      await executeScript(rescanScript);
      console.log('[Browser] Manual scan triggered');
    } catch (error) {
      console.error('[Browser] Manual scan failed:', error);
    }
    
    setTimeout(() => setIsScanning(false), 1500);
  }, [isNative, isModerationEnabled, executeScript]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleNavigate(urlInput);
  };

  const handleOpenExternal = useCallback((url: string, eventType: string = 'external_click') => {
    // Show warning before opening external links
    setExternalWarningUrl(url);
  }, []);

  const confirmExternalOpen = useCallback((url: string) => {
    logEvent('external_click', extractDomain(url), 'opened');
    window.open(url, '_blank', 'noopener,noreferrer');
    setExternalWarningUrl(null);
  }, [logEvent]);

  const handleOpenInWebView = useCallback(async (url: string) => {
    if (isNative) {
      await openWebView(url, true);
      navigate('browse', url, url);
      await logEvent('webview_open', extractDomain(url), 'opened');
    } else {
      // On web, open externally with warning
      setExternalWarningUrl(url);
    }
  }, [isNative, openWebView, navigate, logEvent]);

  // Render special views
  if (currentView === 'youtube' && youtubeContent) {
    return (
      <>
        <YouTubePreviewView
          videoId={youtubeContent.videoId}
          title={youtubeContent.title}
          channelName={youtubeContent.channelName}
          description={youtubeContent.description}
          thumbnailUrl={youtubeContent.thumbnailUrl}
          sourceUrl={youtubeContent.sourceUrl}
          onBack={handleGoBack}
          onOpenExternal={() => isNative 
            ? handleOpenInWebView(youtubeContent.sourceUrl)
            : handleOpenExternal(youtubeContent.sourceUrl, 'youtube_external_click')
          }
        />
        <ExternalLinkWarning
          isOpen={!!externalWarningUrl}
          url={externalWarningUrl || ''}
          onConfirm={() => externalWarningUrl && confirmExternalOpen(externalWarningUrl)}
          onClose={() => setExternalWarningUrl(null)}
        />
      </>
    );
  }

  if (currentView === 'social' && socialContent) {
    return (
      <>
        <SocialPreviewView
          platform={socialContent.platform}
          title={socialContent.title}
          author={socialContent.author}
          description={socialContent.description}
          thumbnailUrl={socialContent.thumbnailUrl}
          sourceUrl={socialContent.sourceUrl}
          contentId={socialContent.contentId}
          onBack={handleGoBack}
          onOpenExternal={() => isNative
            ? handleOpenInWebView(socialContent.sourceUrl)
            : handleOpenExternal(socialContent.sourceUrl, `${socialContent.platform}_external_click`)
          }
        />
        <ExternalLinkWarning
          isOpen={!!externalWarningUrl}
          url={externalWarningUrl || ''}
          onConfirm={() => externalWarningUrl && confirmExternalOpen(externalWarningUrl)}
          onClose={() => setExternalWarningUrl(null)}
        />
      </>
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
          canGoForward={navCanGoForward}
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
        onScan={currentView === 'browse' ? handleScanPage : undefined}
        canGoBack={navCanGoBack || currentView !== 'home'}
        canGoForward={navCanGoForward}
        isLoading={isLoading || isChecking || webViewState.isLoading}
        isScanning={isScanning}
        isProtected={settings.shield_active}
        modeLabel={getModeLabel()}
        modeColor={getModeColor()}
      />
      
      {/* AI Moderation Status Bar - shown during browse mode */}
      {currentView === 'browse' && isModerationEnabled() && (
        <AIStatusBar
          modelState={moderationBridge.modelState}
          isScanning={moderationBridge.isScanning || isScanning}
          scannedCount={moderationBridge.scannedCount}
          totalCount={moderationBridge.scannedCount + moderationBridge.pendingCount}
          blurredCount={moderationBridge.blurredCount}
          safeCount={moderationBridge.scannedCount - moderationBridge.blurredCount}
          onScan={handleScanPage}
          compact
        />
      )}

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
                This site has been blocked by GoodCreation protection.
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
          />
        ) : currentView === 'browse' ? (
          // Native WebView is handled externally - show placeholder when WebView is open
          isNative && webViewState.isOpen ? (
            <div className="absolute inset-0 flex items-center justify-center bg-background">
              <div className="text-center">
                <Loader2 className="w-8 h-8 mx-auto mb-3 text-aqua animate-spin" />
                <p className="text-sm text-muted-foreground font-display tracking-wider">
                  BROWSING IN WEBVIEW
                </p>
                <p className="text-xs text-silver mt-2 max-w-xs mx-auto truncate px-4">
                  {webViewState.currentUrl}
                </p>
              </div>
            </div>
          ) : (
            // Web fallback message
            <div className="absolute inset-0 flex items-center justify-center p-6 bg-background">
              <div className="text-center max-w-md">
                <Globe className="w-16 h-16 mx-auto mb-4 text-aqua" />
                <h2 className="font-display text-xl tracking-wider mb-3">
                  NATIVE WEBVIEW REQUIRED
                </h2>
                <p className="text-sm text-muted-foreground mb-6">
                  Full browser functionality requires the native mobile app. 
                  Use Reader Mode to view content on web.
                </p>
                <button
                  onClick={() => {
                    setFallbackUrl(currentUrl);
                    navigate('fallback', '', currentUrl);
                  }}
                  className="px-6 py-3 bg-aqua text-accent-foreground font-display text-sm tracking-wider hover:bg-aqua/90 transition-colors"
                >
                  USE READER MODE
                </button>
              </div>
            </div>
          )
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

      {/* External link warning modal */}
      <ExternalLinkWarning
        isOpen={!!externalWarningUrl}
        url={externalWarningUrl || ''}
        onConfirm={() => externalWarningUrl && confirmExternalOpen(externalWarningUrl)}
        onClose={() => setExternalWarningUrl(null)}
      />
    </div>
  );
};
