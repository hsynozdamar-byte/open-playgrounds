import { RouOrb, rouTones } from "./fluid/FluidOrb";
import { RouWander } from "./RouWander";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Brain, Check, Loader2, Mic, PanelLeftClose, PanelLeftOpen, Paperclip, Pencil, Plus, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import type { Att, Notice, Rou as RouDef, Talk } from "../types";
import { NoticeCtas, markRead } from "./Notices";
import { KIND_LINE, freshNotices } from "../../shared/notices.mjs";
import { AttChips, MsgFiles, type Pending, uploadFile, useVoice } from "./RouAttach";
import { type Ctx, ALL, blocksOf, inLens, worldOf } from "../lib";
import { addDays, hm, relDay, today } from "../date";
import { RunCard, readyRuns } from "./Auto";
import { StatusMark } from "./StatusMark";
import { type RouAction, apply, describe, planSteps, runsAtOnce } from "./rouActions";
import { uid } from "../store";
import { toast } from "./Toast";
import { UPDATE_READY, hasDraft } from "./Update";
import { DEFAULT_ROU, ROU_COLORS, chatOf, memoryOf, migrateRous, newRou, rouOf, rousOf, setChat } from "../../shared/rou.mjs";

// Rou: Playgrounds'un asistanı. Siyah yumuşak gövde, iki beyaz göz (bebeksiz): kırpar, imleci izler, düşünürken etrafa bakar.
type Mood = "idle" | "think" | "happy";

// Gözler imlece bakar: tüm Rou'lar tek bir dinleyiciyi paylaşır.
const lookers = new Set<(x: number, y: number) => void>();
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  let raf = 0;
  addEventListener("pointermove", (e) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => lookers.forEach((f) => f(e.clientX, e.clientY)));
  });
}

// color: Rou'nun rengi (boşsa siyah).
// lively: yalnız üst çubuktaki Rou zıplar, sıkışır, yoğrulur. Sohbetteki Rou'lar durgun; yalnız gözleri canlı.
// Rou: koyu yumuşak gövde, başında kendi renginde akan ışıklı kubbe (renk seçilmemişse neon limon); gözler aynı renkte ışır.
const ROU_BODY = "#c9f5d6";
export function RouMascot({ size = 32, mood = "idle", color = "", lively = false }: { size?: number; mood?: Mood; color?: string; lively?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const fig = Math.round(size * (size <= 44 ? 1.08 : 1));
  useEffect(() => {
    listen();
    const f = (x: number, y: number) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 240);
      el.style.setProperty("--lx", ((dx / d) * k).toFixed(3));
      el.style.setProperty("--ly", ((dy / d) * k).toFixed(3));
    };
    lookers.add(f);
    return () => void lookers.delete(f);
  }, []);
  return (
    <span ref={ref} className={`rou is-${mood}${color ? " is-tint" : ""}${lively ? " is-lively" : ""}`} style={{ ["--s" as string]: `${size}px`, ["--rc" as string]: color || ROU_BODY }} aria-hidden>
      {/* Küçük Rou'da karakter kutudan taşar: ince, uzun gövde 28-40 px'te de okunur */}
      <span className="rou-fig" style={{ ["--s" as string]: `${fig}px`, left: (size - fig) / 2, top: (size - fig) * 0.62 }}>
      <span className="rou-body"><RouOrb size="100%" colors={color ? rouTones(color) : undefined} state={mood === "think" ? "thinking" : mood === "happy" ? "happy" : "idle"} /></span>
      <span className="rou-face">
        <i className="eye" />
        <i className="eye" />
        <i className="mouth" />
      </span>
      </span>
    </span>
  );
}

// ask: Rou açılır ve bu mesajı kendisi gönderir (ör. Defter'deki "Rou düzenlesin").
// "Rou'ya sor": bir işi ya da çıktıyı sohbete iliştirir; kullanıcı onunla ilgili soru yazar, Rou içeriğiyle birlikte görür.
export const askRouAbout = (ref: { taskId?: string; runId?: string }) => dispatchEvent(new CustomEvent("pg-rou-ref", { detail: ref }));
export const openRou = (ask?: string) => dispatchEvent(new CustomEvent("pg-rou", { detail: typeof ask === "string" ? ask : undefined }));

// Üst çubuktaki (mobilde alt çubuktaki) Rou düğmesi.
// waiting: dış öneri kanalında onay bekleyen öneri sayısı.
export function RouButton({ waiting = 0 }: { waiting?: number }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [away, setAway] = useState(false);
  return (
    <button ref={ref} className={`roubtn${away ? " is-away" : ""}`} onClick={() => openRou()} aria-label={waiting ? `Talk to Rou, ${waiting} suggestion${waiting === 1 ? "" : "s"} awaiting approval` : "Talk to Rou"} title="Talk to Rou">
      <RouMascot size={30} lively />
      {waiting > 0 && <span className="roudot" aria-hidden />}
      <span className="name">Rou</span>
      <RouWander home={ref} onAway={setAway} />
    </button>
  );
}

