import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ScreenTime as screenTime, type ScreenTimeStatus } from '@/native/screenTime';
import { applyActiveShieldRestrictions } from '@/native/screenTime';
import { loadShieldsState } from '@/storage/shieldsLocal';
import { SafeDriver } from '@/plugins/SafeDriver';
import {
  getState,
  subscribe,
  startCountdown,
  completeCountdown,
  cancelSafeDriver,
  rememberDetectedCar,
  ignoreDetectedCar,
  setSafeDriverEnabled,
  setAutoStartOnApprovedCar,
  setBluetoothDetectionIdentifiers,
  setBluetoothServiceUUIDs,
  setBluetoothRssiThreshold,
  markCheckinShownToday,
  initializeDetection,
  SafeDriverStorage,
  PairedCar,
} from '@/lib/safeDriverState';

const buildTodayKey = () => new Date().toISOString().split('T')[0];

const isAfterEightThirty = () => {
  const now = new Date();
  return now.getHours() > 20 || (now.getHours() === 20 && now.getMinutes() >= 30);
};

export interface UseSafeDriverModeResult {
  state: SafeDriverStorage;
  countdownRemainingMs: number | null;
  screenTimeStatus: ScreenTimeStatus | null;
  startCountdown: () => void;
  cancel: () => void;
  openMusic: () => void;
  sendCheckinText: () => void;
  rememberCar: () => void;
  dismissCarPrompt: () => void;
  shouldShowBrowserCard: boolean;
  shouldShowCheckinCopy: boolean;
  screenTimeUnavailableMessage: string | null;
  carName: string | null;
  hasUnapprovedCar: boolean;
  safeDriverEnabled: boolean;
  autoStartOnApprovedCar: boolean;
  toggleSafeDriver: (enabled: boolean) => void;
  toggleAutoStart: (enabled: boolean) => void;
  registerAccessory: () => void;
  registeringAccessory: boolean;
  showAccessoryPicker: () => void;
  testConnection: () => void;
  bluetoothIdentifiersText: string;
  bluetoothServiceUUIDsText: string;
  bluetoothRssiThreshold: number | null;
  updateBluetoothIdentifiers: (value: string) => void;
  updateBluetoothServiceUUIDs: (value: string) => void;
  updateBluetoothRssiThreshold: (value: string | number) => void;
  pairedCars: PairedCar[];
}

