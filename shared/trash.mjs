// Trash: deleted records (and the records that went with them) stay in state.trash for 30 days and can be restored.
// The app and `pg` use the same functions.
export const KEEP_DAYS = 30;
const LISTS = ["worlds", "projects", "tasks", "blocks", "sessions", "inbox", "automations", "runs"];
const DAY_MS = 864e5;

// Puts a record in the trash. recs: { tasks: [...], blocks: [...], ... , account?: { worldId, acc, projectIds }, source?: { projectId, src } }
export function toTrash(s, id, kind, title, recs) {
  const now = Date.now();
  s.trash = [{ id, kind, title, at: new Date(now).toISOString(), recs: structuredClone(recs) }, ...(s.trash ?? [])]
    .filter((b) => now - Date.parse(b.at) < KEEP_DAYS * DAY_MS)
    .slice(0, 300);
}

// What blocks a restore: the name of the world or project it belonged to, if that is gone.
export function blocker(s, b) {
  const r = b.recs;
  const worlds = new Set([...s.worlds.map((w) => w.id), ...(r.worlds ?? []).map((w) => w.id)]);
  const projects = new Set([...s.projects.map((p) => p.id), ...(r.projects ?? []).map((p) => p.id)]);
  const lost = (x) => (x.worldId && !worlds.has(x.worldId)) || (x.projectId && !projects.has(x.projectId));
  const gone = [...(r.projects ?? []), ...(r.tasks ?? []), ...(r.automations ?? []), ...(r.inbox ?? [])].find(lost);
  if (gone) return s.trash?.find((t) => t.recs.worlds?.some((w) => w.id === gone.worldId) || t.recs.projects?.some((p) => p.id === gone.projectId))?.title ?? "its world or project";
  if (r.account && !s.worlds.some((w) => w.id === r.account.worldId)) return "its world";
  if (r.source && !s.projects.some((p) => p.id === r.source.projectId)) return "its project";
  return null;
}

export function restoreTrash(s, id) {
  const b = s.trash?.find((x) => x.id === id);
  if (!b || blocker(s, b)) return false;
  for (const k of LISTS) for (const x of b.recs[k] ?? []) if (!s[k].some((y) => y.id === x.id)) s[k].push(x);
  if (b.recs.account) {
    const { worldId, acc, projectIds = [] } = b.recs.account;
    const w = s.worlds.find((x) => x.id === worldId);
    if (!w.accounts?.some((x) => x.id === acc.id)) (w.accounts ??= []).push(acc);
    for (const p of s.projects) if (projectIds.includes(p.id) && !p.accountIds?.includes(acc.id)) p.accountIds = [...(p.accountIds ?? []), acc.id];
  }
  if (b.recs.source) {
    const p = s.projects.find((x) => x.id === b.recs.source.projectId);
    if (!p.sources?.some((x) => x.id === b.recs.source.src.id)) (p.sources ??= []).unshift(b.recs.source.src);
  }
  s.trash = s.trash.filter((x) => x.id !== id);
  return true;
}

// Delete for good: all of it when no id is given.
export function purgeTrash(s, id) {
  s.trash = id ? (s.trash ?? []).filter((x) => x.id !== id) : [];
}

// What else went with it, for the card. The record itself is not counted: a deleted project says "5 tasks", a lone automation nothing.
export function trashSummary(b) {
  const r = b.recs;
  const own = { world: "worlds", project: "projects", task: "tasks", auto: "automations", run: "runs", note: "inbox" }[b.kind];
  const n = (k, one, many) => { const c = (r[k]?.length ?? 0) - (k === own ? 1 : 0); return c > 0 ? `${c} ${c === 1 ? one : many}` : null; };
  return [n("projects", "project", "projects"), n("tasks", "task", "tasks"), n("automations", "automation", "automations"), n("runs", "output", "outputs"), n("inbox", "note", "notes"), n("sessions", "focus session", "focus sessions")].filter(Boolean).join(", ");
}

// Where it came from, e.g. "Work › Website". Names are looked up in the app first, then in the trash.
export function trashOrigin(s, b) {
  const r = b.recs;
  const all = (k) => [...(s[k] ?? []), ...(s.trash ?? []).flatMap((t) => t.recs[k] ?? [])];
  const name = (k, id) => (id ? all(k).find((x) => x.id === id)?.name ?? all(k).find((x) => x.id === id)?.title : null);
  const path = (worldId, projectId) => [name("worlds", worldId), name("projects", projectId)].filter(Boolean).join(" › ");
  if (b.kind === "project") return path(r.projects?.[0]?.worldId);
  if (b.kind === "task") return path(r.tasks?.[0]?.worldId, r.tasks?.[0]?.projectId);
  if (b.kind === "auto") return path(r.automations?.[0]?.worldId, r.automations?.[0]?.projectId);
  if (b.kind === "note") return path(r.inbox?.[0]?.worldId, r.inbox?.[0]?.suggestion?.projectId);
  if (b.kind === "account") return path(r.account?.worldId);
  if (b.kind === "source") {
    const p = all("projects").find((x) => x.id === r.source?.projectId);
    return p ? path(p.worldId, p.id) : "";
  }
  if (b.kind === "run") {
    const t = all("tasks").find((x) => x.id === r.runs?.[0]?.taskId);
    const a = t?.autoId && all("automations").find((x) => x.id === t.autoId);
    return [t && path(t.worldId, t.projectId), a?.title].filter(Boolean).join(" › ");
  }
  return "";
}
