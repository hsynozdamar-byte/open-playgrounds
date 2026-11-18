// Rou's "do it yourself" job: a request the user approved (e.g. "make this button blue", "let YouTube videos be embedded")
// runs with `claude -p` in the repo root with tool permissions (code, commands, data through `pg`).
// Works only when the developer turns it on (PG_CHANGE=1); when off, /api/change returns 403 and Rou does not propose it.
// Starts with a clean working tree. If code changed: tsc + tests + build (+ does the server code load); if one fails the code is rolled back.
// On success a local commit is made and "Undo" runs git revert. If server code changed the server restarts itself (serve.mjs supervises).
// Data changes are not in git; they are made with pg and deletions go to the Trash. Progress is in state.change, history in state.changes.
import { spawn } from "node:child_process";
import { resolveSpawn } from "../shared/platform.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runClaude } from "./claude.mjs";
import { MEDIA_DIR, id, read, update } from "./store.mjs";
import { DEFAULT_ROU, rouOf, setChat } from "../shared/rou.mjs";
import { mediaPath } from "./attach.mjs";
import { idle } from "./update.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
let busy = false;
export const changeOn = () => process.env.PG_CHANGE === "1";
let rouId = DEFAULT_ROU; // the Rou that asked: the result is written to its chat

function sh(cmd, args, ms = 240000) {
  return new Promise((resolve) => {
    // On Windows npx.cmd runs through cmd.exe (shared/platform.mjs).
    const sp = resolveSpawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    const p = spawn(sp.file, sp.args, sp.opts);
    let out = "";
    p.stdout.setEncoding("utf8").on("data", (c) => (out += c));
    p.stderr.setEncoding("utf8").on("data", (c) => (out += c));
    const t = setTimeout(() => p.kill("SIGTERM"), ms);
    p.on("error", (e) => (clearTimeout(t), resolve({ ok: false, out: e.message, raw: "" })));
    p.on("close", (code) => (clearTimeout(t), resolve({ ok: code === 0, out: out.trim(), raw: out })));
  });
}
const git = (...a) => sh("git", ["-c", `user.name=${process.env.PG_GIT_NAME || "Playgrounds Rou"}`, "-c", `user.email=${process.env.PG_GIT_EMAIL || "rou@playgrounds.local"}`, ...a]);
// -z: the status letters and spaces at the start of a line are kept; the path starts at the 4th character.
const dirty = async () => (await git("status", "--porcelain", "-z", "--untracked-files=all")).raw.split("\0").filter(Boolean).map((l) => l.slice(3));
// A failed change is not deleted, it is put away with git stash (`git stash list` → "rou-failed …"). The working tree is still cleaned.
// It used to run `checkout . && clean -fd`: unsaved files another session (or the user) wrote in the same folder
// while Rou worked were deleted for good as well.
const discard = () => git("stash", "push", "--include-untracked", "-m", `rou-failed ${new Date().toISOString().slice(0, 16)}`);
// The commit subject stays short and the whole request goes in the body (the subject used to be a 2 KB request).
const subject = (text) => { const one = String(text).replace(/\s+/g, " ").trim(); return one.length > 72 ? `${one.slice(0, 69).trimEnd()}…` : one; };
// Does the server really start: it is started with empty data, on a free port, without the scheduler, and must answer.
// Only importing the module missed errors in app.mjs or at startup; such a commit would leave the server unable to start.
async function boots() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-boot-"));
  const port = 5600 + Math.floor(Math.random() * 300);
  const p = spawn(process.execPath, ["server/app.mjs"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PG_DATA: dir, PORT: String(port), PG_NO_SCHEDULE: "1", PG_DRY: "1", PG_SUPERVISED: "" } });
  let out = "", exited = false;
  p.stdout.on("data", (c) => (out += c)); p.stderr.on("data", (c) => (out += c));
  p.on("error", (e) => { out += e.message; exited = true; }); p.on("exit", () => (exited = true));
  try {
    for (let i = 0; i < 24 && !exited; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await fetch(`http://127.0.0.1:${port}/api/backups`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false)) return { ok: true };
    }
    return { ok: false, out: out.trim() || "the server did not answer" };
  } finally { p.kill("SIGTERM"); fs.rmSync(dir, { recursive: true, force: true }); }
}
// Files that need a server restart (the interface updates with a build).
const serverSide = (files) => files.some((f) => /^(server|shared|scripts)\/|^package(-lock)?\.json$/.test(f));
const check = async (files) => {
  const t = await sh("npx", ["tsc", "--noEmit", "-p", "."]);
  if (!t.ok) return { ok: false, error: `Type check failed: ${t.out.split("\n").slice(0, 3).join(" ")}` };
  const v = await sh("npx", ["vitest", "run"]);
  if (!v.ok) return { ok: false, error: `Tests failed: ${v.out.split("\n").filter((l) => /FAIL|Error|✗|×/.test(l)).slice(0, 3).join(" ")}` };
  if (serverSide(files)) {
    const s = await sh(process.execPath, ["-e", "import('./server/store.mjs').then(() => process.exit(0))"], 30000);
    if (!s.ok) return { ok: false, error: `Server code did not load: ${s.out.split("\n").slice(0, 3).join(" ")}` };
    const up = await boots();
    if (!up.ok) return { ok: false, error: `The server did not start: ${up.out.split("\n").slice(-3).join(" ").slice(0, 300)}` };
  }
  if (files.some((f) => /^browser\/.*\.mjs$/.test(f))) {
    const b = await sh(process.execPath, ["--check", "browser/main.mjs"], 30000);
    if (!b.ok) return { ok: false, error: `The app shell code is broken: ${b.out.split("\n").slice(0, 3).join(" ")}` };
  }
  const b = await sh("npx", ["vite", "build"]);
  return b.ok ? { ok: true } : { ok: false, error: `Build failed: ${b.out.split("\n").slice(-3).join(" ")}` };
};

