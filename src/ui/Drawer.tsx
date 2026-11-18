import { motion } from "motion/react";
import { openPost } from "./openPost";
import { runOfTask } from "../runs";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Run, State, Task, Topic } from "../types";
import { accountOf, taskRef } from "../../shared/social.mjs";
import { setDay } from "../../shared/repeat.mjs";
import { type Ctx, STATUS_LABEL, blocksOf, freeSlot, newTask, projectOf, secsOf, sessionsOf, setStatus, worldOf } from "../lib";
import { addDays, ago, dayLong, dur, hm, relDay, spanMin, today, iso, localTs } from "../date";
import { spent, stop } from "../timer";
import { stable, uid } from "../store";
import { Check, Play } from "./TaskRow";
import { AutoInfoRow, BOT, OutputSection, autoOf, kickOff, kickOffWhat } from "./Auto";
import { PostBasis } from "./PostBasis";
import { stagesOf } from "../../shared/stages.mjs";
import { openAutoForm } from "./AutoForm";
import { toast } from "./Toast";
import { DatePick } from "./DatePick";
import { binIt } from "../trashOps";
import { ArrowUpRight, CalendarDays, Plus, RefreshCw, Check as Check2, ChevronDown, ChevronRight, CircleDot, Clock, Copy, Flag, MessageCircle, Repeat, Trash2, UserRound, X } from "lucide-react";
import { askRouAbout } from "./Rou";
import { Select, projectGroups } from "./Select";
import { TimeField } from "./Fields";


// Yeni iş: ayrıntılarıyla eklemek için iş kartı "Yeni iş" olarak açılır. Vazgeç işi siler, Ekle kapatır.
const freshNew = new Set<string>();
export function openNew(ctx: Ctx, id: string) {
  freshNew.add(id);
  ctx.open(id);
}

