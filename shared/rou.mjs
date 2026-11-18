// Birden çok Rou: state.rous { id, name, color, persona }. Varsayılan Rou ("rou") hep vardır; dış öneri kanalı (pg propose) onundur.
// Sohbetler state.chat[rouId] içinde ayrı durur. Hafıza: rouId'siz kayıt ortaktır (tüm Rou'lar bilir), rouId'li yalnız o Rou'nundur.
export const DEFAULT_ROU = "rou";
export const ROU_COLORS = ["", "#3d5afe", "#14b8a6", "#ff6b5b", "#e0218a", "#9a2fe0", "#22c8e6", "#ffb020"];
const base = () => ({ id: DEFAULT_ROU, name: "Rou", color: "", persona: "" });

export const rousOf = (s) => (s.rous?.length ? s.rous : [base()]);
export const rouOf = (s, id) => rousOf(s).find((r) => r.id === id) ?? rousOf(s).find((r) => r.id === DEFAULT_ROU) ?? base();

// Eski tek Rou verisi: rous yoksa varsayılan eklenir, düz sohbet listesi varsayılan Rou'nun sohbeti olur.
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
// Bir Rou'nun sohbetini değiştirir (son 60 mesaj kalır).
export function setChat(s, id, fn) {
  if (!s.chat || Array.isArray(s.chat)) s.chat = { [DEFAULT_ROU]: Array.isArray(s.chat) ? s.chat : [] };
  s.chat[id] = fn(s.chat[id] ?? []).slice(-60);
}

// Rou'nun gördüğü hafıza: ortak + kendi. rouId yoksa yalnız ortak.
export const memoryOf = (s, rouId) => (s.memory ?? []).filter((m) => !m.rouId || (rouId && m.rouId === rouId));

let n = 0;
export function newRou(name, color = "", persona = "") {
  const id = `rou-${Date.now().toString(36)}${(n++).toString(36)}`;
  return { id, name: name.trim().slice(0, 40) || "Rou", color, persona: persona.trim().slice(0, 2000) };
}
