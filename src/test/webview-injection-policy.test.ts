import { describe, it, expect } from 'vitest';
import {
  applyAnatomicalThresholdDecision,
  applyFailOpenAndModePolicyDecision,
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
