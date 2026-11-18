// İşletim sistemine göre değişen işler tek yerde: komut bulma, alt süreç başlatma ve durdurma, klasör açma, çöp kutusu, yollar.
// Fonksiyonlar `plat` (process.platform) ve `env` alır ki testte başka bir sistem taklit edilebilsin.
import fs from "node:fs";
import path from "node:path";

export const isWin = (plat = process.platform) => plat === "win32";
export const isMac = (plat = process.platform) => plat === "darwin";

// Komutun PATH'teki tam yolu (Windows'ta PATHEXT uzantılarıyla: claude.cmd, codex.exe). Yoksa "".
// Yol içeren bir komut (C:\x\claude.exe, ./bin/x) olduğu gibi denetlenir.
export function which(cmd, { plat = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (!cmd) return "";
  const win = isWin(plat);
  const p = win ? path.win32 : path.posix;
  // Windows'ta uzantısız dosya denenmez: npm, claude.cmd'nin yanına Windows'ta çalışmayan uzantısız bir sh betiği de koyar.
  const exts = win ? String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase()) : [""];
  const hasExt = win && /\.[a-z0-9]+$/i.test(cmd);
  const tries = (base) => (hasExt ? [base] : exts.map((e) => base + e));
  if (/[\\/]/.test(cmd)) return tries(cmd).find((f) => exists(f)) ?? "";
  const dirs = String(env.PATH ?? env.Path ?? "").split(win ? ";" : ":").filter(Boolean);
  for (const d of dirs) for (const f of tries(p.join(d.replace(/^"(.*)"$/, "$1"), cmd))) if (exists(f)) return f;
  return "";
}
