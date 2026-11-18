// Serves the built app + the API. serve.mjs runs this; if it exits with code 75 (Rou changed server code) it restarts.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { handle, read, update } from "./store.mjs";
import { startSchedule } from "./schedule.mjs";
import { resumeActs } from "./browse.mjs";

const DIST = path.resolve(import.meta.dirname, "../dist");
const PORT = Number(process.env.PORT || 5340);
// Default: this computer only (127.0.0.1). Phone access is optional: PG_LISTEN=0.0.0.0 and PG_ALLOW_TAILSCALE=1
// let devices on the Tailscale network in too; other devices on the same Wi-Fi still cannot. The API has no password.
const HOST = process.env.PG_LISTEN || "127.0.0.1";
const TAILNET = process.env.PG_ALLOW_TAILSCALE === "1";
const allowed = (ip = "") => {
  const a = ip.replace(/^::ffff:/, "");
  if (a === "127.0.0.1" || a === "::1") return true;
  if (!TAILNET) return false;
  const m = a.match(/^100\.(\d+)\./);
  return (m && +m[1] >= 64 && +m[1] <= 127) || a.toLowerCase().startsWith("fd7a:115c:a1e0:");
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };

// One unhandled error must not take the whole server down (scheduler, running prepares, shares): it is logged and the server continues.
process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e?.stack ?? e));
process.on("uncaughtException", (e) => console.error("uncaught exception:", e?.stack ?? e));
// Let the "exit" event run on shutdown: running claude processes are stopped there (server/claude.mjs stopAll).
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => process.exit(0));

// So jobs cut off by a server restart do not stay stuck. It runs after the port is taken: if a second server is started on the
// same port by mistake (the shell's watchdog), it exits without marking the running server's jobs as "interrupted".
function sweep() {
  const half = (r) => r.status === "working" || (r.status === "approved" && r.publish?.phase && r.publish.by === "claude");
  const { state } = read();
  // Old outputs that failed on the design score are reopened for approval with their critique if they are the task's latest output
  // and its day has not passed (otherwise their visuals never show on the card).
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const hidden = (st, r) => r.status === "failed" && /^(Design review failed|Tasarım denetimi geçmedi)/.test(r.renderError ?? "") && (r.video || r.images?.length)
    && !st.runs.some((x) => x.taskId === r.taskId && x.at > r.at) && st.tasks.some((t) => t.id === r.taskId && t.status !== "done" && (t.day ?? "") >= today);
  if (!state.runs?.some(half) && !state.automations?.some((a) => a.ideas?.phase) && !state.runs?.some((r) => hidden(state, r))) return;
  const at = new Date().toISOString();
  update((st) => {
    // The idea search (Rou) is kept in memory; after a restart the "searching" text must not stay.
    for (const a of st.automations ?? []) if (a.ideas?.phase) { delete a.ideas.phase; delete a.ideas.asked; }
    for (const r of st.runs ?? []) if (hidden(st, r)) { r.status = "ready"; delete r.renderError; }
    for (const r of st.runs ?? []) {
      if (r.status === "working") Object.assign(r, { status: "failed", renderError: "Interrupted: the app restarted. You can prepare it again.", phase: undefined });
      // If it closed while Rou was sharing, the post may have gone out: it is not retried by itself, checking is left to the user.
      // (Before, "Rou is sharing" stayed forever and the post neither went out nor reported.)
      else if (half(r)) r.publish = { error: "Interrupted: the app restarted during sharing. Check your profile; if it was shared, press 'I shared it'.", at, by: "claude" };
    }
  });
}

http
  .createServer((req, res) => {
    if (!allowed(req.socket.remoteAddress)) return res.writeHead(403).end();
    return handle(req, res, () => {
      let file = path.join(DIST, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
      // The page is re-requested on every open (a new build shows at once); hashed files stay in cache indefinitely.
      const cache = file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": cache });
      fs.createReadStream(file).pipe(res);
    });
  })
  .on("error", (e) => { console.error(`Server could not start: ${e.message}`); process.exit(1); })
  .listen(PORT, HOST, () => { console.log(`Playground → http://localhost:${PORT}`); sweep(); startSchedule(); if (!process.env.PG_NO_SCHEDULE) { resumeActs(); setTimeout(() => import("./change.mjs").then((C) => C.resumeChanges()).catch(() => {}), 10000); setTimeout(() => import("./pb.mjs").then(async (P) => P.releaseStaleLabels((await import("./store.mjs")).read().state)).catch(() => {}), 8000); } });
