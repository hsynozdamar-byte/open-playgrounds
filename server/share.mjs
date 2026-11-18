// Automatic sharing of an approved post. The scheduler (schedule.mjs) checks every minute.
// When: once the post is approved, at the task's time (automation time or the first calendar block; with no time, right after approval).
// Automation outputs are shared automatically only if "Auto share" (automation.autoShare) is on in the automation;
// a single post (task.post) is shared at its time after the user's approval. "Share now" works on every approved output.
// Who: sharerOf(a, task). Rou works in the Playgrounds browser (server/pb.mjs), in the profile of the account's world; if PB is not installed
// it uses the account's linked Chrome (publish.mjs).
// Fallback chain (fallbackDue): if Rou cannot share, sharing is left to the user: the text and files are put in the share folder
// and a notification goes out (run.publish.handoff).
// If the account is not connected (no Chrome for the account, no PB) nothing is done and the task card says to connect the account.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { notify } from "./notify.mjs";
import { installed as pbInstalled } from "./pb.mjs";
import { read, update, DATA_DIR } from "./store.mjs";
import { designLow } from "./quality.mjs";
import { shareFiles } from "./sharemedia.mjs";
import { SHARE_DIR } from "./paths.mjs";
import { trashCommand } from "../shared/platform.mjs";
import { addNotice } from "../shared/notices.mjs";
import { accountOf, bodyOf, missingImage, platformName, taskRef } from "../shared/social.mjs";
import { outputOf, sharerOf, stagesOf } from "../shared/stages.mjs";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

// Time of the share (min) or null (no time: right away).
function slotOf(s, task) {
  if (task.autoSlot) return toMin(task.autoSlot);
  const b = (s.blocks ?? []).filter((x) => x.taskId === task.id && x.start.slice(0, 10) === task.day).map((x) => x.start.slice(11, 16)).sort()[0];
  return b ? toMin(b) : null;
}

const autoOfTask = (s, task) => (task?.autoId ? (s.automations ?? []).find((x) => x.id === task.autoId) : undefined);
// Tasks with a share step: from the steps for an automation, from run.post for a single task.
const hasPublish = (s, a, task, r) => (a ? stagesOf(s, a, task, r).steps.some((x) => x.key === "publish") : !!r.post);
const findRun = (st, runId) => {
  const r = runId && (st.runs ?? []).find((x) => x.id === runId || x.id.startsWith(runId));
  if (!r) throw new Error(`No such output: ${runId}`);
  return r;
};

// Automatic sharing waits this long after approval so the user can undo it. "Share now" does not wait.
export const UNDO_MS = 5 * 60 * 1000;

// What must be shared now: [{ runId, by: "claude" }]. Pure function (tested).
// opt.pb: the Playgrounds browser is installed (Rou shares in the world's profile even if the account is not linked to a Chrome).
// If a revision was asked for the same task after approval, or a newer draft exists, that approval is no longer valid
// (the old approved text must not be shared after later revisions).
export function staleApproval(s, task, r) {
  const at = r.approvedAt || r.at || "";
  if ((task.revisions ?? []).some((v) => v.at > at)) return true;
  if (task.revise?.at && task.revise.at > at) return true;
  return (s.runs ?? []).some((x) => x.taskId === task.id && x.id !== r.id && x.at > r.at && x.status !== "failed");
}

export function dueShares(s, now = new Date(), opt = {}) {
  const today = iso(now);
  const min = now.getHours() * 60 + now.getMinutes();
  const out = [];
  for (const r of s.runs ?? []) {
    if (r.status !== "approved" || r.publish || r.shareSentAt) continue;
    if (r.approvedAt && now - new Date(r.approvedAt) < UNDO_MS) continue; // undo window after approval
    const task = (s.tasks ?? []).find((t) => t.id === r.taskId);
    if (!task || task.status === "done") continue;
    if (staleApproval(s, task, r)) continue; // if a revision was asked after approval, the old approved text is not shared
    const a = autoOfTask(s, task);
    // An automation output is shared automatically only if "Auto share" is on; so is an automatically approved
    // (via "auto") output. If it is off the user says "Share now".
    if (a ? a.autoShare !== true : r.approvedVia === "auto") continue;
    if (!hasPublish(s, a, task, r)) continue;
    if (missingImage(r)) continue; // a LinkedIn post is not shared without its image
    if (task.day && task.day > today) continue;
    const slot = slotOf(s, task);
    if (task.day === today && slot !== null && min < slot) continue;
    const by = sharerOf(a, task);
    if (by === "me") continue; // the user shares it themselves
    const acc = accountOf(s, taskRef(s, task));
    if (!((acc?.browser || opt.pb) && (r.post || r.body))) continue;
    out.push({ runId: r.id, by });
  }
  return out;
}

