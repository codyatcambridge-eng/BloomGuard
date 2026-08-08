# BloomGuard Context

## 2026-08-07 Active Shorts Transition Veil

- Goal: close the visible active Shorts loading gap before the normal Flash Shield/media preblur lands.
- Scope: active YouTube Shorts only; Flash Shield gated; no classifier threshold, reveal ownership, or main blur logic changes.
- Patch: added `.mw-flash-shorts-transition-overlay`, a fixed full-viewport frosted veil armed on active Shorts transition intent (`touchmove`, `wheel`, keyboard navigation). It uses `pointer-events: none`, hands off to the existing active Shorts preblur/blur path, and has a bounded 2600ms timeout.
- Cleanup: transition veil releases on safe/timeout/revealed resolution, positive hard-blur handoff, Flash Shield OFF, Shorts exit cleanup, managed timer stop, and teardown.
- Files changed:
  - `src/lib/webview-injection-script.ts`
  - `src/test/stability/harness.ts`
  - `src/test/stability/shorts-veil-release.test.ts`
- Validation:
  - `./node_modules/.bin/vitest run --config vitest.stability.config.ts src/test/stability/shorts-veil-release.test.ts` passed: 21 tests.
  - `npm run test:golden` passed: 23 files, 161 tests.
  - `npm run build` passed with existing Browserslist/chunk-size warnings.
  - `npx cap sync ios` passed.
  - `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -derivedDataPath build/sim-dd-active-shorts-transition-veil build` passed.
  - Fresh simulator install/launch on iPhone 17 Pro Max `FBE187B0-097D-4F4C-BA99-121888E1FC10` succeeded, PID `46236`.
  - Installed app bundle verified to contain `mw-flash-shorts-transition-overlay`.
- Frozen guard note: `node scripts/check-frozen.mjs` blocks the uncommitted working diff because `src/lib/webview-injection-script.ts` is sacred. This patch requires a commit body with `FREEZE-OVERRIDE: active Shorts transition veil is additive, Flash-Shield-gated, pointer-events none, bounded, and golden-tested`.
