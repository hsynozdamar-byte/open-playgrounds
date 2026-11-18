// Notices: what the system reports back to the user (shared, not shared, left to you, waiting for approval, couldn't prepare).
// Kept in state.notices (newest first, at most MAX). The bell in the top bar and the Rou chat show the same records.
// A record only says what happened; the buttons (Try again, Open folder...) follow the task's CURRENT state (noticeCtas).
export const MAX = 80;
// Notices stay at most a week; older ones are removed, read or not.
export const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const freshNotices = (list, now = Date.now()) => (list ?? []).filter((n) => now - new Date(n.at).getTime() < KEEP_MS);
// Drops old notices; true when something changed (the store writes once while reading).
export function pruneNotices(st, now = Date.now()) {
  const before = st.notices?.length ?? 0;
  if (!before) return false;
  st.notices = freshNotices(st.notices, now);
  return st.notices.length !== before;
}
const id = () => Math.random().toString(36).slice(2, 8);

// kind: posted | share_failed | handoff | ready | failed
export function addNotice(st, n) {
  const run = n.runId ? st.runs?.find((r) => r.id === n.runId) : undefined;
  const task = st.tasks?.find((t) => t.id === (n.taskId ?? run?.taskId));
  const x = { id: id(), at: new Date().toISOString(), ...n, ...(task ? { taskId: task.id, worldId: task.worldId } : {}), title: n.title ?? task?.title ?? run?.title ?? "" };
  // An unread notice of the same kind for the same run is replaced (retries should not fill the list).
  const list = freshNotices(st.notices).filter((y) => !(y.runId && y.runId === x.runId && y.kind === x.kind && !y.read));
  st.notices = [x, ...list].slice(0, MAX);
  return x;
}

export const KIND_LINE = {
  posted: "Shared",
  share_failed: "Couldn't share",
  handoff: "Sharing is left to you",
  ready: "Waiting for your approval",
  failed: "Couldn't prepare",
  ask: "Rou is asking",
};

// Buttons from the task's current state: no "Try again" once it is shared, the card instead of "Review" once it is approved.
// Result: [{ id, label, primary? }]; the UI turns ids into actions (src/ui/Notices.tsx run).
export function noticeCtas(s, n) {
  const run = n.runId ? s.runs?.find((r) => r.id === n.runId) : undefined;
  const out = [];
  if (run?.status === "posted") {
    if (run.postUrl) out.push({ id: "view", label: "Open post", primary: true });
    out.push({ id: "card", label: "Open card" });
    return out;
  }
  if (n.kind === "share_failed" && run?.status === "approved" && !run.publish?.phase) out.push({ id: "retry", label: "Try again", primary: true });
  if (n.kind === "handoff" && run?.publish?.dir) out.push({ id: "folder", label: "Open folder", primary: true });
  if (n.kind === "ready" && run?.status === "ready") out.push({ id: "card", label: "Review", primary: true });
  if (n.kind === "ask" && run?.act?.question) out.push({ id: "card", label: "Answer", primary: true });
  // Couldn't prepare: look at the task's LATEST output (the old output stays "failed", so the button used to stay while a new
  // one was being prepared and could be pressed again and again). While a new one is preparing the button is "Preparing again" and disabled; once it is in, the card opens.
  if (n.kind === "failed") {
    const latest = (s.runs ?? []).find((r) => r.taskId === (n.taskId ?? run?.taskId));
    if (latest?.status === "working") out.push({ id: "busy", label: "Preparing again…", busy: true });
    else if (latest && latest.id !== run?.id && latest.status === "ready") out.push({ id: "card", label: "Review", primary: true });
    else if (run?.status === "failed" && (!latest || latest.status === "failed")) out.push({ id: "redo", label: "Prepare again", primary: true });
  }
  if (!out.some((c) => c.id === "card") && (n.taskId || run)) out.push({ id: "card", label: "Open card", primary: !out.length });
  return out;
}

// Where it stands now: a short line when the notice is out of date (couldn't share, but shared later).
export function noticeNow(s, n) {
  const run = n.runId ? s.runs?.find((r) => r.id === n.runId) : undefined;
  if (!run) return "";
  if (n.kind !== "posted" && run.status === "posted") return "Shared later";
  if (run.publish?.phase) return run.publish.phase;
  if (n.kind === "ask" && !run.act?.question) return "Answered";
  if (n.kind === "ready" && run.status !== "ready") return run.status === "approved" ? "Approved" : "";
  if (n.kind === "failed") {
    const latest = (s.runs ?? []).find((r) => r.taskId === run.taskId);
    if (latest && latest.id !== run.id) return latest.status === "working" ? (latest.phase ? `Preparing again: ${latest.phase}` : "Preparing again") : latest.status === "ready" ? "Prepared again, waiting for your approval" : latest.status === "approved" ? "Prepared again and approved" : "";
  }
  return "";
}

export const unreadNotices = (s) => freshNotices(s.notices).filter((n) => !n.read).length;
