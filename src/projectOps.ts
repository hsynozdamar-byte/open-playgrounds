import type { State } from "./types";
import { commit as commitTimer } from "./timer";

// Deleting a project takes its tasks, blocks and focus sessions with it. Undo puts them all back.
export function takeProject(s: State, id: string) {
  const tasks = new Set(s.tasks.filter((t) => t.projectId === id).map((t) => t.id));
  return {
    index: s.projects.findIndex((p) => p.id === id),
    project: s.projects.find((p) => p.id === id)!,
    tasks: s.tasks.filter((t) => tasks.has(t.id)),
    blocks: s.blocks.filter((b) => b.taskId && tasks.has(b.taskId)),
    sessions: s.sessions.filter((x) => tasks.has(x.taskId)),
  };
}

export function removeProject(s: State, id: string) {
  const snap = takeProject(s, id);
  const drop = <T,>(list: T[], gone: T[]) => list.filter((x) => !gone.includes(x));
  s.projects = s.projects.filter((p) => p.id !== id);
  s.tasks = drop(s.tasks, snap.tasks);
  s.blocks = drop(s.blocks, snap.blocks);
  s.sessions = drop(s.sessions, snap.sessions);
  if (s.timer && snap.tasks.some((t) => t.id === s.timer!.taskId)) { commitTimer(s); s.timer = null; }
  for (const n of s.inbox) if (n.suggestion?.projectId === id) n.suggestion.projectId = null;
}

export function restoreProject(s: State, snap: ReturnType<typeof takeProject>) {
  if (s.projects.some((p) => p.id === snap.project.id)) return;
  s.projects.splice(Math.max(0, snap.index), 0, snap.project);
  s.tasks.push(...snap.tasks);
  s.blocks.push(...snap.blocks);
  s.sessions.push(...snap.sessions);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export function projectStats(s: State, id: string) {
  const p = takeProject(s, id);
  const parts = [
    p.tasks.length && plural(p.tasks.length, "task", "tasks"),
    p.sessions.length && plural(p.sessions.length, "focus session", "focus sessions"),
  ].filter(Boolean);
  return parts.length ? `Everything inside goes too: ${parts.join(", ")}. You can undo right after.` : "There is nothing inside.";
}

// Moves a project to another world; its tasks and calendar blocks go with it.
export function moveProject(s: State, id: string, worldId: string) {
  const p = s.projects.find((x) => x.id === id);
  if (!p || !s.worlds.some((w) => w.id === worldId)) return;
  p.worldId = worldId;
  const tasks = new Set<string>();
  for (const t of s.tasks) if (t.projectId === id) { t.worldId = worldId; tasks.add(t.id); }
  for (const b of s.blocks) if (b.taskId && tasks.has(b.taskId)) b.worldId = worldId;
}
