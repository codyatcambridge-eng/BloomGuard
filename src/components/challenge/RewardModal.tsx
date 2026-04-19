/**
 * Reward Modal Component
 * Celebratory modal shown when a weekly challenge is completed
 */

import { useState, useEffect } from 'react';
import { Shield, Zap, Target, Heart, Trophy, Sparkles, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
  WeeklyChallengeType, 
  WEEKLY_CHALLENGES,
} from '@/logic/challengeEngine';
import { cn } from '@/lib/utils';

interface RewardModalProps {
  open: boolean;
  onClose: () => void;
  challengeType: WeeklyChallengeType;
  spAwarded: number;
  badgeUnlocked: string;
}

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Shield,
  Zap,
  Target,
  Heart,
};

export const RewardModal = ({
  open,
  onClose,
  challengeType,
  spAwarded,
  badgeUnlocked,
}: RewardModalProps) => {
  const [showConfetti, setShowConfetti] = useState(false);
  const definition = WEEKLY_CHALLENGES[challengeType];
  
  useEffect(() => {
    if (open) {
      // Trigger confetti animation
      setShowConfetti(true);
      const timer = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [open]);
  
  if (!definition) return null;
  
  const Icon = iconMap[definition.icon] ?? Trophy;
  
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md bg-obsidian border-gold/30 text-center">
        {/* Close button is handled by DialogContent */}
        
        <DialogHeader className="space-y-4">
          {/* Celebration Icon */}
          <div className="relative mx-auto">
            <div className={cn(
              "w-20 h-20 rounded-full flex items-center justify-center",
              "bg-gradient-to-br from-gold/30 to-accent-amber/20",
              "border-2 border-gold/50 shadow-lg shadow-gold/20",
              showConfetti && "animate-pulse"
            )}>
              <Trophy className="w-10 h-10 text-gold" />
            </div>
            
            {/* Sparkles decoration */}
            {showConfetti && (
              <>
                <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-gold animate-spin" />
                <Sparkles className="absolute -bottom-1 -left-2 w-5 h-5 text-accent-amber animate-pulse" />
              </>
            )}
          </div>
          
          <DialogTitle className="text-xl font-display text-gold">
            Challenge Complete!
          </DialogTitle>
          
          <DialogDescription className="text-silver">
            You trained discipline.
          </DialogDescription>
        </DialogHeader>
        
        {/* Challenge Details */}
        <div className="py-4 space-y-4">
          <div className="flex items-center justify-center gap-3 text-foreground">
            <div className="w-8 h-8 rounded-lg bg-silver/10 flex items-center justify-center">
              <Icon className="w-4 h-4 text-silver" />
            </div>
            <span className="font-display">{definition.name}</span>
          </div>
          
          {/* Rewards */}
          <div className="flex justify-center gap-6 py-4">
            <div className="text-center">
              <div className="text-2xl font-display text-gold">+{spAwarded}</div>
              <div className="text-xs text-muted-foreground">Strength Points</div>
            </div>
            
            <div className="w-px bg-silver/20" />
            
            <div className="text-center">
              <div className="text-2xl">🏆</div>
              <div className="text-xs text-muted-foreground">Badge Earned</div>
            </div>
          </div>
          
          {/* Empowering Message */}
          <p className="text-sm text-silver/80 italic">
            "That was a win. Your consistency is building something real."
          </p>
        </div>
        
        {/* Action Button */}
        <Button 
          onClick={onClose}
          className="w-full bg-gold text-obsidian hover:bg-gold/90 font-display"
        >
          Continue Building
        </Button>
      </DialogContent>
    </Dialog>
  );
};
