import { useState } from "react";
import type { Automation, Run, Task } from "../types";
import { runOfTask } from "../runs";
import type { Ctx } from "../lib";
import { addDays, relDay, today } from "../date";
import { occurrenceOf, repeatsOn, slotsOf, topicKey } from "../../shared/repeat.mjs";
import { openAt, queuePrepare } from "./Auto";
import { BrandIcon } from "./BrandIcon";
import { platformsOf } from "../../shared/stages.mjs";
import { toast } from "./Toast";
import { X } from "lucide-react";

// Otomasyonların ürettiği işler (2026-11-01): Sırada (önümüzdeki 14 gün, henüz açılmamışlar dahil) · Hazırlanan (Rou hazırlıyor,
// onay bekliyor, paylaşılacak, hata) · Tamamlanan (son 14 gün). Sıradakiler seçilip toplu hazırlatılır; her satır işin ayrıntısını
// açar (açılmamış gün o an görev olur, hazırlanmaz). Proje sayfasında ve otomasyon penceresinde aynı bileşen.
type Row = { key: string; a: Automation; day: string; slot: string; task?: Task; run?: Run; title: string; line: string; tone?: string };
const SPAN = 14;

export function AutoRuns({ ctx, autos, single }: { ctx: Ctx; autos: Automation[]; single?: boolean }) {
  const s = ctx.state;
  const t0 = today();
  const since = addDays(t0, -SPAN);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const plan: Row[] = [], work: Row[] = [], done: Row[] = [];
  for (const a of autos) {
    const tasks = s.tasks.filter((t) => t.autoId === a.id);
    for (const t of tasks) {
      const run = runOfTask(s.runs, t.id);
      const day = t.autoDay ?? t.day ?? "";
      const base = { key: t.id, a, day, slot: t.autoSlot ?? "", task: t, run, title: t.topic?.title || run?.title && run.title !== a.title && run.title || t.title };
      if (run?.status === "posted" || run?.status === "acted" || t.status === "done") { if (day >= since) done.push({ ...base, line: run?.status === "posted" ? "Shared" : "Done", tone: "ok" }); }
      else if (run) work.push({ ...base, line: run.status === "working" ? "Rou is preparing" : run.status === "ready" ? "Awaiting your approval" : run.status === "approved" ? (run.publish?.phase ?? "To be shared") : run.status === "failed" ? "Couldn't prepare" : run.status, tone: run.status === "ready" ? "you" : run.status === "failed" ? "bad" : undefined });
      else if (day >= t0 || !day) plan.push({ ...base, line: t.queuedAt ? "Up next, Rou will prepare it" : "Opened, not prepared" });
      else plan.push({ ...base, line: "Missed, not prepared", tone: "late" });
    }
    if (a.status !== "active") continue;
    for (let i = 0; i < SPAN; i++) {
      const day = addDays(t0, i);
      if (!repeatsOn(a, day)) continue;
      for (const slot of slotsOf(a)) {
        if (occurrenceOf(s, a, day, slot)) continue;
        if (day === t0 && a.horizon && a.horizon >= t0) continue;
        plan.push({ key: `g|${a.id}|${day}|${slot}`, a, day, slot, title: a.topics?.[topicKey(day, slot)]?.title || "No topic, Rou picks one", line: "Planned", tone: "ghost" });
      }
    }
  }
  const when = (x: Row, y: Row) => `${x.day} ${x.slot || "99"}`.localeCompare(`${y.day} ${y.slot || "99"}`);
  plan.sort(when); work.sort(when); done.sort((x, y) => when(y, x));
  const canPick = (r: Row) => r.a.who === "claude" && !r.run && !r.task?.queuedAt;
  const toggle = (k: string) => setSel((x) => { const n = new Set(x); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const pickable = plan.filter(canPick);
  const open = (r: Row) => ctx.open(r.task?.id ?? openAt(ctx, r.a, r.day, r.slot));
  const prepare = () => {
    const rows = plan.filter((r) => sel.has(r.key));
    const ids = rows.map((r) => r.task?.id ?? openAt(ctx, r.a, r.day, r.slot));
    setSel(new Set());
    setTimeout(() => queuePrepare(ids), 300);
    toast(`${ids.length} ${ids.length === 1 ? "post" : "posts"} added to Rou's queue; Rou prepares them in order`);
  };

  const col = (title: string, rows: Row[], empty: string, pick?: boolean) => {
    let last: string | undefined;
    return (
      <section className="pbcol">
        <h4 className="pbhead">{title}<span>{rows.length || ""}</span>
          {pick && pickable.length > 0 && <button className="arsall" title="Pick several and prepare them now" onClick={() => setSel(sel.size === pickable.length ? new Set() : new Set(pickable.map((r) => r.key)))}>{sel.size === pickable.length ? "Clear selection" : "Select all"}</button>}
        </h4>
        {/* Seçim yapınca toplu hazırlatma bu sütunun içinde, başlığın altında küçük bir satır. */}
        {pick && sel.size > 0 && (
          <div className="arsel">
            <b>{sel.size} selected</b>
            <button className="btn sm primary" onClick={prepare}>Prepare</button>
            <button className="iconbtn" onClick={() => setSel(new Set())} aria-label="Clear selection" title="Clear selection"><X size={15} /></button>
          </div>
        )}
        {rows.length ? (
          <ol className="pblist">
            {rows.map((r) => {
              const show = r.day !== last; last = r.day;
              const p = platformsOf(s, r.a)[0];
              return (
                <li key={r.key}>
                  {show && <p className="pbday">{r.day ? relDay(r.day) : "Someday"}</p>}
                  <div className={`arrow ${sel.has(r.key) ? "is-sel" : ""}`}>
                    {pick && canPick(r) && <input type="checkbox" className="archeck" checked={sel.has(r.key)} onChange={() => toggle(r.key)} aria-label={`Select ${r.title}`} />}
                    <button className={`pbcard ${r.tone ? `is-${r.tone}` : ""}`} onClick={() => open(r)}>
                      <b>{r.title}</b>
                      <span>{r.slot && <em className="mono">{r.slot}</em>}{!single && <>{p && <BrandIcon platform={p} size={12} />}{r.a.title} · </>}{r.line}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="pbempty">{empty}</p>}
      </section>
    );
  };
  return (
    <div className="arruns">
      <div className="pboard">
        {col("Up next", plan, "Nothing planned for the next 2 weeks", true)}
        {col("In the works", work, "Nothing being prepared or awaiting approval")}
        {col("Done", done, "Nothing finished in the last 2 weeks")}
      </div>
    </div>
  );
}
