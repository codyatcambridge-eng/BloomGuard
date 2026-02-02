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
| `src/hooks/useLocalSettings.ts` | Local settings with nonce generation |
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

## Image Moderation Protocol v2.0

### Security Model

The moderation system uses a **nonce-based security model** to prevent message spoofing:

1. **Session Nonce**: A unique nonce is generated per app session in `useLocalSettings`
2. **Request Nonce**: Every moderation request includes this nonce
3. **Response Validation**: The injected script rejects any response without a matching nonce

This prevents malicious page scripts from spoofing moderation results.

### Fail-Closed Policy

By default, the system operates in **fail-closed mode**:
- If a moderation request times out → images are blurred
- If inference fails → images are blurred
- If there's a communication error → images are blurred

This can be configured via `settings.fail_closed` in `useLocalSettings`.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         WebView (Page Context)                           │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ webview-injection-script.ts                                         │ │
│  │                                                                      │ │
│  │  1. MutationObserver detects <img>, background-image, video poster  │ │
│  │  2. Queue items with itemId, batch after 100ms delay                │ │
│  │  3. POST: { type, requestId, items, nonce, thresholds, timestamp }  │ │
│  │  4. LISTEN: window.addEventListener('message') for results          │ │
│  │  5. VALIDATE nonce before processing results                        │ │
│  │  6. Apply CSS blur + reveal overlay on flagged images               │ │
│  │  7. On timeout: apply fail-closed blur if enabled                   │ │
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
│  │  2. Validate nonce against session nonce from useLocalSettings      │ │
│  │  3. Validate with isValidModerationRequest()                        │ │
│  │  4. Call moderationBridge.scanImage() for each item                 │ │
│  │  5. POST back: { type, requestId, results, nonce, timestamp }       │ │
│  │     via executeScript("window.postMessage(...)")                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ ModerationBridgeWeb.ts (NSFWJS)                                     │ │
│  │                                                                      │ │
│  │  • loadImageWithFallback(): Direct load → Fetch+Blob fallback       │ │
│  │  • classifyWithTimeout(): 8s timeout for inference                  │ │
│  │  • Cache results for performance (LRU, 500 items)                   │ │
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
  nonce: string;               // Session security nonce
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
    category: string;          // 'safe', 'sexy', 'porn', 'hentai', 'error', 'timeout'
    confidence: number;        // 0-1
  }>;
  nonce: string;               // Must match request nonce
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
[MW-Host] Received postMessage request: r_abc123_1a2b3c4d nonce valid
[MW-Host] request received r_abc123_1a2b3c4d items=3
[MW-Host]   - i_xyz789 [img]: https://i.ytimg.com/vi/...
[MW-Host] calling scanBatch r_abc123_1a2b3c4d itemCount=3
[MW-Host] scan result i_xyz789 : sexy blur=true
[MW-Host] scan complete r_abc123_1a2b3c4d elapsed=234ms
[MW-Host] posting results back r_abc123_1a2b3c4d count=3 nonce=n_abc123...

# WebView receives result:
[MW] received result r_abc123_1a2b3c4d count=3
[MW] scan result itemId=i_xyz789 src=https://... blur=true cat=sexy
[MW] applied blur [sexy] itemId=i_xyz789: https://...

# Security rejection (if nonce mismatch):
[MW] NONCE MISMATCH - rejecting result: r_spoofed123
[MW] Expected: n_abc123... Got: n_fake456...
```

### Nonce Security

The nonce is a cryptographic-quality random string generated once per app session:

```typescript
// From moderation-request-utils.ts
function generateNonce(): string {
  const crypto = window.crypto;
  if (crypto && crypto.getRandomValues) {
    const arr = new Uint32Array(2);
    crypto.getRandomValues(arr);
    return 'n_' + arr[0].toString(36) + '_' + arr[1].toString(36);
  }
  // Fallback
  return 'n_' + Math.random().toString(36).slice(2, 10) + '_' + ...;
}
```

**Why nonce matters:**
- Malicious page scripts could try to post fake `gc-moderation-result` messages
- Without nonce validation, they could tell the script to NOT blur explicit images
- The nonce is only known to the injection script and the host app
- Any message without the correct nonce is rejected

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

#### Fail-Closed Toggle
Control what happens on timeout/error:

```javascript
window.__MW_DEBUG__.setFailClosed(true);  // Blur on failure (default)
window.__MW_DEBUG__.setFailClosed(false); // Allow on failure
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
window.__MW_DEBUG__.getNonce();        // Current session nonce
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
- **Fail-closed behavior**: On timeout, blur is applied (configurable)

### Key Moderation Files

| File | Purpose |
|------|---------|
| `src/lib/webview-injection-script.ts` | Injected into WebView, handles image detection and blur |
| `src/lib/moderation-request-utils.ts` | Protocol types, nonce generation, and validation utilities |
| `src/hooks/useModerationBridge.ts` | Bridge between WebView messages and AI model |
| `src/hooks/useLocalSettings.ts` | Settings storage with session nonce |
| `src/plugins/ModerationBridgeWeb.ts` | NSFWJS wrapper with fallback image loading |
| `src/plugins/ModerationBridge.ts` | Plugin interface and category calculation |
| `src/components/browser/NativeWebViewBrowser.tsx` | Message handler and script injection |
| `src/components/browser/LocalSettingsPanel.tsx` | Settings UI for blur dial/strength |
| `src/components/browser/AIStatusBar.tsx` | Status display during browsing |

