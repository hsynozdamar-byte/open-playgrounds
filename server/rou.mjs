// Rou: the assistant inside Playgrounds. The connected model (`claude -p`) speaks with Rou's persona and a summary of the data.
// Rou does not change data itself: it proposes an action, and the client applies it when the user approves in the app.
import { read, update, MEDIA_DIR } from "./store.mjs";
import { describeFiles } from "./attach.mjs";
import { runClaude } from "./claude.mjs";
import { FORMATS, accountOf, isFeed, platformName, taskRef } from "../shared/social.mjs";
import { DEFAULT_ROU, memoryOf, rouOf } from "../shared/rou.mjs";
import { userName } from "../shared/user.mjs";
import { changeOn } from "./change.mjs";

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const STATUS = { todo: "to do", doing: "in progress", waiting: "waiting", done: "done" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WHO = (s) => ({ claude: "Claude", me: userName(s) });

// Automation tasks ready to prepare: today or past, not done, prepared by the assistant, no output yet.
function due(s, today, wname) {
  const list = s.tasks.filter((t) => {
    const a = s.automations.find((x) => x.id === t.autoId);
    return a && a.who !== "me" && t.status !== "done" && t.day && t.day <= today && !s.runs.some((r) => r.taskId === t.id && r.status !== "failed");
  }).slice(0, 12);
  return list.length ? list.map((t) => `- (id:${t.id}) ${t.title} [${wname(t.worldId)}] day ${t.day}, prepared by ${WHO(s)[s.automations.find((x) => x.id === t.autoId).who]}`).join("\n") : "(none)";
}

// Rou's memory (state.memory): shared + that Rou's own entries; without rouId only the shared ones. withIds: Rou sees the ids for forget.
export function memoryText(s, withIds = false, rouId) {
  const list = memoryOf(s, rouId);
  return list.length ? list.map((m) => `- ${withIds ? `(memId:${m.id}) ` : ""}${rouId ? (m.rouId ? "[own] " : "[shared] ") : ""}${m.text}`).join("\n") : "(nothing yet)";
}

// The data the model sees: short, readable text.
function snapshot(s, lens) {
  const now = new Date();
  const today = iso(now);
  const week = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
  const wname = (id) => s.worlds.find((w) => w.id === id)?.name ?? "No world";
  const pname = (id) => s.projects.find((p) => p.id === id)?.name;
  const where = (t) => [wname(t.worldId), pname(t.projectId)].filter(Boolean).join(" › ");
  const at = (t) => s.blocks.filter((b) => b.taskId === t.id && b.start.slice(0, 10) >= today).sort((a, b) => a.start.localeCompare(b.start))[0];
  const task = (t) => `- (id:${t.id}) ${t.title}${t.topic?.title ? `: ${t.topic.title}` : ""} [${where(t)}] ${STATUS[t.status]}${t.day ? `, day ${dayOf(t.day)}` : ""}${currentRun(s, t.id) ? `, output runId:${currentRun(s, t.id).id}` : ""}${at(t) ? `, time ${at(t).start.slice(11, 16)}-${at(t).end.slice(11, 16)}` : ""}${t.autoId ? ", automation task" : ""}${t.deadline ? `, deadline ${t.deadline}` : ""}${t.checklist?.length ? `, ${t.checklist.filter((c) => c.done).length}/${t.checklist.length} subtasks` : ""}`;
  const open = s.tasks.filter((t) => t.status !== "done");
  const late = open.filter((t) => (t.deadline && t.deadline < today) || (t.day && t.day < today));
  const todays = open.filter((t) => t.day === today);
  const upcoming = open.filter((t) => t.day && t.day > today && t.day <= week);
  const undated = open.filter((t) => !t.day);
  const doneWeek = s.tasks.filter((t) => t.doneAt && iso(new Date(t.doneAt)) > iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7)));
  const mins = s.sessions.filter((x) => iso(new Date(x.start)) === today).reduce((n, x) => n + (new Date(x.end) - new Date(x.start)) / 60000, 0);
  const notes = s.inbox.filter((i) => i.state === "new");
  const list = (arr, max = 25) => (arr.length ? arr.slice(0, max).map(task).join("\n") + (arr.length > max ? `\n(+${arr.length - max} more)` : "") : "(none)");
  return [
    `Today: ${dayOf(today)}, time ${pad(now.getHours())}:${pad(now.getMinutes())}. Yesterday: ${dayOf(iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)))}. Tomorrow: ${dayOf(iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)))}.`,
    `Day for a share or post task: if the user said "today", "now" (bugün, şimdi) or "share" without naming a day, use ${today}; even if it is late, do not push it to tomorrow. Only use another day when they clearly named one.`,
    lens && lens !== "all" ? `The user is currently looking at the "${wname(lens)}" world.` : "The user is looking at all worlds.",
    timerLine(s),
    `Worlds: ${s.worlds.map((w) => `${w.name} (id:${w.id})${w.description ? ` (${w.description})` : ""}`).join(", ") || "(none)"}`,
    `Accounts (posting): ${s.worlds.flatMap((w) => (w.accounts ?? []).filter((a) => !isFeed(a.platform)).map((a) => `${platformName(a)} ${a.name || ""}${a.handle ? ` ${a.handle}` : ""} (accId:${a.id}) [${w.name}]${a.lang ? ` language ${a.lang}` : ""}`)).join(", ") || "(none)"}`,
    `Projects:\n${s.projects.filter((p) => p.status !== "done").map((p) => `- ${p.name} (id:${p.id}) [${wname(p.worldId)}]${p.status === "paused" ? " paused" : ""}${p.deadline ? ` deadline ${p.deadline}` : p.ongoing ? " ongoing" : ""}${p.description ? `: ${p.description.replace(/\s+/g, " ").slice(0, 400)}` : ""}${brandLine(p.brand)}`).join("\n") || "(none)"}`,
    `Today's tasks:\n${list(todays)}`,
    `Late:\n${list(late)}`,
    `Next 7 days:\n${list(upcoming)}`,
    `Undated tasks:\n${list(undated, 15)}`,
    `Done in the last 7 days: ${doneWeek.length} tasks. Focused today: ${Math.round(mins)} min.`,
    `Notes waiting in the Notebook (newest first):\n${noteList(notes, wname, pname)}`,
    `Automations:\n${s.automations.length ? s.automations.map((a) => `- (autoId:${a.id}) ${a.title} [${wname(a.worldId)}] ${a.status === "active" ? "running" : "paused"}, ${a.times?.join(", ") || "no time"}, prepared by ${WHO(s)[a.who] ?? a.who}${a.days?.length ? `, days ${a.days.map((d) => DAYS[d]).join(" ")}` : ""}${a.image ? ", with image" : ""}${a.browser ? `, in Chrome (${a.browser.name})` : ""}${a.action ? `\n  instruction: "${a.action.replace(/\s+/g, " ").slice(0, 500)}"` : ""}${a.visual?.trim() ? `\n  permanent visual rules (the user's decision; they win if they conflict with the instruction): "${a.visual.replace(/\s+/g, " ").slice(0, 700)}"` : ""}`).join("\n") : "(none)"}`,
    `Automation tasks that can be prepared (today and late, no output):\n${due(s, today, wname)}`,
    `Automation outputs (each task's current output, newest first; "task day" is the post's day on the calendar, "prepared" is only the moment the output was produced):\n${runLines(s, today, wname)}`,
  ].join("\n\n");
}

