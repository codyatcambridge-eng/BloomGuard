import { StewardshipRing } from "@/components/dashboard/StewardshipRing";
import { Shield, Globe, Users, FileText, Settings as SettingsIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSettings } from "@/hooks/useSettings";

const Dashboard = () => {
  const navigate = useNavigate();
  const { settings, isLoading } = useSettings();

  const quickActions = [
    { path: "/browser", icon: Globe, label: "Safe Browser", color: "text-aqua" },
    { path: "/accountability", icon: Users, label: "Partners", color: "text-gold" },
    { path: "/logs", icon: FileText, label: "Logs", color: "text-silver" },
    { path: "/settings", icon: SettingsIcon, label: "Settings", color: "text-aqua" },
  ];

  return (
    <div className="min-h-screen pb-24 warroom-bg relative overflow-hidden">
      {/* Atmospheric overlay */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-gradient-to-b from-aqua/5 via-transparent to-transparent blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[300px] bg-gradient-to-tr from-cathedral-deep/40 via-transparent to-transparent" />
        <div className="absolute top-1/3 right-0 w-[300px] h-[400px] bg-gradient-to-l from-primary/20 via-transparent to-transparent" />
      </div>

      {/* Header */}
      <header className="relative z-10 px-4 pt-8 pb-4 border-b border-silver/20">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-aqua drop-shadow-[0_0_10px_hsl(180_100%_50%/0.5)]" />
          <div>
            <h1 className="font-display text-2xl tracking-wider">IRON WATCH</h1>
            <p className="text-xs text-silver uppercase tracking-widest">
              Digital Protection Active
            </p>
          </div>
        </div>
      </header>

      <main className="relative z-10 px-4 space-y-6">
        {/* Protection Status Ring */}
        <section className="flex flex-col items-center py-8">
          <h2 className="font-display text-sm tracking-widest text-silver mb-6">
            PROTECTION STATUS
          </h2>
          <StewardshipRing 
            percentage={settings.shield_active ? 100 : 0} 
            isActive={settings.shield_active} 
          />
          <div className="mt-4 text-center">
            <p className={`text-sm font-display tracking-wider ${
              settings.shield_active ? 'text-aqua' : 'text-destructive'
            }`}>
              {settings.shield_active ? 'SHIELD ACTIVE' : 'SHIELD INACTIVE'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Blur Level: {settings.blur_sensitivity}
            </p>
          </div>
        </section>

        {/* Quick Actions */}
        <section>
          <h2 className="font-display text-sm tracking-widest text-silver mb-3">
            QUICK ACTIONS
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map(({ path, icon: Icon, label, color }) => (
              <button
                key={path}
                onClick={() => navigate(path)}
                className="cathedral-card flex flex-col items-center gap-3 py-6 hover:border-aqua/50 transition-all"
              >
                <Icon className={`w-8 h-8 ${color}`} />
                <span className="font-display text-xs tracking-wider text-foreground">
                  {label.toUpperCase()}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Status Summary */}
        <section className="cathedral-card">
          <h3 className="font-display text-xs tracking-widest text-muted-foreground mb-3">
            PROTECTION SUMMARY
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Adult Sites</span>
              <span className={settings.block_adult_sites ? 'text-aqua' : 'text-silver'}>
                {settings.block_adult_sites ? 'BLOCKED' : 'ALLOWED'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Social Media</span>
              <span className={settings.block_social_media ? 'text-aqua' : 'text-silver'}>
                {settings.block_social_media ? 'BLOCKED' : 'ALLOWED'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Blur Sensitivity</span>
              <span className="text-gold">{settings.blur_sensitivity}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
