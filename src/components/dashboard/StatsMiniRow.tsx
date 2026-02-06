/**
 * Stats Mini Row
 * 
 * Compact row showing secondary stats: urges resisted, minutes reclaimed.
 */

import { cn } from '@/lib/utils';
import { ShieldCheck, Clock } from 'lucide-react';

interface StatsMiniRowProps {
  urgesResisted: number;
  minutesReclaimed: number;
  className?: string;
}

export function StatsMiniRow({
  urgesResisted,
  minutesReclaimed,
  className,
}: StatsMiniRowProps) {
  return (
    <div className={cn('flex items-center justify-center gap-6', className)}>
      {/* Urges Resisted */}
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-techBlue" />
        <span className="text-sm text-muted-foreground">
          <span className="text-techBlue font-medium">{urgesResisted}</span> urges resisted
        </span>
      </div>

      {/* Divider */}
      <div className="h-4 w-px bg-silver/20" />

      {/* Minutes Reclaimed */}
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-gold" />
        <span className="text-sm text-muted-foreground">
          <span className="text-gold font-medium">{minutesReclaimed}</span> min reclaimed
        </span>
      </div>
    </div>
  );
}
