import { useState } from "react";
import type { Automation, Run, Task } from "../types";
import { runOfTask } from "../runs";
import type { Ctx } from "../lib";
import { dropStatus, lastMode, pomoLen } from "../timer";
import { addDays, iso, relDay, today } from "../date";
import { repeatsOn, slotsOf, topicKey } from "../../shared/repeat.mjs";
import { openAutoView } from "./openAuto";

// The project's task board (2026-11-01): Planned · In progress · Done.
// Planned: open tasks and the automations' next 14 days (including times not yet opened, as faded cards), by day.
// In progress: work under way (doing/waiting) or Rou's output being prepared, waiting for approval, to be shared.
// Done: finished or shared in the last 14 days. Dragging a card changes its status; pressing it opens the task (the automation if faded).

type Col = "plan" | "work" | "done";
type Card = { key: string; day: string | null; time: string; title: string; line: string; tone?: "you" | "bad" | "ok" | "ghost" | "late"; task?: Task; auto?: Automation };
const HORIZON = 14;
const COLS: { id: Col; label: string; empty: string }[] = [
  { id: "plan", label: "Planned", empty: "No planned tasks" },
  { id: "work", label: "In progress", empty: "Nothing in progress" },
  { id: "done", label: "Done", empty: "Nothing done in the last 2 weeks" },
];
const STATUS: Record<Col, Task["status"]> = { plan: "todo", work: "doing", done: "done" };

const hm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }) : "");

// manualOnly: automation tasks are not here (they are on the Automations card, AutoRuns).
export function ProjectBoard({ ctx, projectId, manualOnly }: { ctx: Ctx; projectId: string; manualOnly?: boolean }) {
  const s = ctx.state;
  const t0 = today();
  const end = addDays(t0, HORIZON - 1);
  const since = Date.now() - HORIZON * 86400000;
  const [over, setOver] = useState<Col | null>(null);
  const runOf = (t: Task): Run | undefined => runOfTask(s.runs, t.id);
  const timeOf = (t: Task) => t.autoSlot || s.blocks.find((b) => b.taskId === t.id)?.start.slice(11, 16) || "";
  const who = (t: Task) => (t.autoId ? s.automations.find((a) => a.id === t.autoId)?.who : t.who) === "claude" ? "Rou" : "You";

  const cols: Record<Col, Card[]> = { plan: [], work: [], done: [] };
  for (const t of s.tasks.filter((x) => x.projectId === projectId && !(manualOnly && x.autoId))) {
    const r = runOf(t);
    const base = { key: t.id, day: t.day, time: timeOf(t), title: t.topic?.title || t.title, task: t };
    if (t.status === "done" || r?.status === "posted") {
      const at = r?.postedAt ?? t.doneAt ?? (t.day ? `${t.day}T12:00` : "");
      if (!at || new Date(at).getTime() < since) continue;
      cols.done.push({ ...base, day: iso(new Date(at)), time: hm(r?.postedAt ?? t.doneAt), line: r?.status === "posted" ? "Done, shared" : "Done", tone: "ok" });
    } else if (t.status === "doing" || t.status === "waiting" || (r && ["working", "ready", "approved", "failed"].includes(r.status))) {
      const line = r?.status === "working" ? "Rou is preparing" : r?.status === "ready" ? "Awaiting your approval" : r?.status === "approved" ? (r.publish?.phase ?? "To be shared") : r?.status === "failed" ? "Couldn't prepare" : t.status === "waiting" ? "Waiting" : "In progress";
      cols.work.push({ ...base, line, tone: r?.status === "ready" ? "you" : r?.status === "failed" ? "bad" : undefined });
    } else {
      if (t.day && t.day > end) continue;
      const late = !!t.day && t.day < t0;
      cols.plan.push({ ...base, line: `${late ? "Late · " : ""}${t.autoId ? "Automation · " : ""}${who(t) === "Rou" ? "Rou will prepare it" : "You will do it"}`, tone: late ? "late" : undefined });
    }
  }
  // Automation times not yet opened: the scheduler opens them when the day comes; here a faded card.
  for (const a of manualOnly ? [] : s.automations.filter((x) => x.projectId === projectId && x.status === "active")) {
    for (let i = 0; i < HORIZON; i++) {
      const day = addDays(t0, i);
      if (!repeatsOn(a, day)) continue;
      for (const slot of slotsOf(a)) {
        if (s.tasks.some((t) => t.autoId === a.id && (t.autoDay ?? t.day) === day && (t.autoSlot ?? "") === slot)) continue;
        if (day === t0 && a.horizon && a.horizon >= t0) continue;
        cols.plan.push({ key: `g-${a.id}-${day}-${slot}`, day, time: slot, title: a.topics?.[topicKey(day, slot)]?.title || a.title, line: `Automation · ${a.title}`, tone: "ghost", auto: a });
      }
    }
  }
  const byWhen = (x: Card, y: Card) => `${x.day ?? "9999"} ${x.time || "99"}`.localeCompare(`${y.day ?? "9999"} ${y.time || "99"}`);
  cols.plan.sort(byWhen);
  cols.work.sort(byWhen);
  cols.done.sort((x, y) => byWhen(y, x));

  const drop = (col: Col, id: string) => {
    setOver(null);
    const mode = lastMode();
    ctx.mutate((st) => dropStatus(st, id, STATUS[col], mode, pomoLen()));
  };
  const open = (c: Card) => (c.task ? ctx.open(c.task.id) : c.auto && openAutoView(c.auto.id));

  return (
    <div className="pboard">
      {COLS.map((col) => {
        const list = cols[col.id];
        let lastDay: string | null | undefined;
        return (
          <section key={col.id} className={`pbcol ${over === col.id ? "is-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(col.id); }} onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/pg-task"); if (id) drop(col.id, id); }}>
            <h4 className="pbhead">{col.label}<span>{list.length || ""}</span></h4>
            {list.length ? (
              <ol className="pblist">
                {list.map((c) => {
                  const showDay = c.day !== lastDay;
                  lastDay = c.day;
                  return (
                    <li key={c.key}>
                      {showDay && <p className="pbday">{c.day ? relDay(c.day) : "Someday"}</p>}
                      <button className={`pbcard ${c.tone ? `is-${c.tone}` : ""}`} draggable={!!c.task}
                        onDragStart={(e) => { if (c.task) { e.dataTransfer.setData("text/pg-task", c.task.id); e.dataTransfer.effectAllowed = "move"; } }}
                        onClick={() => open(c)}>
                        <b>{c.title}</b>
                        <span>{c.time && <em className="mono">{c.time}</em>}{c.line}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="pbempty">{col.empty}</p>}
          </section>
        );
      })}
    </div>
  );
}
