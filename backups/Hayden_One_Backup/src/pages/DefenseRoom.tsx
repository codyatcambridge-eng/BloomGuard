import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Shield, Timer, Waves, Focus, Wind, Clock3, CheckCircle2 } from 'lucide-react';
import { useGateRuntime, type GateRequestContext } from '@/hooks/useGateRuntime';
import { toast } from 'sonner';
import { shouldReduceMotion } from '@/ui/theme';

const REQUIRED_VERSE = "I will keep my heart with all diligence; for out of it are the issues of life.";
const STATE_OPTIONS = [
  { id: 'urge', label: 'Urge' },
  { id: 'overstimulated', label: 'Overstimulated' },
  { id: 'anxious', label: 'Anxious' },
  { id: 'avoiding', label: 'Avoiding' },
  { id: 'bored', label: 'Bored' },
  { id: 'low_energy', label: 'Low energy' },
] as const;

const GROUND_STEPS = [
  { id: 'see', label: 'See', target: 5 },
  { id: 'feel', label: 'Feel', target: 4 },
  { id: 'hear', label: 'Hear', target: 3 },
  { id: 'smell', label: 'Smell', target: 2 },
  { id: 'taste', label: 'Taste', target: 1 },
] as const;

const BREAK_ACTIONS = [
  'Drink water',
  'Stretch shoulders',
  '10 deep breaths',
  'Step outside',
  'Text accountability partner',
] as const;

type DetectorState = (typeof STATE_OPTIONS)[number]['id'] | null;
type ToolId = 'reflect' | 'urge_surf' | 'ground' | 'future_self' | 'break_time';
type FutureSelfState = 'proud' | 'neutral' | 'regretful' | null;

interface CountdownState {
  remaining: number;
  running: boolean;
  complete: boolean;
}

function isGateContext(value: string | null): value is GateRequestContext {
  return value === 'DisableShield' || value === 'RevealAttempt' || value === 'StartPass';
}

function isToolId(value: string | null): value is ToolId {
  return (
    value === 'reflect' ||
    value === 'urge_surf' ||
    value === 'ground' ||
    value === 'future_self' ||
    value === 'break_time'
  );
}

function formatClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const candidates = Array.from(container.querySelectorAll<HTMLElement>(selector));
  return candidates.filter((node) => node.offsetParent !== null || node === document.activeElement);
}

function useCountdown(durationSeconds: number) {
  const [state, setState] = useState<CountdownState>({
    remaining: durationSeconds,
    running: false,
    complete: false,
  });
  const endAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    endAtRef.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    const endAt = Date.now() + durationSeconds * 1000;
    endAtRef.current = endAt;
    setState({
      remaining: durationSeconds,
      running: true,
      complete: false,
    });

    timerRef.current = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      if (remaining <= 0) {
        stop();
        setState({
          remaining: 0,
          running: false,
          complete: true,
        });
        return;
      }
      setState({
        remaining,
        running: true,
        complete: false,
      });
    }, 1000);
  }, [durationSeconds, stop]);

  const reset = useCallback(() => {
    stop();
    setState({
      remaining: durationSeconds,
      running: false,
      complete: false,
    });
  }, [durationSeconds, stop]);

  useEffect(() => {
    return () => stop();
  }, [stop]);

  return {
    ...state,
    start,
    reset,
  };
}

