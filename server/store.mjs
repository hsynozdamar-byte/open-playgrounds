// The single source of truth: data/playground.json. The app, the `pg` CLI and AI tools all read and write this file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trusted } from "./guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.PG_DATA || path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "playground.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const EMPTY = { version: 3, worlds: [], projects: [], tasks: [], blocks: [], sessions: [], inbox: [], timer: null };

export function read() {
  if (!fs.existsSync(DATA_FILE)) write(EMPTY);
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return { state: { ...EMPTY, ...JSON.parse(raw) }, rev: rev() };
}

// Revision: modification time (ns) + size, so two writes in the same millisecond still differ.
function rev() {
  const st = fs.statSync(DATA_FILE, { bigint: true });
  return `${st.mtimeNs}-${st.size}`;
}

function write(state) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  // One backup a day, to get yesterday back after a bad write.
  const backup = path.join(BACKUP_DIR, `${localDay()}.json`);
  if (fs.existsSync(DATA_FILE) && !fs.existsSync(backup)) fs.copyFileSync(DATA_FILE, backup);
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, DATA_FILE);
  return rev();
}

// Read, change, write. If the file changed between read and write (the app saved), the change is applied again to the fresh file.
export function update(fn) {
  for (let i = 0; ; i++) {
    const { state, rev: base } = read();
    const next = fn(state) ?? state;
    if (rev() === base || i >= 4) return write(next);
  }
}

// Backups: data/backups/<day>.json (one a day) and "once-<time>.json" taken before a restore.
export function backups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".json")).map((f) => {
    const file = path.join(BACKUP_DIR, f);
    let n = {};
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      n = { worlds: j.worlds?.length ?? 0, projects: j.projects?.length ?? 0, tasks: j.tasks?.length ?? 0, notes: j.inbox?.length ?? 0 };
    } catch { return null; }
    return { name: f.replace(/\.json$/, ""), at: fs.statSync(file).mtime.toISOString(), ...n };
  }).filter(Boolean).sort((a, b) => b.at.localeCompare(a.at));
}

// Restore: the current state is saved first as "once-...", so a restore can be undone too.
export function restore(name) {
  const file = path.join(BACKUP_DIR, `${path.basename(String(name))}.json`);
  if (!fs.existsSync(file)) return { ok: false, error: "Backup not found" };
  const state = { ...EMPTY, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  const d = new Date();
  const stamp = `${localDay(d)}-${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}`;
  fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `once-${stamp}.json`));
  return { ok: true, rev: write(state) };
}

export const id = () => Math.random().toString(36).slice(2, 8);

// Open pages get a server-sent event whenever the file changes (from the app, `pg` or an AI tool).
const clients = new Set();
let watching = false;
function watch() {
  if (watching) return;
  watching = true;
  read();
  let t;
  fs.watch(DATA_DIR, (_e, name) => {
    if (name !== "playground.json") return;
    clearTimeout(t);
    t = setTimeout(() => {
      let r;
      try { r = rev(); } catch { return; }
      for (const res of clients) res.write(`data: ${r}\n\n`);
    }, 60);
  });
}

// The client's last write (PUT /api/state `save` id): a write repeated because its answer was lost is recognised.
let lastSave = { id: "", rev: "" };
const MAX_BODY = 20 * 1024 * 1024;

// /api/* requests. Both the Vite plugin (npm run dev) and server/app.mjs (npm start) use this.
export function handle(req, res, next) {
  // A page from another site cannot call this server (server/guard.mjs).
  if (!trusted(req)) { res.writeHead(403); return res.end(); }
  let url;
  try { url = new URL(req.url, "http://x"); decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (!url.pathname.startsWith("/api/")) return next?.();
  watch();
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const withBody = (fn) => {
    let body = "", size = 0;
    req.setEncoding("utf8").on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { send(413, { ok: false, error: "Too large" }); req.destroy(); return; }
      body += c;
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      try { fn(JSON.parse(body)); } catch (e) { send(400, { ok: false, error: String(e) }); }
    });
  };
  if (url.pathname === "/api/state" && req.method === "GET") return send(200, read());
  if (url.pathname === "/api/backups" && req.method === "GET") return send(200, backups());
  if (url.pathname === "/api/restore" && req.method === "POST") return withBody(({ name }) => { const r = restore(name); send(r.ok ? 200 : 404, r); });
  if (url.pathname === "/api/state" && req.method === "PUT")
    return withBody(({ state, rev: base, save }) => {
      // The same write repeated (its first answer never reached the client) is not applied again.
      if (save && save === lastSave.id) return send(200, { rev: lastSave.rev });
      // If the file changed meanwhile (pg or an AI tool wrote), do not overwrite it.
      if (base && base !== rev()) return send(409, read());
      const r = write(state);
      if (save) lastSave = { id: save, rev: r };
      send(200, { rev: r });
    });
  if (url.pathname === "/api/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`data: ${rev()}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  send(404, { error: "not found" });
}
