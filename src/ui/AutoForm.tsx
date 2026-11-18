import { motion } from "motion/react";
import { openAutoView } from "./openAuto";
import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { BrandIcon } from "./BrandIcon";
import { PLATFORMS, PLATFORM_NAME } from "../../shared/stages.mjs";
import type { Automation, PostFormat, Step, StepKind } from "../types";
import { type Ctx, blocksOf, dflt, worldOf } from "../lib";
import { hm, mkTs, today, toMin } from "../date";
import { DAY_SHORT, KIND_LABEL, TOOL_LABEL, everyTimes, repeatsOn, scheduleText, slotsOf, stepsOf } from "../../shared/repeat.mjs";
import { FORMATS, accountsOfProject, attachOf, canAttach, formatsOf, isFeed, isVideo, needsImage, platformName } from "../../shared/social.mjs";
import { uid } from "../store";
import { toast } from "./Toast";
import { binIt } from "../trashOps";
import { Select } from "./Select";
import { ColorPick, Stepper, TimeField } from "./Fields";
import { SWATCHES } from "../../shared/world.mjs";

// Otomasyon formu her yerden açılır:
//   openAutoForm({})                         yeni
//   openAutoForm({ id })                     düzenle
//   openAutoForm({ fromTask }) / ({ fromNote })  bir işi ya da notu otomasyona çevir (Claude taslağı doldurur)
type FormReq = { id?: string; worldId?: string; projectId?: string | null; accountId?: string; fromTask?: string; fromNote?: string; text?: string };
const NOTE_HINT: Record<string, string> = { text: "Nasıl: ör. samimi, kısa", image: "Nasıl: ör. kare, 1080 px", video: "Nasıl: ör. 15 sn, dikey", other: "Kısa not" };
export const openAutoForm = (r: FormReq) => dispatchEvent(new CustomEvent("pg-auto-form", { detail: r }));

type Draft = Pick<Automation, "title" | "worldId" | "projectId" | "days" | "times" | "minutes" | "who" | "action" | "every"> & { steps: Step[]; format?: PostFormat; accountId?: string; platforms?: string[]; sharer?: Automation["sharer"]; browser?: Automation["browser"]; folder?: string; attach?: Automation["attach"]; autoShare?: boolean; color?: string };

const PRESETS: { label: string; days: number[] }[] = [
  { label: "Her gün", days: [0, 1, 2, 3, 4, 5, 6] },
  { label: "Hafta içi", days: [1, 2, 3, 4, 5] },
  { label: "Hafta sonu", days: [0, 6] },
];
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const same = (a: number[], b: number[]) => [...a].sort().join() === [...b].sort().join();
const WHO: { id: Automation["who"]; label: string; hint: string }[] = [
  { id: "claude", label: "Rou", hint: "Saatinden önce kendisi yazar, sen onaylarsın." },
  { id: "me", label: "Ben", hint: "O saatte sana bir görev açılır." },
];

export function AutoFormHost({ ctx }: { ctx: Ctx }) {
  const [req, setReq] = useState<FormReq | null>(null);
  useEffect(() => {
    const h = (e: Event) => setReq((e as CustomEvent<FormReq>).detail);
    addEventListener("pg-auto-form", h);
    return () => removeEventListener("pg-auto-form", h);
  }, []);
  if (!req) return null;
  return <AutoForm key={JSON.stringify(req)} ctx={ctx} req={req} onClose={() => setReq(null)} />;
}

