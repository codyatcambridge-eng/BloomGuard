import Capacitor
import CoreBluetooth
import Foundation
import UIKit

#if canImport(ManagedSettings)
import ManagedSettings
#endif

#if canImport(CarKit)
import CarKit
#elseif canImport(CarPlay)
import CarPlay
#endif

extension Notification.Name {
  static let safeDriverCarPlayConnected = Notification.Name("SafeDriverCarPlayConnectedNotification")
  static let safeDriverCarPlayDisconnected = Notification.Name("SafeDriverCarPlayDisconnectedNotification")
}

@objc(SafeDriverPlugin)
public class SafeDriverPlugin: CAPPlugin {
  private static weak var sharedInstanceRef: SafeDriverPlugin?
  public static var sharedInstance: SafeDriverPlugin? {
    sharedInstanceRef
  }

  private static func registerInstance(_ instance: SafeDriverPlugin?) {
    sharedInstanceRef = instance
  }

  private let bluetoothManager = SafeDriverBluetoothManager.shared
  private var carPlayObservers: [NSObjectProtocol] = []
  private var carPlayConnected = false
  private var carPlayDisplayName = "CarPlay"
  private var lastCarRouteEvent = CarRouteState.empty
  private var lastBluetoothDetectionTimestamp: Date?
  private var pendingCarDetectionEvents: [[String: Any?]] = []
  private var pendingRouteEvent: [String: Any]?
  private var pendingPairedCarsPayload: [[String: Any]]?
  private var bridgeReady = false

#if canImport(ManagedSettings)
  private lazy var managedStore: ManagedSettingsStore? = {
    ManagedSettingsStore()
  }()
#endif

  override public func load() {
    super.load()
    Self.registerInstance(self)
    bridgeReady = true
    flushPendingEvents()
    bluetoothManager.setDelegate(self)
    bluetoothManager.startMonitoring()
    registerCarPlayNotifications()
    emitPairedCarsUpdate()
  }

  deinit {
    for token in carPlayObservers {
      NotificationCenter.default.removeObserver(token)
    }
    Self.registerInstance(nil)
  }

  // MARK: - Capabilities

  @objc public func configureBluetoothDetection(_ call: CAPPluginCall) {
    let approvedIdentifiers = call.getArray("approvedIdentifiers", String.self) ?? []
    let serviceUUIDs = call.getArray("serviceUUIDs", String.self) ?? []
    let safeDriverEnabled = call.getBool("safeDriverEnabled") ?? false
    let autoStartOnApprovedCar = call.getBool("autoStartOnApprovedCar") ?? false
    let rssiThreshold = call.getInt("rssiThreshold")

    bluetoothManager.updateConfiguration(
      approvedIdentifiers: approvedIdentifiers,
      serviceUUIDs: serviceUUIDs,
      safeDriverEnabled: safeDriverEnabled,
      autoStartOnApprovedCar: autoStartOnApprovedCar,
      rssiThreshold: rssiThreshold,
      shouldRestartScanner: true,
      pairingRequested: false,
      call: call,
      completion: { [weak self] _, _ in
        self?.emitPairedCarsUpdate()
      }
    )
  }

  @objc public func registerAccessory(_ call: CAPPluginCall) {
    startPairingInternal(force: true)
    call.resolve()
  }

  @objc public func showPicker(_ call: CAPPluginCall) {
    startPairingInternal(force: true)
    call.resolve()
  }

  @objc public func startPairing(_ call: CAPPluginCall) {
    startPairingInternal(force: true)
    call.resolve()
  }

  @objc public func getBluetoothStatus(_ call: CAPPluginCall) {
    let state = bluetoothManager.managerState
    call.resolve([
      "supported": state != .unsupported,
      "enabled": state == .poweredOn,
      "state": mapBluetoothState(state),
    ])
  }

  @objc public func getLiveActivityStatus(_ call: CAPPluginCall) {
    call.resolve([
      "supported": false,
      "enabled": false,
      "status": "unsupported",
    ])
  }

  @objc public func checkPermissions(_ call: CAPPluginCall) {
    call.resolve([
      "bluetooth": bluetoothStatusPayload(),
      "screenTime": [
        "supported": false,
        "authorized": false,
        "status": "unsupported",
      ],
    ])
  }

  @objc public func requestPermissions(_ call: CAPPluginCall) {
    checkPermissions(call)
  }

