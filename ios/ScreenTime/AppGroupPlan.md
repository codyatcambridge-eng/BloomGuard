# App Group Plan

- App Group ID: `group.com.yourcompany.miracleworker` (placeholder). Replace with the team-specific identifier when ready.
- Purpose: share Screen Time selection state (ManagedSettings/Device Activity) between the main app target and the future DeviceActivityMonitor extension.
- Template entitlements already include this group under `com.apple.security.application-groups`.
- Once the group exists in the Apple Developer dashboard, enable the App Groups capability for:
  1. The main `App` app target (use `App.entitlements`).
  2. The Device Activity Monitor extension (use `DeviceActivityMonitor.entitlements`).
- Keep the group in both entitlements synchronized so the extension can work with the shared container.
