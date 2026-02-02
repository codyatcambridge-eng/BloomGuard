# GoodCreation Browser - Native WebView Architecture

## Overview

The GoodCreation Browser now supports two rendering modes:
1. **Native WebView** (iOS/Android via Capacitor) - Full browser functionality with cookies, sessions, and login support
2. **Web Iframe** (Browser) - Protected iframe-based browsing with fallback modes

## Architecture

### Platform Detection
The app automatically detects the platform on startup:
- **Native (iOS/Android)**: Uses `NativeWebViewBrowser` component with Capacitor's InAppBrowser
- **Web**: Uses `WebBrowser` component with iframe-based rendering and fallback modes

### Safety Layers (Both Platforms)
All safety features are preserved regardless of platform:
- Domain blocklist checking
- Navigation logging to database
- Image moderation pipeline (NSFWJS)
- Reader Mode for content extraction
- Preview Mode for sanitized static HTML
- Social Preview Modes (YouTube, Instagram, TikTok, Facebook, Twitter/X)
- External link warnings
- PDF viewer

## Native WebView (Capacitor)

### Dependencies
- `@capacitor/core` - Core Capacitor runtime
- `@capacitor/cli` - CLI for building native apps
- `@capgo/inappbrowser` - InAppBrowser plugin for native WebView

### Key Files
- `capacitor.config.ts` - Capacitor configuration
- `src/hooks/useNativeWebView.ts` - Native WebView hook with full API
- `src/hooks/useCapacitor.ts` - Platform detection hook
- `src/components/browser/NativeWebViewBrowser.tsx` - Native browser component

### Features
- Full website interactivity (forms, video playback, scrolling)
- Cookie and session persistence
- Login flow support
- Navigation controls (back/forward/reload)
- URL change detection
- Error handling with fallback to Reader Mode

### Building for Native

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

### Hot Reload Development
The `capacitor.config.ts` is configured with a server URL pointing to the Lovable preview, enabling hot reload during development.

## Web Browser (Iframe)

### Fallback Modes
When iframe embedding fails (X-Frame-Options, CSP), the browser offers:

1. **Fallback Mode** - Detects blocked sites and offers alternatives
2. **Reader Mode** - Extracts and displays clean article content
3. **Preview Mode** - Shows sanitized static HTML snapshot
4. **Social Preview** - Platform-specific metadata cards
5. **Failure View** - Final fallback with copy/external link options

### View Flow
```
Homepage → Search Results → Browse (iframe)
                              ↓ (blocked)
                         Fallback Mode
                              ↓
                    Reader / Preview / Social
                              ↓ (fails)
                        Failure View
```

## Integration Points

### Blocklist Checking
Both platforms check URLs against the `blocked_sites` table via the `check-blocked-site` edge function before navigation.

### Logging
All navigation events are logged to `content_moderation_logs`:
- Navigation allowed/blocked
- Fallback triggers
- Reader/Preview mode activations
- Social preview views
- External link clicks

### Image Moderation
Social previews and Reader Mode images are scanned using NSFWJS for:
- Nudity detection
- Suggestive content
- Blur application based on sensitivity settings
