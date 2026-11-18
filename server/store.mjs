// Single source of truth: data/playground.json. The app, the CLI (pg) and Claude all read and write the same file.
import { update as updateApp, version } from "./update.mjs";
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepare, prepareMany, rerender, copyMedia, makeImage, cancel, setRunText, activeJobs } from "./prepare.mjs";
import { browsers, checkAccount, publish, publishing } from "./publish.mjs";
import { publishing as sharing } from "./share.mjs";
import { addDays, fillTopics, planTopics } from "./plan.mjs";
import { act, chooseBrowser, doTask, folderOf, startDirect } from "./browse.mjs";
import { spawn } from "node:child_process";
import { draft } from "./draft.mjs";
import { ask } from "./rou.mjs";
import { startChange, undoChange, changeOn } from "./change.mjs";
import { mediaPath, transcribe, upload } from "./attach.mjs";
import { runVoice } from "./voice.mjs";
import { status, forget } from "./status.mjs";
import { migrate } from "../shared/social.mjs";
import { migrateRous } from "../shared/rou.mjs";
import { pruneNotices } from "../shared/notices.mjs";
import { trusted } from "./guard.mjs";
import { llmFrom } from "./claude.mjs";
import { features, isMac, openCommand } from "../shared/platform.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.PG_DATA || path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "playground.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const EMPTY = { version: 3, worlds: [], projects: [], tasks: [], blocks: [], sessions: [], inbox: [], timer: null, automations: [], runs: [] };

export function read() {
  if (!fs.existsSync(DATA_FILE)) write(EMPTY);
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  const state = { ...EMPTY, ...JSON.parse(raw) };
  // Data in an old format is converted to the new format once and written back.
  if (migrate(state) | migrateRous(state) | pruneNotices(state)) return { state, rev: write(state) };
  return { state, rev: rev() };
}

// Revision: modified time (ns) + size. Even two writes in the same millisecond differ.
function rev() {
  const st = fs.statSync(DATA_FILE, { bigint: true });
  return `${st.mtimeNs}-${st.size}`;
}

function write(state) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  // One backup a day: to get yesterday back after a bad write.
  const day = localDay();
  const backup = path.join(BACKUP_DIR, `${day}.json`);
  if (fs.existsSync(DATA_FILE) && !fs.existsSync(backup)) fs.copyFileSync(DATA_FILE, backup);
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, DATA_FILE);
  return rev();
}

// Read, change, write. If the file changed between the read and the write (the app saved), the change is applied again to the current file.
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
      n = { worlds: j.worlds?.length ?? 0, projects: j.projects?.length ?? 0, tasks: j.tasks?.length ?? 0, notes: j.inbox?.length ?? 0, automations: j.automations?.length ?? 0 };
    } catch { return null; }
    return { name: f.replace(/\.json$/, ""), at: fs.statSync(file).mtime.toISOString(), ...n };
  }).filter(Boolean).sort((a, b) => b.at.localeCompare(a.at));
}

// Restore: the current state is first kept as "once-...", so a restore can be undone too.
export function restore(name) {
  const file = path.join(BACKUP_DIR, `${path.basename(String(name))}.json`);
  if (!fs.existsSync(file)) return { ok: false, error: "Backup not found" };
  const state = { ...EMPTY, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  const d = new Date();
  const stamp = `${localDay(d)}-${String(d.getHours()).padStart(2, "0")}-${String(d.getMinutes()).padStart(2, "0")}`;
  fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `once-${stamp}.json`));
  return { ok: true, rev: write(state) };
}

// Rou's command comes from Settings › Assistant (state.settings.llm); the current data is read on every call.
llmFrom(() => read().state.settings?.llm);

export const id = () => Math.random().toString(36).slice(2, 8);

// Opens the folder in the system's file manager.
function openPath(dir) {
  const [cmd, args] = openCommand(dir);
  spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
}

// /api/* requests. Both the Vite plugin and serve.mjs use this.
const clients = new Set();
// Sends a notification to the open pages; the desktop app shows it with its own icon. False when no page is open.
export function notice(title, text) {
  if (!clients.size) return false;
  const data = JSON.stringify({ title: title.slice(0, 120), text: text.slice(0, 300) });
  for (const res of clients) res.write(`event: notice\ndata: ${data}\n\n`);
  return true;
}
globalThis.__pgNotice = notice;
const busy = { draft: false, rou: false, plan: false, topics: false };
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

