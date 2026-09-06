# SACRED100 MVP Recovery Report

## 1. Repository state

Audited 2026-09-06 on `integration/flash-active-from-SACRED100` at
`9986d613cc1e797d12d509d30fe652331c1c51fd`. The initial tree was clean and HEAD
was exactly the SACRED100 commit. The integration branch therefore descends
directly from SACRED100 with zero intervening commits before this documentation
work. `origin/integration/flash-active-from-SACRED100` and
`origin/sacred/SACRED100` also advertised the same commit locally.

## 2. SACRED100 verification

`SACRED100` is an annotated tag object (`04008784c92f23a6536ef6d39f52f36b2a661ddd`),
so plain `git rev-parse SACRED100` reports the tag object. `git rev-parse
SACRED100^{}` reports the required commit
`9986d613cc1e797d12d509d30fe652331c1c51fd`. `sacred/SACRED100` resolves to that
same commit. No protected ref was changed.

## 3. Context and documentation findings

The checkout lacked `CONTEXT.md`. The newest historical `context.md`, at
`ad380b2`, only records the August 7 Active Shorts transition veil and cannot
describe the controlled SACRED100 branch by itself. `CONTEXT.md` was therefore
reconstructed from Git ancestry and current control requirements, without copying
later product code. `FROZEN.md` and `AGENTS.md` contain useful invariant history,
but their older baseline references are not authoritative over SACRED100.

## 4. AGENTS.md assessment

The file strongly described blur/reveal invariants, negative safety, lifecycle
testing, and freeze discipline. It did not prohibit moving or developing on
SACRED100, wholesale donor merges, incidental frozen-function edits, or feature
stacking; it named `phase0-behavior-freeze-2026-07-09` as current. A SACRED100
control preamble was required and added. It makes manual device QA mandatory in
addition to green tests and orders subsystem acquisition.

## 5. FROZEN.md assessment

`FROZEN.md` contained a valuable protected-function inventory but named
`mvp-sacred-2026-06-04`, called Active Shorts MVP-ready, and compared the guard
against the old tag. Its original record is preserved under a clearly labeled
historical section. A new governing section makes SACRED100 unambiguous. The
checker now verifies both immutable refs and descendant ancestry, checks each
protected commit for its own override trailer, blocks uncommitted protected-file
changes, and covers the expanded control surface and existing stability tests.

## 6. Accepted sacred behaviors

The accepted SACRED100 control covers stable positive thumbnails, clean negatives,
paired and healing reveal controls through DOM churn, ownership isolation, Main
Dial authority, OFF staying OFF, OFF-to-ON rearming, responsive scrolling, and
bounded scan/observer/timer behavior. These are non-negotiable regression gates.

## 7. Known SACRED100 deficiencies and verification gaps

SACRED100 is not proof of a complete MVP. First run a fresh device matrix across
Home, Search, Watch recommendations, both Shorts shelves, active Shorts, refresh,
foreground/re-entry, inactivity, modes, and performance. Flash Shield, Active
Shorts transitions/player protection, and Watch-player video protection remain
acquisition candidates until device-proven. Automated tests cannot resolve visual
flash timing, native lifecycle, or sustained-scroll responsiveness alone.

## 8. Donor lineages worth investigating

All primary later donors share merge-base `5044f0f` with SACRED100, not SACRED100
itself; they are divergent lines and unsafe wholesale merges.

- `1c6c581` (`sacred-active-shorts-flash-handoff-2026-08-12`): sealed Active
  Shorts first-paint Flash handoff and controls; parent is the August 7 veil seal.
- `745837a` (`freeze-main-dial-off-flash-ownership-2026-08-12`): descendant of
  `1c6c581` through documentation/privacy commits; fixes Flash-only ownership so
  Main Dial OFF remains authoritative.
- `45ff739`: initial preserved Watch-player discovery/poster/reveal foundation.
- `8b746f1` (`sacred-active-watch-main-blur-2026-08-26`): strongest preserved
  Watch-player line, adding identity, frame/native snapshot sampling, ownership,
  reveal, bounded retries, and tests.

## 9. Flash Shield donor recommendation

Use `1c6c581` as the feature donor and `745837a` as a mandatory semantic correction
reference. Do not cherry-pick either: relative to SACRED100 they modify hundreds of
lines in `src/lib/webview-injection-script.ts`, host/UI settings, historical docs,
and remove three SACRED100 recovery tests. Manually port the smallest Flash-only
units: bootstrap configuration, bounded veil creation/release, transition
listeners/timer cleanup, and tests. Preserve SACRED100 reveal, positive ownership,
cleanup, and live rearm code. Threatened sacred areas include reveal sweeps,
Shorts cleanup, Main Dial OFF/ON, mutation scheduling, and performance.

## 10. Active Shorts donor recommendation

