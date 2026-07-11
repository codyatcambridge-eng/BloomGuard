/**
 * Active Shorts orphan-blur regression net (Step 0 — tests only).
 *
 * Two kinds of tests live here, deliberately separated:
 *
 * 1. INVARIANTS (must stay green forever): the paths where "blur implies a
 *    reachable reveal" already holds at HEAD. These are the tripwires that
 *    protect AGENTS.md §2 while the C-phase patches land.
 *
 * 2. KNOWN DEFECTS (pinned wrong behavior): the createRevealOverlay
 *    stable-target redirect dead-end. These tests assert the CURRENT WRONG
 *    behavior on purpose so any change to it is loud. When the C2 fix lands,
 *    each test marked [INVERT-ON-C2-FIX] MUST be inverted to assert the
 *    correct behavior — do NOT delete them.
 *
 * Defect chain being pinned (verified 2026-07-10 at d8d58991):
 *   blur residue sits on the Shorts <video> while its ytm-reel-video-renderer
 *   frame is unstamped → createRevealOverlay(video, ...) redirects to the
 *   frame (stableTarget !== element) WITHOUT migrating the blur stamp → the
 *   recursion exits at the `mwModerated !== 'blurred'` check and removes any
 *   overlay → blur with no reveal button (until/unless a heal runs).
 *
 *   healActiveShortsRevealPairing DOES close this case at HEAD — but only via
 *   an indirect chain: setShortsBlurContextForNode → context count 0→1 →
 *   maybeStartShortsHealthHealInterval → synchronous runShortsHealthHealCycle
 *   → full health heal → applyBlur migrates blur to the frame + creates the
 *   reveal. That success is pinned as an INVARIANT below; the direct
 *   createRevealOverlay dead-end remains pinned as a KNOWN DEFECT.
 *
 *   Residual defect also pinned below: after the heal, BOTH nodes carry
 *   mwModerated='blurred'; tapping reveal marks only the frame 'revealed' and
 *   leaves a stale 'blurred' stamp on the <video>. Visually clean in jsdom,
 *   but on device the Flash Shield stylesheet blurs any active-reel video
 *   whose data-mw-moderated is not safe/revealed/timeout-safe — so while the
 *   shield is armed, the stale stamp can visually RE-BLUR a Short the user
 *   just revealed ("variable blur with reveal button" symptom).
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

describe('Active Shorts orphan blur — KNOWN DEFECT (redirect dead-end) [INVERT-ON-C2-FIX]', () => {
  // These tests assert the CURRENT WRONG behavior. They exist so that:
  //  (a) any accidental change to this code path fails the suite loudly, and
  //  (b) the C2 fix has a ready-made red→green harness: invert the
  //      expectations marked below when the fix lands.

  it('createRevealOverlay dead-ends when blur residue is on the video and the frame is unstamped', () => {
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { frame, video, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    // Residue on the <video>; reel frame unstamped (first-entry shape).
    stampShortsBlurResidue(video, src, SHORTS_ID);
    expect((frame as HTMLElement).dataset.mwModerated).toBeUndefined();

    injection.probe.createRevealOverlay(video, src, 'porn', SHORTS_ID);

    // Blur is still present on the video...
    expect(video.dataset.mwModerated).toBe('blurred');
    // ...but NO reveal overlay was created anywhere: orphan blur.
    // [INVERT-ON-C2-FIX] → expect(anyRevealOverlay()).not.toBeNull();
    expect(anyRevealOverlay()).toBeNull();
  });

  it('stale blurred stamp is left on the video after tap-to-reveal [INVERT-ON-STALE-STAMP-FIX]', () => {
    // After the orphan heal, BOTH nodes carry mwModerated='blurred'. Tapping
    // reveal marks only the frame 'revealed'. The <video> keeps a stale
    // 'blurred' stamp. Harmless to inline styles, but the Flash Shield
    // stylesheet blurs any active-reel video whose data-mw-moderated is not
    // safe/revealed/timeout-safe — so on device, while the shield is armed,
    // this stale stamp can visually re-blur a Short the user just revealed.
    const SHORTS_ID = nextShortsId();
    pushShortsUrl(SHORTS_ID);
    const { video, src } = buildActiveShortsPlayer(SHORTS_ID);
    injection = injectScript();

    stampShortsBlurResidue(video, src, SHORTS_ID);
    injection.probe.healActiveShortsRevealPairing(video, src, 'porn', SHORTS_ID, 'test_stale');

    const btn = document.querySelector('.mw-reveal-btn') as HTMLElement | null;
    expect(btn).not.toBeNull();
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // [INVERT-ON-STALE-STAMP-FIX] → expect(video.dataset.mwModerated).toBe('revealed');
    expect(video.dataset.mwModerated).toBe('blurred');
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