// The project's brand frame on one line, so Rou knows the old state when editing.
function brandLine(b) {
  if (!b) return "";
  const x = [b.audience && `audience: ${b.audience}`, b.pillars?.length && `pillars: ${b.pillars.join(", ")}`, b.use && `tone/use: ${b.use}`, b.avoid && `avoid: ${b.avoid}`].filter(Boolean);
  return x.length ? `\n  brand: ${x.join("; ")}` : "";
}

// Notebook notes with their ids and texts, so Rou can read them and sort them into worlds, projects and tasks.
const CAT = { note: "note", idea: "idea", todo: "to do", link: "link" };
function noteList(notes, wname, pname) {
  if (!notes.length) return "(none)";
  const list = [...notes].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 40);
  return list.map((i) => {
    const where = i.worldId ? ` [${[wname(i.worldId), pname(i.projectId)].filter(Boolean).join(" › ")}]` : " [no place]";
    const body = (i.body || "").replace(/\s+/g, " ").trim();
    return `- (noteId:${i.id}) ${CAT[i.category ?? "note"]}: ${i.title}${where}${i.url ? ` ${i.url}` : ""}, ${i.receivedAt.slice(0, 10)}${body ? `\n  "${body.slice(0, 500)}${body.length > 500 ? "…" : ""}"` : ""}`;
  }).join("\n") + (notes.length > list.length ? `\n(+${notes.length - list.length} more)` : "");
}

