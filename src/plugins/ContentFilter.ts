import { registerPlugin } from '@capacitor/core';
import type { ContentFilterPlugin, NsfwProbabilities } from './ContentFilter.types';

export type { ContentFilterPlugin, ContentFilterRiskDecision, NsfwProbabilities } from './ContentFilter.types';

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
