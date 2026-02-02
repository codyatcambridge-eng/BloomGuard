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
| `src/lib/webview-injection-script.ts` | Injected moderation JavaScript |
| `src/lib/moderation-request-utils.ts` | Protocol utilities and types |
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

---

## Image Moderation Protocol

### Architecture Overview

The moderation system uses a **postMessage-based protocol** for communication between the WebView (injected script) and the React Native host app:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         WebView (Page Context)                           │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ webview-injection-script.ts                                         │ │
│  │                                                                      │ │
│  │  1. MutationObserver detects <img>, background-image, video poster  │ │
│  │  2. Queue items with itemId, batch after 100ms delay                │ │
│  │  3. POST: { type: 'gc-moderation-request', requestId, items }       │ │
│  │  4. LISTEN: window.addEventListener('message') for results          │ │
│  │  5. Apply CSS blur + reveal overlay on flagged images               │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ window.postMessage
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      React Native Host (Bridge)                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ NativeWebViewBrowser.tsx                                            │ │
│  │                                                                      │ │
│  │  1. window.addEventListener('message') receives request             │ │
│  │  2. Validate with isValidModerationRequest()                        │ │
│  │  3. Call moderationBridge.scanImage() for each item                 │ │
│  │  4. POST back: { type: 'gc-moderation-result', requestId, results } │ │
│  │     via executeScript("window.postMessage(...)")                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ ModerationBridgeWeb.ts (NSFWJS)                                     │ │
│  │                                                                      │ │
│  │  • loadImageWithFallback(): Direct load → Fetch+Blob fallback       │ │
│  │  • classifyWithTimeout(): 8s timeout for inference                  │ │
│  │  • Cache results for performance                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

### Message Protocol

#### Request Message (WebView → Host)

```typescript
interface ModerationRequestMessage {
  type: 'gc-moderation-request';
  requestId: string;           // e.g., 'r_abc123_1a2b3c4d'
  items: Array<{
    itemId: string;            // e.g., 'i_xyz789'
    src: string;               // Image URL
    sourceType: 'img' | 'bg-image' | 'video-poster';
  }>;
  thresholds?: {               // Based on blur dial (0-4)
    porn: number;
    sexy: number;
    hentai: number;
  };
  timestamp: number;
}
```

#### Result Message (Host → WebView)

```typescript
interface ModerationResultMessage {
  type: 'gc-moderation-result';
  requestId: string;           // Matches the request
  results: Array<{
    itemId: string;            // Matches the request item
    src: string;
    shouldBlur: boolean;
    category: string;          // 'safe', 'sexy', 'porn', 'hentai', 'error', etc.
    confidence: number;        // 0-1
  }>;
  timestamp?: number;
}
```

### Debugging with requestId Correlation

To trace a moderation request end-to-end, look for matching `requestId` values in the logs:

```
# WebView (injected script) logs:
[MW] request sent r_abc123_1a2b3c4d items=3 [...]
[MW] waiting response r_abc123_1a2b3c4d ts=1706890123456

# Host (React) logs:
[MW-Host] request received r_abc123_1a2b3c4d items=3
[MW-Host]   - i_xyz789 [img]: https://i.ytimg.com/vi/...
[MW-Host] calling scanBatch r_abc123_1a2b3c4d itemCount=3
[MW-Host] scan result i_xyz789 : sexy blur=true
[MW-Host] scan complete r_abc123_1a2b3c4d elapsed=234ms
[MW-Host] posting results back r_abc123_1a2b3c4d count=3

# WebView receives result:
[MW] received result r_abc123_1a2b3c4d count=3
[MW] scan result itemId=i_xyz789 src=https://... blur=true cat=sexy
[MW] applied blur [sexy] itemId=i_xyz789: https://...
```

### Fallback Mechanism

If postMessage communication fails, the system falls back to **global queue polling**:

1. **Legacy Queue** (`window.__GC_SCAN_QUEUE__`): Items are pushed here if postMessage isn't received
2. **Host Polling**: Every 200ms, host polls this queue via `executeScript`
3. **Legacy Results** (`window.__GC_SCAN_RESULTS__`): Results pushed back for the script to pick up

### Development Features

#### Forced Blur Mode (Testing)
Toggle forced blur to test the UI without AI classification:

```javascript
// In WebView console:
window.__MW_DEBUG__.setForcedBlur(true);  // Blur ALL images
window.__MW_DEBUG__.setForcedBlur(false); // Normal mode
```

#### Debug Logging
Enable verbose logging:

```javascript
window.__MW_DEBUG__.setDebug(true);
```

#### Inspect State
```javascript
window.__MW_DEBUG__.stats();           // Scan statistics
window.__MW_DEBUG__.pending();         // Pending items
window.__MW_DEBUG__.pendingRequests(); // In-flight requests
window.__MW_DEBUG__.batchQueue();      // Items waiting to be sent
```

### Blur Dial (0-4 Sensitivity)

| Level | Name     | porn threshold | sexy threshold | hentai threshold |
|-------|----------|----------------|----------------|------------------|
| 0     | Off      | 1.1 (disabled) | 1.1            | 1.1              |
| 1     | Relaxed  | 0.7            | 0.85           | 0.7              |
| 2     | Moderate | 0.5            | 0.65           | 0.5              |
| 3     | Strict   | 0.3            | 0.45           | 0.3              |
| 4     | Maximum  | 0.15           | 0.25           | 0.15             |

### Blur Strength
Adjustable 0-50px blur via CSS `filter: blur(Xpx)`.

### Image Loading Strategy

The `ModerationBridgeWeb` uses a two-tier loading strategy:

1. **Direct Load**: `new Image()` with `crossOrigin='anonymous'`
2. **Fetch Fallback**: If direct fails, use `fetch()` → `blob` → `URL.createObjectURL()`

This handles CORS issues on servers that allow fetch but taint canvas with direct image loads.

### Timeout Handling

- **Image load timeout**: 10 seconds
- **Inference timeout**: 8 seconds  
- **Request timeout** (WebView): 8 seconds

If a request times out, items are marked with category `'timeout'` and can be retried on the next scan.

### Key Moderation Files

| File | Purpose |
|------|---------|
| `src/lib/webview-injection-script.ts` | Injected into WebView, handles image detection and blur |
| `src/lib/moderation-request-utils.ts` | Protocol types and validation utilities |
| `src/hooks/useModerationBridge.ts` | Bridge between WebView messages and AI model |
| `src/plugins/ModerationBridgeWeb.ts` | NSFWJS wrapper with fallback image loading |
| `src/plugins/ModerationBridge.ts` | Plugin interface and category calculation |
| `src/components/browser/NativeWebViewBrowser.tsx` | Message handler and script injection |
| `src/components/browser/LocalSettingsPanel.tsx` | Settings UI for blur dial/strength |
| `src/components/browser/AIStatusBar.tsx` | Status display during browsing |

---

## iOS WKScriptMessageHandler (Optional Enhancement)

For more reliable host→page communication on iOS, consider using `WKScriptMessageHandler`:

```swift
// In native iOS code:
webView.configuration.userContentController.add(self, name: "moderationBridge")

func userContentController(_ controller: WKUserContentController, 
                           didReceive message: WKScriptMessage) {
    if message.name == "moderationBridge",
       let body = message.body as? [String: Any] {
        // Handle moderation request
    }
}
```

Then in the injected script:
```javascript
webkit.messageHandlers.moderationBridge.postMessage({
  type: 'gc-moderation-request',
  requestId: 'r_123',
  items: [...]
});
```

This bypasses `window.postMessage` entirely for more reliable communication on iOS.