export function Drawer({ task: task0, ctx: real, onClose: close }: { task: Task; ctx: Ctx; onClose: () => void }) {
  const isNew = freshNew.has(task0.id);
  // Paylaşılmış gönderi: plan alanları (kim, gün, saat, durum) artık anlamsız; kart ne paylaşıldığını ve sıradaki adımları gösterir.
  const shared = real.state.runs.filter((r) => r.taskId === task0.id && r.status === "posted").at(-1);
  // Var olan işte değişiklikler taslakta birikir; Kaydet hepsini birden uygular ve iş Rou'nunsa başlatır.
  const ops = useRef<((st: State) => void)[]>([]);
  const [rev, bump] = useState(0);
  const [leave, setLeave] = useState(false);
  const draft = useMemo(() => {
    if (!ops.current.length) return real.state;
    const st = structuredClone(real.state);
    ops.current.forEach((f) => f(st));
    return st;
  }, [real.state, rev]);
  const ctx: Ctx = { ...real, state: draft, mutate: (fn) => { ops.current.push(stable(fn)); bump((n) => n + 1); } };
  const task = ctx.state.tasks.find((x) => x.id === task0.id) ?? task0;
  // Gerçekten fark var mı: işin kendisi, saatleri, odak kayıtları ve otomasyonu taslakta öncekinden farklıysa (aç-kapa geri alınmış seçim sayılmaz).
  const slice = (st: State) => JSON.stringify([st.tasks.find((x) => x.id === task0.id), st.blocks.filter((b) => b.taskId === task0.id), st.sessions.filter((x) => x.taskId === task0.id), task0.autoId ? st.automations.find((a) => a.id === task0.autoId) : null]);
  const pending = () => {
    if (!ops.current.length) return false;
    const st = structuredClone(real.state);
    ops.current.forEach((f) => f(st));
    return slice(st) !== slice(real.state);
  };
  const dirty = ops.current.length > 0 && slice(draft) !== slice(real.state);
  const commit = () => {
    const list = ops.current;
    if (!list.length) return;
    ops.current = [];
    real.mutate((st) => list.forEach((f) => f(st)));
    bump((n) => n + 1);
  };
  const onClose = () => (freshNew.delete(task0.id), close());
  // Kapatırken kaydedilmemiş değişiklik varsa sorar (yazılan alan önce blur ile taslağa düşer).
  const tryClose = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    if (pending()) setLeave(true);
    else (ops.current = [], onClose());
  };
  const save = () => {
    (document.activeElement as HTMLElement | null)?.blur();
    const x = ctx.state.tasks.find((y) => y.id === task0.id) ?? task;
    const changed = pending();
    commit();
    setLeave(false);
    const go = kickOff(real, x);
    if (go === "keep") { setStarting(true); return void freshNew.delete(task0.id); }
    onClose();
    if (!go) toast(isNew ? "Görev eklendi" : changed ? "Kaydedildi" : "Değişiklik yok");
  };
  const discard = () => {
    real.mutate((st) => {
      st.tasks = st.tasks.filter((x) => x.id !== task.id);
      st.blocks = st.blocks.filter((b) => b.taskId !== task.id);
    });
    onClose();
  };
  const s = ctx.state;
  const what = kickOffWhat(s, task);
  // Rou bu iş üzerinde çalışıyor mu (hazırlıyor, Chrome'da yapıyor): düğme bunu söyler ve kilitlenir.
  const lastRun = real.state.runs.filter((r) => r.taskId === task0.id).sort((a, b) => b.at.localeCompare(a.at))[0];
  const fresh = (at?: string, min = 45) => !!at && Date.now() - new Date(at).getTime() < min * 60 * 1000;
  const working = !isNew && ((lastRun?.status === "working" && fresh(lastRun.at, 30)) || (!!lastRun?.act?.phase && fresh(lastRun.act.at)));
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    if (!starting) return;
    // Başlatma bitti sayılır: Rou çalışmaya geçti, Chrome seçimi ya da soru göründü, ya da 2 dakika geçti.
    const done = () => setStarting(false);
    addEventListener("pg-do-ready", done);
    const id = setTimeout(done, 120000);
    return () => (removeEventListener("pg-do-ready", done), clearTimeout(id));
  }, [starting]);
  useEffect(() => { if (working) setStarting(false); }, [working]);
  const busyLabel = working ? "Rou çalışıyor" : starting ? "Rou başlıyor" : "";
  // Yazılan alan blur olmadan taslağa düşmez; yazılan değer alanın ilk hâlinden farklıysa kaydet düğmesi çıkar, aynı hâle dönünce kaybolur.
  // Alandan çıkınca değer taslağa geçer ve farkı dirty söyler.
  const edited = useRef(new Set<Element>());
  const [typed, setTyped] = useState(false);
  const track = (el: EventTarget, on: boolean) => {
    if (!(el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "checkbox"))) return;
    if (on && el.value !== el.defaultValue) edited.current.add(el); else edited.current.delete(el);
    setTyped(edited.current.size > 0);
  };
  const changed = dirty || typed;
  const saveLabel = isNew ? `Ekle${what ? ", Rou başlasın" : ""}` : changed ? "Değişiklikleri kaydet" : what ? "Rou başlasın" : "Kaydet";
  const set = (fn: (t: Task) => void) => ctx.mutate((st) => { const x = st.tasks.find((y) => y.id === task.id); if (x) fn(x); });
  const auto0 = autoOf(s, task);
  const topical = !!auto0 && auto0.who !== "me" && !auto0.browser;
  const saveTopic = (patch: Partial<Topic>) => {
    const next = { title: task.topic?.title ?? "", brief: task.topic?.brief ?? "", ...patch };
    if (next.title === (task.topic?.title ?? "") && next.brief === (task.topic?.brief ?? "")) return;
    set((x) => { if (next.title) x.topic = next; else delete x.topic; });
    if (s.runs.some((r) => r.taskId === task.id && (r.status === "ready" || r.status === "approved"))) toast("Konu değişti. Metin eski konuyla hazır; yenisi için Yeniden hazırlat.");
  };
  const w = worldOf(s, task.worldId);
  const p = projectOf(s, task.projectId);
  const blocks = blocksOf(s, task.id);
  const sessions = sessionsOf(s, task.id);
  const sec = secsOf(s, task.id);
  const t = today();
  const [check, setCheck] = useState("");
  const [ask, setAsk] = useState(false);
  const [askSlot, setAskSlot] = useState<string | null>(null);
  // Saati düzenleme: çipe tıklayınca başlangıç ve bitiş saati (gün aynı kalır).
  const [editSlot, setEditSlot] = useState<{ id: string; a: string; b: string } | null>(null);
  const saveSlot = () => {
    if (!editSlot || !editSlot.a || !editSlot.b || editSlot.b <= editSlot.a) return;
    ctx.mutate((st) => {
      const x = st.blocks.find((y) => y.id === editSlot.id);
      if (x) { x.start = `${x.start.slice(0, 11)}${editSlot.a}`; x.end = `${x.start.slice(0, 11)}${editSlot.b}`; }
    });
    setEditSlot(null);
  };
  const [manual, setManual] = useState<{ day: string; a: string; b: string } | null>(null);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key !== "Escape") return; if (leave) setLeave(false); else tryClose(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  return (
    <>
      <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={tryClose} />
      <motion.aside
        className="drawer"
        onInput={(e) => track(e.target, true)}
        onBlur={(e) => track(e.target, false)}
        style={{ ["--w" as string]: w.color }}
        initial={{ scale: 0.96, y: 8, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.96, y: 8, opacity: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 38 }}
      >
        <header className="dhead">
          <ProjectPick task={task} ctx={ctx} />
          <button className="iconbtn" title="Projeye git" aria-label="Projeye git" onClick={() => (commit(), ctx.go({ view: "projects", lens: w.id, project: p?.id ?? `none:${w.id}` }), onClose())}><ArrowUpRight size={16} /></button>
          <button className="x" onClick={tryClose} aria-label="Kapat"><X size={18} /></button>
        </header>

        <div className="dtitle">
          <Check task={task} mutate={ctx.mutate} size={24} running={s.timer?.taskId === task.id} />
          <textarea key={task.id} className="titlein" rows={1} autoFocus={isNew} onFocus={(e) => isNew && e.target.select()} defaultValue={task.title} onBlur={(e) => {
            const v = e.target.value.trim();
            if (!v || v === task.title) return;
            // Tekrarlayan işin adı değişince seri de (ilerideki günler) aynı adı alır.
            ctx.mutate((st) => {
              const x = st.tasks.find((y) => y.id === task.id);
              if (x) x.title = v;
              const a = task.autoId ? st.automations.find((y) => y.id === task.autoId) : undefined;
              if (a) a.title = v;
              // Tek seferlik gönderide ad konudur: hazırlanan çıktının adı da güncellenir (takvim, bildirim eski adı göstermesin).
              if (x?.post && !a) for (const r of st.runs) if (r.taskId === task.id) r.title = v;
            });
          }} />
        </div>


        {shared && <SharedBar task={task} run={shared} ctx={real} onClose={onClose} />}

        {/* Ne yapılacağı: başlığın hemen altında; Rou işi bu metinden anlar (task.notes). */}
        {/* Rou'nun yazdığı otomasyon işi: talimat otomasyonda, bu günün işi "Konu"dur. Rou her sabah önümüzdeki 7 günün boş konularını yazar. */}
        {!shared && topical && <section className="dsec">
          <div className="dsechead"><span className="flabel">Konu</span><span className="muted">Boş kalırsa Rou yazar</span></div>
          <div className="brief topicbox">
          <textarea key={`tt-${task.id}`} className="ttl" rows={1} defaultValue={task.topic?.title ?? ""} aria-label="Konu" placeholder="Bu gönderinin konusu" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())} onBlur={(e) => saveTopic({ title: e.target.value.replace(/\s+/g, " ").trim() })} />
          <textarea key={`tb-${task.id}`} rows={2} defaultValue={task.topic?.brief ?? ""} aria-label="Ne anlatacak" placeholder="Ne anlatacak" onBlur={(e) => saveTopic({ brief: e.target.value.trim() })} />
          </div>
        </section>}
        {!shared && !topical && <div className="brief">
          <textarea key={`n-${task.id}`} rows={3} defaultValue={task.notes} aria-label="Ne yapılacak" placeholder={BRIEF_HINT[(autoOf(s, task) ? "me" : task.who) ?? "me"]} onBlur={(e) => e.target.value !== task.notes && set((x) => (x.notes = e.target.value))} />
          {task.source?.url && <a className="srclink" href={task.source.url} target="_blank" rel="noreferrer">Kaynağı aç ({task.source.type})</a>}
        </div>}

        {/* Rou yapıyorsa ne olacağı (ya da çıktısı) açıklamanın hemen altında: işin ne olacağı ilk bakışta anlaşılsın. */}
        {task.post && !shared && <PostBasis task={task} ctx={real} />}
        <OutputSection task={task} ctx={real} />

        {/* Ayarlar: kim yapacak · ne zaman · durum ve tekrar; tek yumuşak panel, gruplar boşlukla ayrılır. */}
        {shared ? (task.autoId && s.automations.some((a) => a.id === task.autoId) && <dl className="props dprops"><div className="dgroup"><AutoInfoRow task={task} ctx={real} onGo={() => (commit(), onClose())} /></div></dl>) : <section className="dsec"><div className="dsechead"><span className="flabel">Ayarlar</span></div><dl className="props dprops">
          <div className="dgroup">
          <WhoRow task={task} ctx={ctx} play={!isNew && <span className="whoplay" onClickCapture={commit}><Play task={task} ctx={real} label /></span>} />
          </div>
          <div className="dgroup">
          <div>
            <dt><CalendarDays size={15} />Gün</dt>
            <dd className="chips">
              {[{ l: "Bugün", v: t }, { l: "Yarın", v: addDays(t, 1) }, { l: "Tarihsiz", v: null }].map((o) => (
                <button key={o.l} className={task.day === o.v ? "on" : ""} onClick={() => ctx.mutate((st) => { const x = st.tasks.find((y) => y.id === task.id); if (x) setDay(st, x, o.v); })}>{o.l}</button>
              ))}
              <DatePick value={task.day && task.day !== t && task.day !== addDays(t, 1) ? task.day : ""} onChange={(v) => v && ctx.mutate((st) => { const x = st.tasks.find((y) => y.id === task.id); if (x) setDay(st, x, v); })} label="Gün" placeholder="Başka gün" clearable={false} />
            </dd>
          </div>
          <div>
            <dt><Clock size={15} />Saat</dt>
            <dd className="slots">
              {blocks.map((b) => (
                editSlot?.id === b.id ? (
                  <span key={b.id} className="slot is-edit" onKeyDown={(e) => { if (e.key === "Enter") saveSlot(); if (e.key === "Escape") { e.stopPropagation(); setEditSlot(null); } }}>
                    <TimeField autoFocus value={editSlot.a} onChange={(v) => setEditSlot((x) => x && { ...x, a: v })} label="Başlangıç" />
                    –
                    <TimeField value={editSlot.b} onChange={(v) => setEditSlot((x) => x && { ...x, b: v })} label="Bitiş" />
                    <button onClick={saveSlot} disabled={!editSlot.a || !editSlot.b || editSlot.b <= editSlot.a} aria-label="Saati kaydet" title="Kaydet"><Check2 size={14} /></button>
                    <button onClick={() => setEditSlot(null)} aria-label="Vazgeç" title="Vazgeç"><X size={13} /></button>
                  </span>
                ) : (
                <span key={b.id} className={`slot ${askSlot === b.id ? "is-ask" : ""}`} title={dur(spanMin(b.start, b.end))}>
                  {b.start.slice(0, 10) !== task.day && <em>{relDay(b.start.slice(0, 10))}</em>}
                  <button className="slottime" onClick={() => (setAskSlot(null), setEditSlot({ id: b.id, a: hm(b.start), b: hm(b.end) }))} aria-label={`Saati düzenle: ${hm(b.start)}–${hm(b.end)}`} title="Saati düzenle">{hm(b.start)}–{hm(b.end)}</button>
                  {askSlot !== b.id && <button onClick={() => setAskSlot(b.id)} aria-label="Saati takvimden kaldır" title="Saati takvimden kaldır"><X size={13} /></button>}
                </span>
                )
              ))}
              {askSlot && blocks.some((b) => b.id === askSlot) && (
                <div className="slotask">
                  <span>Bu saat takvimden kaldırılsın mı? Görev kalır.</span>
                  <button className="btn sm ghost" onClick={() => setAskSlot(null)}>Vazgeç</button>
                  <button className="btn sm dangerfill" onClick={() => (ctx.mutate((st) => void (st.blocks = st.blocks.filter((x) => x.id !== askSlot))), setAskSlot(null))}>Kaldır</button>
                </div>
              )}
              <button
                className="slotadd"
                onClick={() => ctx.mutate((st) => {
                  const day = task.day && task.day >= t ? task.day : t;
                  const [a, b] = freeSlot(st, day, task.estimate ?? 60);
                  st.blocks.push({ id: uid(), taskId: task.id, worldId: task.worldId, title: "", start: a, end: b, kind: "plan" });
                  const x = st.tasks.find((y) => y.id === task.id);
                  if (x && !x.day) x.day = day;
                })}
              >
                + Saat ekle
              </button>
            </dd>
          </div>
          <div>
            <dt><Flag size={15} />Deadline</dt>
            <dd className="chips">
              <DatePick value={task.deadline ?? ""} onChange={(v) => set((x) => (x.deadline = v || null))} label="Deadline" placeholder="Deadline yok" />
            </dd>
          </div>
          </div>
          <div className="dgroup">
          {!isNew && (
          <div>
            <dt><CircleDot size={15} />Durum</dt>
            <dd className="chips stchips">
              {(["todo", "doing", "waiting", "done"] as const).map((st) => (
                <button key={st} className={`${task.status === st ? "on" : ""} st-${st}`} onClick={() => {
                  // Bitti seçilirken zamanlayıcı bu işteyse süre kaydedilip durdurulur.
                  if (st === "done" && s.timer?.taskId === task.id) stop(ctx.mutate, true);
                  else set((x) => setStatus(x, st));
                }}>{STATUS_LABEL[st]}</button>
              ))}
            </dd>
          </div>
          )}
          {task.autoId && s.automations.some((a) => a.id === task.autoId) ? (
            <AutoInfoRow task={task} ctx={real} onGo={() => (commit(), onClose())} />
          ) : (
            <div>
              <dt><Repeat size={15} />Tekrar</dt>
              <dd><button className="slotadd" onClick={() => (commit(), openAutoForm({ fromTask: task.id }), onClose())}>+ Düzenli tekrarlansın</button></dd>
            </div>
          )}
          </div>
        </dl></section>}


        {!(shared && !task.checklist.length) && <Section title="Alt görevler" meta={task.checklist.length ? `${task.checklist.filter((c) => c.done).length}/${task.checklist.length}` : ""}>
          <ul className="checks">
            {task.checklist.map((c) => (
              <li key={c.id} className={c.done ? "done" : ""}>
                <button className="box" onClick={() => set((x) => { const y = x.checklist.find((z) => z.id === c.id); if (y) y.done = !y.done; })}>{c.done && <Check2 size={11} strokeWidth={3} />}</button>
                <input defaultValue={c.text} onBlur={(e) => set((x) => { const y = x.checklist.find((z) => z.id === c.id); if (y) y.text = e.target.value; })} />
                <button className="rm" onClick={() => set((x) => void (x.checklist = x.checklist.filter((z) => z.id !== c.id)))} aria-label="Sil"><X size={14} /></button>
              </li>
            ))}
          </ul>
          <form className="checkadd" onSubmit={(e) => { e.preventDefault(); if (!check.trim()) return; set((x) => void x.checklist.push({ id: uid(), text: check.trim(), done: false })); setCheck(""); }}>
            <Plus size={15} aria-hidden />
            <input value={check} onChange={(e) => setCheck(e.target.value)} placeholder="Alt görev ekle" aria-label="Alt görev ekle" />
          </form>
        </Section>}

        {!isNew && <Section title={`Odak kayıtları${sessions.length ? ` (${sessions.length})` : ""}`} meta={sec ? spent(sec) : ""} fold>
          <ul className="lines">
            {sessions.map((x) => {
              const a = new Date(x.start), b = new Date(x.end);
              const f = (d: Date) => d.toTimeString().slice(0, 5);
              return (
                <li key={x.id}>
                  <span>{dayLong(iso(a)) === dayLong(today()) ? "bugün" : ago(x.start)}</span>
                  <b>{f(a)}–{f(b)}</b>
                  <em>{x.mode === "pomo" ? "pomodoro" : x.mode === "manual" ? "elle" : spent((b.getTime() - a.getTime()) / 1000)}</em>
                  <button className="rm" onClick={() => ctx.mutate((st) => void (st.sessions = st.sessions.filter((y) => y.id !== x.id)))} aria-label="Sil"><X size={14} /></button>
                </li>
              );
            })}
          </ul>
          {manual ? (
            <form
              className="manual"
              onSubmit={(e) => {
                e.preventDefault();
                const a = new Date(`${manual.day}T${manual.a}`), b = new Date(`${manual.day}T${manual.b}`);
                if (!(b > a)) return;
                ctx.mutate((st) => void st.sessions.push({ id: uid(), taskId: task.id, start: a.toISOString(), end: b.toISOString(), mode: "manual" }));
                setManual(null);
              }}
            >
              <DatePick value={manual.day} onChange={(v) => v && setManual({ ...manual, day: v })} label="Gün" clearable={false} />
              <TimeField value={manual.a} onChange={(v) => setManual((x) => x && { ...x, a: v })} label="Başlangıç" />
              <span>–</span>
              <TimeField value={manual.b} onChange={(v) => setManual((x) => x && { ...x, b: v })} label="Bitiş" />
              <button className="btn sm primary">Ekle</button>
            </form>
          ) : (
            <button className="linkbtn" onClick={() => setManual({ day: t, a: "09:00", b: "10:00" })}>+ Süreyi elle ekle</button>
          )}
        </Section>}


        {ask && (
          <div className="delconfirm" role="alertdialog" aria-label="Görevi sil" ref={(el) => el?.scrollIntoView({ block: "center", behavior: "smooth" })}>
            <b>“{task.title}” tamamen silinsin mi?</b>
            <ul>
              <li>Görev listeden{blocks.length ? ` ve takvimden (${blocks.length} saat)` : ""} kalkar</li>
              {sessions.length > 0 && <li>{sessions.length} odak kaydı silinir</li>}
              {s.runs.some((x) => x.taskId === task.id) && <li>{s.runs.filter((x) => x.taskId === task.id).length} çıktı silinir</li>}
            </ul>
            <p>Sadece takvimden kaldırmak istiyorsan yukarıdaki saatin yanındaki ✕'e bas.</p>
            <div className="bmbtns">
              <button className="btn sm ghost" onClick={() => setAsk(false)}>Vazgeç</button>
              <button className="btn sm dangerfill" onClick={() => {
              // İşle birlikte saatleri, odak kayıtları ve çıktıları gider; bildirimden geri alınabilir.
              const recs = { tasks: [task], blocks: s.blocks.filter((x) => x.taskId === task.id), sessions: s.sessions.filter((x) => x.taskId === task.id), runs: s.runs.filter((x) => x.taskId === task.id) };
              ops.current = [];
              binIt(real, "task", task.title, recs, (st) => {
                st.tasks = st.tasks.filter((x) => x.id !== task.id);
                st.blocks = st.blocks.filter((x) => x.taskId !== task.id);
                st.sessions = st.sessions.filter((x) => x.taskId !== task.id);
                st.runs = st.runs.filter((x) => x.taskId !== task.id);
                if (st.timer?.taskId === task.id) st.timer = null;
              }, `“${task.title}” silindi`);
              onClose();
            }}>Evet, sil</button>
            </div>
          </div>
        )}
        {!isNew && (
          <footer className="dfoot">
            <span className="muted">{task.by === "claude" ? "Rou ekledi" : "Sen ekledin"} · {ago(task.createdAt)}</span>
            <button className="dsdel dsask" onClick={() => askRouAbout({ taskId: task.id, runId: runOfTask(s.runs, task.id)?.id })}>
              <MessageCircle size={14} />Rou'ya sor
            </button>
            <button className="dsdel" onClick={() => setAsk(true)}>
              <Trash2 size={14} />Görevi sil
            </button>
            {/* Değişiklik yoksa kaydet düğmesi yok; yalnız Rou'yu başlatmak gibi gerçek bir iş varsa düğme kalır. */}
            {busyLabel && !changed ? (
              <button className="btn sm primary dsave is-busy" disabled aria-live="polite"><RefreshCw size={14} className="spin" />{busyLabel}</button>
            ) : !changed && !what ? null : (
              <button className="btn sm primary dsave" onClick={save}>
                <Check2 size={14} />{saveLabel}
              </button>
            )}
          </footer>
        )}
        {isNew && (
          <footer className="dfoot">
            <button className="btn sm ghost dnewno" onClick={() => { ops.current = []; discard(); }}>Vazgeç</button>
            <button className="btn sm primary dsave" onClick={save}><Check2 size={14} />{saveLabel}</button>
          </footer>
        )}
      </motion.aside>
      {leave && (
        <div className="leavescrim" onMouseDown={() => setLeave(false)}>
          <div className="leavebox" role="alertdialog" aria-modal="true" aria-labelledby="leave-t" onMouseDown={(e) => e.stopPropagation()}>
            <b id="leave-t">Kaydedilmemiş değişiklikler var</b>
            <p>{isNew ? "Kapatırsan görev eklenmez." : "Kapatırsan bu değişiklikler kaybolur."}</p>
            <div>
              <button className="btn sm ghost" onClick={() => { ops.current = []; setLeave(false); if (isNew) discard(); else onClose(); }}>Yine de kapat</button>
              <button className="btn sm primary" autoFocus onClick={save}>{isNew ? "Ekle" : "Değişiklikleri kaydet"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Paylaşıldıktan sonra kartın başı: nerede, ne zaman paylaşıldı; sıradaki iş gönderiyi açmak, benzerini ürettirmek ya da Rou'ya sormak.
function SharedBar({ task, run, ctx, onClose }: { task: Task; run: Run; ctx: Ctx; onClose: () => void }) {
  const s = ctx.state;
  const ref = taskRef(s, task);
  const acc = accountOf(s, ref);
  const at = run.postedAt ? new Date(run.postedAt) : null;
  const when = at ? `${relDay(iso(at))} ${hm(localTs(at))}` : "";
  const first = (run.body ?? "").split("\n").find((x: string) => x.trim())?.slice(0, 220) ?? "";
  const similar = () => {
    const brief = `Paylaşılan şu gönderiye benzer yeni bir gönderi: "${first}". Aynı ton ve biçim; aynı konuyu ve aynı açılışı tekrar etme.`;
    const fmt = run.post?.format ?? ref?.format;
    const t = newTask(task.worldId, `${task.title} · yeni gönderi`, {
      projectId: task.projectId, who: "claude", day: today(), notes: brief,
      ...(acc && fmt ? { post: { accountId: acc.id, format: fmt, brief } } : {}),
    });
    ctx.mutate((st) => void st.tasks.push(t));
    onClose();
    openNew(ctx, t.id);
  };
  return (
    <div className="dshared">
      <p className="dshst"><Check2 size={14} strokeWidth={2.6} />Paylaşıldı{acc ? <> · <b>{acc.name || acc.handle}</b></> : null}{when ? ` · ${when}` : ""}</p>
      <div className="dshacts">
        {run.postUrl && <a className="btn sm primary" href={run.postUrl} target="_blank" rel="noreferrer" onClick={(e) => openPost(run, e)}>Gönderiyi aç<ArrowUpRight size={13} /></a>}
        <button className="btn sm" onClick={similar}><Copy size={13} />Benzerini oluştur</button>
        <button className="btn sm ghost" onClick={() => askRouAbout({ taskId: task.id, runId: run.id })}><MessageCircle size={13} />Rou'ya sor</button>
      </div>
    </div>
  );
}

function Section({ title, meta, fold, children }: { title: string; meta?: string; fold?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!fold);
  return (
    <section className="dsec">
      {fold ? (
        <button className="dsechead is-fold" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="flabel">{title}</span>
          <span className="dsecend">{meta && <span className="muted">{meta}</span>}<ChevronDown size={15} className={open ? "is-open" : ""} /></span>
        </button>
      ) : (
        <div className="dsechead"><span className="flabel">{title}</span>{meta && <span className="muted">{meta}</span>}</div>
      )}
      {open && children}
    </section>
  );
}

// Üstteki proje seçici: dünya › proje. Seçince iş (ve saatleri) o projeye/dünyaya taşınır.
function ProjectPick({ task, ctx }: { task: Task; ctx: Ctx }) {
  const s = ctx.state;
  const w = worldOf(s, task.worldId);
  const p = projectOf(s, task.projectId);
  // Paylaşılmış gönderinin ya da bir otomasyonun işinin yeri değişmez: yalnız gösterilir (otomasyonun projesi otomasyonda ayarlanır).
  const locked = !!task.autoId || s.runs.some((r) => r.taskId === task.id && r.status === "posted");
  if (locked) return <span className="ppick is-locked" style={{ ["--w" as string]: w.color }} title={task.autoId ? "Otomasyonun işi; projesi otomasyonda" : "Paylaşıldı"}><i />{w.name}<span className="sep">›</span><b>{p ? p.name : "Projesiz"}</b></span>;
  return (
    <Select className="ppick" style={{ ["--w" as string]: w.color }} title="Projeyi değiştir" label="Proje"
      value={task.projectId ?? `none:${task.worldId}`}
      groups={projectGroups(s, task.projectId)}
      onChange={(v) => {
        ctx.mutate((st) => {
          const x = st.tasks.find((y) => y.id === task.id);
          if (!x) return;
          if (v.startsWith("none:")) { x.worldId = v.slice(5); x.projectId = null; }
          else { const pr = st.projects.find((y) => y.id === v); if (pr) { x.worldId = pr.worldId; x.projectId = pr.id; } }
          st.blocks.forEach((b) => b.taskId === x.id && (b.worldId = x.worldId));
        });
      }}>
      <i />{w.name}<span className="sep">›</span><b>{p ? p.name : "Projesiz"}</b>
    </Select>
  );
}

// Atanan iş ne zaman başlar (server/schedule.mjs ile aynı kural: günü gelince 07:00'de, takvimde saati varsa 1 saat önce).
function startText(s: Ctx["state"], task: Task) {
  if (kickOffWhat(s, task)) return "Kaydedince hemen başlar.";
  if (s.runs.some((r) => r.taskId === task.id)) return "";
  if (!task.day) return `Gün seçince o gün kendiliğinden başlar.`;
  const t = today();
  if (task.day > t) return `${relDay(task.day)} kendiliğinden başlar.`;
  if (task.day < t) return "Birazdan başlar.";
  const blk = blocksOf(s, task.id).filter((b) => b.start.slice(0, 10) === t).map((b) => b.start.slice(11, 16)).sort()[0];
  const [h, m] = (blk ?? "08:00").split(":").map(Number);
  const at = blk ? `${String(Math.max(0, h - 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}` : "07:00";
  const n = new Date();
  return at <= `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}` ? "Birazdan başlar." : `Bugün ${at}'de kendiliğinden başlar.`;
}

// Kim yapacak. Otomasyon işinde adımlar otomasyondan gelir (değiştirilmez); tek işte Sen ya da Rou seçilir.
const STEP_NAME: Record<string, string> = { write: "Hazırlık", voice: "Ses kaydı", video: "Video", approve: "Onay", publish: "Paylaşım" };
const WHO_HINT: Record<string, string> = { me: "Sen yaparsın.", claude: "Rou yazar, görsel ve video üretir, araştırır; tarayıcıda sayfa ve form görevlerini de yapar." };
const BRIEF_HINT: Record<string, string> = {
  me: "Ayrıntı, link, not",
  claude: "Rou'ya ne yapacağını anlat: amaç, kullanacağı bilgi ve istediğin sonuç. Tarayıcıda yapılacaksa bunu da yaz.",
};
function WhoRow({ task, ctx, play }: { task: Task; ctx: Ctx; play?: React.ReactNode }) {
  const s = ctx.state;
  const a = autoOf(s, task);
  if (a && a.who !== "me") {
    const st = stagesOf(s, a, task, runOfTask(s.runs, task.id));
    return (
      <div>
        <dt><UserRound size={15} />Kim</dt>
        <dd className="whosteps">
          {st.steps.map((x) => x.key === "publish" && !st.finished ? (
            // Paylaşan bu gönderi için değiştirilebilir (otomasyonun varsayılanını ezer).
            <span key={x.key} className={`whostep is-pick ${x.key === st.current && !st.finished ? "is-now" : ""}`}>{STEP_NAME[x.key]}
              {(["claude", "me"] as const).map((k) => <button key={k} className={x.who === BOT[k] ? "on" : ""} aria-pressed={x.who === BOT[k]} onClick={() => ctx.mutate((stt) => { const y = stt.tasks.find((z) => z.id === task.id); if (y) { if (k === (a.sharer ?? "claude")) delete y.sharer; else y.sharer = k; } })}>{BOT[k]}</button>)}
            </span>
          ) : <span key={x.key} className={`whostep ${x.who === "Sen" ? "is-you" : ""} ${x.key === st.current && !st.finished ? "is-now" : ""}`}>{STEP_NAME[x.key] ?? x.key}<b>{x.who}</b></span>)}
        </dd>
      </div>
    );
  }
  if (a) return null;
  const who = task.who ?? "me";
  return (
    <div>
      <dt><UserRound size={15} />Kim</dt>
      <dd className="whodd">
        <div className="seg whoseg" role="radiogroup" aria-label="Kim yapacak">
          {(["me", "claude"] as const).map((k) => (
            <button key={k} role="radio" aria-checked={who === k} className={who === k ? "on" : ""} onClick={() => ctx.mutate((st) => { const x = st.tasks.find((y) => y.id === task.id); if (x) { if (k === "me") delete x.who; else x.who = k; } })}>{BOT[k]}</button>
          ))}
        </div>
        {who === "me" && task.status !== "done" && play}
        {/* Ne yapacağını üstteki "Rou yapar" anlatır; burada yalnız ne zaman başlayacağı. */}
        {who !== "me" && startText(s, task) && <p className="whohint">{startText(s, task)}</p>}
      </dd>
    </div>
  );
}
