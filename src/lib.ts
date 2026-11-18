import type { Block, InboxItem, Project, Session, State, Task, World } from "./types";
import { uid } from "./store";
import { addDays, mkTs, today, tsDay } from "./date";

export type Lens = string; // "all" or a world id
export type Mutate = (fn: (s: State) => void) => void;
export type Route = { view: "focus" | "calendar" | "inbox" | "projects" | "profile"; lens: Lens; project?: string };
export type Ctx = { state: State; mutate: Mutate; route: Route; go: (r: Partial<Route>) => void; open: (taskId: string | null) => void };

export const ALL = "all";
export const inLens = (lens: Lens) => (x: { worldId: string | null }) => lens === ALL || x.worldId === lens;
export const worldOf = (s: State, id: string | null): World => s.worlds.find((w) => w.id === id) ?? s.worlds[0];
export const projectOf = (s: State, id: string | null): Project | undefined => (id ? s.projects.find((p) => p.id === id) : undefined);
export const blocksOf = (s: State, taskId: string) => s.blocks.filter((b) => b.taskId === taskId).sort((a, b) => a.start.localeCompare(b.start));
export const sessionsOf = (s: State, taskId: string) => s.sessions.filter((x) => x.taskId === taskId).sort((a, b) => b.start.localeCompare(a.start));
const sumSecs = (list: Session[]) => list.reduce((n, x) => n + Math.max(0, (new Date(x.end).getTime() - new Date(x.start).getTime()) / 1000), 0);
export const secsOf = (s: State, taskId: string) => sumSecs(sessionsOf(s, taskId));
export const blockTitle = (s: State, b: Block) => (b.taskId ? s.tasks.find((t) => t.id === b.taskId)?.title ?? b.title : b.title);
export const dflt = (lens: Lens, s: State) => (lens === ALL ? s.worlds[0]?.id ?? "personal" : lens);

export function newTask(worldId: string, title: string, extra: Partial<Task> = {}): Task {
  return { id: uid(), worldId, projectId: null, title, notes: "", status: "todo", day: null, deadline: null, estimate: null, checklist: [], by: "me", createdAt: new Date().toISOString(), ...extra };
}

export function setStatus(t: Task, status: Task["status"]) {
  t.status = status;
  if (status === "done") t.doneAt = new Date().toISOString();
  else delete t.doneAt;
}

const norm = (x: string) => x.toLowerCase().replace(/\s+/g, "");
const DAYS: Record<string, number> = { monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 0, sun: 0 };
const isDayWord = (tok: string) => {
  const w = norm(tok);
  return ["today", "tod", "tomorrow", "tmr", "someday"].includes(w) || w in DAYS || /^\d{1,2}[./]\d{1,2}$/.test(w) || /^\d{4}-\d{2}-\d{2}$/.test(w);
};
// A day word: today, tomorrow, someday (no day), a weekday (the next one), DD.MM or DD/MM, or YYYY-MM-DD.
export function parseDay(word: string): string | null | undefined {
  const w = norm(word);
  const t = today();
  if (w === "today" || w === "tod") return t;
  if (w === "tomorrow" || w === "tmr") return addDays(t, 1);
  if (w === "someday") return null;
  if (w in DAYS) return addDays(t, (DAYS[w] - new Date().getDay() + 7) % 7 || 7);
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  const m = w.match(/^(\d{1,2})[./](\d{1,2})$/);
  if (m) {
    const y = new Date().getFullYear();
    const cand = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const day = cand < t ? `${y + 1}${cand.slice(4)}` : cand;
    // A day that does not exist (31.02, 3.15) is not a date: the word stays in the title.
    const d = new Date(+day.slice(0, 4), +m[2] - 1, +m[1]);
    return d.getMonth() === +m[2] - 1 && d.getDate() === +m[1] ? day : undefined;
  }
  return undefined;
}

