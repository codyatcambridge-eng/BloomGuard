import subprocess
import time
import os

# --- CONFIGURATION ---
PROJECT_PATH = "ios/App"
BUNDLE_ID = "io.ionic.starter" # Confirm this in your Info.plist
SIM_NAME = "iPhone 17 Pro"

def run_command(command, cwd=None):
    result = subprocess.run(command, shell=True, capture_output=True, text=True, cwd=cwd)
    return result.returncode, result.stdout, result.stderr

def ghost_scroll():
    print("👻 Ghost Scroll: Reclaiming the UI...")
    # This AppleScript first FORCES the Simulator to the front, then swipes.
    # This prevents the -1708 "Can't continue drag" error.
    swipe_script = """
    tell application "Simulator" to activate
    tell application "System Events"
        tell process "Simulator"
            drag from {200, 600} to {200, 200} over 0.5
        end tell
    end tell
    """
    for i in range(15):
        print(f"   > Swipe {i+1}/15")
        subprocess.run(f"osascript -e '{swipe_script}'", shell=True)
        time.sleep(3)

def main_loop():
    while True:
        os.system('clear')
        print(f"🚀 --- REBELLION CYCLE: {time.strftime('%H:%M:%S')} ---")
        
        # 1. SYNC & CLEAN
        print("🔄 Syncing Capacitor...")
        run_command("npx cap copy ios")

        # 2. BUILD
        print("🏗️  Compiling Source (iPhone 17 Pro)...")
        # We target the simulator specifically to keep the build fast
        build_cmd = f"xcodebuild -scheme App -project App.xcodeproj -configuration Debug -sdk iphonesimulator build"
        code, out, err = run_command(build_cmd, cwd=PROJECT_PATH)

        if code == 0:
            print("✅ Build Successful!")
            
            # 3. WAKE SIMULATOR
            print(f"📱 Waking {SIM_NAME}...")
            subprocess.run(f"xcrun simctl boot '{SIM_NAME}'", shell=True, capture_output=True)
            subprocess.run("open -a Simulator", shell=True) # Opens the app if closed
            time.sleep(4)
            
            # 4. INSTALL & LAUNCH
            print("⚡ Deploying Miracle Worker...")
            run_command(f"xcrun simctl install booted .", cwd=PROJECT_PATH)
            # We terminate first to ensure a "Fresh Start" launch
            run_command(f"xcrun simctl terminate booted {BUNDLE_ID}")
            run_command(f"xcrun simctl launch booted {BUNDLE_ID}")
            
            time.sleep(3) # Wait for splash screen

            # 5. TEST
            ghost_scroll()
            
            print("\n✅ Cycle Finished. Standing by for code changes...")
            time.sleep(15)
        
        else:
            print("❌ REDLINE DETECTED. Logging for Codex...")
            with open("codex_fix_me.txt", "w") as f:
                f.write(err)
            print(f"Error saved. Check 'codex_fix_me.txt'. Waiting 20s...")
            time.sleep(20)

if __name__ == "__main__":
    main_loop()
