/**
 * GOLDEN / FREEZE TEST — Cold-Start Model-Readiness Rescan
 *
 * The cold-start fix re-issues the moderation request pipeline once the host
 * NSFWJS/TF.js model is ready (mwColdStartRescan), so thumbnails scanned before the
 * model loaded — which time out to 'timeout-safe' + safeResolved — get re-classified
 * and blurred without a navigation.
 *
 * These lock the two things that MUST hold for that fix to be MVP-safe:
 *   1. SAFETY INVARIANT (positive stability): a cold-start rescan must NEVER un-blur an
 *      already authoritative-blurred positive thumbnail. (No regression of sacred blur.)
 *   2. RECOVERY: a thumbnail stuck as 'timeout-safe' is re-armed (attribute cleared) and
 *      its src removed from scanned/safeResolved, so the next scan can re-request it.
 *
 * Driven through generateModerationScript() in jsdom. No production code modified.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

function debugState(): { scanned: Set<string>; safeResolved: Set<string>; blurred: Set<string> } {
  const dbg = (window as Record<string, unknown>).__MW_DEBUG__ as { state: unknown };
  return dbg.state as { scanned: Set<string>; safeResolved: Set<string>; blurred: Set<string> };
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('GOLDEN: Cold-Start Rescan (sacred — must not regress positive blur)', () => {
  it('exposes a bounded host model-ready recovery hook without a visual HUD', () => {
    injection = injectScript();
    const modelReadyRescan = (
      window as unknown as {
        __MW_MODEL_READY_RESCAN__?: (reason: string) => string;
      }
    ).__MW_MODEL_READY_RESCAN__;

    expect(modelReadyRescan).toBeTypeOf('function');
    expect(modelReadyRescan?.('test_model_ready_hook')).toBe('OK');
    expect(document.getElementById('mw-diag-hud')).toBeNull();
  });

  it('SAFETY: a cold-start rescan does NOT un-blur an authoritative-blurred positive', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);

    // Fire the cold-start model-ready rescan (clears scanned/safeResolved, re-issues requests).
    injection.probe.mwColdStartRescan('test_model_ready');

    // Authoritative positive blur must survive untouched.
    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
    expect(video.dataset.mwHardBlur === '1' || video.classList.contains('mw-blurred')).toBe(true);
  });

  it('RECOVERY: a timeout-safe thumbnail is re-armed so it can be re-requested', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    // Simulate the FAIL-OPEN timeout state from a not-ready model on cold start.
    video.dataset.mwModerated = 'timeout-safe';
    video.dataset.mwSrc = srcFor(POSITIVE_ID);

    injection.probe.mwColdStartRescan('test_model_ready');

    // The timeout-safe marker is cleared so the scan path will re-queue it.
    expect(video.dataset.mwModerated).not.toBe('timeout-safe');
    // Cold-start suppression sets are emptied so the src is re-requestable.
    const st = debugState();
    expect(st.safeResolved.size).toBe(0);
  });
});
