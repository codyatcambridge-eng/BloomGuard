/**
 * Approval Window Banner
 * 
 * Shows when user tries to create request outside approval window.
 * Displays next available window time.
 */

import { Clock, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ApprovalWindowBannerProps {
  nextWindowTime: string; // HH:MM format
  onDismiss?: () => void;
  className?: string;
}

export const ApprovalWindowBanner = ({
  nextWindowTime,
  onDismiss,
  className,
}: ApprovalWindowBannerProps) => {
  // Format time for display (e.g., "6:00 PM")
  const formatDisplayTime = (time: string): string => {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  };

  return (
    <div 
      className={cn(
        "p-4 rounded-xl",
        "bg-gradient-to-r from-techBlue/10 to-transparent",
        "border border-techBlue/30",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-techBlue/20 flex items-center justify-center shrink-0">
          <Moon className="w-5 h-5 text-techBlue" />
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-foreground mb-1">
            Outside Approval Window
          </h3>
          <p className="text-xs text-silver">
            Partner requests are available during your approval window.
          </p>
          
          <div className="flex items-center gap-2 mt-2 text-sm">
            <Clock className="w-3.5 h-3.5 text-techBlue" />
            <span className="text-techBlue font-display">
              Opens at {formatDisplayTime(nextWindowTime)}
            </span>
          </div>
        </div>
      </div>
      
      {/* Empowering message */}
      <p className="text-xs text-muted-foreground italic mt-3 pl-13">
        "Delay is power. This window protects your focus."
      </p>
    </div>
  );
};
