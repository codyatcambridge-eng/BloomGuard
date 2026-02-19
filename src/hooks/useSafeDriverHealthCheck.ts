import { useCallback, useEffect, useState } from 'react';
import {
  SafeDriver,
  type SafeDriverLiveActivityStatus,
  type SafeDriverPermissionSnapshot,
} from '@/plugins/SafeDriver';

export const useSafeDriverHealthCheck = () => {
  const [permissionSnapshot, setPermissionSnapshot] = useState<SafeDriverPermissionSnapshot | null>(null);
  const [liveActivityStatus, setLiveActivityStatus] = useState<SafeDriverLiveActivityStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      SafeDriver.checkPermissions(),
      SafeDriver.getLiveActivityStatus(),
    ]).then(([bluetoothResult, liveResult]) => {
      if (bluetoothResult.status === 'fulfilled') {
        setPermissionSnapshot(bluetoothResult.value);
      } else {
        setPermissionSnapshot(null);
      }

      if (liveResult.status === 'fulfilled') {
        setLiveActivityStatus(liveResult.value);
      } else {
        setLiveActivityStatus(null);
      }
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    permissionSnapshot,
    liveActivityStatus,
    loading,
    refresh,
  };
};
