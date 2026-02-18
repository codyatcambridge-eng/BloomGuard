import { getTargetBucket, resolveProtectedTarget, type ProtectedTargetBucket } from '@/lib/protected-targets';
import {
  SHIELD_STRICTNESS_PRECEDENCE,
  isShieldActiveNow,
  type ShieldId,
} from '@/logic/shields';
import { loadShieldsState } from '@/storage/shieldsLocal';
import {
  beginCooldownSessionLocal,
  getCooldownRemainingLocal,
  type BeginCooldownSessionInput,
  type CooldownQuery,
  type CooldownStatus,
} from '@/storage/cooldownLocal';

export interface ProtectionInput {
  targetId: string;
  now: Date;
}

export interface ProtectionResult {
  isProtected: boolean;
  activeShields: ShieldId[];
  strictestShield?: ShieldId;
  bucket?: ProtectedTargetBucket;
  reason: string;
}

export interface FrictionPolicy {
  breakDurationSeconds: number;
  shieldBreakDurationSeconds?: number;
  requiresIntentionStep: boolean;
}

const PERMISSIVE_FRICTION_POLICY: FrictionPolicy = {
  breakDurationSeconds: 30,
  requiresIntentionStep: false,
};

const FRICTION_POLICY_MAP: Record<ShieldId, Record<ProtectedTargetBucket, FrictionPolicy>> = {
  sleep: {
    hard: { breakDurationSeconds: 300, shieldBreakDurationSeconds: 1800, requiresIntentionStep: true },
    soft: { breakDurationSeconds: 180, shieldBreakDurationSeconds: 1200, requiresIntentionStep: true },
  },
  work: {
    hard: { breakDurationSeconds: 240, shieldBreakDurationSeconds: 1200, requiresIntentionStep: true },
    soft: { breakDurationSeconds: 120, shieldBreakDurationSeconds: 900, requiresIntentionStep: true },
  },
  focus: {
    hard: { breakDurationSeconds: 120, shieldBreakDurationSeconds: 900, requiresIntentionStep: true },
    soft: { breakDurationSeconds: 90, shieldBreakDurationSeconds: 600, requiresIntentionStep: false },
  },
  ascent: {
    hard: { breakDurationSeconds: 90, shieldBreakDurationSeconds: 600, requiresIntentionStep: true },
    soft: { breakDurationSeconds: 60, shieldBreakDurationSeconds: 300, requiresIntentionStep: false },
  },
};

function getActiveShieldsForState(now: Date, state = loadShieldsState().state): ShieldId[] {
  return SHIELD_STRICTNESS_PRECEDENCE.filter((shieldId) => {
    const shield = state.shields[shieldId];
    return isShieldActiveNow(shield, now);
  });
}

export function getActiveShields(now: Date): ShieldId[] {
  return getActiveShieldsForState(now);
}

export function evaluateProtection(input: ProtectionInput): ProtectionResult {
  const target = resolveProtectedTarget(input.targetId);
  if (!target) {
    return {
      isProtected: false,
      activeShields: [],
      reason: 'unknown_target',
    };
  }

  const { state } = loadShieldsState();
  const activeNow = getActiveShieldsForState(input.now, state);

  const activeShields = activeNow.filter((shieldId) => {
    const protectedTargets = state.shields[shieldId]?.protectedAppIds || [];
    return protectedTargets.includes(target.id);
  });

  const strictestShield = activeShields[0];
  if (!strictestShield) {
    return {
      isProtected: false,
      activeShields,
      bucket: getTargetBucket(target.id),
      reason: 'no_active_matching_shields',
    };
  }

  return {
    isProtected: true,
    activeShields,
    strictestShield,
    bucket: getTargetBucket(target.id),
    reason: 'protected_by_active_shield',
  };
}

export function getFrictionPolicy(
  strictestShield?: ShieldId,
  bucket?: ProtectedTargetBucket,
): FrictionPolicy {
  if (!strictestShield || !bucket) {
    return { ...PERMISSIVE_FRICTION_POLICY };
  }

  const policy = FRICTION_POLICY_MAP[strictestShield]?.[bucket];
  if (!policy) {
    return { ...PERMISSIVE_FRICTION_POLICY };
  }

  return { ...policy };
}

export function beginCooldownSession(input: BeginCooldownSessionInput): CooldownStatus {
  return beginCooldownSessionLocal(input);
}

export function getCooldownRemaining(query: CooldownQuery = {}): CooldownStatus {
  return getCooldownRemainingLocal(query);
}
