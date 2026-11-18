import { PageHead } from "../ui/PageHead";
import { WeekReview } from "../ui/WeekReview";
import { runOfTask } from "../runs";
import { AnimatePresence } from "motion/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Automation, Block, Task } from "../types";
import { type Ctx, ALL, blockTitle, dflt, inLens, newTask, worldOf } from "../lib";
import { addDays, dayLong, dayNum, dayShort, dur, fromMin, mkTs, range, spanMin, today, tsDay, tsMin, weekStart, localTs } from "../date";
import { uid } from "../store";
import { TaskList } from "../ui/TaskRow";
import { StatusMark } from "../ui/StatusMark";
import { useNow } from "../ui/useNow";
import { toast } from "../ui/Toast";
import { ArrowUpRight, CalendarX2, ChevronLeft, ChevronRight, Play, Repeat, Send } from "lucide-react";
import { startTask } from "../timer";
import { autoOf, doNow, ghosts, whoOf } from "../ui/Auto";
import { whereText } from "../ui/Board";
import { stagesOf } from "../../shared/stages.mjs";
import { openAutoForm } from "../ui/AutoForm";

const START = 0;
const END = 24;
const HOUR = 80;
// Kısa (15 dk) blok da okunur yükseklikte kalır: başlık ve durum işareti rahat sığar.
const MIN_BLK = 34;
const SNAP = 15;
const MINUTES = (END - START) * 60;

type Drag =
  | { kind: "move" | "top" | "bottom"; id: string; col: number; a: number; b: number; y0: number; x0: number; a0: number; b0: number; col0: number; moved: boolean; copy?: boolean; lane: number; of: number }
  | { kind: "create"; col: number; a: number; b: number; anchor: number; moved: boolean };

const isNarrow = () => typeof window !== "undefined" && window.innerWidth < 720;

