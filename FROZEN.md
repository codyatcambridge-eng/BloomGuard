# FROZEN — Positive Blur Stability Core (Strict Zero-Edit)

**Behavior tip (functional home):** `2a6d9c23daddd519db8d8133c2623b0a99c79ed5`  
**Behavior tag:** `phase0-behavior-nosoft-p0off-2a6d9c23`  
**Strict freeze seal tag:** `phase0-positive-blur-strict-freeze-2026-07-15`  
  (this seal commit = behavior tip + FROZEN banners + zero-edit tooling; **no functional runtime change**)  
**Stack:** nosoft + p0off (soft ban + Off→On re-arm) on prior orphanfix / partial2 / lifecycle base  

> **STRICT POLICY:** Zero edits forever to frozen files and frozen contracts.  
> **FREEZE-OVERRIDE is not accepted.**  
> Any future change that must touch frozen files requires: branch from the **seal tag** → minimal emergency patch → golden suite + device matrix → **new freeze tag**.  
> Do not keep editing the sealed tip in place.

This freeze protects **positive blur stability**, not full product Phase 0 completion.  
Known residuals (cold dial lag, cold raw positives until hard verdict, exit white-screen class, accuracy FP/FN, Flash polish) are **open tickets**, not license to edit frozen core.

---

## Absolute rule

```
A true freeze baseline means NEVER TOUCH the protected code again.
No refactoring, no small improvements, no moving functions, no renaming,
no comment-only cleanup inside frozen bodies, no FREEZE-OVERRIDE for convenience.
New work layers on top or extends through narrow, stable interfaces only.
```

---

## Frozen files (DO NOT EDIT)

| File | Role |
|------|------|
| `src/lib/webview-injection-script.ts` | Inject: hard blur, CSS ownership, reveal overlays/buttons, apply path, nosoft, Shorts isolation, exit ownership safety, Off re-arm contracts |
| `src/components/browser/NativeWebViewBrowser.tsx` | Host: inject handshake, load/url lifecycle that keeps blur/reveal alive, Shorts exit multipass hooks, ACK/epoch, dial *push plumbing* (not thr numbers) |
| `src/hooks/useNativeWebView.ts` | Capgo open/load/message bridge inject readiness depends on |

Each file starts with a **FROZEN banner**. Do not remove or weaken those banners.

---

## Frozen user contracts

1. **Positive hard blur holds** until intentional reveal of that content identity.  
2. **Every hard blur has a reveal path** (button and/or interceptor).  
3. **Negatives stay clean** (no stale ownership).  
4. **No soft partial blur on YouTube** (nosoft / `shouldSkipSoftPreblur`).  
5. **Surfaces:** home, results, watch recs, Shorts shelves, active Shorts — hold + reveal through lifecycle.  
6. **Active Shorts must not corrupt** home/results ownership/reveal.  
7. **Off → On re-arm** (p0off) restores scanning without rewriting thr tables.  
8. **No broad cleanup** that strips valid positive hard blur/reveal.

---

## Frozen function classes (bodies never edit)

### Visual hard blur + CSS ownership
- `applyBlur`
- `clearAllBlurAndOverlay` / ownership-safe clear paths
- `reapplyOwnedContainerBlur` (+ lifecycle reapply that restores owned blur)
- `applyOwnedPositiveCardClass` / `applyOwnedSafeCardClass`
- `ensureOwnedCardStyle`
- `isMvpBlurAuthorized` / `getMvpCardHrefItemKey`
- `diagNonShortsReattach` / reattach context remember/find
- Authoritative hard-blur stamps / ownership CSS enforcement

### Reveal system
- `createRevealOverlay` (entire body, stale-closure guards)
- `ensureRevealTapInterceptor` / `ensureRevealDocClickCapture`
- `enforceRevealOverlayVisibilityGuard`
- `setRevealOverlayAnchorTarget` / `resolveRevealOverlayAnchorTarget`
- `findRevealOverlayForElement`
- `positionNonShortsRevealOverlay` / `positionShortsRevealOverlay`
- Portal placement used by the above for non-Shorts reveals

### Soft ban (nosoft)
- `shouldSkipSoftPreblur`
- `applySoftBlur` early-return honoring YouTube ban
- `scrubPartialBlurAfterShortsExit` core (clear reveal-less soft/filter without killing owned hard positives)

### Decision path: positive → hard blur + reveal
- Path from classification/host decision into **`applyBlur` + reveal create**
- Must not be rewritten to “tune accuracy”; thr may only plug in via existing config bags without body rewrites

### Active Shorts isolation
- `resolveShortsStableBlurTarget`
- `maybeReattachShortsBlurForVideoNode`
- Shorts blur-context / epoch / sovereign token machinery
- Reveal identity key rules (no sticky reveal across swipe)

