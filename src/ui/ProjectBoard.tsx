import { useState } from "react";
import type { Task } from "../types";
import { type Ctx, setStatus } from "../lib";
import { addDays, iso, relDay, today } from "../date";

// A project's task board: Planned · In progress · Done.
// Planned: open tasks for the next 14 days (and undated ones), by day. In progress: doing or waiting.
// Done: finished in the last 14 days. Dragging a card changes its status; clicking opens the task.

type Col = "plan" | "work" | "done";
type Card = { key: string; day: string | null; time: string; title: string; line: string; tone?: "ok" | "late"; task: Task };
const HORIZON = 14;
const COLS: { id: Col; label: string; empty: string }[] = [
  { id: "plan", label: "Planned", empty: "Nothing planned" },
  { id: "work", label: "In progress", empty: "Nothing in progress" },
  { id: "done", label: "Done", empty: "Nothing done in the last 2 weeks" },
];
const STATUS: Record<Col, Task["status"]> = { plan: "todo", work: "doing", done: "done" };

const hm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");

export function ProjectBoard({ ctx, projectId }: { ctx: Ctx; projectId: string }) {
  const s = ctx.state;
  const t0 = today();
  const end = addDays(t0, HORIZON - 1);
  const since = Date.now() - HORIZON * 86400000;
  const [over, setOver] = useState<Col | null>(null);
  const timeOf = (t: Task) => s.blocks.find((b) => b.taskId === t.id)?.start.slice(11, 16) || "";

  const cols: Record<Col, Card[]> = { plan: [], work: [], done: [] };
  for (const t of s.tasks.filter((x) => x.projectId === projectId)) {
    const base = { key: t.id, day: t.day, time: timeOf(t), title: t.title, task: t };
    if (t.status === "done") {
      const at = t.doneAt ?? (t.day ? `${t.day}T12:00` : "");
      if (!at || new Date(at).getTime() < since) continue;
      cols.done.push({ ...base, day: iso(new Date(at)), time: hm(t.doneAt), line: "Done", tone: "ok" });
    } else if (t.status === "doing" || t.status === "waiting") {
      cols.work.push({ ...base, line: t.status === "waiting" ? "Waiting" : "Doing" });
    } else {
      if (t.day && t.day > end) continue;
      const late = !!t.day && t.day < t0;
      cols.plan.push({ ...base, line: late ? "Late" : "To do", tone: late ? "late" : undefined });
    }
  }
  const byWhen = (x: Card, y: Card) => `${x.day ?? "9999"} ${x.time || "99"}`.localeCompare(`${y.day ?? "9999"} ${y.time || "99"}`);
  cols.plan.sort(byWhen);
  cols.work.sort(byWhen);
  cols.done.sort((x, y) => byWhen(y, x));

  const drop = (col: Col, id: string) => {
    setOver(null);
    ctx.mutate((st) => { const x = st.tasks.find((t) => t.id === id); if (x && x.status !== STATUS[col]) setStatus(x, STATUS[col]); });
  };

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
                      {showDay && <p className="pbday">{c.day ? relDay(c.day) : "No day"}</p>}
                      <button className={`pbcard ${c.tone ? `is-${c.tone}` : ""}`} draggable
                        onDragStart={(e) => { e.dataTransfer.setData("text/pg-task", c.task.id); e.dataTransfer.effectAllowed = "move"; }}
                        onClick={() => ctx.open(c.task.id)}>
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
