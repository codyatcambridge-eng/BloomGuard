/**
 * GOLDEN / FREEZE TEST — P3 Foreground/Inactivity Recovery + P4 Refresh Recovery.
 *
 * The P3/P4 orchestration lives host-side in NativeWebViewBrowser.tsx (a foreground liveness
 * probe + a shared recoveryNonce that re-arms the bounded injection heartbeat, plus a
 * forceWebViewRescan on the alive path). That orchestration is correct only if these
 * injection-script CONTRACTS hold — this suite locks them so a future change to the script
 * cannot silently break recovery:
 *
 *   1. LIVENESS — a live injection reports window.__MW_ACTIVE__ === true; a torn-down/purged
 *      script reports false. The foreground probe uses this distinction (ack vs. no-ack maps to
 *      alive vs. dead) to decide rescan-vs-reinject.
 *   2. RESCAN HOOKS — window.__MW_SCAN_FULL__ / window.__MW_SCAN_YT__ exist and are callable.
 *      These are exactly what forceWebViewRescan() invokes to re-own a restaled DOM on foreground.
 *   3. RE-OWNERSHIP SAFETY — a host-driven rescan must NEVER un-blur an authoritative-blurred
 *      positive, and must not blur an owned-safe negative.
 *   4. REBUILD — after teardown (the DEAD path / a reload), a fresh injection re-establishes
 *      __MW_ACTIVE__ and the rescan hooks. This is what recoveryNonce -> heartbeat -> reinject does.
 *
 * Driven through generateModerationScript() in jsdom. No production code modified.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';
const SAFE_ID = 'SaFeVid00001';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

function win(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>;
}

function isActive(): boolean {
  return win().__MW_ACTIVE__ === true;
}

/** Invoke the host-callable rescan hooks exactly as forceWebViewRescan() does. */
function hostForceRescan(): void {
  const lifecycle = win().__MW_LIFECYCLE_RESCAN__;
  if (typeof lifecycle === 'function') {
    (lifecycle as (r: string) => string)('test_force_rescan');
    return;
  }
  const scanFull = win().__MW_SCAN_FULL__;
  const scanYt = win().__MW_SCAN_YT__;
  if (typeof scanFull === 'function') (scanFull as () => void)();
  if (typeof scanYt === 'function') (scanYt as () => void)();
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('GOLDEN: Recovery contracts (P3 foreground/inactivity + P4 refresh)', () => {
  it('LIVENESS: a fresh injection is alive and exposes the host rescan hooks', () => {
    injection = injectScript();
    expect(isActive()).toBe(true);
    expect(typeof win().__MW_SCAN_FULL__).toBe('function');
    expect(typeof win().__MW_SCAN_YT__).toBe('function');
    expect(typeof win().__MW_LIFECYCLE_RESCAN__).toBe('function');
    // The foreground probe / reload re-arm depend on teardown being callable too.
    expect(typeof win().__MW_TEARDOWN__).toBe('function');
  });

  it('RE-OWNERSHIP SAFETY: a host rescan does NOT un-blur an authoritative positive', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);

    // Foreground ALIVE path: host drives __MW_SCAN_FULL__ + __MW_SCAN_YT__ to re-own the DOM.
    hostForceRescan();

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
    expect(video.dataset.mwHardBlur === '1' || video.classList.contains('mw-blurred')).toBe(true);
  });

  it('NEGATIVE-SAFE: a host rescan does NOT blur an owned-safe thumbnail', () => {
    const { video } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();
    // Simulate an already-classified safe (negative) node.
    video.dataset.mwModerated = 'safe';
    video.dataset.mwSrc = srcFor(SAFE_ID);

    hostForceRescan();

    expect(video.dataset.mwModerated).not.toBe('blurred');
    expect(hasBlurFilter(video)).toBe(false);
  });

  it('DEAD PATH: teardown purges liveness (__MW_ACTIVE__ === false) so the probe re-injects', () => {
    injection = injectScript();
    expect(isActive()).toBe(true);

    // Model the iOS JS-context purge after a long background.
    (win().__MW_TEARDOWN__ as (r: string) => void)('test_inactivity_purge');

    expect(isActive()).toBe(false);
  });

  it('REBUILD: re-injecting after a purge restores liveness + rescan hooks (recoveryNonce path)', () => {
    injection = injectScript();
    (win().__MW_TEARDOWN__ as (r: string) => void)('test_inactivity_purge');
    expect(isActive()).toBe(false);
    injection.cleanup();

    // recoveryNonce -> heartbeat -> injectModerationScript re-injects the fresh page.
    injection = injectScript();
    expect(isActive()).toBe(true);
    expect(typeof win().__MW_SCAN_FULL__).toBe('function');
    expect(typeof win().__MW_SCAN_YT__).toBe('function');
  });
});
