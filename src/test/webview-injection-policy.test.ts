import { describe, it, expect } from 'vitest';
import {
  applyAnatomicalThresholdDecision,
  applyFailOpenAndModePolicyDecision,
  generateModerationScript,
  shouldAllowNonShortsOverlaySrcFallbackReuse,
  shouldForceRecycleDecontaminateByItemKey,
  shouldHoldNonShortsTransitionClear,
  shouldPreserveShortsContinuityBlur,
} from '@/lib/webview-injection-script';

describe('webview injection blur policy', () => {
  it('generated moderation script is syntactically valid for mvp config', () => {
    const script = generateModerationScript({
      sensitivity: 3,
      blurStrength: 20,
      enabled: true,
      nonce: 'n_test_nonce',
      blockingMode: 'mvp',
      pageEpoch: 5,
      diagYouTubeShorts: false,
    });

    expect(() => new Function(script)).not.toThrow();
  });

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

describe('non-shorts recycle and overlay safety policy', () => {
  it('forces recycle decontaminate only when both item keys are known and different', () => {
    expect(shouldForceRecycleDecontaminateByItemKey({
      previousItemKey: 'abc123',
      nextItemKey: 'xyz789',
    })).toBe(true);
    expect(shouldForceRecycleDecontaminateByItemKey({
      previousItemKey: 'abc123',
      nextItemKey: 'abc123',
    })).toBe(false);
    expect(shouldForceRecycleDecontaminateByItemKey({
      previousItemKey: 'unknown',
      nextItemKey: 'abc123',
    })).toBe(false);
    expect(shouldForceRecycleDecontaminateByItemKey({
      previousItemKey: 'abc123',
      nextItemKey: 'unknown',
    })).toBe(false);
  });

  it('allows non-shorts overlay src fallback reuse only with authoritative ownership proof', () => {
    expect(shouldAllowNonShortsOverlaySrcFallbackReuse({
      authoritativeHardBlur: false,
      overlayNodeIdMatches: true,
      anchoredToTarget: true,
      singleOverlayInParent: true,
    })).toBe(false);
    expect(shouldAllowNonShortsOverlaySrcFallbackReuse({
      authoritativeHardBlur: true,
      overlayNodeIdMatches: true,
      anchoredToTarget: false,
      singleOverlayInParent: false,
    })).toBe(true);
    expect(shouldAllowNonShortsOverlaySrcFallbackReuse({
      authoritativeHardBlur: true,
      overlayNodeIdMatches: false,
      anchoredToTarget: true,
      singleOverlayInParent: true,
    })).toBe(true);
    expect(shouldAllowNonShortsOverlaySrcFallbackReuse({
      authoritativeHardBlur: true,
      overlayNodeIdMatches: false,
      anchoredToTarget: true,
      singleOverlayInParent: false,
    })).toBe(false);
  });
});

describe('non-shorts unresolved transition clear hold policy', () => {
  it('holds clear only for regular-main unresolved churn with blur + classification lock', () => {
    expect(shouldHoldNonShortsTransitionClear({
      isMainSurfaceUrl: true,
      regularPathQuarantinePassed: true,
      isHomeShortsShelfVideo: false,
      isTransitionChurnReason: true,
      strictContinuityItemKey: 'unknown',
      reattachItemKey: 'unknown',
      hasContextData: false,
      hasAnyBlur: true,
      classificationLocked: true,
      hasOwnershipProof: true,
    })).toBe(true);
  });

  it('does not hold clear for unresolved churn when classification is not locked', () => {
    expect(shouldHoldNonShortsTransitionClear({
      isMainSurfaceUrl: true,
      regularPathQuarantinePassed: true,
      isHomeShortsShelfVideo: false,
      isTransitionChurnReason: true,
      strictContinuityItemKey: 'unknown',
      reattachItemKey: 'unknown',
      hasContextData: false,
      hasAnyBlur: true,
      classificationLocked: false,
      hasOwnershipProof: true,
    })).toBe(false);
  });

  it('does not hold clear for shorts path', () => {
    expect(shouldHoldNonShortsTransitionClear({
      isMainSurfaceUrl: true,
      regularPathQuarantinePassed: true,
      isHomeShortsShelfVideo: true,
      isTransitionChurnReason: true,
      strictContinuityItemKey: 'unknown',
      reattachItemKey: 'unknown',
      hasContextData: false,
      hasAnyBlur: true,
      classificationLocked: true,
      hasOwnershipProof: true,
    })).toBe(false);
  });

  it('does not hold clear when ownership proof is missing', () => {
    expect(shouldHoldNonShortsTransitionClear({
      isMainSurfaceUrl: true,
      regularPathQuarantinePassed: true,
      isHomeShortsShelfVideo: false,
      isTransitionChurnReason: true,
      strictContinuityItemKey: 'unknown',
      reattachItemKey: 'unknown',
      hasContextData: false,
      hasAnyBlur: true,
      classificationLocked: true,
      hasOwnershipProof: false,
    })).toBe(false);
  });
});

describe('mvp transition stability regression markers', () => {
  it('includes stale epoch guards for non-shorts transition ordering', () => {
    const script = generateModerationScript({
      sensitivity: 4,
      blurStrength: 20,
      enabled: true,
      nonce: 'n_test_nonce',
      blockingMode: 'mvp',
      pageEpoch: 7,
      diagYouTubeShorts: false,
    });
    expect(script.includes('transitionStaleEpochSkipped')).toBe(true);
    expect(script.includes('scope=node_guard')).toBe(true);
  });

  it('includes unresolved positive same-src clear veto path', () => {
    const script = generateModerationScript({
      sensitivity: 4,
      blurStrength: 20,
      enabled: true,
      nonce: 'n_test_nonce',
      blockingMode: 'mvp',
      pageEpoch: 7,
      diagYouTubeShorts: false,
    });
    expect(script.includes('same_src_clear_veto')).toBe(true);
    expect(script.includes('mwRegularClearVetoUntil')).toBe(true);
  });

  it('includes overlay removal veto while regular positive hold is active', () => {
    const script = generateModerationScript({
      sensitivity: 4,
      blurStrength: 20,
      enabled: true,
      nonce: 'n_test_nonce',
      blockingMode: 'mvp',
      pageEpoch: 7,
      diagYouTubeShorts: false,
    });
    expect(script.includes('regular_main_overlay_remove_veto_positive_hold')).toBe(true);
    expect(script.includes('MW-MVP-REGULAR-THUMB-POSITIVE-HOLD-OVERLAY-VETO-V1')).toBe(true);
  });
});
