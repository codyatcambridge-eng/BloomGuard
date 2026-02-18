import { useEffect, useMemo, useState } from 'react';

type BreathPhase = 'inhale' | 'hold_in' | 'exhale' | 'hold_out';

interface WaveBreathProps {
  isReducedMotion?: boolean;
}

const PHASE_SECONDS = 4;
const PHASE_ORDER: BreathPhase[] = ['inhale', 'hold_in', 'exhale', 'hold_out'];

function getPhaseLabel(phase: BreathPhase): string {
  if (phase === 'inhale') return 'Inhale';
  if (phase === 'hold_in') return 'Hold';
  if (phase === 'exhale') return 'Exhale';
  return 'Hold';
}

export function WaveBreath({ isReducedMotion = false }: WaveBreathProps) {
  const [isRunning, setIsRunning] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [hapticsMuted, setHapticsMuted] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const phase = PHASE_ORDER[phaseIndex];
  const phaseText = getPhaseLabel(phase);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => setPrefersReducedMotion(mediaQuery.matches);
    syncPreference();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', syncPreference);
      return () => mediaQuery.removeEventListener('change', syncPreference);
    }
    mediaQuery.addListener(syncPreference);
    return () => mediaQuery.removeListener(syncPreference);
  }, []);

  const shouldReduceMotion = isReducedMotion || prefersReducedMotion;

  useEffect(() => {
    if (!isRunning) return;

    const intervalId = setInterval(() => {
      setPhaseIndex((prev) => (prev + 1) % PHASE_ORDER.length);
      // No-op haptics fallback when no utility is installed.
      if (!hapticsMuted) {
        void 0;
      }
    }, PHASE_SECONDS * 1000);

    return () => clearInterval(intervalId);
  }, [isRunning, hapticsMuted]);

  const phaseScale = useMemo(() => {
    if (shouldReduceMotion) return 1;
    if (phase === 'inhale') return 1.08;
    if (phase === 'exhale') return 0.94;
    return 1;
  }, [phase, shouldReduceMotion]);

  const phaseOpacity = useMemo(() => {
    if (shouldReduceMotion) return 0.65;
    if (phase === 'inhale') return 0.85;
    if (phase === 'exhale') return 0.5;
    return 0.65;
  }, [phase, shouldReduceMotion]);

  return (
    <div className="w-full rounded-xl border border-aqua/25 bg-aqua/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-display tracking-wide text-aqua">Wave Breath</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setHapticsMuted((prev) => !prev)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {hapticsMuted ? 'Unmute haptics' : 'Mute haptics'}
          </button>
          <button
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {isCollapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="mt-3">
          <div
            className="relative h-24 rounded-lg overflow-hidden border border-aqua/20"
            style={{
              background:
                'linear-gradient(160deg, hsl(194 95% 19% / 0.24) 0%, hsl(210 52% 12% / 0.18) 55%, hsl(213 45% 10% / 0.12) 100%)',
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                transform: `scale(${phaseScale})`,
                opacity: phaseOpacity,
                transition: shouldReduceMotion ? 'none' : 'transform 4s linear, opacity 4s linear',
                background:
                  'radial-gradient(60% 60% at 50% 70%, hsl(186 93% 52% / 0.26) 0%, hsl(197 92% 48% / 0.12) 44%, transparent 85%)',
              }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{phaseText} 4s</p>
            <button
              onClick={() => setIsRunning((prev) => !prev)}
              className="text-xs text-aqua hover:text-aqua/80 transition-colors"
            >
              {isRunning ? 'Stop breathing' : 'Start breathing'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
