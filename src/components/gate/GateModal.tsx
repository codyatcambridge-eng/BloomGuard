/**
 * Gate Modal
 * 
 * Main friction gate UI orchestrating all levels.
 * Wires to progressEngine for outcomes.
 */

import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { X, ArrowLeft, Heart, Coffee } from 'lucide-react';
import { TimerRing } from './TimerRing';
import { HoldToUnlockButton } from './HoldToUnlockButton';
import { ReplacementPicker, type ReplacementOption } from './ReplacementPicker';
import { TypedIntentionStep } from './TypedIntentionStep';
import { 
  getGateState, 
  getGateCopy, 
  getLevel3WaitTime,
  incrementAttempts,
  isWithinRepeatWindow,
  type GateLevel,
} from '@/logic/gateEngine';
import { 
  applyTriggerOutcome, 
  applyGrowthAction,
  type GrowthActionType,
} from '@/logic/progressEngine';
import { UserProgress } from '@/models/UserProgress';
import { toast } from '@/hooks/use-toast';

type GateStep = 
  | 'intention'      // Level 2+: type intention
  | 'replacement'    // Level 3+: pick replacement OR wait
  | 'cooldown'       // All levels: countdown timer
  | 'unlock'         // After cooldown: hold to unlock
  | 'resisted'       // User chose to resist
  | 'unlocked';      // User completed unlock

interface GateModalProps {
  isOpen: boolean;
  onClose: () => void;
  progress: UserProgress;
  highRiskFlag: boolean;
  onProgressUpdate: (progress: UserProgress, pointsDelta: number) => void;
  onUtilityPassRequest?: () => void; // Optional callback to open utility pass modal
  className?: string;
}

