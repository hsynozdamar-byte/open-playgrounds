import type { Block, InboxItem, Project, Session, State, Task, World } from "./types";
import { uid } from "./store";
import { addDays, mkTs, today, tsDay } from "./date";

export type Lens = string; // "all" or a world id
export type Mutate = (fn: (s: State) => void) => void;
export type Route = { view: "focus" | "calendar" | "inbox" | "projects" | "posts" | "browser" | "profile"; lens: Lens; project?: string };
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
export const dflt = (lens: Lens, s: State) => (lens === ALL ? s.worlds[0]?.id ?? "ilk" : lens);

export function newTask(worldId: string, title: string, extra: Partial<Task> = {}): Task {
  return { id: uid(), worldId, projectId: null, title, notes: "", status: "todo", day: null, deadline: null, estimate: null, checklist: [], by: "me", createdAt: new Date().toISOString(), ...extra };
}

export function setStatus(t: Task, status: Task["status"]) {
  t.status = status;
  if (status === "done") t.doneAt = new Date().toISOString();
  else delete t.doneAt;
}

const norm = (x: string) => x.toLocaleLowerCase("en-US").replace(/\s+/g, "");
// Full name or abbreviation. Turkish day words still parse, so older notes and agents that write them keep working.
const DAYS: Record<string, number> = {
  monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 0, sun: 0,
  pazartesi: 1, pzt: 1, salı: 2, sali: 2, sal: 2, çarşamba: 3, carsamba: 3, çar: 3, car: 3, perşembe: 4, persembe: 4, per: 4, cuma: 5, cum: 5, cumartesi: 6, cmt: 6, pazar: 0, paz: 0,
};
const TODAY = ["today", "tod", "bugün", "bugun"], TOMORROW = ["tomorrow", "tmr", "yarın", "yarin"], SOMEDAY = ["someday", "tarihsiz"];
const isDayWord = (tok: string) => {
  const w = norm(tok);
  return [...TODAY, ...TOMORROW, ...SOMEDAY].includes(w) || Object.hasOwn(DAYS, w) || /^\d{1,2}[./]\d{1,2}$/.test(w) || /^\d{4}-\d{2}-\d{2}$/.test(w);
};
// A day word: today, tomorrow, someday (no day), a weekday (the next one), DD.MM or DD/MM, or YYYY-MM-DD.
export function parseDay(word: string): string | null | undefined {
  const w = norm(word);
  const t = today();
  if (TODAY.includes(w)) return t;
  if (TOMORROW.includes(w)) return addDays(t, 1);
  if (SOMEDAY.includes(w)) return null;
  if (Object.hasOwn(DAYS, w)) return addDays(t, (DAYS[w] - new Date().getDay() + 7) % 7 || 7);
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
    // "14:00", "14.30" are times; "5.10" (single-digit day, month <= 12) is read as a date.
    const tm = tok.match(/^(\d{1,2})([:.])(\d{2})$/);
    const asDate = tm && tm[2] === "." && tm[1].length === 1 && +tm[3] >= 1 && +tm[3] <= 12;
    if (tm && !asDate && +tm[1] < 24 && +tm[3] < 60) { out.time = +tm[1] * 60 + +tm[3]; continue; }
    const du = tok.match(/^(\d+(?:[.,]\d)?)(m|min|h|dk|sa|s)$/i);
    if (du) { out.estimate = Math.round(parseFloat(du[1].replace(",", ".")) * (["m", "min", "dk"].includes(du[2].toLowerCase()) ? 1 : 60)); continue; }
    if (isDayWord(tok)) {
      const d = parseDay(tok);
      if (d !== undefined) { out.day = d; continue; }
    }
    words.push(tok);
  }
  if (projectWord) {
    // Rou sometimes writes the project by its id (+nepe1u): the id matches too, and no empty project named after the id is created (2026-11-07).
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
  // The page's project only applies in the same world (if @otherworld was typed, the project is dropped).
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

export const SOURCE_LABEL: Record<string, string> = { gmail: "Gmail", slack: "Slack", clickup: "ClickUp", calendar: "Calendar", other: "Source", note: "Note", mail: "Mail", claude: "Claude" };
export const STATUS_LABEL: Record<Task["status"], string> = { todo: "To do", doing: "In progress", waiting: "Waiting", done: "Done" };
export const PSTATUS_LABEL: Record<Project["status"], string> = { active: "Active", paused: "Paused", done: "Done" };

// Finds the first free slot on the calendar for a task (from 09:00, 15 min steps).
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

// Late: the deadline has passed, or the planned day has passed and the task is not done.
export const lateKind = (t: Task, now = today()): "deadline" | "day" | null =>
  t.status === "done" ? null : t.deadline && t.deadline < now ? "deadline" : t.day && t.day < now ? "day" : null;
