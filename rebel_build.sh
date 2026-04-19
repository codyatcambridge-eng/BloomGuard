#!/bin/bash

# --- Miracle Worker: The Autonomous Rebellion Loop ---
# This script will loop indefinitely, building and testing until you press Ctrl+C.

while true; do
    clear
    echo "----------------------------------------------------"
    echo "🚀 STARTING NEW BUILD CYCLE: $(date +%H:%M:%S)"
    echo "----------------------------------------------------"

    # 1. Sync Web Assets
    echo "🔄 Syncing Capacitor Assets..."
    npx cap copy ios

    # 2. Navigate to Xcode Project
    cd ios/App

    # 3. Clean and Build for iPhone 17 Pro
    echo "🏗️  Compiling Source Code..."
    xcodebuild -scheme App -project App.xcodeproj -configuration Debug -sdk iphonesimulator build > build_log.txt 2>&1

    if [ $? -eq 0 ]; then
        echo "✅ Build Successful!"
        
        # 4. Boot and Prepare Simulator
        echo "📱 Waking up iPhone 17 Pro..."
        xcrun simctl boot "iPhone 17 Pro" || true 
        open /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app
        
        # 5. Install the App
        echo "⚡ Installing Miracle Worker..."
        sleep 5
        xcrun simctl install booted .
        
        # 6. Launch the App
        # Note: Replace 'io.ionic.starter' if you changed your Bundle ID
        echo "🎯 Launching Rebellion UI..."
        xcrun simctl launch booted io.ionic.starter
        
        # 7. The Ghost Scroll (Automated Testing)
        echo "👻 Starting 60-second Ghost Scroll Test..."
        for i in {1..20}
        do
            echo "   > Swipe $i/20"
            # Swipes from middle-bottom to middle-top
            xcrun simctl interact booted swipe 200 600 200 200
            sleep 3 # Wait for content to load/blur to trigger
        done

        echo "🏁 Test Cycle Complete. Restarting in 10 seconds..."
        sleep 10
    else
        echo "❌ BUILD REDLINED! (Error detected)"
        echo "----------------------------------------------------"
        # Pulls the last 10 lines of the error log so you can see why it failed
        tail -n 15 build_log.txt
        echo "----------------------------------------------------"
        echo "🛠️  Fix the code and save. I will try again in 15 seconds..."
        sleep 15
    fi

    # Go back to the root directory to restart the loop
    cd ../..
done
