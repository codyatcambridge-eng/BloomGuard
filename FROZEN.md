# FROZEN — Phase 0 Lifecycle + Blur Stability Lock

**Active freeze tag:** `phase0-mvp-lifecycle-2026-07-15`  
**Active freeze commit:** `2a6d9c23daddd519db8d8133c2623b0a99c79ed5`  
**Stack markers:** `nosoft` + `p0off` (on top of orphanfix / partial2 / sacc / rev2 / life2)  
**Prior sacred tag (still honored):** `mvp-sacred-2026-06-04`  
**Prior phase0 tag (superseded for lifecycle tip):** `phase0-behavior-freeze-2026-07-09` @ `7e576a30`

These systems are **Phase 0 MVP-ready for blur stability and YouTube lifecycle**.  
The default answer to "should I edit this?" is **NO — escalate instead.**

> Any change to a file or function listed below requires ALL of:
> 1. a `FREEZE-OVERRIDE: <reason>` line in the commit body,
> 2. golden suite green: `npx vitest run --config vitest.stability.config.ts`,
> 3. device QA on the sacred lifecycle matrix (below),
> 4. comparison against tag `phase0-mvp-lifecycle-2026-07-15`,
> 5. rollback instructions in the PR/commit notes.
>
> A change that un-blurs a positive unintentionally, drops a reveal button, reintroduces
> soft partial blur on YouTube, orphans blur after Shorts enter/exit, or breaks
> Off→On / refresh recovery is an **automatic reject** regardless of override.

---

## What this freeze guarantees

User-facing contracts (do not regress):

1. **Positive stability** — hard-blurred positives hold until intentional Reveal of that identity.
2. **Reveal pairing** — every hard blur has a working Reveal path (button or interceptor).
3. **Negative safety** — safe content stays clean (no stale positive ownership).
4. **No soft partial blur on YouTube** — no reveal-less soft preblur fog on home/results/watch/exit.
5. **Shorts enter/exit lifecycle** — enter does not strip main-surface Reveals; exit does not leave partial filter/soft residue or white frost.
6. **Refresh / SPA recovery** — protection returns without manual search-bar wake-up.
7. **Dial live retune** — host/page dial updates thr and resamples without killing inject (happy path).
8. **Off → On** — Off cleans blur/reveal; turning protection back on restores scanning (P0 re-arm).

## Explicitly NOT frozen (allowed on new branches)

- Classifier **accuracy** thresholds / FP-FN tuning (must not break the contracts above).
- Flash Shield aesthetic polish (veil timing/identity) — must not break hard blur+reveal or exit.
- New surfaces outside AGENTS required set.
- UI chrome unrelated to blur ownership.

---

## Sacred behaviors (must never regress)

### From original sacred wall
1. **Tap-to-reveal works on all pages** — every hard-blurred item gets a reveal path; tap clears that identity; survives DOM recycling.
2. **Positive thumbnail stability** — classified-positive home thumbs stay blurred through hover, recycle, SPA.
3. **Active Shorts isolation** — active player blur does not contaminate shelf/main feed; swipe does not inherit prior reveal keys.

### Phase 0 lifecycle addendum (this freeze)
4. **YouTube soft preblur ban** — `shouldSkipSoftPreblur` keeps soft off on YouTube/Shorts; hard+reveal only.
5. **Exit partial scrub** — `scrubPartialBlurAfterShortsExit` + host multipass clear soft/filter residue after Active Shorts.
6. **Enter-Shorts reveal scope** — overlay sweeps are shell/portal-scoped; never document-wide strip of main Reveals.
7. **Reveal identity keys** — `isRevealedForSource` requires scope-key match (rev2); no sticky reveal across Shorts swipe.
8. **Off re-arm** — dial/host On after Off clears `offModeVisualCleanupActive`, restarts timers, resumes inject.

---

## Frozen functions — `src/lib/webview-injection-script.ts`

### Reveal (sacred — original)
- `createRevealOverlay`
- `ensureRevealTapInterceptor`
- `ensureRevealDocClickCapture`
- `enforceRevealOverlayVisibilityGuard`
- `setRevealOverlayAnchorTarget` / `resolveRevealOverlayAnchorTarget`
- `findRevealOverlayForElement`
- `positionNonShortsRevealOverlay` / `positionShortsRevealOverlay`
- Reveal button `click` / `touchstart` / `touchend` + liveElement stale-closure guard

### Positive stability (sacred — original)
- `diagNonShortsReattach`
- `isMvpBlurAuthorized`
- `getMvpCardHrefItemKey`
- `applyOwnedPositiveCardClass` / `applyOwnedSafeCardClass`
- `reapplyOwnedContainerBlur`
- `rememberNonShortsReattachContext` / `findNonShortsReattachContextByItemKey`
- `ensureOwnedCardStyle`

### Active Shorts (sacred — original + lifecycle)
- `resolveShortsStableBlurTarget`
- `maybeReattachShortsBlurForVideoNode`
- `getSovereignNavToken`
- `refreshShortsFreshnessOnReentry`
- `forceFirstEntryModerationRequest`
- Shorts blur-context family + epoch + legacy-fallback probes
- `isRevealedForSource` / `markRevealedForSource` / swipe stale-key clear (rev2)

