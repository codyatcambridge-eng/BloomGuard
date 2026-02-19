import Capacitor
import FamilyControls
import ManagedSettings
import SwiftUI
import UIKit

@available(iOS 15.0, *)
@objc(ScreenTimePlugin)
public class ScreenTimePlugin: CAPPlugin {
  private let settingsStore = ManagedSettings.ManagedSettingsStore()
  private let authorizationCenter = FamilyControls.AuthorizationCenter.shared
  private var pendingPickerCall: CAPPluginCall?
  private var pickerController: UIViewController?
  private let sharedStore = ScreenTimeSharedStore()
  private let isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()
  private let tokenEncoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }()
  private let tokenDecoder = JSONDecoder()
  private let selectionEncoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }()
  private let selectionDecoder = JSONDecoder()

  private var runningOnSimulator: Bool {
    ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"] != nil
  }

  private var supportsFamilyControls: Bool {
    guard !runningOnSimulator else { return false }
    guard #available(iOS 15.0, *) else { return false }
    return true
  }

  private func resolveStatus(for call: CAPPluginCall, authorized: Bool, reason: String? = nil) {
    var payload: [String: Any] = ["supported": true, "authorized": authorized]
    if let reason {
      payload["reason"] = reason
    }
    call.resolve(payload)
  }

  private func unsupportedStatus(for call: CAPPluginCall, reason: String? = nil) {
    call.resolve([
      "supported": false,
      "authorized": false,
      "reason": reason ?? "family_controls_unavailable",
    ])
  }

  private func safeRuntimeErrorReason(_ error: Error) -> String {
    "family_controls_runtime_unavailable"
  }

  @objc func getScreenTimeStatus(_ call: CAPPluginCall) {
    if runningOnSimulator {
      unsupportedStatus(for: call, reason: "simulator_unsupported")
      return
    }
    guard supportsFamilyControls else {
      unsupportedStatus(for: call, reason: "ios_version_unsupported")
      return
    }
    let authorized = authorizationCenter.authorizationStatus == .approved
    resolveStatus(for: call, authorized: authorized)
  }

  @objc func requestScreenTimeAuthorization(_ call: CAPPluginCall) {
    guard supportsFamilyControls else {
      unsupportedStatus(for: call)
      return
    }

    if #available(iOS 16.0, *) {
      Task {
        do {
          try await authorizationCenter.requestAuthorization(for: .individual)
          let authorized = authorizationCenter.authorizationStatus == .approved
          resolveStatus(for: call, authorized: authorized)
        } catch {
          unsupportedStatus(for: call, reason: safeRuntimeErrorReason(error))
        }
      }
      return
    }

    authorizationCenter.requestAuthorization { [weak self] result in
      guard let self else { return }
      switch result {
      case .success:
        let authorized = self.authorizationCenter.authorizationStatus == .approved
        self.resolveStatus(for: call, authorized: authorized)
      case .failure(let error):
        self.unsupportedStatus(for: call, reason: self.safeRuntimeErrorReason(error))
      }
    }
  }

  @objc func presentFamilyActivityPicker(_ call: CAPPluginCall) {
    guard supportsFamilyControls else {
      call.resolve(["supported": false, "error": "family_controls_unavailable"])
      return
    }

    guard pendingPickerCall == nil else {
      call.reject("picker_busy", "A picker session is already in progress")
      return
    }

    let initialBlob = call.getString("blob")
    let initialSelection = try? decodeSelection(from: initialBlob)
    pendingPickerCall = call

    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      guard let presenter = self.bridge?.viewController ?? UIApplication.shared.connectedScenes
        .compactMap({ $0 as? UIWindowScene })
        .flatMap({ $0.windows })
        .first(where: { $0.isKeyWindow })?.rootViewController
      else {
        self.finishPicker(result: .failure(.uiUnavailable))
        return
      }

      let contentView = ScreenTimePickerView(initialSelection: initialSelection ?? FamilyControls.FamilyActivitySelection()) { selection in
        self.finishPicker(result: .success(selection))
      } onCancel: {
        self.finishPicker(result: .cancelled)
      }

      let hosting = UIHostingController(rootView: contentView)
      hosting.modalPresentationStyle = .pageSheet
      self.pickerController = hosting
      presenter.present(hosting, animated: true)
    }
  }

  private func finishPicker(result: PickerResult) {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      defer {
        self.pendingPickerCall = nil
        self.pickerController?.dismiss(animated: true, completion: nil)
        self.pickerController = nil
      }

      guard let call = self.pendingPickerCall else { return }

      switch result {
      case .success(let selection):
        do {
          let blob = try self.encodeSelectionBlob(from: selection)
          let total = selection.applicationTokens.count + selection.categoryTokens.count + selection.webDomainTokens.count
          var payload: [String: Any] = ["blob": blob, "selectedCount": total]
          call.resolve(payload)
        } catch {
          call.reject("encoding_error", error.localizedDescription)
        }
      case .cancelled:
        call.reject("user_cancelled", "User cancelled the picker")
      case .failure(let error):
        call.resolve(["supported": false, "error": error.rawValue])
      }
    }
  }

  @objc func applyShieldRestrictions(_ call: CAPPluginCall) {
    guard supportsFamilyControls else {
      call.resolve(["success": false, "supported": false, "error": "family_controls_unavailable"])
      return
    }

    guard let blob = call.getString("selectionBlob") else {
      call.resolve(["success": false, "error": "missing_selection_blob"])
      return
    }

    do {
      let selection = try decodeSelection(from: blob)
      apply(selection: selection)
      storeScheduleEntries(from: call, selectionBlob: blob)
      call.resolve(["success": true])
    } catch {
      call.resolve(["success": false, "supported": false, "error": safeRuntimeErrorReason(error)])
    }
  }

  @objc func clearShieldRestrictions(_ call: CAPPluginCall) {
    guard supportsFamilyControls else {
      call.resolve(["success": false, "supported": false, "error": "family_controls_unavailable"])
      return
    }
    clearAppliedRestrictions()
    call.resolve(["success": true])
  }

  private func apply(selection: FamilyControls.FamilyActivitySelection) {
    settingsStore.shield.applications = selection.applicationTokens
    settingsStore.shield.webDomains = selection.webDomainTokens
    if selection.categoryTokens.isEmpty {
      settingsStore.shield.applicationCategories = nil
    } else {
      settingsStore.shield.applicationCategories = .specific(selection.categoryTokens, except: [])
    }
  }

  private func clearAppliedRestrictions() {
    settingsStore.shield.applications = nil
    settingsStore.shield.applicationCategories = nil
    settingsStore.shield.webDomains = nil
    settingsStore.shield.webDomainCategories = nil
    sharedStore.clearAll()
  }

  private func storeScheduleEntries(from call: CAPPluginCall, selectionBlob: String) {
    guard let shieldId = call.getString("shieldId") else {
      sharedStore.clearAll()
      return
    }

    guard let windows = call.getArray("windows") as? [[String: Any]], !windows.isEmpty else {
      sharedStore.clearAll()
      return
    }

    let strictness = call.getInt("strictness")
    let timestamp = call.getString("timestamp") ?? isoFormatter.string(from: Date())

    let entries = windows.enumerated().compactMap { index, rawWindow -> ScreenTimeScheduleEntry? in
      guard let startString = rawWindow["startTime"] as? String,
            let endString = rawWindow["endTime"] as? String,
            let startMin = Self.minutes(from: startString),
            let endMin = Self.minutes(from: endString) else {
        return nil
      }

      let daysMask = Self.daysMask(from: rawWindow["days"])
      let scheduleId = "mw_shield_\(shieldId)_win_\(index)"

      let window = ScreenTimeScheduleWindow(
        startMin: startMin,
        endMin: endMin,
        daysMask: daysMask
      )

      return ScreenTimeScheduleEntry(
        scheduleId: scheduleId,
        shieldId: shieldId,
        strictness: strictness,
        window: window,
        selectionBlob: selectionBlob,
        updatedAt: timestamp
      )
    }

    if entries.isEmpty {
      sharedStore.clearAll()
    } else {
      sharedStore.replaceSchedules(with: entries)
    }
  }

  private static func minutes(from time: String) -> Int? {
    let parts = time.split(separator: ":")
    guard parts.count == 2,
          let hours = Int(parts[0]),
          let minutes = Int(parts[1]),
          hours >= 0, hours < 24,
          minutes >= 0, minutes < 60 else {
      return nil
    }
    return hours * 60 + minutes
  }

  private static func daysMask(from rawDays: Any?) -> Int {
    guard let array = rawDays as? [Any] else { return 0 }
    var mask = 0
    for value in array {
      let intValue: Int?
      if let number = value as? NSNumber {
        intValue = number.intValue
      } else if let int = value as? Int {
        intValue = int
      } else if let string = value as? String {
        intValue = Int(string)
      } else {
        intValue = nil
      }
      guard let day = intValue, day >= 0, day <= 6 else { continue }
      mask |= (1 << day)
    }
    return mask
  }

  private func encodeSelectionBlob(from selection: FamilyControls.FamilyActivitySelection) throws -> String {
    let serializable = try SerializableSelection(from: selection, encoder: tokenEncoder)
    let selectionData = try selectionEncoder.encode(serializable)
    let blob = SelectionBlob(
      v: 1,
      selection: selectionData.base64EncodedString(),
      createdAt: isoFormatter.string(from: Date())
    )
    let blobData = try selectionEncoder.encode(blob)
    return blobData.base64EncodedString()
  }

  private func decodeSelection(from blob: String?) throws -> FamilyControls.FamilyActivitySelection {
    guard let blob else { throw ScreenTimeError.invalidBlob }
    guard let blobData = Data(base64Encoded: blob) else {
      throw ScreenTimeError.invalidBlob
    }
    let decodedBlob = try selectionDecoder.decode(SelectionBlob.self, from: blobData)
    guard decodedBlob.v == 1 else {
      throw ScreenTimeError.unsupportedVersion
    }
    guard let selectionData = Data(base64Encoded: decodedBlob.selection) else {
      throw ScreenTimeError.invalidBlob
    }
    let serializable = try selectionDecoder.decode(SerializableSelection.self, from: selectionData)
    return try serializable.toFamilyActivitySelection(using: tokenDecoder)
  }
}

