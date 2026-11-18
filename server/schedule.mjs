// Scheduler for automations: checks once a minute while the server is up. Opens today's tasks (materialize);
// prepares Rou's task LEAD min before its time. Single tasks assigned to Rou go the same way. Outputs still wait for approval,
// nothing is shared without approval. Does not run while the computer sleeps; on waking it picks up today's missed tasks.
import { restartPending } from "./update.mjs";
import { read, update } from "./store.mjs";
import { materialize, needsMaterialize } from "../shared/repeat.mjs";
import { needsChrome } from "../shared/chrome.mjs";
import { accountOf, taskRef } from "../shared/social.mjs";

export const LEAD = 60; // min: timed tasks are prepared this long before
export const DAY_START = "07:00"; // tasks with no time are prepared after this time
export const AHEAD_AT = "12:00"; // Rou's automation tasks are prepared a day ahead, after this time (those with automation.ahead === false on their own day)

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

// A failed task is retried automatically: if the last output failed, RETRY_MIN min passed since the last attempt, and it was
// tried fewer than RETRY_MAX times today. Tasks where Rou asked a question, the user is needed (password, a file for the revision) or that were shared are not retried.
export const RETRY_MIN = 20, RETRY_MAX = 3;
// "Request a revision to try again": the banned phrase stayed in the second attempt too, a third attempt with the same note gives the same result.
// Both the old Turkish and the English wording of the failure texts are matched (they may be stored in existing data).
const NEEDS_YOU = /durduruldu|stopped|Rou soruyor|Rou asks|zaten paylaşıldı|already shared|şifre|password|dosya olarak ekle|as a file|Revize iste ile tekrar dene|revision note to try again|Request a revision/i;
const failText = (r) => `${r.renderError ?? ""} ${r.body ?? ""}`;
export function retryable(s, t, now = new Date()) {
  const runs = (s.runs ?? []).filter((r) => r.taskId === t.id);
  if (!runs.length || runs.some((r) => r.status === "posted" || r.status === "working")) return false;
  const last = runs.reduce((a, b) => (String(a.at ?? "") > String(b.at ?? "") ? a : b));
  if (!last.at || last.status !== "failed") return false;
  if (NEEDS_YOU.test(failText(last))) return false;
  if (now - new Date(last.at) < RETRY_MIN * 60 * 1000) return false;
  // The day is counted in local time (counting in UTC shifted the day boundary).
  const day = iso(now);
  return runs.filter((r) => r.status === "failed" && r.at && iso(new Date(r.at)) === day).length < RETRY_MAX;
}

// Tasks that must be prepared now. Pure function (tested).
export function dueNow(s, now = new Date()) {
  const today = iso(now);
  const tomorrow = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const min = now.getHours() * 60 + now.getMinutes();
  const out = { claude: [], chrome: [] };
  for (const t of s.tasks ?? []) {
    // A single task assigned to Rou: starts when its day comes (or has passed); if it has a calendar time, LEAD min before it.
    if (!t.autoId && t.who === "claude") {
      if (t.status === "done" || t.status === "waiting" || !t.day || t.day > today) continue;
      if ((s.runs ?? []).some((r) => r.taskId === t.id)) continue;
      const blk = (s.blocks ?? []).filter((b) => b.taskId === t.id && b.start.slice(0, 10) === today).map((b) => toMin(b.start.slice(11, 16))).sort((x, y) => x - y)[0];
      const at = t.day < today ? 0 : blk !== undefined ? Math.max(0, blk - LEAD) : toMin(DAY_START);
      if (min < at) continue;
      (needsChrome(t) ? out.chrome : out.claude).push(t.id);
      continue;
    }
    if (!t.autoId || t.status === "done") continue;
    const a = (s.automations ?? []).find((x) => x.id === t.autoId);
    if (!a || a.status !== "active" || a.who !== "claude") continue;
    // Tomorrow's task: prepared today after AHEAD_AT; approval is given a day ahead.
    const ahead = a.ahead !== false && t.day === tomorrow && (t.autoDay ?? t.day) === tomorrow;
    if (!ahead && (t.day !== today || (t.autoDay ?? t.day) !== today)) continue;
    const tried = (s.runs ?? []).filter((r) => r.taskId === t.id);
    if (tried.length && !retryable(s, t, now)) continue; // prepared, being prepared or already tried
    // A task tried before is due: a retry does not wait for the time (like tomorrow's task prepared ahead).
    const at = tried.length ? 0 : ahead ? toMin(AHEAD_AT) : t.autoSlot ? Math.max(0, toMin(t.autoSlot) - LEAD) : toMin(DAY_START);
    if (min < at) continue;
    out.claude.push(t.id);
  }
  return out;
}

