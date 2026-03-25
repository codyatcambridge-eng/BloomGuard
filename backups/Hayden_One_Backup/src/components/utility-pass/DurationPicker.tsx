/**
 * Duration Picker
 * 
 * Selection of utility pass duration options.
 * Basic tier: 5, 10, 15 min max
 * Pro tier: extended durations require partner approval
 */

import { cn } from '@/lib/utils';
import { Lock } from 'lucide-react';
import {
  UTILITY_PASS_DURATIONS,
  PRO_EXTENDED_DURATIONS,
  type UtilityPassDuration,
} from '@/logic/utilityPass';
import { tokens } from '@/ui/tokens';

interface DurationPickerProps {
  selectedDuration: UtilityPassDuration;
  onSelect: (duration: UtilityPassDuration) => void;
  planTier: 'basic' | 'pro';
  className?: string;
}

export function DurationPicker({
  selectedDuration,
  onSelect,
  planTier,
  className,
}: DurationPickerProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <h3 className="text-sm font-display text-muted-foreground tracking-wider text-center">
        HOW LONG?
      </h3>
      
      <div className="flex gap-2 justify-center">
        {UTILITY_PASS_DURATIONS.map((option) => (
          <button
            key={option.minutes}
            onClick={() => onSelect(option.minutes)}
            className={cn(
              'flex-1 py-3 px-4 rounded-xl transition-all duration-200',
              'border font-display text-sm tracking-wide',
              'min-h-[44px]',
              selectedDuration === option.minutes
                ? 'border-gold bg-gold/20 text-gold'
                : 'border-silver/30 bg-cathedral-deep/50 text-silver hover:border-silver/60'
            )}
            style={{ minHeight: tokens.minTouchTarget }}
          >
            {option.label}
          </button>
        ))}
      </div>
      
      {/* Pro extended durations (locked for basic) */}
      {planTier === 'pro' && (
        <div className="pt-2">
          <p className="text-xs text-muted-foreground text-center mb-2">
            Extended (requires partner approval)
          </p>
          <div className="flex gap-2 justify-center opacity-50">
            {PRO_EXTENDED_DURATIONS.map((option) => (
              <button
                key={option.minutes}
                disabled
                className={cn(
                  'flex items-center gap-1 py-2 px-3 rounded-lg',
                  'border border-silver/20 bg-cathedral-deep/30',
                  'text-silver/50 text-xs',
                  'cursor-not-allowed'
                )}
              >
                <Lock className="w-3 h-3" />
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
