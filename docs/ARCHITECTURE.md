# Iron Watch: Content Protection Architecture

## Overview

Iron Watch is a multi-layered content protection system designed to prevent access to inappropriate, explicit, or suggestive content. This document outlines the complete architecture including both the web-based MVP and the native components required for a production deployment.

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LAYER 1: IN-APP BROWSER                       │
│         WebView-based browsing with request interception            │
│                    ✅ MVP (Web) / 🔧 Native Required                 │
├─────────────────────────────────────────────────────────────────────┤
│                     LAYER 2: ON-DEVICE AI MODERATION                 │
│         TensorFlow.js / Core ML / TensorFlow Lite                   │
│                         ✅ MVP Implemented                           │
├─────────────────────────────────────────────────────────────────────┤
│                      LAYER 3: LOCAL DOMAIN BLOCKING                  │
│               JSON blocklist with pattern matching                   │
│                         ✅ MVP Implemented                           │
├─────────────────────────────────────────────────────────────────────┤
│                     LAYER 4: BROWSER EXTENSIONS                      │
│            Chrome/Firefox/Safari content interception               │
│                      🔧 Separate Build Required                      │
├─────────────────────────────────────────────────────────────────────┤
│                       LAYER 5: DNS FILTERING                         │
│           Network-level blocking via NextDNS/Pi-hole                │
│                      📋 Configuration Guide                          │
├─────────────────────────────────────────────────────────────────────┤
│                    LAYER 6: MDM/DEVICE MANAGEMENT                    │
│          Enterprise-level device control and policies               │
│                      📋 Configuration Guide                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## MVP Implementation (Web-Based)

### What's Included

| Component | Status | Technology |
|-----------|--------|------------|
| Safe Browser UI | ✅ Complete | React + iframe sandbox |
| On-Device AI | ✅ Complete | TensorFlow.js + NSFWJS |
| Local Blocklist | ✅ Complete | localStorage + JSON |
| Image Scanner | ✅ Complete | Client-side processing |
| Local Settings | ✅ Complete | localStorage persistence |
| Local Activity Logs | ✅ Complete | localStorage (1000 entries) |

### On-Device AI Model

**Model**: NSFWJS with MobileNetV2 backbone
- **Size**: ~2MB (quantized)
- **Inference**: ~50ms per image
- **Categories**: Drawing, Hentai, Neutral, Porn, Sexy
- **Runs**: 100% client-side via WebGL

```typescript
// Usage Example
import { useOnDeviceModeration } from '@/hooks/useOnDeviceModeration';

const { classifyImage, isReady } = useOnDeviceModeration();

const result = await classifyImage(imageUrl, {
  porn: 0.3,    // Block if >30% confidence
  sexy: 0.4,    // Block if >40% confidence  
  hentai: 0.3   // Block if >30% confidence
});

if (result.shouldBlur) {
  // Apply blur effect
}
```

### Sensitivity Levels

| Level | Porn Threshold | Sexy Threshold | Hentai Threshold |
|-------|---------------|----------------|------------------|
| Relaxed | 80% | 85% | 80% |
| Moderate | 50% | 60% | 50% |
| Strict | 30% | 40% | 30% |

### Local Blocklist

Pre-configured with 30+ domains across categories:
- Adult content sites
- Proxy/VPN bypass tools
- Known explicit content aggregators

```typescript
// Adding custom domain
import { useLocalBlocklist } from '@/hooks/useLocalBlocklist';

const { addDomain, isBlocked } = useLocalBlocklist();

addDomain('example.com', 'custom');

const result = isBlocked('https://example.com/page');
// { blocked: true, domain: 'example.com', category: 'custom' }
```

---

## Native App Architecture (Required for Full Protection)

### iOS Implementation