Use the combined behavior evidenced by `1c6c581` plus the ownership correction at
`745837a`; earlier sealed checkpoints `323499d`, `b240e8d`, `d6c26b9`, and
`ad380b2` are useful to isolate individual changes. Reimplement/manual-port against
SACRED100 after Flash Shield is frozen. Likely units include
`ensureFlashShieldShortsTransitionOverlay`,
`armFlashShieldShortsTransitionVeil`,
`releaseFlashShieldShortsTransitionVeil`, transition intent listeners, active
Shorts veil identity/handoff, and their bounded cleanup tests. Do not replace
SACRED100 reveal ownership, sovereign navigation, overlay sweep scope, main-surface
healing, or OFF-to-ON recovery. A broad cherry-pick is rejected.

## 11. Player-protection donor recommendation

Use `8b746f1` as the strongest donor, with `45ff739` as the smaller foundation and
rollback comparison. Manually stage it after Active Shorts freezes: first routed
Watch discovery and bootstrap marking; then canonical poster/frame classification;
then identity-bound blur/reveal handoff; finally bounded playback/native-snapshot
sampling only if device evidence requires it. Likely units are
`getCurrentWatchVideoId`, `isFlashShieldWatchPlayerVideo`,
`markFlashShieldWatchPlayerCandidates`, `resolveWatchRevealOverlayAnchor`,
`scanWatchPlayerMedia`, `finalizeWatchPlayerPositiveHandoff`,
`finalizeWatchPlayerSafeHandoff`, playback retry/cleanup functions, host
`getYouTubeWatchId`, and snapshot-message handling. Dependencies include
`NativeWebViewBrowser.tsx`, a native snapshot facility/patch script, harness work,
and Watch tests. It directly threatens reveal anchoring, host lifecycle, timer
bounds, route identity, performance, and frozen injection code; cherry-pick is
rejected.

## 12. Regression threats

Highest risks are donor removal of SACRED100 recovery tests/logic, Flash-only
results acquiring Main Blur ownership, broad Shorts overlay cleanup contaminating
Home, stale Watch identities surviving route changes, duplicate reveal controls,
unbounded transition/playback timers, observer stacking, first-paint white/clear
flashes, and scroll/frame-capture load. Later docs must not overwrite the control.

## 13. Proposed integration order

1. Device-verify SACRED100 and capture a signed QA matrix.
2. Manually acquire Flash Shield only; full regression/device gate; checkpoint.
3. Freeze accepted Flash Shield behavior.
4. Manually acquire Active Shorts only; full regression/device gate; checkpoint.
5. Freeze accepted Active Shorts behavior.
6. Acquire Watch-player protection in staged slices; full regression/device gate.
7. Apply only required native-feeling loading/UI polish.
8. Run final long-session/full-surface QA and freeze an MVP candidate.

## 14. Phase 0 to MVP roadmap

### Must have for MVP

1. Close verification gaps for every required surface/lifecycle and the Main Dial.
2. Flash Shield with bounded safe/positive handoff and no residue.
3. Active Shorts entry, swipe, reveal, exit, and re-entry without Home corruption.
4. Actual Watch-player/poster/video protection with exact reveal ownership.
5. Only loading/UI polish needed to prevent persistent white screens, visible
   unprotected flashes, blocked taps, or manual wake-up.

### Should have

- Reproducible QA fixtures and diagnostic capture that do not create runtime loops.
- CI enforcement of the SACRED100 comparison and protected-region disclosure.
- Performance budgets for sustained scroll, navigation, and frame sampling.

### Post-MVP

- Broad classifier retuning, expanded non-YouTube coverage, product features,
  analytics, and cosmetic redesign not required by the Phase 0 contract.

## 15. Git checkpoint/freeze strategy

Commit these documents on the integration branch without touching product code.
For each subsystem create a branch from the last accepted checkpoint, make small
reviewable commits, record SACRED100/previous-checkpoint diffs, require automated
plus device QA, then tag an immutable accepted checkpoint. Never advance or reuse
`SACRED100`; retain it as the rollback control. Suggested names:
`checkpoint/sacred100-doc-control`, `freeze/sacred100-flash-v1`,
`freeze/sacred100-active-shorts-v1`, and `mvp/sacred100-phase0-rc1`.

## 16. Normally forbidden files/functions

Without an explicit freeze override, agents should not change:

- `src/lib/webview-injection-script.ts`, especially all reveal creation/routing,
  `diagNonShortsReattach`, `isMvpBlurAuthorized`, card item-key/ownership/style
  functions, Shorts target/reattach/nav/reentry/first-entry functions, cleanup,
  scheduling, and Main Dial mode application.
- `src/components/browser/NativeWebViewBrowser.tsx` and
  `src/hooks/useNativeWebView.ts`, especially injection and host-context lifecycle.
- `src/lib/injection-readiness.ts` and mode/settings plumbing where readiness or
  OFF/ON authority can change.
- `src/test/stability/` tripwires: do not delete, weaken, skip, or rewrite them to
  fit donor behavior.
- `AGENTS.md`, `FROZEN.md`, `SACRED100_MVP_DIRECTIVE.md`, and this report except
  for an explicit, evidence-backed control-document update.

The correct strategy is additive adapters and surgical ports around sacred code.
If the only apparent path requires replacing these areas wholesale, reject it and
redesign the acquisition.
