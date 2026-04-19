import { AlertTriangle, ExternalLink, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ExternalLinkWarningProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  platformName?: string;
  url?: string;
}

export const ExternalLinkWarning = ({
  isOpen,
  onClose,
  onConfirm,
  platformName = "this site",
  url,
}: ExternalLinkWarningProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full shadow-xl animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-amber-500/10 rounded-full flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="font-display font-bold text-lg">External Link Warning</h3>
          </div>
        </div>
        
        {/* Content */}
        <div className="space-y-3 mb-6">
          <p className="text-sm text-muted-foreground">
            This will open <span className="font-medium text-foreground">{platformName}</span> in an external browser.
          </p>
          
          <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
            <Shield className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-600">
              Focus Browser protections will <strong>not apply</strong> outside this app. Browse carefully.
            </p>
          </div>
          
          {url && (
            <div className="p-2 bg-muted rounded text-xs font-mono text-muted-foreground truncate">
              {url}
            </div>
          )}
        </div>
        
        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white"
            onClick={onConfirm}
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Open External
          </Button>
        </div>
      </div>
    </div>
  );
};
