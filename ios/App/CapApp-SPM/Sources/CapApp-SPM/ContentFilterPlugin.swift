import Foundation
import Capacitor

@objc(ContentFilterPlugin)
public class ContentFilterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ContentFilterPlugin"
    public let jsName = "ContentFilter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startScanning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopScanning", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNSFWSignal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tapToReveal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise)
    ]

    private lazy var engine = ContentFilterEngine { [weak self] decision in
        self?.notifyListeners("riskDecision", data: decision.toDictionary())
    }
    private var allowRevealDuringHardBlur = false

    @objc func startScanning(_ call: CAPPluginCall) {
        let presetString = (call.getString("preset") ?? ContentFilterPreset.balanced.rawValue).lowercased()
        let preset = ContentFilterPreset(rawValue: presetString) ?? .balanced
        let kidMode = call.getBool("kidMode") ?? false

        let overrides = ContentFilterConfigOverrides(
            fps: call.getDouble("fps"),
            hysteresisOnMs: call.getInt("hysteresisOnMs"),
            hysteresisOffMs: call.getInt("hysteresisOffMs"),
            nsfwWeight: call.getDouble("nsfwWeight"),
            segmentationWeight: call.getDouble("segmentationWeight"),
            onThreshold: call.getDouble("onThreshold"),
            offThreshold: call.getDouble("offThreshold"),
            frameDeltaThreshold: call.getDouble("frameDeltaThreshold"),
            allowRevealDuringHardBlur: call.getBool("allowRevealDuringHardBlur"),
            revealDurationSeconds: call.getInt("revealDurationSeconds")
        )

        let config = ContentFilterConfig.build(
            preset: preset,
            kidMode: kidMode,
            overrides: overrides
        )

        self.allowRevealDuringHardBlur = config.allowRevealDuringHardBlur
        engine.start(config: config)
#if DEBUG
        print("[ContentFilterPlugin] startScanning called preset=\(preset.rawValue) kidMode=\(kidMode) fps=\(config.fps)")
#endif
        call.resolve([
            "started": true,
            "requestedPreset": presetString,
            "preset": preset.rawValue,
            "kidMode": kidMode,
            "fps": config.fps,
            "hysteresisOnMs": config.hysteresisOnMs,
            "hysteresisOffMs": config.hysteresisOffMs,
            "nsfwWeight": config.nsfwWeight,
            "segmentationWeight": config.segmentationWeight,
            "softThreshold": config.softThreshold,
            "hardThreshold": config.hardThreshold,
            "offThreshold": config.offThreshold,
            "frameDeltaThreshold": config.frameDeltaThreshold,
            "revealDurationSeconds": config.revealDurationSeconds,
            "allowRevealDuringHardBlur": config.allowRevealDuringHardBlur
        ])
    }

    @objc func stopScanning(_ call: CAPPluginCall) {
        engine.stop()
        call.resolve([
            "stopped": true
        ])
    }

    @objc func setNSFWSignal(_ call: CAPPluginCall) {
        guard let score = call.getDouble("score") else {
            call.reject("score is required")
            return
        }
#if DEBUG
        print("[ContentFilterPlugin] setNSFWSignal score=\(score)")
#endif
        engine.setNSFWScore(score)
        call.resolve()
    }

    @objc func tapToReveal(_ call: CAPPluginCall) {
        guard allowRevealDuringHardBlur else {
            call.reject("Tap to reveal is disabled by policy")
            return
        }
        let seconds = max(1, min(30, call.getInt("seconds") ?? 10))
        engine.temporarilyReveal(seconds: seconds)
        call.resolve([
            "revealedForSeconds": seconds
        ])
    }

    @objc func getState(_ call: CAPPluginCall) {
        call.resolve(engine.currentState())
    }
}
