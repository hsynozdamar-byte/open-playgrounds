import { weekReport } from "../postReport";
import { PLATFORM_LABEL } from "../../shared/social.mjs";
import { BrandIcon } from "../ui/BrandIcon";
import { AnimatePresence, motion } from "motion/react";
import { runOfTask } from "../runs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlignLeft, CalendarDays, CalendarRange, Check, FolderOpen, Settings2, ChevronLeft, ChevronRight, Plus, RefreshCw, Repeat, Sparkles, X } from "lucide-react";
import type { Account, Automation, PostFormat, Project, Run, Task, World } from "../types";
import { type Ctx, ALL, newTask } from "../lib";
import { addDays, dayLong, dayName, daysBetween, dayNum, dayShort, hm, localTs, mkTs, range, relDay, today, toMin, weekStart } from "../date";
import { uid } from "../store";
import { FORMATS, POST_PLATFORMS, accountOf, formatOf, formatsOf, isFeed, normalize, pickAccount, platformOfFormat, taskRef } from "../../shared/social.mjs";
import { DatePick } from "../ui/DatePick";
import { RunCard, SeriesDot, autoOf, ghosts, isLatest, isStale, runAt } from "../ui/Auto";
import { PageHead } from "../ui/PageHead";
import { AgentAlert } from "../ui/AgentStatus";
import { reveal } from "../ui/reveal";
import { openAutoView } from "../ui/openAuto";
import { outputOf, platformsOf, PLATFORM_NAME } from "../../shared/stages.mjs";
import { openAutoForm } from "../ui/AutoForm";
import { AccountTile, openAccountForm } from "../ui/Social";
import { toast } from "../ui/Toast";
import { InsightButton, InsightView } from "../ui/Insights";
import { Ideas } from "../ui/Ideas";
import { Select } from "../ui/Select";
import { TimeField } from "../ui/Fields";
import { PostTile } from "../ui/PostTile";
import { AddRow, AddTile } from "../ui/QuickAdd";
import { formatAt, scheduleText } from "../../shared/repeat.mjs";
import { queueSlots, setTopic, stateOf, suggestTopics, topicOf } from "../ui/Topics";
import { topicOk } from "../postBasis";
import { SHORT_TOPIC } from "../ui/PostBasis";

// Gönderiler (eski adı Stüdyo): sosyal hesapların bu ve gelecek haftası, duruma göre gruplu liste.
// Gönderi iki yoldan gelir: otomasyonun işi (task.autoId) ya da "Haftayı planla" ile açılan iş (task.post).
// Durum: Planlandı (çıktı yok) → Hazırlanıyor → Onay bekliyor → Onaylandı → Paylaşıldı.

type Acc = Account & { world: World };
export type Item = { key: string; day: string; time: string; acc?: Acc; plats?: string[]; title: string; format: PostFormat | null; task?: Task; run?: Run; auto?: Automation };
type St = "plan" | "working" | "ready" | "approved" | "posted" | "failed" | "ghost";
// Satırdaki durum: gönderinin şu an nerede olduğu, düz dille.
const ST_LABEL: Record<St, string> = { plan: "Not ready", working: "Preparing", ready: "Awaiting your approval", approved: "Approved", posted: "Shared", failed: "Couldn't prepare", ghost: "Not ready" };
const nPosts = (n: number) => `${n} ${n === 1 ? "post" : "posts"}`;

const stOf = (it: Item): St => {
  if (!it.task) return "ghost";
  const r = it.run;
  if (!r) return "plan";
  if (r.status === "working") return isStale(r) ? "failed" : "working";
  return r.status === "acted" ? "posted" : r.status;
};

// Mercekteki dünyaların paylaşım hesapları.
export const studioAccounts = (ctx: Ctx): Acc[] =>
  ctx.state.worlds.filter((w) => ctx.route.lens === ALL || w.id === ctx.route.lens).flatMap((w) => (w.accounts ?? []).filter((a) => !isFeed(a.platform)).map((a) => ({ ...a, world: w })));

const postPlats = (t: Task) => { const p = platformOfFormat(t.post?.format); return p ? [p] : []; };
const timeOf = (s: Ctx["state"], t: Task) => t.post?.at || t.autoSlot || s.blocks.find((b) => b.taskId === t.id)?.start.slice(11, 16) || "";

export function itemsOf(ctx: Ctx, accs: Acc[], days: string[]): Item[] {
  const s = ctx.state;
  const ids = new Set(accs.map((a) => a.id));
  const byId = new Map(accs.map((a) => [a.id, a]));
  const out: Item[] = [];
  for (const t of s.tasks) {
    if (!t.day || !days.includes(t.day)) continue;
    const ref = taskRef(s, t);
    const acc = accountOf(s, ref);
    const run = runOfTask(s.runs, t.id);
    if (acc && ids.has(acc.id)) { out.push({ key: t.id, day: t.day, time: timeOf(s, t), acc: byId.get(acc.id)!, title: t.title, format: formatOf(s, ref), task: t, run }); continue; }
    // Hesabı bağlanmamış elle gönderi: platform seçildiyse o, yoksa Rou seçer.
    if (!acc && t.post && (ctx.route.lens === ALL || t.worldId === ctx.route.lens)) { out.push({ key: t.id, day: t.day, time: timeOf(s, t), plats: postPlats(t), title: t.title, format: null, task: t, run }); continue; }
    // Hesabı olmayan ama gönderi/video üreten otomasyonun işi de bir gönderidir (platform otomasyondan).
    const a = !acc ? autoOf(s, t) : undefined;
    if (a && (ctx.route.lens === ALL || a.worldId === ctx.route.lens) && ["post", "video"].includes(outputOf(s, a))) out.push({ key: t.id, day: t.day, time: timeOf(s, t), plats: platformsOf(s, a), title: t.title, format: null, task: t, run });
  }
  for (const g of ghosts(s, ctx.route.lens, days)) {
    const acc = accountOf(s, g.a);
    const key = `${g.a.id}-${g.day}-${g.slot}`;
    if (acc && ids.has(acc.id)) out.push({ key, day: g.day, time: g.slot, acc: byId.get(acc.id)!, title: g.a.title, format: formatOf(s, { ...g.a, format: formatAt(g.a, g.day, g.slot) }), auto: g.a });
    else if (!acc && ["post", "video"].includes(outputOf(s, g.a))) out.push({ key, day: g.day, time: g.slot, plats: platformsOf(s, g.a), title: g.a.title, format: null, auto: g.a });
  }
  return out.sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
}

// Otomasyon işinden ve henüz açılmamış saatinden kart öğesi (Otomasyonlar › Bugün de aynı kartı kullanır).
export function itemOfTask(s: Ctx["state"], t: Task): Item {
  const ref = taskRef(s, t);
  const acc = accountOf(s, ref);
  const a = autoOf(s, t);
  const world = acc && s.worlds.find((w) => w.accounts?.some((x) => x.id === acc.id));
  return { key: t.id, day: t.day!, time: timeOf(s, t), acc: acc && world ? { ...acc, world } : undefined, plats: acc ? undefined : a ? platformsOf(s, a) : t.post ? postPlats(t) : undefined, title: t.title, format: acc ? formatOf(s, ref) : null, task: t, run: runOfTask(s.runs, t.id) };
}
export function itemOfSlot(s: Ctx["state"], a: Automation, day: string, slot: string): Item {
  const acc = accountOf(s, a);
  const world = acc && s.worlds.find((w) => w.accounts?.some((x) => x.id === acc.id));
  return { key: `${a.id}-${day}-${slot}`, day, time: slot, acc: acc && world ? { ...acc, world } : undefined, plats: !acc ? platformsOf(s, a) : undefined, title: a.title, format: acc ? formatOf(s, { ...a, format: formatAt(a, day, slot) }) : null, auto: a };
}

async function prepareMany(ids: string[]) {
  const r = await fetch("/api/prepare-many", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).then((x) => x.json()).catch(() => ({ ok: false }));
  toast(r.ok ? `Preparing ${nPosts(ids.length)} one by one` : "Couldn't reach the server");
}

// Üstteki özet: gönderiler hangi aşamada. Tıklayınca liste o aşamaya süzülür.

// Sol listedeki "Gönderiler" satırının özeti: hesap adları değil, gönderilerin durumu.
export function studioSummary(ctx: Ctx) {
  const accs = studioAccounts(ctx);
  if (!accs.length) return "Add an account and your posts gather here";
  const items = itemsOf(ctx, accs, Array.from({ length: 14 }, (_, i) => addDays(weekStart(today()), i)));
  const n = (st: St[]) => items.filter((x) => st.includes(stOf(x))).length;
  return [n(["ready", "failed"]) && `${n(["ready", "failed"])} awaiting approval`, n(["plan", "ghost", "working", "approved"]) && `${n(["plan", "ghost", "working", "approved"])} up next`].filter(Boolean).join(" · ") || `${accs.length} ${accs.length === 1 ? "account" : "accounts"} · no planned posts`;
}

// Sol menüdeki Gönderiler sayfası: otomasyonlardan çıkan ve planlanan bütün gönderiler tek yerde.
export function Posts({ ctx }: { ctx: Ctx }) {
  return (
    <div className="autos posts">
      <PageHead ctx={ctx} title="Posts" sub="Every post your automations make and every one you add by hand. Nothing is shared until you approve it." />
      <AgentAlert ctx={ctx} />
      <Studio ctx={ctx} />
    </div>
  );
}

// Rail rozeti: onay bekleyen gönderiler (hesaplı ya da gönderi üreten otomasyonun çıktısı).
export function postsWaiting(s: Ctx["state"], lens: string) {
  return s.runs.filter((r) => {
    // Kenar çubuğundaki sayı Gönderiler'in "Onayını bekliyor" kutusuyla aynı: hazır ya da hazırlanamamış son çıktılar.
    if (!["ready", "failed"].includes(r.status) || !isLatest(s, r)) return false;
    const t = s.tasks.find((x) => x.id === r.taskId);
    if (!t || t.status === "done" || (lens !== ALL && t.worldId !== lens)) return false;
    const a = autoOf(s, t);
    return !!r.post || !!accountOf(s, taskRef(s, t)) || (!!a && ["post", "video"].includes(outputOf(s, a)));
  }).length;
}

