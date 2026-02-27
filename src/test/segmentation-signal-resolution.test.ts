import { describe, expect, it } from 'vitest';
import { resolveSegmentationSignal } from '@/lib/segmentation-signal';

describe('segmentation signal resolution', () => {
  it('auto-heals persisted false to true in DEV when no explicit dev override is set', () => {
    const resolved = resolveSegmentationSignal({
      isDevBuild: true,
      defaultEnabled: true,
      hasPersistedValue: true,
      persistedValue: false,
      devOverrideValue: null,
    });

    expect(resolved.enabled).toBe(true);
    expect(resolved.autoHealed).toBe(true);
    expect(resolved.source).toBe('policy');
    expect(resolved.disabledSource).toBe('none');
    expect(resolved.disabledReason).toBe('none');
  });

  it('allows an explicit dev override to disable segmentation in DEV', () => {
    const resolved = resolveSegmentationSignal({
      isDevBuild: true,
      defaultEnabled: true,
      hasPersistedValue: true,
      persistedValue: true,
      devOverrideValue: false,
    });

    expect(resolved.enabled).toBe(false);
    expect(resolved.source).toBe('policy');
    expect(resolved.disabledSource).toBe('policy');
    expect(resolved.disabledReason).toBe('dev_override_disabled');
  });
});
