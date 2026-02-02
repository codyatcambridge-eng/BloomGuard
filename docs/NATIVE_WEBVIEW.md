# GoodCreation Browser - Native WebView Architecture

## Overview

The GoodCreation Browser uses a **unified native WebView architecture** for full interactivity. The browser supports:
- Full scrolling, video playback, and forms
- Cookie and session persistence
- Login flow support
- All safety layers integrated around the WebView engine

## Architecture

### Unified Engine
The browser uses `NativeWebViewBrowser` as the single entry point for all platforms:
- **Native (iOS/Android)**: Uses Capacitor's InAppBrowser for true native WebView
- **Web**: Falls back to Reader/Preview modes (no iframes)

### Safety Layers (All Platforms)
All safety features are preserved regardless of platform:
- Domain blocklist checking (via `check-blocked-site` edge function)
- Navigation logging to database
- Image moderation pipeline (NSFWJS on-device AI)
- Reader Mode for content extraction
- Preview Mode for sanitized static HTML
- Social Preview Modes (YouTube, Instagram, TikTok, Facebook, Twitter/X)
- External link warnings with confirmation
- PDF viewer

### Social Platform Handling
**IMPORTANT**: Social platforms (YouTube, Instagram, TikTok, Facebook, Twitter) load **fully in WebView** on native platforms for complete interactivity. On web, they use Social Preview Mode.

## Key Files

| File | Purpose |
|------|---------|
| `src/pages/SafeBrowser.tsx` | Entry point - renders NativeWebViewBrowser |
| `src/components/browser/NativeWebViewBrowser.tsx` | Unified browser component |
| `src/hooks/useNativeWebView.ts` | Native WebView controller hook |
| `src/hooks/useBrowserNavigation.ts` | Browser navigation state |
| `src/hooks/useWebViewModeration.ts` | Image moderation for WebView |
| `src/hooks/useCapacitor.ts` | Platform detection |
| `capacitor.config.ts` | Capacitor configuration |

## Dependencies
- `@capacitor/core` - Core Capacitor runtime
- `@capacitor/cli` - CLI for building native apps
- `@capgo/inappbrowser` - InAppBrowser plugin for native WebView

## Navigation Flow

```
Homepage → Search Results → WebView (native) / Fallback (web)
                              ↓ (blocked/error)
                          Fallback Mode
                              ↓
                     Reader / Preview / Social / PDF
                              ↓ (fails)
                          Failure View
```

## Fallback Triggers
Fallback mode activates ONLY when:
- Domain is blocked by the blocklist
- WebView fails to load (native only)
- User is on web platform (no native WebView available)
- User manually chooses "Reader Mode" or "Safe Preview"

## Building for Native

1. Export to GitHub and clone locally:
```bash
git pull origin main
npm install
```

2. Add native platforms:
```bash
npx cap add ios
npx cap add android
```

3. Build and sync:
```bash
npm run build
npx cap sync
```

4. Run on device/emulator:
```bash
npx cap run ios    # Requires Xcode (Mac only)
npx cap run android # Requires Android Studio
```

## Hot Reload Development
The `capacitor.config.ts` is configured with a server URL pointing to the Lovable preview, enabling hot reload during development.

## Image Moderation in WebView

### Architecture
The moderation system uses JavaScript injection to scan images in real-time:

```
WebView (Injected Script)          React App Layer
┌──────────────────────┐           ┌──────────────────────┐
│ MutationObserver     │──scan────▶│ useModerationBridge  │
│ watches for images   │◀─result───│ (queues requests)    │
│ applies CSS blur     │           └──────────┬───────────┘
│ reveal toggle        │                      │
└──────────────────────┘                      ▼
                                   ┌──────────────────────┐
                                   │ useOnDeviceModeration│
                                   │ NSFWJS (~50ms/image) │
                                   └──────────────────────┘
```

### Blur Dial (0-4 Sensitivity)
| Level | Name     | Description               |
|-------|----------|---------------------------|
| 0     | Off      | No scanning               |
| 1     | Relaxed  | Only explicit content     |
| 2     | Moderate | Explicit + suggestive     |
| 3     | Strict   | All questionable content  |
| 4     | Maximum  | Aggressive filtering      |

### Blur Strength
Adjustable 0-50px blur via CSS `filter: blur(Xpx)`.

### Key Moderation Files
- `src/hooks/useModerationBridge.ts` - Bridge between WebView and AI
- `src/lib/webview-injection-script.ts` - Injected JavaScript
- `src/plugins/ModerationBridge.ts` - Plugin interface
- `src/components/browser/LocalSettingsPanel.tsx` - Settings UI
- `src/components/browser/AIStatusBar.tsx` - Status during browsing