  @objc public func requestScreenTimeAuth(_ call: CAPPluginCall) {
    call.resolve([
      "supported": false,
      "authorized": false,
      "status": "unsupported",
    ])
  }

  @objc public func presentFamilyActivityPicker(_ call: CAPPluginCall) {
    call.reject("Family Activity picker is not handled natively")
  }

  @objc public func requestTemporaryBreak(_ call: CAPPluginCall) {
    call.reject("Temporary breaks are not handled natively")
  }

  @objc public func requestEmergencyUnlocks(_ call: CAPPluginCall) {
    call.resolve()
  }

  @objc public func getCurrentStatus(_ call: CAPPluginCall) {
    let name = activeVehicleName()
    call.resolve([
      "safeModeActive": name != nil,
      "connectedVehicleName": name ?? NSNull(),
    ])
  }

  @objc public func testHeartbeat(_ call: CAPPluginCall) {
    call.resolve([
      "seen": lastBluetoothDetectionTimestamp != nil,
    ])
  }

  @objc public func openSettings(_ call: CAPPluginCall) {
    guard let url = URL(string: UIApplication.openSettingsURLString) else {
      return call.resolve(["opened": false])
    }
    UIApplication.shared.open(url, options: [:]) { success in
      call.resolve(["opened": success])
    }
  }

  @objc public func getCurrentRoute(_ call: CAPPluginCall) {
    call.resolve(lastCarRouteEvent.payload)
  }

  // MARK: - Internal Observers

  private func startPairingInternal(force: Bool) {
    bluetoothManager.updateConfiguration(
      approvedIdentifiers: bluetoothManager.approvedIdentifiers,
      serviceUUIDs: bluetoothManager.serviceUUIDs,
      safeDriverEnabled: bluetoothManager.safeDriverEnabled,
      autoStartOnApprovedCar: bluetoothManager.autoStartOnApprovedCar,
      rssiThreshold: bluetoothManager.rssiThreshold,
      shouldRestartScanner: false,
      pairingRequested: true,
      call: nil
    )
  }

  private func registerCarPlayNotifications() {
    #if canImport(CarKit) || canImport(CarPlay)
    let center = NotificationCenter.default
    let connected = center.addObserver(forName: .safeDriverCarPlayConnected, object: nil, queue: .main) { [weak self] notification in
      guard let controller = notification.object as? CPInterfaceController else { return }
      self?.handleCarPlayChange(connected: true, controller: controller)
    }
    let disconnected = center.addObserver(forName: .safeDriverCarPlayDisconnected, object: nil, queue: .main) { [weak self] notification in
      guard let controller = notification.object as? CPInterfaceController else { return }
      self?.handleCarPlayChange(connected: false, controller: controller)
    }
    carPlayObservers = [connected, disconnected]
    #endif
  }

  // MARK: - Bluetooth Helpers

  private func bluetoothStatusPayload() -> [String: Any] {
    let state = bluetoothManager.managerState
    return [
      "supported": state != .unsupported,
      "enabled": state == .poweredOn,
      "state": mapBluetoothState(state),
    ]
  }

  private func mapBluetoothState(_ state: CBManagerState) -> String {
    switch state {
    case .unknown:
      return "unknown"
    case .resetting:
      return "resetting"
    case .unsupported:
      return "unsupported"
    case .unauthorized:
      return "unauthorized"
    case .poweredOff:
      return "poweredOff"
    case .poweredOn:
      return "poweredOn"
    @unknown default:
      return "unknown"
    }
  }

  private func activeVehicleName() -> String? {
    if carPlayConnected {
      return carPlayDisplayName
    }
    if let name = bluetoothManager.connectedBluetoothCarName() {
      return name
    }
    return nil
  }

  fileprivate func notifyBluetoothDetection(id: String, name: String?, rssi: Int?, timestamp: String) {
    lastBluetoothDetectionTimestamp = Date()
    let event: [String: Any?] = [
      "id": id,
      "name": name,
      "rssi": rssi as Any,
      "ts": timestamp,
    ]
    queueOrSendCarDetectedEvent(event)
    emitPairedCarsUpdate()
  }

  fileprivate func notifyBluetoothStateChange() {
    emitPairedCarsUpdate()
  }