---

## Native Platform Stubs

### iOS (Swift) - WKScriptMessageHandler

For more reliable host→page communication on iOS, consider using `WKScriptMessageHandler`:

```swift
import WebKit

class ModerationBridgeHandler: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private var sessionNonce: String
    
    init(webView: WKWebView, nonce: String) {
        self.webView = webView
        self.sessionNonce = nonce
        super.init()
    }
    
    func userContentController(_ controller: WKUserContentController, 
                               didReceive message: WKScriptMessage) {
        guard message.name == "gcModeration",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String,
              type == "gc-moderation-request",
              let requestId = body["requestId"] as? String,
              let items = body["items"] as? [[String: Any]],
              let nonce = body["nonce"] as? String,
              nonce == sessionNonce else {
            print("[MW-Native] Invalid or unauthorized message")
            return
        }
        
        print("[MW-Native] Received request \(requestId) items=\(items.count)")
        
        // Process each item
        Task {
            var results: [[String: Any]] = []
            
            for item in items {
                guard let itemId = item["itemId"] as? String,
                      let src = item["src"] as? String else { continue }
                
                print("[MW-Native] Processing \(itemId): \(src.prefix(60))")
                
                // Native image fetch
                do {
                    let (data, response) = try await URLSession.shared.data(from: URL(string: src)!)
                    let httpResponse = response as? HTTPURLResponse
                    print("[MW-Native] Fetch OK status=\(httpResponse?.statusCode ?? 0) bytes=\(data.count)")
                    
                    // Run inference (CoreML/TFLite or call JS bridge)
                    let scanResult = await runInference(imageData: data)
                    
                    results.append([
                        "itemId": itemId,
                        "src": src,
                        "shouldBlur": scanResult.shouldBlur,
                        "category": scanResult.category,
                        "confidence": scanResult.confidence
                    ])
                } catch {
                    print("[MW-Native] Fetch error: \(error)")
                    // Fail-closed: blur on error
                    results.append([
                        "itemId": itemId,
                        "src": src,
                        "shouldBlur": true,
                        "category": "error",
                        "confidence": 0
                    ])
                }
            }
            
            // Post results back
            await postResultsToWebView(requestId: requestId, results: results, nonce: nonce)
        }
    }
    
    private func postResultsToWebView(requestId: String, results: [[String: Any]], nonce: String) async {
        let resultMessage: [String: Any] = [
            "type": "gc-moderation-result",
            "requestId": requestId,
            "results": results,
            "nonce": nonce,
            "timestamp": Date().timeIntervalSince1970 * 1000
        ]
        
        guard let jsonData = try? JSONSerialization.data(withJSONObject: resultMessage),
              let jsonString = String(data: jsonData, encoding: .utf8) else { return }
        
        // Escape for JS injection
        let escaped = jsonString
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        
        let script = "window.postMessage(JSON.parse('\(escaped)'), '*');"
        
        await MainActor.run {
            webView?.evaluateJavaScript(script) { _, error in
                if let error = error {
                    print("[MW-Native] Failed to post result: \(error)")
                } else {
                    print("[MW-Native] Posted results for \(requestId)")
                }
            }
        }
    }
    
    private func runInference(imageData: Data) async -> (shouldBlur: Bool, category: String, confidence: Double) {
        // TODO: Implement CoreML inference here
        // For now, return safe result
        return (false, "safe", 1.0)
    }
}

// Setup in your view controller:
// let nonce = generateNonce()
// webView.configuration.userContentController.add(
//     ModerationBridgeHandler(webView: webView, nonce: nonce),
//     name: "gcModeration"
// )
```

### Android (Kotlin) - WebView JavaScriptInterface

