import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react';
import { ShieldConfig, ShieldId, ShieldWindow, getShieldWindowUnionForDay } from '@/logic/shields';
import { useCapacitor } from '@/hooks/useCapacitor';
import { parseScreenTimeSelectionBlob, ScreenTimeStatus } from '@/native/screenTime';

interface ShieldEditorModalProps {
  isOpen: boolean;
  shield: ShieldConfig | null;
  onClose: () => void;
  onToggleEnabled: (shieldId: ShieldId, enabled: boolean) => void;
  onSaveWindows: (shieldId: ShieldId, windows: ShieldWindow[]) => void;
  onAddApp: (shieldId: ShieldId, appId: string) => void;
  onUpdateApp: (shieldId: ShieldId, index: number, appId: string) => void;
  onRemoveApp: (shieldId: ShieldId, index: number) => void;
  onMoveApp: (shieldId: ShieldId, index: number, direction: 'up' | 'down') => void;
  onChooseScreenTimeApps: (shieldId: ShieldId, currentBlob: string | null) => void;
  screenTimeStatus: ScreenTimeStatus | null;
  isPickingScreenTimeApps: boolean;
}

const DAY_OPTIONS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

const createDefaultWindow = (id: 'A' | 'B'): ShieldWindow => ({
  id,
  startTime: '09:00',
  endTime: '17:00',
  days: [1, 2, 3, 4, 5],
});