  private func queueOrSendCarDetectedEvent(_ payload: [String: Any?]) {
    if bridgeReady {
      DispatchQueue.main.async {
        self.notifyListeners("carDetected", data: payload)
      }
      return
    }
    pendingCarDetectionEvents.append(payload)
  }

  private func flushPendingCarDetectionEvents() {
    guard !pendingCarDetectionEvents.isEmpty else { return }
    let queued = pendingCarDetectionEvents
    pendingCarDetectionEvents.removeAll()
    DispatchQueue.main.async {
      for event in queued {
        self.notifyListeners("carDetected", data: event)
      }
    }
  }

  private func flushPendingEvents() {
    guard bridgeReady else { return }
    flushPendingCarDetectionEvents()
    if let paired = pendingPairedCarsPayload {
      pendingPairedCarsPayload = nil
      DispatchQueue.main.async {
        self.notifyListeners("pairedCars", data: ["cars": paired])
      }
    }
    if let route = pendingRouteEvent {
      pendingRouteEvent = nil
      DispatchQueue.main.async {
        self.notifyListeners("carRouteChange", data: route)
      }
    }
  }

  fileprivate func pairedCarsPayload() -> [[String: Any]] {
    var results: [[String: Any]] = bluetoothManager.pairedCars()
#if canImport(CarKit) || canImport(CarPlay)
    let carPlayPayload: [String: Any] = [
      "id": "carplay",
      "name": carPlayDisplayName,
      "connected": carPlayConnected,
    ]
    if let index = results.firstIndex(where: { ($0["id"] as? String) == "carplay" }) {
      results[index] = carPlayPayload
    } else {
      results.append(carPlayPayload)
    }
#endif
    return results
  }

  fileprivate func emitPairedCarsUpdate() {
    let payload = pairedCarsPayload()
    guard bridgeReady else {
      pendingPairedCarsPayload = payload
      return
    }
    DispatchQueue.main.async {
      self.notifyListeners("pairedCars", data: [
        "cars": payload,
      ])
    }
  }

  func handleBackgroundRefresh() {
    print("SafeDriverPlugin [BG] background refresh triggered")
    bluetoothManager.refreshForBackgroundTask()
    let shouldApplyShield = activeVehicleName() != nil
    print("SafeDriverPlugin [BG] car connected state: \(shouldApplyShield)")
    forceSyncShieldStoreIfNeeded(shouldApplyShield)
  }

  private func forceSyncShieldStoreIfNeeded(_ shouldApply: Bool) {
    guard shouldApply else {
      print("SafeDriverPlugin [BG] shield sync skipped; no car detected")
      return
    }
#if canImport(ManagedSettings)
    guard let store = managedStore else {
      print("SafeDriverPlugin [BG] shield sync skipped; ManagedSettingsStore unavailable")
      return
    }
    DispatchQueue.main.async {
      let shield = store.shield
      store.shield.applications = shield.applications
      store.shield.applicationCategories = shield.applicationCategories
      store.shield.webDomains = shield.webDomains
      store.shield.webDomainCategories = shield.webDomainCategories
      print("SafeDriverPlugin [BG] forced shield state resync")
    }
#else
    print("SafeDriverPlugin [BG] managed settings not supported on this platform")
#endif
  }

  #if canImport(CarKit) || canImport(CarPlay)
  private func handleCarPlayChange(connected: Bool, controller: CPInterfaceController) {
    carPlayConnected = connected
    carPlayDisplayName = "CarPlay"
    lastCarRouteEvent = CarRouteState(
      portName: connected ? carPlayDisplayName : "",
      localizedName: connected ? carPlayDisplayName : "",
      portType: "carPlay",
      timestamp: ISO8601DateFormatter().string(from: Date()),
    )
    let payload = lastCarRouteEvent.payload
    if bridgeReady {
      DispatchQueue.main.async {
        self.notifyListeners("carRouteChange", data: payload)
      }
    } else {
      pendingRouteEvent = payload
    }
    emitPairedCarsUpdate()
  }
  #endif

}

extension SafeDriverPlugin: SafeDriverBluetoothManagerDelegate {
  func bluetoothManager(_ manager: SafeDriverBluetoothManager, didDetect id: String, name: String?, rssi: Int?, timestamp: String) {
    notifyBluetoothDetection(id: id, name: name, rssi: rssi, timestamp: timestamp)
  }

