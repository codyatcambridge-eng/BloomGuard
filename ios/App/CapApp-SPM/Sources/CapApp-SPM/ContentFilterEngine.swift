import Foundation
import UIKit
import WebKit
import Vision

final class ContentFilterEngine {
    private let onDecision: (ContentFilterDecision) -> Void
    private let processingQueue = DispatchQueue(label: "ContentFilterEngine.processing", qos: .utility)

    private var config = ContentFilterConfig.build(
        preset: .balanced,
        kidMode: false,
        overrides: .empty
    )
    private var timer: DispatchSourceTimer?
    private var currentFps: Double = 1.0
    private var isRunning = false
    private var isProcessing = false

    private weak var targetWebView: WKWebView?
    private var appIsActive = true
    private let overlayView = ContentProtectionOverlayView()
    private var pendingOverlayUpdate: DispatchWorkItem?
    private var lastOverlayMode: ContentProtectionOverlayMode = .hidden
    private var lastOverlayAllowReveal = false
    private var awaitingFirstDecision = false

    private var nsfwScore: Double = 0
    private var nsfwTimestamp = Date.distantPast
    private let nsfwSignalHalfLifeSec: Double = 4.0

    private var lastFrameSignature: [UInt8]?
    private var safeStableSince: Date?

    private var state: ContentFilterState = .safe
    private var hardRiskStartedAt: Date?
    private var safeRiskStartedAt: Date?
    private var recentHardHits: [Bool] = []
    private var revealUntil: Date?

    private var latestDecision = ContentFilterDecision(
        state: .safe,
        riskScore: 0,
        nsfwScore: 0,
        segmentationScore: 0,
        shouldSoftBlur: false,
        shouldHardBlur: false,
        fps: 1.0,
        reason: "init",
        timestampMs: Int64(Date().timeIntervalSince1970 * 1000),
        features: .empty
    )

