# BloomGuard / Miracle Worker Agent Guidance

This file defines what a true Phase 0 MVP system means for BloomGuard and gives future agents strict rules for preserving the core blur system.

## Phase 0 MVP Definition

BloomGuard is a YouTube-focused NSFWJS visual moderation system. Its core job is simple:

- Detect risky/positive visual content.
- Apply a stable blur to positives.
- Pair every blurred item with a working tap-to-reveal button.
- Keep safe/negative content clean.
- Survive YouTube lifecycle churn like a professional product.

## 1. Positive Stability

A positive item must hold its blur until the user intentionally reveals that exact item.

Positives must not randomly drop blur during:

- YouTube home launch
- scrolling
- lazy loading
- DOM churn
- thumbnail replacement
- static-to-video thumbnail swaps
- search navigation
- route changes
- browser refresh
- app background / foreground
- long inactivity
- entering active Shorts
- exiting active Shorts
- returning from active Shorts to home/results
- re-entering active Shorts
- tapping reveal on a different item

A positive blur drop is a Phase 0 failure.

## 2. Reveal Pairing

Every blurred item must have a tap-to-reveal path.

If anything is blurred, it must have either:

- a visible tap-to-reveal button, or
- a reliable tap/reveal interceptor that intentionally reveals that exact blurred item.

There must be no:

- partial blur without reveal
- CSS-only blur without ownership
- orphan blur state
- veil blur without reveal
- hidden blurred item with no user escape path
- duplicate reveal buttons
- disappearing reveal buttons

## 3. Negative Safety

Negatives must stay clean.

A safe/negative item should not receive:

- blur
- tap-to-reveal button
- positive ownership
- stale positive state from recycled DOM nodes

Negatives must remain clean through:

- scrolling
- YouTube DOM recycling
- route changes
- refresh
- active Shorts entry/exit
- background/foreground
- model rescans

A negative gaining blur is a Phase 0 failure unless the model genuinely reclassifies the same content identity as positive under the current mode.

## 4. Required YouTube Surfaces

Blur injection must work across all required YouTube surfaces:

- YouTube home feed
- search results
- watch-page recommendation thumbnails
- home Shorts shelf thumbnails
- results Shorts shelf thumbnails
- Shorts poster thumbnails
- active Shorts player/poster surface

Each required surface must support:

- positive blur
- tap-to-reveal
- negative clean behavior
- lifecycle recovery

## 5. Active Shorts Requirement

Active Shorts are part of the MVP.

The system must handle:

- first active Short entry
- swiping between Shorts
- Shorts poster/player blur
- tap-to-reveal on active Shorts
- exiting Shorts back to home/results
- re-entering Shorts

Active Shorts must not corrupt the home/results lifecycle.

## 6. Lifecycle Quality

The system should behave like a professional browser product.

Required lifecycle behavior:

- no persistent white screen
- no injection that requires tapping the YouTube search bar
- no manual wake-up requirement
- no blur dropping after refresh
- no blur dropping after inactivity
- no blur dropping after background/foreground
- no stale overlays after route changes
- no observer stacking
- no unbounded timers
- no permanent heartbeat loops
- no console spam loops
- no broad cleanup that removes valid positive blur

## 7. Mode Switcher Behavior

The browser currently has a mode-switching shield/control button.

This control changes the scanning/tuning mode of the NSFWJS moderation system.

Supported modes:

- Off
- On / Balanced
- Moderate
- Strict
- Maximum

### Off

- Blur injection must drop from all YouTube pages and active Shorts.
- Existing BloomGuard blur overlays should be removed.
- Existing tap-to-reveal buttons should be removed.
- Scanning should stop or become inactive.
- Negatives and positives should both be visually clean because moderation is off.
- Turning Off must not corrupt ownership state for when the system turns back on.

### On / Balanced

- Default recommended mode.
- Balanced false-positive / false-negative behavior.
- Should protect clearly risky content while avoiding excessive over-blur.

### Moderate

