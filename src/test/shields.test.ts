import { describe, it, expect } from 'vitest';
import {
  buildDefaultShieldsState,
  isShieldActiveNow,
  evaluateActiveShields,
  getShieldWindowUnionForDay,
} from '@/logic/shields';

function localDateAt(day: number, hour: number, minute = 0): Date {
  const d = new Date(2026, 1, 15 + day, hour, minute, 0, 0);
  return d;
}

describe('shields schedule helpers', () => {
  it('supports cross-midnight window evaluation for sleep shield', () => {
    const state = buildDefaultShieldsState();
    const sleep = state.shields.sleep;
    sleep.enabled = true;

    expect(isShieldActiveNow(sleep, localDateAt(1, 23, 0))).toBe(true);
    expect(isShieldActiveNow(sleep, localDateAt(2, 5, 30))).toBe(true);
    expect(isShieldActiveNow(sleep, localDateAt(2, 7, 0))).toBe(false);
  });

  it('returns winner + active shields with strictness precedence', () => {
    const state = buildDefaultShieldsState();

    state.shields.sleep.enabled = true;
    state.shields.work.enabled = true;
    state.shields.sleep.protectedAppIds = ['target.youtube'];
    state.shields.work.protectedAppIds = ['target.youtube'];

    const result = evaluateActiveShields(state, localDateAt(1, 23, 30), 'target.youtube');

    expect(result.activeShieldIds).toContain('sleep');
    expect(result.activeShieldIds).not.toContain('work');
    expect(result.winnerShieldId).toBe('sleep');
    expect(result.reason.toLowerCase()).toContain('strictest');
  });

  it('unions overlapping windows deterministically for a day', () => {
    const state = buildDefaultShieldsState();
    const focus = state.shields.focus;
    focus.windows = [
      { id: 'A', startTime: '09:00', endTime: '12:00', days: [1] },
      { id: 'B', startTime: '11:00', endTime: '13:00', days: [1] },
    ];

    const segments = getShieldWindowUnionForDay(focus, 1);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({ startMin: 540, endMin: 780 });
  });
});
