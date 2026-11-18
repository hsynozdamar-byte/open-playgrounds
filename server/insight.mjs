// Account analysis: three looks at an Instagram account (profile score, what works, the week's plan). The method is in the KINDS texts below.
// Rou opens the profile IN THE BACKGROUND in the browser of the account's world (rouTab quiet), reads it from a screenshot and the page content,
// and applies the method. It clicks nothing that changes anything, does not sign in, like or message.
// Result account.insights[kind] = { at, score?, summary, items: [{ title, detail }], error? }; while running { phase }.
import { read, update } from "./store.mjs";
import { runClaude } from "./claude.mjs";
import { releaseTab, rouArgs, rouRules, rouTab } from "./pb.mjs";

export const KINDS = {
  profile: {
    label: "Profile score",
    ask: "Score the profile out of 100. Criteria (each weighted): does the name field carry the searched keyword (10), does the bio say in its first line who it serves, what it offers and why to follow (20), are the link and call clear (10), are the highlights organized and named (10), do the pinned posts introduce the account (15), does the grid show a consistent look and recurring series (20), is the posting frequency regular (15). Give the weakest areas first; for each, write a copy-ready rewrite or a concrete fix.",
  },
  audit: {
    label: "What works",
    ask: "Examine the recent posts and the visible numbers (likes, comments, views): which ones beat the account's own average, what they have in common (format, topic, first frame, headline), which ones fell short and why. Write what to repeat, what to drop, and the next three experiments. Do not invent a number you cannot see; use only what is visible on the page.",
  },
  plan: {
    label: "The week's plan",
    ask: "Plan this account's coming week: for each post the day, format (reel, carousel, post, story), topic, opening sentence or first frame, and why that day. Rely on what worked in the account's recent posts and on the project's subject; 3-5 posts a week is enough.",
  },
};
const busy = new Set();
// The first JSON object in the reply.
const json = (out) => { const m = String(out ?? "").match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const HOME = (handle) => `https://www.instagram.com/${String(handle ?? "").replace(/^@/, "").replace(/^.*instagram\.com\//, "").replace(/\/.*$/, "")}/`;

export function accountInsight(accountId, kind) {
  const k = KINDS[kind];
  const { state: s } = read();
  const world = s.worlds.find((w) => w.accounts?.some((a) => a.id === accountId));
  const acc = world?.accounts.find((a) => a.id === accountId);
  if (!k || !acc) return { ok: false, error: "No such account or analysis kind" };
  if (acc.platform !== "instagram") return { ok: false, error: "This analysis is only for Instagram accounts" };
  const key = `${accountId}:${kind}`;
  if (busy.has(key)) return { ok: false, error: "This analysis is already running" };
  busy.add(key);
  const set = (v) => update((st) => { const a = st.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === accountId); if (a) a.insights = { ...(a.insights ?? {}), [kind]: v }; });
  const prev = acc.insights?.[kind];
  set({ ...(prev ?? {}), phase: "Rou is opening the profile", at: prev?.at ?? new Date().toISOString() });
  const project = s.projects.find((p) => p.accountIds?.includes(acc.id));
  const done = (async () => {
    let tab;
    try { tab = await rouTab(world, `insight-${accountId}-${kind}`, `Rou is analyzing · ${k.label}`); }
    catch (e) { return { ok: false, error: e.message }; }
    const prompt = [
      `You are analyzing the user's Instagram account: ${acc.handle || acc.name}${project ? ` (project: ${project.name}${project.description ? `, ${project.description}` : ""})` : ""}.`,
      rouRules(tab, null),
      `In this tab open ${HOME(acc.handle || acc.name)}. Read the page with take_snapshot, scroll down if needed (the first 12 posts at most) and look with take_screenshot. If you need to open a post, open it and then go back.`,
      "Rules: read only. Do not like, comment, follow, message or edit anything; do not sign in; do not open settings. If the session is signed out, stop and write an error.",
      "Gather the data you need from this page yourself; do not ask questions.",
      k.ask,
      "Write short and concrete, in the language the account's posts are in. No invented numbers.",
      'Write ONLY this JSON: {"score": 0-100 or null, "summary": "2-3 sentences", "items": [{"title": "short title", "detail": "what, why, copy-ready suggestion"}], "error": "the reason if it could not be done, or empty"}',
    ].join("\n\n");
    try { return await runClaude(prompt, 8 * 60 * 1000, undefined, { args: rouArgs(null, ["Read"], [], { read: true }) }); }
    finally { releaseTab(tab.targetId); }
  })().then((r) => {
    busy.delete(key);
    const j = r.ok ? json(r.out) : null;
    const at = new Date().toISOString();
    if (!j || j.error) return set({ ...(prev ?? {}), at: prev?.at ?? at, error: String(j?.error || r.error || "Could not read the answer").slice(0, 300), phase: undefined });
    set({ at, score: typeof j.score === "number" ? Math.round(j.score) : null, summary: String(j.summary ?? "").slice(0, 800), items: (Array.isArray(j.items) ? j.items : []).slice(0, 12).map((x) => ({ title: String(x?.title ?? "").slice(0, 160), detail: String(x?.detail ?? "").slice(0, 900) })) });
  });
  return { ok: true, done };
}
