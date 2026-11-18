import type { Automation, Brand, NoteCategory, ProjectStatus, State } from "../types";
import { type Ctx, newTask, setStatus, worldOf } from "../lib";
import { mkTs, relDay, today } from "../date";
import { revert, stable, uid } from "../store";
import { guideOf } from "../../shared/guide.mjs";
import { setDay } from "../../shared/repeat.mjs";
import { newWorld } from "../../shared/world.mjs";
import { copyPost, movePost } from "../../shared/revise.mjs";
import { missingImage, platformName } from "../../shared/social.mjs";
import { outputOf, stagesOf } from "../../shared/stages.mjs";
import { pause, resume, start, startTask, stop } from "../timer";
import { toast } from "./Toast";
import { openAutoForm } from "./AutoForm";

// An action Rou proposes. The server passes the raw object from the model; here the ids are checked against the data.
export type RouAction =
  | { type: "start"; taskId: string; minutes?: number | null }
  | { type: "pause" } | { type: "resume" } | { type: "stop" }
  | { type: "add_task"; title: string; worldId: string; projectId?: string | null; day?: string | null; at?: string | null; minutes?: number | null; ref?: string }
  | { type: "add_project"; name: string; worldId: string; deadline?: string | null; description?: string; ref?: string }
  | { type: "edit_task"; taskId: string; title?: string; deadline?: string | null; projectId?: string | null; notes?: string; steps?: string[]; minutes?: number | null }
  | { type: "edit_project"; projectId: string; name?: string; description?: string; deadline?: string | null; ongoing?: boolean; status?: ProjectStatus; brand?: Partial<Brand> }
  | { type: "edit_auto"; autoId: string; title?: string; action?: string; days?: number[]; times?: string[]; who?: Automation["who"]; status?: Automation["status"]; visual?: string }
  | { type: "schedule"; taskId: string; day: string; at: string; minutes?: number | null }
  | { type: "note_place"; noteId: string; worldId?: string | null; projectId?: string | null }
  | { type: "note_task"; noteId: string; title?: string; worldId?: string | null; projectId?: string | null; day?: string | null; at?: string | null; minutes?: number | null; ref?: string }
  | { type: "note_attach"; noteId: string; taskId: string; as?: "notes" | "steps" }
  | { type: "note_edit"; noteId: string; title?: string; body?: string; category?: NoteCategory }
  | { type: "note_archive"; noteId: string }
  | { type: "plan"; title: string; steps: RouAction[] }
  | { type: "move"; taskId: string; day: string | null }
  | { type: "done"; taskId: string }
  | { type: "note"; title: string; body?: string; worldId?: string | null }
  | { type: "add_world"; name: string; description?: string }
  | { type: "approve"; runId: string }
  | { type: "auto"; text: string; worldId?: string | null }
  | { type: "prepare"; taskId: string }
  | { type: "share"; runId: string }
  | { type: "revise"; runId: string; note: string; worldId?: string | null; projectId?: string | null; accountId?: string | null }
  | { type: "set_text"; runId: string; text: string }
  | { type: "copy_post"; runId: string; accountId: string; day?: string | null; at?: string | null; ref?: string }
  | { type: "set_example"; projectId: string; text: string }
  | { type: "set_guide"; text: string; mode?: "prepend" | "replace" }
  | { type: "remember"; text: string; shared?: boolean }
  | { type: "forget"; memId: string }
  | { type: "change"; text: string; files?: string[] | null }
  | { type: "undo_change"; changeId: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const AT = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (n: unknown) => (typeof n === "number" && n >= 5 && n <= 240 ? Math.round(n) : null);
const dayText = (d: string | null | undefined) => (d ? relDay(d) : "someday");

// Text shown on the card. Null if invalid: no card.
// Does the task stay open after approval: a post to be shared (finishes when shared) or a single task given to Rou (Rou continues).
function approveKeepsOpen(s: State, r: State["runs"][number]) {
  const t = s.tasks.find((x) => x.id === r.taskId);
  const auto = t?.autoId ? s.automations.find((x) => x.id === t.autoId) : undefined;
  return !!r.post || (!!auto && ["post", "video"].includes(outputOf(s, auto))) || (!!t && !auto && t.who === "claude");
}

export function describe(a: RouAction, s: State): { verb: string; what: string; detail?: string } | null {
  const task = "taskId" in a ? s.tasks.find((x) => x.id === a.taskId) : undefined;
  const note = "noteId" in a ? s.inbox.find((x) => x.id === a.noteId) : undefined;
  switch (a.type) {
    case "start": {
      if (!task || task.status === "done") return null;
      const m = mins(a.minutes);
      return { verb: "Start", what: task.title, detail: m ? `${m} min pomodoro` : "Open-ended" };
    }
    case "pause":
      return s.timer && !s.timer.pausedAt ? { verb: "Pause", what: s.tasks.find((x) => x.id === s.timer!.taskId)?.title ?? "Timer" } : null;
    case "resume":
      return s.timer?.pausedAt ? { verb: "Resume", what: s.tasks.find((x) => x.id === s.timer!.taskId)?.title ?? "Timer" } : null;
    case "stop":
      return s.timer ? { verb: "Stop and save", what: s.tasks.find((x) => x.id === s.timer!.taskId)?.title ?? "Timer" } : null;
    case "add_task": {
      if (typeof a.title !== "string" || !a.title.trim() || !s.worlds.some((w) => w.id === a.worldId)) return null;
      if (a.projectId && !s.projects.some((p) => p.id === a.projectId && p.worldId === a.worldId)) return null;
      if (a.day && !DAY.test(a.day)) return null;
      const p = a.projectId ? s.projects.find((x) => x.id === a.projectId)?.name : null;
      const at = a.day && a.at && AT.test(a.at) ? ` ${a.at}` : "";
      return { verb: "Add task", what: a.title.trim(), detail: [worldOf(s, a.worldId).name, p, `${dayText(a.day)}${at}`].filter(Boolean).join(" · ") };
    }
    case "move":
      if (!task || (a.day !== null && !DAY.test(a.day))) return null;
      return { verb: "Move", what: task.title, detail: `${dayText(task.day)} → ${dayText(a.day)}` };
    case "done":
      return task && task.status !== "done" ? { verb: "Mark done", what: task.title } : null;
    case "note":
      if (typeof a.title !== "string" || !a.title.trim() || (a.worldId && !s.worlds.some((w) => w.id === a.worldId))) return null;
      return { verb: "Note to Notebook", what: a.title.trim(), detail: a.worldId ? worldOf(s, a.worldId).name : undefined };
    case "add_world":
      if (typeof a.name !== "string" || !a.name.trim() || s.worlds.some((w) => w.name.toLocaleLowerCase() === a.name.trim().toLocaleLowerCase())) return null;
      return { verb: "New world", what: a.name.trim(), detail: a.description?.trim() || undefined };
    case "approve": {
      const r = s.runs.find((x) => x.id === a.runId && x.status === "ready");
      // Where the card's Approve is hidden it cannot be approved from the chat either: revision requested, waiting for a choice, voice/video/image missing.
      if (!r || r.items?.length || missingImage(r)) return null;
      const t = s.tasks.find((x) => x.id === r.taskId);
      const auto = t?.autoId ? s.automations.find((x) => x.id === t.autoId) : undefined;
      if (auto && t && ["voice", "video"].includes(stagesOf(s, auto, t, r).current ?? "")) return null;
      return { verb: "Approve", what: t?.title ?? r.title, detail: approveKeepsOpen(s, r) ? "Output is approved; the share step continues" : "Output is approved, the task is done" };
    }
    // Share: Rou shares the post on its own account; on X it can be a reply or quote to a tweet in the text (server/publish.mjs).
    case "share": {
      const r = s.runs.find((x) => x.id === a.runId && (x.status === "ready" || x.status === "approved"));
      return r ? { verb: "Share", what: s.tasks.find((x) => x.id === r.taskId)?.title ?? r.title, detail: r.status === "ready" ? "Approved and shared on its account" : "Shared on its account" } : null;
    }
    case "auto":
      if (typeof a.text !== "string" || !a.text.trim()) return null;
      return { verb: "Set up automation", what: a.text.trim(), detail: `${a.worldId && s.worlds.some((w) => w.id === a.worldId) ? `${worldOf(s, a.worldId).name} · ` : ""}The form opens filled in, you save it` };
    // Revision: if the user objected to an output in the chat the note is written to the task's revision history and Rou prepares again.
    case "revise": {
      const run = s.runs.find((x) => x.id === a.runId);
      const t = run && s.tasks.find((x) => x.id === run.taskId);
      if (!run || !t || !a.note?.trim() || run.status === "posted" || s.runs.some((x) => x.taskId === t.id && x.status === "working")) return null;
      // Move: the target is checked against the data (on a copy); an invalid id drops the card.
      if (a.worldId || a.projectId || a.accountId) {
        const mv = movePost(structuredClone(s), structuredClone(t), { worldId: a.worldId ?? undefined, projectId: a.projectId ?? undefined, accountId: a.accountId ?? undefined });
        if (!mv || "error" in mv) return null;
        const acc = s.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === mv.to.accountId);
        const where = [worldOf(s, mv.to.worldId).name, s.projects.find((p) => p.id === mv.to.projectId)?.name, acc ? `${platformName(acc)} ${acc.name}` : null].filter(Boolean).join(" · ");
        return { verb: "Move and revise", what: t.title, detail: `${where}${t.autoId ? " · leaves the automation, becomes a one-off post" : ""}. ${a.note.trim().slice(0, 140)}` };
      }
      return { verb: "Revise", what: t.title, detail: a.note.trim().slice(0, 160) };
    }
    // Copy post: the output will also be shared on another account. It opens as a copy post task (task.post) and waits in Waiting for approval.
    case "copy_post": {
      if ((a.day && !DAY.test(a.day)) || (a.at && !AT.test(a.at))) return null;
      const r = copyPost(structuredClone(s), a.runId, a.accountId, { day: a.day ?? undefined, at: a.at ?? undefined, ids: { taskId: "x", runId: "y" } });
      if ("error" in r) return null;
      const acc = s.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === a.accountId)!;
      return { verb: "Copy post", what: r.task.title, detail: [`${platformName(acc)} ${acc.name || acc.handle || ""}`.trim(), worldOf(s, r.task.worldId).name, `${dayText(r.task.day)}${r.task.post?.at ? ` ${r.task.post.at}` : ""}`, "same text and media, waits for your approval"].join(" · ") };
    }
    // The final text the user gave: written into the output word for word (images stay as they are).
    case "set_text": {
      const run = s.runs.find((x) => x.id === a.runId);
      const t = run && s.tasks.find((x) => x.id === run.taskId);
      // The text of a shared or being-prepared output is not changed.
      if (!run || !["ready", "approved", "failed"].includes(run.status) || typeof a.text !== "string" || !a.text.trim()) return null;
      return { verb: "Set text", what: t?.title ?? run.title, detail: `${a.text.trim().slice(0, 140)}… Word for word; images stay the same` };
    }
    case "set_example": {
      const p = s.projects.find((x) => x.id === a.projectId);
      if (!p || typeof a.text !== "string" || !a.text.trim()) return null;
      return { verb: "Make approved example", what: p.name, detail: `${a.text.trim().slice(0, 120)}… Every draft in the project aims for this voice` };
    }
    case "set_guide":
      if (typeof a.text !== "string" || a.text.trim().length < 40) return null;
      return { verb: "Change writing guide", what: a.text.trim().split("\n")[0].slice(0, 80), detail: `${a.mode === "replace" ? "Replaces the old guide" : "Goes on top, the old guide stays below"}. Rou writes every draft with it` };
    case "prepare": {
      const auto = s.automations.find((x) => x.id === task?.autoId);
      if (!task || task.status === "done" || auto?.who !== "claude") return null;
      if (s.runs.some((r) => r.taskId === task.id && (r.status === "working" || r.status === "ready"))) return null;
      return { verb: "Prepare", what: task.title, detail: auto.browser ? `In ${auto.browser.name}, only reads and makes suggestions` : "Claude prepares, you approve" };
    }
    case "remember":
      if (typeof a.text !== "string" || !a.text.trim()) return null;
      return { verb: "Remember", what: a.text.trim(), detail: a.shared === false ? "Only this Rou knows" : "Every Rou knows" };
    case "forget": {
      const m = s.memory?.find((x) => x.id === a.memId);
      return m ? { verb: "Forget", what: m.text } : null;
    }
    case "change":
      if (typeof a.text !== "string" || !a.text.trim()) return null;
      return { verb: "Let Rou do it", what: a.text.trim(), detail: `${a.files?.length ? `With ${a.files.length} attachment${a.files.length === 1 ? "" : "s"}. ` : ""}Code, system or data may change; code is checked and rolled back if it breaks` };
    case "undo_change": {
      const c = s.changes?.find((x) => x.id === a.changeId && !x.undone);
      return c ? { verb: "Undo", what: c.text, detail: "The app goes back to how it was before this change" } : null;
    }
    case "add_project": {
      if (typeof a.name !== "string" || !a.name.trim() || !s.worlds.some((w) => w.id === a.worldId)) return null;
      if (a.deadline && !DAY.test(a.deadline)) return null;
      if (s.projects.some((p) => p.worldId === a.worldId && p.name.toLocaleLowerCase() === a.name.trim().toLocaleLowerCase())) return null;
      return { verb: "New project", what: a.name.trim(), detail: [worldOf(s, a.worldId).name, a.deadline ? `deadline ${relDay(a.deadline)}` : ""].filter(Boolean).join(" · ") };
    }
    case "edit_task": {
      if (!task) return null;
      const parts: string[] = [];
      if (typeof a.title === "string" && a.title.trim() && a.title.trim() !== task.title) parts.push(`name: ${a.title.trim()}`);
      if (a.deadline !== undefined) {
        if (a.deadline !== null && !DAY.test(a.deadline)) return null;
        parts.push(a.deadline ? `deadline ${relDay(a.deadline)}` : "no deadline");
      }
      if (a.projectId !== undefined) {
        const p = a.projectId ? s.projects.find((x) => x.id === a.projectId) : null;
        if (a.projectId && !p) return null;
        parts.push(p ? `project: ${worldOf(s, p.worldId).name} › ${p.name}` : "no project");
      }
      if (mins(a.minutes)) parts.push(`estimate ${mins(a.minutes)} min`);
      if (typeof a.notes === "string" && a.notes.trim()) parts.push("adds to notes");
      const steps = cleanSteps(a.steps);
      if (steps.length) parts.push(`${steps.length} subtask${steps.length === 1 ? "" : "s"}: ${steps.slice(0, 3).join(", ")}${steps.length > 3 ? "…" : ""}`);
      return parts.length ? { verb: "Edit", what: task.title, detail: parts.join(" · ") } : null;
    }
    case "schedule":
      if (!task || task.status === "done" || !DAY.test(a.day) || !AT.test(a.at)) return null;
      return { verb: "Put on calendar", what: task.title, detail: `${relDay(a.day)} ${a.at}, ${mins(a.minutes) ?? task.estimate ?? 60} min` };
    case "note_place": {
      if (!note || note.state !== "new") return null;
      const p = a.projectId ? s.projects.find((x) => x.id === a.projectId) : null;
      if (a.projectId && !p) return null;
      const wid = p ? p.worldId : a.worldId ?? null;
      if (wid && !s.worlds.some((w) => w.id === wid)) return null;
      if (wid === (note.worldId ?? null) && (p?.id ?? null) === (note.projectId ?? null)) return null;
      return { verb: "Place", what: note.title, detail: wid ? [worldOf(s, wid).name, p?.name].filter(Boolean).join(" › ") : "No world" };
    }
    case "note_task": {
      if (!note || note.state !== "new" || note.taskId) return null;
      const p = a.projectId ? s.projects.find((x) => x.id === a.projectId) : null;
      if (a.projectId && !p) return null;
      const wid = p?.worldId ?? a.worldId ?? note.worldId;
      if (!wid || !s.worlds.some((w) => w.id === wid)) return null;
      if (a.day && !DAY.test(a.day)) return null;
      const at = a.day && a.at && AT.test(a.at) ? ` ${a.at}` : "";
      return { verb: "Make a task", what: a.title?.trim() || note.title, detail: [worldOf(s, wid).name, p?.name, `${dayText(a.day)}${at}`].filter(Boolean).join(" · ") };
    }
    case "note_attach":
      if (!note || note.state !== "new" || !task) return null;
      return { verb: a.as === "steps" ? "Make subtasks" : "Add to task", what: note.title, detail: `→ ${task.title}${a.as === "steps" ? `, ${noteSteps(note).length} steps` : ", to the task's notes"}` };
    case "note_edit": {
      if (!note) return null;
      const cat = a.category && CATS.includes(a.category) ? a.category : undefined;
      const title = typeof a.title === "string" && a.title.trim() ? a.title.trim() : undefined;
      const body = typeof a.body === "string" ? a.body.trim() : undefined;
      if (!cat && !title && body === undefined) return null;
      return { verb: "Edit note", what: title ?? note.title, detail: [title && title !== note.title ? `old name: ${note.title}` : "", cat ? CAT_LABEL[cat] : "", body !== undefined ? "text is rewritten" : ""].filter(Boolean).join(" · ") || undefined };
    }
    case "edit_project": {
      const p = s.projects.find((x) => x.id === a.projectId);
      const c = projectChanges(a, p);
      return p && c?.length ? { verb: "Update project", what: p.name, detail: c.join(" · ") } : null;
    }
    case "edit_auto": {
      const x = s.automations.find((y) => y.id === a.autoId);
      const c = autoChanges(a, x);
      return x && c?.length ? { verb: "Update automation", what: x.title, detail: c.join(" · ") } : null;
    }
    case "note_archive":
      return note && note.state === "new" ? { verb: "Archive", what: note.title } : null;
    case "plan": {
      const ok = planSteps(a, s).filter((x) => x.d).length;
      return ok ? { verb: "Batch", what: a.title?.trim() || "Rou's suggestions", detail: `${ok} step${ok === 1 ? "" : "s"}` } : null;
    }
    default:
      return null;
  }
}

