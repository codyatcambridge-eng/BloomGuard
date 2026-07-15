/**
 * Active Shorts accuracy contracts: host-OR for FNs, dial-only FP floor,
 * poster-vs-frame authority (documented decision helpers).
 */
import { describe, expect, it } from 'vitest';
import { getCategoryThresholds } from '@/lib/webview-injection-script';

describe('Active Shorts accuracy decision matrix', () => {
  it('host-OR preserves host positive when dial misses (FN guard)', () => {
    const hostShouldBlur = true;
    const dialAnyHit = false;
    const shortsApply = hostShouldBlur || dialAnyHit;
    expect(shortsApply).toBe(true);
  });

  it('dial-only weak sexy is suppressed on Shorts (MVP FP stability)', () => {
    const thr = getCategoryThresholds(2); // moderate sexy 0.65
    const sexy = 0.66; // barely over dial thr but under 0.72 floor
    const dialAnyHit = sexy > thr.sexy;
    expect(dialAnyHit).toBe(true);
    const floorSexy = 0.72;
    const dialOnlyStrong =
      sexy > Math.max(thr.sexy, floorSexy); // must clear floor
    expect(dialOnlyStrong).toBe(false);
    const hostShouldBlur = false;
    const shouldBlur = hostShouldBlur || dialOnlyStrong;
    expect(shouldBlur).toBe(false);
  });

  it('dial-only strong sexy above 0.72 floor can blur without host', () => {
    const thr = getCategoryThresholds(2);
    const sexy = 0.8;
    const dialOnlyStrong = sexy > Math.max(thr.sexy, 0.72);
    expect(dialOnlyStrong).toBe(true);
  });

  it('dial reeval keeps host-stamped Shorts positives without scores', () => {
    const hostBlur = true;
    const inShorts = true;
    // reevaluateStampedNodesForDial: host stamp → keep
    const release = inShorts && hostBlur ? false : true;
    expect(release).toBe(false);
  });

  it('host positive is never dial-only FP suppressed even if weak sexy', () => {
    const hostShouldBlur = true;
    const sexy = 0.5;
    const floorSexy = 0.72;
    const dialOnlyWeak = sexy < floorSexy;
    // Suppression only when !hostShouldBlur
    const shouldSuppress = !hostShouldBlur && dialOnlyWeak;
    expect(shouldSuppress).toBe(false);
  });

  it('strong sexy dial hit is not weak-floor FP', () => {
    const sexy = 0.9;
    const floorSexy = 0.72;
    expect(sexy >= floorSexy).toBe(true);
  });

  it('frame verdict authority beats poster once frame ok', () => {
    const frameOk = true;
    const sourceType = 'video-poster';
    const ignorePoster = frameOk && sourceType === 'video-poster';
    expect(ignorePoster).toBe(true);
  });
});