// Images prepared by Rou: data/media/<file>, served as /media/<file>.
export const MEDIA_DIR = path.join(DATA_DIR, "media");
const IMG = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".heic": "image/heic", ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".aac": "audio/aac", ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".csv": "text/plain; charset=utf-8", ".json": "application/json" };

// Serves the file; video and audio players (especially Safari) ask for it in parts.
function stream(req, res, file, cache) {
  const head = { "content-type": IMG[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": cache, "accept-ranges": "bytes" };
  const size = fs.statSync(file).size;
  // A read error (the file was just deleted) or a request cut off midway does not crash the server or leave a file open.
  const send = (opt) => { const f = fs.createReadStream(file, opt); f.on("error", () => res.destroy()); res.on("close", () => f.destroy()); return f.pipe(res); };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
  if (m && size && (m[1] || m[2])) {
    const start = m[1] ? Math.min(+m[1], size - 1) : Math.max(0, size - +m[2]);
    const end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start > end) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...head, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
    return send({ start, end });
  }
  res.writeHead(200, { ...head, "content-length": size });
  return send();
}

// The client's last write (the `save` id of PUT /api/state): a write whose answer was lost is recognised when repeated.
let lastSave = { id: "", rev: "" };

export function handle(req, res, next) {
  // A page of another site cannot send requests to this server (server/guard.mjs).
  if (!trusted(req)) { res.writeHead(403); return res.end(); }
  // A malformed address (e.g. /media/%E0%A4%A) must not crash the server: 400.
  let url;
  try { url = new URL(req.url, "http://x"); decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (url.pathname.startsWith("/media/")) {
    const file = path.join(MEDIA_DIR, path.basename(decodeURIComponent(url.pathname)));
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    return stream(req, res, file, "max-age=31536000, immutable");
  }
  // The project's media library (server/library.mjs): files stay in place and cannot reach outside the folder.
  if (url.pathname === "/lib/file" || url.pathname === "/lib/thumb") {
    return void import("./library.mjs").then(async (L) => {
      const file = L.fileOfKey(url.searchParams.get("p"), url.searchParams.get("rel"));
      if (!file) { res.writeHead(404); return res.end(); }
      if (url.pathname === "/lib/file") return stream(req, res, file, "no-cache");
      const t = await L.thumb(file);
      if (!t) { res.writeHead(404); return res.end(); }
      stream(req, res, t, "max-age=86400");
    }).catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
  }
  // The first page of Rou's job tab in the Playgrounds browser (server/pb.mjs).
  if (url.pathname === "/pb/go")
    return void import("./pb.mjs").then((P) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(P.goPage());
    });
  if (!url.pathname.startsWith("/api/")) return next?.();
  watch();
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // Identity: the desktop app uses a server on a port only if it belongs to its own install (token) or to the same data
  // folder (browser/main.mjs pickPort). A hash of the folder is sent, not the folder itself.
  // System: jobs that work only on macOS are hidden by the interface on other systems (shared/platform.mjs features).
  if (url.pathname === "/api/platform" && req.method === "GET") return send(200, features({ shell: process.env.PG_SHELL === "app" }));
  if (url.pathname === "/api/whoami" && req.method === "GET")
    return send(200, { app: "playgrounds", token: process.env.PG_INSTALL_TOKEN || null, data: createHash("sha256").update(path.resolve(DATA_DIR)).digest("hex").slice(0, 16) });
  if (url.pathname === "/api/state" && req.method === "GET") return send(200, read());
  if (url.pathname === "/api/library" && req.method === "GET")
    return void import("./library.mjs").then((L) => { const r = L.listAll(url.searchParams.get("p")); send(r.ok ? 200 : 404, r); }).catch((e) => send(500, { ok: false, error: String(e?.message ?? e).slice(0, 200) }));
  // ?fresh=1: "Retry" skips the cached Claude result.
  if (url.pathname === "/api/status" && req.method === "GET") {
    if (url.searchParams.get("fresh")) forget();
    return void status(DATA_DIR, read().state).then((r) => send(200, r));
  }
  // Requests with a JSON body; 400 if the body cannot be read.
  const withBody = (fn) => {
    let body = "";
    req.setEncoding("utf8").on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        await fn(JSON.parse(body));
      } catch (e) {
        send(400, { ok: false, error: String(e) });
      }
    });
  };
  if (url.pathname === "/api/version" && req.method === "GET") return send(200, version());
  if (url.pathname === "/api/update" && req.method === "POST") return void updateApp().then((r) => send(r.ok ? 200 : 500, r));
  if (url.pathname === "/api/backups" && req.method === "GET") return send(200, backups());
  if (url.pathname === "/api/restore" && req.method === "POST") return withBody(({ name }) => { const r = restore(name); send(r.ok ? 200 : 404, r); });
  if (url.pathname === "/api/state" && req.method === "PUT")
    return withBody(({ state, rev: base, save }) => {
      // If the same write is repeated (its first answer never reached the client), it is not applied again.
      if (save && save === lastSave.id) return send(200, { rev: lastSave.rev });
      // If the file changed in the meantime (Claude or pg wrote), do not overwrite it.
      if (base && base !== rev()) return send(409, read());
      const r = write(state);
      if (save) lastSave = { id: save, rev: r };
      send(200, { rev: r });
    });
  if (url.pathname === "/api/prepare/cancel" && req.method === "POST")
    return withBody(({ taskId }) => send(200, cancel(String(taskId))));
  if (url.pathname === "/api/busy") return send(200, { prepare: activeJobs(), publish: publishing(), share: sharing() });
  if (url.pathname === "/api/prepare" && req.method === "POST")
    return withBody(({ taskId, feedback, files, worldId, projectId, accountId, rouId }) => {
      // Who asked for the prepare: to tell apart cases where the same task is prepared again by itself.
      console.log(`prepare ${taskId} ← ${req.headers["user-agent"]?.slice(0, 40) ?? "?"} ${req.headers.referer ?? ""} ${feedback ? "revision" : ""}`);
      // Revision attachments: only files uploaded to Rou that really exist (data/media/rou-*).
      const ok = (Array.isArray(files) ? files : []).filter((f) => /^rou-[a-z0-9]+\.[a-z0-9]+$/.test(String(f?.file ?? "")) && fs.existsSync(path.join(MEDIA_DIR, String(f.file)))).slice(0, 8).map((f) => ({ file: String(f.file), kind: f.kind === "video" ? "video" : "image", name: String(f.name ?? "").slice(0, 120) }));
      const move = worldId || projectId || accountId ? { worldId: worldId || undefined, projectId: projectId || undefined, accountId: accountId || undefined } : undefined;
      const { done, ...r } = prepare(taskId, feedback, ok, move, { rouId: typeof rouId === "string" && /^[a-z0-9-]{1,40}$/i.test(rouId) ? rouId : undefined });
      send(r.ok ? 200 : 409, r);
    });
  if (url.pathname === "/api/run-text" && req.method === "POST")
    return withBody(({ runId, text }) => { const r = setRunText(String(runId), text); send(r.ok ? 200 : 409, r); });
  if (url.pathname === "/api/prepare-many" && req.method === "POST")
    return withBody(({ ids }) => send(200, prepareMany((Array.isArray(ids) ? ids : []).map(String).slice(0, 40))));
  if (url.pathname === "/api/run-voice" && req.method === "POST")
    return withBody(({ runId, file }) => { const r = runVoice(String(runId), String(file)); send(r.ok ? 200 : 409, r); });
  // Makes an image for a LinkedIn output that lacks one (the text stays the same).
  if (url.pathname === "/api/run-image" && req.method === "POST")
    return withBody(({ runId }) => { const r = makeImage(String(runId ?? "")); send(r.ok ? 200 : 409, { ok: r.ok, error: r.error }); });
  if (url.pathname === "/api/run-media" && req.method === "POST")
    return withBody(({ runId, from }) => { const r = copyMedia(String(runId), String(from)); send(r.ok ? 200 : 409, r); });
  if (url.pathname === "/api/rerender" && req.method === "POST")
    return withBody(({ runId, post, template }) => { const r = rerender(String(runId), post ? { post, template } : undefined); send(r.ok ? 200 : 409, r); });
  // Browser: connected Chromes, the account check, sharing. Sharing starts from this request only with the user's approval.
  if (url.pathname === "/api/browsers" && req.method === "GET")
    return void browsers().then((r) => send(r.ok ? 200 : 502, r));
  // Content ideas: Rou scans the news for an automation and produces post ideas (server/ideas.mjs).
  if (url.pathname === "/api/post-ideas" && req.method === "POST")
    return withBody(async ({ autoId }) => {
      const { postIdeas } = await import("./ideas.mjs");
      const r = postIdeas(String(autoId ?? ""));
      send(r.ok ? 200 : 400, { ok: r.ok, error: r.error });
    });
  // Account analysis (Instagram): Rou reads the profile in the background and writes a profile, an audit or a plan (server/insight.mjs).
  if (url.pathname === "/api/account-insight" && req.method === "POST")
    return withBody(async ({ accountId, kind }) => {
      const { accountInsight } = await import("./insight.mjs");
      const r = accountInsight(String(accountId ?? ""), String(kind ?? ""));
      send(r.ok ? 200 : 400, { ok: r.ok, error: r.error });
    });
  if (url.pathname === "/api/account-check" && req.method === "POST")
    return withBody(async ({ accountId, browser }) => {
      // If no Chrome is chosen, the check runs in the Playgrounds browser (if installed), in the world's session.
      if (!browser?.id) {
        const { checkAccountPb } = await import("./publish.mjs");
        const r = await checkAccountPb(String(accountId));
        return send(r.ok ? 200 : 409, r);
      }
      const r = await checkAccount(String(accountId), { id: String(browser.id), name: String(browser.name || "Chrome") });
      send(r.ok ? 200 : 409, r);
    });
  // Shares an approved post now (the sharer Rou). The earlier error is cleared.
  if (url.pathname === "/api/share" && req.method === "POST")
    // approve: a post waiting for approval comes with "Approve and share now"; it is approved first. Its place on the calendar does not change.
    return withBody(async ({ runId, approve }) => {
      const { shareNow, approveRun } = await import("./share.mjs");
      const { sharerOf } = await import("../shared/stages.mjs");
      if (approve) {
        let err = null;
        update((s) => { const x = s.runs.find((y) => y.id === String(runId)); if (x?.status === "ready") { try { approveRun(s, x.id); } catch (e) { err = e.message; } } });
        if (err) return send(409, { ok: false, error: err });
      }
      const st = read().state;
      const run = st.runs.find((x) => x.id === String(runId));
      if (!run || run.status !== "approved") return send(409, { ok: false, error: "Approve it first" });
      const task = st.tasks.find((t) => t.id === run.taskId);
      const a = task?.autoId ? st.automations.find((x) => x.id === task.autoId) : undefined;
      const by = sharerOf(a, task);
      if (by === "me") return send(409, { ok: false, error: "You share this post" });
      // The record of a share in progress is not deleted (the "Retry" of an old notification or an old card on the phone).
      if (publishing().includes(run.id) || sharing().includes(run.id)) return send(409, { ok: false, error: "Already being shared" });
      update((s) => { const x = s.runs.find((y) => y.id === run.id); if (x) { delete x.publish; delete x.shareSentAt; } });
      const r = await shareNow(run.id, by);
      const { done, ...rest } = r;
      send(r.ok ? 200 : 409, rest);
    });
  if (url.pathname === "/api/publish" && req.method === "POST")
    return withBody(({ runId }) => { const { done, ...r } = publish(String(runId)); send(r.ok ? 200 : 409, r); });
  // Chrome automation: do the approved items; open the automation's working folder (the path is derived from the automation, not from data).
  if (url.pathname === "/api/act" && req.method === "POST")
    return withBody(({ runId, pick, note, answers }) => { const { done, ...r } = act(String(runId), { pick, note, answers }); send(r.ok ? 200 : 409, r); });
  // Rou does it: Rou applies a single task's approved plan in Chrome (browse.mjs doTask). answer: the answer to Rou's question.
  if (url.pathname === "/api/do-task" && req.method === "POST")
    return withBody(async ({ taskId, browser }) => send(200, await startDirect(String(taskId), { browser })));
  if (url.pathname === "/api/do" && req.method === "POST")
    return withBody(async ({ runId, browser, answer, note }) => {
      const run = read().state.runs.find((x) => x.id === String(runId));
      const P = await import("./pb.mjs");
      if (run && !browser?.id && !P.installed()) { const c = await chooseBrowser(run.taskId, run.id); if (!c.ok) return send(409, c); browser = c.browser; }
      const { done, ...r } = doTask(String(runId), { browser, answer, note });
      send(r.ok ? 200 : 409, r);
    });
  // Brings the tab Rou works in to the front: in the Playgrounds browser, the task's world (Rou's tab active); Chrome as the fallback.
  if (url.pathname === "/api/focus-chrome" && req.method === "POST")
    return withBody(async ({ runId } = {}) => {
      const P = await import("./pb.mjs");
      if (P.installed()) {
        const s = read().state;
        const run = s.runs.find((x) => x.id === String(runId ?? ""));
        const task = run && s.tasks.find((t) => t.id === run.taskId);
        const w = task && s.worlds.find((x) => x.id === task.worldId);
        if (w) return send(200, await P.openProfile(w));
      }
      // Bringing Chrome to the front works only on macOS; on other systems the job still goes on.
      if (isMac()) spawn("osascript", ["-e", 'tell application "Google Chrome" to activate'], { stdio: "ignore", detached: true }).unref();
      send(200, { ok: true });
    });
  // Opens the share package folder in the file manager (server/share.mjs handoff).
  if (url.pathname === "/api/open-share" && req.method === "POST")
    return withBody(({ runId }) => {
      const dir = read().state.runs.find((x) => x.id === String(runId))?.publish?.dir;
      if (!dir || !fs.existsSync(dir)) return send(404, { ok: false, error: "No such folder" });
      openPath(dir);
      send(200, { ok: true });
    });
  if (url.pathname === "/api/open-folder" && req.method === "POST")
    return withBody(({ autoId }) => {
      const a = read().state.automations.find((x) => x.id === String(autoId));
      if (!a) return send(404, { ok: false, error: "No such automation" });
      const dir = folderOf(a);
      fs.mkdirSync(dir, { recursive: true });
      openPath(dir);
      send(200, { ok: true });
    });
  if (url.pathname === "/api/plan-topics" && req.method === "POST")
    return withBody(async (body) => {
      if (busy.topics) return send(429, { ok: false, error: "Rou is already planning topics" });
      busy.topics = true;
      const stop = new AbortController();
      res.on("close", () => !res.writableFinished && stop.abort());
      const r = await planTopics(body ?? {}, stop.signal).finally(() => (busy.topics = false));
      if (stop.signal.aborted) return;
      send(r.ok ? 200 : 502, r);
    });
  if (url.pathname === "/api/plan-week-topics" && req.method === "POST")
    return withBody(async (body) => {
      if (busy.topics) return send(429, { ok: false, error: "Rou is already planning topics" });
      busy.topics = true;
      const { week, autoIds, days, note } = body ?? {}; // days: the length of the range (Planned posts asks for 28 days), otherwise one week
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(week))) { busy.topics = false; return send(400, { ok: false, error: "No week given" }); }
      const r = await fillTopics({ from: week, until: addDays(week, Math.min(35, Math.max(1, Number(days) || 7))), autoIds: Array.isArray(autoIds) ? autoIds : undefined, ...(typeof note === "string" && note.trim() ? { note: note.trim().slice(0, 1500) } : {}) }).finally(() => (busy.topics = false));
      send(r.ok ? 200 : 502, r);
    });
  if (url.pathname === "/api/auto-draft" && req.method === "POST")
    return withBody(async ({ text, worldId }) => {
      text = String(text || "").trim();
      if (!text) return send(400, { ok: false, error: "Empty" });
      // One draft at a time: repeated clicks must not start several claude processes.
      if (busy.draft) return send(429, { ok: false, error: "Claude is already filling a draft" });
      busy.draft = true;
      // When the form closes the request is cut and the claude process stops too.
      const stop = new AbortController();
      res.on("close", () => !res.writableFinished && stop.abort());
      const r = await draft(text, typeof worldId === "string" ? worldId : null, stop.signal).finally(() => (busy.draft = false));
      if (stop.signal.aborted) return;
      send(r.ok ? 200 : 502, r);
    });
  // Change the app with Rou: comes from the client only when the user presses Approve (server/change.mjs).
  // Only when the developer turns it on (PG_CHANGE=1): Rou writes and runs code in the repo.
  if (url.pathname.startsWith("/api/change") && req.method === "POST" && !changeOn()) { req.resume(); return send(403, { ok: false, error: "Rou's code changes are turned off (a developer turns them on with PG_CHANGE=1)" }); }
  if (url.pathname === "/api/change" && req.method === "POST")
    return withBody(({ text, rouId, files }) => { const r = startChange(text, rouId, files); send(r.ok ? 200 : 409, r); });
  if (url.pathname === "/api/change/undo" && req.method === "POST")
    return withBody(({ changeId, rouId }) => { const r = undoChange(String(changeId), rouId); send(r.ok ? 200 : 409, r); });
  // Attachment for Rou: the body is the raw file. Voice command: the recording is uploaded, then transcribed.
  if (url.pathname === "/api/upload" && req.method === "POST")
    return void upload(req, url.searchParams.get("name"), url.searchParams.get("type") || "").then((r) => send(r.ok ? 200 : 400, r));
  if (url.pathname === "/api/transcribe" && req.method === "POST")
    return withBody(async ({ file }) => { const r = await transcribe(String(file)); send(r.ok ? 200 : 400, r); });
  if (url.pathname === "/api/rou" && req.method === "POST")
    return withBody(async ({ messages, lens, rouId }) => {
      const files = (m) => (Array.isArray(m.files) ? m.files.filter((f) => mediaPath(f?.file)).slice(0, 8).map((f) => ({ file: f.file, name: String(f.name || "").slice(0, 120), kind: String(f.kind || "") })) : []);
      const list = (Array.isArray(messages) ? messages : []).filter((m) => m && typeof m.text === "string" && (m.text.trim() || files(m).length)).map((m) => ({ role: m.role === "rou" ? "rou" : "user", text: m.text.slice(0, 4000), ...(files(m).length ? { files: files(m) } : {}) }));
      if (!list.length || list.at(-1).role !== "user") return send(400, { ok: false, error: "Empty" });
      if (busy.rou) return send(429, { ok: false, error: "Rou is still thinking about the previous question" });
      busy.rou = true;
      const r = await ask(list, typeof lens === "string" ? lens : "all", typeof rouId === "string" ? rouId : undefined).finally(() => (busy.rou = false));
      send(r.ok ? 200 : 502, r);
    });
  // A notification from another process (the pg CLI): passed to the open app (server/notify.mjs).
  if (url.pathname === "/api/notify" && req.method === "POST")
    return withBody(({ title, text }) => send(200, { ok: true, delivered: notice(String(title ?? ""), String(text ?? "")) }));
  // Playgrounds browser: monitoring (profiles, sessions, tabs), tab picture, bringing a profile/tab to the front, letting Rou sign in.
  if (url.pathname === "/api/pb" && req.method === "GET")
    return void import("./pb.mjs").then(async (P) => send(200, await P.pbState(read().state)));
  if (url.pathname === "/api/pb/shot" && req.method === "GET")
    return void import("./pb.mjs").then(async (P) => {
      const img = await P.shot(url.searchParams.get("t"), Math.min(1280, Number(url.searchParams.get("w")) || 640)).catch(() => null);
      if (res.headersSent) return;
      if (!img) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" });
      res.end(img);
    });
  if (url.pathname === "/api/pb/open" && req.method === "POST")
    return withBody(async ({ worldId, accountId, login, runId }) => {
      const P = await import("./pb.mjs");
      const { SITES } = await import("../shared/pb.mjs");
      const s = read().state;
      // The link of a shared post opens in the browser of the world of the account that shared it (the session is open there).
      if (runId) {
        const run = s.runs.find((x) => x.id === String(runId));
        if (!run?.postUrl) return send(404, { ok: false, error: "The post has no link" });
        const { accountOf, taskRef } = await import("../shared/social.mjs");
        const task = s.tasks.find((t) => t.id === run.taskId);
        const acc = task ? accountOf(s, taskRef(s, task)) : null;
        const pw = s.worlds.find((x) => (acc && x.accounts?.some((a) => a.id === acc.id))) ?? s.worlds.find((x) => x.id === task?.worldId);
        if (!pw) return send(404, { ok: false, error: "No such world" });
        const r = await P.openProfile(pw, run.postUrl);
        return send(r.ok ? 200 : 409, r);
      }
      const w = s.worlds.find((x) => x.id === String(worldId) || x.accounts?.some((a) => a.id === String(accountId)));
      if (!w) return send(404, { ok: false, error: "No such world" });
      const acc = accountId ? w.accounts?.find((a) => a.id === String(accountId)) : null;
      const site = acc ? SITES[acc.platform] : null;
      const r = await P.openProfile(w, site ? (login ? site.login : site.home) : undefined);
      send(r.ok ? 200 : 409, r);
    });
  if (url.pathname === "/api/pb/focus" && req.method === "POST")
    return withBody(async ({ targetId }) => {
      const P = await import("./pb.mjs");
      try { send(200, await P.focusPage(String(targetId))); } catch (e) { send(409, { ok: false, error: e.message }); }
    });
  if (url.pathname === "/api/pb/login" && req.method === "POST")
    return withBody(async ({ accountId }) => {
      const { pbLogin } = await import("./publish.mjs");
      const { done, ...r } = pbLogin(String(accountId));
      send(r.ok ? 200 : 409, r);
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
