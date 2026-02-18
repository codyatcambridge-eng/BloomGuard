import { useMemo, useState } from 'react';
import { X, Shield } from 'lucide-react';
import {
  OnboardingAnswers,
  ShieldId,
  SHIELD_LABELS,
  DEFAULT_WINDOWS,
  suggestShieldsFromOnboarding,
} from '@/logic/shields';

interface ShieldsOnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSkip: () => void;
  onComplete: (answers: OnboardingAnswers, appIdsByShield: Partial<Record<ShieldId, string[]>>) => void;
}

type OnboardingStep = 'quiz' | 'suggestions' | 'apps';

const primaryGoalOptions: Array<{ value: OnboardingAnswers['primaryGoal']; label: string; description: string }> = [
  { value: 'sleep', label: 'Protect sleep', description: 'Keep nights calmer and consistent.' },
  { value: 'work', label: 'Protect work time', description: 'Reduce interruptions during core work blocks.' },
  { value: 'focus', label: 'Protect focus', description: 'Support distraction-free focus sessions.' },
  { value: 'ascent', label: 'Protect mornings', description: 'Keep early growth routines clear.' },
];

const hardestTimeOptions: Array<{ value: OnboardingAnswers['hardestTime']; label: string; description: string }> = [
  { value: 'late_night', label: 'Late night', description: 'Most vulnerable during evening/overnight.' },
  { value: 'daytime', label: 'Daytime', description: 'Most vulnerable during workday hours.' },
  { value: 'both', label: 'Both', description: 'Challenges happen both day and night.' },
];

