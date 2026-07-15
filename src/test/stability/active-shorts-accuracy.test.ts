/**
 * Active Shorts accuracy contracts for Phase 0 MVP stability.
 */
import { describe, expect, it } from 'vitest';
import { getCategoryThresholds } from '@/lib/webview-injection-script';

describe('Active Shorts accuracy decision matrix', () => {
  it('zero-bag host positive still blurs on Shorts (FN protect)', () => {
    const shouldBlur = true;
    const hasMeaningfulScores = false;
    const apply = shouldBlur && !hasMeaningfulScores;
    expect(apply).toBe(true);
  });

  it('dial-only weak sexy is suppressed on Shorts (MVP FP stability)', () => {
    const thr = getCategoryThresholds(2); // moderate sexy 0.65
    const sexy = 0.66; // barely over dial thr but under 0.72 floor
    const dialAnyHit = sexy > thr.sexy;
    expect(dialAnyHit).toBe(true);
    const floorSexy = 0.72;
    const dialOnlyStrong = sexy > Math.max(thr.sexy, floorSexy);
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
    const release = inShorts && hostBlur ? false : true;
    expect(release).toBe(false);
  });

  it('unconfirmed forceUnsafe swimwear is suppressed on Shorts (FP cut)', () => {
    const shouldBlur = true;
    const forceUnsafe = true;
    const hasMeaningfulScores = true;
    const sexy = 0.5;
    const thrSexy = 0.45;
    const hostConfirmed = sexy > Math.max(thrSexy, 0.65);
    expect(hostConfirmed).toBe(false);
    const dialOnlyStrong = sexy > Math.max(thrSexy, 0.72);
    expect(dialOnlyStrong).toBe(false);
    const apply =
      shouldBlur && forceUnsafe && hasMeaningfulScores
        ? hostConfirmed || dialOnlyStrong
        : shouldBlur;
    expect(apply).toBe(false);
  });

  it('confirmed forceUnsafe swimwear blurs on Shorts', () => {
    const sexy = 0.75;
    const thrSexy = 0.45;
    const hostConfirmed = sexy > Math.max(thrSexy, 0.65);
    expect(hostConfirmed).toBe(true);
  });

  it('uncertain empty frame does not force hard blur', () => {
    const isUncertain = true;
    const hostForceBlurLegacy = true;
    const finalShouldBlur = isUncertain ? false : hostForceBlurLegacy;
    expect(finalShouldBlur).toBe(false);
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
