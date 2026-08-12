# FROZEN — BloomGuard MVP Protected Baseline

## Purpose

`AGENTS.md` is the authoritative BloomGuard MVP product and engineering contract.

This file has a narrower purpose:

**FROZEN.md protects behavior that has already been demonstrated to work and must not regress while the remaining MVP is stabilized.**

It does NOT define new product behavior.

It does NOT override `AGENTS.md`.

It does NOT mean BloomGuard as a whole is MVP-ready.

A behavior may be frozen while other parts of the same system remain unfinished.

The operating rule is:

> Preserve proven behavior. Fix the smallest broken layer. Never destroy a working invariant to repair another feature.

---

# 1. AUTHORITY ORDER

When interpreting BloomGuard requirements:

1. `AGENTS.md` defines required product behavior.
2. `FROZEN.md` identifies already-proven implementation behavior that must be protected.
3. Reproducible device behavior is authoritative over assumptions.
4. Automated tests support validation but do not override broken real-device behavior.

If a frozen behavior conflicts with a newly and explicitly changed requirement in `AGENTS.md`, stop and report the conflict before changing implementation.

Do not silently reinterpret either contract.

---

# 2. FREEZE DOES NOT MEAN WHOLE MVP READY

The previous freeze language must not be interpreted as saying BloomGuard is complete.

Only the specific behaviors listed in this file are protected.

Unfinished work may still exist in:

* Phase 0 lifecycle stability
* Main Blur behavior on additional surfaces
* Main Dial persistence
* Flash Shield
* zero-flash protection
* video-player protection
* High-Velocity Scanning
* Tunnel Vision
* additional lifecycle recovery
* performance tuning
* classifier tuning

Follow the Phase 0 → Test → Freeze → Phase 1 order defined in `AGENTS.md`.

Do not use this file to skip an `AGENTS.md` acceptance gate.

---

# 3. SACRED CURRENT BEHAVIORS

The following behaviors have demonstrated value and must not regress while other MVP work continues.

## A. Reveal Integrity

For an item that Main Blur currently protects:

* a reveal control must exist
* the control must belong to the exact protected content
* tapping reveal must affect only that item
* DOM replacement must not create stale reveal ownership
* DOM recycling must not make a reveal control operate on different content
* duplicate reveal controls must not accumulate
* stale closures must not target replaced content

A patch that causes an existing working reveal path to disappear is a regression.

### Reveal identity rule

Reveal ownership follows stable content identity whenever reasonably possible, not raw DOM-node position.

For identity, prefer:

1. YouTube video ID / Shorts ID
2. canonical content href or stable YouTube identifier
3. stable media URL / relevant content metadata
4. DOM-instance identity only as a last resort

A genuinely different content identity must never inherit another item's reveal state.

DOM replacement of the SAME content identity must not cause accidental cross-item reveal behavior.

Do not turn reveal state into an uncontrolled permanent whitelist.

---

## B. Positive Continuity

Once the same content identity owns a valid positive classification:

**KEEP IT PROTECTED unless an intentional, valid state transition removes that protection.**

Do not remove an established positive merely because of:

* hover mutation
* CSS/style mutation
* DOM replacement
* card recycling
* lazy loading
* SPA navigation
* temporary classification failure
* model timeout
* missing image/frame
* uncertain rescan
* transient lifecycle disruption
* element replacement

A transient failure to classify is NOT equivalent to a negative classification.

Positive ownership may be removed only through a justified state transition such as:

* reliable safe/negative resolution under the established classifier rules
* intentional reveal where applicable
* actual content identity change
* Main Blur being turned OFF
* legitimate cleanup by the system that owns that exact protection

Never trade positive continuity for a speculative accuracy or lifecycle fix.

---

## C. Negative Isolation

Safe content must not inherit stale protection.

A negative item must not receive:

