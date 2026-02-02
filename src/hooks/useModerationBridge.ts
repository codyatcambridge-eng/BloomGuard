import { useState, useCallback, useRef, useEffect } from 'react';
import { useOnDeviceModeration, ModerationResult } from '@/hooks/useOnDeviceModeration';
import { useLocalSettings } from '@/hooks/useLocalSettings';
import { 
  ModerationScanResult, 
  ModerationCategory,
  calculateCategory,
} from '@/plugins/ModerationBridge';

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
  onError?: (error: string) => void;
}

/**
 * Hook for managing the moderation bridge between WebView and AI model
 * Handles scan requests from injected JavaScript and returns results
 */
export const useModerationBridge = (options: UseModerationBridgeOptions = {}) => {
  const { onImageBlurred, onScanComplete, onError } = options;
  
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
  }, [modelReady]);

  /**
   * Convert NSFWJS result to our ModerationScanResult format
   */
  const convertResult = useCallback((src: string, result: ModerationResult): ModerationScanResult => {
    const predictions: Record<string, number> = {};
    result.predictions.forEach(p => {
      predictions[p.className] = p.probability;
    });

    const category = calculateCategory(predictions);

    return {
      src,
      shouldBlur: result.shouldBlur,
      category,
      confidence: result.confidence,
      predictions,
      inferenceTime: result.inferenceTime,
    };
  }, []);

  /**
   * Scan a single image
   */
  const scanImage = useCallback(async (src: string): Promise<ModerationScanResult | null> => {
    if (!modelReady || !isModerationEnabled()) {
      return null;
    }

    // Check cache
    if (resultsCache.current.has(src)) {
      return resultsCache.current.get(src)!;
    }

    const thresholds = getDialThresholds();
    const startTime = performance.now();

    try {
      const result = await classifyImage(src, thresholds);
      
      if (!result) {
        return null;
      }

      const scanResult = convertResult(src, result);
      resultsCache.current.set(src, scanResult);

      // Update state
      setState(prev => ({
        ...prev,
        scannedCount: prev.scannedCount + 1,
        blurredCount: prev.blurredCount + (scanResult.shouldBlur ? 1 : 0),
        lastScanTime: performance.now() - startTime,
      }));

      if (scanResult.shouldBlur) {
        onImageBlurred?.(src, scanResult);
      }

      console.log(`[ModerationBridge] Scanned ${src.substring(0, 50)}... -> ${scanResult.category} (blur: ${scanResult.shouldBlur})`);
      return scanResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Scan failed';
      console.debug('[ModerationBridge] Scan error:', src.substring(0, 50), errorMsg);
      return null;
    }
  }, [modelReady, isModerationEnabled, getDialThresholds, classifyImage, convertResult, onImageBlurred]);

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
   */
  const handleWebViewMessage = useCallback(async (message: any): Promise<ModerationScanResult | null> => {
    if (message?.type === 'gc-moderation-request' && message?.action === 'scan') {
      return scanImage(message.src);
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
