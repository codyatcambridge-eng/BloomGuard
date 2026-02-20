import Capacitor
import CoreBluetooth
import ExternalAccessory
import FamilyControls
import Foundation
import UIKit

private extension CBManagerState {
    var safeDriverState: String {
        switch self {
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
}

private struct BluetoothDetectionConfig {
    var approvedIdentifiers: Set<String> = []
    var serviceUUIDs: Set<String> = []
    var safeDriverEnabled: Bool = false
    var autoStartOnApprovedCar: Bool = false
    var rssiThreshold: Int?
}

@objc(SafeDriverPlugin)
public class SafeDriverPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SafeDriverPlugin"
    public let jsName = "SafeDriver"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCurrentRoute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureBluetoothDetection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "registerAccessory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showPicker", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startPairing", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getBluetoothStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLiveActivityStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestScreenTimeAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCurrentStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testHeartbeat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addListener", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeListener", returnType: CAPPluginReturnPromise),
    ]

    private let appGroupSuite = "group.bet.goodcreation.miracleworker"
    private lazy var sharedDefaults = UserDefaults(suiteName: appGroupSuite)

    private lazy var isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private lazy var centralManager: CBCentralManager = {
        CBCentralManager(delegate: self, queue: nil)
    }()

    private var bluetoothState: CBManagerState = .unknown
    private var detectionConfig = BluetoothDetectionConfig()
    private var connectedCars: [EAAccessory] = []
    private var seenAccessoryIDs: Set<UInt> = []

    private var connectedVehicleName: String? {
        connectedCars.first?.name
    }

    private let carProtocolSnippets: [String] = [
        "carplay", "carplay.audio", "carplay.video", "carplay.diagnostic"
    ]

    // MARK: - Lifecycle

