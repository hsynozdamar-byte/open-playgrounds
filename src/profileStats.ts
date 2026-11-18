import type { State } from "./types";
import { addDays, daysBetween, spanMin, today } from "./date";

// Numbers for the Profile page: focus time over the last N days, finished tasks, streak, on-time finishes,
// day and hour distribution, world and project breakdown, plus a count of everything we have. Pure function, tested.
const localDay = (isoTime: string) => {
  const d = new Date(isoTime);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function profileStats(s: State, days: number, now = today()) {
  const from = addDays(now, -(days - 1));
  const inRange = (d: string) => d >= from && d <= now;
  const task = new Map(s.tasks.map((t) => [t.id, t]));

  const perDay = new Map<string, number>();
  const perHour = Array.from({ length: 24 }, () => 0);
  const perWorld = new Map<string, { min: number; done: number }>();
  const perProject = new Map<string, { min: number; done: number }>();
  const bump = (m: Map<string, { min: number; done: number }>, k: string | null | undefined, min: number, done: number) => {
    if (!k) return;
    const v = m.get(k) ?? { min: 0, done: 0 };
    v.min += min; v.done += done; m.set(k, v);
  };

  let focus = 0;
  for (const x of s.sessions) {
    const d = localDay(x.start);
    if (!inRange(d)) continue;
    const min = Math.max(0, spanMin(x.start, x.end));
    focus += min;
    perDay.set(d, (perDay.get(d) ?? 0) + min);
    perHour[new Date(x.start).getHours()] += min;
    const t = task.get(x.taskId);
    bump(perWorld, t?.worldId, min, 0);
    bump(perProject, t?.projectId, min, 0);
  }

  const done = s.tasks.filter((t) => t.status === "done" && t.doneAt && inRange(localDay(t.doneAt)));
  for (const t of done) { bump(perWorld, t.worldId, 0, 1); bump(perProject, t.projectId, 0, 1); }
  const withDeadline = done.filter((t) => t.deadline);
  const onTime = withDeadline.filter((t) => localDay(t.doneAt!) <= t.deadline!).length;

  // Streak: counting back from today (from yesterday if today is empty), the consecutive days with work done or a task finished.
  const active = new Set<string>([...s.sessions.map((x) => localDay(x.start)), ...s.tasks.filter((t) => t.doneAt).map((t) => localDay(t.doneAt!))]);
  let streak = 0;
  for (let d = active.has(now) ? now : addDays(now, -1); active.has(d); d = addDays(d, -1)) streak++;

  const chart = Array.from({ length: days }, (_, i) => { const d = addDays(from, i); return { day: d, min: perDay.get(d) ?? 0 }; });
  const peak = perHour.reduce((b, v, h) => (v > perHour[b] ? h : b), 0);
  const worlds = s.worlds.map((w) => ({ w, ...(perWorld.get(w.id) ?? { min: 0, done: 0 }), open: s.tasks.filter((t) => t.worldId === w.id && t.status !== "done").length }))
    .sort((a, b) => b.min - a.min || b.done - a.done);
  const projects = s.projects.map((p) => ({ p, ...(perProject.get(p.id) ?? { min: 0, done: 0 }) }))
    .filter((x) => x.min || x.done).sort((a, b) => b.min - a.min || b.done - a.done).slice(0, 6);

  const first = [...s.tasks.map((t) => t.createdAt), ...s.sessions.map((x) => x.start)].filter(Boolean).sort()[0];
  return {
    from, days, focus, done: done.length, streak,
    onTime: withDeadline.length ? Math.round((onTime / withDeadline.length) * 100) : null,
    activeDays: chart.filter((c) => c.min > 0).length,
    chart, perHour, peak: perHour[peak] ? peak : null,
    worlds, projects,
    since: first ? localDay(first) : null,
    sinceDays: first ? daysBetween(localDay(first), now) + 1 : 0,
    own: {
      worlds: s.worlds.length,
      projects: s.projects.filter((p) => p.status !== "done").length,
      open: s.tasks.filter((t) => t.status !== "done").length,
      notes: s.inbox.filter((n) => n.state === "new").length,
    },
  };
}
export type ProfileStats = ReturnType<typeof profileStats>;
