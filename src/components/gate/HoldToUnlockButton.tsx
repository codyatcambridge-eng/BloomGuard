/**
 * Hold To Unlock Button
 * 
 * Press and hold for 2 seconds after cooldown to unlock.
 * Prevents tap-to-unlock spam.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Unlock } from 'lucide-react';

interface HoldToUnlockButtonProps {
  onUnlock: () => void;
  disabled?: boolean;
  holdDurationMs?: number;
  className?: string;
}

export function HoldToUnlockButton({
  onUnlock,
  disabled = false,
  holdDurationMs = 2000,
  className,
}: HoldToUnlockButtonProps) {
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [isUnlocked, setIsUnlocked] = useState(false);
  
  const holdStartRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const updateProgress = useCallback(() => {
    if (!holdStartRef.current) return;
    
    const elapsed = Date.now() - holdStartRef.current;
    const progress = Math.min(1, elapsed / holdDurationMs);
    
    setHoldProgress(progress);
    
    if (progress >= 1) {
      setIsUnlocked(true);
      onUnlock();
      return;
    }
    
    animationFrameRef.current = requestAnimationFrame(updateProgress);
  }, [holdDurationMs, onUnlock]);

  const handleStart = useCallback(() => {
    if (disabled || isUnlocked) return;
    
    setIsHolding(true);
    holdStartRef.current = Date.now();
    animationFrameRef.current = requestAnimationFrame(updateProgress);
  }, [disabled, isUnlocked, updateProgress]);

  const handleEnd = useCallback(() => {
    setIsHolding(false);
    holdStartRef.current = null;
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    // Reset progress if not unlocked
    if (!isUnlocked) {
      setHoldProgress(0);
    }
  }, [isUnlocked]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <button
      onMouseDown={handleStart}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
      onTouchStart={handleStart}
      onTouchEnd={handleEnd}
      onTouchCancel={handleEnd}
      disabled={disabled || isUnlocked}
      className={cn(
        'relative overflow-hidden rounded-xl px-8 py-4',
        'border-2 transition-all duration-200',
        'touch-none select-none',
        disabled
          ? 'border-silver/20 bg-cathedral-deep/30 text-muted-foreground cursor-not-allowed'
          : isUnlocked
            ? 'border-gold/50 bg-gold/20 text-gold'
            : isHolding
              ? 'border-silver/50 bg-cathedral-deep/80 scale-95'
              : 'border-silver/30 bg-cathedral-deep/50 hover:border-silver/50',
        className
      )}
    >
      {/* Progress fill */}
      <div 
        className="absolute inset-0 bg-silver/10 origin-left transition-transform"
        style={{ 
          transform: `scaleX(${holdProgress})`,
        }}
      />
      
      {/* Content */}
      <div className="relative flex items-center justify-center gap-2">
        <Unlock className={cn(
          'w-5 h-5 transition-colors',
          isUnlocked ? 'text-gold' : 'text-silver'
        )} />
        <span className="font-display text-sm tracking-wider">
          {disabled
            ? 'Wait for cooldown'
            : isUnlocked
              ? 'Unlocked'
              : isHolding
                ? 'Hold...'
                : 'Hold to unlock'}
        </span>
      </div>

      {/* Progress indicator text */}
      {isHolding && !isUnlocked && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2">
          <span className="text-xs text-muted-foreground">
            {Math.round(holdProgress * 100)}%
          </span>
        </div>
      )}
    </button>
  );
}