### Lifecycle / exit / soft ban (sacred — Phase 0 tip)
- `shouldSkipSoftPreblur` / `isSoftPreblurSuppressed` / `suppressSoftPreblur`
- `clearMainFeedSoftPreblurResidue`
- `scrubPartialBlurAfterShortsExit`
- `performShortsExitSurfaceCleanup`
- `enforceMainSurfaceBlurRevealInvariant`
- `healNonShortsHardPositiveMissingReveals` / `forceCreateRevealForHardPositive` / `repairNonShortsBlurRevealInvariant`
- `applySoftBlur` early-return path that honors soft ban on YouTube
- Mode transition overlay sweep scope (Shorts shell / portal mode only — orphanfix)

### Dial / Off re-arm (sacred — P0)
- `applySensitivityLevel` Off cleanup + On re-arm latch/timer restart
- `reevaluateStampedNodesForDial` (behavior: host Shorts stamps kept; weak dial-only may release)
- `window.__MW_APPLY_SENSITIVITY__`
- `window.__MW_RESUME_AFTER_REINJECT__`
- `window.__MW_OFF_MODE_CLEANUP__` contract (cleanup + optional teardown)
- `ensureSensitivityToggle` durability (documentElement re-seat)
- `isVisualModerationActive` / `offModeVisualCleanupActive` semantics
- `startManagedTimers` / teardown re-arm (`teardownDone` clear on On only)

### Blur apply (sacred ownership)
- `applyBlur` (hard blur + reveal create path)
- `clearAllBlurAndOverlay` when used for safe/reveal clears
- `removeBlur` Shorts C2c same-src residue clear

---

## Frozen host contract — `src/components/browser/NativeWebViewBrowser.tsx`

- `injectModerationScript` epoch/nav handshake
- `onLoadStart` / `onLoadEnd` / URL change reinject wiring
- Active Shorts **exit multipass** (`__MW_SHORTS_EXIT_CLEANUP__` / `__MW_HOME_FEED_HEAL__` at 0 / 400 / 1000 / 1500 / 2500 / 5000 ms)
- Live dial push (`__MW_APPLY_SENSITIVITY__` / thr cache clear on `blur_dial` change)
- Off / protection-off cleanup hooks (`__MW_OFF_MODE_CLEANUP__`)
- `__MW_SYNC_HOST_CONTEXT__` contract

## Frozen host contract — `src/hooks/useNativeWebView.ts`
- Injection lifecycle hooks tied to readiness (no silent ready when inject dead)

> Cold-start driver loops remain modifiable **only** if they do not weaken exit scrub,
> nosoft soft ban, reveal pairing, or Off→On re-arm.

---

## Regression suite (tripwire)

```bash
npx vitest run --config vitest.stability.config.ts
# or
npm run test:golden
```

Minimum suite that must stay green for lifecycle freeze:

- `mvp-sacred-reveal.golden.test.ts`
- `positive-continuity.test.ts`
- `negative-isolation.test.ts`
- `shorts-contamination.test.ts`
- `shorts-exit-invariant-repair.test.ts`
- `blur-reveal-orphan-surfaces.test.ts`
- `active-shorts-reveal-recycle.test.ts`
- `off-mode-cleanup.test.ts` (includes P0 dial re-enable)
- `cold-start-exit-heal.test.ts` / lifecycle soft clear tests
- href-key / card-selector / stale-href guards

**Red suite = not done. Do not ship lifecycle edits with red golden suite.**

---

## Device matrix (must re-pass after any FREEZE-OVERRIDE)

- [ ] Home positives hold blur + Reveal; negatives clean  
- [ ] Results / watch recs same  
- [ ] Refresh recovers blur without search-bar wake  
- [ ] Active Shorts entry / swipe / reveal / exit  
- [ ] Exit → no top-row partial soft/filter fog  
- [ ] Enter Shorts does not strip home/results Reveal  
- [ ] Dial Strict/Relaxed retunes without killing inject  
- [ ] Off clears; On restores blur + 🛡 toggle  
- [ ] Background/foreground does not drop positives  

---

## Known residual risks (do not “fix” by rewriting frozen lifecycle)

| Residual | Policy |
|----------|--------|
| Active Shorts classifier FPs/FNs | **Accuracy branch only** — no exit/nosoft rewrites |
| Dial change during first-entry Shorts edge glitches | Accuracy/sample branch; preserve reeval host-keep rules |
| Flash Shield aesthetic / veil timing | Flash branch only; never reintroduce soft partial on main surfaces |
| Maximum thr aggressive (0.15/0.25) | Optional thr branch after freeze |

---

## Protected-region guard

```bash
node scripts/check-frozen.mjs
node scripts/check-frozen.mjs --range phase0-mvp-lifecycle-2026-07-15..HEAD
npm run check:frozen
npm run test:golden
```

Fails if a frozen **file** is modified without `FREEZE-OVERRIDE:` in the latest commit message.

Frozen files (keep in sync with `scripts/check-frozen.mjs`):

- `src/lib/webview-injection-script.ts`
- `src/components/browser/NativeWebViewBrowser.tsx`
- `src/hooks/useNativeWebView.ts`

---

## Rollback

```bash
git checkout phase0-mvp-lifecycle-2026-07-15
# or
git reset --hard 2a6d9c23daddd519db8d8133c2623b0a99c79ed5
```

This tip is the **behavior rollback point** for blur + lifecycle stability.  
It is **not** a claim that classifier accuracy or Flash Shield polish are complete.

---

## Architect rule for future agents

1. Prefer a new branch from `phase0-mvp-lifecycle-2026-07-15`.  
2. One bug → one patch → golden suite → device matrix rows above.  
3. Never stack veil + Off + accuracy + exit in one commit.  
4. If a fix needs to touch a frozen function, write FREEZE-OVERRIDE and list every sacred name touched.  
5. If stability and accuracy conflict, **stability wins** until a separate accuracy freeze is declared.
