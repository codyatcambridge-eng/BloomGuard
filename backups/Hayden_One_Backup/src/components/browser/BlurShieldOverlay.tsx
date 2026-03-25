import { useCallback, useMemo, useState } from 'react';
import { Shield, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { useLocalSettings, BlurDialLevel } from '@/hooks/useLocalSettings';

const DIAL_PRESETS: Record<BlurDialLevel, { name: string; description: string; focus: string[] }> = {
  0: {
    name: 'Off',
    description: 'Blur engine is paused — safe-by-default, no scanning updates.',
    focus: ['Manual reveal only'],
  },
  1: {
    name: 'Relaxed',
    description: 'Targets the explicit content quadrant while staying gentle on everyday browsing.',
    focus: ['Gym content', 'Tight clothes', 'Swimwear (casual)'],
  },
  2: {
    name: 'Moderate',
    description: 'Balanced filtering that also covers suggestive thumbnails and body-positive feeds.',
    focus: ['Shirtless scenes', 'Bikinis & swimwear', 'Tight outfits', 'Thongs/lingerie'],
  },
  3: {
    name: 'Strict',
    description: 'Keeps “thirst trap” categories fuzzy — perfect for shorts, gym feeds, and high energy clips.',
    focus: ['Short-form feeds', 'Gym content sets', 'Tight cloth close‑ups', 'Body-focused angles'],
  },
  4: {
    name: 'Maximum',
    description: 'Covers every supported trigger the model can flag, including swimwear, thong, workout, and shirtless edits.',
    focus: ['Thrill-seeking gym reels', 'Swimwear & bikini shots', 'Shirtless & thong frames', 'Animated/AI sensual edits'],
  },
};

interface BlurShieldOverlayProps {
  executeScript?: (script: string) => Promise<unknown>;
}

export const BlurShieldOverlay = ({ executeScript }: BlurShieldOverlayProps) => {
  const [open, setOpen] = useState(false);
  const { settings, updateSetting } = useLocalSettings();
  const preset = useMemo(() => DIAL_PRESETS[settings.blur_dial] || DIAL_PRESETS[2], [settings.blur_dial]);
  const actionsDisabled = !settings.shield_active || !executeScript;
  const isLargeText = settings.isEnhancedVisibility === true;

  const sendShieldCommand = useCallback((action: 'report' | 'false_positive' | 'deep_scan') => {
    if (!executeScript) return;
    executeScript(`
      (function() {
        try {
          window.postMessage({ type: 'MW_SHIELD_ACTION', action: '${action}', timestamp: Date.now() }, '*');
          return 'OK';
        } catch (e) {
          return 'ERR';
        }
      })();
    `).catch(() => {});
  }, [executeScript]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]">
      <div className="pointer-events-auto fixed bottom-4 right-4 flex flex-col items-end gap-3">
        {open && (
          <div className={`${isLargeText ? 'w-80' : 'w-72'} rounded-2xl border border-[#2c3330] bg-[#1A1B1E]/90 text-[#E0E0E0] shadow-2xl shadow-black/40 backdrop-blur-lg p-4 space-y-3`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[0.65rem] uppercase tracking-[0.2em] text-[#E0E0E0]/70">Shield Strength</p>
                <p className="text-sm font-display text-[#E0E0E0] leading-snug">{preset.name}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full border border-[#2c3330] p-1 text-[#E0E0E0]/70 hover:text-[#E0E0E0]"
                aria-label="Close shield strength controls"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            <Slider
              value={[settings.blur_dial]}
              onValueChange={([value]) => updateSetting('blur_dial', value as BlurDialLevel)}
              min={0}
              max={4}
              step={1}
              className="w-full"
            />

            <div className="flex items-center justify-between rounded-lg border border-[#2c3330] bg-[#22252a] px-3 py-2">
              <span className="text-xs uppercase tracking-[0.16em] text-[#E0E0E0]/75">Enhanced Visibility</span>
              <button
                type="button"
                onClick={() => updateSetting('isEnhancedVisibility', !settings.isEnhancedVisibility)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                  settings.isEnhancedVisibility
                    ? 'bg-[#76937C] text-[#1A1B1E]'
                    : 'bg-[#2c3330] text-[#E0E0E0]'
                }`}
                aria-label="Toggle enhanced visibility"
              >
                {settings.isEnhancedVisibility ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className={`grid ${isLargeText ? 'grid-cols-1' : 'grid-cols-3'} gap-2 text-[0.65rem] uppercase tracking-[0.2em]`}>
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => sendShieldCommand('report')}
                className="mw-break-button rounded-lg border border-[#6b2f37] bg-[#3f1f24] px-2 py-1 text-center text-[#ffb4c1] transition hover:bg-[#4b252b] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Report potential leak"
              >
                <span className="block text-base leading-none">[!]</span>
                Report Leak
              </button>
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => sendShieldCommand('false_positive')}
                className="mw-controls-button rounded-lg border border-[#76937C]/80 bg-[#76937C]/20 px-2 py-1 text-center text-[#9fc0a7] transition hover:bg-[#76937C]/30 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Mark as false positive"
              >
                <span className="block text-base leading-none">[✓]</span>
                False Positive
              </button>
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => sendShieldCommand('deep_scan')}
                className="rounded-lg border border-[#2c3330] bg-[#22252a] px-2 py-1 text-center text-[#E0E0E0] transition hover:bg-[#282d33] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Trigger high resolution deep scan"
              >
                <span className="block text-base leading-none">[👁]</span>
                Deep Scan
              </button>
            </div>

            <p className="text-[10px] leading-snug text-[#E0E0E0]/70">{preset.description}</p>
            <div className="flex flex-wrap gap-2">
              {preset.focus.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] rounded-full border border-[#2c3330] px-2 py-0.5 text-[#E0E0E0]/70"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[#E0E0E0]/70">
                <span>Shield Strength</span>
                <span>{settings.blur_strength_px}px</span>
              </div>
              <Slider
                value={[settings.blur_strength_px]}
                onValueChange={([value]) => updateSetting('blur_strength_px', value)}
                min={0}
                max={50}
                step={2}
                disabled={!settings.shield_active || settings.blur_dial === 0}
                className="w-full"
              />
            </div>
          </div>
        )}

        <button
          onClick={() => setOpen((prev) => !prev)}
          className="mw-controls-button flex items-center justify-center rounded-full bg-[#76937C] p-3 text-[#1A1B1E] shadow-2xl shadow-black/40 hover:bg-[#76937C]/90"
          aria-label="Shield strength controls"
        >
          <Shield className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
