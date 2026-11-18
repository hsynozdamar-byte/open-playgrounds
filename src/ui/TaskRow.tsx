import { AnimatePresence, motion } from "motion/react";
import type { Task } from "../types";
import { runOfTask } from "../runs";
import { type Ctx, type Mutate, blocksOf, lateKind, projectOf, secsOf, sessionsOf, setStatus, worldOf } from "../lib";
import { useState } from "react";
import { daysBetween, dur, hm, iso, localTs, relDay, today } from "../date";

const lateLabel = (day: string, t: string) => { const n = daysBetween(day, t); return n === 1 ? "1 day" : `${n} days`; };
import { clock, elapsed, pause, resume, spent, startTask, stop } from "../timer";
import { useNow } from "./useNow";
import { Check as CheckIcon, ChevronDown, ChevronRight, GripVertical, Pause, Play as PlayIcon, Repeat, Sparkles, Square } from "lucide-react";
import { autoOf, doNow, isStale, whoOf } from "./Auto";
import { whereText } from "./Board";
import { BrandIcon } from "./BrandIcon";
import { OUTPUT_LABEL, outputOf, platformsOf, stagesOf } from "../../shared/stages.mjs";
import { FORMATS, formatOf } from "../../shared/social.mjs";
import { Clapperboard, ClipboardList, FileText, Image as ImageIcon } from "lucide-react";
const OUT_ICON = { text: FileText, post: ImageIcon, video: Clapperboard, report: ClipboardList } as const;
import { scheduleText } from "../../shared/repeat.mjs";
import { toast } from "./Toast";