export function Studio({ ctx }: { ctx: Ctx }) {
  const s = ctx.state;
  const accs = studioAccounts(ctx);
  const thisWeek = weekStart(today());
  // Bir seferde tek hafta; oklarla geçmiş haftalara (arşiv) ve önümüzdeki haftalara geçilir.
  const [wk, setWk] = useState(thisWeek);
  const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
  // Otomasyon süzgeci: çipe basınca hafta o otomasyonun gönderilerine süzülür. Otomasyonların listesi burası.
  // Proje süzgeci: hafta ve otomasyon çipleri o projenin gönderilerine daralır.
  const [proj, setProj] = useState<string | null>(null);
  const allAutos = postAutos(ctx, accs);
  const autos = proj ? allAutos.filter((a) => a.projectId === proj) : allAutos;
  const [only, setOnly] = useState<string | null>(null);
  const picked0 = autos.find((a) => a.id === only);
  const every = itemsOf(ctx, accs, days);
  const projs = s.projects.filter((p) => allAutos.some((a) => a.projectId === p.id) || every.some((x) => projIdOf(s, x) === p.id));
  const all = (proj ? every.filter((x) => projIdOf(s, x) === proj) : every).sort((a, b) => a.day.localeCompare(b.day) || (a.time || "99").localeCompare(b.time || "99"));
  const items = picked0 ? all.filter((x) => autoIdOf(s, x) === picked0.id) : all;
  const first = s.tasks.reduce((m, t) => (t.day && t.day < m ? t.day : m), thisWeek);
  const minWk = weekStart(first);
  const maxWk = addDays(thisWeek, 28);
  const [sel, setSel] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [creating, setCreating] = useState(false);
  const [summary, setSummary] = useState(false);
  const [ins, setIns] = useState<Account | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const sumBtn = useRef<HTMLButtonElement>(null);
  const past = wk < thisWeek;
  const todo = items.filter((x) => x.task && x.day >= today() && stOf(x) === "plan" && x.task.status !== "done" && (x.task.post || s.automations.find((a) => a.id === x.task!.autoId)?.who === "claude"));
  const addWorld = ctx.route.lens === ALL ? (s.worlds.find((w) => w.accounts?.length) ?? s.worlds[0])?.id : ctx.route.lens;
  const count = (st: St[]) => items.filter((x) => st.includes(stOf(x))).length;
  const card = (it: Item) => <PostCard key={it.key} it={it} s={s} open={sel === it.key} onToggle={() => setSel(it.key)} />;
  // Hafta | Ay: ay görünümünde aynı süzgeçlerle ayın bütün gönderileri; karta basınca aynı ayrıntı açılır.
  const [view, setView] = useState<"week" | "month">("week");
  const [mon, setMon] = useState(today().slice(0, 7));
  // Ay görünümünde seçili gün: altında o günün bütün gönderileri kart olarak açılır.
  const [mday, setMday] = useState<string | null>(today());
  const mdays = monthDays(mon);
  const mevery = view === "month" ? itemsOf(ctx, accs, mdays) : [];
  const mitems = mevery.filter((x) => (!proj || projIdOf(s, x) === proj) && (!picked0 || autoIdOf(s, x) === picked0.id));
  const picked = (view === "month" ? mitems : items).find((x) => x.key === sel);
  // Durum süzgeci (2026-11-01, ayrı Plan özeti kaldırıldı): sayılar planın içinde, basınca hafta/ay o duruma daralır.
  const [stf, setStf] = useState<StKey>("all");
  const base = view === "month" ? mitems : items;
  const stRows = base.map((it) => rowOf(s, it));
  const shownKeys = new Set(stRows.filter((r) => stMatch(stf, r)).map((r) => r.it.key));
  const vis = (list: Item[]) => (stf === "all" ? list : list.filter((x) => shownKeys.has(x.key)));
  const go = (w: string) => (setWk(w), setSel(null));

  return (
    <>
    <section className="card autodetail studio">
      <div className="stbox">
        <div className="stboxhead">
          <h3>Sharing plan</h3>
          {/* Başlıkta tek yer (2026-11-01): Rou'ya talimatla planlat, haftanın konularını düzenle, tek seferlik gönderi oluştur.
              Otomasyon kurmak projenin sayfasında. */}
          <button className={`btn sm ghost ${noteOpen ? "on" : ""}`} disabled={past} onClick={() => setNoteOpen(!noteOpen)}><Sparkles size={14} />Plan with Rou</button>
          <button className="btn sm ghost" disabled={past} title={past ? "A past week can't be planned" : undefined} onClick={() => setPlanning(true)}><CalendarRange size={14} />Edit topics</button>
          <button className="btn sm primary" onClick={() => setCreating(true)}><Plus size={14} />Create post</button>
        </div>
        {/* Süzgeçler tek çerçevede (2026-11-01): solda etiket sütunu, sağda aynı biçimde çipler. Proje seçilince otomasyon satırı o projeye daralır. */}
        {(projs.length > 1 || autos.length > 0) && (
          <div className="stfbar">
            {projs.length > 1 && (
              <div className="stfrow">
                <span className="stflab"><FolderOpen size={14} />Project</span>
                <nav className="stprojs" aria-label="Project">
                  <button className={proj ? "" : "on"} onClick={() => (setProj(null), setOnly(null), setSel(null))}>All</button>
                  {projs.map((p) => <button key={p.id} className={proj === p.id ? "on" : ""} style={{ ["--w" as string]: s.worlds.find((w) => w.id === p.worldId)?.color }} onClick={() => (setProj(p.id), setOnly(null), setSel(null))}><i />{p.name}</button>)}
                </nav>
              </div>
            )}
            {autos.length > 0 && (
              <div className="stfrow">
                <span className="stflab"><Repeat size={14} />Automation</span>
                <AutoChips ctx={ctx} autos={autos} items={all} on={picked0?.id ?? null} onPick={(id) => (setOnly(id), setSel(null))} />
              </div>
            )}
          </div>
        )}
        {/* Kural satırı açılıp kapanırken alttaki hafta zıplamaz, yumuşakça kayar. */}
        <AnimatePresence initial={false}>
          {picked0 && (
            <motion.div key="rule" className="aruleWrap" initial={{ height: 0, opacity: 0, marginTop: -12 }} animate={{ height: "auto", opacity: 1, marginTop: 0 }} exit={{ height: 0, opacity: 0, marginTop: -12 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}>
              <AutoRule ctx={ctx} a={picked0} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="stviewrow">
          <nav className="seg stview" role="tablist">
            {([["week", "Week"], ["month", "Month"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={view === k} className={view === k ? "on" : ""} onClick={() => (setView(k), setSel(null))}>{l}</button>)}
          </nav>
          {view === "week" ? <WeekNav wk={wk} min={minWk} max={maxWk} onGo={go} /> : (
            <div className="wknav">
              <button className="iconbtn" onClick={() => setMon(shiftMonth(mon, -1))} aria-label="Previous month"><ChevronLeft size={16} /></button>
              <p><b>{monthName(mon)}</b></p>
              <button className="iconbtn" onClick={() => setMon(shiftMonth(mon, 1))} aria-label="Next month"><ChevronRight size={16} /></button>
              {mon !== today().slice(0, 7) && <button className="link" onClick={() => setMon(today().slice(0, 7))}>Back to this month</button>}
            </div>
          )}
        </div>
        <div className="stplanbar">
          <div className="psstats">
            {ST_TILES.map((x) => { const n = stRows.filter((r) => stMatch(x.id, r)).length; return <button key={x.id} className={`${stf === x.id ? "on" : ""} is-${x.id}`} onClick={() => setStf(stf === x.id ? "all" : x.id)}><b>{n}</b><span>{x.label}</span></button>; })}
          </div>
          {noteOpen && wk >= thisWeek && <WeekNote ctx={ctx} week={wk} items={items} onDone={() => setNoteOpen(false)} />}
        </div>
        {view === "month" && <MonthGrid s={s} mon={mon} days={mdays} items={vis(mitems)} day={mday} onDay={setMday} card={card} />}
        {view === "month" ? null : !items.length && wk === thisWeek && !s.automations.length ? (
          <ol className="ststeps">
            <li><b>Plan</b><span>The week's posts and their topics. Rou writes any topic left empty.</span></li>
            <li><b>Prepare</b><span>Each post gets its text and visual.</span></li>
            <li><b>Approve</b><span>You check the preview and approve. Sharing happens on your click.</span></li>
          </ol>
        ) : (
          <>
            {todo.length > 0 && (
              <div className="stprep">
                <Sparkles size={15} />
                <span><b>{nPosts(todo.length)} planned but not ready.</b> Let Rou prepare the text and visual now, then approve from the preview.</span>
                <button className="btn sm primary" onClick={() => prepareMany(todo.map((x) => x.task!.id))}>Prepare all</button>
              </div>
            )}
            {/* Hafta yedi sütun: boş gün de yerini tutar, haftanın ritmi bir bakışta görünür. */}
            <div className="stweek">
              <div className="stgrid">
                {days.map((d) => {
                  const list = vis(items).filter((x) => x.day === d);
                  return (
                    <div key={d} className={`stcol ${d === today() ? "is-today" : d < today() ? "is-past" : ""} ${list.length ? "" : "is-empty"}`}>
                      <p className="stcolhead"><b>{dayTitle(d, true)}</b><span>{dayNum(d)}</span></p>
                      {list.length ? <ul className="stcards">{list.map(card)}</ul> : <span className="stnone" />}
                    </div>
                  );
                })}
              </div>
              {!items.length && <p className="muted stnote">{past ? "Nothing was shared this week." : "No posts planned this week."}</p>}
            </div>
          </>
        )}
        {/* Haftalık paylaşım raporu takvimin hemen altında (2026-11-08). */}
        {view === "week" && <WeekReport s={s} wk={wk} />}
      </div>
      {picked && <PickedPost key={picked.key} ctx={ctx} it={picked} onClose={() => setSel(null)} />}
      {creating && <NewPost ctx={ctx} onClose={() => setCreating(false)} />}
      {planning && <PlanWeek ctx={ctx} accounts={accs} week={wk} min={thisWeek} max={maxWk} onWeek={go} onClose={() => setPlanning(false)} />}
    </section>
    <Ideas ctx={ctx} autos={autos} pick={picked0?.id ?? null} />
    {ins && <InsightView ctx={ctx} a={ins} onClose={() => setIns(null)} />}
    <section className="card autodetail studio staccs">
      <div className="stbox">
        <div className="stboxhead">
          <h3>Accounts</h3>
          <span className="n">{accs.length || ""}</span>
        </div>
        {accs.length ? (
          <ul className="acclist strip">
            <AddTile items={[{ label: "Add account", onClick: () => openAccountForm({ worldId: addWorld, group: "post" }) }]} />
            {(proj ? accs.filter((a) => s.projects.find((p) => p.id === proj)?.accountIds?.includes(a.id)) : accs).map((a) => <AccountTile key={a.id} ctx={ctx} a={a} world={a.world}><span className="accuse">{a.world.name} world{!a.handle && !a.name ? " · add its name" : ""}</span>{a.platform === "instagram" && <InsightButton a={a} onOpen={() => setIns(a)} />}</AccountTile>)}
          </ul>
        ) : (
          <p className="muted stnote">Add the account you share from: Instagram, LinkedIn or X. Posts are prepared for that account.</p>
        )}
      </div>
    </section>
    </>
  );
}

// Gönderi üreten otomasyonlar (hesabı mercekte ya da çıktısı gönderi/video), dünya sırasıyla.
function postAutos(ctx: Ctx, accs: Acc[]): Automation[] {
  const s = ctx.state;
  const ids = new Set(accs.map((a) => a.id));
  const order = new Map(s.worlds.map((w, i) => [w.id, i]));
  return s.automations
    .filter((a) => (ctx.route.lens === ALL || a.worldId === ctx.route.lens) && (accountOf(s, a) ? ids.has(accountOf(s, a)!.id) : ["post", "video"].includes(outputOf(s, a))))
    .sort((a, b) => Number(a.status === "paused") - Number(b.status === "paused") || (order.get(a.worldId)! - order.get(b.worldId)!) || a.title.localeCompare(b.title, "en-US"));
}
const autoIdOf = (s: Ctx["state"], it: Item) => it.auto?.id ?? (it.task ? autoOf(s, it.task)?.id : undefined);
const platOf = (s: Ctx["state"], a: Automation) => accountOf(s, a)?.platform ?? platformsOf(s, a)[0];

// Otomasyon çipleri: Tümü + her otomasyon (platform ikonu, adı, bu hafta onay bekleyen sayısı). Duraklatılmış olan soluk.
function AutoChips({ ctx, autos, items, on, onPick }: { ctx: Ctx; autos: Automation[]; items: Item[]; on: string | null; onPick: (id: string | null) => void }) {
  const s = ctx.state;
  const wait = (id: string) => items.filter((x) => autoIdOf(s, x) === id && (x.run?.status === "ready")).length;
  // Tek satır: taşarsa yatay kayar, taşan kenar yumuşakça solar; seçili çip görünür alana kayar.
  const box = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const measure = () => { const b = box.current; if (b) setEdge({ l: b.scrollLeft > 2, r: b.scrollLeft + b.clientWidth < b.scrollWidth - 2 }); };
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [autos.length]);
  useEffect(() => {
    const b = box.current;
    const el = b?.querySelector<HTMLElement>(".afilt.on");
    if (!b || !el) return;
    const pad = 28;
    const left = el.offsetLeft - pad, right = el.offsetLeft + el.offsetWidth + pad - b.clientWidth;
    if (left < b.scrollLeft) b.scrollTo({ left, behavior: "smooth" });
    else if (right > b.scrollLeft) b.scrollTo({ left: right, behavior: "smooth" });
  }, [on]);
  return (
    <div ref={box} onScroll={measure} className={`afilts ${edge.l ? "is-l" : ""} ${edge.r ? "is-r" : ""}`} role="tablist" aria-label="Filter by automation">
      <button role="tab" aria-selected={!on} className={`afilt ${!on ? "on" : ""}`} onClick={() => onPick(null)}>All</button>
      {autos.map((a) => {
        const p = platOf(s, a);
        const n = wait(a.id);
        return (
          <button key={a.id} role="tab" aria-selected={on === a.id} className={`afilt ${on === a.id ? "on" : ""} ${a.status === "paused" ? "is-paused" : ""}`} onClick={() => onPick(on === a.id ? null : a.id)} title={a.status === "paused" ? "Paused" : scheduleText(a)}>
            {p && <BrandIcon platform={p} size={14} mono={on === a.id} />}
            <SeriesDot color={a.color} />
            <span>{a.title}</span>
            {n > 0 && <i className="afiltn" title="Awaiting your approval">{n}</i>}
          </button>
        );
      })}
    </div>
  );
}

// Seçili otomasyonun kuralı tek satırda: ne zaman, kim hazırlar, nereye. Ayarlar penceresi buradan açılır.
function AutoRule({ ctx, a }: { ctx: Ctx; a: Automation }) {
  const s = ctx.state;
  const acc = accountOf(s, a);
  const p = s.projects.find((x) => x.id === a.projectId);
  const who = a.who === "me" ? "You do it" : "Rou prepares, you approve";
  return (
    <div className="arule">
      <span className="aruletext">
        <b>{scheduleText(a)}</b>
        <span>{[who, acc ? (acc.handle?.startsWith("@") ? acc.handle : acc.name || acc.handle) : null, p?.name].filter(Boolean).join(" · ")}{a.status === "paused" ? " · Paused" : ""}</span>
      </span>
      <button className="btn sm" onClick={() => openAutoView(a.id)}><Settings2 size={14} />Settings</button>
    </div>
  );
}

// Bugün, Yarın; diğer günler kısa gün adıyla (Pzt, Sal).
const dayTitle = (d: string, short = false) => { const n = daysBetween(today(), d); const r = n === 0 || n === 1 ? relDay(d) : short ? dayShort(d) : dayName(d); return r.charAt(0).toLocaleUpperCase("en-US") + r.slice(1); };

// Hesabın okunur adı: tanıtıcı bir adres ise (linkedin.com/company/…) hesabın adı gösterilir.
const accLabel = (a: Acc) => (a.handle && !a.handle.includes("/") ? a.handle : a.name || a.handle || "unnamed");

// Hesapsız gönderinin platform satırı: otomasyonun platformları, seçilen platform ya da "Rou seçer".
const platLabel = (it: Item) => (it.plats ?? []).map((p) => PLATFORM_NAME[p] ?? p).join(", ") || (it.task?.post ? "Rou picks the platform" : "No account picked");

// Paylaşılmayan çıktı (rapor, tarayıcı işi) bitince "Bitti" der, "Paylaşıldı" değil.
const shares = (it: Item) => !!it.acc || !!it.plats?.length || !!it.format;
const stLabel = (it: Item) => { const st = stOf(it); return it.day < today() && !["posted", "approved", "failed"].includes(st) ? "Late" : st === "posted" && !shares(it) ? "Done" : ST_LABEL[st]; };
const stHint = (it: Item) => {
  const st = stOf(it);
  if (st === "ghost") return it.auto?.who === "claude" ? "Rou prepares it that morning" : "The task opens that day";
  if (st === "plan") return "Not prepared";
  if (st === "approved") return it.run?.publish?.phase ? "Rou is sharing" : "Shared when its time comes";
  if (st === "posted" && it.run?.postedAt) return `at ${hm(localTs(new Date(it.run.postedAt)))}`;
  return "";
};
const StIcon = ({ st }: { st: St }) => (st === "working" ? <RefreshCw size={11} className="spin" /> : st === "posted" || st === "approved" ? <Check size={11} /> : <i />);

export function PostCard({ it, open, onToggle, s, when }: { it: Item; open: boolean; onToggle: () => void; s: Ctx["state"]; when?: boolean }) {
  const st = stOf(it);
  const auto = it.auto ?? (it.task ? autoOf(s, it.task) : undefined);
  const tp = auto ? topicOf(s, auto, it.day, it.time) : undefined;
  const late = it.day < today() && !["posted", "approved", "failed"].includes(st);
  const fmt = it.format && FORMATS[it.format].short !== "Post" ? FORMATS[it.format].short : "";
  return (
    <li>
      <button className={`stcard st-${st} ${open ? "on" : ""} ${late ? "is-late" : ""}`} aria-expanded={open} onClick={onToggle} title={stHint(it) || undefined}>
        <span className="stctop"><span className="mono">{when && <em>{dayTitle(it.day, true)} </em>}{it.time || "–"}</span><span className="stlab"><StIcon st={st} />{st === "ready" ? "To approve" : stLabel(it)}</span></span>
        <b>{tp?.title ?? (it.task?.post && !auto ? it.title : (it.run?.title && it.run.title !== it.title ? it.run.title : it.run?.body?.split(/[.!?\n]/)[0])) ?? it.title}</b>
        {tp && it.title !== auto?.title && <span className="sttopic">{it.title}</span>}
        {(auto || it.task?.post) && <span className="stkind">{[auto ? auto.title : "One-off", projName(s, it)].filter(Boolean).join(" · ")}</span>}
        <span className="withbrand">{it.acc
          ? <><BrandIcon platform={it.acc.platform} size={12} /><span>{accLabel(it.acc)}{fmt ? ` · ${fmt}` : ""}</span></>
          : <>{(it.plats ?? []).map((p) => <BrandIcon key={p} platform={p as never} size={12} />)}<span>{platLabel(it)}</span></>}</span>
      </button>
    </li>
  );
}

// Takvimdeki karta basınca açılan gönderi penceresi. Çıktı varsa gönderi gerçek görünümüyle (onayla, revize, paylaş);
// yoksa konusu (yazılır, boşsa Rou yazar) ve şimdi hazırlatma. Alt satırda otomasyonu ve görevi açma.
// Gönderiye tıklayınca: görevi varsa tek pencere, görev penceresi (Drawer) açılır. Görevi henüz oluşmamış otomasyon gönderisinde
// (ileri bir günün saati) aynı düzende küçük pencere: konu, ne olacağı, şimdi hazırlat.
export function PickedPost({ ctx, it, onClose }: { ctx: Ctx; it: Item; onClose: () => void }) {
  const id = it.task?.id;
  useEffect(() => { if (id) { ctx.open(id); onClose(); } }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return id ? null : <PostView ctx={ctx} it={it} onClose={onClose} />;
}

export function PostView({ ctx, it, onClose }: { ctx: Ctx; it: Item; onClose: () => void }) {
  const s = ctx.state;
  const auto = it.auto ?? (it.task ? autoOf(s, it.task) : undefined);
  const st = stOf(it);
  const maker = "Rou";
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  const goAuto = () => auto && openAutoView(auto.id);
  const make = () => (it.task?.post && !topicOk(it.task.title) ? toast(SHORT_TOPIC) : it.task ? prepareMany([it.task.id]) : auto && runAt(ctx, auto, it.day, it.time));
  const why = auto?.who === "me" ? "You prepare this post." : it.task ? `${maker} prepares it 1 hour before its time, you approve.` : `If you wait, ${maker} prepares it ${it.day === today() ? "today" : "that day"} on its own, you approve.`;
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="modal postview" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <header className="pvmhead">
          <div className="pvmwho">
            <b>{auto?.title ?? it.title}</b>
            <span>{it.acc && <><BrandIcon platform={it.acc.platform} size={13} />{accLabel(it.acc)} · </>}{dayTitle(it.day)} {dayLong(it.day)}{it.time ? ` · ${it.time}` : ""}</span>
          </div>
          <span className={`stlab st-${st}`}><StIcon st={st} />{stLabel(it)}</span>
          <button className="x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="pvmbody">
          {it.run ? <RunCard r={it.run} ctx={ctx} /> : <>
            {auto && !it.task?.post && auto.who !== "me" && ["post", "video"].includes(outputOf(s, auto)) ? <PostTopic ctx={ctx} a={auto} day={it.day} slot={it.time} /> : auto && !it.task?.post ? (
              <section className="dsec">
                <div className="dsechead"><span className="flabel">What it does</span></div>
                <div className="brief topicbox is-read"><p>{it.task?.notes || auto.action || auto.title}</p></div>
              </section>
            ) : (
              <section className="dsec">
                <div className="dsechead"><span className="flabel">Konu</span></div>
                <div className="brief topicbox is-read">
                  <b>{it.title}</b>
                  {(it.task?.post?.brief || it.task?.notes) && <p>{it.task?.post?.brief || it.task?.notes}</p>}
                </div>
              </section>
            )}
            <section className="dsec">
              <div className="dsechead"><span className="flabel">Process</span></div>
              <p className="pvmwhy">{why}</p>
            </section>
          </>}
        </div>
        <footer className="pvmfoot">
          {auto && <button className="stsrc" onClick={goAuto}><Repeat size={13} /><span>{auto.title}</span><ChevronRight size={13} /></button>}
          {it.task && <button className="btn sm ghost" onClick={() => (onClose(), ctx.open(it.task!.id))}>Open task</button>}
          {!it.run && auto?.who !== "me" && <button className="btn sm primary" onClick={make}>Prepare now</button>}
        </footer>
      </motion.div>
    </div>
  );
}

// Otomasyon gönderisinin konusu: metin gibi okunur, tıklayınca düzenlenir; boşsa Rou önerebilir ya da o gün kendisi yazar.
function PostTopic({ ctx, a, day, slot }: { ctx: Ctx; a: Automation; day: string; slot: string }) {
  const t = topicOf(ctx.state, a, day, slot);
  const [title, setTitle] = useState(t?.title ?? "");
  const [brief, setBrief] = useState(t?.brief ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(t?.title ?? ""); setBrief(t?.brief ?? ""); }, [t?.title, t?.brief]);
  const save = () => { const v = title.replace(/\s+/g, " ").trim(); if (v !== (t?.title ?? "") || brief.trim() !== (t?.brief ?? "")) setTopic(ctx, a, day, slot, v ? { title: v, brief: brief.trim() } : null); };
  return (
    <section className="dsec">
      <div className="dsechead"><span className="flabel">Konu</span>{!t && a.who !== "me" ? <button className="link" disabled={busy} onClick={async () => { setBusy(true); await suggestTopics(ctx, a, 6); setBusy(false); }}>{busy ? "Rou is writing…" : "Let Rou suggest"}</button> : <span className="muted">Left empty, Rou writes it</span>}</div>
      <div className="brief topicbox">
      <textarea className="ttl" rows={1} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())} placeholder="This post's topic" aria-label="Topic" />
      <textarea rows={1} value={brief} onChange={(e) => setBrief(e.target.value)} onBlur={save} placeholder="What it should say" aria-label="What it should say" />
      </div>
    </section>
  );
}

// Hafta gezgini: ‹ hafta adı ve tarih aralığı ›; bu haftada değilse "Bu haftaya dön".
const weekName = (wk: string) => { const n = daysBetween(weekStart(today()), wk) / 7; return n === 0 ? "This week" : n === 1 ? "Next week" : n === -1 ? "Last week" : n < 0 ? `${-n} weeks ago` : `In ${n} weeks`; };
// Ay görünümü: ayın haftaları, her gün en çok 3 gönderi (saat, platform, konu), fazlası "+N".
const monthDays = (m: string) => { const first = `${m}-01`; const start = weekStart(first); const out: string[] = []; for (let d = start; d.slice(0, 7) <= m || out.length % 7; d = addDays(d, 1)) out.push(d); return out; };
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const monthName = (m: string) => new Date(`${m}-01T12:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });
function MonthGrid({ s, mon, days, items, day, onDay, card }: { s: Ctx["state"]; mon: string; days: string[]; items: Item[]; day: string | null; onDay: (d: string | null) => void; card: (it: Item) => React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const of = (d: string) => items.filter((x) => x.day === d).sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  const pick = (d: string) => {
    onDay(day === d ? null : d);
    if (day !== d) setTimeout(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  };
  const shown = day ? of(day) : [];
  const counts = shown.reduce<Record<string, number>>((m, it) => { const st = rowOf(s, it).st; m[st] = (m[st] ?? 0) + 1; return m; }, {});
  return (
    <>
      <div className="stmonth">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <p key={d} className="stmhead">{d}</p>)}
        {days.map((d) => {
          const list = of(d);
          return (
            // Güne basınca altında o günün ayrıntısı açılır; gönderiye basınca gönderinin kendisi.
            <div key={d} role="button" tabIndex={0} aria-pressed={day === d} onClick={() => pick(d)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick(d))}
              className={`stmcell ${d.slice(0, 7) !== mon ? "is-out" : ""} ${d === today() ? "is-today" : ""} ${day === d ? "is-sel" : ""} ${d < today() ? "is-past" : ""}`}>
              <span className="stmnum">{Number(d.slice(8))}{list.length > 0 && <em>{list.length}</em>}</span>
              {list.slice(0, 3).map((it) => {
                const p = it.acc?.platform ?? it.plats?.[0];
                const r = rowOf(s, it);
                const t = titleOf(it, r.topic);
                return <span key={it.key} className={`stmitem st-${r.st} ${t ? "" : "is-empty"}`}>{p && <BrandIcon platform={p as never} size={11} />}<em className="mono">{it.time}</em><span>{t || "No topic"}</span></span>;
              })}
              {list.length > 3 && <span className="stmmore">+{list.length - 3} more</span>}
              {list.length > 0 && <span className="stmdots" aria-hidden="true">{list.slice(0, 6).map((it) => <i key={it.key} className={`st-${rowOf(s, it).st}`} />)}</span>}
            </div>
          );
        })}
      </div>
      {day && (
        <section className="stmday" ref={panel} aria-label="Posts of the day">
          <header>
            <h4>{new Date(`${day}T12:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</h4>
            <span className="n">{shown.length ? nPosts(shown.length) : "No posts"}</span>
            <span className="stmdaysum">{Object.entries(counts).map(([st, n]) => <span key={st} className={`stlab st-${st}`}><StIcon st={st as St} />{n} {ST_LABEL[st as St].toLocaleLowerCase("en-US")}</span>)}</span>
            <button className="iconbtn" onClick={() => onDay(null)} aria-label="Close day" title="Close"><X size={16} /></button>
          </header>
          {shown.length ? <ul className="stcards stmdaycards">{shown.map(card)}</ul> : <p className="stmdayempty">No posts planned for this day.</p>}
        </section>
      )}
    </>
  );
}

