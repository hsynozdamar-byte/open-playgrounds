// Masaüstü kurulum paketi (electron-builder): `npm run dist:mac` → dist-electron/Playgrounds-<sürüm>-<mimari>.dmg,
// `npm run dist:win` → dist-electron/Playgrounds-Setup-<sürüm>.exe (NSIS: Masaüstü ve Başlat menüsü kısayolu).
// Uygulama kendi kopyasını taşır: derlenmiş dist/, server/, shared/, scripts/, browser/ ve render/ kaynakları (render bağımlılıkları yok).
// Sunucu Electron'un Node'uyla çalışır; veri kullanıcı klasöründe (browser/main.mjs).
// İmza: CSC_NAME ya da CSC_LINK verilirse electron-builder o kimlikle imzalar; yoksa macOS'ta ad-hoc imza (codesign -s -), Windows imzasız.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { build, Platform } from "electron-builder";

const target = process.argv[2];
if (!["mac", "win"].includes(target)) {
  console.error("Kullanım: node build/dist.mjs mac|win");
  process.exit(1);
}
const identity = !!(process.env.CSC_NAME || process.env.CSC_LINK);

/** @type {import("electron-builder").Configuration} */
const config = {
  appId: "app.playgrounds.desktop",
  productName: "Playgrounds",
  directories: { output: "dist-electron", buildResources: "build" },
  // asar kapalı: sunucu ve Rou'nun çalıştırdığı betikler (node scripts/shot.mjs) dosyaları düz yoldan okur.
  asar: false,
  npmRebuild: false,
  files: [
    "package.json",
    "browser/**/*", "!browser/node_modules/**", "!browser/build.sh", "!browser/icon.*", "!browser/icon-1024.png", "!browser/package*.json",
    "server/**/*", "shared/**/*", "dist/**/*",
    "scripts/**/*", "!scripts/.tmp-*",
    "render/**/*", "!render/node_modules/**", "!render/.cache/**",
  ],
  extraMetadata: { main: "browser/main.mjs" },
  publish: null,
  // Yeni NSIS paketi (3.12): eski 3.0.4 makensis yalnız x86_64, Apple Silicon'da Rosetta olmadan çalışmıyor.
  toolsets: { nsis: "1.2.1" },
  mac: {
    target: ["dmg"],
    category: "public.app-category.productivity",
    icon: "build/icon.png",
    identity: identity ? undefined : null,
    hardenedRuntime: identity,
    extendInfo: { NSMicrophoneUsageDescription: "Rou'ya sesle yazmak için." },
  },
  dmg: { artifactName: "Playgrounds-${version}-${arch}.${ext}" },
  win: { target: [{ target: "nsis", arch: ["x64"] }], icon: "build/icon.png" },
  nsis: {
    oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: "Playgrounds",
    artifactName: "Playgrounds-Setup-${version}.${ext}",
  },
  // İmza kimliği yoksa macOS paketi ad-hoc imzalanır (Apple Silicon imzasız uygulamayı çalıştırmaz).
  afterPack: async (ctx) => {
    if (ctx.electronPlatformName !== "darwin" || identity) return;
    const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
    execFileSync("codesign", ["--force", "--deep", "-s", "-", app], { stdio: "inherit" });
  },
};

await build({ targets: (target === "mac" ? Platform.MAC : Platform.WINDOWS).createTarget(), config });
