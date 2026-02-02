import { useState } from 'react';
import { Shield, Eye, EyeOff, Zap, Gauge } from 'lucide-react';
import { useLocalSettings, BlurDialLevel } from '@/hooks/useLocalSettings';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

const SENSITIVITY_LABELS: Record<BlurDialLevel, { label: string; description: string; color: string }> = {
  0: { label: 'Off', description: 'No image scanning', color: 'text-muted-foreground' },
  1: { label: 'Relaxed', description: 'Only explicit content', color: 'text-green-500' },
  2: { label: 'Moderate', description: 'Explicit + suggestive', color: 'text-yellow-500' },
  3: { label: 'Strict', description: 'All questionable content', color: 'text-orange-500' },
  4: { label: 'Maximum', description: 'Aggressive filtering', color: 'text-red-500' },
};

interface ModerationSettingsPanelProps {
  compact?: boolean;
}

export const ModerationSettingsPanel = ({ compact = false }: ModerationSettingsPanelProps) => {
  const { settings, updateSetting, isModerationEnabled } = useLocalSettings();
  
  const currentLevel = SENSITIVITY_LABELS[settings.blur_dial];
  const isEnabled = isModerationEnabled();

  if (compact) {
    return (
      <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          <Shield className={`w-4 h-4 ${isEnabled ? 'text-aqua' : 'text-muted-foreground'}`} />
          <span className="text-sm font-medium">
            AI Shield: <span className={currentLevel.color}>{currentLevel.label}</span>
          </span>
        </div>
        <div className="flex-1">
          <Slider
            value={[settings.blur_dial]}
            onValueChange={([value]) => updateSetting('blur_dial', value as BlurDialLevel)}
            min={0}
            max={4}
            step={1}
            className="w-full"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-5 h-5 text-aqua" />
        <h3 className="font-display text-lg tracking-wider">AI IMAGE MODERATION</h3>
      </div>

      {/* Master Toggle */}
      <div className="flex items-center justify-between py-3 border-b border-border">
        <div>
          <Label className="text-sm font-medium">Shield Active</Label>
          <p className="text-xs text-muted-foreground">Enable AI image scanning</p>
        </div>
        <Switch
          checked={settings.shield_active}
          onCheckedChange={(checked) => updateSetting('shield_active', checked)}
        />
      </div>

      {/* Sensitivity Dial (0-4) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Sensitivity Level</Label>
          </div>
          <span className={`text-sm font-display tracking-wider ${currentLevel.color}`}>
            {currentLevel.label.toUpperCase()}
          </span>
        </div>
        
        <div className="px-1">
          <Slider
            value={[settings.blur_dial]}
            onValueChange={([value]) => updateSetting('blur_dial', value as BlurDialLevel)}
            min={0}
            max={4}
            step={1}
            disabled={!settings.shield_active}
            className="w-full"
          />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>Off</span>
            <span>Relaxed</span>
            <span>Moderate</span>
            <span>Strict</span>
            <span>Max</span>
          </div>
        </div>
        
        <p className="text-xs text-muted-foreground">
          {currentLevel.description}
        </p>
      </div>

      {/* Blur Strength */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {settings.blur_strength_px > 0 ? (
              <EyeOff className="w-4 h-4 text-muted-foreground" />
            ) : (
              <Eye className="w-4 h-4 text-muted-foreground" />
            )}
            <Label className="text-sm font-medium">Blur Strength</Label>
          </div>
          <span className="text-sm font-display tracking-wider text-aqua">
            {settings.blur_strength_px}px
          </span>
        </div>
        
        <div className="px-1">
          <Slider
            value={[settings.blur_strength_px]}
            onValueChange={([value]) => updateSetting('blur_strength_px', value)}
            min={0}
            max={50}
            step={2}
            disabled={!settings.shield_active || settings.blur_dial === 0}
            className="w-full"
          />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>None</span>
            <span>Light</span>
            <span>Medium</span>
            <span>Heavy</span>
            <span>Max</span>
          </div>
        </div>
        
        {/* Preview */}
        <div className="relative h-20 rounded-lg overflow-hidden bg-gradient-to-r from-rose-400 via-amber-400 to-emerald-400">
          <div 
            className="absolute inset-0 bg-gradient-to-r from-rose-400 via-amber-400 to-emerald-400"
            style={{ filter: `blur(${settings.blur_strength_px}px)` }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-medium text-white/80 bg-black/30 px-2 py-1 rounded">
              Blur Preview
            </span>
          </div>
        </div>
      </div>

      {/* Auto-scan toggle */}
      <div className="flex items-center justify-between py-3 border-t border-border">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-muted-foreground" />
          <div>
            <Label className="text-sm font-medium">Auto-Scan</Label>
            <p className="text-xs text-muted-foreground">Scan images automatically</p>
          </div>
        </div>
        <Switch
          checked={settings.auto_scan_images}
          onCheckedChange={(checked) => updateSetting('auto_scan_images', checked)}
          disabled={!settings.shield_active || settings.blur_dial === 0}
        />
      </div>

      {/* Status info */}
      <div className="p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isEnabled ? 'bg-green-500' : 'bg-muted-foreground'}`} />
          <span className="text-xs text-muted-foreground">
            {isEnabled 
              ? 'AI moderation active - images will be scanned in real-time'
              : 'AI moderation disabled - images will not be scanned'
            }
          </span>
        </div>
      </div>
    </div>
  );
};
