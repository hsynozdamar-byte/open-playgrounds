// A new world: an id from its name and the first unused colour. The app (Rail, Rou) and pg use the same rule.
// Same family as the logo's sphere. The order makes neighbouring worlds differ most: red, blue, cyan, purple,
// amber, pink, teal, coral, indigo, peach, navy, night.
export const SWATCHES = ["#ff2a2a", "#3d5afe", "#22c8e6", "#9a2fe0", "#ffb020", "#e0218a", "#14b8a6", "#ff6b5b", "#5b3df0", "#ff9e80", "#2a2052", "#475569"];
const rnd = () => Math.random().toString(36).slice(2, 8);

export function worldId(s, name) {
  // The id is ASCII: Turkish folding keeps "ACME IT" from becoming "acme ıt" and turns "Çalışma" into "calisma".
  const ascii = { ğ: "g", ü: "u", ş: "s", ı: "i", ö: "o", ç: "c" };
  let id = String(name).toLocaleLowerCase("tr").replace(/[ğüşıöç]/g, (c) => ascii[c]).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || rnd();
  // "all" is the name of the all-worlds view; a world cannot take this id.
  if (id === "all" || s.worlds.some((w) => w.id === id)) id = `${id}-${rnd().slice(0, 3)}`;
  return id;
}

export function newWorld(s, name, description = "", color) {
  const used = s.worlds.map((w) => w.color);
  return { id: worldId(s, name), name: String(name).trim(), color: color || SWATCHES.find((c) => !used.includes(c)) || SWATCHES[0], description };
}

// Moves a project to another world: its tasks, calendar blocks, automations and Notebook notes go with it (its Notes live inside the project).
// If an account the project uses is not in the target world and no other project in the old world uses it, the account moves too.
export function moveProjectTo(s, projectId, worldId) {
  const p = s.projects.find((x) => x.id === projectId);
  const to = s.worlds.find((w) => w.id === worldId);
  if (!p || !to || p.worldId === worldId) return;
  const from = s.worlds.find((w) => w.id === p.worldId);
  p.worldId = worldId;
  const tasks = new Set();
  for (const t of s.tasks) if (t.projectId === projectId) { t.worldId = worldId; tasks.add(t.id); }
  for (const b of s.blocks) if (b.taskId && tasks.has(b.taskId)) b.worldId = worldId;
  for (const a of s.automations) if (a.projectId === projectId) a.worldId = worldId;
  for (const n of s.inbox) if (n.projectId === projectId || (n.taskId && tasks.has(n.taskId))) n.worldId = worldId;
  if (!from) return;
  for (const accId of p.accountIds ?? []) {
    if (to.accounts?.some((a) => a.id === accId)) continue;
    const acc = from.accounts?.find((a) => a.id === accId);
    if (!acc || s.projects.some((x) => x.id !== projectId && x.worldId === from.id && x.accountIds?.includes(accId))) continue;
    from.accounts = from.accounts.filter((a) => a.id !== accId);
    (to.accounts ??= []).push(acc);
  }
}
