#!/usr/bin/env node
// pg: the command line for Playgrounds. You and your AI tools use it to read and write data/playground.json;
// the app picks up every change at once. Run `pg help` (or `npm run pg -- help`) for the commands.
import { read, update, id } from "../server/store.mjs";
import { toTrash } from "../shared/trash.mjs";
import { newWorld, SWATCHES } from "../shared/world.mjs";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HELP = `pg: Playgrounds from the command line

Reading
  pg list [--week | --all] [--world W]   today's and late tasks (--week: next 7 days, --all: every open task)
  pg show <taskId>                       one task with its checklist, blocks and focus time
  pg worlds                              worlds with open task and project counts
  pg projects [--world W]                projects with ids
  pg notes [--world W]                   Notebook items waiting for a decision
  pg context <projectId>                 a project, its open tasks and its sources (hand this to an AI tool)
  pg now                                 the running timer
  pg json                                the whole data file
  pg open [-w]                           open the Mac app (-w / --web: the app in the browser)

Writing
  pg add "Title" --world W [--project P] [--day D] [--at 14:00] [--min 60] [--est 60]
         [--deadline D] [--check "a;b"] [--notes ".."] [--by "Tool name"]
  pg in "Title" [--world W] [--project P] [--body ".."] [--url ..] [--suggest "Task title"]
         [--source agent|mail|slack|note] [--from X] [--by "Tool name"]
  pg edit <taskId> [--title ..] [--notes ..] [--append ..] [--deadline D] [--est N] [--project P] [--check "a;b"]
  pg world "Name" [--desc ..] [--color "#hex"]
  pg project "Name" --world W [--deadline D] [--desc ..]
  pg src <projectId> "Title" --body ".." [--url ..]      add a source (note or link) to a project
  pg block <taskId> <day> <HH:MM> <minutes>             reserve time on the calendar
  pg move <taskId> <day>  ·  pg done <taskId>  ·  pg status <taskId> todo|doing|waiting|done
  pg rm <taskId | noteId | empty projectId>             to the Trash for 30 days
  pg start <taskId> [--pomo] [--min 25]  ·  pg stop [--done]

Days: today, tomorrow, someday (no day), mon..sun or monday..sunday (the next one), YYYY-MM-DD.
Ids may be shortened to their first characters. AI tools: always pass --by "<your name>".`;

const [cmd, ...rest] = process.argv.slice(2);
const args = { _: [] };
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) args[rest[i].slice(2)] = rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? true : rest[++i];
  else args._.push(rest[i]);
}
const opt = (k) => (args[k] === undefined || args[k] === true ? undefined : String(args[k]));
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const now = () => new Date().toISOString();

