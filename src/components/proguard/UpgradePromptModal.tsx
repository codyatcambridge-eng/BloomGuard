/**
 * Upgrade Prompt Modal
 * 
 * Shown when non-pro users attempt protected actions.
 * Uses empowering, non-judgmental language.
 */

import { Shield, Sparkles, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface UpgradePromptModalProps {
  open: boolean;
  onClose: () => void;
  actionLabel: string;
}

export const UpgradePromptModal = ({
  open,
  onClose,
  actionLabel,
}: UpgradePromptModalProps) => {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md bg-obsidian border-gold/30">
        <DialogHeader className="space-y-4 text-center">
          {/* Icon */}
          <div className="mx-auto w-16 h-16 rounded-full bg-gradient-to-br from-gold/20 to-accent-amber/10 border border-gold/30 flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-gold" />
          </div>
          
          <DialogTitle className="text-lg font-display text-foreground">
            Pro Feature
          </DialogTitle>
          
          <DialogDescription className="text-silver">
            Partner accountability for <span className="text-foreground">{actionLabel}</span> is available with Champ Pro.
          </DialogDescription>
        </DialogHeader>
        
        {/* Benefits */}
        <div className="py-4 space-y-3">
          <div className="flex items-start gap-3 text-sm">
            <Shield className="w-4 h-4 text-gold mt-0.5 shrink-0" />
            <span className="text-silver">Partner approval for protected actions</span>
          </div>
          <div className="flex items-start gap-3 text-sm">
            <Shield className="w-4 h-4 text-gold mt-0.5 shrink-0" />
            <span className="text-silver">Approval windows for focused times</span>
          </div>
          <div className="flex items-start gap-3 text-sm">
            <Shield className="w-4 h-4 text-gold mt-0.5 shrink-0" />
            <span className="text-silver">Privacy-first partner notifications</span>
          </div>
        </div>
        
        {/* Empowering message */}
        <p className="text-xs text-center text-muted-foreground italic">
          "Building strength is a team effort."
        </p>
        
        {/* Actions */}
        <div className="flex flex-col gap-2 pt-2">
          <Button 
            className="w-full bg-gold text-obsidian hover:bg-gold/90 font-display"
            onClick={() => {
              // TODO: Navigate to upgrade flow
              onClose();
            }}
          >
            Explore Champ Pro
          </Button>
          <Button
            variant="ghost"
            className="w-full text-silver hover:text-foreground"
            onClick={onClose}
          >
            Maybe Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
