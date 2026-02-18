import { useEffect, useMemo, useState } from 'react';
import { Shield } from 'lucide-react';
import { useLocalShields } from '@/hooks/useLocalShields';
import { ShieldsOnboardingModal } from '@/components/settings/ShieldsOnboardingModal';
import { SHIELD_STRICTNESS_PRECEDENCE } from '@/logic/shields';
import { toast } from 'sonner';

export const ShieldsSection = () => {
  const {
    state,
    isLoaded,
    hasPersistedState,
    dismissOnboardingCta,
    applyOnboarding,
  } = useLocalShields();
  const [showOnboarding, setShowOnboarding] = useState(false);

  const shouldAutoOpenOnboarding = isLoaded && !hasPersistedState;

  useEffect(() => {
    if (shouldAutoOpenOnboarding) {
      setShowOnboarding(true);
    }
  }, [shouldAutoOpenOnboarding]);

  const allShieldsDisabled = useMemo(() => {
    return SHIELD_STRICTNESS_PRECEDENCE.every(shieldId => !state.shields[shieldId].enabled);
  }, [state.shields]);

  const showOneTimeCta = isLoaded && hasPersistedState && !state.onboardingDismissed;

  return (
    <section className="cathedral-card">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-sm bg-secondary flex items-center justify-center">
            <Shield className="w-5 h-5 text-gold" />
          </div>
          <div>
            <h3 className="font-display text-sm tracking-wider">SHIELDS</h3>
            <p className="text-xs text-muted-foreground">Set schedule defaults and app identifiers</p>
          </div>
        </div>
        <button
          onClick={() => setShowOnboarding(true)}
          className="px-3 py-2 border border-silver/30 text-xs text-silver hover:text-foreground transition-colors font-display tracking-wide"
        >
          Set up
        </button>
      </div>

      {showOneTimeCta && (
        <div className="mt-4 p-3 border border-gold/30 bg-gold/5">
          <p className="text-sm text-foreground">Set up Shields</p>
          <p className="text-xs text-muted-foreground mt-1">A quick setup can prefill defaults. Skippable anytime.</p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => setShowOnboarding(true)}
              className="px-3 py-2 bg-gold text-cathedral-midnight text-xs font-display tracking-wide"
            >
              Start
            </button>
            <button
              onClick={dismissOnboardingCta}
              className="px-3 py-2 border border-silver/30 text-xs text-silver hover:text-foreground transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {isLoaded && hasPersistedState && allShieldsDisabled && (
        <div className="mt-4 p-3 border border-silver/20 bg-muted/20">
          <p className="text-sm text-foreground">All shields are currently off.</p>
          <p className="text-xs text-muted-foreground mt-1">Set up Shields to add schedules and app identifiers.</p>
          <button
            onClick={() => setShowOnboarding(true)}
            className="mt-2 px-3 py-2 border border-silver/30 text-xs text-silver hover:text-foreground transition-colors"
          >
            Set up Shields
          </button>
        </div>
      )}

      <ShieldsOnboardingModal
        isOpen={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onSkip={() => {
          dismissOnboardingCta();
          setShowOnboarding(false);
        }}
        onComplete={(answers, appIdsByShield) => {
          applyOnboarding(answers, appIdsByShield);
          setShowOnboarding(false);
          toast.success('Shields setup saved');
        }}
      />
    </section>
  );
};
