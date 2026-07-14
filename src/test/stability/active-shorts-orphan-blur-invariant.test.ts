/**
 * Active Shorts orphan-blur regression net (Step 0 — tests only).
 *
 * Two kinds of tests live here, deliberately separated:
 *
 * 1. INVARIANTS (must stay green forever): the paths where "blur implies a
 *    reachable reveal" already holds at HEAD. These are the tripwires that
 *    protect AGENTS.md §2 while the C-phase patches land.
 *
 * 2. FIXED redirect dead-end (was KNOWN DEFECT): createRevealOverlay now
 *    migrates blur onto the stable reel frame before redirecting when residue
 *    sits on the <video> and the frame is unstamped — so a direct
 *    createRevealOverlay(video, ...) call attaches reveal without waiting for
 *    health heal. Heal path remains an independent invariant below.
 *
 *   C2c also fixed same-src residue stamps on reveal; C2b fail-closed owner
 *   mismatch. Those are inverted to assert correct behavior below.
 *
 * Harness gotchas honored here (from prior guardian work):
 *  - stamp blur AFTER injectScript() — the bootstrap sweep clears residue.
 *  - navigate to /shorts/<id> BEFORE injectScript() so shorts mode is active
 *    during bootstrap.
 *  - on active Shorts, applyBlur may land blur on the reel frame, not the
 *    <video> — assert on "the node holding residue", not a fixed node.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  buildActiveShortsPlayer,
  injectScript,
  pushShortsUrl,
  restoreMainFeedUrl,
  stampShortsBlurResidue,
  type InjectionResult,
} from './harness';

// The injection script persists reveal/heuristic state in localStorage
// (mw_reveal_store, 24h TTL), which SURVIVES across injectScript() instances
// within one jsdom file. Use a unique Shorts id per test and clear storage,
// or a reveal tapped in one test silently disables heals in the next.
let shortsIdCounter = 0;
function nextShortsId(): string {
  shortsIdCounter += 1;
  return `TestShort${String(shortsIdCounter).padStart(3, '0')}`;
}

let injection: InjectionResult | undefined;

afterEach(() => {
  injection?.cleanup();
  injection = undefined;
  try {
    window.localStorage.clear();
  } catch {
    /* jsdom storage always available; defensive */
  }
  restoreMainFeedUrl();
});

function anyRevealOverlay(): Element | null {
  return document.querySelector('.mw-reveal-overlay');
}

describe('Active Shorts blur/reveal pairing — INVARIANTS (must stay green)', () => {
  it('shorts mode + active player container resolve on a /shorts/ URL', () => {
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    expect(injection.probe.isShortsModeActive()).toBe(true);
    expect(injection.probe.getActiveShortsPlayerContainer()).toBe(frame);
  });

  it('resolveShortsStableBlurTarget resolves the reel frame for the video src', () => {
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame, video, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    const resolution = injection.probe.resolveShortsStableBlurTarget(video, src);
    expect(resolution?.target).toBe(frame);
  });

  it('applyBlur on the active Shorts video produces blur WITH a reveal overlay', () => {
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame, video, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    injection.probe.applyBlur(video, src, 'porn', 40, SHORTS_ID);

    // Blur must exist somewhere in the player (frame or video — applyBlur may
    // redirect to the stable container), and it must be paired with a reveal.
    const blurredNode = [frame, video].find(
      n => (n as HTMLElement).dataset.mwModerated === 'blurred',
    );
    expect(blurredNode).toBeDefined();
    expect(anyRevealOverlay()).not.toBeNull();
  });

  it('createRevealOverlay on an already-stamped reel frame attaches a reveal', () => {
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    stampShortsBlurResidue(frame, src, SHORTS_ID);
    injection.probe.createRevealOverlay(frame, src, 'porn', SHORTS_ID);

    expect(anyRevealOverlay()).not.toBeNull();
  });

  it('heal recreates a missing reveal for a stamped reel frame (heal success path)', () => {
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    stampShortsBlurResidue(frame, src, SHORTS_ID);
    injection.probe.createRevealOverlay(frame, src, 'porn', SHORTS_ID);
    // Simulate YouTube churn eating the overlay.
    anyRevealOverlay()?.remove();
    expect(anyRevealOverlay()).toBeNull();

    const healed = injection.probe.healActiveShortsRevealPairing(
      frame,
      src,
      'porn',
      SHORTS_ID,
      'test_overlay_lost',
    );

    expect(healed).toBe(true);
    expect(anyRevealOverlay()).not.toBeNull();
    // Heal must not have dropped the blur.
    expect((frame as HTMLElement).dataset.mwModerated).toBe('blurred');
  });

  it('heal closes the first-entry orphan: video residue + unstamped frame → blur migrates to frame WITH reveal', () => {
    // This is the exact shape of guardian defect 2. At HEAD the heal closes it
    // via the nested health-heal chain (see header). If this test ever goes
    // red, the last line of defense against orphan blur on active Shorts is
    // gone — treat as a Phase 0 blocker.
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame, video, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    stampShortsBlurResidue(video, src, SHORTS_ID);
    expect((frame as HTMLElement).dataset.mwModerated).toBeUndefined();

    const healed = injection.probe.healActiveShortsRevealPairing(
      video,
      src,
      'porn',
      SHORTS_ID,
      'test_orphan_first_entry',
    );

    expect(healed).toBe(true);
    expect(anyRevealOverlay()).not.toBeNull();
    // Blur ownership lands on the stable frame with inline blur present.
    expect((frame as HTMLElement).dataset.mwModerated).toBe('blurred');
    expect(
      ((frame as HTMLElement).style.getPropertyValue('filter') || '').includes('blur('),
    ).toBe(true);
  });

  it('tap-to-reveal after the orphan heal clears the visible blur and the overlay', () => {
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame, video, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    stampShortsBlurResidue(video, src, SHORTS_ID);
    injection.probe.healActiveShortsRevealPairing(video, src, 'porn', SHORTS_ID, 'test_tap');

    const btn = document.querySelector('.mw-reveal-btn') as HTMLElement | null;
    expect(btn).not.toBeNull();
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // The user's tap must fully clear the visible blur and the overlay.
    expect((frame as HTMLElement).dataset.mwModerated).toBe('revealed');
    expect((frame as HTMLElement).style.getPropertyValue('filter') || '').not.toContain('blur(');
    expect(video.style.getPropertyValue('filter') || '').not.toContain('blur(');
    expect(anyRevealOverlay()).toBeNull();
  });
});

