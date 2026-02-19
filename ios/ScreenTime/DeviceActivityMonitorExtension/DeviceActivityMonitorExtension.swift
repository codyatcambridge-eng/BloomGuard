import DeviceActivity
import FamilyControls
import ManagedSettings

@available(iOS 15.0, *)
final class DeviceActivityMonitorExtension: DeviceActivityMonitor {
  private let settingsStore = ManagedSettings.ManagedSettingsStore()
  private let sharedStore = ScreenTimeSharedStore()
  private let selectionDecoder = JSONDecoder()
  private let tokenDecoder = JSONDecoder()

  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    let scheduleId = activity.rawValue
    print("[ScreenTime][DIAG] intervalDidStart for \(scheduleId)")

    guard let entry = sharedStore.schedule(for: scheduleId) else {
      print("[ScreenTime][DIAG] no schedule entry for \(scheduleId)")
      return
    }

    guard let selection = tryDecodeSelection(from: entry.selectionBlob) else {
      print("[ScreenTime][DIAG] failed to decode selection for \(scheduleId)")
      return
    }

    apply(selection: selection)
    print("[ScreenTime][DIAG] applied restrictions for \(scheduleId)")
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    let scheduleId = activity.rawValue
    print("[ScreenTime][DIAG] intervalDidEnd for \(scheduleId); clearing restrictions")
    clearAppliedRestrictions()
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
  }

  private func tryDecodeSelection(from blob: String) -> FamilyControls.FamilyActivitySelection? {
    guard let blobData = Data(base64Encoded: blob) else { return nil }
    guard let decodedBlob = try? selectionDecoder.decode(SelectionBlob.self, from: blobData),
          decodedBlob.v == 1,
          let selectionData = Data(base64Encoded: decodedBlob.selection),
          let serializable = try? selectionDecoder.decode(SerializableSelection.self, from: selectionData)
    else {
      return nil
    }
    return try? serializable.toFamilyActivitySelection(using: tokenDecoder)
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
        throw SelectionDecodeError.invalidBlob
      }
      let token = try decoder.decode(T.self, from: data)
      decoded.insert(token)
    }
    return decoded
  }
}

@available(iOS 15.0, *)
private enum SelectionDecodeError: Error {
  case invalidBlob
}