// Durum süzgeçleri: Onayını bekliyor (hazır ya da hatalı), Hazırlanacak (konusu olan plan), Konusu boş, Paylaşıldı.
type StKey = "all" | "you" | "plan" | "empty" | "posted";
const ST_TILES: { id: Exclude<StKey, "all">; label: string }[] = [{ id: "you", label: "Awaiting your approval" }, { id: "plan", label: "To prepare" }, { id: "empty", label: "No topic" }, { id: "posted", label: "Shared" }];
function stMatch(k: StKey, r: Row) {
  const empty = r.editable && !titleOf(r.it, r.topic);
  return k === "all" ? true : k === "you" ? r.st === "ready" || r.st === "failed" : k === "empty" ? empty : k === "plan" ? (r.st === "plan" || r.st === "ghost") && !empty : r.st === "posted";
}
// Hafta talimatı: haftanın nasıl planlanacağı yazılır; Rou hazırlanmamış gönderilerin konusunu buna göre yeniden kurar.
function WeekNote({ ctx, week, items, onDone }: { ctx: Ctx; week: string; items: Item[]; onDone?: () => void }) {
  const s = ctx.state;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!note.trim() || busy) return;
    setBusy(true);
    const autoIds = [...new Set(items.map((it) => autoIdOf(s, it)).filter(Boolean))];
    const r = await fetch("/api/plan-week-topics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ week: week < today() ? today() : week, days: 7, note, ...(autoIds.length ? { autoIds } : {}) }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
    setBusy(false);
    toast(r.ok ? (r.filled ? `Rou set the topics of ${nPosts(r.filled)} from your note` : "No topics needed changing") : r.error ?? "Couldn't plan");
    if (r.ok) { setNote(""); onDone?.(); }
  };
  return (
    <div className="pspnote stnote2">
      <textarea rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="How should this week be planned? E.g. talk about the new release, switch to the blog post on Friday" />
      <button className="btn sm primary" disabled={!note.trim() || busy} onClick={run}>{busy ? "Rou is planning…" : "Let Rou plan with this"}</button>
    </div>
  );
}

