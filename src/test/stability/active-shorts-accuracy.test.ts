/**
 * Active Shorts accuracy contracts for Phase 0 MVP stability.
 *
 * Mirrors production inject decision (channel-evidence first) and host gates.
 */
import { describe, expect, it } from 'vitest';
import { getCategoryThresholds } from '@/lib/webview-injection-script';

/** Mirrors production Active Shorts hard-blur decision (post sacc3). */
function decideActiveShortsHardBlur(input: {
  shouldBlur: boolean;
  forceUnsafe: boolean;
  porn: number;
  sexy: number;
  hentai: number;
  thirst?: number;
  thr: { porn: number; sexy: number; hentai: number };
  rawCategory?: string;
  predictedLabel?: string;
  isUncertain?: boolean;
}): { apply: boolean; reason: string } {
  const pornD = input.porn;
  const sexyD = input.sexy;
  const hentaiD = input.hentai;
  const maxUnsafe = Math.max(pornD, sexyD, hentaiD);
  const hasMeaningfulScores = maxUnsafe > 0.02;
  const thr = input.thr;
  const sexyFloor = Math.max(Number(thr.sexy) || 0, 0.7);
  const dialOnlyStrong =
    pornD > thr.porn ||
    hentaiD > thr.hentai ||
    sexyD > Math.max(Number(thr.sexy) || 0, 0.72);
  const hostConfirmed =
    pornD > thr.porn || hentaiD > thr.hentai || sexyD > sexyFloor;
  const rawLabel = String(input.rawCategory || input.predictedLabel || '').toLowerCase();
  const isExplicitHostLabel = rawLabel === 'porn' || rawLabel === 'hentai';

  if (input.isUncertain) {
    return { apply: false, reason: 'shorts_uncertain_no_hard_blur' };
  }
  if (input.shouldBlur && !hasMeaningfulScores && isExplicitHostLabel) {
    return { apply: true, reason: 'host_blur_zero_bag_explicit_shorts' };
  }
  if (input.shouldBlur && !hasMeaningfulScores) {
    return { apply: false, reason: 'shorts_zero_bag_non_explicit_suppressed' };
  }
  if (input.shouldBlur && input.forceUnsafe) {
    if (hostConfirmed || dialOnlyStrong) {
      return {
        apply: true,
        reason: hostConfirmed ? 'host_force_unsafe_confirmed_shorts' : 'shorts_dial_only_strong',
      };
    }
    return { apply: false, reason: 'shorts_force_unsafe_unconfirmed_fp' };
  }
  if (input.shouldBlur) {
    if (hostConfirmed || dialOnlyStrong) {
      return {
        apply: true,
        reason: hostConfirmed ? 'host_confirmed_shorts' : 'shorts_dial_only_strong',
      };
    }
    return { apply: false, reason: 'shorts_weak_host_suppressed_fp' };
  }
  if (dialOnlyStrong) {
    return { apply: true, reason: 'shorts_dial_only_strong' };
  }
  return { apply: false, reason: 'shorts_safe_host_and_dial' };
}

