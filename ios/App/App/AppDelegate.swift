import UIKit
import Capacitor
import InappbrowserPlugin
import WebKit
import ObjectiveC.runtime
import SwiftUI

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Restore InAppBrowser lifecycle bridge so native plugins can observe the active WKWebView.
        InAppBrowserLifecycleBridge.installIfNeeded()
        NativeRevealOverlayManager.shared.installIfNeeded()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

// MARK: - Flash Shield / Content Filter bridge for InAppBrowser

private enum ContentFilterBridgeUserInfoKey {
    static let webView = "webView"
}

extension Notification.Name {
    static let mwInAppBrowserDidAttachWebView = Notification.Name("mwInAppBrowserDidAttachWebView")
    static let mwInAppBrowserDidDetachWebView = Notification.Name("mwInAppBrowserDidDetachWebView")
    static let mwNativeRevealOverlayForceVisible = Notification.Name("mwNativeRevealOverlayForceVisible")
}

private enum InAppBrowserLifecycleBridge {
    private static var installed = false
    private static var webViewAssociationKey: UInt8 = 0

    static func installIfNeeded() {
        guard !installed else { return }
        installed = true

        guard let browserClass = resolveBrowserControllerClass() else {
            return
        }

        swizzle(
            on: browserClass,
            original: #selector(UIViewController.viewDidAppear(_:)),
            replacement: #selector(UIViewController.mw_cf_viewDidAppear(_:))
        )

        swizzle(
            on: browserClass,
            original: #selector(UIViewController.viewDidDisappear(_:)),
            replacement: #selector(UIViewController.mw_cf_viewDidDisappear(_:))
        )

        let cleanupSelector = NSSelectorFromString("cleanupWebView")
        if class_getInstanceMethod(browserClass, cleanupSelector) != nil {
            swizzle(
                on: browserClass,
                original: cleanupSelector,
                replacement: #selector(UIViewController.mw_cf_cleanupWebView)
            )
        }
    }

    private static func resolveBrowserControllerClass() -> AnyClass? {
        let candidates = [
            "InAppBrowserPlugin.WKWebViewController",
            "WKWebViewController"
        ]
        for name in candidates {
            if let cls = NSClassFromString(name) {
                return cls
            }
        }
        return nil
    }

    private static func swizzle(on cls: AnyClass, original: Selector, replacement: Selector) {
        guard
            let originalMethod = class_getInstanceMethod(cls, original),
            let replacementMethod = class_getInstanceMethod(UIViewController.self, replacement)
        else { return }
        method_exchangeImplementations(originalMethod, replacementMethod)
    }