// Full name or a set abbreviation, never a bare prefix ("t" would be both tue and thu).
const DAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
function parseDay(v, fallback) {
  if (v === undefined || v === true) return fallback;
  const s = String(v).trim().toLowerCase();
  if (["someday", "none", "-"].includes(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date();
  if (["today", "tod"].includes(s)) return iso(d);
  if (["tomorrow", "tmr"].includes(s)) return d.setDate(d.getDate() + 1), iso(d);
  const k = DAYS[s];
  if (k !== undefined) return d.setDate(d.getDate() + (((k - d.getDay() + 7) % 7) || 7)), iso(d);
  throw new Error(`Unknown day: ${v}`);
}
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, "");
function world(s, v, optional) {
  if (!v) {
    if (optional) return null;
    if (s.worlds.length === 1) return s.worlds[0];
    throw new Error(s.worlds.length ? `--world is required: ${s.worlds.map((w) => w.id).join(", ")}` : 'No worlds yet. Create one: pg world "Name"');
  }
  const w = s.worlds.find((w) => w.id === v || norm(w.name) === norm(v));
  if (!w) throw new Error(`No world: ${v}. Worlds: ${s.worlds.map((w) => w.id).join(", ") || "none"}`);
  return w;
}
// A project id or name. A name that does not exist yet opens a new project in that world.
function project(s, w, ref) {
  if (!ref) return null;
  let p = s.projects.find((p) => p.worldId === w.id && (p.id === ref || norm(p.name) === norm(ref)));
  if (!p) s.projects.push((p = { id: id(), worldId: w.id, name: ref, description: "", status: "active", deadline: null }));
  return p.id;
}
// An empty id (a blank shell variable) would match the start of every id and pick the first record.
function pick(list, ref, what) {
  if (typeof ref !== "string" || !ref.trim()) throw new Error(`A ${what} id is required`);
  const hits = list.filter((x) => x.id.startsWith(ref));
  if (!hits.length) throw new Error(`No ${what}: ${ref}`);
  if (hits.length > 1 && !hits.some((x) => x.id === ref)) throw new Error(`More than one ${what} starts with "${ref}"`);
  return hits.find((x) => x.id === ref) ?? hits[0];
}
const task = (s, ref) => pick(s.tasks, ref, "task");
const projectById = (s, ref) => pick(s.projects, ref, "project");
const checks = (v) => (v ? v.split(";").map((x) => x.trim()).filter(Boolean).map((text) => ({ id: id(), text, done: false })) : []);
const time = (v) => { if (!/^\d{1,2}:\d{2}$/.test(v ?? "")) throw new Error(`Time must look like 14:00, got: ${v}`); return v.padStart(5, "0"); };
const addMin = (day, hm, m) => { const [h, mi] = hm.split(":").map(Number); const t = Math.min(24 * 60 - 1, h * 60 + mi + m); return `${day}T${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };
const num = (v, what) => { if (v === undefined) return undefined; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`${what} must be a number of minutes`); return Math.round(n); };
function setStatus(t, st) {
  if (!["todo", "doing", "waiting", "done"].includes(st)) throw new Error(`Status must be todo, doing, waiting or done`);
  t.status = st;
  if (st === "done") t.doneAt = now(); else delete t.doneAt;
}
// Writes the running focus time as a session (the same rule as src/timer.ts).
function commit(s) {
  const t = s.timer;
  if (!t || t.phase !== "focus" || t.pausedAt) return;
  const own = Math.floor((Date.now() - Date.parse(t.startedAt)) / 1000);
  const seg = t.mode === "pomo" ? Math.min(own, Math.max(0, t.length * 60 - (t.base ?? 0))) : own;
  const sec = seg + (t.carry ?? 0);
  if (sec < 60) return;
  const end = Date.parse(t.startedAt) + seg * 1000;
  s.sessions.push({ id: id(), taskId: t.taskId, start: new Date(end - sec * 1000).toISOString(), end: new Date(end).toISOString(), mode: t.mode });
}

const names = (s) => ({
  world: (wid) => s.worlds.find((w) => w.id === wid)?.name ?? wid,
  project: (pid) => (pid ? s.projects.find((p) => p.id === pid)?.name ?? "" : ""),
});
function row(s, t) {
  const n = names(s);
  const at = s.blocks.filter((b) => b.taskId === t.id && b.start.startsWith(t.day ?? "-")).map((b) => b.start.slice(11)).sort()[0];
  const where = [n.world(t.worldId), n.project(t.projectId)].filter(Boolean).join(" › ");
  const late = t.day && t.day < today() && t.status !== "done" ? " LATE" : "";
  const dl = t.deadline ? ` · deadline ${t.deadline}` : "";
  const est = t.estimate ? ` · ${t.estimate} min` : "";
  const mark = { done: "✓", doing: "▶", waiting: "…" }[t.status] ?? "·";
  return `${t.id}  ${mark} ${at ? at + " " : ""}${t.title}  [${where}]${est}${dl}${late}`;
}

// pg open: the menu bar app (desktop/build.sh), or the app in the browser.
const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = Number(process.env.PORT || 5340);
const URL_ = `http://localhost:${PORT}/`;
const opener = (target) => spawnSync(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [target], { stdio: "ignore" });

function openApp() {
  if (process.platform !== "darwin") throw new Error("The desktop app is for macOS. Use pg open -w");
  if (spawnSync("open", ["-b", "dev.openplaygrounds.app"], { stdio: "ignore" }).status === 0) return "Playgrounds is open.";
  const found = [path.join(os.homedir(), "Applications/Playgrounds.app"), "/Applications/Playgrounds.app", path.join(ROOT, "desktop/build/Playgrounds.app")].find((p) => fs.existsSync(p));
  if (!found) throw new Error("The app is not built yet. Run npm run desktop (or use pg open -w)");
  opener(found);
  return "Playgrounds is open.";
}

const up = async () => { try { await fetch(`${URL_}api/state`, { method: "HEAD", signal: AbortSignal.timeout(800) }); return true; } catch { return false; } };

// Uses the server that already runs (the app, npm run dev or npm start); otherwise starts server/app.mjs in the background.
async function openWeb() {
  if (!(await up())) {
    if (!fs.existsSync(path.join(ROOT, "dist/index.html"))) throw new Error("No build found. Run npm run build first, or npm run dev");
    const log = fs.openSync(path.join(os.tmpdir(), "playgrounds-server.log"), "a");
    spawn(process.execPath, [path.join(ROOT, "server/app.mjs")], { cwd: ROOT, detached: true, stdio: ["ignore", log, log], env: { ...process.env, PORT: String(PORT) } }).unref();
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { await new Promise((r) => setTimeout(r, 150)); ok = await up(); }
    if (!ok) throw new Error(`The server did not start. See ${path.join(os.tmpdir(), "playgrounds-server.log")}`);
  }
  opener(URL_);
  return `Opened ${URL_}`;
}

let out = "";
try {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    out = HELP;
  } else if (cmd === "add") {
    const title = args._[0];
    if (!title) throw new Error('A title is required: pg add "Title" --world W');
    let shown;
    update((s) => {
      const w = world(s, opt("world") ?? opt("pg"));
      const at = opt("at") && time(opt("at"));
      const day = parseDay(args.day, at ? today() : null);
      const t = {
        id: id(), worldId: w.id, projectId: project(s, w, opt("project")), title: String(title), notes: opt("notes") ?? "",
        status: "todo", day, deadline: parseDay(args.deadline, null), estimate: num(opt("est") ?? opt("min"), "--est") ?? null,
        checklist: checks(opt("check")), by: opt("by") ?? "me", createdAt: now(),
      };
      s.tasks.push(t);
      if (at) {
        if (!day) throw new Error("--at needs a day");
        s.blocks.push({ id: id(), taskId: t.id, worldId: w.id, title: "", start: `${day}T${at}`, end: addMin(day, at, num(opt("min"), "--min") ?? 60), kind: "plan" });
      }
      shown = row(s, t);
    });
    out = `+ ${shown}`;
  } else if (cmd === "in") {
    const title = args._[0];
    if (!title) throw new Error('A title is required: pg in "Title"');
    let nid;
    update((s) => {
      const w = world(s, opt("world") ?? opt("pg"), true);
      const pid = w && opt("project") ? project(s, w, opt("project")) : null;
      const by = opt("by");
      const item = {
        id: (nid = id()), worldId: w?.id ?? null, projectId: pid, source: opt("source") ?? (by ? "agent" : "note"), from: opt("from") ?? by ?? "",
        url: opt("url") ?? "", title: String(title), body: opt("body") ?? "", receivedAt: now(), state: "new",
      };
      if (opt("suggest")) item.suggestion = { title: opt("suggest"), projectId: pid, day: parseDay(args.day, null), deadline: parseDay(args.deadline, null) };
      s.inbox.unshift(item);
    });
    out = `+ Notebook ${nid}: ${title}`;
  } else if (cmd === "edit") {
    let shown;
    update((s) => {
      const t = task(s, args._[0]);
      if (opt("title")) t.title = opt("title");
      if (args.notes !== undefined) t.notes = opt("notes") ?? "";
      if (opt("append")) t.notes = [t.notes, opt("append")].filter(Boolean).join("\n\n");
      if (args.deadline !== undefined) t.deadline = parseDay(args.deadline, null);
      if (opt("est") !== undefined) t.estimate = num(opt("est"), "--est");
      if (opt("project")) {
        const w = s.worlds.find((x) => x.id === t.worldId);
        t.projectId = opt("project") === "none" ? null : project(s, w, opt("project"));
      }
      if (opt("check")) t.checklist.push(...checks(opt("check")));
      shown = row(s, t);
    });
    out = `~ ${shown}`;
  } else if (cmd === "world") {
    const name = args._[0];
    if (!name) throw new Error('A name is required: pg world "Name"');
    let w;
    update((s) => {
      if (s.worlds.some((x) => norm(x.name) === norm(name))) throw new Error(`World exists: ${name}`);
      const color = opt("color");
      if (color && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Color must look like #3d5afe (or one of ${SWATCHES.join(" ")})`);
      s.worlds.push((w = newWorld(s, name, opt("desc") ?? "", color)));
    });
    out = `+ world ${w.id}: ${w.name}`;
  } else if (cmd === "project") {
    const name = args._[0];
    if (!name) throw new Error('A name is required: pg project "Name" --world W');
    let p;
    update((s) => {
      const w = world(s, opt("world") ?? opt("pg"));
      if (s.projects.some((x) => x.worldId === w.id && norm(x.name) === norm(name))) throw new Error(`Project exists in ${w.name}: ${name}`);
      s.projects.push((p = { id: id(), worldId: w.id, name, description: opt("desc") ?? "", status: "active", deadline: parseDay(args.deadline, null) }));
    });
    out = `+ project ${p.id}: ${p.name}`;
  } else if (cmd === "src") {
    const [ref, title] = args._;
    if (!title) throw new Error('Usage: pg src <projectId> "Title" --body ".." [--url ..]');
    const url = opt("url");
    if (url && !/^https?:\/\//.test(url)) throw new Error("--url must start with http:// or https://");
    update((s) => {
      const p = projectById(s, ref);
      (p.sources ??= []).push({ id: id(), kind: url ? "link" : "note", title, body: opt("body") ?? "", ...(url ? { url } : {}), use: true, addedAt: now() });
    });
    out = `+ source: ${title}`;
  } else if (cmd === "block") {
    const [ref, d, hm, min] = args._;
    let shown;
    update((s) => {
      const t = task(s, ref);
      const day = parseDay(d);
      if (!day) throw new Error("Usage: pg block <taskId> <day> <HH:MM> <minutes>");
      const at = time(hm);
      s.blocks.push({ id: id(), taskId: t.id, worldId: t.worldId, title: "", start: `${day}T${at}`, end: addMin(day, at, num(min, "minutes") ?? 60), kind: "plan" });
      if (!t.day) t.day = day;
      shown = `${t.title} · ${day} ${at}`;
    });
    out = `+ block: ${shown}`;
  } else if (cmd === "move") {
    let shown;
    update((s) => { const t = task(s, args._[0]); t.day = parseDay(args._[1] ?? "someday", null); shown = row(s, t); });
    out = `→ ${shown}`;
  } else if (cmd === "done" || cmd === "status") {
    let shown;
    update((s) => {
      const t = task(s, args._[0]);
      if (cmd === "done" || args._[1] === "done") if (s.timer?.taskId === t.id) { commit(s); s.timer = null; }
      setStatus(t, cmd === "done" ? "done" : String(args._[1]));
      shown = row(s, t);
    });
    out = shown;
  } else if (cmd === "rm") {
    const ref = String(args._[0] ?? "");
    let what;
    update((s) => {
      if (!ref.trim()) throw new Error("An id is required");
      const n = s.inbox.find((x) => x.id === ref);
      if (n) { toTrash(s, id(), "note", n.title, { inbox: [n] }); s.inbox = s.inbox.filter((x) => x.id !== n.id); what = `note: ${n.title}`; return; }
      // An empty project (no tasks, no notes) can be removed here; a project with work in it is removed in the app.
      const p = s.projects.find((x) => x.id === ref);
      if (p) {
        if (s.tasks.some((t) => t.projectId === p.id) || s.inbox.some((x) => x.projectId === p.id)) throw new Error(`Project is not empty: ${p.name}`);
        toTrash(s, id(), "project", p.name, { projects: [p] }); s.projects = s.projects.filter((x) => x.id !== p.id); what = `project: ${p.name}`; return;
      }
      const t = task(s, ref);
      if (s.timer?.taskId === t.id) s.timer = null;
      for (const x of s.inbox) if (x.taskId === t.id) delete x.taskId;
      toTrash(s, id(), "task", t.title, { tasks: [t], blocks: s.blocks.filter((b) => b.taskId === t.id), sessions: s.sessions.filter((x) => x.taskId === t.id) });
      s.tasks = s.tasks.filter((x) => x.id !== t.id);
      s.blocks = s.blocks.filter((b) => b.taskId !== t.id);
      s.sessions = s.sessions.filter((x) => x.taskId !== t.id);
      what = `task: ${t.title}`;
    });
    out = `− ${what} (in the Trash for 30 days)`;
  } else if (cmd === "start") {
    let shown;
    update((s) => {
      const t = task(s, args._[0]);
      commit(s);
      const prev = s.timer && s.tasks.find((x) => x.id === s.timer.taskId);
      if (prev && prev.id !== t.id && prev.status === "doing") prev.status = "todo";
      if (t.status !== "doing") setStatus(t, "doing");
      const pomo = !!args.pomo;
      s.timer = { taskId: t.id, startedAt: now(), mode: pomo ? "pomo" : "free", phase: "focus", length: pomo ? num(opt("min"), "--min") ?? 25 : 0, round: 1 };
      shown = `${pomo ? "Pomodoro" : "Timer"} started: ${t.title}`;
    });
    out = `▶ ${shown}`;
  } else if (cmd === "stop") {
    let shown = "No timer is running";
    update((s) => {
      if (!s.timer) return;
      const t = s.tasks.find((x) => x.id === s.timer.taskId);
      commit(s);
      s.timer = null;
      if (t && args.done) setStatus(t, "done");
      shown = `■ Stopped${t ? `: ${t.title}` : ""}${args.done ? " (done)" : ""}`;
    });
    out = shown;
  } else if (cmd === "now") {
    const { state: s } = read();
    const t = s.timer;
    if (!t) out = "No timer is running";
    else {
      const tk = s.tasks.find((x) => x.id === t.taskId);
      const sec = (t.base ?? 0) + (t.pausedAt ? 0 : Math.floor((Date.now() - Date.parse(t.startedAt)) / 1000));
      out = `${t.pausedAt ? "Paused" : "Running"}: ${tk?.title ?? t.taskId} · ${Math.floor(sec / 60)} min${t.mode === "pomo" ? ` of ${t.length}` : ""}`;
    }
  } else if (cmd === "show") {
    const { state: s } = read();
    const t = task(s, args._[0]);
    const lines = [row(s, t), `day: ${t.day ?? "someday"} · status: ${t.status} · added by: ${t.by}`];
    if (t.notes) lines.push("", t.notes);
    if (t.checklist.length) lines.push("", ...t.checklist.map((c) => `${c.done ? "[x]" : "[ ]"} ${c.text}`));
    const blocks = s.blocks.filter((b) => b.taskId === t.id);
    if (blocks.length) lines.push("", ...blocks.map((b) => `block ${b.start.replace("T", " ")}–${b.end.slice(11)}`));
    const min = Math.round(s.sessions.filter((x) => x.taskId === t.id).reduce((a, x) => a + (Date.parse(x.end) - Date.parse(x.start)), 0) / 6e4);
    if (min) lines.push(`focused: ${min} min`);
    out = lines.join("\n");
  } else if (cmd === "worlds") {
    const { state: s } = read();
    out = s.worlds.map((w) => `${w.id.padEnd(14)} ${w.name.padEnd(16)} ${s.tasks.filter((t) => t.worldId === w.id && t.status !== "done").length} open · ${s.projects.filter((p) => p.worldId === w.id).length} projects`).join("\n") || 'No worlds yet. Create one: pg world "Name"';
  } else if (cmd === "projects") {
    const { state: s } = read();
    const w = world(s, opt("world") ?? opt("pg"), true);
    const n = names(s);
    out = s.projects.filter((p) => !w || p.worldId === w.id).map((p) => `${p.id}  ${p.name}  [${n.world(p.worldId)}] ${p.status}${p.deadline ? ` · deadline ${p.deadline}` : ""} · ${s.tasks.filter((t) => t.projectId === p.id && t.status !== "done").length} open`).join("\n") || "No projects";
  } else if (cmd === "notes") {
    const { state: s } = read();
    const w = world(s, opt("world") ?? opt("pg"), true);
    const n = names(s);
    out = s.inbox.filter((x) => x.state === "new" && (!w || x.worldId === w.id)).map((x) => {
      const where = [x.worldId && n.world(x.worldId), n.project(x.projectId)].filter(Boolean).join(" › ");
      return `${x.id}  ${x.title}${where ? `  [${where}]` : ""}${x.from ? ` · from ${x.from}` : ""}${x.body ? `\n    ${x.body.split("\n")[0].slice(0, 140)}` : ""}`;
    }).join("\n") || "The Notebook is empty";
  } else if (cmd === "context") {
    const { state: s } = read();
    const p = projectById(s, args._[0]);
    const lines = [`# ${p.name}`, `world: ${names(s).world(p.worldId)} · status: ${p.status}${p.deadline ? ` · deadline ${p.deadline}` : ""}`];
    if (p.description) lines.push("", p.description);
    const open = s.tasks.filter((t) => t.projectId === p.id && t.status !== "done");
    lines.push("", "## Open tasks", ...(open.length ? open.map((t) => row(s, t)) : ["none"]));
    const src = (p.sources ?? []).filter((x) => x.use);
    if (src.length) lines.push("", "## Sources", ...src.flatMap((x) => [`### ${x.title}${x.url ? ` (${x.url})` : ""}`, x.body.slice(0, 4000), ""]));
    out = lines.join("\n");
  } else if (cmd === "json") {
    out = JSON.stringify(read().state, null, 2);
  } else if (cmd === "list") {
    const { state: s } = read();
    const w = world(s, opt("world") ?? opt("pg"), true);
    const d0 = today();
    const end = new Date(); end.setDate(end.getDate() + 6);
    const d1 = args.week ? iso(end) : d0;
    const open = s.tasks.filter((t) => t.status !== "done" && (!w || t.worldId === w.id));
    const late = open.filter((t) => t.day && t.day < d0);
    const days = open.filter((t) => t.day && t.day >= d0 && t.day <= d1).sort((a, b) => a.day.localeCompare(b.day) || (a.order ?? 0) - (b.order ?? 0));
    const later = args.all ? open.filter((t) => !t.day || t.day > d1) : [];
    const doneToday = s.tasks.filter((t) => t.status === "done" && t.doneAt && iso(new Date(t.doneAt)) === d0 && (!w || t.worldId === w.id));
    const part = (title, list) => (list.length ? [title, ...list.map((t) => `  ${row(s, t)}`)] : []);
    const byDay = args.week ? [...new Set(days.map((t) => t.day))].flatMap((d) => part(d === d0 ? `Today (${d})` : d, days.filter((t) => t.day === d))) : part(`Today (${d0})`, days);
    out = [...part("Late", late), ...byDay, ...part("Later / someday", later), ...part("Done today", doneToday)].join("\n") || 'Nothing planned. Add a task: pg add "Title" --day today';
  } else if (cmd === "open") {
    out = (args.web || args.w || args._.includes("-w")) ? await openWeb() : openApp();
  } else {
    // An unknown command must fail: a tool that mistyped it would otherwise think the work was done.
    throw new Error(`Unknown command: ${cmd}. Run pg help`);
  }
  console.log(out);
} catch (e) {
  console.error(`pg: ${e.message}`);
  process.exit(1);
}