@available(iOS 15.0, *)
extension ScreenTimePlugin {
  enum PickerResult {
    case success(FamilyControls.FamilyActivitySelection)
    case cancelled
    case failure(ScreenTimeError)
  }

  enum ScreenTimeError: String, Error {
    case invalidBlob
    case unsupportedVersion
    case uiUnavailable = "family_controls_runtime_unavailable"
  }
}

@available(iOS 15.0, *)
private struct SelectionBlob: Codable {
  let v: Int
  let selection: String
  let createdAt: String
}

@available(iOS 15.0, *)
private struct SerializableSelection: Codable {
  let includeEntireCategory: Bool
  let applicationTokens: [String]
  let categoryTokens: [String]
  let webDomainTokens: [String]

  init(from selection: FamilyControls.FamilyActivitySelection, encoder: JSONEncoder) throws {
    if #available(iOS 15.2, *) {
      includeEntireCategory = selection.includeEntireCategory
    } else {
      includeEntireCategory = false
    }
    applicationTokens = try Self.encodeTokens(selection.applicationTokens, using: encoder)
    categoryTokens = try Self.encodeTokens(selection.categoryTokens, using: encoder)
    webDomainTokens = try Self.encodeTokens(selection.webDomainTokens, using: encoder)
  }

  func toFamilyActivitySelection(using decoder: JSONDecoder) throws -> FamilyControls.FamilyActivitySelection {
    var selection: FamilyControls.FamilyActivitySelection
    if #available(iOS 15.2, *) {
      selection = FamilyControls.FamilyActivitySelection(includeEntireCategory: includeEntireCategory)
    } else {
      selection = FamilyControls.FamilyActivitySelection()
    }
    selection.applicationTokens = try Self.decodeTokens(applicationTokens, using: decoder)
    selection.categoryTokens = try Self.decodeTokens(categoryTokens, using: decoder)
    selection.webDomainTokens = try Self.decodeTokens(webDomainTokens, using: decoder)
    return selection
  }

  private static func encodeTokens<T: Hashable & Codable>(_ tokens: Set<T>, using encoder: JSONEncoder) throws -> [String] {
    try tokens.map { token in
      let data = try encoder.encode(token)
      return data.base64EncodedString()
    }
    .sorted()
  }

  private static func decodeTokens<T: Hashable & Codable>(_ values: [String], using decoder: JSONDecoder) throws -> Set<T> {
    var decoded = Set<T>()
    for value in values {
      guard let data = Data(base64Encoded: value) else {
        throw ScreenTimePlugin.ScreenTimeError.invalidBlob
      }
      let token = try decoder.decode(T.self, from: data)
      decoded.insert(token)
    }
    return decoded
  }
}

@available(iOS 15.0, *)
private struct ScreenTimePickerView: View {
  @State private var selection: FamilyControls.FamilyActivitySelection
  let onDone: (FamilyControls.FamilyActivitySelection) -> Void
  let onCancel: () -> Void

  init(initialSelection: FamilyControls.FamilyActivitySelection, onDone: @escaping (FamilyControls.FamilyActivitySelection) -> Void, onCancel: @escaping () -> Void) {
    self._selection = State(initialValue: initialSelection)
    self.onDone = onDone
    self.onCancel = onCancel
  }

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $selection)
        .navigationTitle("Choose Shielded Apps")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel", action: onCancel)
          }
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") {
              onDone(selection)
            }
          }
        }
    }
  }
}
