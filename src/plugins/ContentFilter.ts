import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';

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

export interface ContentFilterNativePrediction {
  predictions: Record<string, number>;
  confidence: number;
  inferenceTimeMs: number;
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
  classifyImage(options: { imageBase64: string }): Promise<ContentFilterNativePrediction>;
  isModelReady(): Promise<{ ready: boolean }>;
  addListener(
    eventName: 'riskDecision',
    listenerFunc: (event: ContentFilterRiskDecision) => void,
  ): Promise<PluginListenerHandle>;
}

const CHUNK_SIZE = 0x8000;

const bufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const fetchAsBase64 = async (url: string): Promise<string> => {
  if (url.startsWith('data:')) {
    const idx = url.indexOf(',');
    return idx >= 0 ? url.slice(idx + 1) : url;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image for native classification: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return bufferToBase64(buffer);
};

export const imageSourceToBase64 = async (
  source: HTMLImageElement | HTMLCanvasElement,
): Promise<string> => {
  if (source instanceof HTMLCanvasElement) {
    const dataUrl = source.toDataURL('image/jpeg', 0.85);
    const idx = dataUrl.indexOf(',');
    return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  }

  const img = source as HTMLImageElement;
  const src = img.currentSrc || img.src;
  if (!src) {
    throw new Error('Image element has no `src` value');
  }
  return fetchAsBase64(src);
};

export const isNativeContentFilterAvailable = (): boolean => Capacitor.isNativePlatform();

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

export const isNativeModelReady = () => ContentFilter.isModelReady();
