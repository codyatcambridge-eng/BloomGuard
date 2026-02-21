import UIKit
import Capacitor
#if canImport(BackgroundTasks)
import BackgroundTasks
#endif
#if canImport(CarKit)
import CarKit
#elseif canImport(CarPlay)
import CarPlay
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate
#if canImport(CarKit) || canImport(CarPlay)
, CPApplicationDelegate
#endif
{

    private let driverRefreshTaskIdentifier = "com.miracleworker.driver-refresh"
    var window: UIWindow?

    func application(_ application: UIApplication, willFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        print("SafeDriver: willFinishLaunchingWithOptions")
        SafeDriverBluetoothManager.shared.handleLaunchOptions(launchOptions)
        registerBackgroundTasks()
        return true
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        print("SafeDriver: didFinishLaunchingWithOptions")
        SafeDriverBluetoothManager.shared.handleLaunchOptions(launchOptions)
        scheduleDriverRefreshTask()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        print("SafeDriver: didEnterBackground")
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        print("SafeDriver: willTerminate")
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

  func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
    // Called when the app was launched with an activity, including Universal Links.
    // Feel free to add additional processing here, but if you want the App API to support
    // tracking app url opens, make sure to keep this call
    return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
  }

#if canImport(BackgroundTasks)
  private func registerBackgroundTasks() {
    if #available(iOS 13.0, *) {
      print("SafeDriver: registering background app refresh task")
      BGTaskScheduler.shared.register(forTaskWithIdentifier: driverRefreshTaskIdentifier, using: nil) { task in
        self.handleAppRefresh(task: task as! BGAppRefreshTask)
      }
    }
  }

  private func scheduleDriverRefreshTask() {
    if #available(iOS 13.0, *) {
      print("SafeDriver: scheduling driver refresh task")
      let request = BGAppRefreshTaskRequest(identifier: driverRefreshTaskIdentifier)
      request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
      do {
        try BGTaskScheduler.shared.submit(request)
        print("SafeDriver: driver refresh task scheduled")
      } catch {
        print("Failed to schedule driver refresh task:", error)
      }
    }
  }

  @available(iOS 13.0, *)
  private func handleAppRefresh(task: BGAppRefreshTask) {
    print("SafeDriver: handling background app refresh")
    scheduleDriverRefreshTask()
    task.expirationHandler = {
      print("SafeDriver: background app refresh expired")
      task.setTaskCompleted(success: false)
    }
    SafeDriverPlugin.sharedInstance?.handleBackgroundRefresh()
    task.setTaskCompleted(success: true)
  }
#endif

#if canImport(CarKit) || canImport(CarPlay)
  func application(
    _ application: UIApplication,
    didConnectCarInterfaceController interfaceController: CPInterfaceController,
    to window: CPWindow
  ) {
    NotificationCenter.default.post(name: .safeDriverCarPlayConnected, object: interfaceController)
  }

  func application(
    _ application: UIApplication,
    didDisconnectCarInterfaceController interfaceController: CPInterfaceController,
    from window: CPWindow
  ) {
    NotificationCenter.default.post(name: .safeDriverCarPlayDisconnected, object: interfaceController)
  }
#endif

}
