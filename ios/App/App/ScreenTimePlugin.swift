import Capacitor
import Foundation

#if canImport(FamilyControls)
import FamilyControls
#endif

#if canImport(ManagedSettings)
import ManagedSettings
#endif

@objc(ScreenTimePlugin)
public class ScreenTimePlugin: CAPPlugin {
  private static let simulatedSuccess: Bool = {
    #if DEBUG
    true
    #else
    false
    #endif
  }()

  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()
  private lazy var isoFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()

  @available(iOS 15.0, *)
  private lazy var managedStore: ManagedSettingsStore? = {
    ManagedSettingsStore()
  }()

  // MARK: - Screen Time status

  @objc public func getScreenTimeStatus(_ call: CAPPluginCall) {
    if Self.simulatedSuccess {
      call.resolve([
        "supported": true,
        "authorized": true,
      ])
      return
    }

    guard #available(iOS 15.0, *) else {
      call.resolve([
        "supported": false,
        "authorized": false,
        "reason": "unsupported_platform",
      ])
      return
    }

    let status = AuthorizationCenter.shared.authorizationStatus
    call.resolve(statusPayload(from: status))
  }

  @objc public func requestScreenTimeAuthorization(_ call: CAPPluginCall) {
    if Self.simulatedSuccess {
      call.resolve([
        "supported": true,
        "authorized": true,
      ])
      return
    }

    guard #available(iOS 16.0, *) else {
      call.resolve([
        "supported": false,
        "authorized": false,
        "reason": "unsupported_platform",
      ])
      return
    }

    Task {
      do {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        let status = AuthorizationCenter.shared.authorizationStatus
        call.resolve(statusPayload(from: status))
      } catch {
        call.reject("authorization_failed", error.localizedDescription, error)
      }
    }
  }

  @objc public func presentFamilyActivityPicker(_ call: CAPPluginCall) {
    let shieldId = call.getString("shieldId")

    if Self.simulatedSuccess {
      call.resolve(simulatedPickerResult(shieldId: shieldId))
      return
    }

    guard #available(iOS 15.0, *) else {
      call.reject("unsupported_platform", "Family Activity picker requires iOS 15+")
      return
    }

    let selection = FamilyActivitySelection()
    let payload = makeSelectionBlob(shieldId: shieldId, selection: selection)

    call.resolve([
      "blob": payload ?? "",
      "selectedCount": selection.applicationTokens.count + selection.categoryTokens.count,
      "label": "Family Activity selection",
    ])
  }

  @objc public func applyShieldRestrictions(_ call: CAPPluginCall) {
    if Self.simulatedSuccess {
      applySimulatedShieldChanges()
      call.resolve(["success": true])
      return
    }

    guard #available(iOS 15.0, *) else {
      call.resolve(["success": false])
      return
    }

    guard let blob = call.getString("selectionBlob"), let selection = decodeSelection(from: blob) else {
      call.resolve(["success": false])
      return
    }

    mutateShieldStore { store in
      store.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens
      if selection.categoryTokens.isEmpty {
        store.shield.applicationCategories = .none
      } else {
        store.shield.applicationCategories = .specific(selection.categoryTokens, except: [])
      }
      store.shield.webDomains = nil
      store.shield.webDomainCategories = .none
    }
    call.resolve(["success": true])
  }

  @objc public func clearShieldRestrictions(_ call: CAPPluginCall) {
    if Self.simulatedSuccess {
      applySimulatedShieldChanges()
      call.resolve(["success": true])
      return
    }

    guard #available(iOS 15.0, *) else {
      call.resolve(["success": false])
      return
    }

    mutateShieldStore { store in
      if #available(iOS 16.0, *) {
        store.clearAllSettings()
      } else {
        store.shield.applications = nil
        store.shield.applicationCategories = .none
        store.shield.webDomains = nil
        store.shield.webDomainCategories = .none
      }
    }
    call.resolve(["success": true])
  }

  // MARK: - Helpers

  private func statusPayload(from status: AuthorizationStatus) -> [String: Any] {
    [
      "supported": true,
      "authorized": status == .approved,
      "reason": reason(for: status),
    ]
  }

  private func reason(for status: AuthorizationStatus) -> String {
    switch status {
    case .approved:
      return "authorized"
    case .denied:
      return "denied"
    case .notDetermined:
      return "not_determined"
    @unknown default:
      return "unknown"
    }
  }

  private func mutateShieldStore(_ block: @escaping (ManagedSettingsStore) -> Void) {
    #if canImport(ManagedSettings)
    guard let store = managedStore else { return }
    DispatchQueue.main.async {
      block(store)
    }
    #endif
  }

  private func decodeSelection(from blob: String) -> FamilyActivitySelection? {
    guard let metaData = Data(base64Encoded: blob), let meta = try? decoder.decode(ScreenTimeSelectionMeta.self, from: metaData) else {
      return nil
    }
    guard let payload = meta.selectionPayload, let selectionData = Data(base64Encoded: payload) else {
      return nil
    }
    return try? decoder.decode(FamilyActivitySelection.self, from: selectionData)
  }

  private func makeSelectionBlob(shieldId: String?, selection: FamilyActivitySelection) -> String? {
    guard let selectionData = try? encoder.encode(selection) else {
      return nil
    }
    let payload = selectionData.base64EncodedString()
    let meta = ScreenTimeSelectionMeta(
      version: 1,
      shieldId: shieldId,
      createdAt: isoFormatter.string(from: Date()),
      apps: [],
      categories: [],
      selectionPayload: payload
    )
    guard let metaData = try? encoder.encode(meta) else {
      return nil
    }
    return metaData.base64EncodedString()
  }

  private func simulatedPickerResult(shieldId: String?) -> [String: Any] {
    let selection = FamilyActivitySelection()
    return [
      "blob": makeSelectionBlob(shieldId: shieldId, selection: selection) ?? "",
      "selectedCount": 0,
      "label": "Simulated picker result",
    ]
  }

  private func applySimulatedShieldChanges() {
    mutateShieldStore { store in
      store.shield.applications = nil
      store.shield.applicationCategories = .none
      store.shield.webDomains = nil
      store.shield.webDomainCategories = .none
    }
  }
}

private struct ScreenTimeSelectionMeta: Codable {
  let version: Int
  let shieldId: String?
  let createdAt: String
  let apps: [String]
  let categories: [String]
  let selectionPayload: String?
}
