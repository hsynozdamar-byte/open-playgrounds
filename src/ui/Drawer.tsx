import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { State, Task } from "../types";
import { type Ctx, STATUS_LABEL, blocksOf, byLabel, freeSlot, projectOf, secsOf, sessionsOf, setStatus, worldOf } from "../lib";
import { addDays, ago, dayLong, dur, hm, relDay, spanMin, today, iso } from "../date";
import { spent, stop } from "../timer";
import { stable, uid } from "../store";
import { Check, Play } from "./TaskRow";
import { toast } from "./Toast";
import { DatePick } from "./DatePick";
import { binIt } from "../trashOps";
import { ArrowUpRight, CalendarDays, Plus, Check as Check2, ChevronDown, CircleDot, Clock, Flag, Trash2, X } from "lucide-react";
import { Select, projectGroups } from "./Select";
import { TimeField } from "./Fields";

// A new task opens as "New task" so it can be added with details. Cancel deletes it, Add closes the card.
const freshNew = new Set<string>();
export function openNew(ctx: Ctx, id: string) {
  freshNew.add(id);
  ctx.open(id);
}

export function Drawer({ task: task0, ctx: real, onClose: close }: { task: Task; ctx: Ctx; onClose: () => void }) {
  const isNew = freshNew.has(task0.id);
  // Edits collect in a draft; Save applies them together.
  const ops = useRef<((st: State) => void)[]>([]);
  const [rev, bump] = useState(0);
  const [leave, setLeave] = useState(false);
  const draft = useMemo(() => {
    if (!ops.current.length) return real.state;
    const st = structuredClone(real.state);
    ops.current.forEach((f) => f(st));
    return st;
  }, [real.state, rev]);
  const ctx: Ctx = { ...real, state: draft, mutate: (fn) => { ops.current.push(stable(fn)); bump((n) => n + 1); } };
  const task = ctx.state.tasks.find((x) => x.id === task0.id) ?? task0;
  // Is there a real difference: the task, its blocks or its sessions differ from before (a choice undone again does not count).
  const slice = (st: State) => JSON.stringify([st.tasks.find((x) => x.id === task0.id), st.blocks.filter((b) => b.taskId === task0.id), st.sessions.filter((x) => x.taskId === task0.id)]);
  const pending = () => {
    if (!ops.current.length) return false;
    const st = structuredClone(real.state);
    ops.current.forEach((f) => f(st));
    return slice(st) !== slice(real.state);
  };
  const dirty = ops.current.length > 0 && slice(draft) !== slice(real.state);
  const commit = () => {
    const list = ops.current;
    if (!list.length) return;
    ops.current = [];
    real.mutate((st) => list.forEach((f) => f(st)));
    bump((n) => n + 1);
  };
  const onClose = () => (freshNew.delete(task0.id), close());
  // Closing with unsaved changes asks first (a field being typed in reaches the draft on blur).
  const tryClose = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    if (pending()) setLeave(true);
    else (ops.current = [], onClose());
  };
  const save = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    const changed = pending();
    commit();
    setLeave(false);
    onClose();
    toast(isNew ? "Task added" : changed ? "Saved" : "No changes");
  };
  const discard = () => {
    real.mutate((st) => {
      st.tasks = st.tasks.filter((x) => x.id !== task.id);
      st.blocks = st.blocks.filter((b) => b.taskId !== task.id);
    });
    onClose();
  };
  const s = ctx.state;
  // A typed field only reaches the draft on blur; while its value differs from where it started, the save button shows.
  const edited = useRef(new Set<Element>());
  const [typed, setTyped] = useState(false);
  const track = (el: EventTarget, on: boolean) => {
    if (!(el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "checkbox"))) return;
    if (on && el.value !== el.defaultValue) edited.current.add(el); else edited.current.delete(el);
    setTyped(edited.current.size > 0);
  };
  const changed = dirty || typed;
  const set = (fn: (t: Task) => void) => ctx.mutate((st) => { const x = st.tasks.find((y) => y.id === task.id); if (x) fn(x); });
  const w = worldOf(s, task.worldId);
  const p = projectOf(s, task.projectId);
  const blocks = blocksOf(s, task.id);
  const sessions = sessionsOf(s, task.id);
  const sec = secsOf(s, task.id);
  const t = today();
  const [check, setCheck] = useState("");
  const [ask, setAsk] = useState(false);
  const [askSlot, setAskSlot] = useState<string | null>(null);
  // Editing a time: clicking the chip shows start and end (the day stays).
  const [editSlot, setEditSlot] = useState<{ id: string; a: string; b: string } | null>(null);
  const saveSlot = () => {
    if (!editSlot || !editSlot.a || !editSlot.b || editSlot.b <= editSlot.a) return;
    ctx.mutate((st) => {
      const x = st.blocks.find((y) => y.id === editSlot.id);
      if (x) { x.start = `${x.start.slice(0, 11)}${editSlot.a}`; x.end = `${x.start.slice(0, 11)}${editSlot.b}`; }
    });
    setEditSlot(null);
  };
  const [manual, setManual] = useState<{ day: string; a: string; b: string } | null>(null);
  const setDay = (v: string | null) => set((x) => (x.day = v));

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key !== "Escape") return; if (leave) setLeave(false); else tryClose(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  return (
    <>
      <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={tryClose} />
      <motion.aside
        className="drawer"
        onInput={(e) => track(e.target, true)}
        onBlur={(e) => track(e.target, false)}
        style={{ ["--w" as string]: w.color }}
        initial={{ scale: 0.96, y: 8, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 8, opacity: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 38 }}
      >
        <header className="dhead">
          <ProjectPick task={task} ctx={ctx} />
          <button className="iconbtn" title="Go to project" aria-label="Go to project" onClick={() => (commit(), ctx.go({ view: "projects", lens: w.id, project: p?.id ?? `none:${w.id}` }), onClose())}><ArrowUpRight size={16} /></button>
          <button className="x" onClick={tryClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="dtitle">
          <Check task={task} mutate={ctx.mutate} size={24} running={s.timer?.taskId === task.id} />
          <textarea key={task.id} className="titlein" rows={1} autoFocus={isNew} onFocus={(e) => isNew && e.target.select()} defaultValue={task.title} onBlur={(e) => {
            const v = e.target.value.trim();
            if (v && v !== task.title) set((x) => (x.title = v));
          }} />
        </div>

        <div className="brief">
          <textarea key={`n-${task.id}`} rows={3} defaultValue={task.notes} aria-label="Notes" placeholder="Details, links, notes" onBlur={(e) => e.target.value !== task.notes && set((x) => (x.notes = e.target.value))} />
          {task.source?.url && <a className="srclink" href={task.source.url} target="_blank" rel="noreferrer">Open source ({task.source.type})</a>}
        </div>

        <section className="dsec"><div className="dsechead"><span className="flabel">Details</span>{!isNew && task.status !== "done" && <span className="whoplay" onClickCapture={commit}><Play task={task} ctx={real} label /></span>}</div><dl className="props dprops">
          <div className="dgroup">
          <div>
            <dt><CalendarDays size={15} />Day</dt>
            <dd className="chips">
              {[{ l: "Today", v: t }, { l: "Tomorrow", v: addDays(t, 1) }, { l: "Someday", v: null }].map((o) => (
                <button key={o.l} className={task.day === o.v ? "on" : ""} onClick={() => setDay(o.v)}>{o.l}</button>
              ))}
              <DatePick value={task.day && task.day !== t && task.day !== addDays(t, 1) ? task.day : ""} onChange={(v) => v && setDay(v)} label="Day" placeholder="Pick a day" clearable={false} />
            </dd>
          </div>
          <div>
            <dt><Clock size={15} />Time</dt>
            <dd className="slots">
              {blocks.map((b) => (
                editSlot?.id === b.id ? (
                  <span key={b.id} className="slot is-edit" onKeyDown={(e) => { if (e.key === "Enter") saveSlot(); if (e.key === "Escape") { e.stopPropagation(); setEditSlot(null); } }}>
                    <TimeField autoFocus value={editSlot.a} onChange={(v) => setEditSlot((x) => x && { ...x, a: v })} label="Start" />
                    –
                    <TimeField value={editSlot.b} onChange={(v) => setEditSlot((x) => x && { ...x, b: v })} label="End" />
                    <button onClick={saveSlot} disabled={!editSlot.a || !editSlot.b || editSlot.b <= editSlot.a} aria-label="Save time" title="Save"><Check2 size={14} /></button>
                    <button onClick={() => setEditSlot(null)} aria-label="Cancel" title="Cancel"><X size={13} /></button>
                  </span>
                ) : (
                <span key={b.id} className={`slot ${askSlot === b.id ? "is-ask" : ""}`} title={dur(spanMin(b.start, b.end))}>
                  {b.start.slice(0, 10) !== task.day && <em>{relDay(b.start.slice(0, 10))}</em>}
                  <button className="slottime" onClick={() => (setAskSlot(null), setEditSlot({ id: b.id, a: hm(b.start), b: hm(b.end) }))} aria-label={`Edit time: ${hm(b.start)}–${hm(b.end)}`} title="Edit time">{hm(b.start)}–{hm(b.end)}</button>
                  {askSlot !== b.id && <button onClick={() => setAskSlot(b.id)} aria-label="Remove from calendar" title="Remove from calendar"><X size={13} /></button>}
                </span>
                )
              ))}
              {askSlot && blocks.some((b) => b.id === askSlot) && (
                <div className="slotask">
                  <span>Remove this time from the calendar? The task stays.</span>
                  <button className="btn sm ghost" onClick={() => setAskSlot(null)}>Cancel</button>
                  <button className="btn sm dangerfill" onClick={() => (ctx.mutate((st) => void (st.blocks = st.blocks.filter((x) => x.id !== askSlot))), setAskSlot(null))}>Remove</button>
                </div>
              )}
              <button
                className="slotadd"
                onClick={() => ctx.mutate((st) => {
                  const day = task.day && task.day >= t ? task.day : t;
                  const [a, b] = freeSlot(st, day, task.estimate ?? 60);
                  st.blocks.push({ id: uid(), taskId: task.id, worldId: task.worldId, title: "", start: a, end: b, kind: "plan" });
                  const x = st.tasks.find((y) => y.id === task.id);
                  if (x && !x.day) x.day = day;
                })}
              >
                + Add time
              </button>
            </dd>
          </div>
          <div>
            <dt><Flag size={15} />Deadline</dt>
            <dd className="chips">
              <DatePick value={task.deadline ?? ""} onChange={(v) => set((x) => (x.deadline = v || null))} label="Deadline" placeholder="No deadline" />
            </dd>
          </div>
          </div>
          {!isNew && (
          <div className="dgroup">
          <div>
            <dt><CircleDot size={15} />Status</dt>
            <dd className="chips stchips">
              {(["todo", "doing", "waiting", "done"] as const).map((st) => (
                <button key={st} className={`${task.status === st ? "on" : ""} st-${st}`} onClick={() => {
                  // Choosing Done while the timer runs on this task saves the time and stops it.
                  if (st === "done" && s.timer?.taskId === task.id) stop(ctx.mutate, true);
                  else set((x) => setStatus(x, st));
                }}>{STATUS_LABEL[st]}</button>
              ))}
            </dd>
          </div>
          </div>
          )}
        </dl></section>

        <Section title="Subtasks" meta={task.checklist.length ? `${task.checklist.filter((c) => c.done).length}/${task.checklist.length}` : ""}>
          <ul className="checks">
            {task.checklist.map((c) => (
              <li key={c.id} className={c.done ? "done" : ""}>
                <button className="box" onClick={() => set((x) => { const y = x.checklist.find((z) => z.id === c.id); if (y) y.done = !y.done; })} aria-label={c.done ? "Mark not done" : "Mark done"}>{c.done && <Check2 size={11} strokeWidth={3} />}</button>
                <input defaultValue={c.text} aria-label="Subtask" onBlur={(e) => set((x) => { const y = x.checklist.find((z) => z.id === c.id); if (y) y.text = e.target.value; })} />
                <button className="rm" onClick={() => set((x) => void (x.checklist = x.checklist.filter((z) => z.id !== c.id)))} aria-label="Delete subtask"><X size={14} /></button>
              </li>
            ))}
          </ul>
          <form className="checkadd" onSubmit={(e) => { e.preventDefault(); if (!check.trim()) return; set((x) => void x.checklist.push({ id: uid(), text: check.trim(), done: false })); setCheck(""); }}>
            <Plus size={15} aria-hidden />
            <input value={check} onChange={(e) => setCheck(e.target.value)} placeholder="Add a subtask" aria-label="Add a subtask" />
          </form>
        </Section>

        {!isNew && <Section title={`Focus sessions${sessions.length ? ` (${sessions.length})` : ""}`} meta={sec ? spent(sec) : ""} fold>
          <ul className="lines">
            {sessions.map((x) => {
              const a = new Date(x.start), b = new Date(x.end);
              const f = (d: Date) => d.toTimeString().slice(0, 5);
              return (
                <li key={x.id}>
                  <span>{dayLong(iso(a)) === dayLong(today()) ? "today" : ago(x.start)}</span>
                  <b>{f(a)}–{f(b)}</b>
                  <em>{x.mode === "pomo" ? "pomodoro" : x.mode === "manual" ? "manual" : spent((b.getTime() - a.getTime()) / 1000)}</em>
                  <button className="rm" onClick={() => ctx.mutate((st) => void (st.sessions = st.sessions.filter((y) => y.id !== x.id)))} aria-label="Delete session"><X size={14} /></button>
                </li>
              );
            })}
          </ul>
          {manual ? (
            <form
              className="manual"
              onSubmit={(e) => {
                e.preventDefault();
                const a = new Date(`${manual.day}T${manual.a}`), b = new Date(`${manual.day}T${manual.b}`);
                if (!(b > a)) return;
                ctx.mutate((st) => void st.sessions.push({ id: uid(), taskId: task.id, start: a.toISOString(), end: b.toISOString(), mode: "manual" }));
                setManual(null);
              }}
            >
              <DatePick value={manual.day} onChange={(v) => v && setManual({ ...manual, day: v })} label="Day" clearable={false} />
              <TimeField value={manual.a} onChange={(v) => setManual((x) => x && { ...x, a: v })} label="Start" />
              <span>–</span>
              <TimeField value={manual.b} onChange={(v) => setManual((x) => x && { ...x, b: v })} label="End" />
              <button className="btn sm primary">Add</button>
            </form>
          ) : (
            <button className="linkbtn" onClick={() => setManual({ day: t, a: "09:00", b: "10:00" })}>+ Add time by hand</button>
          )}
        </Section>}

        {ask && (
          <div className="delconfirm" role="alertdialog" aria-label="Delete task" ref={(el) => el?.scrollIntoView({ block: "center", behavior: "smooth" })}>
            <b>Delete “{task.title}”?</b>
            <ul>
              <li>The task leaves the list{blocks.length ? ` and the calendar (${blocks.length} ${blocks.length === 1 ? "time" : "times"})` : ""}</li>
              {sessions.length > 0 && <li>{sessions.length} focus {sessions.length === 1 ? "session is" : "sessions are"} deleted</li>}
            </ul>
            <p>To take it off the calendar only, press ✕ next to its time above.</p>
            <div className="bmbtns">
              <button className="btn sm ghost" onClick={() => setAsk(false)}>Cancel</button>
              <button className="btn sm dangerfill" onClick={() => {
              // The task goes with its blocks and sessions; the toast can bring them back.
              const recs = { tasks: [task], blocks: s.blocks.filter((x) => x.taskId === task.id), sessions: s.sessions.filter((x) => x.taskId === task.id) };
              ops.current = [];
              binIt(real, "task", task.title, recs, (st) => {
                st.tasks = st.tasks.filter((x) => x.id !== task.id);
                st.blocks = st.blocks.filter((x) => x.taskId !== task.id);
                st.sessions = st.sessions.filter((x) => x.taskId !== task.id);
                if (st.timer?.taskId === task.id) st.timer = null;
              }, `“${task.title}” deleted`);
              onClose();
            }}>Delete</button>
            </div>
          </div>
        )}
        {!isNew && (
          <footer className="dfoot">
            <span className="muted">Added by {byLabel(task.by).replace(/^You$/, "you")} · {ago(task.createdAt)}</span>
            <button className="dsdel" onClick={() => setAsk(true)}>
              <Trash2 size={14} />Delete task
            </button>
            {changed && (
              <button className="btn sm primary dsave" onClick={save}>
                <Check2 size={14} />Save changes
              </button>
            )}
          </footer>
        )}
        {isNew && (
          <footer className="dfoot">
            <button className="btn sm ghost dnewno" onClick={() => { ops.current = []; discard(); }}>Cancel</button>
            <button className="btn sm primary dsave" onClick={save}><Check2 size={14} />Add</button>
          </footer>
        )}
      </motion.aside>
      {leave && (
        <div className="leavescrim" onMouseDown={() => setLeave(false)}>
          <div className="leavebox" role="alertdialog" aria-modal="true" aria-labelledby="leave-t" onMouseDown={(e) => e.stopPropagation()}>
            <b id="leave-t">You have unsaved changes</b>
            <p>{isNew ? "If you close now, the task is not added." : "If you close now, these changes are lost."}</p>
            <div>
              <button className="btn sm ghost" onClick={() => { ops.current = []; setLeave(false); if (isNew) discard(); else onClose(); }}>Close anyway</button>
              <button className="btn sm primary" autoFocus onClick={save}>{isNew ? "Add" : "Save changes"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({ title, meta, fold, children }: { title: string; meta?: string; fold?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!fold);
  return (
    <section className="dsec">
      {fold ? (
        <button className="dsechead is-fold" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="flabel">{title}</span>
          <span className="dsecend">{meta && <span className="muted">{meta}</span>}<ChevronDown size={15} className={open ? "is-open" : ""} /></span>
        </button>
      ) : (
        <div className="dsechead"><span className="flabel">{title}</span>{meta && <span className="muted">{meta}</span>}</div>
      )}
      {open && children}
    </section>
  );
}

// Project picker at the top: world › project. Picking one moves the task (and its blocks) there.
function ProjectPick({ task, ctx }: { task: Task; ctx: Ctx }) {
  const s = ctx.state;
  const w = worldOf(s, task.worldId);
  const p = projectOf(s, task.projectId);
  return (
    <Select className="ppick" style={{ ["--w" as string]: w.color }} title="Change project" label="Project"
      value={task.projectId ?? `none:${task.worldId}`}
      groups={projectGroups(s, task.projectId)}
      onChange={(v) => {
        ctx.mutate((st) => {
          const x = st.tasks.find((y) => y.id === task.id);
          if (!x) return;
          if (v.startsWith("none:")) { x.worldId = v.slice(5); x.projectId = null; }
          else { const pr = st.projects.find((y) => y.id === v); if (pr) { x.worldId = pr.worldId; x.projectId = pr.id; } }
          st.blocks.forEach((b) => b.taskId === x.id && (b.worldId = x.worldId));
        });
      }}>
      <i />{w.name}<span className="sep">›</span><b>{p ? p.name : "No project"}</b>
    </Select>
  );
}
