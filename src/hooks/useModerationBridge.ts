import { useState, useCallback, useRef, useEffect } from 'react';
import { useOnDeviceModeration, ModerationResult } from '@/hooks/useOnDeviceModeration';
import { useLocalSettings } from '@/hooks/useLocalSettings';
import { 
  ModerationScanResult, 
  ModerationCategory,
  calculateCategory,
} from '@/plugins/ModerationBridge';
import { isBlurOverlayReadyMessage, mapModerationCategoryToSeverity } from '@/lib/moderation-request-utils';

export interface ModerationBridgeState {
  isReady: boolean;
  isScanning: boolean;
  scannedCount: number;
  blurredCount: number;
  pendingCount: number;
  lastScanTime: number;
  error: string | null;
}

export interface UseModerationBridgeOptions {
  onImageBlurred?: (src: string, result: ModerationScanResult) => void;
  onScanComplete?: (stats: { total: number; blurred: number; safe: number }) => void;
  onSignal?: (probs: {
    Porn: number;
    Hentai: number;
    Sexy: number;
    Neutral: number;
    Drawing: number;
  }) => void;
  onError?: (error: string) => void;
}

export const isWebViewBlurReadyEvent = (message: unknown): boolean => {
  return isBlurOverlayReadyMessage(message);
};

/**
 * Hook for managing the moderation bridge between WebView and AI model
 * Handles scan requests from injected JavaScript and returns results
 */
