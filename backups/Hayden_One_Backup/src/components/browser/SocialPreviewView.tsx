import { useState, useEffect } from "react";
import { ArrowLeft, ExternalLink, Copy, Check, AlertTriangle, Shield, Loader2, User, Globe } from "lucide-react";
import { useOnDeviceModeration, ModerationResult } from "@/hooks/useOnDeviceModeration";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export type SocialPlatform = 'instagram' | 'tiktok' | 'facebook' | 'twitter' | 'youtube';

interface SocialPreviewViewProps {
  platform: SocialPlatform;
  title: string;
  author: string;
  description: string;
  thumbnailUrl: string;
  sourceUrl: string;
  contentId?: string;
  onBack: () => void;
  onOpenExternal: () => void;
}

const PLATFORM_CONFIG: Record<SocialPlatform, {
  name: string;
  color: string;
  bgColor: string;
  icon: string;
}> = {
  instagram: {
    name: 'Instagram',
    color: 'text-pink-500',
    bgColor: 'bg-gradient-to-r from-purple-500 via-pink-500 to-orange-400',
    icon: '📷',
  },
  tiktok: {
    name: 'TikTok',
    color: 'text-foreground',
    bgColor: 'bg-foreground',
    icon: '🎵',
  },
  facebook: {
    name: 'Facebook',
    color: 'text-blue-600',
    bgColor: 'bg-blue-600',
    icon: '👤',
  },
  twitter: {
    name: 'X (Twitter)',
    color: 'text-foreground',
    bgColor: 'bg-foreground',
    icon: '𝕏',
  },
  youtube: {
    name: 'YouTube',
    color: 'text-red-500',
    bgColor: 'bg-red-600',
    icon: '▶️',
  },
};

export const SocialPreviewView = ({
  platform,
  title,
  author,
  description,
  thumbnailUrl,
  sourceUrl,
  contentId,
  onBack,
  onOpenExternal,
}: SocialPreviewViewProps) => {
  const [copied, setCopied] = useState(false);
  const [thumbnailResult, setThumbnailResult] = useState<ModerationResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [showExternalWarning, setShowExternalWarning] = useState(false);

  const { isReady: aiReady, classifyImage, modelState } = useOnDeviceModeration();
  const { settings, getAIThresholds, getBlurAmount } = useLocalSettings();

  const blurAmount = getBlurAmount();
  const thresholds = getAIThresholds();
  const config = PLATFORM_CONFIG[platform];

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
        console.error('[SocialPreview] Error scanning thumbnail:', error);
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
      return { text: 'SCANNING', variant: 'secondary' as const };
    }
    if (!thumbnailResult) {
      return { text: 'NOT SCANNED', variant: 'secondary' as const };
    }
    if (thumbnailResult.shouldBlur) {
      return { text: 'BLURRED', variant: 'destructive' as const };
    }
    return { text: 'SAFE', variant: 'default' as const };
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
              <span className="text-lg">{config.icon}</span>
              <span className={`text-xs font-display tracking-wider ${config.color}`}>
                {config.name.toUpperCase()} PREVIEW MODE
              </span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">{sourceUrl}</p>
          </div>
        </div>
      </header>

      {/* Warning Banner */}
      <div className={`px-4 py-3 ${config.bgColor} bg-opacity-10 border-b border-border`}>
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">
              Social Preview Mode — Interactivity Disabled
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              For your protection, interactive content is disabled inside Focus Browser.
              Use "View on {config.name}" to access full functionality.
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
            <span className="flex items-center gap-1 text-primary">
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
          {thumbnailUrl && (
            <div className="relative aspect-video bg-muted rounded-lg overflow-hidden border border-border mb-6">
              <img
                src={thumbnailUrl}
                alt={title}
                className="w-full h-full object-cover transition-all duration-300"
                style={shouldBlurThumbnail ? { filter: `blur(${blurAmount}px)` } : {}}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              
              {/* Moderation badge */}
              <div className="absolute top-3 left-3">
                <Badge variant={badge.variant} className="text-[10px]">
                  {badge.text}
                </Badge>
              </div>
              
              {/* Content ID if available */}
              {contentId && (
                <div className="absolute bottom-3 right-3 px-2 py-1 bg-background/70 backdrop-blur rounded text-[10px] font-mono">
                  ID: {contentId}
                </div>
              )}
            </div>
          )}

          {/* Title */}
          <h1 className="text-xl font-display font-bold mb-3 text-foreground leading-tight">
            {title || `${config.name} Content`}
          </h1>

          {/* Author */}
          {author && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium text-foreground">{author}</span>
            </div>
          )}

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

          {/* Platform info */}
          <div className="mt-6 p-4 bg-muted/20 rounded-lg border border-border">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Globe className="w-4 h-4" />
              <span>Content from {config.name}</span>
            </div>
          </div>
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
              This link will open {config.name} in an external browser. Focus Browser protections will not apply.
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
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={handleConfirmExternal}
            >
              Open {config.name}
            </Button>
          </div>
        </div>
      </div>
    )}

    {/* Action Footer */}
    <footer className="px-4 py-4 border-t border-border bg-card fixed bottom-0 left-0 right-0">
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
            className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={handleOpenExternalClick}
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            View on {config.name}
          </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Social Preview shows static metadata only. Open in external browser for full access.
          </p>
        </div>
      </footer>
    </div>
  );
};
