import { StewardshipRing } from "@/components/dashboard/StewardshipRing";
import { DailyBread } from "@/components/dashboard/DailyBread";
import { QuickLaunch } from "@/components/dashboard/QuickLaunch";
import { Shield } from "lucide-react";

const Dashboard = () => {
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
            <h1 className="font-display text-2xl tracking-wider">MIRACLE WORKER</h1>
            <p className="text-xs text-silver uppercase tracking-widest">
              Digital Stewardship Active
            </p>
          </div>
        </div>
      </header>

      <main className="relative z-10 px-4 space-y-6">
        {/* Stewardship Ring Section */}
        <section className="flex flex-col items-center py-8">
          <h2 className="font-display text-sm tracking-widest text-silver mb-6">
            DIGITAL STEWARDSHIP
          </h2>
          <StewardshipRing percentage={87} isActive={true} />
          <p className="mt-4 text-sm text-muted-foreground text-center max-w-xs">
            Your shield is active. Stay disciplined, stay protected.
          </p>
        </section>

        {/* Daily Bread */}
        <section>
          <DailyBread />
        </section>

        {/* Quick Launch */}
        <section>
          <h2 className="font-display text-sm tracking-widest text-silver mb-3">
            QUICK ACTIONS
          </h2>
          <QuickLaunch />
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
