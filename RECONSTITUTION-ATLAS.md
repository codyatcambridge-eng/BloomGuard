# RECONSTITUTION-ATLAS.md

**Status:** Consolidated engineering intelligence, 2026-11-25

**Repository scope:** `codyatcambridge-eng/Claude-Bloom-Guard` is the leading native iOS integration candidate. `codyatcambridge-eng/BloomGuard` and `codyatcambridge-eng/miracle-worker-pro` are historical donor repositories.

## Executive summary

The newest verified native build reference is `r027` in `Claude-Bloom-Guard`. GitHub resolves `r027` to commit [`4777424dcd7b2de1d18947bab3d826f594f44c35`](https://github.com/codyatcambridge-eng/Claude-Bloom-Guard/commit/4777424dcd7b2de1d18947bab3d826f594f44c35), titled **“YouTube Watch ads: Skip only through YouTube's own button; no forced seek.”** It is not a reason to reopen the YouTube implementation; it is evidence of a narrow, preservation-focused ad-transition fix on the already-frozen native line.

The shortest safe path is to preserve the native r027 architecture and qualification evidence, isolate P0 reveal/coverage gaps, verify ad and sponsored-media behavior, and only then port the strongest independent donor implementations.

## Verified r027 state

- **Ref:** `r027`
- **Commit:** `4777424dcd7b2de1d18947bab3d826f594f44c35`
- **Commit date:** 2026-11-09
- **Modified file:** `Resources/bloomguard-youtube.js`
- **Purpose:** Remove prior forced-ad seeking and force-skip behavior. Watch ads remain muted under the BloomGuard cover and are clicked through YouTube's own Skip control only if YouTube offers it. Sponsored Shorts and promoted previews remain paused. Ads that YouTube does not permit skipping are allowed to play out.
- **Evidence in commit:** claims simulator reproduction, 290 JS tests, 8/8 YouTube certification runs and 0 flash observations.
- **Evidence not established here:** independent rerun, physical-device artifact, complete build identifier, all r027 ancestry, and P0/P1/P2 certification package.

## What changed from older native builds

Older Sacred Baseline 02 was source `b7ff3b74` and focused on advanced triggers, frame verdict aggregation and bare-skin detection. r027 belongs to the later YouTube work and supersedes it for ad-transition behavior only. The native architecture is broadly continuous: one WKWebView, document-start CSS/core/engine injection, native identity validation and on-device classifier queue remain the leading candidate.

Do not revert to Miracle Worker or Capacitor for general browser UX. Use them as donor sources for isolated, proven mechanics only.

## Source navigation

- Native entry point: `App/BloomGuardApp.swift`
- Native browser engine: `Browser/BrowserEngine.swift`
- Native script bridge: `Browser/BridgeController.swift`
- Script injection: `Browser/ScriptInjector.swift`
- Page core: `Resources/bloomguard-core.js`
- Page engine: `Resources/bloomguard-engine.js`
- Protection CSS: `Resources/bloomguard.css`
- YouTube ad/current build logic: `Resources/bloomguard-youtube.js`
- Classifier orchestration: `Classifier/ClassifierService.swift`
- Settings: `Core/ProtectionState.swift`, `Core/ProtectionSettings.swift`, `Core/SettingsStore.swift`
- Unit tests: `Tests/BloomGuardTests.swift`
- Real-touch UI tests: `UITests/RevealTests.swift`, `UITests/BlurDropTests.swift`, `UITests/Rig.swift`, `UITests/TriggerTests.swift`

## Supporting documents

- [Product contract registry](./DOCUMENT-REGISTRY.md)
- [Repository and architecture map](./REPOSITORY-MAP.md)
- [Complete build genealogy](./BUILD-GENEALOGY.md)
- [Feature reconstitution matrix](./RECONSTITUTION-MATRIX.md)
- [Historical donor library](./DONOR-ACQUISITION-PLAN.md)
- [Regression lineage](./REGRESSION-LINEAGE.md)
- [Current build truth](./CURRENT-BUILD-TRUTH.md)
- [MVP critical path](./MVP-CRITICAL-PATH.md)
- [Evidence index](./EVIDENCE-INDEX.md)

## Highest-confidence preserved implementations

| Area | Current/donor location | Exact evidence | Recommendation |
|---|---|---|---|
| Browser shell | `Browser/BrowserEngine.swift` | One persistent WKWebView; navigation and settings are written by the host | KEEP; do not rebuild |
| Document-start protection | `Browser/ScriptInjector.swift`, `Resources/bloomguard.css` | CSS is armed and installed at document start | KEEP |
| Video identity | `Browser/BridgeController.swift` | 11-character YouTube ID validation and reconstructed thumbnail URLs | KEEP |
| Reveal identity | `CLAUDE.md`, `UITests/RevealTests.swift`, page engine | Identity is documented by video ID; real-touch tests cover one/two tap behavior | REPAIR only against demonstrated current defects |
| Shorts/reveal geometry | `UITests/RevealTests.swift`, `UITests/Rig.swift` | Simulator real-touch tests cover active Shorts, badges and reveal | RECONSTITUTE selectively if newest source has a defect |
| Classifier fallback | `Classifier/ClassifierService.swift`, native classifier files | NSFWJS/Core ML/native evidence is present in project history | KEEP and require latest parity/physical evidence |
| Watch/Sponsored ads | `Resources/bloomguard-youtube.js` at r027 | r027 only uses YouTube Skip controls and pauses Sponsored Shorts/promoted previews | KEEP; add independent regression fixtures |
| Bridge governor/deduplication | Miracle Worker PR #3 | Caches host blur state and disconnects stale reveal state; mutation loop guard is documented | EXAMINE branch diff; transplant only isolated guard |
| Shorts flicker continuity | Miracle Worker PR #4 | Four continuity fixes and 14-test claim; open draft, not merged | ENHANCE only after native reproduction |
| Bounded recovery rescans | Legacy BloomGuard `phase1a-bounded-rescan-reliability` | Commit `435046d081f7da8...` documents bounded recovery and 126 green tests | RECONSTITUTE as a pattern, not wholesale code |

## Highest-value historical donors

1. **Miracle Worker PR #1**, merged Feb. 9: blur reliability work, exact merge SHA `792d953d3573acff116b686ff01d11157e54e372`.
2. **Miracle Worker PR #3**, open draft: bridge state caching, mutation guard, Reveal lock bypass and sovereign reset. Extract the principles and isolated functions only after reproducing native behavior.
3. **Miracle Worker PR #4**, open draft: Shorts continuity grace and blur fallback. Useful as a hypothesis and test design; not proof it is safe in r027.
4. **Legacy BloomGuard `phase1a-bounded-rescan-reliability`**, commit `435046d081f7da8a93c8...`: bounded foreground and SPA recovery; useful as a lifecycle pattern.
5. **Sacred Baseline 01/02 archives:** exact simulator app, source and test evidence; preserve and freeze, but do not call them physical-device qualification.

## Explicitly not recommended

- Do not revert r027 to Miracle Worker or earlier BloomGuard runtimes.
- Do not reopen Instagram implementation unless an owner-authorized critical defect requires it.
- Do not make broad YouTube DOM changes; changes must be isolated and freeze-authorized.
- Do not restore historical ad seeking or forced skipping.
- Do not blur recognized ads or sponsored surfaces.
- Do not preserve fail-open policies when a P0 certification matrix expects protection.
- Do not transplant large generated JS files wholesale because of selector and state ownership drift.

## Exclusive remaining MVP blockers

1. Independent r027 physical-device run and complete artifact index.
2. P0 Reveal/recovery matrix, including second tap, ripple, scroll and menu transitions.
3. Sponsor/ad behavior validation under live YouTube markup.
4. R027 blur-drop soak with 0 uncovered frames across a defined test set.
5. Long-session memory, CPU, thermal and battery evidence.
6. Reconcile Scroll/SPA recovery, process termination and bfcache behavior.
7. Exact Browser Feature List v3/PDF is not included in this repository snapshot reviewed here.

## Immediate Claude Code starting point

Starting build: r027 native `Claude-Bloom-Guard` line.

Before any code change:

1. Verify the exact checkout and clean worktree.
2. Record Xcode, iOS simulator/physical device, OS and app build SHA.
3. Run existing JS, Swift and UI suites.
4. Add no ad or sponsored blur in any patch.
5. Use a failing real-tap regression test before Reveal changes.
6. Require freeze/UNFREEZE authorization for YouTube or shared protected files.
7. Keep all changes isolated and rollbackable.

## Access limitations

- GitHub tag API endpoints were unsupported by the available tooling for direct tag-object retrieval.
- The `/commits/r027` endpoint returned the exact commit metadata and r027 content, so r027 resolution is confirmed by commit resolution rather than a direct annotated-tag object read.
- No authoritative Browser Feature List v3 PDF or attached engineering contract was available as a repository file in this session.
- No fresh Xcode build, `.xcresult`, Instruments trace or physical-device certificate was available here.