// action: Rou'nun önerdiği iş; act: kullanıcının kararı.
// show: Rou'nun sohbette gösterdiği çıktılar (runId), önizlemeleriyle.
// Sekmeler:
// Onay bekleyen = yalnız şu an Onayla'ya basılabilecek öneriler; onaylanan, vazgeçilen, geçersizleşen ve "Geri al" satırları girmez.
// Değişiklikler = Rou'nun kendi yaptığı işlerin durumu: şimdi çalışan, sırada bekleyen, yapılanlar (Geri al) ve olmayanlar.
type Cat = "all" | "wait" | "change";
const CATS: { id: Cat; label: string }[] = [{ id: "all", label: "Chat" }, { id: "wait", label: "Awaiting approval" }, { id: "change", label: "Changes" }];
const live = (a: RouAction | undefined, act: string | undefined, s: Ctx["state"]) => !!a && !act && a.type !== "undo_change" && !!describe(a, s);
type Msg = { role: "user" | "rou"; text: string; at?: string; error?: boolean; action?: RouAction; act?: "done" | "no"; show?: string[]; files?: Att[] };
const KEY = "pg-rou-chat";
// Kullanıcının adı (Profil, localStorage pg-profile); yoksa "Kullanıcı".
const myName = () => { try { return (JSON.parse(localStorage.getItem("pg-profile") || "{}").name as string)?.trim() || "User"; } catch { return "User"; } };
const CLEARED = "pg-rou-cleared"; // "Yeni sohbet": kanalın bundan önceki mesajları gizlenir
const cleared = () => { try { return localStorage.getItem(CLEARED) ?? ""; } catch { return ""; } };
// Eskiden sohbet tarayıcıda (localStorage) dururdu; ilk açılışta veriye taşınır.
const legacy = (): Msg[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
};
// Sunucu cevap verene kadar bekleyip sayfayı yeniler (en çok ~30 sn); yeniden başlarken açılan boş sayfayı önler.
// Yazılmış ama gönderilmemiş metin varsa sayfa yenilenmez (yazı silinirdi): sağ altta "Güncelleme var" çıkar, kullanıcı ne zaman isterse basar.
async function reloadWhenUp(wait: number) {
  await new Promise((r) => setTimeout(r, wait));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch("/api/backups", { cache: "no-store" })).ok) {
        if (hasDraft()) return dispatchEvent(new Event(UPDATE_READY));
        return location.reload();
      }
    } catch { /* yeniden başlıyor */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}

const STARTERS = ["What's on today?", "Which tasks are late?", "What should I focus on this week?"];

const PICK = "pg-rou-pick"; // seçili Rou (cihazda)
const picked = () => { try { return localStorage.getItem(PICK) ?? DEFAULT_ROU; } catch { return DEFAULT_ROU; } };
const WIDE = "pg-rou-list"; // Rou listesi açık mı (masaüstü; varsayılan kapalı, yalnız maskotlar)

// Rou'nun önerisi onay bekliyor mu: kendi sohbetinde, varsayılan Rou'da dış öneri kanalında da.
const pendingOf = (s: Ctx["state"], id: string) =>
  chatOf(s, id).some((m) => live(m.action as RouAction | undefined, m.act, s)) || (id === DEFAULT_ROU && rouWaiting(s) > 0);
const roleOf = (r: RouDef) => r.persona.trim().split("\n")[0] || (r.id === DEFAULT_ROU ? "Your Playgrounds assistant" : "No instructions");

