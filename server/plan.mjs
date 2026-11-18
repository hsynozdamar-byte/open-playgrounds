// Post topics: Rou proposes topics for an automation's upcoming slots (planTopics) or fills the week (fillTopics).
import { read, update } from "./store.mjs";
import { runClaude } from "./claude.mjs";
import { platformName, accountOf, langRule } from "../shared/social.mjs";
import { brandBlock, sourcesText } from "./prepare.mjs";
import { alwaysMedia, pastLessons, visualRules } from "../shared/revise.mjs";
import { addDirs, workDirs, workHints } from "./findmedia.mjs";
import { nextRun, occurrenceOf, topicKey } from "../shared/repeat.mjs";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (day, n) => { const [y, m, d] = day.split("-").map(Number); return iso(new Date(y, m - 1, d + n)); };
const dayName = (day) => { const [y, m, d] = day.split("-").map(Number); return DAYS[new Date(y, m - 1, d).getDay()]; };

// Topic proposals for an automation's upcoming runs: for each slot a short title + what it will cover.
// It reads the instruction, brand voice, Notes and what was recently posted; it does not repeat. The server does not write data, the app applies it.
// With from/until (YYYY-MM-DD) only the slots in that range; with empty only those without a topic.
export async function planTopics({ autoId, count, from: since, until, empty, note }, signal) {
  const { state: s } = read();
  const a = s.automations.find((x) => x.id === autoId);
  if (!a) return { ok: false, error: "No such automation" };
  const n = Math.max(1, Math.min(14, Number(count) || 6));
  const slots = [];
  const now = new Date();
  let from = since ? new Date(...since.split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0))) : now;
  if (from < now) from = now;
  while (slots.length < n) {
    const r = nextRun(a, from);
    if (!r || (until && r.day >= until)) break;
    const task = occurrenceOf(s, a, r.day, r.slot);
    const topic = task?.topic ?? a.topics?.[topicKey(r.day, r.slot)];
    // A run that has an output is already written; no topic is proposed for it.
    if ((!task || !s.runs.some((x) => x.taskId === task.id)) && !(empty && topic)) slots.push(r);
    const [h, m] = (r.slot || "23:59").split(":").map(Number);
    const [y, mo, d] = r.day.split("-").map(Number);
    from = new Date(y, mo - 1, d, h, m + 1);
  }
  if (!slots.length) return { ok: false, error: "No scheduled slots" };
  const p = s.projects.find((x) => x.id === a.projectId);
  const acc = accountOf(s, a);
  const ids = new Set(s.tasks.filter((t) => t.autoId === a.id).map((t) => t.id));
  const recent = s.runs.filter((r) => r.taskId && ids.has(r.taskId) && r.body).slice(0, 10).map((r) => r.body.split("\n").find((x) => x.trim())?.slice(0, 140)).filter(Boolean);
  const planned = Object.values(a.topics ?? {}).map((t) => t.title);
  // On an account that needs real media in every post, a topic rests on work that really exists on disk or live (source).
  const real = alwaysMedia(visualRules(s, { autoId: a.id, worldId: a.worldId }));
  const dirs = real ? workDirs(s, p) : [];
  const used = real ? [...new Set(s.tasks.filter((t) => t.autoId === a.id).map((t) => t.topic?.source).concat(Object.values(a.topics ?? {}).map((t) => t.source)).filter(Boolean))].slice(-30) : [];
  const prompt = [
    "You are planning the topics of upcoming posts for one of the user's social media automations. For now only the topic: each post will be written separately later.",
    // An instruction from the weekly review: the plan for that period is built by it, and it comes before the other rules.
    note ? `The user's instruction for this period (most important; choose and order the topics by it, do not include a topic they do not want): ${note}` : "",
    `Automation: ${a.title}`,
    acc ? `Account: ${platformName(acc)} ${acc.handle || acc.name}${acc.voice ? ` · Style: ${acc.voice}` : ""}` : "",
    acc ? `Write the topic titles and briefs in the account's language. ${langRule(acc)}` : "",
    p ? `Project: ${p.name}${p.description ? `: ${p.description}` : ""}` : "",
    brandBlock(p),
    sourcesText(p),
    `Instruction (general direction): ${a.action || a.title}`,
    recent.length ? `First lines of what was posted recently (do not repeat):\n${recent.map((x) => `- ${x}`).join("\n")}` : "",
    (() => { const l = pastLessons(s, { id: "", autoId: a.id }, 10); return l.length ? `The user gave these revisions on this automation's posts; do not repeat the same mistake when choosing topics (e.g. a topic they did not want, the wrong focus):\n${l.map((x) => `- ${x}`).join("\n")}` : ""; })(),
    planned.length ? `Topics already planned (do not repeat):\n${planned.map((x) => `- ${x}`).join("\n")}` : "",
    `Slots that need a topic:\n${slots.map((x) => `- ${x.day} ${dayName(x.day)}${x.slot ? ` ${x.slot}` : ""}`).join("\n")}`,
    real ? [
      "Every post on this account will have a real image or video. So every topic must rest on a piece of the user's work that REALLY exists and can be shown. Before choosing topics, look at these with Read, Glob and Grep:",
      workHints(s),
      dirs.length ? `Folders you can read: ${dirs.join(", ")}` : "",
      "For every topic write a source: the address or file path of what the post will show (e.g. https://example.com/work/project or a video file). Put moving work (launch and logo animations, openings, transitions) first. The brief must describe only what is really visible in that source; do not write an event, attempt or decision story that has no evidence (e.g. 'I tried three versions'). Do not use the same source in two topics.",
      used.length ? `Sources used before (do not reuse):\n${used.map((x) => `- ${x}`).join("\n")}` : "",
    ].filter(Boolean).join("\n") : "",
    "Rules: one topic per slot. A topic should be interesting and clear to someone who follows the account: a piece of work, a product or a decision of the user; not infrastructure topics that concern only them and rest on internal tool names (Rou, the automation flow). Topics are concrete and different from each other; spread them across the brand's content pillars if there are any. Do not invent numbers, events, customers or product features you do not know; start from what is in the Notes and the instruction. Do not use em dashes (—).",
    `Write ONLY this JSON: {"items":[{"day":"YYYY-MM-DD","slot":"HH:MM or empty","title":"topic, at most 8 words","brief":"what it will cover, 1-2 sentences"${real ? ',"source":"address or file path of the real work to show"' : ""}}]}`,
  ].filter(Boolean).join("\n\n");
  const r = await runClaude(prompt, (real ? 8 : 3) * 60 * 1000, signal, real ? { args: ["--allowedTools", "Read,Glob,Grep", ...addDirs(dirs)] } : {});
  if (!r.ok) return r;
  let j;
  try { j = JSON.parse(r.out.match(/\{[\s\S]*\}/)?.[0] ?? ""); } catch { return { ok: false, error: "Could not read the topics" }; }
  const clean = (x, n) => String(x || "").replace(/—/g, ",").trim().slice(0, n);
  const items = (Array.isArray(j?.items) ? j.items : []).map((x) => {
    const at = slots.find((y) => y.day === x?.day && (y.slot || "") === (x?.slot || ""));
    return at && x.title ? { day: at.day, slot: at.slot || "", title: clean(x.title, 90), brief: clean(x.brief, 400), ...(real && x.source ? { source: clean(x.source, 300) } : {}) } : null;
  }).filter(Boolean);
  return items.length ? { ok: true, items } : { ok: false, error: "No topics came out" };
}