  func bluetoothManagerDidUpdatePairedCars(_ manager: SafeDriverBluetoothManager) {
    notifyBluetoothStateChange()
  }
}

}

private struct CarRouteState {
  let portName: String
  let localizedName: String
  let portType: String
  let timestamp: String

  static var empty: CarRouteState {
    CarRouteState(portName: "", localizedName: "", portType: "none", timestamp: ISO8601DateFormatter().string(from: Date()))
  }

  var payload: [String: Any] {
    [
      "portName": portName,
      "localizedName": localizedName,
      "portType": portType,
      "timestamp": timestamp,
    ]
  }
}

private protocol SafeDriverBluetoothManagerDelegate: AnyObject {
  func bluetoothManager(_ manager: SafeDriverBluetoothManager, didDetect id: String, name: String?, rssi: Int?, timestamp: String)
  func bluetoothManagerDidUpdatePairedCars(_ manager: SafeDriverBluetoothManager)
}

final class SafeDriverBluetoothManager: NSObject {
  static let shared = SafeDriverBluetoothManager()

  weak var delegate: SafeDriverBluetoothManagerDelegate?

  private var centralManager: CBCentralManager!
  private var tracking: [UUID: TrackedPeripheral] = [:]
  private var isScanning = false
  private(set) var approvedIdentifiers: [String] = []
  private(set) var serviceUUIDs: [String] = []
  private(set) var safeDriverEnabled = false
  private(set) var autoStartOnApprovedCar = false
  private(set) var rssiThreshold: Int?
  private var pairingRequested = false

  private lazy var identifierMatches: Set<UUID> = []
  private lazy var nameMatches: Set<String> = []
  private lazy var parsedServiceUUIDs: [CBUUID] = []

  var managerState: CBManagerState {
    centralManager.state
  }

  private override init() {
    super.init()
    centralManager = CBCentralManager(delegate: self, queue: nil, options: [
      CBCentralManagerOptionRestoreIdentifierKey: "SafeDriverBluetoothCentral",
    ])
  }

  func setDelegate(_ delegate: SafeDriverBluetoothManagerDelegate?) {
    self.delegate = delegate
  }

  func startMonitoring() {
    updateScanState(forceStart: false)
  }

  func handleLaunchOptions(_ launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
    if let restored = launchOptions?[.bluetoothCentrals] as? [String], !restored.isEmpty {
      startMonitoring()
    }
  }

  func refreshForBackgroundTask() {
    updateScanState(forceStart: true)
  }