export const useSafeDriverMode = (): UseSafeDriverModeResult => {
  const [state, setState] = useState<SafeDriverStorage>(getState());
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  const [screenTimeStatus, setScreenTimeStatus] = useState<ScreenTimeStatus | null>(null);
  const [dailyCardDay, setDailyCardDay] = useState<string | null>(null);
  const [dailyCardVisible, setDailyCardVisible] = useState(false);
  const [timerTick, setTimerTick] = useState(0);
  const [registeringAccessory, setRegisteringAccessory] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribe(() => setState(getState()));
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    void initializeDetection();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const config = state.bluetoothDetection;
    void SafeDriver.configureBluetoothDetection({
      approvedIdentifiers: config.identifiers,
      serviceUUIDs: config.serviceUUIDs,
      safeDriverEnabled: state.safeDriverEnabled,
      autoStartOnApprovedCar: state.autoStartOnApprovedCar,
      rssiThreshold: config.rssiThreshold,
    }).catch(() => {
      console.debug('[SafeDriver][DIAG] configureBluetoothDetection failed');
    });
  }, [
    state.safeDriverEnabled,
    state.autoStartOnApprovedCar,
    state.bluetoothDetection.identifiers.join('|'),
    state.bluetoothDetection.serviceUUIDs.join('|'),
    state.bluetoothDetection.rssiThreshold,
  ]);

  useEffect(() => {
    let active = true;
    screenTime.getScreenTimeStatus()
      .then((status) => {
        if (!active) return;
        setScreenTimeStatus(status);
      })
      .catch(() => {
        if (!active) return;
        setScreenTimeStatus({ supported: false, authorized: false, reason: 'status_error' });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (state.mode !== 'COUNTDOWN' || !state.countdownEndsAt) {
      setCountdownRemaining(null);
      return;
    }

    const tick = () => {
      const end = new Date(state.countdownEndsAt!).getTime();
      const remaining = Math.max(0, end - Date.now());
      setCountdownRemaining(remaining);
      if (remaining <= 0) {
        completeCountdown();
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [state.mode, state.countdownEndsAt]);

  useEffect(() => {
    if (state.mode !== 'ACTIVE' && state.mode !== 'OFF') return;
    const { state: shieldsState } = loadShieldsState();
    void applyActiveShieldRestrictions(shieldsState).catch(() => {
      console.debug('[SafeDriver][DIAG] applyActiveShieldRestrictions failed');
    });
  }, [state.mode]);

  useEffect(() => {
    const today = buildTodayKey();
    if (!isAfterEightThirty()) {
      setDailyCardVisible(false);
      setDailyCardDay(null);
      return;
    }

    if (state.lastCheckinDate === today && dailyCardDay !== today) {
      // already recorded in storage, no need to show again this session
      setDailyCardVisible(false);
      setDailyCardDay(today);
      return;
    }

    if (dailyCardDay === today) {
      setDailyCardVisible(true);
      return;
    }

    setDailyCardVisible(true);
    setDailyCardDay(today);
    markCheckinShownToday();
  }, [state.lastCheckinDate, dailyCardDay, timerTick]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const interval = window.setInterval(() => {
      setTimerTick((prev) => prev + 1);
    }, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const hasUnapprovedCar = Boolean(
    state.lastDetected &&
    !state.lastDetected.isApproved &&
    state.lastDetected.portName !== state.ignoredPortName
  );
  const shouldShowBrowserCard = false;
  const shouldShowCheckinCopy = dailyCardVisible;

  const start = () => {
    startCountdown();
  };

  const cancel = () => {
    cancelSafeDriver();
  };

  const openMusic = () => {
    if (typeof window === 'undefined') return;
    const url = 'music://';
    const opened = window.open(url, '_blank');
    if (!opened) {
      toast('Unable to open Music. Play a track before Safe Driver starts.');
    }
  };

  const sendCheckinText = () => {
    if (typeof window === 'undefined') return;
    const body = encodeURIComponent('Heading out. If I’m still out late, text me to make sure I’m good.');
    const smsUrl = `sms:&body=${body}`;
    try {
      window.location.href = smsUrl;
    } catch (error) {
      if (navigator.share) {
        void navigator.share({
          text: 'Heading out. If I’m still out late, text me to make sure I’m good.',
        }).catch(() => {
          toast('Unable to open messaging. Try texting manually.');
        });
      } else {
        toast('Unable to open messaging. Try texting manually.');
      }
    }
  };

  const rememberCar = () => {
    rememberDetectedCar();
  };

  const dismissCarPrompt = () => {
    ignoreDetectedCar();
  };

  const toggleSafeDriver = (enabled: boolean) => {
    setSafeDriverEnabled(enabled);
  };

  const toggleAutoStart = (enabled: boolean) => {
    setAutoStartOnApprovedCar(enabled);
  };

  const presentAccessoryPicker = () => {
    if (registeringAccessory) return;
    setRegisteringAccessory(true);
    void SafeDriver.startPairing()
      .then(() => {
        toast('Accessory picker shown. Complete setup on the device.');
      })
      .catch(() => {
        toast('Accessory setup is unavailable on this device.');
      })
      .finally(() => {
        setRegisteringAccessory(false);
      });
  };

  const registerAccessory = presentAccessoryPicker;
  const showAccessoryPicker = presentAccessoryPicker;

  const testConnection = () => {
    void SafeDriver.testHeartbeat()
      .then((result) => {
        if (result.seen) {
          toast.success('Car detected. Your phone vibrated to confirm.');
        } else {
          toast('No paired car is currently in range.');
        }
      })
      .catch(() => {
        toast('Unable to test the connection right now.');
      });
  };

  const parseList = (input: string) =>
    input
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

  const bluetoothIdentifiersText = state.bluetoothDetection.identifiers.join('\n');
  const bluetoothServiceUUIDsText = state.bluetoothDetection.serviceUUIDs.join('\n');
  const bluetoothRssiThreshold = state.bluetoothDetection.rssiThreshold;

  const updateBluetoothIdentifiers = (value: string) => {
    setBluetoothDetectionIdentifiers(parseList(value));
  };

  const updateBluetoothServiceUUIDs = (value: string) => {
    setBluetoothServiceUUIDs(parseList(value));
  };

  const updateBluetoothRssiThreshold = (value: string | number) => {
    const normalized = typeof value === 'number' ? value.toString() : value;
    const trimmed = normalized.trim();
    if (!trimmed) {
      setBluetoothRssiThreshold(null);
      return;
    }
    const parsed = parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) return;
    setBluetoothRssiThreshold(parsed);
  };

  const screenTimeUnavailableMessage = useMemo(() => {
    if (!screenTimeStatus) return null;
    if (!screenTimeStatus.supported) return 'Lock unavailable on this build';
    if (!screenTimeStatus.authorized) return 'Lock unavailable until Screen Time is authorized';
    return null;
  }, [screenTimeStatus]);

  return {
    state,
    countdownRemainingMs: countdownRemaining,
    screenTimeStatus,
    startCountdown: start,
    cancel,
    openMusic,
    sendCheckinText,
    rememberCar,
    dismissCarPrompt,
    shouldShowBrowserCard,
    shouldShowCheckinCopy,
    screenTimeUnavailableMessage,
    carName: state.lastDetected?.portName ?? null,
    hasUnapprovedCar,
    safeDriverEnabled: state.safeDriverEnabled,
    autoStartOnApprovedCar: state.autoStartOnApprovedCar,
    toggleSafeDriver,
    toggleAutoStart,
    registerAccessory,
    showAccessoryPicker,
    testConnection,
    registeringAccessory,
    bluetoothIdentifiersText,
    bluetoothServiceUUIDsText,
    bluetoothRssiThreshold,
    updateBluetoothIdentifiers,
    updateBluetoothServiceUUIDs,
    updateBluetoothRssiThreshold,
    pairedCars: state.pairedCars,
  };
};
