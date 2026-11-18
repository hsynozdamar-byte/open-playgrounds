import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { runOfTask } from "../runs";
import { AutoRuns } from "./AutoRuns";
import { ChevronRight, Pencil, Repeat, X } from "lucide-react";
import type { Automation, Lang } from "../types";
import { toast } from "./Toast";
import { type Ctx, projectOf, worldOf } from "../lib";
import { scheduleText, slotsOf } from "../../shared/repeat.mjs";
import { DEFAULT_LANG, FORMATS, LANGS, accountOf, attachOf, formatOf, platformName } from "../../shared/social.mjs";
import { addDays, dayNum, dayShort, today } from "../date";
import { OUTPUT_LABEL, outputOf, platformsOf } from "../../shared/stages.mjs";
import { BOT, ghosts } from "./Auto";
import { BrandIcon } from "./BrandIcon";
import { openAutoForm } from "./AutoForm";
import { topicOf } from "./Topics";
import { type Item, PickedPost, itemOfSlot, itemOfTask } from "../views/Studio";

// Tekrarlayan görev = otomasyon. Projenin altında tek bir görev; günlük gönderiler onun çıktıları.
// Pencerede: ne zaman, nereye, kim (özet) · neye göre yazar (talimat ve kaynaklar) · plan (sıradaki saatler ve konuları) · çıktılar.
// "Nasıl çalışır": başlığın yanında küçük ? düğmesi, basınca adımlar küçük bir pencerede.
function HowItWorks({ flow }: { flow: { k: string; v: string }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("mousedown", down); addEventListener("keydown", key);
    return () => { removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [open]);
  return (
    <span className="avhow" ref={box}>
      <button className="avhowbtn" onClick={() => setOpen((x) => !x)} aria-label="How it works" aria-expanded={open} title="How it works">?</button>
      {open && <span className="avhowpop" role="dialog" aria-label="How it works">
        <b>How it works</b>
        <ol>{flow.map((f, i) => <li key={i}><span className="avn">{i + 1}</span><span><b>{f.k}</b><em>{f.v}</em></span></li>)}</ol>
      </span>}
    </span>
  );
}

export function AutoViewHost({ ctx }: { ctx: Ctx }) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const h = (e: Event) => setId((e as CustomEvent<string>).detail);
    addEventListener("pg-auto-view", h);
    return () => removeEventListener("pg-auto-view", h);
  }, []);
  const a = id ? ctx.state.automations.find((x) => x.id === id) : undefined;
  if (!a) return null;
  return <AutoView key={a.id} ctx={ctx} a={a} onClose={() => setId(null)} />;
}

