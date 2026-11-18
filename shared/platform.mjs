// Everything that differs by operating system in one place: finding commands, starting and stopping child processes, opening folders, the trash, paths.
// Functions take `plat` (process.platform) and `env` so a test can imitate another system.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const isWin = (plat = process.platform) => plat === "win32";
export const isMac = (plat = process.platform) => plat === "darwin";

// The full path of a command on PATH (on Windows with PATHEXT extensions: claude.cmd, codex.exe). "" when missing.
// A command with a path in it (C:\x\claude.exe, ./bin/x) is checked as it is.
export function which(cmd, { plat = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (!cmd) return "";
  const win = isWin(plat);
  const p = win ? path.win32 : path.posix;
  // On Windows files without an extension are not tried: npm also puts an extensionless sh script next to claude.cmd, which does not run on Windows.
  const exts = win ? String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase()) : [""];
  const hasExt = win && /\.[a-z0-9]+$/i.test(cmd);
  const tries = (base) => (hasExt ? [base] : exts.map((e) => base + e));
  if (/[\\/]/.test(cmd)) return tries(cmd).find((f) => exists(f)) ?? "";
  const dirs = String(env.PATH ?? env.Path ?? "").split(win ? ";" : ":").filter(Boolean);
  for (const d of dirs) for (const f of tries(p.join(d.replace(/^"(.*)"$/, "$1"), cmd))) if (exists(f)) return f;
  return "";
}

// On Windows .cmd/.bat files (claude.cmd, codex.cmd, npx.cmd installed by npm) cannot be started directly (Node ≥18.20 refuses) and
// shell: true joins the arguments without escaping. The cross-spawn way: cmd.exe /d /s /c "<command> <escaped arguments>".
const META = /([()\][%!^"`<>&|;, *?])/g;
// An argument is quoted and cmd.exe special characters are escaped with ^; twice, because .cmd scripts expand the argument once more.
export function cmdQuote(arg, double = true) {
  let a = String(arg).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  a = `"${a}"`.replace(META, "^$1");
  return double ? a.replace(META, "^$1") : a;
}
// Returns { file, args, opts } for spawn(file, args, opts). windowsHide is added to opts.
export function spawnSpec(file, args = [], opts = {}, { plat = process.platform } = {}) {
  const o = { windowsHide: true, ...opts };
  if (!isWin(plat) || !/\.(cmd|bat)$/i.test(file)) return { file, args, opts: o };
  const line = [String(file).replace(META, "^$1"), ...args.map((a) => cmdQuote(a))].join(" ");
  return { file: "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], opts: { ...o, windowsVerbatimArguments: true } };
}
// Finds the command on PATH and makes it startable (by its name when not found; the error arrives in spawn's "error" event).
export const resolveSpawn = (cmd, args, opts, o = {}) => spawnSpec(which(cmd, o) || cmd, args, opts, o);

// npx: npx.cmd on Windows (in an MCP server config { command: "cmd", args: ["/c", "npx", ...] }).
export const npxCommand = (args, { plat = process.platform } = {}) => (isWin(plat) ? { command: "cmd", args: ["/c", "npx", ...args] } : { command: "npx", args });

// Stops a process together with the child processes it started. On Unix the process group (must have been started detached), on Windows taskkill /T.
export function killTree(pid, { plat = process.platform, run, kill = process.kill } = {}) {
  if (!pid) return;
  if (isWin(plat)) {
    const go = run ?? ((f, a) => spawn(f, a, { stdio: "ignore", windowsHide: true }).on("error", () => {}));
    go("taskkill", ["/pid", String(pid), "/T", "/F"]);
    return;
  }
  try { kill(-pid, "SIGTERM"); } catch { try { kill(pid, "SIGTERM"); } catch { /* already finished */ } }
}

// The command to open a folder or file in the system's file manager.
export const openCommand = (p, { plat = process.platform } = {}) => (isMac(plat) ? ["open", [p]] : isWin(plat) ? ["explorer.exe", [p]] : ["xdg-open", [p]]);

// Command to move to the trash: on macOS the file is moved to ~/.Trash (a rename, no command); on Windows the Recycle Bin through PowerShell;
// on Linux gio trash. Returns null (macOS: move it by hand) or [command, arguments].
export function trashCommand(p, { plat = process.platform } = {}) {
  if (isMac(plat)) return null;
  if (isWin(plat)) {
    const q = String(p).replace(/'/g, "''");
    return ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Add-Type -AssemblyName Microsoft.VisualBasic; $p='${q}'; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }`]];
  }
  return ["gio", ["trash", p]];
}

// ffmpeg and ffprobe: PG_FFMPEG / PG_FFPROBE can give a full path; otherwise the name on PATH (on Windows ffmpeg.exe is found by itself).
export const FFMPEG = process.env.PG_FFMPEG || "ffmpeg";
export const FFPROBE = process.env.PG_FFPROBE || "ffprobe";

// "~" and "~/x" (also "~\x" on Windows) expand to the home folder.
export const expandHome = (p, home) => String(p ?? "").replace(/^~(?=[\\/]|$)/, home);
// Media key: the path inside the folder, with "/" on every system (stored in data, used in addresses).
export const mediaKey = (rel) => String(rel).split(/[\\/]+/).join("/");

// Jobs that work only on macOS: the interface hides them on other systems (GET /api/platform).
export const features = ({ plat = process.platform, shell = false } = {}) => ({
  os: plat,
  features: { focusChrome: isMac(plat), macNotify: isMac(plat), trash: true, openFolder: true, shell },
});

// Synchronous download (instead of curl; Windows does not always have curl). A separate Node process downloads with fetch: limited in time and size.
// Returns true (file written) or false.
export function downloadSync(url, file, { ms = 25000, max = 30 * 1024 * 1024 } = {}) {
  if (!/^https?:\/\//i.test(String(url))) return false;
  const js = `const [u,f,max]=process.argv.slice(1);fetch(u,{redirect:"follow",signal:AbortSignal.timeout(${ms})}).then(async(r)=>{if(!r.ok)process.exit(2);const b=Buffer.from(await r.arrayBuffer());if(b.length>Number(max))process.exit(3);require("fs").writeFileSync(f,b);}).catch(()=>process.exit(1));`;
  const r = spawnSync(process.execPath, ["-e", js, String(url), file, String(max)], { timeout: ms + 5000, windowsHide: true, stdio: "ignore", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  return r.status === 0 && fs.existsSync(file);
}
