import { AnimatePresence, motion } from "motion/react";
import { openPost } from "../ui/openPost";
import { runOfTask } from "../runs";
import { useState } from "react";
import type { Task } from "../types";
import { ArrowUpRight, Check, CheckCheck, ChevronDown, CircleCheck, Repeat, Send, Sparkles, Hand, CalendarClock } from "lucide-react";
import { accountOf, taskRef } from "../../shared/social.mjs";
import { setDay } from "../../shared/repeat.mjs";
import { type Ctx, ALL, inLens, inboxNew, worldOf } from "../lib";
import { addDays, dateShort, dayLong, dayName, dur, iso, relDay, spanMin, today, tsDay, tsMin, localTs } from "../date";
import { spent } from "../timer";
import { QuickAdd } from "../ui/QuickAdd";
import { TaskRow } from "../ui/TaskRow";
import { FocusTimer } from "./Focus";
import { useNow } from "../ui/useNow";
import { Calendar } from "./Calendar";
import { type Who, autoOf, whoOf } from "../ui/Auto";
import { whereText } from "../ui/Board";
import { stagesOf } from "../../shared/stages.mjs";
import { TitleRow } from "../ui/PageHead";

const cap = (x: string) => x.replace(/^./, (c) => c.toLocaleUpperCase("en-US"));

const card = (i: number) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * 0.05, type: "spring" as const, stiffness: 260, damping: 28 } });

