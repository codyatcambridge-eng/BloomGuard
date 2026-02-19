import { Shield, Music, MessageCircle, BellRing, Car } from 'lucide-react';
import { SafeDriverMode } from '@/lib/safeDriverState';
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

  const buttonLabel = screenTimeMessage
    ? 'Start (no lock)'
    : mode === 'COUNTDOWN'
      ? 'Countdown running'
      : mode === 'ACTIVE'
        ? 'Safe Driver active'
        : 'Start Safe Driver';

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
        <PrimaryButton onClick={onStart} disabled={mode === 'COUNTDOWN' || mode === 'ACTIVE'}>
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
