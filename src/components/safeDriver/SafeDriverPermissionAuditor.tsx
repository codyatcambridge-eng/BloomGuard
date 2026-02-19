import { ActivitySquare, Bluetooth, ShieldCheck } from 'lucide-react';
import type { ScreenTimeStatus } from '@/native/screenTimeTypes';
import type {
  SafeDriverLiveActivityStatus,
  SafeDriverPermissionSnapshot,
} from '@/plugins/SafeDriver';
import { PrimaryButton } from '@/components/ui/PrimaryButton';

interface SafeDriverPermissionAuditorProps {
  screenTimeStatus: ScreenTimeStatus | null;
  permissionSnapshot: SafeDriverPermissionSnapshot | null;
  liveActivityStatus: SafeDriverLiveActivityStatus | null;
  loading: boolean;
  onFix: () => void;
  onRefresh?: () => void;
}

export const SafeDriverPermissionAuditor = ({
  screenTimeStatus,
  permissionSnapshot,
  liveActivityStatus,
  loading,
  onFix,
  onRefresh,
}: SafeDriverPermissionAuditorProps) => {
  const screenTimeData = permissionSnapshot?.screenTime;
  const bluetoothData = permissionSnapshot?.bluetooth;
  const screenTimeLabel = loading && !screenTimeData
    ? 'Checking…'
    : screenTimeData?.authorized
      ? 'Authorized'
      : 'Denied';
  const bluetoothLabel = loading && !bluetoothData
    ? 'Checking…'
    : bluetoothData?.enabled
      ? 'On'
      : 'Off';
  const liveActivityLabel = loading && !liveActivityStatus
    ? 'Checking…'
    : liveActivityStatus?.enabled
      ? 'Enabled'
      : 'Disabled';

  const screenTimeHealthy = Boolean(screenTimeData?.authorized && screenTimeData?.supported);
  const screenTimeDenied = Boolean(screenTimeData) && !screenTimeHealthy;
  const bluetoothHealthy = Boolean(bluetoothData?.enabled);
  const bluetoothDenied = Boolean(bluetoothData) && !bluetoothHealthy;
  const liveActivityHealthy = Boolean(liveActivityStatus?.enabled);
  const liveActivityDenied = Boolean(liveActivityStatus) && !liveActivityHealthy;
  const needsFix = screenTimeDenied || bluetoothDenied || liveActivityDenied;

  const bluetoothPending = loading && !bluetoothData;
  const liveActivityPending = loading && !liveActivityStatus;

  const screenTimeHelper = loading
    ? 'Checking Screen Time…'
    : screenTimeStatus?.authorized
      ? 'Family Controls authorized'
      : 'Authorize Screen Time in Settings';

  const bluetoothHelper = loading
    ? 'Probing Bluetooth radio…'
    : bluetoothData
      ? `State: ${bluetoothData.state}`
      : 'Bluetooth is off';

  const liveActivityHelper = loading
    ? 'Checking Live Activities…'
    : liveActivityStatus
      ? `Authorization: ${liveActivityStatus.status}`
      : 'Requires iOS 17+';

  const details = [
    {
      label: 'Screen Time API',
      icon: ShieldCheck,
      status: screenTimeLabel,
      helper: screenTimeHelper,
      healthy: screenTimeHealthy,
      pending: !screenTimeData,
    },
    {
      label: 'Bluetooth',
      icon: Bluetooth,
      status: bluetoothLabel,
      helper: bluetoothHelper,
      healthy: bluetoothHealthy,
      pending: bluetoothPending,
    },
    {
      label: 'Live Activities',
      icon: ActivitySquare,
      status: liveActivityLabel,
      helper: liveActivityHelper,
      healthy: liveActivityHealthy,
      pending: liveActivityPending,
    },
  ];

  return (
    <section className="cathedral-card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-display text-xs tracking-[0.3em] text-muted-foreground uppercase">
            Permission Auditor
          </p>
          <h3 className="text-sm font-semibold tracking-wider">Health Check</h3>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="text-[10px] uppercase tracking-wider text-silver hover:text-silver/80 transition-colors"
          >
            Refresh
          </button>
        )}
      </div>

      <div className="space-y-3">
        {details.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 border border-border/40 rounded-md p-3">
            <div className="flex items-center gap-2">
              <item.icon className="w-4 h-4 text-muted-foreground" />
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{item.label}</p>
                <p className="text-[11px] text-muted-foreground">{item.helper}</p>
              </div>
            </div>
            <span
              className={`font-display text-sm tracking-wider ${
                item.pending
                  ? 'text-silver/50'
                  : item.healthy
                    ? 'text-gold'
                    : 'text-flame'
              }`}
            >
              {item.status}
            </span>
          </div>
        ))}
      </div>

      {needsFix && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Tap below to adjust permissions in Settings if something is denied.
          </p>
          <PrimaryButton onClick={onFix} disabled={loading} className="w-full">
            Fix in Settings
          </PrimaryButton>
        </div>
      )}
    </section>
  );
};
