# BloomGuard Phase 0 MVP Context

Last updated: 2026-08-04

## User Goal

Push BloomGuard / Miracle Worker to a reliable Phase 0 MVP before adding new product scope.

Core MVP rule from AGENTS.md:

- A positive item gets a stable blur with a working tap-to-reveal button.
- A negative item stays clean.
- This must survive YouTube lifecycle churn.

## Sacred Baseline Discipline

Do not contaminate existing sacred tags or rollback commits.

Current protected source baseline from AGENTS.md:

- tag: `phase0-behavior-freeze-2026-07-09`
- commit: `7e576a30c64fd06b85ceb5914064ac8a57157a29`
- source tag: `mvp.333tUOFF`

Recent user-selected rollback baseline:

- tag: `phase0-active-shorts-feed-dampener-2026-07-29`
- commit: `5044f0fbc35e32f9bdcd3a9b667b5ad706149cdf`

Safe audit worktree for the current MVP lock work:

- path: `/Users/codygroves/cleanrooms/mw1111-phase0-feed-dampener-mvp-audit-20260803`
- branch: `work/phase0-feed-dampener-mvp-audit-20260803`

Edits should happen in the safe audit worktree unless the user explicitly asks to modify another worktree.

## Current Update

New sacred tag:

- tag: `sacred-phase0-flashshield-active-shorts-stable-2026-08-04`
- commit: tag target
- base: `phase0-active-shorts-feed-dampener-2026-07-29` / `5044f0fbc35e32f9bdcd3a9b667b5ad706149cdf`

Problem observed by user:

- Flash Shield / preblur in active Shorts oscillated: it would preblur, release, then reappear during the same active Short.

Expected active Shorts Flash Shield behavior:

- Preblur immediately on active Shorts entry or true new/unknown Short transition.
- Drop after AI safe/timeout-safe verdict.
- Stay down for that same Short through normal YouTube poster/src/player churn.
- Hand off to hard blur plus reveal for positives.
- Respect the Flash Shield toggle: Off removes active Shorts dampener and prevents reapplication; On restores governed preblur.

Implemented fix:

- `src/lib/webview-injection-script.ts`
  - `isFlashShieldStrongShortsIdentity` now treats a real `/shorts/{id}` URL id as a strong identity.
  - This prevents same-Short safe verdicts from being wiped and re-veiled just because the active video node lacks `data-video-id` or its poster/src changes.

Added tests:

- `src/test/stability/shorts-veil-release.test.ts`
  - live Flash Shield toggle removes/restores active Shorts dampening.
  - same-URL poster churn after safe release does not re-veil active Shorts.
  - unknown-URL poster swap still gets a fresh bounded dampener.

## Verification

Automated:

- Focused Flash Shield suite passed:
  - `3` files passed
  - `28` tests passed
- Full golden suite passed:
  - `23` files passed
  - `158` tests passed

Simulator:

- Built from the safe audit worktree.
- Synced Capacitor iOS assets.
- Built with fresh derived data path: `build/sim-dd-flashshield-audit`.
- Uninstalled existing app from simulator.
- Installed and launched fresh on:
  - device: `iPhone 17 Pro Max`
  - UDID: `FBE187B0-097D-4F4C-BA99-121888E1FC10`
  - bundle id: `bet.goodcreation.miracleworker`

## MVP Next Steps

1. Manual QA the active Shorts Flash Shield fix on device:
   - enter active Shorts
   - wait for safe verdict release
   - observe no same-Short oscillation during playback/poster churn
   - swipe to new Short and confirm preblur appears once
   - toggle Flash Shield Off and confirm all Flash Shield dampening is removed
   - toggle Flash Shield On and confirm preblur returns only when governed

2. Manual QA required AGENTS.md surfaces:
   - YouTube home feed
   - search results
   - watch-page recommendations
   - home Shorts shelf thumbnails
   - results Shorts shelf thumbnails
   - Shorts poster thumbnails
   - active Shorts player/poster
   - profile/channel-origin Shorts
   - refresh
   - background/foreground
   - Off -> On
   - Balanced / Moderate / Strict / Maximum mode changes

3. If manual QA passes, freeze the Flash Shield active Shorts behavior.