export const ShieldsOnboardingModal = ({
  isOpen,
  onClose,
  onSkip,
  onComplete,
}: ShieldsOnboardingModalProps) => {
  const [step, setStep] = useState<OnboardingStep>('quiz');
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    primaryGoal: 'focus',
    hardestTime: 'daytime',
  });
  const [appInputByShield, setAppInputByShield] = useState<Partial<Record<ShieldId, string>>>({});
  const [appIdsByShield, setAppIdsByShield] = useState<Partial<Record<ShieldId, string[]>>>({});

  const suggestedShields = useMemo(() => suggestShieldsFromOnboarding(answers), [answers]);

  if (!isOpen) return null;

  const handleAddApp = (shieldId: ShieldId) => {
    const raw = (appInputByShield[shieldId] || '').trim();
    if (!raw) return;

    const current = appIdsByShield[shieldId] || [];
    if (current.includes(raw)) {
      setAppInputByShield(prev => ({ ...prev, [shieldId]: '' }));
      return;
    }

    setAppIdsByShield(prev => ({ ...prev, [shieldId]: [...current, raw] }));
    setAppInputByShield(prev => ({ ...prev, [shieldId]: '' }));
  };

  const handleRemoveApp = (shieldId: ShieldId, index: number) => {
    const current = [...(appIdsByShield[shieldId] || [])];
    current.splice(index, 1);
    setAppIdsByShield(prev => ({ ...prev, [shieldId]: current }));
  };

  const handleClose = () => {
    setStep('quiz');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-cathedral-midnight/95 backdrop-blur-sm" />

      <div className="relative w-full max-w-md border border-gold/30 bg-card p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-aqua" />
            <h2 className="font-display text-lg tracking-wider text-foreground">Set Up Shields</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2 border border-silver/20 text-silver hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 'quiz' && (
          <div className="space-y-5">
            <div>
              <p className="text-sm text-foreground mb-2">What would you like to protect first?</p>
              <div className="space-y-2">
                {primaryGoalOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setAnswers(prev => ({ ...prev, primaryGoal: option.value }))}
                    className={`w-full text-left p-3 border transition-colors ${
                      answers.primaryGoal === option.value
                        ? 'border-gold/50 bg-gold/10'
                        : 'border-silver/20 hover:border-silver/40'
                    }`}
                  >
                    <p className="text-sm font-medium text-foreground">{option.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">{option.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm text-foreground mb-2">When is it usually hardest?</p>
              <div className="space-y-2">
                {hardestTimeOptions.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setAnswers(prev => ({ ...prev, hardestTime: option.value }))}
                    className={`w-full text-left p-3 border transition-colors ${
                      answers.hardestTime === option.value
                        ? 'border-gold/50 bg-gold/10'
                        : 'border-silver/20 hover:border-silver/40'
                    }`}
                  >
                    <p className="text-sm font-medium text-foreground">{option.label}</p>
                    <p className="text-xs text-muted-foreground mt-1">{option.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={onSkip}
                className="flex-1 py-3 border border-silver/30 text-silver hover:text-foreground transition-colors text-sm font-display tracking-wide"
              >
                Skip for now
              </button>
              <button
                onClick={() => setStep('suggestions')}
                className="flex-1 py-3 bg-gold text-cathedral-midnight hover:bg-gold/90 transition-colors text-sm font-display tracking-wide"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'suggestions' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Suggested shields based on your answers. You can edit everything now or later.
            </p>

            <div className="space-y-3">
              {suggestedShields.map(shieldId => {
                const preset = DEFAULT_WINDOWS[shieldId][0];
                const daysText = preset.days.length === 7 ? 'Daily' : 'Weekdays';
                return (
                  <div key={shieldId} className="p-3 border border-gold/30 bg-gold/5">
                    <p className="text-sm font-medium text-foreground">{SHIELD_LABELS[shieldId]}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Default window: {preset.startTime} - {preset.endTime} ({daysText})
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setStep('quiz')}
                className="flex-1 py-3 border border-silver/30 text-silver hover:text-foreground transition-colors text-sm font-display tracking-wide"
              >
                Back
              </button>
              <button
                onClick={() => setStep('apps')}
                className="flex-1 py-3 bg-gold text-cathedral-midnight hover:bg-gold/90 transition-colors text-sm font-display tracking-wide"
              >
                Add apps
              </button>
            </div>
          </div>
        )}

        {step === 'apps' && (
          <div className="space-y-4">
            <p className="text-sm text-foreground">Add apps (identifier)</p>
            <p className="text-xs text-muted-foreground">You can refine later.</p>

            <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1">
              {suggestedShields.map(shieldId => (
                <div key={shieldId} className="p-3 border border-silver/20 space-y-2">
                  <p className="text-sm font-medium text-foreground">{SHIELD_LABELS[shieldId]}</p>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={appInputByShield[shieldId] || ''}
                      onChange={(e) => setAppInputByShield(prev => ({ ...prev, [shieldId]: e.target.value }))}
                      placeholder="com.example.app"
                      className="flex-1 bg-input border border-silver/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua"
                    />
                    <button
                      onClick={() => handleAddApp(shieldId)}
                      className="px-3 py-2 border border-silver/30 text-silver hover:text-foreground text-xs font-display tracking-wide"
                    >
                      Add
                    </button>
                  </div>

                  {(appIdsByShield[shieldId] || []).length > 0 && (
                    <div className="space-y-1">
                      {(appIdsByShield[shieldId] || []).map((appId, index) => (
                        <div key={`${appId}-${index}`} className="flex items-center justify-between gap-2 bg-muted/30 px-2 py-1.5">
                          <span className="text-xs text-foreground break-all">{appId}</span>
                          <button
                            onClick={() => handleRemoveApp(shieldId, index)}
                            className="text-xs text-silver hover:text-foreground transition-colors"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setStep('suggestions')}
                className="flex-1 py-3 border border-silver/30 text-silver hover:text-foreground transition-colors text-sm font-display tracking-wide"
              >
                Back
              </button>
              <button
                onClick={() => onComplete(answers, appIdsByShield)}
                className="flex-1 py-3 bg-gold text-cathedral-midnight hover:bg-gold/90 transition-colors text-sm font-display tracking-wide"
              >
                Save setup
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
