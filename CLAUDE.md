# CLAUDE.md

## Mission
This repo is in MVP stabilization mode for a Capacitor + iOS + WKWebView YouTube moderation browser.

Your job is not redesign.
Your job is not refactor.
Your job is not cleanup.
Your job is not architecture improvement.

Your job is to preserve known-good behavior and make only the smallest safe changes needed to reach a trustworthy MVP.

## Highest-priority protection
Protect **active Shorts** at all costs.

If a bug is isolated to homepage/feed/results/non-active thumbnail surfaces, do not patch active Shorts playback behavior.
If a proposed fix risks active Shorts stability, say that directly before making changes.

## Product truth
This app lives or dies by runtime behavior, not source alone.

For any restore, comparison, investigation, or fix, treat all of these as part of the real app state:
1. Git source
2. built web bundle in `dist/`
3. Capacitor-synced iOS public assets in `ios/App/App/public/`
4. evidence of what Xcode / Simulator is actually loading

Never claim a state is "same," "restored," or "working" unless source + dist + ios public + runtime proof align.

## Hard constraints
- Stay locked on MVP
- No broad refactors
- No opportunistic cleanup
- No architecture rewrites
- No new modes or new global features unless explicitly requested
- No broad system scans when a narrow investigation is enough
- No documentation side quests
- Preserve working behavior over elegance
- Prefer runtime truth over git purity

## Surface split
Treat these as separate systems:

1. Active Shorts player
2. Shorts shelf / non-active Shorts thumbnails
3. Main YouTube page thumbnails / feed / results / regular video cards

Do not casually mix logic across these surfaces.
Do not break active Shorts while fixing homepage thumbnails.
Do not break homepage thumbnails while fixing active Shorts.

## Behaviors to preserve
These behaviors are critical and must be protected:

### Active Shorts
1. Active Shorts positives must not blur-drop after positive resolution.
2. Active Shorts blur must survive normal playback churn and DOM/lifecycle churn.
3. Active Shorts negatives must stay clear unless there is fresh authoritative positive proof.
4. Active Shorts reveal must only exist when authoritative blur exists.
5. Active Shorts must not inherit blur/reveal from shelf thumbnails or recycled nearby nodes.
6. Homepage/feed/results fixes must not degrade active Shorts behavior.

### Main-page / non-active thumbnails
1. Unsafe positives should stay blurred once authoritatively positive.
2. Safe negatives should stay clear.
3. Tap-to-reveal must only exist when authoritative blur exists.
4. Tap-to-reveal must never migrate to the wrong card.
5. Static->video transition must not cause borrowed blur/reveal on negatives.
6. DOM churn / virtual scroll must not cause wrong-owner blur carryover.

## Current engineering stance
- Active Shorts protection is a top priority.
- If the bug is on non-Shorts main-surface transitions, patch that path only.
- Do not "fix" active Shorts as collateral damage.
- Do not add a static YouTube mode or page-level shield unless explicitly requested.
- Do not mask lifecycle bugs with broad UX changes.

## Debugging discipline
Prefer proof over theories.

When investigating:
- identify exact file/function/line region
- identify exact state transition or ownership failure
- identify exact DIAG markers that prove the path
- keep recommendations narrow and local

Do not give vague architecture advice when a specific codepath can be named.

## Change discipline
Before editing, always state:
1. the exact contract being fixed
2. the exact surface being touched
3. the smallest file/function/line region involved
4. what must not regress, especially active Shorts

After editing, always provide:
1. minimal diff summary
2. exact explanation of each change
3. exact risks
4. expected DIAG markers / log flow
5. narrow acceptance tests

## Preferred patch style
- Minimal
- Local
- Guarded
- Reversible
- DIAG-visible

Avoid:
- broad continuity rewrites
- hidden side effects across Shorts and homepage
- "simplification" that changes behavior broadly
- touching multiple surfaces when one surface is the real bug location

## Recovery / restore discipline
Never treat "checkout succeeded" as recovery.

Recovery means:
- correct source ref
- correct `dist/` bundle
- correct `ios/App/App/public/` bundle
- proof of active installed runtime if possible

If runtime proof is incomplete, say exactly:
`SIMULATOR RUNTIME NOT FULLY PROVEN`

If source and bundles are not aligned, say exactly:
`RUNTIME NOT TRUSTWORTHY YET`

If the latest patch broke behavior:
- stop patching
- preserve broken HEAD
- restore the previous runtime on a fresh branch
- rebuild `dist/`
- run `npx cap sync ios`
- validate from the canonical repo path only

## Branch rules
Before risky edits:
- create or confirm a dedicated debug branch
- preserve known-good baselines
- do not dirty a stable runtime branch

## Output format requirements
When asked to investigate or patch, always return:
A. exact files/functions/lines
B. exact behavior contract involved
C. minimal proposed action
D. risks
E. DIAG proof plan
F. acceptance test steps

## Strict no-go moves
- Do not break active Shorts to improve homepage behavior
- Do not patch active Shorts when the bug is isolated to regular main-surface thumbnails
- Do not add global static/freeze/shield behavior as a shortcut
- Do not continue patching after a regression without first recovering runtime truth
- Do not widen scope unless runtime evidence proves the bug crosses surfaces

End of file.
