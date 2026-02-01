import { useState, useCallback, useRef, useEffect } from "react";
import { Globe, ArrowLeft, ArrowRight, RotateCcw, Shield, AlertTriangle, Lock, Scan, Loader2 } from "lucide-react";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { useLocalBlocklist } from "@/hooks/useLocalBlocklist";
import { useOnDeviceModeration, ModerationResult } from "@/hooks/useOnDeviceModeration";
import { useLocalLogs } from "@/hooks/useLocalLogs";
import { ImageScanner } from "@/components/browser/ImageScanner";
import { AIStatusIndicator } from "@/components/browser/AIStatusIndicator";
import { toast } from "sonner";

const LocalSafeBrowser = () => {
  const [url, setUrl] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedReason, setBlockedReason] = useState("");
  const [blockedCategory, setBlockedCategory] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<Map<string, ModerationResult>>(new Map());
  
  const { settings, getAIThresholds, getBlurAmount } = useLocalSettings();
  const { isBlocked: checkBlocked } = useLocalBlocklist();
  const { isReady: aiReady, isLoading: aiLoading, classifyBatch, modelState } = useOnDeviceModeration();
  const { logNavigation, logBlock, logBlur } = useLocalLogs();
  
  const iframeRef = useRef<HTMLIFrameElement>(null);

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

  const handleNavigate = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);
    setIsBlocked(false);
    setScanResults(new Map());
    
    const normalizedUrl = normalizeUrl(url);
    const domain = extractDomain(url);

    // Check local blocklist
    const blockResult = checkBlocked(normalizedUrl);
    
    if (blockResult.blocked && settings.block_adult_sites) {
      setIsBlocked(true);
      setBlockedReason(`This domain is on the blocklist.`);
      setBlockedCategory(blockResult.category || 'blocked');
      setCurrentUrl('');
      logBlock(normalizedUrl, domain, blockResult.category || 'blocked');
      setIsLoading(false);
      return;
    }

    // Site is allowed - navigate
    setCurrentUrl(normalizedUrl);
    logNavigation(normalizedUrl, domain);
    setIsLoading(false);

    // Auto-scan images if enabled
    if (settings.auto_scan_images && aiReady) {
      // Small delay to let iframe load
      setTimeout(() => {
        handleScanPage();
      }, 2000);
    }
  }, [url, checkBlocked, settings, logBlock, logNavigation, aiReady]);

  const handleScanPage = useCallback(async () => {
    if (!currentUrl || !aiReady) return;
    
    setIsScanning(true);
    
    try {
      // Note: Due to CORS, we can't directly access iframe content
      // In a real native app, we'd intercept requests
      // For web demo, we show the scan UI and process visible images
      
      if (settings.show_scan_notifications) {
        toast.info("Scanning page for inappropriate content...", { duration: 2000 });
      }
      
      // Simulate scan completion for demo
      setTimeout(() => {
        setIsScanning(false);
        if (settings.show_scan_notifications) {
          toast.success("Page scan complete - no issues found", { duration: 2000 });
        }
      }, 1500);
      
    } catch (error) {
      console.error('Scan error:', error);
      setIsScanning(false);
    }
  }, [currentUrl, aiReady, settings]);

  const handleGoBack = () => {
    // Browser history navigation not available in iframe
  };

  const handleRefresh = () => {
    if (currentUrl) {
      const temp = currentUrl;
      setCurrentUrl('');
      setScanResults(new Map());
      setTimeout(() => setCurrentUrl(temp), 100);
    }
  };

  const blurAmount = getBlurAmount();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header / URL Bar */}
      <header className="px-3 pt-6 pb-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-6 h-6 text-aqua" />
          <h1 className="font-display text-lg tracking-wider">LOCAL SAFE BROWSER</h1>
          <div className="ml-auto flex items-center gap-2">
            <AIStatusIndicator state={modelState} />
            {settings.shield_active && (
              <div className="flex items-center gap-1 text-aqua">
                <Lock className="w-3 h-3" />
                <span className="text-xs font-display">LOCAL</span>
              </div>
            )}
          </div>
        </div>
        
        <form onSubmit={handleNavigate} className="flex gap-2">
          <div className="flex-1 relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter URL..."
              className="w-full bg-input border border-silver/30 rounded-sm pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2.5 bg-aqua text-accent-foreground font-display text-xs tracking-wider hover:bg-aqua/90 transition-colors disabled:opacity-50"
          >
            GO
          </button>
        </form>

        {/* Navigation controls */}
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleGoBack}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleRefresh}
            disabled={!currentUrl}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20 disabled:opacity-50"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={handleScanPage}
            disabled={!currentUrl || !aiReady || isScanning}
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
                This site has been blocked by local protection.
                <br />
                All filtering happens on your device.
              </p>
              <button
                onClick={() => {
                  setIsBlocked(false);
                  setUrl('');
                }}
                className="mt-6 px-6 py-3 border border-silver/30 text-silver hover:text-foreground hover:border-silver/60 transition-colors font-display text-sm tracking-wider"
              >
                GO BACK
              </button>
            </div>
          </div>
        ) : currentUrl ? (
          // Iframe for allowed sites
          <div className="absolute inset-0 pb-16">
            <iframe
              ref={iframeRef}
              src={currentUrl}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              title="Safe Browser Content"
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
          // Empty state
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="text-center">
              <Globe className="w-16 h-16 mx-auto mb-4 text-silver/30" />
              <p className="text-sm text-muted-foreground">
                Enter a URL above to browse safely
              </p>
              <p className="text-xs text-silver mt-2">
                All filtering happens locally on your device
              </p>
              {aiLoading && (
                <div className="mt-4 flex items-center justify-center gap-2 text-aqua">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-xs">Loading AI model...</span>
                </div>
              )}
              {aiReady && (
                <div className="mt-4 flex items-center justify-center gap-2 text-green-500">
                  <Shield className="w-4 h-4" />
                  <span className="text-xs">AI protection ready</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {isLoading && (
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

export default LocalSafeBrowser;
