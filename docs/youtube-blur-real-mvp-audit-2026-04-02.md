# 1. Executive Verdict
- MVP score: **6.3 / 10**.
- What is solid:
  - Shorts request/result stale-guarding is strong (`pageEpoch` + `sovereignId` + stale hard-kill).
  - Host/inject protocol integrity is solid (nonce checks + epoch gate).
  - First-entry Shorts reliability work is real and not cosmetic.
- What is fragile:
  - Injected runtime is very large and timing-coupled (`~7.7k` LOC) and host orchestration is similarly large (`~4.6k` LOC).
  - Thumbnail/video reveal UX path is brittle and appears under-specified for non-Shorts playback transitions.
  - Flash timing remains structurally exposed by policy choice (`Shorts pre-blur intentionally disabled`).
- Whether this is worth continuing from current state:
  - **Yes**, continue from here. Do not rewrite.
  - But only with narrow hardening in the scan/reveal/transition layer. Do not expand model/policy complexity yet.

# 2. What the Code Actually Does
- Host injects moderation script on `onLoadStart` (after teardown) and again on `onLoadEnd` with an extra delayed attempt (80ms) if needed.
  - Evidence: [NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:1420), [NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:1441).
- Injected runtime discovers candidate media via mutation scans + YouTube selector scans + periodic rescans.
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6735), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:7414).
- Queueing pipeline:
  - `queueForScan()` stores `itemId -> element`, adds pending state, batches, then sends `gc-moderation-request` to host.
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6242), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5292).
- Blur behavior by mode:
  - **Shorts**: intentionally removes soft blur and waits for positive moderation verdict.
  - **Non-Shorts**: applies soft pre-blur while awaiting verdict.
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6249), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6264).
- Verdict application path:
  - Results map to element by `itemId`, apply policy gates (threshold/anatomical/fail-open/mvp mode), then `applyBlur` or `removeSoftBlur`, then source fanout (`findAndBlur`).
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5709), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5768), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5917).
- Reveal overlay behavior:
  - Overlay root is `pointer-events:none`; button is `pointer-events:auto`; reveal logic is currently `click`-driven.
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5005), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5032), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5062), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:7274).
- Host moderation layer:
  - Enforces stale request rejection / guarded bypass and has Shorts-specific uncertain-frame force-blur behavior.
  - Evidence: [NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:2291), [NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:2630).

# 3. Proven Working Areas
- **Stale request protection works in design and implementation**:
  - hard-kill stale nav/gen requests + epoch/sovereign gating.
  - Evidence: [NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:2345), [NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:2371).
- **Shorts uncertain video frame protection exists and is explicit**:
  - unknown/no-pixel `video-frame` gets force-blur category (`shorts_uncertain_input*`).
  - Evidence: [NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:2631), [NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:2725).
- **Policy guardrails are tested** for MVP mode + fail-open/fail-closed decision helpers.
  - Evidence: [webview-injection-policy.test.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/test/webview-injection-policy.test.ts:7).
- **Default fail-open + MVP mode are clearly configured in runtime settings**.
  - Evidence: [useLocalSettings.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useLocalSettings.ts:66).

# 4. Proven Broken or Fragile Areas
- **Fragile flash posture in Shorts by design**:
  - Shorts disables pre-blur before verdict to avoid false first-entry blur, which leaves an unavoidable exposure window.
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6249).
- **Non-Shorts video transition coverage is poster-centric**:
  - Non-Shorts scan path uses `video.poster`/poster attributes; no equivalent non-Shorts active-frame path.
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6487), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6547).
- **Reveal interaction is click-only with overlay pass-through container**:
  - This is fragile against iOS/YouTube gesture handlers that bind earlier pointer/touch phases.
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5005), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5062).
- **Flash guard exists but is disabled**:
  - If scan/inject latency spikes, there is no page-wide fallback veil.
  - Evidence: [useNativeWebView.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useNativeWebView.ts:5).
- **Dead/unused adapter risk**:
  - `YouTubeAdapter.ts` exists but no active references found in current runtime path.
  - Evidence: [YouTubeAdapter.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/blur-engine/adapters/YouTubeAdapter.ts:11).

# 5. Audit of Each User-Observed Problem
## A. Shorts flash timing
- What code proves:
  - Shorts intentionally skips pre-blur (`removeSoftBlur` path) before moderation verdict.
  - Request batching and host round-trip are asynchronous (`batchDelay`, request/processing path).
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6249), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6290), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5292).
- What is inferred:
  - Flash comes from combined delay: node discovery + queue batch delay + host moderation + result apply.
  - Injection timing can add extra startup flash when content appears before first effective scan.
- Root cause confidence: **High**.
- Smallest MVP-safe next move:
  - Add a **short-lived, Shorts-only first-frame safety veil** (100–200ms cap) only on active Shorts video container during entry/swap, removed immediately on first verdict or timeout.
  - Keep it strictly scope-limited to avoid permanent pre-blur regressions.
  - This is safer than changing thresholds/model.