* stale positive ownership
* blur copied from recycled DOM
* stale reveal overlay
* stale Shorts ownership
* protection belonging to a previous card
* protection based solely on DOM position

Fixes to positive stability must preserve negative isolation.

A solution that makes positives more stable by broadly blurring safe content is rejected.

---

## D. Active Shorts Isolation

The working Active Shorts ownership/isolation behavior is sacred.

Maintain:

* correct ownership of the currently active Short
* no cross-contamination from Shorts shelves
* no contamination from Home/Search/Watch cards
* stable active-Short blur target resolution
* stale-request rejection
* safe entry/exit behavior
* re-entry freshness behavior
* first-entry moderation behavior where currently proven

Active Shorts remains governed by the same Main Blur / Detection state defined in `AGENTS.md`.

This freeze protects working Shorts behavior.

It does NOT mean all Active Shorts MVP requirements are automatically complete.

If additional Shorts lifecycle bugs remain reproducible, they may be fixed surgically without rewriting working sacred behavior.

---

# 4. CURRENTLY PROTECTED FUNCTIONS

## `src/lib/webview-injection-script.ts`

### Reveal — Protected

Protect the behavior of:

* `createRevealOverlay`
* `ensureRevealTapInterceptor`
* `ensureRevealDocClickCapture`
* `enforceRevealOverlayVisibilityGuard`
* `setRevealOverlayAnchorTarget`
* `resolveRevealOverlayAnchorTarget`
* `findRevealOverlayForElement`
* `positionNonShortsRevealOverlay`
* `positionShortsRevealOverlay`

Also protect the working:

* `.mw-reveal-btn` click behavior
* touch handling
* live-element resolution
* stale-closure defense
* exact-item reveal ownership

These may be modified only for a reproducible MVP bug requiring a surgical change.

Do not replace this subsystem merely to support another feature.

---

### Positive Continuity — Protected

Protect the working behavior of:

* `diagNonShortsReattach`
* `isMvpBlurAuthorized`
* `getMvpCardHrefItemKey`
* `applyOwnedPositiveCardClass`
* `applyOwnedSafeCardClass`
* `reapplyOwnedContainerBlur`
* `rememberNonShortsReattachContext`
* `findNonShortsReattachContextByItemKey`
* `ensureOwnedCardStyle`

The important invariant is behavior, not preservation of code for its own sake:

> positive ownership survives appropriate DOM churn while negative content remains clean.

Do not change these functions for unrelated feature work.

---

### Active Shorts — Protected

Protect the working behavior of:

* `resolveShortsStableBlurTarget`
* `maybeReattachShortsBlurForVideoNode`
* `getSovereignNavToken`
* `refreshShortsFreshnessOnReentry`
* `forceFirstEntryModerationRequest`

Also protect the currently functioning:

* Shorts blur-context ownership
* epoch/freshness handling
* stale-request rejection
* legacy fallback behavior that is still required for proven Shorts stability

Do not replace this with an independent Shorts blur engine.

Active Shorts must remain an extension of Main Blur / Detection as defined in `AGENTS.md`.

---

# 5. HOST LIFECYCLE CONTRACT

## `src/components/browser/NativeWebViewBrowser.tsx`

## `src/hooks/useNativeWebView.ts`

The working host-context relationship is protected where it supports sacred behavior.

Protect the established behavior of:

* `injectModerationScript`
* `onLoadStart`
* `onLoadEnd`
* `onUrlChange`
* `__MW_SYNC_HOST_CONTEXT__`
* nav/epoch synchronization required to reject stale work

However:

**Do not treat the entirety of lifecycle implementation as permanently frozen.**

`AGENTS.md` explicitly requires continued lifecycle stabilization during Phase 0.

Therefore:

* reproducible lifecycle bugs may be fixed
* unfinished cold-start behavior may be fixed
* background/foreground recovery may be fixed
* inactivity recovery may be fixed
* SPA navigation recovery may be fixed
* DOM replacement handling may be fixed

