import type { PluginListenerHandle } from '@capacitor/core';

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
