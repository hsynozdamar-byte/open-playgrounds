import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Task } from "../types";
import { Check, CheckCheck, ChevronDown, CircleCheck, CalendarClock } from "lucide-react";
import { type Ctx, ALL, inLens, inboxNew, worldOf } from "../lib";
import { addDays, dateShort, dayName, dur, iso, spanMin, today, tsDay, tsMin, localTs } from "../date";
import { spent } from "../timer";
import { QuickAdd } from "../ui/QuickAdd";
import { TaskRow } from "../ui/TaskRow";
import { FocusTimer } from "./Focus";
import { useNow } from "../ui/useNow";
import { Calendar } from "./Calendar";
import { TitleRow } from "../ui/PageHead";

const card = (i: number) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.05, type: "spring" as const, stiffness: 260, damping: 28 } });

export function Today({ ctx }: { ctx: Ctx }) {
  const { state: s, route } = ctx;
  const t = today();
  const lens = route.lens;
  const mine = s.tasks.filter(inLens(lens));
  const blocksToday = s.blocks.filter(inLens(lens)).filter((b) => tsDay(b.start) === t);
  const firstMin = (x: Task) => Math.min(...blocksToday.filter((b) => b.taskId === x.id).map((b) => tsMin(b.start)), 1440);
  // Order: doing → ordered by hand → by time → no time.
  const rank = (x: Task) => (x.status === "doing" ? -1 : x.order ?? 1000 + firstMin(x));

  // A task finished today belongs to today even if its day was yesterday or unset.
  const doneToday = (x: Task) => x.status === "done" && !!x.doneAt && iso(new Date(x.doneAt)) === t;
  const todays = mine.filter((x) => x.day === t || x.status === "doing" || doneToday(x) || blocksToday.some((b) => b.taskId === x.id));
  const open = todays.filter((x) => x.status !== "done").sort((a, b) => rank(a) - rank(b));
  const done = todays.filter((x) => x.status === "done").sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? ""));
  const hhmm = (iso?: string) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "");
  const overdue = mine.filter((x) => x.day && x.day < t && x.status !== "done" && x.status !== "doing");
  const [showDone, setShowDoneState] = useState(() => { try { return localStorage.getItem("pg-done-open") !== "0"; } catch { return true; } });
  const setShowDone = (v: boolean) => { setShowDoneState(v); try { localStorage.setItem("pg-done-open", v ? "1" : "0"); } catch { /* storage blocked */ } };
  const [over, setOver] = useState<string | null>(null);

  const planned = blocksToday.reduce((n, b) => n + spanMin(b.start, b.end), 0);
  const ids = new Set(mine.map((x) => x.id));
  const focus = s.sessions.filter((y) => ids.has(y.taskId) && localTs(new Date(y.start)).slice(0, 10) === t).reduce((m, y) => m + (new Date(y.end).getTime() - new Date(y.start).getTime()) / 1000, 0);
  const inbox = inboxNew(s, lens).length;

  // A task dropped on the list moves to today and sits before the row it was dropped on.
  const drop = (id: string, before: string | null) =>
    ctx.mutate((st) => {
      const moved = st.tasks.find((x) => x.id === id);
      if (!moved) return;
      moved.day = t;
      const list = open.map((x) => x.id).filter((x) => x !== id);
      const at = before ? list.indexOf(before) : -1;
      list.splice(at < 0 ? list.length : at, 0, id);
      list.forEach((tid, i) => {
        const x = st.tasks.find((y) => y.id === tid);
        if (x) x.order = i;
      });
    });

  return (
    <div className="home">
      <div className="hometimer"><FocusTimer ctx={ctx} /></div>
      <motion.section className="card hero" {...card(0)}>
        <div className="herotext">
          <TitleRow ctx={ctx}>{dayName(t)}, {dateShort(t)}</TitleRow>
          <DayStrip ctx={ctx} blocks={blocksToday} />
          <TodayNow ctx={ctx} blocks={blocksToday} />
          <div className="kpis">
            <Kpi n={open.length} label="open" />
            <Kpi n={done.length} label="done" />
            <Kpi n={planned ? dur(planned) : "0"} label="planned" />
            <Kpi n={focus >= 60 ? spent(focus) : "0"} label="focused" />
          </div>
        </div>
        {inbox > 0 && (
          <button className="nudge" onClick={() => ctx.go({ view: "inbox" })}>
            <b>{inbox}</b> in the notebook <span>Open →</span>
          </button>
        )}
      </motion.section>

      {/* Today: the task list on the left, its hours on the right. */}
      <motion.section className="card tasks todaycard" {...card(2)}>
        <div className="todaygrid">
        <div className="tlist">
          <div className="thead">
            <h3>Today</h3>
            <span className="n">{open.length}</span>
          </div>

          {overdue.length > 0 && (
            <div className="overdue">
              <div className="subhead">
                <span>Late · {overdue.length}</span>
                <button className="link" onClick={() => { const late = new Set(overdue.map((x) => x.id)); ctx.mutate((st) => st.tasks.forEach((x) => { if (late.has(x.id) && x.day && x.day < t && x.status !== "done") x.day = t; })); }}>Move all to today</button>
              </div>
              <ul className="list">
                <AnimatePresence initial={false}>
                  {overdue.map((x) => <TaskRow key={x.id} task={x} ctx={ctx} o={{ day: true, world: lens === ALL, project: true, card: true }} />)}
                </AnimatePresence>
              </ul>
            </div>
          )}

          <div className="tgroup">
          <h4 className="tgrouphead"><CircleCheck size={15} />Your tasks<span>{open.length || ""}</span></h4>
          <ul
            className={`list droplist ${over === "end" ? "over-end" : ""} ${open.length ? "" : "is-empty"}`}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("text/pg-task")) return;
              e.preventDefault();
              const row = (e.target as HTMLElement).closest<HTMLElement>("[data-task]");
              setOver(row?.dataset.task ?? "end");
            }}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("text/pg-task");
              const hit = (e.target as HTMLElement).closest<HTMLElement>("[data-task]")?.dataset.task ?? null;
              const before = hit && hit !== id ? hit : null;
              setOver(null);
              if (id) drop(id, before);
            }}
          >
            <AnimatePresence initial={false}>
              {open.map((x) => (
                <div key={x.id} className={`dropslot ${over === x.id ? "over" : ""}`}>
                  <TaskRow task={x} ctx={ctx} o={{ world: lens === ALL, project: true, card: true }} />
                </div>
              ))}
            </AnimatePresence>
            {open.length === 0 && <li className="empty">Nothing for today yet. Type one below or drag one here from Projects.</li>}
          </ul>
          <div className="tadd"><QuickAdd ctx={ctx} preset={{ day: t }} placeholder="Add a task for today" /></div>
          </div>
          {done.length > 0 && (
            <div className="tgroup tdone">
              <button className="tgrouphead tfold" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
                <CheckCheck size={15} />Done<span>{done.length}</span>
                <ChevronDown size={16} className={`tfoldi ${showDone ? "is-open" : ""}`} />
              </button>
              <AnimatePresence initial={false}>
                {showDone && (
                  <motion.ul className="list donelist" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    {done.map((task) => (
                      <li key={task.id} className="row donerow" onClick={() => ctx.open(task.id)}>
                        <span className="tsok"><Check size={13} strokeWidth={2.8} /></span>
                        <div className="rbody">
                          <span className="rtitle">{task.title}</span>
                          <span className="tsmeta">Done{lens === ALL ? ` · ${worldOf(s, task.worldId).name}` : ""}{task.doneAt ? ` · ${hhmm(task.doneAt)}` : ""}</span>
                        </div>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
        <div className="tplan">
          <div className="thead">
            <h3>Hours</h3>
            {planned > 0 && <span className="n">{dur(planned)} planned</span>}
            <button className="link" onClick={() => ctx.go({ view: "calendar" })}>See the week →</button>
          </div>
          <p className="tplanhint">Drag a task onto an hour</p>
          <Calendar ctx={ctx} embedded />
        </div>
        </div>
      </motion.section>
    </div>
  );
}

function Kpi({ n, label }: { n: number | string; label: string }) {
  return (
    <span className="kpi">
      <motion.b key={String(n)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>{n}</motion.b>
      <span>{label}</span>
    </span>
  );
}

// The shape of the day: blocks from 00 to 24 in their world color, a line for now.
function DayStrip({ ctx, blocks }: { ctx: Ctx; blocks: Ctx["state"]["blocks"] }) {
  const A = 0, B = 24 * 60;
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const pos = (m: number) => `${Math.max(0, Math.min(100, ((m - A) / (B - A)) * 100))}%`;
  return (
    <div className="daystrip">
      <div className="dstrack">
        {blocks.map((b, i) => (
          <motion.button
            key={b.id}
            className="dsblk"
            title={b.start.slice(11, 16)}
            aria-label={`Block at ${b.start.slice(11, 16)}`}
            style={{ ["--w" as string]: worldOf(ctx.state, b.worldId).color, left: pos(tsMin(b.start)), width: `calc(${pos(tsMin(b.end) || 1440)} - ${pos(tsMin(b.start))})` }}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ delay: 0.2 + i * 0.05 }}
            onClick={() => b.taskId && ctx.open(b.taskId)}
          />
        ))}
        {nowM >= A && nowM <= B && <span className="dsnow" style={{ left: pos(nowM) }} />}
      </div>
      <div className="dslabels"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
    </div>
  );
}

// Right now: what is on, what is next, what ran over and what is due today. A row opens its task.
function TodayNow({ ctx, blocks }: { ctx: Ctx; blocks: Ctx["state"]["blocks"] }) {
  const s = ctx.state;
  const t = today();
  useNow(true, 30000);
  const n = new Date();
  const nowM = n.getHours() * 60 + n.getMinutes();
  const task = (id?: string | null) => (id ? s.tasks.find((x) => x.id === id) : undefined);
  const live = blocks.filter((b) => task(b.taskId)?.status !== "done").sort((a, b) => a.start.localeCompare(b.start));
  const cur = live.find((b) => tsMin(b.start) <= nowM && (tsMin(b.end) || 1440) > nowM);
  const next = live.find((b) => tsMin(b.start) > nowM);
  const ended = live.filter((b) => (tsMin(b.end) || 1440) <= nowM && s.timer?.taskId !== b.taskId);
  const due = s.tasks.filter(inLens(ctx.route.lens)).filter((x) => x.deadline === t && x.status !== "done");
  type Row = { k: string; time: string; title: string; meta: string; tone?: string; id?: string | null };
  const where = (x?: Task) => { if (!x) return ""; const w = s.worlds.find((y) => y.id === x.worldId); const p = x.projectId ? s.projects.find((y) => y.id === x.projectId) : undefined; return [w?.name, p?.name].filter(Boolean).join(" › "); };
  const hmOf = (ts: string) => ts.slice(11, 16);
  const rows: Row[] = [];
  if (cur) rows.push({ k: "cur", time: hmOf(cur.start), title: task(cur.taskId)?.title ?? cur.title, meta: `Now · ${dur((tsMin(cur.end) || 1440) - nowM)} left`, tone: "now", id: cur.taskId });
  ended.forEach((b) => rows.push({ k: `ended-${b.id}`, time: hmOf(b.start), title: task(b.taskId)?.title ?? b.title, meta: "Time is up", tone: "over", id: b.taskId }));
  if (next) rows.push({ k: "next", time: hmOf(next.start), title: task(next.taskId)?.title ?? next.title ?? "", meta: `In ${dur(tsMin(next.start) - nowM)}`, id: next.taskId });
  live.filter((b) => tsMin(b.start) > nowM && b !== next).slice(0, 3).forEach((b) => rows.push({ k: `later-${b.id}`, time: hmOf(b.start), title: task(b.taskId)?.title ?? b.title ?? "", meta: dur(tsMin(b.end) - tsMin(b.start)), id: b.taskId }));
  // A task with a time is not listed again as "Due today"; the note goes onto its timed row.
  due.forEach((x) => {
    const row = rows.find((r) => r.id === x.id);
    if (row) { if (!/Due today/.test(row.meta)) row.meta = `${row.meta} · Due today`; return; }
    rows.push({ k: `due-${x.id}`, time: "", title: x.title, meta: "Due today", tone: "due", id: x.id });
  });
  return (
    <div className="tnow">
      {rows.length === 0 ? (
        <p className="tnempty">{live.length ? "Today's planned hours are over." : "No hours planned today. Drag a task from the list below onto an hour."}</p>
      ) : (
        <section className="tngroup is-mine">
          <h3 className="tnh"><span className="tnhi"><CalendarClock size={14} /></span>Your day<span>{rows.length}</span></h3>
          {rows.map((r) => (
            <button key={r.k} className={`tnrow ${r.tone ? `is-${r.tone}` : ""}`} onClick={() => r.id && ctx.open(r.id)} disabled={!r.id}>
              <span className="tnt">{r.time}</span>
              <span className="tnb"><b>{r.title}</b>{where(task(r.id)) && <span>{where(task(r.id))}</span>}</span>
              <span className="tnm">{r.meta}</span>
            </button>
          ))}
        </section>
      )}
      {/* Deadlines within two weeks, so nothing due sneaks up. */}
      <Deadlines ctx={ctx} />
    </div>
  );
}

function Deadlines({ ctx }: { ctx: Ctx }) {
  const s = ctx.state;
  const t = today();
  const lens = ctx.route.lens;
  const list = [
    ...s.tasks.filter(inLens(lens)).filter((x) => x.deadline && x.status !== "done" && x.deadline > t && x.deadline <= addDays(t, 14)).map((x) => ({ id: x.id, title: x.title, d: x.deadline!, task: true, w: x.worldId })),
    ...s.projects.filter(inLens(lens)).filter((p) => p.deadline && p.status !== "done" && p.deadline >= t && p.deadline <= addDays(t, 14)).map((p) => ({ id: p.id, title: p.name, d: p.deadline!, task: false, w: p.worldId })),
  ].sort((a, b) => a.d.localeCompare(b.d)).slice(0, 4);
  if (!list.length) return null;
  return (
    <section className="tngroup is-ask">
      <h3 className="tnh"><span className="tnhi"><CalendarClock size={14} /></span>Coming up<span>{list.length}</span></h3>
      {list.map((x) => (
        <button key={x.id} className="tnrow" onClick={() => (x.task ? ctx.open(x.id) : ctx.go({ view: "projects", lens: x.w, project: x.id }))}>
          <span className="tnt">{dateShort(x.d)}</span>
          <span className="tnb"><b>{x.title}</b><span>{x.task ? "Task deadline" : "Project deadline"}</span></span>
          <span className="tnm">⚑</span>
        </button>
      ))}
    </section>
  );
}