// One line: "Store screenshots @work #launch tomorrow 14:00 1h !fri"
type Parsed = { title: string; worldId: string; projectId: string | null; newProject?: string; day?: string | null; time?: number; estimate?: number; deadline?: string | null };
export function parseQuick(s: State, raw: string, fallbackWorld: string): Parsed {
  const out: Parsed = { title: "", worldId: fallbackWorld, projectId: null };
  const words: string[] = [];
  const toks = raw.trim().split(/\s+/);
  let projectWord: string | null = null;
  for (const tok of toks) {
    if (tok.startsWith("@") && tok.length > 1) {
      const hit = s.worlds.find((w) => norm(w.name).startsWith(norm(tok.slice(1))) || w.id.startsWith(norm(tok.slice(1))));
      if (hit) { out.worldId = hit.id; continue; }
    }
    if (tok.startsWith("#") && tok.length > 1) { projectWord = tok.slice(1); continue; }
    if (tok.startsWith("!") && tok.length > 1) {
      const d = parseDay(tok.slice(1));
      if (d !== undefined) { out.deadline = d; continue; }
    }
    // "14:00" and "14.30" are times; "5.10" (one-digit day, month ≤ 12) is a date.
    const tm = tok.match(/^(\d{1,2})([:.])(\d{2})$/);
    const asDate = tm && tm[2] === "." && tm[1].length === 1 && +tm[3] >= 1 && +tm[3] <= 12;
    if (tm && !asDate && +tm[1] < 24 && +tm[3] < 60) { out.time = +tm[1] * 60 + +tm[3]; continue; }
    const du = tok.match(/^(\d+(?:[.,]\d)?)(m|min|h)$/i);
    if (du) { out.estimate = Math.round(parseFloat(du[1].replace(",", ".")) * (du[2].toLowerCase() === "h" ? 60 : 1)); continue; }
    if (isDayWord(tok)) {
      const d = parseDay(tok);
      if (d !== undefined) { out.day = d; continue; }
    }
    words.push(tok);
  }
  if (projectWord) {
    // A project can also be named by its id (#nepe1u), so no empty project named after an id is created.
    const hit = s.projects.find((p) => p.id === projectWord) ?? s.projects.find((p) => p.worldId === out.worldId && norm(p.name).startsWith(norm(projectWord!)));
    if (hit) out.projectId = hit.id;
    else out.newProject = projectWord;
  }
  out.title = words.join(" ");
  return out;
}

// Applies a parsed line to the state; a time also opens a calendar block.
export function addParsed(s: State, p: Parsed, preset: Partial<Task> = {}) {
  if (!p.title) return null;
  // The page's project only counts when it is in the same world (writing @otherworld drops it).
  const presetProject = preset.projectId && s.projects.find((x) => x.id === preset.projectId)?.worldId === p.worldId ? preset.projectId : null;
  let projectId = p.projectId ?? presetProject;
  if (p.newProject) {
    const pr: Project = { id: uid(), worldId: p.worldId, name: p.newProject, description: "", status: "active", deadline: null };
    s.projects.push(pr);
    projectId = pr.id;
  }
  const day = p.day !== undefined ? p.day : p.time !== undefined ? today() : preset.day ?? null;
  const t = newTask(p.worldId, p.title, { ...preset, worldId: p.worldId, projectId, day, estimate: p.estimate ?? preset.estimate ?? null, deadline: p.deadline ?? preset.deadline ?? null });
  s.tasks.push(t);
  if (p.time !== undefined && day) {
    const len = p.estimate ?? 60;
    s.blocks.push({ id: uid(), taskId: t.id, worldId: t.worldId, title: "", start: mkTs(day, p.time), end: mkTs(day, p.time + len), kind: "plan" });
  }
  return t;
}

export const SOURCE_LABEL: Record<string, string> = { gmail: "Gmail", slack: "Slack", calendar: "Calendar", other: "Source", note: "Note", mail: "Mail", agent: "AI tool" };
export const STATUS_LABEL: Record<Task["status"], string> = { todo: "To do", doing: "Doing", waiting: "Waiting", done: "Done" };
export const PSTATUS_LABEL: Record<Project["status"], string> = { active: "Active", paused: "Paused", done: "Done" };

// First free place for a task on the calendar (from 09:00, 15 min steps).
export function freeSlot(s: State, day: string, len: number) {
  const busy = s.blocks.filter((b) => tsDay(b.start) === day).map((b) => [b.start, b.end]);
  const nowM = day === today() ? Math.ceil((new Date().getHours() * 60 + new Date().getMinutes()) / 15) * 15 : 9 * 60;
  for (let m = Math.max(9 * 60, nowM); m + len <= 23 * 60; m += 15) {
    const a = mkTs(day, m), b = mkTs(day, m + len);
    if (!busy.some(([x, y]) => a < y && b > x)) return [a, b];
  }
  return [mkTs(day, 9 * 60), mkTs(day, 9 * 60 + len)];
}

export const inboxNew = (s: State, lens: Lens) => s.inbox.filter((i: InboxItem) => i.state === "new" && (lens === ALL || i.worldId === lens || i.worldId === null));

// Late: the deadline passed, or the planned day passed and the task is not done.
export const lateKind = (t: Task, now = today()): "deadline" | "day" | null =>
  t.status === "done" ? null : t.deadline && t.deadline < now ? "deadline" : t.day && t.day < now ? "day" : null;

// Who added it, in words: "you", or the tool's name as it wrote it (`pg add --by "Codex"`).
export const byLabel = (by: string) => (!by || by === "me" ? "You" : by);