- Slightly stronger than Balanced.
- More willing to blur borderline thumbnails.

### Strict

- Stronger protection.
- Accepts more false positives to reduce false negatives.

### Maximum

- Most protective scanning/tuning mode.
- Blurs more aggressively.
- Still must respect core lifecycle rules.
- Still must not create partial blur without reveal.
- Still must not corrupt negatives through stale ownership.

Important mode rule:

Mode changes may alter model thresholds, scan depth, or tuning, but they must not break the core invariants:

- positives hold blur
- negatives stay clean
- every blur has reveal
- lifecycle remains stable

## 8. Accuracy Goal

BloomGuard currently has some false positives and false negatives. Accuracy tuning is part of the product direction.

Accuracy work should focus on:

- better NSFWJS threshold mapping
- safer mode presets
- stronger surface-specific tuning
- reducing false negatives on obviously risky content
- reducing false positives on safe content
- preserving negative safety
- preserving positive stability

Accuracy work must not be implemented by adding unstable lifecycle hacks.

Do not improve "accuracy" in a way that causes:

- blur drops
- orphan blur
- missing reveal buttons
- negative contamination
- active Shorts instability
- reload/inactivity failures

## 9. Architecture Principles

Future agents must preserve these principles:

- Content identity is more important than raw DOM node identity.
- Blur ownership should be tied to stable content identity when possible.
- Overlay creation must be idempotent.
- Reveal buttons must be recreated after DOM replacement.
- MutationObservers must be bounded and cleaned up.
- Timers must be bounded and cleaned up.
- Injection readiness must be truthful.
- A script should not be marked ready unless the active injected system is actually alive.
- Refresh and foreground recovery must re-check liveness.
- Off mode must cleanly disable the system without leaving residue.
- On/mode changes must reapply moderation safely.

## 10. Forbidden Phase 0 Regressions

Do not accept any patch that causes:

- positives dropping blur unintentionally
- blurred items without reveal
- negatives gaining blur from stale state
- active Shorts losing reveal
- refresh dropping blur
- background/foreground dropping blur
- partial blur without reveal
- Flash Shield veil residue
- unbounded heartbeat
- broad lifecycle refactor without tests
- mode switching corrupting the blur engine

## 11. Testing Expectations

Any meaningful change to blur, reveal, lifecycle, modes, or NSFWJS thresholds must include tests or a clear manual validation plan.

Required validation surfaces:

- home feed
- search results
- watch recommendations
- home Shorts shelf
- results Shorts shelf
- Shorts poster thumbnail
- active Shorts
- refresh
- background/foreground
- long inactivity
- mode switching Off -> On
- mode switching between Balanced / Moderate / Strict / Maximum

Manual validation must confirm:

- positives stay blurred
- negatives stay clean
- every blur has reveal
- no partial blur
- active Shorts entry works
- active Shorts exit/re-entry works
- refresh recovers
- long inactivity recovers
- Off mode removes blur everywhere
- turning protection back on restores proper scanning

## Behavior Freeze Guardrails

When a behavior reaches the MVP definition across the required pages, routes, and lifecycle states, the agent must explicitly recommend freezing that behavior before further patches.

This exists to prevent regression loops where stable behavior gets repeatedly modified after it already satisfies the MVP contract. Stable systems should be protected, not endlessly patched.

### Freeze Candidates

Freeze candidates include, but are not limited to:

- thumbnail blur/reveal stability
- active Shorts blur/reveal stability
- Flash Shield pre-blur and release behavior
- page routing and lifecycle stability
- Off mode cleanup
- classifier accuracy
- profile/channel-origin Shorts coverage
- watch page recommendation behavior
- search results behavior
- home feed behavior

### Freeze Eligibility

A behavior is freeze-eligible when:

