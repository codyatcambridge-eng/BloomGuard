import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, AlertTriangle, Loader2, Eye, EyeOff, Shield, ExternalLink } from "lucide-react";
import { useOnDeviceModeration, ModerationResult } from "@/hooks/useOnDeviceModeration";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { toast } from "sonner";

interface ReaderModeViewProps {
  content: string;
  images: string[];
  title: string;
  sourceUrl: string;
  onBack: () => void;
}

export const ReaderModeView = ({ content, images, title, sourceUrl, onBack }: ReaderModeViewProps) => {
  const [imageResults, setImageResults] = useState<Map<string, ModerationResult>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [revealedImages, setRevealedImages] = useState<Set<string>>(new Set());
  
  const { isReady: aiReady, classifyImage, modelState } = useOnDeviceModeration();
  const { settings, getAIThresholds, getBlurAmount } = useLocalSettings();

  const blurAmount = getBlurAmount();
  const thresholds = getAIThresholds();

  // Scan all images with on-device AI
  const scanImages = useCallback(async () => {
    if (!aiReady || images.length === 0) return;

    setIsScanning(true);
    setScannedCount(0);

    const results = new Map<string, ModerationResult>();

    for (let i = 0; i < images.length; i++) {
      try {
        const result = await classifyImage(images[i], thresholds);
        if (result) {
          results.set(images[i], result);
        }
        setScannedCount(i + 1);
      } catch (error) {
        console.error('Error scanning image:', images[i], error);
      }
    }

    setImageResults(results);
    setIsScanning(false);

    const blurredCount = [...results.values()].filter(r => r.shouldBlur).length;
    if (blurredCount > 0) {
      toast.warning(`${blurredCount} image(s) blurred for your protection`, { duration: 3000 });
    } else if (results.size > 0) {
      toast.success(`${results.size} image(s) scanned - all safe`, { duration: 2000 });
    }
  }, [aiReady, images, classifyImage, thresholds]);

  // Auto-scan images when component mounts
  useEffect(() => {
    if (aiReady && settings.auto_scan_images && images.length > 0) {
      scanImages();
    }
  }, [aiReady, settings.auto_scan_images, images.length, scanImages]);

  const toggleImageReveal = (src: string) => {
    setRevealedImages(prev => {
      const next = new Set(prev);
      if (next.has(src)) {
        next.delete(src);
      } else {
        next.add(src);
      }
      return next;
    });
  };

  const getImageBlurStyle = (src: string): React.CSSProperties => {
    const result = imageResults.get(src);
    if (!result) return {};
    
    if (result.shouldBlur && !revealedImages.has(src) && blurAmount > 0) {
      return { filter: `blur(${blurAmount}px)` };
    }
    return {};
  };

  const shouldShowWarning = (src: string): boolean => {
    const result = imageResults.get(src);
    return result?.shouldBlur === true && !revealedImages.has(src);
  };

  // Process content to add blur to images
  const processedContent = content.replace(
    /<img([^>]*)src\s*=\s*["']([^"']+)["']([^>]*)>/gi,
    (match, before, src, after) => {
      const result = imageResults.get(src);
      const isBlurred = result?.shouldBlur && !revealedImages.has(src) && blurAmount > 0;
      const blurStyle = isBlurred ? `filter: blur(${blurAmount}px);` : '';
      return `<img${before}src="${src}"${after} style="max-width: 100%; height: auto; ${blurStyle}" data-moderated="true">`;
    }
  );

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 border-b border-border bg-card sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 text-silver hover:text-foreground transition-colors border border-silver/20"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-aqua flex-shrink-0" />
              <span className="text-xs font-display text-aqua tracking-wider">PROTECTED READER MODE</span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{sourceUrl}</p>
          </div>
          {images.length > 0 && (
            <div className="text-right text-xs">
              {isScanning ? (
                <div className="flex items-center gap-1 text-aqua">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{scannedCount}/{images.length}</span>
                </div>
              ) : (
                <span className="text-muted-foreground">
                  {imageResults.size} images scanned
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* AI Status Bar */}
      {modelState !== 'ready' && (
        <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center gap-2">
          {modelState === 'loading' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-aqua" />
              <span className="text-xs text-muted-foreground">Loading AI model...</span>
            </>
          ) : modelState === 'error' ? (
            <>
              <AlertTriangle className="w-4 h-4 text-destructive" />
              <span className="text-xs text-destructive">AI model failed to load</span>
            </>
          ) : null}
        </div>
      )}

      {/* Content */}
      <main className="flex-1 px-4 py-6 pb-20 overflow-auto">
        <article className="max-w-2xl mx-auto">
          {title && (
            <h1 className="text-2xl font-display font-bold mb-4 tracking-tight">{title}</h1>
          )}
          
          <div className="text-xs text-muted-foreground mb-6 flex items-center gap-2">
            <ExternalLink className="w-3 h-3" />
            <a 
              href={sourceUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="hover:text-aqua transition-colors truncate"
            >
              {sourceUrl}
            </a>
          </div>

          {/* Image Gallery with Moderation */}
          {images.length > 0 && (
            <div className="mb-6 p-4 bg-card border border-border rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-display">Images ({images.length})</span>
                {!isScanning && imageResults.size < images.length && aiReady && (
                  <button
                    onClick={scanImages}
                    className="text-xs text-aqua hover:underline"
                  >
                    Scan images
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {images.slice(0, 12).map((src, idx) => {
                  const result = imageResults.get(src);
                  const isBlurred = result?.shouldBlur && !revealedImages.has(src) && blurAmount > 0;
                  
                  return (
                    <div key={idx} className="relative aspect-video bg-muted rounded overflow-hidden group">
                      <img
                        src={src}
                        alt={`Image ${idx + 1}`}
                        className="w-full h-full object-cover transition-all duration-300"
                        style={getImageBlurStyle(src)}
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                      {shouldShowWarning(src) && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <div className="text-center p-2">
                            <AlertTriangle className="w-6 h-6 text-destructive mx-auto mb-1" />
                            <p className="text-xs text-white font-display">BLURRED</p>
                            <button
                              onClick={() => toggleImageReveal(src)}
                              className="mt-1 text-xs text-white/70 hover:text-white flex items-center gap-1 mx-auto"
                            >
                              <Eye className="w-3 h-3" />
                              Reveal
                            </button>
                          </div>
                        </div>
                      )}
                      {isBlurred && revealedImages.has(src) && (
                        <button
                          onClick={() => toggleImageReveal(src)}
                          className="absolute top-1 right-1 p-1 bg-black/50 rounded text-white/70 hover:text-white"
                        >
                          <EyeOff className="w-3 h-3" />
                        </button>
                      )}
                      {result && !result.shouldBlur && (
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-green-500/80 rounded text-[10px] text-white font-display">
                          SAFE
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {images.length > 12 && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  +{images.length - 12} more images
                </p>
              )}
            </div>
          )}

          {/* Rendered Content */}
          <div 
            className="prose prose-sm dark:prose-invert max-w-none
              prose-headings:font-display prose-headings:tracking-tight
              prose-a:text-aqua prose-a:no-underline hover:prose-a:underline
              prose-img:rounded-lg prose-img:mx-auto"
            dangerouslySetInnerHTML={{ __html: processedContent }}
          />

          {!content && (
            <div className="text-center py-12 text-muted-foreground">
              <p>No readable content could be extracted from this page.</p>
            </div>
          )}
        </article>
      </main>
    </div>
  );
};