const busy = new Set();
export const publishing = () => [...busy];
export async function shareNow(runId, by = "claude") {
  if (busy.has(runId)) return { ok: false, error: "Already being shared" };
  if (by !== "claude") return { ok: false, error: "You share this post" };
  if (missingImage(read().state.runs.find((x) => x.id === runId))) return { ok: false, error: "Image missing; a LinkedIn post is not shared without its image" };
  busy.add(runId);
  try {
    update((st) => { const x = st.runs.find((y) => y.id === runId); if (x) x.tried = [...new Set([...(x.tried ?? []), by])]; });
    const { publish } = await import("./publish.mjs");
    const r = publish(runId);
    // "Already being shared" is not an error: if written, the fallback chain would hand the job to the user while Rou keeps sharing.
    if (!r.ok && r.error !== "Already being shared") update((st) => { const x = st.runs.find((y) => y.id === runId); if (x) x.publish = { error: r.error, at: new Date().toISOString() }; });
    return r;
  } finally {
    busy.delete(runId);
  }
}

// From the scheduler: shares every post whose turn has come.
export function shareDue(now = new Date()) {
  const list = dueShares(read().state, now, { pb: pbInstalled() });
  for (const x of list) shareNow(x.runId, x.by).catch((e) => console.error("share:", e));
  return list;
}

// Next step for posts that could not be shared: [{ runId, next: "claude" | "me", reason }]. Pure function (tested).
// Rou tries once; if that fails, sharing is left to the user.
export function dueFallbacks(s, now = new Date(), opt = {}) {
  const out = [];
  for (const r of s.runs ?? []) {
    const p = r.publish;
    if (r.status !== "approved" || !p || p.handoff || !p.error) continue;
    const task = (s.tasks ?? []).find((t) => t.id === r.taskId);
    if (!task || task.status === "done") continue;
    const reason = `Rou could not share: ${p.error}`;
    const acc = accountOf(s, taskRef(s, task));
    const tried = r.tried ?? ["claude"];
    out.push({ runId: r.id, next: (acc?.browser || (opt.pb && acc)) && !tried.includes("claude") ? "claude" : "me", reason });
  }
  return out;
}

// Handoff folder: <share folder>/<Project>/<day> <Platform> · <task>/ (text.txt + 01.png…).
// Which output the folder belongs to is written in the hidden .run file inside it. Once the post is shared (I shared it, pg posted, Rou)
// the folder goes to the Trash; the original media stays in data/media. The daily retention sweeps up leftovers.
export const HANDOFF_ROOT = SHARE_DIR;
const safeName = (x) => String(x ?? "").replace(/^@/, "").replace(/https?:\/\//, "").replace(/[\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
function handoffDirs() {
  const out = [];
  const walk = (d, depth) => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { if (!e.isDirectory() || e.name.startsWith(".")) continue; const p = path.join(d, e.name);
      let id = ""; try { id = fs.readFileSync(path.join(p, ".run"), "utf8").trim(); } catch { id = (e.name.match(/ ([a-z0-9]{6})$/) || [])[1] || ""; }
      if (id) out.push({ dir: p, runId: id }); else if (depth < 1) walk(p, depth + 1); } };
  walk(HANDOFF_ROOT, 0);
  return out;
}
// The folder goes to the trash: ~/.Trash on macOS; on other systems only a folder with a .run marker (made by the app), the Recycle Bin on Windows, gio trash on Linux
// (shared/platform.mjs trashCommand). If it cannot be moved to the trash it is deleted.
function toTrash(p) {
  const cmd = trashCommand(p);
  if (cmd && !fs.existsSync(path.join(p, ".run"))) return false;
  if (!cmd) {
    const bin = path.join(os.homedir(), ".Trash");
    let to = path.join(bin, path.basename(p)), n = 2;
    while (fs.existsSync(to)) to = path.join(bin, `${path.basename(p)} ${n++}`);
    try { fs.renameSync(p, to); } catch { return false; }
  } else {
    try { execFileSync(cmd[0], cmd[1], { stdio: "ignore", timeout: 20000, windowsHide: true }); } catch { /* no trash: it is deleted */ }
    if (fs.existsSync(p)) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { return false; } }
  }
  const parent = path.dirname(p);   // also remove the project folder if it is left empty
  try { if (parent !== HANDOFF_ROOT && !fs.readdirSync(parent).filter((f) => !f.startsWith(".")).length) fs.rmSync(parent, { recursive: true }); } catch {}
  return true;
}
// Moves the handoff folders of shared (or deleted) outputs to the Trash. With a runId, only that one's.
export function sweepHandoffs(st, runId) {
  let n = 0;
  for (const h of handoffDirs()) {
    if (runId ? h.runId !== runId : (() => { const r = st.runs.find((x) => x.id === h.runId); return r && r.status !== "posted"; })()) continue;
    if (toTrash(h.dir)) n++;
  }
  return n;
}

