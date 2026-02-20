import { useCallback, useEffect, useMemo, useState } from 'react';
import { SafeDriver } from '@/plugins/SafeDriver';
import type {
  SafeDriverBluetoothDetectionEvent,
  SafeDriverPermissionSnapshot,
  SafeDriverStatus,
} from '@/plugins/SafeDriver';
import type { PluginListenerHandle } from '@capacitor/core';

const SafeDriverDashboard = () => {
  const [permissionSnapshot, setPermissionSnapshot] = useState<SafeDriverPermissionSnapshot | null>(null);
  const [safeDriverStatus, setSafeDriverStatus] = useState<SafeDriverStatus>({
    safeModeActive: false,
    connectedVehicleName: null,
  });
  const [lastDetection, setLastDetection] = useState<SafeDriverBluetoothDetectionEvent | null>(null);
  const [isCheckingPermissions, setIsCheckingPermissions] = useState(true);
  const [isRequestingPermissions, setIsRequestingPermissions] = useState(false);
  const [isPairing, setIsPairing] = useState(false);
  const [isStatusLoading, setIsStatusLoading] = useState(true);

  const permissionsGranted = Boolean(permissionSnapshot?.screenTime?.authorized);

  const refreshPermissions = useCallback(async () => {
    setIsCheckingPermissions(true);
    try {
      const snapshot = await SafeDriver.checkPermissions();
      setPermissionSnapshot(snapshot);
    } catch (error) {
      console.warn('SafeDriver permission check failed', error);
    } finally {
      setIsCheckingPermissions(false);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    setIsStatusLoading(true);
    try {
      const status = await SafeDriver.getCurrentStatus();
      setSafeDriverStatus(status);
    } catch (error) {
      console.warn('Unable to read SafeDriver status', error);
    } finally {
      setIsStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshPermissions();
    refreshStatus();
  }, [refreshPermissions, refreshStatus]);

  useEffect(() => {
    let listener: PluginListenerHandle | null = null;
    SafeDriver.addListener('carDetected', (event) => {
      setLastDetection(event);
      void refreshStatus();
    })
      .then((handle) => {
        listener = handle;
      })
      .catch((error) => {
        console.warn('Failed to register SafeDriver listener', error);
      });
    return () => {
      listener?.remove();
    };
  }, [refreshStatus]);

  const handleRequestPermissions = async () => {
    setIsRequestingPermissions(true);
    try {
      const snapshot = await SafeDriver.requestPermissions();
      setPermissionSnapshot(snapshot);
      void refreshStatus();
    } catch (error) {
      console.warn('SafeDriver permission request failed', error);
    } finally {
      setIsRequestingPermissions(false);
    }
  };

  const handleStartPairing = async () => {
    setIsPairing(true);
    try {
      await SafeDriver.startPairing();
    } catch (error) {
      console.warn('SafeDriver start pairing failed', error);
    } finally {
      setIsPairing(false);
    }
  };

  const dynamicIslandStyle = useMemo(() => {
    if (!safeDriverStatus.safeModeActive) {
      return 'bg-white/10 border-white/20 text-white/70';
    }
    return 'bg-gradient-to-r from-emerald-300/80 via-emerald-200/70 to-emerald-300/70 border-emerald-200/70 text-emerald-950 shadow-[0_18px_40px_rgba(16,185,129,0.35)]';
  }, [safeDriverStatus.safeModeActive]);

  const lastDetectedLabel = lastDetection?.name || 'Awaiting detection';
  const lastDetectedTime = lastDetection?.ts ? new Date(lastDetection.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <div className="min-h-screen bg-slate-950 px-4 pb-16 pt-8 text-white">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">Safe Driver</p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">Dashboard</h1>
          <p className="text-sm text-white/60">
            Monitor Safe Mode, pair new vehicles, and keep the dynamic island experience in sync with the native driver controls.
          </p>
        </div>

        <section className="rounded-[32px] border border-white/5 bg-white/5 p-6 shadow-[0_25px_45px_rgba(15,23,42,0.75)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-white/40">Status</p>
              <h2 className="text-2xl font-semibold text-white">{safeDriverStatus.safeModeActive ? 'Safe Mode Active' : 'Safe Mode Idle'}</h2>
            </div>
            <div className="text-right text-xs uppercase tracking-[0.3em] text-white/50">
              {!isStatusLoading ? 'Live' : 'Refreshing'}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <article className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-sm text-white/60">Connected vehicle</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {safeDriverStatus.connectedVehicleName ?? 'Not connected'}
              </p>
            </article>
            <article className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-sm text-white/60">Pairing status</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {isPairing ? 'Opening picker…' : 'Accessory picker ready'}
              </p>
            </article>
          </div>

            <div className={`mt-6 flex items-center justify-between rounded-full border px-5 py-3 text-sm font-semibold tracking-wide backdrop-blur ${dynamicIslandStyle}`}>
              <div>
                <p className="text-[0.63rem] uppercase tracking-[0.5em] text-current/70">Live Activity</p>
                <p className="text-base leading-none">
                  {safeDriverStatus.safeModeActive ? 'Safe Mode is running' : 'No live activity'}
                </p>
              </div>
            <div className="text-xs font-medium text-current/60">
              {isStatusLoading ? 'Updating…' : lastDetectedTime ?? 'Idle'}
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-dashed border-white/20 bg-white/5 p-4 text-sm text-white/70">
            <p className="font-semibold text-white">Last car detection</p>
            <p className="mt-1">{lastDetectedLabel}</p>
            {lastDetectedTime && <p className="text-xs text-white/40">{lastDetectedTime}</p>}
          </div>

          {isCheckingPermissions ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 p-4 text-center text-sm text-white/70">
              Checking permissions…
            </div>
          ) : !permissionsGranted ? (
            <div className="mt-6 space-y-4 rounded-2xl border border-amber-300/60 bg-amber-500/10 p-4 text-sm text-amber-50">
              <p className="text-lg font-semibold text-amber-100">Setup Required</p>
              <p className="text-amber-50/80">
                Safe Driver needs Screen Time authorization to keep your commute locked down. Tap below to request access.
              </p>
              <button
                className="w-full rounded-2xl bg-amber-400 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-amber-300/70"
                onClick={handleRequestPermissions}
                disabled={isRequestingPermissions}
              >
                {isRequestingPermissions ? 'Requesting…' : 'Request Permissions'}
              </button>
            </div>
          ) : (
            <div className="mt-6 space-y-3 text-sm text-white/80">
              <p>Safe Driver is authorized and ready to protect your drive. Pair a vehicle or refresh the status to keep everything in sync.</p>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <button
              className="flex-1 rounded-2xl border border-white/30 bg-white/10 px-5 py-3 text-sm font-semibold transition hover:border-white/60 disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/40 md:max-w-xs"
              onClick={handleStartPairing}
              disabled={!permissionsGranted || isPairing}
            >
              {isPairing ? 'Pairing…' : 'Pair Your Vehicle'}
            </button>
            <button
              className="text-xs font-semibold uppercase tracking-[0.5em] text-white/60"
              onClick={refreshStatus}
            >
              Refresh status
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default SafeDriverDashboard;
