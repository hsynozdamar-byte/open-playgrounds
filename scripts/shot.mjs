#!/usr/bin/env node
// Turns an HTML or SVG file into a PNG (headless Chrome). Rou uses it to make brand images (logo, cover, profile):
//   node scripts/shot.mjs <input.html|svg> <out.png> <width>x<height> [--transparent] [--scale 3]
// --scale: pixel density (a phone screen 390x844 with --scale 3 = 1170x2532).
// Fonts load in the input with @font-face from a file path (file://); a separate profile is used, an open Chrome is not touched.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HEADLESS } from "../shared/headless.mjs";

const [input, output, size, ...flags] = process.argv.slice(2);
const m = /^(\d{2,5})x(\d{2,5})$/.exec(size ?? "");
if (!input || !output || !m) {
  console.error("Usage: node scripts/shot.mjs <input.html|svg> <out.png> <width>x<height> [--transparent]");
  process.exit(2);
}
const src = path.resolve(input);
if (!fs.existsSync(src)) { console.error(`No such file: ${src}`); process.exit(2); }
const out = path.resolve(output.endsWith(".png") ? output : `${output}.png`);
const CHROME = HEADLESS;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "pg-shot-"));
const args = [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  `--user-data-dir=${profile}`, `--window-size=${m[1]},${m[2]}`, `--force-device-scale-factor=${Math.min(4, Math.max(1, Number(flags[flags.indexOf("--scale") + 1]) || 1))}`,
  "--virtual-time-budget=3000", `--screenshot=${out}`,
  ...(flags.includes("--transparent") ? ["--default-background-color=00000000"] : []),
  pathToFileURL(src).href,
];
const r = spawnSync(CHROME, args, { encoding: "utf8", timeout: 60000 });
fs.rmSync(profile, { recursive: true, force: true });
if (!fs.existsSync(out)) { console.error(`No image was made: ${(r.stderr || r.error?.message || "").slice(-400)}`); process.exit(1); }
console.log(out);