## B. Thumbnail -> video transition blur drop
- What code proves:
  - Non-Shorts video scan path keys off poster, not active frame current playback surface.
  - `findAndBlur` fanout for videos matches poster/origPoster, not current frame identity.
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6547), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5957).
- What is inferred:
  - When YouTube replaces thumbnail node or transitions to playback surface, old blurred node can be orphaned while new playing node lacks inherited blur state.
  - Overlay can remain anchored in old container/state while visual blur is gone.
- Root cause confidence: **High (mechanism), Medium-High (exact node lifecycle in your runtime without live trace)**.
- Smallest MVP-safe next move:
  - Add non-Shorts transition hook: on video `play`/`playing`/`loadeddata`, if current container has active moderated context, re-resolve target and re-apply blur to active surface.
  - Do not change model/policy; treat as ownership rebind only.

## C. Tap-to-reveal broken on thumbnails/videos
- What code proves:
  - Overlay root is pass-through (`pointer-events:none`) and reveal logic is button `click` only.
  - No `pointerdown`/`touchstart` interception on reveal button path.
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5005), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5062), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:7274).
- What is inferred:
  - On iOS YouTube surfaces, upstream gesture handlers can consume pointer/touch before button `click` phase resolves, causing underlying navigation/play instead of reveal.
- Root cause confidence: **Medium-High**.
- Smallest MVP-safe next move:
  - Add capture-phase `pointerdown` + `touchstart` handlers on reveal button and overlay-local hit area to `preventDefault`/`stopImmediatePropagation` before YouTube click stack runs.
  - Keep logic local to reveal button only; avoid global gesture interception.

## D. Blur dial / threshold strategy
- What code proves:
  - Threshold dial exists in settings and injection (`0..4` mappings).
  - Policy stack currently includes threshold evaluation + anatomical gate + fail-open/mvp filter, then final blur decision.
  - Evidence: [useLocalSettings.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useLocalSettings.ts:75), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:210), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5741).
- What is inferred:
  - UX variance across users is likely better addressed by a small number of profile presets, not exposing many independent controls.
- Root cause confidence: **High** for architecture, **Medium** for UX impact without live telemetry.
- Smallest MVP-safe next move:
  - Keep current threshold machinery.
  - Add telemetry-backed tuning with 2–3 user-facing profiles only (reuse existing dial/mode), not new granular knobs.
  - Do not add more policy branches now.

## E. BodyPix / segmentation decision
- What code proves:
  - Stage-B segmentation already exists in on-device moderation path, with throttling/cache/gray-zone controls and DEV-leaning defaults.
  - Evidence: [useOnDeviceModeration.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useOnDeviceModeration.ts:1166), [useOnDeviceModeration.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useOnDeviceModeration.ts:1002), [useLocalSettings.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useLocalSettings.ts:90).
- What is inferred:
  - Expanding segmentation usage now increases runtime complexity and battery risk while transition/reveal bugs are still unresolved.
- Root cause confidence: **High**.
- Smallest MVP-safe next move:
  - **Defer segmentation expansion**.
  - Keep existing optional Stage-B as-is until transition/reveal/flash reliability is stabilized.

## F. Shelf life under YouTube updates
- What code proves:
  - Heavy dependence on explicit selector sets + mutation attribute heuristics + periodic rescans.
  - Evidence: [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6735), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6864), [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:7427).
- What is inferred:
  - DOM churn risk remains highest in node identity transitions (thumbnail->video, shorts reel swaps) and event ownership for reveal controls.
- Root cause confidence: **High**.
- Smallest MVP-safe next move:
  - Add selector/scan health counters and explicit fallback state logs per navigation epoch.
  - Harden node ownership rebinding for video transition/reveal before adding new features.

# 6. Exact Hotspots in Code
- [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6249)
  - Region: `queueForScan` Shorts pre-blur skip.
  - Why it matters: direct flash-risk source.
  - Risk: **High**.
- [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:6487)
  - Region: `scanVideoPoster` behavior split (Shorts frame capture vs poster fallback).
  - Why it matters: transition handling and playback coverage.
  - Risk: **High**.
- [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5957)
  - Region: `findAndBlur` video fanout keyed by poster/origPoster.
  - Why it matters: likely cause of blur drop during thumbnail->playing transition.
  - Risk: **High**.
- [webview-injection-script.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/lib/webview-injection-script.ts:5005)
  - Region: reveal overlay pointer-event model.
  - Why it matters: reveal taps falling through to YouTube handlers.
  - Risk: **High**.
- [NativeWebViewBrowser.tsx](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/components/browser/NativeWebViewBrowser.tsx:1420)
  - Region: inject-on-load timing.
  - Why it matters: initial scan timing/flash window.
  - Risk: **Medium-High**.
