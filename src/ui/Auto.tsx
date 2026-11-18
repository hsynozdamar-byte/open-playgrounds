import { motion } from "motion/react";
import { openPost } from "./openPost";
import { runOfTask } from "../runs";
import { useState } from "react";
import { AlertTriangle, ArrowUpRight, CalendarDays, Check, Copy, Download, Eye, ChevronRight, ChevronUp, Folder, History, MessageCircle, MoreHorizontal, Paperclip, Pencil, RefreshCw, Repeat, RotateCcw, Send, Sparkles, Trash2, X } from "lucide-react";
import { Versions, versionsOf } from "./Versions";
import { DraftEditor, PostEditor } from "./PostEditor";
import { Gallery, mediaOf } from "./Gallery";
import { RunItems } from "./RunItems";
import { PUBLISHABLE, openAccountForm, worldOfAccount } from "./Social";
import { accountOf, missingImage, platformName, taskRef } from "../../shared/social.mjs";
import { bansOf, revisionsOf } from "../../shared/revise.mjs";
import { uploadFile } from "./RouAttach";
import { ImageStep, VideoStep, VoiceStep } from "./Board";
import { DraftPost, PostPreview, download, mediaFiles } from "./Preview";
import { openAutoForm } from "./AutoForm";
import type { Automation, Run, State, Task } from "../types";
import type React from "react";
import { type Ctx, ALL, blocksOf, setStatus, worldOf } from "../lib";
import { ago, relDay, today } from "../date";
import { makeOccurrence, nextRun, occurrenceOf, repeatsOn, scheduleText, slotsOf, topicKey } from "../../shared/repeat.mjs";
import { toast } from "./Toast";
import { askRouAbout } from "./Rou";
import { DoPanel, LiveBox, requestDo } from "./Live";
import { NoteBody } from "./NoteBody";
import { needsChrome } from "../../shared/chrome.mjs";
import { uid } from "../store";
import { startTask } from "../timer";
import { PLATFORM_NAME, outputOf, platformsOf, sharerOf, stagesOf } from "../../shared/stages.mjs";
import { binIt } from "../trashOps";
import { BrandIcon } from "./BrandIcon";
import { reveal } from "./reveal";
import { openAutoView } from "./openAuto";
import { AddTile } from "./QuickAdd";

export const autoOf = (s: State, t: Task) => (t.autoId ? s.automations.find((a) => a.id === t.autoId) : undefined);
const nextText = (a: Automation) => {
  if (a.status !== "active") return "Durduruldu";
  const n = nextRun(a);
  return n ? `Sıradaki: ${relDay(n.day)}${n.slot ? ` ${n.slot}` : ""}` : "Plan yok";
};

// İş kartında: bu iş bir otomasyondan geldiyse hangisi olduğu.
export function AutoInfoRow({ task, ctx, onGo }: { task: Task; ctx: Ctx; onGo: () => void }) {
  const a = autoOf(ctx.state, task);
  if (!a) return null;
  return (
    <div>
      <dt><Repeat size={15} />Otomasyon</dt>
      <dd className="autoinfo">
        <button onClick={() => (onGo(), a && openAutoView(a.id))}>
          <Repeat size={13} /><b>{a.title}</b><span>{scheduleText(a)}{task.autoSlot ? ` · bu görev ${task.autoSlot}` : ""}</span><ArrowUpRight size={14} />
        </button>
      </dd>
    </div>
  );
}

// Sunucu açılışta yarım kalan "working" çıktıları failed yapar (server/app.mjs); burada yalnız takılı kalanlara karşı geniş bir sınır.
// Eskiden 6 dk idi: revizeler (video kaydı) daha uzun sürünce iş listeden düşüyor, "hazırlanıyor" görünmüyordu.
const STALE = 60 * 60 * 1000;
export const isStale = (r: Run) => r.status === "working" && Date.now() - new Date(r.at).getTime() > STALE;

