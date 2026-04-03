# YouTube Blur MVP Audit (April 2, 2026)

## 1. Executive Summary

The current YouTube blur system is sophisticated and already includes many hard-earned protections for Shorts churn (epoching, sovereign IDs, stale-request hard-kill, fallback legacy queue mirror, and overlay health/reposition loops). It is beyond a typical MVP in complexity.

Architecturally, the main risk is not missing functionality; it is complexity-driven fragility and maintenance cost. The pipeline has multiple transport and state paths (postMessage, Capgo event unwrap, legacy queue mirror/polling), plus multiple blur authorities (element blur, reveal overlay, central blur state, optional flash guard plumbing). This increases the chance of regressions under frequent YouTube DOM changes.

The safest next MVP step is to reduce moving parts while preserving current safety behavior in Shorts:
- Keep the resilient epoch/sovereign safeguards.
- Keep uncertain-frame force-blur for active Shorts video frames.
- Remove or gate legacy/non-primary paths outside proven recovery windows.
- Introduce contract tests + selector health metrics so YouTube updates are detected quickly.

## 2. System Scope and Core Behavior

### 2.1 Policy Defaults
- `fail_closed` defaults to `false` (fail-open) and `blocking_mode` defaults to `mvp` in local settings ([useLocalSettings.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useLocalSettings.ts:66)).
- MVP policy allowlist includes `swimwear`, `shirtless`, `bikini`, `swim_trunks`, `thirst`, and always permits `porn`/`hentai` in policy evaluation ([webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:62)).

### 2.2 On-Device Classifier (Host side)
- NSFW classification is fail-open on timeout/error (`FAST_TIMEOUT_MS = 3000`, fallback `shouldBlur=false`) ([useOnDeviceModeration.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useOnDeviceModeration.ts:134), [useOnDeviceModeration.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useOnDeviceModeration.ts:1529)).
- Neutral fast-pass suppresses blur when neutral is high and explicit risk is below override threshold ([useOnDeviceModeration.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useOnDeviceModeration.ts:1170)).
- Stage-B segmentation can escalate safe stage-A output to blur via `thirst_detected` ([useOnDeviceModeration.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useOnDeviceModeration.ts:1417)).

### 2.3 Injected WebView Runtime
- Injected config uses page epoch + nonce and request timeout of 8s ([webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:187)).
- YouTube path applies fixed hard blur `40px` (non-YouTube path clamps to <=20px) ([webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:4538)).
- YouTube selectors are explicit and broad (`ytd-*`, thumbnail IDs/classes, `ytimg`/`ggpht`) ([webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6735)).
- Multiple periodic scans run on startup/scroll/interval for YouTube ([webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:7414)).

### 2.4 Host-Orchestrated Request/Result Protocol
- Request/result schema includes `nonce`, `pageEpoch`, and `sovereignId` to prevent stale cross-navigation contamination ([moderation-request-utils.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/moderation-request-utils.ts:85)).
- Host enforces stale request hard-kill and guarded YouTube relaxed epoch acceptance ([NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:2291)).
- For active Shorts `video-frame` with unknown input/no pixels, host force-blurs as uncertain-safe behavior ([NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:2630)).
- Overlay safety signal is computed from aggregated hard/soft hit policy with Shorts-specific `any blur hit` unsafe escalation ([NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:2841)).

### 2.5 Legacy Reliability Path
- In Shorts mode, injected runtime mirrors request subset into `__GC_SCAN_QUEUE__` ([webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5351)).
- Host has adaptive legacy polling for this queue, including probe windows and self-disable logic ([NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:3405)).

## 3. What Is Working Well (Keep)

1. Strong stale-context defenses: `pageEpoch` + `sovereignId` + stale hard-kill make cross-video contamination much less likely.
2. Shorts uncertainty handling: force-blur on unknown active frame avoids dangerous false-safe transitions in high-churn video swaps.
3. Nonce-based protocol validation: blocks spoofed `gc-moderation-result` acceptance.
4. Good policy test baseline for MVP/fail-open behavior ([webview-injection-policy.test.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/test/webview-injection-policy.test.ts:7)).

## 4. Key Risks and MVP Gaps

### 4.1 Complexity Debt Is the Main Failure Vector
- Injection runtime is ~7,690 LOC and host browser orchestrator is ~4,634 LOC. Combined behavior is hard to reason about during regressions.
- Multiple fallback channels increase race-condition surface area and debugging burden.

### 4.2 Selector Shelf Life Against YouTube Updates
- Hard-coded selector lists and repeated scan loops are vulnerable to YouTube class/tag churn.
- Heavy rescanning can still miss transient render states and may raise CPU/thermal pressure on lower-end devices.

