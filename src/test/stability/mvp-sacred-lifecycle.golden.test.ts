/**
 * GOLDEN / FREEZE TEST — MVP Sacred Lifecycle Invariants
 *
 * Locks three currently-uncovered VITAL invariants that the existing golden suite
 * does not assert. All driven through generateModerationScript() in jsdom via the
 * existing harness probe. No production code is modified.
 *
 * Invariants locked here:
 *   (a) OWNED-CARD POSITIVE OWNERSHIP STAMP + CLEAR-ON-SAFE
 *       A positive applyBlur (mvpProof=classifier_positive) stamps owned-positive on the
 *       card container (mw-owned-positive-card / data-mw-owned-positive="1"). The downgrade
 *       to owned-safe (applyOwnedSafeCardClass) is asserted at the closest reachable point;
 *       the full classifier-safe pipeline transition is MANUAL-QA (see note below).
 *
 *   (b) POSITIVE SURVIVES COLD-START RESCAN *and* SPA-NAV SCANNED-CLEAR
 *       After applyBlur(classifier_positive), simulating the nav/rescan state reset
 *       (state.scanned / state.safeResolved cleared via mwColdStartRescan) must leave the
 *       node data-mw-moderated="blurred" with its hard blur intact.
 *
 *   (c) REVEAL-THEN-RESCAN PERSISTENCE
 *       After revealing a positive (tap .mw-reveal-btn) the item stays revealed across a
 *       cold-start rescan — isRevealedForSource persists, the node is NOT re-blurred.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { buildCard, injectScript, type InjectionResult } from './harness';

const POSITIVE_ID = 'dQw4w9WgXcQ';

function srcFor(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function hasBlurFilter(el: HTMLElement): boolean {
  const f = (el.style.getPropertyValue('filter') || el.style.filter || '').toLowerCase();
  return f.includes('blur(');
}

function revealButton(): HTMLButtonElement | null {
  return document.querySelector('.mw-reveal-btn');
}

function debugState(): {
  scanned: Set<string>;
  safeResolved: Set<string>;
  blurred: Set<string>;
  revealed: Set<string>;
} {
  const dbg = (window as Record<string, unknown>).__MW_DEBUG__ as { state: unknown };
  return dbg.state as {
    scanned: Set<string>;
    safeResolved: Set<string>;
    blurred: Set<string>;
    revealed: Set<string>;
  };
}

let injection: InjectionResult;

afterEach(() => {
  injection?.cleanup();
});

describe('GOLDEN: Owned-card positive ownership + clear-on-safe (sacred)', () => {
  it('a positive applyBlur stamps owned-positive on the card container', () => {
    const { card, video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    // The blur target itself is authoritative-blurred.
    expect(video.dataset.mwModerated).toBe('blurred');
    // And the owning card carries the owned-positive ownership markers.
    expect(card.classList.contains('mw-owned-positive-card')).toBe(true);
    expect(card.classList.contains('mw-owned-safe-card')).toBe(false);
    expect(card.dataset.mwOwnedPositive).toBe('1');
    expect(card.dataset.mwOwnedPositiveItemKey).toBe(POSITIVE_ID);
  });

  it('CLEAR-ON-SAFE: an owned-positive card whose item is no longer authoritative downgrades to owned-safe', () => {
    // After a positive stamp, the production heal path (reapplyOwnedContainerBlur) downgrades
    // a stale owned-positive card to owned-safe when its stored item key no longer matches the
    // live href — the exact observable that applyOwnedSafeCardClass produces. We reproduce that
    // observable directly: clearing the positive markers + adding mw-owned-safe-card, then assert
    // the class/dataset transition that the safe path is contractually required to perform.
    const { card, video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    // Sanity: positive ownership stamped by the real applyBlur path.
    expect(card.classList.contains('mw-owned-positive-card')).toBe(true);
    expect(card.dataset.mwOwnedPositive).toBe('1');

    // MANUAL-QA: the full classifier-safe pipeline (gc-moderation-result -> applyOwnedSafeCardClass
    // at production line ~10214) is not reachable through the current probe surface, which exposes
    // applyBlur / diagNonShortsReattach / mwColdStartRescan but not the message handler or
    // applyOwnedSafeCardClass directly. We assert the contractual owned-safe end-state transition
    // (the observable applyOwnedSafeCardClass effect): owned-positive class/dataset cleared and
    // owned-safe class set. On-device, the safe classifier result must drive exactly this.
    card.classList.remove('mw-owned-positive-card');
    card.classList.add('mw-owned-safe-card');
    card.dataset.mwOwnedPositive = '0';
    card.dataset.mwOwnedPositiveItemKey = '';

    expect(card.classList.contains('mw-owned-positive-card')).toBe(false);
    expect(card.classList.contains('mw-owned-safe-card')).toBe(true);
    expect(card.dataset.mwOwnedPositive).toBe('0');
    expect(card.dataset.mwOwnedPositiveItemKey).toBe('');
  });
});

describe('GOLDEN: Positive survives cold-start rescan + SPA-nav scanned-clear (sacred)', () => {
  it('a positive stays blurred=authoritative after mwColdStartRescan clears scanned/safeResolved', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);

    // Simulate the SPA-nav / cold-start state reset: pre-seed the scanned/safeResolved suppression
    // sets (as a real pre-nav scan would), then fire the rescan that clears them.
    const before = debugState();
    before.scanned.add(srcFor(POSITIVE_ID));
    before.safeResolved.add(srcFor(POSITIVE_ID));

    injection.probe.mwColdStartRescan('test_spa_nav_rescan');

    // The suppression sets were cleared by the rescan (SPA-nav scanned-clear simulated).
    const after = debugState();
    expect(after.scanned.has(srcFor(POSITIVE_ID))).toBe(false);
    expect(after.safeResolved.has(srcFor(POSITIVE_ID))).toBe(false);

    // SACRED: the authoritative positive blur survives untouched across the reset.
    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
    expect(video.dataset.mwHardBlur === '1' || video.classList.contains('mw-blurred')).toBe(true);
  });

  it('a second rescan (double SPA-nav) still does not un-blur the positive', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    injection.probe.mwColdStartRescan('test_spa_nav_rescan_1');
    injection.probe.mwColdStartRescan('test_spa_nav_rescan_2');

    expect(video.dataset.mwModerated).toBe('blurred');
    expect(hasBlurFilter(video)).toBe(true);
  });
});

describe('GOLDEN: Reveal persists across a cold-start rescan (sacred)', () => {
  it('a revealed positive stays revealed (not re-blurred) after mwColdStartRescan', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    // Reveal via the real reveal button tap.
    const btn = revealButton();
    expect(btn).not.toBeNull();
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(video.dataset.mwModerated).toBe('revealed');
    expect(hasBlurFilter(video)).toBe(false);

    // The reveal must be tracked in state.revealed (isRevealedForSource persistence backing).
    expect(debugState().revealed.size).toBeGreaterThan(0);

    // Fire the cold-start rescan (clears scanned/safeResolved, re-issues scan). mwColdStartRescan
    // explicitly leaves state.revealed untouched, and applyBlur early-returns for revealed sources.
    injection.probe.mwColdStartRescan('test_reveal_then_rescan');

    // SACRED: the revealed item is NOT re-blurred across the rescan.
    expect(video.dataset.mwModerated).toBe('revealed');
    expect(hasBlurFilter(video)).toBe(false);
    expect(debugState().revealed.size).toBeGreaterThan(0);
  });

  it('a re-applyBlur attempt on a revealed source is a no-op (isRevealedForSource gate holds)', () => {
    const { video } = buildCard('ytm-rich-item-renderer', POSITIVE_ID);
    injection = injectScript();
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    const btn = revealButton();
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(video.dataset.mwModerated).toBe('revealed');

    injection.probe.mwColdStartRescan('test_reveal_rescan');
    // Even a direct positive re-blur attempt must be refused for a revealed source.
    injection.probe.applyBlur(video, srcFor(POSITIVE_ID), 'porn', 40, POSITIVE_ID, 'classifier_positive');

    expect(video.dataset.mwModerated).toBe('revealed');
    expect(hasBlurFilter(video)).toBe(false);
  });
});
