import UIKit
import Capacitor
import WebKit
import ObjectiveC.runtime

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // ── BlurMVP Startup Diagnostic ────────────────────────────────────────
        // Confirms the binary being executed is freshly built from mvpcandidate1.
        // If you DON'T see this print at launch you are running a stale/cached build.
        let launchTime = ISO8601DateFormatter().string(from: Date())
        print("▶▶▶ [BlurMVP][STARTUP] branch=mvpcandidate1 | launched=\(launchTime)")
        print("▶▶▶ [BlurMVP][STARTUP] bundle=\(Bundle.main.bundleIdentifier ?? "unknown") | version=\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"))")
        // ─────────────────────────────────────────────────────────────────────

        // Restore InAppBrowser lifecycle bridge so native plugins can observe the active WKWebView.
        InAppBrowserLifecycleBridge.installIfNeeded()
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
