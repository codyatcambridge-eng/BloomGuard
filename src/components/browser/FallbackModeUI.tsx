import { AlertTriangle, BookOpen, Home, Shield } from "lucide-react";

interface FallbackModeUIProps {
  url: string;
  onReaderMode: () => void;
  onHome: () => void;
  isLoading?: boolean;
}

export const FallbackModeUI = ({ url, onReaderMode, onHome, isLoading }: FallbackModeUIProps) => {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6 bg-gradient-to-b from-muted/30 to-background">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center border border-border">
          <Shield className="w-10 h-10 text-silver" />
        </div>
        
        <h2 className="font-display text-xl tracking-wider text-foreground mb-3">
          SITE CANNOT LOAD IN BROWSER
        </h2>
        
        <p className="text-sm text-muted-foreground mb-4">
          This site cannot be displayed securely inside the Safe Browser due to security restrictions.
        </p>
        
        <div className="px-4 py-2 bg-card border border-border rounded-sm mb-6 text-xs text-muted-foreground font-mono truncate">
          {url}
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={onReaderMode}
            disabled={isLoading}
            className="w-full px-6 py-3.5 bg-aqua text-accent-foreground font-display text-sm tracking-wider hover:bg-aqua/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <BookOpen className="w-4 h-4" />
            {isLoading ? 'LOADING...' : 'OPEN IN PROTECTED READER MODE'}
          </button>
          
          <button
            onClick={onHome}
            className="w-full px-6 py-3 border border-silver/30 text-silver hover:text-foreground hover:border-silver/60 transition-colors font-display text-sm tracking-wider flex items-center justify-center gap-2"
          >
            <Home className="w-4 h-4" />
            RETURN HOME
          </button>
        </div>

        <div className="mt-6 p-4 bg-muted/30 border border-border rounded-sm">
          <div className="flex items-start gap-2 text-left">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
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
      </div>
    </div>
  );
};