### 4.3 Policy Ambiguity Between Fail-Open and Shorts Force-Blur
- Global default is fail-open, but Shorts uncertain frame intentionally force-blurs.
- This is directionally correct for safety, but UX messaging can feel inconsistent unless explicitly explained in-product.

### 4.4 Dead/Drifting Code Signal
- `src/lib/blur-engine/adapters/YouTubeAdapter.ts` appears unreferenced from current orchestration (candidate dead path) ([YouTubeAdapter.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/blur-engine/adapters/YouTubeAdapter.ts:11)).
- Dead paths increase “unknown unknowns” during incident response.

### 4.5 Flash Exposure Strategy Is Mixed
- Flash guard exists but is globally disabled (`FLASH_GUARD_ENABLED = false`) while central blur/element blur handle safety ([useNativeWebView.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useNativeWebView.ts:6)).
- If YouTube introduces render timing shifts, this may reopen micro-flash windows.

## 5. Stability and Shelf-Life Assessment (YouTube Update Cadence)

Current resilience is medium-high for short-term churn because of strict stale gating and reentry recovery logic. Long-term shelf life is medium unless complexity is reduced and selector coverage becomes contract-tested.

Expected shelf-life without further work:
- Minor YouTube DOM changes: usually survivable.
- Structural Shorts container/model changes: likely to degrade behavior until patched.
- Messaging/iframe behavior changes: medium risk due to multi-channel transport assumptions.

## 6. Recommended MVP-Safe Fixes (Ranked)

## Priority 0 (Immediate, low risk)
1. Add “detector health heartbeat” telemetry for YouTube runtime.
- Emit: selector hit counts, request send/ack ratio, timeout ratio, stale rejection ratio, uncertain-force-blur ratio.
- Goal: detect breakages within one session, not from user complaints.

2. Make Shorts uncertainty behavior explicit in UX copy.
- Explain: “When frame data is unstable, we briefly protect by blur-first.”
- Reduces confusion around apparent fail-open/fail-closed mismatch.

3. Add an explicit kill-switch flag per risky subsystem.
- Flags: `legacy_queue_mirror`, `legacy_poll_fallback`, `shorts_health_heal`, `shorts_force_uncertain_blur`.
- Use remote config/local override for incident mitigation.

## Priority 1 (Next sprint, medium impact)
1. Collapse non-Shorts YouTube path to single transport.
- Prefer postMessage path only for non-Shorts contexts.
- Keep legacy polling strictly probe-gated for Shorts recovery windows.

2. Convert selectors into versioned profiles.
- `yt_selector_profile_v1` with confidence scoring.
- On low hit-rate, auto-switch to broader fallback profile.

3. Add deterministic contract tests for injected runtime decisions.
- Test matrix:
  - epoch mismatch accept/reject
  - sovereign mismatch behavior
  - Shorts unknown frame force-blur
  - timeout fail-open/fail-closed

## Priority 2 (Stability hardening)
1. Reduce startup scan bursts.
- Replace fixed multi-timeout scans with adaptive cadence from mutation velocity.
- Keeps protection while lowering perf pressure.

2. Delete or integrate dead adapter path.
- If `YouTubeAdapter` is obsolete, remove it.
- If intended, wire it explicitly and test it.

3. Introduce bounded state machine docs and runtime assertions.
- States: `Injected`, `Ready`, `WaitingForHost`, `ResultApplied`, `EpochInvalidated`, `Teardown`.
- Assertions catch impossible transitions in dev builds.

## 7. MVP User-Friendliness Upgrades

1. One-tap “Why blurred?” panel.
- Show category, confidence band, and “unstable frame protection” reason when applicable.

2. Session-level reveal memory with clear scope label.
- State if reveal applies to current Shorts video only vs page-level.

3. Graceful degradation message.
- If detector health drops (timeouts/stale high), show “Protection reduced; retrying…” banner rather than silent behavior changes.

## 8. Architecture Guidance for ChatGPT/Team Handoff

When reasoning about this system, treat it as 5 layers:
1. `Detection`: injected DOM discovery + source extraction.
2. `Transport`: postMessage + nonce + epoch/sovereign + optional legacy fallback.
3. `Decision`: on-device model + policy transforms + Shorts uncertain override.
4. `Enforcement`: blur CSS + reveal overlay + optional central blur signal.
5. `Recovery`: reentry refresh, stale hard-kill, probe-based legacy fallback.

Most production bugs will be cross-layer race conditions, not isolated classifier errors.

## 9. Verification Snapshot (This Audit)

- Targeted policy test executed and passing:
  - `npm test -- --run src/test/webview-injection-policy.test.ts`
  - Result: 1 file, 4 tests, all passed.

## 10. Final Recommendation

For MVP safety + maintainability, do not add more heuristics first. First reduce transport/state complexity, add health telemetry, and formalize selector and epoch contracts. That will extend shelf life against YouTube churn more than adding more detection branches.