// Formun başlangıç değerleri: var olan otomasyon, dönüştürülen iş ya da not, ya da boş.
function initial(ctx: Ctx, req: FormReq): { d: Draft; describe: string } {
  const s = ctx.state;
  const a = req.id ? s.automations.find((x) => x.id === req.id) : undefined;
  // accountId "": bilerek hesapsız (düz metin); undefined: yeni, projenin ilk hesabı önerilir.
  if (a) return { d: { ...a, accountId: a.accountId ?? "", steps: structuredClone(stepsOf(a)) }, describe: "" };
  const base: Draft = { title: "", worldId: req.worldId ?? dflt(ctx.route.lens, s), projectId: req.projectId ?? null, ...(req.accountId ? { accountId: req.accountId } : {}), days: [0, 1, 2, 3, 4, 5, 6], times: ["09:00"], minutes: 30, who: "claude", action: "", steps: [{ id: uid(), kind: "text", tool: "claude" }] };
  const task = req.fromTask ? s.tasks.find((x) => x.id === req.fromTask) : undefined;
  if (task) {
    const b = blocksOf(s, task.id).find((x) => x.start.slice(0, 10) === (task.day ?? today()));
    return {
      d: { ...base, title: task.title, worldId: task.worldId, projectId: task.projectId, times: b ? [hm(b.start)] : [], minutes: task.estimate ?? 30, who: "me", action: task.notes, steps: [] },
      describe: [task.title, task.notes].filter(Boolean).join(". "),
    };
  }
  const note = req.fromNote ? s.inbox.find((x) => x.id === req.fromNote) : undefined;
  if (note) return { d: { ...base, title: note.title.slice(0, 80), worldId: note.worldId ?? base.worldId, action: note.body }, describe: [note.title, note.body].filter(Boolean).join(". ") };
  return { d: base, describe: req.text ?? "" };
}

