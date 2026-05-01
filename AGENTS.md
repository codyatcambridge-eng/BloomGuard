# BloomGuard Agent Guardrails

## Mission
Lock the app into MVP behavior. Preserve stable blur/reveal behavior. Avoid refactors, side quests, architecture rewrites, or speculative improvements.

## Non-Negotiable MVP Rules
- Positives must retain blur through YouTube DOM churn, static thumbnail -> video preview transitions, SPA navigation, and reattachment.
- Positives must retain exactly one visible tap-to-reveal overlay while blurred.
- Negatives must never receive blur, reveal, stale reveal intent, inherited ownership, or card contamination.
- Reveal must only appear when blur is actually present.
- No duplicate reveal buttons.
- No orphaned reveal overlays.
- No wrong-card inheritance.
- No blur-drop regressions.
- No flicker regressions.
- No behavior that makes YouTube feel broken or abnormal.

## Active Shorts Protection
Active Shorts are protected. Do not modify active Shorts logic, scanning, classification, overlay behavior, timing, or transition handling unless the user explicitly authorizes it in the current task.

Allowed:
- Read active Shorts code for context.
- Add comments only if truly necessary.
- Mention possible Shorts risks in the report.

Forbidden:
- No active Shorts patches.
- No timing changes for active Shorts.
- No classifier changes affecting active Shorts.
- No shared helper changes that could alter active Shorts unless proven isolated.
- No "cleanup" that touches Shorts.

## Work Style
- Smallest safe patch only.
- One bug class at a time.
- Prefer diagnostics before patching when behavior is uncertain.
- Never rewrite large sections.
- Never "simplify" working logic.
- Never remove guards without proving they are obsolete.
- Never assume YouTube DOM identity is stable.
- Fail closed: unclear identity should not give negatives blur or reveal.
- Preserve current stable behavior over elegance.

## Required Verification Before Claiming Success
Before saying a fix is done, verify:
- Build succeeds.
- Runtime bundle is actually updated.
- Dist and iOS copied bundle match.
- Diagnostic marker appears in source and built output if a marker was added.
- Homepage positives retain blur.
- Homepage positives retain one tap-to-reveal button.
- Homepage negatives stay clean.
- Static thumbnail -> video preview transition does not drop blur on positives.
- Negative thumbnails do not inherit blur/reveal during transitions.
- Active Shorts are not changed.

## Diagnostic Expectations
When adding diagnostics:
- Use clear unique markers.
- Include enough fields to prove identity, card ownership, blur authority, reveal state, and reason for action.
- Do not spam logs in hot paths unless gated or temporary.
- Diagnostics should help answer: why did this node blur, clear, reveal, or inherit state?

## Patch Rules
Every patch must explain:
- The exact bug being targeted.
- The exact file and function touched.
- Why the change is isolated.
- Why active Shorts are not affected.
- What behavior could regress.
- How to test the fix manually.

## Forbidden Changes Unless Explicitly Approved
- Architecture rewrites.
- Broad helper refactors.
- New classifier systems.
- Changing active Shorts.
- Changing unrelated app UI.
- Changing package dependencies.
- Removing existing safety guards.
- Optimizing for beauty instead of MVP correctness.
- Touching multiple surfaces when the task is only homepage/feed.

## MVP Definition
MVP is reached when:
- YouTube homepage/feed positives reliably blur and retain reveal.
- YouTube homepage/feed negatives stay clean.
- Static -> video transition is stable.
- No duplicate reveal overlays.
- No wrong-card inheritance.
- No active Shorts regression.
- The browser feels normal.
