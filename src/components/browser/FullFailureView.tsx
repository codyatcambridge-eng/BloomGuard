import { useState } from "react";
import { ArrowLeft, AlertTriangle, Copy, Check, ExternalLink, Shield, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface FullFailureViewProps {
  sourceUrl: string;
  error: string;
  onBack: () => void;
  onRetry: () => void;
}

export const FullFailureView = ({ sourceUrl, error, onBack, onRetry }: FullFailureViewProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(sourceUrl);
      setCopied(true);
      toast.success("URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error("Failed to copy URL");
    }
  };

  const handleOpenExternal = () => {
    window.open(sourceUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors border border-border rounded"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-aqua flex-shrink-0" />
              <span className="text-xs font-display text-aqua tracking-wider">FOCUS BROWSER</span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{sourceUrl}</p>
          </div>
        </div>
      </header>

      {/* Error Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-10 h-10 text-destructive" />
          </div>
          
          <h2 className="text-2xl font-display font-bold text-foreground mb-3">
            Cannot Render Safely
          </h2>
          
          <p className="text-muted-foreground mb-2">
            This site cannot be displayed in Protected Reader Mode.
          </p>
          
          <p className="text-sm text-muted-foreground/80 mb-8 px-4">
            {error || "The page content could not be extracted or rendered safely."}
          </p>

          {/* URL Display */}
          <div className="bg-muted/50 rounded-lg p-3 mb-6">
            <p className="text-xs text-muted-foreground mb-1">Attempted URL:</p>
            <p className="text-sm text-foreground font-mono truncate">{sourceUrl}</p>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full"
              onClick={onRetry}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Try Again
            </Button>
            
            <Button
              variant="outline"
              className="w-full"
              onClick={handleCopyUrl}
            >
              {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              Copy URL
            </Button>
            
            <Button
              className="w-full bg-aqua hover:bg-aqua/90 text-accent-foreground"
              onClick={handleOpenExternal}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open in External Browser
            </Button>
          </div>

          {/* Safety Note */}
          <div className="mt-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <p className="text-xs text-amber-600">
              <AlertTriangle className="w-3 h-3 inline mr-1" />
              Opening in an external browser will bypass Focus Browser protections.
              Browse carefully.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-4 py-3 border-t border-border bg-card">
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Shield className="w-3 h-3 text-aqua" />
          <span>Content protection could not be applied to this site</span>
        </div>
      </footer>
    </div>
  );
};
