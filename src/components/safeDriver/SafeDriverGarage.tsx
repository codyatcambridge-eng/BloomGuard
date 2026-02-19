import type { ChangeEvent } from 'react';
import { Car } from 'lucide-react';
import type { PairedCar } from '@/lib/safeDriverState';
import { PrimaryButton } from '@/components/ui/PrimaryButton';

interface SafeDriverGarageProps {
  pairedCars: PairedCar[];
  rssiThreshold: number | null;
  onAddVehicle: () => void;
  onUpdateRssiThreshold: (value: number) => void;
  onTestConnection?: () => void;
}

export const SafeDriverGarage = ({
  pairedCars,
  rssiThreshold,
  onAddVehicle,
  onUpdateRssiThreshold,
  onTestConnection,
}: SafeDriverGarageProps) => {
  const sliderValue = Math.min(Math.max(rssiThreshold ?? -70, -90), -40);

  const handleSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    onUpdateRssiThreshold(Number(event.currentTarget.value));
  };

  return (
    <section className="cathedral-card space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-display text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Safe Driver Garage
          </p>
          <h3 className="text-sm font-semibold tracking-wider">Paired Vehicles</h3>
          <p className="text-[11px] text-muted-foreground">
            The app learns which car you drive. Keep this list tidy to avoid false detections.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <PrimaryButton onClick={onAddVehicle} className="px-4 py-2 text-xs tracking-widest">
            Add Vehicle
          </PrimaryButton>
          {onTestConnection && (
            <button
              type="button"
              onClick={onTestConnection}
              className="text-[10px] uppercase tracking-widest text-silver hover:text-silver/80 transition-colors"
            >
              Test Connection
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {pairedCars.length === 0 ? (
          <div className="rounded-md border border-border/50 bg-background/40 p-3 text-xs text-muted-foreground">
            No vehicles paired yet. Tap “Add Vehicle” to connect via Accessory Setup Kit.
          </div>
        ) : (
          <div className="space-y-3">
            {pairedCars.map((car) => (
              <div
                key={car.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/30 bg-background/10 p-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <div className="rounded-full bg-secondary p-2 text-xs text-muted-foreground">
                    <Car className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold tracking-wide">{car.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {car.connected ? 'Currently connected' : 'Authorized but not connected'}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-xs font-display tracking-wider ${
                    car.connected ? 'text-gold' : 'text-muted-foreground'
                  }`}
                >
                  {car.connected ? 'Connected' : 'Authorized'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-muted-foreground">
          <span>RSSI threshold</span>
          <span>{sliderValue} dBm</span>
        </div>
        <input
          type="range"
          min={-90}
          max={-40}
          step={1}
          value={sliderValue}
          onChange={handleSliderChange}
          className="w-full accent-gold"
        />
        <div className="flex items-center justify-between text-[10px] tracking-[0.4em] text-muted-foreground">
          <span>Far</span>
          <span>Near</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Drag toward “Near” to require a stronger signal. Pull toward “Far” to avoid locking up when you hover near the car.
        </p>
      </div>
    </section>
  );
};
