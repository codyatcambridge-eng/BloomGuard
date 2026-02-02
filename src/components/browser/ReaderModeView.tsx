import { useState, useEffect, useCallback, useMemo } from "react";
import { ArrowLeft, AlertTriangle, Loader2, Eye, EyeOff, Shield, ExternalLink, RefreshCw } from "lucide-react";
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

// Convert HTML to safe, readable format
const sanitizeAndParseContent = (html: string): string => {
  // Remove any remaining dangerous content
  let cleaned = html
    // Remove inline scripts
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove inline styles with expressions
    .replace(/style\s*=\s*["'][^"']*expression[^"']*["']/gi, '')
    // Remove javascript: URLs
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
    // Remove data: URLs in iframes (potential XSS)
    .replace(/<iframe[^>]*>/gi, '')
    // Remove event handlers
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');
  
  // Add target="_blank" to all links for safety
  cleaned = cleaned.replace(
    /<a\s+([^>]*)href\s*=\s*["']([^"']+)["']([^>]*)>/gi,
    '<a $1href="$2"$3 target="_blank" rel="noopener noreferrer">'
  );

  return cleaned;
};

// Extract text content for accessibility
const extractTextPreview = (html: string): string => {
  const textOnly = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return textOnly.slice(0, 500) + (textOnly.length > 500 ? '...' : '');
};

export const ReaderModeView = ({ content, images, title, sourceUrl, onBack }: ReaderModeViewProps) => {
  const [imageResults, setImageResults] = useState<Map<string, ModerationResult>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [revealedImages, setRevealedImages] = useState<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);
  
  const { isReady: aiReady, isLoading: aiLoading, classifyImage, modelState } = useOnDeviceModeration();
  const { settings, getAIThresholds, getBlurAmount } = useLocalSettings();

  const blurAmount = getBlurAmount();
  const thresholds = getAIThresholds();

  // Memoize image list to prevent re-scans
  const uniqueImages = useMemo(() => [...new Set(images)], [images]);

  // Scan all images with on-device AI
  const scanImages = useCallback(async () => {
    if (!aiReady || uniqueImages.length === 0) return;

    setIsScanning(true);
    setScannedCount(0);
    setScanError(null);

    const results = new Map<string, ModerationResult>();
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < uniqueImages.length; i++) {
      try {
        const result = await classifyImage(uniqueImages[i], thresholds);
        if (result) {
          results.set(uniqueImages[i], result);
          successCount++;
        } else {
          failCount++;
        }
        setScannedCount(i + 1);
      } catch (error) {
        console.error('[ReaderMode] Error scanning image:', uniqueImages[i], error);
        failCount++;
      }
    }

    setImageResults(results);
    setIsScanning(false);

    // Show results
    const blurredCount = [...results.values()].filter(r => r.shouldBlur).length;
    
    if (settings.show_scan_notifications) {
      if (blurredCount > 0) {
        toast.warning(`${blurredCount} image(s) blurred for your protection`, { 
          duration: 3000,
          icon: <Shield className="w-4 h-4" />
        });
      } else if (successCount > 0) {
        toast.success(`${successCount} image(s) scanned - all safe`, { duration: 2000 });
      }
      
      if (failCount > 0) {
        setScanError(`${failCount} image(s) could not be scanned`);
      }
    }
  }, [aiReady, uniqueImages, classifyImage, thresholds, settings.show_scan_notifications]);

  // Auto-scan images when AI is ready
  useEffect(() => {
    if (aiReady && settings.auto_scan_images && uniqueImages.length > 0 && imageResults.size === 0) {
      scanImages();
    }
  }, [aiReady, settings.auto_scan_images, uniqueImages.length, imageResults.size, scanImages]);

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

  const getImageStyle = useCallback((src: string): React.CSSProperties => {
    if (shouldBlurImage(src)) {
      return { filter: `blur(${blurAmount}px)`, transition: 'filter 0.3s ease' };
    }
    return { transition: 'filter 0.3s ease' };
  }, [shouldBlurImage, blurAmount]);

  const getClassification = useCallback((src: string): string => {
    const result = imageResults.get(src);
    if (!result) return 'unscanned';
    if (result.shouldBlur) return result.dominantClass;
    return 'safe';
  }, [imageResults]);

  // Process content to handle images with moderation
  const processedContent = useMemo(() => {
    let processed = sanitizeAndParseContent(content);
    
    // Add moderation attributes to images
    processed = processed.replace(
      /<img([^>]*)src\s*=\s*["']([^"']+)["']([^>]*)>/gi,
      (match, before, src, after) => {
        const classification = getClassification(src);
        const isBlurred = shouldBlurImage(src);
        const blurStyle = isBlurred ? `filter: blur(${blurAmount}px);` : '';
        
        return `<img${before}src="${src}"${after} 
          style="max-width: 100%; height: auto; border-radius: 8px; ${blurStyle}" 
          data-moderated="true" 
          data-classification="${classification}"
          loading="lazy"
          onerror="this.style.display='none'"
        >`;
      }
    );
    
    return processed;
  }, [content, getClassification, shouldBlurImage, blurAmount]);

  // Stats for display
  const stats = useMemo(() => {
    const total = uniqueImages.length;
    const scanned = imageResults.size;
    const blurred = [...imageResults.values()].filter(r => r.shouldBlur).length;
    const safe = scanned - blurred;
    return { total, scanned, blurred, safe };
  }, [uniqueImages.length, imageResults]);

  const textPreview = useMemo(() => extractTextPreview(content), [content]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-4 py-4 border-b border-border bg-card sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors border border-border rounded"
            aria-label="Go back"
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
        </div>
      </header>

      {/* AI Status & Image Stats Bar */}
      <div className="px-4 py-2 bg-muted/30 border-b border-border">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            {/* AI Status */}
            {modelState === 'loading' && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Loading AI...
              </span>
            )}
            {modelState === 'ready' && (
              <span className="flex items-center gap-1 text-green-600">
                <Shield className="w-3 h-3" />
                AI Ready
              </span>
            )}
            {modelState === 'error' && (
              <span className="flex items-center gap-1 text-destructive">
                <AlertTriangle className="w-3 h-3" />
                AI Error
              </span>
            )}
          </div>

          {/* Image Stats */}
          {stats.total > 0 && (
            <div className="flex items-center gap-3">
              {isScanning ? (
                <span className="flex items-center gap-1 text-aqua">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Scanning {scannedCount}/{stats.total}
                </span>
              ) : (
                <>
                  <span className="text-muted-foreground">
                    {stats.scanned}/{stats.total} scanned
                  </span>
                  {stats.blurred > 0 && (
                    <span className="text-amber-600">
                      {stats.blurred} blurred
                    </span>
                  )}
                  {stats.safe > 0 && (
                    <span className="text-green-600">
                      {stats.safe} safe
                    </span>
                  )}
                  {stats.scanned < stats.total && aiReady && !isScanning && (
                    <button
                      onClick={scanImages}
                      className="flex items-center gap-1 text-aqua hover:underline"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Scan
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        
        {scanError && (
          <p className="text-xs text-amber-600 mt-1">{scanError}</p>
        )}
      </div>

      {/* Content */}
      <main className="flex-1 overflow-auto pb-20">
        <article className="max-w-2xl mx-auto px-4 py-6">
          {/* Title */}
          {title && (
            <h1 className="text-2xl font-display font-bold mb-4 tracking-tight text-foreground">
              {title}
            </h1>
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

          {/* Image Gallery with Moderation */}
          {uniqueImages.length > 0 && (
            <div className="mb-6 p-4 bg-card border border-border rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-display font-medium">
                  Images ({uniqueImages.length})
                </span>
                <span className="text-xs text-muted-foreground">
                  Blur: {settings.blur_level} | Sensitivity: {settings.ai_sensitivity}
                </span>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {uniqueImages.slice(0, 12).map((src, idx) => {
                  const result = imageResults.get(src);
                  const isBlurred = shouldBlurImage(src);
                  const isRevealed = revealedImages.has(src);
                  
                  return (
                    <div 
                      key={`${src}-${idx}`} 
                      className="relative aspect-video bg-muted rounded-lg overflow-hidden group border border-border"
                    >
                      <img
                        src={src}
                        alt={`Image ${idx + 1}`}
                        className="w-full h-full object-cover"
                        style={getImageStyle(src)}
                        loading="lazy"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.style.display = 'none';
                          target.parentElement?.classList.add('bg-muted');
                        }}
                      />
                      
                      {/* Blurred overlay with reveal option */}
                      {isBlurred && !isRevealed && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                          <div className="text-center p-2">
                            <AlertTriangle className="w-6 h-6 text-amber-500 mx-auto mb-1" />
                            <p className="text-xs font-display text-foreground mb-1">
                              {result?.dominantClass?.toUpperCase() || 'BLURRED'}
                            </p>
                            <p className="text-[10px] text-muted-foreground mb-2">
                              {result ? `${(result.confidence * 100).toFixed(0)}% confidence` : ''}
                            </p>
                            <button
                              onClick={() => toggleImageReveal(src)}
                              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto px-2 py-1 bg-muted rounded"
                            >
                              <Eye className="w-3 h-3" />
                              Reveal
                            </button>
                          </div>
                        </div>
                      )}
                      
                      {/* Revealed but flagged - show hide button */}
                      {result?.shouldBlur && isRevealed && (
                        <button
                          onClick={() => toggleImageReveal(src)}
                          className="absolute top-2 right-2 p-1.5 bg-background/80 rounded-full text-muted-foreground hover:text-foreground"
                          title="Hide image"
                        >
                          <EyeOff className="w-3 h-3" />
                        </button>
                      )}
                      
                      {/* Safe badge */}
                      {result && !result.shouldBlur && (
                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-green-500/90 rounded text-[10px] text-white font-display">
                          SAFE
                        </div>
                      )}
                      
                      {/* Unscanned indicator */}
                      {!result && !isScanning && (
                        <div className="absolute top-2 left-2 px-2 py-0.5 bg-muted/90 rounded text-[10px] text-muted-foreground font-display">
                          NOT SCANNED
                        </div>
                      )}
                      
                      {/* Scanning indicator */}
                      {!result && isScanning && (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                          <Loader2 className="w-5 h-5 animate-spin text-aqua" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              
              {uniqueImages.length > 12 && (
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  +{uniqueImages.length - 12} more images in content below
                </p>
              )}
            </div>
          )}

          {/* Rendered Content */}
          {content ? (
            <div 
              className="prose prose-sm dark:prose-invert max-w-none
                prose-headings:font-display prose-headings:tracking-tight prose-headings:text-foreground
                prose-p:text-foreground prose-p:leading-relaxed
                prose-a:text-aqua prose-a:no-underline hover:prose-a:underline
                prose-strong:text-foreground prose-strong:font-semibold
                prose-ul:text-foreground prose-ol:text-foreground
                prose-li:text-foreground
                prose-blockquote:border-l-aqua prose-blockquote:text-muted-foreground
                prose-img:rounded-lg prose-img:mx-auto prose-img:my-4
                prose-pre:bg-muted prose-pre:text-foreground
                prose-code:text-aqua prose-code:bg-muted prose-code:px-1 prose-code:rounded"
              dangerouslySetInnerHTML={{ __html: processedContent }}
            />
          ) : (
            <div className="text-center py-12">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground mb-2">No readable content could be extracted.</p>
              <p className="text-xs text-muted-foreground">
                The page may be heavily dynamic or require JavaScript to load.
              </p>
            </div>
          )}

          {/* Text preview for debugging/accessibility */}
          {textPreview && content && (
            <details className="mt-8 text-xs">
              <summary className="text-muted-foreground cursor-pointer hover:text-foreground">
                View plain text extract
              </summary>
              <p className="mt-2 p-3 bg-muted rounded text-muted-foreground whitespace-pre-wrap">
                {textPreview}
              </p>
            </details>
          )}
        </article>
      </main>

      {/* Footer with protection info */}
      <footer className="px-4 py-3 border-t border-border bg-card">
        <div className="max-w-2xl mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Shield className="w-3 h-3 text-aqua" />
            <span>Content filtered • Images moderated on-device</span>
          </div>
          <span>
            Blur: {settings.blur_level} | AI: {settings.ai_sensitivity}
          </span>
        </div>
      </footer>
    </div>
  );
};