// Sohbet paneli: solda Rou'lar, sağda seçili Rou'nun sohbeti. Masaüstünde sağ üstte yüzen geniş panel, mobilde alttan açılan sayfa.
export function RouChat({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(picked);
  const [wide, setWide] = useState(() => { try { return localStorage.getItem(WIDE) === "1"; } catch { return false; } });
  const toggleList = () => setWide((w) => { try { localStorage.setItem(WIDE, w ? "0" : "1"); } catch { /* depolama yok */ } return !w; });
  const rous = rousOf(ctx.state);
  const cur = rouOf(ctx.state, pick);
  const choose = (id: string) => {
    setPick(id);
    setView("chat");
    try { localStorage.setItem(PICK, id); } catch { /* depolama yok */ }
  };
  // Sohbet veride (state.chat[rouId]): tarayıcı ve Mac uygulaması aynı geçmişi görür.
  const msgs = chatOf(ctx.state, cur.id) as Msg[];
  const setMsgs = (id: string, fn: (l: Msg[]) => Msg[]) => ctx.mutate((s) => setChat(s, id, (l) => fn(l as Msg[])));
  const since = ctx.state.chatFrom ?? "";
  const [view, setView] = useState<"chat" | "memory" | "edit" | "new">("chat");
  useEffect(() => {
    const old = legacy();
    if (!old.length && !cleared()) return;
    ctx.mutate((s) => {
      if (!chatOf(s, DEFAULT_ROU).length && old.length) setChat(s, DEFAULT_ROU, () => old);
      if (!s.chatFrom && cleared()) s.chatFrom = cleared();
    });
    try { localStorage.removeItem(KEY); localStorage.removeItem(CLEARED); } catch { /* depolama yok */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Sohbet = Rou ile konuşma + (varsayılan Rou'da) dış araçların önerileri, zamana göre.
  const talk = cur.id === DEFAULT_ROU ? (ctx.state.talk ?? []).filter((m) => m.at > since && m.from === "agent") : [];
  // Sistemin geri dönüşleri (paylaşıldı, paylaşılamadı, onay bekliyor...) Rou'nun ağzından, düğmeleriyle (shared/notices.mjs).
  const notices = cur.id === DEFAULT_ROU ? freshNotices(ctx.state.notices).filter((n) => n.at > since) : [];
  const rows: { key: string; at: string; m?: Msg; i?: number; t?: Talk; n?: Notice }[] = [
    ...msgs.map((m, i) => ({ key: `m${i}`, at: m.at ?? "", m, i })),
    ...talk.map((t) => ({ key: t.id, at: t.at, t })),
    ...notices.map((n) => ({ key: `n${n.id}`, at: n.at, n })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  // Sohbet kategorileri (2026-11-04): öneriler çoğalınca bekleyenler, yapılanlar ve kod değişiklikleri ayrı süzülür.
  const [cat, setCat] = useState<Cat>("all");
  const actOf = (r: (typeof rows)[number]) => (r.m?.action ? { a: r.m.action, act: r.m.act } : r.t?.action ? { a: r.t.action as RouAction, act: r.t.act } : null);
  const inCat = (r: (typeof rows)[number], c: Cat) => {
    if (c === "all") return true;
    const x = actOf(r);
    return c === "wait" && !!x && live(x.a, x.act, ctx.state);
  };
  const st = ctx.state;
  const working = st.change && !st.change.done && Date.now() - Date.parse(st.change.at) < 25 * 60 * 1000 ? 1 : 0;
  const counts = { wait: rows.filter((r) => inCat(r, "wait")).length, change: working + (st.changeQueue?.length ?? 0) };
  const hasChanges = counts.change > 0 || !!st.changes?.length;
  const shown = rows.filter((r) => inCat(r, cat));
  // Son bekleyen de onaylanınca sohbete dönülür; boş "Onay bekleyen" ekranında kalınmaz.
  useEffect(() => { if (cat === "wait" && counts.wait === 0) setCat("all"); }, [cat, counts.wait]);
  // Sohbet açıkken görülen bildirimler okundu sayılır (zildeki sayı düşer).
  const unreadHere = notices.filter((n) => !n.read).map((n) => n.id).join(",");
  useEffect(() => { if (open && unreadHere) markRead(ctx, unreadHere.split(",")); }, [open, unreadHere]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => {
    ctx.mutate((s) => {
      setChat(s, cur.id, () => []);
      if (cur.id === DEFAULT_ROU) s.chatFrom = new Date().toISOString();
    });
  };
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // düşünen Rou
  const [mood, setMood] = useState<Mood>("idle");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // Rou bir işi kendisi yaparken: ilerleme o Rou'nun sohbetinde görünür. Derlenmiş uygulamada (Mac) bitince sayfa yenilenir; geliştirmede Vite zaten yeniler.
  // Sunucu kodu değiştiyse sunucu yeniden başlar; sayfa sunucu yeniden cevap verince yenilenir.
  const ch = ctx.state.change;
  const changing = !!ch && !ch.done && Date.now() - Date.parse(ch.at) < 25 * 60 * 1000;
  const saw = useRef<string | null>(null);
  useEffect(() => {
    if (changing) saw.current = ch!.id;
    else if (ch?.done && saw.current === ch.id) {
      saw.current = null;
      // Yalnız arayüz kodu değiştiyse yenilenir; veri ya da sistem işi (kod değişmedi) ekranı yenilemez.
      if (!ch.error && ch.code && !import.meta.env.DEV) void reloadWhenUp(ch.restart ? 1500 : 800);
    }
  }, [changing, ch]);

  const sendRef = useRef<(q: string) => void>(() => {});
  useEffect(() => {
    const h = (e: Event) => {
      const ask = (e as CustomEvent<string | undefined>).detail;
      if (!ask) return setOpen((o) => !o);
      setOpen(true);
      setView("chat");
      setTimeout(() => sendRef.current(ask), 0);
    };
    addEventListener("pg-rou", h);
    return () => removeEventListener("pg-rou", h);
  }, []);
  useEffect(() => { if (open) markRouSeen(); }, [open, ctx.state.talk?.length]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", k);
    setTimeout(() => input.current?.focus(), 60);
    return () => removeEventListener("keydown", k);
  }, [open, cur.id]);
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length, busy, open, talk.length, changing, cur.id]);

  // Ekler: ataç, sürükle-bırak ya da yapıştır. Yüklenirken gönder bekler.
  const [atts, setAtts] = useState<Pending[]>([]);
  const [ref, setRef] = useState<{ taskId?: string; runId?: string } | null>(null);
  useEffect(() => {
    const h = (e: Event) => { setRef((e as CustomEvent<{ taskId?: string; runId?: string }>).detail); setOpen(true); setView("chat"); setTimeout(() => input.current?.focus(), 80); };
    addEventListener("pg-rou-ref", h);
    return () => removeEventListener("pg-rou-ref", h);
  }, []);
  const refRun = ref?.runId ? ctx.state.runs.find((r) => r.id === ref.runId) : undefined;
  const refTask = ctx.state.tasks.find((t) => t.id === (ref?.taskId ?? refRun?.taskId));
  const fileIn = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const addFiles = (files: File[]) => {
    for (const f of files.slice(0, 8)) {
      const key = uid();
      setAtts((l) => [...l, { key, file: "", name: f.name || "image.png", kind: f.type.startsWith("image/") ? "image" : f.type.startsWith("video/") ? "video" : f.type.startsWith("audio/") ? "audio" : "file", up: true, preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined }]);
      void uploadFile(f, f.name || "image.png").then((r) => {
        if ("error" in r) { toast(`${f.name}: ${r.error}`); setAtts((l) => l.filter((x) => x.key !== key)); return; }
        setAtts((l) => l.map((x) => (x.key === key ? { ...x, ...r, up: false } : x)));
      });
    }
  };
  const uploading = atts.some((a) => a.up);
  // Döküm yazma alanına eklenir; kullanıcı bakıp düzeltir, kendisi gönderir.
  const voice = useVoice((v) => { setText((x) => (x.trim() ? `${x.trimEnd()} ${v}` : v)); setTimeout(() => input.current?.focus(), 30); }, (e) => toast(e));

  const send = async (raw: string) => {
    const q = raw.trim();
    const files: Att[] = atts.filter((a) => !a.up && a.file).map(({ file, name, kind }) => ({ file, name, kind }));
    if ((!q && !files.length) || busy || uploading) return;
    const id = cur.id;
    const next = [...msgs.filter((m) => !m.error), { role: "user" as const, text: q, at: new Date().toISOString(), ...(files.length ? { files } : {}), ...(refRun ? { show: [refRun.id] } : {}) }];
    // İliştirilen iş/çıktı: sunucuya giden son mesajın başına içeriğiyle eklenir (sohbette yalnız soru ve kart görünür).
    const me = myName();
    const about = refTask || refRun ? [
      `[${me} is asking about this task: "${refTask?.title ?? refRun?.title}" (task ${refTask?.id ?? "-"}, status ${refTask?.status ?? "-"}${refTask?.who ? `, done by ${refTask.who === "claude" ? "Rou" : me}` : ""})`,
      refTask?.notes ? `Task notes: ${refTask.notes.slice(0, 800)}` : "",
      refRun ? `Output ${refRun.id} (${refRun.status}):\n${(refRun.body ?? "").slice(0, 2500)}` : "",
      "]",
    ].filter(Boolean).join("\n") : "";
    setRef(null);
    setMsgs(id, () => next);
    setText("");
    setAtts([]);
    setBusy(id);
    setMood("think");
    const r = await fetch("/api/rou", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next.map(({ role, text, files }, i) => ({ role, text: i === next.length - 1 && about ? `${about}\n\n${text}` : text, ...(files ? { files } : {}) })), lens: ctx.route.lens, rouId: id }) })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: "Couldn't reach the server" }));
    setBusy(null);
    const at = new Date().toISOString();
    // İstenen iş hemen yapılır; yalnız paylaşma, onaylama gibi işler kartta onay bekler (rouActions runsAtOnce).
    const now = r.ok && r.action && describe(r.action, ctx.state) && runsAtOnce(r.action);
    if (now) apply(r.action, ctx, id);
    setMsgs(id, (m) => [...m, r.ok ? { role: "rou", text: r.text, at, ...(r.action ? { action: r.action } : {}), ...(now ? { act: "done" as const } : {}), ...(r.show?.length ? { show: r.show } : {}) } : { role: "rou", text: `I couldn't answer right now. ${r.error ?? ""}`.trim(), at, error: true }]);
    setMood(r.ok ? "happy" : "idle");
    setTimeout(() => setMood("idle"), 1400);
  };
  sendRef.current = (q) => void send(q);
  const thinking = busy === cur.id;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="rouscrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
          <motion.section
            className={`rouchat ${wide ? "" : "is-narrow"}`}
            role="dialog"
            aria-label="Rou"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <nav className="rlist" aria-label="Rous">
              <div className="rlhead">
                <span>Rous</span>
                <button className="iconbtn" onClick={toggleList} aria-label={wide ? "Collapse list" : "Expand list"} title={wide ? "Collapse list" : "Expand list"} aria-expanded={wide}>{wide ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button>
              </div>
              <ul>
                {rous.map((r) => (
                  <li key={r.id}>
                    <button className={r.id === cur.id ? "is-on" : ""} onClick={() => choose(r.id)} aria-current={r.id === cur.id} title={wide ? undefined : `${r.name}: ${roleOf(r)}`}>
                      <RouMascot size={30} color={r.color} mood={busy === r.id ? "think" : "idle"} />
                      <span className="rlt"><b>{r.name}</b><span>{roleOf(r)}</span></span>
                      {pendingOf(ctx.state, r.id) && <span className="rldot" aria-label="A suggestion is awaiting approval" />}
                    </button>
                  </li>
                ))}
              </ul>
              <button className={`rlnew ${view === "new" ? "is-on" : ""}`} onClick={() => setView("new")} title="New Rou" aria-label="New Rou"><Plus size={16} /><span>New Rou</span></button>
            </nav>
            <div className={`rpane ${drag ? "is-drop" : ""}`}
              onDragOver={(e) => { if ([...e.dataTransfer.types].includes("Files")) (e.preventDefault(), setDrag(true)); }}
              onDragLeave={(e) => e.currentTarget === e.target && setDrag(false)}
              onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDrag(false); addFiles([...e.dataTransfer.files]); }}>
            {view === "new" ? <RouForm ctx={ctx} onDone={(id) => (id ? choose(id) : setView("chat"))} /> : view === "edit" ? <RouForm ctx={ctx} rou={cur} onDone={(id) => (id ? setView("chat") : choose(DEFAULT_ROU))} /> : <>
            <header className="rchead">
              <RouMascot size={36} color={cur.color} mood={thinking ? "think" : mood} lively />
              <div className="rct">
                <b>{cur.name}</b>
                <span>{thinking ? "Thinking…" : view === "memory" ? "Memory" : roleOf(cur)}</span>
              </div>
              <button className={`iconbtn ${view === "memory" ? "is-on" : ""}`} onClick={() => setView(view === "memory" ? "chat" : "memory")} aria-label="Memory" aria-pressed={view === "memory"} title={`${cur.name}'s memory`}><Brain size={16} /></button>
              <button className="iconbtn" onClick={() => setView("edit")} aria-label="Edit" title={`Edit ${cur.name}`}><Pencil size={15} /></button>
              {view === "chat" && rows.length > 0 && (
                <button className="iconbtn" onClick={reset} aria-label="New chat" title="New chat"><RotateCcw size={16} /></button>
              )}
              <button className="iconbtn" onClick={() => setOpen(false)} aria-label="Close" title="Close"><X size={18} /></button>
            </header>

            {view === "memory" ? <MemoryView ctx={ctx} rou={cur} /> : <>
            {(counts.wait > 0 || hasChanges) && (
              <div className="rcats" role="tablist" aria-label="Filter chat">
                {CATS.filter((c) => (c.id !== "change" || hasChanges) && (c.id !== "wait" || counts.wait > 0)).map((c) => (
                  <button key={c.id} role="tab" aria-selected={cat === c.id} className={cat === c.id ? "is-on" : ""} onClick={() => setCat(c.id)}>
                    {c.label}{c.id !== "all" && counts[c.id] > 0 && <span className="rccount">{counts[c.id]}</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="rcbody" ref={list}>
              {cat === "change" ? <ChangeList ctx={ctx} rouId={cur.id} /> : rows.length === 0 ? (
                <>
                  <div className="rchello">
                    <RouMascot size={64} color={cur.color} mood={mood} lively />
                    <b>Hi, I'm {cur.name}.</b>
                    <p>{cur.persona.trim() || "Your next tasks and automation outputs are here. Ask, or give me a job: start, add, move, set up an automation, prepare, remember."}</p>
                  </div>
                  <Briefing ctx={ctx} onOpen={() => setOpen(false)} />
                  <div className="rcstart">
                    {[...STARTERS, ...(ctx.state.runs.some((r) => r.post) ? ["Show recent posts"] : [])].map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
                  </div>
                </>
              ) : (
                shown.map((row) => row.n ? (
                  <motion.div key={row.key} className="rmwrap rou" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                    <span className="rmwho">{cur.name}</span>
                    <div className="rmsg rou rnotice"><b>{row.n.title}: {KIND_LINE[row.n.kind].toLocaleLowerCase()}.</b>{row.n.text ? ` ${row.n.text}` : ""}</div>
                    <NoticeCtas ctx={ctx} n={row.n} close={() => setOpen(false)} />
                  </motion.div>
                ) : row.t ? (
                  <motion.div key={row.key} className="rmwrap rou" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                    <span className="rmwho">{row.t.from === "agent" ? row.t.name || "Tool" : cur.name}</span>
                    <div className="rmsg rou">{row.t.text}</div>
                    {row.t.show && <Shown ids={row.t.show} ctx={ctx} />}
                    {row.t.action && (
                      <ActionCard
                        a={row.t.action as RouAction}
                        act={row.t.act}
                        ctx={ctx}
                        rouId={cur.id}
                        onAct={(act) => ctx.mutate((s) => { const x = s.talk?.find((y) => y.id === row.t!.id); if (x) x.act = act; })}
                      />
                    )}
                  </motion.div>
                ) : row.m && (
                  <motion.div key={row.key} className={`rmwrap ${row.m.role}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                    {row.m.files?.length ? <MsgFiles files={row.m.files} /> : null}
                    {(row.m.text || !row.m.files?.length) && <div className={`rmsg ${row.m.role} ${row.m.error ? "is-error" : ""}`}>{bold(row.m.text)}</div>}
                    {row.m.show && <Shown ids={row.m.show} ctx={ctx} />}
                    {row.m.action && (
                      <ActionCard
                        a={row.m.action}
                        act={row.m.act}
                        ctx={ctx}
                        rouId={cur.id}
                        onAct={(act) => setMsgs(cur.id, (list) => list.map((x, j) => (j === row.i ? { ...x, act } : x)))}
                      />
                    )}
                  </motion.div>
                ))
              )}
              {thinking && <div className="rmsg rou typing" aria-label={`${cur.name} is typing`}><i /><i /><i /></div>}
              {changing && (ch!.rouId ?? DEFAULT_ROU) === cur.id && <ChangeLine phase={ch!.phase} text={ch!.text} />}
            </div>

            {(refTask || refRun) && (
              <div className="rcref">
                <span><b>About this task</b>{refTask?.title ?? refRun?.title}</span>
                <button type="button" className="iconbtn" onClick={() => setRef(null)} aria-label="Remove attachment"><X size={14} /></button>
              </div>
            )}
            <AttChips list={atts} onRemove={(k) => setAtts((l) => l.filter((x) => x.key !== k))} />
            <form className="rcinput" onSubmit={(e) => (e.preventDefault(), send(text))}>
              <input ref={fileIn} type="file" multiple hidden accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json" onChange={(e) => (addFiles([...(e.target.files ?? [])]), (e.target.value = ""))} />
              <button type="button" className="iconbtn rcattach" onClick={() => fileIn.current?.click()} aria-label="Add file" title="Add an image, video, audio or document"><Paperclip size={17} /></button>
              <textarea
                ref={input}
                rows={1}
                value={text}
                placeholder={voice.state === "rec" ? `Listening… ${voice.sec} s. ✓ when done, × to cancel.` : voice.state === "busy" ? "Transcribing…" : cur.name === "Rou" ? "Ask Rou…" : "Ask or give a task…"}
                onChange={(e) => setText(e.target.value)}
                onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) (e.preventDefault(), addFiles(f)); }}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send(text))}
              />
              {voice.state === "rec" ? (
                <>
                  <span className="rcrec" aria-live="polite"><i />{Math.floor(voice.sec / 60)}:{String(voice.sec % 60).padStart(2, "0")}</span>
                  <button type="button" className="iconbtn rccancel" onClick={voice.cancel} aria-label="Discard recording" title="Discard recording"><X size={16} /></button>
                  <button type="button" className="btn rcsend rcmic is-rec" onClick={voice.finish} aria-label="Finish recording" title="Finish and transcribe"><Check size={16} /></button>
                </>
              ) : (
                <button type="button" className="iconbtn rcmic" onClick={voice.start} disabled={voice.state === "busy"} aria-label="Dictate" title="Dictate">
                  {voice.state === "busy" ? <Loader2 size={16} className="spin" /> : <Mic size={17} />}
                </button>
              )}
              <button className="btn primary rcsend" disabled={!!busy || uploading || voice.state !== "idle" || (!text.trim() && !atts.length)} aria-label="Send"><ArrowUp size={16} /></button>
            </form>
            </>}
            </>}
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}

// Yeni Rou ya da düzenleme: ad, renk, görev talimatı. Varsayılan Rou silinmez.
// onDone(id): kaydedildi (id) ya da silindi/vazgeçildi (undefined).
function RouForm({ ctx, rou, onDone }: { ctx: Ctx; rou?: RouDef; onDone: (id?: string) => void }) {
  const [name, setName] = useState(rou?.name ?? "");
  const [color, setColor] = useState(rou?.color ?? ROU_COLORS[1]);
  const [persona, setPersona] = useState(rou?.persona ?? "");
  const save = () => {
    if (!name.trim()) return;
    if (rou) {
      ctx.mutate((s) => {
        migrateRous(s);
        const r = s.rous!.find((x) => x.id === rou.id);
        if (r) Object.assign(r, { name: name.trim().slice(0, 40), color, persona: persona.trim().slice(0, 2000) });
      });
      return onDone(rou.id);
    }
    const r = newRou(name, color, persona);
    ctx.mutate((s) => (migrateRous(s), void s.rous!.push(r)));
    onDone(r.id);
  };
  // Silinen Rou sohbeti ve kendi hafızasıyla gider; bildirimden geri gelir.
  const remove = () => {
    if (!rou) return;
    const i = ctx.state.rous?.findIndex((x) => x.id === rou.id) ?? -1;
    const chat = chatOf(ctx.state, rou.id);
    const mems = (ctx.state.memory ?? []).filter((m) => m.rouId === rou.id);
    ctx.mutate((s) => {
      s.rous = s.rous?.filter((x) => x.id !== rou.id);
      if (s.chat && !Array.isArray(s.chat)) delete s.chat[rou.id];
      s.memory = s.memory?.filter((m) => m.rouId !== rou.id);
    });
    onDone();
    toast(`${rou.name} deleted`, () => ctx.mutate((s) => {
      if (s.rous?.some((x) => x.id === rou.id)) return;
      (s.rous ??= []).splice(Math.max(1, Math.min(i, s.rous.length)), 0, rou);
      setChat(s, rou.id, () => chat);
      (s.memory ??= []).push(...mems);
    }));
  };
  return (
    <form className="rform" onSubmit={(e) => (e.preventDefault(), save())}>
      <header className="rchead">
        <RouMascot size={36} color={color} />
        <div className="rct">
          <b>{rou ? `Edit ${rou.name}` : "New Rou"}</b>
          <span>Name, color and instructions</span>
        </div>
        <button type="button" className="iconbtn" onClick={() => onDone(rou?.id)} aria-label="Cancel" title="Cancel"><X size={18} /></button>
      </header>
      <div className="rcbody">
        <label className="rffield">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="E.g. Research Rou" maxLength={40} autoFocus />
        </label>
        <div className="rffield">
          <span>Color</span>
          <div className="rfcolors" role="radiogroup" aria-label="Color">
            {ROU_COLORS.map((c) => (
              <button key={c || "black"} type="button" role="radio" aria-checked={color === c} aria-label={c || "Black"} className={color === c ? "is-on" : ""} onClick={() => setColor(c)}>
                <RouMascot size={28} color={c} />
              </button>
            ))}
          </div>
        </div>
        <label className="rffield">
          <span>Instructions</span>
          <textarea rows={6} value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="E.g. You handle my research: find sources, read them and write short summaries. You keep it short and clear." maxLength={2000} />
        </label>
      </div>
      <div className="rcinput rfbtns">
        {rou && rou.id !== DEFAULT_ROU && <button type="button" className="btn ghost danger" onClick={remove}><Trash2 size={14} />Delete</button>}
        <span className="rfgrow" />
        <button type="button" className="btn ghost" onClick={() => onDone(rou?.id)}>Cancel</button>
        <button className="btn primary" disabled={!name.trim()}>{rou ? "Save" : "Add"}</button>
      </div>
    </form>
  );
}

// Rou'nun özeti: modele sormadan, veriden. Sıradaki işler (bugün + 7 gün, saatiyle) ve onay bekleyen otomasyon çıktıları.
function Briefing({ ctx, onOpen }: { ctx: Ctx; onOpen: () => void }) {
  const s = ctx.state;
  const lens = ctx.route.lens;
  const t = today(), end = addDays(t, 7);
  const firstBlock = (id: string) => blocksOf(s, id).find((b) => b.start.slice(0, 10) >= t);
  const next = s.tasks
    .filter(inLens(lens))
    .filter((x) => x.status !== "done" && x.day && x.day >= t && x.day <= end)
    .map((x) => ({ x, b: firstBlock(x.id) }))
    .sort((a, b) => (a.x.day! + (a.b ? hm(a.b.start) : "99")).localeCompare(b.x.day! + (b.b ? hm(b.b.start) : "99")))
    .slice(0, 6);
  const runs = readyRuns(s, lens).filter((r) => r.status === "ready").slice(0, 3);
  const go = (id: string) => (ctx.open(id), onOpen());
  return (
    <div className="rbrief">
      <section>
        <h4>Up next{lens !== ALL && <em> · {worldOf(s, lens).name}</em>}</h4>
        {next.length === 0 ? (
          <p className="rbempty">No tasks planned for the next 7 days.</p>
        ) : (
          <ul>
            {next.map(({ x, b }) => (
              <li key={x.id} style={{ ["--w" as string]: worldOf(s, x.worldId).color }}>
                <button onClick={() => go(x.id)}>
                  <StatusMark status={x.status} />
                  <span className="t">{x.title}</span>
                  <span className="d">{relDay(x.day!)}{b ? ` ${hm(b.start)}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {runs.length > 0 && (
        <section>
          <h4>Automation outputs<em> · awaiting approval</em></h4>
          <div className="rbruns">{runs.map((r) => <RunCard key={r.id} r={r} ctx={ctx} withSource />)}</div>
        </section>
      )}
    </div>
  );
}

// Rou'nun gösterdiği çıktılar: veride hâlâ varsa önizlemeyle.
function Shown({ ids, ctx }: { ids: string[]; ctx: Ctx }) {
  const runs = ids.map((id) => ctx.state.runs.find((r) => r.id === id)).filter((r) => !!r);
  if (!runs.length) return null;
  return <div className="rbruns rshow">{runs.map((r) => <RunCard key={r.id} r={r} ctx={ctx} withSource />)}</div>;
}

// Rou'nun cevaplarında **kalın** yazı yıldızlarıyla görünmesin (değişiklik raporları markdown yazıyor).
const bold = (t: string) => t.split(/\*\*(.+?)\*\*/g).map((x, i) => (i % 2 ? <b key={i}>{x}</b> : x));

// Rou'nun kendi yaptığı işler: şimdi çalışan, sırada bekleyen, yapılanlar. Geri al yalnız kod değişikliğinde (sha) var.
const when = (at: string) => {
  const d = new Date(at), t = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString("en-US", { day: "numeric", month: "short" })} ${t}`;
};
// Kayıtta Rou'ya giden talimatın tamamı durur; listede ilk cümlesi (numaralı adımlardan önce) yeter.
// Sohbette süren iş: tek satır (aşama + işin kısa adı); talimatın tamamı "Ayrıntı" ile açılır.
function ChangeLine({ phase, text }: { phase: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rmsg rou rchange${open ? " is-open" : ""}`}>
      <RefreshCw size={13} className="spin" />
      <span className="rchange-t"><b>{phase}…</b> {open ? text : short(text)}</span>
      <button type="button" className="rchange-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Close" : "Details"}</button>
    </div>
  );
}

const short = (t: string) => { const x = t.replace(/\s+/g, " ").trim(); return (x.match(/^.{12,}?[.!?](?=\s|$)/)?.[0] ?? x).replace(/\s*\d\)$/, ""); };
function ChangeList({ ctx, rouId }: { ctx: Ctx; rouId: string }) {
  const s = ctx.state;
  const [sure, setSure] = useState<string | null>(null);
  const ch = s.change && !s.change.done && Date.now() - Date.parse(s.change.at) < 25 * 60 * 1000 ? s.change : null;
  const queue = s.changeQueue ?? [];
  const past = (s.changes ?? []).filter((c) => c.id !== ch?.id).slice(0, 20);
  if (!ch && !queue.length && !past.length) return <p className="rcempty">Rou hasn't made any changes yet.</p>;
  return (
    <div className="rchg">
      {ch && (
        <section>
          <h4>Now</h4>
          <div className="rchrow is-run">
            <Loader2 size={15} className="spin" />
            <div><p>{short(ch.text)}</p><span>{ch.waiting ? "Another unfinished job is in the code; this starts once that is saved" : ch.phase}</span></div>
          </div>
        </section>
      )}
      {queue.length > 0 && (
        <section>
          <h4>Up next</h4>
          {queue.map((q, i) => (
            <div key={q.id} className="rchrow">
              <span className="rchn">{i + 1}</span>
              <div><p>{short(q.text)}</p><span>Approved: {when(q.at)}{q.tries ? " · starts when the code job is done" : ""}</span></div>
            </div>
          ))}
        </section>
      )}
      {past.length > 0 && (
        <section>
          <h4>History</h4>
          {past.map((c) => (
            <div key={c.id} className={`rchrow ${c.error ? "is-fail" : c.undone ? "is-undone" : ""}`}>
              {c.error ? <X size={15} /> : c.undone ? <RotateCcw size={15} /> : <Check size={15} />}
              <div>
                <p>{short(c.text)}</p>
                {sure === c.id ? (
                  <span className="rchundo">Remove this change?
                    <button className="btn sm ghost" onClick={() => setSure(null)}>Cancel</button>
                    <button className="btn sm danger" onClick={() => (apply({ type: "undo_change", changeId: c.id }, ctx, rouId), setSure(null))}>Yes, undo</button>
                  </span>
                ) : (
                  <span className="rchmeta">{when(c.at)} · {c.error ? `Failed: ${c.error}` : c.undone ? "Undone" : "Done"}
                    {c.sha && !c.undone && !c.error && <> · <button className="link" onClick={() => setSure(c.id)}>Undo</button></>}
                  </span>
                )}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// Rou'nun önerdiği iş: Onayla'ya basılınca uygulanır. Veriyle uyuşmayan öneri kart olarak çıkmaz.
function ActionCard({ a, act, ctx, rouId, onAct }: { a: RouAction; act?: "done" | "no"; ctx: Ctx; rouId: string; onAct: (x: "done" | "no") => void }) {
  const d = describe(a, ctx.state);
  if (!d && !act) return <div className="ract is-void">This suggestion no longer applies.</div>;
  if (!d) return null;
  // Geri al bir onay isteği değil: değişiklik zaten yapıldı. Ayrı, sakin bir satır olarak durur ve bir kez daha sorar.
  if (a.type === "undo_change") return <UndoCard ctx={ctx} a={a} rouId={rouId} act={act} onAct={onAct} />;
  if (a.type === "plan") return <PlanCard ctx={ctx} a={a} rouId={rouId} act={act} onAct={onAct} title={d.what} />;
  return (
    <div className={`ract ${act ? `is-${act}` : ""}`}>
      <div className="rat">
        <span className="verb">{d.verb}</span>
        <b>{d.what}</b>
        {d.detail && <span className="det">{d.detail}</span>}
      </div>
      {act ? (
        <span className="rastate">{act === "done" ? <><Check size={14} />Done</> : "Dismissed"}</span>
      ) : (
        <div className="rabtns">
          <button className="btn sm ghost" onClick={() => onAct("no")}>Cancel</button>
          <button className="btn sm primary" onClick={() => (apply(a, ctx, rouId), onAct("done"))}><Check size={14} />Approve</button>
        </div>
      )}
    </div>
  );
}

// Toplu öneri: her adım ayrı satır, kutusundan açılıp kapanır. Seçilmeyen bir adıma bağlı adım (ör. açılmayacak projeye iş) kendiliğinden pasifleşir.
function PlanCard({ a, act, ctx, rouId, onAct, title }: { a: Extract<RouAction, { type: "plan" }>; act?: "done" | "no"; ctx: Ctx; rouId: string; onAct: (x: "done" | "no") => void; title: string }) {
  const all = planSteps(a, ctx.state);
  const valid = all.filter((x) => x.d).map((x) => x.i);
  const [picked, setPicked] = useState(() => new Set(valid));
  const rows = planSteps(a, ctx.state, picked);
  const n = rows.filter((x) => x.d && picked.has(x.i)).length;
  const flip = (i: number) => setPicked((p) => { const q = new Set(p); if (q.has(i)) q.delete(i); else q.add(i); return q; });
  const dropped = all.length - valid.length;
  if (act) return (
    <div className={`ract rplan is-${act}`}>
      <div className="rat"><span className="verb">Batch</span><b>{title}</b></div>
      <span className="rastate">{act === "done" ? <><Check size={14} />Done</> : "Dismissed"}</span>
    </div>
  );
  return (
    <div className="ract rplan">
      <div className="rat"><span className="verb">Batch · {valid.length} step{valid.length === 1 ? "" : "s"}</span><b>{title}</b></div>
      <ul className="rpsteps">
        {all.filter((x) => x.d).map(({ i, d }) => {
          const ok = !!rows[i].d;
          const on = ok && picked.has(i);
          return (
            <li key={i} className={`${on ? "on" : ""} ${ok ? "" : "is-off"}`}>
              <button type="button" role="checkbox" aria-checked={on} disabled={!ok} onClick={() => flip(i)}>
                <span className="rpbox">{on && <Check size={12} strokeWidth={3} />}</span>
                <span className="rptext">
                  <span className="rpverb">{d!.verb}</span>
                  <b>{d!.what}</b>
                  {ok ? d!.detail && <span className="det">{d!.detail}</span> : <span className="det">The step it depends on isn't picked</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {dropped > 0 && <span className="rpnote">{dropped} suggestion{dropped === 1 ? " was" : "s were"} left out because {dropped === 1 ? "it doesn't" : "they don't"} match the data.</span>}
      <div className="rabtns">
        <button className="btn sm ghost push" onClick={() => setPicked(picked.size ? new Set() : new Set(valid))}>{picked.size ? "None" : "All"}</button>
        <button className="btn sm ghost" onClick={() => onAct("no")}>Cancel</button>
        <button className="btn sm primary" disabled={!n} onClick={() => (apply(a, ctx, rouId, picked), onAct("done"))}><Check size={14} />Do {n} step{n === 1 ? "" : "s"}</button>
      </div>
    </div>
  );
}

function UndoCard({ a, act, ctx, rouId, onAct }: { a: RouAction; act?: "done" | "no"; ctx: Ctx; rouId: string; onAct: (x: "done" | "no") => void }) {
  const [sure, setSure] = useState(false);
  if (act === "done") return <div className="rundo"><span className="muted">This change was undone.</span></div>;
  return (
    <div className="rundo">
      {sure ? (
        <>
          <span>Remove this change?</span>
          <button className="btn sm ghost" onClick={() => setSure(false)}>Cancel</button>
          <button className="btn sm danger" onClick={() => (apply(a, ctx, rouId), onAct("done"))}>Yes, undo</button>
        </>
      ) : (
        <>
          <span className="muted"><Check size={13} />Change applied.</span>
          <button className="link" onClick={() => setSure(true)}>Undo</button>
        </>
      )}
    </div>
  );
}

// Dış öneri kanalında onay bekleyen, hâlâ geçerli öneriler.
// Sohbet temizlendiyse (chatFrom) öncesindeki kartlar görünmez; onlar da bekleyen sayılmaz (nokta boşuna yanıyordu).
export const rouWaiting = (s: Ctx["state"]) => (s.talk ?? []).filter((t) => t.at > (s.chatFrom ?? "") && live(t.action as RouAction | undefined, t.act, s)).length;
// Rou düğmesindeki nokta yalnız görülmemiş öneriler için: sohbet açılınca o ana kadarkiler görüldü sayılır (cihazda).
const SEEN = "pg-rou-seen";
const seenAt = () => { try { return localStorage.getItem(SEEN) ?? ""; } catch { return ""; } };
export const markRouSeen = () => { try { localStorage.setItem(SEEN, new Date().toISOString()); } catch { /* yok */ } dispatchEvent(new Event(SEEN)); };
export function useRouUnseen(s: Ctx["state"]) {
  const [seen, setSeen] = useState(seenAt);
  useEffect(() => { const h = () => setSeen(seenAt()); addEventListener(SEEN, h); return () => removeEventListener(SEEN, h); }, []);
  const chats = Object.values(s.chat ?? {}).flat() as { action?: unknown; act?: unknown; at?: string }[];
  return [...(s.talk ?? []), ...chats].filter((t) => t.action && !t.act && (t.at ?? "") > seen && describe(t.action as RouAction, s)).length;
}

// Rou'nun hafızası: ortak kayıtlar (tüm Rou'lar bilir) + bu Rou'nun kendi kayıtları. Rou önerir (Hatırla kartı) ya da buradan elle eklenir; her biri silinebilir.
function MemoryView({ ctx, rou }: { ctx: Ctx; rou: RouDef }) {
  const list = memoryOf(ctx.state, rou.id);
  const [text, setText] = useState("");
  const [own, setOwn] = useState(false);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    ctx.mutate((s) => void (s.memory ??= []).push({ id: uid(), text: t.slice(0, 300), at: new Date().toISOString(), ...(own ? { rouId: rou.id } : {}) }));
    setText("");
  };
  const remove = (id: string) => {
    const all = ctx.state.memory ?? [];
    const i = all.findIndex((x) => x.id === id);
    const m = all[i];
    ctx.mutate((s) => void (s.memory = (s.memory ?? []).filter((x) => x.id !== id)));
    toast(`${rou.name} forgot this`, () => ctx.mutate((s) => void ((s.memory ??= []).some((x) => x.id === id) || s.memory.splice(Math.min(i, s.memory.length), 0, m))));
  };
  return (
    <>
      <div className="rcbody rmem">
        <p className="rmemhint">{rou.name} remembers these and uses them in answers. Every Rou knows the shared ones; browser jobs also check them when filling in forms.</p>
        {list.length === 0 ? (
          <p className="rbempty">Nothing yet. Say something like "my salary expectation is X, remember it" in the chat, or type it below.</p>
        ) : (
          <ul>
            {list.map((m) => (
              <li key={m.id}>
                <span>{m.text}</span>
                <em className="rmemtag">{m.rouId ? "Only this Rou" : "Shared"}</em>
                <button className="iconbtn" onClick={() => remove(m.id)} aria-label="Forget" title="Forget"><X size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form className="rcinput" onSubmit={(e) => (e.preventDefault(), add())}>
        <textarea rows={1} value={text} placeholder="Something to remember…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), add())} aria-label="Something to remember" />
        <button type="button" className={`rmemscope ${own ? "is-on" : ""}`} onClick={() => setOwn(!own)} aria-pressed={own} title="Only this Rou knows it">{own ? "Only this Rou" : "Shared"}</button>
        <button className="btn primary rcsend" disabled={!text.trim()} aria-label="Add"><Check size={16} /></button>
      </form>
    </>
  );
}
