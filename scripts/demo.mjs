// Demo data: node scripts/demo.mjs <target-folder>  →  <target>/playground.json
// Refuses to write into the real data/ folder. To try the app: PG_DATA=<target> npm run dev
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "../shared/social.mjs";
import { migrateRous } from "../shared/rou.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
if (!arg) { console.error("Usage: node scripts/demo.mjs <target-folder>"); process.exit(1); }
const target = path.resolve(arg);
const real = path.join(ROOT, "data");
if (target === real || target.startsWith(real + path.sep)) { console.error("Refused: this is the real data/ folder."); process.exit(1); }
fs.mkdirSync(target, { recursive: true });

// Seeded random: the same output on every run.
let seed = 20261025;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
let n = 0;
const id = (p = "") => `${p}${(n++).toString(36).padStart(3, "0")}${Math.floor(rnd() * 1e6).toString(36)}`.slice(0, 8);

const pad = (x) => String(x).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const base = new Date(); base.setHours(0, 0, 0, 0);
const day = (off) => { const d = new Date(base); d.setDate(d.getDate() + off); return iso(d); };
const at = (off, h, m = 0) => { const d = new Date(base); d.setDate(d.getDate() + off); d.setHours(h, m, 0, 0); return d.toISOString(); };
const ts = (off, h, m = 0) => `${day(off)}T${pad(h)}:${pad(m)}`;
const dow = (off) => new Date(base.getTime() + off * 86400000).getDay(); // 0 = Sunday

// World: a single workspace (the app needs at least one world). The demo runs on three projects.
const worlds = [
  { id: "studio", name: "Studio", color: "#3d5afe", color2: "#22c8e6", description: "Client work, my own app and a side project", accounts: [
    { id: "acc-ig", platform: "instagram", name: "App account", handle: "@sample.studio", lang: "en", voice: "Plain, friendly, short sentences. Few emoji." },
    { id: "acc-li", platform: "linkedin", name: "Personal LinkedIn", handle: "linkedin.com/in/example", lang: "en", voice: "First person, notes from learning by doing." },
  ] },
];
const W = "studio";

// Projects: key, name, description, status, deadline offset (days)
const P = {};
const projects = [];
const proj = (key, name, description, status, dl) => {
  const p = { id: id("p"), worldId: W, name, description, status, deadline: dl == null ? null : day(dl) };
  P[key] = p.id; projects.push(p);
};
proj("marka", "Cafe branding", "Logo, colors and menu design for a neighborhood cafe", "active", 6);
proj("fit", "Workout app v2", "Onboarding refresh, progress screen, paywall and launch", "active", 12);
proj("arac", "Color palette tool", "A small web tool that pulls a palette from a photo", "active", 14);

// Tasks
const tasks = [];
const blocks = [];
const T = {};
const ck = (...items) => items.map(([text, done]) => ({ id: id("c"), text, done: !!done }));
const task = (key, projectKey, title, o = {}) => {
  const t = {
    id: id("t"), worldId: W, projectId: projectKey ? P[projectKey] : null, title, notes: o.notes ?? "", status: o.status ?? "todo",
    day: o.day ?? null, deadline: o.deadline ?? null, estimate: o.estimate ?? null, checklist: o.checklist ?? [], by: "me",
    createdAt: at(o.created ?? -20, 10),
  };
  if (t.status === "done") t.doneAt = at(o.doneOff ?? -1, o.doneH ?? 17, o.doneM ?? 20);
  if (o.order != null) t.order = o.order;
  if (o.who) t.who = o.who;
  if (key) T[key] = t.id;
  tasks.push(t);
  return t;
};
const done = (key, pk, title, off, o = {}) => task(key, pk, title, { ...o, status: "done", doneOff: off, created: off - 5, deadline: o.deadline ?? null });
const block = (t, off, h, m, mins, kind = "plan", title = "") =>
  blocks.push({ id: id("b"), taskId: t ? t.id : null, worldId: W, title, start: ts(off, h, m), end: ts(off, h + Math.floor((m + mins) / 60), (m + mins) % 60), kind });

