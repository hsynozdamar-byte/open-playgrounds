import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Pause, Play, SkipForward } from "lucide-react";
import { type Ctx, inLens, projectOf, worldOf } from "../lib";
import { localTs, today } from "../date";
import { BREAK_OPTS, POMO_OPTS, breakLen, pomoLen, setLens, clock, elapsed, lastMode, saveMode, setMode, spent, start, stop, finish, pause, resume } from "../timer";
import { useNow } from "../ui/useNow";

// The big timer on the Focus page. A task is started with ▶ from the Today list below.
export function FocusTimer({ ctx }: { ctx: Ctx }) {
  const s = ctx.state;
  const t = s.timer;
  const now = useNow(!!t);
  const task = t ? s.tasks.find((x) => x.id === t.taskId) : undefined;
  const sec = t ? elapsed(t, now) : 0;
  const total = t?.length ? t.length * 60 : 0;
  // When the time is up the timer does not stop: it counts the overrun as +01:23.
  const over = !!total && sec >= total;
  const shown = over ? sec - total : total ? total - sec : sec;
  const pct = total ? Math.min(1, sec / total) : (sec % 3600) / 3600;
  const [pref, setPref] = useState(lastMode);
  const mode = t?.mode ?? pref;
  const [lens, setLensState] = useState({ f: pomoLen(), b: breakLen() });
  const pick = (f: number, b: number) => (setLensState({ f, b }), setLens(ctx.mutate, f, b));
  const w = task ? worldOf(s, task.worldId) : undefined;
  const R = 118, C = 2 * Math.PI * R;

  return (
    <section className="card focuscard" style={{ ["--w" as string]: w?.color ?? "var(--accent)" }}>
      <div className="fmode">
        <div className="seg">
          {(["free", "pomo"] as const).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => (saveMode(m), setPref(m), t && setMode(ctx.mutate, m))}>
              {m === "free" ? "Free" : "Pomodoro"}
            </button>
          ))}
        </div>
        {mode === "pomo" ? (
          <div className="plens">
            <span>Focus</span>
            <div className="seg sm">{POMO_OPTS.map((m) => <button key={m} className={lens.f === m ? "on" : ""} onClick={() => pick(m, lens.b)}>{m}</button>)}</div>
            <span>Break</span>
            <div className="seg sm">{BREAK_OPTS.map((m) => <button key={m} className={lens.b === m ? "on" : ""} onClick={() => pick(lens.f, m)}>{m}</button>)}</div>
            <span>min</span>
          </div>
        ) : (
          <p className="plens free">No time limit. Save when you finish.</p>
        )}
      </div>

      <div className={`bigring ph-${t?.phase ?? "idle"} ${over ? "is-over" : ""}`}>
        <svg viewBox="0 0 260 260">
          <circle cx="130" cy="130" r={R} className="track" />
          <motion.circle cx="130" cy="130" r={R} className="fill" strokeDasharray={C} animate={{ strokeDashoffset: C * (1 - (t ? pct : 0)) }} transition={{ duration: 0.6 }} />
        </svg>
        <div className="bigcenter">
          <span className="bigphase">{!t ? "Ready" : t.pausedAt ? "Paused" : over ? (t.phase === "break" ? "Break over" : "Time is up") : t.phase === "break" ? "Break" : t.mode === "pomo" ? `Pomodoro ${t.round}` : "Focus"}</span>
          <span className="bigclock">{t ? `${over ? "+" : ""}${clock(shown)}` : mode === "pomo" ? `${lens.f}:00` : "00:00"}</span>
          {task && <span className="bigtask">{task.title}</span>}
          {task && task.checklist.length > 0 && (
            <button className="bigsteps" onClick={() => ctx.open(task.id)}>
              {task.checklist.filter((c) => c.done).length}/{task.checklist.length} {task.checklist.length === 1 ? "step" : "steps"}
            </button>
          )}
        </div>
      </div>

      {t && task ? (
        <div className="fctl fslot">
          {t.phase === "break" ? (
            <button className="btn" onClick={() => start(ctx.mutate, task.id, "pomo", t.round + 1)}><SkipForward size={16} />Continue</button>
          ) : (
            <>
              {t.pausedAt
                ? <button className="btn wfill" onClick={() => resume(ctx.mutate)}><Play size={16} />Resume</button>
                : <button className="btn wfill" onClick={() => pause(ctx.mutate)}><Pause size={16} />Pause</button>}
              <button className="btn ghost" onClick={() => stop(ctx.mutate)}>Stop and save</button>
            </>
          )}
          <button className="btn ghost" onClick={() => finish(ctx.mutate, ctx.state)}>Finish task</button>
          <button className="btn ghost" onClick={() => ctx.open(task.id)}>Open task</button>
        </div>
      ) : (
        <p className="fhint fslot">Press ▶ on a task in the list below.</p>
      )}

    </section>
  );
}