export function Calendar({ ctx, embedded }: { ctx: Ctx; embedded?: boolean }) {
  const { state: s, route, mutate } = ctx;
  const t = today();
  const [mode, setMode] = useState<"week" | "day">(() => (embedded || isNarrow() ? "day" : "week"));
  const [anchor, setAnchor] = useState(t);
  // Uygulama gece yarısını açık geçerse bugünü gösteren takvim yeni güne geçer (yoksa dünün saatlerine iş bırakılır).
  const wasToday = useRef(t);
  useEffect(() => {
    const was = wasToday.current;
    if (was === t) return;
    wasToday.current = t;
    setAnchor((a) => (a === was ? t : a));
  }, [t]);
  const days = useMemo(() => (mode === "week" ? Array.from({ length: 7 }, (_, i) => addDays(weekStart(anchor), i)) : [anchor]), [mode, anchor]);
  const lens = route.lens;
  const blocks = s.blocks.filter(inLens(lens)).filter((b) => days.includes(tsDay(b.start)));
  const tasks = s.tasks.filter(inLens(lens));
  const cols = useRef<(HTMLDivElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  // Saat ızgarası pencerenin altına kadar uzar; altta yanlardaki gibi 12 px boşluk kalır.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (embedded || !el) return;
    const fit = () => {
      const card = el.closest(".cal") as HTMLElement | null;
      if (!card || window.innerWidth <= 1180) return el.style.removeProperty("height");
      const below = card.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
      el.style.height = `${Math.max(360, window.innerHeight - (el.getBoundingClientRect().top + window.scrollY) - below - 12)}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const [draft, setDraft] = useState<{ col: number; a: number; b: number } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  // Silme her zaman onaylı: Delete tuşu da menüyü onay adımında açar.
  const [askRemove, setAskRemove] = useState(false);
  const [review, setReview] = useState(false);
  const overTray = useRef(false);
  const [trayHot, setTrayHot] = useState(false);
  // Sağ panel: saati olmayan işler. Bugün, bu hafta (gösterilen günler) ya da tarihsiz.
  const [trayTab, setTrayTab] = useState<"today" | "week" | "none">(() => { try { return (localStorage.getItem("pg-tray") as "today" | "week" | "none" | null) ?? "today"; } catch { return "today"; } });
  const pickTray = (k: "today" | "week" | "none") => { setTrayTab(k); try { localStorage.setItem("pg-tray", k); } catch { /* yok */ } };
  // Blok backlog'a dönerse: blok silinir; işin başka saati kalmadıysa tarihi de kalkar.
  const unplan = (blockId: string) =>
    mutate((st) => {
      const blk = st.blocks.find((x) => x.id === blockId);
      st.blocks = st.blocks.filter((x) => x.id !== blockId);
      const task = blk?.taskId ? st.tasks.find((x) => x.id === blk.taskId) : undefined;
      if (task && !st.blocks.some((x) => x.taskId === task.id)) task.day = null;
    });
  const now = useNow(true, 30000);

  useEffect(() => {
    // Bir saat önceden başla; en alta dayanınca da tam saat çizgisine otursun ki üstteki saat etiketi kesilmesin.
    const g = scroller.current;
    if (!g) return;
    const h = new Date().getHours();
    const top = Math.floor(Math.min(g.scrollHeight - g.clientHeight, (h - START - 1) * HOUR) / HOUR) * HOUR;
    g.scrollTo({ top: Math.max(0, top - 12) });
  }, []);

  // Sadece bu saat takvimden kalkar; iş ve diğer saatleri kalır. Bildirimden geri alınır.
  const removeBlock = (id: string) => {
    const blk = s.blocks.find((b) => b.id === id);
    setSel(null);
    if (!blk) return;
    mutate((st) => void (st.blocks = st.blocks.filter((b) => b.id !== id)));
    toast("Saat takvimden kaldırıldı", () => mutate((st) => void (st.blocks.some((b) => b.id === blk.id) || st.blocks.push(blk))));
  };

  // Seçili bloğu Delete ile sil.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      // İş kartı açıkken ya da yazı alanındayken blok silinmez.
      if (!sel || (e.target as HTMLElement).closest("input,textarea,select") || document.querySelector(".drawer, .modal")) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); setAskRemove(true); }
      if (e.key === "Escape") setSel(null);
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [sel, mutate, s.blocks]);

  const minAt = (col: number, y: number) => {
    const r = cols.current[col]!.getBoundingClientRect();
    const m = ((y - r.top) / HOUR) * 60;
    return Math.max(0, Math.min(MINUTES, Math.round(m / SNAP) * SNAP)) + START * 60;
  };
  const colAt = (x: number, fallback: number) => {
    const i = cols.current.findIndex((c) => { if (!c) return false; const r = c.getBoundingClientRect(); return x >= r.left && x < r.right; });
    return i < 0 ? fallback : i;
  };

  // Sürükleme: pencere üzerinden izlenir, bırakınca kaydedilir.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === "move") {
        // Bloğu backlog'a sürüklemek: takvimden çıkar.
        const hit = !!(document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".tray");
        if (hit !== overTray.current) { overTray.current = hit; setTrayHot(hit); }
      }
      if (d.kind === "create") {
        const m = minAt(d.col, e.clientY);
        return setDrag({ ...d, a: Math.min(d.anchor, m), b: Math.max(d.anchor + SNAP, m), moved: d.moved || Math.abs(m - d.anchor) >= SNAP });
      }
      const dy = Math.round((((e.clientY - d.y0) / HOUR) * 60) / SNAP) * SNAP;
      const moved = d.moved || Math.abs(e.clientY - d.y0) > 4 || Math.abs(e.clientX - d.x0) > 4;
      if (d.kind === "move") {
        const len = d.b0 - d.a0;
        const a = Math.max(START * 60, Math.min(END * 60 - len, d.a0 + dy));
        return setDrag({ ...d, a, b: a + len, col: colAt(e.clientX, d.col), moved, copy: e.altKey });
      }
      if (d.kind === "top") return setDrag({ ...d, a: Math.min(d.b0 - SNAP, Math.max(START * 60, d.a0 + dy)), moved });
      setDrag({ ...d, b: Math.max(d.a0 + SNAP, Math.min(END * 60, d.b0 + dy)), moved });
    };
    const up = () => {
      const d = dragRef.current;
      const toTray = overTray.current;
      overTray.current = false;
      setTrayHot(false);
      setDrag(null);
      if (!d) return;
      if (d.kind === "move" && toTray && d.moved) return unplan(d.id);
      if (d.kind === "create") return setDraft({ col: d.col, a: d.a, b: Math.min(END * 60, d.moved ? d.b : d.a + 60) });
      if (!d.moved) {
        // Tıklama: bloğu seç, yanında ne yapılacağını soran küçük menü açılır.
        setSel(d.id);
        return;
      }
      const day = days[d.col];
      // ⌥ ile sürükleme: aynı işe yeni bir saat eklenir (ayrı iş açılmaz); değerse eskisiyle birleşir.
      if (d.kind === "move" && d.copy) {
        const nid = uid();
        mutate((st) => {
          const blk = st.blocks.find((x) => x.id === d.id);
          if (!blk) return;
          st.blocks.push({ ...blk, id: nid, start: mkTs(day, d.a), end: mkTs(day, d.b) });
        });
        setSel(nid);
        return;
      }
      mutate((st) => {
        const blk = st.blocks.find((x) => x.id === d.id);
        if (!blk) return;
        blk.start = mkTs(day, d.a);
        blk.end = mkTs(day, d.b);
        const task = blk.taskId ? st.tasks.find((x) => x.id === blk.taskId) : undefined;
        if (task && task.status !== "done") { if (task.autoId) task.autoDay ??= task.day ?? day; task.day = day; }
      });
    };
    const cancel = () => setDrag(null);
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("pointercancel", cancel);
    return () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
      removeEventListener("pointercancel", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  const startBlockDrag = (e: React.PointerEvent, b: Block, kind: "move" | "top" | "bottom", col: number, lane = 0, of = 1) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setDraft(null);
    const a = tsMin(b.start), bb = tsMin(b.end) || 24 * 60;
    setDrag({ kind, id: b.id, col, a, b: bb, y0: e.clientY, x0: e.clientX, a0: a, b0: bb, col0: col, moved: false, lane, of });
  };

  // Kenar çubuğundan (ya da listeden) bir işi takvime bırakma.
  const dropTask = (taskId: string, day: string, min: number | null) =>
    mutate((st) => {
      const task = st.tasks.find((x) => x.id === taskId);
      if (!task) return;
      if (task.autoId) task.autoDay ??= task.day ?? day;
      task.day = day;
      if (min === null) return;
      // İşin bu aralıkta zaten bir saati varsa o taşınır; ikinci saat eklenmez (ek saat için ⌥ ya da "+ Saat ekle").
      const existing = st.blocks.find((b) => b.taskId === taskId && days.includes(tsDay(b.start)));
      if (existing) {
        const len = Math.max(SNAP, spanMin(existing.start, existing.end));
        const a = Math.min(min, END * 60 - len);
        existing.start = mkTs(day, a);
        existing.end = mkTs(day, a + len);
        return;
      }
      const len = task.estimate ?? 60;
      const a = Math.min(min, END * 60 - len);
      st.blocks.push({ id: uid(), taskId, worldId: task.worldId, title: "", start: mkTs(day, a), end: mkTs(day, a + len), kind: "plan" });
    });

  const visible = (d: string) => tasks.filter((x) => x.day === d && x.status !== "done" && !s.blocks.some((b) => b.taskId === x.id && tsDay(b.start) === d));
  // Backlog: takvimde hiç yeri olmayan işler (tarihsiz ya da günü geçmiş). Günü ya da saati olan iş burada görünmez.
  const unplanned = tasks.filter((x) => x.status !== "done" && (!x.day || (x.day < t && !days.includes(x.day))) && !s.blocks.some((b) => b.taskId === x.id && days.includes(tsDay(b.start))));
  const weekMin = blocks.reduce((n, b) => n + spanMin(b.start, b.end), 0);
  const nowMin = new Date(now).getHours() * 60 + new Date(now).getMinutes();

  // Gerçekte çalışılan süre (oturumlar + çalışan zamanlayıcı), yerel saate çevrilir.

  // Botların hazırladığı, belli bir güne planlanmış çıktılar (ör. Sosyal gönderileri).
  const runWorld = (r: (typeof s.runs)[number]) => s.tasks.find((x) => x.id === r.taskId)?.worldId;
  const posts = s.runs.filter((r) => r.on && (r.status === "ready" || r.status === "approved") && days.includes(r.on) && runWorld(r) && (lens === ALL || runWorld(r) === lens));
  // İlerideki tekrarlar: henüz açılmamış günlerde soluk yer tutucu.
  const ghostList = ghosts(s, lens, days);
  const openGhost = (a: (typeof s.automations)[number]) => openAutoForm({ id: a.id });

  const calEl = (
        <div className="cal" style={{ ["--days" as string]: days.length }}>
          {/* Takvimin kendi araç satırı: gezinme ve görünüm, yönettiği ızgaranın hemen üstünde, sol kenarda. */}
          {!embedded && <div className="caltool">
            <div className="seg sm">
              <button onClick={() => setAnchor(addDays(anchor, mode === "week" ? -7 : -1))} aria-label="Önceki"><ChevronLeft size={16} /></button>
              <button className={days.includes(t) ? "on" : ""} aria-pressed={days.includes(t)} onClick={() => setAnchor(t)}>Bugün</button>
              <button onClick={() => setAnchor(addDays(anchor, mode === "week" ? 7 : 1))} aria-label="Sonraki"><ChevronRight size={16} /></button>
            </div>
            <div className="seg sm">
              <button className={mode === "day" ? "on" : ""} onClick={() => setMode("day")}>Gün</button>
              <button className={mode === "week" ? "on" : ""} onClick={() => setMode("week")}>Hafta</button>
            </div>
            <button className="btn sm" onClick={() => setReview(true)}>Hafta özeti</button>
          </div>}
          <div className="chead">
            <span className="gut" />
            {days.map((d) => (
              <button key={d} className={`ch ${d === t ? "today" : ""} ${d < t ? "past" : ""}`} onClick={() => (setAnchor(d), setMode("day"))}>
                <span>{dayShort(d)}</span>
                <b>{dayNum(d)}</b>
              </button>
            ))}
          </div>
          {/* Gün satırı yalnız gösterilecek bir şey varsa (deadline, gönderi, saatsiz otomasyon) görünür. */}
          {!embedded && days.some((d) => tasks.some((x) => x.deadline === d && x.status !== "done") || s.projects.filter(inLens(lens)).some((p) => p.deadline === d && p.status !== "done") || posts.some((r) => r.on === d) || ghostList.some((g) => g.day === d && !g.slot)) && <div className="allday">
            <span className="gut">gün</span>
            {days.map((d) => (
              <DropZone key={d} className="adcell" onDrop={(id) => dropTask(id, d, null)}>
                {[...tasks.filter((x) => x.deadline === d && x.status !== "done"), ...s.projects.filter(inLens(lens)).filter((p) => p.deadline === d && p.status !== "done")].map((x) => (
                  <span key={x.id} className="flag">⚑ {"title" in x ? x.title : x.name}</span>
                ))}
                {posts.filter((r) => r.on === d).map((r) => {
                  const wid = runWorld(r)!;
                  return (
                    <button key={r.id} className="post" style={{ ["--w" as string]: worldOf(s, wid).color }} title={r.title} onClick={() => r.taskId ? ctx.open(r.taskId) : undefined}>
                      {r.images?.[0] ? <img src={`/${r.images[0]}`} alt="" /> : <Send size={11} />}
                      <span>{r.title}</span>
                    </button>
                  );
                })}
                {ghostList.filter((g) => g.day === d && !g.slot).map((g) => (
                  <button key={g.a.id} className="chip ghost" style={{ ["--w" as string]: worldOf(s, g.a.worldId).color }} title={`Otomasyon: ${g.a.title}`} onClick={() => openGhost(g.a)}>
                    <Repeat size={12} />{g.a.title}
                  </button>
                ))}
                {embedded && visible(d).map((x) => <Chip key={x.id} task={x} ctx={ctx} />)}
              </DropZone>
            ))}
          </div>}
          <div className="grid" ref={scroller}>
            <div className="gutter">
              {Array.from({ length: END - START }, (_, i) => <span key={i} style={{ height: HOUR }}>{String(START + i).padStart(2, "0")}:00</span>)}
            </div>
            {days.map((d, ci) => (
              <div
                key={d}
                ref={(el) => void (cols.current[ci] = el)}
                className={`dcol ${d === t ? "today" : ""}`}
                style={{ height: (END - START) * HOUR }}
                onPointerDown={(e) => {
                  if (e.button !== 0 || e.target !== e.currentTarget) return;
                  setSel(null);
                  setDraft(null);
                  const m = minAt(ci, e.clientY);
                  setDrag({ kind: "create", col: ci, a: m, b: m + SNAP, anchor: m, moved: false });
                }}
                onDragOver={(e) => e.dataTransfer.types.includes("text/pg-task") && e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData("text/pg-task");
                  if (id) dropTask(id, d, minAt(ci, e.clientY));
                }}
              >

                {(() => {
                  // Sürüklenen blok da şerit hesabına girer: yan yana duran bloklar sürüklerken genişlemez.
                  const live = drag && "id" in drag ? drag : null;
                  const isCopy = !!live && live.kind === "move" && !!live.copy && live.moved;
                  const orig = live ? s.blocks.find((x) => x.id === live.id) : undefined;
                  // Sürükleme boyunca yerleşim donar: diğer bloklar yerinde kalır, sürüklenen başladığı genişliği korur.
                  const list = blocks.filter((b) => tsDay(b.start) === d && !(live && b.id === live.id && !isCopy && live.col0 !== ci));
                  // Henüz açılmamış otomasyon saatleri de şeride girer: gerçek işlerin üstüne binmez, yanına dizilir.
                  const gs = ghostList.filter((g) => g.day === d && g.slot).map((g) => {
                    const m = tsMin(`${d}T${g.slot}`);
                    return { id: `g:${g.a.id}:${g.slot}`, taskId: null, worldId: g.a.worldId, title: g.a.title, start: `${d}T${g.slot}`, end: `${d}T${fromMin(Math.min(1440, m + (g.a.minutes || 30)))}`, kind: "plan" as const, g };
                  });
                  const laid = lanes([...list, ...gs]).filter((x) => !(live && x.b.id === live.id && !isCopy));
                  return (
                    <>
                      {laid.map(({ b, lane, of }) => "g" in b ? (
                        <GhostView key={b.id} g={(b as (typeof gs)[number]).g} ctx={ctx} a={tsMin(b.start)} e={tsMin(b.end) || 1440} lane={lane} of={of} onOpen={openGhost} />
                      ) : (
                        <BlockView key={b.id} b={b} ctx={ctx} a={tsMin(b.start)} e={tsMin(b.end) || 24 * 60} lane={lane} of={of} sel={sel === b.id} onDown={(e, kind) => startBlockDrag(e, b, kind, ci, lane, of)} />
                      ))}
                      {live && orig && live.col === ci && (
                        <BlockView key={isCopy ? "__copy" : orig.id} b={orig} ctx={ctx} a={live.a} e={live.b} lane={live.lane} of={live.of} sel dragging copy={isCopy} onDown={() => {}} />
                      )}
                    </>
                  );
                })()}
                {drag?.kind === "create" && drag.col === ci && (
                  <div className="cghost" style={{ top: ((drag.a - START * 60) / 60) * HOUR, height: ((drag.b - drag.a) / 60) * HOUR }}>{fromMin(drag.a)}–{fromMin(drag.b)}</div>
                )}
                {draft && draft.col === ci && (
                  <Draft
                    top={((draft.a - START * 60) / 60) * HOUR}
                    height={((draft.b - draft.a) / 60) * HOUR}
                    label={`${fromMin(draft.a)}–${fromMin(draft.b)}`}
                    onCancel={() => setDraft(null)}
                    onSave={(title) => {
                      const worldId = dflt(lens, s);
                      mutate((st) => {
                        const task = newTask(worldId, title, { day: d, estimate: draft.b - draft.a });
                        st.tasks.push(task);
                        st.blocks.push({ id: uid(), taskId: task.id, worldId, title: "", start: mkTs(d, draft.a), end: mkTs(d, draft.b), kind: "plan" });
                      });
                      setDraft(null);
                    }}
                  />
                )}
                {d === t && nowMin >= START * 60 && <div className="nowline" style={{ top: ((nowMin - START * 60) / 60) * HOUR }} />}
              </div>
            ))}
          </div>
        </div>
  );
  const menu = sel && !drag && <BlockMenu key={sel} id={sel} ctx={ctx} ask={askRemove} onAsk={setAskRemove} onClose={() => (setSel(null), setAskRemove(false))} onRemove={() => (removeBlock(sel), setAskRemove(false))} />;
  if (embedded) return <div className="calendar embedded">{calEl}{menu}</div>;

  return (
    <div className={`calendar ${mode}`}>
      <PageHead
        ctx={ctx}
        title={mode === "week" ? range(days[0]) : `${dayShort(anchor)} ${dayLong(anchor)}`}
        sub={weekMin ? `${dur(weekMin)} planlı` : "Henüz plan yok, görevi saate sürükle."}
      />

      <AnimatePresence>{review && <WeekReview ctx={ctx} start={weekStart(anchor)} onClose={() => setReview(false)} />}</AnimatePresence>
      <div className="calwrap">
        {calEl}
        {menu}
        <aside className={`tray ${trayHot ? "is-hot" : ""}`}>
          {(() => {
            const todayList = visible(t);
            const weekList = days.flatMap((d) => visible(d));
            const tabs = [["today", "Bugün", todayList], ["week", mode === "week" ? "Bu hafta" : "Bu gün", weekList], ["none", "Tarihsiz", unplanned]] as const;
            const cur = tabs.find((x) => x[0] === trayTab) ?? tabs[0];
            return <>
              <div className="sechead"><h3>Saatsiz görevler</h3></div>
              <div className="seg sm traytabs" role="tablist" aria-label="Saatsiz görevler">
                {tabs.map(([k, l, list]) => <button key={k} role="tab" aria-selected={trayTab === k} className={trayTab === k ? "on" : ""} onClick={() => pickTray(k)}>{l}<span className="tabn">{list.length}</span></button>)}
              </div>
              <p className="hint">Saate sürükle: takvime girer.{cur[0] === "none" ? " Takvimdeki bir görevi buraya sürükle: takvimden ve günden çıkar." : " Takvimdeki bir görevi buraya sürükle: saati kalkar, günü kalır."}</p>
              <DropZone className="traydrop" onDrop={(id) => mutate((st) => {
                const x = st.tasks.find((y) => y.id === id);
                const was = st.blocks.find((b) => b.taskId === id && days.includes(tsDay(b.start)));
                st.blocks = st.blocks.filter((b) => !(b.taskId === id && days.includes(tsDay(b.start))));
                if (!x) return;
                if (cur[0] === "none") { if (!st.blocks.some((b) => b.taskId === id)) x.day = null; }
                else if (cur[0] === "today") x.day = t;
                else if (!x.day && was) x.day = tsDay(was.start);
              })}>
                <TaskList tasks={[...cur[2]]} ctx={ctx} o={{ world: lens === ALL, day: cur[0] !== "today", grip: true }} empty={cur[0] === "today" ? "Bugün saatsiz görev yok." : cur[0] === "week" ? "Bu hafta saatsiz görev yok." : "Tarihsiz görev yok."} />
              </DropZone>
            </>;
          })()}
        </aside>
      </div>
    </div>
  );
}

// Çakışan bloklar yan yana dizilir: her kümede şerit sayısı kadar sütun.
function lanes(list: Block[]) {
  const sorted = [...list].sort((x, y) => x.start.localeCompare(y.start));
  const out: { b: Block; lane: number; of: number }[] = [];
  let cluster: { b: Block; lane: number; of: number }[] = [];
  let ends: string[] = [];
  let clusterEnd = "";
  const flush = () => { cluster.forEach((x) => (x.of = ends.length)); out.push(...cluster); cluster = []; ends = []; };
  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush();
    let lane = ends.findIndex((e) => e <= b.start);
    if (lane < 0) lane = ends.push(b.end) - 1; else ends[lane] = b.end;
    cluster.push({ b, lane, of: 1 });
    clusterEnd = cluster.length === 1 || b.end > clusterEnd ? b.end : clusterEnd;
  }
  flush();
  return out;
}

// Otomasyonun henüz açılmamış saati: o gün iş olarak açılacak. Gerçek blok gibi durur, soluk ve tekrar simgeli.
function GhostView({ g, ctx, a, e, lane, of, onOpen }: { g: { a: Automation }; ctx: Ctx; a: number; e: number; lane: number; of: number; onOpen: (a: Automation) => void }) {
  const len = e - a;
  const tall = (len / 60) * HOUR - 2 >= 48;
  const by = g.a.who === "me" ? "Sen yaparsın" : "Rou hazırlar";
  return (
    <button
      className={`blk ghost ${of > 1 ? "is-split" : ""} ${!tall ? "short" : ""}`}
      style={{ ["--w" as string]: worldOf(ctx.state, g.a.worldId).color, top: ((a - START * 60) / 60) * HOUR + 1, height: Math.max(MIN_BLK, (len / 60) * HOUR - 2), ...(of > 1 ? { left: `calc(5px + (100% - 7px) * ${lane / of})`, right: "auto", width: `calc((100% - 7px) / ${of} - 3px)` } : {}) }}
      title={`Otomasyon: ${g.a.title} · ${fromMin(a)} · ${by}`}
      onPointerDown={(ev) => ev.stopPropagation()}
      onClick={() => onOpen(g.a)}
    >
      <span className="bt"><Repeat size={12} className="rep" /><span className="btx">{g.a.title}</span></span>
      {tall && <span className="bm">{fromMin(a)}–{fromMin(e)}</span>}
    </button>
  );
}

function BlockView({ b, ctx, a, e, lane = 0, of = 1, sel, dragging, copy, onDown }: { b: Block; ctx: Ctx; a: number; e: number; lane?: number; of?: number; sel?: boolean; dragging?: boolean; copy?: boolean; onDown: (ev: React.PointerEvent, kind: "move" | "top" | "bottom") => void }) {
  const s = ctx.state;
  const task = b.taskId ? s.tasks.find((x) => x.id === b.taskId) : undefined;
  const w = worldOf(s, b.worldId);
  const len = e - a;

  // Günü geçmiş ve bitmemiş iş: takvimde de gecikmiş görünür.
  // Rou'nun otomasyon işi senin zamanın değil: gecikti/saati geçti yazmaz, hangi adımda olduğunu yazar.
  const auto = task ? autoOf(s, task) : undefined;
  const bot = !!auto && auto.who !== "me";
  const stage = bot && task ? whereText(stagesOf(s, auto!, task, runOfTask(s.runs, task.id)), runOfTask(s.runs, task.id)) : "";
  const late = !bot && !!task && task.status !== "done" && tsDay(b.start) < today();
  // Bugün saati geçmiş ama bitmemiş (ve şu an üzerinde çalışılmıyor): süresi doldu.
  const n = new Date();
  const ended = !bot && !late && !!task && task.status !== "done" && s.timer?.taskId !== task.id && tsDay(b.start) === today() && e <= n.getHours() * 60 + n.getMinutes();
  // Alt satırlar: saat (30 dk ve üstü), durum (1 saat ve üstü, kendi satırında; kesilmez).
  const tag = late ? "Gecikti" : ended ? "Saati geçti" : bot ? stage : "";
  const showTag = !!tag && len >= 60 && of === 1;
  // Saat satırı yalnız sığdığında (48px ve üstü); sığmıyorsa blok tek satır, başlık ortada.
  const tall = (len / 60) * HOUR - 2 >= 48;
  const lines = Math.max(1, Math.floor(((len / 60) * HOUR - (tall ? 24 : 8) - (showTag ? 18 : 0)) / 16));
  return (
    <div
      className={`blk s-${task?.status ?? "todo"} ${task?.status === "done" ? "done" : ""} ${s.timer?.taskId === b.taskId ? "running" : ""} ${sel ? "sel" : ""} ${dragging ? "dragging" : ""} ${copy ? "is-copy" : ""} ${of > 1 ? "is-split" : ""} ${!tall ? "short" : ""} ${late ? "is-late" : ""} ${ended ? "is-ended" : ""} ${bot ? "is-auto" : ""}`}
      style={{ ["--w" as string]: w.color, ["--lines" as string]: lines, top: ((a - START * 60) / 60) * HOUR + 1, height: Math.max(MIN_BLK, (len / 60) * HOUR - 2), ...(of > 1 ? { left: `calc(5px + (100% - 7px) * ${lane / of})`, right: "auto", width: `calc((100% - 7px) / ${of} - 3px)` } : {}) }}
      title={`${blockTitle(s, b)} · ${fromMin(a)}–${fromMin(e)}${late ? " · Gecikti, bitmedi" : ended ? " · Saati geçti, bitmedi" : bot ? ` · Otomasyon: ${stage}` : ""}`}
      data-blk={b.id}
      onPointerDown={(ev) => onDown(ev, "move")}
    >
      {len >= 45 && <span className="h top" onPointerDown={(ev) => onDown(ev, "top")} />}
      {task && (
        <button className="bopen" title="Görevi aç" aria-label="Görevi aç" onPointerDown={(ev) => ev.stopPropagation()} onClick={(ev) => (ev.stopPropagation(), ctx.open(task.id))}>
          <ArrowUpRight size={14} />
        </button>
      )}
      <span className="bt"><StatusMark status={task?.status ?? "todo"} size={16} /><span className="btx">{blockTitle(s, b)}</span>{task?.autoId && <Repeat size={12} className="rep" />}</span>
      {tall && <span className="bm">{fromMin(a)}–{fromMin(e)}</span>}
      {showTag && <span className={`btag ${late ? "is-late" : ended ? "is-ended" : "is-auto"}`}>{tag}</span>}
      <span className="h bottom" onPointerDown={(ev) => onDown(ev, "bottom")} />
    </div>
  );
}

function Draft({ top, height, label, onSave, onCancel }: { top: number; height: number; label: string; onSave: (t: string) => void; onCancel: () => void }) {
  const [v, setV] = useState("");
  return (
    <form className="draft" style={{ top, minHeight: height }} onSubmit={(e) => { e.preventDefault(); if (v.trim()) onSave(v.trim()); else onCancel(); }} onPointerDown={(e) => e.stopPropagation()}>
      <span>{label}</span>
      <textarea
        autoFocus
        rows={1}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter") (e.preventDefault(), v.trim() ? onSave(v.trim()) : onCancel());
        }}
        onBlur={() => (v.trim() ? onSave(v.trim()) : onCancel())}
        placeholder="Ne yapacaksın?"
      />
    </form>
  );
}

function Chip({ task, ctx }: { task: Task; ctx: Ctx }) {
  return (
    <button
      className={`chip s-${task.status} ${task.status !== "done" && task.day && task.day < today() ? "is-late" : ""}`}
      style={{ ["--w" as string]: worldOf(ctx.state, task.worldId).color }}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/pg-task", task.id)}
      onClick={() => ctx.open(task.id)}
      title={task.title}
    >
      <StatusMark status={task.status} size={15} />{task.title}
    </button>
  );
}

function DropZone({ className, onDrop, children }: { className: string; onDrop: (id: string) => void; children: React.ReactNode }) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`${className} ${over ? "over" : ""}`}
      onDragOver={(e) => { if (!e.dataTransfer.types.includes("text/pg-task")) return; e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => { setOver(false); const id = e.dataTransfer.getData("text/pg-task"); if (id) onDrop(id); }}
    >
      {children}
    </div>
  );
}


// Takvimdeki bloğa tıklayınca: o saat için ne yapılacağı. "Takvimden kaldır" işi silmez, sadece bu saati.
function BlockMenu({ id, ctx, ask, onAsk, onClose, onRemove }: { id: string; ctx: Ctx; ask: boolean; onAsk: (x: boolean) => void; onClose: () => void; onRemove: () => void }) {
  const s = ctx.state;
  const b = s.blocks.find((x) => x.id === id);
  const task = b?.taskId ? s.tasks.find((x) => x.id === b.taskId) : undefined;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = document.querySelector(`[data-blk="${id}"]`);
      const m = ref.current;
      if (!el || !m) return onClose();
      // Mobilde alttaki dünya çubuğu: menü onun üstünde kalır.
      const floor = matchMedia("(max-width: 720px)").matches ? (document.querySelector(".topbar")?.getBoundingClientRect().top ?? innerHeight) : innerHeight;
      const r = el.getBoundingClientRect(), W = m.offsetWidth, H = m.offsetHeight, G = 8;
      const x = r.right + G + W <= innerWidth - 12 ? r.right + G : r.left - G - W >= 12 ? r.left - G - W : Math.max(12, Math.min(innerWidth - W - 12, r.left));
      const y = Math.max(12, r.right + G + W <= innerWidth - 12 || r.left - G - W >= 12 ? Math.min(floor - H - 12, r.top) : Math.min(floor - H - 12, r.bottom + G));
      setPos({ x, y });
    };
    place();
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest(`[data-blk="${id}"]`)) onClose();
    };
    addEventListener("pointerdown", away, true);
    addEventListener("scroll", place, true);
    addEventListener("resize", place);
    return () => {
      removeEventListener("pointerdown", away, true);
      removeEventListener("scroll", place, true);
      removeEventListener("resize", place);
    };
  }, [id, onClose, ask]);
  if (!b) return null;
  const w = worldOf(s, b.worldId);
  const running = s.timer?.taskId === task?.id;
  return createPortal(
    <div ref={ref} className="blkmenu" role="dialog" aria-label="Takvim saati" style={{ ["--w" as string]: w.color, left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}>
      <div className="bmhead">
        <StatusMark status={task?.status ?? "todo"} size={16} />
        <div>
          <b>{blockTitle(s, b)}</b>
          <span>{dayLong(tsDay(b.start))} · {fromMin(tsMin(b.start))}–{fromMin(tsMin(b.end) || 24 * 60)}</span>
        </div>
      </div>
      {task && (
        <button onClick={() => (ctx.open(task.id), onClose())}><ArrowUpRight size={16} />Görevi aç</button>
      )}
      {task && task.status !== "done" && !running && (
        whoOf(ctx.state, task) === "me"
          ? <button onClick={() => (startTask(ctx.mutate, task.id), onClose())}><Play size={15} />Başlat</button>
          : <button onClick={() => (doNow(ctx, task), onClose())}><Play size={15} />Rou şimdi yapsın</button>
      )}
      {ask ? (
        <div className="bmconfirm">
          <b>Bu saat takvimden kaldırılsın mı?</b>
          <p>{dayLong(tsDay(b.start))} {fromMin(tsMin(b.start))}–{fromMin(tsMin(b.end) || 24 * 60)} saati takvimden silinir. {task ? `“${task.title}” görevi listede kalır.` : ""}</p>
          <div className="bmbtns">
            <button className="btn sm ghost" onClick={() => onAsk(false)}>Vazgeç</button>
            <button className="btn sm dangerfill" onClick={onRemove}>Kaldır</button>
          </div>
        </div>
      ) : (
        <button className="is-danger" onClick={() => onAsk(true)}><CalendarX2 size={16} />Takvimden kaldır<em>Görev kalır</em></button>
      )}
    </div>,
    document.body,
  );
}