    static func attachIfPossible(from controller: UIViewController) {
        guard let webView = controller.view.mw_findLargestWKWebView() else { return }

        let current = objc_getAssociatedObject(controller, &webViewAssociationKey) as AnyObject?
        if let currentWebView = current as? WKWebView, currentWebView === webView {
            return
        }

        objc_setAssociatedObject(controller, &webViewAssociationKey, webView, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
#if DEBUG
        print("[FlashShield][DIAG] posting MWInAppBrowserDidAttachWebView")
#endif
        NotificationCenter.default.post(
            name: .mwInAppBrowserDidAttachWebView,
            object: nil,
            userInfo: [ContentFilterBridgeUserInfoKey.webView: webView]
        )
    }

    static func detachIfAttached(from controller: UIViewController) {
        guard let webView = objc_getAssociatedObject(controller, &webViewAssociationKey) as? WKWebView else {
            return
        }
#if DEBUG
        print("[FlashShield][DIAG] posting MWInAppBrowserDidDetachWebView")
#endif
        NotificationCenter.default.post(
            name: .mwInAppBrowserDidDetachWebView,
            object: nil,
            userInfo: [ContentFilterBridgeUserInfoKey.webView: webView]
        )
        objc_setAssociatedObject(controller, &webViewAssociationKey, nil, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }
}

private extension UIViewController {
    @objc func mw_cf_viewDidAppear(_ animated: Bool) {
        mw_cf_viewDidAppear(animated)
#if DEBUG
        print("[FlashShield][DIAG] swizzled viewDidAppear for \(type(of: self))")
#endif
        InAppBrowserLifecycleBridge.attachIfPossible(from: self)
    }

    @objc func mw_cf_viewDidDisappear(_ animated: Bool) {
        mw_cf_viewDidDisappear(animated)
        if isBeingDismissed || isMovingFromParent {
            InAppBrowserLifecycleBridge.detachIfAttached(from: self)
        }
    }

    @objc func mw_cf_cleanupWebView() {
        InAppBrowserLifecycleBridge.detachIfAttached(from: self)
        mw_cf_cleanupWebView()
    }
}

private extension UIView {
    func mw_findLargestWKWebView() -> WKWebView? {
        var best: WKWebView?
        var bestArea: CGFloat = 0

        func walk(_ view: UIView) {
            if let webView = view as? WKWebView {
                let area = webView.bounds.width * webView.bounds.height
                if area > bestArea, webView.bounds.width > 30, webView.bounds.height > 30 {
                    bestArea = area
                    best = webView
                }
            }
            for subview in view.subviews {
                walk(subview)
            }
        }

        walk(self)
        return best
    }
}

private final class NativeRevealOverlayViewModel: ObservableObject {
    @Published var isVisible = false
    var onTapReveal: (() -> Void)?
}

private struct NativeRevealOverlayView: View {
    @ObservedObject var model: NativeRevealOverlayViewModel

    var body: some View {
        ZStack {
            Color.clear
            VStack {
                Spacer()
                if model.isVisible {
                    Button(action: {
                        model.onTapReveal?()
                    }) {
                        Text("Tap to Reveal")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 22)
                            .padding(.vertical, 12)
                            .background(Color.black.opacity(0.82))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14)
                                    .stroke(Color.white.opacity(0.38), lineWidth: 1.5)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .padding(.bottom, 112)
                    .shadow(color: .black.opacity(0.35), radius: 10, x: 0, y: 7)
                    .allowsHitTesting(true)
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(true)
    }
}

private final class NativeRevealOverlayWindow: UIWindow {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hitView = super.hitTest(point, with: event)
        if hitView === rootViewController?.view {
            return nil
        }
        return hitView
    }
}

private final class NativeRevealOverlayManager {
    static let shared = NativeRevealOverlayManager()

    private let model = NativeRevealOverlayViewModel()
    private var installDone = false
    private var attachObserver: NSObjectProtocol?
    private var detachObserver: NSObjectProtocol?
    private var forceVisibleObserver: NSObjectProtocol?
    private weak var activeWebView: WKWebView?
    private var overlayWindow: NativeRevealOverlayWindow?

    private init() {
        model.onTapReveal = { [weak self] in
            self?.handleTapReveal()
        }
    }

    func installIfNeeded() {
        guard !installDone else { return }
        installDone = true
        attachObserver = NotificationCenter.default.addObserver(
            forName: .mwInAppBrowserDidAttachWebView,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleAttach(notification)
        }
        detachObserver = NotificationCenter.default.addObserver(
            forName: .mwInAppBrowserDidDetachWebView,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleDetach(notification)
        }
        forceVisibleObserver = NotificationCenter.default.addObserver(
            forName: .mwNativeRevealOverlayForceVisible,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            self?.handleForceVisible(notification)
        }
    }

    private func handleAttach(_ notification: Notification) {
        guard let webView = notification.userInfo?[ContentFilterBridgeUserInfoKey.webView] as? WKWebView else {
            return
        }
        activeWebView = webView
        presentOverlay(attachedTo: webView)
    }

    private func handleDetach(_ notification: Notification) {
        guard let detached = notification.userInfo?[ContentFilterBridgeUserInfoKey.webView] as? WKWebView else {
            removeOverlay()
            activeWebView = nil
            return
        }
        if detached === activeWebView {
            activeWebView = nil
            removeOverlay()
        }
    }

    private func handleForceVisible(_ notification: Notification) {
        let visible = (notification.userInfo?["visible"] as? Bool) ?? true
        let reason = (notification.userInfo?["reason"] as? String) ?? "unknown"
        if reason == "nsfw_signal" {
            // Do not force global native overlay from coarse NSFW signal events.
            // Item-level web overlays remain available for reveal actions.
            return
        }
        if !visible {
            return
        }
        if let existingWebView = activeWebView, existingWebView.window != nil {
            presentOverlay(attachedTo: existingWebView)
            return
        }
        if let discoveredWebView = findForegroundWebView() {
            activeWebView = discoveredWebView
            presentOverlay(attachedTo: discoveredWebView)
            return
        }
        if let scene = resolveWindowScene(for: nil) {
            if let existing = overlayWindow, existing.windowScene == scene {
                model.isVisible = true
                existing.isHidden = false
                return
            }
            let overlayWindow = NativeRevealOverlayWindow(windowScene: scene)
            overlayWindow.backgroundColor = .clear
            overlayWindow.windowLevel = .alert + 1
            let host = UIHostingController(rootView: NativeRevealOverlayView(model: model))
            host.view.backgroundColor = .clear
            overlayWindow.rootViewController = host
            overlayWindow.isHidden = false
            self.overlayWindow = overlayWindow
            model.isVisible = true
        }
    }

    private func resolveWindowScene(for webView: WKWebView?) -> UIWindowScene? {
        if let scene = webView?.window?.windowScene {
            return scene
        }
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first(where: { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive })
    }

    private func findForegroundWebView() -> WKWebView? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        var best: WKWebView?
        var bestArea: CGFloat = 0

        for scene in scenes where scene.activationState == .foregroundActive || scene.activationState == .foregroundInactive {
            for window in scene.windows where !window.isHidden {
                guard let candidate = window.mw_findLargestWKWebView() else { continue }
                let area = candidate.bounds.width * candidate.bounds.height
                if area > bestArea, candidate.bounds.width > 30, candidate.bounds.height > 30 {
                    bestArea = area
                    best = candidate
                }
            }
        }
        return best
    }

    private func presentOverlay(attachedTo webView: WKWebView) {
        guard let scene = resolveWindowScene(for: webView) else { return }
        if let existing = overlayWindow, existing.windowScene == scene {
            model.isVisible = true
            existing.isHidden = false
            return
        }
        let overlayWindow = NativeRevealOverlayWindow(windowScene: scene)
        overlayWindow.backgroundColor = .clear
        overlayWindow.windowLevel = .alert + 1
        let host = UIHostingController(rootView: NativeRevealOverlayView(model: model))
        host.view.backgroundColor = .clear
        overlayWindow.rootViewController = host
        overlayWindow.isHidden = false
        self.overlayWindow = overlayWindow
        model.isVisible = true
    }

    private func removeOverlay() {
        model.isVisible = false
        overlayWindow?.isHidden = true
        overlayWindow?.rootViewController = nil
        overlayWindow = nil
    }

    private func handleTapReveal() {
        guard let webView = activeWebView else { return }
        let revealScript = """
        (function() {
          try {
            if (typeof window.__MW_NATIVE_REVEAL__ === 'function') {
              return window.__MW_NATIVE_REVEAL__('native_swiftui_overlay');
            }
            var first = document.querySelector('[data-mw-moderated="blurred"][data-mw-src]');
            if (!first) return JSON.stringify({ ok: false, reason: 'no_blurred_candidate' });
            first.style.removeProperty('filter');
            first.style.removeProperty('-webkit-filter');
            first.style.removeProperty('backdrop-filter');
            first.style.removeProperty('-webkit-backdrop-filter');
            first.dataset.mwModerated = 'revealed';
            first.dataset.mwRevealed = 'true';
            var overlays = document.querySelectorAll('.mw-reveal-overlay');
            for (var i = 0; i < overlays.length; i += 1) {
              overlays[i].style.display = 'none';
            }
            return JSON.stringify({ ok: true, reason: 'fallback_reveal' });
          } catch (e) {
            return JSON.stringify({ ok: false, reason: String(e) });
          }
        })();
        """
        webView.evaluateJavaScript(revealScript) { _, _ in }
    }
}