function WeekNav({ wk, min, max, onGo }: { wk: string; min: string; max: string; onGo: (w: string) => void }) {
  const cur = weekStart(today());
  return (
    <div className="wknav">
      <button className="iconbtn" disabled={wk <= min} onClick={() => onGo(addDays(wk, -7))} aria-label="Previous week"><ChevronLeft size={16} /></button>
      <p><b>{weekName(wk)}</b><span>{range(wk)}</span></p>
      <button className="iconbtn" disabled={wk >= max} onClick={() => onGo(addDays(wk, 7))} aria-label="Next week"><ChevronRight size={16} /></button>
      {wk !== cur && <button className="link" onClick={() => onGo(cur)}>Back to this week</button>}
    </div>
  );
}

// Haftayı planla: haftanın bütün gönderileri gün gün (otomasyonların saatleri + elle eklenenler) ve her birinin konusu.
// Konusu boş olanları Rou doldurur (server/plan.mjs fillTopics); konusu olanlar sırayla hazırlatılır. Elle gönderi de eklenir.
function PlanWeek({ ctx, accounts, week, min, max, onWeek, onClose }: { ctx: Ctx; accounts: Acc[]; week: string; min: string; max: string; onWeek: (w: string) => void; onClose: () => void }) {
  const s = ctx.state;
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const items = itemsOf(ctx, accounts, days).sort((a, b) => a.day.localeCompare(b.day) || (a.time || "99").localeCompare(b.time || "99"));
  const rows = items.map((it) => rowOf(s, it));
  const open = rows.filter((r) => r.editable);
  const empty = open.filter((r) => !r.topic && r.auto && r.auto.who !== "me");
  const ready = open.filter((r) => r.topic && r.who === "claude");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  const fill = async () => {
    setBusy(true);
    const r = await fetch("/api/plan-week-topics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ week }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
    setBusy(false);
    toast(!r.ok ? `No topics came back: ${r.error ?? "error"}` : r.filled ? `Topics written for ${nPosts(r.filled)}` : "No empty topics left");
  };
  const prep = () => {
    queueSlots(ctx, ready.filter((r) => r.auto && !r.it.task).map((r) => ({ a: r.auto!, day: r.it.day, slot: r.slot })), ready.filter((r) => r.it.task).map((r) => r.it.task!.id));
  };
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="modal planweek" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <div className="afhead">
          <div>
            <h2 className="mtitle">Plan the week</h2>
            <p className="muted msub">The week's posts and each one's topic. Rou writes from these topics.</p>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <WeekNav wk={week} min={min} max={max} onGo={onWeek} />
        <div className="pwsum">
          <p><b>{nPosts(items.length)}</b><span>{[rows.length - open.length && `${rows.length - open.length} prepared`, open.length - empty.length && `${open.length - empty.length} with a topic`, empty.length && `${empty.length} without a topic`].filter(Boolean).join(" · ")}</span></p>
          {(empty.length > 0 || busy) && <button className="btn sm primary" disabled={busy} onClick={fill}>
            {busy ? <><RefreshCw size={14} className="spin" />Rou is writing topics…</> : <><Sparkles size={14} />Let Rou write {empty.length} empty {empty.length === 1 ? "topic" : "topics"}</>}
          </button>}
        </div>
        <div className="pwlist">
          {!items.length && <p className="muted stnote">No posts this week. You can add one below.</p>}
          {days.map((d) => {
            const list = rows.filter((r) => r.it.day === d);
            if (!list.length) return null;
            return (
              <section key={d} className="pwday">
                <p className="pwdayhead"><b>{dayTitle(d)}</b><span>{dayLong(d)}</span></p>
                <ul>{list.map((r) => <PlanRow key={r.it.key} ctx={ctx} r={r} />)}</ul>
              </section>
            );
          })}
        </div>
        {adding ? <AddPost ctx={ctx} days={days} onDone={() => setAdding(false)} /> : null}
        <div className="foot">
          {!adding && <button type="button" className="btn ghost" onClick={() => setAdding(true)}><Plus size={14} />Add post</button>}
          <span style={{ flex: 1 }} />
          {ready.length > 0 && <button type="button" className="btn pwprep" onClick={prep}><Sparkles size={14} />Prepare {ready.length} {ready.length === 1 ? "post" : "posts"} with a topic</button>}
          <button type="button" className="btn primary" onClick={onClose}>Done</button>
        </div>
      </motion.div>
    </div>
  );
}