    init(onDecision: @escaping (ContentFilterDecision) -> Void) {
        self.onDecision = onDecision
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appDidBecomeActive),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(appWillResignActive),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInAppBrowserDidAttachWebView(_:)),
            name: .mwInAppBrowserDidAttachWebView,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInAppBrowserDidDetachWebView(_:)),
            name: .mwInAppBrowserDidDetachWebView,
            object: nil
        )
    }

    deinit {
        stop()
        NotificationCenter.default.removeObserver(self)
    }

    func start(config: ContentFilterConfig) {
        DispatchQueue.main.async {
            self.config = config
            self.isRunning = true
            self.awaitingFirstDecision = true
            self.safeStableSince = Date()
            self.currentFps = config.fps
            self.scheduleTimer(fps: config.fps)
        }
    }

    func stop() {
        DispatchQueue.main.async {
            self.isRunning = false
            self.timer?.cancel()
            self.timer = nil
            self.targetWebView = nil
            self.isProcessing = false
            self.lastFrameSignature = nil
            self.recentHardHits.removeAll()
            self.hardRiskStartedAt = nil
            self.safeRiskStartedAt = nil
            self.revealUntil = nil
            self.state = .safe
            self.pendingOverlayUpdate?.cancel()
            self.pendingOverlayUpdate = nil
            self.lastOverlayMode = .hidden
            self.lastOverlayAllowReveal = false
            self.awaitingFirstDecision = false
            self.overlayView.setMode(.hidden, animated: false, allowReveal: false, onRevealTap: nil)
            self.overlayView.detach()
        }
    }

    func setNSFWScore(_ score: Double) {
        processingQueue.async {
            self.nsfwScore = min(max(score, 0), 1)
            self.nsfwTimestamp = Date()
        }
    }

    func temporarilyReveal(seconds: Int) {
        processingQueue.async {
            self.revealUntil = Date().addingTimeInterval(TimeInterval(seconds))
            self.state = .revealTemp
        }
    }

    func currentState() -> [String: Any] {
        var dict: [String: Any] = [:]
        processingQueue.sync {
            dict = self.latestDecision.toDictionary()
            dict["running"] = self.isRunning
        }
        return dict
    }

    @objc private func appDidBecomeActive() {
        appIsActive = true
    }

    @objc private func appWillResignActive() {
        appIsActive = false
    }

    @objc private func handleInAppBrowserDidAttachWebView(_ notification: Notification) {
        guard let webView = notification.userInfo?[ContentFilterBridgeUserInfoKey.webView] as? WKWebView else {
#if DEBUG
            print("[ContentFilterEngine] attach notification missing WKWebView")
#endif
            return
        }
#if DEBUG
        print("[ContentFilterEngine] handleInAppBrowserDidAttachWebView")
#endif
        awaitingFirstDecision = true
        targetWebView = webView
        overlayView.attach(to: webView)
        overlayView.setMode(.soft, animated: false, allowReveal: false, onRevealTap: nil)
        lastOverlayMode = .soft
        lastOverlayAllowReveal = false
    }

    @objc private func handleInAppBrowserDidDetachWebView(_ notification: Notification) {
        let detachedWebView = notification.userInfo?[ContentFilterBridgeUserInfoKey.webView] as? WKWebView
        if detachedWebView == nil || detachedWebView === targetWebView {
            targetWebView = nil
            pendingOverlayUpdate?.cancel()
            pendingOverlayUpdate = nil
            lastOverlayMode = .hidden
            lastOverlayAllowReveal = false
            awaitingFirstDecision = false
            overlayView.setMode(.hidden, animated: false, allowReveal: false, onRevealTap: nil)
            overlayView.detach()
        }
    }

    private func scheduleTimer(fps: Double) {
        timer?.cancel()
        timer = nil

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
        let interval = DispatchTimeInterval.milliseconds(Int((1.0 / max(fps, 0.2)) * 1000.0))
        timer.schedule(deadline: .now() + interval, repeating: interval)
        timer.setEventHandler { [weak self] in
            self?.tick()
        }
        timer.resume()
        self.timer = timer
    }

    private func tick() {
        guard isRunning, appIsActive, !isProcessing else { return }

        guard let webView = resolveWebViewForScanning(), webView.window != nil else { return }
        guard !webView.isHidden, webView.alpha > 0.01 else { return }
        guard webView.bounds.width > 30, webView.bounds.height > 30 else { return }

        isProcessing = true

        let snapshotConfig = WKSnapshotConfiguration()
        snapshotConfig.afterScreenUpdates = false
        snapshotConfig.rect = webView.bounds

        webView.takeSnapshot(with: snapshotConfig) { [weak self] image, _ in
            guard let self else { return }
            guard let cgImage = self.cgImage(from: image) else {
                self.isProcessing = false
                return
            }

            self.processingQueue.async {
                let frameDelta = self.computeFrameDelta(cgImage: cgImage)
                let shouldSkipHeavyWork = self.shouldSkipForTier0(frameDelta: frameDelta)
                let features: SegmentationFeatures
                if shouldSkipHeavyWork {
                    features = SegmentationFeatures(
                        personPresent: false,
                        skinRatio: 0,
                        clothingRatio: 0,
                        faceRatio: 0,
                        personAreaRatio: 0,
                        torsoFocus: 0,
                        frameDelta: frameDelta,
                        segmentationAvailable: false
                    )
                } else {
                    features = self.extractSegmentationFeatures(cgImage: cgImage, frameDelta: frameDelta)
                }

                let decision = self.makeDecision(features: features)
                self.latestDecision = decision

                let targetFps = self.computeAdaptiveFPS(decision: decision)

                DispatchQueue.main.async {
                    self.onDecision(decision)
                    self.awaitingFirstDecision = false
                    self.queueOverlayUpdate(for: decision)
                    if abs(targetFps - self.currentFps) > 0.05 {
                        self.currentFps = targetFps
                        self.scheduleTimer(fps: targetFps)
                    }
                    self.isProcessing = false
                }
            }
        }
    }

    private func resolveWebViewForScanning() -> WKWebView? {
        if let webView = targetWebView, webView.window != nil {
            return webView
        }

        guard let activeScene = UIApplication.shared.connectedScenes
            .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
            return nil
        }

        let candidate = activeScene.windows
            .filter { !$0.isHidden && $0.alpha > 0.01 }
            .compactMap { $0.rootViewController?.view.findLargestWKWebView() }
            .max(by: { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height })

        targetWebView = candidate
        return candidate
    }

    private func cgImage(from image: UIImage?) -> CGImage? {
        guard let image else { return nil }
        return image.cgImage
    }

    private func computeFrameDelta(cgImage: CGImage) -> Double {
        guard let signature = makeGrayscaleSignature(cgImage: cgImage, dimension: 32) else {
            return 1
        }
        defer { lastFrameSignature = signature }
        guard let previous = lastFrameSignature, previous.count == signature.count else {
            return 1
        }

        var sumDiff: Double = 0
        for i in 0 ..< signature.count {
            sumDiff += Double(abs(Int(signature[i]) - Int(previous[i])))
        }
        return (sumDiff / Double(signature.count)) / 255.0
    }

    private func shouldSkipForTier0(frameDelta: Double) -> Bool {
        if state == .hardBlur || state == .softBlur || state == .cooldown {
            return false
        }
        if state == .revealTemp {
            return false
        }
        return frameDelta < config.frameDeltaThreshold
    }

    private func extractSegmentationFeatures(cgImage: CGImage, frameDelta: Double) -> SegmentationFeatures {
        let segmentation = runPersonSegmentation(cgImage: cgImage)

        let roiImage: CGImage
        let personAreaRatio: Double
        let personPresent: Bool
        let torsoFocus: Double

        if let segmentation, let roi = cropWithPadding(cgImage: cgImage, normalizedRect: segmentation.boundingBox, padding: 0.08) {
            roiImage = roi
            personAreaRatio = segmentation.personAreaRatio
            personPresent = segmentation.personPresent
            torsoFocus = segmentation.torsoFocus
        } else {
            roiImage = cgImage
            personAreaRatio = 0
            personPresent = false
            torsoFocus = 0
        }

        let skinRatio = estimateSkinRatio(cgImage: roiImage)
        let faceRatio = estimateFaceRatio(cgImage: roiImage)

        // TODO: When MediaPipe class labels are integrated, replace this with class-specific clothing mask ratio.
        let clothingRatio = max(0, min(1, personAreaRatio - skinRatio * 0.7))

        if segmentation == nil {
            // Tier-1 fallback when person segmentation is unavailable.
            let heuristicPerson = faceRatio > 0.005 || skinRatio > 0.12
            let fallbackPersonArea = heuristicPerson ? min(0.35, skinRatio * 2.2) : 0
            return SegmentationFeatures(
                personPresent: heuristicPerson,
                skinRatio: skinRatio,
                clothingRatio: max(0, fallbackPersonArea - skinRatio * 0.5),
                faceRatio: faceRatio,
                personAreaRatio: fallbackPersonArea,
                torsoFocus: heuristicPerson ? min(1, skinRatio * 1.4) : 0,
                frameDelta: frameDelta,
                segmentationAvailable: false
            )
        }

        return SegmentationFeatures(
            personPresent: personPresent,
            skinRatio: skinRatio,
            clothingRatio: clothingRatio,
            faceRatio: faceRatio,
            personAreaRatio: personAreaRatio,
            torsoFocus: torsoFocus,
            frameDelta: frameDelta,
            segmentationAvailable: true
        )
    }

    private func runPersonSegmentation(cgImage: CGImage) -> (personPresent: Bool, personAreaRatio: Double, boundingBox: CGRect, torsoFocus: Double)? {
        if #available(iOS 15.0, *) {
            let request = VNGeneratePersonSegmentationRequest()
            request.qualityLevel = .balanced
            request.outputPixelFormat = kCVPixelFormatType_OneComponent8

            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            do {
                try handler.perform([request])
                guard let obs = request.results?.first as? VNPixelBufferObservation else { return nil }
                let pixelBuffer = obs.pixelBuffer

                CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
                defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

                guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }

                let width = CVPixelBufferGetWidth(pixelBuffer)
                let height = CVPixelBufferGetHeight(pixelBuffer)
                let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
                let threshold: UInt8 = 110

                let pointer = baseAddress.assumingMemoryBound(to: UInt8.self)
                var minX = width
                var maxX = 0
                var minY = height
                var maxY = 0
                var personPixels = 0
                var torsoPixels = 0
                var torsoTotal = 0

                let xCenterMin = Int(Double(width) * 0.28)
                let xCenterMax = Int(Double(width) * 0.72)
                let yTorsoMin = Int(Double(height) * 0.30)
                let yTorsoMax = Int(Double(height) * 0.78)

                for y in 0 ..< height {
                    let row = pointer.advanced(by: y * bytesPerRow)
                    for x in stride(from: 0, to: width, by: 2) {
                        let value = row[x]
                        let active = value > threshold
                        if active {
                            personPixels += 1
                            minX = min(minX, x)
                            maxX = max(maxX, x)
                            minY = min(minY, y)
                            maxY = max(maxY, y)
                        }

                        if x >= xCenterMin, x <= xCenterMax, y >= yTorsoMin, y <= yTorsoMax {
                            torsoTotal += 1
                            if active {
                                torsoPixels += 1
                            }
                        }
                    }
                }

                let sampledPixelCount = max(1, (width / 2) * height)
                let personAreaRatio = Double(personPixels) / Double(sampledPixelCount)
                let personPresent = personAreaRatio > 0.02
                let torsoFocus = torsoTotal > 0 ? Double(torsoPixels) / Double(torsoTotal) : 0

                guard personPresent, minX < maxX, minY < maxY else {
                    return (false, personAreaRatio, .zero, torsoFocus)
                }

                let normRect = CGRect(
                    x: CGFloat(minX) / CGFloat(width),
                    y: CGFloat(minY) / CGFloat(height),
                    width: CGFloat(maxX - minX + 1) / CGFloat(width),
                    height: CGFloat(maxY - minY + 1) / CGFloat(height)
                ).standardized

                return (personPresent, personAreaRatio, normRect, torsoFocus)
            } catch {
                return nil
            }
        }
        return nil
    }

    private func estimateFaceRatio(cgImage: CGImage) -> Double {
        let request = VNDetectFaceRectanglesRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
            guard let results = request.results as? [VNFaceObservation], !results.isEmpty else {
                return 0
            }
            let totalArea = results.reduce(0.0) { partial, face in
                partial + (face.boundingBox.width * face.boundingBox.height)
            }
            return min(1, max(0, totalArea))
        } catch {
            return 0
        }
    }

    private func estimateSkinRatio(cgImage: CGImage) -> Double {
        let sampleWidth = 64
        let sampleHeight = 64
        let bytesPerPixel = 4
        let bytesPerRow = sampleWidth * bytesPerPixel
        var raw = [UInt8](repeating: 0, count: sampleHeight * bytesPerRow)

        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let context = CGContext(
            data: &raw,
            width: sampleWidth,
            height: sampleHeight,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return 0
        }

        context.interpolationQuality = .low
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: sampleWidth, height: sampleHeight))

        var skinPixels = 0
        var totalPixels = 0
        for i in stride(from: 0, to: raw.count, by: 4) {
            let r = Double(raw[i]) / 255.0
            let g = Double(raw[i + 1]) / 255.0
            let b = Double(raw[i + 2]) / 255.0

            let y = 0.299 * r + 0.587 * g + 0.114 * b
            let cb = (b - y) * 0.564 + 0.5
            let cr = (r - y) * 0.713 + 0.5

            let isSkin = cb >= 0.26 && cb <= 0.62 && cr >= 0.36 && cr <= 0.72 && y > 0.15
            totalPixels += 1
            if isSkin {
                skinPixels += 1
            }
        }

        guard totalPixels > 0 else { return 0 }
        return min(1, max(0, Double(skinPixels) / Double(totalPixels)))
    }

    private func makeDecision(features: SegmentationFeatures) -> ContentFilterDecision {
        let now = Date()
        let timestampMs = Int64(now.timeIntervalSince1970 * 1000)

        let effectiveNSFW = decayedNSFWScore(at: now)
        let segmentationScore = computeSegmentationRisk(features: features)
        let risk = min(1, max(0, (effectiveNSFW * config.nsfwWeight) + (segmentationScore * config.segmentationWeight)))

        let revealActive = (revealUntil != nil) && (now < (revealUntil ?? .distantPast))
        if revealActive {
            state = .revealTemp
            return ContentFilterDecision(
                state: .revealTemp,
                riskScore: risk,
                nsfwScore: effectiveNSFW,
                segmentationScore: segmentationScore,
                shouldSoftBlur: false,
                shouldHardBlur: false,
                fps: currentFps,
                reason: "reveal_temp_active",
                timestampMs: timestampMs,
                features: features
            )
        } else if revealUntil != nil {
            // Reveal window ended, continue with normal policy.
            revealUntil = nil
        }

        let hardHit = risk >= config.hardThreshold
        recentHardHits.append(hardHit)
        if recentHardHits.count > 3 {
            recentHardHits.removeFirst()
        }
        let hardCount = recentHardHits.filter { $0 }.count
        let twoOfLastThreeHard = recentHardHits.count >= 3 && hardCount >= 2

        if hardHit {
            if hardRiskStartedAt == nil {
                hardRiskStartedAt = now
            }
        } else {
            hardRiskStartedAt = nil
        }

        let hardSustained = (hardRiskStartedAt != nil)
            && (now.timeIntervalSince(hardRiskStartedAt!) * 1000.0 >= Double(config.hysteresisOnMs))

        let hardConfirmed = hardHit && (hardSustained || twoOfLastThreeHard)
        let softTriggered = risk >= config.softThreshold

        if hardConfirmed {
            state = .hardBlur
            safeRiskStartedAt = nil
            safeStableSince = nil
        } else if softTriggered {
            state = .softBlur
            safeRiskStartedAt = nil
            safeStableSince = nil
        } else if risk <= config.offThreshold {
            if safeRiskStartedAt == nil {
                safeRiskStartedAt = now
            }

            let safeElapsedMs = now.timeIntervalSince(safeRiskStartedAt!) * 1000.0
            if safeElapsedMs >= Double(config.hysteresisOffMs) {
                state = .safe
                safeStableSince = safeStableSince ?? now
                recentHardHits.removeAll()
            } else {
                // Keep a low-friction blur while waiting for sustained safe window.
                state = .cooldown
            }
        } else {
            safeRiskStartedAt = nil
            state = (state == .hardBlur || state == .softBlur || state == .cooldown) ? .softBlur : .safe
            if state == .safe {
                safeStableSince = safeStableSince ?? now
            } else {
                safeStableSince = nil
            }
        }

        let shouldSoft = state == .softBlur || state == .hardBlur || state == .cooldown
        let shouldHard = state == .hardBlur
        let reason = buildReason(
            risk: risk,
            hardConfirmed: hardConfirmed,
            softTriggered: softTriggered
        )

        return ContentFilterDecision(
            state: state,
            riskScore: risk,
            nsfwScore: effectiveNSFW,
            segmentationScore: segmentationScore,
            shouldSoftBlur: shouldSoft,
            shouldHardBlur: shouldHard,
            fps: currentFps,
            reason: reason,
            timestampMs: timestampMs,
            features: features
        )
    }

    private func computeSegmentationRisk(features: SegmentationFeatures) -> Double {
        if !features.personPresent {
            return max(0, min(1, features.skinRatio * 0.35))
        }

        var score = 0.18
        score += min(0.40, features.skinRatio * 0.85)
        score += min(0.18, features.faceRatio * 0.90)
        score += min(0.16, features.personAreaRatio * 0.70)
        score += min(0.12, features.torsoFocus * 0.35)

        if features.clothingRatio > 0.45 {
            score -= 0.08
        }

        return min(1, max(0, score))
    }

    private func decayedNSFWScore(at now: Date) -> Double {
        let age = now.timeIntervalSince(nsfwTimestamp)
        if age <= 0 {
            return nsfwScore
        }
        let decay = pow(0.5, age / nsfwSignalHalfLifeSec)
        return min(1, max(0, nsfwScore * decay))
    }

    private func computeAdaptiveFPS(decision: ContentFilterDecision) -> Double {
        if decision.state == .hardBlur || decision.state == .softBlur || decision.state == .cooldown {
            return 2.0
        }

        if decision.riskScore >= max(config.softThreshold - 0.08, config.offThreshold + 0.03) {
            return 2.0
        }

        if decision.state == .safe {
            if safeStableSince == nil {
                safeStableSince = Date()
            }
            if let stableSince = safeStableSince, Date().timeIntervalSince(stableSince) > 10, decision.features.frameDelta < 0.02 {
                return 0.65
            }
            return max(1.0, config.fps)
        }

        return config.fps
    }

    private func buildReason(risk: Double, hardConfirmed: Bool, softTriggered: Bool) -> String {
        if hardConfirmed {
            return "hard_confirmed"
        }
        if softTriggered {
            return "soft_triggered"
        }
        if risk <= config.offThreshold {
            return "safe_hysteresis"
        }
        return "safe"
    }

    private func cropWithPadding(cgImage: CGImage, normalizedRect: CGRect, padding: Double) -> CGImage? {
        guard !normalizedRect.isEmpty else { return nil }
        var rect = normalizedRect.standardized
        rect.origin.x = max(0, rect.origin.x - rect.width * padding)
        rect.origin.y = max(0, rect.origin.y - rect.height * padding)
        rect.size.width = min(1 - rect.origin.x, rect.width * (1 + padding * 2))
        rect.size.height = min(1 - rect.origin.y, rect.height * (1 + padding * 2))

        let pixelRect = CGRect(
            x: rect.origin.x * CGFloat(cgImage.width),
            y: rect.origin.y * CGFloat(cgImage.height),
            width: rect.width * CGFloat(cgImage.width),
            height: rect.height * CGFloat(cgImage.height)
        ).integral

        guard pixelRect.width > 2, pixelRect.height > 2 else { return nil }
        return cgImage.cropping(to: pixelRect)
    }

    private func makeGrayscaleSignature(cgImage: CGImage, dimension: Int) -> [UInt8]? {
        var pixels = [UInt8](repeating: 0, count: dimension * dimension)
        let colorSpace = CGColorSpaceCreateDeviceGray()
        guard let context = CGContext(
            data: &pixels,
            width: dimension,
            height: dimension,
            bitsPerComponent: 8,
            bytesPerRow: dimension,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else {
            return nil
        }

        context.interpolationQuality = .low
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: dimension, height: dimension))
        return pixels
    }

    private func queueOverlayUpdate(for decision: ContentFilterDecision, immediate: Bool = false) {
        var presentation = overlayPresentation(for: decision)
        if awaitingFirstDecision {
            presentation = (.soft, false)
        }
        if presentation.mode == lastOverlayMode, presentation.allowReveal == lastOverlayAllowReveal {
            return
        }

        pendingOverlayUpdate?.cancel()
        let update = DispatchWorkItem { [weak self] in
            guard let self else { return }

            if let webView = self.targetWebView {
                self.overlayView.attach(to: webView)
            }

            self.overlayView.setMode(
                presentation.mode,
                animated: true,
                allowReveal: presentation.allowReveal,
                onRevealTap: presentation.allowReveal ? { [weak self] in
                    guard let self else { return }
                    self.temporarilyReveal(seconds: self.config.revealDurationSeconds)
                } : nil
            )
            self.lastOverlayMode = presentation.mode
            self.lastOverlayAllowReveal = presentation.allowReveal
        }
        pendingOverlayUpdate = update

        let shouldApplyImmediately = immediate || presentation.mode != .hidden
        if shouldApplyImmediately {
            DispatchQueue.main.async(execute: update)
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(180), execute: update)
        }
    }

    private func overlayPresentation(for decision: ContentFilterDecision) -> (mode: ContentProtectionOverlayMode, allowReveal: Bool) {
        switch decision.state {
        case .hardBlur:
            return (.hard, config.allowRevealDuringHardBlur)
        case .softBlur, .cooldown:
            return (.soft, false)
        case .safe, .revealTemp:
            return (.hidden, false)
        }
    }
}

private extension UIView {
    func findLargestWKWebView() -> WKWebView? {
        var best: WKWebView?
        var bestArea: CGFloat = 0

        func visit(_ view: UIView) {
            if let webView = view as? WKWebView {
                let area = webView.bounds.width * webView.bounds.height
                if area > bestArea, webView.window != nil, !webView.isHidden, webView.alpha > 0.01 {
                    best = webView
                    bestArea = area
                }
            }
            for subview in view.subviews {
                visit(subview)
            }
        }

        visit(self)
        return best
    }
}
