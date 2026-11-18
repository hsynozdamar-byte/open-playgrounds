import { useState } from "react";
import { Repeat, Settings2 } from "lucide-react";
import type { Automation } from "../types";
import type { Ctx } from "../lib";
import { scheduleText } from "../../shared/repeat.mjs";
import { platformsOf } from "../../shared/stages.mjs";
import { BrandIcon } from "./BrandIcon";
import { AutoRuns } from "./AutoRuns";
import { openAutoView } from "./openAuto";
import { SeriesDot } from "./Auto";

// Projenin otomasyonları (2026-11-01, sadeleştirildi): tek otomasyonda süzgeç yok, başlıkta adı, saati ve ayar düğmesi;
// birden çoksa Tümü + her otomasyon çipi (çipin ayar simgesi o otomasyonu açar). Altında işleri (AutoRuns).
// Otomasyon kurma sol sütunda (Oluştur).
export function ProjectAutomations({ ctx, projectId }: { ctx: Ctx; worldId: string; projectId: string }) {
  const s = ctx.state;
  const all = s.automations.filter((a) => a.projectId === projectId);
  const [only, setOnly] = useState<string | null>(null);
  if (!all.length) return null;
  const one = all.length === 1 ? all[0] : null;
  const picked = one ?? all.find((a) => a.id === only);
  const autos = picked ? [picked] : all;
  const icon = (a: Automation) => { const p = platformsOf(s, a)[0]; return p ? <BrandIcon platform={p} size={15} /> : <Repeat size={14} />; };
  return (
    <section className="card kbcard pautos2">
      <div className="cardhead"><Repeat size={15} className="hicon" /><h3>Otomasyonlar</h3><span className="n">{all.length}</span></div>
      {/* Her otomasyon bir çip: adı, saati, ayar simgesi. Birden çoksa çipe basınca işler o otomasyona daralır (Tümü ile geri). */}
      <nav className="pafilter" aria-label="Otomasyonlar">
        {!one && <button className={only ? "" : "on"} onClick={() => setOnly(null)}>Tümü</button>}
        {all.map((a) => (
          <span key={a.id} className={`pachip ${!one && only === a.id ? "on" : ""} ${one ? "is-one" : ""} ${a.status !== "active" ? "is-paused" : ""}`}>
            <button onClick={() => (one ? openAutoView(a.id) : setOnly(only === a.id ? null : a.id))}>{icon(a)}<SeriesDot color={a.color} /><b>{a.title}</b><span>{a.status !== "active" ? "Durdu" : scheduleText(a)}</span></button>
            <button className="paset" onClick={() => openAutoView(a.id)} aria-label={`${a.title} ayarları`} title="Otomasyonu aç"><Settings2 size={14} /></button>
          </span>
        ))}
      </nav>
      <AutoRuns ctx={ctx} autos={autos} single={autos.length === 1} />
    </section>
  );
}
