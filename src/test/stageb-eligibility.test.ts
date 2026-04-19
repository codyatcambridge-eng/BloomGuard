import { describe, expect, it } from 'vitest';
import { evaluateStageBEligibility } from '@/hooks/useOnDeviceModeration';

describe('Stage-B eligibility gating', () => {
  it('allows Stage-B in gray zone when enabled', () => {
    const decision = evaluateStageBEligibility({
      segmentationEnabled: true,
      strictMode: false,
      grayZoneOnly: true,
      inGrayZone: true,
      forceOverride: false,
    });
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBe('eligible');
  });

  it('blocks Stage-B outside gray zone when gray-zone-only and non-strict', () => {
    const decision = evaluateStageBEligibility({
      segmentationEnabled: true,
      strictMode: false,
      grayZoneOnly: true,
      inGrayZone: false,
      forceOverride: false,
    });
    expect(decision.eligible).toBe(false);
    expect(decision.reason).toBe('gray_zone_gate');
  });

  it('strict mode forces Stage-B attempt even outside gray zone', () => {
    const decision = evaluateStageBEligibility({
      segmentationEnabled: true,
      strictMode: true,
      grayZoneOnly: true,
      inGrayZone: false,
      forceOverride: false,
    });
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBe('eligible');
  });

  it('dev override forces Stage-B attempt regardless feature flag/gate', () => {
    const decision = evaluateStageBEligibility({
      segmentationEnabled: false,
      strictMode: false,
      grayZoneOnly: true,
      inGrayZone: false,
      forceOverride: true,
    });
    expect(decision.eligible).toBe(true);
    expect(decision.reason).toBe('forced_override');
  });
});
