set -euo pipefail

PROJECT_ROOT="/Users/codygroves/cleanrooms/mw1111-cleanroom-20260421-120146"
DERIVED="/tmp/mw-fresh-derived"
SIM_NAME="iPhone 17 Pro"
BUNDLE_ID="io.ionic.starter"

cd "$PROJECT_ROOT"

echo "=== Git state ==="
git rev-parse --short HEAD
git status --short

echo "=== Verify patch exists in source ==="
grep -R "null_card_fallback_adopted\|nearestRegularCardNodeId" src/lib/webview-injection-script.ts

echo "=== Clean web + iOS copied assets ==="
rm -rf dist ios/App/App/public/assets "$DERIVED"

echo "=== Build web ==="
npm run build

echo "=== Verify patch exists in built dist ==="
grep -R "null_card_fallback_adopted\|nearestRegularCardNodeId" dist/assets || true

echo "=== Sync to iOS ==="
npx cap copy ios

echo "=== Verify patch exists in iOS public assets ==="
grep -R "null_card_fallback_adopted\|nearestRegularCardNodeId" ios/App/App/public/assets || true

echo "=== Boot simulator ==="
xcrun simctl boot "$SIM_NAME" 2>/dev/null || true
open /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app

echo "=== Build iOS app with fixed DerivedData path ==="
xcodebuild \
  -project "$PROJECT_ROOT/ios/App/App.xcodeproj" \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -derivedDataPath "$DERIVED" \
  build

APP_PATH="$DERIVED/Build/Products/Debug-iphonesimulator/App.app"

echo "=== Verify app exists ==="
test -d "$APP_PATH"
echo "$APP_PATH"

echo "=== Uninstall old app if present ==="
xcrun simctl uninstall booted "$BUNDLE_ID" 2>/dev/null || true

echo "=== Install fresh app ==="
xcrun simctl install booted "$APP_PATH"

echo "=== Launch fresh app ==="
xcrun simctl launch booted "$BUNDLE_ID"

echo "=== DONE: fresh app launched ==="