function AutoView({ ctx, a, onClose }: { ctx: Ctx; a: Automation; onClose: () => void }) {
  const s = ctx.state;
  const [sel, setSel] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [tab, setTab] = useState<"plan" | "past" | "setup">("plan");
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !sel && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose, sel]);
  const w = worldOf(s, a.worldId);
  const p = projectOf(s, a.projectId);
  const acc = accountOf(s, a);
  const plats = platformsOf(s, a);
  const out = outputOf(s, a);
  const fmt = formatOf(s, a);
  const att = fmt ? attachOf(fmt, a) : a.attach;
  const paused = a.status !== "active";
  const toggle = () => ctx.mutate((st) => { const x = st.automations.find((y) => y.id === a.id); if (x) x.status = x.status === "active" ? "paused" : "active"; });
  const goProject = () => p && (onClose(), ctx.go({ view: "projects", lens: a.worldId, project: p.id }));
  // Sıradakiler: bugünden iki hafta; her saat bir satır (açılmış iş ya da henüz açılmamış saat).
  const days = Array.from({ length: 14 }, (_, i) => addDays(today(), i));
  const tasks = s.tasks.filter((t) => t.autoId === a.id && t.day && days.includes(t.autoDay ?? t.day)).map((t) => itemOfTask(s, t));
  const slots = ghosts(s, a.worldId, days).filter((g) => g.a.id === a.id).map((g) => itemOfSlot(s, a, g.day, g.slot));
  const items: Item[] = [...tasks, ...slots];
  const upcoming = [...items].sort((x, y) => (x.day + x.time).localeCompare(y.day + y.time));
  const last = s.runs.find((r) => r.body && s.tasks.find((t) => t.id === r.taskId)?.autoId === a.id);
  // Neye bağlı: projenin marka sesi, medya klasörü, bilgi notları, hesap.
  const brand = !!(p?.brand && (p.brand.use || p.brand.avoid || p.brand.audience));
  const media = (p?.mediaDirs?.length ?? 0) + (p?.mediaDir ? 1 : 0);
  const notes = p?.sources?.filter((x) => x.use).length ?? 0;
  const langId = (acc as { lang?: string } | undefined)?.lang ?? DEFAULT_LANG;
  const langName = (id: string) => LANGS.find((l) => l.id === id)?.label ?? id;
  const lang = langName(langId);
  // Dil hesabındır (aynı hesabın bütün otomasyonları); talimattaki dil sözünü geçer (shared/social.mjs langRule).
  const setLang = (id: Lang) => {
    if (!acc) return;
    ctx.mutate((st) => { for (const w of st.worlds) for (const x of w.accounts ?? []) if (x.id === acc.id) x.lang = id; });
    toast(`${acc.handle || acc.name}: next posts are written in ${langName(id)}.`);
  };
  const rules = (a.visual ?? "").split("\n").map((x) => x.replace(/^[-•]\s*/, "").trim()).filter(Boolean);
  const dropRule = (i: number) => ctx.mutate((st) => { const x = st.automations.find((y) => y.id === a.id); if (x) { const r = rules.filter((_, j) => j !== i); if (r.length) x.visual = r.map((y) => `- ${y}`).join("\n"); else delete x.visual; } });
  const sharer = a.sharer ?? (a.who === "me" ? "me" : "claude");
  const flow = [
    { k: "When", v: scheduleText(a) },
    { k: a.who === "me" ? "You prepare it" : `${BOT[a.who]} writes it`, v: a.who === "me" ? "A task opens at that time" : `1 hour before its time${att === "image" ? ", and makes the image" : att === "video" ? ", and builds the video" : ""}` },
    { k: "You approve it", v: "Check the preview, then approve or request changes" },
    ...(out === "post" || out === "video" ? [{ k: sharer === "me" ? "You share it" : `${BOT[sharer]} shares it`, v: acc ? `${platformName(acc)} ${acc.handle || acc.name}` : "To the account" }] : []),
  ];
  const stOf = (it: Item) => (!it.task ? "ghost" : !it.run ? "plan" : it.run.status === "acted" ? "posted" : it.run.status);
  const titleOf = (it: Item) => it.task ? (it.task.topic?.title ?? (it.run?.title && it.run.title !== a.title ? it.run.title : it.run?.body?.split(/[.!?\n]/)[0] || undefined)) : topicOf(s, a, it.day, it.time)?.title;
  // Sağlık: son çalışma, sıradaki, bekleyen, hata. Geçmiş: bütün çalışmalar, en yeni başta.
  const own = s.tasks.filter((t) => t.autoId === a.id && t.day);
  const runOf = (id: string) => runOfTask(s.runs, id);
  const past = own.filter((t) => (t.autoDay ?? t.day)! < today() || runOf(t.id)).map((t) => itemOfTask(s, t)).sort((x, y) => (y.day + y.time).localeCompare(x.day + x.time));
  const lastRun = past.find((x) => x.run);
  const next = ghosts(s, a.worldId, Array.from({ length: 14 }, (_, i) => addDays(today(), i))).find((g) => g.a.id === a.id && (g.day > today() || g.slot > new Date().toTimeString().slice(0, 5)));
  const waiting = past.filter((x) => x.run?.status === "ready").length;
  const failed = past.filter((x) => x.run?.status === "failed" || (!x.run && x.day < today() && x.task?.status !== "done")).length;
  const picked = [...items, ...past].find((x) => x.key === sel);
  const dl = (d: string) => (d === today() ? "Today" : d === addDays(today(), -1) ? "Yesterday" : d === addDays(today(), 1) ? "Tomorrow" : `${dayShort(d)} ${dayNum(d)}`);
  const stTxt: Record<string, string> = { ghost: "Up next", plan: "Not ready", working: "Preparing", ready: "Awaiting approval", approved: "Approved", posted: "Shared", failed: "Error" };
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className={`modal autoview ${paused ? "is-paused" : ""}`} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} style={{ ["--w" as string]: w.color }}>
        <header className="avhead">
          <span className="avicon">{plats.length ? <BrandIcon platform={plats[0]} size={20} /> : <Repeat size={20} />}</span>
          <div className="avtitle">
            <h2>{a.title}<HowItWorks flow={flow} /></h2>
            <p>Automation · {w.name}{p ? <> › <button className="link" onClick={goProject}>{p.name}</button></> : null}</p>
          </div>
          <button className={`switch ${paused ? "" : "on"}`} onClick={toggle} role="switch" aria-checked={!paused}><span className="knob" />{paused ? "Paused" : "Running"}</button>
          <button className="btn sm" onClick={() => { onClose(); openAutoForm({ id: a.id }); }}><Pencil size={13} />Edit settings</button>
          <button className="x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="avbody">
          <div className="avhealth">
            <div><em>Last run</em><b>{lastRun ? `${dl(lastRun.day)} ${lastRun.time}` : "None yet"}</b><span>{lastRun?.run ? stTxt[stOf(lastRun)] : ""}</span></div>
            <div><em>Next</em><b>{paused ? "Paused" : next ? `${dl(next.day)} ${next.slot}` : "No plan"}</b><span>{next ? topicOf(s, a, next.day, next.slot)?.title ?? "No topic" : ""}</span></div>
            <div className={waiting ? "is-you" : ""}><em>Waiting</em><b>{waiting ? `${waiting} awaiting your approval` : "None"}</b><span>{waiting ? "In the Tasks tab" : ""}</span></div>
            <div className={failed ? "is-bad" : ""}><em>Errors or missed</em><b>{failed || "None"}</b><span>{failed ? "In the Tasks tab" : ""}</span></div>
          </div>
          <nav className="seg avtabs" role="tablist">
            {([["plan", "Tasks"], ["setup", "Settings and sources"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
          </nav>
          {/* Sekme içeriği sabit yükseklikte kayar: sekme değişince pencere boyu oynamaz. */}
          <div className="avpanel">
          {/* Sıradakiler: önümüzdeki iki haftanın gönderileri, Geçmiş ile aynı satırlar. Haftalık takvim Gönderiler'de (bu otomasyonun çipi). */}
          {/* İşler: projedeki Otomasyonlar kartıyla aynı görünüm (Sırada · Hazırlanan · Tamamlanan, toplu hazırlatma). */}
          {tab === "plan" && <AutoRuns ctx={ctx} autos={[a]} single />}
          {tab === "setup" && <>
          {/* 2. Neye bağlı / Ne üretir: iki kutu yan yana. */}
          <div className="avduo">
            <section className="avbox">
              <h3>Draws on</h3>
              <dl className="avdl">
                <div><dt>Project</dt><dd>{p ? <button className="link" onClick={goProject}>{w.name} › {p.name}</button> : "No project"}</dd></div>
                <div><dt>Account</dt><dd>{acc ? <><BrandIcon platform={acc.platform} size={13} />{acc.handle || acc.name}</> : "No account"}</dd></div>
                <div className={brand ? "" : "is-off"}><dt>Brand voice</dt><dd>{brand ? "Follows the project's" : "None in the project"}</dd></div>
                <div className={media ? "" : "is-off"}><dt>Media</dt><dd>{media ? `${media} ${media === 1 ? "folder" : "folders"}` : "No folder linked"}</dd></div>
                <div className={notes ? "" : "is-off"}><dt>Sources</dt><dd>{notes ? `${notes} ${notes === 1 ? "note" : "notes"}` : "No notes"}</dd></div>
              </dl>
              {p && <button className="link avgo" onClick={goProject}>Edit in project<ChevronRight size={13} /></button>}
            </section>
            <section className="avbox">
              <h3>What it makes</h3>
              <dl className="avdl">
                <div><dt>Output</dt><dd>{fmt ? FORMATS[fmt].label : OUTPUT_LABEL[out]}</dd></div>
                <div><dt>Attachment</dt><dd>{att === "image" ? "Image" : att === "video" ? "Video" : "Text only"}</dd></div>
                <div><dt>Language</dt><dd>{acc ? (
                  <span className="seg avlang" role="radiogroup" aria-label="Account language">
                    {LANGS.map((l) => (
                      <button key={l.id} type="button" role="radio" aria-checked={langId === l.id} className={langId === l.id ? "on" : ""} onClick={() => setLang(l.id)}>{l.id === "tr+en" ? "TR + EN" : langName(l.id)}</button>
                    ))}
                  </span>
                ) : lang}</dd></div>
                <div><dt>Frequency</dt><dd>{scheduleText(a)}{slotsOf(a).filter(Boolean).length > 1 ? ` · ${slotsOf(a).filter(Boolean).length} a day` : ""}</dd></div>
              </dl>
              {last && <p className="avlast"><em>Last output</em>{last.body.slice(0, 160)}{last.body.length > 160 ? "…" : ""}</p>}
            </section>
          </div>

          {a.who !== "me" && (
            <section className="avsec">
              <h3>Instruction<span>Rou follows it in every post</span></h3>
              {a.action ? <p className={`avaction ${full ? "is-open" : ""}`} onClick={() => setFull(!full)}>{a.action}</p> : <p className="muted">No instruction. Write what to share in Edit settings.</p>}
              {a.action && a.action.length > 280 && <button className="link" onClick={() => setFull(!full)}>{full ? "Show less" : "Show all"}</button>}
            </section>
          )}
          {a.who !== "me" && rules.length > 0 && (
            <section className="avsec">
              <h3>Visual rules<span>Kept from your revisions; every visual follows them</span></h3>
              <ul className="avrules">{rules.map((x, i) => <li key={i}><p>{x}</p><button type="button" className="link" onClick={() => dropRule(i)}>Remove</button></li>)}</ul>
            </section>
          )}
          </>}
          </div>
        </div>
        {picked && <PickedPost key={picked.key} ctx={ctx} it={picked} onClose={() => setSel(null)} />}
      </motion.div>
    </div>
  );
}
