import Capacitor

@objc(SafeDriverPlugin)
public class SafeDriverPlugin: CAPPlugin {

    @objc public func checkSafety(_ call: CAPPluginCall) {
        call.resolve([
            "status": "placeholder",
            "safe": false,
        ])
    }
}
