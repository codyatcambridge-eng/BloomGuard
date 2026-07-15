/**
 * Cold-start + Shorts-exit home heal lifecycle pins.
 * FREEZE-OVERRIDE (lifecycle): model_not_ready must not finalize as safe;
 * exit must leave home re-scannable without stuck flash residue.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';
const SAFE_ID = 'safe1234567';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('Cold-start model_not_ready + exit home heal', () => {
  it('model_not_ready legacy result does not finalize as safe or hard-clear soft blur', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    const src = srcFor(POSITIVE_ID);
    video.dataset.mwOrigPoster = src;
    video.dataset.mwModerated = 'softblur';
    video.classList.add('mw-softblur');
    video.style.setProperty('filter', 'blur(12px)', 'important');

    window.__GC_SCAN_RESULTS__ = [
      {
        src,
        shouldBlur: false,
        category: 'model_not_ready',
        blurStrengthPx: 40,
      },
    ];

    injection.probe.processLegacyResults();

    // Soft pre-blur must survive non-final pending (not fail-open safe clear).
    expect(video.dataset.mwModerated).toBe('softblur');
    expect(hasBlurFilter(video)).toBe(true);
    expect(video.classList.contains('mw-softblur')).toBe(true);
  });

  it('cold-start flush hook clears scanned and returns OK', () => {
    injection = injectScript();
    const flush = (window as unknown as { __MW_COLD_START_FLUSH__?: (r: string) => string })
      .__MW_COLD_START_FLUSH__;
    expect(typeof flush).toBe('function');
    const result = flush!('test_model_ready');
    expect(String(result)).toMatch(/^OK/);
  });

  it('home feed heal hook is available on main surface', () => {
    injection = injectScript();
    const heal = (window as unknown as { __MW_HOME_FEED_HEAL__?: (r: string) => string })
      .__MW_HOME_FEED_HEAL__;
    expect(typeof heal).toBe('function');
    const result = heal!('test_heal');
    expect(result === 'OK' || result === 'SKIP_SHORTS').toBe(true);
  });

  it('exit cleanup still clears flash residue and preserves authorized positive', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    const src = srcFor(POSITIVE_ID);

    injection.probe.applyBlur(video, src, 'porn', 40, POSITIVE_ID, 'classifier_positive');
    expect(hasBlurFilter(video)).toBe(true);

    // Stuck flash overlay that historically white-screened home after Shorts.
    const flashOverlay = document.createElement('div');
    flashOverlay.className = 'mw-flash-shorts-overlay';
    document.body.appendChild(flashOverlay);

    const result = injection.probe.performShortsExitSurfaceCleanup('test_exit_heal');
    expect(result.removedFlashOverlays).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.mw-flash-shorts-overlay')).toBeNull();
    // Authorized positive must still hold.
    expect(hasBlurFilter(video)).toBe(true);
    expect(video.dataset.mwModerated).toBe('blurred');
  });

  it('safe soft residue is cleared by exit repair (no void-positive orphan)', () => {
    const { video } = buildCard('ytm-rich-item-renderer', SAFE_ID);
    injection = injectScript();
    video.dataset.mwVeil = '1';
    video.dataset.mwModerated = 'softblur';
    video.classList.add('mw-softblur');
    video.style.setProperty('filter', 'blur(12px)', 'important');

    injection.probe.repairNonShortsBlurRevealInvariant('test_exit_soft_clear');

    expect(video.dataset.mwVeil).toBeUndefined();
    expect(hasBlurFilter(video)).toBe(false);
  });
});