```
┌─────────────────────────────────────────────────────────┐
│                    iOS Native App                        │
├─────────────────────────────────────────────────────────┤
│  WKWebView with WKNavigationDelegate                    │
│  - decidePolicyFor navigationAction                     │
│  - Intercept all requests before loading                │
├─────────────────────────────────────────────────────────┤
│  WKURLSchemeHandler (Custom Protocol)                   │
│  - Intercept image requests                             │
│  - Run through Core ML before displaying                │
├─────────────────────────────────────────────────────────┤
│  Core ML Model (NSFW Detector)                          │
│  - Convert NSFWJS to Core ML format                     │
│  - ~15ms inference on Neural Engine                     │
├─────────────────────────────────────────────────────────┤
│  Content Blocker Extension                              │
│  - Safari content blocking rules                        │
│  - JSON rule format for domain blocking                 │
├─────────────────────────────────────────────────────────┤
│  Photo Library Access Observer                          │
│  - PHPhotoLibraryChangeObserver                         │
│  - Scan new photos automatically                        │
└─────────────────────────────────────────────────────────┘
```

#### Swift Code Example: WebView Request Interception

```swift
import WebKit

class SafeWebViewController: UIViewController, WKNavigationDelegate {
    
    func webView(_ webView: WKWebView, 
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        
        // Check local blocklist
        if BlocklistManager.shared.isBlocked(url) {
            showBlockedScreen(for: url)
            decisionHandler(.cancel)
            return
        }
        
        decisionHandler(.allow)
    }
    
    // Image interception via custom URL scheme
    func webView(_ webView: WKWebView, 
                 start urlSchemeTask: WKURLSchemeTask) {
        
        guard let url = urlSchemeTask.request.url,
              url.pathExtension.isImageExtension else {
            // Not an image, pass through
            return
        }
        
        Task {
            let imageData = try await downloadImage(url)
            let result = await NSFWDetector.shared.classify(imageData)
            
            if result.shouldBlur {
                let blurredData = applyBlur(imageData, amount: 32)
                urlSchemeTask.didReceive(blurredResponse(blurredData))
            } else {
                urlSchemeTask.didReceive(originalResponse(imageData))
            }
        }
    }
}
```

### Android Implementation

```
┌─────────────────────────────────────────────────────────┐
│                   Android Native App                     │
├─────────────────────────────────────────────────────────┤
│  WebView with WebViewClient                             │
│  - shouldInterceptRequest()                             │
│  - Intercept all resource requests                      │
├─────────────────────────────────────────────────────────┤
│  TensorFlow Lite Model                                  │
│  - GPU Delegate for acceleration                        │
│  - ~20ms inference on mobile GPU                        │
├─────────────────────────────────────────────────────────┤
│  VPN Service (for system-wide protection)               │
│  - Local VPN to intercept all traffic                   │
│  - No data leaves device                                │
├─────────────────────────────────────────────────────────┤
│  Accessibility Service (optional)                       │
│  - Monitor other apps for images                        │
│  - Overlay blur on detected content                     │
├─────────────────────────────────────────────────────────┤
│  MediaStore Observer                                    │
│  - ContentObserver for new images                       │
│  - Automatic gallery scanning                           │
└─────────────────────────────────────────────────────────┘
```

#### Kotlin Code Example: WebView Request Interception

```kotlin
class SafeWebViewClient(
    private val nsfwDetector: NSFWDetector,
    private val blocklist: BlocklistManager
) : WebViewClient() {
    
    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest
    ): WebResourceResponse? {
        val url = request.url.toString()
        
        // Check blocklist
        if (blocklist.isBlocked(url)) {
            return createBlockedResponse()
        }
        
        // Check if image
        if (url.isImageUrl()) {
            return interceptImage(url)
        }
        
        return super.shouldInterceptRequest(view, request)
    }
    
    private fun interceptImage(url: String): WebResourceResponse? {
        return runBlocking {
            try {
                val imageBytes = downloadImage(url)
                val bitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
                
                val result = nsfwDetector.classify(bitmap)
                
                if (result.shouldBlur) {
                    val blurred = applyBlur(bitmap, radius = 32f)
                    createImageResponse(blurred.toByteArray())
                } else {
                    createImageResponse(imageBytes)
                }
            } catch (e: Exception) {
                null // Fall back to default loading
            }
        }
    }
}
```

