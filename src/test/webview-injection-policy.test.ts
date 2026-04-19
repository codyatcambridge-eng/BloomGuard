import { describe, it, expect } from 'vitest';
import {
  applyAnatomicalThresholdDecision,
  applyFailOpenAndModePolicyDecision,
  shouldPreserveShortsContinuityBlur,
} from '@/lib/webview-injection-script';

describe('webview injection blur policy', () => {
  it('does not blur sexy when anatomical score is below threshold (fail-open)', () => {
    const anatomical = applyAnatomicalThresholdDecision({
      shouldApplyBlur: true,
      predictedLabel: 'sexy',
      sexyScore: 0.5,
      pornScore: 0,
      anatomicalThreshold: 0.6,
      forceUnsafe: false,
      failClosed: false,
      enabled: true,
      sensitivity: 2,
    });
    expect(anatomical.shouldBlur).toBe(false);
  });

  it('high sexy score still requires MVP-allowed category to blur', () => {
    const anatomical = applyAnatomicalThresholdDecision({
      shouldApplyBlur: true,
      predictedLabel: 'sexy',
      sexyScore: 0.8,
      pornScore: 0,
      anatomicalThreshold: 0.6,
      forceUnsafe: false,
      failClosed: false,
      enabled: true,
      sensitivity: 2,
    });
    expect(anatomical.shouldBlur).toBe(true);

    const mvpBlocked = applyFailOpenAndModePolicyDecision({
      rawShouldBlur: anatomical.shouldBlur,
      normalizedCategory: 'sexy',
      predictedLabel: 'sexy',
      isErrorResult: false,
      failClosed: false,
      enabled: true,
      sensitivity: 2,
      blockingMode: 'mvp',
    });
    expect(mvpBlocked.shouldBlur).toBe(false);
    expect(mvpBlocked.reason).toBe('mvp_filter/sexy');

    const mvpAllowed = applyFailOpenAndModePolicyDecision({
      rawShouldBlur: anatomical.shouldBlur,
      normalizedCategory: 'swimwear',
      predictedLabel: 'sexy',
      isErrorResult: false,
      failClosed: false,
      enabled: true,
      sensitivity: 2,
      blockingMode: 'mvp',
    });
    expect(mvpAllowed.shouldBlur).toBe(true);

    const mvpThirstAllowed = applyFailOpenAndModePolicyDecision({
      rawShouldBlur: anatomical.shouldBlur,
      normalizedCategory: 'thirst',
      predictedLabel: 'thirst',
      isErrorResult: false,
      failClosed: false,
      enabled: true,
      sensitivity: 2,
      blockingMode: 'mvp',
    });
    expect(mvpThirstAllowed.shouldBlur).toBe(true);
  });

  it('timeout is fail-open when failClosed=false', () => {
    const timeoutDecision = applyFailOpenAndModePolicyDecision({
      rawShouldBlur: false,
      normalizedCategory: 'timeout',
      predictedLabel: 'timeout',
      isErrorResult: true,
      failClosed: false,
      enabled: true,
      sensitivity: 2,
      blockingMode: 'mvp',
    });
    expect(timeoutDecision.shouldBlur).toBe(false);
    expect(timeoutDecision.reason).toBe('failOpen/timeout');
  });

  it('timeout blurs when failClosed=true', () => {
    const timeoutDecision = applyFailOpenAndModePolicyDecision({
      rawShouldBlur: false,
      normalizedCategory: 'timeout',
      predictedLabel: 'timeout',
      isErrorResult: true,
      failClosed: true,
      enabled: true,
      sensitivity: 2,
      blockingMode: 'mvp',
    });
    expect(timeoutDecision.shouldBlur).toBe(true);
    expect(timeoutDecision.reason).toBe('failClosed/timeout');
  });
});

describe('shorts continuity grace policy', () => {
  it('preserves blur only for shorts churn with transient gaps inside grace window', () => {
    expect(shouldPreserveShortsContinuityBlur({
      isHomeShortsShelfVideo: true,
      isTransitionChurnReason: true,
      hasTransientIdentityOrContextGap: true,
      elapsedSinceAuthoritativeBlurMs: 350,
      graceWindowMs: 1200,
    })).toBe(true);
  });

  it('fails closed when grace preconditions are not met', () => {
    expect(shouldPreserveShortsContinuityBlur({
      isHomeShortsShelfVideo: false,
      isTransitionChurnReason: true,
      hasTransientIdentityOrContextGap: true,
      elapsedSinceAuthoritativeBlurMs: 100,
      graceWindowMs: 1200,
    })).toBe(false);
    expect(shouldPreserveShortsContinuityBlur({
      isHomeShortsShelfVideo: true,
      isTransitionChurnReason: false,
      hasTransientIdentityOrContextGap: true,
      elapsedSinceAuthoritativeBlurMs: 100,
      graceWindowMs: 1200,
    })).toBe(false);
    expect(shouldPreserveShortsContinuityBlur({
      isHomeShortsShelfVideo: true,
      isTransitionChurnReason: true,
      hasTransientIdentityOrContextGap: true,
      elapsedSinceAuthoritativeBlurMs: 1800,
      graceWindowMs: 1200,
    })).toBe(false);
  });
});
