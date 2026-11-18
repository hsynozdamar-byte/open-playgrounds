import type { State } from "./types";
import { commit as commitTimer } from "./timer";

// Proje silinince işleri, blokları, odak kayıtları, çıktıları ve otomasyonları da gider. Geri al hepsini geri koyar.
export function takeProject(s: State, id: string) {
  const tasks = new Set(s.tasks.filter((t) => t.projectId === id).map((t) => t.id));
  return {
    index: s.projects.findIndex((p) => p.id === id),
    project: s.projects.find((p) => p.id === id)!,
    tasks: s.tasks.filter((t) => tasks.has(t.id)),
    blocks: s.blocks.filter((b) => b.taskId && tasks.has(b.taskId)),
    sessions: s.sessions.filter((x) => tasks.has(x.taskId)),
    automations: s.automations.filter((a) => a.projectId === id),
    runs: s.runs.filter((r) => r.taskId && tasks.has(r.taskId)),
  };
}

export function removeProject(s: State, id: string) {
  const snap = takeProject(s, id);
  const drop = <T,>(list: T[], gone: T[]) => list.filter((x) => !gone.includes(x));
  s.projects = s.projects.filter((p) => p.id !== id);
  s.tasks = drop(s.tasks, snap.tasks);
  s.blocks = drop(s.blocks, snap.blocks);
  s.sessions = drop(s.sessions, snap.sessions);
  s.automations = drop(s.automations, snap.automations);
  s.runs = drop(s.runs, snap.runs);
  if (s.timer && snap.tasks.some((t) => t.id === s.timer!.taskId)) { commitTimer(s); s.timer = null; }
  for (const n of s.inbox) if (n.suggestion?.projectId === id) n.suggestion.projectId = null;
}

export function restoreProject(s: State, snap: ReturnType<typeof takeProject>) {
  if (s.projects.some((p) => p.id === snap.project.id)) return;
  s.projects.splice(Math.max(0, snap.index), 0, snap.project);
  s.tasks.push(...snap.tasks);
  s.blocks.push(...snap.blocks);
  s.sessions.push(...snap.sessions);
  s.automations.push(...snap.automations);
  s.runs.push(...snap.runs);
}

export function projectStats(s: State, id: string) {
  const p = takeProject(s, id);
  const parts = [
    p.tasks.length && `${p.tasks.length} görev`,
    p.automations.length && `${p.automations.length} otomasyon`,
    p.runs.length && `${p.runs.length} çıktı`,
    p.sessions.length && `${p.sessions.length} odak kaydı`,
  ].filter(Boolean);
  return parts.length ? `İçindekiler de silinir: ${parts.join(", ")}. Hemen ardından geri alabilirsin.` : "İçinde hiçbir şey yok.";
}

// Projeyi başka dünyaya taşır: işleri, takvim blokları ve otomasyonları da onunla gider.
export function moveProject(s: State, id: string, worldId: string) {
  const p = s.projects.find((x) => x.id === id);
  if (!p || !s.worlds.some((w) => w.id === worldId)) return;
  p.worldId = worldId;
  const tasks = new Set<string>();
  for (const t of s.tasks) if (t.projectId === id) { t.worldId = worldId; tasks.add(t.id); }
  for (const b of s.blocks) if (b.taskId && tasks.has(b.taskId)) b.worldId = worldId;
  for (const a of s.automations) if (a.projectId === id) a.worldId = worldId;
}
