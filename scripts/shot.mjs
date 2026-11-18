#!/usr/bin/env node
// HTML ya da SVG dosyasını PNG'ye çevirir (Chrome headless). Rou marka görseli (logo, kapak, profil) üretirken kullanır:
//   node scripts/shot.mjs <girdi.html|svg> <çıktı.png> <genişlik>x<yükseklik> [--transparent] [--scale 3]
// --scale: piksel yoğunluğu (telefon ekranı 390x844 --scale 3 = 1170x2532).
// Fontlar girdide @font-face ile dosya yolundan (file://) yüklenir; ayrı bir profil kullanılır, açık Chrome'a dokunmaz.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HEADLESS } from "../shared/headless.mjs";

const [input, output, size, ...flags] = process.argv.slice(2);
const m = /^(\d{2,5})x(\d{2,5})$/.exec(size ?? "");
if (!input || !output || !m) {
  console.error("Kullanım: node scripts/shot.mjs <girdi.html|svg> <çıktı.png> <genişlik>x<yükseklik> [--transparent]");
  process.exit(2);
}
const src = path.resolve(input);
if (!fs.existsSync(src)) { console.error(`Dosya yok: ${src}`); process.exit(2); }
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
if (!fs.existsSync(out)) { console.error(`Görsel çıkmadı: ${(r.stderr || r.error?.message || "").slice(-400)}`); process.exit(1); }
console.log(out);
