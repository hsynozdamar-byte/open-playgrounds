import { motion } from "motion/react";
import { useEffect } from "react";
import { X } from "lucide-react";
import type { Ctx, Lens } from "../lib";
import { inLens } from "../lib";
import type { State, Task } from "../types";
import { addDays, dayLong, dur, range, relDay, spanMin, today, tsDay } from "../date";
import { setDay } from "../../shared/repeat.mjs";
import { Orb } from "./Orb";
import { StatusMark } from "./StatusMark";
import { toast } from "./Toast";

// Haftalık gözden geçirme (docs/PLAN.md akış E): dünya başına planlanan ve çalışılan süre,
// biten işler, kaçan deadline'lar, kalanları gelecek haftaya taşıma.
export function weekReview(s: State, lens: Lens, start: string, now = today()) {
  const end = addDays(start, 6);
  const inWeek = (d: string | null | undefined) => !!d && d >= start && d <= end;
  const tasks = s.tasks.filter(inLens(lens));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const worlds = s.worlds.filter((w) => lens === "all" || w.id === lens).map((w) => {
    const planned = s.blocks.filter((b) => b.worldId === w.id && inWeek(tsDay(b.start))).reduce((n, b) => n + spanMin(b.start, b.end), 0);
    const worked = s.sessions.filter((x) => byId.get(x.taskId)?.worldId === w.id && inWeek(localDay(x.start))).reduce((n, x) => n + Math.max(0, spanMin(x.start, x.end)), 0);
    return { w, planned, worked };
  }).filter((x) => x.planned || x.worked);
  const done = tasks.filter((t) => t.status === "done" && t.doneAt && inWeek(localDay(t.doneAt)));
  const missed = tasks.filter((t) => t.status !== "done" && inWeek(t.deadline) && t.deadline! < now);
  // Taşınacaklar: bu haftaya planlanmış, bitmemiş, kendi kendine tekrar açılmayan işler.
  const left = tasks.filter((t) => t.status !== "done" && !t.autoId && inWeek(t.day));
  return { start, end, worlds, done, missed, left };
}
const localDay = (isoTime: string) => {
  const d = new Date(isoTime);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Kalanlar gelecek haftanın pazartesisine; ileri saatleri de onlarla gider. Geri al hepsini eski gününe döndürür.
export function moveLeft(s: State, ids: string[], to: string) {
  for (const id of ids) {
    const t = s.tasks.find((x) => x.id === id);
    if (t && t.status !== "done") setDay(s, t, to);
  }
}

export function WeekReview({ ctx, start, onClose }: { ctx: Ctx; start: string; onClose: () => void }) {
  const s = ctx.state;
  const r = weekReview(s, ctx.route.lens, start);
  const next = addDays(start, 7);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  const totalPlan = r.worlds.reduce((n, x) => n + x.planned, 0);
  const totalWork = r.worlds.reduce((n, x) => n + x.worked, 0);
  const max = Math.max(1, ...r.worlds.map((x) => Math.max(x.planned, x.worked)));

  const carry = () => {
    const ids = r.left.map((t) => t.id);
    const was = r.left.map((t) => ({ id: t.id, day: t.day }));
    const blocks = s.blocks.filter((b) => b.taskId && ids.includes(b.taskId));
    ctx.mutate((st) => moveLeft(st, ids, next));
    toast(`${ids.length} görev ${dayLong(next)} gününe taşındı`, () => ctx.mutate((st) => {
      for (const w of was) { const t = st.tasks.find((x) => x.id === w.id); if (t) t.day = w.day; }
      st.blocks = [...st.blocks.filter((b) => !(b.taskId && ids.includes(b.taskId))), ...blocks];
    }));
  };

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="modal review" role="dialog" aria-label="Hafta özeti" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <header className="bkhead">
          <div>
            <h2>Hafta özeti</h2>
            <p>{range(start)} · {totalWork ? `${dur(totalWork)} çalışıldı` : "Çalışma kaydı yok"}{totalPlan ? `, ${dur(totalPlan)} planlıydı` : ""}</p>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </header>

        <section className="rvsec">
          <h3>Dünyalar</h3>
          {!r.worlds.length ? <p className="muted">Bu hafta planlanan ya da çalışılan süre yok.</p> : (
            <ul className="rvworlds">
              {r.worlds.map(({ w, planned, worked }) => (
                <li key={w.id} style={{ ["--w" as string]: w.color }}>
                  <span className="rvname"><Orb world={w} size={16} />{w.name}</span>
                  <span className="rvbars" aria-hidden>
                    <i className="plan" style={{ width: `${(planned / max) * 100}%` }} />
                    <i className="work" style={{ width: `${(worked / max) * 100}%` }} />
                  </span>
                  <span className="rvnum">{dur(worked)} <em>/ {dur(planned)}</em></span>
                </li>
              ))}
            </ul>
          )}
          {r.worlds.length > 0 && <p className="rvkey"><i className="work" />çalışılan <i className="plan" />planlanan</p>}
        </section>

        <div className="rvcols">
          <TaskList ctx={ctx} title="Biten" items={r.done} empty="Bu hafta biten görev yok." />
          <TaskList ctx={ctx} title="Kaçan deadline" items={r.missed} empty="Kaçan deadline yok." danger />
        </div>

        <section className="rvsec rvleft">
          <h3>Kalanlar <span className="n">{r.left.length}</span></h3>
          {r.left.length ? (
            <>
              <TaskList ctx={ctx} items={r.left} />
              <button className="btn primary" onClick={carry}>Kalan {r.left.length} görevi gelecek haftaya taşı</button>
            </>
          ) : <p className="muted">Bu haftaya planlı açık görev kalmadı.</p>}
        </section>
      </motion.div>
    </div>
  );
}

function TaskList({ ctx, title, items, empty, danger }: { ctx: Ctx; title?: string; items: Task[]; empty?: string; danger?: boolean }) {
  const list = items.slice(0, 6);
  const body = !items.length ? <p className="muted">{empty}</p> : (
    <ul className="rvtasks">
      {list.map((t) => (
        <li key={t.id} style={{ ["--w" as string]: ctx.state.worlds.find((w) => w.id === t.worldId)?.color }}>
          <button onClick={() => ctx.open(t.id)}>
            <StatusMark status={t.status} />
            <span className="t">{t.title}</span>
            <span className={`d ${danger ? "late" : ""}`}>{danger && t.deadline ? relDay(t.deadline) : t.day ? relDay(t.day) : ""}</span>
          </button>
        </li>
      ))}
      {items.length > list.length && <li className="more">ve {items.length - list.length} görev daha</li>}
    </ul>
  );
  if (!title) return body;
  return (
    <section className="rvsec">
      <h3>{title} <span className="n">{items.length}</span></h3>
      {body}
    </section>
  );
}