describe('Injection bootstrap — stale portal hygiene (C2a)', () => {
  it('a fresh injection purges stale reveal overlays left in the portal by a previous instance', () => {
    // The reveal portal lives on document.documentElement and survives
    // re-injection (only Off-mode cleanup removes it). Stale overlays from a
    // dead instance can collide with the new instance's diag node ids and
    // trigger createRevealOverlay's existing_owner_mismatch destruction path
    // (unblurs a true positive). A new instance owns no overlays by
    // definition, so anything found in the portal at init is stale.
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    buildActiveShortsPlayer(SHORTS_ID);

    // Forge the previous instance's surviving portal + overlay.
    const stalePortal = document.createElement('div');
    stalePortal.id = 'mw-reveal-portal';
    const staleOverlay = document.createElement('div');
    staleOverlay.className = 'mw-reveal-overlay';
    staleOverlay.dataset.mwNodeId = 'n1';
    staleOverlay.dataset.mwShortsOwnerToken = 'shorts_owner|dead|instance|token';
    stalePortal.appendChild(staleOverlay);
    document.documentElement.appendChild(stalePortal);

    injection = injectScript();

    const portal = document.getElementById('mw-reveal-portal');
    expect(portal?.querySelectorAll('.mw-reveal-overlay').length ?? 0).toBe(0);
  });
});

