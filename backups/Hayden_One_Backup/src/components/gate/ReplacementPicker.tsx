/**
 * Replacement Picker Component
 * 
 * Level 3 replacement activity selection.
 * Exact list as specified.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  Dumbbell, 
  Target, 
  BookOpen, 
  MessageCircle, 
  Footprints,
  Check,
} from 'lucide-react';
import type { GrowthActionType } from '@/logic/progressEngine';

export interface ReplacementOption {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  actionType: GrowthActionType | 'WALK'; // WALK is not a growth action but a replacement
  description: string;
}

const REPLACEMENT_OPTIONS: ReplacementOption[] = [
  {
    id: 'workout',
    label: '2-minute workout',
    icon: Dumbbell,
    actionType: 'WORKOUT',
    description: 'Quick bodyweight exercises',
  },
  {
    id: 'focus',
    label: '10-minute focus sprint',
    icon: Target,
    actionType: 'QUICK_WIN_10',
    description: 'Deep work on something meaningful',
  },
  {
    id: 'devotional',
    label: 'Prayer / Devotional',
    icon: BookOpen,
    actionType: 'DEVOTIONAL',
    description: 'Connect with your spiritual practice',
  },
  {
    id: 'buddy',
    label: 'Text an accountability buddy',
    icon: MessageCircle,
    actionType: 'TEXT_BUDDY',
    description: 'Reach out for support',
  },
  {
    id: 'walk',
    label: 'Walk outside',
    icon: Footprints,
    actionType: 'WALK',
    description: 'Change your environment',
  },
];

interface ReplacementPickerProps {
  onSelect: (option: ReplacementOption) => void;
  onCancel?: () => void;
  className?: string;
}

export function ReplacementPicker({
  onSelect,
  onCancel,
  className,
}: ReplacementPickerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const handleSelect = (option: ReplacementOption) => {
    if (selectedId === option.id) {
      // Double tap to confirm
      setIsConfirming(true);
      onSelect(option);
    } else {
      setSelectedId(option.id);
    }
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div className="text-center">
        <h3 className="font-display text-lg text-gold tracking-wide">
          Redirect your energy
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          Choose strength over impulse
        </p>
      </div>

      <div className="space-y-2">
        {REPLACEMENT_OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = selectedId === option.id;
          
          return (
            <button
              key={option.id}
              onClick={() => handleSelect(option)}
              disabled={isConfirming}
              className={cn(
                'w-full flex items-center gap-4 p-4 rounded-xl',
                'border transition-all duration-200',
                'text-left',
                isSelected
                  ? 'border-gold/50 bg-gold/10'
                  : 'border-silver/20 bg-cathedral-deep/30 hover:border-silver/40',
                isConfirming && 'opacity-50 cursor-not-allowed'
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
                  {option.description}
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

      {selectedId && (
        <p className="text-center text-xs text-muted-foreground">
          Tap again to confirm
        </p>
      )}

      {onCancel && (
        <button
          onClick={onCancel}
          className="w-full py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          I'll wait instead
        </button>
      )}
    </div>
  );
}

export { REPLACEMENT_OPTIONS };