type Row = { it: Item; auto?: Automation; slot: string; topic?: { title: string; brief: string }; who: "me" | "claude"; editable: boolean; st: St };
function rowOf(s: Ctx["state"], it: Item): Row {
  const auto = it.auto ?? (it.task ? autoOf(s, it.task) : undefined);
  const slot = it.task?.autoSlot ?? it.time;
  const topic = auto ? topicOf(s, auto, it.day, slot) : it.task?.post ? { title: it.task.title, brief: it.task.post.brief ?? "" } : undefined;
  const st = stOf(it);
  const queued = it.task && stateOf(s, it.task) !== "idle";
  return { it, auto, slot, topic, who: auto?.who ?? "claude", st, editable: (st === "plan" || st === "ghost") && !queued && it.day >= today() };
}

// Satırda gönderinin projesi: elle eklenende işin projesi, otomasyonda otomasyonunki.
const projIdOf = (s: Ctx["state"], it: Item) => it.task?.projectId ?? (it.auto ?? (it.task ? autoOf(s, it.task) : undefined))?.projectId ?? null;
const projName = (s: Ctx["state"], it: Item) => {
  const pid = projIdOf(s, it);
  return (pid && s.projects.find((p) => p.id === pid)?.name) || "";
};

// Plan özeti: gönderiler METİN olarak, gün gün: saat, nerede (platform/hesap, otomasyon ya da "Tek seferlik"), konu ve kısa açıklama.
// Hazırlanmış gönderide "Gönderiye git", hazırlanmamışta durumu yazar; satır gönderi penceresini açar (konu orada yazılır).
// Gönderiler'de üst satırdaki "Plan özeti" açılır kutusu (görünen hafta), proje sayfasında o projenin önümüzdeki 4 haftası.
const titleOf = (it: Item, topic?: { title: string }) => topic?.title || (it.run?.title && it.run.title !== it.title ? it.run.title : it.run?.body?.split(/[.!?\n]/)[0]?.trim()) || (it.task?.post ? it.title : "");
const briefOf = (it: Item, topic?: { brief: string }) => topic?.brief || it.task?.post?.brief || "";
function SumList({ ctx, rows, days, solo, onOpen }: { ctx: Ctx; rows: Row[]; days: string[]; solo?: boolean; onOpen: (r: Row) => void }) {
  const s = ctx.state;
  return (
    <div className="pslist">
      {days.map((d) => {
        const list = rows.filter((r) => r.it.day === d);
        if (!list.length) return null;
        return (
          <section key={d} className="psday">
            <p className="psdayhead"><b>{dayTitle(d)}</b><span>{dayLong(d)}</span></p>
            <ul>{list.map((r) => {
              const { it, auto } = r;
              const t = titleOf(it, r.topic);
              const brief = briefOf(it, r.topic);
              const plats = it.acc ? [it.acc.platform] : it.plats ?? [];
              const where = [auto ? auto.title : `One-off · ${it.acc ? accLabel(it.acc) : platLabel(it)}`, solo || projName(s, it) === auto?.title ? "" : projName(s, it)].filter(Boolean).join(" · ");
              return (
                <li key={it.key}>
                  <button className="psitem" onClick={() => onOpen(r)}>
                    <span className="pstime mono">{it.time || "–"}</span>
                    <span className="pstext">
                      <span className="psmeta">{plats.map((p) => <BrandIcon key={p} platform={p as never} size={12} />)}<span>{where}</span></span>
                      <b className={t ? "" : "is-none"}>{t || "No topic yet"}</b>
                      {brief && <span className="psbrief">{brief}</span>}
                    </span>
                    <span className={`psst st-${r.editable && !t ? "empty" : r.st}`}>{r.editable && !t ? "No topic" : stLabel(it)}</span>
                    <ChevronRight size={14} className="pschev" />
                  </button>
                </li>
              );
            })}</ul>
          </section>
        );
      })}
    </div>
  );
}

