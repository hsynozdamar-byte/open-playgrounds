// Desktop installer (electron-builder): `npm run dist:mac` → dist-electron/Playgrounds-<version>-<arch>.dmg,
// `npm run dist:win` → dist-electron/Playgrounds-Setup-<version>.exe (NSIS: Desktop and Start menu shortcuts).
// The app carries its own copy: the built dist/ plus the server/, shared/, scripts/, browser/ and render/ sources (without render dependencies).
// The server runs on Electron's Node; data lives in the user's folder (browser/main.mjs).
// Signing: electron-builder signs with CSC_NAME or CSC_LINK if given; otherwise an ad-hoc signature on macOS (codesign -s -), unsigned on Windows.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { build, Platform } from "electron-builder";

const target = process.argv[2];
if (!["mac", "win"].includes(target)) {
  console.error("Usage: node build/dist.mjs mac|win");
  process.exit(1);
}
const identity = !!(process.env.CSC_NAME || process.env.CSC_LINK);

/** @type {import("electron-builder").Configuration} */
const config = {
  appId: "app.playgrounds.desktop",
  productName: "Playgrounds",
  directories: { output: "dist-electron", buildResources: "build" },
  // asar is off: the server and the scripts Rou runs (node scripts/shot.mjs) read files by plain path.
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
  // Newer NSIS package (3.12): the old 3.0.4 makensis is x86_64 only and does not run on Apple Silicon without Rosetta.
  toolsets: { nsis: "1.2.1" },
  mac: {
    target: ["dmg"],
    category: "public.app-category.productivity",
    icon: "build/icon.png",
    identity: identity ? undefined : null,
    hardenedRuntime: identity,
    extendInfo: { NSMicrophoneUsageDescription: "To talk to Rou by voice." },
  },
  dmg: { artifactName: "Playgrounds-${version}-${arch}.${ext}" },
  win: { target: [{ target: "nsis", arch: ["x64"] }], icon: "build/icon.png" },
  nsis: {
    oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: "Playgrounds",
    artifactName: "Playgrounds-Setup-${version}.${ext}",
  },
  // Without a signing identity the macOS package is signed ad-hoc (Apple Silicon does not run unsigned apps).
  afterPack: async (ctx) => {
    if (ctx.electronPlatformName !== "darwin" || identity) return;
    const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
    execFileSync("codesign", ["--force", "--deep", "-s", "-", app], { stdio: "inherit" });
  },
};

await build({ targets: (target === "mac" ? Platform.MAC : Platform.WINDOWS).createTarget(), config });
