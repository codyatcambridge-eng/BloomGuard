import { Shield, Music, MessageCircle, BellRing, Car } from 'lucide-react';
import { SafeDriverMode } from '@/lib/safeDriverState';
import { Switch } from '@/components/ui/switch';
import { PrimaryButton } from '@/components/ui/PrimaryButton';

interface SafeDriverCardProps {
  mode: SafeDriverMode;
  countdownRemainingMs: number | null;
  screenTimeMessage: string | null;
  onStart: () => void;
  onCancel: () => void;
  onOpenMusic: () => void;
  onSendCheckin: () => void;
  onRememberCar: () => void;
  onDismissCar: () => void;
  carName?: string;
  hasUnapprovedCar?: boolean;
  showCheckinCopy?: boolean;
  safeDriverEnabled?: boolean;
  autoStartOnApprovedCar?: boolean;
  onToggleSafeDriver?: (enabled: boolean) => void;
  onToggleAutoStart?: (enabled: boolean) => void;
  bluetoothIdentifiersText?: string;
  bluetoothServiceUUIDsText?: string;
  bluetoothRssiThreshold?: number | null;
  onUpdateBluetoothIdentifiers?: (value: string) => void;
  onUpdateBluetoothServiceUUIDs?: (value: string) => void;
  onUpdateBluetoothRssiThreshold?: (value: string | number) => void;
  registeringAccessory?: boolean;
  onRegisterAccessory?: () => void;
  showSettingsControls?: boolean;
}