1. It satisfies the MVP definition in AGENTS.md.
2. It satisfies the sacred behavior rules in FROZEN.md.
3. It passes required manual QA on all relevant pages, routes, and lifecycle transitions.
4. It passes available automated tests, or remaining failures are clearly classified as non-blocking.
5. It does not reproduce known historical bugs.
6. It survives the required long-session test or an explicitly labeled accelerated lifecycle/shelf-life proxy.
7. User-facing behavior is stable enough that further changes are more likely to create regression risk than meaningful value.

### Required Freeze Signal

When a behavior is freeze-eligible, the agent must output this exact phrase:

"FREEZE SIGNAL: [behavior name] appears to satisfy MVP requirements. Recommend freezing this behavior before further patches."

The freeze signal must include:

- behavior name
- pages/routes tested
- evidence supporting freeze
- known remaining risks
- exact files/functions to protect
- recommended freeze tag or branch name
- what future work may still modify
- what future work must not modify

### Required Warning Language

When a behavior passes MVP requirements, agents must not silently continue patching.

They must explicitly tell the user:

"This behavior is now a freeze candidate. Further changes may create more regression risk than value."

Then the agent must recommend one of:

- freeze now
- run one final defined QA pass, then freeze
- hold freeze only because of a named reproducible blocker

### Patch Discipline After Freeze

After a behavior is frozen, future agents must not modify it unless:

1. A reproducible bug is found in that exact behavior.
2. The bug is a true MVP blocker.
3. The patch is scoped only to that bug.
4. The patch includes rollback instructions.
5. The patch compares behavior against the frozen baseline.
6. The patch reports every sacred file touched.
7. The patch reruns the required regression checklist.

Concrete examples:

- If active Shorts blur/reveal is frozen, do not rewrite active Shorts lifecycle to fix general classifier accuracy.
- If thumbnail blur/reveal is frozen, do not change reveal overlay creation to tune thresholds.
- If Flash Shield is frozen, do not rewrite Flash Shield handoff to fix unrelated page accuracy.
- If home/feed behavior is frozen, do not risk it while fixing profile/channel-origin Shorts.
- If Off mode cleanup is frozen, do not broadly alter cleanup unless Off mode itself has a reproducible blocker.

### Accuracy Freeze Rule

Classifier accuracy is also freezeable.

Once classifier accuracy reaches the MVP definition across required pages and routing contexts, the agent must recommend freezing the accuracy configuration.

Accuracy freeze may protect:

- thresholds
- model selection
- category mapping
- confidence logic
- frame/poster sampling strategy
- page-specific accuracy exceptions
- route-specific scanning behavior that affects classification

After accuracy is frozen, future accuracy changes require:

- a new branch from the frozen tag
- before/after evidence
- a rollback plan
- a report of every protected file touched
- regression testing against frozen blur/reveal behavior

### Current Protected Behavior Baseline

The current protected behavior baseline is:

- tag: `phase0-behavior-freeze-2026-07-09`
- commit: `7e576a30c64fd06b85ceb5914064ac8a57157a29`
- source tag: `mvp.333tUOFF`

This baseline protects:

- thumbnail discovery
- blur application
- reveal overlay
- Flash Shield
- active Shorts behavior
- route lifecycle
- Off mode cleanup
- settings plumbing
- stability tests

Future agents must compare surgical patches against this baseline.

This baseline is a protected behavior rollback point, not a claim that every MVP issue is solved.

## 12. Agent Behavior Rules

When working on this repo:

- Do not chase random fixes.
- Do not trust green tests alone if manual behavior fails.
- Do not freeze a build where positives drop blur.
- Do not freeze a build where blurred items lack reveal.
- Do not freeze a build where active Shorts corrupt lifecycle.
- Do not add future features in a Phase 0 stability patch.
- Keep patches small and explain what invariant they protect.
- If a change affects lifecycle, explicitly explain refresh, route, Shorts, and foreground behavior.
- If a change affects model tuning, explicitly explain false-positive and false-negative tradeoffs.

## Central Phase 0 Rule

A positive item gets a stable blur with a working tap-to-reveal button. A negative item stays clean. This must survive YouTube lifecycle churn.