const DefenseRoom = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reduceMotion = shouldReduceMotion();
  const transitionClass = reduceMotion ? 'duration-0' : 'duration-200';
  const context: GateRequestContext = isGateContext(params.get('context')) ? params.get('context') : 'DisableShield';
  const initialTool: ToolId = isToolId(params.get('tool')) ? params.get('tool') : 'reflect';

  const {
    effectiveShieldState,
    requestAccess,
    startPass,
    applyCooldown,
  } = useGateRuntime();

  const roomRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const [activeTool, setActiveTool] = useState<ToolId>(initialTool);
  const [detectorState, setDetectorState] = useState<DetectorState>('urge');
  const [canContinue, setCanContinue] = useState(() => requestAccess(context).allowed);
  const [accessReason, setAccessReason] = useState(() => requestAccess(context).reason);

  const [reflectGoal, setReflectGoal] = useState('');
  const [faithMode, setFaithMode] = useState(false);
  const [reflectVerse, setReflectVerse] = useState('');
  const [transmutationChecked, setTransmutationChecked] = useState(false);

  const urgeTimer = useCountdown(90);
  const [urgeLocation, setUrgeLocation] = useState('');
  const [urgeIntensity, setUrgeIntensity] = useState<number>(3);
  const [urgeTrigger, setUrgeTrigger] = useState('');
  const [urgeReflection, setUrgeReflection] = useState('');

  const [groundCounts, setGroundCounts] = useState<Record<string, number>>({
    see: 0,
    feel: 0,
    hear: 0,
    smell: 0,
    taste: 0,
  });

  const [futureSelf, setFutureSelf] = useState<FutureSelfState>(null);
  const [futureNote, setFutureNote] = useState('');

  const [breakActions, setBreakActions] = useState<Record<string, boolean>>(() =>
    BREAK_ACTIONS.reduce<Record<string, boolean>>((acc, label) => {
      acc[label] = false;
      return acc;
    }, {}),
  );
  const [breakDurationSeconds, setBreakDurationSeconds] = useState(120);
  const {
    remaining: breakRemaining,
    running: breakRunning,
    complete: breakTimerComplete,
    start: startBreakTimer,
    reset: resetBreakTimer,
  } = useCountdown(breakDurationSeconds);
  const [breakDone, setBreakDone] = useState(false);

  useEffect(() => {
    const decision = requestAccess(context);
    setCanContinue(decision.allowed);
    setAccessReason(decision.reason);
  }, [context, requestAccess, effectiveShieldState.cooldownRemainingSeconds, effectiveShieldState.passRemainingSeconds, effectiveShieldState.shieldEnabled]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        navigate(-1);
        return;
      }

      if (event.key !== 'Tab') return;
      const container = roomRef.current;
      if (!container) return;

      const focusables = getFocusableElements(container);
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [navigate]);

  useEffect(() => {
    setActiveTool(initialTool);
  }, [initialTool]);

  useEffect(() => {
    setBreakDone(false);
    resetBreakTimer();
  }, [breakDurationSeconds, resetBreakTimer]);

  const reflectComplete =
    reflectGoal.trim().length >= 8 &&
    transmutationChecked &&
    (!faithMode || reflectVerse.trim() === REQUIRED_VERSE);
  const urgeComplete = urgeTimer.complete && urgeReflection.trim().length >= 8;
  const groundComplete = GROUND_STEPS.every((step) => (groundCounts[step.id] || 0) >= step.target);
  const futureComplete = futureSelf !== null;
  const breakActionCount = Object.values(breakActions).filter(Boolean).length;
  const canMarkBreakDone = breakActionCount > 0 && breakTimerComplete;
  const breakComplete = breakDone;

  const completedByTool = useMemo<Record<ToolId, boolean>>(
    () => ({
      reflect: reflectComplete,
      urge_surf: urgeComplete,
      ground: groundComplete,
      future_self: futureComplete,
      break_time: breakComplete,
    }),
    [reflectComplete, urgeComplete, groundComplete, futureComplete, breakComplete],
  );

  const completedCount = useMemo(() => Object.values(completedByTool).filter(Boolean).length, [completedByTool]);
  const passDurationMinutes = context === 'DisableShield' ? 15 : 10;

  const handleGroundTap = useCallback((stepId: string, target: number) => {
    setGroundCounts((prev) => ({
      ...prev,
      [stepId]: Math.min(target, (prev[stepId] || 0) + 1),
    }));
  }, []);

  const handleToggleBreakAction = useCallback((label: string) => {
    setBreakActions((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
  }, []);

  const handleContinue = useCallback(() => {
    const decision = requestAccess(context);
    setCanContinue(decision.allowed);
    setAccessReason(decision.reason);

    if (!decision.allowed) {
      toast.error(decision.reason);
      return;
    }

    if (context === 'RevealAttempt') {
      applyCooldown(30, 'reveal_attempt_cooldown');
      toast.success('Reveal access granted');
      navigate(-1);
      return;
    }

    const reason = [
      context,
      detectorState || 'unknown',
      activeTool,
      `tools:${completedCount}`,
    ].join('|');

    startPass({
      reason,
      duration: passDurationMinutes,
    });

    if (context === 'DisableShield') {
      toast.success('Shield deactivated for 15 minutes');
      navigate('/settings');
      return;
    }

    toast.success(`Pass started for ${passDurationMinutes} minutes`);
    navigate('/');
  }, [requestAccess, context, detectorState, activeTool, completedCount, startPass, passDurationMinutes, navigate, applyCooldown]);

  const shieldStatusLabel = effectiveShieldState.shieldEnabled
    ? 'Shield active'
    : `Shield pass active (${Math.max(1, Math.ceil(effectiveShieldState.passRemainingSeconds / 60))}m left)`;

  return (
    <div className="min-h-screen bg-background pb-24">
      <div
        ref={roomRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="defense-room-title"
        className="relative min-h-screen"
      >
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_18%_12%,rgba(125,200,255,0.12),transparent_35%),radial-gradient(circle_at_85%_18%,rgba(80,220,170,0.14),transparent_38%),linear-gradient(180deg,rgba(10,15,20,0.9),rgba(15,18,22,0.98))]" />
        <main className="relative z-10 mx-auto max-w-3xl px-4 pb-20 pt-6 space-y-6">
          <header className="rounded-xl border border-silver/20 bg-cathedral-deep/70 p-4 backdrop-blur-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1
                  id="defense-room-title"
                  ref={titleRef}
                  tabIndex={-1}
                  className="font-display text-2xl tracking-wider text-gold outline-none"
                >
                  Defense Room
                </h1>
                <p className="text-xs text-muted-foreground uppercase tracking-[0.18em]">
                  Cognitive Defense Architecture
                </p>
              </div>
              <div className="rounded-lg border border-aqua/30 bg-aqua/10 px-3 py-2 text-right">
                <p className="text-xs text-muted-foreground">Context</p>
                <p className="text-sm font-medium text-aqua">{context}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-silver/20 bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Shield Status</p>
                <p className="text-sm font-medium">{shieldStatusLabel}</p>
              </div>
              <div className="rounded-lg border border-silver/20 bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Cooldown</p>
                <p className="text-sm font-medium">
                  {effectiveShieldState.cooldownActive
                    ? formatClock(effectiveShieldState.cooldownRemainingSeconds)
                    : 'None'}
                </p>
              </div>
              <div className="rounded-lg border border-silver/20 bg-background/40 p-3">
                <p className="text-xs text-muted-foreground">Tool Progress</p>
                <p className="text-sm font-medium">{completedCount}/5 completed</p>
              </div>
            </div>
          </header>

          <section className="rounded-xl border border-silver/20 bg-cathedral-deep/60 p-4">
            <h2 className="font-display text-base tracking-wider text-foreground">State Detector</h2>
            <p className="text-xs text-muted-foreground mb-3">Select your current state before choosing a tool.</p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              {STATE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  onClick={() => setDetectorState(option.id)}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    detectorState === option.id
                      ? 'border-aqua/60 bg-aqua/15 text-aqua'
                      : 'border-silver/20 bg-background/35 text-silver hover:border-silver/45'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-silver/20 bg-cathedral-deep/60 p-4">
            <h2 className="font-display text-base tracking-wider text-foreground mb-3">Tool Box</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
              {[
                { id: 'reflect' as const, label: 'Reflect', icon: Focus },
                { id: 'urge_surf' as const, label: 'Urge Surf', icon: Waves },
                { id: 'ground' as const, label: 'Ground', icon: Wind },
                { id: 'future_self' as const, label: 'Future Self', icon: Shield },
                { id: 'break_time' as const, label: 'Break Time', icon: Clock3 },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTool(id)}
                  className={`rounded-lg border px-3 py-3 text-left transition-all ${transitionClass} ${
                    activeTool === id
                      ? 'border-gold/60 bg-gold/10'
                      : 'border-silver/20 bg-background/35 hover:border-silver/45'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <Icon className={`h-4 w-4 ${activeTool === id ? 'text-gold' : 'text-silver'}`} />
                    {completedByTool[id] && <CheckCircle2 className="h-4 w-4 text-aqua" />}
                  </div>
                  <p className="mt-2 text-xs font-medium">{label}</p>
                </button>
              ))}
            </div>

            {activeTool === 'reflect' && (
              <div className="space-y-3 rounded-lg border border-silver/20 bg-background/40 p-4">
                <h3 className="font-display text-sm tracking-wider">Reflect</h3>
                <input
                  value={reflectGoal}
                  onChange={(event) => setReflectGoal(event.target.value)}
                  placeholder="Goal check: what matters in the next 15 minutes?"
                  className="w-full rounded-md border border-silver/30 bg-background px-3 py-2 text-sm"
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={faithMode}
                    onChange={(event) => setFaithMode(event.target.checked)}
                  />
                  Faith mode (requires verse match)
                </label>
                {faithMode && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">{REQUIRED_VERSE}</p>
                    <textarea
                      value={reflectVerse}
                      onChange={(event) => setReflectVerse(event.target.value)}
                      placeholder="Type the verse exactly"
                      rows={3}
                      className="w-full rounded-md border border-silver/30 bg-background px-3 py-2 text-sm"
                    />
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={transmutationChecked}
                    onChange={(event) => setTransmutationChecked(event.target.checked)}
                  />
                  Transmutation test: I can name one constructive next action.
                </label>
              </div>
            )}

            {activeTool === 'urge_surf' && (
              <div className="space-y-3 rounded-lg border border-silver/20 bg-background/40 p-4">
                <h3 className="font-display text-sm tracking-wider">Urge Surf</h3>
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center gap-2 rounded-md border border-aqua/40 bg-aqua/10 px-3 py-1.5">
                    <Timer className="h-4 w-4 text-aqua" />
                    <span className="text-sm font-medium">{formatClock(urgeTimer.remaining)}</span>
                  </div>
                  <button
                    onClick={urgeTimer.start}
                    disabled={urgeTimer.running}
                    className="rounded-md border border-silver/30 px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    {urgeTimer.complete ? 'Restart' : 'Start 90s'}
                  </button>
                </div>
                <input
                  value={urgeLocation}
                  onChange={(event) => setUrgeLocation(event.target.value)}
                  placeholder="Body location (chest, stomach, jaw...)"
                  className="w-full rounded-md border border-silver/30 bg-background px-3 py-2 text-sm"
                />
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Intensity</p>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        key={value}
                        onClick={() => setUrgeIntensity(value)}
                        className={`h-9 w-9 rounded-md border text-sm ${
                          urgeIntensity === value
                            ? 'border-aqua/60 bg-aqua/20 text-aqua'
                            : 'border-silver/30 bg-background/40'
                        }`}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  value={urgeTrigger}
                  onChange={(event) => setUrgeTrigger(event.target.value)}
                  placeholder="Trigger note"
                  rows={2}
                  className="w-full rounded-md border border-silver/30 bg-background px-3 py-2 text-sm"
                />
                <textarea
                  value={urgeReflection}
                  onChange={(event) => setUrgeReflection(event.target.value)}
                  placeholder="Reflection after timer"
                  rows={3}
                  className="w-full rounded-md border border-silver/30 bg-background px-3 py-2 text-sm"
                />
              </div>
            )}

            {activeTool === 'ground' && (
              <div className="space-y-3 rounded-lg border border-silver/20 bg-background/40 p-4">
                <h3 className="font-display text-sm tracking-wider">Ground (5-4-3-2-1)</h3>
                <div className="grid gap-2 md:grid-cols-2">
                  {GROUND_STEPS.map((step) => (
                    <button
                      key={step.id}
                      onClick={() => handleGroundTap(step.id, step.target)}
                      className="rounded-md border border-silver/30 bg-background/45 px-3 py-2 text-left"
                    >
                      <p className="text-sm font-medium">{step.target} {step.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {Math.min(step.target, groundCounts[step.id] || 0)}/{step.target} logged
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeTool === 'future_self' && (
              <div className="space-y-3 rounded-lg border border-silver/20 bg-background/40 p-4">
                <h3 className="font-display text-sm tracking-wider">Future Self</h3>
                <div className="flex gap-2">
                  {(['proud', 'neutral', 'regretful'] as const).map((state) => (
                    <button
                      key={state}
                      onClick={() => setFutureSelf(state)}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                        futureSelf === state
                          ? 'border-aqua/60 bg-aqua/15 text-aqua'
                          : 'border-silver/30 bg-background/40'
                      }`}
                    >
                      {state}
                    </button>
                  ))}
                </div>
                <textarea
                  value={futureNote}
                  onChange={(event) => setFutureNote(event.target.value)}
                  placeholder="Optional note to your future self"
                  rows={3}
                  className="w-full rounded-md border border-silver/30 bg-background px-3 py-2 text-sm"
                />
              </div>
            )}

            {activeTool === 'break_time' && (
              <div className="space-y-3 rounded-lg border border-silver/20 bg-background/40 p-4">
                <h3 className="font-display text-sm tracking-wider">Break Time</h3>
                <div className="flex gap-2">
                  {[60, 120, 180].map((seconds) => (
                    <button
                      key={seconds}
                      onClick={() => setBreakDurationSeconds(seconds)}
                      className={`rounded-md border px-3 py-1.5 text-sm ${
                        breakDurationSeconds === seconds
                          ? 'border-aqua/60 bg-aqua/15 text-aqua'
                          : 'border-silver/30 bg-background/40'
                      }`}
                    >
                      {Math.round(seconds / 60)}m
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center gap-2 rounded-md border border-aqua/40 bg-aqua/10 px-3 py-1.5">
                    <Timer className="h-4 w-4 text-aqua" />
                    <span className="text-sm font-medium">{formatClock(breakRemaining)}</span>
                  </div>
                  <button
                    onClick={startBreakTimer}
                    disabled={breakRunning}
                    className="rounded-md border border-silver/30 px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    {breakTimerComplete ? 'Restart' : 'Start timer'}
                  </button>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {BREAK_ACTIONS.map((action) => (
                    <label key={action} className="flex items-center gap-2 rounded-md border border-silver/20 bg-background/35 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={breakActions[action]}
                        onChange={() => handleToggleBreakAction(action)}
                      />
                      {action}
                    </label>
                  ))}
                </div>
                <button
                  onClick={() => setBreakDone(true)}
                  disabled={!canMarkBreakDone}
                  className="rounded-md border border-aqua/50 bg-aqua/15 px-3 py-2 text-sm text-aqua disabled:opacity-50"
                >
                  Done
                </button>
              </div>
            )}
          </section>

          <footer className="rounded-xl border border-silver/20 bg-cathedral-deep/70 p-4 backdrop-blur-sm">
            <p className="text-xs text-muted-foreground mb-3">
              Policy: {accessReason}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={() => navigate(-1)}
                className="rounded-md border border-silver/30 px-4 py-2 text-sm"
              >
                Back
              </button>
              {canContinue ? (
                <button
                  onClick={handleContinue}
                  className="rounded-md border border-destructive/60 bg-destructive/20 px-4 py-2 text-sm text-destructive-foreground"
                >
                  Continue anyway ({passDurationMinutes} minutes)
                </button>
              ) : (
                <p className="text-xs text-gold">
                  Continue blocked until cooldown ends ({formatClock(effectiveShieldState.cooldownRemainingSeconds)}).
                </p>
              )}
            </div>
          </footer>
        </main>
      </div>
    </div>
  );
};

export default DefenseRoom;