export const useModerationBridge = (options: UseModerationBridgeOptions = {}) => {
  const { onImageBlurred, onScanComplete, onSignal, onError } = options;
  
  const [state, setState] = useState<ModerationBridgeState>({
    isReady: false,
    isScanning: false,
    scannedCount: 0,
    blurredCount: 0,
    pendingCount: 0,
    lastScanTime: 0,
    error: null,
  });

  const scanQueue = useRef<Array<{ src: string; meta?: { lastModified?: number | string; contentLength?: number } }>>([]);
  const resultsCache = useRef<Map<string, ModerationScanResult>>(new Map());
  const processingRef = useRef(0);
  const maxConcurrent = 4;
  const buildCacheKey = useCallback((src: string, meta?: { lastModified?: number | string; contentLength?: number }) => {
    const parts = [src];
    if (meta?.lastModified !== undefined && meta?.lastModified !== null) {
      parts.push(`lm:${meta.lastModified}`);
    }
    if (typeof meta?.contentLength === 'number' && Number.isFinite(meta.contentLength)) {
      parts.push(`cl:${meta.contentLength}`);
    }
    return parts.join('|');
  }, []);

  const { isReady: modelReady, classifyImage, modelState } = useOnDeviceModeration();
  const { settings, getDialThresholds, isModerationEnabled, getModerationConfig } = useLocalSettings();

  // Update ready state when model loads
  useEffect(() => {
    setState(prev => ({ ...prev, isReady: modelReady }));
    if (modelReady) {
      console.debug('[MW-Bridge] AI model ready for scanning');
    }
  }, [modelReady]);

  /**
   * Convert NSFWJS result to our ModerationScanResult format
   */
  const convertResult = useCallback((src: string, result: ModerationResult, inferenceTime: number): ModerationScanResult => {
    const predictions: Record<string, number> = {};
    result.predictions.forEach(p => {
      predictions[p.className] = p.probability;
    });

    const pornScore = predictions.Porn ?? predictions.porn ?? 0;
    const sexyScore = predictions.Sexy ?? predictions.sexy ?? 0;
    const hentaiScore = predictions.Hentai ?? predictions.hentai ?? 0;

    let category = calculateCategory(predictions);

    // Keep category aligned with blur decisions so downstream JS doesn't discard unsafe hits.
    if (result.reason === 'swimwear_detected') {
      category = 'swimwear';
    } else if (
      result.shouldBlur &&
      (category === 'safe' || category === 'neutral' || category === 'drawing')
    ) {
      if (pornScore >= hentaiScore && pornScore >= sexyScore) {
        category = 'porn';
      } else if (hentaiScore >= pornScore && hentaiScore >= sexyScore) {
        category = 'hentai';
      } else {
        category = 'sexy';
      }
    }

    return {
      src,
      shouldBlur: result.shouldBlur,
      category,
      confidence: result.confidence,
      severity: mapModerationCategoryToSeverity(category),
      predictions,
      inferenceTime,
    };
  }, []);

  /**
   * Scan a single image and return result
   */
  const scanImage = useCallback(async (
    src: string,
    thresholds?: { porn: number; sexy: number; hentai: number },
    meta?: { lastModified?: number | string; contentLength?: number },
  ): Promise<ModerationScanResult | null> => {
    if (!modelReady) {
      console.debug('[MW-Bridge] Model not ready, skipping scan');
      return null;
    }
    
    if (!isModerationEnabled()) {
      console.debug('[MW-Bridge] Moderation disabled, skipping scan');
      return null;
    }

    const cacheKey = buildCacheKey(src, meta);

    // Invalidate cache entries when metadata changes for same src
    for (const key of Array.from(resultsCache.current.keys())) {
      if ((key === src || key.startsWith(src + '|')) && key !== cacheKey) {
        resultsCache.current.delete(key);
      }
    }

    // Check cache
    if (resultsCache.current.has(cacheKey)) {
      console.debug('[MW-Bridge] Cache hit:', cacheKey.substring(0, 50));
      return resultsCache.current.get(cacheKey)!;
    }

    const effectiveThresholds = thresholds || getDialThresholds();
    const startTime = performance.now();

    try {
      console.debug('[MW-Bridge] Scanning:', src.substring(0, 60));
      const result = await classifyImage(src, effectiveThresholds);
      const inferenceTime = performance.now() - startTime;
      
      if (!result) {
        console.debug('[MW-Bridge] No result from classifier');
        return null;
      }

      const scanResult = convertResult(src, result, inferenceTime);
      resultsCache.current.set(cacheKey, scanResult);

      onSignal?.({
        Porn: scanResult.predictions?.Porn ?? scanResult.predictions?.porn ?? 0,
        Hentai: scanResult.predictions?.Hentai ?? scanResult.predictions?.hentai ?? 0,
        Sexy: scanResult.predictions?.Sexy ?? scanResult.predictions?.sexy ?? 0,
        Neutral: scanResult.predictions?.Neutral ?? scanResult.predictions?.neutral ?? 0,
        Drawing: scanResult.predictions?.Drawing ?? scanResult.predictions?.drawing ?? 0,
      });

      // Update state
      setState(prev => ({
        ...prev,
        scannedCount: prev.scannedCount + 1,
        blurredCount: prev.blurredCount + (scanResult.shouldBlur ? 1 : 0),
        lastScanTime: inferenceTime,
      }));

      if (scanResult.shouldBlur) {
        console.debug('[MW-Bridge] BLUR:', src.substring(0, 50), '->', scanResult.category);
        onImageBlurred?.(src, scanResult);
      } else {
        console.debug('[MW-Bridge] SAFE:', src.substring(0, 50), '->', scanResult.category);
      }

      return scanResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Scan failed';
      const code = (error as any)?.code || (error instanceof Error ? error.name : '');
      const isNpuOffline = String(code).toUpperCase() === 'NPU_OFFLINE' || errorMsg.toUpperCase().includes('NPU_OFFLINE');
      console.debug('[MW-Bridge] Scan error:', src.substring(0, 50), errorMsg);

      const fallback: ModerationScanResult = {
        src,
        shouldBlur: true,
        category: isNpuOffline ? 'error_npu_offline' as any : 'error' as any,
        confidence: 1,
        severity: 'hard',
        predictions: {},
        inferenceTime: performance.now() - startTime,
      };
      setState(prev => ({
        ...prev,
        error: isNpuOffline ? 'NPU_OFFLINE' : 'SCAN_ERROR',
        blurredCount: prev.blurredCount + 1,
        scannedCount: prev.scannedCount + 1,
      }));
      return fallback;
    }
  }, [modelReady, isModerationEnabled, getDialThresholds, classifyImage, convertResult, onImageBlurred, onSignal, buildCacheKey]);

  /**
   * Process scan queue with concurrency limit
   */
  const processQueue = useCallback(async () => {
    while (processingRef.current < maxConcurrent && scanQueue.current.length > 0) {
      const item = scanQueue.current.shift();
      if (!item) continue;
      const cacheKey = buildCacheKey(item.src, item.meta);
      if (!resultsCache.current.has(cacheKey)) {
        processingRef.current++;
        
        scanImage(item.src, undefined, item.meta).finally(() => {
          processingRef.current--;
          setState(prev => ({
            ...prev,
            pendingCount: scanQueue.current.length + processingRef.current,
          }));
          processQueue();
        });
      }
    }
  }, [scanImage, buildCacheKey]);

  /**
   * Queue an image for scanning
   */
  const queueScan = useCallback((src: string, meta?: { lastModified?: number | string; contentLength?: number }) => {
    if (!src || !src.startsWith('http')) return;
    const cacheKey = buildCacheKey(src, meta);
    if (resultsCache.current.has(cacheKey)) return;
    if (scanQueue.current.some(item => buildCacheKey(item.src, item.meta) === cacheKey)) return;

    scanQueue.current.push({ src, meta });
    setState(prev => ({
      ...prev,
      pendingCount: scanQueue.current.length + processingRef.current,
    }));
    processQueue();
  }, [processQueue, buildCacheKey]);

  /**
   * Scan multiple images
   */
  const scanBatch = useCallback(async (sources: string[]): Promise<Map<string, ModerationScanResult>> => {
    const results = new Map<string, ModerationScanResult>();
    
    setState(prev => ({ ...prev, isScanning: true }));

    const workerCount = Math.min(maxConcurrent, Math.max(sources.length, 1));
    let index = 0;
    const workers = Array.from({ length: workerCount }, async () => {
      while (index < sources.length) {
        const currentIndex = index++;
        const src = sources[currentIndex];
        const result = await scanImage(src);
        if (result) {
          results.set(src, result);
        }
      }
    });

    await Promise.all(workers);

    // Collect results
    const blurred = [...results.values()].filter(r => r.shouldBlur).length;
    
    setState(prev => ({ ...prev, isScanning: false }));
    
    onScanComplete?.({
      total: results.size,
      blurred,
      safe: results.size - blurred,
    });

    return results;
  }, [scanImage, onScanComplete, maxConcurrent]);

  /**
   * Handle message from WebView (injected script)
   * This is the main entry point for WebView moderation requests
   */
  const handleWebViewMessage = useCallback(async (message: any): Promise<ModerationScanResult | null> => {
    console.debug('[MW-Bridge] Received WebView message:', message?.type, message?.action);
    
    if (message?.type === 'gc-moderation-request' && message?.action === 'scan') {
      const { src, thresholds, messageId, sourceType, lastModified, contentLength } = message;
      
      console.debug('[MW-Bridge] Processing scan request #' + messageId + ' [' + sourceType + ']:', src?.substring(0, 60));
      
      const result = await scanImage(src, thresholds, { lastModified, contentLength });
      
      if (result) {
        return { ...result, messageId } as any;
      }
    }
    return null;
  }, [scanImage]);

  /**
   * Get result for a specific image
   */
  const getResult = useCallback((src: string, meta?: { lastModified?: number | string; contentLength?: number }): ModerationScanResult | undefined => {
    return resultsCache.current.get(buildCacheKey(src, meta));
  }, [buildCacheKey]);

  /**
   * Clear cache
   */
  const clearCache = useCallback(() => {
    resultsCache.current.clear();
    scanQueue.current = [];
    processingRef.current = 0;
    setState({
      isReady: modelReady,
      isScanning: false,
      scannedCount: 0,
      blurredCount: 0,
      pendingCount: 0,
      lastScanTime: 0,
      error: null,
    });
    console.debug('[MW-Bridge] Cache cleared');
  }, [modelReady]);

  /**
   * Get current moderation config for WebView injection
   */
  const getInjectionConfig = useCallback(() => {
    return getModerationConfig();
  }, [getModerationConfig]);

  // Map to ModelState type for AIStatusBar compatibility
  const mappedModelState = modelReady 
    ? 'ready' as const
    : modelState === 'loading' 
      ? 'loading' as const
      : modelState === 'error' 
        ? 'error' as const 
        : 'idle' as const;

  return {
    // State
    ...state,
    modelState: mappedModelState,
    config: getModerationConfig(),
    
    // Actions
    scanImage,
    scanBatch,
    queueScan,
    handleWebViewMessage,
    getResult,
    clearCache,
    getInjectionConfig,
  };
};