async function cancelPrepare(taskId: string) {
  const r = await fetch("/api/prepare/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId }) }).then((r) => r.json()).catch(() => ({ ok: false }));
  toast(r.ok ? "Hazırlama durduruldu" : "Durdurulamadı: sunucuya ulaşılamadı");
}
export async function prepare(taskId: string, tries = 3, feedback?: string, files?: { file: string; name: string; kind: "image" | "video" }[]): Promise<boolean | void> {
  const r = await fetch("/api/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId, feedback, files }) }).then((r) => r.json()).catch(() => ({ ok: false, error: "Sunucuya ulaşılamadı" }));
  // Yeni açılan iş dosyaya henüz yazılmadıysa kısa bir süre sonra yeniden dener.
  if (!r.ok && r.error === "Görev yok" && tries > 1) return void setTimeout(() => prepare(taskId, tries - 1), 700);
  if (!r.ok) toast(r.error ?? "Hazırlanamadı");
  else if (r.queued) toast(r.message ?? "Sıraya alındı: şu anki hazırlık bitince başlayacak");
  else toast("Rou hazırlamaya başladı; ilerleme Süreç'te görünür");
  return r.ok;
}

export const BOT: Record<string, string> = { claude: "Rou", me: "Sen" };
// İşi kim yapıyor: otomasyon işinde otomasyonun hazırlayanı, tek işte atanan; yoksa sen.
export type Who = "me" | "claude";
// Rou'nun açtığı tek seferlik gönderi (task.post, by claude) Rou'nundur: Odak'ta Rou panelinde, paylaşım durumuyla görünür.
export const whoOf = (s: State, t: Task): Who => (autoOf(s, t)?.who ?? t.who ?? (t.post && t.by === "claude" ? "claude" : "me")) as Who;

// Proje (ya da dünya) sayfasında: buradaki otomasyonlar, kısa liste.
// Otomasyon satırı: görev listesinde bir görev gibi durur, "Otomasyon" etiketiyle ayrılır. Ne zaman, kim, (gerekirse) hangi proje
// ve şu an ne beklediği tek bakışta. Basınca otomasyon penceresi (ayar, plan, çıktılar) açılır.
// Seri rengi noktası (automation.color): listelerde ve çiplerde otomasyonun adının yanında.
export const SeriesDot = ({ color }: { color?: string }) => (color ? <i className="autodot" style={{ background: color }} aria-hidden /> : null);

export function AutoRow({ ctx, a, showProject, tag = true }: { ctx: Ctx; a: Automation; showProject?: boolean; tag?: boolean }) {
  const s = ctx.state;
  const waiting = s.runs.filter((r) => r.status === "ready" && isLatest(s, r) && s.tasks.find((t) => t.id === r.taskId)?.autoId === a.id).length;
  const plats = platformsOf(s, a);
  const n = slotsOf(a).filter(Boolean).length;
  const out = outputOf(s, a);
  const p = showProject && a.projectId ? s.projects.find((x) => x.id === a.projectId) : undefined;
  return (
    <li className="arow">
      <button onClick={() => openAutoView(a.id)}>
        <span className="arico">{plats.length ? <BrandIcon platform={plats[0]} size={16} /> : <Repeat size={16} />}</span>
        <span className="arbody">
          <span className="artitle"><SeriesDot color={a.color} /><b>{a.title}</b></span>
          <span className="armeta">{[p?.name, `${scheduleText(a)}${n > 1 ? ` · günde ${n} ${out === "post" || out === "video" ? "gönderi" : "kez"}` : ""}`, a.who === "me" ? "Sen yaparsın" : `${BOT[a.who]} hazırlar, sen onaylarsın`].filter(Boolean).join(" · ")}</span>
          <span className={`arst ${waiting ? "is-you" : ""}`}>{a.status === "paused" ? "Durdu" : waiting ? `${waiting} onayını bekliyor` : nextText(a)}</span>{tag && <span className="arfoot"><span className="artag"><Repeat size={11} />Otomasyon</span></span>}
        </span>
        <ChevronRight size={16} className="archev" />
      </button>
    </li>
  );
}

// Dünyanın (ya da projenin) otomasyonları: satır listesi. bare: yalnız liste (proje görev listesinin içinde).
export function ProjectAutos({ ctx, worldId, projectId, bare, adds }: { ctx: Ctx; worldId: string; projectId?: string | null; bare?: boolean; adds?: { label: string; onClick: () => void }[] }) {
  const s = ctx.state;
  const list = s.automations.filter((a) => a.worldId === worldId && (projectId === undefined || a.projectId === projectId));
  // adds: [] → ekleme kutusu yok (oluşturma düğmeleri kartın başlığında).
  if (bare && adds?.length === 0 && !list.length) return null;
  const rows = (
    <ul className="arows strip">
      {adds?.length !== 0 && <AddTile items={adds ?? [{ label: "Otomasyon kur", onClick: () => openAutoForm({ worldId, projectId: projectId ?? null }) }]} />}
      {list.map((a) => <AutoRow key={a.id} ctx={ctx} a={a} showProject={projectId === undefined} tag={!!bare && adds?.length !== 0} />)}
    </ul>
  );
  if (bare) return rows;
  return (
    <section className="card pautos">
      <div className="cardhead">
        <Repeat size={15} className="hicon" />
        <h3>Otomasyonlar</h3>
        <span className="n">{list.length || ""}</span>
      </div>
      {rows}
    </section>
  );
}

// Otomasyonu şimdi çalıştır: bugünün sıradaki (çıktısı olmayan) işini açar, Claude'unsa hazırlatır.
// Bugün otomasyonun günü olmasa da elle çalıştırılabilir.
// Şimdi yap: iş bugüne alınır, takvimdeki saati şu ana gelir (yoksa eklenir, uzunluğu korunur), sonra kim yapıyorsa başlar:
// Sen → odak sayacı, Rou → hazırlar. Sürüklemeden "şimdi" demek için (iş kartı Kim satırı).

// Rou'nun doğrudan Chrome işi (POST /api/do-task): run açılır; Chrome'u Rou kendisi seçer ve başlar. Bağlı Chrome yoksa sunucu söyler.
async function goDirect(taskId: string) {
  const res = await fetch("/api/do-task", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskId }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Sunucuya ulaşılamadı" }));
  if (!res.ok) return toast(res.error ?? "Başlatılamadı");
  toast("Rou tarayıcıda başladı");
}

// Çekmecedeki Kaydet ne başlatır: iş Rou'nunsa ve günü geldiyse (ya da tarihsizse) saatini beklemeden.
// Günü ilerideyse zamanlayıcı o gün başlatır. Düğmenin yazısı da buradan gelir.
export function kickOffWhat(s: State, task: Task): "chrome" | "prepare" | null {
  if (task.status === "done" || autoOf(s, task) || (task.day && task.day > today())) return null;
  if (task.who !== "claude") return null;
  const last = s.runs.filter((r) => r.taskId === task.id).sort((a, b) => b.at.localeCompare(a.at))[0];
  const fresh = !last || last.status === "failed" || isStale(last);
  if ((fresh || (last.status === "approved" && !last.act?.phase)) && needsChrome(task, last)) return "chrome";
  return fresh ? "prepare" : null;
}

// "keep" = çekmece açık kalsın (Chrome seçimi, canlı izleme).
export function kickOff(ctx: Ctx, task: Task): "keep" | "started" | false {
  const what = kickOffWhat(ctx.state, task);
  if (what === "chrome") { void goDirect(task.id); return "keep"; }
  if (what === "prepare") { void prepare(task.id); toast("Kaydedildi. Rou başladı."); return "started"; }
  return false;
}

export function doNow(ctx: Ctx, task: Task) {
  const who = whoOf(ctx.state, task);
  const d = new Date();
  d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
  const p2 = (n: number) => String(n).padStart(2, "0");
  const at = (x: Date) => `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}T${p2(x.getHours())}:${p2(x.getMinutes())}`;
  const day = at(d).slice(0, 10);
  ctx.mutate((st) => {
    const x = st.tasks.find((y) => y.id === task.id);
    if (!x) return;
    x.day = day;
    const mine = st.blocks.filter((b) => b.taskId === x.id).sort((a, b) => a.start.localeCompare(b.start));
    const b = mine.find((y) => y.start.slice(0, 10) === day && y.end > at(d)) ?? mine.find((y) => y.start > at(d));
    const len = b ? Math.max(15, (new Date(b.end).getTime() - new Date(b.start).getTime()) / 60000) : x.estimate ?? (who === "me" ? 60 : 30);
    const end = at(new Date(d.getTime() + len * 60000));
    if (b) Object.assign(b, { start: at(d), end });
    else st.blocks.push({ id: uid(), taskId: x.id, worldId: x.worldId, title: "", start: at(d), end, kind: "plan" });
  });
  if (who === "me") { if (ctx.state.timer?.taskId !== task.id) startTask(ctx.mutate, task.id); toast("Başladı: odak sayacı çalışıyor"); }
  else if (who === "claude") {
    const last = ctx.state.runs.filter((r) => r.taskId === task.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    if ((!last || last.status === "approved" || last.status === "failed") && needsChrome(task, last)) void goDirect(task.id);
    else { void prepare(task.id); toast("Rou şimdi hazırlıyor"); }
  }
}

export function runNow(ctx: Ctx, a: Automation) {
  const s = ctx.state;
  const t = today();
  const used = (task?: Task) => !!task && (task.status === "done" || s.runs.some((r) => r.taskId === task.id && r.status !== "failed" && !isStale(r)));
  const slot = slotsOf(a).find((x) => !used(occurrenceOf(s, a, t, x)));
  if (slot === undefined) return toast("Bugünün görevleri zaten hazırlandı");
  let task = occurrenceOf(s, a, t, slot);
  if (!task) {
    // Yeni işi önce geçici bir durumda kur: aynı id ile hem kaydedilir hem hazırlatılır.
    const tmp = { tasks: [], blocks: [] } as unknown as State;
    task = makeOccurrence(tmp, { ...a, topics: { ...a.topics } }, t, slot);
    const made = tmp;
    ctx.mutate((st) => {
      st.tasks.push(...made.tasks); st.blocks.push(...made.blocks);
      const x = st.automations.find((y) => y.id === a.id);
      if (x?.topics) delete x.topics[topicKey(t, slot)];
    });
  }
  const id = task.id;
  if (a.who === "claude") setTimeout(() => prepare(id), 500);
  else toast("Bugünün görevi açıldı", () => ctx.open(id), "Aç");
}

// Gelecek bir günün gönderisini beklemeden üretir: o günün görevi şimdi açılır (günü ve saati aynı kalır)
// ve hazırlanır. Sabah otomasyon o görevi bulur, ikinci kez açmaz.
// Otomasyonun bir gününün görevini açar (hazırlatmaz): yoksa şimdi oluşturur, kimliğini döner. Ayrıntıyı görmek ve toplu hazırlatmak için.
export function openAt(ctx: Ctx, a: Automation, day: string, slot: string): string {
  const have = occurrenceOf(ctx.state, a, day, slot);
  if (have) return have.id;
  const tmp = { tasks: [], blocks: [] } as unknown as State;
  const task = makeOccurrence(tmp, { ...a, topics: { ...a.topics } }, day, slot);
  ctx.mutate((st) => {
    st.tasks.push(...tmp.tasks); st.blocks.push(...tmp.blocks);
    const x = st.automations.find((y) => y.id === a.id);
    if (x?.topics) delete x.topics[topicKey(day, slot)];
  });
  return task.id;
}
export function runAt(ctx: Ctx, a: Automation, day: string, slot: string) {
  let task = occurrenceOf(ctx.state, a, day, slot);
  if (!task) {
    const tmp = { tasks: [], blocks: [] } as unknown as State;
    // Kopya üzerinde açılır (konu otomasyondan göreve geçer); asıl veri mutate içinde değişir.
    task = makeOccurrence(tmp, { ...a, topics: { ...a.topics } }, day, slot);
    ctx.mutate((st) => {
      st.tasks.push(...tmp.tasks); st.blocks.push(...tmp.blocks);
      const x = st.automations.find((y) => y.id === a.id);
      if (x?.topics) delete x.topics[topicKey(day, slot)];
    });
  }
  const id = task.id;
  if (a.who === "claude") { setTimeout(() => queuePrepare([id]), 500); toast("Rou'nun sırasına eklendi; sırayla hazırlar"); }
  else toast("Görev açıldı", () => ctx.open(id), "Aç");
}

// Rou'nun sırası: işler aynı anda değil, birbiri ardına hazırlanır (sunucu prepareMany).
export function queuePrepare(ids: string[]) {
  return fetch("/api/prepare-many", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => toast("Sunucuya ulaşılamadı"));
}
// Sırada mı: işaret 2 saatten eskiyse (sunucu yeniden başladıysa) sayılmaz.
export const isQueued = (t?: Task) => !!t?.queuedAt && Date.now() - new Date(t.queuedAt).getTime() < 2 * 3600 * 1000;

// İş kartında: Claude'un hazırladığı çıktı ya da hazırlatma düğmesi.
export function OutputSection({ task, ctx }: { task: Task; ctx: Ctx }) {
  const s = ctx.state;
  // Basınca hemen geri bildirim: yeni çıktı gelene kadar düğme dönen simgeyle bekler.
  const [starting, setStarting] = useState<string | null>(null);
  const a = autoOf(s, task);
  const runs = s.runs.filter((r) => r.taskId === task.id);
  // Otomasyonsuz işte de kim yapacağı seçilebilir (task.who): Rou hazırlar.
  const who = a ? a.who : task.who ?? "me";
  // Çıktı varsa başlık onu yapanı söyler (kartta Kim değiştirilse de).
  const bot = runs[0]?.by ?? (who !== "me" ? who : undefined);
  if (!runs.length && who === "me") return null;
  const last = runs[0];
  const busy = last?.status === "working" && !isStale(last);
  const waiting = !!starting && !busy && (last?.id ?? "none") === starting;
  const start = async () => {
    setStarting(last?.id ?? "none");
    const ok = await prepare(task.id);
    if (!ok) setStarting(null);
    else setTimeout(() => setStarting(null), 20000);
  };
  return (
    <section className="dsec">
      <div className="dsechead"><span className="flabel">{a && a.who !== "me" ? (last ? `${BOT[last.by ?? a.who] ?? BOT[a.who]} hazırladı` : `${BOT[a.who]} hazırlayacak`) : `${BOT[bot ?? "claude"] ?? bot} yapar`}</span></div>
      {last && <RunCard r={last} ctx={ctx} />}
      {/* Deneme geçmişi: önceki çıktılar, revize notun, Rou'nun puanı ya da hata nedeni. */}
      {runs.length > 1 && (
        <details className="dhist">
          <summary>Önceki denemeler · {runs.length - 1}</summary>
          <ol>
            {runs.slice(1).map((x) => (
              <li key={x.id}>
                <span className="dhwhen">{new Date(x.at).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <span className={`dhstat s-${x.status}`}>{({ failed: "Hazırlanamadı", ready: "Onay bekliyordu", approved: "Onaylandı", posted: "Paylaşıldı", working: "Hazırlanıyordu" } as Record<string, string>)[x.status] ?? x.status}{x.review?.score != null ? ` · ${x.review.score}/10` : ""}</span>
                {x.reviseNote ? <p><b>Revize notun:</b> {x.reviseNote}</p> : x.status === "failed" && (x.renderError || x.body) ? <p>{(x.renderError || x.body)!.slice(0, 220)}</p> : x.title ? <p>{x.title}</p> : null}
              </li>
            ))}
          </ol>
        </details>
      )}
      {/* Tek iş, henüz sonuç yok: ne olacağını anlatır; başlatmak çekmecenin alt düğmesinden. */}
      {!last && !a && <p className="rplanned">{needsChrome(task) ? "Rou görevi Playgrounds tarayıcısında yapar: planlar, gereken metin ve görselleri üretir, sayfada uygular. Geri dönüşü olmayan son adımdan önce sana sorar." : "Rou hazırlar; sonuç bu karta gelir ve onayını bekler."}</p>}
      {/* Süreç: işin hangi adımda olduğu; çıktı kartından ayrı başlıkla, ne işe yaradığı belli olsun. */}
      {a && a.who !== "me" && <>
        <div className="dsechead dlifehead"><span className="flabel">Süreç</span></div>
        <Lifecycle ctx={ctx} task={task} a={a} r={last} />
      </>}
      {a && task.status !== "done" && !busy && (!last || last.status === "failed") && (waiting
          ? <button className="btn sm dsecbtn" disabled aria-busy><RefreshCw size={14} className="spin" />Rou başlıyor…</button>
          : <button className="btn sm dsecbtn" onClick={start}><Sparkles size={14} />{last ? "Yeniden hazırla" : "Beklemeden şimdi hazırla"}</button>)}
    </section>
  );
}

// İşin hikâyesi: kim hazırladı, onay, paylaşım ve bundan sonra ne olacak. Her adım saatiyle; sıradaki adım açıkça kimin elinde yazar.
function Lifecycle({ ctx, task, a, r }: { ctx: Ctx; task: Task; a: Automation; r?: Run }) {
  const s = ctx.state;
  const bot = BOT[a.who];
  const out = outputOf(s, a);
  const shareable = !!r?.post || out === "post" || out === "video";
  const acc = accountOf(s, taskRef(s, task));
  const accName = acc ? `${platformName(acc)} ${acc.handle || acc.name}`.trim() : "";
  const hm = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("tr", { hour: "2-digit", minute: "2-digit" }) : "");
  type Row = { state: "done" | "now" | "todo" | "fail"; title: string; text?: React.ReactNode; at?: string; body?: React.ReactNode };
  const rows: Row[] = [];
  const stg = stagesOf(s, a, task, r);
  const sharer = stg.steps.find((x) => x.key === "publish")?.who ?? "Rou";
  const isVideo = out === "video";
  const what = isVideo ? "video metnini" : out === "post" ? "gönderi metnini" : out === "report" ? "raporu" : "metni";
  for (const x of stg.steps) {
    const busy = x.state === "now" && stg.busy;
    if (x.key === "write") rows.push(x.state === "done" ? { state: "done", title: `${bot} ${what} hazırladı`, at: hm(r?.at) }
      : x.state === "fail" ? { state: "fail", title: "Hazırlanamadı", text: r?.renderError ? r.renderError.slice(0, 400) : r?.body ? r.body.slice(0, 200) : "Yeniden hazırlatabilirsin." }
      : busy ? { state: "now", title: `${bot} ${what} hazırlıyor`, text: [r?.phase ? `${r.phase}…` : "", r?.queued ?? ""].filter(Boolean).join(" · ") || undefined }
      : { state: "now", title: `Rou ${what} hazırlayacak`, text: "Görevin saatinden 1 saat önce kendiliğinden başlar." });
    if (x.key === "voice") rows.push(x.state === "done" ? { state: "done", title: "Sesini kaydettin" }
      : x.state === "now" ? { state: "now", title: "Metni kendi sesinle oku", text: "Kayıttan sonra videoyu Rou kurar.", body: r ? <VoiceStep run={r} /> : undefined }
      : { state: "todo", title: "Seslendirme senden", text: "Metin hazır olunca burada okuyup kaydedersin." });
    if (x.key === "video") rows.push(x.state === "done" ? { state: "done", title: "Video hazır", text: "Aşağıdaki kartta izleyebilir, indirebilirsin." }
      : x.state === "fail" ? { state: "fail", title: "Video üretilemedi", text: r?.renderError, body: r ? <VideoStep run={r} failed /> : undefined }
      : busy ? { state: "now", title: "Rou videoyu üretiyor", text: r?.phase ? `${r.phase}…` : undefined }
      : { state: x.state === "now" ? "now" : "todo", title: isVideo ? "Rou videoyu kurar" : "Rou videoyu üretir", text: isVideo ? "Sesini senaryodaki sahnelerle birleştirip dikey Reel'i üretir. Bu adımda senden bir şey gerekmez." : "Metnin ana fikrinden kısa, dikey bir video. Video bitmeden onay ve paylaşım açılmaz." });
    if (x.key === "image") rows.push(x.state === "done" ? (r?.images?.length ? { state: "done", title: "Görsel hazır", text: "Gönderinin altında görünüyor." } : r?.video ? { state: "done", title: "Video hazır", text: "Gönderinin altında görünüyor; görsel yerine video gidiyor." } : { state: "done", title: "Görsel eklenmedi", text: "Bu gönderi yalnız metin." })
      : x.state === "fail" ? { state: "fail", title: "Görsel üretilemedi", text: r?.renderError, body: r ? <ImageStep run={r} failed /> : undefined }
      : busy ? { state: "now", title: "Rou görseli üretiyor", text: r?.phase ? `${r.phase}…` : undefined }
      : x.state === "now" && r ? { state: "now", title: "Görsel eksik", text: "Metin hazır; görsel olmadan onaylanamaz ve paylaşılmaz.", body: <ImageStep run={r} /> }
      : { state: "todo", title: "Rou görseli üretir", text: "Metnin ana fikrinden, projenin görünümüyle. Görsel bitmeden onay ve paylaşım açılmaz." });
    if (x.key === "approve") rows.push(x.state === "done" ? { state: "done", title: "Onayladın", at: hm(r?.approvedAt) }
      : x.state === "now" ? { state: "now", title: "Onayını bekliyor", text: `${isVideo ? "Videoyu izle; onayla ya da revize iste." : "Metni oku; onayla, düzenle ya da revize iste."}` }
      : { state: "todo", title: "Onay senden", text: isVideo ? "Video hazır olunca izleyip onaylarsın." : undefined });
    if (x.key === "publish") {
      // Rou Playgrounds'un tarayıcısında, hesabın dünyasının oturumunda paylaşır. Saatinde kendiliğinden (server/share.mjs).
      const byRou = sharer === "Rou";
      const byMe = sharer === "Sen";
      const plats = platformsOf(s, a);
      const ready = byMe || !!acc;
      const where = accName || plats.map((p) => PLATFORM_NAME[p] ?? p).join(", ");
      const slot = task.autoSlot || blocksOf(s, task.id).find((b) => b.start.slice(0, 10) === task.day)?.start.slice(11, 16);
      const when = slot ? `saat ${slot}'de` : "onaydan hemen sonra";
      const linkAcc = acc
        ? <button className="link" onClick={() => { const wd = worldOfAccount(s.worlds, acc.id); if (wd) openAccountForm({ worldId: wd.id, id: acc.id }); }}>Hesabı aç</button>
        : <button className="link" onClick={() => openAccountForm({ worldId: task.worldId ?? "", projectId: task.projectId ?? undefined })}>Hesap bağla</button>;
      const how = byMe
        ? <>Onaydan sonra metni kopyalayıp {where ? `${where} hesabında ` : ""}kendin paylaşırsın, sonra "Paylaştım"a basarsın.</>
        : ready
        ? <>Rou, {where} hesabını Playgrounds tarayıcısında açıp {when} paylaşır ve gönderi linkini buraya ekler.</>
        : byRou
          ? <>Rou'nun paylaşabilmesi için bir hesap gerekiyor. {linkAcc}. Kendin paylaştıysan "Elle paylaştım"a bas.</>
          : <>Nerede paylaşılacağı belli değil. Otomasyonda platform seç ya da {linkAcc}. Kendin paylaştıysan "Elle paylaştım"a bas.</>;
      const now = !byMe && r && r.status === "approved" && ready && !r.publish?.phase ? <button className="btn sm" onClick={() => shareNow(r.id)}><Send size={14} />{r.publish?.error ? "Yeniden dene" : "Şimdi paylaş"}</button> : undefined;
      const kit = r?.publish?.handoff ? <div className="runact">{acc && <RetryShare runId={r.id} />}<button className="btn sm" onClick={() => fetch("/api/open-share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: r.id }) })}><Folder size={14} />Klasörü aç</button></div> : undefined;
      rows.push(x.state === "done" ? { state: "done", title: "Paylaşıldı", at: hm(r?.postedAt), text: r?.postUrl ? <a className="link" href={r.postUrl} target="_blank" rel="noreferrer" onClick={(e) => openPost(r, e)}>Gönderiyi aç ↗</a> : "Link eklenmedi." }
        : r?.publish?.handoff ? { state: "fail", title: "Paylaşım sana kaldı", text: `${r.publish.reason}. Metin ve dosyalar paylaşım klasöründe; paylaşınca "Paylaştım"a bas.`, at: hm(r.publish.at), body: kit }
        : r?.publish?.error ? { state: "fail", title: "Paylaşılamadı", text: r.publish.error, body: now }
        : r?.publish?.phase ? { state: "now", title: r.publish.phase.startsWith(sharer) ? r.publish.phase : `${sharer} paylaşıyor`, text: r.publish.live ? "Bitince link buraya gelir." : `${r.publish.phase}. Bitince link buraya gelir.`, at: hm(r.publish.at), body: r.publish.by === "claude" ? <LiveBox live={r.publish.live} busy runId={r.id} /> : undefined }
        : x.state === "now" ? { state: "now", title: byMe ? "Paylaşım senden" : ready ? `${sharer} paylaşacak` : "Paylaşım bekliyor", text: how, body: now }
        : { state: "todo", title: byMe ? "Sen paylaşırsın" : `${sharer} paylaşır`, text: how });
    }
  }
  rows.push(task.status === "done" ? { state: "done", title: r?.status === "posted" ? "Paylaşıldı, görev tamamlandı" : "Görev tamamlandı", at: hm(r?.postedAt ?? task.doneAt) } : { state: "todo", title: shareable ? "Paylaşılınca görev biter" : a.approve === false ? "Çıktı gelince görev biter" : "Onaylayınca görev biter" });
  return (
    <ol className="life">
      {rows.map((x, i) => (
        <li key={i} className={`is-${x.state}`}>
          <span className="ldot">{x.state === "done" && <Check size={10} strokeWidth={3} />}</span>
          <div className="ltext"><b>{x.title}{x.at && <em>{x.at}</em>}</b>{x.text && <span>{x.text}</span>}{x.body && <div className="lbody">{x.body}</div>}</div>
        </li>
      ))}
    </ol>
  );
}

// Onaylanan gönderiyi beklemeden paylaştırır (paylaşan Rou; server/share.mjs).
async function shareNow(runId: string, approve = false) {
  const r = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, approve }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Sunucuya ulaşılamadı" }));
  toast(r.ok ? "Paylaşım başladı" : `Paylaşılamadı: ${r.error}`);
}

async function publish(runId: string) {
  const r = await fetch("/api/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Sunucuya ulaşılamadı" }));
  toast(r.ok ? "Rou paylaşmaya başladı. Ne yaptığı burada görünür." : `Başlatılamadı: ${r.error ?? "bilinmeyen hata"}`);
  return !!r.ok;
}

// Paylaşım kullanıcıya kaldıysa Rou'ya bir daha denetir.
// Basınca hemen dönen çark; başlayınca satır "Rou yeniden deniyor" olur ve canlı adımlar gelir.
function RetryShare({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);
  return <button className="btn sm primary" disabled={busy} onClick={async () => { setBusy(true); if (!(await publish(runId))) setBusy(false); }}>{busy ? <RefreshCw size={14} className="spin" /> : <Send size={14} />}{busy ? "Başlatılıyor…" : "Rou yeniden denesin"}</button>;
}

const STATE_ICON: Partial<Record<Run["status"], typeof Check>> = { ready: Eye, approved: Check, posted: Check, acted: Check, failed: AlertTriangle };
// Kartın etiketi: işin şu anki aşaması ve sıradaki adımı kimin attığı ("Onaylandı · Rou paylaşacak 10:00").
export function runTag(s: State, task: Task, r?: Run | null): string {
  if (!r) return task.status === "done" ? "Tamamlandı" : "Hazırlanmadı";
  const a = autoOf(s, task);
  // Tek iş (otomasyonsuz, ör. Gmail temizliği): Rou tarayıcıda yapar, soru sorabilir.
  if (!a) {
    if (r.status === "working") return "Rou hazırlıyor";
    if (r.status !== "approved") return RUN_LABEL[r.status] ?? r.status;
    if (task.status === "done") return "Tamamlandı";
    if (r.act?.question) return "Cevabını bekliyor";
    if (r.act?.phase) return "Rou yapıyor";
    if (r.act?.error) return "Rou yapamadı";
    return "Onaylandı";
  }
  const pub = stagesOf(s, a, task, r).steps.some((x: { key: string }) => x.key === "publish");
  const me = sharerOf(a, task) === "me";
  const slot = task.autoSlot || task.post?.at || "";
  switch (r.status) {
    case "working": return "Rou hazırlıyor";
    case "failed": return "Hazırlanamadı";
    case "ready": return "Onay bekliyor";
    case "posted": return "Paylaşıldı";
    case "acted": return "Tamamlandı";
    case "approved":
      if (!pub || task.status === "done") return "Tamamlandı";
      if (r.publish?.error) return "Paylaşılamadı";
      if (r.publish?.handoff) return "Onaylandı · paylaşım sende";
      if (r.publish?.phase) return "Rou paylaşıyor";
      return me ? "Onaylandı · paylaşım sende" : `Onaylandı · Rou paylaşacak${slot && task.day && task.day >= today() ? ` ${task.day === today() ? "" : relDay(task.day) + " "}${slot}` : ""}`;
  }
  return RUN_LABEL[r.status] ?? r.status;
}

export const RUN_LABEL: Record<Run["status"], string> = { working: "Hazırlanıyor", failed: "Hazırlanamadı", ready: "Onay bekliyor", approved: "Onaylandı", posted: "Paylaşıldı", acted: "Yapıldı" };

// Revize notların: bu işe yazdığın her not (eskiden yeniye) ve Rou'nun bu çıktıda yapamadıkları.
function Revisions({ task, r }: { task: Task; r: Run }) {
  const list = revisionsOf(task);
  if (!list.length && !r.reviseGaps?.length && !r.topicMiss) return null;
  const last = list.at(-1);
  const bans = bansOf(task);
  return (
    <div className="rrevs">
      {r.topicMiss ? <div className="rrevgap"><b>Konu kaynağa tam uymadı</b><ul><li>{r.topicMiss}</li></ul></div> : null}
      {r.reviseGaps?.length ? <div className="rrevgap"><b>Rou bunları yapamadı</b><ul>{r.reviseGaps.map((g, i) => <li key={i}>{g.ask}{g.why ? <span> · {g.why}</span> : null}</li>)}</ul></div> : null}
      {last?.clear && (
        <div className="rrevclear">
          <b>Rou son notunu böyle anladı</b>
          <p>{last.clear.ask}</p>
          {bans.length > 0 && <p className="rrevban">Hiçbir yerde geçmeyecek: {bans.join(", ")}</p>}
          {last.clear.rule && last.saved?.length ? <p className="rrevask">Kalıcı kural yaptı ({last.saved.length} otomasyon): {last.clear.rule.text}</p> : null}
          {r.found?.facts?.length ? <p className="rrevask">İşin kendisinden öğrendikleri: {r.found.facts.join(" ")}</p> : null}
          {r.found && (r.found.note || !r.found.facts?.length) ? <p className="rrevask">Görselleri buradan aldı: {r.found.from}{r.found.note ? `. ${r.found.note}` : ""}</p> : null}
        </div>
      )}
      {list.length > 0 && (
        <details className="rrevlog">
          <summary>Revize notların <span>{list.length}</span></summary>
          <ol>{list.map((x, i) => <li key={x.at + i} className={r.answers === x.at ? "is-this" : ""}><time>{x.at ? new Date(x.at).toLocaleString("tr", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</time><p>{x.note}</p>{x.clear && <p className="rrevask">Rou'nun anladığı: {x.clear.ask}</p>}</li>)}</ol>
        </details>
      )}
    </div>
  );
}

export function RunCard({ r, ctx, withSource, onCollapse }: { r: Run; ctx: Ctx; withSource?: boolean; onCollapse?: () => void }) {
  const s = ctx.state;
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<"del" | "post" | "revise" | "posted" | "share" | "versions" | null>(null);
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  // Revize ekleri: Rou bunlara bakar ve çıktıya ekler (görseller önde, video yerine geçer).
  const [revFiles, setRevFiles] = useState<{ file: string; name: string; kind: "image" | "video" }[]>([]);
  const [uploading, setUploading] = useState(false);
  const addRevFiles = async (list: FileList | null) => {
    const fs = [...(list ?? [])].filter((f) => /^(image|video)\//.test(f.type)).slice(0, 8);
    if (!fs.length) return;
    setUploading(true);
    for (const f of fs) {
      const up = await uploadFile(f, f.name);
      if ("error" in up) toast(up.error); else setRevFiles((x) => [...x, { file: up.file, name: f.name, kind: f.type.startsWith("video/") ? "video" : "image" }]);
    }
    setUploading(false);
  };
  const [editing, setEditing] = useState(false);
  const task = r.taskId ? s.tasks.find((x) => x.id === r.taskId) : undefined;
  const acc = r.post ? accountOf(s, taskRef(s, task)) : undefined;
  const remove = () => {
    binIt(ctx, "run", r.title, { runs: [r] }, (st) => void (st.runs = st.runs.filter((x) => x.id !== r.id)), "Çıktı silindi");
  };
  const w = worldOf(s, task?.worldId ?? null);
  const status = isStale(r) ? "failed" : r.status;
  const setRun = (patch: Partial<Run>, done?: boolean) =>
    ctx.mutate((st) => {
      const x = st.runs.find((y) => y.id === r.id);
      if (x) Object.assign(x, patch);
      const t = st.tasks.find((y) => y.id === r.taskId);
      if (t && done) setStatus(t, "done");
    });
  // Gönderi ya da videoysa onay işi bitirmez: iş paylaşılınca biter. Metin, rapor gibi çıktılarda onay işi bitirir.
  const shareable = (() => { const t = r.taskId ? s.tasks.find((x) => x.id === r.taskId) : undefined; const a = t && autoOf(s, t); return !!r.post || (!!a && ["post", "video"].includes(outputOf(s, a))); })();
  const postOut = (() => { const a = task && autoOf(s, task); return !!a && outputOf(s, a) === "post"; })();
  // Onay geri alınabilir: paylaşım başlamadıysa çıktı yeniden onay bekler.
  const unapprove = () => ctx.mutate((st) => {
    const x = st.runs.find((y) => y.id === r.id);
    if (!x || x.status !== "approved") return;
    x.status = "ready";
    delete x.approvedAt;
    delete x.approvedVia;
    delete x.publish;
    delete x.shareSentAt;
    const t = st.tasks.find((y) => y.id === r.taskId);
    if (t && t.status === "done") setStatus(t, "todo");
  });
  // Rou'ya verilmiş tek iş (otomasyon değil): onay "devam et" demek, iş açık kalır; bitince işi sen kapatırsın.
  const keepOpen = (() => { const t = r.taskId ? s.tasks.find((x) => x.id === r.taskId) : undefined; return !!t && !autoOf(s, t) && t.who === "claude"; })();
  const approve = () => {
    setRun({ status: "approved", approvedAt: new Date().toISOString() }, !shareable && !keepOpen);
    // Chrome'da yapılacak tek iş onaylanınca Rou beklemeden başlar.
    const t = r.taskId ? s.tasks.find((x) => x.id === r.taskId) : undefined;
    if (keepOpen && t && needsChrome(t, r)) { requestDo(r.id); return toast("Onaylandı. Rou tarayıcıda başlıyor.", unapprove); }
    toast(keepOpen ? "Onaylandı. Görev açık kalıyor." : "Onaylandı. 5 dakika içinde geri alabilirsin.", unapprove);
  };
  // Başlamış ve sürmekte olan paylaşım geri alınamaz; paylaşılamadıysa onay geri alınabilir.
  const canUnapprove = status === "approved" && !r.publish?.phase && (!r.shareSentAt || !!r.publish?.error);
  const markPosted = (url?: string) => {
    const before = r.status, pub = r.publish;
    const was = r.taskId ? s.tasks.find((x) => x.id === r.taskId)?.status : undefined;
    setRun({ status: "posted", postedAt: new Date().toISOString(), publish: undefined, ...(url ? { postUrl: url } : {}) }, true);
    // Geri al her şeyi eski hâline getirir: iş yeniden açılır, paylaşım kaydı ve adres de döner.
    toast("Paylaşıldı olarak işaretlendi", () => ctx.mutate((st) => {
      const x = st.runs.find((y) => y.id === r.id);
      if (x) { x.status = before; delete x.postedAt; if (url) delete x.postUrl; if (pub) x.publish = pub; }
      const t = st.tasks.find((y) => y.id === r.taskId);
      if (t && was && was !== "done" && t.status === "done") setStatus(t, was);
    }));
  };
  const publishing = !!r.publish?.phase && Date.now() - new Date(r.publish.at).getTime() < 12 * 60 * 1000;
  const busyPhase = status === "working" ? `${r.phase ? `${r.phase}…` : "Hazırlanıyor…"}${r.queued ? ` · ${r.queued}` : ""}` : publishing ? `${r.publish!.phase}…` : r.phase ? `${r.phase}…` : null;
  const label = busyPhase ?? (task ? runTag(ctx.state, task, r) : RUN_LABEL[status]);
  const files = mediaFiles(r);
  const when = task?.day ? `${relDay(task.day)}${task.autoSlot ? ` ${task.autoSlot}` : task.post?.at ? ` ${task.post.at}` : ""}` : "";
  const canPost = !!acc && PUBLISHABLE.has(acc.platform);
  const ready = canPost;
  const accName = acc ? `${platformName(acc)} ${acc.handle || acc.name}`.trim() : "";
  // Sesi, videosu ya da (LinkedIn) görseli henüz yoksa onaylanamaz (shared/stages.mjs).
  const auto = task ? autoOf(s, task) : undefined;
  const stage = auto ? stagesOf(s, auto, task, r).current : null;
  const lowScore = r.review?.score != null && r.review.score < 8;
  const incomplete = stage === "voice" || stage === "video" || stage === "image" || missingImage(r);
  const byMe = (!!auto && sharerOf(auto, task) === "me") || !!r.publish?.handoff;
  // Kim, ne zaman paylaşır: onay çubuğunda yazar. "Şimdi paylaş" takvimdeki yeri değiştirmez.
  const sharerKey = task ? sharerOf(auto, task) : "claude";
  const sharerName = sharerKey === "claude" ? "Rou" : sharerKey === "me" ? "Sen" : "Rou";
  const slot0 = task ? task.autoSlot || blocksOf(s, task.id).find((b) => b.start.slice(0, 10) === task.day)?.start.slice(11, 16) : undefined;
  // Saati geçtiyse paylaşım saat beklemez: "hemen".
  const slot = slot0 && task?.day && `${task.day}T${slot0}` > new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) ? slot0 : undefined;
  const canShareNow = shareable && !!r.post && !byMe && !publishing && !missingImage(r) && (sharerKey === "claude" ? !!acc : !!acc || (!!auto && platformsOf(s, auto).length > 0));
  const whenNote = !shareable || byMe || !canShareNow ? "" : status === "ready" ? `Onaylarsan ${slot ? `${slot}'de` : "hemen"} ${sharerName} paylaşır` : status === "approved" ? `${slot ? `${slot}'de` : "Birazdan"} ${sharerName} paylaşacak` : "";
  const nVersions = versionsOf(s, r).length;
  return (
    <motion.article layout transition={{ layout: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } }} className={`run r-${status}`} style={{ ["--w" as string]: w.color }}>
      <div className="runmeta">
        {withSource && <button className="wd" onClick={() => task && ctx.open(task.id)} title={task?.title ?? r.title}><i /><span className="wdt">{task?.title ?? r.title}</span></button>}
        {when && <span className="ron"><CalendarDays size={12} />{when}</span>}
        <span>{ago(r.postedAt ?? r.at)}{r.by ? ` · ${r.by === "claude" ? "Rou" : r.by}` : ""}{r.edited ? " · düzenlendi" : ""}</span>
        <span className={`rstate ${busyPhase ? "working" : status}`}>{busyPhase ? <RefreshCw size={12} className="spin" /> : (() => { const I = STATE_ICON[status]; return I ? <I size={12} strokeWidth={2.5} /> : null; })()}{label}</span>
        {status === "working" && task && <button className="btn sm ghost rstop" onClick={() => cancelPrepare(task.id)}><X size={13} />Durdur</button>}
        {onCollapse && <button className="iconbtn rcollapse" onClick={onCollapse} aria-label="Kapat" title="Kapat"><ChevronUp size={16} /></button>}
      </div>
      {editing && r.post ? <PostEditor r={r} ctx={ctx} color={w.color} onDone={() => setEditing(false)} />
        : editing ? <DraftEditor r={r} ctx={ctx} onDone={() => setEditing(false)} />
        : r.post && status !== "failed" ? <PostPreview r={r} s={s} />
        : postOut && status !== "working" && status !== "failed" && r.body ? <DraftPost r={r} s={s} />
        : status !== "working" && r.body && <>
          {/* Çıktı markdown yazılır (başlık, liste, kalın); kapalıyken ilk satırlar, altı yumuşakça kaybolur. */}
          {(() => { const long = r.body.length > 220 || r.body.split("\n").length > 4; return <>
            <div className={`rmd ${long && !open ? "is-clamped" : ""}`} onClick={() => long && setOpen(!open)}><NoteBody text={r.body} /></div>
            {long && <button className="pvmore rmore" onClick={() => setOpen(!open)}>{open ? "Daralt" : "Tümünü gör"}</button>}
          </>; })()}
        </>}
      {status === "working" && r.live && <LiveBox live={r.live} busy runId={r.id} />}
      {task && !auto && task.who === "claude" && (status === "approved" || status === "acted") && <DoPanel r={r} task={task} ctx={ctx} />}
      {!r.post && !postOut && !editing && <div className="rgal"><Gallery items={mediaOf(r).filter((m) => !m.remote)} /></div>}
      {r.items?.length && status !== "working" ? <RunItems r={r} auto={task ? autoOf(s, task) : undefined} /> : null}
      {r.publish?.error && !publishing && status !== "posted" && <p className="pvissues rperr">Paylaşılamadı: {r.publish.error}</p>}
      {task && status !== "posted" && <Revisions task={task} r={r} />}
      {/* Paylaşılan gönderi: durum, nerede ve ne zaman, tek düğmeyle gönderiye git. Genişte önizlemenin sağında durur. */}
      {status === "posted" && (
        <div className="rpostedbox">
          <span className="rpok"><Check size={16} strokeWidth={2.6} /></span>
          <div className="rptext">
            <b>Paylaşıldı</b>
            <span>{[acc?.name ?? "", r.postedAt ? new Date(r.postedAt).toLocaleString("tr", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : ""].filter(Boolean).join(" · ")}</span>
          </div>
          {r.postUrl ? <a className="btn sm primary" href={r.postUrl} target="_blank" rel="noreferrer" onClick={(e) => openPost(r, e)}>Gönderiyi aç<ArrowUpRight size={14} /></a> : <span className="muted">Link eklenmedi</span>}
        </div>
      )}
      {editing ? null : ask === "revise" && task ? (
        <form className="revise" onSubmit={(e) => { e.preventDefault(); if ((!note.trim() && !revFiles.length) || uploading) return; setAsk(null); void prepare(task.id, 3, note, revFiles); setNote(""); setRevFiles([]); toast("Revize notunla yeniden hazırlanıyor"); }}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addRevFiles(e.dataTransfer.files); }}>
          <textarea autoFocus rows={3} value={note} onChange={(e) => setNote(e.target.value)} onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void addRevFiles(e.clipboardData.files); } }} placeholder="Neyi değiştirelim? Ör. kanca daha kısa olsun, ikinci sahneyi çıkar, sonunda oyun linki olsun. Görsel ya da video ekleyebilirsin." />
          {revFiles.length > 0 && (
            <ul className="revfiles">
              {revFiles.map((f) => (
                <li key={f.file}>
                  {f.kind === "video" ? <video src={`/media/${f.file}`} muted /> : <img src={`/media/${f.file}`} alt="" />}
                  <button type="button" aria-label={`${f.name} ekini kaldır`} onClick={() => setRevFiles((x) => x.filter((y) => y.file !== f.file))}><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          <div className="bmbtns">
            <label className="btn sm ghost revattach"><Paperclip size={14} />{uploading ? "Yükleniyor…" : "Görsel / video ekle"}<input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void addRevFiles(e.currentTarget.files); e.currentTarget.value = ""; }} /></label>
            <button type="button" className="btn sm ghost" onClick={() => (setAsk(null), setRevFiles([]))}>Vazgeç</button>
            <button className="btn sm primary" disabled={(!note.trim() && !revFiles.length) || uploading}>Revizeyle yeniden hazırla</button>
          </div>
        </form>
      ) : ask === "posted" ? (
        <form className="revise" onSubmit={(e) => { e.preventDefault(); setAsk(null); markPosted(link.trim() || undefined); setLink(""); }}>
          <input autoFocus className="input" type="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Gönderinin linki (isteğe bağlı), ör. https://instagram.com/p/…" />
          <div className="bmbtns">
            <button type="button" className="btn sm ghost" onClick={() => setAsk(null)}>Vazgeç</button>
            <button className="btn sm primary">Paylaşıldı olarak işaretle</button>
          </div>
        </form>
      ) : ask === "del" ? (
        <div className="delconfirm" role="alertdialog" aria-label="Çıktıyı sil">
          <b>Bu çıktı silinsin mi?</b>
          <p>{task && task.status !== "done" ? "Görev yerinde kalır, yeniden hazırlatabilirsin." : "Görev yerinde kalır."}</p>
          <div className="bmbtns">
            <button className="btn sm ghost" onClick={() => setAsk(null)}>Vazgeç</button>
            <button className="btn sm dangerfill" onClick={remove}>Evet, sil</button>
          </div>
        </div>
      ) : ask === "versions" ? (
        <Versions r={r} ctx={ctx} onDone={() => setAsk(null)} />
      ) : ask === "share" ? (
        <div className="delconfirm postconfirm" role="alertdialog" aria-label="Şimdi paylaş">
          <b>{status === "ready" ? "Onaylanıp hemen paylaşılsın mı?" : "Şimdi paylaşılsın mı?"}</b>
          <p>{sharerName} {accName || "hesapta"} şimdi paylaşır{slot ? `; takvimdeki ${slot} yeri değişmez` : ""}. Paylaşılan gönderi geri alınamaz.</p>
          <div className="bmbtns">
            <button className="btn sm ghost" onClick={() => setAsk(null)}>Vazgeç</button>
            <button className="btn sm primary" onClick={() => (setAsk(null), shareNow(r.id, status === "ready"))}><Send size={14} />Evet, şimdi paylaş</button>
          </div>
        </div>
      ) : ask === "post" && acc ? (
        <div className="delconfirm postconfirm" role="alertdialog" aria-label="Paylaş">
          <b>{accName} hesabında paylaşılsın mı?</b>
          <p>Rou Playgrounds tarayıcısında hesabın açık olduğunu kontrol eder, metni{files.length ? " ve dosyaları" : ""} girer ve paylaşır. Hesap uymazsa hiçbir şey paylaşmaz.</p>
          <div className="bmbtns">
            <button className="btn sm ghost" onClick={() => setAsk(null)}>Vazgeç</button>
            <button className="btn sm primary" onClick={() => (setAsk(null), publish(r.id))}><Send size={14} />Evet, paylaş</button>
          </div>
        </div>
      ) : (status === "ready" || status === "approved" || status === "failed" || status === "posted" || status === "acted") && !publishing && !r.phase && !(r.act?.phase && Date.now() - new Date(r.act.at).getTime() < 60 * 60 * 1000) && (
        <div className={`runact is-${status}`}>
          {/* Ana işlem önde; ne zaman ve kimin paylaşacağı yanında; geri kalan her şey ⋯ menüsünde. */}
          {/* Rou'nun kendi kontrolünden geçmeyen çıktı (puan 8'in altı) öne revizeyle gelir; onay ikincil ve açıkça "yine de". */}
          {status === "ready" && !r.items?.length && !incomplete && <button className={`btn sm ${lowScore ? "" : "primary"}`} onClick={approve}><Check size={14} />{lowScore ? "Yine de onayla" : shareable || keepOpen ? "Onayla" : "Onayla, görev bitti"}</button>}
          {status === "ready" && !r.items?.length && !incomplete && canShareNow && <button className="btn sm" onClick={() => setAsk("share")}><Send size={13} />Onayla ve şimdi paylaş</button>}
          {status === "approved" && canShareNow && <button className="btn sm primary" onClick={() => setAsk("share")}><Send size={14} />{r.publish?.error ? "Yeniden dene" : "Şimdi paylaş"}</button>}
          {status === "approved" && shareable && <button className={`btn sm ${byMe ? "primary" : "ghost"}`} onClick={() => setAsk("posted")}>{byMe ? "Paylaştım" : "Elle paylaştım"}</button>}
          {task && whoOf(s, task) === "claude" && (status === "ready" || status === "approved") && <button className={`btn sm ${lowScore && status === "ready" ? "primary" : "ghost"}`} onClick={() => setAsk("revise")}>Revize iste</button>}
          {(r.post || postOut) && (status === "ready" || status === "approved") && <button className="btn sm ghost" onClick={() => setEditing(true)}><Pencil size={13} />Düzenle</button>}
          {whenNote && <span className="rwhen">{whenNote}</span>}
          <details className="rmenu" onClick={(e) => e.stopPropagation()}>
            <summary className="iconbtn" aria-label="Diğer işlemler" title="Diğer işlemler"><MoreHorizontal size={16} /></summary>
            <div className="rmenupop" onClick={(e) => ((e.target as Element).closest("button") && (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute("open"))}>
              {nVersions > 0 && <button onClick={() => setAsk("versions")}><History size={14} />Sürümler<em>{nVersions}</em></button>}
              {canUnapprove && <button onClick={unapprove}><RotateCcw size={14} />Onayı geri al</button>}
              {task && status !== "approved" && status !== "posted" && status !== "acted" && <button onClick={() => prepare(task.id)}><RefreshCw size={14} />Yeniden hazırlat</button>}
              <button onClick={() => askRouAbout({ runId: r.id })}><MessageCircle size={14} />Rou'ya sor</button>
              {status !== "failed" && r.body && <button onClick={() => navigator.clipboard?.writeText(r.body).then(() => toast("Kopyalandı"))}><Copy size={14} />{r.post ? "Metni kopyala" : "Kopyala"}</button>}
              {status !== "failed" && files.length > 0 && <button onClick={() => download(files, (task?.title ?? r.title).replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase())}><Download size={14} />{r.video ? "Videoyu indir" : files.length > 1 ? "Görselleri indir" : "Görseli indir"}</button>}
              {status !== "posted" && status !== "acted" && <button className="is-danger" onClick={() => setAsk("del")}><Trash2 size={14} />Sil</button>}
            </div>
          </details>
        </div>
      )}
    </motion.article>
  );
}

// Görevin en yeni çıktısı (runs başa eklenir). Aynı görevin eski taslakları yenisi gelince sayılmaz.
export const isLatest = (s: State, r: Run) => !r.taskId || runOfTask(s.runs, r.taskId) === r;
export const readyRuns = (s: State, lens: string) =>
  s.runs.filter((r) => (r.status === "ready" || (r.status === "working" && !isStale(r))) && isLatest(s, r)).filter((r) => {
    return lens === ALL || s.tasks.find((x) => x.id === r.taskId)?.worldId === lens;
  });

// Takvimde ilerideki otomasyon işleri: henüz açılmamış günlerde soluk yer tutucu.
export function ghosts(s: State, lens: string, days: string[]) {
  const t = today();
  const out: { a: Automation; day: string; slot: string }[] = [];
  for (const a of s.automations) {
    if (a.status !== "active" || (lens !== ALL && a.worldId !== lens)) continue;
    for (const d of days) {
      if (d < t || (a.horizon && d <= a.horizon) || !repeatsOn(a, d)) continue;
      for (const slot of slotsOf(a)) if (!occurrenceOf(s, a, d, slot)) out.push({ a, day: d, slot });
    }
  }
  return out;
}
