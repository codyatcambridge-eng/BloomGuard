/**
 * Next Move Picker Component
 * 
 * Step 3 of recovery flow - choose next growth action.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  Target, 
  Dumbbell, 
  BookOpen, 
  Heart, 
  MessageCircle,
  Check,
} from 'lucide-react';
import { NEXT_MOVE_OPTIONS, RecoveryNextMove } from '@/logic/recovery';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Target,
  Dumbbell,
  BookOpen,
  Heart,
  MessageCircle,
};

interface NextMovePickerProps {
  onSelect: (move: RecoveryNextMove) => void;
  onSkip?: () => void;
  className?: string;
}

export function NextMovePicker({
  onSelect,
  onSkip,
  className,
}: NextMovePickerProps) {
  const [selected, setSelected] = useState<RecoveryNextMove | null>(null);

  const handleSelect = (move: RecoveryNextMove) => {
    if (selected === move) {
      // Double tap to confirm
      onSelect(move);
    } else {
      setSelected(move);
    }
  };

  return (
    <div className={cn('space-y-6', className)}>
      <div className="text-center">
        <h3 className="font-display text-lg text-gold tracking-wide">
          What's your next move?
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Channel your energy into growth
        </p>
      </div>

      <div className="space-y-2">
        {NEXT_MOVE_OPTIONS.map((option) => {
          const Icon = ICON_MAP[option.icon] ?? Target;
          const isSelected = selected === option.id;
          
          return (
            <button
              key={option.id}
              onClick={() => handleSelect(option.id)}
              className={cn(
                'w-full flex items-center gap-4 p-4 rounded-xl',
                'border transition-all duration-200',
                'text-left',
                isSelected
                  ? 'border-gold/50 bg-gold/10'
                  : 'border-silver/20 bg-cathedral-deep/30 hover:border-silver/40'
              )}
            >
              <div className={cn(
                'flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center',
                isSelected ? 'bg-gold/20' : 'bg-silver/10'
              )}>
                <Icon className={cn(
                  'w-5 h-5',
                  isSelected ? 'text-gold' : 'text-silver'
                )} />
              </div>
              
              <div className="flex-1 min-w-0">
                <span className={cn(
                  'block font-medium',
                  isSelected ? 'text-gold' : 'text-foreground'
                )}>
                  {option.label}
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  +{option.points} SP
                </span>
              </div>

              {isSelected && (
                <div className="flex-shrink-0">
                  <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center">
                    <Check className="w-4 h-4 text-gold" />
                  </div>
                </div>
              )}
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
          Skip for now
        </button>
      )}
    </div>
  );
}
