/**
 * Timer Ring Component
 * 
 * Circular countdown visualization with breathing animation.
 * Respects prefers-reduced-motion for accessibility.
 */

import { useEffect, useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { motion } from '@/ui';
import { tokens } from '@/ui/tokens';

interface TimerRingProps {
  durationSeconds: number;
  onComplete: () => void;
  isPaused?: boolean;
  size?: 'sm' | 'md' | 'lg';
  showBreathing?: boolean;
  className?: string;
}

export function TimerRing({
  durationSeconds,
  onComplete,
  isPaused = false,
  size = 'md',
  showBreathing = true,
  className,
}: TimerRingProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(durationSeconds);
  const [isComplete, setIsComplete] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const pausedAtRef = useRef<number | null>(null);
  
  // Check reduced motion preference
  const prefersReducedMotion = motion.shouldReduceMotion();

  // Size configurations with accessible touch targets
  const sizeConfig = {
    sm: { diameter: 120, strokeWidth: 6, fontSize: 'text-2xl' },
    md: { diameter: 180, strokeWidth: 8, fontSize: 'text-4xl' },
    lg: { diameter: 240, strokeWidth: 10, fontSize: 'text-5xl' },
  };

  const { diameter, strokeWidth, fontSize } = sizeConfig[size];
  const radius = (diameter - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Calculate progress
  const progress = Math.max(0, remainingSeconds / durationSeconds);
  const strokeDashoffset = circumference * (1 - progress);

  useEffect(() => {
    if (isPaused) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      pausedAtRef.current = Date.now();
      return;
    }

    // Resume from pause
    if (pausedAtRef.current) {
      const pauseDuration = Date.now() - pausedAtRef.current;
      startTimeRef.current += pauseDuration;
      pausedAtRef.current = null;
    }

    intervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const remaining = Math.max(0, durationSeconds - elapsed);
      
      setRemainingSeconds(remaining);

      if (remaining <= 0 && !isComplete) {
        setIsComplete(true);
        onComplete();
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      }
    }, 100);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPaused, durationSeconds, onComplete, isComplete]);

  // Format time display
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins > 0) {
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    return secs.toString();
  };

  // Get breathing animation class (respects reduced motion)
  const breathingClass = showBreathing && !isComplete && !prefersReducedMotion 
    ? 'animate-pulse' 
    : '';

  return (
    <div 
      className={cn(
        'relative flex items-center justify-center',
        breathingClass,
        className
      )}
      style={{ width: diameter, height: diameter }}
      role="timer"
      aria-live="polite"
      aria-label={`${formatTime(remainingSeconds)} remaining`}
    >
      {/* Background glow - subtle, respects reduced motion */}
      <div 
        className={cn(
          "absolute inset-0 rounded-full",
          prefersReducedMotion ? "opacity-10" : "opacity-20"
        )}
        style={{
          background: 'radial-gradient(circle, hsl(var(--gold)) 0%, transparent 70%)',
        }}
      />

      {/* SVG Ring */}
      <svg
        width={diameter}
        height={diameter}
        className="transform -rotate-90"
        aria-hidden="true"
      >
        {/* Background circle */}
        <circle
          cx={diameter / 2}
          cy={diameter / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--silver) / 0.2)"
          strokeWidth={strokeWidth}
        />
        
        {/* Progress circle */}
        <circle
          cx={diameter / 2}
          cy={diameter / 2}
          r={radius}
          fill="none"
          stroke={isComplete ? 'hsl(var(--gold))' : 'hsl(var(--tech-blue))'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            transition: `stroke-dashoffset ${motion.getSafeDuration(100)}ms ${motion.easings.smooth}`,
          }}
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn(
          'font-display font-bold',
          fontSize,
          isComplete ? 'text-gold' : 'text-foreground'
        )}>
          {formatTime(remainingSeconds)}
        </span>
        {!isComplete && (
          <span className="text-xs text-muted-foreground mt-1">
            {isPaused ? 'Paused' : 'Breathe'}
          </span>
        )}
        {isComplete && (
          <span className="text-xs text-gold mt-1">
            Ready
          </span>
        )}
      </div>
    </div>
  );
}
