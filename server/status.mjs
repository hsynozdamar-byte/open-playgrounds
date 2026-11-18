// Status of the assistant: is the selected command (Claude Code, Codex, Gemini CLI ...) on this computer and signed in.
// Is Rou's code change turned on (PG_CHANGE=1).
import { execFile } from "node:child_process";
import { changeOn } from "./change.mjs";
import { caps, CLIS, llmConfig } from "../shared/llm.mjs";
import { spawnSpec, which } from "../shared/platform.mjs";

// The sign-in check can take a few seconds; the result is kept for 5 minutes (checked again when the command changes).
let cache = null;
const run = (file, args) => { const sp = spawnSpec(file, args, { timeout: 10000 }); return new Promise((resolve) => execFile(sp.file, sp.args, sp.opts, (err, out) => resolve({ err, out: String(out ?? "") }))); };

async function check(cfg) {
  const path = which(cfg.file);
  if (!path) return { state: "missing" };
  if (cfg.kind === "claude") {
    const { err, out } = await run(path, [...cfg.pre, "auth", "status"]);
    if (err?.code === "ENOENT") return { state: "missing" };
    try { return JSON.parse(out).loggedIn ? { state: "ok" } : { state: "off" }; } catch { return { state: err ? "off" : "unknown" }; }
  }
  // Codex: `codex login status` exits 0 when signed in. Gemini and other commands have no sign-in check: if present they count as ready.
  if (cfg.kind === "codex") return (await run(path, [...cfg.pre, "login", "status"])).err ? { state: "off" } : { state: "ok" };
  return { state: "ok" };
}

export async function status(_dir, state) {
  const cfg = llmConfig(process.env, state?.settings?.llm);
  if (!cache || cache.cmd !== cfg.cmd || Date.now() - cache.at > 5 * 60 * 1000) cache = { at: Date.now(), cmd: cfg.cmd, v: await check(cfg) };
  return {
    // The `claude` key is for older clients: the status of the selected assistant.
    claude: cache.v,
    llm: { id: cfg.id, name: cfg.name, cmd: cfg.cmd, fromEnv: cfg.fromEnv, caps: caps(cfg), install: CLIS[cfg.kind]?.install ?? "" },
    change: changeOn(),
  };
}

export const forget = () => (cache = null);
