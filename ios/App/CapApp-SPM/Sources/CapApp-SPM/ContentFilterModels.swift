import Foundation

enum ContentFilterState: String {
    case safe = "SAFE"
    case softBlur = "SOFT_BLUR"
    case hardBlur = "HARD_BLUR"
    case revealTemp = "REVEAL_TEMP"
    case cooldown = "COOLDOWN"
}

enum ContentFilterPreset: String {
    case balanced = "balanced"
    case strict = "strict"
    case relaxed = "relaxed"
}

struct ContentFilterConfigOverrides {
    let fps: Double?
    let hysteresisOnMs: Int?
    let hysteresisOffMs: Int?
    let nsfwWeight: Double?
    let segmentationWeight: Double?
    let onThreshold: Double?
    let offThreshold: Double?
    let frameDeltaThreshold: Double?
    let allowRevealDuringHardBlur: Bool?
    let revealDurationSeconds: Int?

    static let empty = ContentFilterConfigOverrides(
        fps: nil,
        hysteresisOnMs: nil,
        hysteresisOffMs: nil,
        nsfwWeight: nil,
        segmentationWeight: nil,
        onThreshold: nil,
        offThreshold: nil,
        frameDeltaThreshold: nil,
        allowRevealDuringHardBlur: nil,
        revealDurationSeconds: nil
    )
}

struct ContentFilterConfig {
    let fps: Double
    let hysteresisOnMs: Int
    let hysteresisOffMs: Int
    let nsfwWeight: Double
    let segmentationWeight: Double
    let softThreshold: Double
    let hardThreshold: Double
    let offThreshold: Double
    let frameDeltaThreshold: Double
    let allowRevealDuringHardBlur: Bool
    let revealDurationSeconds: Int

    init(
        fps: Double = 1.0,
        hysteresisOnMs: Int = 800,
        hysteresisOffMs: Int = 1500,
        nsfwWeight: Double = 0.65,
        segmentationWeight: Double = 0.35,
        onThreshold: Double = 0.60,
        offThreshold: Double = 0.35,
        frameDeltaThreshold: Double = 0.015,
        allowRevealDuringHardBlur: Bool = false,
        revealDurationSeconds: Int = 10
    ) {
        let normalizedFps = min(max(fps, 0.5), 2.0)
        let normalizedHard = min(max(onThreshold, 0.40), 0.95)
        let normalizedOff = min(max(offThreshold, 0.05), normalizedHard - 0.05)
        let normalizedSoft = min(max(normalizedHard - 0.15, normalizedOff + 0.08), normalizedHard - 0.03)

        self.fps = normalizedFps
        self.hysteresisOnMs = max(300, hysteresisOnMs)
        self.hysteresisOffMs = max(600, hysteresisOffMs)
        self.nsfwWeight = min(max(nsfwWeight, 0.0), 1.0)
        self.segmentationWeight = min(max(segmentationWeight, 0.0), 1.0)
        self.softThreshold = normalizedSoft
        self.hardThreshold = normalizedHard
        self.offThreshold = normalizedOff
        self.frameDeltaThreshold = min(max(frameDeltaThreshold, 0.002), 0.15)
        self.allowRevealDuringHardBlur = allowRevealDuringHardBlur
        self.revealDurationSeconds = max(1, min(30, revealDurationSeconds))
    }