```kotlin
import android.webkit.JavascriptInterface
import android.webkit.WebView
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.URL

class ModerationBridge(
    private val webView: WebView,
    private val sessionNonce: String,
    private val scope: CoroutineScope
) {
    @JavascriptInterface
    fun handleModerationRequest(jsonString: String) {
        scope.launch(Dispatchers.IO) {
            try {
                val body = JSONObject(jsonString)
                val type = body.optString("type")
                val requestId = body.optString("requestId")
                val nonce = body.optString("nonce")
                val items = body.optJSONArray("items") ?: JSONArray()
                
                if (type != "gc-moderation-request") return@launch
                
                // Validate nonce
                if (nonce != sessionNonce) {
                    println("[MW-Native] NONCE MISMATCH - rejecting request: $requestId")
                    return@launch
                }
                
                println("[MW-Native] Received request $requestId items=${items.length()}")
                
                val results = JSONArray()
                
                for (i in 0 until items.length()) {
                    val item = items.getJSONObject(i)
                    val itemId = item.optString("itemId")
                    val src = item.optString("src")
                    
                    println("[MW-Native] Processing $itemId: ${src.take(60)}")
                    
                    try {
                        // Native image fetch
                        val connection = URL(src).openConnection()
                        connection.connectTimeout = 10000
                        connection.readTimeout = 10000
                        val bytes = connection.getInputStream().readBytes()
                        
                        println("[MW-Native] Fetch OK bytes=${bytes.size}")
                        
                        // Run inference (TFLite or call JS bridge)
                        val scanResult = runInference(bytes)
                        
                        results.put(JSONObject().apply {
                            put("itemId", itemId)
                            put("src", src)
                            put("shouldBlur", scanResult.shouldBlur)
                            put("category", scanResult.category)
                            put("confidence", scanResult.confidence)
                        })
                    } catch (e: Exception) {
                        println("[MW-Native] Fetch error: ${e.message}")
                        // Fail-closed: blur on error
                        results.put(JSONObject().apply {
                            put("itemId", itemId)
                            put("src", src)
                            put("shouldBlur", true)
                            put("category", "error")
                            put("confidence", 0)
                        })
                    }
                }
                
                // Post results back
                postResultsToWebView(requestId, results, nonce)
            } catch (e: Exception) {
                println("[MW-Native] Error processing request: ${e.message}")
            }
        }
    }
    
    private suspend fun postResultsToWebView(requestId: String, results: JSONArray, nonce: String) {
        val resultMessage = JSONObject().apply {
            put("type", "gc-moderation-result")
            put("requestId", requestId)
            put("results", results)
            put("nonce", nonce)
            put("timestamp", System.currentTimeMillis())
        }
        
        val escaped = resultMessage.toString()
            .replace("\\", "\\\\")
            .replace("'", "\\'")
        
        val script = "window.postMessage(JSON.parse('$escaped'), '*');"
        
        withContext(Dispatchers.Main) {
            webView.evaluateJavascript(script) { result ->
                println("[MW-Native] Posted results for $requestId: $result")
            }
        }
    }
    
    private fun runInference(imageData: ByteArray): ScanResult {
        // TODO: Implement TFLite inference here
        // For now, return safe result
        return ScanResult(false, "safe", 1.0)
    }
    
    data class ScanResult(
        val shouldBlur: Boolean,
        val category: String,
        val confidence: Double
    )
}

// Setup in your activity:
// val nonce = generateNonce()
// webView.addJavascriptInterface(
//     ModerationBridge(webView, nonce, lifecycleScope),
//     "NativeModerationBridge"
// )
//
// Then in injected script, call:
// window.NativeModerationBridge.handleModerationRequest(JSON.stringify(request))
```

---

## Test Runbook

### End-to-End Test (YouTube Shorts)

1. Build and run on device:
```bash
npm run build
npx cap sync
npx cap run ios  # or android
```

2. Navigate to YouTube Shorts:
   - Open browser in app
   - Search for "shorts" or navigate to `youtube.com/shorts`

3. Check logs for full pipeline:
```
# Expected logs (in order):
[MW] injected - Moderation Script v2.0
[MW] Platform detected: youtube-shorts
[MW] ========== FULL PAGE SCAN ==========
[MW] queued [img] itemId=i_abc123: https://i.ytimg.com/vi/...
[MW] request sent r_xyz789 items=3 [...]
[MW] waiting response r_xyz789 ts=...

# Host logs:
[MW-Host] Received postMessage request: r_xyz789 nonce valid
[MW-Host] request received r_xyz789 items=3
[MW-Host] scan result i_abc123 : sexy blur=true
[MW-Host] posting results back r_xyz789 count=3 nonce=n_...

# WebView receives:
[MW] received result r_xyz789 count=3
[MW] applied blur [sexy] itemId=i_abc123: https://...
```

4. Verify visual blur on thumbnails

### Forced Blur Test

1. In browser console:
```javascript
window.__MW_DEBUG__.setForcedBlur(true)
```

2. Scroll or trigger rescan:
```javascript
window.__MW_DEBUG__.scanAll()
```

3. Verify ALL thumbnails are blurred

### Timeout/Fail-Closed Test

1. Simulate slow network or disconnect
2. Load a page with images
3. Wait 8+ seconds
4. Check logs for:
```
[MW] timeout r_xyz789 items=3
[MW] FAIL-CLOSED: Applying blur to timed-out items
[MW] applied blur [timeout] itemId=i_abc123: https://...
```

### Nonce Security Test

1. In browser console, try to spoof a result:
```javascript
window.postMessage({
  type: 'gc-moderation-result',
  requestId: 'r_fake123',
  results: [{ itemId: 'i_fake', src: 'https://...', shouldBlur: false, category: 'safe' }],
  nonce: 'n_wrong_nonce'
}, '*')
```

2. Check logs for rejection:
```
[MW] NONCE MISMATCH - rejecting result: r_fake123
[MW] Expected: n_abc123... Got: n_wrong_nonce...
```