export function Today({ ctx }: { ctx: Ctx }) {
  const { state: s, route } = ctx;
  const t = today();
  const lens = route.lens;
  // Kim filtresi: herkes, sen, Rou. Tercih tarayıcıda kalır.
  const [who, setWhoState] = useState<Who | "all">(() => { try { const v = localStorage.getItem("pg-who"); return v === "me" || v === "claude" ? v : "all"; } catch { return "all"; } });
  const setWho = (v: Who | "all") => { setWhoState(v); try { localStorage.setItem("pg-who", v); } catch { /* yok */ } };
  const lensed = s.tasks.filter(inLens(lens));
  const mine = who === "all" ? lensed : lensed.filter((x) => whoOf(s, x) === who);
  const blocksToday = s.blocks.filter(inLens(lens)).filter((b) => tsDay(b.start) === t);
  const firstMin = (x: Task) => Math.min(...blocksToday.filter((b) => b.taskId === x.id).map((b) => tsMin(b.start)), 1440);
  // Sıra: yapılıyor → elle sıralanan → saatine göre → saatsiz.
  const rank = (x: Task) => (x.status === "doing" ? -1 : x.order ?? 1000 + firstMin(x));

  // Bugün bitirilen iş, günü dün ya da tarihsiz olsa da bugünün işidir (Gecikenler'den bitirilen iş Tamamlananlar'a düşer).
  const doneToday = (x: Task) => x.status === "done" && !!x.doneAt && iso(new Date(x.doneAt)) === t;
  const todays = mine.filter((x) => x.day === t || x.status === "doing" || doneToday(x) || blocksToday.some((b) => b.taskId === x.id));
  // İşler kimin elindeyse orada: senin işlerin sürüklenebilir listede; Rou'nun işleri (otomasyon ya da atanmış) kendi gruplarında.
  const isBot = (x: Task) => whoOf(s, x) !== "me";
  const open = todays.filter((x) => x.status !== "done" && !isBot(x)).sort((a, b) => rank(a) - rank(b));
  const ready = (x: Task) => s.runs.some((r) => r.taskId === x.id && (r.status === "ready" || r.status === "approved"));
  const autos = mine.filter((x) => x.status !== "done" && isBot(x) && (x.day === t || ready(x) || (!autoOf(s, x) && !!x.day && x.day < t))).sort((a, b) => ((a.day ?? "") + (a.autoSlot ?? "")).localeCompare((b.day ?? "") + (b.autoSlot ?? "")));
  // Bugün yalnız bugünün (ve gecikenlerin) işleri; ileri günün hazır/onaylı işleri kendi gün başlığında durur
  // (bugünün altında yarının işleri de kalmasın, yarının kendi başlığı var).
  const later = (x: Task) => !!x.day && x.day > t;
  const rouList = autos.filter((x) => !later(x));
  const ahead = [...new Set(autos.filter(later).map((x) => x.day!))].sort().map((d) => ({ d, list: autos.filter((x) => x.day === d) }));
  const count = (k: Who) => lensed.filter((x) => x.status !== "done" && whoOf(s, x) === k && !later(x) && (x.day === t || (x.day && x.day < t) || ready(x) || blocksToday.some((b) => b.taskId === x.id))).length;
  const done = todays.filter((x) => x.status === "done");
  const shared = s.runs.filter((r) => r.status === "posted" && r.postedAt && iso(new Date(r.postedAt)) === t)
    .sort((a, b) => b.postedAt!.localeCompare(a.postedAt!))
    .map((r) => { const task = s.tasks.find((x) => x.id === r.taskId); return { r, task, acc: task ? accountOf(s, taskRef(s, task)) : undefined }; })
    .filter((x) => !x.task || inLens(lens)(x.task));
  const hhmm = (iso?: string) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "");
  const completed = [
    ...shared.map(({ r, task, acc }) => ({ key: r.id, task, r, acc, at: hhmm(r.postedAt), sort: r.postedAt ?? "" })),
    ...done.filter((x) => !shared.some((y) => y.task?.id === x.id)).map((x) => ({ key: x.id, task: x, r: undefined, acc: undefined, at: hhmm(x.doneAt ?? undefined), sort: x.doneAt ?? "" })),
  ].sort((a, b) => b.sort.localeCompare(a.sort));
  const overdue = mine.filter((x) => x.day && x.day < t && x.status !== "done" && x.status !== "doing" && !autos.includes(x));
  const [showDone, setShowDoneState] = useState(() => { try { return localStorage.getItem("pg-done-open") !== "0"; } catch { return true; } });
  const setShowDone = (v: boolean) => { setShowDoneState(v); try { localStorage.setItem("pg-done-open", v ? "1" : "0"); } catch { /* yok */ } };
  const [over, setOver] = useState<string | null>(null);

  const planned = blocksToday.reduce((n, b) => n + spanMin(b.start, b.end), 0);
  // Özetteki "takvimde": yalnız senin saatlerin (Rou'nun işleri senin zamanını almaz).
  const mineMin = blocksToday.filter((b) => { const x = b.taskId && s.tasks.find((y) => y.id === b.taskId); return !x || whoOf(s, x) === "me"; }).reduce((n, b) => n + spanMin(b.start, b.end), 0);
  const ids = new Set(mine.map((x) => x.id));
  const focus = s.sessions.filter((y) => ids.has(y.taskId) && localTs(new Date(y.start)).slice(0, 10) === t).reduce((m, y) => m + (new Date(y.end).getTime() - new Date(y.start).getTime()) / 1000, 0);
  const deadlines = [
    ...mine.filter((x) => x.deadline && x.status !== "done" && x.deadline >= t && x.deadline <= addDays(t, 14)).map((x) => ({ id: x.id, title: x.title, d: x.deadline!, w: x.worldId, task: true })),
    ...s.projects.filter(inLens(lens)).filter((p) => p.deadline && p.status !== "done" && p.deadline >= t && p.deadline <= addDays(t, 14)).map((p) => ({ id: p.id, title: p.name, d: p.deadline!, w: p.worldId, task: false })),
  ].sort((a, b) => a.d.localeCompare(b.d));
  const inbox = inboxNew(s, lens).length;
  const w = lens === ALL ? null : worldOf(s, lens);

  // Listeye bırakılan iş: bugüne alınır ve bırakıldığı satırın önüne yerleşir.
  const drop = (id: string, before: string | null) =>
    ctx.mutate((st) => {
      const moved = st.tasks.find((x) => x.id === id);
      if (!moved) return;
      if (moved.day !== t) setDay(st, moved, t);
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
      {/* Odak: zamanlayıcı en başta, yanında günün özeti. */}
      <div className="hometimer"><FocusTimer ctx={ctx} /></div>
      <motion.section className="card hero" {...card(0)}>
        <div className="herotext">
          <TitleRow ctx={ctx}>{dayName(t)}, {dateShort(t)}</TitleRow>
          <DayStrip ctx={ctx} blocks={blocksToday} />
          <TodayNow ctx={ctx} blocks={blocksToday} />
          <div className="kpis">
            <Kpi n={open.length} label="open" />
            <Kpi n={done.length} label="done" />
            <Kpi n={mineMin ? dur(mineMin) : "0"} label="planned" />
            <Kpi n={focus >= 60 ? spent(focus) : "0"} label="focused" />
          </div>
        </div>
        {inbox > 0 && (
          <button className="nudge" onClick={() => ctx.go({ view: "inbox" })}>
            <b>{inbox}</b> in the notebook <span>Open →</span>
          </button>
        )}
      </motion.section>


      {/* Bugün: solda işlerin listesi, sağda saatleri. Aynı işler iki yerde tekrar etmez. */}
      <motion.section className="card tasks todaycard" {...card(2)}>
        {/* Bugün (2026-10-29): solda iş ekleme + Sen/Rou grupları (hepsi aynı görünüm), sağda ayrı panelde günün saatleri. */}
        <div className="todaygrid">
        <div className="tlist">
          <div className="thead">
            <h3>Today</h3>
            <span className="n">{open.length + rouList.length}</span>
            <div className="whofilter" role="tablist" aria-label="Who does it">
              {([["all", "Everyone"], ["me", "You"], ["claude", "Rou"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={who === k} className={who === k ? "on" : ""} onClick={() => setWho(k)}>{l}{k !== "all" && <span>{count(k)}</span>}</button>
              ))}
            </div>
          </div>

          {overdue.length > 0 && (
            <div className="overdue">
              <div className="subhead">
                <span>Late · {overdue.length}</span>
                <button className="link" onClick={() => { const ids = new Set(overdue.map((x) => x.id)); ctx.mutate((st) => st.tasks.forEach((x) => ids.has(x.id) && x.day && x.day < t && x.status !== "done" && setDay(st, x, t))); }}>Move all to today</button>
              </div>
              <ul className="list">
                <AnimatePresence initial={false}>
                  {overdue.map((x) => <TaskRow key={x.id} task={x} ctx={ctx} o={{ day: true, world: lens === ALL, project: true, card: true }} />)}
                </AnimatePresence>
              </ul>
            </div>
          )}

          {(who === "all" || who === "me") && (<>
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
          </>)}
          {who === "claude" && autos.length === 0 && <p className="empty">Nothing for Rou today. Open a task and pick Rou in the Who row.</p>}
          {([["claude", rouList, <Sparkles size={14} />, "Your turn comes when it needs approval or a voice recording"]] as const).map(([k, list, icon, about]) => list.length > 0 && (
            <div key={k} className="tgroup tautos">
              <h4 className="tgrouphead">{icon}Rou's tasks<span>{list.length}</span><em>{about}</em></h4>
              <ul className="list">{list.map((x) => <TaskRow key={x.id} task={x} ctx={ctx} o={{ world: lens === ALL, project: true, day: x.day !== t, card: true }} />)}</ul>
            </div>
          ))}
          {ahead.map(({ d, list }) => (
            <div key={d} className="tgroup tautos">
              <h4 className="tgrouphead"><CalendarClock size={14} />{cap(relDay(d))}<span>{list.length}</span><em>You can approve the ready ones now</em></h4>
              <ul className="list">{list.map((x) => <TaskRow key={x.id} task={x} ctx={ctx} o={{ world: lens === ALL, project: true, card: true }} />)}</ul>
            </div>
          ))}
          {/* Tamamlananlar: bugün biten işler ve bugün paylaşılan gönderiler tek listede; paylaşılanın yanında gönderiye giden düğme. */}
          {completed.length > 0 && (
            <div className="tgroup tdone">
              <button className="tgrouphead tfold" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
                <CheckCheck size={15} />Completed<span>{completed.length}</span>
                <ChevronDown size={16} className={`tfoldi ${showDone ? "is-open" : ""}`} />
              </button>
              <AnimatePresence initial={false}>
                {showDone && (
                  <motion.ul className="list donelist" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                    {completed.map(({ key, task, r, acc, at }) => (
                      <li key={key} className="row donerow" onClick={() => task && ctx.open(task.id)}>
                        <span className="tsok"><Check size={13} strokeWidth={2.8} /></span>
                        <div className="rbody">
                          <span className="rtitle">{task?.title ?? r?.title}</span>
                          <span className="tsmeta">{r ? "Done, shared" : "Done"}{acc ? ` · ${acc.name}` : task && lens === ALL ? ` · ${worldOf(s, task.worldId).name}` : ""}{at ? ` · ${at}` : ""}</span>
                        </div>
                        {r?.postUrl && <a className="btn sm" href={r.postUrl} target="_blank" rel="noreferrer" onClick={(e) => openPost(r, e)}>Open post<ArrowUpRight size={13} /></a>}
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

// Günün şekli: 00–24 arası bloklar dünya renginde, şu an bir çizgi.
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

// Günün şu anı: şimdi ne var, sıradaki ne zaman, süresi dolan ve bugün teslim olan. Satıra basınca iş açılır.
function TodayNow({ ctx, blocks }: { ctx: Ctx; blocks: Ctx["state"]["blocks"] }) {
  const s = ctx.state;
  const t = today();
  useNow(true, 30000);
  const n = new Date();
  const nowM = n.getHours() * 60 + n.getMinutes();
  const task = (id?: string | null) => (id ? s.tasks.find((x) => x.id === id) : undefined);
  // Rou'nun yaptığı otomasyon işleri senin saatin değil: "şimdi/sıradaki/saati geçti"ye girmez, ayrı satırda özetlenir.
  const bot = (id?: string | null) => { const x = task(id); const a = x && autoOf(s, x); return !!a && a.who !== "me"; };
  const live = blocks.filter((b) => task(b.taskId)?.status !== "done" && !bot(b.taskId)).sort((a, b) => a.start.localeCompare(b.start));
  const waiting = s.tasks.filter(inLens(ctx.route.lens)).filter((x) => x.status !== "done" && bot(x.id)).map((x) => {
    const st = stagesOf(s, autoOf(s, x)!, x, runOfTask(s.runs, x.id));
    const cur = st.steps.find((y) => y.key === st.current);
    // Hazırlanamayan da senden bekleniyor (Gönderiler'in "Onayını bekliyor"u gibi): yeniden hazırlat ya da revize et.
    if (!st.busy && runOfTask(s.runs, x.id)?.status === "failed") return { x, what: "Error" };
    return !st.busy && cur?.who === "You" ? { x, what: cur.key === "voice" ? "Voice" : cur.key === "approve" ? "Approval" : "Action" } : null;
  }).filter(Boolean) as { x: Task; what: string }[];
  const cur = live.find((b) => tsMin(b.start) <= nowM && (tsMin(b.end) || 1440) > nowM);
  const next = live.find((b) => tsMin(b.start) > nowM);
  const ended = live.filter((b) => (tsMin(b.end) || 1440) <= nowM && s.timer?.taskId !== b.taskId);
  const due = s.tasks.filter(inLens(ctx.route.lens)).filter((x) => x.deadline === t && x.status !== "done");
  // Üç grup: senden beklenenler, senin saatlerin, Rou'nun bugünkü işleri. Her satır: saat · başlık · durum.
  type Row = { k: string; time: string; day?: string; title: string; meta: string; tone?: string; id?: string | null; sub?: string; auto?: boolean };
  // Satırın altı: hangi dünya › proje; otomasyon işiyse otomasyonun adı da (başlıktan farklıysa).
  const where = (x?: Task) => { if (!x) return ""; const w = s.worlds.find((y) => y.id === x.worldId); const p = x.projectId ? s.projects.find((y) => y.id === x.projectId) : undefined; return [w?.name, p?.name].filter(Boolean).join(" › "); };
  const hmOf = (ts: string) => ts.slice(11, 16);
  const mine: Row[] = [];
  if (cur) mine.push({ k: "cur", time: hmOf(cur.start), title: task(cur.taskId)?.title ?? "", meta: `Now · ${dur((tsMin(cur.end) || 1440) - nowM)} left`, tone: "now", id: cur.taskId });
  ended.forEach((b) => mine.push({ k: `ended-${b.id}`, time: hmOf(b.start), title: task(b.taskId)?.title ?? "", meta: "Time is up", tone: "over", id: b.taskId }));
  if (next) mine.push({ k: "next", time: hmOf(next.start), title: task(next.taskId)?.title ?? next.title ?? "", meta: `${dur(tsMin(next.start) - nowM)} sonra`, id: next.taskId });
  live.filter((b) => tsMin(b.start) > nowM && b !== next).slice(0, 3).forEach((b) => mine.push({ k: `later-${b.id}`, time: hmOf(b.start), title: task(b.taskId)?.title ?? b.title ?? "", meta: dur(tsMin(b.end) - tsMin(b.start)), id: b.taskId }));
  // Saate konmuş iş ikinci kez "Bugün teslim" satırı olarak çıkmaz; teslim notu saatli satıra eklenir.
  due.forEach((x) => {
    const row = mine.find((r) => r.id === x.id);
    if (row) { if (!/Due today/.test(row.meta)) row.meta = `${row.meta} · Due today`; return; }
    mine.push({ k: `due-${x.id}`, time: "", title: x.title, meta: "Due today", tone: "due", id: x.id });
  });
  // Gönderiler'le aynı dil (iki sayfa arasında kopukluk olmasın): başlık gönderinin konusu,
  // altında otomasyonun adı; bugün değilse günü de yazılır (yarının gönderileri bugünkü gibi duruyordu).
  const isAhead = (x: Task) => !!x.day && x.day > t;
  const dayOf = (x: Task) => (x.day && x.day < t ? cap(relDay(x.day)) : undefined);
  const asks: Row[] = waiting.filter((w) => !isAhead(w.x)).sort((a, b) => `${a.x.day ?? ""}${a.x.autoSlot ?? ""}`.localeCompare(`${b.x.day ?? ""}${b.x.autoSlot ?? ""}`)).map((w) => {
    const topic = w.x.topic?.title?.trim();
    return { k: `ask-${w.x.id}`, time: w.x.autoSlot ?? "", day: dayOf(w.x), title: topic || w.x.title, sub: [where(w.x), topic && topic !== w.x.title ? w.x.title : ""].filter(Boolean).join(" · "), auto: !!w.x.autoId, meta: w.what === "Approval" ? "Awaiting your approval" : w.what === "Error" ? "Couldn't prepare" : w.what === "Voice" ? "Waiting for your voice" : "Waiting for you", tone: w.what === "Error" ? "over" : "now", id: w.x.id };
  });
  const rou: Row[] = s.tasks.filter(inLens(ctx.route.lens)).filter((x) => x.day === t && x.status !== "done" && bot(x.id) && !waiting.some((w) => w.x.id === x.id))
    .sort((a, b) => (a.autoSlot ?? "").localeCompare(b.autoSlot ?? ""))
    .map((x) => { const a = autoOf(s, x)!; const topic = x.topic?.title?.trim(); return { k: `bot-${x.id}`, time: x.autoSlot ?? "", title: topic || x.title, sub: [where(x), topic && topic !== x.title ? x.title : ""].filter(Boolean).join(" · "), auto: true, meta: whereText(stagesOf(s, a, x, runOfTask(s.runs, x.id)), runOfTask(s.runs, x.id)), tone: "bot", id: x.id }; });
  // İleri günlerde onay bekleyenler bugünün altında değil, kendi gün başlığında (Gönderiler'in Yarın sütunu gibi).
  const aheadAsks = waiting.filter((w) => isAhead(w.x));
  const aheadDays = [...new Set(aheadAsks.map((w) => w.x.day!))].sort();
  const toRow = (w: { x: Task; what: string }): Row => {
    const topic = w.x.topic?.title?.trim();
    return { k: `ask-${w.x.id}`, time: w.x.autoSlot ?? "", title: topic || w.x.title, sub: [where(w.x), topic && topic !== w.x.title ? w.x.title : ""].filter(Boolean).join(" · "), auto: !!w.x.autoId, meta: w.what === "Approval" ? "Awaiting your approval" : w.what === "Error" ? "Couldn't prepare" : "Waiting for you", tone: w.what === "Error" ? "over" : "now", id: w.x.id };
  };
  const groups = [
    { k: "ask", title: "Waiting for you", rows: asks, Icon: Hand },
    { k: "mine", title: "Your day", rows: mine, Icon: CalendarClock },
    { k: "rou", title: "Rou's tasks", rows: rou, Icon: Sparkles },
    ...aheadDays.map((d) => ({ k: `ahead-${d}`, title: `${cap(relDay(d))} · awaiting your approval`, rows: aheadAsks.filter((w) => w.x.day === d).sort((a, b) => (a.x.autoSlot ?? "").localeCompare(b.x.autoSlot ?? "")).map(toRow), Icon: CalendarClock })),
  ].filter((g) => g.rows.length);
  return (
    <div className="tnow">
      {groups.length === 0 ? (
        <p className="tnempty">{live.length ? "Today's planned hours are over." : "No hours planned today. Drag a task from the list below onto an hour."}</p>
      ) : (
        groups.map((g) => (
          <section key={g.k} className={`tngroup is-${g.k}`}>
            {/* Her grup kendi çerçevesinde, simgeli; satırlar ayrı kartlar (2026-11-01). */}
            <h3 className="tnh"><span className="tnhi"><g.Icon size={14} /></span>{g.title}<span>{g.rows.length}</span></h3>
            {g.rows.map((r) => (
              <button key={r.k} className={`tnrow ${r.tone ? `is-${r.tone}` : ""}`} onClick={() => r.id && ctx.open(r.id)} disabled={!r.id}>
                <span className="tnt">{r.day && <em>{r.day}</em>}{r.time}</span>
                <span className="tnb"><b>{r.auto && <Repeat size={13} className="tnrep" />}{r.title}</b>{(r.sub ?? where(task(r.id))) && <span>{r.sub ?? where(task(r.id))}</span>}</span>
                <span className="tnm">{r.meta}</span>
              </button>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
