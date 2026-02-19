import Capacitor
import AVFoundation

@objc(SafeDriverPlugin)
public class SafeDriverPlugin: CAPPlugin {

  private lazy var audioSession = AVAudioSession.sharedInstance()
  private var routeChangeObserver: NSObjectProtocol?

  public override func load() {
    super.load()
    routeChangeObserver = NotificationCenter.default.addObserver(
      forName: AVAudioSession.routeChangeNotification,
      object: audioSession,
      queue: .main
    ) { [weak self] notification in
      self?.handleRouteChange(notification)
    }
  }

  deinit {
    if let observer = routeChangeObserver {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  @objc func getCurrentRoute(_ call: CAPPluginCall) {
    let current = currentRouteEvent()
    call.resolve(current)
  }

private func handleRouteChange(_ notification: Notification) {
    let event = currentRouteEvent()
    notifyListeners("carRouteChange", data: event)
  }

  private func currentRouteEvent() -> [String: Any] {
    let route = audioSession.currentRoute
    let portName = route.outputs.first?.portName ?? "Unknown"
    return [
      "portName": portName,
      "portType": route.outputs.first?.portType.rawValue ?? "unknown",
      "timestamp": ISO8601DateFormatter().string(from: Date()),
    ]
  }
}