const CATS: NoteCategory[] = ["note", "idea", "todo", "link"];
const CAT_LABEL: Record<NoteCategory, string> = { note: "Note", idea: "Idea", todo: "To do", link: "Link" };
const cleanSteps = (l: unknown) => (Array.isArray(l) ? l : []).filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()).slice(0, 20);
// Sub-steps of a note: each line of the body (list markers dropped); without a body the title is one step.
const noteSteps = (n: State["inbox"][number]) => {
  const l = n.body.split("\n").map((x) => x.replace(/^\s*(?:[-*•]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?/, "").trim()).filter(Boolean);
  return l.length ? l : [n.title];
};
// The note's text when it goes to the task's notes: title and body.
const noteText = (n: State["inbox"][number]) => [n.title, n.body].filter(Boolean).join("\n\n");

// In a batch proposal a later step can link to a record opened in an earlier step with "@ref" (e.g. a new project, a task in it).
const REF_KEYS = ["worldId", "projectId", "taskId"] as const;
const resolveRefs = (a: RouAction, refs: Record<string, string>): RouAction => {
  const x = { ...a } as Record<string, unknown>;
  for (const k of REF_KEYS) if (typeof x[k] === "string" && (x[k] as string).startsWith("@")) x[k] = refs[(x[k] as string).slice(1)] ?? "?";
  return x as RouAction;
};
// Steps that can be in a batch: jobs that change data and can be undone. The timer, forms and code changes are proposed alone.
const IN_PLAN = new Set(["copy_post", "set_example", "set_guide", "add_task", "add_project", "edit_task", "edit_project", "edit_auto", "schedule", "move", "done", "note", "note_place", "note_task", "note_attach", "note_edit", "note_archive", "add_world", "approve", "remember", "forget"]);

// The steps of a batch proposal are tried in order on a copy of the data: each step is checked against the result of the previous ones.
// If picked is given only the selected steps count as applied (a task tied to an unselected project also becomes invalid).
export function planSteps(a: Extract<RouAction, { type: "plan" }>, s: State, picked?: Set<number>) {
  const sim = structuredClone(s);
  const refs: Record<string, string> = {};
  const steps = Array.isArray(a.steps) ? a.steps.slice(0, 40) : [];
  return steps.map((raw, i) => {
    const step = raw && typeof raw === "object" && IN_PLAN.has(raw.type) ? resolveRefs(raw, refs) : null;
    const d = step ? describe(step, sim) : null;
    if (step && d && (!picked || picked.has(i))) {
      const id = applyData(step, (fn) => fn(sim), sim);
      if (id && "ref" in raw && typeof raw.ref === "string") refs[raw.ref] = id;
    }
    return { i, step, d };
  });
}

// A task asked for in the chat is done without waiting:
// keeping every task waiting on an Approve card left the request undone. A card stays only for tasks that go outside or
// are hard to reverse: sharing, approving (an approved post is shared at its time), deleting from memory, undo, deleting and rewriting the guide.
const ASK_FIRST = new Set(["share", "approve", "forget", "undo_change"]);
const askFirst = (a: { type: string; mode?: string }) => ASK_FIRST.has(a.type) || (a.type === "set_guide" && a.mode === "replace");
export const runsAtOnce = (a: RouAction): boolean =>
  a.type === "plan" ? !(a.steps as { type: string; mode?: string }[]).some(askFirst) : !askFirst(a as { type: string; mode?: string });

// Applies on approval. Can be undone from the notice (the earlier data is restored).
// rouId: the Rou that made the proposal (its own memory, the chat where the result of the change is written).
// picked: the steps the user selected in a batch proposal.
export function apply(a: RouAction, ctx: Ctx, rouId?: string, picked?: Set<number>) {
  // These do not change data on Rou's behalf: a form opens or preparation starts.
  if (a.type === "auto") return openAutoForm({ text: a.text.trim(), ...(a.worldId && ctx.state.worlds.some((w) => w.id === a.worldId) ? { worldId: a.worldId } : {}) });
  if (a.type === "change" || a.type === "undo_change") {
    const [url, body] = a.type === "change" ? ["/api/change", { text: a.text.trim(), rouId, files: Array.isArray(a.files) ? a.files : [] }] : ["/api/change/undo", { changeId: a.changeId, rouId }];
    void fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }))
      .then((r) => (!r.ok ? toast(r.error ?? "Couldn't start") : r.queued && toast(`Queued (number ${r.queued} in line)`)));
    return;
  }
  if (a.type === "revise") {
    const run = ctx.state.runs.find((x) => x.id === a.runId);
    void fetch("/api/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: run?.taskId, feedback: a.note, rouId, worldId: a.worldId ?? undefined, projectId: a.projectId ?? undefined, accountId: a.accountId ?? undefined }) })
      .then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }))
      .then((r) => toast(r.ok ? (r.queued ? (r.message ?? "Revision queued") : "Revision note saved; I'll show the result in the chat when it's done.") : r.error ?? "Couldn't start"));
    return;
  }
  if (a.type === "set_text") {
    void fetch("/api/run-text", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: a.runId, text: a.text }) })
      .then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }))
      .then((r) => toast(r.ok ? "Text set as is." : r.error ?? "Couldn't do it"));
    return;
  }
  if (a.type === "share") {
    const run = ctx.state.runs.find((x) => x.id === a.runId);
    void fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: a.runId, approve: run?.status === "ready" }) })
      .then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }))
      .then((r) => toast(r.ok ? "Sharing started" : `Couldn't share: ${r.error}`));
    return;
  }
  if (a.type === "prepare") {
    void fetch("/api/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId: a.taskId }) })
      .then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }))
      .then((r) => toast(r.ok ? "Preparing. The output will come in for approval." : r.error ?? "Couldn't start"));
    return;
  }
  const before = structuredClone(ctx.state);
  // The change is applied to both the data and a copy; undo returns only the records Rou touched.
  const after = structuredClone(ctx.state);
  // The copy and the data get the same ids (stable): otherwise "Undo" could not find the added time, note or memory entry and it would stay behind.
  const m: Ctx["mutate"] = (fn) => { const f = stable(fn); f(after); ctx.mutate(f); };
  if (a.type === "plan") {
    const done = planSteps(a, ctx.state, picked).filter((x) => x.d && (!picked || picked.has(x.i)));
    const refs: Record<string, string> = {};
    for (const x of done) {
      const raw = a.steps[x.i];
      const step = resolveRefs(raw, refs);
      if (!describe(step, after)) continue;
      const id = applyData(step, m, after, rouId);
      if (id && "ref" in raw && typeof raw.ref === "string") refs[raw.ref] = id;
    }
    return void toast(`Rou did ${done.length} step${done.length === 1 ? "" : "s"}`, () => ctx.mutate((s) => revert(s, after, before)));
  }
  if (["start", "pause", "resume", "stop"].includes(a.type)) applyTimer(a, m, ctx);
  else applyData(a, m, ctx.state, rouId);
  toast("Rou did it", () => ctx.mutate((s) => revert(s, after, before)));
}

