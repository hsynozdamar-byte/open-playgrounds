#!/bin/zsh
# Developer install (macOS only): Playgrounds.app runs the repo's browser/main.mjs directly, so after a code change only the app needs a
# restart; data stays in the repo's data/. This is not the package for other people: use `npm run dist:mac` / `npm run dist:win` (build/dist.mjs).
# First install or when the Electron version changes: `browser/build.sh` (sessions stay in ~/Library/Application Support/Playgrounds).
# The install goes to ${PG_APP_DIR:-~/Applications}/Playgrounds.app. PG_BUNDLE_ID sets the bundle id, PG_SIGN_ID the signing identity (ad-hoc if unset),
# PG_DESKTOP_ALIAS=1 adds a Finder alias on the Desktop.
set -e
DIR="${0:A:h}"
NAME="Playgrounds"; APP="${PG_APP_DIR:-$HOME/Applications}/Playgrounds.app"; BID="${PG_BUNDLE_ID:-app.playgrounds.desktop}"; ICON="$DIR/../mac/icon-1024.png"; SHELLENV='process.env.PG_SHELL = "app";'

[[ -d "$DIR/node_modules/electron/dist/Electron.app" ]] || (cd "$DIR" && npm install --no-audit --no-fund && node node_modules/electron/install.js)

# Icon: mac/icon-1024.png → .icns
TMP=$(mktemp -d)
SET="$TMP/app.iconset"; mkdir -p "$SET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ICON" --out "$SET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$ICON" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o "$TMP/app.icns"

osascript -e "quit app \"${APP:t:r}\"" 2>/dev/null || true
sleep 1
mkdir -p "${APP:h}"
rm -rf "$APP"
cp -c -R "$DIR/node_modules/electron/dist/Electron.app" "$APP"
C="$APP/Contents"
P() { /usr/libexec/PlistBuddy -c "$1" "$C/Info.plist" 2>/dev/null || true; }
P "Set :CFBundleName $NAME"
P "Add :CFBundleDisplayName string $NAME"
P "Set :CFBundleDisplayName $NAME"
P "Set :CFBundleIdentifier $BID"
P "Set :CFBundleIconFile app.icns"
P "Delete :CFBundleIconName"
P "Set :NSMicrophoneUsageDescription To talk to Rou by voice."
cp "$TMP/app.icns" "$C/Resources/app.icns"
rm -f "$C/Resources/default_app.asar" "$C/Resources/electron.icns"

# App code: the repo's browser/main.mjs (full path). The code stays in the repo; no copy is kept.
mkdir -p "$C/Resources/app"
cat > "$C/Resources/app/package.json" <<JSON
{ "name": "playground-browser", "productName": "$NAME", "version": "1.0.0", "type": "module", "main": "main.mjs" }
JSON
echo "$SHELLENV await import(\"$DIR/main.mjs\");" > "$C/Resources/app/main.mjs"

# Signing: the PG_SIGN_ID identity if given (so permissions survive a reinstall), else ad-hoc.
xattr -cr "$APP"
codesign --force --deep -s "${PG_SIGN_ID:--}" "$APP" 2>&1 | grep -v "replacing existing signature" || true
codesign --verify "$APP" && echo "signature ok"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
# Optional Desktop shortcut (PG_DESKTOP_ALIAS=1): a Finder alias (deleting it removes only the shortcut)
if [[ "$PG_DESKTOP_ALIAS" == "1" ]]; then
  rm -rf "$HOME/Desktop/$NAME" "$HOME/Desktop/$NAME.app" 2>/dev/null || true
  osascript -e "tell application \"Finder\" to make new alias file to (POSIX file \"$APP\") at desktop with properties {name:\"$NAME\"}" >/dev/null 2>&1 || echo "Could not add the Desktop shortcut (permission)"
fi
echo "$APP is ready"
