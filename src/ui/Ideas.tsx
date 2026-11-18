import { useState } from "react";
import { ExternalLink, Lightbulb, Plus, RefreshCw } from "lucide-react";
import type { Automation } from "../types";
import type { Ctx } from "../lib";
import { addDays, relDay, today } from "../date";
import { occurrenceOf, repeatsOn, slotsOf, topicKey } from "../../shared/repeat.mjs";
import { platformsOf } from "../../shared/stages.mjs";
import { BrandIcon } from "./BrandIcon";
import { toast } from "./Toast";

// Gönderiler › Öneriler: seçili otomasyon için gündemden gönderi fikirleri. Rou gündemi tarayıp çıkarır (server/ideas.mjs).
// "Plana ekle" fikri otomasyonun konusu boş ilk saatine yazar; hazırlık yine saatinden önce Rou'da.
export function Ideas({ ctx, autos, pick }: { ctx: Ctx; autos: Automation[]; pick?: string | null }) {
  const s = ctx.state;
  const list = autos.filter((a) => a.who !== "me");
  const [cur, setCur] = useState<string | null>(null);
  const a = list.find((x) => x.id === (pick ?? cur)) ?? list[0];
  if (!a) return null;
  const live = s.automations.find((x) => x.id === a.id) ?? a;
  const ideas = live.ideas;
  const run = async () => {
    const r = await fetch("/api/post-ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ autoId: a.id }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Sunucuya ulaşılamadı" }));
    if (!r.ok) toast(r.error ?? "Başlatılamadı");
  };
  // Konusu boş ilk saat (14 gün): açılmış ama hazırlanmamış görev ya da henüz açılmamış gün.
  const slot = () => {
    for (let i = 0; i < 14; i++) {
      const day = addDays(today(), i);
      if (!repeatsOn(live, day)) continue;
      for (const sl of slotsOf(live)) {
        const t = occurrenceOf(s, live, day, sl);
        if (t ? !t.topic && !s.runs.some((r) => r.taskId === t.id) : !live.topics?.[topicKey(day, sl)]) return { day, sl, task: t };
      }
    }
    return null;
  };
  const add = (x: { title: string; brief: string }) => {
    const at = slot();
    if (!at) return toast("Önümüzdeki 2 haftada konusu boş saat yok");
    ctx.mutate((st) => {
      const au = st.automations.find((y) => y.id === live.id);
      if (!au) return;
      const t = at.task && st.tasks.find((y) => y.id === at.task!.id);
      if (t) t.topic = { title: x.title, brief: x.brief };
      else au.topics = { ...(au.topics ?? {}), [topicKey(at.day, at.sl)]: { title: x.title, brief: x.brief } };
      if (au.ideas?.items) au.ideas.items = au.ideas.items.filter((y) => y.title !== x.title);
    });
    toast(`${relDay(at.day)}${at.sl ? ` ${at.sl}` : ""} gönderisinin konusu oldu`);
  };
  return (
    <section className="card autodetail studio stideas">
      <div className="cardhead">
        <Lightbulb size={15} className="hicon" /><h3>Öneriler</h3>
        <span className="n">Gündemden gönderi fikirleri</span>
        <button className="btn sm ghost stidrun" disabled={!!ideas?.phase} onClick={run}><RefreshCw size={14} className={ideas?.phase ? "spin" : ""} />{ideas?.items?.length ? "Yenile" : "Öneri getir"}</button>
      </div>
      {!pick && list.length > 1 && (
        <nav className="stprojs" aria-label="Otomasyon">
          {list.map((x) => { const p = platformsOf(s, x)[0]; return <button key={x.id} className={x.id === a.id ? "on" : ""} onClick={() => setCur(x.id)}>{p && <BrandIcon platform={p} size={13} />}{x.title}</button>; })}
        </nav>
      )}
      {ideas?.phase && <p className="insbusy">{ideas.phase}… birkaç dakika sürebilir.</p>}
      {!ideas?.phase && ideas?.error && !ideas.items?.length && <p className="pvissues">Öneri çıkmadı: {ideas.error}</p>}
      {ideas?.items?.length ? (
        <ul className="idgrid">
          {ideas.items.map((x) => (
            <li key={x.title} className="idcard">
              <b>{x.title}</b>
              <p>{x.brief}</p>
              <span className="idwhy">{x.why}</span>
              <div className="idfoot">
                {x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="idsrc" title={x.trend || x.url}><ExternalLink size={12} />{x.trend || "Kaynak"}</a> : x.trend ? <span className="idsrc">{x.trend}</span> : <span />}
                <button className="btn sm" onClick={() => add(x)}><Plus size={13} />Plana ekle</button>
              </div>
            </li>
          ))}
        </ul>
      ) : !ideas?.phase && <p className="insempty">{a.title} için gündemden gönderi fikirleri gelir; beğendiğini plana eklersin.</p>}
    </section>
  );
}