export function Check({ task, mutate, size = 19, running }: { task: Task; mutate: Mutate; size?: number; running?: boolean }) {
  const done = task.status === "done";
  return (
    <motion.button
      className={`check ${done ? "on" : ""} ${task.status === "doing" ? "doing" : ""} ${task.status === "waiting" ? "waiting" : ""}`}
      style={{ width: size, height: size }}
      aria-label={done ? "Mark not done" : "Mark done"}
      whileTap={{ scale: 0.8 }}
      onClick={(e) => {
        e.stopPropagation();
        // Finishing a running task saves its time as a session.
        const prev = task.status;
        const undo = () => mutate((s) => { const x = s.tasks.find((y) => y.id === task.id); if (x) setStatus(x, prev === "done" ? "todo" : prev); });
        if (!done && running) {
          stop(mutate, true);
          return toast("Task done", undo);
        }
        mutate((s) => {
          const x = s.tasks.find((y) => y.id === task.id);
          if (x) setStatus(x, done ? "todo" : "done");
        });
        if (!done) toast("Task done", undo);
      }}
    >
      {task.status === "waiting" && <svg viewBox="0 0 16 16" className="cwait"><path d="M6.2 5.2v5.6M9.8 5.2v5.6" stroke="var(--w, var(--ink-3))" strokeWidth="1.8" strokeLinecap="round" /></svg>}
      <AnimatePresence>
        {done && (
          <motion.svg viewBox="0 0 16 16" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 600, damping: 22 }}>
            <path d="M4 8.5l2.5 2.5L12 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </motion.svg>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

// Rou's task: no focus timer (you are not doing it). A "do it now" button while there is no output yet or it failed to prepare.
function BotGo({ task, ctx }: { task: Task; ctx: Ctx }) {
  const last = runOfTask(ctx.state.runs, task.id);
  const idle = !last || last.status === "failed" || isStale(last);
  if (task.status === "done" || !idle) return null;
  const who = "Rou";
  return (
    <motion.button className="play botgo" whileTap={{ scale: 0.92 }} title={`Let ${who} do it now`} aria-label={`Let ${who} do it now`}
      onClick={(e) => { e.stopPropagation(); doNow(ctx, task); }}>
      <Sparkles size={14} />
    </motion.button>
  );
}

export function Play({ task, ctx, label }: { task: Task; ctx: Ctx; label?: boolean }) {
  const t = ctx.state.timer;
  const running = t?.taskId === task.id;
  const paused = running && !!t?.pausedAt;
  const now = useNow(running && !paused);
  const over = running && !!t!.length && elapsed(t!, now) >= t!.length * 60;
  if (task.status === "done") return null;
  const btn = (
    <motion.button
      className={`play ${running ? "on" : ""} ${paused ? "is-paused" : ""} ${over ? "is-over" : ""} ${label ? "labeled" : ""}`}
      whileTap={{ scale: 0.92 }}
      title={paused ? "Resume" : running ? "Pause" : "Start"}
      onClick={(e) => {
        e.stopPropagation();
        if (paused) resume(ctx.mutate);
        else if (running) pause(ctx.mutate);
        else startTask(ctx.mutate, task.id);
      }}
    >
      {running ? (
        <>
          {paused ? <PlayIcon size={14} fill="currentColor" strokeWidth={0} /> : <span className="eq"><i /><i /><i /></span>}
          <span className="pc">{(() => {
            const sec = elapsed(t!, now), total = t!.length * 60;
            return !total ? clock(sec) : sec >= total ? `+${clock(sec - total)}` : clock(total - sec);
          })()}</span>
          {label && (paused ? <span>Resume</span> : <><Pause size={14} fill="currentColor" strokeWidth={0} /><span>Pause</span></>)}
        </>
      ) : (
        <>
          <PlayIcon size={label ? 15 : 14} fill="currentColor" strokeWidth={0} />
          {label && <span>Start</span>}
        </>
      )}
    </motion.button>
  );
  if (!running) return btn;
  // While running there are two options: the pill pauses/resumes, the square button is "Finish, save".
  return (
    <span className="playgrp">
      {btn}
      <motion.button
        className={`play stopbtn ${label ? "labeled" : ""}`}
        whileTap={{ scale: 0.92 }}
        title="Stop and save"
        aria-label="Stop and save"
        onClick={(e) => {
          e.stopPropagation();
          stop(ctx.mutate);
        }}
      >
        <Square size={12} fill="currentColor" strokeWidth={0} />
        {label && <span>Stop and save</span>}
      </motion.button>
    </span>
  );
}

type RowOpts = { card?: boolean; world?: boolean; project?: boolean; day?: boolean; grip?: boolean };

export function TaskRow({ task, ctx, o = {} }: { task: Task; ctx: Ctx; o?: RowOpts }) {
  const s = ctx.state;
  const w = worldOf(s, task.worldId);
  const p = o.project ? projectOf(s, task.projectId) : undefined;
  const t = today();
  const blocks = blocksOf(s, task.id).filter((b) => b.start.slice(0, 10) === (task.day ?? t));
  const sec = secsOf(s, task.id);
  const late = task.deadline && task.status !== "done" && task.deadline < t;
  const checks = task.checklist.length;
  const sessions = sessionsOf(s, task.id);
  const [open, setOpen] = useState(task.status === "doing");
  // An automation task run by Rou: the output type's icon instead of a tick; you do not finish it, the steps do.
  const botAuto = (() => { const a = autoOf(ctx.state, task); return a && a.who !== "me" ? a : undefined; })();
  const hasSub = checks > 0 || sessions.length > 0;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ duration: 0.2 }}
      className={`row s-${task.status} ${ctx.state.timer?.taskId === task.id ? "running" : ""}`}
      style={{ ["--w" as string]: w.color }}
      data-task={task.id}
      draggable
      onDragStart={(e) => {
        const ev = e as unknown as React.DragEvent<HTMLElement>;
        ev.dataTransfer.setData("text/pg-task", task.id);
        ev.dataTransfer.effectAllowed = "move";
        ev.currentTarget.classList.add("dragging");
      }}
      onDragEnd={(e) => (e as unknown as React.DragEvent<HTMLElement>).currentTarget.classList.remove("dragging")}
      onClick={() => ctx.open(task.id)}
    >
      {o.grip ? <span className="grip" title="Drag"><GripVertical size={16} /></span>
        : botAuto ? <span className="autotile" title="Automation: Rou prepares it">{(() => { const I = OUT_ICON[outputOf(ctx.state, botAuto)]; return <I size={15} />; })()}</span>
        : <Check task={task} mutate={ctx.mutate} running={ctx.state.timer?.taskId === task.id} />}
      <div className="rbody">
        <span className="rtitle">{task.title}</span>
        <span className="meta">
          {o.card && !botAuto && task.status === "todo" && lateKind(task, t) !== "day" && <span className="st todo">To do</span>}
          {task.status === "doing" && <span className="st doing">In progress</span>}
          {task.status === "waiting" && <span className="st waiting">Waiting</span>}
          {!o.card && !task.autoId && task.who && task.who !== "me" && <span className="st who">Rou does it</span>}
          {!botAuto && lateKind(task, t) === "day" && <span className="st late" title={`Planned for ${relDay(task.day!)}`}>Late · {lateLabel(task.day!, t)}</span>}
          {blocks.map((b) => <span key={b.id} className="tm">{hm(b.start)}–{hm(b.end)}</span>)}
          {task.day && ((o.day && lateKind(task, t) !== "day") || (botAuto && task.day < t)) && <span>{relDay(task.day)}</span>}
          {o.card ? (o.world || p) && <span className="wdp"><i />{o.world && <span>{w.name}</span>}{o.world && p && <em>›</em>}{p && <b>{p.name}</b>}</span> : <>
            {o.world && <span className="wd"><i />{w.name}</span>}
            {p && <span>{p.name}</span>}
          </>}
          {hasSub ? (
            <button className={`subtoggle ${open ? "is-open" : ""}`} onClick={(e) => (e.stopPropagation(), setOpen(!open))} aria-expanded={open}>
              {checks > 0 && <span>☑ {task.checklist.filter((c) => c.done).length}/{checks}</span>}
              {sec > 0 && <span>⏱ {spent(sec)}{task.estimate ? ` / ${dur(task.estimate)}` : ""}</span>}
              {sessions.length > 0 && <b>{sessions.length} {sessions.length === 1 ? "session" : "sessions"}</b>}
              <ChevronDown size={13} />
            </button>
          ) : (
            task.estimate && <span>⏱ {dur(task.estimate)}</span>
          )}
          {task.deadline && <span className={late ? "st late" : "dlm"}>⚑ {late ? `Deadline passed · ${relDay(task.deadline)}` : relDay(task.deadline)}</span>}
          {botAuto && platformsOf(s, botAuto).length > 0 && (() => { const fmt = formatOf(s, botAuto); return <span className="autoplat">{platformsOf(s, botAuto).map((pl) => <BrandIcon key={pl} platform={pl} size={13} />)}{fmt ? FORMATS[fmt]?.short : OUTPUT_LABEL[outputOf(s, botAuto)]}</span>; })()}
          {(() => { const a = autoOf(s, task); return a && a.who === "me" ? <span className="rp" title={`Automation: ${scheduleText(a)}`}><Repeat size={12} />Automation</span> : null; })()}
        </span>
        <AnimatePresence initial={false}>
          {open && hasSub && (
            <motion.div className="subs" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} onClick={(e) => e.stopPropagation()}>
              {checks > 0 && (
                <ul className="subchecks">
                  {task.checklist.map((c) => (
                    <li key={c.id} className={c.done ? "done" : ""}>
                      <button className="box" onClick={() => ctx.mutate((st) => { const y = st.tasks.find((z) => z.id === task.id)?.checklist.find((z) => z.id === c.id); if (y) y.done = !y.done; })} aria-label={c.done ? "Mark not done" : "Mark done"}>
                        {c.done && <CheckIcon size={10} strokeWidth={3} />}
                      </button>
                      <span>{c.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {sessions.length > 0 && (
                <ul className="sublog">
                  {sessions.slice(0, 5).map((x) => (
                    <li key={x.id}>
                      <span>{relDay(iso(new Date(x.start)))}</span>
                      <b>{hm(localTs(new Date(x.start)))}–{hm(localTs(new Date(x.end)))}</b>
                      <em>{x.mode === "pomo" ? "pomodoro · " : x.mode === "manual" ? "elle · " : ""}{spent((new Date(x.end).getTime() - new Date(x.start).getTime()) / 1000)}</em>
                    </li>
                  ))}
                  {sessions.length > 5 && <li className="more"><button onClick={() => ctx.open(task.id)}>+{sessions.length - 5} more</button></li>}
                </ul>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {botAuto && (() => {
        // Automation task: which step it is on and who it waits for. On the right of the row, level with the title; the expand arrow is next to it.
        const run = s.runs.filter((r) => r.taskId === task.id).sort((x, y) => (x.at < y.at ? 1 : -1))[0];
        const st = stagesOf(s, botAuto, task, run);
        const mine = !st.busy && st.steps.find((x) => x.key === st.current)?.who === "You";
        const act = st.current === "approve" && mine;
        return (
          <button className={`autochip rtailchip ${st.finished ? "is-done" : mine ? "is-you" : st.busy ? "is-busy" : ""} ${act ? "is-act" : ""}`} onClick={(e) => (e.stopPropagation(), ctx.open(task.id))} title={`Automation: ${scheduleText(botAuto)}`}>
            {act ? "Needs approval" : whereText(st, run)}
          </button>
        );
      })()}
      {botAuto ? null : whoOf(s, task) !== "me" && ctx.state.timer?.taskId !== task.id ? <BotGo task={task} ctx={ctx} /> : <Play task={task} ctx={ctx} />}
      {o.grip && <span className="ropen" aria-hidden><ChevronRight size={16} /></span>}
    </motion.li>
  );
}

export function TaskList({ tasks, ctx, o, empty }: { tasks: Task[]; ctx: Ctx; o?: RowOpts; empty?: string }) {
  return (
    <ul className="list">
      <AnimatePresence initial={false}>
        {tasks.map((t) => <TaskRow key={t.id} task={t} ctx={ctx} o={o} />)}
      </AnimatePresence>
      {tasks.length === 0 && empty && <li className="empty">{empty}</li>}
    </ul>
  );
}
