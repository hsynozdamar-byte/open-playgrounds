// Automations. The app and pg use the same rule.
// On its days an automation (state.automations) opens that day's task for each of its times (Task: autoId + autoSlot).
// A task opens only when its day comes; later days show as faint "ghosts" on the calendar.
// horizon = the last day whose tasks were opened; a deleted task does not come back that day. Changing times/days resets horizon.

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const weekday = (day) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };
const rid = () => Math.random().toString(36).slice(2, 8);
const ts = (day, min) => { const m = Math.max(0, Math.min(24 * 60 - 1, min)); return `${day}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

export const KIND_LABEL = { text: "Text", image: "Image", video: "Video", post: "Share", other: "Other" };
export const TOOL_LABEL = { claude: "Rou", me: "Me" };
// No saved steps: derived from the old fields, the preparer's text.
export const stepsOf = (a) => a.steps?.length ? a.steps : [{ id: "s1", kind: "text", tool: a.who }];
export const stepText = (st) => [KIND_LABEL[st.kind] ?? st.kind, TOOL_LABEL[st.tool] ?? st.tool, st.account].filter(Boolean).join(" · ");
// Steps the preparing bot does not do: a checklist on every task.
export const manualSteps = (a) => stepsOf(a).filter((st) => a.who === "me" || st.tool !== a.who);

export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const repeatsOn = (a, day) => a.days.includes(weekday(day));
// An automation without times has one "slot": "" (no time of day).
export const slotsOf = (a) => (a.times?.length ? [...a.times].sort() : [""]);

function daysText(a) {
  const k = [...a.days].sort().join();
  if (k === "0,1,2,3,4,5,6") return "Every day";
  if (k === "1,2,3,4,5") return "Weekdays";
  if (k === "0,6") return "Weekends";
  return [1, 2, 3, 4, 5, 6, 0].filter((x) => a.days.includes(x)).map((x) => DAY_SHORT[x]).join(", ");
}
export const scheduleText = (a) => (a.every ? `${daysText(a)} · ${a.every.from}–${a.every.to} ${a.every.hours === 1 ? "every hour" : `every ${a.every.hours} hours`}` : a.times?.length ? `${daysText(a)} · ${slotsOf(a).join(", ")}` : daysText(a));
// Times of an interval automation: every N hours from `from` to `to` (inclusive).
export function everyTimes(e) {
  const toM = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const out = [];
  for (let m = toM(e.from); m <= toM(e.to) && out.length < 48; m += Math.max(1, e.hours) * 60) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out;
}

// The automation's task for one day and time: title, project, time and who does it come from the automation.
// Topics planned ahead are kept under this key: "YYYY-MM-DD HH:MM" (only the day when there is no time).
export const topicKey = (day, slot) => (slot ? `${day} ${slot}` : day);

// Rotating formats (a.formats, e.g. ig_reel, ig_post): picked by how many runs there have been from the first day up to this slot.
// Counted from the calendar (deleted tasks don't shift the order); future ghosts show the same format.
export function formatAt(a, day, slot) {
  const list = a.formats?.filter(Boolean) ?? [];
  if (list.length < 2) return a.format;
  const start = String(a.formatsFrom ?? a.createdAt ?? day).slice(0, 10);
  const slots = slotsOf(a);
  let n = 0;
  const [y, m, d] = start.split("-").map(Number);
  for (let i = 0; i < 4000; i++) {
    const cur = iso(new Date(y, m - 1, d + i));
    if (cur > day) break;
    if (!repeatsOn(a, cur)) continue;
    for (const sl of slots) { if (cur === day && sl >= slot) break; n++; }
    if (cur === day) break;
  }
  return list[n % list.length];
}

export function makeOccurrence(s, a, day, slot) {
  const task = {
    id: rid(), worldId: a.worldId, projectId: a.projectId, title: a.title, notes: "", status: "todo",
    day, deadline: null, estimate: a.minutes || null, checklist: (a.who === "me" ? (a.steps ?? []) : manualSteps(a)).map((st) => ({ id: rid(), text: stepText(st) + (st.note ? `: ${st.note}` : ""), done: false })), by: a.who === "me" ? "me" : a.who,
    createdAt: new Date().toISOString(), autoId: a.id, autoSlot: slot, autoDay: day,
  };
  if (a.formats?.length > 1) task.format = formatAt(a, day, slot);
  const topic = a.topics?.[topicKey(day, slot)];
  if (topic) { task.topic = topic; delete a.topics[topicKey(day, slot)]; }
  s.tasks.push(task);
  if (slot) s.blocks.push({ id: rid(), taskId: task.id, worldId: a.worldId, title: "", start: ts(day, toMin(slot)), end: ts(day, toMin(slot) + (a.minutes || 30)), kind: "plan" });
  return task;
}
// autoDay: the day the task belongs to. Moved to another day, it still holds its own day's place and doesn't block the new day's task.
export const occurrenceOf = (s, a, day, slot) => s.tasks.find((t) => t.autoId === a.id && (t.autoDay ?? t.day) === day && (t.autoSlot ?? "") === slot);

// Changes the task's day; its blocks on other days from today on move to the new day at the same time.
// Moved to no day or a past day, those future blocks go. Past blocks (work done) stay.
export function setDay(s, task, day, today = iso(new Date())) {
  if (task.autoId && task.autoDay === undefined && task.day) task.autoDay = task.day;
  task.day = day;
  s.blocks = s.blocks.flatMap((b) => {
    const d = b.start.slice(0, 10);
    if (b.taskId !== task.id || d < today || d === day) return [b];
    if (!day || day < today) return [];
    return [{ ...b, start: day + b.start.slice(10), end: day + b.end.slice(10) }];
  });
}

// Opens today's and tomorrow's tasks if they are not open yet (tomorrow's post is prepared today,
// approved a day ahead). horizon: the last day whose tasks are open. True when something changed.
const nextDay = (day) => { const [y, m, d] = day.split("-").map(Number); const x = new Date(y, m - 1, d + 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
export function materialize(s, today = iso(new Date())) {
  let changed = false;
  const tomorrow = nextDay(today);
  for (const t of s.tasks) if (t.autoId && t.autoDay === undefined && t.day) t.autoDay = t.day;
  for (const a of s.automations ?? []) {
    if (a.status !== "active" || (a.horizon && a.horizon >= tomorrow)) continue;
    for (const day of [today, tomorrow]) {
      if (a.horizon && a.horizon >= day) continue;
      if (!repeatsOn(a, day)) continue;
      for (const slot of slotsOf(a)) if (!occurrenceOf(s, a, day, slot)) makeOccurrence(s, a, day, slot);
    }
    a.horizon = tomorrow;
    changed = true;
  }
  return changed;
}
export const needsMaterialize = (s, today = iso(new Date())) => (s.automations ?? []).some((a) => a.status === "active" && !(a.horizon && a.horizon >= nextDay(today)));

// Next run: day + time (start of the day when there is no time).
export function nextRun(a, from = new Date()) {
  for (let i = 0; i < 8; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const day = iso(d);
    if (!a.days.includes(d.getDay())) continue;
    for (const slot of slotsOf(a)) {
      const at = slot ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), ...slot.split(":").map(Number)) : d;
      if (i > 0 || !slot || at > from) return { day, slot };
    }
  }
  return null;
}

