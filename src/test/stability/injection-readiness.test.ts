import { describe, expect, it } from 'vitest';
import {
  getInjectionReadinessVerdict,
  isInjectionExecutionResultReadinessProof,
} from '@/lib/injection-readiness';

const context = {
  activeUrl: 'https://m.youtube.com/results?search_query=bloom',
  activePageEpoch: 42,
};

describe('Phase 0 injection readiness gate', () => {
  it('dispatch success without ACK does not prove injection readiness', () => {
    expect(isInjectionExecutionResultReadinessProof('MW_INJECTED')).toBe(false);
  });

  it('OK_EPOCH_RESYNCED does not prove injection readiness', () => {
    expect(isInjectionExecutionResultReadinessProof('OK_EPOCH_RESYNCED')).toBe(false);
  });

  it('OK_NO_CHANGE does not prove injection readiness by itself', () => {
    expect(isInjectionExecutionResultReadinessProof('OK_NO_CHANGE')).toBe(false);
  });

  it('null native result does not prove injection readiness', () => {
    expect(isInjectionExecutionResultReadinessProof(null)).toBe(false);
  });

  it('valid current-epoch ACK proves injection readiness', () => {
    const verdict = getInjectionReadinessVerdict(
      {
        type: 'MW_INJECTED_ACK',
        pageEpoch: 42,
        url: 'https://m.youtube.com/results?search_query=bloom',
        timestamp: Date.now(),
      },
      context,
    );

    expect(verdict.accepted).toBe(true);
    expect(verdict.signal).toBe('MW_INJECTED_ACK');
  });

  it('valid current-epoch blur-ready proves injection readiness', () => {
    const verdict = getInjectionReadinessVerdict(
      {
        type: 'MW_BLUR_READY',
        pageEpoch: 42,
        url: 'https://m.youtube.com/results?search_query=bloom',
        timestamp: Date.now(),
      },
      context,
    );

    expect(verdict.accepted).toBe(true);
    expect(verdict.signal).toBe('MW_BLUR_READY');
  });

  it('refresh or foreground recovery can reject stale liveness and re-trigger injection', () => {
    const verdict = getInjectionReadinessVerdict(
      {
        type: 'MW_INJECTED_ACK',
        pageEpoch: 41,
        url: 'https://m.youtube.com/results?search_query=bloom',
        timestamp: Date.now(),
      },
      context,
    );

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe('stale_or_missing_epoch');
  });

  it('stale current-page URL does not prove injection readiness', () => {
    const verdict = getInjectionReadinessVerdict(
      {
        type: 'MW_INJECTED_ACK',
        pageEpoch: 42,
        url: 'https://m.youtube.com/watch?v=stale',
        timestamp: Date.now(),
      },
      context,
    );

    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toBe('stale_or_missing_url');
  });
});
