import type { State, Task, Timer } from "./types";
import { toast } from "./ui/Toast";
import type { Mutate } from "./lib";
import { setStatus } from "./lib";
import { uid } from "./store";

// Pomodoro ve mola süreleri kullanıcı ayarı (bu tarayıcıda saklanır); varsayılan 25 / 5 dk.
const num = (k: string, d: number) => { try { return Number(localStorage.getItem(k)) || d; } catch { return d; } };
export const pomoLen = () => num("pg-pomo", 25);
export const breakLen = () => num("pg-break", 5);
export const POMO_OPTS = [15, 25, 45, 50, 90];
export const BREAK_OPTS = [5, 10, 15];
export function setLens(mutate: Mutate, focus: number, brk: number) {
  try { localStorage.setItem("pg-pomo", String(focus)); localStorage.setItem("pg-break", String(brk)); } catch { /* yok */ }
  // Çalışan pomodoro varsa hedefi hemen güncellenir.
  mutate((s) => {
    if (s.timer?.mode !== "pomo") return;
    s.timer = { ...s.timer, length: s.timer.phase === "break" ? brk : focus };
  });
}
// Şu anki parça (son başlatma ya da devamdan beri); duraklatılmışsa 0.
const segment = (t: Timer, now = Date.now()) => (t.pausedAt ? 0 : Math.max(0, Math.floor((now - new Date(t.startedAt).getTime()) / 1000)));
export const elapsed = (t: Timer, now = Date.now()) => (t.base ?? 0) + segment(t, now);

// Çalışan odak süresini oturum olarak kaydeder (toplamı 1 dk altı kaydedilmez). Kaydedilmeyen saniyeyi döndürür:
// duraklatırken bu süre sayaçta (carry) taşınır, böylece 50 sn + 50 sn çalışma kaybolmaz.
export function commit(s: State, now = Date.now()) {
  const t = s.timer;
  if (!t || t.phase !== "focus") return 0;
  // Sadece son parça (ve önceki kısa parçalardan taşınan süre) kaydedilir; önceki parçalar duraklatırken kaydedildi.
  const seg = segment(t, now);
  const own = t.mode === "pomo" ? Math.min(seg, Math.max(0, t.length * 60 - (t.base ?? 0))) : seg;
  const sec = own + (t.carry ?? 0);
  if (sec < 60) return sec;
  const end = new Date(t.startedAt).getTime() + own * 1000;
  s.sessions.push({ id: uid(), taskId: t.taskId, start: new Date(end - sec * 1000).toISOString(), end: new Date(end).toISOString(), mode: t.mode });
  return 0;
}

function begin(s: State, taskId: string, mode: Timer["mode"], round = 1, length = mode === "pomo" ? pomoLen() : 0) {
  commit(s);
  const prev = s.timer && s.tasks.find((x) => x.id === s.timer!.taskId);
  if (prev && prev.id !== taskId && prev.status === "doing") prev.status = "todo";
  const t = s.tasks.find((x) => x.id === taskId);
  if (t && t.status !== "doing") setStatus(t, "doing");
  s.timer = { taskId, startedAt: new Date().toISOString(), mode, phase: "focus", length: mode === "pomo" ? length : 0, round };
}

export function start(mutate: Mutate, taskId: string, mode: Timer["mode"], round = 1) {
  mutate((s) => begin(s, taskId, mode, round));
}

// Sürükleyip bırakınca durum değişir (pano sütunu). "Yapılıyor"a bırakılan kendi işin sayacı başlar;
// çalışan iş başka sütuna bırakılınca sayaç durur ve süre kaydedilir. Rou'nun ve otomasyonun işi sayaç başlatmaz.
// (2026-11-18: bir kullanıcı işi "In progress"a sürükledi, sayaç başlamadı.)
export function dropStatus(s: State, id: string, status: Task["status"], mode: Timer["mode"] = "free", length = 25) {
  const t = s.tasks.find((x) => x.id === id);
  if (!t) return;
  const mine = !t.autoId && (!t.who || t.who === "me");
  if (status === "doing" && mine) {
    if (s.timer?.taskId !== id) begin(s, id, mode, 1, length);
  } else if (s.timer?.taskId === id) {
    commit(s);
    s.timer = null;
  }
  if (t.status !== status) setStatus(t, status);
}

// Durdur: oturum kaydedilir, iş "Yapılıyor"da kalır. Bitti: iş kapanır.
export function stop(mutate: Mutate, done = false) {
  mutate((s) => {
    const id = s.timer?.taskId;
    commit(s);
    s.timer = null;
    const t = id ? s.tasks.find((x) => x.id === id) : undefined;
    if (t && done) setStatus(t, "done");
  });
}

// Zamanlayıcıyı durdurup işi bitirir; yanlışlıkla basılırsa geri alınabilir.
export function finish(mutate: Mutate, state: State) {
  const id = state.timer?.taskId;
  const prev = state.tasks.find((x) => x.id === id)?.status;
  stop(mutate, true);
  toast("Görev bitti olarak işaretlendi", () => mutate((s) => { const t = s.tasks.find((x) => x.id === id); if (t && prev) setStatus(t, prev); }));
}

// Duraklat: o ana kadarki çalışma kaydedilir, sayaç kaldığı yerde durur. Devam et: aynı sayaç sürer.
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
    // Mola sıfırdan sayar: odak sırasındaki duraklatmadan kalan base ile başlasaydı "Mola bitti" hemen çıkardı.
    const { base: _b, pausedAt: _p, carry: _c, ...rest } = s.timer;
    s.timer = { ...rest, phase: "break", startedAt: new Date().toISOString(), length: breakLen() };
  });
}

export function setMode(mutate: Mutate, mode: Timer["mode"]) {
  mutate((s) => {
    if (!s.timer || s.timer.mode === mode || s.timer.phase !== "focus") return;
    // Mod değişince süre sıfırlanmaz: aynı oturum devam eder, sadece sayma biçimi değişir.
    // 25 dk'yı çoktan geçtiyse hedef bir sonraki pomodoro sınırına uzar.
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
  if (m < 1) return "<1 dk";
  if (m < 60) return `${m} dk`;
  return m % 60 ? `${Math.floor(m / 60)} sa ${m % 60} dk` : `${m / 60} sa`;
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
  } catch { /* ses yok */ }
}
export function notify(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body, silent: true });
  } catch { /* bildirim yok */ }
}
export const lastMode = (): Timer["mode"] => { try { return localStorage.getItem("pg-mode") === "pomo" ? "pomo" : "free"; } catch { return "free"; } };
export const saveMode = (m: Timer["mode"]) => { try { localStorage.setItem("pg-mode", m); } catch { /* yok */ } };
export function startTask(mutate: Mutate, id: string) {
  const mode = lastMode();
  if (mode === "pomo" && "Notification" in window && Notification.permission === "default") Notification.requestPermission();
  start(mutate, id, mode);
}
