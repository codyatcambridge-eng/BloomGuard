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

  const scanQueue = useRef<string[]>([]);
  const resultsCache = useRef<Map<string, ModerationScanResult>>(new Map());
  const processingRef = useRef(0);
  const maxConcurrent = 4;

  const { isReady: modelReady, classifyImage, modelState } = useOnDeviceModeration();
  const { settings, getDialThresholds, isModerationEnabled, getModerationConfig } = useLocalSettings();

  // Update ready state when model loads
  useEffect(() => {
    setState(prev => ({ ...prev, isReady: modelReady }));
    if (modelReady) {
      console.log('[MW-Bridge] AI model ready for scanning');
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
  const scanImage = useCallback(async (src: string, thresholds?: { porn: number; sexy: number; hentai: number }): Promise<ModerationScanResult | null> => {
    if (!modelReady) {
      console.log('[MW-Bridge] Model not ready, skipping scan');
      return null;
    }
    
    if (!isModerationEnabled()) {
      console.log('[MW-Bridge] Moderation disabled, skipping scan');
      return null;
    }

    // Check cache
    if (resultsCache.current.has(src)) {
      console.log('[MW-Bridge] Cache hit:', src.substring(0, 50));
      return resultsCache.current.get(src)!;
    }

    const effectiveThresholds = thresholds || getDialThresholds();
    const startTime = performance.now();

    try {
      console.log('[MW-Bridge] Scanning:', src.substring(0, 60));
      const result = await classifyImage(src, effectiveThresholds);
      const inferenceTime = performance.now() - startTime;
      
      if (!result) {
        console.log('[MW-Bridge] No result from classifier');
        return null;
      }

      const scanResult = convertResult(src, result, inferenceTime);
      resultsCache.current.set(src, scanResult);

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
        console.log('[MW-Bridge] BLUR:', src.substring(0, 50), '->', scanResult.category);
        onImageBlurred?.(src, scanResult);
      } else {
        console.log('[MW-Bridge] SAFE:', src.substring(0, 50), '->', scanResult.category);
      }

      return scanResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Scan failed';
      console.debug('[MW-Bridge] Scan error:', src.substring(0, 50), errorMsg);
      return null;
    }
  }, [modelReady, isModerationEnabled, getDialThresholds, classifyImage, convertResult, onImageBlurred, onSignal]);

  /**
   * Process scan queue with concurrency limit
   */
  const processQueue = useCallback(async () => {
    while (processingRef.current < maxConcurrent && scanQueue.current.length > 0) {
      const src = scanQueue.current.shift();
      if (src && !resultsCache.current.has(src)) {
        processingRef.current++;
        
        scanImage(src).finally(() => {
          processingRef.current--;
          setState(prev => ({
            ...prev,
            pendingCount: scanQueue.current.length + processingRef.current,
          }));
          processQueue();
        });
      }
    }
  }, [scanImage]);

  /**
   * Queue an image for scanning
   */
  const queueScan = useCallback((src: string) => {
    if (!src || !src.startsWith('http')) return;
    if (resultsCache.current.has(src)) return;
    if (scanQueue.current.includes(src)) return;

    scanQueue.current.push(src);
    setState(prev => ({
      ...prev,
      pendingCount: scanQueue.current.length + processingRef.current,
    }));
    processQueue();
  }, [processQueue]);

  /**
   * Scan multiple images
   */
  const scanBatch = useCallback(async (sources: string[]): Promise<Map<string, ModerationScanResult>> => {
    const results = new Map<string, ModerationScanResult>();
    
    setState(prev => ({ ...prev, isScanning: true }));

    for (const src of sources) {
      queueScan(src);
    }

    // Wait for all to complete
    await new Promise<void>(resolve => {
      const checkComplete = () => {
        if (processingRef.current === 0 && scanQueue.current.length === 0) {
          resolve();
        } else {
          setTimeout(checkComplete, 100);
        }
      };
      setTimeout(checkComplete, 100);
    });

    // Collect results
    for (const src of sources) {
      const result = resultsCache.current.get(src);
      if (result) {
        results.set(src, result);
      }
    }

    const blurred = [...results.values()].filter(r => r.shouldBlur).length;
    
    setState(prev => ({ ...prev, isScanning: false }));
    
    onScanComplete?.({
      total: results.size,
      blurred,
      safe: results.size - blurred,
    });

    return results;
  }, [queueScan, onScanComplete]);

  /**
   * Handle message from WebView (injected script)
   * This is the main entry point for WebView moderation requests
   */
  const handleWebViewMessage = useCallback(async (message: any): Promise<ModerationScanResult | null> => {
    console.log('[MW-Bridge] Received WebView message:', message?.type, message?.action);
    
    if (message?.type === 'gc-moderation-request' && message?.action === 'scan') {
      const { src, thresholds, messageId, sourceType } = message;
      
      console.log('[MW-Bridge] Processing scan request #' + messageId + ' [' + sourceType + ']:', src?.substring(0, 60));
      
      const result = await scanImage(src, thresholds);
      
      if (result) {
        return { ...result, messageId } as any;
      }
    }
    return null;
  }, [scanImage]);

  /**
   * Get result for a specific image
   */
  const getResult = useCallback((src: string): ModerationScanResult | undefined => {
    return resultsCache.current.get(src);
  }, []);

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
    console.log('[MW-Bridge] Cache cleared');
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
