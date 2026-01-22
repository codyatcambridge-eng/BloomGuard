import { useState } from "react";
import { Shield, DollarSign, CreditCard, AlertTriangle } from "lucide-react";
import { FrictionUnlockModal } from "@/components/settings/FrictionUnlockModal";

const Settings = () => {
  const [shieldActive, setShieldActive] = useState(true);
  const [showFrictionModal, setShowFrictionModal] = useState(false);

  const handleShieldToggle = () => {
    if (shieldActive) {
      // Trying to turn OFF - show friction modal
      setShowFrictionModal(true);
    } else {
      // Turning ON - no friction
      setShieldActive(true);
    }
  };

  const handleUnlock = () => {
    setShieldActive(false);
    setShowFrictionModal(false);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-4 pt-8 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-aqua" />
          <div>
            <h1 className="font-display text-2xl tracking-wider">SETTINGS</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">
              The Iron Shield Configuration
            </p>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 space-y-6">
        {/* Iron Shield Toggle */}
        <section className="cathedral-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-sm flex items-center justify-center ${
                shieldActive ? "bg-aqua" : "bg-secondary"
              }`}>
                <Shield className={`w-5 h-5 ${shieldActive ? "text-accent-foreground" : "text-muted-foreground"}`} />
              </div>
              <div>
                <h3 className="font-display text-sm tracking-wider">THE IRON SHIELD</h3>
                <p className="text-xs text-muted-foreground">App Blocker Protection</p>
              </div>
            </div>
            <button
              onClick={handleShieldToggle}
              className={`w-14 h-8 rounded-full transition-all duration-300 ${
                shieldActive ? "bg-aqua" : "bg-secondary"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full bg-foreground transition-transform duration-300 ${
                  shieldActive ? "translate-x-7" : "translate-x-1"
                }`}
              />
            </button>
          </div>
          
          {shieldActive && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2 text-aqua">
                <div className="w-2 h-2 rounded-full bg-aqua animate-pulse" />
                <span className="text-xs font-display tracking-wider">PROTECTION ACTIVE</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Family Controls API: com.apple.developer.family-controls
              </p>
            </div>
          )}
        </section>

        {/* Guardian Economy */}
        <section>
          <h2 className="font-display text-sm tracking-widest text-muted-foreground mb-3">
            GUARDIAN ECONOMY
          </h2>
          
          {/* Subscription */}
          <div className="cathedral-card mb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-sm bg-secondary flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-aqua" />
                </div>
                <div>
                  <h3 className="font-display text-sm tracking-wider">GUARDIAN PRO</h3>
                  <p className="text-xs text-muted-foreground">Monthly Subscription</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-display text-lg text-aqua">$4.99</p>
                <p className="text-xs text-muted-foreground">/month</p>
              </div>
            </div>
            <button className="w-full mt-4 py-3 text-sm font-display tracking-wider bg-aqua text-accent-foreground hover:bg-aqua/90 transition-colors">
              SUBSCRIBE NOW
            </button>
          </div>

          {/* Focus Fine */}
          <div className="cathedral-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-sm bg-secondary flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-gold" />
                </div>
                <div>
                  <h3 className="font-display text-sm tracking-wider">FOCUS FINE</h3>
                  <p className="text-xs text-muted-foreground">Per shield bypass attempt</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-display text-lg text-gold">$1.00</p>
                <p className="text-xs text-muted-foreground">per fine</p>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-xs">Charged when Iron Shield is deactivated</span>
              </div>
            </div>
          </div>
        </section>

        {/* API Info */}
        <section className="cathedral-card bg-secondary/30">
          <h3 className="font-display text-xs tracking-widest text-muted-foreground mb-2">
            TECHNICAL INTEGRATION
          </h3>
          <code className="text-xs text-aqua break-all">
            com.apple.developer.family-controls
          </code>
          <p className="text-xs text-muted-foreground mt-2">
            Screen Time API integration pending native bridge implementation.
          </p>
        </section>
      </main>

      <FrictionUnlockModal
        isOpen={showFrictionModal}
        onClose={() => setShowFrictionModal(false)}
        onUnlock={handleUnlock}
      />
    </div>
  );
};

export default Settings;