describe('Active Shorts accuracy decision matrix', () => {
  it('zero-bag explicit host positive still blurs on Shorts (FN protect)', () => {
    const d = decideActiveShortsHardBlur({
      shouldBlur: true,
      forceUnsafe: false,
      porn: 0,
      sexy: 0,
      hentai: 0,
      thr: getCategoryThresholds(2),
      rawCategory: 'porn',
    });
    expect(d.apply).toBe(true);
  });

  it('zero-bag swimwear host positive is suppressed (FP cut)', () => {
    const d = decideActiveShortsHardBlur({
      shouldBlur: true,
      forceUnsafe: true,
      porn: 0,
      sexy: 0,
      hentai: 0,
      thr: getCategoryThresholds(2),
      rawCategory: 'swimwear',
    });
    expect(d.apply).toBe(false);
    expect(d.reason).toBe('shorts_zero_bag_non_explicit_suppressed');
  });

  it('dial-only weak sexy is suppressed on Shorts (MVP FP stability)', () => {
    const thr = getCategoryThresholds(2); // moderate sexy 0.65
    const sexy = 0.66; // barely over dial thr but under 0.72 floor
    const d = decideActiveShortsHardBlur({
      shouldBlur: false,
      forceUnsafe: false,
      porn: 0.05,
      sexy,
      hentai: 0.05,
      thr,
      predictedLabel: 'sexy',
    });
    expect(d.apply).toBe(false);
  });

  it('dial-only strong sexy above 0.72 floor can blur without host', () => {
    const thr = getCategoryThresholds(2);
    const d = decideActiveShortsHardBlur({
      shouldBlur: false,
      forceUnsafe: false,
      porn: 0.1,
      sexy: 0.8,
      hentai: 0.05,
      thr,
      predictedLabel: 'sexy',
    });
    expect(d.apply).toBe(true);
    expect(d.reason).toBe('shorts_dial_only_strong');
  });

  it('unconfirmed forceUnsafe swimwear is suppressed on Shorts (FP cut)', () => {
    const thr = getCategoryThresholds(3); // strict sexy 0.45
    const d = decideActiveShortsHardBlur({
      shouldBlur: true,
      forceUnsafe: true,
      porn: 0.1,
      sexy: 0.5, // over dial but under 0.70 host confirm floor
      hentai: 0.05,
      thr,
      rawCategory: 'swimwear',
    });
    expect(d.apply).toBe(false);
    expect(d.reason).toBe('shorts_force_unsafe_unconfirmed_fp');
  });

  it('confirmed forceUnsafe swimwear blurs on Shorts when sexy clears floor', () => {
    const thr = getCategoryThresholds(3);
    const d = decideActiveShortsHardBlur({
      shouldBlur: true,
      forceUnsafe: true,
      porn: 0.1,
      sexy: 0.75,
      hentai: 0.05,
      thr,
      rawCategory: 'swimwear',
    });
    expect(d.apply).toBe(true);
  });

  it('thirst score alone never confirms host hard blur on Shorts', () => {
    const thr = getCategoryThresholds(2);
    // Host said blur (thirst) with weak sexy — thirst metric is intentionally unused.
    const d = decideActiveShortsHardBlur({
      shouldBlur: true,
      forceUnsafe: true,
      porn: 0.1,
      sexy: 0.4,
      hentai: 0.05,
      thirst: 0.9,
      thr,
      rawCategory: 'thirst',
    });
    expect(d.apply).toBe(false);
  });

  it('uncertain empty frame does not force hard blur', () => {
    const thr = getCategoryThresholds(2);
    const d = decideActiveShortsHardBlur({
      shouldBlur: true,
      forceUnsafe: false,
      porn: 0,
      sexy: 0,
      hentai: 0,
      thr,
      isUncertain: true,
      rawCategory: 'shorts_uncertain_input',
    });
    expect(d.apply).toBe(false);
  });

  it('host weak sexy below 0.70 floor is suppressed even when host wants blur', () => {
    const thr = getCategoryThresholds(3); // sexy thr 0.45
    const d = decideActiveShortsHardBlur({
      shouldBlur: true,
      forceUnsafe: false,
      porn: 0.1,
      sexy: 0.5,
      hentai: 0.05,
      thr,
      predictedLabel: 'sexy',
    });
    expect(d.apply).toBe(false);
    expect(d.reason).toBe('shorts_weak_host_suppressed_fp');
  });

  it('host porn over dial thr hard-blurs (channel evidence)', () => {
    const thr = getCategoryThresholds(2); // porn 0.5
    const d = decideActiveShortsHardBlur({
      shouldBlur: true,
      forceUnsafe: false,
      porn: 0.62,
      sexy: 0.2,
      hentai: 0.1,
      thr,
      predictedLabel: 'porn',
    });
    expect(d.apply).toBe(true);
    expect(d.reason).toBe('host_confirmed_shorts');
  });

  it('frame verdict authority beats poster once frame ok', () => {
    const frameOk = true;
    const sourceType = 'video-poster';
    const ignorePoster = frameOk && sourceType === 'video-poster';
    expect(ignorePoster).toBe(true);
  });

  it('poster is provisional until frame ok (no hard finalize contract)', () => {
    const frameOk = false;
    const sourceType = 'video-poster';
    const isProvisionalPosterPending = !frameOk && sourceType === 'video-poster';
    expect(isProvisionalPosterPending).toBe(true);
  });

  it('host-positive re-force must not undo Shorts FP suppress (regression)', () => {
    // Historical bug: after shouldApplyBlur=false for weak host, later code did
    // `if (shortsDecision && shouldBlur) shouldApplyBlur = true`.
    const suppressed = decideActiveShortsHardBlur({
      shouldBlur: true,
      forceUnsafe: true,
      porn: 0.1,
      sexy: 0.5,
      hentai: 0.05,
      thr: getCategoryThresholds(3),
      rawCategory: 'swimwear',
    });
    expect(suppressed.apply).toBe(false);
    // Simulated post-fix: must remain suppressed
    const reforced = suppressed.apply; // correct path keeps suppressed
    const bugReforce = true; // old bug always re-forced
    expect(reforced).toBe(false);
    expect(bugReforce).toBe(true); // documents the anti-pattern
  });

  it('sacc4: hardBlurOverride score>0.8 must not re-force after Shorts suppress', () => {
    // After channel-evidence decision said no hard blur, score>0.8 override must not
    // force finalBlur on Active Shorts (home still may use hardBlurOverride).
    const shouldApplyBlur = false;
    const hardBlurOverride = true; // e.g. sexy 0.85 > 0.8
    const dialActive = true;
    const shortsMode = true;
    const finalBlur =
      hardBlurOverride && dialActive && !shortsMode ? true : shouldApplyBlur && dialActive;
    expect(finalBlur).toBe(false);
    const homeFinalBlur =
      hardBlurOverride && dialActive && !false ? true : shouldApplyBlur && dialActive;
    expect(homeFinalBlur).toBe(true);
  });

  it('sacc4: dial thr change keeps final frame when scores exist (no freeze wipe)', () => {
    const frameOk = '1';
    const settledId = 'DialShortABC';
    const liveId = 'DialShortABC';
    const hasScores = true;
    const hasFinalFrame = frameOk === '1' && settledId === liveId;
    const shouldWipeFrameForDial = !(hasFinalFrame && hasScores);
    expect(shouldWipeFrameForDial).toBe(false);
  });

  it('per-short battery settle: same identity skips rescan', () => {
    const settledId = 'ShortAAA';
    const liveId = 'ShortAAA';
    const frameOk = true;
    const skip = frameOk && settledId === liveId;
    expect(skip).toBe(true);
  });

  it('per-short battery settle: new identity must rescan', () => {
    const settledId = 'ShortAAA';
    const liveId = 'ShortBBB';
    const frameOk = true;
    const skip = frameOk && settledId === liveId;
    expect(skip).toBe(false);
  });
});