export function GateModal({
  isOpen,
  onClose,
  progress,
  highRiskFlag,
  onProgressUpdate,
  onUtilityPassRequest,
  className,
}: GateModalProps) {
  const nowTs = Date.now();
  const gateState = getGateState(progress, nowTs, highRiskFlag);
  const gateCopy = getGateCopy(gateState.level);

  // Determine initial step based on level
  const getInitialStep = useCallback((): GateStep => {
    if (gateState.level >= 2) return 'intention';
    return 'cooldown';
  }, [gateState.level]);

  const [step, setStep] = useState<GateStep>(() => getInitialStep());
  const [intention, setIntention] = useState<string>('');
  const [cooldownComplete, setCooldownComplete] = useState(false);
  const [selectedReplacement, setSelectedReplacement] = useState<ReplacementOption | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(getInitialStep());
      setIntention('');
      setCooldownComplete(false);
      setSelectedReplacement(null);
    }
  }, [isOpen, getInitialStep]);

  // Get cooldown duration
  const getCooldownDuration = (): number => {
    if (gateState.level >= 3 && step === 'replacement') {
      return getLevel3WaitTime();
    }
    return gateState.cooldownSeconds;
  };

  // Handle resist (user backs out)
  const handleResist = useCallback(async () => {
    setStep('resisted');
    
    // Check for repeat bonus
    const isRepeat = isWithinRepeatWindow(nowTs, progress.lastTriggerAt);
    
    const result = await applyTriggerOutcome(progress, {
      gateLevel: gateState.level,
      outcome: 'RESISTED',
      highRiskUnlockedFlag: false,
      ts: nowTs,
      platform: undefined,
    });

    // Update attempts
    const newAttempts = incrementAttempts(nowTs, progress.lastTriggerAt, progress.recentAttemptCount);
    result.progress.recentAttemptCount = newAttempts;
    result.progress.lastTriggerAt = nowTs;

    onProgressUpdate(result.progress, result.pointsDelta);
    
    toast({
      title: gateCopy.resistMessage,
      description: `+${result.pointsDelta} SP${isRepeat ? ' (repeat bonus!)' : ''}`,
      duration: 3000,
    });

    // Close after short delay
    setTimeout(onClose, 1500);
  }, [progress, gateState.level, nowTs, gateCopy.resistMessage, onProgressUpdate, onClose]);

  // Handle intention complete
  const handleIntentionComplete = useCallback((text: string) => {
    setIntention(text);
    
    if (gateState.level >= 3) {
      setStep('replacement');
    } else {
      setStep('cooldown');
    }
  }, [gateState.level]);

  // Handle replacement selected
  const handleReplacementSelect = useCallback(async (option: ReplacementOption) => {
    setSelectedReplacement(option);
    
    // Award +30 for choosing replacement
    const result = await applyTriggerOutcome(progress, {
      gateLevel: gateState.level,
      outcome: 'RESISTED', // Choosing replacement counts as resisting
      highRiskUnlockedFlag: false,
      ts: nowTs,
      platform: undefined,
    });

    // If it's a growth action, also award those points
    if (option.actionType !== 'WALK') {
      const growthResult = await applyGrowthAction(result.progress, {
        type: option.actionType as GrowthActionType,
        ts: nowTs,
      });
      
      onProgressUpdate(growthResult.progress, result.pointsDelta + growthResult.pointsDelta);
      
      toast({
        title: 'Excellent redirect!',
        description: `+${result.pointsDelta + growthResult.pointsDelta} SP for choosing strength`,
        duration: 3000,
      });
    } else {
      onProgressUpdate(result.progress, result.pointsDelta);
      
      toast({
        title: 'Great choice!',
        description: `+${result.pointsDelta} SP for redirecting your energy`,
        duration: 3000,
      });
    }

    setStep('resisted');
    setTimeout(onClose, 1500);
  }, [progress, gateState.level, nowTs, onProgressUpdate, onClose]);

  // Handle cooldown complete
  const handleCooldownComplete = useCallback(() => {
    setCooldownComplete(true);
    setStep('unlock');
    
    // Award +25 for waiting full cooldown (only if they proceed to unlock step)
    toast({
      title: 'Patience is power.',
      description: '+25 SP for waiting',
      duration: 2000,
    });
  }, []);

  // Handle unlock
  const handleUnlock = useCallback(async () => {
    setStep('unlocked');
    
    const result = await applyTriggerOutcome(progress, {
      gateLevel: gateState.level,
      outcome: 'UNLOCKED',
      highRiskUnlockedFlag: gateState.isHighRisk,
      ts: nowTs,
      platform: undefined,
    });

    // Update attempts
    const newAttempts = incrementAttempts(nowTs, progress.lastTriggerAt, progress.recentAttemptCount);
    result.progress.recentAttemptCount = newAttempts;
    result.progress.lastTriggerAt = nowTs;

    onProgressUpdate(result.progress, result.pointsDelta);
    
    if (gateState.isHighRisk) {
      toast({
        title: 'Shield engaged.',
        description: `Degraded mode active for ${progress.settings.highRiskDegradedMinutes}m`,
        duration: 4000,
      });
    }

    setTimeout(onClose, 1000);
  }, [progress, gateState, nowTs, onProgressUpdate, onClose]);

  // Don't render if not open
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
      {/* Close / Resist button */}
      {step !== 'resisted' && step !== 'unlocked' && (
        <button
          onClick={handleResist}
          className="absolute top-4 right-4 p-3 rounded-full bg-cathedral-deep/50 hover:bg-cathedral-deep transition-colors"
          aria-label="Close and resist"
        >
          <X className="w-5 h-5 text-silver" />
        </button>
      )}

      {/* Main content */}
      <div className="w-full max-w-sm mx-4">
        
        {/* === INTENTION STEP (Level 2+) === */}
        {step === 'intention' && (
          <TypedIntentionStep
            onComplete={handleIntentionComplete}
            onSkip={handleResist}
            minLength={10}
          />
        )}

        {/* === REPLACEMENT STEP (Level 3+) === */}
        {step === 'replacement' && (
          <ReplacementPicker
            onSelect={handleReplacementSelect}
            onCancel={() => setStep('cooldown')}
          />
        )}

        {/* === COOLDOWN STEP === */}
        {step === 'cooldown' && (
          <div className="flex flex-col items-center space-y-8">
            <div className="text-center">
              <h2 className="font-display text-xl text-gold tracking-wide">
                The Clearing
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                {gateCopy.subtitle}
              </p>
            </div>

            <TimerRing
              durationSeconds={getCooldownDuration()}
              onComplete={handleCooldownComplete}
              size="lg"
              showBreathing={true}
            />

            <div className="w-full space-y-3">
              <HoldToUnlockButton
                onUnlock={handleUnlock}
                disabled={!cooldownComplete}
              />
              
              <button
                onClick={handleResist}
                className="w-full py-4 rounded-xl border border-gold/30 bg-gold/10 text-gold font-display text-sm tracking-wider hover:bg-gold/20 transition-colors"
              >
                Choose a replacement
              </button>
              
              {/* Utility Pass option */}
              {onUtilityPassRequest && (
                <button
                  onClick={() => {
                    onClose();
                    onUtilityPassRequest();
                  }}
                  className="w-full py-3 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-techBlue transition-colors"
                >
                  <Coffee className="w-4 h-4" />
                  <span>Utility Pass (work/school)</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* === UNLOCK STEP === */}
        {step === 'unlock' && (
          <div className="flex flex-col items-center space-y-8">
            <div className="text-center">
              <h2 className="font-display text-xl text-gold tracking-wide">
                Ready to unlock
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                You waited. Now decide wisely.
              </p>
            </div>

            <div className="w-24 h-24 rounded-full bg-gold/20 flex items-center justify-center">
              <Heart className="w-10 h-10 text-gold" />
            </div>

            <div className="w-full space-y-3">
              <HoldToUnlockButton
                onUnlock={handleUnlock}
                disabled={false}
              />
              
              <button
                onClick={handleResist}
                className="w-full py-4 rounded-xl border border-gold/30 bg-gold/10 text-gold font-display text-sm tracking-wider hover:bg-gold/20 transition-colors"
              >
                I Chose Peace
              </button>
            </div>
          </div>
        )}

        {/* === RESISTED OUTCOME === */}
        {step === 'resisted' && (
          <div className="flex flex-col items-center space-y-6 animate-in zoom-in duration-300">
            <div className="w-20 h-20 rounded-full bg-gold/20 flex items-center justify-center">
              <Heart className="w-10 h-10 text-gold animate-pulse" />
            </div>
            <div className="text-center">
              <h2 className="font-display text-2xl text-gold tracking-wide">
                {gateCopy.resistMessage}
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                Your strength is growing.
              </p>
            </div>
          </div>
        )}

        {/* === UNLOCKED OUTCOME === */}
        {step === 'unlocked' && (
          <div className="flex flex-col items-center space-y-6 animate-in zoom-in duration-300">
            <div className="text-center">
              <h2 className="font-display text-xl text-foreground tracking-wide">
                {gateState.isHighRisk ? 'Shield engaged.' : 'Unlocked'}
              </h2>
              {gateState.isHighRisk && (
                <p className="text-sm text-techBlue mt-2">
                  Degraded mode: {progress.settings.highRiskDegradedMinutes}m
                </p>
              )}
            </div>
          </div>
        )}

        {/* Level indicator */}
        <div className="mt-8 text-center">
          <span className="text-xs text-muted-foreground">
            Gate Level {gateState.level}
          </span>
        </div>
      </div>
    </div>
  );
}
