import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDefaultShieldsState } from '@/logic/shields';
import { loadShieldsState } from '@/storage/shieldsLocal';
import {
  beginCooldownSession,
  evaluateProtection,
  getActiveShields,
  getCooldownRemaining,
  getFrictionPolicy,
} from '@/logic/ShieldEngine';

const memoryStorage = new Map<string, unknown>();

vi.mock('@/storage/db', () => ({
  getStorageItem: vi.fn((key: string) => (memoryStorage.has(key) ? memoryStorage.get(key) : null)),
  setStorageItem: vi.fn((key: string, value: unknown) => {
    memoryStorage.set(key, value);
  }),
}));

vi.mock('@/storage/shieldsLocal', () => ({
  loadShieldsState: vi.fn(),
}));

const mockedLoadShieldsState = vi.mocked(loadShieldsState);

function localDateAt(day: number, hour: number, minute = 0): Date {
  return new Date(2026, 1, 15 + day, hour, minute, 0, 0);
}

describe('ShieldEngine', () => {
  beforeEach(() => {
    memoryStorage.clear();
    vi.clearAllMocks();
  });

  it('returns active shields for cross-midnight schedules and protects with strict precedence', () => {
    const state = buildDefaultShieldsState();
    state.shields.sleep.enabled = true;
    state.shields.work.enabled = true;
    state.shields.sleep.windows = [{ id: 'A', startTime: '22:00', endTime: '06:00', days: [0, 1, 2, 3, 4, 5, 6] }];
    state.shields.work.windows = [{ id: 'A', startTime: '20:00', endTime: '23:59', days: [0, 1, 2, 3, 4, 5, 6] }];
    state.shields.sleep.protectedAppIds = ['target.youtube'];
    state.shields.work.protectedAppIds = ['target.youtube'];

    mockedLoadShieldsState.mockReturnValue({
      state,
      hadPersistedState: true,
      wasMigrated: false,
    });

    const now = localDateAt(1, 23, 30);

    expect(getActiveShields(now)).toEqual(['sleep', 'work']);

    const result = evaluateProtection({ targetId: 'target.youtube', now });
    expect(result.isProtected).toBe(true);
    expect(result.activeShields).toEqual(['sleep', 'work']);
    expect(result.strictestShield).toBe('sleep');
    expect(result.bucket).toBe('hard');
  });

  it('returns non-protected unknown_target for unknown target ids', () => {
    const state = buildDefaultShieldsState();
    mockedLoadShieldsState.mockReturnValue({
      state,
      hadPersistedState: true,
      wasMigrated: false,
    });

    const result = evaluateProtection({ targetId: 'target.not-in-registry', now: localDateAt(1, 10, 0) });
    expect(result.isProtected).toBe(false);
    expect(result.reason).toBe('unknown_target');
    expect(result.activeShields).toEqual([]);
  });

  it('returns permissive friction policy when strictestShield or bucket is missing', () => {
    const policy = getFrictionPolicy(undefined, 'hard');
    expect(policy.breakDurationSeconds).toBe(30);
    expect(policy.requiresIntentionStep).toBe(false);
    expect(policy.shieldBreakDurationSeconds).toBeUndefined();
  });

  it('persists cooldown sessions and is idempotent for same shield/target/type while active', () => {
    const start = new Date('2026-02-18T10:00:00.000Z');
    const first = beginCooldownSession({
      shieldId: 'sleep',
      targetId: 'target.youtube',
      type: 'break',
      durationSec: 300,
      now: start,
    });

    expect(first.session).not.toBeNull();
    expect(first.remainingSec).toBe(300);

    const second = beginCooldownSession({
      shieldId: 'sleep',
      targetId: 'target.youtube',
      type: 'break',
      durationSec: 999,
      now: new Date('2026-02-18T10:01:00.000Z'),
    });

    expect(second.session).toEqual(first.session);
    expect(second.remainingSec).toBe(240);

    const resumed = getCooldownRemaining({
      shieldId: 'sleep',
      targetId: 'target.youtube',
      type: 'break',
      now: new Date('2026-02-18T10:04:30.000Z'),
    });
    expect(resumed.remainingSec).toBe(30);

    const expired = getCooldownRemaining({
      shieldId: 'sleep',
      targetId: 'target.youtube',
      type: 'break',
      now: new Date('2026-02-18T10:06:00.000Z'),
    });
    expect(expired.remainingSec).toBe(0);
  });
});