export const ShieldEditorModal = ({
  isOpen,
  shield,
  onClose,
  onToggleEnabled,
  onSaveWindows,
  onAddApp,
  onUpdateApp,
  onRemoveApp,
  onMoveApp,
  onChooseScreenTimeApps,
  screenTimeStatus,
  isPickingScreenTimeApps,
}: ShieldEditorModalProps) => {
  const [appInput, setAppInput] = useState('');
  const { isIOS } = useCapacitor();

  const overlapDetected = useMemo(() => {
    if (!shield) return false;

    for (const day of DAY_OPTIONS.map(opt => opt.value)) {
      const union = getShieldWindowUnionForDay(shield, day);
      const rawSegments = shield.windows
        .filter(window => window.days.includes(day))
        .map(window => `${window.startTime}-${window.endTime}`);

      if (rawSegments.length > union.length && rawSegments.length > 1) {
        return true;
      }
    }

    return false;
  }, [shield]);

  if (!isOpen || !shield) return null;
  const screenTimeSelection = parseScreenTimeSelectionBlob(shield.screenTimeSelectionBlob);

  const updateWindow = (index: number, update: Partial<ShieldWindow>) => {
    const next = [...shield.windows];
    const base = next[index];
    if (!base) return;
    next[index] = { ...base, ...update };
    onSaveWindows(shield.id, next);
  };

  const toggleDay = (index: number, day: number) => {
    const window = shield.windows[index];
    if (!window) return;

    const hasDay = window.days.includes(day);
    const nextDays = hasDay
      ? window.days.filter(d => d !== day)
      : [...window.days, day].sort((a, b) => a - b);

    if (nextDays.length === 0) return;

    updateWindow(index, { days: nextDays });
  };

  const addWindowB = () => {
    if (shield.windows.length >= 2) return;
    onSaveWindows(shield.id, [...shield.windows, createDefaultWindow('B')]);
  };

  const removeWindow = (index: number) => {
    if (shield.windows.length <= 1) return;
    const next = [...shield.windows];
    next.splice(index, 1);
    if (next.length > 0) {
      next[0] = { ...next[0], id: 'A' };
    }
    if (next.length > 1) {
      next[1] = { ...next[1], id: 'B' };
    }
    onSaveWindows(shield.id, next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-cathedral-midnight/95 backdrop-blur-sm" />

      <div className="relative w-full max-w-lg border border-gold/30 bg-card p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-lg tracking-wider text-foreground">{shield.label}</h3>
            <p className="text-xs text-muted-foreground mt-1">Edit schedule and app identifiers</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 border border-silver/20 text-silver hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5">
          <section className="border border-silver/20 p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-foreground">Enabled</p>
              <button
                onClick={() => onToggleEnabled(shield.id, !shield.enabled)}
                className={`w-12 h-7 rounded-full transition-all ${shield.enabled ? 'bg-aqua' : 'bg-secondary'}`}
              >
                <div className={`w-5 h-5 rounded-full bg-foreground transition-transform ${shield.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </section>

          <section className="border border-silver/20 p-3 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-foreground">Schedule windows</p>
              {shield.windows.length < 2 && (
                <button
                  onClick={addWindowB}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-silver/30 text-silver hover:text-foreground transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Add Window B
                </button>
              )}
            </div>

            {shield.windows.map((window, index) => (
              <div key={`${window.id}-${index}`} className="border border-silver/20 p-3 space-y-3 bg-muted/10">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-display tracking-wider text-muted-foreground">Window {window.id}</p>
                  {shield.windows.length > 1 && (
                    <button
                      onClick={() => removeWindow(index)}
                      className="inline-flex items-center gap-1 text-xs text-silver hover:text-foreground transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-muted-foreground">
                    Start
                    <input
                      type="time"
                      value={window.startTime}
                      onChange={(e) => updateWindow(index, { startTime: e.target.value })}
                      className="mt-1 w-full bg-input border border-silver/30 px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-aqua"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    End
                    <input
                      type="time"
                      value={window.endTime}
                      onChange={(e) => updateWindow(index, { endTime: e.target.value })}
                      className="mt-1 w-full bg-input border border-silver/30 px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-aqua"
                    />
                  </label>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-2">Days</p>
                  <div className="grid grid-cols-7 gap-1">
                    {DAY_OPTIONS.map(day => {
                      const selected = window.days.includes(day.value);
                      return (
                        <button
                          key={`${window.id}-${day.value}`}
                          onClick={() => toggleDay(index, day.value)}
                          className={`py-1 text-[11px] border transition-colors ${selected ? 'border-gold/50 bg-gold/10 text-gold' : 'border-silver/20 text-silver hover:text-foreground'}`}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}

            {overlapDetected && (
              <p className="text-xs text-muted-foreground">Overlaps detected - treated as one window during evaluation.</p>
            )}
          </section>

          <section className="border border-silver/20 p-3 space-y-3">
            <p className="text-sm text-foreground">Protected apps</p>
            <p className="text-xs text-muted-foreground">Add apps (identifier). You can refine later.</p>

            <div className="flex gap-2">
              <input
                type="text"
                value={appInput}
                onChange={(e) => setAppInput(e.target.value)}
                placeholder="com.example.app"
                className="flex-1 bg-input border border-silver/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua"
              />
              <button
                onClick={() => {
                  onAddApp(shield.id, appInput);
                  setAppInput('');
                }}
                className="px-3 py-2 border border-silver/30 text-xs text-silver hover:text-foreground transition-colors"
              >
                Add
              </button>
            </div>

            {shield.protectedAppIds.length === 0 ? (
              <p className="text-xs text-muted-foreground">No app identifiers added yet.</p>
            ) : (
              <div className="space-y-2">
                {shield.protectedAppIds.map((appId, index) => (
                  <div key={`${shield.id}-app-${index}`} className="border border-silver/20 p-2 space-y-2">
                    <input
                      type="text"
                      value={appId}
                      onChange={(e) => onUpdateApp(shield.id, index, e.target.value)}
                      className="w-full bg-input border border-silver/30 px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-aqua"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => onMoveApp(shield.id, index, 'up')}
                        disabled={index === 0}
                        className="p-1 border border-silver/20 text-silver hover:text-foreground disabled:opacity-30"
                        aria-label="Move up"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => onMoveApp(shield.id, index, 'down')}
                        disabled={index === shield.protectedAppIds.length - 1}
                        className="p-1 border border-silver/20 text-silver hover:text-foreground disabled:opacity-30"
                        aria-label="Move down"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => onRemoveApp(shield.id, index)}
                        className="px-2 py-1 border border-silver/20 text-xs text-silver hover:text-foreground"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="border border-silver/20 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Choose Apps (Screen Time)</p>
                <p className="text-xs text-muted-foreground">iOS only selection for Screen Time enforcement.</p>
              </div>
              <button
                onClick={() => onChooseScreenTimeApps(shield.id, shield.screenTimeSelectionBlob)}
                disabled={
                  !isIOS ||
                  isPickingScreenTimeApps ||
                  !screenTimeStatus?.supported ||
                  !screenTimeStatus?.authorized
                }
                className="px-3 h-9 text-xs rounded border border-silver/30 text-silver transition-colors hover:text-foreground hover:border-foreground disabled:opacity-40"
              >
                {isPickingScreenTimeApps ? 'Opening…' : 'Choose Apps'}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {screenTimeSelection?.label || 'No Screen Time selection yet.'}
            </p>
            {!isIOS && (
              <p className="text-xs text-destructive">Screen Time locking works only on iOS.</p>
            )}
            {screenTimeStatus && !screenTimeStatus.supported && (
              <p className="text-xs text-destructive">Screen Time is not supported on this device.</p>
            )}
            {screenTimeStatus && screenTimeStatus.supported && !screenTimeStatus.authorized && (
              <p className="text-xs text-muted-foreground">Screen Time authorization is required.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
