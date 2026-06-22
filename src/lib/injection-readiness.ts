export type InjectionReadinessSignal = 'MW_INJECTED_ACK' | 'MW_BLUR_READY';

export interface InjectionReadinessContext {
  activeUrl: string;
  activePageEpoch: number;
}

export interface InjectionReadinessVerdict {
  accepted: boolean;
  reason: string;
  signal?: InjectionReadinessSignal;
}

function normalizeUrlForReadiness(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return trimmed.replace(/#.*$/, '');
  }
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export function getInjectionReadinessVerdict(
  message: unknown,
  context: InjectionReadinessContext,
): InjectionReadinessVerdict {
  if (!message || typeof message !== 'object') {
    return { accepted: false, reason: 'not_object' };
  }

  const typed = message as Record<string, unknown>;
  const type = typed.type;
  if (type !== 'MW_INJECTED_ACK' && type !== 'MW_BLUR_READY') {
    return { accepted: false, reason: 'unsupported_signal' };
  }

  const expectedEpoch = readFiniteNumber(context.activePageEpoch);
  const messageEpoch = readFiniteNumber(typed.pageEpoch);
  if (expectedEpoch === null || messageEpoch === null || messageEpoch !== expectedEpoch) {
    return {
      accepted: false,
      reason: 'stale_or_missing_epoch',
      signal: type,
    };
  }

  const expectedUrl = normalizeUrlForReadiness(context.activeUrl);
  const messageUrl = normalizeUrlForReadiness(String(typed.url || ''));
  if (expectedUrl && (!messageUrl || messageUrl !== expectedUrl)) {
    return {
      accepted: false,
      reason: 'stale_or_missing_url',
      signal: type,
    };
  }

  return {
    accepted: true,
    reason: 'current_epoch_url_ready',
    signal: type,
  };
}

export function isInjectionExecutionResultReadinessProof(_result: string | null): boolean {
  return false;
}
