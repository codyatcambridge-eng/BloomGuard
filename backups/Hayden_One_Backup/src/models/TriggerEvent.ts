/**
 * Trigger Event Model
 * Privacy-safe logging of resistance/unlock events
 * NO URLs or explicit content stored
 */

export type GateLevel = 1 | 2 | 3 | 4;

export type TriggerOutcome = 
  | 'RESISTED'           // User closed/resisted without unlocking
  | 'UNLOCKED'           // User completed friction gate and unlocked
  | 'PARTNER_OVERRIDE';  // Partner approved override request

export type EmotionTag = 
  | 'BORED'
  | 'LONELY'
  | 'STRESSED'
  | 'ANGRY'
  | 'TEMPTED'
  | null;

export interface TriggerEvent {
  id: string;
  ts: number; // Unix timestamp (ms)
  
  // What gate level was triggered (1=low risk, 4=high risk)
  gateLevel: GateLevel;
  
  // How did it resolve?
  outcome: TriggerOutcome;
  
  // Optional emotion tagging (user-selected)
  emotion: EmotionTag;
  
  // Did user complete recovery flow?
  recoveryCompleted: boolean;
  
  // Platform identifier only (no URLs)
  platform: string | null; // e.g. "browser", "social", "video"
  
  // User-entered notes only (optional)
  notes: string | null;
}

/**
 * Create a new trigger event
 */
export function createTriggerEvent(
  gateLevel: GateLevel,
  outcome: TriggerOutcome,
  options?: {
    emotion?: EmotionTag;
    recoveryCompleted?: boolean;
    platform?: string;
    notes?: string;
  }
): TriggerEvent {
  return {
    id: 'trigger_' + crypto.randomUUID(),
    ts: Date.now(),
    gateLevel,
    outcome,
    emotion: options?.emotion ?? null,
    recoveryCompleted: options?.recoveryCompleted ?? false,
    platform: options?.platform ?? null,
    notes: options?.notes ?? null,
  };
}

/**
 * Check if event is a resistance (positive outcome)
 */
export function isResistance(event: TriggerEvent): boolean {
  return event.outcome === 'RESISTED';
}

/**
 * Check if event is high-risk (gate level 3 or 4)
 */
export function isHighRisk(event: TriggerEvent): boolean {
  return event.gateLevel >= 3;
}