function applyTimer(a: RouAction, m: Ctx["mutate"], ctx: Ctx) {
  switch (a.type) {
    case "start": {
      const len = mins(a.minutes);
      if (len) {
        start(m, a.taskId, "pomo");
        m((s) => void (s.timer && (s.timer.length = len)));
      } else startTask(m, a.taskId);
      break;
    }
    case "pause": pause(m); break;
    case "resume": resume(m); break;
    case "stop": stop(m); break;
  }
}

// Tasks that change data. Returns the id of the opened record (for @ref in a batch proposal). st: the data before the change.
function applyData(a: RouAction, m: Ctx["mutate"], st: State, rouId?: string): string | undefined {
  let made: string | undefined;
  const block = (s: State, taskId: string, worldId: string, day: string, at: string, len: number) => {
    const [h, mm] = at.split(":").map(Number);
    const from = h * 60 + mm;
    s.blocks.push({ id: uid(), taskId, worldId, title: "", start: mkTs(day, from), end: mkTs(day, from + len), kind: "plan" });
  };
  switch (a.type) {
    case "add_task": {
      const len = mins(a.minutes);
      const t = newTask(a.worldId, a.title.trim(), { projectId: a.projectId ?? null, day: a.day ?? null, estimate: len, by: "claude" });
      made = t.id;
      m((s) => {
        s.tasks.push(structuredClone(t));
        if (a.day && a.at && AT.test(a.at)) block(s, t.id, t.worldId, a.day, a.at, len ?? 60);
      });
      break;
    }
    case "copy_post": {
      const ids = { taskId: uid(), runId: uid() };
      made = ids.taskId;
      m((s) => void copyPost(s, a.runId, a.accountId, { day: a.day ?? undefined, at: a.at ?? undefined, ids }));
      break;
    }
    case "add_project": {
      const id = uid();
      made = id;
      m((s) => void s.projects.push({ id, worldId: a.worldId, name: a.name.trim(), description: (a.description ?? "").trim(), status: "active", deadline: a.deadline || null }));
      break;
    }
    case "edit_task": {
      const p = a.projectId ? st.projects.find((x) => x.id === a.projectId) : null;
      const steps = cleanSteps(a.steps);
      m((s) => {
        const t = s.tasks.find((x) => x.id === a.taskId);
        if (!t) return;
        if (typeof a.title === "string" && a.title.trim()) t.title = a.title.trim();
        if (a.deadline !== undefined) t.deadline = a.deadline || null;
        if (mins(a.minutes)) t.estimate = mins(a.minutes);
        if (a.projectId !== undefined) {
          t.projectId = p?.id ?? null;
          // A task moved to a project in another world also moves its world and calendar blocks.
          if (p && p.worldId !== t.worldId) {
            t.worldId = p.worldId;
            for (const b of s.blocks) if (b.taskId === t.id) b.worldId = p.worldId;
          }
        }
        if (typeof a.notes === "string" && a.notes.trim()) t.notes = [t.notes.trim(), a.notes.trim()].filter(Boolean).join("\n\n");
        for (const x of steps) t.checklist.push({ id: uid(), text: x, done: false });
      });
      break;
    }
    case "schedule": {
      const t = st.tasks.find((x) => x.id === a.taskId);
      if (!t) break;
      m((s) => {
        const x = s.tasks.find((y) => y.id === a.taskId);
        if (!x) return;
        if (x.day !== a.day) setDay(s, x, a.day);
        block(s, x.id, x.worldId, a.day, a.at, mins(a.minutes) ?? x.estimate ?? 60);
      });
      break;
    }
    case "move":
      m((s) => {
        const t = s.tasks.find((x) => x.id === a.taskId);
        if (!t) return;
        setDay(s, t, a.day);
      });
      break;
    case "done":
      // If it is a counted task the focus time is saved first.
      if (st.timer?.taskId === a.taskId) { stop(m, true); break; }
      m((s) => {
        const t = s.tasks.find((x) => x.id === a.taskId);
        if (!t) return;
        setStatus(t, "done");
      });
      break;
    case "note":
      m((s) => void s.inbox.unshift({ id: uid(), worldId: a.worldId ?? null, source: "claude", from: "Rou", url: "", title: a.title.trim(), body: (a.body ?? "").trim(), receivedAt: new Date().toISOString(), state: "new" }));
      break;
    case "note_place": {
      const p = a.projectId ? st.projects.find((x) => x.id === a.projectId) : null;
      m((s) => {
        const n = s.inbox.find((x) => x.id === a.noteId);
        if (!n) return;
        n.worldId = p?.worldId ?? a.worldId ?? null;
        if (p) n.projectId = p.id;
        else delete n.projectId;
      });
      break;
    }
    case "note_task": {
      const n = st.inbox.find((x) => x.id === a.noteId);
      if (!n) break;
      const p = a.projectId ? st.projects.find((x) => x.id === a.projectId) : null;
      const wid = (p?.worldId ?? a.worldId ?? n.worldId)!;
      const title = a.title?.trim() || n.title;
      const len = mins(a.minutes);
      const t = newTask(wid, title, { projectId: p?.id ?? null, day: a.day ?? null, estimate: len, by: "claude", notes: [title !== n.title ? n.title : "", n.body].filter(Boolean).join("\n\n"), ...(n.url ? { source: { type: n.source, url: n.url } } : {}) });
      made = t.id;
      m((s) => {
        const x = s.inbox.find((y) => y.id === a.noteId);
        if (!x) return;
        s.tasks.push(structuredClone(t));
        if (a.day && a.at && AT.test(a.at)) block(s, t.id, wid, a.day, a.at, len ?? 60);
        x.state = "done";
        x.taskId = t.id;
        x.worldId = wid;
      });
      break;
    }
    case "note_attach": {
      const n = st.inbox.find((x) => x.id === a.noteId);
      if (!n) break;
      m((s) => {
        const t = s.tasks.find((y) => y.id === a.taskId);
        const x = s.inbox.find((y) => y.id === a.noteId);
        if (!t || !x) return;
        if (a.as === "steps") for (const line of noteSteps(n)) t.checklist.push({ id: uid(), text: line, done: false });
        else t.notes = [t.notes.trim(), noteText(n)].filter(Boolean).join("\n\n");
        x.state = "done";
        x.taskId = t.id;
      });
      break;
    }
    case "note_edit":
      m((s) => {
        const n = s.inbox.find((x) => x.id === a.noteId);
        if (!n) return;
        if (typeof a.title === "string" && a.title.trim()) n.title = a.title.trim();
        if (typeof a.body === "string") n.body = a.body.trim();
        if (a.category && CATS.includes(a.category)) n.category = a.category;
      });
      break;
    case "set_example":
      m((s) => {
        const x = s.projects.find((y) => y.id === a.projectId);
        if (x) x.brand = { audience: "", pillars: [], use: "", avoid: "", ...x.brand, example: a.text.trim() };
      });
      break;
    case "set_guide":
      m((s) => {
        const text = a.mode === "replace" ? a.text.trim() : `${a.text.trim()}\n\nDetailed guide (if it conflicts with the above, the above applies):\n\n${guideOf(s)}`;
        s.writingGuide = { text, at: new Date().toISOString() };
      });
      break;
    case "edit_project": {
      const p = st.projects.find((x) => x.id === a.projectId);
      if (!p || !projectChanges(a, p)) break;
      m((s) => {
        const x = s.projects.find((y) => y.id === a.projectId);
        if (!x) return;
        const name = text(a.name), desc = text(a.description);
        if (name) x.name = name;
        if (desc) x.description = desc;
        if (a.deadline !== undefined) { x.deadline = a.deadline || null; if (a.deadline) x.ongoing = false; }
        if (typeof a.ongoing === "boolean") { x.ongoing = a.ongoing; if (a.ongoing) x.deadline = null; }
        if (a.status && STATUS.includes(a.status)) x.status = a.status;
        const b = cleanBrand(a.brand);
        if (b) x.brand = { audience: "", pillars: [], use: "", avoid: "", ...x.brand, ...b };
      });
      break;
    }
    case "edit_auto": {
      if (!autoChanges(a, st.automations.find((x) => x.id === a.autoId))) break;
      m((s) => {
        const x = s.automations.find((y) => y.id === a.autoId);
        if (!x) return;
        const title = text(a.title), action = text(a.action);
        if (title) x.title = title;
        if (action) x.action = action;
        const days = cleanDays(a.days), times = cleanTimes(a.times);
        if (days) x.days = days;
        if (times) x.times = times;
        if (a.who && WHO_AUTO[a.who]) x.who = a.who;
        if (a.status === "active" || a.status === "paused") x.status = a.status;
        const visual = text(a.visual);
        if (visual) x.visual = visual;
      });
      break;
    }
    case "note_archive":
      m((s) => void s.inbox.forEach((n) => n.id === a.noteId && (n.state = "done")));
      break;
    case "add_world": {
      m((s) => {
        const w = newWorld(s, a.name, (a.description ?? "").trim());
        made = w.id;
        s.worlds.push(w);
      });
      break;
    }
    case "remember":
      m((s) => void (s.memory ??= []).push({ id: uid(), text: a.text.trim().slice(0, 300), at: new Date().toISOString(), ...(a.shared === false && rouId ? { rouId } : {}) }));
      break;
    case "forget":
      m((s) => void (s.memory = (s.memory ?? []).filter((x) => x.id !== a.memId)));
      break;
    case "approve":
      // Same as Approve on the card: the approval moment is written (sharing counts its 5-minute undo window and its time from here),
      // the task of a post to be shared stays open. Before, the task became "done" at once and the post was never shared.
      m((s) => {
        const r = s.runs.find((x) => x.id === a.runId);
        if (!r || r.status !== "ready") return;
        const keep = approveKeepsOpen(s, r);
        Object.assign(r, { status: "approved", approvedAt: new Date().toISOString() });
        const t = s.tasks.find((x) => x.id === r.taskId);
        if (t && !keep) setStatus(t, "done");
      });
      break;
  }
  return made;
}

