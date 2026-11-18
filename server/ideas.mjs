// Content ideas: post ideas for an automation drawn from current events (trend, why now, source).
// Rou produces them with web search.
// Result automation.ideas = { at, items: [{ title, brief, why, trend?, url? }], error? }; while running { phase }. Nothing is shared.
import { read, update } from "./store.mjs";
import { runClaude } from "./claude.mjs";

const busy = new Set();
const json = (out) => { const m = String(out ?? "").match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const FORMAT = '{"title": "topic, at most 70 characters", "brief": "what it will cover, 1-2 sentences", "why": "why now / why it works, 1 sentence", "trend": "the current event it rests on, or empty", "url": "source, or empty"}';

// Ideas from Rou's output: only known fields, limited length, http(s) source, at most 8.
export const cleanIdeas = (items) => (Array.isArray(items) ? items : [])
  .filter((x) => x && typeof x === "object" && String(x.title ?? "").trim())
  .slice(0, 8)
  .map((x) => ({ title: String(x.title).trim().slice(0, 120), brief: String(x.brief ?? "").slice(0, 400), why: String(x.why ?? "").slice(0, 300), trend: String(x.trend ?? "").slice(0, 200), url: /^https?:\/\//.test(String(x.url ?? "")) ? String(x.url).slice(0, 500) : "" }));

const set = (autoId, v) => update((st) => { const x = st.automations.find((y) => y.id === autoId); if (x) x.ideas = v; });

// What the ideas are searched for: the start of Rou's prompt.
export function ideasBrief(s, a) {
  const p = s.projects.find((x) => x.id === a.projectId);
  const recent = s.runs.filter((r) => s.tasks.find((t) => t.id === r.taskId)?.autoId === a.id).slice(0, 10).map((r) => `- ${r.title}: ${(r.body ?? "").split("\n").find((l) => l.trim())?.slice(0, 120) ?? ""}`);
  const planned = Object.values(a.topics ?? {}).map((t) => `- ${t.title}`).slice(0, 14);
  return [
    `Content ideas for the user's "${a.title}" automation${p ? ` (project: ${p.name}${p.description ? `, ${p.description}` : ""})` : ""}.`,
    `The automation's instruction: ${a.action || "(none)"}`,
    p?.brand?.audience ? `Audience: ${p.brand.audience}` : "",
    recent.length ? `Recent posts (do not repeat):\n${recent.join("\n")}` : "",
    planned.length ? `Topics already planned (do not repeat):\n${planned.join("\n")}` : "",
    "Come up with 6 post ideas that fit this account. Make each idea concrete: what it will cover and why it works now. If there is a trend or news item, give its source; if not, do not invent one, leave url empty. Write briefly, in the language of the account's posts.",
  ].filter(Boolean).join("\n\n");
}

export function postIdeas(autoId) {
  const { state: s } = read();
  const a = s.automations.find((x) => x.id === autoId);
  if (!a) return { ok: false, error: "No such automation" };
  if (busy.has(autoId)) return { ok: false, error: "Ideas are already being prepared" };
  const prev = a.ideas;
  const started = new Date().toISOString();
  const brief = ideasBrief(s, a);

  busy.add(autoId);
  set(autoId, { ...(prev ?? {}), at: prev?.at ?? started, error: undefined, phase: "Rou is scanning the news" });
  const prompt = [
    brief,
    "Use WebSearch to look for the latest news in this field, the topics being discussed and trending formats.",
    `Write ONLY this JSON: {"items": [${FORMAT}]}`,
  ].join("\n\n");
  const done = runClaude(prompt, 6 * 60 * 1000, undefined, { args: ["--allowedTools", "WebSearch,WebFetch"] }).then((r) => {
    busy.delete(autoId);
    const items = cleanIdeas(r.ok ? json(r.out)?.items : null);
    const at = new Date().toISOString();
    if (!items.length) return set(autoId, { ...(prev ?? {}), at: prev?.at ?? at, phase: undefined, error: String(r.error || "No ideas came out").slice(0, 300) });
    set(autoId, { at, items });
  });
  return { ok: true, by: "claude", done };
}
