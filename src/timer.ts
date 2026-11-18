import type { State, Timer } from "./types";
import { toast } from "./ui/Toast";
import type { Mutate } from "./lib";
import { setStatus } from "./lib";
import { uid } from "./store";

// Pomodoro and break lengths are a user setting (stored in this browser); default 25 / 5 min.
const num = (k: string, d: number) => { try { return Number(localStorage.getItem(k)) || d; } catch { return d; } };
export const pomoLen = () => num("pg-pomo", 25);
export const breakLen = () => num("pg-break", 5);
export const POMO_OPTS = [15, 25, 45, 50, 90];
export const BREAK_OPTS = [5, 10, 15];
export function setLens(mutate: Mutate, focus: number, brk: number) {
  try { localStorage.setItem("pg-pomo", String(focus)); localStorage.setItem("pg-break", String(brk)); } catch { /* none */ }
  // A running pomodoro gets its new target right away.
  mutate((s) => {
    if (s.timer?.mode !== "pomo") return;
    s.timer = { ...s.timer, length: s.timer.phase === "break" ? brk : focus };
  });
}
// The current segment (since the last start or resume); 0 when paused.
const segment = (t: Timer, now = Date.now()) => (t.pausedAt ? 0 : Math.max(0, Math.floor((now - new Date(t.startedAt).getTime()) / 1000)));
export const elapsed = (t: Timer, now = Date.now()) => (t.base ?? 0) + segment(t, now);

// Saves the running focus time as a session (under 1 min in total is not saved). Returns the seconds not saved:
// when pausing, that time is carried on the timer (carry), so 50 s + 50 s of work is not lost.
export function commit(s: State, now = Date.now()) {
  const t = s.timer;
  if (!t || t.phase !== "focus") return 0;
  // Only the last segment (plus time carried from earlier short segments) is saved; earlier segments were saved when pausing.
  const seg = segment(t, now);
  const own = t.mode === "pomo" ? Math.min(seg, Math.max(0, t.length * 60 - (t.base ?? 0))) : seg;
  const sec = own + (t.carry ?? 0);
  if (sec < 60) return sec;
  const end = new Date(t.startedAt).getTime() + own * 1000;
  s.sessions.push({ id: uid(), taskId: t.taskId, start: new Date(end - sec * 1000).toISOString(), end: new Date(end).toISOString(), mode: t.mode });
  return 0;
}

export function start(mutate: Mutate, taskId: string, mode: Timer["mode"], round = 1) {
  mutate((s) => {
    commit(s);
    const prev = s.timer && s.tasks.find((x) => x.id === s.timer!.taskId);
    if (prev && prev.id !== taskId && prev.status === "doing") prev.status = "todo";
    const t = s.tasks.find((x) => x.id === taskId);
    if (t && t.status !== "doing") setStatus(t, "doing");
    s.timer = { taskId, startedAt: new Date().toISOString(), mode, phase: "focus", length: mode === "pomo" ? pomoLen() : 0, round };
  });
}

// Stop: the session is saved and the task stays "Doing". Done: the task is closed.
export function stop(mutate: Mutate, done = false) {
  mutate((s) => {
    const id = s.timer?.taskId;
    commit(s);
    s.timer = null;
    const t = id ? s.tasks.find((x) => x.id === id) : undefined;
    if (t && done) setStatus(t, "done");
  });
}

// Stops the timer and finishes the task; can be undone if pressed by mistake.
export function finish(mutate: Mutate, state: State) {
  const id = state.timer?.taskId;
  const prev = state.tasks.find((x) => x.id === id)?.status;
  stop(mutate, true);
  toast("Task marked as done", () => mutate((s) => { const t = s.tasks.find((x) => x.id === id); if (t && prev) setStatus(t, prev); }));
}

// Pause: the work so far is saved and the timer stops where it is. Resume: the same timer carries on.
export function pause(mutate: Mutate) {
  mutate((s) => {
    const t = s.timer;
    if (!t || t.pausedAt) return;
    const base = elapsed(t);
    const carry = commit(s);
    const { carry: _c, ...rest } = t;
    s.timer = { ...rest, base, pausedAt: new Date().toISOString(), ...(carry ? { carry } : {}) };
  });
}
export function resume(mutate: Mutate) {
  mutate((s) => {
    const t = s.timer;
    if (!t?.pausedAt) return;
    const { pausedAt: _p, ...rest } = t;
    s.timer = { ...rest, startedAt: new Date().toISOString() };
  });
}

export function toBreak(mutate: Mutate) {
  mutate((s) => {
    if (!s.timer) return;
    commit(s);
    // A break counts from zero: starting with the base left over from a pause during focus would show "Break over" at once.
    const { base: _b, pausedAt: _p, carry: _c, ...rest } = s.timer;
    s.timer = { ...rest, phase: "break", startedAt: new Date().toISOString(), length: breakLen() };
  });
}

export function setMode(mutate: Mutate, mode: Timer["mode"]) {
  mutate((s) => {
    if (!s.timer || s.timer.mode === mode || s.timer.phase !== "focus") return;
    // Changing the mode does not reset the time: the same session carries on, only the way of counting changes.
    // If 25 min are already past, the target extends to the next pomodoro boundary.
    const min = elapsed(s.timer) / 60;
    s.timer = { ...s.timer, mode, length: mode === "pomo" ? Math.ceil((min + 1) / pomoLen()) * pomoLen() : 0 };
  });
}

export const clock = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
export const spent = (sec = 0) => {
  const m = Math.round(sec / 60);
  if (!sec) return "";
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
};

export function chime() {
  try {
    const a = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime + i * 0.18;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g).connect(a.destination);
      o.start(t0);
      o.stop(t0 + 0.55);
    });
  } catch { /* no sound */ }
}
export function notify(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, silent: true });
  } catch { /* no notifications */ }
}
export const lastMode = (): Timer["mode"] => { try { return localStorage.getItem("pg-mode") === "pomo" ? "pomo" : "free"; } catch { return "free"; } };
export const saveMode = (m: Timer["mode"]) => { try { localStorage.setItem("pg-mode", m); } catch { /* none */ } };
export function startTask(mutate: Mutate, id: string) {
  const mode = lastMode();
  if (mode === "pomo" && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
  start(mutate, id, mode);
}
