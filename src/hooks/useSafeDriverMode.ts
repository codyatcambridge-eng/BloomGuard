import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ScreenTime as screenTime, type ScreenTimeStatus } from '@/native/screenTime';
import { applyActiveShieldRestrictions } from '@/native/screenTime';
import { loadShieldsState } from '@/storage/shieldsLocal';
import {
  getState,
  subscribe,
  startCountdown,
  completeCountdown,
  cancelSafeDriver,
  armSafeDriver,
  rememberDetectedCar,
  clearDetectedCar,
  markCheckinShownToday,
  initializeDetection,
  SafeDriverStorage,
} from '@/lib/safeDriverState';

const COUNTDOWN_DURATION_MS = 90_000;

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
}

export const useSafeDriverMode = (): UseSafeDriverModeResult => {
  const [state, setState] = useState<SafeDriverStorage>(getState());
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  const [screenTimeStatus, setScreenTimeStatus] = useState<ScreenTimeStatus | null>(null);
  const [dailyCardDay, setDailyCardDay] = useState<string | null>(null);
  const [dailyCardVisible, setDailyCardVisible] = useState(false);
  const [timerTick, setTimerTick] = useState(0);

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
    if (state.mode !== 'COUNTDOWN' || !state.countdownExpiresAt) {
      setCountdownRemaining(null);
      return;
    }

    const tick = () => {
      const end = new Date(state.countdownExpiresAt!).getTime();
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
  }, [state.mode, state.countdownExpiresAt]);

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

  const hasUnapprovedCar = Boolean(state.lastDetectedCar && !state.lastDetectedCar.isApproved);
  const countdownActive = state.mode === 'COUNTDOWN';
  const shouldShowBrowserCard = dailyCardVisible || countdownActive || hasUnapprovedCar || state.mode === 'ARMED';
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
    armSafeDriver();
  };

  const dismissCarPrompt = () => {
    clearDetectedCar();
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
    carName: state.lastDetectedCar?.localizedName ?? null,
    hasUnapprovedCar,
  };
};
