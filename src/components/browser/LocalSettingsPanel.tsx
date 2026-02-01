import { Shield, Eye, EyeOff, Bell, RefreshCw } from "lucide-react";
import { useLocalSettings, BlurLevel, AISensitivity } from "@/hooks/useLocalSettings";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

const BLUR_LEVELS: { value: BlurLevel; label: string; description: string }[] = [
  { value: 'OFF', label: 'Off', description: 'No blur applied' },
  { value: 'LOW', label: 'Low', description: 'Light blur (8px)' },
  { value: 'MEDIUM', label: 'Medium', description: 'Moderate blur (16px)' },
  { value: 'HIGH', label: 'High', description: 'Heavy blur (32px)' },
];

const SENSITIVITY_LEVELS: { value: AISensitivity; label: string; description: string }[] = [
  { value: 'relaxed', label: 'Relaxed', description: 'Only block explicit content' },
  { value: 'moderate', label: 'Moderate', description: 'Block explicit and suggestive' },
  { value: 'strict', label: 'Strict', description: 'Block all inappropriate content' },
];

export const LocalSettingsPanel = () => {
  const { settings, updateSetting, resetSettings, isLoaded } = useLocalSettings();

  const handleReset = () => {
    resetSettings();
    toast.success("Settings reset to defaults");
  };

  if (!isLoaded) {
    return (
      <div className="p-4 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-aqua" />
          <h2 className="font-display text-lg tracking-wider">LOCAL SETTINGS</h2>
        </div>
        <Button variant="outline" size="sm" onClick={handleReset}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Reset
        </Button>
      </div>

      {/* Shield Active */}
      <div className="flex items-center justify-between py-3 border-b border-silver/20">
        <div>
          <Label className="text-sm font-medium">Shield Active</Label>
          <p className="text-xs text-muted-foreground">Enable all protection features</p>
        </div>
        <Switch
          checked={settings.shield_active}
          onCheckedChange={(checked) => updateSetting('shield_active', checked)}
        />
      </div>

      {/* AI Sensitivity */}
      <div className="space-y-3">
        <Label className="text-xs font-display tracking-wider text-muted-foreground">
          AI SENSITIVITY
        </Label>
        <Select
          value={settings.ai_sensitivity}
          onValueChange={(value: AISensitivity) => updateSetting('ai_sensitivity', value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SENSITIVITY_LEVELS.map(level => (
              <SelectItem key={level.value} value={level.value}>
                <div>
                  <div className="font-medium">{level.label}</div>
                  <div className="text-xs text-muted-foreground">{level.description}</div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Blur Level */}
      <div className="space-y-3">
        <Label className="text-xs font-display tracking-wider text-muted-foreground">
          BLUR LEVEL
        </Label>
        <Select
          value={settings.blur_level}
          onValueChange={(value: BlurLevel) => updateSetting('blur_level', value)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BLUR_LEVELS.map(level => (
              <SelectItem key={level.value} value={level.value}>
                <div className="flex items-center gap-2">
                  {level.value === 'OFF' ? (
                    <Eye className="w-4 h-4" />
                  ) : (
                    <EyeOff className="w-4 h-4" />
                  )}
                  <div>
                    <div className="font-medium">{level.label}</div>
                    <div className="text-xs text-muted-foreground">{level.description}</div>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Block Adult Sites */}
      <div className="flex items-center justify-between py-3 border-b border-silver/20">
        <div>
          <Label className="text-sm font-medium">Block Adult Sites</Label>
          <p className="text-xs text-muted-foreground">Use local blocklist for known adult domains</p>
        </div>
        <Switch
          checked={settings.block_adult_sites}
          onCheckedChange={(checked) => updateSetting('block_adult_sites', checked)}
        />
      </div>

      {/* Block Social Media */}
      <div className="flex items-center justify-between py-3 border-b border-silver/20">
        <div>
          <Label className="text-sm font-medium">Block Social Media</Label>
          <p className="text-xs text-muted-foreground">Block social media platforms</p>
        </div>
        <Switch
          checked={settings.block_social_media}
          onCheckedChange={(checked) => updateSetting('block_social_media', checked)}
        />
      </div>

      {/* Auto Scan Images */}
      <div className="flex items-center justify-between py-3 border-b border-silver/20">
        <div>
          <Label className="text-sm font-medium">Auto-Scan Images</Label>
          <p className="text-xs text-muted-foreground">Automatically scan images when browsing</p>
        </div>
        <Switch
          checked={settings.auto_scan_images}
          onCheckedChange={(checked) => updateSetting('auto_scan_images', checked)}
        />
      </div>

      {/* Show Scan Notifications */}
      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <div>
            <Label className="text-sm font-medium">Scan Notifications</Label>
            <p className="text-xs text-muted-foreground">Show toast when scans complete</p>
          </div>
        </div>
        <Switch
          checked={settings.show_scan_notifications}
          onCheckedChange={(checked) => updateSetting('show_scan_notifications', checked)}
        />
      </div>

      <div className="pt-4 border-t border-silver/20">
        <p className="text-xs text-silver">
          All settings are stored locally on your device.
          <br />
          No data is sent to any server.
        </p>
      </div>
    </div>
  );
};