- [useNativeWebView.ts](/Users/codygroves/dev/mw-forensics/tag-mvp-stable/src/hooks/useNativeWebView.ts:5)
  - Region: flash guard disabled.
  - Why it matters: no global visual safety fallback for injection/scan latency spikes.
  - Risk: **Medium**.

# 7. Recommended MVP-Safe Fix Order
1. **Fix reveal event ownership on thumbnails/videos**.
- Benefit: immediate UX correctness for reveal.
- Risk: low-medium.
- Rollback: easy (single injection event block).
- Shorts break risk: low if scoped to reveal controls.
- Thumbnail break risk: low.
- Battery/runtime risk: negligible.

2. **Add non-Shorts thumbnail->playing ownership rebind**.
- Benefit: fixes blur-drop during playback transition.
- Risk: medium.
- Rollback: moderate but contained.
- Shorts break risk: low if path-gated to non-Shorts.
- Thumbnail break risk: low-medium.
- Battery/runtime risk: low.

3. **Add bounded Shorts first-frame safety veil (100–200ms max)**.
- Benefit: reduces visible unsafe flash without full pre-blur regression.
- Risk: medium (timing-sensitive).
- Rollback: easy with flag.
- Shorts break risk: medium if not strictly bounded.
- Thumbnail break risk: none.
- Battery/runtime risk: low if limited to entry/swap windows.

4. **Add minimal detector-health telemetry per epoch**.
- Benefit: early break detection under YouTube churn.
- Risk: low.
- Rollback: easy.
- Shorts break risk: none.
- Thumbnail break risk: none.
- Battery/runtime risk: negligible.

# 8. Things I Should NOT Touch Yet
- Do not redesign threshold/policy stack now.
  - Reason: current failures are primarily ownership/timing/event-layer, not classification policy core.
- Do not expand BodyPix/segmentation usage now.
  - Reason: architecture fragility is in DOM/runtime transition and interaction layers.
- Do not broad-refactor `webview-injection-script.ts` yet.
  - Reason: high regression risk while behavior is timing-sensitive; apply small targeted patches first.
- Do not introduce many user knobs.
  - Reason: configuration swamp will mask root-cause bugs and destabilize MVP.

# 9. Suggested DIAG / Instrumentation Additions
- Add per-epoch counters emitted once on navigation settle:
  - `shorts_entry_to_first_blur_ms`
  - `video_transition_rebind_attempts/success/fail`
  - `reveal_button_pointerdown_seen` vs `reveal_click_seen`
  - `overlay_present_blur_absent_events`
- Add explicit reason code when blur disappears while overlay exists:
  - e.g. `blur_lost_node_replaced`, `blur_lost_safe_result`, `blur_lost_owner_mismatch`.
- Keep DIAG gated by existing debug flags only.

# 10. Commands Run / Tests Run
- `git status --short`
  - Result: untracked files present, including prior audit doc and local scripts.
- `git rev-parse --abbrev-ref HEAD`
  - Result: `mvp/shorts-zerohero5-guardrails`.
- `git tag --list | rg -n "CODYMVP1" -S`
  - Result: tag exists.
- `git show --no-patch --oneline CODYMVP1`
  - Result: points to commit `365527b8` with Shorts first-entry fix message.
- `git diff --stat CODYMVP1 -- <core moderation files>`
  - Result: no diff shown for audited core files in current working tree.
- Source inspection commands (selection):
  - `rg -n "..." src/lib/webview-injection-script.ts ...`
  - `nl -ba ... | sed -n ...` on:
    - `src/lib/webview-injection-script.ts`
    - `src/components/browser/NativeWebViewBrowser.tsx`
    - `src/hooks/useNativeWebView.ts`
    - `src/hooks/useOnDeviceModeration.ts`
    - `src/hooks/useLocalSettings.ts`
    - `src/lib/moderation-request-utils.ts`
    - `src/lib/blur-engine/adapters/YouTubeAdapter.ts`
- Test run:
  - `npm test -- --run src/test/webview-injection-policy.test.ts`
  - Result: `1` file, `4` tests, all passed.

# 11. Final Blunt Recommendation
- Keep this architecture and stabilize it with surgical fixes.
- Next I would do exactly this in order:
  1. Patch reveal interaction to capture pointer/touch before YouTube handlers.
  2. Patch non-Shorts thumbnail->video transition ownership rebinding.
  3. Add a strictly bounded Shorts first-frame safety veil (flagged, rollbackable).
  4. Add minimal epoch-scoped DIAG counters to prove the fixes and detect churn regressions.
- I would **not** touch thresholds/model policy/segmentation scope until these runtime ownership/timing defects are closed.
- Prior fixes were mostly in stale-request/epoch reliability (correct layer for Shorts first-entry), but they did not resolve non-Shorts transition ownership and reveal event capture; that gap is now the MVP bottleneck.
