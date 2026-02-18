export type ShieldId = 'focus' | 'sleep' | 'work' | 'ascent';

export interface ShieldWindow {
  id: 'A' | 'B';
  startTime: string; // HH:MM local wall-clock
  endTime: string; // HH:MM local wall-clock
  days: number[]; // 0-6 (Sun-Sat)
}

export interface ShieldConfig {
  id: ShieldId;
  label: string;
  enabled: boolean;
  strictness: number;
  windows: ShieldWindow[]; // max 2
  protectedAppIds: string[]; // ordered
}

export interface ShieldsState {
  version: number;
  configuredAt: string | null;
  onboardingDismissed: boolean;
  shields: Record<ShieldId, ShieldConfig>;
}

export interface EvaluateActiveShieldsResult {
  winnerShieldId: ShieldId | null;
  activeShieldIds: ShieldId[];
  reason: string;
}

export const SHIELDS_STORAGE_VERSION = 1;

export const SHIELD_STRICTNESS_PRECEDENCE: ShieldId[] = ['sleep', 'work', 'focus', 'ascent'];

export const SHIELD_LABELS: Record<ShieldId, string> = {
  focus: 'Focus Shield',
  sleep: 'Sleep Shield',
  work: 'Work Shield',
  ascent: 'Ascent Shield',
};

export const DEFAULT_WINDOWS: Record<ShieldId, ShieldWindow[]> = {
  focus: [{ id: 'A', startTime: '09:00', endTime: '12:00', days: [1, 2, 3, 4, 5] }],
  work: [{ id: 'A', startTime: '09:00', endTime: '17:00', days: [1, 2, 3, 4, 5] }],
  sleep: [{ id: 'A', startTime: '22:00', endTime: '06:00', days: [0, 1, 2, 3, 4, 5, 6] }],
  ascent: [{ id: 'A', startTime: '06:00', endTime: '08:00', days: [0, 1, 2, 3, 4, 5, 6] }],
};

const SHIELD_STRICTNESS_MAP: Record<ShieldId, number> = {
  sleep: 4,
  work: 3,
  focus: 2,
  ascent: 1,
};

function parseTimeToMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return -1;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return -1;
  return (hours * 60) + minutes;
}

function normalizeDays(days: number[]): number[] {
  const seen = new Set<number>();
  for (const day of days || []) {
    if (Number.isInteger(day) && day >= 0 && day <= 6) {
      seen.add(day);
    }
  }
  return Array.from(seen).sort((a, b) => a - b);
}

export function buildDefaultShield(id: ShieldId): ShieldConfig {
  return {
    id,
    label: SHIELD_LABELS[id],
    enabled: false,
    strictness: SHIELD_STRICTNESS_MAP[id],
    windows: DEFAULT_WINDOWS[id].map(w => ({ ...w, days: [...w.days] })),
    protectedAppIds: [],
  };
}

export function buildDefaultShieldsState(): ShieldsState {
  return {
    version: SHIELDS_STORAGE_VERSION,
    configuredAt: null,
    onboardingDismissed: false,
    shields: {
      focus: buildDefaultShield('focus'),
      sleep: buildDefaultShield('sleep'),
      work: buildDefaultShield('work'),
      ascent: buildDefaultShield('ascent'),
    },
  };
}

export function validateWindow(window: ShieldWindow): boolean {
  const start = parseTimeToMinutes(window.startTime);
  const end = parseTimeToMinutes(window.endTime);
  const days = normalizeDays(window.days);
  return (
    (window.id === 'A' || window.id === 'B') &&
    start >= 0 &&
    end >= 0 &&
    days.length > 0
  );
}

function getLocalDay(nowLocal: Date): number {
  return nowLocal.getDay();
}

function getPreviousDay(day: number): number {
  return day === 0 ? 6 : day - 1;
}

function getLocalMinutes(nowLocal: Date): number {
  return (nowLocal.getHours() * 60) + nowLocal.getMinutes();
}

