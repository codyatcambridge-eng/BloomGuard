import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X, AlertTriangle, DollarSign } from "lucide-react";
import { getCooldownRemaining } from "@/logic/ShieldEngine";
import type { ShieldId } from "@/logic/shields";
import type { CooldownType } from "@/storage/cooldownLocal";

interface FrictionUnlockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlock?: () => void;
  mode?: "settings_unlock" | "shield_lock";
  shieldLock?: {
    shieldId: ShieldId;
    targetId: string;
    type: CooldownType;
    calmCopy: string;
    onComplete: () => void;
    breathingCompanion?: ReactNode;
  };
}

const REQUIRED_VERSE = "I will keep my heart with all diligence; for out of it are the issues of life.";
const VERSE_REFERENCE = "Proverbs 4:23";

function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export const FrictionUnlockModal = ({
  isOpen,
  onClose,
  onUnlock,
  mode = "settings_unlock",
  shieldLock,
}: FrictionUnlockModalProps) => {
  const [input, setInput] = useState("");
  const [remainingSec, setRemainingSec] = useState(0);
  const [durationSec, setDurationSec] = useState(1);
  const completedRef = useRef(false);

  const isMatch = useMemo(() => input.trim() === REQUIRED_VERSE, [input]);
  const isShieldLockMode = mode === "shield_lock";

  const handleSubmit = () => {
    if (isMatch) {
      setInput("");
      onUnlock?.();
    }
  };

  const handleClose = () => {
    setInput("");
    onClose();
  };

  useEffect(() => {
    if (!isOpen || !isShieldLockMode || !shieldLock) {
      completedRef.current = false;
      return;
    }

    completedRef.current = false;

    const syncRemaining = () => {
      const status = getCooldownRemaining({
        shieldId: shieldLock.shieldId,
        targetId: shieldLock.targetId,
        type: shieldLock.type,
      });

      const nextRemaining = status.remainingSec;
      setRemainingSec(nextRemaining);
      setDurationSec((prev) => Math.max(1, status.session?.durationSec || prev));

      if (nextRemaining <= 0 && !completedRef.current) {
        completedRef.current = true;
        shieldLock.onComplete();
      }
    };

    syncRemaining();
    const intervalId = setInterval(syncRemaining, 500);
    return () => clearInterval(intervalId);
  }, [isOpen, isShieldLockMode, shieldLock]);

  if (!isOpen) return null;

  if (isShieldLockMode && shieldLock) {
    const progress = Math.max(0, Math.min(1, remainingSec / Math.max(1, durationSec)));
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-cathedral-midnight/98 backdrop-blur-md"
          style={{
            background: "radial-gradient(ellipse at center, hsl(220 60% 6%) 0%, hsl(220 70% 3%) 100%)",
          }}
        />
        <div
          className="relative w-full max-w-md p-6 border border-aqua/30"
          style={{
            background: "linear-gradient(145deg, hsl(220 50% 10%) 0%, hsl(220 60% 6%) 100%)",
            boxShadow: "0 0 48px hsl(194 100% 50% / 0.12), inset 0 1px 0 hsl(220 10% 30% / 0.1)",
          }}
        >
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-aqua" />
              <h2 className="font-display text-xl tracking-wider text-aqua">SHIELD LOCK</h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center text-silver hover:text-foreground transition-colors border border-silver/20 hover:border-silver/40"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-sm text-silver mb-4">{shieldLock.calmCopy}</p>

          <div className="mb-4 p-4 border border-aqua/25 rounded-md bg-aqua/5">
            <p className="text-xs text-muted-foreground mb-1">Cooldown remaining</p>
            <p className="font-display text-4xl tracking-wider text-aqua">{formatRemaining(remainingSec)}</p>
            <div className="mt-3 h-1.5 rounded-full bg-slate-900/80 overflow-hidden">
              <div
                className="h-full bg-aqua transition-[width] duration-500"
                style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
              />
            </div>
          </div>

          {shieldLock.breathingCompanion}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Full-screen blocking overlay */}
      <div 
        className="absolute inset-0 bg-cathedral-midnight/98 backdrop-blur-md"
        style={{
          background: 'radial-gradient(ellipse at center, hsl(220 60% 6%) 0%, hsl(220 70% 3%) 100%)',
        }}
      />
      
      {/* Modal content */}
      <div 
        className="relative w-full max-w-md p-6 border border-destructive/50"
        style={{
          background: 'linear-gradient(145deg, hsl(220 50% 10%) 0%, hsl(220 60% 6%) 100%)',
          boxShadow: '0 0 60px hsl(0 84% 60% / 0.2), inset 0 1px 0 hsl(220 10% 30% / 0.1)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-destructive animate-pulse" />
            <h2 className="font-display text-xl tracking-wider text-destructive">
              FRICTION UNLOCK
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center text-silver hover:text-foreground transition-colors border border-silver/20 hover:border-silver/40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Focus Fine Warning */}
        <div 
          className="flex items-center gap-3 p-3 mb-4 border border-gold/30"
          style={{
            background: 'linear-gradient(90deg, hsl(45 100% 50% / 0.05) 0%, transparent 100%)',
          }}
        >
          <DollarSign className="w-5 h-5 text-gold" />
          <div>
            <p className="text-sm font-display text-gold tracking-wide">FOCUS FINE: $1.00</p>
            <p className="text-xs text-muted-foreground">Charged upon deactivation</p>
          </div>
        </div>

        {/* Warning */}
        <p className="text-sm text-silver mb-4">
          To disable The Iron Shield, you must hand-type the following verse <span className="text-foreground font-semibold">exactly</span>:
        </p>

        {/* Verse to type */}
        <div 
          className="p-4 mb-4 border border-silver/20"
          style={{
            background: 'linear-gradient(135deg, hsl(220 40% 12%) 0%, hsl(220 50% 8%) 100%)',
          }}
        >
          <p className="text-sm italic text-foreground leading-relaxed">
            "{REQUIRED_VERSE}"
          </p>
          <p className="text-xs text-aqua mt-2 font-display tracking-wide">— {VERSE_REFERENCE} KJV</p>
        </div>

        {/* Input */}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type the verse exactly..."
          rows={4}
          className="w-full bg-input border rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none transition-colors resize-none border-silver/30 focus:border-aqua"
          style={{
            boxShadow: 'inset 0 2px 4px hsl(220 100% 3% / 0.3)',
          }}
        />

        {/* Match indicator */}
        <div className="flex items-center gap-2 mt-2 mb-4">
          <div 
            className={`w-2 h-2 rounded-full transition-colors ${
              isMatch ? 'bg-aqua animate-pulse' : 'bg-muted-foreground/30'
            }`}
          />
          <span className={`text-xs ${isMatch ? 'text-aqua' : 'text-muted-foreground'}`}>
            {isMatch ? 'VERSE MATCHED — UNLOCK AVAILABLE' : 'Awaiting exact match...'}
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleClose}
            className="flex-1 py-3 text-sm font-display tracking-wider border border-silver/30 hover:border-silver/60 text-silver hover:text-foreground transition-all"
          >
            KEEP SHIELD ACTIVE
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isMatch}
            className={`flex-1 py-3 text-sm font-display tracking-wider transition-all ${
              isMatch 
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-[0_0_20px_hsl(0_84%_60%/0.3)]' 
                : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
            }`}
          >
            DEACTIVATE ($1.00)
          </button>
        </div>
      </div>
    </div>
  );
};
