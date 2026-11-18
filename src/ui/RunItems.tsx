import { useState } from "react";
import { ArrowUpRight, Check, FolderOpen, RefreshCw, Send } from "lucide-react";
import type { Automation, Run } from "../types";
import { toast } from "./Toast";

// Chrome otomasyonunun önerileri: seç, gerekirse soruları cevapla, not ekle; "Seçilenleri yap" ile Claude yapar (server/browse.mjs act).
export function RunItems({ r, auto }: { r: Run; auto?: Automation }) {
  const items = r.items ?? [];
  const [pick, setPick] = useState<Set<string>>(() => new Set(items.filter((x) => x.pick && !x.result?.done).map((x) => x.id)));
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(items.filter((x) => x.answer).map((x) => [x.id, x.answer!])));
  const [note, setNote] = useState(r.act?.note ?? "");
  const [open, setOpen] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const acting = !!r.act?.phase && Date.now() - new Date(r.act.at).getTime() < 60 * 60 * 1000;
  const todo = items.filter((x) => !x.result?.done);
  const chosen = todo.filter((x) => pick.has(x.id));
  const toggle = (id: string) => setPick((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = chosen.length === todo.length;
  const go = async () => {
    setAsk(false);
    const res = await fetch("/api/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: r.id, pick: chosen.map((x) => x.id), note, answers }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Sunucuya ulaşılamadı" }));
    if (!res.ok) toast(res.error ?? "Başlatılamadı");
  };
  const folder = async () => {
    if (!auto) return;
    const res = await fetch("/api/open-folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ autoId: auto.id }) }).then((x) => x.json()).catch(() => ({ ok: false }));
    if (!res.ok) toast("Klasör açılamadı");
  };
  if (!items.length) return null;
  return (
    <div className="ritems">
      <div className="rihead">
        <b>{items.length} öneri{items.some((x) => x.result?.done) ? ` · ${items.filter((x) => x.result?.done).length} yapıldı` : ""}</b>
        {!acting && todo.length > 1 && <button type="button" className="link" onClick={() => setPick(all ? new Set() : new Set(todo.map((x) => x.id)))}>{all ? "Seçimi kaldır" : "Hepsini seç"}</button>}
        {auto && items.some((x) => x.files?.length) && <button type="button" className="link rifolder" onClick={folder}><FolderOpen size={13} />Klasörü aç</button>}
      </div>
      <ul>
        {items.map((x) => {
          const done = !!x.result?.done;
          const on = done || pick.has(x.id);
          return (
            <li key={x.id} className={`${done ? "is-done" : ""} ${!on ? "is-off" : ""}`}>
              {done
                ? <span className="box2 ridone" aria-label="Yapıldı"><Check size={12} /></span>
                : <button type="button" role="checkbox" aria-checked={on} className="box2" disabled={acting} onClick={() => toggle(x.id)} aria-label={x.title}>{on && <Check size={12} />}</button>}
              <div className="ribody">
                <div className="rititle">
                  <b>{x.title}</b>
                  {x.score != null && <span className={`riscore ${x.score >= 75 ? "is-hi" : x.score < 50 ? "is-lo" : ""}`}>%{x.score}</span>}
                </div>
                {x.detail && <p className={open === x.id ? "open" : ""} onClick={() => setOpen(open === x.id ? null : x.id)}>{x.detail}</p>}
                {(x.url || x.files?.length) && (
                  <div className="rilinks">
                    {x.url && <a href={x.url} target="_blank" rel="noreferrer">Aç<ArrowUpRight size={12} /></a>}
                    {x.files?.map((f) => <span key={f} className="rifile">{f.split("/").pop()}</span>)}
                  </div>
                )}
                {x.result && (done
                  ? <p className="riresult is-ok">{x.result.note || "Yapıldı"}{x.result.url && <> · <a href={x.result.url} target="_blank" rel="noreferrer">sonuç</a></>}</p>
                  : <p className="riresult">{x.result.note || "Yapılamadı"}</p>)}
                {!done && x.result?.question && (
                  <label className="riq">
                    <span>{x.result.question}</span>
                    <input value={answers[x.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [x.id]: e.target.value }))} placeholder="Cevabın" disabled={acting} />
                  </label>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {acting ? (
        <p className="riact"><RefreshCw size={13} className="spin" />{r.act!.phase}… Tarayıcıda çalışıyor; Rou'nun sekmesini kapatma.</p>
      ) : todo.length > 0 && (ask ? (
        <div className="delconfirm postconfirm" role="alertdialog" aria-label="Seçilenleri yap">
          <b>{chosen.length} öğe için yapılsın mı?</b>
          <p>Rou tarayıcıda talimattaki işlemi yalnız seçtiklerin için, her biri için bir kez yapar. Cevabını bilmediği bir soru çıkarsa o öğeyi göndermez, sana sorar.</p>
          <div className="bmbtns">
            <button type="button" className="btn sm ghost" onClick={() => setAsk(false)}>Vazgeç</button>
            <button type="button" className="btn sm primary" onClick={go}><Send size={14} />Evet, yap</button>
          </div>
        </div>
      ) : (
        <div className="rifoot">
          <textarea rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Claude'a not (isteğe bağlı)" aria-label="Claude'a not" />
          <button type="button" className="btn sm primary" disabled={!chosen.length || !auto?.browser} onClick={() => setAsk(true)}><Send size={14} />Seçilenleri yap{chosen.length ? ` (${chosen.length})` : ""}</button>
        </div>
      ))}
      {!acting && r.act?.error && <p className="pvissues rperr">{r.act.error}</p>}
    </div>
  );
}