// The week's topics: Rou fills the empty-topic slots of every automation (written by Rou) in the range and writes them to the data.
// Hand-written topics are not touched. "Plan the week" in the app and the scheduler (every day, the next 7 days) call this.
let filling = false;
export async function fillTopics(opts, signal) {
  if (filling) return { ok: false, error: "Rou is already planning topics" };
  filling = true;
  try { return await fill(opts, signal); } finally { filling = false; }
}
async function fill({ from, until, autoIds, note }, signal) {
  const { state: s } = read();
  const autos = s.automations.filter((a) => a.status === "active" && a.who !== "me" && !a.browser && (!autoIds || autoIds.includes(a.id)));
  let filled = 0;
  const errors = [];
  for (const a of autos) {
    if (signal?.aborted) break;
    // With an instruction, all slots not yet prepared are planned again; without one, only empty topics are filled.
    const r = await planTopics({ autoId: a.id, count: 14, from, until, empty: !note, note }, signal);
    if (!r.ok) { if (r.error !== "No scheduled slots") errors.push(`${a.title}: ${r.error}`); continue; }
    update((st) => {
      const x = st.automations.find((y) => y.id === a.id);
      if (!x) return;
      for (const it of r.items) {
        const t = { title: it.title, brief: it.brief, ...(it.source ? { source: it.source } : {}) };
        const task = occurrenceOf(st, x, it.day, it.slot);
        if (task) { if (!task.topic || note) { task.topic = t; filled++; } continue; }
        x.topics = { ...(x.topics ?? {}) };
        if (!x.topics[topicKey(it.day, it.slot)] || note) { x.topics[topicKey(it.day, it.slot)] = t; filled++; }
      }
    });
  }
  return filled || !errors.length ? { ok: true, filled, errors } : { ok: false, error: errors[0] };
}
