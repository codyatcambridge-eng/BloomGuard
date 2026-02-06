/**
 * Reason Picker
 * 
 * One-tap selection of utility pass reason presets.
 * Privacy-safe: only stores reason category, never content details.
 */

import { cn } from '@/lib/utils';
import { 
  UTILITY_PASS_REASONS, 
  type UtilityPassReason 
} from '@/logic/utilityPass';
import { tokens } from '@/ui/tokens';

interface ReasonPickerProps {
  onSelect: (reason: UtilityPassReason) => void;
  className?: string;
}

export function ReasonPicker({ onSelect, className }: ReasonPickerProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <h3 className="text-sm font-display text-muted-foreground tracking-wider text-center">
        WHAT DO YOU NEED?
      </h3>
      
      <div className="grid grid-cols-2 gap-3">
        {UTILITY_PASS_REASONS.map((reason) => (
          <button
            key={reason.id}
            onClick={() => onSelect(reason.id)}
            className={cn(
              'flex flex-col items-center gap-2 p-4',
              'rounded-xl border border-silver/30',
              'bg-cathedral-deep/50 hover:bg-cathedral-deep',
              'hover:border-gold/50 transition-all duration-200',
              'min-h-[88px]' // 2x touch target minimum
            )}
          >
            <span className="text-2xl" role="img" aria-label={reason.label}>
              {reason.icon}
            </span>
            <span className="text-sm font-medium text-foreground">
              {reason.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
