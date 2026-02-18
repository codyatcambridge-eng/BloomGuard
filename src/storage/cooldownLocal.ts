import { resolveProtectedTarget } from '@/lib/protected-targets';
import type { ShieldId } from '@/logic/shields';
import { getStorageItem, setStorageItem } from '@/storage/db';

export type CooldownType = 'break' | 'shield_break';

export interface CooldownSession {
  shieldId: ShieldId;
  targetId: string;
  type: CooldownType;
  startedAt: string;
  durationSec: number;
}

export interface BeginCooldownSessionInput {
  shieldId: ShieldId;
  targetId: string;
  type: CooldownType;
  durationSec: number;
  now?: Date;
}

export interface CooldownQuery {
  shieldId?: ShieldId;
  targetId?: string;
  type?: CooldownType;
  now?: Date;
}

export interface CooldownStatus {
  session: CooldownSession | null;
  remainingSec: number;
}

export const SHIELD_COOLDOWN_STORAGE_KEY = 'mw_shield_cooldown_session_v1';

function safeNow(now?: Date): Date {
  return now instanceof Date ? now : new Date();
}

function isValidSession(value: unknown): value is CooldownSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CooldownSession>;
  return (
    (candidate.shieldId === 'sleep' ||
      candidate.shieldId === 'work' ||
      candidate.shieldId === 'focus' ||
      candidate.shieldId === 'ascent') &&
    typeof candidate.targetId === 'string' &&
    (candidate.type === 'break' || candidate.type === 'shield_break') &&
    typeof candidate.startedAt === 'string' &&
    Number.isFinite(candidate.durationSec) &&
    Number(candidate.durationSec) > 0
  );
}

function normalizeSession(raw: unknown): CooldownSession | null {
  if (!isValidSession(raw)) return null;
  const canonicalTarget = resolveProtectedTarget(raw.targetId)?.id;
  if (!canonicalTarget) return null;

  return {
    shieldId: raw.shieldId,
    targetId: canonicalTarget,
    type: raw.type,
    startedAt: raw.startedAt,
    durationSec: Math.floor(raw.durationSec),
  };
}

function computeRemainingSec(session: CooldownSession, now: Date): number {
  const startedAtMs = new Date(session.startedAt).getTime();
  if (!Number.isFinite(startedAtMs)) return 0;
  const endAtMs = startedAtMs + (session.durationSec * 1000);
  return Math.max(0, Math.ceil((endAtMs - now.getTime()) / 1000));
}

function matchesQuery(session: CooldownSession, query: CooldownQuery): boolean {
  if (query.shieldId && session.shieldId !== query.shieldId) return false;
  if (query.type && session.type !== query.type) return false;

  if (query.targetId) {
    const canonicalTarget = resolveProtectedTarget(query.targetId)?.id;
    if (!canonicalTarget) return false;
    if (session.targetId !== canonicalTarget) return false;
  }

  return true;
}

function loadSession(): CooldownSession | null {
  const stored = getStorageItem<unknown>(SHIELD_COOLDOWN_STORAGE_KEY);
  return normalizeSession(stored);
}

function saveSession(session: CooldownSession): void {
  setStorageItem(SHIELD_COOLDOWN_STORAGE_KEY, session);
}

export function beginCooldownSessionLocal(input: BeginCooldownSessionInput): CooldownStatus {
  const now = safeNow(input.now);
  const canonicalTarget = resolveProtectedTarget(input.targetId)?.id;
  if (!canonicalTarget) {
    return { session: null, remainingSec: 0 };
  }

  const existing = loadSession();
  if (
    existing &&
    existing.shieldId === input.shieldId &&
    existing.targetId === canonicalTarget &&
    existing.type === input.type
  ) {
    const remainingSec = computeRemainingSec(existing, now);
    if (remainingSec > 0) {
      return { session: existing, remainingSec };
    }
  }

  const durationSec = Math.max(1, Math.floor(input.durationSec));
  const session: CooldownSession = {
    shieldId: input.shieldId,
    targetId: canonicalTarget,
    type: input.type,
    startedAt: now.toISOString(),
    durationSec,
  };

  saveSession(session);
  return { session, remainingSec: durationSec };
}

export function getCooldownRemainingLocal(query: CooldownQuery = {}): CooldownStatus {
  const session = loadSession();
  if (!session) return { session: null, remainingSec: 0 };
  if (!matchesQuery(session, query)) return { session: null, remainingSec: 0 };

  const now = safeNow(query.now);
  return { session, remainingSec: computeRemainingSec(session, now) };
}
