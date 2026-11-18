// Update: when the source (src, shared, public, index.html) is newer than the built version (dist), or server code (server, shared, scripts)
// changed after the server started, the app says an update is available. POST /api/update builds; if server code changed, the supervised
// server exits with code 75 and restarts (server/serve.mjs). On the dev server (npm run dev) Vite already updates instantly.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { read } from "./store.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const STARTED = Date.now();
const newest = (rels) => {
  let m = 0;
  const walk = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const f of fs.readdirSync(p)) if (f !== "node_modules") walk(path.join(p, f)); }
    else m = Math.max(m, st.mtimeMs);
  };
  for (const r of rels) walk(path.join(ROOT, r));
  return m;
};
const builtAt = () => { try { return fs.statSync(path.join(ROOT, "dist/index.html")).mtimeMs; } catch { return 0; } };

export function version() {
  if (!process.env.PG_SUPERVISED) return { dev: true };
  const built = builtAt();
  return { built, client: newest(["src", "shared", "public", "index.html"]) > built, server: newest(["server", "shared"]) > STARTED, ...(pending ? { pending: true, jobs: jobNames() } : {}) };
}

// A restart is armed and running jobs are being waited for. Meanwhile the scheduler starts no new prepares (server/schedule.mjs):
// otherwise the queue never empties and the update would not come for hours. The app shows what it waits for by name (src/ui/Update.tsx).
let pending = false;
export const restartPending = () => pending;
function jobNames(now = Date.now()) {
  try {
    const { state: s } = read();
    return [...new Set(s.runs.filter((r) => r.status === "working" && now - new Date(r.at).getTime() < 90 * 60000).map((r) => s.tasks.find((t) => t.id === r.taskId)?.title ?? r.title ?? "Preparing"))].slice(0, 6);
  } catch { return []; }
}

// Jobs running while the server restarts are cut off (prepare, share, Rou's code change): the restart waits for them (90 min at most).
export function jobsRunning(now = Date.now()) {
  try {
    const { state: s } = read();
    const fresh = (at, min) => at && now - new Date(at).getTime() < min * 60000;
    const prep = s.runs.filter((r) => r.status === "working" && fresh(r.at, 90)).length;
    const share = s.runs.filter((r) => r.status === "approved" && r.publish?.phase && !r.publish.handoff && fresh(r.publish.at, 20)).length;
    // Rou's code change is one long step (at is not refreshed): a short window would let an update cut it off
    // mid-work and leave half-written files uncommitted. Same window as preparing.
    const change = s.change && !s.change.done && fresh(s.change.at, 90) ? 1 : 0;
    return prep + share + change;
  } catch { return 0; }
}
export const idle = async () => { for (const end = Date.now() + 90 * 60000; Date.now() < end && jobsRunning() > 0; ) await new Promise((r) => setTimeout(r, 3000)); };

let busy = null;
export function update() {
  if (busy) return busy;
  busy = new Promise((resolve) => {
    const v = version();
    // busy is cleared on the next tick: cleared synchronously here, the promise assigned afterwards would return the old result forever
    const done = (r) => { queueMicrotask(() => (busy = null)); resolve(r); if (r.ok && v.server && !pending) { pending = true; void idle().then(() => setTimeout(() => process.exit(75), 300)); } };
    if (!v.client) return done({ ok: true, restart: !!v.server, waiting: v.server ? jobsRunning() : 0 });
    const p = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], shell: process.platform === "win32" });
    let err = "";
    p.stderr.setEncoding("utf8").on("data", (d) => (err += d));
    p.on("close", (code) => done(code === 0 ? { ok: true, restart: !!v.server, waiting: v.server ? jobsRunning() : 0 } : { ok: false, error: err.slice(-400) || `vite build ${code}` }));
  });
  return busy;
}
