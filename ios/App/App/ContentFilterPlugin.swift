import Foundation
import Capacitor
import WebKit
import OSLog

private let bgLogger = Logger(subsystem: "com.bloomguard.app", category: "blur-diagnostics")

private class BlurDiagnosticsHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? String else { return }
        bgLogger.info("\(body, privacy: .public)")
        NSLog("[BlurDiag] %@", body)
    }
}

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
    private let blurDiagHandler = BlurDiagnosticsHandler()

    public override func load() {
        super.load()
        bgLogger.info("[BlurDiag] ContentFilterPlugin.load() called")
        NSLog("[BlurDiag] ContentFilterPlugin.load() called")
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
        call.resolve()
    }

    // MARK: - Attach / Detach notifications

    @objc private func onAttach(_ notification: Notification) {
        guard let webView = notification.userInfo?["webView"] as? WKWebView else { return }
        activeWebView = webView
        let ucc = webView.configuration.userContentController
        ucc.removeScriptMessageHandler(forName: "blurDiagnostics")
        ucc.add(blurDiagHandler, name: "blurDiagnostics")
        bgLogger.info("[BlurDiag] onAttach fired — blurDiagnostics handler registered")
        NSLog("[BlurDiag] onAttach fired — blurDiagnostics handler registered")
        rateLimitedLog("[FlashShield][DIAG] attached WKWebView — blurDiagnostics handler registered")
    }

    @objc private func onDetach(_ notification: Notification) {
        if let webView = notification.userInfo?["webView"] as? WKWebView, webView === activeWebView {
            webView.configuration.userContentController.removeScriptMessageHandler(forName: "blurDiagnostics")
            activeWebView = nil
            rateLimitedLog("[FlashShield][DIAG] detached WKWebView — blurDiagnostics handler removed")
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