4. Remaining MVP polish targets after this lock:
   - test-only coverage for Shorts shelf reveal tap not navigating/freezing
   - profile/channel-origin Shorts manual pass
   - final long-session/lifecycle pass
   - tag final MVP release candidate

## Protected Areas

Do not modify these unless there is a reproducible MVP blocker and a rollback plan:

- Flash Shield active Shorts identity/release:
  - `isFlashShieldStrongShortsIdentity`
  - `getFlashShieldShortsIdentity`
  - `getFlashShieldActiveDampenerIdentity`
  - `markFlashShieldShortsCandidate`
  - `clearFlashShieldResolution`
  - `armShortsVeilTimeout`
  - `startFlashShieldRuntime`
  - `disableFlashShieldRuntime`
  - `window.__MW_FLASH_SHIELD_SET__`

- Sacred reveal/blur behavior from FROZEN.md:
  - `createRevealOverlay`
  - `ensureRevealTapInterceptor`
  - `isMvpBlurAuthorized`
  - `applyBlur`
  - active Shorts blur/reveal pairing functions

## Update Rule

After every successful update, append:

- date
- branch/worktree
- exact behavior changed
- files touched
- tests run
- simulator/manual QA result
- new sacred tag if created
- remaining MVP risks

## Update: 2026-08-04 Active Shorts Early Bootstrap Arm

Branch/worktree:

- `/Users/codygroves/cleanrooms/mw1111-phase0-feed-dampener-mvp-audit-20260803`
- `work/phase0-feed-dampener-mvp-audit-20260803`

Behavior changed:

- Pushed the previous sacred stable build to GitHub before patching:
  - branch: `origin/work/phase0-feed-dampener-mvp-audit-20260803`
  - tag: `sacred-phase0-flashshield-active-shorts-stable-2026-08-04`
- Added an active-Shorts-only host bootstrap arm so Flash Shield can preveil the active Shorts player earlier on existing host lifecycle events:
  - `onLoadStart`
  - pure `/shorts/...` URL change
  - pure `/shorts/...` first-entry/open recovery
  - Flash Shield live toggle On while already in pure active Shorts
- Mirrored the runtime Shorts identity rule into the bootstrap copy: a real `/shorts/{id}` URL identity remains strong even when YouTube has not populated node ids.

Files touched:

- `src/components/browser/NativeWebViewBrowser.tsx`
- `src/lib/webview-injection-script.ts`
- `src/test/flash-shield.golden.test.ts`
- `context.md`

Tests run:

- Focused Flash Shield/Shorts suite:
  - `./node_modules/.bin/vitest run --config vitest.stability.config.ts src/test/flash-shield.golden.test.ts src/test/stability/shorts-veil-release.test.ts src/test/stability/shorts-veil-memory.test.ts src/test/stability/shorts-veil-identity.test.ts`
  - passed: `4` files, `38` tests
- Full golden suite:
  - `npm run test:golden`
  - passed: `23` files, `160` tests
- Production build:
  - `npm run build`
  - passed; emitted existing large-chunk/Browserslist warnings only.

Simulator/manual QA:

- Built from fresh derived data path: `build/sim-dd-flashshield-bootstrap`.
- Synced Capacitor iOS assets.
- Uninstalled existing simulator app, installed the newly built app, and launched fresh on:
  - device: `iPhone 17 Pro Max`
  - UDID: `FBE187B0-097D-4F4C-BA99-121888E1FC10`
  - bundle id: `bet.goodcreation.miracleworker`
- Launch screenshot captured at `/private/tmp/mw-flashshield-bootstrap-launch.png`.
- Result: app rendered the BloomGuard home screen after fresh install; no launch freeze observed.

Remaining MVP risks:

- This patch improves active Shorts timing inside the existing host injection architecture, but it is not true native document-start prepaint protection.
- The active bootstrap arm is intentionally limited to pure `/shorts/...` routes. Profile/channel-origin Shorts should be handled in a separate measured patch if manual QA shows flashes there.
- Need fresh simulator install and active Shorts manual QA for freeze eligibility.

## Update: 2026-08-05 Critical Active Shorts Entry Recovery

Branch/worktree:

- `/Users/codygroves/cleanrooms/mw1111-phase0-feed-dampener-mvp-audit-20260803`
- `work/phase0-feed-dampener-mvp-audit-20260803`

