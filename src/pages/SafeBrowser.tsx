import { useState, useRef, useEffect } from "react";
import { Globe, ArrowLeft, ArrowRight, RotateCcw, Shield, X, AlertTriangle, Lock } from "lucide-react";
import { useContentProtection } from "@/hooks/useContentProtection";
import { useSettings } from "@/hooks/useSettings";
import { useDeviceId } from "@/hooks/useDeviceId";
import { supabase } from "@/integrations/supabase/client";

const SafeBrowser = () => {
  const [url, setUrl] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockedReason, setBlockedReason] = useState("");
  const [blockedCategory, setBlockedCategory] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { checkBlockedSite, isChecking } = useContentProtection();
  const { settings } = useSettings();
  const deviceId = useDeviceId();
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

  const handleNavigate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!url.trim()) return;

    setIsLoading(true);
    setIsBlocked(false);
    
    const normalizedUrl = normalizeUrl(url);
    const domain = extractDomain(url);

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

    // Site is allowed - navigate
    setCurrentUrl(normalizedUrl);
    await logEvent('allowed', domain, 'allowed');
    setIsLoading(false);
  };

  const handleGoBack = () => {
    // In a real app with history management
  };

  const handleRefresh = () => {
    if (currentUrl) {
      const temp = currentUrl;
      setCurrentUrl('');
      setTimeout(() => setCurrentUrl(temp), 100);
    }
  };

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
                This site has been blocked by Iron Watch protection.
                <br />
                Your accountability partner has been notified.
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
            {/* Blur overlay based on settings */}
            {settings.blur_sensitivity !== 'OFF' && (
              <div 
                className="absolute inset-0 pointer-events-none"
                style={{
                  backdropFilter: settings.blur_sensitivity === 'HIGH' ? 'blur(8px)' : 'blur(3px)',
                  opacity: 0, // Blur is applied by AI image moderation, not blanket
                }}
              />
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
