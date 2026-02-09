import Foundation

public extension Notification.Name {
    static let mwInAppBrowserDidAttachWebView = Notification.Name("MWInAppBrowserDidAttachWebView")
    static let mwInAppBrowserDidDetachWebView = Notification.Name("MWInAppBrowserDidDetachWebView")
}

public enum ContentFilterBridgeUserInfoKey {
    public static let webView = "webView"
}