describe('Active Shorts orphan blur — redirect migrate + C2 fixes', () => {
  it('createRevealOverlay migrates video residue to the frame and attaches reveal', () => {
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame, video, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    // Residue on the <video>; reel frame unstamped (first-entry shape).
    stampShortsBlurResidue(video, src, SHORTS_ID);
    expect((frame as HTMLElement).dataset.mwModerated).toBeUndefined();

    injection.probe.createRevealOverlay(video, src, 'porn', SHORTS_ID);

    // Frame receives migrated blur + a paired reveal (no orphan).
    expect((frame as HTMLElement).dataset.mwModerated).toBe('blurred');
    expect(anyRevealOverlay()).not.toBeNull();
  });

  it('owner-token mismatch does NOT unblur a positive (fail-closed pairing)', () => {
    // Historical intermittent defect: after one mismatch retry, createRevealOverlay
    // called clearAllBlurAndOverlay(..., 'safe') — leaving no blur and no reveal,
    // or racing with re-apply and producing blur-without-reveal. Fail-closed:
    // realign tokens and keep blur + attach reveal.
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    stampShortsBlurResidue(frame, src, SHORTS_ID);
    injection.probe.createRevealOverlay(frame, src, 'porn', SHORTS_ID);
    expect(anyRevealOverlay()).not.toBeNull();
    expect((frame as HTMLElement).dataset.mwModerated).toBe('blurred');

    // Force a second create with a poisoned element owner token (swipe mid-attach).
    (frame as HTMLElement).dataset.mwShortsOwnerToken = 'shorts_owner|stale|poison|token';
    (frame as HTMLElement).dataset.mwOwnerMismatchCount = '1';
    (frame as HTMLElement).dataset.mwOwnerMismatchRetryScheduled = 'false';

    injection.probe.createRevealOverlay(frame, src, 'porn', SHORTS_ID);

    // FAIL-CLOSED: blur holds and a reveal path exists.
    expect((frame as HTMLElement).dataset.mwModerated).toBe('blurred');
    expect(
      ((frame as HTMLElement).style.getPropertyValue('filter') || '').includes('blur('),
    ).toBe(true);
    expect(anyRevealOverlay()).not.toBeNull();
  });

  it('tap-to-reveal clears same-src residue stamps on sibling nodes (C2c)', () => {
    // Historical defect (inverted by the C2c fix): after the orphan heal,
    // BOTH nodes carried mwModerated='blurred'; tapping reveal marked only
    // the frame 'revealed', leaving a stale 'blurred' stamp on the <video>.
    // The Flash Shield stylesheet blurs any active-reel video whose
    // data-mw-moderated is not safe/revealed/timeout-safe — so on device the
    // stale stamp could visually RE-BLUR a Short the user just revealed.
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { video, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    stampShortsBlurResidue(video, src, SHORTS_ID);
    injection.probe.healActiveShortsRevealPairing(video, src, 'porn', SHORTS_ID, 'test_stale');

    const btn = document.querySelector('.mw-reveal-btn') as HTMLElement | null;
    expect(btn).not.toBeNull();
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // The user's reveal must clear the residue stamp too, or the veil CSS
    // re-blurs the Short while the shield is armed.
    expect(video.dataset.mwModerated).toBe('revealed');
  });

  it('reveal residue sweep does NOT touch a different-src blurred node in the same container (C2c negative control)', () => {
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame, video, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    // A second node inside the same frame holding blur for DIFFERENT content
    // (e.g. recycled slot) must keep its blur through an unrelated reveal.
    const otherNode = document.createElement('img');
    const otherSrc = 'https://i.ytimg.com/vi/OtherShort99/oardefault.jpg';
    otherNode.src = otherSrc;
    otherNode.dataset.mwModerated = 'blurred';
    otherNode.dataset.mwSrc = otherSrc;
    (frame as HTMLElement).appendChild(otherNode);

    stampShortsBlurResidue(video, src, SHORTS_ID);
    injection.probe.healActiveShortsRevealPairing(video, src, 'porn', SHORTS_ID, 'test_ctrl');

    const btn = document.querySelector('.mw-reveal-btn') as HTMLElement | null;
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // Unrelated content keeps its blur stamp: reveals never leak across src.
    expect(otherNode.dataset.mwModerated).toBe('blurred');
  });

  it('stale overlay owner token is REPLACED without unblurring the positive (C2b fail-closed)', () => {
    // Historical defect (inverted by the C2b fix): when the overlay found for
    // this element carried a different shorts owner token, createRevealOverlay
    // called clearAllBlurAndOverlay(..., 'safe') — a bookkeeping mismatch
    // unblurred a TRUE POSITIVE and stamped it safe. Fail-closed behavior:
    // discard the stale overlay, rebuild a fresh one, never unblur.
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    stampShortsBlurResidue(frame, src, SHORTS_ID);
    injection.probe.createRevealOverlay(frame, src, 'porn', SHORTS_ID);
    const overlay = document.querySelector('.mw-reveal-overlay') as HTMLElement | null;
    expect(overlay).not.toBeNull();
    expect((frame as HTMLElement).dataset.mwModerated).toBe('blurred');

    // Simulate a stale owner token (previous instance / previous Short).
    if (overlay) overlay.dataset.mwShortsOwnerToken = 'shorts_owner|stale|instance|token';

    injection.probe.createRevealOverlay(frame, src, 'porn', SHORTS_ID);

    // FAIL-CLOSED: blur holds, and a usable reveal overlay exists.
    expect((frame as HTMLElement).dataset.mwModerated).toBe('blurred');
    expect(
      ((frame as HTMLElement).style.getPropertyValue('filter') || '').includes('blur('),
    ).toBe(true);
    expect(anyRevealOverlay()).not.toBeNull();
  });
});
