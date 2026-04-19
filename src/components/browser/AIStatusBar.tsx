import { Shield, Loader2, AlertTriangle, RefreshCw } from "lucide-react";

type ModelState = 'idle' | 'loading' | 'ready' | 'error';

interface AIStatusBarProps {
  modelState: ModelState;
  isScanning?: boolean;
  scannedCount?: number;
  totalCount?: number;
  blurredCount?: number;
  safeCount?: number;
  onScan?: () => void;
  compact?: boolean;
}

export const AIStatusBar = ({
  modelState,
  isScanning = false,
  scannedCount = 0,
  totalCount = 0,
  blurredCount = 0,
  safeCount = 0,
  onScan,
  compact = false,
}: AIStatusBarProps) => {
  const showStats = totalCount > 0;
  const canScan = modelState === 'ready' && scannedCount < totalCount && !isScanning;

  return (
    <div className={`px-4 ${compact ? 'py-1.5' : 'py-2'} bg-muted/30 border-b border-border`}>
      <div className="flex items-center justify-between text-xs">
        {/* AI Status */}
        <div className="flex items-center gap-3">
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
            <span className="flex items-center gap-1 text-amber-500">
              <AlertTriangle className="w-3 h-3" />
              AI unavailable
            </span>
          )}
          {modelState === 'idle' && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Shield className="w-3 h-3" />
              Initializing...
            </span>
          )}
        </div>

        {/* Image Stats */}
        {showStats && (
          <div className="flex items-center gap-3">
            {isScanning ? (
              <span className="flex items-center gap-1 text-aqua">
                <Loader2 className="w-3 h-3 animate-spin" />
                Scanning {scannedCount}/{totalCount}
              </span>
            ) : (
              <>
                <span className="text-muted-foreground">
                  {scannedCount}/{totalCount} scanned
                </span>
                {blurredCount > 0 && (
                  <span className="text-amber-600">
                    {blurredCount} blurred
                  </span>
                )}
                {safeCount > 0 && !compact && (
                  <span className="text-green-600">
                    {safeCount} safe
                  </span>
                )}
                {canScan && onScan && (
                  <button
                    onClick={onScan}
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
    </div>
  );
};