// Boş konuları Rou yazar (fillTopics; elle yazılana dokunmaz).
function useFill(from: string, days: number, autoIds?: string[]) {
  const [busy, setBusy] = useState(false);
  const fill = async () => {
    setBusy(true);
    const r = await fetch("/api/plan-week-topics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ week: from, days, autoIds }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
    setBusy(false);
    toast(!r.ok ? `No topics came back: ${r.error ?? "error"}` : r.filled ? `Topics written for ${nPosts(r.filled)}` : "No empty topics left");
  };
  return { busy, fill };
}
const FillBtn = ({ n, busy, fill }: { n: number; busy: boolean; fill: () => void }) => (n > 0 || busy ? (
  <button className="btn sm" disabled={busy} onClick={fill}>{busy ? <><RefreshCw size={14} className="spin" />Rou is writing…</> : <><Sparkles size={14} />Let Rou write {n} empty {n === 1 ? "topic" : "topics"}</>}</button>
) : null);

// Gönderiler › Plan özeti: görünen haftanın (süzgeç uygulanmış) gönderileri, düğmenin altında açılır kutu.
function PlanSummary({ ctx, anchor, week, items, onOpen, onPlan, onClose, inline }: { ctx: Ctx; anchor: React.RefObject<HTMLButtonElement | null>; week: string; items: Item[]; onOpen: (it: Item) => void; onPlan: () => void; onClose: () => void; inline?: boolean }) {
  const s = ctx.state;
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const allRows = items.map((it) => rowOf(s, it));
  const empty = allRows.filter((r) => r.editable && !r.topic && r.auto && r.auto.who !== "me");
  // Özetin üstündeki sayılar aynı zamanda süzgeç: basınca liste o duruma daralır.
  const [stf, setStf] = useState<"all" | "you" | "plan" | "empty" | "posted">("all");
  const isYou = (r: Row) => r.st === "ready" || r.st === "failed";
  const isEmpty = (r: Row) => r.editable && !titleOf(r.it, r.topic);
  const isPlan = (r: Row) => (r.st === "plan" || r.st === "ghost") && !isEmpty(r);
  const STATS = [
    { id: "you", label: "Awaiting your approval", n: allRows.filter(isYou).length },
    { id: "plan", label: "To prepare", n: allRows.filter(isPlan).length },
    { id: "empty", label: "No topic", n: allRows.filter(isEmpty).length },
    { id: "posted", label: "Shared", n: allRows.filter((r) => r.st === "posted").length },
  ] as const;
  const rows = stf === "all" ? allRows : allRows.filter(stf === "you" ? isYou : stf === "plan" ? isPlan : stf === "empty" ? isEmpty : (r: Row) => r.st === "posted");
  const { busy, fill } = useFill(week < today() ? today() : week, 7);
  // Hafta talimatı: kullanıcı haftanın nasıl planlanacağını yazar; Rou henüz hazırlanmamış bütün gönderilerin konusunu buna göre yeniden kurar.
  const [note, setNote] = useState("");
  const [replanning, setReplanning] = useState(false);
  const replan = async () => {
    if (!note.trim() || replanning) return;
    setReplanning(true);
    const autoIds = [...new Set(items.map((it) => autoIdOf(s, it)).filter(Boolean))];
    const r = await fetch("/api/plan-week-topics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ week: week < today() ? today() : week, days: 7, note, ...(autoIds.length ? { autoIds } : {}) }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
    setReplanning(false);
    toast(r.ok ? (r.filled ? `Rou set the topics of ${nPosts(r.filled)} from your note` : "No topics needed changing") : r.error ?? "Couldn't plan");
    if (r.ok) setNote("");
  };
  useLayoutEffect(() => {
    if (inline) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const vw = innerWidth, width = Math.min(480, vw - 32);
      const left = Math.max(16, Math.min(r.right - width, vw - 16 - width));
      setPos({ top: r.bottom + 8, left, width, maxHeight: innerHeight - r.bottom - (vw <= 640 ? 96 : 24) });
    };
    place();
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => { removeEventListener("resize", place); removeEventListener("scroll", place, true); };
  }, [anchor]);
  useEffect(() => {
    if (inline) return;
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("mousedown", down);
    addEventListener("keydown", key);
    return () => { removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [anchor, onClose]);
  const head = inline
    ? <div className="cardhead"><AlignLeft size={15} className="hicon" /><h3>Plan summary</h3><span className="n">{weekName(week)} · {range(week)} · {items.length ? nPosts(items.length) : "no posts"}</span></div>
    : <div className="psphead">
        <p><b>{weekName(week)}</b><span>{range(week)} · {items.length ? nPosts(items.length) : "no posts"}</span></p>
        <button className="x" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>;
  const noteBox = week >= weekStart(today()) && (
    <div className="pspnote">
      <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="How should this week be planned? E.g. talk about the new release, switch to the blog post on Friday" />
      <button className="btn sm primary" disabled={!note.trim() || replanning} onClick={replan}>{replanning ? "Rou is planning…" : "Let Rou plan with this"}</button>
    </div>
  );
  const stats = inline && (
    <div className="psstats">
      {STATS.map((x) => <button key={x.id} className={`${stf === x.id ? "on" : ""} is-${x.id}`} onClick={() => setStf(stf === x.id ? "all" : x.id)}><b>{x.n}</b><span>{x.label}</span></button>)}
    </div>
  );
  const body = (<>
      {head}
      {stats}
      {inline && noteBox}
      {rows.length ? <SumList ctx={ctx} rows={rows} days={days} onOpen={(r) => onOpen(r.it)} /> : <p className="muted stnote">{items.length ? "No posts with this status." : "No posts planned this week."}</p>}
      {!inline && noteBox}
      {(empty.length > 0 || busy || (week >= weekStart(today()))) && (
        <div className="pspfoot">
          <FillBtn n={empty.length} busy={busy} fill={fill} />
          <span style={{ flex: 1 }} />
          {week >= weekStart(today()) && <button className="btn sm ghost" onClick={onPlan}><CalendarRange size={14} />Plan the week</button>}
        </div>
      )}
  </>);
  // inline: Gönderiler'de Paylaşım planının altında sabit bölüm (2026-11-01); değilse düğmenin altında açılan pencere.
  if (inline) return <section className="card autodetail studio stsum">{body}</section>;
  return createPortal(
    <motion.div ref={box} className="pspop" role="dialog" aria-label="Plan summary" style={pos ?? { visibility: "hidden" }} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      {body}
    </motion.div>,
    document.body,
  );
}

// Proje sayfası: projenin önümüzdeki 4 haftalık gönderileri aynı metin özetiyle.
const PLAN_DAYS = 28;
const PLAN_SHOW = 6;
export function PlannedPosts({ ctx, project }: { ctx: Ctx; project: Project }) {
  const s = ctx.state;
  const c = { ...ctx, route: { ...ctx.route, lens: project.worldId } };
  const days = Array.from({ length: PLAN_DAYS }, (_, i) => addDays(today(), i));
  const items = itemsOf(c, studioAccounts(c), days).filter((x) => projIdOf(s, x) === project.id).sort((a, b) => a.day.localeCompare(b.day) || (a.time || "99").localeCompare(b.time || "99"));
  const rows = items.map((it) => rowOf(s, it));
  const empty = rows.filter((r) => r.editable && !r.topic && r.auto && r.auto.who !== "me");
  const { busy, fill } = useFill(today(), PLAN_DAYS, [...new Set(empty.map((r) => r.auto!.id))]);
  const [all, setAll] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  if (!rows.length) return null;
  const picked = items.find((x) => x.key === sel);
  return (
    <section className="card planned">
      <div className="cardhead">
        <CalendarRange size={15} className="hicon" />
        <h3>Planned posts</h3>
        <span className="n">{rows.length}</span>
        <FillBtn n={empty.length} busy={busy} fill={fill} />
      </div>
      <SumList ctx={ctx} rows={all ? rows : rows.slice(0, PLAN_SHOW)} days={days} solo onOpen={(r) => setSel(r.it.key)} />
      {rows.length > PLAN_SHOW && <button className="kbdone" onClick={() => setAll(!all)} aria-expanded={all}>{all ? "Show less" : `Show all (${rows.length})`}<ChevronRight size={13} className={all ? "is-open" : ""} /></button>}
      {picked && <PickedPost key={picked.key} ctx={ctx} it={picked} onClose={() => setSel(null)} />}
    </section>
  );
}

// Satırda yazılan konu: otomasyonun saatinde setTopic, elle gönderide işin başlığı ve ayrıntısı.
function saveTopic(ctx: Ctx, r: Row, title: string, brief: string) {
  const { it, auto, topic } = r;
  const v = title.trim(), b = brief.trim();
  if (v === (topic?.title ?? "") && b === (topic?.brief ?? "")) return;
  if (auto) return setTopic(ctx, auto, it.day, r.slot, v ? { title: v, brief: b } : null);
  if (it.task && v) ctx.mutate((st) => { const t = st.tasks.find((x) => x.id === it.task!.id); if (t) { t.title = v; t.notes = b; if (t.post) t.post.brief = b; } });
}

const WHO_NAME = { me: "You write it", claude: "Rou writes it" } as const;
function PlanRow({ ctx, r }: { ctx: Ctx; r: Row }) {
  const { it, auto, topic } = r;
  const [title, setTitle] = useState(topic?.title ?? "");
  const [brief, setBrief] = useState(topic?.brief ?? "");
  useEffect(() => { setTitle(topic?.title ?? ""); setBrief(topic?.brief ?? ""); }, [topic?.title, topic?.brief]);
  const save = () => saveTopic(ctx, r, title, brief);
  const status = r.editable ? (topic ? "" : "No topic") : stLabel(it);
  return (
    <li className={`pwrow ${r.editable ? "" : "is-locked"} ${topic ? "" : "is-empty"} ${status ? "has-st" : ""}`}>
      <span className="pwtime mono">{it.time || "–"}</span>
      <span className="pwacc">
        <span className="withbrand">{it.acc ? <><BrandIcon platform={it.acc.platform} size={13} /><span>{accLabel(it.acc)}</span></> : <>{(it.plats ?? []).map((p) => <BrandIcon key={p} platform={p as never} size={13} />)}<span>{platLabel(it)}</span></>}</span>
        <em>{[auto ? auto.title : "One-off", projName(ctx.state, it), WHO_NAME[r.who === "me" ? "me" : "claude"]].filter(Boolean).join(" · ")}</em>
      </span>
      {r.editable ? (
        <span className="pwtopic">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} placeholder={r.who === "me" ? "Write a topic" : "Write a topic or let Rou"} aria-label="Topic" />
          <input value={brief} onChange={(e) => setBrief(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} placeholder="What it should say (optional)" aria-label="What it should say" />
        </span>
      ) : (
        <span className="pwtopic is-read"><b>{topic?.title ?? it.title}</b>{topic?.brief && <span>{topic.brief}</span>}</span>
      )}
      {status ? <span className={`pwst st-${r.editable ? "empty" : r.st}`}>{!r.editable && <StIcon st={r.st} />}{status}</span> : null}
    </li>
  );
}

// Elle gönderinin ortak parçaları: proje (bulunduğun dünyadan; mercek Hepsi ise dünyalara göre gruplu), platform (isteğe bağlı) ve kayıt.
// Hesap zorunlu değil: platform seçilip dünyada o platformun hesabı varsa ona bağlanır; "Rou seçsin" ise Rou hazırlarken projenin hesabından seçer.
const blockOf = (t: Task, worldId: string, day: string, time: string) => ({ id: uid(), taskId: t.id, worldId, title: t.title, start: `${day}T${time}`, end: mkTs(day, toMin(time) + 30), kind: "plan" as const });

function postProjects(ctx: Ctx) {
  const s = ctx.state;
  const worlds = s.worlds.filter((w) => ctx.route.lens === ALL || w.id === ctx.route.lens);
  return worlds.map((w) => ({ w, list: s.projects.filter((p) => p.worldId === w.id && p.status === "active") })).filter((g) => g.list.length);
}
function ProjectPick({ ctx, value, onChange }: { ctx: Ctx; value: string; onChange: (v: string) => void }) {
  const groups = postProjects(ctx);
  const p = ctx.state.projects.find((x) => x.id === value);
  if (!groups.length) return <span className="pwfixed">No project</span>;
  return <Select className="selfield" label="Project" value={value} onChange={onChange} groups={groups.map(({ w, list }) => ({ label: groups.length > 1 ? w.name : undefined, color: groups.length > 1 ? w.color : undefined, options: list.map((x) => ({ value: x.id, label: x.name })) }))}>{p?.name ?? "Pick a project"}</Select>;
}
function PlatformPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg npplat" role="radiogroup" aria-label="Platform">
      <button type="button" role="radio" aria-checked={!value} className={!value ? "on" : ""} onClick={() => onChange("")}><Sparkles size={13} />Let Rou pick</button>
      {POST_PLATFORMS.map((p) => <button key={p} type="button" role="radio" aria-checked={value === p} className={value === p ? "on" : ""} onClick={() => onChange(p)}><BrandIcon platform={p} size={13} mono={value !== p} />{PLATFORM_NAME[p] ?? p}</button>)}
    </div>
  );
}
// Seçilen platformun dünyadaki hesabı (projenin bağlı hesabı önce); yoksa undefined.
const accountFor = (s: Ctx["state"], worldId: string, projectId: string, plat: string) => {
  const social = (s.worlds.find((w) => w.id === worldId)?.accounts ?? []).filter((a) => !isFeed(a.platform) && a.platform === plat);
  const p = s.projects.find((x) => x.id === projectId);
  return social.find((a) => p?.accountIds?.includes(a.id)) ?? social[0];
};
const postLine = (s: Ctx["state"], worldId: string, projectId: string, plat: string) => {
  if (!plat) return "Rou picks the platform and account";
  const a = accountFor(s, worldId, projectId, plat);
  return a ? `${PLATFORM_NAME[plat] ?? plat} ${a.handle || a.name || ""}`.trim() : `No ${PLATFORM_NAME[plat] ?? plat} account in this world, you share it yourself`;
};
function createPost(ctx: Ctx, o: { projectId: string; day: string; time: string; title: string; brief: string; plat: string; mine?: boolean }) {
  const s = ctx.state;
  const p = s.projects.find((x) => x.id === o.projectId);
  const worldId = p?.worldId ?? (ctx.route.lens === ALL ? s.worlds[0]?.id : ctx.route.lens);
  const a = o.plat ? accountFor(s, worldId, o.projectId, o.plat) : undefined;
  const format = o.plat ? formatsOf(o.plat as never)[0] : undefined;
  const t = newTask(worldId, o.title.replace(/\s+/g, " ").trim(), { projectId: p?.id ?? null, day: o.day, by: o.mine ? "me" : "claude", ...(o.mine ? {} : { who: "claude" as const }), notes: o.brief, post: { accountId: a?.id ?? "", ...(format ? { format } : {}), brief: o.brief, ...(o.time ? { at: o.time } : {}) } });
  ctx.mutate((st) => { st.tasks.push(t); if (o.time) st.blocks.push(blockOf(t, worldId, o.day, o.time)); });
  return t;
}
const firstProject = (ctx: Ctx, projectId?: string) => projectId ?? postProjects(ctx)[0]?.list[0]?.id ?? "";

// Haftayı planla › Gönderi ekle: konudan başlar (ne anlatılacak, proje, gün, saat), platform isteğe bağlı. Rou o gün (ya da "hazırlat" ile hemen) yazar.
function AddPost({ ctx, days, onDone }: { ctx: Ctx; days: string[]; onDone: () => void }) {
  const s = ctx.state;
  const [pid, setPid] = useState(() => firstProject(ctx));
  const proj = s.projects.find((p) => p.id === pid);
  const [day, setDay] = useState(days.find((d) => d >= today()) ?? days[0]);
  const [time, setTime] = useState("10:00");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [plat, setPlat] = useState("");
  const ok = topicOk(title);
  const add = () => {
    if (!ok) return;
    createPost(ctx, { projectId: pid, day, time, title, brief: notes.trim(), plat });
    toast("Post added");
    onDone();
  };
  return (
    <form className="pwadd" onSubmit={(e) => { e.preventDefault(); add(); }}>
      <label className="fld"><span>What to say</span><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="E.g. New release notes" /><em className="pwhint">Rou writes this topic in the project brand and the account's voice.</em></label>
      <div className="pwaddgrid">
        <label className="fld"><span>Project</span><ProjectPick ctx={ctx} value={pid} onChange={setPid} /></label>
        <label className="fld"><span>Day</span><Select className="selfield" label="Day" value={day} onChange={setDay} groups={[{ options: days.filter((d) => d >= today()).map((d) => ({ value: d, label: `${dayShort(d)} ${dayNum(d)}` })) }]}>{dayShort(day)} {dayNum(day)}</Select></label>
        <label className="fld"><span>Time</span><TimeField value={time} onChange={setTime} label="Time" /></label>
      </div>
      <div className="fld"><span>Platform <em>optional</em></span><PlatformPick value={plat} onChange={setPlat} /></div>
      <label className="fld"><span>Details <em>optional</em></span><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you tried, what happened, what to stress" /></label>
      <div className="pwaddfoot">
        <p className="pwsumline">{["One-off post", proj?.name ?? "No project", postLine(s, proj?.worldId ?? "", pid, plat), `${dayShort(day)} ${dayNum(day)}${time ? ` ${time}` : ""}`].join(" · ")}</p>
        <button type="button" className="btn sm ghost" onClick={onDone}>Cancel</button>
        <button className="btn sm primary" disabled={!ok}>Add</button>
      </div>
    </form>
  );
}

// Gönderi oluştur: konu, proje, gün, saat, platform (isteğe bağlı); metni Rou yazar ya da sen yazarsın (görseliyle). Sen yazınca gönderi
// doğrudan onayına düşer, Rou yazacaksa saatinden önce (ya da "şimdi hazırlat" ile hemen) hazırlar. Gönderiler sayfası ve proje sayfasından açılır.
export function NewPost({ ctx, projectId, onClose }: { ctx: Ctx; projectId?: string; onClose: () => void }) {
  const s = ctx.state;
  const [pid, setPid] = useState(() => firstProject(ctx, projectId));
  const proj = s.projects.find((p) => p.id === pid);
  // Varsayılan: iki saat sonrası. 22:00'den sonra bu saat yarına düşer; gün de yarın olur (yoksa gönderi geçmişe yazılırdı).
  const [day, setDay] = useState(() => (new Date().getHours() >= 22 ? addDays(today(), 1) : today()));
  const [time, setTime] = useState(() => { const n = new Date(); n.setHours(n.getHours() + 2, 0); return `${String(n.getHours()).padStart(2, "0")}:00`; });
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [plat, setPlat] = useState("");
  const [mode, setMode] = useState<"rou" | "me">("rou");
  // Kim paylaşacak: Rou (onaydan sonra hesabın tarayıcısında) ya da kullanıcı (metni alır, kendisi paylaşır, "Paylaştım" der).
  const [sharer, setSharer] = useState<"claude" | "me">("claude");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  const ok = topicOk(title) && !!day && (mode === "rou" || !!text.trim());
  const create = async (now = false) => {
    if (!ok) return;
    setBusy(true);
    let image: string | undefined;
    if (mode === "me" && file) {
      const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type)}`, { method: "POST", body: file }).then((x) => x.json()).catch(() => ({ ok: false }));
      if (!r.ok) { setBusy(false); return toast(r.error ?? "Couldn't upload the image"); }
      image = `media/${r.file}`;
    }
    const t = createPost(ctx, { projectId: pid, day, time, title, brief: brief.trim(), plat, mine: mode === "me" });
    ctx.mutate((st) => { const x = st.tasks.find((y) => y.id === t.id); if (x) x.sharer = sharer; });
    if (mode === "me") {
      // Sen yazınca hazırlık yok: hesap şimdi seçilir (Rou seçsin ise projenin hesabından); hesap yoksa metin düz kalır.
      const acc = t.post?.accountId ? undefined : pickAccount(ctx.state, t);
      const format = acc ? formatsOf(acc.platform)[0] : t.post?.format;
      ctx.mutate((st) => {
        const x = st.tasks.find((y) => y.id === t.id);
        if (x?.post && acc) Object.assign(x.post, { accountId: acc.id, format });
        const post = format ? normalize(format, format === "linkedin" || format === "text" ? { text } : format === "ig_post" ? { slides: [{ title: t.title, text: "" }], caption: text, hashtags: [] } : { tweets: [text] }) : null;
        st.runs.unshift({ id: uid(), taskId: t.id, at: new Date().toISOString(), title: t.title, body: text.trim(), status: "ready", by: "me", ...(post ? { post } : {}), ...(image ? { images: [image] } : {}) });
      });
    }
    if (mode === "rou" && now) await prepareMany([t.id]);
    setBusy(false);
    toast(mode === "me" ? "Post added for your approval" : now ? "Rou is preparing the post" : "Post planned; Rou prepares it before its time");
    onClose();
  };
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.form className="modal newpost" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} onSubmit={(e) => { e.preventDefault(); void create(false); }}>
        <header className="pvmhead"><div className="pvmwho"><b>Create post</b><span>A post shared once; for regular ones, set up an automation</span></div><button type="button" className="x" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <div className="pvmbody">
          <label className="fld"><span>What to say</span><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="E.g. New release notes" /></label>
          <div className="npgrid">
            <label className="fld"><span>Project</span><ProjectPick ctx={ctx} value={pid} onChange={setPid} /></label>
            <label className="fld"><span>Day</span><DatePick value={day} onChange={(v) => v && setDay(v)} label="Day" clearable={false} /></label>
            <label className="fld"><span>Time</span><TimeField value={time} onChange={setTime} label="Time" /></label>
          </div>
          <div className="fld"><span>Platform <em>optional</em></span><PlatformPick value={plat} onChange={setPlat} /><em className="pwhint">{postLine(s, proj?.worldId ?? "", pid, plat)}</em></div>
          <div className="fld"><span>Who writes the text</span>
            <div className="seg" role="radiogroup" aria-label="Who writes the text">
              <button type="button" role="radio" aria-checked={mode === "rou"} className={mode === "rou" ? "on" : ""} onClick={() => setMode("rou")}>Rou writes</button>
              <button type="button" role="radio" aria-checked={mode === "me"} className={mode === "me" ? "on" : ""} onClick={() => setMode("me")}>I'll write</button>
            </div>
          </div>
          <div className="fld"><span>Who shares it</span>
            <div className="seg" role="radiogroup" aria-label="Who shares it">
              <button type="button" role="radio" aria-checked={sharer === "claude"} className={sharer === "claude" ? "on" : ""} onClick={() => setSharer("claude")}>Rou shares</button>
              <button type="button" role="radio" aria-checked={sharer === "me"} className={sharer === "me" ? "on" : ""} onClick={() => setSharer("me")}>I'll share</button>
            </div>
          </div>
          {mode === "rou"
            ? <label className="fld"><span>Details <em>optional</em></span><textarea className="input" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What you tried, what happened, what you changed and why" /></label>
            : <>
              <label className="fld"><span>Text</span><textarea className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="The post's text" /></label>
              <div className="fld"><span>Image <em>optional</em></span><label className="npfile"><input type="file" accept="image/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><span className="btn sm">{file ? "Change" : "Pick image"}</span><em>{file ? file.name : "None picked"}</em></label></div>
            </>}
        </div>
        <footer className="pvmfoot">
          <span className="pvmwhy">{mode === "me" ? "Goes to your approval" : "Rou writes it 1 hour before its time, you approve"}{sharer === "claude" ? "; after approval Rou shares it." : "; you share it yourself."}</span>
          <button type="button" className="btn sm ghost" onClick={onClose}>Cancel</button>
          {mode === "rou" && <button type="button" className="btn sm" disabled={!ok || busy} onClick={() => void create(true)}>Prepare now</button>}
          <button className="btn sm primary" disabled={!ok || busy}>{mode === "me" ? "Add for approval" : "Plan"}</button>
        </footer>
      </motion.form>
    </div>
  );
}

// Haftalık paylaşım raporu: seçili haftada ne paylaşıldı, hangi dünyada, hangi projede, hangi hesaptan (src/postReport.ts).
// 2026-11-08: dünyalar tek satırda kayan şerit; proje ve hesap kırılımı kartın altında açılan menüde (masaüstü: üstüne gelince
// ya da odaklanınca, dokunmatik: dokununca). Menü body'de portal, şerit kırpmaz.
type RW = ReturnType<typeof weekReport>["worlds"][number];
function WeekReport({ s, wk }: { s: Ctx["state"]; wk: string }) {
  const r = weekReport(s, wk, today());
  const running = today() >= wk && today() <= addDays(wk, 6);
  const diff = r.total - r.prev;
  const rail = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const [open, setOpen] = useState<{ w: RW; el: HTMLElement } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const measure = () => {
    const el = rail.current;
    if (!el) return;
    setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useLayoutEffect(() => {
    measure();
    addEventListener("resize", measure);
    return () => removeEventListener("resize", measure);
  }, [r.worlds.length]);
  const hold = () => clearTimeout(timer.current);
  const later = () => { hold(); timer.current = window.setTimeout(() => setOpen(null), 160); };
  const show = (w: RW, el: HTMLElement) => { hold(); setOpen({ w, el }); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const page = (dir: 1 | -1) => rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <section className="stbox streport">
      <div className="stboxhead">
        <h3>Shared this week</h3>
        <span className="n">{nPosts(r.total)} · {running ? "last week to this day" : "last week"} {r.prev}{r.prev || r.total ? (diff > 0 ? ` (+${diff})` : diff < 0 ? ` (${diff})` : "") : ""}</span>
      </div>
      {r.worlds.length ? (
        <div className={`srrail ${edge.l ? "is-l" : ""} ${edge.r ? "is-r" : ""}`}>
          {edge.l && <button className="srarrow is-prev" aria-label="Previous worlds" onClick={() => page(-1)}><ChevronLeft size={16} /></button>}
          <div ref={rail} className="srworlds" onScroll={() => (measure(), setOpen(null))}>
            {r.worlds.map((w) => {
              const d = w.n - w.prev;
              return (
                <button
                  key={w.id}
                  className={`srworld ${open?.w.id === w.id ? "on" : ""}`}
                  style={{ ["--w" as string]: w.color ?? "var(--ink-3)" }}
                  aria-expanded={open?.w.id === w.id}
                  onPointerEnter={(e) => e.pointerType === "mouse" && show(w, e.currentTarget)}
                  onPointerLeave={(e) => e.pointerType === "mouse" && later()}
                  onFocus={(e) => e.currentTarget.matches(":focus-visible") && show(w, e.currentTarget)}
                  onBlur={later}
                  onClick={(e) => (open?.w.id === w.id && !matchMedia("(hover: hover)").matches ? setOpen(null) : show(w, e.currentTarget))}
                >
                  <span className="srwhead"><i className="srdot" /><b>{w.name}</b></span>
                  <span className="srwnum"><b>{w.n}</b>{d !== 0 && <small className={d > 0 ? "is-up" : "is-down"} title={running ? "Change from the same day last week" : "Change from last week"}>{d > 0 ? `+${d}` : d}</small>}</span>
                </button>
              );
            })}
          </div>
          {edge.r && <button className="srarrow is-next" aria-label="Next worlds" onClick={() => page(1)}><ChevronRight size={16} /></button>}
        </div>
      ) : <p className="srempty">No posts shared this week yet.</p>}
      {open && <ReportMenu w={open.w} anchor={open.el} onEnter={hold} onLeave={later} onClose={() => setOpen(null)} />}
    </section>
  );
}

// Dünya kartının altında açılan proje · hesap listesi. Ekran kenarına taşmaz; Esc ve dışarı tıklama kapatır.
function ReportMenu({ w, anchor, onEnter, onLeave, onClose }: { w: RW; anchor: HTMLElement; onEnter: () => void; onLeave: () => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const vw = innerWidth, width = Math.min(300, vw - 32);
      const left = Math.max(16, Math.min(a.left, vw - 16 - width));
      setPos({ top: a.bottom + 6, left, width, maxHeight: Math.max(160, innerHeight - a.bottom - (vw <= 640 ? 96 : 24)) });
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  }, [anchor]);
  useEffect(() => {
    const down = (e: PointerEvent) => !box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const scroll = (e: Event) => !box.current?.contains(e.target as Node) && onClose();
    addEventListener("pointerdown", down);
    addEventListener("keydown", key);
    addEventListener("scroll", scroll, true);
    return () => { removeEventListener("pointerdown", down); removeEventListener("keydown", key); removeEventListener("scroll", scroll, true); };
  }, [anchor, onClose]);
  return createPortal(
    <motion.div ref={box} className="srmenu" role="dialog" aria-label={`${w.name} posts`} style={pos ?? { visibility: "hidden" }} onPointerEnter={onEnter} onPointerLeave={(e) => e.pointerType === "mouse" && onLeave()} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}>
      {w.projects.map((p) => (
        <div key={p.id} className="srproj">
          <p><span>{p.name}</span><span className="srn">{p.n}</span></p>
          <p className="sraccs">{p.accounts.map((a) => <span key={a.id}>{PLATFORM_LABEL[a.platform as keyof typeof PLATFORM_LABEL] ?? a.platform} {a.name} · {a.n}</span>)}</p>
        </div>
      ))}
    </motion.div>,
    document.body,
  );
}
