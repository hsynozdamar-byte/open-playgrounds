import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { type Ctx, projectOf, secsOf, worldOf } from "../lib";
import { chime, clock, elapsed, notify, pause, resume, saveMode, setMode, spent, start, stop, finish, toBreak } from "../timer";
import { useNow } from "./useNow";
import { Check as CheckIcon } from "lucide-react";

// Pomodoro/mola geçişleri: hangi ekranda olursan ol çalışır.
export function useTimerEngine(ctx: Ctx) {
  const t = ctx.state.timer;
  const now = useNow(!!t);
  const fired = useRef("");
  const task = t ? ctx.state.tasks.find((x) => x.id === t.taskId) : undefined;
  const sec = t ? elapsed(t, now) : 0;
  const over = !!t && t.length > 0 && sec >= t.length * 60;
  useEffect(() => {
    if (!t || !over || fired.current === t.startedAt) return;
    fired.current = t.startedAt;
    chime();
    if (t.phase === "focus") {
      notify("Pomodoro bitti", `${task?.title ?? ""}. 5 dk mola.`);
      toBreak(ctx.mutate);
    } else notify("Mola bitti", "Devam etmeye hazır olduğunda başlat.");
  }, [over, t, task, ctx.mutate]);
  useEffect(() => {
    if (!t || !task) return void (document.title = "Playgrounds");
    // Süre dolunca sekmede de görünsün: başka sekmedeyken fark edilir.
    if (t.length && sec >= t.length * 60) return void (document.title = `${t.phase === "break" ? "Mola bitti" : "Süre doldu"} · ${task.title}`);
    const left = !t.length ? clock(sec) : clock(t.length * 60 - sec);
    document.title = `${left} · ${t.phase === "break" ? "Mola" : task.title}`;
  }, [t, task, sec]);
}

function useTimerView(ctx: Ctx) {
  const t = ctx.state.timer;
  const now = useNow(!!t);
  const task = t ? ctx.state.tasks.find((x) => x.id === t.taskId) : undefined;
  const sec = t ? elapsed(t, now) : 0;
  const total = t?.length ? t.length * 60 : 0;
  const over = !!total && sec >= total;
  const shown = over ? sec - total : total ? total - sec : sec;
  const pct = total ? Math.min(1, sec / total) : (sec % 3600) / 3600;
  const label = !t ? "" : t.pausedAt ? "Duraklatıldı" : t.phase === "break" ? (over ? "Mola bitti" : "Mola") : over ? "Süre doldu" : t.mode === "pomo" ? `Pomodoro ${t.round}` : "Odak";
  return { t, task, sec, shown, pct, over, label };
}

function Ring({ pct, size = 44 }: { pct: number; size?: number }) {
  const R = size / 2 - 3;
  const C = 2 * Math.PI * R;
  return (
    <svg className="ringsvg" viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }}>
      <circle cx={size / 2} cy={size / 2} r={R} className="track" />
      <motion.circle cx={size / 2} cy={size / 2} r={R} className="fill" strokeDasharray={C} animate={{ strokeDashoffset: C * (1 - pct) }} transition={{ duration: 0.6 }} />
    </svg>
  );
}

function Controls({ ctx, compact }: { ctx: Ctx; compact?: boolean }) {
  const { t, task, over } = useTimerView(ctx);
  if (!t || !task) return null;
  return (
    <div className="tctl">
      {t.phase === "focus" && !compact && (
        <div className="seg sm">
          {(["free", "pomo"] as const).map((m) => (
            <button key={m} className={t.mode === m ? "on" : ""} onClick={() => (saveMode(m), setMode(ctx.mutate, m))}>
              {m === "free" ? "Serbest" : "Pomodoro"}
            </button>
          ))}
        </div>
      )}
      {t.phase === "break" ? (
        <button className="btn" onClick={() => start(ctx.mutate, task.id, "pomo", t.round + 1)}>{over ? "Devam et" : "Molayı atla"}</button>
      ) : (
        <>
          {t.pausedAt
            ? <button className="btn wfill" onClick={() => resume(ctx.mutate)}>Devam et</button>
            : <button className="btn wfill" onClick={() => pause(ctx.mutate)}>Duraklat</button>}
          <button className="btn ghost sm" onClick={() => stop(ctx.mutate)}>Bitir, kaydet</button>
        </>
      )}
      <button className="btn ghost sm" onClick={() => finish(ctx.mutate, ctx.state)}>Görevi bitir</button>
    </div>
  );
}

// Diğer ekranlarda alttaki çubuk.
export function TimerBar({ ctx, hidden }: { ctx: Ctx; hidden: boolean }) {
  const { t, task, shown, pct, label, over } = useTimerView(ctx);
  const w = task ? worldOf(ctx.state, task.worldId) : undefined;
  return (
    <AnimatePresence>
      {t && task && w && !hidden && (
        <motion.div
          className="timerbar"
          style={{ ["--w" as string]: w.color }}
          initial={{ y: 90, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 90, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        >
          <button className="nowring sm" onClick={() => ctx.open(task.id)} aria-label="Görevi aç">
            <Ring pct={pct} size={40} />
            <span className="pulse" />
          </button>
          <div className="tinfo" onClick={() => ctx.open(task.id)}>
            <span className="eyebrow">{label} · {w.name}</span>
            <span className="ttitle">{task.title}</span>
          </div>
          <span className={`tclock ${over ? "is-over" : ""}`}>{over ? "+" : ""}{clock(shown)}</span>
          <Controls ctx={ctx} compact />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
