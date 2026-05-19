# CLAUDE.md — BloomGuard MVP Rules

## MVP Goal

BloomGuard's MVP is simple:

On YouTube mobile, unsafe/positive thumbnails must stay blurred through normal browsing and preview transitions.

A user should not see a positive thumbnail blur, then suddenly unblur during static image → video preview churn.

## Required MVP Behavior

### Positives

If a YouTube thumbnail is classified as unsafe/positive:

- It must be blurred.
- The blur must persist during:
  - static IMG → preview VIDEO transition
  - `mutation_added:descendant_video`
  - `attr:src`
  - `attr:poster`
  - `loadeddata`
  - `play`
  - `playing`
- The reveal button must stay attached to the correct item.
- Blur should not drop just because YouTube changes from a `ytimg` thumbnail URL to a streaming video URL.

### Negatives

If a YouTube thumbnail is safe/negative:

- It must never gain blur.
- It must never inherit blur from a nearby positive.
- It must never get a reveal button.
- Unknown identity must fail clean: no blur, no reveal.

## Current Priority

Fix regular YouTube thumbnails first.

Primary surfaces:

- `m.youtube.com/`
- `m.youtube.com/feed*`
- `m.youtube.com/results*`

Focus on regular non-Shorts video thumbnails.

Do not patch Shorts shelf or active Shorts playback unless explicitly asked.

## Technical Focus

Primary file:

```bash
src/lib/webview-injection-script.ts
```
