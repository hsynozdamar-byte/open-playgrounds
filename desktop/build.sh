#!/bin/sh
# Builds Playgrounds.app (menu bar app) into desktop/build/. `--install` also copies it to ~/Applications and opens it.
# The app runs this repo's server/app.mjs with the node found now, so it shares data/ with `pg`.
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node not found on PATH" >&2; exit 1; }
OUT="desktop/build"
APP="$OUT/Playgrounds.app"
TMP="$OUT/tmp"

echo "→ web build"
npm run build --silent

echo "→ icons"
rm -rf "$APP" "$TMP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$TMP/Playgrounds.iconset"
swiftc -O desktop/make-icon.swift -o "$TMP/make-icon"
SRC=public/apple-touch-icon.png
"$TMP/make-icon" "$SRC" "$APP/Contents/Resources/orb.png" 256
for s in 16 32 128 256 512; do
  "$TMP/make-icon" "$SRC" "$TMP/Playgrounds.iconset/icon_${s}x${s}.png" $s 0.08
  "$TMP/make-icon" "$SRC" "$TMP/Playgrounds.iconset/icon_${s}x${s}@2x.png" $((s * 2)) 0.08
done
iconutil -c icns "$TMP/Playgrounds.iconset" -o "$APP/Contents/Resources/Playgrounds.icns"

echo "→ app"
swiftc -O desktop/Playgrounds.swift -o "$APP/Contents/MacOS/Playgrounds" \
  -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement -framework UserNotifications
VERSION="$(node -p 'require("./package.json").version')"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Playgrounds</string>
  <key>CFBundleDisplayName</key><string>Playgrounds</string>
  <key>CFBundleIdentifier</key><string>dev.openplaygrounds.app</string>
  <key>CFBundleExecutable</key><string>Playgrounds</string>
  <key>CFBundleIconFile</key><string>Playgrounds</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>PGRoot</key><string>$ROOT</string>
  <key>PGNode</key><string>$NODE</string>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null
rm -rf "$TMP"
echo "✓ $APP"

if [ "$1" = "--install" ]; then
  mkdir -p "$HOME/Applications"
  osascript -e 'quit app "Playgrounds"' 2>/dev/null || true
  # Wait until the old copy has quit, or `open` fails.
  i=0; while pgrep -qf "Playgrounds.app/Contents/MacOS/Playgrounds" && [ $i -lt 50 ]; do sleep 0.1; i=$((i + 1)); done
  rm -rf "$HOME/Applications/Playgrounds.app"
  cp -R "$APP" "$HOME/Applications/"
  # Launch Services can still be letting go of the old copy; try a few times.
  for _ in 1 2 3 4 5 6; do open "$HOME/Applications/Playgrounds.app" 2>/dev/null && break; sleep 0.5; done
  echo "✓ installed to ~/Applications/Playgrounds.app"
fi