---

## Browser Extension Architecture

### Chrome/Edge Extension (Manifest V3)

```
iron-watch-extension/
├── manifest.json
├── background.js          # Service worker
├── content-script.js      # Page injection
├── popup/
│   ├── popup.html
│   └── popup.js
├── models/
│   └── nsfwjs/           # Bundled model
└── rules/
    └── blocklist.json    # Declarative net request rules
```

#### manifest.json

```json
{
  "manifest_version": 3,
  "name": "Iron Watch Protection",
  "version": "1.0.0",
  "permissions": [
    "declarativeNetRequest",
    "storage",
    "activeTab",
    "scripting"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content-script.js"],
    "run_at": "document_start"
  }],
  "declarative_net_request": {
    "rule_resources": [{
      "id": "blocklist",
      "enabled": true,
      "path": "rules/blocklist.json"
    }]
  }
}
```

#### content-script.js (Image Scanning)

```javascript
// Load NSFWJS in content script
let model = null;

async function initModel() {
  model = await nsfwjs.load('/models/nsfwjs/');
}

// Observer for new images
const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeName === 'IMG') {
        scanImage(node);
      }
    });
  });
});

observer.observe(document.body, { 
  childList: true, 
  subtree: true 
});

async function scanImage(img) {
  if (!model) await initModel();
  
  try {
    const predictions = await model.classify(img);
    const shouldBlur = checkThresholds(predictions);
    
    if (shouldBlur) {
      img.style.filter = 'blur(32px)';
      img.dataset.ironWatchBlurred = 'true';
      
      // Report to background script
      chrome.runtime.sendMessage({
        type: 'IMAGE_BLOCKED',
        url: img.src,
        predictions
      });
    }
  } catch (e) {
    console.error('Iron Watch scan failed:', e);
  }
}
```

### Safari Extension (App Extension)

```swift
// SafariWebExtensionHandler.swift
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    
    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems[0] as! NSExtensionItem
        let message = item.userInfo?[SFExtensionMessageKey] as? [String: Any]
        
        if let action = message?["action"] as? String {
            switch action {
            case "checkImage":
                handleImageCheck(message, context: context)
            case "checkUrl":
                handleUrlCheck(message, context: context)
            default:
                break
            }
        }
    }
    
    private func handleImageCheck(_ message: [String: Any]?, 
                                   context: NSExtensionContext) {
        guard let imageData = message?["imageData"] as? Data else { return }
        
        let result = NSFWDetector.shared.classify(imageData)
        
        let response = NSExtensionItem()
        response.userInfo = [
            SFExtensionMessageKey: [
                "shouldBlur": result.shouldBlur,
                "confidence": result.confidence
            ]
        ]
        
        context.completeRequest(returningItems: [response])
    }
}
```

---

## DNS Filtering Setup

### NextDNS Configuration

1. Create account at https://nextdns.io
2. Configure blocklists:
   - OISD NSFW
   - Steven Black Hosts (Porn)
   - Porn Blocklist by Sinfonietta

3. Enable security features:
   - Block Newly Registered Domains
   - Block DNS Rebinding
   - Block Typosquatting

4. Configure on device:
   - iOS: Settings → General → VPN & Device Management → DNS
   - Android: Settings → Network → Private DNS
   - Set: `xxxx.dns.nextdns.io`

### Pi-hole Configuration (Self-Hosted)

```bash
# Install Pi-hole
curl -sSL https://install.pi-hole.net | bash

# Add NSFW blocklists
pihole -a -w https://raw.githubusercontent.com/chadmayfield/my-pihole-blocklists/master/lists/pi_blocklist_porn_top1m.list

# Configure clients to use Pi-hole as DNS
# Router → DHCP → DNS Server = Pi-hole IP
```

---

## MDM/Device Management

