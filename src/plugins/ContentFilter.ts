import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export interface NsfwProbabilities {
  Porn: number;
  Hentai: number;
  Sexy: number;
  Neutral: number;
  Drawing: number;
}

export interface ContentFilterRiskDecision {
  state: 'SAFE' | 'SOFT_BLUR' | 'HARD_BLUR' | 'REVEAL_TEMP' | 'COOLDOWN';
  riskScore: number;
  nsfwScore: number;
  segmentationScore: number;
  shouldSoftBlur: boolean;
  shouldHardBlur: boolean;
  shouldBlur: boolean;
  fps: number;
  reason: string;
  timestamp: number;
}

export interface ContentFilterPlugin {
  startScanning(options?: {
    preset?: 'balanced' | 'strict' | 'relaxed';
    kidMode?: boolean;
    debug?: boolean;
    fps?: number;
    hysteresisOnMs?: number;
    hysteresisOffMs?: number;
    nsfwWeight?: number;
    segmentationWeight?: number;
    onThreshold?: number;
    offThreshold?: number;
    frameDeltaThreshold?: number;
    allowRevealDuringHardBlur?: boolean;
    revealDurationSeconds?: number;
  }): Promise<Record<string, unknown>>;
  stopScanning(): Promise<Record<string, unknown>>;
  getCounters(): Promise<{
    softBlurCount: number;
    hardBlurCount: number;
  }>;
  resetCounters(): Promise<Record<string, unknown>>;
  setNSFWSignal(options: {
    score: number;
    probs?: NsfwProbabilities;
  }): Promise<void>;
  addListener(
    eventName: 'riskDecision',
    listenerFunc: (event: ContentFilterRiskDecision) => void,
  ): Promise<PluginListenerHandle>;
}

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const calculateNsfwRiskScore = (probs: NsfwProbabilities): number => {
  // Keep native as source of truth; this is a lightweight JS-side proxy score.
  const explicit = Math.max(clamp01(probs.Porn), clamp01(probs.Hentai));
  const suggestive = clamp01(probs.Sexy);
  return clamp01(explicit * 0.8 + suggestive * 0.45);
};

export const normalizeNsfwProbabilities = (
  partial?: Partial<NsfwProbabilities>,
): NsfwProbabilities => ({
  Porn: clamp01(partial?.Porn ?? 0),
  Hentai: clamp01(partial?.Hentai ?? 0),
  Sexy: clamp01(partial?.Sexy ?? 0),
  Neutral: clamp01(partial?.Neutral ?? 0),
  Drawing: clamp01(partial?.Drawing ?? 0),
});

export const ContentFilter = registerPlugin<ContentFilterPlugin>('ContentFilter', {
  web: () => import('./ContentFilterWeb').then((m) => new m.ContentFilterWeb()),
});

export const startScanning = (options?: Parameters<ContentFilterPlugin['startScanning']>[0]) =>
  ContentFilter.startScanning(options);

export const stopScanning = () => ContentFilter.stopScanning();
export const getCounters = () => ContentFilter.getCounters();
export const resetCounters = () => ContentFilter.resetCounters();

export const setNSFWSignal = async (probs: Partial<NsfwProbabilities>) => {
  const normalized = normalizeNsfwProbabilities(probs);
  const score = calculateNsfwRiskScore(normalized);
  await ContentFilter.setNSFWSignal({ score, probs: normalized });
};

export const onRiskDecision = (
  listener: Parameters<ContentFilterPlugin['addListener']>[1],
) => ContentFilter.addListener('riskDecision', listener);
