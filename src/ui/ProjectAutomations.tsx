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

// The project's automations (2026-11-01, simplified): with one automation there is no filter, its name, time and settings button are in the header;
// with several, All + a chip per automation (the chip's settings icon opens that automation). Its tasks below (AutoRuns).
// Setting up an automation is in the left column (Create).
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
      <div className="cardhead"><Repeat size={15} className="hicon" /><h3>Automations</h3><span className="n">{all.length}</span></div>
      {/* Each automation is a chip: name, time, settings icon. With several, pressing a chip narrows the tasks to that automation (All goes back). */}
      <nav className="pafilter" aria-label="Automations">
        {!one && <button className={only ? "" : "on"} onClick={() => setOnly(null)}>All</button>}
        {all.map((a) => (
          <span key={a.id} className={`pachip ${!one && only === a.id ? "on" : ""} ${one ? "is-one" : ""} ${a.status !== "active" ? "is-paused" : ""}`}>
            <button onClick={() => (one ? openAutoView(a.id) : setOnly(only === a.id ? null : a.id))}>{icon(a)}<SeriesDot color={a.color} /><b>{a.title}</b><span>{a.status !== "active" ? "Paused" : scheduleText(a)}</span></button>
            <button className="paset" onClick={() => openAutoView(a.id)} aria-label={`${a.title} settings`} title="Open automation"><Settings2 size={14} /></button>
          </span>
        ))}
      </nav>
      <AutoRuns ctx={ctx} autos={autos} single={autos.length === 1} />
    </section>
  );
}