// Project and automation editing: Rou writes lasting decisions given in conversation (tone, rule, rhythm) to the record.
// Text fields (description, instruction, brand) come in their full new form; a field that did not change is not written.
const STATUS: ProjectStatus[] = ["active", "paused", "done"];
const STATUS_TR = { active: "active", paused: "paused", done: "done" };
const WHO_AUTO: Record<string, string> = { me: "You", claude: "Rou" };
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : "");
const short = (v: string) => (v.length > 90 ? `${v.slice(0, 90)}…` : v);
const cleanDays = (v: unknown) => (Array.isArray(v) && v.length && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ? [...new Set(v as number[])].sort() : null);
const cleanTimes = (v: unknown) => (Array.isArray(v) && v.every((t) => typeof t === "string" && AT.test(t)) ? [...new Set(v as string[])].sort() : null);
function cleanBrand(v: unknown): Partial<Brand> | null {
  if (!v || typeof v !== "object") return null;
  const b = v as Record<string, unknown>, out: Partial<Brand> = {};
  for (const k of ["audience", "use", "avoid"] as const) if (typeof b[k] === "string") out[k] = (b[k] as string).trim();
  if (Array.isArray(b.pillars)) out.pillars = b.pillars.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim());
  return Object.keys(out).length ? out : null;
}
function projectChanges(a: Extract<RouAction, { type: "edit_project" }>, p?: State["projects"][number]) {
  if (!p) return null;
  if (a.deadline && !DAY.test(a.deadline)) return null;
  const c: string[] = [];
  const name = text(a.name), desc = text(a.description);
  if (name && name !== p.name) c.push(`name: ${name}`);
  if (desc && desc !== p.description) c.push(`description: ${short(desc)}`);
  if (a.deadline !== undefined && (a.deadline || null) !== p.deadline) c.push(a.deadline ? `deadline ${relDay(a.deadline)}` : "no deadline");
  if (typeof a.ongoing === "boolean" && a.ongoing !== !!p.ongoing) c.push(a.ongoing ? "ongoing project" : "not ongoing");
  if (a.status && STATUS.includes(a.status) && a.status !== p.status) c.push(STATUS_TR[a.status]);
  const b = cleanBrand(a.brand);
  const LB = { audience: "audience", use: "tone / use", avoid: "avoid" } as const;
  if (b) for (const k of ["audience", "use", "avoid"] as const) if (b[k] !== undefined && b[k] !== (p.brand?.[k] ?? "")) c.push(`${LB[k]}: ${short(b[k] || "empty")}`);
  if (b?.pillars && b.pillars.join("|") !== (p.brand?.pillars ?? []).join("|")) c.push(`pillars: ${b.pillars.join(", ") || "empty"}`);
  return c.length ? c : null;
}
function autoChanges(a: Extract<RouAction, { type: "edit_auto" }>, x?: Automation) {
  if (!x) return null;
  const c: string[] = [];
  const title = text(a.title), action = text(a.action);
  if (title && title !== x.title) c.push(`name: ${title}`);
  if (action && action !== x.action) c.push(`instruction: ${short(action)}`);
  const days = cleanDays(a.days), times = cleanTimes(a.times);
  if (days && days.join() !== [...x.days].sort().join()) c.push(`days: ${days.map((d) => WD[d]).join(", ")}`);
  if (times && times.join() !== [...x.times].sort().join()) c.push(`time: ${times.join(", ") || "no time"}`);
  if (a.who && WHO_AUTO[a.who] && a.who !== x.who) c.push(`done by: ${WHO_AUTO[a.who]}`);
  if ((a.status === "active" || a.status === "paused") && a.status !== x.status) c.push(a.status === "active" ? "runs" : "pauses");
  const visual = text(a.visual);
  if (visual && visual !== (x.visual ?? "")) c.push(`visual rule: ${short(visual.split("\n").at(-1) ?? visual)}`);
  return c.length ? c : null;
}
