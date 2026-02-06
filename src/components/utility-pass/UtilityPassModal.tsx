/**
 * Utility Pass Modal
 * 
 * Full-screen modal for requesting a utility pass.
 * Enforces Level 2+ gate (typed intention + cooldown) before granting pass.
 */

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { X, Coffee } from 'lucide-react';
import { ReasonPicker } from './ReasonPicker';
import { DurationPicker } from './DurationPicker';
import { TimerRing } from '@/components/gate/TimerRing';
import { TypedIntentionStep } from '@/components/gate/TypedIntentionStep';
import { HoldToUnlockButton } from '@/components/gate/HoldToUnlockButton';
import {
  type UtilityPassReason,
  type UtilityPassDuration,
  getUtilityPassGateLevel,
  getReasonLabel,
} from '@/logic/utilityPass';
import { UserProgress } from '@/models/UserProgress';
import { toast } from '@/hooks/use-toast';

type ModalStep = 
  | 'reason'      // Pick reason
  | 'intention'   // Type intention (Level 2+)
  | 'duration'    // Choose duration
  | 'cooldown'    // Wait cooldown
  | 'confirm';    // Hold to confirm

interface UtilityPassModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (reason: UtilityPassReason, duration: UtilityPassDuration, gateLevel: number) => void;
  progress: UserProgress;
  className?: string;
}

export function UtilityPassModal({
  isOpen,
  onClose,
  onComplete,
  progress,
  className,
}: UtilityPassModalProps) {
  const [step, setStep] = useState<ModalStep>('reason');
  const [reason, setReason] = useState<UtilityPassReason | null>(null);
  const [duration, setDuration] = useState<UtilityPassDuration>(5);
  const [intention, setIntention] = useState('');
  const [cooldownComplete, setCooldownComplete] = useState(false);
  
  const gateLevel = getUtilityPassGateLevel();
  const cooldownSeconds = Math.max(30, Math.min(90, progress.settings.cooldownSeconds));
  
  // Reset state when modal opens
  const resetState = useCallback(() => {
    setStep('reason');
    setReason(null);
    setDuration(5);
    setIntention('');
    setCooldownComplete(false);
  }, []);
  
  // Handle close with reset
  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);
  
  // Handle reason selection
  const handleReasonSelect = useCallback((selectedReason: UtilityPassReason) => {
    setReason(selectedReason);
    setStep('intention');
  }, []);
  
  // Handle intention complete
  const handleIntentionComplete = useCallback((text: string) => {
    setIntention(text);
    setStep('duration');
  }, []);
  
  // Handle duration selection
  const handleDurationSelect = useCallback((selectedDuration: UtilityPassDuration) => {
    setDuration(selectedDuration);
  }, []);
  
  // Handle proceed to cooldown
  const handleProceedToCooldown = useCallback(() => {
    setStep('cooldown');
  }, []);
  
  // Handle cooldown complete
  const handleCooldownComplete = useCallback(() => {
    setCooldownComplete(true);
    setStep('confirm');
  }, []);
  
  // Handle final confirmation
  const handleConfirm = useCallback(() => {
    if (!reason) return;
    
    onComplete(reason, duration, gateLevel);
    resetState();
  }, [reason, duration, gateLevel, onComplete, resetState]);
  
  // Handle resist (user backs out)
  const handleResist = useCallback(() => {
    toast({
      title: 'That was a win.',
      description: '+25 SP for waiting',
      duration: 3000,
    });
    handleClose();
  }, [handleClose]);
  
  if (!isOpen) return null;
  
  return (
    <div
      className={cn(
        'fixed inset-0 z-50',
        'bg-cathedral-dark/95 backdrop-blur-sm',
        'flex items-center justify-center',
        'animate-in fade-in duration-200',
        className
      )}
    >
      {/* Close button */}
      <button
        onClick={handleClose}
        className="absolute top-4 right-4 p-3 rounded-full bg-cathedral-deep/50 hover:bg-cathedral-deep transition-colors"
        aria-label="Close"
      >
        <X className="w-5 h-5 text-silver" />
      </button>
      
      <div className="w-full max-w-sm mx-4">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-techBlue/20 flex items-center justify-center mx-auto mb-4">
            <Coffee className="w-8 h-8 text-techBlue" />
          </div>
          <h2 className="font-display text-xl text-gold tracking-wide">
            Utility Pass
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Shield stays engaged during break
          </p>
        </div>
        
        {/* === STEP 1: Reason Selection === */}
        {step === 'reason' && (
          <ReasonPicker onSelect={handleReasonSelect} />
        )}
        
        {/* === STEP 2: Typed Intention (Level 2+ gate) === */}
        {step === 'intention' && (
          <TypedIntentionStep
            onComplete={handleIntentionComplete}
            onSkip={handleResist}
            minLength={10}
          />
        )}
        
        {/* === STEP 3: Duration Selection === */}
        {step === 'duration' && (
          <div className="space-y-6">
            <div className="text-center text-sm text-muted-foreground">
              Reason: <span className="text-gold">{reason && getReasonLabel(reason)}</span>
            </div>
            
            <DurationPicker
              selectedDuration={duration}
              onSelect={handleDurationSelect}
              planTier={progress.planTier}
            />
            
            <button
              onClick={handleProceedToCooldown}
              className="w-full py-4 rounded-xl bg-techBlue text-white font-display text-sm tracking-wider hover:bg-techBlue/90 transition-colors"
            >
              Continue
            </button>
            
            <button
              onClick={handleResist}
              className="w-full py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Actually, I don't need this
            </button>
          </div>
        )}
        
        {/* === STEP 4: Cooldown === */}
        {step === 'cooldown' && (
          <div className="flex flex-col items-center space-y-6">
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                Delay is power.
              </p>
            </div>
            
            <TimerRing
              durationSeconds={cooldownSeconds}
              onComplete={handleCooldownComplete}
              size="lg"
              showBreathing={true}
            />
            
            <button
              onClick={handleResist}
              className="w-full py-4 rounded-xl border border-gold/30 bg-gold/10 text-gold font-display text-sm tracking-wider hover:bg-gold/20 transition-colors"
            >
              Actually, I'll resist
            </button>
          </div>
        )}
        
        {/* === STEP 5: Confirm === */}
        {step === 'confirm' && (
          <div className="flex flex-col items-center space-y-6">
            <div className="text-center">
              <p className="text-gold font-display tracking-wide">
                Ready to start break
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {duration} min for {reason && getReasonLabel(reason)}
              </p>
            </div>
            
            <div className="w-full space-y-3">
              <HoldToUnlockButton
                onUnlock={handleConfirm}
                disabled={false}
              />
              
              <button
                onClick={handleResist}
                className="w-full py-4 rounded-xl border border-gold/30 bg-gold/10 text-gold font-display text-sm tracking-wider hover:bg-gold/20 transition-colors"
              >
                Actually, I'll resist
              </button>
            </div>
          </div>
        )}
        
        {/* Gate level indicator */}
        <div className="mt-8 text-center">
          <span className="text-xs text-muted-foreground">
            Gate Level {gateLevel} • Friction Gate Active
          </span>
        </div>
      </div>
    </div>
  );
}
