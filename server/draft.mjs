// "Set up with Claude": turns a free sentence (or a task/note) into an automation draft.
// `claude -p` returns JSON; the user checks it in the form and saves.
import { read } from "./store.mjs";
import { runClaude } from "./claude.mjs";
import { accountsOfProject, formatsOf, isFeed } from "../shared/social.mjs";

function prompt(s, text, fixed) {
  const worlds = s.worlds.filter((w) => !fixed || w.id === fixed.id).map((w) => ({ id: w.id, name: w.name, about: w.description, projects: s.projects.filter((p) => p.worldId === w.id && p.status !== "done").map((p) => ({ id: p.id, name: p.name, ...(accountsOfProject(s, p).filter((a) => !isFeed(a.platform)).length ? { accounts: accountsOfProject(s, p).filter((a) => !isFeed(a.platform)).map((a) => ({ id: a.id, platform: a.platform, name: a.name, handle: a.handle })) } : {}) })) }));
  const d = new Date();
  return [
    "Make an automation draft for Playgrounds, the user's planner. Write only JSON, nothing else.",
    `Today: ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}, day of the week ${d.getDay()} (0=Sunday).`,
    fixed ? `The world is fixed: ${fixed.name} (worldId "${fixed.id}"). Pick the project only from this world's projects.` : "",
    `Worlds and projects: ${JSON.stringify(worlds)}`,
    `Request: """${text}"""`,
    `JSON schema: {"title": string (short, e.g. "LinkedIn post"), "worldId": string (from the list), "projectId": string|null (from the list; null if none fits), "days": number[] (0=Sun..6=Sat; "every day" = [0,1,2,3,4,5,6], "weekdays" = [1,2,3,4,5]), "times": string[] ("HH:MM"; "morning and 8 in the evening" = ["08:00","20:00"]; [] if no time), "minutes": number (time to reserve on the calendar, default 30), "who": "claude"|"me" (claude if text/content is to be prepared and no person is named; me if the person does it themselves), "action": string (a clear instruction in English to the assistant that will prepare it: what to produce, tone, length, project context; a short description if me; if the project has an account, write only the topic, format and style come from the account), "accountId": string|null (only for a project that has accounts: the id of the account that fits the platform or account named in the request; otherwise null), "format": "ig_post"|"ig_reel"|"linkedin"|"tweet"|"thread"|"threads"|"short"|"text"|null (by the chosen account's platform: instagram post ig_post, reels/video ig_reel; linkedin linkedin; x single tweet tweet, thread thread; threads threads; tiktok and youtube short; other text; null if there is no account), "steps": [{"kind": "text"|"image"|"video"|"post"|"other", "tool": "claude"|"me", "account": string (only post: platform and account, e.g. "LinkedIn, personal profile"), "note": string (short: how)}] (in the order named in the request; if no tool is named, the preparing assistant for text, "me" for sharing)}`,
    "Do not use em dashes (—). Do not invent information you do not know.",
  ].filter(Boolean).join("\n\n");
}

// With worldId the world is fixed: Claude sees only that world's projects and cannot change the world.
export async function draft(text, worldId = null, signal) {
  const { state: s } = read();
  const fixed = worldId ? s.worlds.find((w) => w.id === worldId) : undefined;
  const r = await runClaude(prompt(s, text, fixed), 120000, signal);
  const m = r.ok && r.out.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, error: (r.error || r.out || "Claude gave no answer").slice(0, 300) };
  try {
    const j = JSON.parse(m[0]);
    const world = fixed ?? s.worlds.find((w) => w.id === j.worldId) ?? s.worlds[0];
    const project = s.projects.find((p) => p.id === j.projectId && p.worldId === world.id);
    return {
      ok: true,
      draft: {
        title: String(j.title || text).slice(0, 80),
        worldId: world.id,
        projectId: project?.id ?? null,
        days: Array.isArray(j.days) && j.days.length ? j.days.filter((x) => x >= 0 && x <= 6) : [0, 1, 2, 3, 4, 5, 6],
        times: Array.isArray(j.times) ? j.times.filter((x) => /^\d{2}:\d{2}$/.test(x)) : [],
        minutes: +j.minutes || 30,
        who: ["claude", "me"].includes(j.who) ? j.who : "claude",
        action: String(j.action || ""),
        ...(() => {
          const acc = accountsOfProject(s, project).find((a) => a.id === j.accountId && !isFeed(a.platform));
          return acc ? { accountId: acc.id, ...(formatsOf(acc.platform).includes(j.format) ? { format: j.format } : {}) } : {};
        })(),
        steps: (Array.isArray(j.steps) ? j.steps : []).filter((x) => x && ["text", "image", "video", "post", "other"].includes(x.kind)).slice(0, 8).map((x, i) => ({
          id: `d${i}${Math.random().toString(36).slice(2, 6)}`, kind: x.kind,
          tool: ["claude", "me"].includes(x.tool) ? x.tool : "me",
          ...(x.kind === "post" && x.account ? { account: String(x.account).slice(0, 80) } : {}),
          ...(x.note ? { note: String(x.note).slice(0, 80) } : {}),
        })),
      },
    };
  } catch {
    return { ok: false, error: "Could not read Claude's answer" };
  }
}