// Done (last 30 days)
done("d1", "marka", "Sketch 3 logo directions", -26, { estimate: 180, notes: "Warm, neighborhood feel. Hand-drawn." });
done("d2", "marka", "Pick the color palette and typeface", -22, { estimate: 90, deadline: day(-21) });
done("d3", "marka", "Logo revision (round 2)", -17, { estimate: 120, deadline: day(-16) });
done("d4", "marka", "Measure the sign and the cup", -12, { estimate: 30 });
done("d5", "fit", "Sketch the onboarding flow on paper", -28, { estimate: 90 });
done("d6", "fit", "Progress screen first draft", -19, { estimate: 120 });
done("d7", "fit", "Keyword research", -13, { estimate: 60 });
done("d8", "fit", "Paywall copy", -9, { estimate: 60, deadline: day(-8) });
done("d9", "fit", "First 3 store screenshots", -6, { estimate: 120, deadline: day(-5) });
done("d10", "fit", "Draft of the release announcement", -4, { estimate: 40 });
done("d11", "fit", "Store description (short and long)", -1, { estimate: 45, doneH: 16, doneM: 5 });
done("d12", "arac", "Try the palette extraction logic", -18, { estimate: 120, notes: "5 colors with k-means; reading pixels from a canvas is enough." });
done("d13", "arac", "First interface draft", -5, { estimate: 90 });
done("d14", "arac", "Photo upload area", -2, { estimate: 60 });
// Done today
done("dt1", "marka", "Confirm the colors with the cafe owner", 0, { estimate: 20, doneH: 9, doneM: 10 });

// Open: late
task("o1", "marka", "Send the logo guidelines to the client", { status: "doing", day: day(0), deadline: day(-2), estimate: 60, notes: "One PDF: logo spacing, color codes, typefaces, misuse examples.", checklist: ck(["Logo spacing", 1], ["Color codes", 1], ["Misuse examples", 0], ["Export to PDF", 0]), order: 1 });
// Today
task("o3", "marka", "Finish the menu design", { day: day(0), deadline: day(5), estimate: 150, notes: "Coffee, desserts, cold drinks. One sheet, two sides.", checklist: ck(["Coffee section", 1], ["Desserts", 0], ["Cold drinks", 0], ["Print check", 0]), order: 2 });
task("o4", "fit", "Store screenshots: screens 4 and 5", { day: day(0), deadline: day(3), estimate: 90, order: 3 });
task("o5", "fit", "Collect the competitors' paywalls", { day: day(0), estimate: 30, who: "claude", notes: "5 apps: price, trial length, first sentence. As a table.", order: 4 });
// Tomorrow and this week
task("o7", "fit", "Paywall: design two price options", { day: day(1), deadline: day(8), estimate: 120, checklist: ck(["Monthly card", 0], ["Yearly card", 0], ["Free trial wording", 0]) });
task("o8", "arac", "Palette tool: copy button", { day: day(2), deadline: day(13), estimate: 60 });
task("o9", "arac", "Add a feedback form to the product page", { day: day(2), estimate: 20, who: "claude", notes: "Create the form and put the link at the bottom of the page." });
task("o12", "fit", "3 visuals for the announcement", { day: day(3), deadline: day(8), estimate: 120 });
task("o15", "marka", "Deliver the logo files (SVG, PNG, PDF)", { day: day(4), deadline: day(6), estimate: 45, checklist: ck(["SVG", 0], ["PNG @2x", 0], ["PDF", 0], ["Guidelines", 0]) });
task("o16", "marka", "Cup and sign applications", { day: day(5), deadline: day(6), estimate: 90 });
// The next two weeks
task("o18", "fit", "Build the first 3 onboarding screens in Figma", { day: day(8), deadline: day(11), estimate: 240 });
task("o19", "fit", "Plan the launch day posts", { day: day(9), deadline: day(9), estimate: 60 });
task("o20", "arac", "Publish and share the tool", { day: day(12), deadline: day(14), estimate: 90 });
// Waiting
task("o23", "marka", "Wait for the menu prices from the cafe owner", { status: "waiting", deadline: day(3), notes: "Nothing goes to print before the prices arrive." });
task("o24", "fit", "Store review result", { status: "waiting", notes: "Submitted, 24-48 hours." });
// Someday
task("u1", "arac", "Also copy the palette as CSS variables and Tailwind", { estimate: 60 });
task("u2", "fit", "Dark mode color tests", { estimate: 90 });
task("u3", "marka", "Opening post idea for Instagram", { notes: "The logo story at the cafe opening: from the first sketch to the sign." });

// Calendar blocks: today and this week
const tk = (k) => tasks.find((t) => t.id === T[k]);
block(tk("o1"), 0, 9, 30, 60);
block(null, 0, 11, 0, 30, "meeting", "Client call: cafe owner");
block(tk("o3"), 0, 13, 30, 150);
block(tk("o4"), 0, 16, 30, 90);
block(tk("o7"), 1, 10, 0, 120);
block(null, 1, 14, 0, 45, "meeting", "Weekly plan");
block(tk("o8"), 2, 10, 0, 60);
block(tk("o12"), 3, 11, 0, 120);
block(tk("o15"), 4, 10, 0, 60);
block(tk("o16"), 5, 14, 0, 90);

