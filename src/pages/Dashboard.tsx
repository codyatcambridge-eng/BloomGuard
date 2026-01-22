import { StewardshipRing } from "@/components/dashboard/StewardshipRing";
import { DailyBread } from "@/components/dashboard/DailyBread";
import { QuickLaunch } from "@/components/dashboard/QuickLaunch";
import { Shield } from "lucide-react";

const Dashboard = () => {
  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-4 pt-8 pb-4">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-aqua" />
          <div>
            <h1 className="font-display text-2xl tracking-wider">MIRACLE WORKER</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">
              Digital Stewardship Active
            </p>
          </div>
        </div>
      </header>

      <main className="px-4 space-y-6">
        {/* Stewardship Ring Section */}
        <section className="flex flex-col items-center py-8">
          <h2 className="font-display text-sm tracking-widest text-muted-foreground mb-6">
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
          <h2 className="font-display text-sm tracking-widest text-muted-foreground mb-3">
            QUICK ACTIONS
          </h2>
          <QuickLaunch />
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
