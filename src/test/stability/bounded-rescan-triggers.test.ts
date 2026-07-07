/**
 * Phase 1A — bounded rescan reliability.
 *
 * Proves the lifecycle triggers that keep blur injection alive are present
 * AND bounded:
 *   1. cold injection / refresh schedules the bootstrap full scan
 *   2. SPA route change schedules exactly one bounded rescan per URL change
 *   3. back/forward (popstate) drives the same rescan path
 *   4. foreground/visibility restore schedules ONE bounded bootstrap rescan
 *      (re-arming replaces the pending timer — never stacks)
 *   5. Off cleanup stops the scanner, cleans overlays, and unregisters the
 *      host sync hook so a dead instance can never short-circuit re-injection
 *   6. Off→On (fresh instance, host NO_HOOK path) restarts with a bootstrap
 *      rescan and re-queueable nodes (dedupe stamps erased by Off cleanup)
 *   7. repeated route/visibility churn does not create unbounded timers
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function revealOverlayCount(): number {
  return document.querySelectorAll('.mw-reveal-overlay').length;
}

let injection: InjectionResult | null = null;

afterEach(() => {
  injection?.cleanup();
  injection = null;
  vi.useRealTimers();
  window.history.pushState({}, '', 'https://m.youtube.com/');
});

describe('Phase 1A bounded rescan triggers', () => {
  it('cold injection (refresh path) schedules the bootstrap full scan', () => {
    injection = injectScript();
    // jsdom documents report readyState 'complete', which is exactly the
    // post-refresh re-injection state: bootstrap must fire immediately.
    const bootstrapLogs = injection.logs.filter((l) => l.includes('bootstrapFullScan:ready_complete'));
    expect(bootstrapLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('SPA route change schedules exactly one bounded rescan per URL change', () => {
    injection = injectScript();
    const before = injection.logs.filter((l) => l.includes('spaFullScan')).length;

    window.history.pushState({}, '', 'https://m.youtube.com/watch?v=' + POSITIVE_ID);
    injection.probe.checkUrlChange();

    const afterOne = injection.logs.filter((l) => l.includes('spaFullScan')).length;
    expect(afterOne - before).toBe(1);
    expect(injection.logs.some((l) => l.includes('SPA navigation detected'))).toBe(true);

    // Same URL re-checked repeatedly → self-guarded, zero additional rescans.
    for (let i = 0; i < 50; i += 1) injection.probe.checkUrlChange();
    const afterChurn = injection.logs.filter((l) => l.includes('spaFullScan')).length;
    expect(afterChurn).toBe(afterOne);
  });

  it('back/forward (popstate) drives the same bounded rescan path', () => {
    injection = injectScript();
    vi.useFakeTimers();
    const before = injection.logs.filter((l) => l.includes('spaFullScan')).length;

    // Simulate back/forward: URL changes and popstate fires (history wrapper
    // setTimeout(0) callbacks are driven by fake timers).
    window.history.pushState({}, '', 'https://m.youtube.com/watch?v=' + POSITIVE_ID);
    window.dispatchEvent(new PopStateEvent('popstate'));
    vi.advanceTimersByTime(10);

    const after = injection.logs.filter((l) => l.includes('spaFullScan')).length;
    expect(after - before).toBe(1);
  });

  it('foreground/visibility restore schedules ONE bounded bootstrap rescan', () => {
    injection = injectScript();
    vi.useFakeTimers();

    // Re-arm ten times: pending timer must be replaced, never stacked.
    for (let i = 0; i < 10; i += 1) {
      injection.probe.scheduleForegroundBootstrapRescan('test_foreground_' + i);
    }
    expect(injection.probe.getTimerSnapshot().foregroundRescanTimer).toBe(true);

    const bootstrapBefore = injection.logs.filter((l) => l.includes('bootstrapFullScan:foreground')).length;
    vi.advanceTimersByTime(250);
    const bootstrapAfter = injection.logs.filter((l) => l.includes('bootstrapFullScan:foreground')).length;

    // Ten re-arms → exactly one bootstrap rescan fired, timer slot cleared.
    expect(bootstrapAfter - bootstrapBefore).toBe(1);
    expect(injection.probe.getTimerSnapshot().foregroundRescanTimer).toBe(false);
  });

  it('visibilitychange hidden→visible arms the bounded foreground rescan', () => {
    injection = injectScript();
    vi.useFakeTimers();

    const visibilityState = vi.spyOn(document, 'visibilityState', 'get');
    visibilityState.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(injection.probe.getTimerSnapshot().paused).toBe(true);

    visibilityState.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(injection.probe.getTimerSnapshot().paused).toBe(false);
    expect(injection.probe.getTimerSnapshot().foregroundRescanTimer).toBe(true);

    vi.advanceTimersByTime(250);
    expect(
      injection.logs.some((l) => l.includes('bootstrapFullScan:foreground:visibility_visible')),
    ).toBe(true);
    visibilityState.mockRestore();
  });

  it('Off stops the scanner, cleans overlays, and unregisters the host sync hook', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    expect(revealOverlayCount()).toBeGreaterThan(0);
    expect(typeof (window as Record<string, unknown>).__MW_SYNC_HOST_CONTEXT__).toBe('function');

    const result = (window as Record<string, unknown> & {
      __MW_OFF_MODE_CLEANUP__: (r: string) => string;
    }).__MW_OFF_MODE_CLEANUP__('test_protection_off');

    expect(result).toBe('OK_OFF_MODE_CLEANUP');
    expect(revealOverlayCount()).toBe(0);
    expect(injection.probe.isVisualModerationActive()).toBe(false);
    // The dead instance must not answer the host's context sync — a live hook
    // here is exactly what previously made Off→On unrecoverable on SPA pages.
    expect((window as Record<string, unknown>).__MW_SYNC_HOST_CONTEXT__).toBeNull();
    expect((window as Record<string, unknown>).__MW_ACTIVE__).toBe(false);
  });

  it('Off erases scan dedupe stamps so the next On bootstrap can re-queue nodes', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');
    // Simulate a node the scanner already stamped as processed.
    video.dataset.mwScanned = 'true';
    video.dataset.mwLastScanSrc = srcFor(POSITIVE_ID);

    (window as Record<string, unknown> & {
      __MW_OFF_MODE_CLEANUP__: (r: string) => string;
    }).__MW_OFF_MODE_CLEANUP__('test_off_dedupe');

    expect(video.dataset.mwScanned).toBe('false');
    expect(video.dataset.mwLastScanSrc).toBe('');
  });

  it('Off→On: a fresh instance fully re-initializes and runs its bootstrap rescan', () => {
    injection = injectScript();
    (window as Record<string, unknown> & {
      __MW_OFF_MODE_CLEANUP__: (r: string) => string;
    }).__MW_OFF_MODE_CLEANUP__('test_off_before_on');
    expect((window as Record<string, unknown>).__MW_SYNC_HOST_CONTEXT__).toBeNull();

    // Host sees NO_HOOK → executes the full script again (protection On path).
    injection.cleanup();
    injection = injectScript();

    // Fresh instance: live sync hook restored, scanner active, bootstrap ran.
    expect(typeof (window as Record<string, unknown>).__MW_SYNC_HOST_CONTEXT__).toBe('function');
    expect(injection.probe.isVisualModerationActive()).toBe(true);
    expect(
      injection.logs.some((l) => l.includes('bootstrapFullScan:ready_complete')),
    ).toBe(true);
  });

  it('repeated route/visibility churn keeps timers bounded', () => {
    injection = injectScript();
    vi.useFakeTimers();
    // Injection-time timers were scheduled on real timers and cannot fire
    // under the fake clock; they are the fixed baseline churn must not grow.
    const baseline = injection.probe.getTimerSnapshot().initialTimeouts;

    const pendingPerCycle: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      window.history.pushState({}, '', 'https://m.youtube.com/watch?v=vid' + i);
      injection.probe.checkUrlChange();
      injection.probe.scheduleForegroundBootstrapRescan('churn_' + i);
      // Let scheduled one-shots fire between navigations (steady state).
      vi.advanceTimersByTime(600);
      pendingPerCycle.push(injection.probe.getTimerSnapshot().initialTimeouts);
    }

    // Bounded means constant steady-state, not growth: the pending count after
    // 25 navigations must not exceed the count reached after 5.
    expect(pendingPerCycle[24]).toBeLessThanOrEqual(pendingPerCycle[4]);
    expect(Math.max(...pendingPerCycle)).toBeLessThan(20);

    vi.advanceTimersByTime(5000);
    const drained = injection.probe.getTimerSnapshot();
    expect(drained.foregroundRescanTimer).toBe(false);
    // Everything the churn scheduled has fired and self-removed: only the
    // pre-churn baseline handles remain.
    expect(drained.initialTimeouts).toBeLessThanOrEqual(baseline);
  });

  it('teardown gates the foreground rescan (no scans after teardown)', () => {
    injection = injectScript();
    vi.useFakeTimers();
    (window as Record<string, unknown> & { __MW_TEARDOWN__: (r: string) => void }).__MW_TEARDOWN__('test_teardown');

    injection.probe.scheduleForegroundBootstrapRescan('after_teardown');
    expect(injection.probe.getTimerSnapshot().foregroundRescanTimer).toBe(false);

    const before = injection.logs.filter((l) => l.includes('bootstrapFullScan:foreground')).length;
    vi.advanceTimersByTime(1000);
    const after = injection.logs.filter((l) => l.includes('bootstrapFullScan:foreground')).length;
    expect(after).toBe(before);
  });
});
