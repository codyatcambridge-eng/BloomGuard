import { AlertTriangle, BookOpen, Home, Shield, Loader2, XCircle, Eye, Copy, Check, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface FallbackModeUIProps {
  url: string;
  onReaderMode: () => void;
  onHome: () => void;
  isLoading?: boolean;
  error?: string | null;
  isSocialPlatform?: boolean;
  platformName?: string;
}

export const FallbackModeUI = ({ 
  url, 
  onReaderMode, 
  onHome, 
  isLoading, 
  error,
  isSocialPlatform = false,
  platformName,
}: FallbackModeUIProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy URL");
    }
  };

  const handleOpenExternal = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Error state
  if (error) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6 bg-gradient-to-b from-destructive/5 to-background">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-destructive/10 flex items-center justify-center border border-destructive/20">
            <XCircle className="w-10 h-10 text-destructive" />
          </div>
          
          <h2 className="font-display text-xl tracking-wider text-foreground mb-3">
            READER MODE FAILED
          </h2>
          
          <p className="text-sm text-muted-foreground mb-4">
            {error}
          </p>
          
          <div className="px-4 py-2 bg-card border border-border rounded-sm mb-6 text-xs text-muted-foreground font-mono truncate">
            {url}
          </div>

          <div className="flex flex-col gap-3">
            <Button
              onClick={onReaderMode}
              className="w-full bg-aqua hover:bg-aqua/90 text-accent-foreground font-display text-sm tracking-wider"
            >
              <BookOpen className="w-4 h-4 mr-2" />
              TRY AGAIN
            </Button>
            
            <Button
              variant="outline"
              onClick={handleCopyUrl}
              className="w-full"
            >
              {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              Copy URL
            </Button>
            
            <Button
              variant="outline"
              onClick={onHome}
              className="w-full"
            >
              <Home className="w-4 h-4 mr-2" />
              RETURN HOME
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6 bg-gradient-to-b from-aqua/5 to-background">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-aqua/10 flex items-center justify-center border border-aqua/20">
            <Loader2 className="w-10 h-10 text-aqua animate-spin" />
          </div>
          
          <h2 className="font-display text-xl tracking-wider text-foreground mb-3">
            LOADING READER MODE...
          </h2>
          
          <p className="text-sm text-muted-foreground mb-4">
            Fetching and cleaning page content...
          </p>
          
          <div className="px-4 py-2 bg-card border border-border rounded-sm mb-6 text-xs text-muted-foreground font-mono truncate">
            {url}
          </div>

          <Button
            variant="outline"
            onClick={onHome}
            className="w-full"
          >
            <Home className="w-4 h-4 mr-2" />
            CANCEL
          </Button>
        </div>
      </div>
    );
  }

  // Normal fallback state - site can't load in iframe
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6 bg-gradient-to-b from-muted/30 to-background">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center border border-border">
          <Shield className="w-10 h-10 text-muted-foreground" />
        </div>
        
        <h2 className="font-display text-xl tracking-wider text-foreground mb-3">
          {isSocialPlatform 
            ? `${platformName || 'SOCIAL'} PREVIEW AVAILABLE`
            : 'SITE CANNOT LOAD IN BROWSER'}
        </h2>
        
        <p className="text-sm text-muted-foreground mb-4">
          {isSocialPlatform
            ? `${platformName || 'This platform'} cannot be embedded. View a safe preview with image moderation.`
            : 'This site cannot be displayed securely inside the Focus Browser due to security restrictions.'}
        </p>
        
        <div className="px-4 py-2 bg-card border border-border rounded-sm mb-6 text-xs text-muted-foreground font-mono truncate">
          {url}
        </div>

        <div className="flex flex-col gap-3">
          <Button
            onClick={onReaderMode}
            className="w-full bg-aqua hover:bg-aqua/90 text-accent-foreground font-display text-sm tracking-wider"
          >
            {isSocialPlatform ? (
              <>
                <Eye className="w-4 h-4 mr-2" />
                VIEW SAFE PREVIEW
              </>
            ) : (
              <>
                <BookOpen className="w-4 h-4 mr-2" />
                OPEN IN PROTECTED READER MODE
              </>
            )}
          </Button>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleCopyUrl}
              className="flex-1"
            >
              {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              Copy
            </Button>
            <Button
              variant="outline"
              onClick={handleOpenExternal}
              className="flex-1"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              External
            </Button>
          </div>
          
          <Button
            variant="ghost"
            onClick={onHome}
            className="w-full text-muted-foreground hover:text-foreground"
          >
            <Home className="w-4 h-4 mr-2" />
            RETURN HOME
          </Button>
        </div>

        {/* Info box */}
        <div className="mt-6 p-4 bg-muted/30 border border-border rounded-sm">
          <div className="flex items-start gap-2 text-left">
            <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">
                {isSocialPlatform ? 'What is Safe Preview?' : 'What is Protected Reader Mode?'}
              </p>
              <p>
                {isSocialPlatform
                  ? 'Safe Preview shows static metadata (title, description, thumbnail) without allowing interactive content. All images are scanned with on-device AI.'
                  : 'Reader Mode fetches the page content through a secure proxy, strips away scripts and trackers, and scans all images with on-device AI before displaying them.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