    public override func load() {
        super.load()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(accessoryDidConnect(_:)),
            name: Notification.Name(EAAccessoryDidConnectNotification),
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(accessoryDidDisconnect(_:)),
            name: Notification.Name(EAAccessoryDidDisconnectNotification),
            object: nil
        )
        EAAccessoryManager.shared().registerForLocalNotifications()
        refreshConnectedAccessories()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        EAAccessoryManager.shared().unregisterForLocalNotifications()
    }

    // MARK: - Plugin handlers

    @objc func getCurrentRoute(_ call: CAPPluginCall) {
        call.resolve(currentRoutePayload())
    }

    @objc func configureBluetoothDetection(_ call: CAPPluginCall) {
        if let configPayload = call.getObject("config") as? [String: Any] {
            let identifiers = (configPayload["approvedIdentifiers"] as? [String]) ?? []
            let serviceUUIDs = (configPayload["serviceUUIDs"] as? [String]) ?? []
            let safeDriverEnabled = configPayload["safeDriverEnabled"] as? Bool ?? false
            let autoStartOnApprovedCar = configPayload["autoStartOnApprovedCar"] as? Bool ?? false
            let rssiThreshold = configPayload["rssiThreshold"] as? Int

            detectionConfig = BluetoothDetectionConfig(
                approvedIdentifiers: Set(identifiers),
                serviceUUIDs: Set(serviceUUIDs),
                safeDriverEnabled: safeDriverEnabled,
                autoStartOnApprovedCar: autoStartOnApprovedCar,
                rssiThreshold: rssiThreshold
            )
        }
        call.resolve()
    }

    @objc func registerAccessory(_ call: CAPPluginCall) {
        presentAccessoryPicker(call: call)
    }

    @objc func showPicker(_ call: CAPPluginCall) {
        presentAccessoryPicker(call: call)
    }

    @objc func startPairing(_ call: CAPPluginCall) {
        presentAccessoryPicker(call: call)
    }

    @objc func getBluetoothStatus(_ call: CAPPluginCall) {
        call.resolve(bluetoothStatusPayload())
    }

    @objc func getLiveActivityStatus(_ call: CAPPluginCall) {
        call.resolve([
            "supported": false,
            "enabled": false,
            "status": "unsupported"
        ])
    }

    @objc func checkPermissions(_ call: CAPPluginCall) {
        call.resolve(permissionSnapshot())
    }

    @objc func requestPermissions(_ call: CAPPluginCall) {
        requestFamilyControlsAuthorization(call: call, returnSnapshot: true)
    }

    @objc func requestScreenTimeAuth(_ call: CAPPluginCall) {
        requestFamilyControlsAuthorization(call: call, returnSnapshot: false)
    }

    @objc func getCurrentStatus(_ call: CAPPluginCall) {
        call.resolve([
            "safeModeActive": isCarConnected,
            "connectedVehicleName": connectedVehicleName ?? NSNull()
        ])
    }

    @objc func testHeartbeat(_ call: CAPPluginCall) {
        call.resolve(["seen": isCarConnected])
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            call.reject("Unable to build settings URL")
            return
        }
        UIApplication.shared.open(url, options: [:]) { opened in
            call.resolve(["opened": opened])
        }
    }

    @objc func addListener(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func removeListener(_ call: CAPPluginCall) {
        call.resolve()
    }

    // MARK: - Helpers

    private var isCarConnected: Bool {
        !connectedCars.isEmpty
    }

    private func bluetoothStatusPayload() -> [String: Any] {
        let state = bluetoothState.safeDriverState
        return [
            "supported": bluetoothState != .unsupported,
            "enabled": bluetoothState == .poweredOn,
            "state": state
        ]
    }

    private func currentRoutePayload() -> [String: Any] {
        guard let accessory = connectedCars.first else {
            return [
                "portName": "",
                "localizedName": "",
                "portType": "unavailable",
                "timestamp": isoFormatter.string(from: Date())
            ]
        }
        return [
            "portName": accessory.name,
            "localizedName": accessory.manufacturer,
            "portType": "carAccessory",
            "timestamp": isoFormatter.string(from: Date())
        ]
    }

    private func permissionSnapshot() -> [String: Any] {
        let authStatus = AuthorizationCenter.shared.authorizationStatus
        return [
            "screenTime": [
                "supported": true,
                "authorized": authStatus == .approved,
                "status": screenTimeStatus(for: authStatus)
            ],
            "bluetooth": bluetoothStatusPayload()
        ]
    }

    private func screenTimeStatus(for status: AuthorizationStatus) -> String {
        switch status {
        case .notDetermined:
            return "notDetermined"
        case .denied:
            return "denied"
        case .approved:
            return "approved"
        default:
            return "unsupported"
        }
    }

    private func requestFamilyControlsAuthorization(call: CAPPluginCall, returnSnapshot: Bool) {
        Task {
            do {
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                if returnSnapshot {
                    call.resolve(permissionSnapshot())
                } else {
                    let status = AuthorizationCenter.shared.authorizationStatus
                    call.resolve([
                        "supported": true,
                        "authorized": status == .approved,
                        "status": screenTimeStatus(for: status)
                    ])
                }
            } catch {
                call.reject("family-controls-error", error.localizedDescription, error)
            }
        }
    }

    private func presentAccessoryPicker(call: CAPPluginCall) {
        DispatchQueue.main.async {
            EAAccessoryManager.shared().showBluetoothAccessoryPicker(
                withNameFilter: nil
            ) { [weak self] error in
                guard let self = self else {
                    call.reject("plugin-deallocated")
                    return
                }
                if let error = error as NSError? {
                    call.reject("pairing-error", error.localizedDescription, error)
                } else {
                    call.resolve()
                    self.refreshConnectedAccessories()
                }
            }
        }
    }

    private func refreshConnectedAccessories() {
        let accessories = EAAccessoryManager.shared().connectedAccessories
        connectedCars = accessories.filter(isCarAccessory)
        seenAccessoryIDs = Set(connectedCars.map { $0.connectionID })
        notifyPairedCars()
        if let accessory = connectedCars.first {
            notifyCarEvents(for: accessory)
        }
    }

    private func isCarAccessory(_ accessory: EAAccessory) -> Bool {
        accessory.protocolStrings.contains { protocolString in
            let lower = protocolString.lowercased()
            return carProtocolSnippets.contains { lower.contains($0) }
        }
    }

    private func notifyCarEvents(for accessory: EAAccessory) {
        let payload: [String: Any] = [
            "id": String(accessory.connectionID),
            "name": accessory.name,
            "ts": isoFormatter.string(from: Date())
        ]
        DispatchQueue.main.async {
            self.notifyListeners("carDetected", data: payload)
            self.notifyListeners("carRouteChange", data: [
                "portName": accessory.name,
                "localizedName": accessory.manufacturer,
                "portType": "carAccessory",
                "timestamp": payload["ts"] as Any
            ])
        }
    }

    private func notifyPairedCars() {
        let cars = connectedCars.map { accessory -> [String: Any] in
            [
                "id": String(accessory.connectionID),
                "name": accessory.name,
                "connected": accessory.isConnected
            ]
        }
        DispatchQueue.main.async {
            self.notifyListeners("pairedCars", data: ["cars": cars])
        }
    }

    @objc private func accessoryDidConnect(_ notification: Notification) {
        guard let accessory = notification.userInfo?[EAAccessoryKey] as? EAAccessory else {
            return
        }
        guard isCarAccessory(accessory) else { return }
        DispatchQueue.main.async {
            if !self.connectedCars.contains(where: { $0.connectionID == accessory.connectionID }) {
                self.connectedCars.append(accessory)
            }
            self.seenAccessoryIDs.insert(accessory.connectionID)
            self.notifyPairedCars()
            self.notifyCarEvents(for: accessory)
        }
    }

    @objc private func accessoryDidDisconnect(_ notification: Notification) {
        guard let accessory = notification.userInfo?[EAAccessoryKey] as? EAAccessory else {
            return
        }
        DispatchQueue.main.async {
            self.connectedCars.removeAll { $0.connectionID == accessory.connectionID }
            self.seenAccessoryIDs.remove(accessory.connectionID)
            self.notifyPairedCars()
        }
    }
}

extension SafeDriverPlugin: CBCentralManagerDelegate {
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        bluetoothState = central.state
    }
}
