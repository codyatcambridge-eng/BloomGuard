import Foundation
import Capacitor
import WebKit

@objc(ContentFilter)
public class ContentFilterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ContentFilter"
    public let jsName = "ContentFilter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startScanning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScanning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNSFWSignal", returnType: CAPPluginReturnPromise)
    ]

    private weak var activeWebView: WKWebView?
    private var scanning = false
    private let logCooldownMs: Double = 800
    private var lastLogAt: TimeInterval = 0
    private var lastRevealForceAt: TimeInterval = 0

    public override func load() {
        super.load()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onAttach(_:)),
            name: .mwInAppBrowserDidAttachWebView,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onDetach(_:)),
            name: .mwInAppBrowserDidDetachWebView,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc func startScanning(_ call: CAPPluginCall) {
        scanning = true
        rateLimitedLog("[FlashShield][DIAG] startScanning (stub) attached=\(activeWebView != nil)")
        call.resolve([
            "started": true,
            "attached": activeWebView != nil
        ])
    }

    @objc func stopScanning(_ call: CAPPluginCall) {
        scanning = false
        rateLimitedLog("[FlashShield][DIAG] stopScanning")
        call.resolve(["stopped": true])
    }

    @objc func setNSFWSignal(_ call: CAPPluginCall) {
        let score = call.getDouble("score") ?? 0
        let reason = call.getString("reason") ?? "signal"
        rateLimitedLog("[FlashShield][DIAG] setNSFWSignal score=\(score) reason=\(reason)")
        let nowMs = Date().timeIntervalSince1970 * 1000
        if score >= 0.35 && (nowMs - lastRevealForceAt) > 500 {
            lastRevealForceAt = nowMs
            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: .mwNativeRevealOverlayForceVisible,
                    object: nil,
                    userInfo: [
                        "visible": true,
                        "reason": "nsfw_signal",
                        "score": score
                    ]
                )
            }
        }
        call.resolve()
    }

    // MARK: - Attach / Detach notifications

    @objc private func onAttach(_ notification: Notification) {
        guard let webView = notification.userInfo?["webView"] as? WKWebView else { return }
        activeWebView = webView
        rateLimitedLog("[FlashShield][DIAG] attached WKWebView")
    }

    @objc private func onDetach(_ notification: Notification) {
        if let webView = notification.userInfo?["webView"] as? WKWebView, webView === activeWebView {
            activeWebView = nil
            rateLimitedLog("[FlashShield][DIAG] detached WKWebView")
        }
    }

    // MARK: - Helpers

    private func rateLimitedLog(_ message: String) {
        let now = Date().timeIntervalSince1970 * 1000
        if now - lastLogAt < logCooldownMs { return }
        lastLogAt = now
#if DEBUG
        print(message)
#endif
    }
}
