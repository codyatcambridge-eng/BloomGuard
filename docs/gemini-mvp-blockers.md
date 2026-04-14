# Bloom Guard YouTube MVP (mvpcandidate3) — Blockers to 10/10

This note is written for an external reviewer (Gemini) to quickly understand what is working, what is still fragile, and what to harden next.

## What “good” looks like for MVP

1. **Homepage thumbnails are stable**
   - No blur “drop” during scroll/churn.
   - No surprise “tap to reveal” button appearing/disappearing.
   - If blurred, stays blurred until user reveals; if safe, stays safe.

2. **Active Shorts behavior is stable**
   - No flash of visible Shorts video during swipe/navigation.
   - If the current Shorts frame is unsafe, blur is applied quickly and stays applied.
   - If user reveals, it remains revealed for the current Shorts video (no instant re-blur).

3. **SPA navigation never uses stale state**
   - No “safe_epoch_stale” caused by timers or observers from prior pages.
   - No scanning results applied to the wrong page/video.

## What’s already hardened in this snapshot (mvpcandidate3)

### 1) Shorts Flash (Latency & Veil)

- **Reinject timer reduced to 50ms** (from 250ms).
- **Safety Veil**: on Shorts SPA navigation, inject CSS immediately:
  - `#shorts-player { opacity: 0 !important; }`
- **Veil lift is gated**:
  - Only after the injection is ACKed (`MW_INJECTED_ACK`) and `hookStable` is true in the native host.
  - Only after a Shorts **verdict is applied** in the injection script (`MW_SHORTS_VERDICT_APPLIED`).
  - Lift is **frame-synchronized** (removes style on `requestAnimationFrame`) to avoid any mid-tick “1ms gap”.

### 2) Tap-to-Reveal event ownership

- Reveal uses **capture-phase pointerdown** on the button and consumes the gesture with:
  - `e.preventDefault()` + `e.stopImmediatePropagation()` to reduce YouTube capture listeners stealing taps.

### 3) Timer / state leak prevention

- On every host `onUrlChange`, the host explicitly calls `__MW_HARD_TEARDOWN__()` in the webview **before** re-injection.
- Injection-side `hardTeardown()` clears known intervals/timeouts/raf handles in `timerState`.

### 4) Build/runtime “is this stale code?” marker

- The app logs a startup runtime marker:
  - `[codyMVP] runtime_marker sha=<shortsha> builtAt=<iso time>`

## Current MVP blockers to reach 10/10

### Blocker A — DOM churn still can orphan overlays (Blur-drop)

Symptoms:
- Blur overlay/reveal overlay can detach when YouTube swaps nodes during list virtualization / scroll.

Why:
- Some binding uses element identity and/or uses “best-effort” heal that can lose association during rapid churn.

Hardening direction:
- Track media identity by stable attributes (normalized src/poster/video id) and *re-parent overlays* immediately when node is replaced but the media identity is unchanged.

### Blocker B — Shorts epoch/sovereign mismatch windows (“safe_epoch_stale”)

Symptoms:
- During rapid Shorts swipes, host logs can show epoch/sovereign mismatch and skip scanning, resulting in “safe_epoch_stale” outcomes.

Why:
- During the SPA transition window, requests can be emitted with tokens that don’t match the active “sovereign” context; the host correctly fails open but that can reduce protection and/or cause visible logic churn.

Hardening direction:
- Tighten sovereign-id alignment earlier (or broaden safe bypass windows only after hook stability is proven).
- Reduce windows where `hookStable=false` during Shorts swipe by ensuring reinject/ack happen as early as possible and that teardown doesn’t induce re-entry races.

### Blocker C — YouTube gesture stack edge cases (Tap-to-Reveal)

Symptoms:
- Even with capture pointerdown, YouTube may still navigate due to touch/gesture handlers outside normal bubbling paths.

Hardening direction:
- Consider also owning `touchstart` / `touchend` in capture on the reveal button (and possibly the overlay container) when on YouTube/Shorts.
- Ensure the overlay/button is above YouTube’s top-most layers (`z-index`) and that pointer-events remain correct.

## “Do not regress” invariants (quick checklist)

- Shorts video never becomes visible before either:
  - veil is lifted *and* hook is stable *and* a verdict was applied for the active Shorts frame.
- Teardown always clears timers before new injection on `onUrlChange`.
- Reveal pointerdown capture always fires and consumes the event when the user taps the reveal button.

