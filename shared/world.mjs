// A new world: an id from its name and the first unused color. The app (Rail) and `pg` use the same rule.
// The order keeps neighbouring worlds as different as possible: red, blue, cyan, purple, amber, pink, teal, coral, indigo, peach, navy, slate.
export const SWATCHES = ["#ff2a2a", "#3d5afe", "#22c8e6", "#9a2fe0", "#ffb020", "#e0218a", "#14b8a6", "#ff6b5b", "#5b3df0", "#ff9e80", "#2a2052", "#475569"];
const rnd = () => Math.random().toString(36).slice(2, 8);

export function worldId(s, name) {
  // ASCII ids: accents are dropped ("Café" → "cafe").
  let id = String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || rnd();
  // "all" is the name of the all-worlds view; a world cannot take it.
  if (id === "all" || s.worlds.some((w) => w.id === id)) id = `${id}-${rnd().slice(0, 3)}`;
  return id;
}

export function newWorld(s, name, description = "", color) {
  const used = s.worlds.map((w) => w.color);
  return { id: worldId(s, name), name: String(name).trim(), color: color || SWATCHES.find((c) => !used.includes(c)) || SWATCHES[0], description };
}

// Moves a project to another world: its tasks, calendar blocks and Notebook notes go with it.
export function moveProjectTo(s, projectId, worldId) {
  const p = s.projects.find((x) => x.id === projectId);
  const to = s.worlds.find((w) => w.id === worldId);
  if (!p || !to || p.worldId === worldId) return;
  p.worldId = worldId;
  const tasks = new Set();
  for (const t of s.tasks) if (t.projectId === projectId) { t.worldId = worldId; tasks.add(t.id); }
  for (const b of s.blocks) if (b.taskId && tasks.has(b.taskId)) b.worldId = worldId;
  for (const n of s.inbox) if (n.projectId === projectId || (n.taskId && tasks.has(n.taskId))) n.worldId = worldId;
}
