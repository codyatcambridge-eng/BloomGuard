# FROZEN — MVP Sacred Systems

**Baseline tag:** `mvp-sacred-2026-06-04`

These systems are **MVP-ready and working**. They are FROZEN. The default answer to
"should I edit this?" is **NO — escalate instead.**

> Any change to a function/file listed below requires BOTH:
> 1. a `FREEZE-OVERRIDE: <reason>` line in the commit body, and
> 2. QA sign-off (the golden suite green + a device pass on the sacred behaviors).
>
> A change that un-blurs a positive, drops a reveal button, or destabilizes active
> Shorts is an automatic reject regardless of override.

## Sacred behaviors (must never regress)

1. **Tap-to-reveal works on all pages** — every blurred thumbnail gets a reveal button;
   tapping it clears the blur; the button survives DOM recycling (stale-closure guard).
2. **Positive thumbnail stability** — a classified-positive home-feed thumbnail stays
   blurred through hover/style mutation, card recycling, and SPA navigation.
3. **Active Shorts** — blur on the active short is correct through entry/exit, with no
   cross-contamination from the shelf or main feed.

## Frozen functions — `src/lib/webview-injection-script.ts`

### Reveal (sacred)
- `createRevealOverlay` — builds `.mw-reveal-overlay` + `.mw-reveal-btn`, binds tap handlers.
- `ensureRevealTapInterceptor` — document-level geometric tap interceptor.
- `ensureRevealDocClickCapture` — capture-phase click routing to the button.
- `enforceRevealOverlayVisibilityGuard` — overlay scope/identity guard + recovery.
- `setRevealOverlayAnchorTarget` / `resolveRevealOverlayAnchorTarget` — live-anchor tracking.
- `findRevealOverlayForElement` — overlay lookup by element/src.
- `positionNonShortsRevealOverlay` / `positionShortsRevealOverlay` — overlay placement.
- The `.mw-reveal-btn` `click` / `touchstart` / `touchend` handlers and the `liveElement`
  resolution inside `createRevealOverlay` (the stale-closure guard).

### Positive stability (sacred)
- `diagNonShortsReattach` — the blur maintenance / heal pipeline for non-Shorts cards.
- `isMvpBlurAuthorized` — the blur authorization gate (negative-content protection).
- `getMvpCardHrefItemKey` — card href → item-key resolution.
- `applyOwnedPositiveCardClass` / `applyOwnedSafeCardClass` — card ownership CSS.
- `reapplyOwnedContainerBlur` — owned-card blur reapplication.
- `rememberNonShortsReattachContext` / `findNonShortsReattachContextByItemKey` — reattach ctx.
- `ensureOwnedCardStyle` — the owned-card stylesheet.

### Active Shorts (sacred)
- `resolveShortsStableBlurTarget` — stable blur target resolution for Shorts.
- `maybeReattachShortsBlurForVideoNode` — Shorts blur reattach on node swap.
- `getSovereignNavToken` — sovereign nav token (stale-request rejection).
- `refreshShortsFreshnessOnReentry` — Shorts reentry refresh.
- `forceFirstEntryModerationRequest` — first-entry latch.
- The Shorts blur-context family + epoch handling + legacy-fallback probes.

## Frozen host contract — `src/components/browser/NativeWebViewBrowser.tsx` / `src/hooks/useNativeWebView.ts`
- `injectModerationScript` — the epoch/nav host-context handshake.
- `onLoadStart` / `onLoadEnd` / `onUrlChange` lifecycle wiring.
- `__MW_SYNC_HOST_CONTEXT__` contract.

> Cold-start injection work (the `cold_start_injection_ensure` effect and the
> `ColdStartScan` / `ColdStartGuarantee` loops) is **WIP, not frozen** — it may be
> modified to fix the cold-start bug, but **without** altering the frozen functions above.

## Golden suite (the tripwire)

```
npx vitest run --config vitest.stability.config.ts
```

Locks the sacred behaviors:
- `src/test/stability/mvp-sacred-reveal.golden.test.ts` — reveal + stale-closure guard.
- `src/test/stability/positive-continuity.test.ts` — positive stays blurred.
- `src/test/stability/negative-isolation.test.ts` — negatives not over-blurred.
- `src/test/stability/shorts-contamination.test.ts` — Shorts isolation.
- `src/test/stability/stale-href-race.test.ts`, `href-key-extraction.test.ts`,
  `card-selector-coverage.test.ts` — key-resolution invariants.

**Every PR must keep this suite green.** Red suite = not done.

## Protected-region guard

```
node scripts/check-frozen.mjs            # checks staged/working diff vs HEAD
node scripts/check-frozen.mjs --range mvp-sacred-2026-06-04..HEAD
```

Exits non-zero if a diff touches a frozen file without `FREEZE-OVERRIDE:` in the latest
commit message. Recommended wiring (add manually to `package.json` scripts):

```json
"scripts": {
  "check:frozen": "node scripts/check-frozen.mjs",
  "test:golden": "vitest run --config vitest.stability.config.ts"
}
```

Recommended pre-commit / CI step: run `test:golden` then `check:frozen`.
