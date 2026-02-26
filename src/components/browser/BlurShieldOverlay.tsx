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
          <div className="w-72 rounded-2xl border border-border bg-background/95 shadow-2xl shadow-black/40 backdrop-blur-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">Blur Dial</p>
                <p className="text-sm font-display text-foreground leading-snug">{preset.name}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full border border-silver/20 p-1 text-muted-foreground hover:text-foreground"
                aria-label="Close blur dial"
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

            <div className="grid grid-cols-3 gap-2 text-[0.65rem] uppercase tracking-[0.2em]">
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => sendShieldCommand('report')}
                className="rounded-lg border border-border/60 bg-destructive/10 px-2 py-1 text-center text-destructive transition hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Report potential leak"
              >
                <span className="block text-base leading-none">[!]</span>
                Report Leak
              </button>
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => sendShieldCommand('false_positive')}
                className="rounded-lg border border-border/60 bg-emerald/10 px-2 py-1 text-center text-emerald transition hover:bg-emerald/20 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Mark as false positive"
              >
                <span className="block text-base leading-none">[✓]</span>
                False Positive
              </button>
              <button
                type="button"
                disabled={actionsDisabled}
                onClick={() => sendShieldCommand('deep_scan')}
                className="rounded-lg border border-border/60 bg-sky/10 px-2 py-1 text-center text-sky transition hover:bg-sky/20 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Trigger high resolution deep scan"
              >
                <span className="block text-base leading-none">[👁]</span>
                Deep Scan
              </button>
            </div>

            <p className="text-[10px] leading-snug text-muted-foreground">{preset.description}</p>
            <div className="flex flex-wrap gap-2">
              {preset.focus.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] rounded-full border border-border/70 px-2 py-0.5 text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <span>Blur strength</span>
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
          className="flex items-center justify-center rounded-full bg-aqua p-3 text-accent-foreground shadow-2xl shadow-black/40 hover:bg-aqua/90"
          aria-label="Blur shield dial"
        >
          <Shield className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
