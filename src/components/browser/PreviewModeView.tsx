import { useState, useCallback, useMemo, useEffect } from "react";
import { ArrowLeft, AlertTriangle, Eye, EyeOff, Shield, ExternalLink, Copy, Check, Loader2, RefreshCw } from "lucide-react";
import { useOnDeviceModeration, ModerationResult } from "@/hooks/useOnDeviceModeration";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface PreviewModeViewProps {
  previewHtml: string;
  images: string[];
  title: string;
  description?: string;
  sourceUrl: string;
  onBack: () => void;
  onOpenExternal: () => void;
}

export const PreviewModeView = ({
  previewHtml,
  images,
  title,
  description,
  sourceUrl,
  onBack,
  onOpenExternal,
}: PreviewModeViewProps) => {
  const [imageResults, setImageResults] = useState<Map<string, ModerationResult>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [revealedImages, setRevealedImages] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const { isReady: aiReady, classifyImage, modelState } = useOnDeviceModeration();
  const { settings, getAIThresholds, getBlurAmount } = useLocalSettings();

  const blurAmount = getBlurAmount();
  const thresholds = getAIThresholds();
  const uniqueImages = useMemo(() => [...new Set(images)], [images]);

  // Scan images
  const scanImages = useCallback(async () => {
    if (!aiReady || uniqueImages.length === 0) return;

    setIsScanning(true);
    setScannedCount(0);

    const results = new Map<string, ModerationResult>();

    for (let i = 0; i < uniqueImages.length; i++) {
      try {
        const result = await classifyImage(uniqueImages[i], thresholds);
        if (result) {
          results.set(uniqueImages[i], result);
        }
        setScannedCount(i + 1);
      } catch (error) {
        console.error('[PreviewMode] Error scanning image:', error);
      }
    }

    setImageResults(results);
    setIsScanning(false);

    const blurredCount = [...results.values()].filter(r => r.shouldBlur).length;
    if (settings.show_scan_notifications && blurredCount > 0) {
      toast.warning(`${blurredCount} image(s) blurred for your protection`);
    }
  }, [aiReady, uniqueImages, classifyImage, thresholds, settings.show_scan_notifications]);

  // Auto-scan when ready
  useEffect(() => {
    if (aiReady && settings.auto_scan_images && uniqueImages.length > 0 && imageResults.size === 0) {
      scanImages();
    }
  }, [aiReady, settings.auto_scan_images, uniqueImages.length, imageResults.size, scanImages]);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(sourceUrl);
      setCopied(true);
      toast.success("URL copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      toast.error("Failed to copy URL");
    }
  };

  const toggleImageReveal = useCallback((src: string) => {
    setRevealedImages(prev => {
      const next = new Set(prev);
      if (next.has(src)) {
        next.delete(src);
      } else {
        next.add(src);
      }
      return next;
    });
  }, []);

  const shouldBlurImage = useCallback((src: string): boolean => {
    if (blurAmount === 0) return false;
    const result = imageResults.get(src);
    return result?.shouldBlur === true && !revealedImages.has(src);
  }, [imageResults, revealedImages, blurAmount]);

  // Process HTML to add blur to flagged images
  const processedHtml = useMemo(() => {
    let html = previewHtml;
    
    // Add blur styles to flagged images
    html = html.replace(
      /<img([^>]*)src\s*=\s*["']([^"']+)["']([^>]*)>/gi,
      (match, before, src, after) => {
        const isBlurred = shouldBlurImage(src);
        const blurStyle = isBlurred ? `filter: blur(${blurAmount}px);` : '';
        return `<img${before}src="${src}"${after} style="${blurStyle} max-width: 100%; height: auto; border-radius: 8px;" loading="lazy" onerror="this.style.display='none'">`;
      }
    );
    
    return html;
  }, [previewHtml, shouldBlurImage, blurAmount]);

  const stats = useMemo(() => {
    const total = uniqueImages.length;
    const scanned = imageResults.size;
    const blurred = [...imageResults.values()].filter(r => r.shouldBlur).length;
    return { total, scanned, blurred };
  }, [uniqueImages.length, imageResults]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 border-b border-border bg-card sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors border border-border rounded"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span className="text-xs font-display text-amber-500 tracking-wider">PREVIEW MODE</span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{sourceUrl}</p>
          </div>
        </div>
      </header>

      {/* Warning Banner */}
      <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-amber-600 font-medium">Static Preview Mode</p>
            <p className="text-xs text-amber-600/80 mt-1">
              This is a static preview. Interactivity is disabled. Forms, buttons, and dynamic content will not function.
            </p>
          </div>
        </div>
      </div>

      {/* AI Status Bar */}
      <div className="px-4 py-2 bg-muted/30 border-b border-border">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            {modelState === 'ready' && (
              <span className="flex items-center gap-1 text-green-600">
                <Shield className="w-3 h-3" />
                AI Ready
              </span>
            )}
            {modelState === 'loading' && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading AI...
              </span>
            )}
            {modelState === 'error' && (
              <span className="flex items-center gap-1 text-amber-500">
                <AlertTriangle className="w-3 h-3" />
                AI unavailable
              </span>
            )}
          </div>

          {stats.total > 0 && (
            <div className="flex items-center gap-3">
              {isScanning ? (
                <span className="flex items-center gap-1 text-aqua">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Scanning {scannedCount}/{stats.total}
                </span>
              ) : (
                <>
                  <span className="text-muted-foreground">{stats.scanned}/{stats.total} scanned</span>
                  {stats.blurred > 0 && <span className="text-amber-600">{stats.blurred} blurred</span>}
                  {stats.scanned < stats.total && aiReady && (
                    <button onClick={scanImages} className="flex items-center gap-1 text-aqua hover:underline">
                      <RefreshCw className="w-3 h-3" />
                      Scan
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-auto pb-20">
        <article className="max-w-3xl mx-auto px-4 py-6">
          {/* Title */}
          {title && (
            <h1 className="text-2xl font-display font-bold mb-2 text-foreground">
              {title}
            </h1>
          )}
          
          {/* Description */}
          {description && (
            <p className="text-sm text-muted-foreground mb-4 italic">
              {description}
            </p>
          )}

          {/* Source Link */}
          <div className="text-xs text-muted-foreground mb-6 flex items-center gap-2">
            <ExternalLink className="w-3 h-3 flex-shrink-0" />
            <a 
              href={sourceUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="hover:text-aqua transition-colors truncate"
            >
              {sourceUrl}
            </a>
          </div>

          {/* Image Gallery */}
          {uniqueImages.length > 0 && (
            <div className="mb-6 p-4 bg-card border border-border rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-display font-medium">
                  Images ({uniqueImages.length})
                </span>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {uniqueImages.slice(0, 9).map((src, idx) => {
                  const result = imageResults.get(src);
                  const isBlurred = shouldBlurImage(src);
                  const isRevealed = revealedImages.has(src);
                  
                  return (
                    <div 
                      key={`${src}-${idx}`} 
                      className="relative aspect-video bg-muted rounded-lg overflow-hidden border border-border"
                    >
                      <img
                        src={src}
                        alt={`Image ${idx + 1}`}
                        className="w-full h-full object-cover"
                        style={isBlurred ? { filter: `blur(${blurAmount}px)` } : {}}
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      
                      {isBlurred && !isRevealed && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                          <button
                            onClick={() => toggleImageReveal(src)}
                            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 bg-muted rounded"
                          >
                            <Eye className="w-3 h-3" />
                            Reveal
                          </button>
                        </div>
                      )}
                      
                      {result?.shouldBlur && isRevealed && (
                        <button
                          onClick={() => toggleImageReveal(src)}
                          className="absolute top-2 right-2 p-1.5 bg-background/80 rounded-full"
                        >
                          <EyeOff className="w-3 h-3" />
                        </button>
                      )}
                      
                      {result && !result.shouldBlur && (
                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-green-500/90 rounded text-[10px] text-white font-display">
                          SAFE
                        </div>
                      )}
                      
                      {!result && !isScanning && (
                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-muted/90 rounded text-[10px] text-muted-foreground font-display">
                          NOT SCANNED
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preview HTML Content */}
          {processedHtml ? (
            <div 
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: processedHtml }}
            />
          ) : (
            <div className="text-center py-12">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No preview content available.</p>
            </div>
          )}
        </article>
      </main>

      {/* Action Footer */}
      <footer className="px-4 py-4 border-t border-border bg-card">
        <div className="max-w-2xl mx-auto flex flex-col gap-3">
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleCopyUrl}
            >
              {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
              Copy URL
            </Button>
            <Button
              className="flex-1 bg-aqua hover:bg-aqua/90 text-accent-foreground"
              onClick={onOpenExternal}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open External
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Preview Mode shows static content only. For full functionality, open in an external browser.
          </p>
        </div>
      </footer>
    </div>
  );
};