// Focus sessions: the last 30 days. Some days have none.
const sessions = [];
const doneTasks = tasks.filter((t) => t.status === "done");
const pickTask = (off) => {
  const near = doneTasks.filter((t) => t.doneAt && Math.abs((new Date(t.doneAt) - new Date(at(off, 12))) / 86400000) < 4);
  const pool = near.length ? near : doneTasks;
  return pool[Math.floor(rnd() * pool.length)];
};
const zero = new Set([-29, -28, -23, -20, -14, -13, -8, -3]);
for (let off = -29; off <= 0; off++) {
  if (zero.has(off)) continue;
  const weekend = [0, 6].includes(dow(off));
  const count = off === 0 ? 1 : weekend ? (rnd() < 0.5 ? 1 : 0) : 1 + Math.floor(rnd() * 3);
  let h = 9 + Math.floor(rnd() * 2);
  for (let i = 0; i < count; i++) {
    const t = off === 0 ? tasks.find((x) => x.id === T.o1) : pickTask(off);
    const mins = [25, 25, 45, 50, 90, 35, 60][Math.floor(rnd() * 7)];
    const m = Math.floor(rnd() * 4) * 15;
    sessions.push({ id: id("s"), taskId: t.id, start: at(off, h, m), end: at(off, h, m + mins), mode: mins === 25 ? "pomo" : rnd() < 0.15 ? "manual" : "free" });
    h += 2 + Math.floor(rnd() * 3);
    if (h > 21) break;
  }
}
// A few late sessions for an evening weight
for (const off of [-10, -9, -5, -4, -2]) {
  const t = pickTask(off);
  sessions.push({ id: id("s"), taskId: t.id, start: at(off, 21, 0), end: at(off, 21, 40), mode: "free" });
}
sessions.sort((a, b) => a.start.localeCompare(b.start));

// Notebook
const note = (o) => ({ id: id("n"), worldId: o.projectId ? W : null, projectId: o.projectId ?? null, source: "note", from: "", url: o.url ?? "", title: o.title, body: o.body ?? "", receivedAt: at(o.off, o.h ?? 10, o.m ?? 0), state: "new", category: o.category });
const inbox = [
  note({ off: 0, h: 8, m: 40, category: "idea", projectId: P.fit, title: "A summary card you can share in one tap after a workout", body: "The **duration** and **volume** of the workout you just finished, plus one sentence.\n\n- Story size\n- Dark and light theme\n- Small logo in the corner" }),
  note({ off: 0, h: 9, category: "todo", projectId: P.marka, title: "Ask the cafe owner for the menu prices", body: "Nothing goes to print without prices on the menu.\n\n1. Coffees\n2. Desserts\n3. Sandwiches" }),
  note({ off: -1, h: 18, category: "idea", projectId: P.arac, title: "Also copy the palette as CSS variables and Tailwind", body: "```css\n:root { --c1: #3d5afe; --c2: #ff6b5b; }\n```\nThree formats in one click: HEX, CSS, Tailwind." }),
  note({ off: -2, h: 13, category: "note", projectId: P.marka, title: "Client meeting notes: cafe", body: "## What we discussed\n\n- The logo must read from far away on the sign\n- Big prices on the menu, short descriptions\n- Only the emblem on the cup\n\n> \"It should look like the neighborhood cafe, not like a chain.\"" }),
  note({ off: -3, h: 9, category: "idea", title: "Weekly closing ritual: Friday 17:00, 15 minutes", body: "Count what got done, pick next week's first 3 tasks, clear the desk." }),
  note({ off: -4, h: 16, category: "link", projectId: P.fit, url: "https://example.com/mobile-onboarding", title: "Case study on the number of onboarding questions", body: "Completion is best with 3 to 5 questions. Our flow has **6** right now." }),
  note({ off: -8, h: 21, category: "idea", title: "A short video series: 'what I designed today'", body: "2 videos a week, 20 seconds. Screen recording first, then one sentence." }),
];

