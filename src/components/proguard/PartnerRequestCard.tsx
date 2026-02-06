/**
 * Partner Request Card
 * 
 * Displayed to partners for approval/denial.
 * Shows ONLY request type + time - NO content details, URLs, or platform info.
 */

import { useState, useEffect } from 'react';
import { Shield, Clock, Check, X, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CathedralCard } from '@/components/ui/CathedralCard';
import { 
  PartnerRequest, 
  PartnerRequestStatus,
  getRequestTypeLabel,
} from '@/models/PartnerRequest';
import { 
  getRequestTimeRemaining, 
  formatTimeRemaining,
  ENCOURAGEMENT_PRESETS,
  EncouragementPreset,
} from '@/logic/proGuard';
import { cn } from '@/lib/utils';

interface PartnerRequestCardProps {
  request: PartnerRequest;
  onApprove: (messagePreset?: EncouragementPreset) => void;
  onDeny: () => void;
  className?: string;
}

export const PartnerRequestCard = ({
  request,
  onApprove,
  onDeny,
  className,
}: PartnerRequestCardProps) => {
  const [timeRemaining, setTimeRemaining] = useState(() => getRequestTimeRemaining(request));
  const [showMessages, setShowMessages] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<EncouragementPreset | null>(null);

  // Update countdown every second
  useEffect(() => {
    if (request.status !== 'PENDING') return;
    
    const interval = setInterval(() => {
      const remaining = getRequestTimeRemaining(request);
      setTimeRemaining(remaining);
      
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [request]);

  const isPending = request.status === 'PENDING' && timeRemaining > 0;
  const isExpired = request.status === 'EXPIRED' || (request.status === 'PENDING' && timeRemaining <= 0);
  
  // Get safe label - NO content details
  const typeLabel = getRequestTypeLabel(request.type);
  
  // Format request time
  const requestTime = new Date(request.ts).toLocaleTimeString([], { 
    hour: 'numeric', 
    minute: '2-digit' 
  });

  const handleApprove = () => {
    onApprove(selectedPreset ?? undefined);
  };

  return (
    <CathedralCard 
      variant={isPending ? 'default' : 'silver'}
      className={cn('p-4 space-y-4', className)}
    >
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center",
            isPending ? "bg-accent-amber/20" : "bg-silver/10"
          )}>
            <Shield className={cn(
              "w-5 h-5",
              isPending ? "text-accent-amber" : "text-silver/50"
            )} />
          </div>
          <div>
            <h3 className="text-sm font-medium text-foreground">
              {typeLabel}
            </h3>
            <p className="text-xs text-muted-foreground">
              Requested at {requestTime}
            </p>
          </div>
        </div>
        
        {/* Status / Timer */}
        {isPending ? (
          <div className="flex items-center gap-1.5 text-accent-amber">
            <Clock className="w-3.5 h-3.5" />
            <span className="text-sm font-mono font-medium">
              {formatTimeRemaining(timeRemaining)}
            </span>
          </div>
        ) : isExpired ? (
          <span className="text-xs text-muted-foreground">Expired</span>
        ) : request.status === 'APPROVED' ? (
          <span className="text-xs text-emerald-500">Approved</span>
        ) : request.status === 'DENIED' ? (
          <span className="text-xs text-destructive">Denied</span>
        ) : null}
      </div>
      
      {/* Privacy notice */}
      <p className="text-xs text-muted-foreground">
        No browsing details shared. Only action type is visible.
      </p>
      
      {/* Encouragement presets (optional) */}
      {isPending && showMessages && (
        <div className="space-y-2">
          <p className="text-xs text-silver">Add encouragement (optional):</p>
          <div className="flex flex-wrap gap-2">
            {ENCOURAGEMENT_PRESETS.map((preset) => (
              <button
                key={preset}
                onClick={() => setSelectedPreset(selectedPreset === preset ? null : preset)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs transition-colors",
                  selectedPreset === preset
                    ? "bg-gold/20 text-gold border border-gold/40"
                    : "bg-silver/10 text-silver border border-silver/20 hover:border-silver/40"
                )}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Actions */}
      {isPending && (
        <div className="flex items-center gap-2 pt-2">
          <Button
            onClick={handleApprove}
            className="flex-1 bg-emerald-600/90 hover:bg-emerald-600 text-foreground border border-emerald-500/30"
          >
            <Check className="w-4 h-4 mr-1.5" />
            Approve
          </Button>
          <Button
            onClick={onDeny}
            variant="outline"
            className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            <X className="w-4 h-4 mr-1.5" />
            Deny
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowMessages(!showMessages)}
            className={cn(
              "shrink-0",
              showMessages ? "text-gold" : "text-silver"
            )}
          >
            <MessageSquare className="w-4 h-4" />
          </Button>
        </div>
      )}
    </CathedralCard>
  );
};