But such fixes must preserve the sacred reveal, positive continuity, negative isolation, and Active Shorts behavior above.

---

# 6. COLD START / RECOVERY STATUS

Cold-start and recovery mechanisms are NOT automatically frozen.

This includes, where applicable:

* `cold_start_injection_ensure`
* `ColdStartScan`
* `ColdStartGuarantee`
* related readiness/recovery mechanisms

They may be changed to satisfy Phase 0 lifecycle requirements.

But they must NOT:

* reset user settings
* create parallel blur engines
* remove valid positive ownership
* create stale blur
* break reveal
* break Active Shorts
* create permanent heartbeat loops
* stack observers
* create infinite retries
* fake readiness

Recovery must restore observation/protection behavior without changing what the user selected.

---

# 7. NO FALSE FREEZES

Do not freeze a feature merely because:

* code exists
* a test passes
* it worked once
* the old `FROZEN.md` called it ready
* a simulated test says it works

A feature becomes eligible for a new freeze only after its required `AGENTS.md` surfaces and lifecycle tests pass with credible evidence.

Follow the `FREEZE SIGNAL` process defined in `AGENTS.md`.

---

# 8. CHANGE POLICY FOR PROTECTED BEHAVIOR

The default answer to:

> "Should I modify a protected subsystem?"

is:

> **No, unless a reproducible MVP bug requires it.**

A protected change requires:

1. Identify the reproducible bug.
2. Identify the failing `AGENTS.md` invariant.
3. Explain why the protected code is the smallest responsible layer.
4. Make the smallest possible patch.
5. State which protected functions/files are touched.
6. Provide rollback instructions.
7. Run the relevant focused tests.
8. Run the complete golden regression suite.
9. Perform relevant real-device/manual verification.
10. Compare behavior against the frozen baseline.

Do not use a protected-system change as an opportunity for cleanup or refactoring.

---

# 9. FREEZE OVERRIDE

If the repository's existing freeze tooling requires a commit override, preserve this convention:

`FREEZE-OVERRIDE: <specific reproducible MVP reason>`

The reason must identify the actual bug or contract violation.

Bad:

`FREEZE-OVERRIDE: refactor`

Bad:

`FREEZE-OVERRIDE: improve code`

Good:

`FREEZE-OVERRIDE: same video identity loses positive ownership after YouTube card node replacement`

Good:

`FREEZE-OVERRIDE: reveal overlay resolves recycled node and reveals wrong content identity`

An override grants permission to attempt a surgical fix.

It does NOT waive regression requirements.

---

# 10. AUTOMATIC REJECTION CONDITIONS

Reject a patch if it causes any previously working behavior to:

* unblur a valid positive unexpectedly
* blur a safe item from stale ownership
* lose a reveal control
* create duplicate reveal controls
* reveal the wrong item
* transfer reveal state to recycled content
* break Active Shorts isolation
* allow shelf/feed ownership to contaminate Active Shorts
* reset a user setting
* turn Main Blur back on after the user selected OFF
* create observer stacking
* create unbounded scanning
* create lifecycle wake-up dependencies
* create stale overlays
* introduce a competing blur engine

A patch is not acceptable merely because another test becomes green.

---

# 11. GOLDEN REGRESSION SUITE

The current golden suite remains a tripwire:

```bash
npx vitest run --config vitest.stability.config.ts
```

Important existing tests include:

* `src/test/stability/mvp-sacred-reveal.golden.test.ts`
* `src/test/stability/positive-continuity.test.ts`
* `src/test/stability/negative-isolation.test.ts`
* `src/test/stability/shorts-contamination.test.ts`
* `src/test/stability/stale-href-race.test.ts`
* `src/test/stability/href-key-extraction.test.ts`
* `src/test/stability/card-selector-coverage.test.ts`

The suite protects existing behavior.

Passing it is necessary when touching protected behavior.

