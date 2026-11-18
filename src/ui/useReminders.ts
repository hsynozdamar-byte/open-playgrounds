import { useEffect, useRef } from "react";
import type { Ctx } from "../lib";
import type { State } from "../types";
import { blockTitle } from "../lib";
import { addDays, hm, localTs, today } from "../date";
import { chime, notify, startTask } from "../timer";
import { toast } from "./Toast";
import { useNow } from "./useNow";

// Reminders (while the app is open): when a calendar task's time comes, and on the first open of the day the tasks due today.
// Reminded items are kept in this browser; the same one does not show again after a page reload.
const KEY = "pg-reminded";
const LATE_MIN = 10; // no longer reminded once more than 10 minutes late

function seen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
}
// The key is "b:DAY:block" or "d:DAY"; only those from yesterday on are kept.
function remember(keys: Set<string>) {
  const from = addDays(today(), -1);
  const keep = [...keys].filter((k) => k.split(":")[1] >= from);
  try { localStorage.setItem(KEY, JSON.stringify(keep)); } catch { /* none */ }
}

// Blocks that should start now: the start has passed but is within LATE_MIN, the task is not done, and it is not on the timer.
export function dueBlocks(s: State, now = new Date()) {
  const cur = localTs(now);
  const from = localTs(new Date(now.getTime() - LATE_MIN * 60000));
  return s.blocks.filter((b) => {
    if (!b.taskId || b.start > cur || b.start < from) return false;
    const t = s.tasks.find((x) => x.id === b.taskId);
    if (!t || t.status === "done" || s.timer?.taskId === t.id) return false;
    return true;
  });
}

export function useReminders(ctx: Ctx) {
  const minute = useNow(true, 30000);
  const s = ctx.state;
  const c = useRef(ctx);
  c.current = ctx;
  useEffect(() => {
    const ctx = c.current;
    const done = seen();
    let changed = false;
    // There is only one notice slot: a task whose time has come is more urgent, so it is shown last.
    const t = today();
    const k = `d:${t}`;
    if (!done.has(k)) {
      const due = s.tasks.filter((x) => x.deadline === t && x.status !== "done");
      done.add(k);
      changed = true;
      if (due.length) toast(due.length === 1 ? `Deadline today: ${due[0].title}` : `${due.length} tasks have a deadline today`, () => (due.length === 1 ? ctx.open(due[0].id) : ctx.go({ view: "focus" })), "Show");
    }
    for (const b of dueBlocks(s)) {
      const k = `b:${b.start.slice(0, 10)}:${b.id}`;
      if (done.has(k)) continue;
      done.add(k);
      changed = true;
      const title = blockTitle(s, b);
      chime();
      notify(`${hm(b.start)} · ${title}`, "Time to start.");
      toast(`${hm(b.start)} · ${title} is starting`, () => startTask(ctx.mutate, b.taskId!), "Start");
    }
    if (changed) remember(done);
  }, [s, minute]);
}