let lastRetention = 0;
let lastTopics = "";
export function tick(now = new Date()) {
  if (needsMaterialize(read().state)) update((s) => void materialize(s, iso(now)));
  // An automation that skips approval (a.approve === false): the output is approved through the same path as Approve in the app (approveRun).
  // The task of a post to be shared stays open and is shared at its time; it used to be marked "done" here and the post never went out.
  // An output with missing voice, video or image is not approved, it waits on the card.
  const auto = (st, r) => { const t = st.tasks.find((x) => x.id === r.taskId); const a = t && st.automations.find((x) => x.id === t.autoId); return a?.approve === false ? t : null; };
  if (read().state.runs.some((r) => r.status === "ready" && auto(read().state, r))) import("./share.mjs").then(({ approveRun }) => update((st) => {
    for (const r of st.runs) if (r.status === "ready" && auto(st, r)) { try { approveRun(st, r.id, { via: "auto" }); } catch { /* incomplete: it waits */ } }
  })).catch((e) => console.error("approve:", e));
  // Stuck preparations are stopped; retryable below restarts them after 20 min.
  import("./prepare.mjs").then(({ stopStuck }) => { const x = stopStuck(); if (x.length) console.log("stuck preparation stopped:", x.join(", ")); }).catch((e) => console.error("watchdog:", e));
  const s = read().state;
  const d = dueNow(s, now);
  // If a restart for an update is pending, no new preparation starts; the tasks are picked up by the new server on the next tick.
  const hold = restartPending();
  if (!hold && d.claude.length) import("./prepare.mjs").then(({ prepareMany }) => prepareMany(d.claude)).catch((e) => console.error("prepare:", e));
  // Rou's Chrome tasks run directly without a plan; Rou picks the Chrome itself, and if none is connected the card says so and a notification goes out.
  if (d.chrome.length) import("./browse.mjs").then(async ({ startDirect }) => { for (const id of d.chrome) await startDirect(id); }).catch((e) => console.error("browser task:", e));
  // If the kit (look) changed, images waiting for approval are redrawn with the new kit; the old state stays in the version history.
  // An output that was tried once with this kit and could not be drawn (kitTried) is not retried: otherwise a broken render would restart every minute.
  import("./prepare.mjs").then(({ kitHash, kitOf, rerender }) => {
    const st = read().state;
    const stale = st.runs.filter((r) => r.status === "ready" && r.kitHash && r.images?.length && r.post && !r.phase).filter((r) => {
      const t = st.tasks.find((x) => x.id === r.taskId);
      const acc = t && accountOf(st, taskRef(st, t));
      const h = acc && kitHash(kitOf(st, acc, t));
      return acc && h !== r.kitHash && h !== r.kitTried;
    });
    for (const r of stale.slice(0, 2)) rerender(r.id, { why: "kit" });
  }).catch((e) => console.error("kit:", e));
  // Weekly topic plan: once a day, Rou fills the empty topic slots of the next 7 days (server/plan.mjs fillTopics).
  if (now.getHours() * 60 + now.getMinutes() >= toMin(DAY_START) && lastTopics !== iso(now)) {
    lastTopics = iso(now);
    import("./plan.mjs").then(({ addDays, fillTopics }) => fillTopics({ from: iso(now), until: addDays(iso(now), 7) })).then((r) => r.filled && console.log(`topics: planned the topic of ${r.filled} posts`)).catch((e) => console.error("topics:", e));
  }
  // Retention: once a day (server/retention.mjs).
  if (Date.now() - lastRetention > 864e5) {
    lastRetention = Date.now();
    import("./retention.mjs").then(({ retention }) => { const r = retention(); if (Object.values(r).some(Boolean)) console.log("retention:", r); }).catch((e) => console.error("retention:", e));
  }
  // Approved posts are shared at their time (server/share.mjs).
  import("./share.mjs").then(({ shareDue, fallbackDue }) => { shareDue(now); fallbackDue(now); }).catch((e) => console.error("share:", e));
  return d;
}

export function startSchedule() {
  if (process.env.PG_NO_SCHEDULE) return;
  setTimeout(() => { safe(); setInterval(safe, 60 * 1000); }, 15 * 1000);
}
const safe = () => { try { tick(); } catch (e) { console.error("scheduler:", e); } };
