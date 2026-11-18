import { motion } from "motion/react";
import { openPost } from "./openPost";
import { runOfTask } from "../runs";
import { useState } from "react";
import { AlertTriangle, ArrowUpRight, CalendarDays, Check, Copy, Download, Eye, ChevronRight, ChevronUp, Folder, History, MessageCircle, MoreHorizontal, Paperclip, Pencil, RefreshCw, Repeat, RotateCcw, Send, Sparkles, Trash2, X } from "lucide-react";
import { Versions, versionsOf } from "./Versions";
import { DraftEditor, PostEditor } from "./PostEditor";
import { Gallery, mediaOf } from "./Gallery";
import { RunItems } from "./RunItems";
import { PUBLISHABLE, openAccountForm, worldOfAccount } from "./Social";
import { accountOf, missingImage, platformName, taskRef } from "../../shared/social.mjs";
import { bansOf, revisionsOf } from "../../shared/revise.mjs";
import { uploadFile } from "./RouAttach";
import { ImageStep, VideoStep, VoiceStep } from "./Board";
import { DraftPost, PostPreview, download, mediaFiles } from "./Preview";
import { openAutoForm } from "./AutoForm";
import type { Automation, Run, State, Task } from "../types";
import type React from "react";
import { type Ctx, ALL, blocksOf, setStatus, worldOf } from "../lib";
import { ago, relDay, today } from "../date";
import { makeOccurrence, nextRun, occurrenceOf, repeatsOn, scheduleText, slotsOf, topicKey } from "../../shared/repeat.mjs";
import { toast } from "./Toast";
import { askRouAbout } from "./Rou";
import { DoPanel, LiveBox, requestDo } from "./Live";
import { NoteBody } from "./NoteBody";
import { needsChrome } from "../../shared/chrome.mjs";
import { uid } from "../store";
import { startTask } from "../timer";
import { PLATFORM_NAME, outputOf, platformsOf, sharerOf, stagesOf } from "../../shared/stages.mjs";
import { binIt } from "../trashOps";
import { BrandIcon } from "./BrandIcon";
import { reveal } from "./reveal";
import { openAutoView } from "./openAuto";
import { AddTile } from "./QuickAdd";

export const autoOf = (s: State, t: Task) => (t.autoId ? s.automations.find((a) => a.id === t.autoId) : undefined);
const nextText = (a: Automation) => {
  if (a.status !== "active") return "Paused";
  const n = nextRun(a);
  return n ? `Next: ${relDay(n.day)}${n.slot ? ` ${n.slot}` : ""}` : "No plan";
};

// On the task card: if this task came from an automation, which one.
export function AutoInfoRow({ task, ctx, onGo }: { task: Task; ctx: Ctx; onGo: () => void }) {
  const a = autoOf(ctx.state, task);
  if (!a) return null;
  return (
    <div>
      <dt><Repeat size={15} />Automation</dt>
      <dd className="autoinfo">
        <button onClick={() => (onGo(), a && openAutoView(a.id))}>
          <Repeat size={13} /><b>{a.title}</b><span>{scheduleText(a)}{task.autoSlot ? ` · this task ${task.autoSlot}` : ""}</span><ArrowUpRight size={14} />
        </button>
      </dd>
    </div>
  );
}

// At startup the server turns half-finished "working" outputs into failed (server/app.mjs); this is only a wide limit for ones that got stuck.
// It used to be 6 min: when revisions (video recording) took longer the task dropped off the list and "preparing" was not shown.
const STALE = 60 * 60 * 1000;
export const isStale = (r: Run) => r.status === "working" && Date.now() - new Date(r.at).getTime() > STALE;

