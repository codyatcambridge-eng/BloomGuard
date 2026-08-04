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
