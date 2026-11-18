import { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { X } from "lucide-react";
import type { Ctx } from "../lib";
import type { Account } from "../types";
import { toast } from "./Toast";

// Hesap analizi (Instagram): Rou hesabın profilini arka planda okuyup Instagram becerilerini uygular (server/insight.mjs).
// Üç bölüm: Profil puanı (ig-profile), Ne işe yarıyor (ig-audit), Haftanın planı (ig-plan). Sonuç hesapta saklanır.
type Kind = "profile" | "audit" | "plan";
const TABS: { id: Kind; label: string; what: string }[] = [
  { id: "profile", label: "Profil puanı", what: "Profili 100 üzerinden puanlar, zayıf yerleri yeniden yazar." },
  { id: "audit", label: "Ne işe yarıyor", what: "Son gönderilerden neyin tuttuğunu, neyin bırakılması gerektiğini çıkarır." },
  { id: "plan", label: "Haftanın planı", what: "Önümüzdeki haftayı biçim, gün ve nedeniyle planlar." },
];

export function InsightButton({ a, onOpen }: { a: Account; onOpen: () => void }) {
  const score = a.insights?.profile?.score;
  return <button className="btn sm insbtn" onClick={onOpen}>{typeof score === "number" ? <><b>{score}</b>/100 · Analiz</> : "Analiz"}</button>;
}

export function InsightView({ ctx, a, onClose }: { ctx: Ctx; a: Account; onClose: () => void }) {
  const [tab, setTab] = useState<Kind>("profile");
  const live = ctx.state.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === a.id) ?? a;
  const r = live.insights?.[tab];
  const run = async () => {
    const res = await fetch("/api/account-insight", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId: a.id, kind: tab }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Sunucuya ulaşılamadı" }));
    if (!res.ok) toast(res.error ?? "Başlatılamadı");
  };
  const t = TABS.find((x) => x.id === tab)!;
  return createPortal(
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="modal insview" role="dialog" aria-label="Hesap analizi" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <header className="inshead">
          <div><h2>Hesap analizi</h2><p>{live.handle || live.name}</p></div>
          <button className="x" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </header>
        <nav className="seg instabs" role="tablist">
          {TABS.map((x) => <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>{x.label}</button>)}
        </nav>
        <div className="inspanel">
          {r?.phase ? <p className="insbusy">{r.phase}… Rou profili arka planda okuyor, birkaç dakika sürebilir.</p> : null}
          {r && !r.phase && r.error ? <p className="pvissues">Yapılamadı: {r.error}</p> : null}
          {r?.summary ? (
            <>
              <div className="inssum">
                {typeof r.score === "number" && <span className="insscore"><b>{r.score}</b><em>/100</em></span>}
                <p>{r.summary}</p>
              </div>
              <ol className="insitems">{(r.items ?? []).map((x, i) => <li key={i}><b>{x.title}</b><p>{x.detail}</p></li>)}</ol>
              <p className="insat">{new Date(r.at).toLocaleString("tr", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · {t.label}</p>
            </>
          ) : !r?.phase && <p className="insempty">{t.what} Rou profili uygulamanın tarayıcısında arka planda açar, yalnız okur.</p>}
        </div>
        <footer className="insfoot">
          <button className="btn primary" disabled={!!r?.phase} onClick={run}>{r?.summary ? "Yeniden analiz et" : "Rou analiz etsin"}</button>
        </footer>
      </motion.div>
    </div>,
    document.body,
  );
}