Passing it is NOT sufficient to declare MVP completion.

Manual/device behavior remains required by `AGENTS.md`.

---

# 12. PROTECTED REGION GUARD

Preserve existing freeze guard tooling where functional:

```bash
node scripts/check-frozen.mjs
```

and any supported baseline/range mode already implemented by the repository.

Do not invent a new baseline tag merely from this documentation change.

Do not assume the historical `mvp-sacred-2026-06-04` tag represents the current complete MVP baseline.

It may remain useful as historical reference if it exists in Git.

A future baseline/freeze tag should be created only after the relevant current behavior has been validated and intentionally frozen.

Recommended repository scripts remain conceptually:

```json
{
  "scripts": {
    "check:frozen": "node scripts/check-frozen.mjs",
    "test:golden": "vitest run --config vitest.stability.config.ts"
  }
}
```

Do not modify `package.json` during this documentation-only task unless I separately ask you to.

---

# 13. PERFORMANCE PROTECTION

A sacred-system fix must not create unacceptable performance regressions.

Reject a protected-system patch that introduces severe:

* feed scrolling lag
* Shorts swipe lag
* navigation stalls
* player-control interference
* repeated UI freezing
* runaway CPU work
* duplicate classification work
* observer/listener accumulation

Do not preserve performance by allowing known protected content to bypass protection.

Do not preserve protection by making YouTube unusable.

The implementation must satisfy both within reasonable MVP constraints.

---

# 14. DIAGNOSTICS ARE ALLOWED

Local/development-only diagnostics may be added when necessary to reproduce or validate an MVP bug.

Useful bounded diagnostics may include:

* discovered media
* resolved content identity
* classification queued
* classification completed
* positive result
* negative result
* positive ownership acquired
* ownership reattached
* reveal created
* reveal ownership
* stale identity rejected
* Shorts nav/epoch rejection
* active observer/listener counts
* queue depth
* Flash Shield → Main Blur handoff when Flash Shield work begins

Diagnostics must:

* be bounded
* avoid permanent console spam
* avoid altering product behavior
* not become cloud analytics
* not create timers/observers merely for instrumentation

---

# 15. RELATIONSHIP WITH FUTURE PHASE 0 FREEZE

The behaviors in this file are the current protected baseline.

When Phase 0 fully passes the `AGENTS.md` Phase 0 Test Gate:

1. issue the `FREEZE SIGNAL`
2. identify the exact tested surfaces
3. record evidence
4. identify remaining risks
5. identify protected functions/files
6. create an intentional current baseline tag/branch
7. update this file narrowly to reflect the newly validated Phase 0 freeze

Do not prematurely convert this file into a claim that Phase 0 has passed.

---

# 16. RELATIONSHIP WITH PHASE 1

After Phase 0 is frozen, Phase 1 features must integrate around it.

This includes:

* Flash Shield
* Video Player Protection
* High-Velocity Scanning
* Progressive Tunnel Vision

Phase 1 work must not casually rewrite the Phase 0 Main Blur engine.

If a Phase 1 feature requires interaction with protected behavior:

1. identify ownership boundaries
2. integrate through the smallest interface possible
3. keep feature state independent
4. rerun Phase 0 regression validation
5. reject the Phase 1 patch if it damages a higher-priority invariant

---

# 17. CENTRAL FROZEN RULE

`AGENTS.md` tells BloomGuard what it must become.

`FROZEN.md` protects what BloomGuard already does correctly.

Never confuse the two.

**Do not freeze unfinished behavior.**

**Do not rewrite proven behavior merely because adjacent behavior remains broken.**

Protect:

* reveal integrity
* positive continuity
* negative isolation
* Active Shorts isolation
* stable content identity ownership
* proven host lifecycle behavior

Allow surgical changes where reproducible MVP bugs require them.

Every change must move BloomGuard closer to the `AGENTS.md` contract without destroying behavior that already satisfies it.
