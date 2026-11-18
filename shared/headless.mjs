// Başsız ekran görüntüsü, PDF ve kayıt için ayrı Chrome kabuğu. Kullanıcının Google Chrome'u asla başlatılmaz:
// aynı ikili, profil verilmezse açık Chrome oturumuna bağlanıp onu kapatabiliyor.
// Yol: PG_CHROME, yoksa ~/.cache/pg-headless altında bu sistem için kurulmuş chrome-headless-shell
// (`npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/pg-headless`), yoksa PATH'teki ad.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EXE = process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell";
const PLATFORM = { darwin: process.arch === "arm64" ? "mac_arm" : "mac", win32: "win64", linux: "linux" }[process.platform] ?? process.platform;

function find() {
  const root = path.join(os.homedir(), ".cache", "pg-headless", "chrome-headless-shell");
  let versions = [];
  try { versions = fs.readdirSync(root).filter((d) => d.startsWith(`${PLATFORM}-`)).sort().reverse(); } catch { return EXE; }
  for (const v of versions) {
    let subs = [];
    try { subs = fs.readdirSync(path.join(root, v)); } catch { continue; }
    for (const d of subs) {
      const p = path.join(root, v, d, EXE);
      if (fs.existsSync(p)) return p;
    }
  }
  return EXE;
}

export const HEADLESS = process.env.PG_CHROME || find();
