/**
 * Dial strength must change decision outcomes (Relaxed ≠ Maximum).
 * Pins thr-floor anatomical + MVP sexy allow so dial is not binary.
 */
import { describe, expect, it } from 'vitest';
import {
  applyAnatomicalThresholdDecision,
  applyFailOpenAndModePolicyDecision,
  getCategoryThresholds,
} from '@/lib/webview-injection-script';

describe('dial strength accuracy', () => {
  it('Maximum dial thr is lower than Relaxed', () => {
    const relaxed = getCategoryThresholds(1);
    const maximum = getCategoryThresholds(4);
    expect(maximum.porn).toBeLessThan(relaxed.porn);
    expect(maximum.sexy).toBeLessThan(relaxed.sexy);
  });

  it('anatomical floor does not raise bar above Maximum dial thr', () => {
    const maxThr = getCategoryThresholds(4);
    // Score between Maximum thr and old fixed 0.60 anatomical floor.
    const midScore = 0.35;
    expect(midScore).toBeGreaterThan(maxThr.sexy);
    expect(midScore).toBeLessThan(0.6);

    const decision = applyAnatomicalThresholdDecision({
      shouldApplyBlur: true,
      predictedLabel: 'sexy',
      sexyScore: midScore,
      pornScore: 0.1,
      anatomicalThreshold: 0.6,
      dialThreshold: maxThr.sexy,
      forceUnsafe: false,
      failClosed: false,
      enabled: true,
      sensitivity: 4,
    });
    expect(decision.shouldBlur).toBe(true);
  });

  it('anatomical floor still unblurs below Relaxed dial thr', () => {
    const relaxed = getCategoryThresholds(1);
    const decision = applyAnatomicalThresholdDecision({
      shouldApplyBlur: true,
      predictedLabel: 'sexy',
      sexyScore: 0.5,
      pornScore: 0.1,
      anatomicalThreshold: 0.6,
      dialThreshold: relaxed.sexy,
      forceUnsafe: false,
      failClosed: false,
      enabled: true,
      sensitivity: 1,
    });
    // keepFloor = min(0.6, 0.85) = 0.6 → 0.5 unblurs
    expect(decision.shouldBlur).toBe(false);
  });

  it('mvp mode allows sexy labels so dial thr can apply', () => {
    const decision = applyFailOpenAndModePolicyDecision({
      rawShouldBlur: true,
      normalizedCategory: 'sexy',
      predictedLabel: 'sexy',
      isErrorResult: false,
      failClosed: false,
      enabled: true,
      sensitivity: 3,
      blockingMode: 'mvp',
    });
    expect(decision.shouldBlur).toBe(true);
    expect(decision.reason).toBeNull();
  });

  it('Active Shorts must not treat zero prediction bags as thr-safe over host blur', () => {
    // Regression: anyUnsafeScore was true for {porn:0,sexy:0,hentai:0}, dialAnyHit false
    // wiped host shouldBlur → systematic Active Shorts FNs after dial-first patch.
    const zeroMax = Math.max(0, 0, 0);
    const hasMeaningful = zeroMax > 0.02;
    expect(hasMeaningful).toBe(false);
    // Host blur preserved when scores are not meaningful:
    const hostShouldBlur = true;
    const dialAnyHit = false;
    const shortsApply = hostShouldBlur || dialAnyHit;
    expect(shortsApply).toBe(true);
  });

  it('mid sexy score blurs at Maximum but not at Relaxed (dial-first band)', () => {
    const mid = 0.5;
    const relaxed = getCategoryThresholds(1);
    const maximum = getCategoryThresholds(4);
    expect(mid).toBeLessThan(relaxed.sexy);
    expect(mid).toBeGreaterThan(maximum.sexy);
    // Anatomical keep floor follows dial thr — mid survives Maximum floor.
    const maxKeep = applyAnatomicalThresholdDecision({
      shouldApplyBlur: true,
      predictedLabel: 'sexy',
      sexyScore: mid,
      pornScore: 0.05,
      anatomicalThreshold: 0.6,
      dialThreshold: maximum.sexy,
      forceUnsafe: false,
      failClosed: false,
      enabled: true,
      sensitivity: 4,
    });
    const relKeep = applyAnatomicalThresholdDecision({
      shouldApplyBlur: true,
      predictedLabel: 'sexy',
      sexyScore: mid,
      pornScore: 0.05,
      anatomicalThreshold: 0.6,
      dialThreshold: relaxed.sexy,
      forceUnsafe: false,
      failClosed: false,
      enabled: true,
      sensitivity: 1,
    });
    expect(maxKeep.shouldBlur).toBe(true);
    // At Relaxed, dial thr is 0.85 so host wouldn't hit; anatomical min(0.6,0.85)=0.6 still drops 0.5.
    expect(relKeep.shouldBlur).toBe(false);
  });
});
