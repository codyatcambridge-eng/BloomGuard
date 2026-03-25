import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, ExternalLink, Copy, Check, AlertTriangle, Shield, Loader2, Play, User } from "lucide-react";
import { useOnDeviceModeration, ModerationResult } from "@/hooks/useOnDeviceModeration";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface YouTubePreviewViewProps {
  videoId: string;
  title: string;
  channelName: string;
  description: string;
  thumbnailUrl: string;
  sourceUrl: string;
  onBack: () => void;
  onOpenExternal: () => void;
}

export const YouTubePreviewView = ({
  videoId,
  title,
  channelName,
  description,
  thumbnailUrl,
  sourceUrl,
  onBack,
  onOpenExternal,
}: YouTubePreviewViewProps) => {
  const [copied, setCopied] = useState(false);
  const [thumbnailResult, setThumbnailResult] = useState<ModerationResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [showExternalWarning, setShowExternalWarning] = useState(false);

  const { isReady: aiReady, classifyImage, modelState } = useOnDeviceModeration();
  const { settings, getAIThresholds, getBlurAmount } = useLocalSettings();

  const blurAmount = getBlurAmount();
  const thresholds = getAIThresholds();

  // Scan thumbnail when AI is ready
  useEffect(() => {
    const scanThumbnail = async () => {
      if (!aiReady || !thumbnailUrl || thumbnailResult) return;
      
      setIsScanning(true);
      try {
        const result = await classifyImage(thumbnailUrl, thresholds);
        if (result) {
          setThumbnailResult(result);
          if (settings.show_scan_notifications && result.shouldBlur) {
            toast.warning("Thumbnail blurred for your protection");
          }
        }
      } catch (error) {
        console.error('[YouTubePreview] Error scanning thumbnail:', error);
      } finally {
        setIsScanning(false);
      }
    };

    if (settings.auto_scan_images) {
      scanThumbnail();
    }
  }, [aiReady, thumbnailUrl, thumbnailResult, classifyImage, thresholds, settings]);

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

  const handleOpenExternalClick = () => {
    setShowExternalWarning(true);
  };

  const handleConfirmExternal = () => {
    setShowExternalWarning(false);
    onOpenExternal();
  };

  const shouldBlurThumbnail = blurAmount > 0 && thumbnailResult?.shouldBlur === true;

  const getThumbnailBadge = () => {
    if (isScanning) {
      return { text: 'SCANNING', color: 'bg-muted text-muted-foreground' };
    }
    if (!thumbnailResult) {
      return { text: 'NOT SCANNED', color: 'bg-muted/90 text-muted-foreground' };
    }
    if (thumbnailResult.shouldBlur) {
      return { text: 'BLURRED', color: 'bg-amber-500/90 text-white' };
    }
    return { text: 'SAFE', color: 'bg-green-500/90 text-white' };
  };

  const badge = getThumbnailBadge();
  const truncatedDescription = description.length > 300 
    ? description.substring(0, 300) + '...' 
    : description;

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
              <Play className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-xs font-display text-red-500 tracking-wider">YOUTUBE PREVIEW MODE</span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{sourceUrl}</p>
          </div>
        </div>
      </header>

      {/* Warning Banner */}
      <div className="px-4 py-3 bg-red-500/10 border-b border-red-500/20">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-red-600 font-medium">YouTube Preview Mode — Video playback disabled</p>
            <p className="text-xs text-red-600/80 mt-1">
              For your protection, videos cannot be played inside Focus Browser. Use "Watch on YouTube" to view the video.
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
                Image moderation unavailable
              </span>
            )}
          </div>
          
          {isScanning && (
            <span className="flex items-center gap-1 text-aqua">
              <Loader2 className="w-3 h-3 animate-spin" />
              Scanning thumbnail...
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-auto pb-20">
        <article className="max-w-2xl mx-auto px-4 py-6">
          {/* Thumbnail */}
          <div className="relative aspect-video bg-muted rounded-lg overflow-hidden border border-border mb-6">
            {thumbnailUrl && (
              <img
                src={thumbnailUrl}
                alt={title}
                className="w-full h-full object-cover transition-all duration-300"
                style={shouldBlurThumbnail ? { filter: `blur(${blurAmount}px)` } : {}}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            
            {/* Play button overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center opacity-90">
                <Play className="w-8 h-8 text-white fill-white ml-1" />
              </div>
            </div>
            
            {/* Moderation badge */}
            <div className={`absolute top-3 left-3 px-2 py-1 rounded text-[10px] font-display ${badge.color}`}>
              {badge.text}
            </div>
            
            {/* Video ID */}
            <div className="absolute bottom-3 right-3 px-2 py-1 bg-black/70 rounded text-[10px] text-white font-mono">
              ID: {videoId}
            </div>
          </div>

          {/* Title */}
          <h1 className="text-xl font-display font-bold mb-3 text-foreground leading-tight">
            {title}
          </h1>

          {/* Channel */}
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-muted-foreground" />
            </div>
            <span className="text-sm font-medium text-foreground">{channelName}</span>
          </div>

          {/* Description */}
          {description && (
            <div className="p-4 bg-muted/30 rounded-lg border border-border">
              <h3 className="text-xs font-display font-medium text-muted-foreground mb-2 uppercase tracking-wider">
                Description
              </h3>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                {truncatedDescription}
              </p>
            </div>
          )}
        </article>
      </main>

      {/* External Warning Modal */}
      {showExternalWarning && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-lg p-6 max-w-sm w-full shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <h3 className="font-display font-bold text-lg">External Link Warning</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              This link will open YouTube in an external browser. Focus Browser protections will not apply.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowExternalWarning(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                onClick={handleConfirmExternal}
              >
                Open YouTube
              </Button>
            </div>
          </div>
        </div>
      )}

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
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
              onClick={handleOpenExternalClick}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Watch on YouTube
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            YouTube Preview shows static metadata only. Open in external browser to watch the video.
          </p>
        </div>
      </footer>
    </div>
  );
};
