import Foundation

@available(iOS 15.0, *)
final class ScreenTimeSharedStore {
  private enum Constants {
    static let appGroupId = "group.com.codygroves.miracleworker"
    static let storageKey = "ScreenTimeScheduleStore"
  }

  private let defaults: UserDefaults?
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  init(suiteName: String = Constants.appGroupId) {
    defaults = UserDefaults(suiteName: suiteName)
  }

  func replaceSchedules(with entries: [ScreenTimeScheduleEntry]) {
    guard let defaults else { return }
    let payload = ScreenTimeScheduleStore(schedules: Dictionary(uniqueKeysWithValues: entries.map { ($0.scheduleId, $0) }))
    if let data = try? encoder.encode(payload) {
      defaults.set(data, forKey: Constants.storageKey)
    }
  }

  func schedule(for id: String) -> ScreenTimeScheduleEntry? {
    loadEntries()[id]
  }

  func clearAll() {
    defaults?.removeObject(forKey: Constants.storageKey)
  }

  private func loadEntries() -> [String: ScreenTimeScheduleEntry] {
    guard let defaults, let data = defaults.data(forKey: Constants.storageKey) else { return [:] }
    let store = try? decoder.decode(ScreenTimeScheduleStore.self, from: data)
    return store?.schedules ?? [:]
  }
}

@available(iOS 15.0, *)
struct ScreenTimeScheduleWindow: Codable {
  let startMin: Int
  let endMin: Int
  let daysMask: Int
}

@available(iOS 15.0, *)
struct ScreenTimeScheduleEntry: Codable {
  let scheduleId: String
  let shieldId: String
  let strictness: Int?
  let window: ScreenTimeScheduleWindow
  let selectionBlob: String
  let updatedAt: String
}

@available(iOS 15.0, *)
private struct ScreenTimeScheduleStore: Codable {
  let schedules: [String: ScreenTimeScheduleEntry]
}
