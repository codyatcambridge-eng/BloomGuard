import { describe, it, expect } from 'vitest';
import {
  applyAnatomicalThresholdDecision,
  applyFailOpenAndModePolicyDecision,
  shouldFailClosedPreserveBlurOnUnresolved,
  shouldHoldTransitionBlurLease,
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

describe('transition blur lease policy', () => {
  it('holds blur during transition churn while lease is active and identity is unresolved', () => {
    expect(shouldHoldTransitionBlurLease({
      isTransitionChurnReason: true,
      hasAuthoritativeBlur: true,
      hasUnresolvedIdentityOrContextGap: true,
      elapsedSinceBlurSetMs: 320,
      leaseWindowMs: 650,
    })).toBe(true);
  });

  it('does not hold when lease is expired or preconditions fail', () => {
    expect(shouldHoldTransitionBlurLease({
      isTransitionChurnReason: true,
      hasAuthoritativeBlur: true,
      hasUnresolvedIdentityOrContextGap: true,
      elapsedSinceBlurSetMs: 900,
      leaseWindowMs: 650,
    })).toBe(false);
    expect(shouldHoldTransitionBlurLease({
      isTransitionChurnReason: false,
      hasAuthoritativeBlur: true,
      hasUnresolvedIdentityOrContextGap: true,
      elapsedSinceBlurSetMs: 100,
      leaseWindowMs: 650,
    })).toBe(false);
  });
});

describe('fail-closed unresolved ownership policy', () => {
  it('preserves blur when identity is unresolved and state says blurred', () => {
    expect(shouldFailClosedPreserveBlurOnUnresolved({
      hasUnresolvedIdentityOrContextGap: true,
      hasBlurredResolution: true,
      hasSafeResolution: false,
    })).toBe(true);
  });

  it('does not preserve when safe is resolved or unresolved precondition is false', () => {
    expect(shouldFailClosedPreserveBlurOnUnresolved({
      hasUnresolvedIdentityOrContextGap: true,
      hasBlurredResolution: true,
      hasSafeResolution: true,
    })).toBe(false);
    expect(shouldFailClosedPreserveBlurOnUnresolved({
      hasUnresolvedIdentityOrContextGap: false,
      hasBlurredResolution: true,
      hasSafeResolution: false,
    })).toBe(false);
  });
});
