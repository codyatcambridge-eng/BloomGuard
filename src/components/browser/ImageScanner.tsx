import { useState, useCallback } from "react";
import { Upload, Camera, Image as ImageIcon, AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { useOnDeviceModeration, ModerationResult } from "@/hooks/useOnDeviceModeration";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { useLocalLogs } from "@/hooks/useLocalLogs";
import { Button } from "@/components/ui/button";

interface ScanResult {
  file: File;
  url: string;
  result: ModerationResult | null;
  isProcessing: boolean;
}

export const ImageScanner = () => {
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  
  const { classifyFile, isReady, isLoading } = useOnDeviceModeration();
  const { settings, getAIThresholds, getBlurAmount } = useLocalSettings();
  const { logImageScan, logBlur } = useLocalLogs();

  const processFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;

    const objectUrl = URL.createObjectURL(file);
    const newResult: ScanResult = {
      file,
      url: objectUrl,
      result: null,
      isProcessing: true,
    };

    setScanResults(prev => [...prev, newResult]);

    const thresholds = getAIThresholds();
    const result = await classifyFile(file, thresholds);

    setScanResults(prev => 
      prev.map(r => 
        r.url === objectUrl 
          ? { ...r, result, isProcessing: false }
          : r
      )
    );

    if (result) {
      if (result.shouldBlur) {
        logBlur(file.name, result.dominantClass, result.confidence);
        logImageScan(file.name, result.dominantClass, 'blurred');
      } else {
        logImageScan(file.name, result.dominantClass, 'allowed');
      }
    }
  }, [classifyFile, getAIThresholds, logBlur, logImageScan]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(processFile);
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(processFile);
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const removeResult = useCallback((url: string) => {
    URL.revokeObjectURL(url);
    setScanResults(prev => prev.filter(r => r.url !== url));
  }, []);

  const clearAll = useCallback(() => {
    scanResults.forEach(r => URL.revokeObjectURL(r.url));
    setScanResults([]);
  }, [scanResults]);

  const blurAmount = getBlurAmount();

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg tracking-wider">IMAGE SCANNER</h2>
        {scanResults.length > 0 && (
          <Button variant="outline" size="sm" onClick={clearAll}>
            Clear All
          </Button>
        )}
      </div>

      {!isReady ? (
        <div className="flex items-center justify-center p-8 border border-silver/20 rounded-lg">
          {isLoading ? (
            <div className="text-center">
              <Loader2 className="w-8 h-8 mx-auto mb-2 text-aqua animate-spin" />
              <p className="text-sm text-muted-foreground">Loading AI model...</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">AI model not available</p>
          )}
        </div>
      ) : (
        <>
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragOver
                ? 'border-aqua bg-aqua/5'
                : 'border-silver/30 hover:border-silver/50'
            }`}
          >
            <ImageIcon className="w-12 h-12 mx-auto mb-4 text-silver/50" />
            <p className="text-sm text-muted-foreground mb-4">
              Drag & drop images to scan, or
            </p>
            <div className="flex gap-2 justify-center">
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button variant="outline" size="sm" asChild>
                  <span>
                    <Upload className="w-4 h-4 mr-2" />
                    Select Files
                  </span>
                </Button>
              </label>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button variant="outline" size="sm" asChild>
                  <span>
                    <Camera className="w-4 h-4 mr-2" />
                    Camera
                  </span>
                </Button>
              </label>
            </div>
          </div>

          {/* Results grid */}
          {scanResults.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {scanResults.map((item) => (
                <div
                  key={item.url}
                  className="relative border border-silver/20 rounded-lg overflow-hidden bg-card"
                >
                  {/* Image with conditional blur */}
                  <div className="aspect-square relative">
                    <img
                      src={item.url}
                      alt="Scanned"
                      className="w-full h-full object-cover"
                      style={{
                        filter: item.result?.shouldBlur && blurAmount > 0
                          ? `blur(${blurAmount}px)`
                          : 'none',
                      }}
                    />
                    
                    {/* Processing overlay */}
                    {item.isProcessing && (
                      <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                        <Loader2 className="w-6 h-6 text-aqua animate-spin" />
                      </div>
                    )}

                    {/* Remove button */}
                    <button
                      onClick={() => removeResult(item.url)}
                      className="absolute top-2 right-2 p-1 bg-background/80 rounded-full hover:bg-background"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Result info */}
                  {item.result && (
                    <div className="p-2 text-xs">
                      <div className="flex items-center gap-1 mb-1">
                        {item.result.shouldBlur ? (
                          <AlertTriangle className="w-3 h-3 text-destructive" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                        )}
                        <span className={item.result.shouldBlur ? 'text-destructive' : 'text-green-500'}>
                          {item.result.shouldBlur ? 'FLAGGED' : 'SAFE'}
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        {item.result.dominantClass} ({(item.result.confidence * 100).toFixed(1)}%)
                      </div>
                      <div className="text-silver">
                        {item.result.inferenceTime.toFixed(0)}ms
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};