Problem:

- User reported that active Shorts could no longer open; tapping a Shorts thumbnail froze the system.

Root cause / recovery decision:

- The only active-Shorts-entry functional delta after the sacred tag `sacred-phase0-flashshield-active-shorts-stable-2026-08-04` was host-side execution of `generateFlashShieldBootstrap(true)` during Shorts navigation events.
- That extra host `executeScript` work ran before/around the existing teardown and full moderation injection path, creating a high-risk route-entry race.
- Recovery removes the host-side bootstrap arming and restores `NativeWebViewBrowser.tsx` to the sacred active Shorts entry flow.

Files touched:

- `src/components/browser/NativeWebViewBrowser.tsx`
- `src/test/flash-shield.golden.test.ts`
- `context.md`

Validation:

- Focused active Shorts recovery suite passed:
  - `4` files, `43` tests
- Full golden suite passed:
  - `23` files, `160` tests
- Production build passed:
  - `npm run build`
  - existing Browserslist and chunk-size warnings only.

Remaining risk:

- Simulator active Shorts manual QA still required after installing the recovered build.
- Do not reintroduce host-side document-start/bootstrap arming on Shorts route handlers unless there is a measured implementation that cannot freeze the WebView.

## Update: 2026-08-05 Active Shorts Neighbor Preblur Timing

Branch/worktree:

- `/Users/codygroves/cleanrooms/mw1111-phase0-feed-dampener-mvp-audit-20260803`
- `work/phase0-feed-dampener-mvp-audit-20260803`

Problem:

- User confirmed active Shorts entry is working again, but the next Short can briefly flash visible during swipe because adjacent/preloaded Shorts are not always covered by preblur in time.

Root cause / patch decision:

- The active Shorts neighbor veil was allowed to mark an unresolved adjacent Short as `timeout-safe` after its bounded timeout.
- A `timeout-safe` neighbor is not a classifier-safe or user-revealed verdict; it is only a fail-open release.
- If the user lingered on the current Short, the next preloaded Short could become visually clean before it slid into view, creating the reported flash.
- The host/WebView bootstrap path remains untouched because it caused the prior active Shorts entry freeze.

Behavior changed:

- `markFlashShieldNeighborShortsCandidates` now treats `timeout-safe` adjacent Shorts as re-armable while they are still previous/next swipe candidates.
- Real `safe`, `revealed`, and `blurred` verdicts still block neighbor re-veiling.
- The Flash Shield stylesheet now also blurs descendant `video` and `img` inside `[data-mw-neighbor-veil="1"]` frames, so frame-level neighbor coverage is backed by direct media blur if an overlay clips or misses during YouTube swipe layout.

Files touched:

- `src/lib/webview-injection-script.ts`
- `src/test/stability/shorts-neighbor-preveil.test.ts`
- `context.md`

Validation:

- Focused active Shorts / Flash Shield suite passed:
  - `3` files, `38` tests
- Full golden suite passed:
  - `23` files, `162` tests
- Frozen guard passed:
  - `node scripts/check-frozen.mjs`
  - frozen file touched: `src/lib/webview-injection-script.ts`
- Production build passed:
  - `npm run build`
  - existing Browserslist and chunk-size warnings only.
- Simulator:
  - Synced Capacitor iOS assets after production build.
  - Built from fresh derived data path: `build/sim-dd-active-shorts-neighbor-preblur`.
  - Uninstalled existing simulator app, installed the newly built app, and launched fresh on:
    - device: `iPhone 17 Pro Max`
    - UDID: `FBE187B0-097D-4F4C-BA99-121888E1FC10`
    - bundle id: `bet.goodcreation.miracleworker`
  - Launch screenshot captured at `/private/tmp/mw-active-shorts-neighbor-preblur-launch.png`.
  - Result: BloomGuard home screen rendered after fresh install; no launch freeze observed.

Remaining risk:

- Simulator active Shorts manual QA is still required for real swipe timing, especially rapid next/previous swipes after lingering on a Short.
- This does not claim true native document-start prepaint coverage; it is a runtime-only active Shorts neighbor coverage patch.
- Do not alter host-side Shorts route injection for this issue unless this runtime fix fails manual QA.
