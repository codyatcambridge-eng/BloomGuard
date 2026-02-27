export const DEV_SEGMENTATION_SIGNAL_OVERRIDE_KEY = 'MW_DEV_SEGMENTATION_SIGNAL_OVERRIDE';

export type SegmentationSignalSource = 'default' | 'persisted' | 'policy';

export type SegmentationSignalDisabledReason =
  | 'none'
  | 'default_disabled'
  | 'persisted_disabled'
  | 'dev_override_disabled'
  | 'policy_disabled';

export interface ResolveSegmentationSignalInput {
  isDevBuild: boolean;
  defaultEnabled: boolean;
  hasPersistedValue: boolean;
  persistedValue: boolean | null;
  devOverrideValue: boolean | null;
}

export interface SegmentationSignalResolution {
  enabled: boolean;
  source: SegmentationSignalSource;
  disabledSource: SegmentationSignalSource | 'none';
  disabledReason: SegmentationSignalDisabledReason;
  autoHealed: boolean;
  hasPersistedValue: boolean;
  persistedValue: boolean | null;
  devOverrideValue: boolean | null;
}

const TRUE_VALUES = new Set(['1', 'true', 'on', 'enabled', 'yes']);
const FALSE_VALUES = new Set(['0', 'false', 'off', 'disabled', 'no']);

export const parseBooleanLike = (raw: string | null | undefined): boolean | null => {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
};

export const readDevSegmentationSignalOverride = (): boolean | null => {
  if (typeof window === 'undefined') return null;
  try {
    return parseBooleanLike(window.localStorage.getItem(DEV_SEGMENTATION_SIGNAL_OVERRIDE_KEY));
  } catch {
    return null;
  }
};

export const resolveSegmentationSignal = (
  input: ResolveSegmentationSignalInput,
): SegmentationSignalResolution => {
  const baselineSource: SegmentationSignalSource = input.hasPersistedValue ? 'persisted' : 'default';
  const baselineEnabled = input.hasPersistedValue
    ? input.persistedValue === true
    : input.defaultEnabled === true;

  let enabled = baselineEnabled;
  let source: SegmentationSignalSource = baselineSource;
  let autoHealed = false;

  if (input.isDevBuild) {
    if (input.devOverrideValue === false) {
      enabled = false;
      source = 'policy';
    } else if (input.devOverrideValue === true) {
      enabled = true;
      source = 'policy';
      autoHealed = !baselineEnabled;
    } else if (!baselineEnabled) {
      enabled = true;
      source = 'policy';
      autoHealed = true;
    }
  }

  let disabledSource: SegmentationSignalSource | 'none' = 'none';
  let disabledReason: SegmentationSignalDisabledReason = 'none';
  if (!enabled) {
    disabledSource = source;
    if (source === 'default') {
      disabledReason = 'default_disabled';
    } else if (source === 'persisted') {
      disabledReason = 'persisted_disabled';
    } else {
      disabledReason = input.isDevBuild && input.devOverrideValue === false
        ? 'dev_override_disabled'
        : 'policy_disabled';
    }
  }

  return {
    enabled,
    source,
    disabledSource,
    disabledReason,
    autoHealed,
    hasPersistedValue: input.hasPersistedValue,
    persistedValue: input.hasPersistedValue ? input.persistedValue : null,
    devOverrideValue: input.devOverrideValue,
  };
};
