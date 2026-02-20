//
//  DeviceActivityMonitorExtension.swift
//  SafeDriverMonitor
//
//  Created by Cody Groves on 2/19/26.
//

import DeviceActivity
import FamilyControls
import ManagedSettings
import os

class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    private let managedStore = ManagedSettingsStore()
    private let selectionDecoder = JSONDecoder()
    private let sharedDefaults = UserDefaults(suiteName: "group.bet.goodcreation.miracleworker")
    private let selectionKey = "SafeDriverFamilyActivitySelection"
    private var shieldApplied = false

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        clearShield()
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        clearShield()
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        guard event.rawValue == "carDetected" else { return }
        applyShieldIfNeeded()
    }

    private func applyShieldIfNeeded() {
        guard let selection = loadFamilyActivitySelection() else {
            clearShield()
            return
        }
        configureShield(using: selection)
    }

    private func configureShield(using selection: FamilyControls.FamilyActivitySelection) {
        managedStore.shield.applications = selection.applicationTokens.isEmpty ? nil : selection.applicationTokens

        if selection.includeEntireCategory {
            managedStore.shield.applicationCategories = .all(except: Set<ManagedSettings.Token<ManagedSettings.Application>>())
        } else if !selection.categoryTokens.isEmpty {
            managedStore.shield.applicationCategories = .specific(
                selection.categoryTokens,
                except: Set<ManagedSettings.Token<ManagedSettings.Application>>()
            )
        } else {
            managedStore.shield.applicationCategories = nil
        }

        managedStore.shield.webDomains = selection.webDomainTokens.isEmpty ? nil : selection.webDomainTokens
        shieldApplied = true
    }

    private func clearShield() {
        guard shieldApplied else { return }
        managedStore.shield.applications = nil
        managedStore.shield.applicationCategories = nil
        managedStore.shield.webDomains = nil
        shieldApplied = false
    }

    private func loadFamilyActivitySelection() -> FamilyControls.FamilyActivitySelection? {
        guard
            let data = sharedDefaults?.data(forKey: selectionKey)
        else {
            return nil
        }
        do {
            return try selectionDecoder.decode(FamilyControls.FamilyActivitySelection.self, from: data)
        } catch {
            os_log(.error, "Failed to decode FamilyActivitySelection: %@", error.localizedDescription)
            return nil
        }
    }
}
