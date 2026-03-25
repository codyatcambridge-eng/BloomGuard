/**
 * Utility Pass Modal
 *
 * Active Task Terminal refactor:
 * - AI-native chat backdrop (SparkSmith)
 * - Peripheral HUD timer
 * - Run 1 stagnation gate + liquid-glass controls
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Send, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import {
  type UtilityPassReason,
  type UtilityPassDuration,
  getUtilityPassGateLevel,
} from '@/logic/utilityPass';
import { UserProgress } from '@/models/UserProgress';
import { createPartnerRequest } from '@/models/PartnerRequest';
import { savePartnerRequest } from '@/storage/eventsRepo';
import { toast } from '@/hooks/use-toast';
import { shouldReduceMotion } from '@/ui/theme';
import { requestHfChatCompletion, type HfChatMessage } from '@/lib/hfChatClient';

interface UtilityPassModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (reason: UtilityPassReason, duration: UtilityPassDuration, gateLevel: number) => void;
  onResisted?: () => Promise<void> | void;
  progress: UserProgress;
  className?: string;
}

type SparkSmithToneState = 'hot' | 'reflective';
type ChatRole = 'assistant' | 'user';
type ChatInputMode = 'type' | 'clarity';

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

const SPARKSMITH_NAME = 'SparkSmith';
const SPARKSMITH_ROLE = 'Calm Reflection Assistant';
const SPARKSMITH_SPECIALIZATION = 'Friction-moment reflection and grounded next steps';
const SPARKSMITH_BASELINE_IDENTITY = 'Calm, practical, and concise.';
const SPARKSMITH_GREETING =
  `I am ${SPARKSMITH_NAME}. I help you pause, reflect, and pick one grounded next step. ${SPARKSMITH_BASELINE_IDENTITY}`;
const SPARKSMITH_SYSTEM_PROMPT =
  'You are SparkSmith, a calm and grounded reflection assistant in a break waiting room. ' +
  'Be supportive, practical, and concise. Keep most responses to 2-4 short sentences. ' +
  'Do not be preachy, manipulative, melodramatic, or shaming. ' +
  'Focus on helping the user name what is happening and choose one realistic next step for the next five minutes. ' +
  'Ask a clarifying question when it improves usefulness. ' +
  'Do not claim to be a therapist, crisis service, doctor, or legal authority. ' +
  'Do not overclaim certainty. If information is incomplete, say so briefly.';

const DEFAULT_REASON: UtilityPassReason = 'WORK';
const DEFAULT_DURATION: UtilityPassDuration = 5;
const HANDSHAKE_EXPIRY_MS = 5 * 60 * 1000;
const RUN_ONE_START_SECONDS = 45;
const RUN_ONE_STAGNATION_SECONDS = 1;
const RUN_ONE_LABEL = 'RUN 1: PROVE INTENT';
const CLARITY_QUICK_PICKS = [
  'Anxious',
  'Restless',
  'Bored',
  'Lonely',
  'Tempted',
  'Want to relax',
] as const;
const DEFAULT_TONE_STATE: SparkSmithToneState = 'reflective';
const DEFAULT_INPUT_MODE: ChatInputMode = 'type';
const MIN_TYPING_WINDOW_MS = 350;
const HOT_SENTIMENT_PATTERNS: RegExp[] = [
  /\bright now\b/i,
  /\bnow\b/i,
  /\bneed\b/i,
  /\bmust\b/i,
  /\burgent\b/i,
  /\bpanic\b/i,
  /\bangry\b/i,
  /\boverwhelm(?:ed|ing)?\b/i,
  /\bstress(?:ed|ing)?\b/i,
  /\bcan't\b/i,
  /\bcannot\b/i,
  /\bphone\b/i,
];

type ConflictHeader = (typeof CLARITY_QUICK_PICKS)[number];

const liquidGlassStyle: CSSProperties = {
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '0.5px solid rgba(255, 255, 255, 0.2)',
  boxShadow:
    '0 0 0.4px rgba(255, 255, 255, 0.45), inset 0 1px 14px rgba(255, 255, 255, 0.08), 0 10px 28px rgba(0, 0, 0, 0.3)',
};

const hudTimerAnchorStyle: CSSProperties = {
  top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
  left: '16px',
};

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
  return candidates.filter((element) => {
    if (element.getAttribute('aria-hidden') === 'true') return false;
    return element.offsetParent !== null || element === document.activeElement;
  });
}

function formatCountdown(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function cleanTopic(topic: string): string {
  const normalized = topic.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'the current topic';
  return normalized.length > 100 ? `${normalized.slice(0, 97)}...` : normalized;
}

function buildClarityDraft(pick: ConflictHeader): string {
  const normalized = pick.toLowerCase();
  const lead = normalized === 'want to relax' ? 'I want to relax.' : `I feel ${normalized}.`;
  return `${lead} Help me pick one grounded next action for the next 5 minutes.`;
}

function isValidRunOneInput(input: string): boolean {
  return input.trim().length > 0;
}

function getWordCount(input: string): number {
  const trimmed = input.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function getSentenceCount(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;

  const sentences = trimmed
    .split(/[.!?]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  return Math.max(sentences.length, 1);
}

function estimateTypingCharsPerSecond(input: string, startedAtMs: number | null): number {
  if (!startedAtMs) return 0;

  const elapsedMs = Math.max(Date.now() - startedAtMs, MIN_TYPING_WINDOW_MS);
  return input.length / (elapsedMs / 1000);
}

function getHotSentimentScore(input: string): number {
  let score = 0;

  for (const pattern of HOT_SENTIMENT_PATTERNS) {
    if (pattern.test(input)) score += 1;
  }

  if (/[!?]{2,}/.test(input)) score += 1;
  if (/\b[A-Z]{4,}\b/.test(input)) score += 1;

  return score;
}

function analyzeSparkSmithTone(input: string, typingCharsPerSecond: number): SparkSmithToneState {
  const wordCount = getWordCount(input);
  const sentenceCount = getSentenceCount(input);
  const sentimentScore = getHotSentimentScore(input);

  const hotScore =
    (wordCount > 0 && wordCount <= 8 ? 2 : 0) +
    (typingCharsPerSecond >= 4.2 ? 1 : 0) +
    Math.min(sentimentScore, 3);

  const reflectiveScore =
    (sentenceCount >= 2 ? 2 : 0) +
    (wordCount >= 12 ? 1 : 0) +
    (typingCharsPerSecond > 0 && typingCharsPerSecond <= 2.2 ? 1 : 0) +
    (sentimentScore === 0 ? 1 : 0);

  return hotScore >= 3 && hotScore >= reflectiveScore ? 'hot' : 'reflective';
}

function buildRunOneTask(
  conflictHeader: ConflictHeader | null,
  toneState: SparkSmithToneState
): string {
  const toneLabel = toneState === 'hot' ? 'Hot State' : 'Reflective State';
  const prefix = conflictHeader
    ? `Run 1 task (${conflictHeader} • ${toneLabel}):`
    : `Run 1 task (${toneLabel}):`;

  if (toneState === 'hot') {
    return `${prefix}\n1) Plant feet. Relax jaw.\n2) Exhale six counts slowly.\n3) Type next grounded action.`;
  }

  return `${prefix} write one sentence with the exact productive action you will execute for the next 5 minutes.`;
}

function buildRunOneAcknowledgement(
  toneState: SparkSmithToneState,
  conflictHeader: ConflictHeader | null
): string {
  if (toneState === 'hot') {
    return 'Grounding logged. Move steady.';
  }

  return conflictHeader
    ? `Run 1 accepted. Reflective intent verified against "${conflictHeader}".`
    : 'Run 1 accepted. Reflective intent verified.';
}

function buildHotStateReply(): string {
  return ['Plant feet. Relax jaw.', 'Exhale six counts slowly.', 'Start next grounded action.'].join(
    '\n'
  );
}

function buildReflectiveReply(
  topic: string,
  conflictHeader: ConflictHeader | null
): string {
  const safeTopic = cleanTopic(topic);
  const conflictContext = conflictHeader ? `Conflict Header: ${conflictHeader}. ` : '';
  return `${conflictContext}Wisdom Mode: In "${safeTopic}", what outcome matters most in the next 5 minutes, and which belief is stealing your first move? Choose one behavior that proves your intent, then execute it now.\n\n${SPARKSMITH_BASELINE_IDENTITY}`;
}

function buildSparkSmithReply(
  topic: string,
  toneState: SparkSmithToneState,
  conflictHeader: ConflictHeader | null
): string {
  if (toneState === 'hot') return buildHotStateReply();
  return buildReflectiveReply(topic, conflictHeader);
}

export function UtilityPassModal({
  isOpen,
  onClose,
  onComplete,
  onResisted: _onResisted,
  progress: _progress,
  className,
}: UtilityPassModalProps) {
  const navigate = useNavigate();
  const prefersReducedMotion = shouldReduceMotion();
  const transitionDurationClass = prefersReducedMotion ? 'duration-0' : 'duration-300';
  const gateLevel = getUtilityPassGateLevel();
  const [remainingSeconds, setRemainingSeconds] = useState(RUN_ONE_START_SECONDS);
  const [draft, setDraft] = useState('');
  const [inputMode, setInputMode] = useState<ChatInputMode>(DEFAULT_INPUT_MODE);
  const [runOneToneState, setRunOneToneState] = useState<SparkSmithToneState>(DEFAULT_TONE_STATE);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isChatActive, setIsChatActive] = useState(false);
  const [isAiPending, setIsAiPending] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [hasRunOneSubmission, setHasRunOneSubmission] = useState(false);
  const [hasInputInteraction, setHasInputInteraction] = useState(false);
  const [conflictHeader, setConflictHeader] = useState<ConflictHeader | null>(null);
  const [isClarityMenuOpen, setIsClarityMenuOpen] = useState(false);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hasCompletedRef = useRef(false);
  const messageIdRef = useRef(0);
  const draftStartedAtRef = useRef<number | null>(null);

  const nextMessageId = useCallback((): string => {
    messageIdRef.current += 1;
    return `sparksmith-msg-${Date.now()}-${messageIdRef.current}`;
  }, []);

  const buildInitialMessages = useCallback(
    (): ChatMessage[] => [
      {
        id: nextMessageId(),
        role: 'assistant',
        content: `${SPARKSMITH_NAME} online. ${SPARKSMITH_ROLE} mode active. ${SPARKSMITH_SPECIALIZATION}.`,
      },
      {
        id: nextMessageId(),
        role: 'assistant',
        content: SPARKSMITH_GREETING,
      },
      {
        id: nextMessageId(),
        role: 'assistant',
        content: buildRunOneTask(null, DEFAULT_TONE_STATE),
      },
    ],
    [nextMessageId]
  );

  const resetState = useCallback(() => {
    hasCompletedRef.current = false;
    setRemainingSeconds(RUN_ONE_START_SECONDS);
    setDraft('');
    setInputMode(DEFAULT_INPUT_MODE);
    setRunOneToneState(DEFAULT_TONE_STATE);
    setMessages(buildInitialMessages());
    setIsChatActive(false);
    setIsAiPending(false);
    setHasRunOneSubmission(false);
    setHasInputInteraction(false);
    setConflictHeader(null);
    setIsClarityMenuOpen(false);
    setKeyboardInset(0);
    draftStartedAtRef.current = null;
  }, [buildInitialMessages]);

  const appendMessage = useCallback(
    (role: ChatRole, content: string) => {
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(),
          role,
          content,
        },
      ]);
    },
    [nextMessageId]
  );

  const completePass = useCallback(() => {
    if (hasCompletedRef.current) return;
    hasCompletedRef.current = true;
    onComplete(DEFAULT_REASON, DEFAULT_DURATION, gateLevel);
  }, [gateLevel, onComplete]);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [onClose, resetState]);

  const handleSend = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (isAiPending) return;

      const userText = draft.trim();
      if (!isValidRunOneInput(userText)) return;

      const typingCharsPerSecond = estimateTypingCharsPerSecond(userText, draftStartedAtRef.current);
      const detectedToneState = analyzeSparkSmithTone(userText, typingCharsPerSecond);
      const nextMessages: ChatMessage[] = [
        ...messages,
        { id: nextMessageId(), role: 'user', content: userText },
      ];

      if (!hasRunOneSubmission) {
        if (detectedToneState !== runOneToneState) {
          nextMessages.push({
            id: nextMessageId(),
            role: 'assistant',
            content: buildRunOneTask(conflictHeader, detectedToneState),
          });
        }

        nextMessages.push({
          id: nextMessageId(),
          role: 'assistant',
          content: buildRunOneAcknowledgement(detectedToneState, conflictHeader),
        });
        setHasRunOneSubmission(true);
      }

      setHasInputInteraction(true);
      setRunOneToneState(detectedToneState);
      setInputMode('type');
      setIsClarityMenuOpen(false);
      setMessages(nextMessages);
      setDraft('');
      draftStartedAtRef.current = null;

      if (!hasRunOneSubmission && remainingSeconds <= RUN_ONE_STAGNATION_SECONDS) {
        setRemainingSeconds(0);
      }

      const aiMessages: HfChatMessage[] = nextMessages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const lastPayloadUserMessage = [...aiMessages].reverse().find((message) => message.role === 'user');
      const currentUserTypedControlToken = /^(clarity|type)$/i.test(userText);
      const accidentalUiControlTokenInjected = Boolean(
        lastPayloadUserMessage &&
          /^(clarity|type)$/i.test(lastPayloadUserMessage.content.trim()) &&
          lastPayloadUserMessage.content.trim() !== userText
      );

      console.info('[DIAG][WAITING_ROOM][PAYLOAD_GUARD]', {
        mode: inputMode,
        currentUserTypedControlToken,
        accidentalUiControlTokenInjected,
        messageCount: aiMessages.length,
      });

      setIsAiPending(true);
      try {
        const result = await requestHfChatCompletion({
          systemPrompt: SPARKSMITH_SYSTEM_PROMPT,
          messages: aiMessages,
        });
        appendMessage('assistant', result.assistantMessage);
      } catch (error) {
        console.warn('[DIAG][HF_CHAT][ERROR]', {
          reason: error instanceof Error ? error.message : 'unknown_error',
        });
        appendMessage('assistant', buildSparkSmithReply(userText, detectedToneState, conflictHeader));
      } finally {
        setIsAiPending(false);
      }
    },
    [
      appendMessage,
      conflictHeader,
      draft,
      hasRunOneSubmission,
      inputMode,
      isAiPending,
      messages,
      nextMessageId,
      remainingSeconds,
      runOneToneState,
    ]
  );

  const handleClarity = useCallback(() => {
    setInputMode('clarity');
    setIsClarityMenuOpen((prev) => !prev);
  }, []);

  const handleConflictHeaderSelect = useCallback((reason: ConflictHeader) => {
    setInputMode('clarity');
    setConflictHeader(reason);
    setIsClarityMenuOpen(false);
    setDraft((prev) => (prev.trim().length > 0 ? prev : buildClarityDraft(reason)));
    setHasInputInteraction(true);
    console.info('[DIAG][WAITING_ROOM][MODE]', {
      mode: 'clarity',
      quickPickApplied: true,
    });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleToggleType = useCallback(() => {
    setInputMode('type');
    setIsClarityMenuOpen(false);
    console.info('[DIAG][WAITING_ROOM][MODE]', {
      mode: 'type',
      quickPickApplied: false,
    });
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleOpenDefenseRoom = useCallback(() => {
    handleClose();
    navigate('/defense?context=StartPass&tool=reflect');
  }, [handleClose, navigate]);

  const handleReturnToNoise = useCallback(async () => {
    try {
      const request = createPartnerRequest('UNBLUR_HIGH_RISK', {
        expiresInMs: HANDSHAKE_EXPIRY_MS,
        messagePreset: 'Return to Noise',
      });

      await savePartnerRequest(request);

      toast({
        title: 'Accountability handshake sent',
        description: 'Peer notified. Timer bypassed.',
        duration: 2800,
      });
    } catch (error) {
      console.error('Failed accountability handshake:', error);
      toast({
        title: 'Timer bypassed',
        description: 'Peer notification could not be saved locally.',
        duration: 2800,
      });
    }

    setRemainingSeconds(0);
    completePass();
  }, [completePass]);

  // Reset each time modal opens
  useEffect(() => {
    if (!isOpen) return;
    resetState();
  }, [isOpen, resetState]);

  useEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusables = getFocusableElements(dialog);
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
  }, [isOpen, handleClose]);

  // Countdown ticker
  useEffect(() => {
    if (!isOpen || hasCompletedRef.current) return;

    const intervalId = window.setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 0) return 0;
        if (!hasRunOneSubmission && prev <= RUN_ONE_STAGNATION_SECONDS && !hasInputInteraction) {
          return RUN_ONE_STAGNATION_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [hasInputInteraction, hasRunOneSubmission, isOpen]);

  // Auto-complete when timer finishes
  useEffect(() => {
    if (!isOpen || remainingSeconds > 0) return;
    completePass();
  }, [completePass, isOpen, remainingSeconds]);

  // Keep chat pinned to latest bubble
  useEffect(() => {
    if (!isOpen) return;

    const container = chatScrollRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [isOpen, messages, prefersReducedMotion]);

  useEffect(() => {
    if (!isOpen) return;

    const viewport = window.visualViewport;
    if (!viewport) {
      setKeyboardInset(0);
      return;
    }

    const syncKeyboardInset = () => {
      const occludedHeight = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardInset(Math.round(occludedHeight));
    };

    syncKeyboardInset();
    viewport.addEventListener('resize', syncKeyboardInset);
    viewport.addEventListener('scroll', syncKeyboardInset);

    return () => {
      viewport.removeEventListener('resize', syncKeyboardInset);
      viewport.removeEventListener('scroll', syncKeyboardInset);
      setKeyboardInset(0);
    };
  }, [isOpen]);

  if (!isOpen) return null;
  const isRunOneFrozen =
    !hasRunOneSubmission && remainingSeconds <= RUN_ONE_STAGNATION_SECONDS && !hasInputInteraction;

  return (
    <div
      ref={dialogRef}
      className={cn('fixed inset-0 z-50 overflow-hidden', className)}
      style={{ backgroundColor: '#1A1B1E' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="utility-pass-terminal-title"
    >
      <h2 id="utility-pass-terminal-title" className="sr-only">
        Utility Pass Active Task Terminal
      </h2>
      <button
        ref={closeButtonRef}
        onClick={handleClose}
        className="absolute right-4 z-50 rounded-full p-2.5 text-[#E0E0E0] transition hover:text-white"
        style={{
          ...liquidGlassStyle,
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        }}
        aria-label="Close Active Task Terminal"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Chat Backdrop Layer */}
      <div
        className={cn(
          'absolute inset-0 z-10 flex flex-col transition-opacity',
          prefersReducedMotion ? 'duration-0' : 'duration-200',
        )}
        style={{ opacity: isChatActive ? 1 : 0.82 }}
      >
        <div
          className="px-4"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          }}
        >
          <p
            className="text-[11px] uppercase tracking-[0.22em] text-[#E0E0E0]/75"
            aria-label={SPARKSMITH_SYSTEM_PROMPT}
          >
            {SPARKSMITH_NAME} • {SPARKSMITH_ROLE}
          </p>
        </div>

        <div
          ref={chatScrollRef}
          className="flex-1 overflow-y-auto px-4 pt-4"
          style={{
            paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${keyboardInset + 232}px)`,
          }}
        >
          <div className="space-y-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[82%] rounded-[22px] border px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap',
                    isChatActive ? 'backdrop-blur-none' : 'backdrop-blur-xl',
                    message.role === 'user'
                      ? 'border-white/25 text-[#F5FAFF]'
                      : 'border-white/30 text-[#0E1116]'
                  )}
                  style={{
                    backgroundColor:
                      message.role === 'user'
                        ? isChatActive
                          ? 'rgba(10, 132, 255, 0.78)'
                          : 'rgba(10, 132, 255, 0.4)'
                        : isChatActive
                          ? 'rgba(255, 255, 255, 0.9)'
                          : 'rgba(255, 255, 255, 0.4)',
                  }}
                >
                  {message.content}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Timer Overlay Layer */}
      <div
        className="pointer-events-none absolute inset-0 z-20"
        style={{
          backgroundColor: isChatActive ? 'transparent' : 'rgba(26, 27, 30, 0.84)',
          transition: prefersReducedMotion ? 'none' : 'background-color 220ms ease',
        }}
      />

      <div className="pointer-events-none absolute inset-0 z-30">
        <div
          className="absolute rounded-full px-3 py-1.5"
          style={{
            ...liquidGlassStyle,
            ...hudTimerAnchorStyle,
          }}
        >
          <p
            className="font-mono text-[15px] font-semibold leading-none tracking-[0.09em]"
            style={{ color: isRunOneFrozen ? '#EAF3FF' : '#72F5FF' }}
          >
            {formatCountdown(remainingSeconds)}
          </p>
        </div>

        <div
          className={cn(
            'pointer-events-auto absolute left-1/2 w-full max-w-md px-4 transition-[bottom] ease-out',
            transitionDurationClass,
          )}
          style={{
            bottom: `calc(env(safe-area-inset-bottom, 0px) + ${keyboardInset + 128}px)`,
            transform: 'translateX(-50%)',
          }}
        >
          <div className="relative">
            {isClarityMenuOpen && (
              <div className="absolute inset-x-0 -top-2 z-50 -translate-y-full rounded-[20px] p-2" style={liquidGlassStyle}>
                <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-[0.2em] text-[#EAF3FF]/78">
                  Quick Pick
                </p>
                <div className="space-y-1">
                  {CLARITY_QUICK_PICKS.map((reason) => (
                    <button
                      key={reason}
                      onClick={() => handleConflictHeaderSelect(reason)}
                      className="w-full rounded-xl px-3 py-2 text-left text-sm font-medium text-[#EAF3FF] transition hover:bg-white/15"
                      style={{
                        border: '0.5px solid rgba(255, 255, 255, 0.2)',
                      }}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleClarity}
                className={cn(
                  'rounded-2xl px-2 py-3 text-center transition',
                  inputMode === 'clarity' ? 'bg-white/20' : 'hover:bg-white/15'
                )}
                style={liquidGlassStyle}
                aria-label="Open clarity quick pick"
              >
                <span className="block text-sm font-medium text-[#EAF3FF]">Clarity</span>
              </button>

              <button
                onClick={handleToggleType}
                className={cn(
                  'rounded-2xl px-2 py-3 text-center transition',
                  inputMode === 'type' ? 'bg-white/20' : 'hover:bg-white/15'
                )}
                style={liquidGlassStyle}
                aria-label="Switch to typing mode"
              >
                <span className="block text-sm font-medium text-[#EAF3FF]">Type</span>
                <span className="mt-0.5 block text-[11px] uppercase tracking-[0.08em] text-[#EAF3FF]/80">
                  {inputMode === 'type' ? 'Typing' : 'Switch'}
                </span>
              </button>

              <button
                onClick={handleOpenDefenseRoom}
                className="rounded-2xl px-2 py-3 text-center transition hover:bg-white/15"
                style={liquidGlassStyle}
                aria-label="Open defense room"
              >
                <span className="block text-sm font-medium text-[#EAF3FF]">Defense Room</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <form
        onSubmit={handleSend}
        className={cn(
          'absolute inset-x-0 z-40 px-4 transition-[bottom] ease-out',
          transitionDurationClass,
        )}
        style={{
          bottom: `calc(env(safe-area-inset-bottom, 0px) + ${keyboardInset + 52}px)`,
        }}
      >
        <div className="mx-auto w-full max-w-md">
          <p
            className={cn(
              'mb-1.5 px-2 text-left uppercase tracking-[0.3em] text-[#EAF3FF]/90 transition-all',
              transitionDurationClass,
              isChatActive ? 'text-[11px] opacity-100' : 'text-[10px] opacity-95'
            )}
          >
            {RUN_ONE_LABEL}
          </p>
          <div
            className={cn(
              'flex items-center gap-2 rounded-[26px] px-3 py-2 transition-all',
              prefersReducedMotion ? 'duration-0' : 'duration-200',
            )}
            style={liquidGlassStyle}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => {
                const nextValue = event.target.value;
                const hasContent = nextValue.trim().length > 0;

                if (hasContent && draftStartedAtRef.current === null) {
                  draftStartedAtRef.current = Date.now();
                } else if (!hasContent) {
                  draftStartedAtRef.current = null;
                }

                setDraft(nextValue);
                setHasInputInteraction(true);
              }}
              onFocus={() => {
                setIsChatActive(true);
                setIsClarityMenuOpen(false);
                setHasInputInteraction(true);
              }}
              onBlur={() => {
                setIsChatActive(false);
              }}
              placeholder={
                hasRunOneSubmission
                  ? inputMode === 'clarity'
                    ? 'Use a clarity signal or write your next step...'
                    : 'Continue the task thread...'
                  : 'Answer Run 1 to release the countdown...'
              }
              className="h-9 flex-1 bg-transparent px-2 text-sm text-[#EAF3FF] placeholder:text-[#EAF3FF]/65 outline-none"
              aria-label="Message SparkSmith"
            />
            <button
              type="submit"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#F5FAFF] transition hover:bg-[#0A84FF]/24 disabled:opacity-40"
              style={{
                ...liquidGlassStyle,
                backgroundColor: 'rgba(10, 132, 255, 0.2)',
              }}
              disabled={!draft.trim() || isAiPending}
              aria-label="Send message"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </form>

      <button
        onClick={handleReturnToNoise}
        className="absolute left-1/2 z-40 -translate-x-1/2 bg-transparent px-1 py-0.5 text-[10px] tracking-[0.18em] text-[#E0E0E0]"
        style={{ bottom: `calc(env(safe-area-inset-bottom, 0px) + ${keyboardInset + 18}px)` }}
      >
        Return to Noise
      </button>
    </div>
  );
}