function AutoForm({ ctx, req, onClose }: { ctx: Ctx; req: FormReq; onClose: () => void }) {
  const s = ctx.state;
  const a = req.id ? s.automations.find((x) => x.id === req.id) : undefined;
  const init = useRef(initial(ctx, req)).current;
  const [d, setD] = useState<Draft>(init.d);
  // Elle değiştirilen alanlar: Claude doldururken bunlara dokunmaz. İşten gelen saat de işin bloğuyla aynı kalsın diye sabittir.
  const touched = useRef(new Set<keyof Draft>(req.fromTask && init.d.times.length ? ["times"] : []));
  const set = (p: Partial<Draft>) => { Object.keys(p).forEach((k) => touched.current.add(k as keyof Draft)); setD((x) => ({ ...x, ...p })); };
  const [describe, setDescribe] = useState(init.describe);
  const [ai, setAi] = useState<"idle" | "busy" | "done">("idle");
  const [confirm, setConfirm] = useState(false);
  // Dünya belliyse (o dünyanın sayfasından açıldı, iş/nottan geldi, düzenleniyor ya da elle seçildi) Claude onu değiştirmez.
  const [picked, setPicked] = useState(false);
  // Satır içi yeni proje: null kapalı, metin açık. Eklenen proje seçili dünyada açılır ve hemen seçilir.
  const [newProj, setNewProj] = useState<string | null>(null);
  const addProject = () => {
    const name = newProj?.trim();
    if (!name) return;
    const pid = uid();
    ctx.mutate((st) => { st.projects.push({ id: pid, worldId: d.worldId, name, description: "", status: "active", deadline: null, ongoing: true }); });
    set({ projectId: pid });
    setNewProj(null);
  };
  const fromNote = req.fromNote ? s.inbox.find((x) => x.id === req.fromNote) : undefined;
  const worldFixed = picked || !!a || !!req.worldId || !!req.fromTask || !!fromNote?.worldId;
  const project = d.projectId ? s.projects.find((p) => p.id === d.projectId) : undefined;
  const accounts = accountsOfProject(s, project).filter((x) => !isFeed(x.platform));
  const social = d.accountId === "" ? undefined : accounts.find((x) => x.id === d.accountId) ?? accounts[0];
  const formats = social ? formatsOf(social.platform) : [];
  const format = social ? (d.format && formats.includes(d.format) ? d.format : formats[0]) : undefined;
  const w = worldOf(s, d.worldId);
  // Otomasyon her zaman bir projeye bağlıdır (projenin tekrar eden görevi).
  const ok = !!d.title.trim() && !!d.projectId && d.days.length > 0 && (d.who === "me" || !!d.action.trim());
  const source = req.fromTask ? "görev" : req.fromNote ? "not" : null;
  // Seri rengi seçerken aynı hesabın ya da projenin diğer serilerinin renkleri görünür (birbirinden uzak ton seçilsin).
  const siblings = s.automations.filter((x) => x.id !== a?.id && x.color && ((social && x.accountId === social.id) || (d.projectId && x.projectId === d.projectId)));

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);

  // Claude ile doldur: tarifi otomasyon alanlarına çevirir. İşten/nottan gelince ya da sayfadaki kutudan gelince kendiliğinden çalışır.
  // Form kapanınca süren doldurma kesilir (sunucu da Claude'u durdurur).
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const fill = async (text = describe) => {
    if (!text.trim() || ai === "busy") return;
    setAi("busy");
    abort.current = new AbortController();
    const r = await fetch("/api/auto-draft", { method: "POST", signal: abort.current.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ text, worldId: worldFixed ? d.worldId : null }) }).then((r) => r.json()).catch((e) => ({ ok: false, error: e?.name === "AbortError" ? null : "Sunucuya ulaşılamadı" }));
    if (abort.current?.signal.aborted) return;
    if (!r.ok) { setAi("idle"); return toast(r.error ?? "Form doldurulamadı"); }
    setD((x) => {
      const next = { ...x };
      for (const [k, v] of Object.entries(r.draft) as [keyof Draft, never][]) if (!touched.current.has(k) && !(k === "steps" && !(v as unknown[]).length)) next[k] = v;
      // Dünya sabitse Claude'un önerdiği proje yalnız o dünyadansa geçer (sunucu da bunu sağlar).
      if (worldFixed) next.worldId = x.worldId;
      if (touched.current.has("projectId")) next.projectId = x.projectId;
      if (!touched.current.has("who")) next.who = req.fromTask && r.draft.who === "claude" && !/yaz|hazırla|üret|gönderi|post|içerik/i.test(text) ? x.who : r.draft.who;
      return next;
    });
    setAi("done");
  };
  useEffect(() => {
    if (!a && (req.fromNote || req.text)) fill(init.describe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    if (!ok) return;
    const times = d.every ? everyTimes(d.every) : [...new Set(d.times.filter(Boolean))].sort();
    const steps = d.steps.map((x) => ({ ...x, account: x.kind === "post" ? x.account?.trim() || undefined : undefined, note: x.note?.trim() || undefined }));
    const fields = { title: d.title.trim(), worldId: d.worldId, projectId: d.projectId, days: d.days, times, every: d.every, minutes: d.minutes, who: d.who, action: d.action.trim(), steps, accountId: social?.id, platforms: social ? undefined : d.platforms?.length ? d.platforms : undefined, sharer: d.sharer === "claude" || d.sharer === "me" ? d.sharer : undefined, format, attach: d.who !== "me" && canAttach(format) ? d.attach : undefined, browser: d.who !== "me" && !social ? d.browser : undefined, folder: d.who !== "me" && !social && d.browser ? d.folder?.trim() || undefined : undefined, autoShare: d.who !== "me" && (d.sharer ?? "claude") === "claude" && d.autoShare ? true : undefined, color: d.color || undefined };
    if (fields.autoShare && a?.approve === false && !window.confirm("Bu otomasyon onay beklemiyor. Otomatik paylaş açıkken gönderiler hiçbir tıklama olmadan paylaşılır. Devam edilsin mi?")) return;
    const newId = uid();
    ctx.mutate((st) => {
      const t = today();
      if (a) {
        const x = st.automations.find((y) => y.id === a.id);
        if (!x) return;
        const reschedule = !same(x.days, fields.days) || x.times.join() !== fields.times.join();
        Object.assign(x, fields);
        // Bugünün ve ilerinin başlanmamış işleri yeni ayara uyar; saatler değiştiyse bugünkü işler yeniden açılır.
        st.tasks.forEach((k) => {
          if (k.autoId !== x.id || k.status === "done" || !k.day || k.day < t) return;
          Object.assign(k, { title: x.title, worldId: x.worldId, projectId: x.projectId, by: x.who });
          st.blocks.forEach((b) => b.taskId === k.id && (b.worldId = x.worldId));
        });
        if (reschedule) {
          const stale = new Set(st.tasks.filter((k) => k.autoId === x.id && k.day === t && k.status === "todo" && !st.runs.some((r) => r.taskId === k.id) && (!repeatsOn(x, t) || !slotsOf(x).includes(k.autoSlot ?? ""))).map((k) => k.id));
          st.tasks = st.tasks.filter((k) => !stale.has(k.id));
          st.blocks = st.blocks.filter((b) => !b.taskId || !stale.has(b.taskId));
          x.horizon = null;
        }
        return;
      }
      const auto: Automation = { id: newId, ...fields, status: "active", horizon: null, createdAt: new Date().toISOString() };
      st.automations.push(auto);
      // İşten dönüştürüldüyse: o iş otomasyonun ilk işi olur (aynı saate ikinci iş açılmaz).
      const task = req.fromTask ? st.tasks.find((x) => x.id === req.fromTask) : undefined;
      if (task) {
        Object.assign(task, { autoId: auto.id, title: auto.title, worldId: auto.worldId, projectId: auto.projectId, by: auto.who });
        task.day ??= t;
        const slots = slotsOf(auto);
        const b = st.blocks.find((x) => x.taskId === task.id && x.start.slice(0, 10) === task.day);
        const slot = b && slots.includes(hm(b.start)) ? hm(b.start) : slots[0];
        task.autoSlot = slot;
        if (slot && !b) st.blocks.push({ id: uid(), taskId: task.id, worldId: auto.worldId, title: "", start: mkTs(task.day!, toMin(slot)), end: mkTs(task.day!, toMin(slot) + auto.minutes), kind: "plan" });
        st.blocks.forEach((x) => x.taskId === task.id && (x.worldId = auto.worldId));
      }
      // Nottan geldiyse not arşivlenir ve otomasyona bağlanır.
      const note = req.fromNote ? st.inbox.find((x) => x.id === req.fromNote) : undefined;
      if (note) Object.assign(note, { state: "done", autoId: auto.id });
    });
    toast(a ? "Otomasyon güncellendi" : `Otomasyon kuruldu: ${scheduleText(fields as Automation)}`, a ? undefined : () => openAutoView(newId), a ? undefined : "Gör");
    onClose();
  };
  const remove = () => {
    if (!a) return;
    const gone0 = new Set(s.tasks.filter((t) => t.autoId === a.id && t.status === "todo" && t.day && t.day >= today() && !s.runs.some((r) => r.taskId === t.id)).map((t) => t.id));
    binIt(ctx, "auto", a.title, { automations: [{ ...a, horizon: null }], tasks: s.tasks.filter((t) => gone0.has(t.id)), blocks: s.blocks.filter((b) => b.taskId && gone0.has(b.taskId)) }, (st) => {
      st.automations = st.automations.filter((x) => x.id !== a.id);
      // Henüz başlanmamış bugünkü/ilerideki işleri gider; geçmiş işler ve çıktılar kalır.
      const gone = new Set(st.tasks.filter((t) => t.autoId === a.id && t.status === "todo" && t.day && t.day >= today() && !st.runs.some((r) => r.taskId === t.id)).map((t) => t.id));
      st.tasks = st.tasks.filter((t) => !gone.has(t.id));
      st.blocks = st.blocks.filter((b) => !b.taskId || !gone.has(b.taskId));
    }, `“${a.title}” silindi`);
    onClose();
  };

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.form className="modal autoform" style={{ ["--w" as string]: w.color }} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} onSubmit={(e) => (e.preventDefault(), save())}>
        <div className="afhead">
          <p className="flabel aftitle">{a ? "Otomasyonu düzenle" : source ? `Bu ${source}tan otomasyon` : "Yeni otomasyon"}</p>
          <button type="button" className="x" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </div>

        <div className={`aibar ${ai === "busy" ? "is-busy" : ""}`}>
          <Sparkles size={16} />
          <input value={describe} onChange={(e) => setDescribe(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), fill())} placeholder="Tarif et, form kendiliğinden dolsun" aria-label="Otomasyonu tarif et" disabled={ai === "busy"} />
          <button type="button" className="btn sm" onClick={() => fill()} disabled={!describe.trim() || ai === "busy"}>
            {ai === "busy" ? <><RefreshCw size={13} className="spin" />Dolduruyor</> : "Doldur"}
          </button>
        </div>
        {ai === "done" && <p className="aidone">Form dolduruldu. Kontrol et, istediğini değiştir.</p>}

        <input className="big" autoFocus={!a && !source} value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="Adı: ör. LinkedIn gönderisi" aria-label="Otomasyonun adı" />

        <dl className="props">
          <div>
            <dt>Nerede</dt>
            <dd>
              {/* Dünya ve proje ayrı seçici (tek listede ikisini birden seçmek zordu); proje listesinin sonunda yeni proje. */}
              <div className="wherepick">
                <Select className="ppick" style={{ ["--w" as string]: w.color }} label="Dünya" disabled={ai === "busy"}
                  value={d.worldId} groups={[{ options: s.worlds.map((x) => ({ value: x.id, label: x.name, color: x.color })) }]}
                  onChange={(v) => { if (v !== d.worldId) { set({ worldId: v, projectId: null }); setNewProj(null); } setPicked(true); }}>
                  <i /><b>{w.name}</b>
                </Select>
                {newProj === null ? (
                  <Select className="ppick" label="Proje" disabled={ai === "busy"}
                    value={d.projectId ?? ""} groups={[{ options: [...s.projects.filter((p) => p.worldId === d.worldId && (p.status !== "done" || p.id === d.projectId)).map((p) => ({ value: p.id, label: p.name })), { value: "new", label: "+ Yeni proje" }] }]}
                    onChange={(v) => { if (v === "new") setNewProj(""); else set({ projectId: v }); setPicked(true); }}>
                    <b className={project ? "" : "unset"}>{project ? project.name : "Proje seç"}</b>
                  </Select>
                ) : (
                  <form className="newproj" onSubmit={(e) => { e.preventDefault(); addProject(); }}>
                    <input autoFocus value={newProj} onChange={(e) => setNewProj(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setNewProj(null); } }} placeholder="Proje adı" aria-label="Yeni projenin adı" />
                    <button type="submit" disabled={!newProj.trim()}>Ekle</button>
                  </form>
                )}
              </div>
            </dd>
          </div>
          <div>
            <dt>Günler</dt>
            <dd className="chips">
              {PRESETS.map((p) => <button type="button" key={p.label} className={same(d.days, p.days) ? "on" : ""} onClick={() => set({ days: p.days })}>{p.label}</button>)}
            </dd>
          </div>
          <div>
            <dt />
            <dd className="chips days">
              {WEEK.map((x) => (
                <button type="button" key={x} className={d.days.includes(x) ? "on" : ""} onClick={() => set({ days: d.days.includes(x) ? d.days.filter((y) => y !== x) : [...d.days, x] })}>{DAY_SHORT[x]}</button>
              ))}
            </dd>
          </div>
          <div>
            <dt>Saatler</dt>
            <dd className="times">
              <span className="seg sm">
                <button type="button" className={!d.every ? "on" : ""} onClick={() => set({ every: undefined })}>Belirli saatler</button>
                <button type="button" className={d.every ? "on" : ""} onClick={() => set({ every: d.every ?? { hours: 1, from: "09:00", to: "18:00" } })}>Aralıklı</button>
              </span>
              {d.every ? <span className="everyin">
                <TimeField value={d.every.from} onChange={(v) => set({ every: { ...d.every!, from: v } })} label="Başlangıç" />–
                <TimeField value={d.every.to} onChange={(v) => set({ every: { ...d.every!, to: v } })} label="Bitiş" />
                <span>arası her</span>
                <Stepper value={d.every.hours} min={1} max={12} step={1} onChange={(v) => set({ every: { ...d.every!, hours: v } })} label="Saat aralığı" />
                <span>saatte bir · günde {everyTimes(d.every).length} kez</span>
              </span> : <>
              {d.times.map((t, i) => (
                <span key={i} className="timein">
                  <TimeField value={t} onChange={(v) => set({ times: d.times.map((x, j) => (j === i ? v : x)) })} label={`${i + 1}. saat`} />
                  <button type="button" onClick={() => set({ times: d.times.filter((_, j) => j !== i) })} aria-label="Saati kaldır"><X size={13} /></button>
                </span>
              ))}
              <button type="button" className="slotadd" onClick={() => set({ times: [...d.times, d.times.length ? "20:00" : "09:00"] })}><Plus size={13} />Saat ekle</button>
              {!d.times.length && <span className="muted">Saatsiz: o günün listesine düşer</span>}
              </>}
            </dd>
          </div>
          <div>
            <dt>Süre</dt>
            <dd className="reptime"><label><Stepper value={d.minutes} min={5} max={480} step={5} onChange={(v) => set({ minutes: v })} label="Süre" /><span>dk, takvimde ayrılan</span></label></dd>
          </div>
          <div>
            <dt>Seri rengi</dt>
            <dd>
              <div className="swatches">
                <button type="button" className={`auto ${d.color ? "" : "on"}`} onClick={() => set({ color: undefined })} aria-label="Renksiz" title="Projenin kit rengi">A</button>
                {SWATCHES.map((c) => <button type="button" key={c} className={c === d.color ? "on" : ""} style={{ background: c }} onClick={() => set({ color: c })} aria-label={c} />)}
                <ColorPick className={`pick ${d.color && !SWATCHES.includes(d.color) ? "on" : ""}`} title="Başka bir renk" value={d.color || w.color} onChange={(c) => set({ color: c })} label="Başka bir seri rengi" />
              </div>
              {siblings.length > 0 && <p className="muted whohint autosibs">Aynı hesap ya da projedeki seriler: {siblings.map((x) => <span key={x.id}><i className="autodot" style={{ background: x.color }} />{x.title}</span>)}</p>}
            </dd>
          </div>
          <div>
            <dt>Kim hazırlar</dt>
            <dd>
              <div className="seg whoseg">
                {WHO.map((o) => <button type="button" key={o.id} className={d.who === o.id ? "on" : ""} onClick={() => set({ who: o.id, steps: d.steps.map((x) => (x.kind === "text" && x.tool === d.who && o.id !== "me" ? { ...x, tool: o.id } : x)) })}>{o.label}</button>)}
              </div>
              <p className="muted whohint">{WHO.find((o) => o.id === d.who)!.hint}</p>
            </dd>
          </div>
          {accounts.length > 0 && (
            <div>
              <dt>Paylaşım</dt>
              <dd>
                <Select className="ppick accpick" label="Hangi hesapta paylaşılacak" value={social?.id ?? ""} onChange={(v) => set({ accountId: v, format: undefined })}
                  groups={[{ options: [...accounts.map((x) => ({ value: x.id, label: `${platformName(x)}${x.name ? ` · ${x.name}` : ""}${x.handle ? ` ${x.handle}` : ""}` })), { value: "", label: "Paylaşım yok, düz metin" }] }]}>
                  <b>{social ? `${platformName(social)}${social.name ? ` · ${social.name}` : ""}${social.handle ? ` ${social.handle}` : ""}` : "Paylaşım yok, düz metin"}</b>
                </Select>
                {social && formats.length > 1 && <div className="seg whoseg fmtseg">{formats.map((f) => <button type="button" key={f} className={format === f ? "on" : ""} onClick={() => set({ format: f })}>{FORMATS[f].short}</button>)}</div>}
                {social && <p className="muted whohint">{FORMATS[format!].label}. {isVideo(format) ? "Video bu bilgisayarda üretilir." : format === "ig_post" ? "Slayt görselleri bu bilgisayarda üretilir." : "Gerçek görünümüyle önizlenir."}</p>}
              </dd>
            </div>
          )}
          {social && d.who !== "me" && canAttach(format) && (
            <div>
              <dt>Ek</dt>
              <dd>
                <div className="seg">
                  {([[undefined, "Yok"], ["image", "Görsel"], ["video", "Video"]] as const).filter(([k]) => k || !needsImage(format)).map(([k, l]) => <button type="button" key={l} className={attachOf(format, d) === k ? "on" : ""} onClick={() => set({ attach: k })}>{l}</button>)}
                </div>
                <p className="muted whohint">{attachOf(format, d) === "image" ? `Rou metnin özünden tek bir görsel üretir, gönderiyle birlikte paylaşılır.${needsImage(format) ? " LinkedIn gönderisi görselsiz çıkmaz." : ""}` : d.attach === "video" ? "Rou metinden 15 ile 25 saniyelik dikey bir video üretir, gönderiyle birlikte paylaşılır." : "Yalnız metin."}</p>
              </dd>
            </div>
          )}
          {d.who !== "me" && !social && (
            <div>
              <dt>Platform</dt>
              <dd>
                <div className="platpick">
                  {PLATFORMS.map((pl) => {
                    const on = d.platforms?.includes(pl) ?? false;
                    return <button type="button" key={pl} className={on ? "on" : ""} aria-pressed={on} onClick={() => set({ platforms: on ? d.platforms!.filter((x) => x !== pl) : [...(d.platforms ?? []), pl] })}><BrandIcon platform={pl} size={15} />{PLATFORM_NAME[pl]}</button>;
                  })}
                </div>
                <p className="muted whohint">Hesap bağlı değilken nerede paylaşılacağı. Hesap bağlanınca oraya paylaşılır.</p>
              </dd>
            </div>
          )}
          {d.who !== "me" && (social || !!d.platforms?.length) && (
            <div>
              <dt>Paylaşan</dt>
              <dd>
                <div className="seg">
                  {([["claude", "Rou"], ["me", "Ben"]] as const).map(([k, l]) => <button type="button" key={k} className={(d.sharer ?? "claude") === k ? "on" : ""} onClick={() => set({ sharer: k })}>{l}</button>)}
                </div>
                <p className="muted whohint">{d.sharer === "me" ? "Onaydan sonra metni kopyalayıp kendin paylaşırsın, sonra Paylaştım dersin." : "Onaydan sonra Rou paylaşır."} Tek bir gönderi için görev kartından değiştirebilirsin.</p>
              </dd>
            </div>
          )}
          {d.who !== "me" && (social || !!d.platforms?.length) && (d.sharer ?? "claude") === "claude" && (
            <div>
              <dt>Otomatik</dt>
              <dd>
                <button type="button" className={`switch ${d.autoShare ? "on" : ""}`} role="switch" aria-checked={!!d.autoShare} onClick={() => set({ autoShare: d.autoShare ? undefined : true })}><span className="knob" />Otomatik paylaş</button>
                <p className="muted whohint">{d.autoShare ? "Onaylanan gönderiyi Rou saatinde kendiliğinden paylaşır." : "Kapalıyken onaylanan gönderi, sen \"Şimdi paylaş\" diyene kadar bekler."}</p>
              </dd>
            </div>
          )}
          {d.who !== "me" && !social && (
            <div>
              <dt>Çalışma</dt>
              <dd><ChromePick browser={d.browser} folder={d.folder ?? ""} title={d.title} onChange={(p) => set(p)} /></dd>
            </div>
          )}
          {d.who !== "me" && (
            <div>
              <dt>Talimat</dt>
              <dd>
                <textarea className="notes" rows={4} value={d.action} onChange={(e) => set({ action: e.target.value })} placeholder={d.browser && !social ? "Tarayıcıda ne yapılsın? Ör. LinkedIn'de Product Designer ilanlarına bak, uygun olanlara ilana göre CV hazırla; onaylarsam başvur." : social ? "Ne hakkında? Ör. bu hafta yaptığım bir tasarım kararını anlat. Biçim ve tarz hesaptan gelir." : "Ne hazırlansın? Ör. Proje için kısa bir LinkedIn gönderisi; bir özelliğini anlat, en fazla 4 cümle."} />
              </dd>
            </div>
          )}
          <div>
            <dt>Adımlar</dt>
            <dd className="steps">
              {d.steps.map((x, i) => {
                const upd = (p: Partial<Step>) => set({ steps: d.steps.map((y) => (y.id === x.id ? { ...y, ...p } : y)) });
                return (
                  <div key={x.id} className="steprow">
                    <span className="stepn">{i + 1}</span>
                    <Select className="selfield" label="Ne yapılacak" value={x.kind} onChange={(v) => upd({ kind: v as StepKind })} groups={[{ options: Object.entries(KIND_LABEL).map(([k, l]) => ({ value: k, label: l as string })) }]}>
                      {KIND_LABEL[x.kind as keyof typeof KIND_LABEL] ?? x.kind}
                    </Select>
                    <Select className="selfield" label="Hangi araçla" value={x.tool} onChange={(v) => upd({ tool: v })} groups={[{ options: Object.entries(TOOL_LABEL).map(([k, l]) => ({ value: k, label: l as string })) }]}>
                      {TOOL_LABEL[x.tool as keyof typeof TOOL_LABEL] ?? x.tool}
                    </Select>
                    {x.kind === "post"
                      ? <input value={x.account ?? ""} onChange={(e) => upd({ account: e.target.value })} placeholder="Nerede: ör. LinkedIn, kişisel profil" aria-label="Hesap" />
                      : <input value={x.note ?? ""} onChange={(e) => upd({ note: e.target.value })} placeholder={NOTE_HINT[x.kind] ?? "Not"} aria-label="Not" />}
                    <button type="button" className="iconbtn" onClick={() => set({ steps: d.steps.filter((y) => y.id !== x.id) })} aria-label="Adımı kaldır"><X size={14} /></button>
                  </div>
                );
              })}
              <button type="button" className="slotadd" onClick={() => set({ steps: [...d.steps, { id: uid(), kind: d.steps.length ? "post" : "text", tool: d.steps.length ? "me" : d.who === "me" ? "me" : d.who }] })}><Plus size={13} />Adım ekle</button>
              <span className="muted stephint">{d.who === "me" ? "Her adım görevde kontrol listesi olur." : "Hazırlayanın adımları kendiliğinden yapılır, diğerleri sana kontrol listesi olur."}</span>
            </dd>
          </div>
        </dl>

        <p className="afsum">
          {d.title.trim() ? <b>{d.title.trim()}</b> : "Bu otomasyon"}: {scheduleText(d as Automation).toLocaleLowerCase("tr")}, {w.name}{project ? ` › ${project.name}` : ""} içinde bir görev açar.{" "}
          {d.who === "me" ? "Takviminde ve Bugün listende görünür." : "Hazırlanan çıktıyı sen onaylarsın."}
          {req.fromTask && " Bu görev, otomasyonun bugünkü görevi olur."}
        </p>

        {confirm ? (
          <div className="wdel">
            <p><b>{a?.title}</b> silinsin mi? Bugünden sonraki başlanmamış görevleri de gider; eski çıktılar kalır.</p>
            <div className="foot"><span /><button type="button" className="btn" onClick={() => setConfirm(false)}>Vazgeç</button><button type="button" className="btn dangerfill" onClick={remove}>Evet, sil</button></div>
          </div>
        ) : (
          <div className="foot">
            {a ? <button type="button" className="btn danger" onClick={() => setConfirm(true)}>Sil</button> : null}
            {!d.projectId ? <span className="muted">Otomasyon bir projenin tekrar eden görevidir; önce proje seç.</span> : <span />}
            <button type="button" className="btn" onClick={onClose}>Vazgeç</button>
            <button className="btn primary" disabled={!ok || ai === "busy"}>{a ? "Kaydet" : "Kur"}</button>
          </div>
        )}
      </motion.form>
    </div>
  );
}

