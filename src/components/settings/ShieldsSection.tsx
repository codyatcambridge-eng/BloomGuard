import { useCallback, useEffect, useMemo, useState } from 'react';
import { Shield } from 'lucide-react';
import { useLocalShields } from '@/hooks/useLocalShields';
import { ShieldsOnboardingModal } from '@/components/settings/ShieldsOnboardingModal';
import { ShieldEditorModal } from '@/components/settings/ShieldEditorModal';
import { SHIELD_STRICTNESS_PRECEDENCE, ShieldId } from '@/logic/shields';
import { toast } from 'sonner';
import { ScreenTime as screenTime, type ScreenTimeStatus } from '@/native/screenTime';

const formatDays = (days: number[]): string => {
  if (days.length === 7) return 'Daily';
  const weekdays = [1, 2, 3, 4, 5];
  if (days.length === weekdays.length && weekdays.every(day => days.includes(day))) return 'Weekdays';
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days.slice().sort((a, b) => a - b).map(day => labels[day] || '').join(', ');
};

const getWindowSummary = (shieldId: ShieldId, windows: Array<{ startTime: string; endTime: string; days: number[] }>): string => {
  if (!windows || windows.length === 0) return 'No windows';
  const summaries = windows.map(window => `${window.startTime}-${window.endTime} (${formatDays(window.days)})`);
  if (shieldId === 'sleep') return summaries.join(' • ');
  return summaries.join(' • ');
};

export const ShieldsSection = () => {
  const {
    state,
    isLoaded,
    hasPersistedState,
    dismissOnboardingCta,
    applyOnboarding,
    setShieldEnabled,
    updateShieldWindows,
    addProtectedAppId,
    updateProtectedAppId,
    removeProtectedAppId,
    moveProtectedAppId,
    setShieldScreenTimeSelectionBlob,
  } = useLocalShields();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [editingShieldId, setEditingShieldId] = useState<ShieldId | null>(null);
  const [screenTimeStatusState, setScreenTimeStatusState] = useState<ScreenTimeStatus | null>(null);
  const [isPickingScreenTimeApps, setIsPickingScreenTimeApps] = useState(false);

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
  const editingShield = editingShieldId ? state.shields[editingShieldId] : null;
  const refreshScreenTimeStatus = useCallback(async () => {
    try {
      const status = await screenTime.getScreenTimeStatus();
      setScreenTimeStatusState(status);
    } catch (error) {
      console.error('Failed to get Screen Time status', error);
      setScreenTimeStatusState({ supported: false, authorized: false, reason: 'status_error' });
    }
  }, []);

  useEffect(() => {
    refreshScreenTimeStatus();
  }, [refreshScreenTimeStatus]);

  useEffect(() => {
    if (editingShieldId) {
      refreshScreenTimeStatus();
    }
  }, [editingShieldId, refreshScreenTimeStatus]);

  const handleChooseScreenTimeApps = useCallback(async (shieldId: ShieldId, currentBlob: string | null) => {
    if (!screenTimeStatusState?.supported || !screenTimeStatusState.authorized) return;
    setIsPickingScreenTimeApps(true);
    try {
      const result = await screenTime.presentFamilyActivityPicker({
        shieldId,
        blob: currentBlob,
      });
      if (result?.blob) {
        setShieldScreenTimeSelectionBlob(shieldId, result.blob);
      }
    } catch (error) {
      console.error('Screen Time picker canceled or failed', error);
    } finally {
      setIsPickingScreenTimeApps(false);
    }
  }, [screenTimeStatusState, setShieldScreenTimeSelectionBlob]);

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

      <div className="mt-4 space-y-3">
        {SHIELD_STRICTNESS_PRECEDENCE.map(shieldId => {
          const shield = state.shields[shieldId];
          return (
            <div key={shieldId} className="border border-silver/20 p-3 bg-muted/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-foreground">{shield.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{getWindowSummary(shieldId, shield.windows)}</p>
                  <p className="text-xs text-muted-foreground mt-1">Apps: {shield.protectedAppIds.length}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShieldEnabled(shieldId, !shield.enabled)}
                    className={`w-12 h-7 rounded-full transition-all ${shield.enabled ? 'bg-aqua' : 'bg-secondary'}`}
                    aria-label={`Toggle ${shield.label}`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-foreground transition-transform ${shield.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                  <button
                    onClick={() => setEditingShieldId(shieldId)}
                    className="px-2.5 py-1.5 border border-silver/30 text-xs text-silver hover:text-foreground transition-colors"
                  >
                    Edit
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

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

      <ShieldEditorModal
        isOpen={editingShieldId !== null}
        shield={editingShield}
        onClose={() => setEditingShieldId(null)}
        screenTimeStatus={screenTimeStatusState}
        onChooseScreenTimeApps={handleChooseScreenTimeApps}
        isPickingScreenTimeApps={isPickingScreenTimeApps}
        onToggleEnabled={setShieldEnabled}
        onSaveWindows={updateShieldWindows}
        onAddApp={addProtectedAppId}
        onUpdateApp={updateProtectedAppId}
        onRemoveApp={removeProtectedAppId}
        onMoveApp={moveProtectedAppId}
      />
    </section>
  );
};