const phase = (p, fresh = false) => update((s) => void (s.change = { ...(fresh ? {} : s.change), ...p, at: new Date().toISOString() }));
const say = (text, action, extra = {}) => update((s) => setChat(s, rouId, (l) => [...l, { role: "rou", text, at: new Date().toISOString(), ...(action ? { action } : {}), ...extra }]));

// The visual of the work is shown in the chat: if a cover or image changed, the result appears in the chat.
// Rou writes "SHOW: file, runId" on the last line; the files are attached to the message from data/media, runIds are shown with the output's own view.
// Without that line, images and videos that landed in data/media during the job are attached (except those of other outputs prepared at the time).
const SHOWABLE = /\.(png|jpe?g|webp|gif|mp4|mov|webm)$/i;
export function shownOf(out, since, s = read().state) {
  const lines = String(out ?? "").split("\n");
  const marks = lines.filter((l) => /^\s*(SHOW|GÖSTER|GOSTER)\s*:/i.test(l));
  const text = lines.filter((l) => !marks.includes(l)).join("\n").trim();
  const kind = (f) => (/\.(mp4|mov|webm)$/i.test(f) ? "video" : "image");
  const ok = (f) => SHOWABLE.test(f) && fs.existsSync(path.join(MEDIA_DIR, f));
  let files = [], show = [];
  for (const tok of marks.flatMap((l) => l.replace(/^[^:]*:/, "").split(/[,\s]+/)).map((t) => t.replace(/[`"'()]/g, "").trim()).filter(Boolean)) {
    const f = path.basename(tok);
    if (s.runs?.some((r) => r.id === tok)) show.push(tok);
    else if (ok(f)) files.push(f);
  }
  if (!marks.length && since) {
    const fresh = new Set(s.runs?.filter((r) => new Date(r.at) >= since).map((r) => r.id));
    try {
      files = fs.readdirSync(MEDIA_DIR).filter((f) => ok(f) && !/^rou-/.test(f) && !fresh.has(f.split("-")[0]) && fs.statSync(path.join(MEDIA_DIR, f)).mtimeMs >= since.getTime())
        .sort((a, b) => fs.statSync(path.join(MEDIA_DIR, b)).mtimeMs - fs.statSync(path.join(MEDIA_DIR, a)).mtimeMs);
    } catch { files = []; }
  }
  files = [...new Set(files)].slice(0, 4).map((f) => ({ file: f, name: f, kind: kind(f) }));
  show = [...new Set(show)].slice(0, 3);
  return { text, extra: { ...(files.length ? { files } : {}), ...(show.length ? { show } : {}) } };
}

const PROMPT = (text, seen = []) => [
  "You are Rou, the assistant in the user's Playgrounds app. You run on this computer, in the app's repo root, with file and command tools. Read CLAUDE.md first.",
  `The user asked for this and approved it: «${text}»`,
  seen.length ? `The user attached these files about it; open them with Read and look (e.g. find the spot in a screenshot):\n${seen.map((p) => `- ${p}`).join("\n")}` : "",
  [
    "How:",
    "- Change the app code (src/, server/, shared/, scripts/, tests/) if needed; it can be a new feature too. Follow the naming and comment density of the surrounding code, and use the type scale and colour tokens. If logic changes, add a test under tests/.",
    "- Data (world, project, task, note, automation) is written only with `node scripts/pg.mjs ...` (the commands are in CLAUDE.md; `pg world` for a world). Do not edit the files under data/ by hand. Do not invent tasks, notes or numbers.",
    "- Run commands if needed (e.g. npm test, npx tsc, npm install in this project). The system does the check and the commit after you: do not run git commit, push, reset or checkout.",
    "- Do not: send or publish anything outside (message, email, post, deploy), enter passwords or credentials, delete files outside this repo, change system settings, start a long-running process such as `npm run dev`. If something like that is needed, write why instead of doing it.",
    "- Make the smallest complete change that does what was asked; do not go beyond the request. Do not use em dashes (—). Interface text is English.",
    "- If the request is unclear, change nothing and write what is missing.",
  ].join("\n"),
  "When done, tell the user what you did in one or two short sentences, in the language the request was written in; say it in the past tense (I did, I changed) and give no file paths in the text. If you made or changed an image or video (cover, image, video), write `SHOW: <file name in data/media>` on a separate last line (comma-separated if several, at most 4); if you changed the image or text of an output (runId), add its runId to that line too. The app shows these in the chat, so the user sees the result there.",
].filter(Boolean).join("\n\n");

// Queue: a new change approved while one is running
// is not lost, it goes into state.changeQueue and starts when the previous one ends. The queue is kept in the data file: if server code changes and
// the server restarts (restartServer), the remaining work continues with the new code at startup through resumeChanges. The working tree must be clean when each job starts (run checks).
const MAX_QUEUE = 5;
let restarting = false;
const sayTo = (to, text) => update((s) => setChat(s, to, (l) => [...l, { role: "rou", text, at: new Date().toISOString() }]));

export function startChange(text, who, files) {
  if (!changeOn()) return { ok: false, error: "Rou's code changes are turned off" };
  text = String(text || "").trim().slice(0, 2000);
  if (!text) return { ok: false, error: "The request is empty" };
  const to = rouOf(read().state, who).id;
  const seen = (Array.isArray(files) ? files : []).map(mediaPath).filter(Boolean).slice(0, 8);
  const q = read().state.changeQueue ?? [];
  if (q.length >= MAX_QUEUE) return { ok: false, error: `There are already ${q.length} changes in the queue` };
  if (busy || restarting || q.length) {
    const n = q.length + 1;
    update((s) => void (s.changeQueue ??= []).push({ id: id(), text, rouId: to, seen, at: new Date().toISOString() }));
    sayTo(to, `I am making another change right now; I queued this one (number ${n}). I will start it by myself when the previous one is done.`);
    return { ok: true, queued: n };
  }
  begin({ text, rouId: to, seen });
  return { ok: true };
}

const RETRY_MS = 2 * 60 * 1000, MAX_TRIES = 60;
let retry;
function begin(job) {
  busy = true;
  rouId = job.rouId;
  void run(job.text, job.seen).catch((e) => console.error("change:", e?.stack ?? e)).then((res) => {
    if (res !== "dirty") return;
    const tries = (job.tries ?? 0) + 1;
    if (tries > MAX_TRIES) return sayTo(job.rouId, `I could not make the change: there has been unsaved work in the code for two hours. Approve «${job.text.slice(0, 120)}» again.`);
    if (tries === 1) sayTo(job.rouId, "There is unfinished work in the code right now. I am holding this change; I will start by myself once that work is saved.");
    update((s) => void (s.changeQueue ??= []).unshift({ ...job, tries }));
    clearTimeout(retry);
    retry = setTimeout(drain, RETRY_MS);
  }).finally(() => { busy = false; if (!retry || (read().state.changeQueue?.[0]?.tries ?? 0) === 0) drain(); });
}

// Starts the next job; waits if the server is about to restart (it continues with the new code at startup).
function drain() {
  retry = clearTimeout(retry);
  if (busy || restarting) return;
  let job;
  update((s) => { job = s.changeQueue?.shift(); if (job && !job.id) job.id = id(); if (s.changeQueue && !s.changeQueue.length) delete s.changeQueue; });
  if (job) begin(job);
}

// At startup: the queue left by the previous process continues. A job cut off midway (the server closed then) does not stay stuck on "Working".
export function resumeChanges() {
  if (!changeOn()) return;
  const c = read().state.change;
  if (c && !c.done && !c.waiting && !busy) { log({ id: c.id, text: c.text, at: new Date().toISOString(), error: "Interrupted: the app restarted." }); phase({ phase: "Failed", error: "Interrupted: the app restarted.", done: true }); }
  drain();
}

async function run(text, seen) {
  const cid = id();
  const since = new Date();
  phase({ id: cid, text, phase: "Preparing", rouId }, true);
  try {
    if ((await dirty()).length) { phase({ phase: "Waiting", waiting: true }); return "dirty"; }
    phase({ phase: "Working" });
    const r = await runClaude(PROMPT(text, seen), 20 * 60 * 1000, undefined, { cwd: ROOT, args: ["--allowedTools", "Read,Edit,Write,Glob,Grep,Bash", "--permission-mode", "bypassPermissions"] });
    if (!r.ok) return fail(r.error.slice(0, 200), true);
    const files = await dirty();
    // If no code changed, the job was in data or the system (e.g. a world was created with pg): there is no commit to undo.
    if (!files.length) {
      phase({ phase: "Done", done: true });
      log({ id: cid, text, at: new Date().toISOString() });
      const o = shownOf(r.out, since);
      return say(o.text.slice(0, 600) || "Done.", undefined, o.extra);
    }
    phase({ phase: "Checking" });
    const c = await check(files);
    if (!c.ok) return fail(`${c.error} The code change was rolled back (it is kept in git stash).`, true);
    // If another session (Claude Code) is committing at the same time, index.lock is held for a moment: wait a little and try once more.
    const commit = async () => { await git("add", "-A"); return git("commit", "-q", "-m", `Rou: ${subject(text)}`, "-m", String(text)); };
    let m = await commit();
    if (!m.ok && /index\.lock/.test(m.out)) { await new Promise((r) => setTimeout(r, 3000)); m = await commit(); }
    if (!m.ok) return fail(`The commit failed (${m.out.split("\n")[0].slice(0, 160)}); the change was rolled back.`, true);
    const sha = (await git("rev-parse", "HEAD")).out;
    log({ id: cid, text, sha, at: new Date().toISOString() });
    const restart = serverSide(files);
    phase({ phase: "Done", done: true, code: true, ...(restart ? { restart: true } : {}) });
    const o = shownOf(r.out, since);
    say(o.text.slice(0, 600) || "Done.", { type: "undo_change", changeId: cid }, o.extra);
    if (restart) restartServer();
  } catch (e) {
    await fail(String(e).slice(0, 200), true);
  }
}

// Under serve.mjs we exit with code 75 and serve.mjs starts again with the new code. With npm run dev, Vite must be restarted by hand.
// Running prepares and shares are waited for (15 min at most); otherwise they would be cut off and end as failed.
function restartServer() {
  if (process.env.PG_SUPERVISED) restarting = true;
  if (process.env.PG_SUPERVISED) void idle().then(() => setTimeout(() => process.exit(75), 400));
  else say("The server code changed; it takes effect when you restart npm run dev.");
}

// History (the Changes tab of the Rou chat): a code change (sha, Undo), a data-only or system job, or a failed one (error).
const log = (c) => update((s) => { (s.changes ??= []).unshift(c); s.changes.splice(40); });

async function fail(msg, revert = false) {
  if (revert) await discard();
  const c = read().state.change;
  if (c?.id && !c.done) log({ id: c.id, text: c.text, at: new Date().toISOString(), error: msg });
  phase({ phase: "Failed", error: msg, done: true });
  say(`I could not make the change. ${msg}`);
}

// Undo: that change's commit is reverted with git revert, then built again.
export function undoChange(changeId, who) {
  if (!changeOn()) return { ok: false, error: "Rou's code changes are turned off" };
  if (busy || restarting) return { ok: false, error: "Rou is making a change right now" };
  busy = true;
  rouId = rouOf(read().state, who).id;
  void (async () => {
    const c = read().state.changes?.find((x) => x.id === changeId && !x.undone);
    if (!c) return say("I could not find the change to undo.");
    if ((await dirty()).length) return say("There are unsaved changes in the code; I could not undo.");
    phase({ id: c.id, text: c.text, phase: "Undoing", rouId }, true);
    const r = await git("revert", "--no-edit", c.sha);
    if (!r.ok) { await git("revert", "--abort"); phase({ phase: "Failed", done: true }); return say("This change could not be undone because later changes got mixed with it."); }
    const files = (await git("show", "--name-only", "--format=", c.sha)).out.split("\n").filter(Boolean);
    const k = await check(files);
    update((s) => { const x = s.changes?.find((y) => y.id === c.id); if (x) x.undone = true; });
    const restart = k.ok && serverSide(files);
    phase({ phase: "Done", done: true, code: true, ...(restart ? { restart: true } : {}) });
    say(k.ok ? `Undone: «${c.text}».` : `Undone, but the check failed: ${k.error}`);
    if (restart) restartServer();
  })().finally(() => { busy = false; drain(); });
  return { ok: true };
}