// Tarayıcıda çalışsın: Rou Playgrounds'un tarayıcısında, otomasyonun dünyasının oturumunda çalışır. Hazırlıkta yalnız okur ve önerir, onaylanınca yapar.
// automation.browser yalnız "tarayıcıda" işaretidir (eski kayıtlarda Chrome'un kimliği durur; sunucu Playgrounds'un tarayıcısını kullanır).
const IN_APP = { id: "pb", name: "Playgrounds" };
function ChromePick({ browser, folder, title, onChange }: { browser?: Automation["browser"]; folder: string; title: string; onChange: (p: { browser?: Automation["browser"]; folder?: string }) => void }) {
  return (
    <div className="chpick">
      <div className="seg whoseg">
        <button type="button" className={!browser ? "on" : ""} onClick={() => onChange({ browser: undefined })}>Yalnız yazar</button>
        <button type="button" className={browser ? "on" : ""} onClick={() => (browser ? null : onChange({ browser: IN_APP }))}>Tarayıcıda</button>
      </div>
      {browser && (
        <>
          <label className="chfolder">
            <span>Dosyalar</span>
            <span className="chpath">Çalışma klasörü ›</span>
            <input value={folder} onChange={(e) => onChange({ folder: e.target.value })} placeholder={title.trim() || "Klasör adı"} aria-label="Klasör adı" />
          </label>
          <p className="muted whohint">Hazırlat'ta dünyanın tarayıcı oturumunda yalnız okur ve hazırlar, yapılacakları listeler. Seçip onayladıklarını yapar.</p>
        </>
      )}
    </div>
  );
}
