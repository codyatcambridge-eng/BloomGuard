import { useState } from "react";
import { FileText, ExternalLink, Download, AlertTriangle, RefreshCw, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface PDFViewerProps {
  pdfUrl: string;
  title: string;
  onOpenExternal?: () => void;
}

export const PDFViewer = ({ pdfUrl, title, onOpenExternal }: PDFViewerProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  const handleRetry = () => {
    setIsLoading(true);
    setHasError(false);
    // Force iframe reload by changing key
    const iframe = document.querySelector('iframe[data-pdf-viewer]') as HTMLIFrameElement;
    if (iframe) {
      iframe.src = iframe.src;
    }
  };

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(pdfUrl);
      setCopied(true);
      toast.success("URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy URL");
    }
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = title || 'document.pdf';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenExternal = () => {
    if (onOpenExternal) {
      onOpenExternal();
    } else {
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    }
  };

  // Use Google Docs viewer as a fallback for better PDF rendering
  const googleViewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(pdfUrl)}&embedded=true`;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* PDF Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="w-5 h-5 text-aqua flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{title}</p>
            <p className="text-xs text-muted-foreground truncate">{pdfUrl}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyUrl}
            className="text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="text-muted-foreground hover:text-foreground"
          >
            <Download className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenExternal}
            className="text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* PDF Content */}
      <div className="flex-1 relative">
        {isLoading && !hasError && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-aqua mx-auto mb-4" />
              <p className="text-sm text-muted-foreground font-display">Loading PDF...</p>
            </div>
          </div>
        )}

        {hasError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background">
            <div className="text-center max-w-md px-6">
              <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
              <h3 className="text-lg font-display font-medium text-foreground mb-2">
                PDF Could Not Be Loaded
              </h3>
              <p className="text-sm text-muted-foreground mb-6">
                This PDF cannot be displayed inline. You can download it or open it in a new browser tab.
              </p>
              
              <div className="flex flex-col gap-3">
                <Button
                  onClick={handleRetry}
                  variant="outline"
                  className="w-full"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
                <Button
                  onClick={handleDownload}
                  variant="outline"
                  className="w-full"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </Button>
                <Button
                  onClick={handleOpenExternal}
                  className="w-full bg-aqua hover:bg-aqua/90 text-accent-foreground"
                >
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Open in External Browser
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <iframe
            data-pdf-viewer
            src={googleViewerUrl}
            className="w-full h-full border-0"
            title={`PDF: ${title}`}
            onLoad={handleLoad}
            onError={handleError}
          />
        )}
      </div>

      {/* PDF Warning Footer */}
      <div className="px-4 py-2 bg-amber-500/10 border-t border-amber-500/20">
        <p className="text-xs text-amber-600 text-center">
          <AlertTriangle className="w-3 h-3 inline mr-1" />
          PDF documents may contain embedded content. Image moderation does not apply to PDFs.
        </p>
      </div>
    </div>
  );
};
