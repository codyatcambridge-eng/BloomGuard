# AGENTS.md

## Mission
This repo is in MVP stabilization mode.

Keep changes small.
Do not refactor broadly.
Do not redesign the system.
Preserve working behavior.

## Main protections
- Preserve positive thumbnail behavior on the home page.
- Protect active Shorts as-is.
- Do not touch active Shorts unless I explicitly ask.

## Expected behaviors
- Positive home-page thumbnails should have stable blur.
- Positive home-page thumbnails should have one working tap-to-reveal button centered on the thumbnail.
- Tap-to-reveal should remove the blur and let the user click the thumbnail underneath.
- Negative thumbnails should never gain a blur.
- Negative thumbnails should never gain a tap-to-reveal button.
- Negative thumbnails should stay clear in static image state.
- Negative thumbnails should stay clear during video transition.
- Tap-to-reveal should only exist when authoritative blur exists.

## Current focus
- Main focus is stability on positive thumbnails.
- The blur on positives should never drop.
- At the same time, negatives must not gain blur or tap-to-reveal during static image or video transition.

## Surface rules
Treat these separately:
1. Active Shorts
2. Home page / feed / results / regular thumbnails

Do not break active Shorts while fixing home-page thumbnails.

## Working style
- Stay locked on MVP.
- Make the smallest safe change possible.
- Do not add new modes or big features.
- Do not do unrelated cleanup.
- Before patching, say what behavior you are protecting.
- After patching, explain the exact risk to positives, negatives, and active Shorts.

## Output format
When investigating or patching, always return:
A. exact file/function/line region
B. exact behavior being protected or fixed
C. minimal proposed action
D. risks
E. DIAG/log proof plan
F. acceptance test steps

End of file.