export function isWindowActiveNow(window: ShieldWindow, nowLocal: Date): boolean {
  if (!validateWindow(window)) return false;

  const start = parseTimeToMinutes(window.startTime);
  const end = parseTimeToMinutes(window.endTime);
  const day = getLocalDay(nowLocal);
  const prevDay = getPreviousDay(day);
  const nowMin = getLocalMinutes(nowLocal);
  const days = normalizeDays(window.days);

  // Same start/end means full-day protection on selected days.
  if (start === end) {
    return days.includes(day);
  }

  // Standard (non-cross-midnight) window.
  if (start < end) {
    return days.includes(day) && nowMin >= start && nowMin < end;
  }

  // Cross-midnight: active late selected day OR early next day.
  if (days.includes(day) && nowMin >= start) return true;
  if (days.includes(prevDay) && nowMin < end) return true;
  return false;
}

export function isShieldActiveNow(shield: ShieldConfig, nowLocal: Date): boolean {
  if (!shield.enabled) return false;
  const windows = (shield.windows || []).slice(0, 2);
  if (windows.length === 0) return false;
  return windows.some(window => isWindowActiveNow(window, nowLocal));
}

interface TimeSegment {
  startMin: number;
  endMin: number;
}

function mergeSegments(segments: TimeSegment[]): TimeSegment[] {
  if (segments.length <= 1) return segments;

  const sorted = [...segments].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const merged: TimeSegment[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, current.endMin);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

// Deterministic union helper used for diagnostics and summaries.
export function getShieldWindowUnionForDay(shield: ShieldConfig, day: number): Array<{ startMin: number; endMin: number }> {
  const daySafe = day >= 0 && day <= 6 ? day : 0;
  const prevDay = getPreviousDay(daySafe);
  const windows = (shield.windows || []).slice(0, 2);
  const segments: TimeSegment[] = [];

  for (const window of windows) {
    if (!validateWindow(window)) continue;

    const start = parseTimeToMinutes(window.startTime);
    const end = parseTimeToMinutes(window.endTime);
    const days = normalizeDays(window.days);

    if (start === end) {
      if (days.includes(daySafe)) segments.push({ startMin: 0, endMin: 1440 });
      continue;
    }

    if (start < end) {
      if (days.includes(daySafe)) segments.push({ startMin: start, endMin: end });
      continue;
    }

    // Cross-midnight contributes two daily segments.
    if (days.includes(daySafe)) segments.push({ startMin: start, endMin: 1440 });
    if (days.includes(prevDay)) segments.push({ startMin: 0, endMin: end });
  }

  return mergeSegments(segments);
}

export function normalizeShieldConfig(input: Partial<ShieldConfig>, id: ShieldId): ShieldConfig {
  const fallback = buildDefaultShield(id);
  const windowsRaw = Array.isArray(input.windows) ? input.windows.slice(0, 2) : fallback.windows;

  const windows: ShieldWindow[] = windowsRaw.map((window, index) => {
    const defaultWindow = fallback.windows[index] || fallback.windows[0];
    const nextWindow: ShieldWindow = {
      id: (window?.id === 'A' || window?.id === 'B') ? window.id : (index === 0 ? 'A' : 'B'),
      startTime: typeof window?.startTime === 'string' ? window.startTime : defaultWindow.startTime,
      endTime: typeof window?.endTime === 'string' ? window.endTime : defaultWindow.endTime,
      days: normalizeDays(Array.isArray(window?.days) ? window.days : defaultWindow.days),
    };

    return validateWindow(nextWindow) ? nextWindow : defaultWindow;
  });

  const appIds = Array.isArray(input.protectedAppIds)
    ? input.protectedAppIds.filter((idVal): idVal is string => typeof idVal === 'string' && idVal.trim().length > 0).map(idVal => idVal.trim())
    : [];

  return {
    id,
    label: SHIELD_LABELS[id],
    enabled: Boolean(input.enabled),
    strictness: SHIELD_STRICTNESS_MAP[id],
    windows,
    protectedAppIds: appIds,
  };
}

export function normalizeShieldsState(input: Partial<ShieldsState> | null | undefined): ShieldsState {
  const defaults = buildDefaultShieldsState();
  if (!input || typeof input !== 'object') return defaults;

  const shieldsInput = input.shields || defaults.shields;

  return {
    version: SHIELDS_STORAGE_VERSION,
    configuredAt: typeof input.configuredAt === 'string' ? input.configuredAt : null,
    onboardingDismissed: Boolean(input.onboardingDismissed),
    shields: {
      focus: normalizeShieldConfig(shieldsInput.focus, 'focus'),
      sleep: normalizeShieldConfig(shieldsInput.sleep, 'sleep'),
      work: normalizeShieldConfig(shieldsInput.work, 'work'),
      ascent: normalizeShieldConfig(shieldsInput.ascent, 'ascent'),
    },
  };
}

export function hasShieldConfigBeenInitialized(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const maybeState = input as Partial<ShieldsState>;
  return typeof maybeState.version === 'number' && maybeState.version >= 1;
}

function containsTargetApp(shield: ShieldConfig, targetAppId: string): boolean {
  const target = targetAppId.trim();
  if (!target) return false;
  return (shield.protectedAppIds || []).some(appId => appId === target);
}

export function evaluateActiveShields(
  shieldsState: ShieldsState,
  nowLocal: Date,
  targetAppId: string,
): EvaluateActiveShieldsResult {
  if (!targetAppId || !targetAppId.trim()) {
    return {
      winnerShieldId: null,
      activeShieldIds: [],
      reason: 'No target app identifier provided.',
    };
  }

  const activeShieldIds = SHIELD_STRICTNESS_PRECEDENCE.filter((shieldId) => {
    const shield = shieldsState.shields[shieldId];
    return containsTargetApp(shield, targetAppId) && isShieldActiveNow(shield, nowLocal);
  });

  const winnerShieldId = activeShieldIds.length > 0 ? activeShieldIds[0] : null;

  if (!winnerShieldId) {
    return {
      winnerShieldId: null,
      activeShieldIds,
      reason: `No active shield matched app "${targetAppId}" at local wall-clock time.`,
    };
  }

  return {
    winnerShieldId,
    activeShieldIds,
    reason: `Strictest active shield for "${targetAppId}" is ${winnerShieldId} (precedence: sleep > work > focus > ascent).`,
  };
}

export interface OnboardingAnswers {
  primaryGoal: 'sleep' | 'work' | 'focus' | 'ascent';
  hardestTime: 'late_night' | 'daytime' | 'both';
}

export function suggestShieldsFromOnboarding(answers: OnboardingAnswers): ShieldId[] {
  const ordered: ShieldId[] = [];

  ordered.push(answers.primaryGoal);

  if (answers.hardestTime === 'late_night') {
    ordered.push('sleep');
  } else if (answers.hardestTime === 'daytime') {
    ordered.push('work');
  } else {
    ordered.push('sleep');
    ordered.push('work');
  }

  const unique: ShieldId[] = [];
  for (const item of ordered) {
    if (!unique.includes(item)) unique.push(item);
  }

  return unique.slice(0, 2);
}

export function applyOnboardingDefaults(
  answers: OnboardingAnswers,
  appIdsByShield: Partial<Record<ShieldId, string[]>> = {},
): ShieldsState {
  const next = buildDefaultShieldsState();
  const suggested = suggestShieldsFromOnboarding(answers);

  for (const shieldId of suggested) {
    next.shields[shieldId].enabled = true;
    const appIds = Array.isArray(appIdsByShield[shieldId])
      ? (appIdsByShield[shieldId] || []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map(value => value.trim())
      : [];
    next.shields[shieldId].protectedAppIds = appIds;
  }

  next.configuredAt = new Date().toISOString();
  return next;
}
