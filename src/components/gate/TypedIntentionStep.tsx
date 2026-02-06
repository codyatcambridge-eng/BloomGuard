/**
 * Typed Intention Step
 * 
 * Level 2 requirement: user must type intention before proceeding.
 */

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { ArrowRight } from 'lucide-react';

interface TypedIntentionStepProps {
  onComplete: (intention: string) => void;
  onSkip?: () => void;
  minLength?: number;
  className?: string;
}

export function TypedIntentionStep({
  onComplete,
  onSkip,
  minLength = 10,
  className,
}: TypedIntentionStepProps) {
  const [intention, setIntention] = useState('');
  const [hasInteracted, setHasInteracted] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  const isValid = intention.trim().length >= minLength;

  const handleSubmit = () => {
    if (isValid) {
      onComplete(intention.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && isValid) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={cn('space-y-6', className)}>
      <div className="text-center">
        <h3 className="font-display text-lg text-gold tracking-wide">
          Delay is power.
        </h3>
        <p className="text-sm text-muted-foreground mt-2">
          Be honest with yourself.
        </p>
      </div>

      <div className="space-y-3">
        <label className="block text-center">
          <span className="text-sm text-foreground font-medium">
            What are you actually seeking?
          </span>
        </label>
        
        <div className="relative">
          <textarea
            ref={inputRef}
            value={intention}
            onChange={(e) => {
              setIntention(e.target.value);
              if (!hasInteracted) setHasInteracted(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type your honest answer..."
            rows={3}
            maxLength={200}
            className={cn(
              'w-full px-4 py-3 rounded-xl resize-none',
              'bg-cathedral-deep/50 border transition-colors',
              'text-foreground placeholder:text-muted-foreground',
              'focus:outline-none focus:ring-2 focus:ring-gold/30',
              hasInteracted && !isValid
                ? 'border-silver/30'
                : isValid
                  ? 'border-gold/50'
                  : 'border-silver/20'
            )}
          />
          
          {/* Character count */}
          <div className="absolute bottom-2 right-3">
            <span className={cn(
              'text-xs',
              isValid ? 'text-gold' : 'text-muted-foreground'
            )}>
              {intention.length}/{minLength}+
            </span>
          </div>
        </div>

        {hasInteracted && !isValid && (
          <p className="text-xs text-muted-foreground text-center">
            Write at least {minLength} characters
          </p>
        )}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!isValid}
        className={cn(
          'w-full flex items-center justify-center gap-2 py-4 rounded-xl',
          'font-display text-sm tracking-wider transition-all',
          isValid
            ? 'bg-gold/20 border border-gold/50 text-gold hover:bg-gold/30'
            : 'bg-cathedral-deep/30 border border-silver/20 text-muted-foreground cursor-not-allowed'
        )}
      >
        <span>Continue</span>
        <ArrowRight className="w-4 h-4" />
      </button>

      {onSkip && (
        <button
          onClick={onSkip}
          className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          I changed my mind
        </button>
      )}
    </div>
  );
}