const formatCountdown = (ms: number | null) => {
  if (!ms) return 'Starting soon';
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const SafeDriverCard = ({
  mode,
  countdownRemainingMs,
  screenTimeMessage,
  onStart,
  onCancel,
  onOpenMusic,
  onSendCheckin,
  onRememberCar,
  onDismissCar,
  carName,
  hasUnapprovedCar,
  showCheckinCopy = false,
  safeDriverEnabled = true,
      autoStartOnApprovedCar = false,
      onToggleSafeDriver,
      onToggleAutoStart,
      bluetoothIdentifiersText,
      bluetoothServiceUUIDsText,
      bluetoothRssiThreshold,
      onUpdateBluetoothIdentifiers,
      onUpdateBluetoothServiceUUIDs,
      onUpdateBluetoothRssiThreshold,
      registeringAccessory = false,
      onRegisterAccessory,
      showSettingsControls = false,
}: SafeDriverCardProps) => {
  const heading = showCheckinCopy
    ? 'Heading out tonight?'
    : mode === 'COUNTDOWN'
      ? 'Safe Driver will start soon'
      : 'Safe Driver Mode';

  const subheading = showCheckinCopy
    ? 'Optional. Private. Takes 2 seconds.'
    : mode === 'COUNTDOWN'
      ? `Starts in ${formatCountdown(countdownRemainingMs)} — want to text someone first?`
      : 'Keep distractions off when you drive.';

  const showBluetoothConfig =
    showSettingsControls &&
    onUpdateBluetoothIdentifiers &&
    onUpdateBluetoothServiceUUIDs &&
    onUpdateBluetoothRssiThreshold;

  const buttonLabel = screenTimeMessage
    ? 'Start (no lock)'
    : mode === 'COUNTDOWN'
      ? 'Countdown running'
      : mode === 'ACTIVE'
        ? 'Safe Driver active'
        : 'Start Safe Driver';

  const countdownActive = mode === 'COUNTDOWN';
  const startDisabled = countdownActive || mode === 'ACTIVE' || !safeDriverEnabled;

  return (
    <section className="cathedral-card">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-sm bg-secondary flex items-center justify-center">
          <Shield className="w-5 h-5 text-gold" />
        </div>
        <div>
          <p className="font-display text-sm tracking-wider">{heading}</p>
          <p className="text-xs text-muted-foreground">{subheading}</p>
        </div>
      </div>
      {showSettingsControls && (
        <div className="space-y-2 mb-3 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-display text-[10px] tracking-wider">Safe Driver</p>
              <p className="text-[10px] text-muted-foreground/80">Manual + auto start</p>
            </div>
            <Switch
              checked={safeDriverEnabled}
              onCheckedChange={(value) => onToggleSafeDriver?.(value)}
              aria-label="Enable Safe Driver"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-display text-[10px] tracking-wider">Auto-start on approved car</p>
              <p className="text-[10px] text-muted-foreground/80">Requires Safe Driver enabled</p>
            </div>
            <Switch
              checked={autoStartOnApprovedCar}
              onCheckedChange={(value) => onToggleAutoStart?.(value)}
              disabled={!safeDriverEnabled}
              aria-label="Auto-start on approved car"
            />
          </div>
          {showBluetoothConfig && (
            <div className="space-y-2 text-[10px] border-t border-border pt-3 text-muted-foreground">
              <p className="font-display tracking-wider">Bluetooth car detection (optional)</p>
              <label className="block">Approved device identifiers (one per line)</label>
              <textarea
                rows={3}
                className="w-full rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground"
                value={bluetoothIdentifiersText ?? ''}
                onChange={(event) => onUpdateBluetoothIdentifiers?.(event.currentTarget.value)}
                placeholder="12345678-1234-1234-1234-123456789ABC"
              />
              <label className="block">Service UUIDs (optional, one per line)</label>
              <textarea
                rows={2}
                className="w-full rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground"
                value={bluetoothServiceUUIDsText ?? ''}
                onChange={(event) => onUpdateBluetoothServiceUUIDs?.(event.currentTarget.value)}
                placeholder="0000180d-0000-1000-8000-00805f9b34fb"
              />
              <div className="flex items-center gap-2">
                <label className="w-full">RSSI threshold</label>
                <input
                  type="number"
                  min={-90}
                  max={-40}
                  step={1}
                  className="w-32 rounded-sm border border-border bg-background px-2 py-1 text-xs text-foreground"
                  value={bluetoothRssiThreshold ?? ''}
                  onChange={(event) => onUpdateBluetoothRssiThreshold?.(event.currentTarget.value)}
                  placeholder="-70"
                />
              </div>
              <p className="text-[9px] text-muted-foreground/80">
                Leave blank to use the default -70 dBm threshold. Higher (closer to 0) values require a stronger signal.
              </p>
              {onRegisterAccessory && (
                <button
                  type="button"
                  onClick={onRegisterAccessory}
                  disabled={registeringAccessory}
                  className="w-full rounded-sm border border-border bg-primary px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-background transition hover:border-silver/50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {registeringAccessory ? 'Registering car…' : 'Register car'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {screenTimeMessage && (
        <div className="flex items-center gap-2 mb-3 text-xs text-red-400">
          <BellRing className="w-4 h-4" />
          <span>{screenTimeMessage}</span>
        </div>
      )}
      {hasUnapprovedCar && carName && (
        <div className="mb-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Car className="w-4 h-4" />
            <span>New car detected: {carName}</span>
          </div>
          <div className="mt-2 flex gap-2">
            <PrimaryButton variant="silver" onClick={onRememberCar}>
              Remember this car
            </PrimaryButton>
            <button onClick={onDismissCar} className="text-xs text-silver underline">Not now</button>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        <PrimaryButton onClick={onStart} disabled={startDisabled}>
          {buttonLabel}
        </PrimaryButton>
        {mode === 'COUNTDOWN' && (
          <button
            onClick={onCancel}
            className="text-xs text-muted-foreground border border-silver/20 px-3 py-2 rounded-sm"
          >
            Cancel
          </button>
        )}
        {mode === 'COUNTDOWN' && (
          <button
            onClick={onOpenMusic}
            className="text-xs text-muted-foreground border border-silver/20 px-3 py-2 rounded-sm flex items-center gap-1"
          >
            <Music className="w-4 h-4" />
            Open Music
          </button>
        )}
        {(showCheckinCopy || mode === 'COUNTDOWN') && (
          <button
            onClick={onSendCheckin}
            className="text-xs text-muted-foreground border border-silver/20 px-3 py-2 rounded-sm flex items-center gap-1"
          >
            <MessageCircle className="w-4 h-4" />
            Send a quick check-in text
          </button>
        )}
      </div>
    </section>
  );
};