async function cancelPrepare(taskId: string) {
  const r = await fetch("/api/prepare/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId }) }).then((r) => r.json()).catch(() => ({ ok: false }));
  toast(r.ok ? "Preparing stopped" : "Couldn't stop: couldn't reach the server");
}
export async function prepare(taskId: string, tries = 3, feedback?: string, files?: { file: string; name: string; kind: "image" | "video" }[]): Promise<boolean | void> {
  const r = await fetch("/api/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId, feedback, files }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
  // If a newly opened task is not yet written to the file, retries shortly.
  if (!r.ok && r.error === "No such task" && tries > 1) return void setTimeout(() => prepare(taskId, tries - 1), 700);
  if (!r.ok) toast(r.error ?? "Couldn't prepare");
  else if (r.queued) toast(r.message ?? "Queued: starts when the current one is done");
  else toast("Rou started preparing; progress shows under Progress");
  return r.ok;
}

export const BOT: Record<string, string> = { claude: "Rou", me: "You" };
// Who does the task: in an automation task the automation's preparer, in a single task the assigned one; otherwise you.
export type Who = "me" | "claude";
// A one-off post Rou opened (task.post, by claude) is Rou's: in Focus it shows in Rou's panel with its share status.
export const whoOf = (s: State, t: Task): Who => (autoOf(s, t)?.who ?? t.who ?? (t.post && t.by === "claude" ? "claude" : "me")) as Who;

// On a project (or world) page: the automations here, a short list.
// Automation row: sits in the task list like a task, set apart by an "Automation" label. When, who, (if needed) which project
// and what it waits for now at a glance. Pressing opens the automation window (settings, plan, outputs).
// Series colour dot (automation.color): next to the automation's name in lists and chips.
export const SeriesDot = ({ color }: { color?: string }) => (color ? <i className="autodot" style={{ background: color }} aria-hidden /> : null);

export function AutoRow({ ctx, a, showProject, tag = true }: { ctx: Ctx; a: Automation; showProject?: boolean; tag?: boolean }) {
  const s = ctx.state;
  const waiting = s.runs.filter((r) => r.status === "ready" && isLatest(s, r) && s.tasks.find((t) => t.id === r.taskId)?.autoId === a.id).length;
  const plats = platformsOf(s, a);
  const n = slotsOf(a).filter(Boolean).length;
  const out = outputOf(s, a);
  const p = showProject && a.projectId ? s.projects.find((x) => x.id === a.projectId) : undefined;
  return (
    <li className="arow">
      <button onClick={() => openAutoView(a.id)}>
        <span className="arico">{plats.length ? <BrandIcon platform={plats[0]} size={16} /> : <Repeat size={16} />}</span>
        <span className="arbody">
          <span className="artitle"><SeriesDot color={a.color} /><b>{a.title}</b></span>
          <span className="armeta">{[p?.name, `${scheduleText(a)}${n > 1 ? ` · ${n} ${out === "post" || out === "video" ? "posts" : "times"} a day` : ""}`, a.who === "me" ? "You do it" : `${BOT[a.who]} prepares, you approve`].filter(Boolean).join(" · ")}</span>
          <span className={`arst ${waiting ? "is-you" : ""}`}>{a.status === "paused" ? "Paused" : waiting ? `${waiting} awaiting your approval` : nextText(a)}</span>{tag && <span className="arfoot"><span className="artag"><Repeat size={11} />Automation</span></span>}
        </span>
        <ChevronRight size={16} className="archev" />
      </button>
    </li>
  );
}

// A world's (or project's) automations: a row list. bare: only the list (inside the project task list).
export function ProjectAutos({ ctx, worldId, projectId, bare, adds }: { ctx: Ctx; worldId: string; projectId?: string | null; bare?: boolean; adds?: { label: string; onClick: () => void }[] }) {
  const s = ctx.state;
  const list = s.automations.filter((a) => a.worldId === worldId && (projectId === undefined || a.projectId === projectId));
  // adds: [] → no add box (the create buttons are in the card header).
  if (bare && adds?.length === 0 && !list.length) return null;
  const rows = (
    <ul className="arows strip">
      {adds?.length !== 0 && <AddTile items={adds ?? [{ label: "Set up automation", onClick: () => openAutoForm({ worldId, projectId: projectId ?? null }) }]} />}
      {list.map((a) => <AutoRow key={a.id} ctx={ctx} a={a} showProject={projectId === undefined} tag={!!bare && adds?.length !== 0} />)}
    </ul>
  );
  if (bare) return rows;
  return (
    <section className="card pautos">
      <div className="cardhead">
        <Repeat size={15} className="hicon" />
        <h3>Automations</h3>
        <span className="n">{list.length || ""}</span>
      </div>
      {rows}
    </section>
  );
}

// Run the automation now: opens today's next task (without an output), prepares it if it is Claude's.
// It can be run by hand even if today is not the automation's day.
// Do it now: the task moves to today, its calendar time becomes now (added if missing, length kept), then it starts for whoever does it:
// You → focus timer, Rou → prepares. To say "now" without dragging (task card Who row).

// Rou's direct Chrome task (POST /api/do-task): a run is opened; Rou picks the Chrome itself and starts. If no Chrome is connected the server says so.
async function goDirect(taskId: string) {
  const res = await fetch("/api/do-task", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
  if (!res.ok) return toast(res.error ?? "Couldn't start");
  toast("Rou started in the browser");
}

// What Save in the drawer starts: if the task is Rou's and its day has come (or it has no date), without waiting for its time.
// If its day is later the scheduler starts it that day. The button text comes from here too.
export function kickOffWhat(s: State, task: Task): "chrome" | "prepare" | null {
  if (task.status === "done" || autoOf(s, task) || (task.day && task.day > today())) return null;
  if (task.who !== "claude") return null;
  const last = s.runs.filter((r) => r.taskId === task.id).sort((a, b) => b.at.localeCompare(a.at))[0];
  const fresh = !last || last.status === "failed" || isStale(last);
  if ((fresh || (last.status === "approved" && !last.act?.phase)) && needsChrome(task, last)) return "chrome";
  return fresh ? "prepare" : null;
}

// "keep" = the drawer stays open (Chrome choice, live view).
export function kickOff(ctx: Ctx, task: Task): "keep" | "started" | false {
  const what = kickOffWhat(ctx.state, task);
  if (what === "chrome") { void goDirect(task.id); return "keep"; }
  if (what === "prepare") { void prepare(task.id); toast("Saved. Rou started."); return "started"; }
  return false;
}

export function doNow(ctx: Ctx, task: Task) {
  const who = whoOf(ctx.state, task);
  const d = new Date();
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const at = (x: Date) => `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}T${p2(x.getHours())}:${p2(x.getMinutes())}`;
  const day = at(d).slice(0, 10);
  ctx.mutate((st) => {
    const x = st.tasks.find((y) => y.id === task.id);
    if (!x) return;
    x.day = day;
    const mine = st.blocks.filter((b) => b.taskId === x.id).sort((a, b) => a.start.localeCompare(b.start));
    const b = mine.find((y) => y.start.slice(0, 10) === day && y.end > at(d)) ?? mine.find((y) => y.start > at(d));
    const len = b ? Math.max(15, (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000) : x.estimate ?? (who === "me" ? 60 : 30);
    const end = at(new Date(d.getTime() + len * 60000));
    if (b) Object.assign(b, { start: at(d), end });
    else st.blocks.push({ id: uid(), taskId: x.id, worldId: x.worldId, title: "", start: at(d), end, kind: "plan" });
  });
  if (who === "me") { if (ctx.state.timer?.taskId !== task.id) startTask(ctx.mutate, task.id); toast("Started: focus timer is running"); }
  else if (who === "claude") {
    const last = ctx.state.runs.filter((r) => r.taskId === task.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    if ((!last || last.status === "approved" || last.status === "failed") && needsChrome(task, last)) void goDirect(task.id);
    else { void prepare(task.id); toast("Rou is preparing it now"); }
  }
}

export function runNow(ctx: Ctx, a: Automation) {
  const s = ctx.state;
  const t = today();
  const used = (task?: Task) => !!task && (task.status === "done" || s.runs.some((r) => r.taskId === task.id && r.status !== "failed" && !isStale(r)));
  const slot = slotsOf(a).find((x) => !used(occurrenceOf(s, a, t, x)));
  if (slot === undefined) return toast("Today's tasks are already prepared");
  let task = occurrenceOf(s, a, t, slot);
  if (!task) {
    // Set the new task up in a temporary state first: it is both saved and prepared with the same id.
    const tmp = { tasks: [], blocks: [] } as unknown as State;
    task = makeOccurrence(tmp, { ...a, topics: { ...a.topics } }, t, slot);
    const made = tmp;
    ctx.mutate((st) => {
      st.tasks.push(...made.tasks); st.blocks.push(...made.blocks);
      const x = st.automations.find((y) => y.id === a.id);
      if (x?.topics) delete x.topics[topicKey(t, slot)];
    });
  }
  const id = task.id;
  if (a.who === "claude") setTimeout(() => prepare(id), 500);
  else toast("Today's task opened", () => ctx.open(id), "Open");
}

// Produces a future day's post without waiting: that day's task is opened now (day and time stay the same)
// and prepared. In the morning the automation finds that task and does not open it a second time.
// Opens the task of one day of an automation (does not prepare): creates it now if missing, returns its id. For seeing details and bulk prepare.
export function openAt(ctx: Ctx, a: Automation, day: string, slot: string): string {
  const have = occurrenceOf(ctx.state, a, day, slot);
  if (have) return have.id;
  const tmp = { tasks: [], blocks: [] } as unknown as State;
  const task = makeOccurrence(tmp, { ...a, topics: { ...a.topics } }, day, slot);
  ctx.mutate((st) => {
    st.tasks.push(...tmp.tasks); st.blocks.push(...tmp.blocks);
    const x = st.automations.find((y) => y.id === a.id);
    if (x?.topics) delete x.topics[topicKey(day, slot)];
  });
  return task.id;
}
export function runAt(ctx: Ctx, a: Automation, day: string, slot: string) {
  let task = occurrenceOf(ctx.state, a, day, slot);
  if (!task) {
    const tmp = { tasks: [], blocks: [] } as unknown as State;
    // Opens on a copy (the topic moves from the automation to the task); the real data changes inside mutate.
    task = makeOccurrence(tmp, { ...a, topics: { ...a.topics } }, day, slot);
    ctx.mutate((st) => {
      st.tasks.push(...tmp.tasks); st.blocks.push(...tmp.blocks);
      const x = st.automations.find((y) => y.id === a.id);
      if (x?.topics) delete x.topics[topicKey(day, slot)];
    });
  }
  const id = task.id;
  if (a.who === "claude") { setTimeout(() => queuePrepare([id]), 500); toast("Added to Rou's queue; Rou prepares in order"); }
  else toast("Task opened", () => ctx.open(id), "Open");
}

// Rou's queue: tasks are prepared one after another, not at once (server prepareMany).
export function queuePrepare(ids: string[]) {
  return fetch("/api/prepare-many", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => toast("Couldn't reach the server"));
}
// Is it queued: if the mark is older than 2 hours (the server restarted) it does not count.
export const isQueued = (t?: Task) => !!t?.queuedAt && Date.now() - new Date(t.queuedAt).getTime() < 2 * 3600 * 1000;

// On the task card: the output the assistant prepared, or the prepare button.
export function OutputSection({ task, ctx }: { task: Task; ctx: Ctx }) {
  const s = ctx.state;
  // Immediate feedback on press: the button waits with a spinner until the new output arrives.
  const [starting, setStarting] = useState<string | null>(null);
  const a = autoOf(s, task);
  const runs = s.runs.filter((r) => r.taskId === task.id);
  // A task without an automation can also have a doer chosen (task.who): Rou prepares.
  const who = a ? a.who : task.who ?? "me";
  // If there is an output the heading says who made it (even if Who was changed on the card).
  const bot = runs[0]?.by ?? (who !== "me" ? who : undefined);
  if (!runs.length && who === "me") return null;
  const last = runs[0];
  const busy = last?.status === "working" && !isStale(last);
  const waiting = !!starting && !busy && (last?.id ?? "none") === starting;
  const start = async () => {
    setStarting(last?.id ?? "none");
    const ok = await prepare(task.id);
    if (!ok) setStarting(null);
    else setTimeout(() => setStarting(null), 20000);
  };
  return (
    <section className="dsec">
      <div className="dsechead"><span className="flabel">{a && a.who !== "me" ? (last ? `${BOT[last.by ?? a.who] ?? BOT[a.who]} prepared` : `${BOT[a.who]} will prepare`) : (BOT[bot ?? "claude"] ?? bot) === "You" ? "You do it" : `${BOT[bot ?? "claude"] ?? bot} does it`}</span></div>
      {last && <RunCard r={last} ctx={ctx} />}
      {/* Attempt history: earlier outputs, your revision note, Rou's score or the reason for the error. */}
      {runs.length > 1 && (
        <details className="dhist">
          <summary>Earlier attempts · {runs.length - 1}</summary>
          <ol>
            {runs.slice(1).map((x) => (
              <li key={x.id}>
                <span className="dhwhen">{new Date(x.at).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
                <span className={`dhstat s-${x.status}`}>{({ failed: "Couldn't prepare", ready: "Was awaiting approval", approved: "Approved", posted: "Shared", working: "Was preparing" } as Record<string, string>)[x.status] ?? x.status}{x.review?.score != null ? ` · ${x.review.score}/10` : ""}</span>
                {x.reviseNote ? <p><b>Your revision note:</b> {x.reviseNote}</p> : x.status === "failed" && (x.renderError || x.body) ? <p>{(x.renderError || x.body)!.slice(0, 220)}</p> : x.title ? <p>{x.title}</p> : null}
              </li>
            ))}
          </ol>
        </details>
      )}
      {/* A single task with no result yet: says what will happen; starting is from the drawer's bottom button. */}
      {!last && !a && <p className="rplanned">{needsChrome(task) ? "Rou does the task in the Playgrounds browser: plans it, makes the text and images it needs, and applies them on the page. It asks you before any final step that can't be undone." : "Rou prepares it; the result comes to this card and waits for your approval."}</p>}
      {/* Process: which step the task is on; under its own heading apart from the output card, so its purpose is clear. */}
      {a && a.who !== "me" && <>
        <div className="dsechead dlifehead"><span className="flabel">Progress</span></div>
        <Lifecycle ctx={ctx} task={task} a={a} r={last} />
      </>}
      {a && task.status !== "done" && !busy && (!last || last.status === "failed") && (waiting
          ? <button className="btn sm dsecbtn" disabled aria-busy><RefreshCw size={14} className="spin" />Rou is starting…</button>
          : <button className="btn sm dsecbtn" onClick={start}><Sparkles size={14} />{last ? "Prepare again" : "Prepare now"}</button>)}
    </section>
  );
}

// The task's story: who prepared it, approval, sharing and what happens next. Each step with its time; the next step says plainly whose hands it is in.
function Lifecycle({ ctx, task, a, r }: { ctx: Ctx; task: Task; a: Automation; r?: Run }) {
  const s = ctx.state;
  const bot = BOT[a.who];
  const out = outputOf(s, a);
  const shareable = !!r?.post || out === "post" || out === "video";
  const acc = accountOf(s, taskRef(s, task));
  const accName = acc ? `${platformName(acc)} ${acc.handle || acc.name}`.trim() : "";
  const hm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "");
  type Row = { state: "done" | "now" | "todo" | "fail"; title: string; text?: React.ReactNode; at?: string; body?: React.ReactNode };
  const rows: Row[] = [];
  const stg = stagesOf(s, a, task, r);
  const sharer = stg.steps.find((x) => x.key === "publish")?.who ?? "Rou";
  const isVideo = out === "video";
  const what = isVideo ? "the video script" : out === "post" ? "the post text" : out === "report" ? "the report" : "the text";
  for (const x of stg.steps) {
    const busy = x.state === "now" && stg.busy;
    if (x.key === "write") rows.push(x.state === "done" ? { state: "done", title: `${bot} prepared ${what}`, at: hm(r?.at) }
      : x.state === "fail" ? { state: "fail", title: "Couldn't prepare", text: r?.renderError ? r.renderError.slice(0, 400) : r?.body ? r.body.slice(0, 200) : "You can prepare it again." }
      : busy ? { state: "now", title: `${bot} is preparing ${what}`, text: [r?.phase ? `${r.phase}…` : "", r?.queued ?? ""].filter(Boolean).join(" · ") || undefined }
      : { state: "now", title: `Rou will prepare ${what}`, text: "Starts on its own 1 hour before the task's time." });
    if (x.key === "voice") rows.push(x.state === "done" ? { state: "done", title: "You recorded your voice" }
      : x.state === "now" ? { state: "now", title: "Read the script in your own voice", text: "After the recording Rou builds the video.", body: r ? <VoiceStep run={r} /> : undefined }
      : { state: "todo", title: "The voice-over is yours", text: "Once the script is ready, you read and record it here." });
    if (x.key === "video") rows.push(x.state === "done" ? { state: "done", title: "Video ready", text: "Watch or download it on the card below." }
      : x.state === "fail" ? { state: "fail", title: "Couldn't make the video", text: r?.renderError, body: r ? <VideoStep run={r} failed /> : undefined }
      : busy ? { state: "now", title: "Rou is making the video", text: r?.phase ? `${r.phase}…` : undefined }
      : { state: x.state === "now" ? "now" : "todo", title: isVideo ? "Rou builds the video" : "Rou makes the video", text: isVideo ? "It joins your voice with the script's scenes into a vertical Reel. Nothing is needed from you in this step." : "A short vertical video from the text's main idea. Approval and sharing open once the video is done." });
    if (x.key === "image") rows.push(x.state === "done" ? (r?.images?.length ? { state: "done", title: "Image ready", text: "It shows under the post." } : r?.video ? { state: "done", title: "Video ready", text: "It shows under the post; a video goes instead of an image." } : { state: "done", title: "No image added", text: "This post is text only." })
      : x.state === "fail" ? { state: "fail", title: "Couldn't make the image", text: r?.renderError, body: r ? <ImageStep run={r} failed /> : undefined }
      : busy ? { state: "now", title: "Rou is making the image", text: r?.phase ? `${r.phase}…` : undefined }
      : x.state === "now" && r ? { state: "now", title: "Image missing", text: "The text is ready; without an image it can't be approved or shared.", body: <ImageStep run={r} /> }
      : { state: "todo", title: "Rou makes the image", text: "From the text's main idea, in the project's look. Approval and sharing open once the image is done." });
    if (x.key === "approve") rows.push(x.state === "done" ? { state: "done", title: "You approved it", at: hm(r?.approvedAt) }
      : x.state === "now" ? { state: "now", title: "Awaiting your approval", text: `${isVideo ? "Watch the video; approve it or request changes." : "Read the text; approve, edit or request changes."}` }
      : { state: "todo", title: "Approval is yours", text: isVideo ? "Once the video is ready, you watch and approve it." : undefined });
    if (x.key === "publish") {
      // Rou shares in Playgrounds' browser, in the session of the account's world. At its time by itself (server/share.mjs).
      const byRou = sharer === "Rou";
      const byMe = sharer === "You";
      const plats = platformsOf(s, a);
      const ready = byMe || !!acc;
      const where = accName || plats.map((p) => PLATFORM_NAME[p] ?? p).join(", ");
      const slot = task.autoSlot || blocksOf(s, task.id).find((b) => b.start.slice(0, 10) === task.day)?.start.slice(11, 16);
      const when = slot ? `at ${slot}` : "right after approval";
      const linkAcc = acc
        ? <button className="link" onClick={() => { const wd = worldOfAccount(s.worlds, acc.id); if (wd) openAccountForm({ worldId: wd.id, id: acc.id }); }}>Open account</button>
        : <button className="link" onClick={() => openAccountForm({ worldId: task.worldId ?? "", projectId: task.projectId ?? undefined })}>Link an account</button>;
      const how = byMe
        ? <>After approval you copy the text, share it yourself{where ? ` on ${where}` : ""}, then press "I shared it".</>
        : ready
        ? <>Rou opens {where} in the Playgrounds browser, shares it {when} and adds the post link here.</>
        : byRou
          ? <>Rou needs an account to share. {linkAcc}. If you shared it yourself, press "Shared by hand".</>
          : <>It's not set where to share. Pick a platform in the automation or {linkAcc}. If you shared it yourself, press "Shared by hand".</>;
      const now = !byMe && r && r.status === "approved" && ready && !r.publish?.phase ? <button className="btn sm" onClick={() => shareNow(r.id)}><Send size={14} />{r.publish?.error ? "Try again" : "Share now"}</button> : undefined;
      const kit = r?.publish?.handoff ? <div className="runact">{acc && <RetryShare runId={r.id} />}<button className="btn sm" onClick={() => fetch("/api/open-share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: r.id }) })}><Folder size={14} />Open folder</button></div> : undefined;
      rows.push(x.state === "done" ? { state: "done", title: "Shared", at: hm(r?.postedAt), text: r?.postUrl ? <a className="link" href={r.postUrl} target="_blank" rel="noreferrer" onClick={(e) => openPost(r, e)}>Open post ↗</a> : "No link added." }
        : r?.publish?.handoff ? { state: "fail", title: "Sharing is left to you", text: `${r.publish.reason}. The text and files are in the share folder; press "I shared it" once you've shared it.`, at: hm(r.publish.at), body: kit }
        : r?.publish?.error ? { state: "fail", title: "Couldn't share", text: r.publish.error, body: now }
        : r?.publish?.phase ? { state: "now", title: r.publish.phase.startsWith(sharer) ? r.publish.phase : `${sharer} ${byMe ? "are" : "is"} sharing`, text: r.publish.live ? "The link comes here when it's done." : `${r.publish.phase}. The link comes here when it's done.`, at: hm(r.publish.at), body: r.publish.by === "claude" ? <LiveBox live={r.publish.live} busy runId={r.id} /> : undefined }
        : x.state === "now" ? { state: "now", title: byMe ? "Sharing is yours" : ready ? `${sharer} will share it` : "Sharing waits", text: how, body: now }
        : { state: "todo", title: byMe ? "You share it" : `${sharer} shares it`, text: how });
    }
  }
  rows.push(task.status === "done" ? { state: "done", title: r?.status === "posted" ? "Shared, task done" : "Task done", at: hm(r?.postedAt ?? task.doneAt) } : { state: "todo", title: shareable ? "The task ends once it's shared" : a.approve === false ? "The task ends when the output arrives" : "The task ends when you approve" });
  return (
    <ol className="life">
      {rows.map((x, i) => (
        <li key={i} className={`is-${x.state}`}>
          <span className="ldot">{x.state === "done" && <Check size={10} strokeWidth={3} />}</span>
          <div className="ltext"><b>{x.title}{x.at && <em>{x.at}</em>}</b>{x.text && <span>{x.text}</span>}{x.body && <div className="lbody">{x.body}</div>}</div>
        </li>
      ))}
    </ol>
  );
}

// Shares the approved post without waiting (the sharer is Rou; server/share.mjs).
async function shareNow(runId: string, approve = false) {
  const r = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, approve }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
  toast(r.ok ? "Sharing started" : `Couldn't share: ${r.error}`);
}

async function publish(runId: string) {
  const r = await fetch("/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
  toast(r.ok ? "Rou started sharing. What it does shows here." : `Couldn't start: ${r.error ?? "unknown error"}`);
  return !!r.ok;
}

// If sharing was left to the user, have Rou try again.
// A spinner right after the press; once it starts the row says "Rou is retrying" and live steps arrive.
function RetryShare({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);
  return <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); if (!(await publish(runId))) setBusy(false); }}>{busy ? <RefreshCw size={14} className="spin" /> : <Send size={14} />}{busy ? "Starting…" : "Let Rou try again"}</button>;
}

const STATE_ICON: Partial<Record<Run["status"], typeof Check>> = { ready: Eye, approved: Check, posted: Check, acted: Check, failed: AlertTriangle };
// The card's label: the task's current stage and who takes the next step ("Approved · Rou will share 10:00").
export function runTag(s: State, task: Task, r?: Run | null): string {
  if (!r) return task.status === "done" ? "Done" : "Not prepared";
  const a = autoOf(s, task);
  // Single task (no automation, e.g. Gmail cleanup): Rou does it in the browser, it may ask questions.
  if (!a) {
    if (r.status === "working") return "Rou is preparing";
    if (r.status !== "approved") return RUN_LABEL[r.status] ?? r.status;
    if (task.status === "done") return "Done";
    if (r.act?.question) return "Waiting for your answer";
    if (r.act?.phase) return "Rou is on it";
    if (r.act?.error) return "Rou couldn't do it";
    return "Approved";
  }
  const pub = stagesOf(s, a, task, r).steps.some((x: { key: string }) => x.key === "publish");
  const me = sharerOf(a, task) === "me";
  const slot = task.autoSlot || task.post?.at || "";
  switch (r.status) {
    case "working": return "Rou is preparing";
    case "failed": return "Couldn't prepare";
    case "ready": return "Awaiting approval";
    case "posted": return "Shared";
    case "acted": return "Done";
    case "approved":
      if (!pub || task.status === "done") return "Done";
      if (r.publish?.error) return "Couldn't share";
      if (r.publish?.handoff) return "Approved · you share it";
      if (r.publish?.phase) return "Rou is sharing";
      return me ? "Approved · you share it" : `Approved · Rou will share${slot && task.day && task.day >= today() ? ` ${task.day === today() ? "" : relDay(task.day) + " "}${slot}` : ""}`;
  }
  return RUN_LABEL[r.status] ?? r.status;
}

export const RUN_LABEL: Record<Run["status"], string> = { working: "Preparing", failed: "Couldn't prepare", ready: "Awaiting approval", approved: "Approved", posted: "Shared", acted: "Done" };

// Your revision notes: every note you wrote for this task (oldest to newest) and what Rou could not do in this output.
function Revisions({ task, r }: { task: Task; r: Run }) {
  const list = revisionsOf(task);
  if (!list.length && !r.reviseGaps?.length && !r.topicMiss) return null;
  const last = list.at(-1);
  const bans = bansOf(task);
  return (
    <div className="rrevs">
      {r.topicMiss ? <div className="rrevgap"><b>The topic didn't fully match its source</b><ul><li>{r.topicMiss}</li></ul></div> : null}
      {r.reviseGaps?.length ? <div className="rrevgap"><b>Rou couldn't do these</b><ul>{r.reviseGaps.map((g, i) => <li key={i}>{g.ask}{g.why ? <span> · {g.why}</span> : null}</li>)}</ul></div> : null}
      {last?.clear && (
        <div className="rrevclear">
          <b>How Rou read your last note</b>
          <p>{last.clear.ask}</p>
          {bans.length > 0 && <p className="rrevban">Won't appear anywhere: {bans.join(", ")}</p>}
          {last.clear.rule && last.saved?.length ? <p className="rrevask">Made it a standing rule ({last.saved.length} {last.saved.length === 1 ? "automation" : "automations"}): {last.clear.rule.text}</p> : null}
          {r.found?.facts?.length ? <p className="rrevask">What it learned from the work itself: {r.found.facts.join(" ")}</p> : null}
          {r.found && (r.found.note || !r.found.facts?.length) ? <p className="rrevask">Took the visuals from: {r.found.from}{r.found.note ? `. ${r.found.note}` : ""}</p> : null}
        </div>
      )}
      {list.length > 0 && (
        <details className="rrevlog">
          <summary>Your revision notes <span>{list.length}</span></summary>
          <ol>{list.map((x, i) => <li key={x.at + i} className={r.answers === x.at ? "is-this" : ""}><time>{x.at ? new Date(x.at).toLocaleString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : ""}</time><p>{x.note}</p>{x.clear && <p className="rrevask">How Rou read it: {x.clear.ask}</p>}</li>)}</ol>
        </details>
      )}
    </div>
  );
}

export function RunCard({ r, ctx, withSource, onCollapse }: { r: Run; ctx: Ctx; withSource?: boolean; onCollapse?: () => void }) {
  const s = ctx.state;
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<"del" | "post" | "revise" | "posted" | "share" | "versions" | null>(null);
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  // Revision attachments: Rou looks at these and adds them to the output (images first, they stand in for the video).
  const [revFiles, setRevFiles] = useState<{ file: string; name: string; kind: "image" | "video" }[]>([]);
  const [uploading, setUploading] = useState(false);
  const addRevFiles = async (list: FileList | null) => {
    const fs = [...(list ?? [])].filter((f) => /^(image|video)\//.test(f.type)).slice(0, 8);
    if (!fs.length) return;
    setUploading(true);
    for (const f of fs) {
      const up = await uploadFile(f, f.name);
      if ("error" in up) toast(up.error); else setRevFiles((x) => [...x, { file: up.file, name: f.name, kind: f.type.startsWith("video/") ? "video" : "image" }]);
    }
    setUploading(false);
  };
  const [editing, setEditing] = useState(false);
  const task = r.taskId ? s.tasks.find((x) => x.id === r.taskId) : undefined;
  const acc = r.post ? accountOf(s, taskRef(s, task)) : undefined;
  const remove = () => {
    binIt(ctx, "run", r.title, { runs: [r] }, (st) => void (st.runs = st.runs.filter((x) => x.id !== r.id)), "Output deleted");
  };
  const w = worldOf(s, task?.worldId ?? null);
  const status = isStale(r) ? "failed" : r.status;
  const setRun = (patch: Partial<Run>, done?: boolean) =>
    ctx.mutate((st) => {
      const x = st.runs.find((y) => y.id === r.id);
      if (x) Object.assign(x, patch);
      const t = st.tasks.find((y) => y.id === r.taskId);
      if (t && done) setStatus(t, "done");
    });
  // For a post or video, approval does not finish the task: it finishes when shared. For outputs like text or a report, approval finishes the task.
  const shareable = (() => { const t = r.taskId ? s.tasks.find((x) => x.id === r.taskId) : undefined; const a = t && autoOf(s, t); return !!r.post || (!!a && ["post", "video"].includes(outputOf(s, a))); })();
  const postOut = (() => { const a = task && autoOf(s, task); return !!a && outputOf(s, a) === "post"; })();
  // Approval can be undone: if sharing has not started the output goes back to waiting for approval.
  const unapprove = () => ctx.mutate((st) => {
    const x = st.runs.find((y) => y.id === r.id);
    if (!x || x.status !== "approved") return;
    x.status = "ready";
    delete x.approvedAt;
    delete x.approvedVia;
    delete x.publish;
    delete x.shareSentAt;
    const t = st.tasks.find((y) => y.id === r.taskId);
    if (t && t.status === "done") setStatus(t, "todo");
  });
  // A single task given to Rou (not an automation): approval means "go on", the task stays open; you close it when done.
  const keepOpen = (() => { const t = r.taskId ? s.tasks.find((x) => x.id === r.taskId) : undefined; return !!t && !autoOf(s, t) && t.who === "claude"; })();
  const approve = () => {
    setRun({ status: "approved", approvedAt: new Date().toISOString() }, !shareable && !keepOpen);
    // When a single task to do in Chrome is approved Rou starts without waiting.
    const t = r.taskId ? s.tasks.find((x) => x.id === r.taskId) : undefined;
    if (keepOpen && t && needsChrome(t, r)) { requestDo(r.id); return toast("Approved. Rou is starting in the browser.", unapprove); }
    toast(keepOpen ? "Approved. The task stays open." : "Approved. You can undo it within 5 minutes.", unapprove);
  };
  // A share that has started and is running cannot be undone; if it could not be shared the approval can be undone.
  const canUnapprove = status === "approved" && !r.publish?.phase && (!r.shareSentAt || !!r.publish?.error);
  const markPosted = (url?: string) => {
    const before = r.status, pub = r.publish;
    const was = r.taskId ? s.tasks.find((x) => x.id === r.taskId)?.status : undefined;
    setRun({ status: "posted", postedAt: new Date().toISOString(), publish: undefined, ...(url ? { postUrl: url } : {}) }, true);
    // Undo restores everything: the task is reopened, the share record and address go back too.
    toast("Marked as shared", () => ctx.mutate((st) => {
      const x = st.runs.find((y) => y.id === r.id);
      if (x) { x.status = before; delete x.postedAt; if (url) delete x.postUrl; if (pub) x.publish = pub; }
      const t = st.tasks.find((y) => y.id === r.taskId);
      if (t && was && was !== "done" && t.status === "done") setStatus(t, was);
    }));
  };
  const publishing = !!r.publish?.phase && Date.now() - new Date(r.publish.at).getTime() < 12 * 60 * 1000;
  const busyPhase = status === "working" ? `${r.phase ? `${r.phase}…` : "Preparing…"}${r.queued ? ` · ${r.queued}` : ""}` : publishing ? `${r.publish!.phase}…` : r.phase ? `${r.phase}…` : null;
  const label = busyPhase ?? (task ? runTag(ctx.state, task, r) : RUN_LABEL[status]);
  const files = mediaFiles(r);
  const when = task?.day ? `${relDay(task.day)}${task.autoSlot ? ` ${task.autoSlot}` : task.post?.at ? ` ${task.post.at}` : ""}` : "";
  const canPost = !!acc && PUBLISHABLE.has(acc.platform);
  const ready = canPost;
  const accName = acc ? `${platformName(acc)} ${acc.handle || acc.name}`.trim() : "";
  // Cannot be approved while the voice, video or (LinkedIn) image is still missing (shared/stages.mjs).
  const auto = task ? autoOf(s, task) : undefined;
  const stage = auto ? stagesOf(s, auto, task, r).current : null;
  const lowScore = r.review?.score != null && r.review.score < 8;
  const incomplete = stage === "voice" || stage === "video" || stage === "image" || missingImage(r);
  const byMe = (!!auto && sharerOf(auto, task) === "me") || !!r.publish?.handoff;
  // Who shares, and when: shown in the approval bar. "Share now" does not change its place on the calendar.
  const sharerKey = task ? sharerOf(auto, task) : "claude";
  const sharerName = sharerKey === "claude" ? "Rou" : sharerKey === "me" ? "You" : "Rou";
  const slot0 = task ? task.autoSlot || blocksOf(s, task.id).find((b) => b.start.slice(0, 10) === task.day)?.start.slice(11, 16) : undefined;
  // If the time has passed sharing does not wait for the time: "right away".
  const slot = slot0 && task?.day && `${task.day}T${slot0}` > new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) ? slot0 : undefined;
  const canShareNow = shareable && !!r.post && !byMe && !publishing && !missingImage(r) && (sharerKey === "claude" ? !!acc : !!acc || (!!auto && platformsOf(s, auto).length > 0));
  const whenNote = !shareable || byMe || !canShareNow ? "" : status === "ready" ? `If you approve, ${sharerName} shares it ${slot ? `at ${slot}` : "right away"}` : status === "approved" ? `${sharerName} will share it ${slot ? `at ${slot}` : "shortly"}` : "";
  const nVersions = versionsOf(s, r).length;
  return (
    <motion.article layout transition={{ layout: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } }} className={`run r-${status}`} style={{ ["--w" as string]: w.color }}>
      <div className="runmeta">
        {withSource && <button className="wd" onClick={() => task && ctx.open(task.id)} title={task?.title ?? r.title}><i /><span className="wdt">{task?.title ?? r.title}</span></button>}
        {when && <span className="ron"><CalendarDays size={12} />{when}</span>}
        <span>{ago(r.postedAt ?? r.at)}{r.by ? ` · ${r.by === "claude" ? "Rou" : r.by}` : ""}{r.edited ? " · edited" : ""}</span>
        <span className={`rstate ${busyPhase ? "working" : status}`}>{busyPhase ? <RefreshCw size={12} className="spin" /> : (() => { const I = STATE_ICON[status]; return I ? <I size={12} strokeWidth={2.5} /> : null; })()}{label}</span>
        {status === "working" && task && <button className="btn sm ghost rstop" onClick={() => cancelPrepare(task.id)}><X size={13} />Stop</button>}
        {onCollapse && <button className="iconbtn rcollapse" onClick={onCollapse} aria-label="Close" title="Close"><ChevronUp size={16} /></button>}
      </div>
      {editing && r.post ? <PostEditor r={r} ctx={ctx} color={w.color} onDone={() => setEditing(false)} />
        : editing ? <DraftEditor r={r} ctx={ctx} onDone={() => setEditing(false)} />
        : r.post && status !== "failed" ? <PostPreview r={r} s={s} />
        : postOut && status !== "working" && status !== "failed" && r.body ? <DraftPost r={r} s={s} />
        : status !== "working" && r.body && <>
          {/* The output is written in markdown (heading, list, bold); when closed the first lines show and the rest fades softly. */}
          {(() => { const long = r.body.length > 220 || r.body.split("\n").length > 4; return <>
            <div className={`rmd ${long && !open ? "is-clamped" : ""}`} onClick={() => long && setOpen(!open)}><NoteBody text={r.body} /></div>
            {long && <button className="pvmore rmore" onClick={() => setOpen(!open)}>{open ? "Show less" : "Show all"}</button>}
          </>; })()}
        </>}
      {status === "working" && r.live && <LiveBox live={r.live} busy runId={r.id} />}
      {task && !auto && task.who === "claude" && (status === "approved" || status === "acted") && <DoPanel r={r} task={task} ctx={ctx} />}
      {!r.post && !postOut && !editing && <div className="rgal"><Gallery items={mediaOf(r).filter((m) => !m.remote)} /></div>}
      {r.items?.length && status !== "working" ? <RunItems r={r} auto={task ? autoOf(s, task) : undefined} /> : null}
      {r.publish?.error && !publishing && status !== "posted" && <p className="pvissues rperr">Couldn't share: {r.publish.error}</p>}
      {task && status !== "posted" && <Revisions task={task} r={r} />}
      {/* Shared post: status, where and when, one button to go to the post. On wide screens it sits to the right of the preview. */}
      {status === "posted" && (
        <div className="rpostedbox">
          <span className="rpok"><Check size={16} strokeWidth={2.6} /></span>
          <div className="rptext">
            <b>Shared</b>
            <span>{[acc?.name ?? "", r.postedAt ? new Date(r.postedAt).toLocaleString("en-US", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : ""].filter(Boolean).join(" · ")}</span>
          </div>
          {r.postUrl ? <a className="btn sm primary" href={r.postUrl} target="_blank" rel="noreferrer" onClick={(e) => openPost(r, e)}>Open post<ArrowUpRight size={14} /></a> : <span className="muted">No link added</span>}
        </div>
      )}
      {editing ? null : ask === "revise" && task ? (
        <form className="revise" onSubmit={(e) => { e.preventDefault(); if ((!note.trim() && !revFiles.length) || uploading) return; setAsk(null); void prepare(task.id, 3, note, revFiles); setNote(""); setRevFiles([]); toast("Preparing again with your revision note"); }}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addRevFiles(e.dataTransfer.files); }}>
          <textarea autoFocus rows={3} value={note} onChange={(e) => setNote(e.target.value)} onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void addRevFiles(e.clipboardData.files); } }} placeholder="What should change? E.g. a shorter hook, drop the second scene, end with the game link. You can attach images or video." />
          {revFiles.length > 0 && (
            <ul className="revfiles">
              {revFiles.map((f) => (
                <li key={f.file}>
                  {f.kind === "video" ? <video src={`/media/${f.file}`} muted /> : <img src={`/media/${f.file}`} alt="" />}
                  <button type="button" aria-label={`Remove attachment ${f.name}`} onClick={() => setRevFiles((x) => x.filter((y) => y.file !== f.file))}><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="bmbtns">
            <label className="btn sm ghost revattach"><Paperclip size={14} />{uploading ? "Uploading…" : "Add image / video"}<input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void addRevFiles(e.currentTarget.files); e.currentTarget.value = ""; }} /></label>
            <button type="button" className="btn sm ghost" onClick={() => (setAsk(null), setRevFiles([]))}>Cancel</button>
            <button className="btn sm primary" disabled={(!note.trim() && !revFiles.length) || uploading}>Prepare again with changes</button>
          </div>
        </form>
      ) : ask === "posted" ? (
        <form className="revise" onSubmit={(e) => { e.preventDefault(); setAsk(null); markPosted(link.trim() || undefined); setLink(""); }}>
          <input autoFocus className="input" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Post link (optional), e.g. https://instagram.com/p/…" />
          <div className="bmbtns">
            <button type="button" className="btn sm ghost" onClick={() => setAsk(null)}>Cancel</button>
            <button className="btn sm primary">Mark as shared</button>
          </div>
        </form>
      ) : ask === "del" ? (
        <div className="delconfirm" role="alertdialog" aria-label="Delete output">
          <b>Delete this output?</b>
          <p>{task && task.status !== "done" ? "The task stays; you can prepare it again." : "The task stays."}</p>
          <div className="bmbtns">
            <button className="btn sm ghost" onClick={() => setAsk(null)}>Cancel</button>
            <button className="btn sm dangerfill" onClick={remove}>Yes, delete</button>
          </div>
        </div>
      ) : ask === "versions" ? (
        <Versions r={r} ctx={ctx} onDone={() => setAsk(null)} />
      ) : ask === "share" ? (
        <div className="delconfirm postconfirm" role="alertdialog" aria-label="Share now">
          <b>{status === "ready" ? "Approve and share right away?" : "Share now?"}</b>
          <p>{sharerName} {sharerName === "You" ? "share" : "shares"} it {accName ? `on ${accName} ` : ""}now{slot ? `; its ${slot} spot on the calendar stays` : ""}. A shared post can't be undone.</p>
          <div className="bmbtns">
            <button className="btn sm ghost" onClick={() => setAsk(null)}>Cancel</button>
            <button className="btn sm primary" onClick={() => (setAsk(null), shareNow(r.id, status === "ready"))}><Send size={14} />Yes, share now</button>
          </div>
        </div>
      ) : ask === "post" && acc ? (
        <div className="delconfirm postconfirm" role="alertdialog" aria-label="Share">
          <b>Share on {accName}?</b>
          <p>Rou checks that the account is signed in in the Playgrounds browser, enters the text{files.length ? " and files" : ""} and shares it. If the account doesn't match, it shares nothing.</p>
          <div className="bmbtns">
            <button className="btn sm ghost" onClick={() => setAsk(null)}>Cancel</button>
            <button className="btn sm primary" onClick={() => (setAsk(null), publish(r.id))}><Send size={14} />Yes, share</button>
          </div>
        </div>
      ) : (status === "ready" || status === "approved" || status === "failed" || status === "posted" || status === "acted") && !publishing && !r.phase && !(r.act?.phase && Date.now() - new Date(r.act.at).getTime() < 60 * 60 * 1000) && (
        <div className={`runact is-${status}`}>
          {/* The main action first; when and who shares next to it; everything else in the ⋯ menu. */}
          {/* An output that fails Rou's own check (score under 8) comes with a revision first; approval is secondary and clearly "anyway". */}
          {status === "ready" && !r.items?.length && !incomplete && <button className={`btn sm ${lowScore ? "" : "primary"}`} onClick={approve}><Check size={14} />{lowScore ? "Approve anyway" : shareable || keepOpen ? "Approve" : "Approve, task done"}</button>}
          {status === "ready" && !r.items?.length && !incomplete && canShareNow && <button className="btn sm" onClick={() => setAsk("share")}><Send size={13} />Approve and share now</button>}
          {status === "approved" && canShareNow && <button className="btn sm primary" onClick={() => setAsk("share")}><Send size={14} />{r.publish?.error ? "Try again" : "Share now"}</button>}
          {status === "approved" && shareable && <button className={`btn sm ${byMe ? "primary" : "ghost"}`} onClick={() => setAsk("posted")}>{byMe ? "I shared it" : "Shared by hand"}</button>}
          {task && whoOf(s, task) === "claude" && (status === "ready" || status === "approved") && <button className={`btn sm ${lowScore && status === "ready" ? "primary" : "ghost"}`} onClick={() => setAsk("revise")}>Request changes</button>}
          {(r.post || postOut) && (status === "ready" || status === "approved") && <button className="btn sm ghost" onClick={() => setEditing(true)}><Pencil size={13} />Edit</button>}
          {whenNote && <span className="rwhen">{whenNote}</span>}
          <details className="rmenu" onClick={(e) => e.stopPropagation()}>
            <summary className="iconbtn" aria-label="More actions" title="More actions"><MoreHorizontal size={16} /></summary>
            <div className="rmenupop" onClick={(e) => ((e.target as Element).closest("button") && (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open"))}>
              {nVersions > 0 && <button onClick={() => setAsk("versions")}><History size={14} />Versions<em>{nVersions}</em></button>}
              {canUnapprove && <button onClick={unapprove}><RotateCcw size={14} />Undo approval</button>}
              {task && status !== "approved" && status !== "posted" && status !== "acted" && <button onClick={() => prepare(task.id)}><RefreshCw size={14} />Prepare again</button>}
              <button onClick={() => askRouAbout({ runId: r.id })}><MessageCircle size={14} />Ask Rou</button>
              {status !== "failed" && r.body && <button onClick={() => navigator.clipboard?.writeText(r.body).then(() => toast("Copied"))}><Copy size={14} />{r.post ? "Copy text" : "Copy"}</button>}
              {status !== "failed" && files.length > 0 && <button onClick={() => download(files, (task?.title ?? r.title).replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase())}><Download size={14} />{r.video ? "Download video" : files.length > 1 ? "Download images" : "Download image"}</button>}
              {status !== "posted" && status !== "acted" && <button className="is-danger" onClick={() => setAsk("del")}><Trash2 size={14} />Delete</button>}
            </div>
          </details>
        </div>
      )}
    </motion.article>
  );
}

// The task's newest output (runs are added at the front). Older drafts of the same task do not count once a newer one exists.
export const isLatest = (s: State, r: Run) => !r.taskId || runOfTask(s.runs, r.taskId) === r;
export const readyRuns = (s: State, lens: string) =>
  s.runs.filter((r) => (r.status === "ready" || (r.status === "working" && !isStale(r))) && isLatest(s, r)).filter((r) => {
    return lens === ALL || s.tasks.find((x) => x.id === r.taskId)?.worldId === lens;
  });

// Future automation tasks on the calendar: faded placeholders on days not yet opened.
export function ghosts(s: State, lens: string, days: string[]) {
  const t = today();
  const out: { a: Automation; day: string; slot: string }[] = [];
  for (const a of s.automations) {
    if (a.status !== "active" || (lens !== ALL && a.worldId !== lens)) continue;
    for (const d of days) {
      if (d < t || (a.horizon && d <= a.horizon) || !repeatsOn(a, d)) continue;
      for (const slot of slotsOf(a)) if (!occurrenceOf(s, a, d, slot)) out.push({ a, day: d, slot });
    }
  }
  return out;
}
