import { useState, useCallback, useRef, useEffect } from 'react';
import {
  useOnDeviceModeration,
  ModerationResult,
  type ModerationScanContext,
  type ModerationCacheFlushContext,
} from '@/hooks/useOnDeviceModeration';
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

export type BridgeScanContext = ModerationScanContext;
export type BridgeCacheFlushContext = ModerationCacheFlushContext;

const getCacheDomainContext = (src: string): string => {
  try {
    return new URL(src).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }
};

const getCacheFamilyContext = (src: string): string => {
  const domain = getCacheDomainContext(src);
  if (domain === 'm.youtube.com') return 'youtube_mobile';
  if (domain === 'youtube.com' || domain === 'www.youtube.com') return 'youtube_www';
  if (domain.endsWith('youtube.com') || domain.endsWith('youtu.be') || domain.endsWith('ytimg.com')) {
    return 'youtube_other';
  }
  return domain || 'unknown';
};

const isShortsPageUrl = (value?: string): boolean => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.pathname.includes('/shorts/');
  } catch {
    return value.includes('/shorts/');
  }
};

const hasShortsBlanketDecision = (decisionReason?: string): boolean => (
  typeof decisionReason === 'string' && decisionReason.includes('shorts_blanket_force')
);

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
  const cacheDiagRef = useRef<{ lastHitDomain: string; lastHitFamily: string }>({
    lastHitDomain: '',
    lastHitFamily: '',
  });
  const maxConcurrent = 4;

  const { isReady: modelReady, classifyImage, modelState, clearCache: clearOnDeviceCache } = useOnDeviceModeration();
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
    const shortsBlanketForced = hasShortsBlanketDecision(result.decisionReason);

    // Keep category aligned with blur decisions so downstream JS doesn't discard unsafe hits.
    if (result.reason === 'thirst_detected') {
      category = 'thirst';
    } else if (result.reason === 'swimwear_detected') {
      category = 'swimwear';
    } else if (
      result.shouldBlur &&
      !shortsBlanketForced &&
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

    const diagnostics: Record<string, unknown> = {};
    if (typeof result.nsfwRisk === 'number') diagnostics.nsfwRisk = result.nsfwRisk;
    if (result.segmentation) {
      diagnostics.segmentationAttempted = result.segmentation.attempted;
      diagnostics.segmentationApplied = result.segmentation.applied;
      diagnostics.segmentationCached = result.segmentation.cached;
      diagnostics.segmentationThrottled = result.segmentation.throttled;
      diagnostics.personPresent = result.segmentation.personPresent;
      diagnostics.personPixels = result.segmentation.personPixels;
      diagnostics.skinPixels = result.segmentation.skinPixels;
      diagnostics.skinRatio = result.segmentation.skinRatio;
      diagnostics.thirstScore = result.segmentation.thirstScore;
      diagnostics.segMs = result.segmentation.segMs;
      diagnostics.skinMs = result.segmentation.skinMs;
      diagnostics.inputWidth = result.segmentation.inputWidth;
      diagnostics.inputHeight = result.segmentation.inputHeight;
      diagnostics.inputSource = result.segmentation.inputSource;
      diagnostics.stageBSkipReason = result.segmentation.skipReason;
      diagnostics.imageWidth = result.segmentation.imageWidth;
      diagnostics.imageHeight = result.segmentation.imageHeight;
      diagnostics.host = result.segmentation.host;
    }

    return {
      src,
      shouldBlur: result.shouldBlur,
      category,
      confidence: result.confidence,
      severity: mapModerationCategoryToSeverity(category),
      predictions,
      inferenceTime,
      reason: result.reason,
      decisionReason: result.decisionReason,
      modelVersion: result.modelVersion,
      thresholdsUsed: result.thresholdsUsed as Record<string, unknown> | undefined,
      diagnostics: Object.keys(diagnostics).length > 0 ? diagnostics : undefined,
    };
  }, []);

  /**
   * Scan a single image and return result
   */
  const scanImage = useCallback(async (
    src: string,
    thresholds?: { porn: number; sexy: number; hentai: number },
    context?: BridgeScanContext,
  ): Promise<ModerationScanResult | null> => {
    if (!modelReady) {
      console.log('[MW-Bridge] Model not ready, skipping scan');
      return null;
    }
    
    if (!isModerationEnabled()) {
      console.log('[MW-Bridge] Moderation disabled, skipping scan');
      return null;
    }

    const cacheDomain = getCacheDomainContext(src);
    const cacheFamily = getCacheFamilyContext(src);
    const previousHitDomain = cacheDiagRef.current.lastHitDomain;
    const siteSwitchedSincePriorHit = !!previousHitDomain && previousHitDomain !== cacheDomain;
    const shortsPageContext = isShortsPageUrl(context?.pageUrl);
    const navId = Number.isFinite(context?.navId) ? String(context?.navId) : 'n/a';
    const pageEpoch = Number.isFinite(context?.pageEpoch) ? String(context?.pageEpoch) : 'n/a';

    // Check cache
    if (resultsCache.current.has(src)) {
      const cachedResult = resultsCache.current.get(src)!;
      const cachedShortsForced = hasShortsBlanketDecision(cachedResult.decisionReason);
      const cacheContextMatch = cachedShortsForced === shortsPageContext;
      if (!cacheContextMatch) {
        resultsCache.current.delete(src);
      } else {
        console.log('[MW-Bridge] Cache hit:', src.substring(0, 50));
        console.log(
          '[DIAG][CACHE]',
          'cache_hit_bridge',
          'domain=' + cacheDomain,
          'keyFamily=' + cacheFamily,
          'domainFamily=' + cacheFamily,
          'siteSwitchedSincePriorHit=' + siteSwitchedSincePriorHit,
          'previousHitDomain=' + (previousHitDomain || 'none'),
          'requestId=' + (context?.requestId || 'n/a'),
          'itemId=' + (context?.itemId || 'n/a'),
          'sourceType=' + (context?.sourceType || 'n/a'),
          'navId=' + navId,
          'pageEpoch=' + pageEpoch,
        );
        cacheDiagRef.current.lastHitDomain = cacheDomain;
        cacheDiagRef.current.lastHitFamily = cacheFamily;
        return cachedResult;
      }
    }
    console.log(
      '[DIAG][CACHE]',
      'cache_miss_bridge',
      'domain=' + cacheDomain,
      'keyFamily=' + cacheFamily,
      'domainFamily=' + cacheFamily,
      'siteSwitchedSincePriorHit=' + siteSwitchedSincePriorHit,
      'previousHitDomain=' + (previousHitDomain || 'none'),
      'requestId=' + (context?.requestId || 'n/a'),
      'itemId=' + (context?.itemId || 'n/a'),
      'sourceType=' + (context?.sourceType || 'n/a'),
      'navId=' + navId,
      'pageEpoch=' + pageEpoch,
    );

    const effectiveThresholds = thresholds || getDialThresholds();
    const startTime = performance.now();

    try {
      console.log('[MW-Bridge] Scanning:', src.substring(0, 60));
      const result = await classifyImage(src, effectiveThresholds, context);
      const inferenceTime = performance.now() - startTime;
      
      if (!result) {
        console.log('[MW-Bridge] No result from classifier');
        return null;
      }

      const scanResult = convertResult(src, result, inferenceTime);
      if (!hasShortsBlanketDecision(scanResult.decisionReason)) {
        resultsCache.current.set(src, scanResult);
      }

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
  const handleWebViewMessage = useCallback(async (
    message: unknown
  ): Promise<(ModerationScanResult & { messageId?: number }) | null> => {
    const msg = (message && typeof message === 'object'
      ? message
      : {}) as {
      type?: string;
      action?: string;
      src?: string;
      thresholds?: { porn: number; sexy: number; hentai: number };
      messageId?: number;
      sourceType?: string;
      requestId?: string;
      itemId?: string;
      navId?: number;
      pageEpoch?: number;
      pageUrl?: string;
      url?: string;
    };
    console.log('[MW-Bridge] Received WebView message:', msg.type, msg.action);
    
    if (msg.type === 'gc-moderation-request' && msg.action === 'scan') {
      const { src, thresholds, messageId, sourceType } = msg;
      
      console.log('[MW-Bridge] Processing scan request #' + messageId + ' [' + sourceType + ']:', src?.substring(0, 60));
      
      if (!src) return null;
      const result = await scanImage(src, thresholds, {
        requestId: typeof msg.requestId === 'string' ? msg.requestId : 'legacy_message',
        itemId: typeof msg.itemId === 'string'
          ? msg.itemId
          : (Number.isFinite(messageId) ? `legacy_${messageId}` : 'legacy_item'),
        sourceType,
        navId: Number.isFinite(msg.navId) ? Number(msg.navId) : undefined,
        pageEpoch: Number.isFinite(msg.pageEpoch) ? Number(msg.pageEpoch) : undefined,
        pageUrl: typeof msg.pageUrl === 'string'
          ? msg.pageUrl
          : (typeof msg.url === 'string' ? msg.url : undefined),
      });
      
      if (result) {
        return { ...result, messageId };
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
  const clearCache = useCallback((context?: BridgeCacheFlushContext) => {
    const bridgeEntries = resultsCache.current.size;
    const queuedItems = scanQueue.current.length;
    resultsCache.current.clear();
    scanQueue.current = [];
    processingRef.current = 0;
    cacheDiagRef.current.lastHitDomain = '';
    cacheDiagRef.current.lastHitFamily = '';
    const onDeviceCleared = clearOnDeviceCache(context);
    setState({
      isReady: modelReady,
      isScanning: false,
      scannedCount: 0,
      blurredCount: 0,
      pendingCount: 0,
      lastScanTime: 0,
      error: null,
    });
    console.log(
      '[DIAG][CACHE]',
      'cache_flushed_reason',
      'scope=bridge',
      'reason=' + (context?.reason || 'manual_clear'),
      'bridgeEntries=' + bridgeEntries,
      'bridgeQueued=' + queuedItems,
      'onDeviceImageEntries=' + (onDeviceCleared?.imageEntries ?? 'n/a'),
      'onDeviceSegmentationEntries=' + (onDeviceCleared?.segmentationEntries ?? 'n/a'),
      'previousFamily=' + (context?.previousFamily || 'unknown'),
      'nextFamily=' + (context?.nextFamily || 'unknown'),
      'navId=' + (Number.isFinite(context?.navId) ? String(context?.navId) : 'n/a'),
      'pageEpoch=' + (Number.isFinite(context?.pageEpoch) ? String(context?.pageEpoch) : 'n/a'),
    );
    console.log('[MW-Bridge] Cache cleared');
    return {
      bridgeEntries,
      queuedItems,
      onDeviceImageEntries: onDeviceCleared?.imageEntries ?? 0,
      onDeviceSegmentationEntries: onDeviceCleared?.segmentationEntries ?? 0,
    };
  }, [modelReady, clearOnDeviceCache]);

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
