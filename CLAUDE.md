# Bloom Guard — Claude Code Team Charter

## Mission
Reach MVP on m.youtube.com homepage/feed: no positive blur drop, working tap-to-reveal, no negatives ever gaining blur.

## Core rules
All work follows AGENTS.md. That file is the contract — read it before every patch.

---

## Agent Roles

### Lead (Agent 1)
- Owns the overall MVP contract and patch sequencing.
- Reviews every diff before it merges. No patch merges through a conflict.
- Sole authority over `clearAllBlurAndOverlay` signature changes.
- Does NOT write code. Reviews and approves only.
- Enforces: one behavior at a time. No combo patches.

### Negative Purity Agent (Agent 2)
**Sole mandate:** Negatives never gain blur — not during transitions, scroll, node reuse, DOM churn.

Owns:
- `regularNuclearA` gate (~line 6236)
- `regularTerminalVetoUnknownIdentity` gate (~line 6691)
- Decontamination calls (~lines 5422, 8050)
- `strictUnknownButCardAuthoritative` adoption guard (~line 4697–4752) — requires `cardContextSrcMatchesLive` for ALL context node cases (self-referential AND sibling)
- Recycle decontamination path

Never touches: `regularShouldKeepBlur`, latch write, `createRevealOverlay`, Shorts paths.

Stop immediately if: any negative gains blur after patch.

### Positive Blur Persistence Agent (Agent 3)
**Sole mandate:** Positive items keep blur through every YouTube transition type.

Owns:
- `regularShouldKeepBlur` gate (~line 6685)
- `regularMainCardBlurLatch` read/write (~lines 3649–3679)
- `strictContinuityItemKey` adoption path (~lines 5059–5141)
- Non-Shorts transition reattach logic (`diagNonShortsReattach`)

Never touches: `regularNuclearA`, `regularTerminalVetoUnknownIdentity`, `createRevealOverlay`, Shorts active-playback paths.

Stop immediately if: any negative gains blur, or Shorts playback behavior changes.

### Reveal Button Agent (Agent 4)
**Sole mandate:** Tap-to-reveal overlay is present when and only when blur is correctly owned by a positive. Button must be tappable.

Owns:
- `createRevealOverlay` (~line 11229)
- `removeRevealOverlay` (~line 10252)
- `resolveNonShortsRevealOverlayParent` (~line 10205)
- `handleRevealActivation` (~line 11749)
- `enforceRevealOverlayVisibilityGuard` (~line 11917)
- Portal mounting (~line 9586)

Never touches: blur gate tree, latch system, Shorts reveal paths.

Rules:
- Reveal must not appear if `data-mw-moderated !== "blurred"` on target.
- Reveal must not appear on negatives under any condition.
- After reveal tap: clear blur AND overlay atomically.

### Regression Auditor (Agent 5) — PRIMARY YOUTUBE WATCHDOG
**Runs after every patch by any agent. Must complete full checklist before Lead approves next patch.**

Rescan checklist:
1. Positive retains blur: simulate `attr:src` change on blurred positive → blur stays.
2. Positive retains blur: simulate `mutation_added:descendant_video` → blur stays.
3. Positive retains blur: scroll away and back → blur re-applies.
4. Negative never gains blur: scroll negative away and back → no blur.
5. Negative never gains blur: load negative into node that previously held positive → no blur.
6. Reveal correct: blur present on positive → overlay visible and button tappable.
7. Reveal correct: blur absent (negative or cleared) → no overlay.
8. No duplicates: single blurred card → exactly one overlay.
9. No orphans: after `clearAllBlurAndOverlay` → no dangling overlay in portal.
10. Shorts non-regression: active Shorts playback unaffected.

**STOP ALL AGENTS immediately if:**
- Any negative gains blur.
- Shorts playback behavior changes.
- Reveal appears on non-blurred element.
- Duplicate overlay detected.
- MVP_ASSERT reports new failure not present before the patch.

### DOM Churn Auditor (Agent 6) — YOUTUBE CHURN WATCHDOG
After every patch:
- Grep changed gate for `src`/`style`/`class` attribute handling — YouTube churns all three on preview start.
- Verify `regularPathQuarantinePassed` is computed before any latch read/write.
- Check `strictContinuityItemKey` — no path may adopt `'unknown'` as a key.
- Confirm `cardContextSrcMatchesLive` is required for ALL `strictUnknownButCardAuthoritative` adoptions (not just self-referential). No sibling bypass path exists.
- Confirm `isHomeShortsShelfVideo` exclusion is in place in any new gate.
- Report to Lead: "CLEAN" or "CHURN RISK at [line/gate]".

---

## Patch Sequence (Lead enforces)
```
Phase 1:  Agent 2 (Negative Purity) patches.
Phase 2:  Agent 6 (DOM Churn Auditor) full rescan.
Phase 3:  Agent 5 (Regression Auditor) full checklist.
Phase 4:  Agent 3 (Positive Blur Persistence) patches.
Phase 5:  Agent 5 + Agent 6 full rescan.
Phase 6:  Agent 4 (Reveal Button) patches.
Phase 7:  Agent 5 + Agent 6 full rescan.
Phase 8:  Lead reviews all diffs for cross-gate conflicts.
```

---

## YouTube DOM Reality (memorize this)
- Cards reuse nodes. Old `data-mw-*` attributes remain stamped after recycle.
- `src`/`style`/`class` churn simultaneously on preview start — treat every reattach event as a potential contamination vector.
- `regularPathQuarantinePassed` separates homepage regular cards from Shorts. Never weaken it.
- The 900ms no-proof timer is a safety net. Do not shorten it.
- `strictUnknownButCardAuthoritative` at ~line 4697 is the known contamination entry point. Treat as hot zone.
- Negative purity > positive persistence. When in doubt, fail toward clearing.
