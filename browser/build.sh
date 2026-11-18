#!/bin/zsh
# Playgrounds.app: Electron kabuğu (Chromium). Pencerede Playgrounds'un kendisi, Tarayıcı sayfasında dünyaların gerçek sekmeleri.
# Kod bu klasörde kalır: uygulama browser/main.mjs'i doğrudan çalıştırır, kod değişince yalnız uygulamayı yeniden başlatmak yeter.
# İlk kurulum ya da Electron sürümü değişince: `browser/build.sh` (oturumlar ~/Library/Application Support/Playground Browser'da kalır).
# Kurulum ${PG_APP_DIR:-~/Applications}/Playgrounds.app'e yazılır. PG_BUNDLE_ID kimliği, PG_SIGN_ID imza kimliğini (yoksa ad-hoc),
# PG_DESKTOP_ALIAS=1 Masaüstüne Finder kısayolunu ekler.
set -e
DIR="${0:A:h}"
NAME="Playgrounds"; APP="${PG_APP_DIR:-$HOME/Applications}/Playgrounds.app"; BID="${PG_BUNDLE_ID:-app.playgrounds.desktop}"; ICON="$DIR/../mac/icon-1024.png"; SHELLENV='process.env.PG_SHELL = "app";'

[[ -d "$DIR/node_modules/electron/dist/Electron.app" ]] || (cd "$DIR" && npm install --no-audit --no-fund && node node_modules/electron/install.js)

# İkon: mac/icon-1024.png → .icns
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
# PlistBuddy düz kesme işaretini siler: ’ kullan.
P "Set :NSMicrophoneUsageDescription Rou’ya sesle komut vermek için."
cp "$TMP/app.icns" "$C/Resources/app.icns"
rm -f "$C/Resources/default_app.asar" "$C/Resources/electron.icns"

# Uygulama kodu: depodaki browser/main.mjs (tam yol). Kod depoda kalır, kopyası tutulmaz.
mkdir -p "$C/Resources/app"
cat > "$C/Resources/app/package.json" <<JSON
{ "name": "playground-browser", "productName": "$NAME", "version": "1.0.0", "type": "module", "main": "main.mjs" }
JSON
echo "$SHELLENV await import(\"$DIR/main.mjs\");" > "$C/Resources/app/main.mjs"

# İmza: PG_SIGN_ID verilirse o kimlik (izinler yeniden kurulumda sıfırlanmasın), yoksa ad-hoc.
xattr -cr "$APP"
codesign --force --deep -s "${PG_SIGN_ID:--}" "$APP" 2>&1 | grep -v "replacing existing signature" || true
codesign --verify "$APP" && echo "imza tamam"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP"
# İsteğe bağlı masaüstü kısayolu (PG_DESKTOP_ALIAS=1): Finder takma adı (silinirse yalnız kısayol gider)
if [[ "$PG_DESKTOP_ALIAS" == "1" ]]; then
  rm -rf "$HOME/Desktop/$NAME" "$HOME/Desktop/$NAME.app" 2>/dev/null || true
  osascript -e "tell application \"Finder\" to make new alias file to (POSIX file \"$APP\") at desktop with properties {name:\"$NAME\"}" >/dev/null 2>&1 || echo "Masaüstü kısayolu konamadı (izin)"
fi
echo "$APP hazır"