  func updateConfiguration(
    approvedIdentifiers: [String],
    serviceUUIDs: [String],
    safeDriverEnabled: Bool,
    autoStartOnApprovedCar: Bool,
    rssiThreshold: Int?,
    shouldRestartScanner: Bool,
    pairingRequested: Bool,
    call: CAPPluginCall? = nil,
    completion: ((Bool, Error?) -> Void)? = nil
  ) {
    self.approvedIdentifiers = approvedIdentifiers
    self.serviceUUIDs = serviceUUIDs
    self.safeDriverEnabled = safeDriverEnabled
    self.autoStartOnApprovedCar = autoStartOnApprovedCar
    self.rssiThreshold = rssiThreshold
    self.pairingRequested = pairingRequested || self.pairingRequested
    identifierMatches = Set(approvedIdentifiers.compactMap { UUID(uuidString: $0) })
    nameMatches = Set(approvedIdentifiers.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty })
    parsedServiceUUIDs = serviceUUIDs.compactMap { CBUUID(string: $0) }
    if shouldRestartScanner {
      stopScanning()
    }
    updateScanState(forceStart: shouldRestartScanner)
    completion?(true, nil)
    call?.resolve()
  }

  func connectedBluetoothCarName() -> String? {
    tracking.values.first(where: { $0.connected })?.name
  }

  func pairedCars() -> [[String: Any]] {
    tracking.values
      .map { tracked in
        [
          "id": tracked.peripheral.identifier.uuidString,
          "name": tracked.name,
          "connected": tracked.connected,
        ]
      }
  }

  private func updateScanState(forceStart: Bool) {
    guard centralManager.state == .poweredOn else {
      stopScanning()
      return
    }
    if (safeDriverEnabled || pairingRequested || forceStart) && (!isScanning || forceStart) {
      startScanning()
    } else if !safeDriverEnabled && !pairingRequested {
      stopScanning()
    }
  }

  private func startScanning() {
    if isScanning {
      centralManager.stopScan()
    }
    centralManager.scanForPeripherals(
      withServices: parsedServiceUUIDs.isEmpty ? nil : parsedServiceUUIDs,
      options: [
        CBCentralManagerScanOptionAllowDuplicatesKey: false,
      ]
    )
    isScanning = true
  }

  private func stopScanning() {
    guard isScanning else { return }
    centralManager.stopScan()
    isScanning = false
  }

  private func shouldTrack(peripheral: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) -> Bool {
    let name = resolvedName(for: peripheral, advertisement: advertisementData)
    if let threshold = rssiThreshold, rssi.intValue < threshold {
      return false
    }
    if identifierMatches.contains(peripheral.identifier) {
      return true
    }
    if nameMatches.contains(name.lowercased()) {
      return true
    }
    if parsedServiceUUIDs.isEmpty {
      return name.lowercased().contains("car")
    }
    if let services = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] {
      return services.contains(where: { parsedServiceUUIDs.contains($0) })
    }
    return false
  }

  private func resolvedName(for peripheral: CBPeripheral, advertisement: [String: Any]) -> String {
    if let localName = advertisement[CBAdvertisementDataLocalNameKey] as? String, !localName.isEmpty {
      return localName
    }
    if let name = peripheral.name, !name.isEmpty {
      return name
    }
    return peripheral.identifier.uuidString
  }

  private func connect(peripheral: CBPeripheral) {
    centralManager.connect(peripheral, options: [
      CBConnectPeripheralOptionNotifyOnConnectionKey: true,
      CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
    ])
  }

  private func notifyDetection(_ tracked: TrackedPeripheral) {
    let timestamp = ISO8601DateFormatter().string(from: tracked.lastSeen)
    delegate?.bluetoothManager(
      self,
      didDetect: tracked.peripheral.identifier.uuidString,
      name: tracked.name,
      rssi: tracked.lastRSSI?.intValue,
      timestamp: timestamp
    )
  }

  private func notifyPairedCars() {
    delegate?.bluetoothManagerDidUpdatePairedCars(self)
  }
}

extension SafeDriverBluetoothManager: CBCentralManagerDelegate {
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    updateScanState(forceStart: false)
  }

  func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
    centralManager = central
    updateScanState(forceStart: true)
    guard let peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral], !peripherals.isEmpty else {
      print("SafeDriverBluetoothManager willRestoreState: no peripherals to restore")
      return
    }
    print("SafeDriverBluetoothManager willRestoreState: restoring \(peripherals.count) peripherals")
    for peripheral in peripherals {
      let tracked = tracking[peripheral.identifier] ?? TrackedPeripheral(peripheral: peripheral, name: resolvedName(for: peripheral, advertisement: [:]), rssi: nil)
      tracked.connected = true
      tracked.lastSeen = Date()
      tracking[peripheral.identifier] = tracked
      notifyDetection(tracked)
    }
    notifyPairedCars()
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
    guard shouldTrack(peripheral: peripheral, advertisementData: advertisementData, rssi: rssi) else { return }
    let name = resolvedName(for: peripheral, advertisement: advertisementData)
    let tracked = tracking[peripheral.identifier] ?? TrackedPeripheral(peripheral: peripheral, name: name, rssi: rssi)
    tracked.name = name
    tracked.lastRSSI = rssi
    tracked.lastSeen = Date()
    tracking[peripheral.identifier] = tracked
    if !tracked.connected {
      connect(peripheral: peripheral)
    }
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    guard let tracked = tracking[peripheral.identifier] else { return }
    tracked.connected = true
    tracked.lastSeen = Date()
    notifyDetection(tracked)
    notifyPairedCars()
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    tracking[peripheral.identifier]?.connected = false
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    tracking[peripheral.identifier]?.connected = false
    notifyPairedCars()
    updateScanState(forceStart: false)
  }
}

private final class TrackedPeripheral {
  let peripheral: CBPeripheral
  var name: String
  var lastRSSI: NSNumber?
  var lastSeen: Date
  var connected = false

  init(peripheral: CBPeripheral, name: String, rssi: NSNumber?) {
    self.peripheral = peripheral
    self.name = name
    self.lastRSSI = rssi
    self.lastSeen = Date()
  }
}