// Automations and outputs
const mkAuto = (o) => ({ id: id("a"), worldId: W, projectId: null, minutes: 20, status: "active", who: "me", horizon: day(14), createdAt: at(-20, 10), ...o });
const a1 = mkAuto({ projectId: P.fit, title: "Weekly app post", action: "Explain one feature of the app in 4 slides. Plain, friendly, a question on the first slide.", times: ["09:00"], days: [0, 1, 3, 5], minutes: 15, who: "claude", image: true, accountId: "acc-ig", format: "ig_post", steps: [{ id: id("st"), kind: "post", tool: "Instagram", account: "acc-ig" }] });
const a2 = mkAuto({ title: "Monday morning weekly plan", action: "Summarize last week and suggest 3 priorities for this week.", times: ["08:30"], days: [1], minutes: 20, who: "claude" });
const automations = [a1, a2];
// Today's automation tasks
const autoToday = [];
const hasDay = (a) => a.days.includes(dow(0));
for (const a of [a1, a2]) {
  if (!hasDay(a)) continue;
  const slot = a.times[0] ?? "";
  const t = task(null, a.projectId ? Object.keys(P).find((k) => P[k] === a.projectId) : null, a.title, { day: day(0), estimate: a.minutes });
  t.autoId = a.id; t.autoSlot = slot; t.autoDay = day(0); t.by = a.who;
  autoToday.push(t);
}
const slide = (title, text) => ({ title, text });
const post = { format: "ig_post", slides: [slide("Remember your workout?", "Most of us forget how many reps the last set was."), slide("Now it remembers for you", "Every set is saved automatically, weight and reps side by side."), slide("Compare with last week", "Small gains show up on the line too."), slide("Try it", "Get the update from the App Store.")], caption: "You don't have to remember how many reps your last set was. The new version has a progress screen for you.", hashtags: ["#workout", "#fitness", "#app"] };
const runs = [
  { id: id("r"), taskId: autoToday.find((t) => t.autoId === a1.id)?.id, at: at(0, 7, 55), title: a1.title, body: `${post.slides.map((s, i) => `${i + 1}. ${s.title}\n${s.text}`).join("\n\n")}\n\n${post.caption}\n\n${post.hashtags.join(" ")}`, status: "ready", post, by: "claude", on: day(0) },
  { id: id("r"), at: at(-2, 7, 50), title: a1.title, body: "This week: Dark mode.\n\nA new theme that is easy on the eyes for late workouts.", status: "posted", post: { format: "ig_post", slides: [slide("Late workouts", "A new theme that is easy on the eyes."), slide("Automatic switch", "It follows your phone's setting.")], caption: "For anyone who trains at night: dark mode is here.", hashtags: ["#darkmode"] }, by: "claude", on: day(-2), postedAt: at(-2, 9, 5) },
  { id: id("r"), at: at(-6, 8, 35), title: a2.title, body: "## Last week\n- Logo revision done\n- Store keywords pulled\n\n## Priorities this week\n1. Menu design\n2. Logo guidelines\n3. Paywall", status: "approved", by: "claude", on: day(-6) },
].filter((r) => r.taskId !== undefined || r.on !== day(0));
const runs2 = runs.map((r) => (r.taskId === undefined ? (({ taskId, ...x }) => x)(r) : r));

// Rous, chat, memory
const rous = [
  { id: "rou", name: "Rou", color: "", persona: "" },
  { id: "rou-editor", name: "Editor", color: "#e0218a", persona: "Simplify the texts I write. Cut needless adjectives, and do not hesitate to split a sentence in two." },
];
const msg = (role, text, off, h, m) => ({ role, text, at: at(off, h, m) });
const chat = {
  rou: [
    msg("user", "What should I focus on today?", 0, 8, 45),
    msg("rou", "One task is late: the logo guidelines. I moved it to today and put a 60-minute block at 09:30. The afternoon has 150 minutes for the menu design.", 0, 8, 45),
    msg("user", "Is there time for the palette tool this week?", 0, 8, 47),
    msg("rou", "Wednesday at 10:00 has an hour for the copy button. I will set up the feedback form too, the same day.", 0, 8, 47),
  ],
};
const memory = [
  { id: id("m"), text: "Most productive between 09:00 and 12:00; put meetings in the afternoon.", at: at(-12, 10) },
  { id: id("m"), text: "For design work, likes to check on the phone before saying 'done'.", at: at(-9, 14) },
  { id: id("m"), text: "Do not schedule anything after 21:00; the bedtime is fixed.", at: at(-6, 18) },
  { id: id("m"), text: "Dislikes the words 'very' and 'really' in texts.", at: at(-4, 11), rouId: "rou-editor" },
];

const state = {
  version: 3, worlds, projects, tasks, blocks, sessions, inbox, timer: null, automations, runs: runs2,
  rous, chat, memory, talk: [], trash: [], changes: [],
};
migrate(state); migrateRous(state);
fs.writeFileSync(path.join(target, "playground.json"), JSON.stringify(state, null, 2) + "\n");

const count = (k) => `${k}: ${state[k].length}`;
console.log(target);
console.log(["worlds", "projects", "tasks", "blocks", "sessions", "inbox", "automations", "runs", "rous", "memory"].map(count).join(", "), `, chat msgs: ${Object.values(chat).flat().length}`);
