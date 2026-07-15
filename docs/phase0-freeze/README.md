# Phase 0 freeze — how to work safely

## Baseline
- **Tag:** `phase0-mvp-lifecycle-2026-07-15` (lifecycle + blur stability)
- **Safe work tip:** `phase0-mvp-safe-work-2026-07-15` (includes FROZEN workstream lanes)
- **Behavior tip:** `2a6d9c23` nosoft + p0off

## Always
```bash
git checkout -b work/<topic> phase0-mvp-safe-work-2026-07-15
# after AI work:
npm run check:frozen
npm run test:golden
git diff phase0-mvp-lifecycle-2026-07-15 -- src/lib/webview-injection-script.ts src/components/browser/NativeWebViewBrowser.tsx
```

## Allowed lanes (see FROZEN.md)
- A) Dial thr / UI (not Off re-arm rewrite)
- B) Flash Shield toggle / veil (not soft preblur on YT)
- C) Active Shorts accuracy (not exit/orphan/nosoft)

## Forbidden without FREEZE-OVERRIDE + matrix
Exit scrub, nosoft soft ban, enter-Shorts reveal scope, Off→On re-arm, createReveal body, host exit multipass.