### Lifecycle that preserves positives (not all product lifecycle)
- Enter-Shorts: no document-wide strip of main-surface reveals
- Exit-Shorts: player/Flash residue clear **without** wiping main-surface owned hard positives
- `performShortsExitSurfaceCleanup` ownership-preserving steps
- Off re-arm latch semantics (`offModeVisualCleanupActive` clear on On)

### Host inject contracts
- Epoch/nav handshake used by inject
- `__MW_SYNC_HOST_CONTEXT__` contract meaning
- Wiring that inject is required for blur/reveal to exist

---

## Open work (allowed — outside frozen files)

| Lane | Allowed locations | Must not |
|------|-------------------|----------|
| **Accuracy** | Host decision / thr tables in **new or existing non-frozen modules** if injectable without editing frozen bodies; settings thr defaults that already flow as config | Edit `applyBlur` / reveal / ownership; re-enable soft preblur |
| **Blur dial / settings UI** | `useLocalSettings`, settings panels, `BlurShieldOverlay` labels/UX | Rewrite inject apply/reveal for dial |
| **Narrow initial page load** | Host-only cold-start **policy in non-frozen modules** when possible; if only possible inside frozen host files → **stop** and plan emergency freeze revision | Touch apply/reveal bodies; broad teardown of owned positives |
| **Flash polish** | Separate Flash helpers/settings if not rewriting frozen apply/reveal | Fix Flash by disabling nosoft or stripping reveals |

### Residual open tickets (track separately)
1. Cold open missing 🛡 / late inject  
2. Cold home raw positives until hard verdict  
3. Shorts exit white/stuck page  
4. Classifier FP/FN  

One branch per ticket **from this freeze tag**. Prove device. Optional new freeze tag after seal.

---

## Process (agents and humans)

### Default home
```bash
git switch --detach phase0-positive-blur-strict-freeze-2026-07-15
# behavior-only tip (no seal banners/docs):
git switch --detach phase0-behavior-nosoft-p0off-2a6d9c23
# branch for work:
git checkout -B work/from-freeze phase0-positive-blur-strict-freeze-2026-07-15
```

### Allowed feature work
```text
1. Branch FROM phase0-positive-blur-strict-freeze-2026-07-15 only
2. ONE feature (accuracy thr | dial UI | cold-load host policy outside frozen bodies)
3. Do NOT open frozen files
4. Run: npm run check:frozen && npm run test:golden
5. Device matrix for your lane
6. STOP — do not chain a second feature
```

### Emergency MVP blocker (only path that may touch frozen files)
1. Repro on seal tip.  
2. Branch from seal tag.  
3. Minimal patch.  
4. Golden suite green + full positive-blur device matrix.  
5. Human sign-off.  
6. **New freeze tag** becomes home.  
7. Document rollback to previous tag.

There is **no** `FREEZE-OVERRIDE:` escape hatch in `scripts/check-frozen.mjs`.

---

## Guard commands

```bash
# Working tree vs HEAD
node scripts/check-frozen.mjs
npm run check:frozen

# Any commit after strict freeze seal
node scripts/check-frozen.mjs --range phase0-positive-blur-strict-freeze-2026-07-15..HEAD

# Golden stability suite
npx vitest run --config vitest.stability.config.ts
npm run test:golden
```

**Red suite or frozen file touch = stop ship.**

---

## Frozen golden tests (do not weaken)

- `src/test/stability/mvp-sacred-reveal.golden.test.ts`
- `src/test/stability/positive-continuity.test.ts`
- `src/test/stability/negative-isolation.test.ts`
- `src/test/stability/shorts-contamination.test.ts`
- `src/test/stability/off-mode-cleanup.test.ts`
- href-key / card-selector / stale-href guards  
- related orphan / exit soft-clear tests present on this tip

---

## Device matrix (positive blur stability)

- [ ] Home / results / watch recs: positives hold hard blur + reveal  
- [ ] Negatives clean  
- [ ] Active Shorts enter / swipe / reveal / exit / re-enter without orphaning main surface  
- [ ] Exit Shorts: no soft partial fog; no strip of owned main positives  
- [ ] Off clears; On restores scan/blur path  
- [ ] Refresh / bg-fg does not permanently drop positives without recovery path  

---

## Rollback

```bash
git switch --detach phase0-positive-blur-strict-freeze-2026-07-15
# functional behavior tip only:
git switch --detach phase0-behavior-nosoft-p0off-2a6d9c23
# or
git reset --hard 2a6d9c23daddd519db8d8133c2623b0a99c79ed5
```

Then rebuild web + iOS artifacts from that tip only.

---

## What this freeze is / is not

| Is | Is not |
|----|--------|
| Immutable **Positive Blur Stability Core** | Claim that cold open / accuracy / Flash are done |
| nosoft + p0off behavior tip lock | License for post-freeze inject refactors |
| Zero-edit policy | Soft FREEZE-OVERRIDE culture |
