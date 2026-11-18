// Several Rous: state.rous { id, name, color, persona }. The default Rou ("rou") always exists; the outside proposal channel (pg propose) is its.
// Chats are kept apart in state.chat[rouId]. Memory: a record without rouId is shared (every Rou knows it), one with rouId belongs to that Rou.
export const DEFAULT_ROU = "rou";
export const ROU_COLORS = ["", "#3d5afe", "#14b8a6", "#ff6b5b", "#e0218a", "#9a2fe0", "#22c8e6", "#ffb020"];
const base = () => ({ id: DEFAULT_ROU, name: "Rou", color: "", persona: "" });

export const rousOf = (s) => (s.rous?.length ? s.rous : [base()]);
export const rouOf = (s, id) => rousOf(s).find((r) => r.id === id) ?? rousOf(s).find((r) => r.id === DEFAULT_ROU) ?? base();

// Old single-Rou data: without rous the default is added, a flat chat list becomes the default Rou's chat.
export function migrateRous(s) {
  let changed = false;
  if (!s.rous?.some((r) => r.id === DEFAULT_ROU)) {
    s.rous = [base(), ...(s.rous ?? [])];
    changed = true;
  }
  if (Array.isArray(s.chat)) {
    s.chat = { [DEFAULT_ROU]: s.chat };
    changed = true;
  }
  return changed;
}

export const chatOf = (s, id) => (Array.isArray(s.chat) ? (id === DEFAULT_ROU ? s.chat : []) : (s.chat?.[id] ?? []));
// Changes one Rou's chat (the last 60 messages are kept).
export function setChat(s, id, fn) {
  if (!s.chat || Array.isArray(s.chat)) s.chat = { [DEFAULT_ROU]: Array.isArray(s.chat) ? s.chat : [] };
  s.chat[id] = fn(s.chat[id] ?? []).slice(-60);
}

// The memory a Rou sees: shared + its own. Without rouId only the shared one.
export const memoryOf = (s, rouId) => (s.memory ?? []).filter((m) => !m.rouId || (rouId && m.rouId === rouId));

let n = 0;
export function newRou(name, color = "", persona = "") {
  const id = `rou-${Date.now().toString(36)}${(n++).toString(36)}`;
  return { id, name: name.trim().slice(0, 40) || "Rou", color, persona: persona.trim().slice(0, 2000) };
}
