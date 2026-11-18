// İşletim sistemine göre değişen işler tek yerde: komut bulma, alt süreç başlatma ve durdurma, klasör açma, çöp kutusu, yollar.
// Fonksiyonlar `plat` (process.platform) ve `env` alır ki testte başka bir sistem taklit edilebilsin.
import { spawn, spawnSync } from "node:child_process";
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

// Windows'ta .cmd/.bat (npm'in kurduğu claude.cmd, codex.cmd, npx.cmd) doğrudan başlatılamaz (Node ≥18.20 reddeder) ve
// shell: true argümanları kaçışsız birleştirir. cross-spawn'ın yolu: cmd.exe /d /s /c "<komut> <kaçışlı argümanlar>".
const META = /([()\][%!^"`<>&|;, *?])/g;
// Argüman: tırnaklanır, cmd.exe özel karakterleri ^ ile kaçar; .cmd betikleri argümanı bir kez daha açtığı için iki kez.
export function cmdQuote(arg, double = true) {
  let a = String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  a = `"${a}"`.replace(META, "^$1");
  return double ? a.replace(META, "^$1") : a;
}
// Döner: spawn(file, args, opts) için { file, args, opts }. opts'a windowsHide eklenir.
export function spawnSpec(file, args = [], opts = {}, { plat = process.platform } = {}) {
  const o = { windowsHide: true, ...opts };
  if (!isWin(plat) || !/\.(cmd|bat)$/i.test(file)) return { file, args, opts: o };
  const line = [String(file).replace(META, "^$1"), ...args.map((a) => cmdQuote(a))].join(" ");
  return { file: "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], opts: { ...o, windowsVerbatimArguments: true } };
}
// Komutu PATH'te bulup başlatılabilir biçime getirir (bulunamazsa adıyla; hata spawn'ın "error" olayında gelir).
export const resolveSpawn = (cmd, args, opts, o = {}) => spawnSpec(which(cmd, o) || cmd, args, opts, o);

// npx: Windows'ta npx.cmd (MCP sunucusu yapılandırmasında { command: "cmd", args: ["/c", "npx", ...] }).
export const npxCommand = (args, { plat = process.platform } = {}) => (isWin(plat) ? { command: "cmd", args: ["/c", "npx", ...args] } : { command: "npx", args });

// Süreci açtığı alt süreçlerle birlikte durdurur. Unix'te süreç grubu (detached başlatılmış olmalı), Windows'ta taskkill /T.
export function killTree(pid, { plat = process.platform, run, kill = process.kill } = {}) {
  if (!pid) return;
  if (isWin(plat)) {
    const go = run ?? ((f, a) => spawn(f, a, { stdio: "ignore", windowsHide: true }).on("error", () => {}));
    go("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  try { kill(-pid, "SIGTERM"); } catch { try { kill(pid, "SIGTERM"); } catch { /* çoktan bitmiş */ } }
}

// Klasörü ya da dosyayı sistemin dosya yöneticisinde açmak için komut.
export const openCommand = (p, { plat = process.platform } = {}) => (isMac(plat) ? ["open", [p]] : isWin(plat) ? ["explorer.exe", [p]] : ["xdg-open", [p]]);

// Çöp kutusuna taşıma komutu: macOS ~/.Trash'e taşınır (rename, komut yok); Windows'ta PowerShell ile Geri Dönüşüm Kutusu;
// Linux'ta gio trash. Döner: null (macOS: elle taşı) ya da [komut, argümanlar].
export function trashCommand(p, { plat = process.platform } = {}) {
  if (isMac(plat)) return null;
  if (isWin(plat)) {
    const q = String(p).replace(/'/g, "''");
    return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName Microsoft.VisualBasic; $p='${q}'; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }`]];
  }
  return ["gio", ["trash", p]];
}

// ffmpeg ve ffprobe: PG_FFMPEG / PG_FFPROBE ile tam yol verilebilir; yoksa PATH'teki ad (Windows'ta ffmpeg.exe kendiliğinden bulunur).
export const FFMPEG = process.env.PG_FFMPEG || "ffmpeg";
export const FFPROBE = process.env.PG_FFPROBE || "ffprobe";

// "~" ve "~/x" (Windows'ta "~\x" de) kullanıcı klasörüne açılır.
export const expandHome = (p, home) => String(p ?? "").replace(/^~(?=[\\/]|$)/, home);
// Medya anahtarı: klasöre göre yol, her sistemde "/" ile (veride saklanır, adreste kullanılır).
export const mediaKey = (rel) => String(rel).split(/[\\/]+/).join("/");

// Yalnız macOS'ta çalışan işler: arayüz bunları başka sistemde gizler (GET /api/platform).
export const features = ({ plat = process.platform, shell = false } = {}) => ({
  os: plat,
  features: { focusChrome: isMac(plat), macNotify: isMac(plat), trash: true, openFolder: true, shell },
});

// Senkron indirme (curl yerine; Windows'ta curl her zaman yok). Ayrı bir Node süreci fetch ile indirir: zaman ve boyut sınırlı.
// Döner: true (dosya yazıldı) ya da false.
export function downloadSync(url, file, { ms = 25000, max = 30 * 1024 * 1024 } = {}) {
  if (!/^https?:\/\//i.test(String(url))) return false;
  const js = `const [u,f,max]=process.argv.slice(1);fetch(u,{redirect:"follow",signal:AbortSignal.timeout(${ms})}).then(async(r)=>{if(!r.ok)process.exit(2);const b=Buffer.from(await r.arrayBuffer());if(b.length>Number(max))process.exit(3);require("fs").writeFileSync(f,b);}).catch(()=>process.exit(1));`;
  const r = spawnSync(process.execPath, ["-e", js, String(url), file, String(max)], { timeout: ms + 5000, windowsHide: true, stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  return r.status === 0 && fs.existsSync(file);
}
