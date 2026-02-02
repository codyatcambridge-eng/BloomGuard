import { AlertTriangle, BookOpen, Home, Shield, Loader2, XCircle } from "lucide-react";

interface FallbackModeUIProps {
  url: string;
  onReaderMode: () => void;
  onHome: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export const FallbackModeUI = ({ url, onReaderMode, onHome, isLoading, error }: FallbackModeUIProps) => {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6 bg-gradient-to-b from-muted/30 to-background">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center border border-border">
          {error ? (
            <XCircle className="w-10 h-10 text-destructive" />
          ) : isLoading ? (
            <Loader2 className="w-10 h-10 text-aqua animate-spin" />
          ) : (
            <Shield className="w-10 h-10 text-muted-foreground" />
          )}
        </div>
        
        <h2 className="font-display text-xl tracking-wider text-foreground mb-3">
          {error ? 'READER MODE FAILED' : isLoading ? 'LOADING READER MODE...' : 'SITE CANNOT LOAD IN BROWSER'}
        </h2>
        
        <p className="text-sm text-muted-foreground mb-4">
          {error 
            ? error 
            : isLoading 
              ? 'Fetching and cleaning page content...'
              : 'This site cannot be displayed securely inside the Safe Browser due to security restrictions.'}
        </p>
        
        <div className="px-4 py-2 bg-card border border-border rounded-sm mb-6 text-xs text-muted-foreground font-mono truncate">
          {url}
        </div>

        {/* Error state - show retry button */}
        {error && (
          <div className="flex flex-col gap-3">
            <button
              onClick={onReaderMode}
              className="w-full px-6 py-3.5 bg-aqua text-accent-foreground font-display text-sm tracking-wider hover:bg-aqua/90 transition-colors flex items-center justify-center gap-2"
            >
              <BookOpen className="w-4 h-4" />
              TRY AGAIN
            </button>
            
            <button
              onClick={onHome}
              className="w-full px-6 py-3 border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors font-display text-sm tracking-wider flex items-center justify-center gap-2"
            >
              <Home className="w-4 h-4" />
              RETURN HOME
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && !error && (
          <div className="flex flex-col gap-3">
            <div className="w-full px-6 py-3.5 bg-muted text-muted-foreground font-display text-sm tracking-wider flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              LOADING CONTENT...
            </div>
            
            <button
              onClick={onHome}
              className="w-full px-6 py-3 border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors font-display text-sm tracking-wider flex items-center justify-center gap-2"
            >
              <Home className="w-4 h-4" />
              CANCEL
            </button>
          </div>
        )}

        {/* Normal state - show reader mode button */}
        {!error && !isLoading && (
          <div className="flex flex-col gap-3">
            <button
              onClick={onReaderMode}
              className="w-full px-6 py-3.5 bg-aqua text-accent-foreground font-display text-sm tracking-wider hover:bg-aqua/90 transition-colors flex items-center justify-center gap-2"
            >
              <BookOpen className="w-4 h-4" />
              OPEN IN PROTECTED READER MODE
            </button>
            
            <button
              onClick={onHome}
              className="w-full px-6 py-3 border border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground transition-colors font-display text-sm tracking-wider flex items-center justify-center gap-2"
            >
              <Home className="w-4 h-4" />
              RETURN HOME
            </button>
          </div>
        )}

        {/* Info box - only show when not in error state */}
        {!error && (
          <div className="mt-6 p-4 bg-muted/30 border border-border rounded-sm">
            <div className="flex items-start gap-2 text-left">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground mb-1">What is Protected Reader Mode?</p>
                <p>
                  Reader Mode fetches the page content through a secure proxy, strips away scripts 
                  and trackers, and scans all images with on-device AI before displaying them. 
                  This lets you safely view content even from sites that block normal embedding.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