// The timer's state: Rou must know it when proposing start/pause.
function timerLine(s) {
  const t = s.timer;
  if (!t) return "Timer: not running.";
  const task = s.tasks.find((x) => x.id === t.taskId);
  const state = t.pausedAt ? "paused" : t.phase === "break" ? "on break" : "running";
  return `Timer: ${state}, task "${task?.title ?? "?"}" (id:${t.taskId}), ${t.mode === "pomo" ? `pomodoro ${t.length} min` : "free"}.`;
}

// "2026-11-10 (Tue)": Rou sees a day by both date and name ("yesterday's", "Tuesday's").
const dayOf = (day) => `${day} (${DAYS[new Date(`${day}T12:00:00`).getDay()]})`;

// A task's current output (same as runOfTask in src/runs.ts): the posted one if any, else the newest that finished preparing.
const currentRun = (s, taskId) => s.runs.find((r) => r.taskId === taskId && r.status === "posted") ?? s.runs.find((r) => r.taskId === taskId && !["working", "failed"].includes(r.status)) ?? s.runs.find((r) => r.taskId === taskId && r.status !== "working");

// Automation outputs: ONE line per task (the current output) with the task's own id, day and topic.
// Two tasks can share a title: the list shows each task's day and topic, and Rou picks by day and topic.
export function runLines(s, today, wname = () => "") {
  const RUN = { working: "preparing", failed: "failed", ready: "awaiting approval", approved: "approved", posted: "posted" };
  const ids = [...new Set(s.runs.map((r) => r.taskId))].slice(0, 14);
  const list = ids.map((id) => currentRun(s, id)).filter(Boolean);
  if (!list.length) return "(none)";
  return list.map((r) => {
    const t = s.tasks.find((x) => x.id === r.taskId);
    const body = (r.body || "").replace(/\s+/g, " ").slice(0, 400);
    const acc = t && accountOf(s, taskRef(s, t));
    const late = t?.day && t.day < today && t.status !== "done" && r.status !== "posted";
    const again = s.runs.some((x) => x.taskId === r.taskId && x.status === "working");
    return `- (runId:${r.id}) ${t?.title ?? r.title}${t?.topic?.title ? `: ${t.topic.title}` : ""} [${wname(t?.worldId)}]${t ? ` task id:${t.id}${t.day ? `, task day ${dayOf(t.day)}${t.autoSlot ? ` ${t.autoSlot}` : ""}${late ? ", LATE" : ""}` : ""},` : ""}${r.post ? ` ${FORMATS[r.post.format]?.label ?? "post"}${acc ? `, account ${platformName(acc)} ${acc.name || ""}${acc.handle ? ` ${acc.handle}` : ""}` : ""}${r.video ? ", with video" : ""},` : ""} ${RUN[r.status] ?? r.status}${again ? " (a new one is being prepared now)" : ""}, prepared by ${r.by ?? "claude"} ${(() => { const d = new Date(r.at); return `${iso(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; })()}${r.images?.length ? `, ${r.images.length} images` : ""}${body ? `\n  "${body}"` : ""}`;
  }).join("\n");
}

// The actions Rou can propose. Ids come only from the (id:...) values in the data.
const ACTIONS_ALL = `Actions you can take. One object for a single action; a plan (below) for several:
{"type":"start","taskId":"…","minutes":30}   start the task's timer; with minutes it is a pomodoro of that length, without it a free timer
{"type":"pause"}  {"type":"resume"}  {"type":"stop"}   pause / resume / finish and save the running timer
{"type":"add_task","title":"…","worldId":"…","projectId":"…"|null,"day":"YYYY-MM-DD"|null,"at":"HH:MM"|null,"minutes":60|null}   add a new task (with at, a calendar block of that many minutes at that time). Do not use it for a post that will be shared on an account: copy_post for a copy of an existing output, change for a new post
{"type":"move","taskId":"…","day":"YYYY-MM-DD"|null}   move the task to another day (null = undated)
{"type":"schedule","taskId":"…","day":"YYYY-MM-DD","at":"HH:MM","minutes":60|null}   put the task on the calendar at that day and time (a block)
{"type":"edit_task","taskId":"…","title":"…","deadline":"YYYY-MM-DD"|null,"projectId":"…"|null,"minutes":45,"notes":"…","steps":["…"]}   edit the task; write only the fields that change. notes is appended to the end of the task's notes, steps are added as subtasks, and if projectId is a project of another world the task moves to that world
{"type":"add_project","name":"…","worldId":"…","deadline":"YYYY-MM-DD"|null,"description":"…","ref":"p1"}   create a new project (do not propose it if a project with the same name exists in that world)
{"type":"edit_project","projectId":"…","name":"…","description":"…","deadline":"YYYY-MM-DD"|null,"ongoing":true|false,"status":"active"|"paused"|"done","brand":{"audience":"…","pillars":["…"],"use":"…","avoid":"…"}}   update the project; write only the fields that change. description and brand are written in their full new form (keep the old, change or add only what changed). brand.use = tone and phrasing to use, brand.avoid = what to avoid; the project's posts are prepared by them
{"type":"edit_auto","autoId":"…","title":"…","action":"…","days":[0-6],"times":["HH:MM"],"who":"me"|"claude","status":"active"|"paused","visual":"…"}   update the automation; write only the fields that change. visual = the automation's permanent visual/cover rules (one rule per line; keep the old ones, append the new one), for when the user asks for a visual revision to be "always like this" or sets a general visual rule for a group of posts ("in this world's game posts ..."). If a rule fits several automations (e.g. all game posts of a world), propose a plan with an edit_auto for each; do not settle for one automation. action = the full new form of the instruction to Claude (keep the old, work in what changed). days 0=Sun … 6=Sat
{"type":"done","taskId":"…"}   mark the task done
{"type":"note","title":"…","body":"…","worldId":"…"|null}   add a note to the Notebook
Notebook actions (noteIds come from the "Notes waiting in the Notebook" list):
{"type":"note_place","noteId":"…","worldId":"…"|null,"projectId":"…"|null}   put the note in a world or project (with projectId the world is the project's world); the note stays in the Notebook
{"type":"note_task","noteId":"…","title":"…","projectId":"…"|null,"worldId":"…"|null,"day":"YYYY-MM-DD"|null,"at":"HH:MM"|null,"minutes":60|null,"ref":"t1"}   turn the note into a task: a task is created, the note's text moves into the task's notes, the note goes to the archive. Give title if it is a clearer task name than the note's title, otherwise leave it empty
{"type":"note_attach","noteId":"…","taskId":"…","as":"notes"|"steps"}   attach the note to an existing task: notes = into the task's notes, steps = the note's lines become the task's subtasks. The note goes to the archive
{"type":"note_edit","noteId":"…","title":"…","body":"…","category":"note"|"idea"|"todo"|"link"}   edit the note: tidy a messy note (clear title, markdown body: "- " list, "- [ ] " to do, "## " subheading) and fix its category. Do not change the note's meaning, add or remove information
{"type":"note_archive","noteId":"…"}   archive the note (finished, no longer needed)
{"type":"approve","runId":"…"}   approve an automation output that is awaiting approval
{"type":"share","runId":"…"}   share a post that is awaiting approval or approved on its account NOW (when the user says "share", "post it", "send it"). On X, if the text contains a tweet address and the task says "reply" or "quote", it is sent as a reply/quote to that tweet; if the user wants a reply to a tweet, first have revise put the tweet address and a "share as a reply" note into the text, then share. Never say "I can't"
{"type":"auto","text":"…","worldId":"…"|null}   set up a new automation: the automation form opens filled with Claude's draft, and the user reviews and saves. text = the whole request in one sentence (what, which account or platform, which days and times, who prepares, tone); worldId = the world named in the request, null if unclear
{"type":"revise","runId":"…","note":"…","worldId":"…"|null,"projectId":"…"|null,"accountId":"…"|null}   when the user in chat dislikes an output or asks for a change, propose this IMMEDIATELY (do not tell them to press Revise): note = their whole request, in their words and complete (what changes, what is added, what to keep). The note is written permanently to the task's revision history and Rou prepares the output again from scratch. If the instruction also has to change permanently, propose edit_auto separately, but do not hold the revision back. worldId, projectId, accountId are filled only when the user wants the post shared in ANOTHER world, project or account (e.g. "share this on the other world's LinkedIn account"): accountId from the Accounts list (accId:…), projectId from Projects (id:…), worldId from Worlds (id:…); the account must belong to that world, and so must the project. The post moves there; if it is an automation task it detaches from the automation and becomes a one-off post of that account (the automation does not change) and is written from scratch with the new account's voice, language and the project's notes. If the requested account is not in the list, do not invent the field, say so. If no move is wanted, all three are null
{"type":"copy_post","runId":"…","accountId":"…","day":"YYYY-MM-DD"|null,"at":"HH:MM"|null}   have an output shared on ANOTHER account too (when the user says "share this on Threads too, and LinkedIn"): one copy_post per account (a two-step plan for two accounts). The copy opens as that account's one-off POST task, the text and video/images pass unchanged, and it waits for approval on Posts. accountId from the Accounts list (accId:…); without day/at the source's day and time are used. Never open a plain task with add_task (a plain task does not show on Posts). Only to LinkedIn, X and Threads accounts; for Instagram move it with revise. If the post will be shared only on another account and not on this one, use revise (move with accountId)
{"type":"set_text","runId":"…","text":"…"}   when the user gave a post's final text themselves (pasted it, "use this text", "I edited it by hand"), propose this, NOT revise: text = their text word for word, do not change, shorten or correct a single character. Images and video stay as they are, and the metin.txt in the share folder is updated too
{"type":"set_example","projectId":"…","text":"…"}   when the user gives a text as a project's example, reference, "write like this": it becomes the project's approved example, and all of that project's drafts aim at this voice. text word for word. If the same message also gives a post's text, propose it together with set_text in a plan
{"type":"set_guide","text":"…","mode":"prepend"|"replace"}   when the user gives a writing guide, writing rules or a "general writing style" text: text = the whole guide word for word. mode prepend (default): the new guide goes first, the old one stays below as the "Detailed guide", and the new one wins on conflict; replace: only when they say "drop the old one, use this". Rou writes and corrects all drafts by it
{"type":"prepare","taskId":"…"}   prepare an automation task whose preparer is Claude now (Chrome tasks too; it only reads and produces proposals, sends nothing). taskId from the "Automation tasks that can be prepared" list
{"type":"remember","text":"…","shared":true|false}   add a lasting fact about the user to your memory (one short sentence, third person: "Salary expectation is 90,000 net."). shared true: general information about the user, all Rous should know; false: only about your own role
{"type":"forget","memId":"…"}   delete a fact from your memory (memId from the memory list)
{"type":"add_world","name":"…","description":"…"}   create a new world (do not propose it if a world with that name exists; description only if the user gave one, otherwise empty)
{"type":"change","text":"…","files":["rou-….png"]|null}   do yourself everything the above cannot cover: you are Claude, and when asked you work on this computer with code and commands. Add a new feature or screen to the app, change the look (color, type, layout), change the server, multi-step data jobs (e.g. world + project + automation together), system jobs. text = the whole request, clear and self-contained: what, where, how it should be. If code changes it is checked and rolled back by itself if it breaks; Undo is possible afterwards too. It can take a while (a minute or two). If a one-off post (text, image, video) to be shared is asked for, ask for it in text as a POST: say which account it is shared from (account id or @handle) and the language, and have the task opened with \`pg add ... --post <account>\` (a plain task does not show on Posts); if it is a video, the video rules in CLAUDE.md apply

Batch work (plan): when several actions are needed, propose a single plan. The user can switch each step on or off, Approve does the selected ones together, and a single Undo reverts them all.
{"type":"plan","title":"Tidy the Notebook","steps":[ {…}, {…} ]}
Allowed in a plan: copy_post, set_example, set_guide, add_task, add_project, edit_task, edit_project, edit_auto, schedule, move, done, note, note_place, note_task, note_attach, note_edit, note_archive, add_world, approve, remember, forget (timer, auto, prepare, share, set_text, change are not allowed in a plan, propose them alone). At most 40 steps.
To refer in a later step to a record opened in the same plan, give the opening step a "ref" and write "@ref" instead of an id in the later step: {"type":"add_project","name":"Launch","worldId":"…","ref":"p1"}, {"type":"note_task","noteId":"…","projectId":"@p1"}.`;

// If Rou's code change (change) is off, the model never sees it.
const actions = () => changeOn() ? ACTIONS_ALL : ACTIONS_ALL.split("\n").filter((l) => !l.startsWith('{"type":"change"')).join("\n")
  + "\nCode change (change) is off in this setup: if a request cannot be done with the ready-made actions, briefly say you cannot do it, and do not propose change.";
const SHOW = `Showing: if the user wants to see an output, post, Reel or tweet (e.g. "show today's LinkedIn post", "how did the last Reel turn out"), put those outputs' runIds in the "show" field (at most 3). The app shows them in the chat in their real form (preview, video); do not repeat the content in the text, a short comment is enough. Showing needs no approval and is not an action.`;

const WHO_TALKS = (s) => ({ user: userName(s), rou: "Rou" });

// rou: the speaking Rou (state.rous). Rous other than the default speak with their own name and the role instruction the user gave.
function prompt(s, lens, messages, rou = rouOf(s)) {
  const me = userName(s);
  // Was the card of the action it proposed approved: an unapproved suggestion counts as not done.
  const saved = s.chat?.[rou.id] ?? [];
  const actTag = (m) => {
    const x = m.action ? m : saved.find((y) => y.role === "rou" && y.at === m.at && y.text === m.text);
    if (!x?.action || ["undo_change", "show"].includes(x.action.type)) return "";
    return x.act ? " [the action it proposed was approved and done]" : " [the action it proposed was NOT approved, not done]";
  };
  const talk = messages.slice(-12).map((m) => `${m.role === "rou" ? rou.name : WHO_TALKS(s)[m.role] ?? me}${m.role === "rou" ? actTag(m) : ""}: ${m.text}`).join("\n\n");
  const others = s.rous?.filter((r) => r.id !== rou.id).map((r) => r.name) ?? [];
  return [
    rou.id === DEFAULT_ROU && rou.name === "Rou"
      ? "You are Rou: the assistant that lives inside Playgrounds, the user's personal planner. You speak warmly, briefly and clearly; like a friend who knows the work."
      : `Your name is ${rou.name}. You are one of the assistants (Rous) that live inside Playgrounds, the user's personal planner. You speak warmly, briefly and clearly; like a friend who knows the work.`,
    me !== "user" ? `The user's name: ${me}.` : "",
    rou.persona?.trim() ? `The role instruction the user gave you (act by it):\n${rou.persona.trim()}` : "",
    s.chatSummary?.[rou.id]?.text ? `Summary of your earlier conversations with the user (the latest messages are given separately below):\n${s.chatSummary[rou.id].text}` : "",
    others.length ? `Other Rous: ${others.join(", ")}. Each has its own chat and its own memory; the shared memory belongs to all of you.` : "",
    "Rules: answer in the language the user writes in (if the user mixes languages, use the language of their last message). Keep it short: most answers are 1-3 sentences or a short list. Do not use em dashes (—). In the app, things to do are called 'tasks': say 'task' to the user (add a task, open the task, today's tasks). Rely only on the data below; do not invent tasks, dates, numbers or events that are not in the data, and say so when you do not know. Do not use Markdown headings; use short bullet points if needed.",
    "Memory: if the user states a lasting fact or preference (job, salary expectation, working hours, likes and dislikes, general writing style) or says 'remember this', propose remember; if a fact changed, first delete the old one with forget. Do not remember temporary things (today's mood, a one-off task). Use what is in your memory in your answers. [shared] entries are known to all Rous, [own] entries only to you.",
    "Lasting decisions go on the record: if the user makes a lasting decision for a project or an automation (tone, audience, a rule, something to avoid, posting days, who does it, visual or not, deadline), write it not to memory but to the relevant record: edit_project for a project (tone and rules into brand, what the project is into description), edit_auto for an automation (instruction, days, times). If the decision also affects that project's automations (e.g. the instruction names the old tone), propose all of them in one plan. Keep the old text, change only what changed; if the decision is unclear or it is not clear which project, ask briefly. remember is only for facts about the user themselves.",
    "Taking action: if the user asks you to do something (start, add, move, finish, note, approve, set up an automation, prepare, remember, forget, create a world; or anything else such as changing the app, the server, something on the computer), propose it with action. Never say you cannot do something: if the ready-made actions are not enough, do it yourself with change. When the user asked for something, the action is applied immediately together with your answer, with no approval step: say in one sentence in the present tense what you are doing (e.g. \"I am preparing the post again: the name will be written in full, and it will have only the cover image.\"). Do not say 'if you approve', 'shall I', 'would you like', do not ask permission. Only share, approve, forget and set_guide replace wait for the user's approval on the card; for these, the sentence should say it is waiting for approval (e.g. \"If you approve, I will share it now.\"). If you are going to suggest an action on your own idea, without the user asking, do not give an action, ask in the text. A past suggestion marked [the action it proposed was NOT approved] was not done: if the user asks for the same thing again, say so and propose the card again. If the user asks you for a job (e.g. clean up the subscriptions in Gmail, do something on a site), first open that job as a task assigned to Rou in the relevant world (personal jobs in the Personal world) so it can be followed from its card; do the job yourself. Jobs and sharing are always yours. If it is unclear which job, give no action, ask briefly. Take ids only from the (id:...) and (runId:...) values in the data, never invent them. Write dates as YYYY-MM-DD relative to today.",
    "Which post: if the user describes a post by its day and topic (\"yesterday's launch post\", \"Tuesday's\", \"the late post\"), pick the output by the TASK'S DAY and by the topic the text covers: the output whose \"task day\" is that day and whose text covers that topic. Several tasks can share a name; do not pick by name or by the newest output. The \"prepared\" time is not the task's day: yesterday's post may have been prepared again today. \"Late\" means only a task marked LATE. If the brand or project named in the message does not appear in the chosen output's text or topic, that output is wrong. If day and topic do not meet in one output, give no action, write the two candidates with their days and ask which. In your answer say which post you picked with its day and topic (e.g. \"I am preparing Tuesday's launch carousel again\").",
    "A decision already made is not asked again: if the user's decision is written in the data (an automation's permanent visual rules, its instruction, the project's brand, memory), do not ask \"should it always be like this?\" again; act by what is written.",
    "Notebook: the user's quick notes. If they ask you to tidy, distribute or sort the Notebook (or say 'Tidy the Notebook'), read each waiting note and propose the best place: if it belongs to a world's project and is something to do, note_task (give the project and day if known), if it is part of an existing task, note_attach, if it only belongs to a place, note_place, if it is messy, note_edit, if it is done or unnecessary, note_archive. Do not put a note you are unsure about into the plan, ask briefly in the text (which world?). If a topic with no project appears in several notes, open a project with add_project + ref and put the notes in it. Propose all of it in one plan; give a short summary in the text (e.g. \"7 notes: 4 to tasks, 2 to a project, 1 to the archive.\"), do not count the notes one by one, the card already shows them.",
    actions(),
    SHOW,
    `Playgrounds data (now):\n${snapshot(s, lens)}`,
    `Conversation:\n${talk}`,
    `Answer the last message as ${rou.name}. Your output must be ONLY a single JSON object, write nothing else: {"text":"your answer","action":null,"show":[]} (action or show may be filled).`,
  ].filter(Boolean).join("\n\n");
}

// A proposal: a single object or a plan. If the model wrote an "actions" array it becomes a plan; a one-step plan becomes a single proposal.
const isAct = (a) => a && typeof a === "object" && typeof a.type === "string";
function actionOf(j) {
  let a = isAct(j.action) ? j.action : Array.isArray(j.actions) && j.actions.length ? { type: "plan", title: "", steps: j.actions } : null;
  if (a?.type === "plan") {
    const steps = (Array.isArray(a.steps) ? a.steps : []).filter(isAct).slice(0, 40);
    a = steps.length > 1 ? { type: "plan", title: typeof a.title === "string" ? a.title : "", steps } : steps[0] ?? null;
  }
  return a;
}

// Extracts the JSON from the model's output; if it is broken, takes it as plain text.
function parse(out) {
  const m = out.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (typeof j.text === "string") return { text: j.text.trim(), action: actionOf(j), show: Array.isArray(j.show) ? j.show.filter((x) => typeof x === "string").slice(0, 3) : [], ask: typeof j.ask === "string" && j.ask.trim() ? j.ask.trim().slice(0, 600) : "" };
    } catch { /* plain text */ }
  }
  return { text: out.trim(), action: null, show: [], ask: "" };
}

export async function ask(messages, lens, rouId) {
  const { state } = read();
  // Attachments: those in the last 6 messages are added to the message as lines; images, video frames and documents are opened with Read (read-only).
  const read_ = [];
  const withFiles = [];
  for (const [i, m] of messages.entries()) {
    if (!m.files?.length || i < messages.length - 6) { withFiles.push(m); continue; }
    const d = await describeFiles(m.files);
    read_.push(...d.read);
    withFiles.push({ ...m, text: `${m.text}${d.lines.length ? `\n[Attachments]\n${d.lines.join("\n")}` : ""}` });
  }
  const look = read_.length ? "\n\nAttachments: open the images, video frames and documents the user attached with the Read tool and really look at them; base your answer on what you see. In a proposal to change the app's code (change), put the file names of the relevant attachments in the files field." : "";
  const r = await runClaude(prompt(state, lens, withFiles, rouOf(state, rouId)) + look, read_.length ? 240000 : 120000, undefined,
    read_.length ? { args: ["--allowedTools", "Read", "--add-dir", MEDIA_DIR] } : {});
  if (!r.ok) return { ok: false, error: r.error.slice(0, 300) };
  const { ask: _ask, ...out } = parse(r.out);
  void summarize(rouOf(state, rouId).id);
  return { ok: true, ...out };
}

// Long chat: Rou sees the last 12 messages on every question. Messages that fall out of this window are folded into a short summary in the background
// (state.chatSummary[rouId] = { text, upTo }); the summary is given on every question, so the old conversation is not forgotten but the context does not bloat.
// Lasting facts (preferences, decisions) are still written to memory (remember).
const KEEP = 12;
const summarizing = new Set();
export async function summarize(rouId) {
  if (summarizing.has(rouId)) return;
  const { state: s } = read();
  const list = (s.chat?.[rouId] ?? []).filter((m) => m.text?.trim() && !m.error);
  const prev = s.chatSummary?.[rouId];
  const old = list.slice(0, -KEEP).filter((m) => m.at && (!prev?.upTo || m.at > prev.upTo));
  if (old.length < 8) return;
  summarizing.add(rouId);
  try {
    const r = await runClaude([
      "You are summarizing the old chat between the user and their assistant Rou. The summary is so Rou can remember this conversation later.",
      prev?.text ? `Summary so far:\n${prev.text}` : "",
      `Messages to add to the summary:\n${old.map((m) => `${m.role === "rou" ? "Rou" : userName(s)} (${m.at.slice(0, 10)}): ${m.text.slice(0, 800)}`).join("\n")}`,
      "Rules: in the language the conversation is in, at most 1200 characters, short bullet points. Keep only what will be useful later: decisions made, requests, open tasks, the user's preferences. Drop greetings and repeated things. Do not invent. Do not use em dashes. Write ONLY the summary.",
    ].filter(Boolean).join("\n\n"), 90000, undefined, { tier: "fast" });
    if (r.ok && r.out.trim()) update((st) => { st.chatSummary = { ...(st.chatSummary ?? {}), [rouId]: { text: r.out.trim().replace(/^```\w*\n?|\n?```$/g, "").trim().slice(0, 1500), upTo: old[old.length - 1].at, at: new Date().toISOString() } }; });
  } finally { summarizing.delete(rouId); }
}