### iOS MDM Profile

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN">
<plist version="1.0">
<dict>
    <key>PayloadContent</key>
    <array>
        <!-- DNS Configuration -->
        <dict>
            <key>PayloadType</key>
            <string>com.apple.dnsSettings.managed</string>
            <key>DNSSettings</key>
            <dict>
                <key>DNSProtocol</key>
                <string>HTTPS</string>
                <key>ServerURL</key>
                <string>https://dns.nextdns.io/xxxxxx</string>
            </dict>
        </dict>
        
        <!-- App Restrictions -->
        <dict>
            <key>PayloadType</key>
            <string>com.apple.applicationaccess</string>
            <key>allowSafari</key>
            <false/>
            <key>safariAllowAutoFill</key>
            <false/>
            <key>allowInAppPurchases</key>
            <false/>
        </dict>
        
        <!-- Web Content Filter -->
        <dict>
            <key>PayloadType</key>
            <string>com.apple.webcontent-filter</string>
            <key>FilterType</key>
            <string>BuiltIn</string>
            <key>AutoFilterEnabled</key>
            <true/>
            <key>PermittedURLs</key>
            <array/>
            <key>BlacklistedURLs</key>
            <array>
                <string>pornhub.com</string>
                <string>xvideos.com</string>
                <!-- ... more domains -->
            </array>
        </dict>
    </array>
</dict>
</plist>
```

### Android Work Profile

Use Android Enterprise with managed Google Play:

1. Configure via EMM (Workspace ONE, Intune, etc.)
2. Block app installation from unknown sources
3. Force VPN always-on with blocking
4. Configure managed DNS
5. Disable developer options

---

## Security Considerations

### Bypass Prevention

| Attack Vector | Mitigation |
|--------------|------------|
| Incognito mode | Extension runs in incognito |
| VPN usage | DNS filtering at router level |
| DNS override | MDM-enforced DNS settings |
| App uninstall | MDM device administrator |
| Browser switch | Block other browsers via MDM |
| Device reset | Device enrollment protection |

### Privacy

- All AI inference runs locally
- No images sent to servers
- Logs stored locally only
- No cloud sync in MVP
- Optional: encrypted local storage

---

## Development Roadmap

### Phase 1: MVP (Current) ✅
- [x] Web-based Safe Browser
- [x] TensorFlow.js AI moderation
- [x] Local blocklist management
- [x] Local settings persistence
- [x] Image scanner component

### Phase 2: Native Apps
- [ ] iOS app with WKWebView
- [ ] Core ML model integration
- [ ] Android app with WebView
- [ ] TensorFlow Lite integration

### Phase 3: Browser Extensions
- [ ] Chrome/Edge extension (MV3)
- [ ] Firefox extension
- [ ] Safari extension

### Phase 4: Enterprise Features
- [ ] MDM integration
- [ ] Central policy management
- [ ] Accountability partner sync
- [ ] Encrypted cloud backup

---

## File Structure

```
iron-watch/
├── src/
│   ├── hooks/
│   │   ├── useLocalSettings.ts      # Local settings persistence
│   │   ├── useLocalBlocklist.ts     # Domain blocking
│   │   ├── useOnDeviceModeration.ts # NSFWJS integration
│   │   └── useLocalLogs.ts          # Activity logging
│   ├── components/
│   │   └── browser/
│   │       ├── AIStatusIndicator.tsx
│   │       ├── ImageScanner.tsx
│   │       ├── BlocklistManager.tsx
│   │       ├── LocalSettingsPanel.tsx
│   │       └── LocalLogsPanel.tsx
│   └── pages/
│       ├── LocalSafeBrowser.tsx     # Main browser UI
│       └── LocalBrowserApp.tsx      # Tab container
├── docs/
│   └── ARCHITECTURE.md              # This file
└── native/                          # Future native code
    ├── ios/
    └── android/
```

---

## Conclusion

This MVP provides a foundation for local-first content protection using browser-based AI. For complete protection, native app development and browser extensions are required to intercept content at the system level.

The architecture is designed to be:
- **Privacy-first**: All processing happens on-device
- **Offline-capable**: No internet required for protection
- **Extensible**: Easy to add cloud sync or accountability features
- **Layered**: Multiple overlapping protection mechanisms
