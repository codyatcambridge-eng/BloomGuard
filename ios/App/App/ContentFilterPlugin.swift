@preconcurrency import Capacitor
import CoreImage
import CoreVideo
import CoreML
import os
import UIKit
import Vision

private enum PluginError: LocalizedError, Equatable {
  case missingPayload
  case invalidImageData
  case modelNotFound(name: String)
  case modelUnavailable

  var errorDescription: String? {
    switch self {
    case .missingPayload:
      return "A Base64-encoded image must be provided."
    case .invalidImageData:
      return "Unable to decode the supplied image."
    case .modelNotFound(let name):
      return "Core ML model '\(name)' is not bundled."
    case .modelUnavailable:
      return "The Core ML model could not be initialized."
    }
  }
}

@objc(ContentFilterPlugin)
public class ContentFilterPlugin: CAPPlugin {
  private let inferenceQueue = DispatchQueue(
    label: "com.goodcreation.contentfilter.inference",
    qos: .userInitiated
  )
  private let logger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "com.goodcreation.contentfilter",
    category: "ContentFilter"
  )
  private lazy var ciContext = CIContext()
  private var visionModel: VNCoreMLModel?
  private var modelLoaded = false
  private var expectedInputSize = CGSize(width: 224, height: 224)
  private let modelResourceName = "LoverboyNSFW"
  private let blurThresholds: [String: Double] = [
    "Porn/Hentai": 0.3,
    "Sexy": 0.2,
  ]

  override public func load() {
    super.load()
    inferenceQueue.async { [weak self] in
      guard let self = self else { return }
      do {
        try self.prepareCoreMLModel()
        self.logger.debug("Vision model loaded for \(self.modelResourceName)")
      } catch {
        self.logger.error("Core ML model preparation failed: \(error.localizedDescription)")
      }
    }
  }

  @MainActor
  @objc public func startScanning(_ call: CAPPluginCall) {
    var payload: [String: Any] = ["started": true, "platform": "ios"]
    if let preset = call.getString("preset") {
      payload["preset"] = preset
    }
    call.resolve(payload)
  }

  @MainActor
  @objc public func stopScanning(_ call: CAPPluginCall) {
    call.resolve(["stopped": true])
  }

  @MainActor
  @objc public func getCounters(_ call: CAPPluginCall) {
    call.resolve(["softBlurCount": 0, "hardBlurCount": 0])
  }

  @MainActor
  @objc public func resetCounters(_ call: CAPPluginCall) {
    call.resolve(["reset": true])
  }

  @MainActor
  @objc public func setNSFWSignal(_ call: CAPPluginCall) {
    let score = call.getDouble("score") ?? 0
    logger.info("setNSFWSignal score=\(score)")
    if let rawProbs: JSObject = call.getObject("probs") {
      let sanitized = rawProbs.compactMapValues { rawValue -> Double? in
        if rawValue is NSNull { return nil }
        if let number = rawValue as? Double { return number }
        if let number = rawValue as? Int { return Double(number) }
        if let string = rawValue as? String, let parsed = Double(string) { return parsed }
        return nil
      }
      logger.debug("Received probabilities: \(sanitized)")
    }
    call.resolve()
  }

  @MainActor
  @objc public func isModelReady(_ call: CAPPluginCall) {
    call.resolve(["ready": modelLoaded && visionModel != nil])
  }

  @MainActor
  @objc public func classifyImage(_ call: CAPPluginCall) {
    guard let rawBase64 = call.getString("imageBase64") else {
      call.reject("missing_image", PluginError.missingPayload.errorDescription, PluginError.missingPayload)
      return
    }
    Task.detached(priority: .userInitiated) { [weak self, weak call] in
      guard let self = self else {
        guard let call = call else { return }
        Task { @MainActor in
          call.reject("inference_cancelled", "Plugin instance was deallocated before inference could run", nil)
        }
        return
      }

      do {
        let uiImage = try self.image(from: rawBase64)
        let cgImage = try self.resizedCGImage(from: uiImage)
        guard let model = self.visionModel else {
          throw PluginError.modelUnavailable
        }

        let inferenceStart = Date()
        let request = VNCoreMLRequest(model: model) { [weak self, weak call] request, error in
          let inferenceTimeMs = Date().timeIntervalSince(inferenceStart) * 1000
          self?.logger.debug("Inference End: \(inferenceTimeMs) ms")

          if let error = error {
            guard let call = call else { return }
            Task { @MainActor in
              call.reject("inference_error", error.localizedDescription, error)
            }
            return
          }

          let observations = (request.results as? [VNClassificationObservation]) ?? []
          let predictions = observations.reduce(into: [String: Double]()) { acc, observation in
            acc[observation.identifier] = Double(observation.confidence)
          }
          let confidence = Double(observations.first?.confidence ?? 0)
          let blurReasons = self?.blurReasons(from: predictions) ?? []
          let shouldBlur = !blurReasons.isEmpty

          guard let call = call else { return }
          Task { @MainActor in
            call.resolve([
              "predictions": predictions,
              "confidence": confidence,
              "inferenceTimeMs": inferenceTimeMs,
              "shouldBlur": shouldBlur,
              "blurReasons": blurReasons,
            ])
          }
        }

        request.imageCropAndScaleOption = .scaleFill
        self.logger.debug("Inference Start")
        let pixelBuffer = try self.pixelBuffer(from: cgImage)
        try autoreleasepool {
          let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
          try handler.perform([request])
        }
      } catch {
        guard let call = call else { return }
        Task { @MainActor in
          let nsError = error as NSError
          let isNeuralOffline =
            (error is PluginError && (error as? PluginError) == .modelUnavailable) ||
            nsError.domain.lowercased().contains("ane") ||
            nsError.localizedDescription.lowercased().contains("neural")
          let code = isNeuralOffline ? "NPU_OFFLINE" : "classification_failed"
          call.reject(code, error.localizedDescription, error)
        }
      }
    }
  }

  private func prepareCoreMLModel() throws {
    let configuration = MLModelConfiguration()
    configuration.computeUnits = .all // Prefer ANE but allow CPU/GPU fallback
    modelLoaded = false

    guard let rawModelURL = Bundle.main.url(forResource: modelResourceName, withExtension: "mlmodel") else {
      logger.error("Missing \(self.modelResourceName).mlmodel – drag LoverboyNSFW.mlmodel into the Xcode target and ensure it is included in the app bundle.")
      throw PluginError.modelNotFound(name: modelResourceName)
    }

    let compiledURL = try MLModel.compileModel(at: rawModelURL)
    let coreMLModel = try MLModel(contentsOf: compiledURL, configuration: configuration)

    if let imageConstraint = coreMLModel.modelDescription.inputDescriptionsByName.values.first(where: { $0.type == .image })?.imageConstraint {
      expectedInputSize = CGSize(width: imageConstraint.pixelsWide, height: imageConstraint.pixelsHigh)
    }

    visionModel = try VNCoreMLModel(for: coreMLModel)
    modelLoaded = true
  }

  private func image(from base64: String) throws -> UIImage {
    let cleaned = cleanedBase64(base64)
    guard let data = Data(base64Encoded: cleaned, options: .ignoreUnknownCharacters),
          let image = UIImage(data: data) else {
      throw PluginError.invalidImageData
    }
    return image
  }

  private func cleanedBase64(_ raw: String) -> String {
    var payload = raw
    if let commaRange = payload.range(of: ",") {
      payload = String(payload[commaRange.upperBound...])
    }
    return payload.replacingOccurrences(of: "\\s", with: "", options: .regularExpression)
  }

  private func resizedCGImage(from image: UIImage) throws -> CGImage {
    let sourceCGImage: CGImage
    if let cg = image.cgImage {
      sourceCGImage = cg
    } else if let ci = image.ciImage {
      guard let converted = ciContext.createCGImage(ci, from: ci.extent) else {
        throw PluginError.invalidImageData
      }
      sourceCGImage = converted
    } else {
      throw PluginError.invalidImageData
    }

    let width = max(1, Int(expectedInputSize.width))
    let height = max(1, Int(expectedInputSize.height))
    guard let context = CGContext(
      data: nil,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
      throw PluginError.invalidImageData
    }

    context.interpolationQuality = .high
    context.draw(sourceCGImage, in: CGRect(origin: .zero, size: CGSize(width: width, height: height)))
    guard let resized = context.makeImage() else {
      throw PluginError.invalidImageData
    }
    return resized
  }

  private func pixelBuffer(from cgImage: CGImage) throws -> CVPixelBuffer {
    let width = cgImage.width
    let height = cgImage.height

    let pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
    var pixelBuffer: CVPixelBuffer?
    let attrs: [CFString: Any] = [
      kCVPixelBufferCGImageCompatibilityKey: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey: true,
      kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary
    ]

    let status = CVPixelBufferCreate(
      kCFAllocatorDefault,
      width,
      height,
      pixelFormat,
      attrs as CFDictionary,
      &pixelBuffer
    )

    guard status == kCVReturnSuccess, let buffer = pixelBuffer else {
      throw PluginError.invalidImageData
    }

    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

    let ciImage = CIImage(cgImage: cgImage)
    ciContext.render(ciImage, to: buffer)

    return buffer
  }

  private func blurReasons(from predictions: [String: Double]) -> [String] {
    blurThresholds.compactMap { category, threshold in
      let value = predictions[category] ?? 0
      return value > threshold ? category : nil
    }
  }
}