    static func build(
        preset: ContentFilterPreset,
        kidMode: Bool,
        overrides: ContentFilterConfigOverrides
    ) -> ContentFilterConfig {
        let presetConfig: (
            fps: Double,
            hysteresisOnMs: Int,
            hysteresisOffMs: Int,
            nsfwWeight: Double,
            segmentationWeight: Double,
            onThreshold: Double,
            offThreshold: Double,
            frameDeltaThreshold: Double,
            allowRevealDuringHardBlur: Bool,
            revealDurationSeconds: Int
        )

        switch preset {
        case .balanced:
            presetConfig = (1.0, 800, 1500, 0.65, 0.35, 0.60, 0.35, 0.015, false, 10)
        case .strict:
            presetConfig = (1.25, 650, 1800, 0.70, 0.30, 0.55, 0.30, 0.012, false, 10)
        case .relaxed:
            presetConfig = (0.85, 950, 1200, 0.60, 0.40, 0.68, 0.40, 0.025, true, 10)
        }

        var fps = overrides.fps ?? presetConfig.fps
        var hysteresisOnMs = overrides.hysteresisOnMs ?? presetConfig.hysteresisOnMs
        var hysteresisOffMs = overrides.hysteresisOffMs ?? presetConfig.hysteresisOffMs
        var nsfwWeight = overrides.nsfwWeight ?? presetConfig.nsfwWeight
        var segmentationWeight = overrides.segmentationWeight ?? presetConfig.segmentationWeight
        var onThreshold = overrides.onThreshold ?? presetConfig.onThreshold
        var offThreshold = overrides.offThreshold ?? presetConfig.offThreshold
        var frameDeltaThreshold = overrides.frameDeltaThreshold ?? presetConfig.frameDeltaThreshold
        var allowRevealDuringHardBlur = overrides.allowRevealDuringHardBlur ?? presetConfig.allowRevealDuringHardBlur
        var revealDurationSeconds = overrides.revealDurationSeconds ?? presetConfig.revealDurationSeconds

        if kidMode {
            allowRevealDuringHardBlur = false
            onThreshold = min(onThreshold, 0.55)
            hysteresisOffMs = max(hysteresisOffMs, 2200)
        }

        fps = min(max(fps, 0.5), 2.0)
        hysteresisOnMs = max(300, hysteresisOnMs)
        hysteresisOffMs = max(600, hysteresisOffMs)
        nsfwWeight = min(max(nsfwWeight, 0.0), 1.0)
        segmentationWeight = min(max(segmentationWeight, 0.0), 1.0)
        onThreshold = min(max(onThreshold, 0.40), 0.95)
        offThreshold = min(max(offThreshold, 0.05), onThreshold - 0.05)
        frameDeltaThreshold = min(max(frameDeltaThreshold, 0.002), 0.15)
        revealDurationSeconds = max(1, min(30, revealDurationSeconds))

        return ContentFilterConfig(
            fps: fps,
            hysteresisOnMs: hysteresisOnMs,
            hysteresisOffMs: hysteresisOffMs,
            nsfwWeight: nsfwWeight,
            segmentationWeight: segmentationWeight,
            onThreshold: onThreshold,
            offThreshold: offThreshold,
            frameDeltaThreshold: frameDeltaThreshold,
            allowRevealDuringHardBlur: allowRevealDuringHardBlur,
            revealDurationSeconds: revealDurationSeconds
        )
    }
}

struct SegmentationFeatures {
    let personPresent: Bool
    let skinRatio: Double
    let clothingRatio: Double
    let faceRatio: Double
    let personAreaRatio: Double
    let torsoFocus: Double
    let frameDelta: Double
    let segmentationAvailable: Bool

    static let empty = SegmentationFeatures(
        personPresent: false,
        skinRatio: 0,
        clothingRatio: 0,
        faceRatio: 0,
        personAreaRatio: 0,
        torsoFocus: 0,
        frameDelta: 1,
        segmentationAvailable: false
    )
}

struct ContentFilterDecision {
    let state: ContentFilterState
    let riskScore: Double
    let nsfwScore: Double
    let segmentationScore: Double
    let shouldSoftBlur: Bool
    let shouldHardBlur: Bool
    let fps: Double
    let reason: String
    let timestampMs: Int64
    let features: SegmentationFeatures

    func toDictionary() -> [String: Any] {
        return [
            "state": state.rawValue,
            "riskScore": riskScore,
            "nsfwScore": nsfwScore,
            "segmentationScore": segmentationScore,
            "shouldSoftBlur": shouldSoftBlur,
            "shouldHardBlur": shouldHardBlur,
            "shouldBlur": shouldSoftBlur || shouldHardBlur,
            "fps": fps,
            "reason": reason,
            "timestamp": timestampMs,
            "features": [
                "personPresent": features.personPresent,
                "skinRatio": features.skinRatio,
                "clothingRatio": features.clothingRatio,
                "faceRatio": features.faceRatio,
                "personAreaRatio": features.personAreaRatio,
                "torsoFocus": features.torsoFocus,
                "frameDelta": features.frameDelta,
                "segmentationAvailable": features.segmentationAvailable
            ]
        ]
    }
}
