/**
 * Emotion Picker Component
 * 
 * Step 2 of recovery flow - select how you were feeling.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { EmotionTag } from '@/models/TriggerEvent';
import { EMOTION_OPTIONS } from '@/logic/recovery';

interface EmotionPickerProps {
  onSelect: (emotion: EmotionTag) => void;
  onSkip?: () => void;
  className?: string;
}

export function EmotionPicker({
  onSelect,
  onSkip,
  className,
}: EmotionPickerProps) {
  const [selected, setSelected] = useState<EmotionTag>(null);

  const handleSelect = (emotion: EmotionTag) => {
    if (selected === emotion) {
      // Double tap to confirm
      onSelect(emotion);
    } else {
      setSelected(emotion);
    }
  };

  return (
    <div className={cn('space-y-6', className)}>
      <div className="text-center">
        <h3 className="font-display text-lg text-gold tracking-wide">
          What were you feeling?
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Understanding triggers helps you grow stronger
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {EMOTION_OPTIONS.map((option) => {
          const isSelected = selected === option.id;
          
          return (
            <button
              key={option.id}
              onClick={() => handleSelect(option.id)}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl',
                'border transition-all duration-200',
                isSelected
                  ? 'border-gold/50 bg-gold/10 scale-105'
                  : 'border-silver/20 bg-cathedral-deep/30 hover:border-silver/40'
              )}
            >
              <span className="text-2xl">{option.emoji}</span>
              <span className={cn(
                'text-xs font-medium',
                isSelected ? 'text-gold' : 'text-foreground'
              )}>
                {option.label}
              </span>
            </button>
          );
        })}
      </div>

      {selected && (
        <p className="text-center text-xs text-muted-foreground animate-in fade-in">
          Tap again to confirm
        </p>
      )}

      {onSkip && (
        <button
          onClick={onSkip}
          className="w-full py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip this step
        </button>
      )}
    </div>
  );
}
