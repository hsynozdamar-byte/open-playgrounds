import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { openPost } from "./openPost";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { AlertCircle, Bell, CheckCircle2, Clock3, Hand, MessageCircleQuestion, RefreshCw, X, XCircle, type LucideIcon } from "lucide-react";
import type { Ctx } from "../lib";
import type { Notice } from "../types";
import { KIND_LINE, freshNotices, noticeCtas, noticeNow, unreadNotices, type NoticeCta } from "../../shared/notices.mjs";
import { toast } from "./Toast";

// Bildirimler: sistemin geri dönüşleri (shared/notices.mjs). Üst çubukta zil + panel; Rou sohbeti aynı kayıtları gösterir.
// Her bildirimin düğmeleri işin şimdiki durumundan gelir; düğmeye ya da satıra basınca bildirim okundu sayılır.

const ICON: Record<Notice["kind"], [LucideIcon, string]> = {
  posted: [CheckCircle2, "ok"],
  share_failed: [AlertCircle, "bad"],
  handoff: [Hand, "warn"],
  ready: [Clock3, "info"],
  failed: [XCircle, "bad"],
  ask: [MessageCircleQuestion, "warn"],
};

export function ago(at: string) {
  const m = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (m < 1) return "şimdi";
  if (m < 60) return `${m} dk`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} sa`;
  const d = new Date(at);
  return h < 48 ? "dün" : d.toLocaleDateString("tr", { day: "numeric", month: "short" });
}

const post = (url: string, body: object) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Sunucuya ulaşılamadı" }));

export const markRead = (ctx: Ctx, ids: string[]) => ctx.mutate((s) => { for (const n of s.notices ?? []) if (ids.includes(n.id)) n.read = true; });

async function runCta(ctx: Ctx, n: Notice, c: NoticeCta, close?: () => void) {
  markRead(ctx, [n.id]);
  const run = ctx.state.runs.find((r) => r.id === n.runId);
  if (c.id === "view" && run?.postUrl) return void openPost(run);
  if (c.id === "card") { close?.(); return ctx.open(n.taskId ?? run?.taskId ?? null); }
  if (c.id === "folder") { const r = await post("/api/open-share", { runId: n.runId }); if (!r.ok) toast(r.error ?? "Klasör açılamadı"); return; }
  if (c.id === "retry") { const r = await post("/api/share", { runId: n.runId }); toast(r.ok ? "Rou yeniden paylaşıyor" : r.error ?? "Başlatılamadı"); return; }
  if (c.id === "redo") { const r = await post("/api/prepare", { taskId: n.taskId ?? run?.taskId }); toast(r.ok ? "Rou yeniden hazırlıyor" : r.error ?? "Başlatılamadı"); return !!r.ok; }
}

export function NoticeCtas({ ctx, n, close }: { ctx: Ctx; n: Notice; close?: () => void }) {
  // Basınca, sunucudan yeni çıktı gelene kadar da tek basış: düğme hemen "Yeniden hazırlanıyor" olur.
  const [sent, setSent] = useState(false);
  const raw = noticeCtas(ctx.state, n);
  // Sunucu yeni hazırlığı gösterince yerel işaret bırakılır; o hazırlık da düşerse düğme yeniden basılabilir.
  const confirmed = raw.some((c) => c.id === "busy");
  useEffect(() => { if (confirmed) setSent(false); }, [confirmed]);
  const ctas = raw.map((c) => (sent && c.id === "redo" ? ({ id: "busy", label: "Yeniden hazırlanıyor…", busy: true } as NoticeCta) : c));
  if (!ctas.length) return null;
  return (
    <div className="ntctas">
      {ctas.map((c) => c.busy
        ? <button key={c.id} className="btn sm" disabled aria-busy><RefreshCw size={13} className="spin" />{c.label}</button>
        : <button key={c.id} className={`btn sm ${c.primary ? "primary" : ""}`} onClick={async (e) => { e.stopPropagation(); if (c.id === "redo") setSent(true); const ok = await runCta(ctx, n, c, close); if (c.id === "redo" && ok === false) setSent(false); }}>{c.label}</button>)}
    </div>
  );
}

function Row({ ctx, n, close }: { ctx: Ctx; n: Notice; close: () => void }) {
  const [Icon, tone] = ICON[n.kind];
  const now = noticeNow(ctx.state, n);
  const world = ctx.state.worlds.find((w) => w.id === n.worldId);
  return (
    <li className={`ntrow ${n.read ? "" : "is-new"}`} onClick={() => !n.read && markRead(ctx, [n.id])}>
      <span className={`nticon is-${tone}`}><Icon size={17} strokeWidth={2} /></span>
      <div className="ntbody">
        <p className="nttitle"><b>{n.title}</b>{!n.read && <i className="ntdot" aria-label="Okunmadı" />}</p>
        <p className="ntmeta"><span className={`ntkind is-${tone}`}>{KIND_LINE[n.kind]}</span>{world && <><span aria-hidden>·</span><span>{world.name}</span></>}<span aria-hidden>·</span><span>{ago(n.at)}</span></p>
        {n.text && <p className="nttext">{n.text}</p>}
        {now && <p className="ntnow">Şimdi: {now}</p>}
        <NoticeCtas ctx={ctx} n={n} close={close} />
      </div>
    </li>
  );
}

function Panel({ ctx, anchor, onClose }: { ctx: Ctx; anchor: React.RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const list = freshNotices(ctx.state.notices);
  const unread = list.filter((n) => !n.read);
  // Temizle: önce sorar (kaç bildirim, geri alınamaz), ikinci basışta siler.
  const [ask, setAsk] = useState(false);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const vw = innerWidth, mobile = vw <= 640, width = Math.min(420, vw - 32);
      // Mobilde zil alt çubukta: panel onun üstünde açılır.
      if (mobile) return setPos({ top: 16 + (visualViewport?.offsetTop ?? 0), left: 16, width, maxHeight: r.top - 32 });
      const left = Math.max(16, Math.min(r.right - width, vw - 16 - width));
      setPos({ top: r.bottom + 8, left, width, maxHeight: innerHeight - r.bottom - 24 });
    };
    place();
    addEventListener("resize", place);
    return () => removeEventListener("resize", place);
  }, [anchor]);
  useEffect(() => {
    const down = (e: MouseEvent) => !box.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("mousedown", down);
    addEventListener("keydown", key);
    return () => { removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [anchor, onClose]);
  return createPortal(
    <motion.div ref={box} className="ntpop" role="dialog" aria-label="Bildirimler" style={pos ?? { visibility: "hidden" }} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}>
      <div className="nthead">
        <p><b>Bildirimler</b><span>{unread.length ? `${unread.length} okunmamış` : "Hepsi okundu"}</span></p>
        {unread.length > 0 && <button className="btn sm ghost" onClick={() => markRead(ctx, unread.map((n) => n.id))}>Tümünü okundu say</button>}
        {list.length > 0 && !ask && <button className="btn sm ghost" onClick={() => setAsk(true)}>Temizle</button>}
        <button className="x" onClick={onClose} aria-label="Kapat"><X size={16} /></button>
      </div>
      {ask && (
        <div className="ntclear" role="alertdialog" aria-label="Bildirimleri temizle">
          <p><b>{list.length} bildirim silinsin mi?</b><span>Geri alınamaz. Görevler ve gönderiler etkilenmez.</span></p>
          <div>
            <button className="btn sm ghost" onClick={() => setAsk(false)} autoFocus>Vazgeç</button>
            <button className="btn sm danger" onClick={() => { ctx.mutate((s) => void (s.notices = [])); setAsk(false); }}>Sil</button>
          </div>
        </div>
      )}
      <p className="ntkeep">Bildirimler bir hafta sonra kendiliğinden silinir.</p>
      {list.length ? <ul className="ntlist">{list.map((n) => <Row key={n.id} ctx={ctx} n={n} close={onClose} />)}</ul> : <p className="ntempty">Paylaşım, onay ve hazırlık haberleri burada görünür.</p>}
    </motion.div>,
    document.body,
  );
}

export function NoticeBell({ ctx }: { ctx: Ctx }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const n = unreadNotices(ctx.state);
  return (
    <>
      <button ref={ref} className={`ntbell ${open ? "on" : ""}`} onClick={() => setOpen((x) => !x)} aria-label={n ? `Bildirimler, ${n} okunmamış` : "Bildirimler"} title="Bildirimler">
        <Bell size={19} strokeWidth={1.9} />
        {n > 0 && <span className="ntbadge">{n > 9 ? "9+" : n}</span>}
      </button>
      {open && <Panel ctx={ctx} anchor={ref} onClose={() => setOpen(false)} />}
    </>
  );
}
