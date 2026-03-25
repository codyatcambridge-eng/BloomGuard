import { useState, useCallback, useRef } from 'react';
import { useOnDeviceModeration, ModerationResult } from '@/hooks/useOnDeviceModeration';
import { useLocalSettings } from '@/hooks/useLocalSettings';

export interface WebViewModerationState {
  isScanning: boolean;
  scannedCount: number;
  totalImages: number;
  blurredCount: number;
  results: Map<string, ModerationResult>;
  error: string | null;
}

export interface UseWebViewModerationOptions {
  onImageBlurred?: (src: string, result: ModerationResult) => void;
  onScanComplete?: (stats: { total: number; blurred: number; safe: number }) => void;
}

/**
 * Hook for managing image moderation in WebView contexts
 * Provides scanning, blur tracking, and reveal functionality
 */
export const useWebViewModeration = (options: UseWebViewModerationOptions = {}) => {
  const { onImageBlurred, onScanComplete } = options;
  
  const [state, setState] = useState<WebViewModerationState>({
    isScanning: false,
    scannedCount: 0,
    totalImages: 0,
    blurredCount: 0,
    results: new Map(),
    error: null,
  });
  
  const [revealedImages, setRevealedImages] = useState<Set<string>>(new Set());
  const scanAbortRef = useRef(false);
  
  const { isReady, classifyImage, modelState } = useOnDeviceModeration();
  const { settings, getAIThresholds, getBlurAmount } = useLocalSettings();

  const thresholds = getAIThresholds();
  const blurAmount = getBlurAmount();

  /**
   * Scan a batch of images
   */
  const scanImages = useCallback(async (imageSources: string[]): Promise<Map<string, ModerationResult>> => {
    if (!isReady || imageSources.length === 0) {
      return new Map();
    }

    scanAbortRef.current = false;
    const uniqueImages = [...new Set(imageSources)];
    
    setState(prev => ({
      ...prev,
      isScanning: true,
      scannedCount: 0,
      totalImages: uniqueImages.length,
      error: null,
    }));

    const results = new Map<string, ModerationResult>();
    let blurredCount = 0;

    for (let i = 0; i < uniqueImages.length; i++) {
      if (scanAbortRef.current) break;
      
      try {
        const result = await classifyImage(uniqueImages[i], thresholds);
        if (result) {
          results.set(uniqueImages[i], result);
          
          if (result.shouldBlur) {
            blurredCount++;
            onImageBlurred?.(uniqueImages[i], result);
          }
        }
        
        setState(prev => ({
          ...prev,
          scannedCount: i + 1,
          results: new Map([...prev.results, ...results]),
          blurredCount,
        }));
      } catch (error) {
        console.error('[WebViewModeration] Scan error:', uniqueImages[i], error);
      }
    }

    const safeCount = results.size - blurredCount;
    
    setState(prev => ({
      ...prev,
      isScanning: false,
      results: new Map([...prev.results, ...results]),
      blurredCount,
    }));

    onScanComplete?.({
      total: uniqueImages.length,
      blurred: blurredCount,
      safe: safeCount,
    });

    return results;
  }, [isReady, classifyImage, thresholds, onImageBlurred, onScanComplete]);

  /**
   * Scan a single image
   */
  const scanSingleImage = useCallback(async (src: string): Promise<ModerationResult | null> => {
    if (!isReady) return null;
    
    try {
      const result = await classifyImage(src, thresholds);
      if (result) {
        setState(prev => {
          const newResults = new Map(prev.results);
          newResults.set(src, result);
          return {
            ...prev,
            results: newResults,
            blurredCount: prev.blurredCount + (result.shouldBlur ? 1 : 0),
          };
        });
        
        if (result.shouldBlur) {
          onImageBlurred?.(src, result);
        }
        
        return result;
      }
    } catch (error) {
      console.error('[WebViewModeration] Single scan error:', src, error);
    }
    
    return null;
  }, [isReady, classifyImage, thresholds, onImageBlurred]);

  /**
   * Check if an image should be blurred
   */
  const shouldBlur = useCallback((src: string): boolean => {
    if (blurAmount === 0) return false;
    const result = state.results.get(src);
    return result?.shouldBlur === true && !revealedImages.has(src);
  }, [state.results, revealedImages, blurAmount]);

  /**
   * Toggle image reveal state
   */
  const toggleReveal = useCallback((src: string) => {
    setRevealedImages(prev => {
      const next = new Set(prev);
      if (next.has(src)) {
        next.delete(src);
      } else {
        next.add(src);
      }
      return next;
    });
  }, []);

  /**
   * Get result for a specific image
   */
  const getResult = useCallback((src: string): ModerationResult | undefined => {
    return state.results.get(src);
  }, [state.results]);

  /**
   * Cancel ongoing scan
   */
  const cancelScan = useCallback(() => {
    scanAbortRef.current = true;
  }, []);

  /**
   * Clear all results
   */
  const reset = useCallback(() => {
    setState({
      isScanning: false,
      scannedCount: 0,
      totalImages: 0,
      blurredCount: 0,
      results: new Map(),
      error: null,
    });
    setRevealedImages(new Set());
  }, []);

  /**
   * Generate JavaScript to inject into WebView for image collection
   * Returns an array of image src URLs
   */
  const getImageCollectionScript = useCallback((): string => {
    return `
      (function() {
        const images = document.querySelectorAll('img');
        const srcs = [];
        images.forEach(img => {
          if (img.src && img.src.startsWith('http')) {
            srcs.push(img.src);
          }
        });
        return JSON.stringify(srcs);
      })();
    `;
  }, []);

  /**
   * Generate JavaScript to apply blur to specific images
   */
  const getBlurScript = useCallback((blurredSrcs: string[]): string => {
    return `
      (function() {
        const blurList = ${JSON.stringify(blurredSrcs)};
        const blurAmount = ${blurAmount};
        const images = document.querySelectorAll('img');
        
        images.forEach(img => {
          if (blurList.includes(img.src)) {
            img.style.filter = 'blur(' + blurAmount + 'px)';
            img.style.transition = 'filter 0.3s ease';
            img.dataset.moderated = 'blurred';
            
            // Add click handler for reveal
            if (!img.dataset.hasRevealHandler) {
              img.dataset.hasRevealHandler = 'true';
              img.style.cursor = 'pointer';
              img.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                if (this.style.filter.includes('blur')) {
                  this.style.filter = 'none';
                  this.dataset.moderated = 'revealed';
                } else {
                  this.style.filter = 'blur(' + blurAmount + 'px)';
                  this.dataset.moderated = 'blurred';
                }
              });
            }
          }
        });
        return 'Applied blur to ' + blurList.length + ' images';
      })();
    `;
  }, [blurAmount]);

  return {
    // State
    ...state,
    isReady,
    modelState,
    blurAmount,
    revealedImages,
    
    // Actions
    scanImages,
    scanSingleImage,
    shouldBlur,
    toggleReveal,
    getResult,
    cancelScan,
    reset,
    
    // WebView helpers
    getImageCollectionScript,
    getBlurScript,
  };
};
