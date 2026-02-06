/**
 * Recovery Modal
 * 
 * Full recovery flow after trigger attempts.
 * Optional - never forced. No shame language.
 */

import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { X, Heart, Sparkles } from 'lucide-react';
import { TimerRing } from '@/components/gate/TimerRing';
import { EmotionPicker } from './EmotionPicker';
import { NextMovePicker } from './NextMovePicker';
import { 
  applyRecovery, 
  getRecoveryCopy, 
  isSlip,
  type RecoveryNextMove,
} from '@/logic/recovery';
import { EmotionTag, TriggerOutcome } from '@/models/TriggerEvent';
import { UserProgress } from '@/models/UserProgress';
import { toast } from '@/hooks/use-toast';

type RecoveryStep = 
  | 'breathe'     // 30s reset timer
  | 'emotion'     // Select emotion
  | 'nextMove'    // Select next action
  | 'complete';   // Show confirmation

interface RecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  triggerEventId: string;
  triggerOutcome: TriggerOutcome;
  progress: UserProgress;
  onProgressUpdate: (progress: UserProgress, pointsDelta: number) => void;
  onAutoTighten?: (until: number) => void;
  className?: string;
}

export function RecoveryModal({
  isOpen,
  onClose,
  triggerEventId,
  triggerOutcome,
  progress,
  onProgressUpdate,
  onAutoTighten,
  className,
}: RecoveryModalProps) {
  const [step, setStep] = useState<RecoveryStep>('breathe');
  const [selectedEmotion, setSelectedEmotion] = useState<EmotionTag>(null);
  const [selectedNextMove, setSelectedNextMove] = useState<RecoveryNextMove>('NONE');
  const [totalPoints, setTotalPoints] = useState(0);

  const copy = getRecoveryCopy(triggerOutcome);
  const wasSlip = isSlip(triggerOutcome);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('breathe');
      setSelectedEmotion(null);
      setSelectedNextMove('NONE');
      setTotalPoints(0);
    }
  }, [isOpen]);

  // Handle breathe complete
  const handleBreatheComplete = useCallback(() => {
    setStep('emotion');
  }, []);

  // Handle emotion selected
  const handleEmotionSelect = useCallback((emotion: EmotionTag) => {
    setSelectedEmotion(emotion);
    setStep('nextMove');
  }, []);

  // Handle next move selected (or skipped)
  const handleNextMoveSelect = useCallback((move: RecoveryNextMove) => {
    setSelectedNextMove(move);
    
    // Apply recovery and award points
    const result = applyRecovery(progress, {
      triggerEventId,
      triggerOutcome,
      emotion: selectedEmotion,
      nextMove: move,
      ts: Date.now(),
    });

    setTotalPoints(result.pointsDelta);
    onProgressUpdate(result.progress, result.pointsDelta);

    // Handle auto-tighten for slips
    if (result.autoTightenUntil && onAutoTighten) {
      onAutoTighten(result.autoTightenUntil);
    }

    setStep('complete');

    // Show toast
    toast({
      title: `+${result.pointsDelta} SP`,
      description: result.perfectSaveAwarded 
        ? 'Perfect save! Recovery complete.' 
        : 'Recovery complete.',
      duration: 3000,
    });
  }, [progress, triggerEventId, triggerOutcome, selectedEmotion, onProgressUpdate, onAutoTighten]);

  // Skip to end without next move
  const handleSkipNextMove = useCallback(() => {
    handleNextMoveSelect('NONE');
  }, [handleNextMoveSelect]);

  // Skip entire recovery
  const handleSkipRecovery = useCallback(() => {
    onClose();
  }, [onClose]);

  // Complete and close
  const handleComplete = useCallback(() => {
    setTimeout(onClose, 300);
  }, [onClose]);

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
      {/* Skip button */}
      {step !== 'complete' && (
        <button
          onClick={handleSkipRecovery}
          className="absolute top-4 right-4 p-3 rounded-full bg-cathedral-deep/50 hover:bg-cathedral-deep transition-colors"
          aria-label="Skip recovery"
        >
          <X className="w-5 h-5 text-silver" />
        </button>
      )}

      {/* Main content */}
      <div className="w-full max-w-sm mx-4">
        
        {/* === BREATHE STEP === */}
        {step === 'breathe' && (
          <div className="flex flex-col items-center space-y-8">
            <div className="text-center">
              <h2 className="font-display text-xl text-gold tracking-wide">
                {copy.title}
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                {copy.subtitle}
              </p>
            </div>

            <TimerRing
              durationSeconds={30}
              onComplete={handleBreatheComplete}
              size="lg"
              showBreathing={true}
            />

            <p className="text-xs text-muted-foreground text-center">
              Take this moment to reset
            </p>

            <button
              onClick={() => setStep('emotion')}
              className="text-sm text-silver hover:text-foreground transition-colors"
            >
              Skip timer
            </button>
          </div>
        )}

        {/* === EMOTION STEP === */}
        {step === 'emotion' && (
          <EmotionPicker
            onSelect={handleEmotionSelect}
            onSkip={() => {
              setSelectedEmotion(null);
              setStep('nextMove');
            }}
          />
        )}

        {/* === NEXT MOVE STEP === */}
        {step === 'nextMove' && (
          <NextMovePicker
            onSelect={handleNextMoveSelect}
            onSkip={handleSkipNextMove}
          />
        )}

        {/* === COMPLETE STEP === */}
        {step === 'complete' && (
          <div className="flex flex-col items-center space-y-6 animate-in zoom-in duration-300">
            <div className="w-20 h-20 rounded-full bg-gold/20 flex items-center justify-center">
              <Sparkles className="w-10 h-10 text-gold animate-pulse" />
            </div>
            
            <div className="text-center">
              <h2 className="font-display text-2xl text-gold tracking-wide">
                {copy.completionMessage}
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                +{totalPoints} SP earned
              </p>
              {wasSlip && (
                <p className="text-xs text-techBlue mt-3">
                  No shame. Every recovery builds strength.
                </p>
              )}
            </div>

            <button
              onClick={handleComplete}
              className="w-full py-4 rounded-xl border border-gold/50 bg-gold/20 text-gold font-display text-sm tracking-wider hover:bg-gold/30 transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* Recovery indicator */}
        <div className="mt-8 flex justify-center gap-2">
          {['breathe', 'emotion', 'nextMove', 'complete'].map((s, i) => (
            <div
              key={s}
              className={cn(
                'w-2 h-2 rounded-full transition-colors',
                step === s 
                  ? 'bg-gold' 
                  : i < ['breathe', 'emotion', 'nextMove', 'complete'].indexOf(step)
                    ? 'bg-gold/50'
                    : 'bg-silver/30'
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