// Leaves sharing to the user: text + files in the handoff folder, a notification.
export function handoff(runId, reason) {
  const s = read().state;
  const r = s.runs.find((x) => x.id === runId);
  if (!r) return null;
  const task = s.tasks.find((t) => t.id === r.taskId);
  const acc = task && accountOf(s, taskRef(s, task));
  const where = acc ? `${platformName(acc)} ${acc.handle || acc.name}` : "";
  const proj = task?.projectId && s.projects.find((p) => p.id === task.projectId);
  const group = safeName(proj?.name || acc?.name || "Other");
  const base = safeName(`${iso(new Date())} ${acc ? platformName(acc) : "Post"} · ${task?.title || r.title || acc?.name || ""}`);
  sweepHandoffs(s, r.id);   // so the old handoff folder of the same output (a retry) is not left as a duplicate
  let dir = path.join(HANDOFF_ROOT, group, base), k = 2;
  while (fs.existsSync(dir)) dir = path.join(HANDOFF_ROOT, group, `${base} (${k++})`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, ".run"), r.id);
  fs.writeFileSync(path.join(dir, "text.txt"), (r.post ? bodyOf(r.post) : r.body) ?? "");
  let files;
  try { files = shareFiles(r, acc?.platform); } catch { files = (r.video ? [r.video] : r.images ?? []).map((f) => path.join(DATA_DIR, f)); }
  files.forEach((src, i) => {
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, `${String(i + 1).padStart(2, "0")}${path.extname(src)}`));
  });
  update((st) => { const x = st.runs.find((y) => y.id === runId); if (x) { x.publish = { handoff: true, reason: String(reason).slice(0, 300), dir, at: new Date().toISOString() }; addNotice(st, { kind: "handoff", runId, text: `${reason}. The text and files are in the share folder: ${HANDOFF_ROOT}` }); } });
  notify(`Sharing is left to you${where ? `: ${where}` : ""}`, `${reason}. The text and files are in the share folder.`);
  return dir;
}

// From the scheduler: moves posts that could not be shared to the next step.
export function fallbackDue(now = new Date()) {
  const list = dueFallbacks(read().state, now, { pb: pbInstalled() });
  for (const x of list) {
    if (x.next === "claude") {
      update((st) => { const r = st.runs.find((y) => y.id === x.runId); if (r) r.publish = undefined; });
      shareNow(x.runId, "claude").catch((e) => console.error("fallback share:", e));
    } else handoff(x.runId, x.reason);
  }
  return list;
}

// Writes the shared (or could-not-share) result; the task ends once shared. Used by pg posted and publish.mjs.
// Like "LinkedIn · linkedin.com/company/...": where the share was made.
function whereOf(st, r) {
  const acc = accountOf(st, taskRef(st, st.tasks.find((t) => t.id === r.taskId)));
  return acc ? `${platformName(acc)} · ${acc.handle || acc.name}` : "";
}
export function markPosted(st, runId, { url, error } = {}) {
  const r = findRun(st, runId);
  const at = new Date().toISOString();
  const by = r.publish?.by ?? r.tried?.at(-1);
  const where = whereOf(st, r);
  if (error) {
    r.publish = { error: String(error).slice(0, 300), at, ...(by ? { by } : {}) };
    addNotice(st, { kind: "share_failed", runId, by, text: `${where ? `${where}. ` : ""}${r.publish.error}` });
    return r;
  }
  Object.assign(r, { status: "posted", postedAt: at, publish: undefined, ...(url && /^https?:\/\//.test(url) ? { postUrl: url } : {}) });
  sweepHandoffs(st, runId);   // shared: the handoff folder goes to the Trash
  addNotice(st, { kind: "posted", runId, by, text: where });
  const t = st.tasks.find((x) => x.id === r.taskId);
  if (t && t.status !== "done") { t.status = "done"; t.doneAt = at; }
  return r;
}

// Approval (same as Approve in the app): a task with no share ends on approval, one with a share ends once shared.
export function approveRun(st, runId, { via } = {}) {
  const r = findRun(st, runId);
  if (r.status !== "ready") throw new Error(r.status === "working" ? "The output is still being prepared" : `Not waiting for approval (${r.status}): ${r.title}`);
  if (r.revisedAt) throw new Error("A revision was requested for this output; approve the new one");
  if (r.items?.length) throw new Error("This output has choices; pick them in the app");
  const task = st.tasks.find((t) => t.id === r.taskId);
  const a = autoOfTask(st, task);
  if (a && task && ["voice", "video"].includes(stagesOf(st, a, task, r).current)) throw new Error("Voice or video is missing; complete it first");
  if (missingImage(r)) throw new Error("Image missing; a LinkedIn post is approved with its image");
  // An output with a low design review score is shown but is not approved automatically even in an automation that skips approval.
  if (via === "auto" && designLow(r)) throw new Error("Design score is low; approval is up to the user");
  const at = new Date().toISOString();
  Object.assign(r, { status: "approved", approvedAt: at, ...(via ? { approvedVia: via } : {}) });
  const shareable = !!r.post || (!!a && ["post", "video"].includes(outputOf(st, a)));
  // A single task given to Rou: approval means "go ahead", the task stays open (same as RunCard in the app).
  const keepOpen = !!task && !a && task.who === "claude";
  if (task && !shareable && !keepOpen && task.status !== "done") { task.status = "done"; task.doneAt = at; }
  return r;
}
