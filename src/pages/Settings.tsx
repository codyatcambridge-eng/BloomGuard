import { Shield, DollarSign, AlertTriangle, Eye, EyeOff, Coffee, Clock, Lock } from "lucide-react";
import { useSettings, BlurLevel } from "@/hooks/useSettings";
import { useLocalSettings } from "@/hooks/useLocalSettings";
import { toast } from "sonner";
import { UTILITY_PASS_DURATIONS, UTILITY_PASS_REASONS } from "@/logic/utilityPass";
import { useNavigate } from "react-router-dom";
import { useGateRuntime } from "@/hooks/useGateRuntime";

const Settings = () => {
  const { settings, updateSetting, isLoading } = useSettings();
  const { settings: mwLocalSettings, updateSetting: updateMwLocalSetting } = useLocalSettings();
  const navigate = useNavigate();
  const { effectiveShieldState, endPass } = useGateRuntime();

  const effectiveShieldEnabled = effectiveShieldState.shieldEnabled;
  const passRemainingMinutes = Math.max(1, Math.ceil(effectiveShieldState.passRemainingSeconds / 60));

  const handleShieldToggle = () => {
    if (effectiveShieldEnabled) {
      navigate('/defense?context=DisableShield&tool=reflect');
      return;
    }

    endPass();
    toast.success('Shield activated!');
  };

  const blurLevels: BlurLevel[] = ['OFF', 'LOW', 'HIGH'];

  const handleBlurChange = (level: BlurLevel) => {
    updateSetting('blur_sensitivity', level);
    toast.success(`Blur level set to ${level}`);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Shield className="w-12 h-12 text-aqua animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="px-4 pt-8 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-aqua" />
          <div>
            <h1 className="font-display text-2xl tracking-wider">SETTINGS</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">
              GoodCreation.net Configuration
            </p>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6">
        <section className="cathedral-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${
                effectiveShieldEnabled ? "bg-aqua" : "bg-secondary"
              }`}>
                <Shield className={`w-5 h-5 ${effectiveShieldEnabled ? "text-accent-foreground" : "text-muted-foreground"}`} />
              </div>
              <div>
                <h3 className="font-display text-sm tracking-wider">THE GOODCREATION SHIELD</h3>
                <p className="text-xs text-muted-foreground">Master Protection Toggle</p>
              </div>
            </div>
            <button
              onClick={handleShieldToggle}
              className={`w-14 h-8 rounded-full transition-all duration-300 ${
                effectiveShieldEnabled ? "bg-aqua" : "bg-secondary"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full bg-foreground transition-transform duration-300 ${
                  effectiveShieldEnabled ? "translate-x-7" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {effectiveShieldEnabled ? (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2 text-aqua">
                <div className="w-2 h-2 rounded-full bg-aqua animate-pulse" />
                <span className="text-xs font-display tracking-wider">PROTECTION ACTIVE</span>
              </div>
            </div>
          ) : (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2 text-gold">
                <div className="w-2 h-2 rounded-full bg-gold animate-pulse" />
                <span className="text-xs font-display tracking-wider">
                  PASS ACTIVE — SHIELD OFF FOR {passRemainingMinutes} MIN
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="cathedral-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-sm bg-secondary flex items-center justify-center">
              <Eye className="w-5 h-5 text-gold" />
            </div>
            <div>
              <h3 className="font-display text-sm tracking-wider">SHIELD STRENGTH</h3>
              <p className="text-xs text-muted-foreground">Image filter intensity</p>
            </div>
          </div>

          <div className="flex gap-2">
            {blurLevels.map((level) => (
              <button
                key={level}
                onClick={() => handleBlurChange(level)}
                className={`flex-1 py-4 flex flex-col items-center gap-2 transition-all ${
                  settings.blur_sensitivity === level
                    ? 'bg-gold text-cathedral-midnight'
                    : 'border border-silver/30 text-silver hover:border-silver/60'
                }`}
              >
                {level === 'OFF' ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
                <span className="font-display text-xs tracking-wider">{level}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 text-xs text-muted-foreground">
            {settings.blur_sensitivity === 'OFF' && 'No image blurring applied'}
            {settings.blur_sensitivity === 'LOW' && 'Blurs explicit content only'}
            {settings.blur_sensitivity === 'HIGH' && 'Blurs suggestive and explicit content'}
          </div>
        </section>

        <section className="cathedral-card">
          <h3 className="font-display text-xs tracking-widest text-muted-foreground mb-4">
            BLOCKING OPTIONS
          </h3>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Flash Shield (pre-paint blur)</p>
                <p className="text-xs text-muted-foreground">Blur thumbnails on load, before AI scan - fixes blur-on-startup</p>
              </div>
              <button
                onClick={() => updateMwLocalSetting('flash_shield_enabled', !mwLocalSettings.flash_shield_enabled)}
                className={`w-12 h-7 rounded-full transition-all duration-300 ${
                  mwLocalSettings.flash_shield_enabled ? "bg-aqua" : "bg-secondary"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-foreground transition-transform duration-300 ${
                    mwLocalSettings.flash_shield_enabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Block Adult Sites</p>
                <p className="text-xs text-muted-foreground">Explicit content domains</p>
              </div>
              <button
                onClick={() => updateSetting('block_adult_sites', !settings.block_adult_sites)}
                className={`w-12 h-7 rounded-full transition-all duration-300 ${
                  settings.block_adult_sites ? "bg-aqua" : "bg-secondary"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-foreground transition-transform duration-300 ${
                    settings.block_adult_sites ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Block Social Media</p>
                <p className="text-xs text-muted-foreground">Instagram, Twitter, etc.</p>
              </div>
              <button
                onClick={() => updateSetting('block_social_media', !settings.block_social_media)}
                className={`w-12 h-7 rounded-full transition-all duration-300 ${
                  settings.block_social_media ? "bg-aqua" : "bg-secondary"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-foreground transition-transform duration-300 ${
                    settings.block_social_media ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Block Ads</p>
                <p className="text-xs text-muted-foreground">Ad networks</p>
              </div>
              <button
                onClick={() => updateSetting('block_ads', !settings.block_ads)}
                className={`w-12 h-7 rounded-full transition-all duration-300 ${
                  settings.block_ads ? "bg-aqua" : "bg-secondary"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-foreground transition-transform duration-300 ${
                    settings.block_ads ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        <section className="cathedral-card">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-sm bg-techBlue/20 flex items-center justify-center">
              <Coffee className="w-5 h-5 text-techBlue" />
            </div>
            <div>
              <h3 className="font-display text-sm tracking-wider">UTILITY PASS</h3>
              <p className="text-xs text-muted-foreground">Time-limited break system</p>
            </div>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <Clock className="w-4 h-4 mt-0.5 text-techBlue" />
              <div>
                <p className="text-foreground font-medium">Duration limits</p>
                <p className="text-xs">{UTILITY_PASS_DURATIONS.map(d => d.label).join(', ')} (max 15 min)</p>
              </div>
            </div>

            <div className="flex items-start gap-2 text-muted-foreground">
              <Lock className="w-4 h-4 mt-0.5 text-gold" />
              <div>
                <p className="text-foreground font-medium">Gate requirement</p>
                <p className="text-xs">Defense Room approval required</p>
              </div>
            </div>

            <div className="flex items-start gap-2 text-muted-foreground">
              <Shield className="w-4 h-4 mt-0.5 text-aqua" />
              <div>
                <p className="text-foreground font-medium">Protection status</p>
                <p className="text-xs">Active pass temporarily suspends shield enforcement</p>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Valid reasons: {UTILITY_PASS_REASONS.map(r => r.label).join(', ')}
            </p>
          </div>
        </section>

        <section
          className={`cathedral-card transition-all duration-300 ${
            effectiveShieldEnabled
              ? 'border-silver/20'
              : 'border-gold/50 shadow-[0_0_30px_hsl(45_100%_50%/0.2)]'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-sm flex items-center justify-center transition-all ${
                  effectiveShieldEnabled ? 'bg-secondary' : 'bg-gold'
                }`}
              >
                <DollarSign className={`w-5 h-5 ${effectiveShieldEnabled ? 'text-gold' : 'text-cathedral-midnight'}`} />
              </div>
              <div>
                <h3 className="font-display text-sm tracking-wider">FOCUS FINE</h3>
                <p className="text-xs text-muted-foreground">Per shield bypass attempt</p>
              </div>
            </div>
            <div className="text-right">
              <p className={`font-display text-lg ${effectiveShieldEnabled ? 'text-gold' : 'text-gold animate-pulse'}`}>$1.00</p>
              <p className="text-xs text-muted-foreground">per fine</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border">
            <div className={`flex items-center gap-2 ${effectiveShieldEnabled ? 'text-muted-foreground' : 'text-gold'}`}>
              <AlertTriangle className="w-4 h-4" />
              <span className="text-xs font-display tracking-wide">
                {effectiveShieldEnabled
                  ? 'Fine activated upon shield deactivation'
                  : 'SHIELD INACTIVE — FINE PENDING'
                }
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Settings;
