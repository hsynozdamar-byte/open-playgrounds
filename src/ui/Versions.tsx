import { Film, RotateCcw, Type } from "lucide-react";
import type { Run } from "../types";
import type { Ctx } from "../lib";
import { applyPart, applyVersion, canTakePart } from "../../shared/versions.mjs";
import { ago } from "../date";
import { toast } from "./Toast";

// Versions of a post: older states of this output (edit, redraw, restore) and earlier outputs of the same task (revisions).
// Restore applies the chosen one to the current output; the current state also goes into history, so a restore can be undone too.
const WHY: Record<string, string> = { edit: "Before edit", render: "Before redraw", kit: "Before look change", restore: "Before going back" };

type Item = { key: string; label: string; at: string; img?: string; text: string; from: Partial<Run>; mediaOnly?: boolean };

export function versionsOf(s: Ctx["state"], r: Run): Item[] {
  const own = (r.versions ?? []).map((v, i) => ({ key: `v${i}`, label: WHY[v.why] ?? "Earlier version", at: v.at, img: v.images?.[0], text: v.body ?? "", from: v }));
  const older = s.runs
    .filter((x) => x.taskId && x.taskId === r.taskId && x.id !== r.id && x.status !== "working" && (x.status !== "failed" ? x.post || x.body : x.video || x.images?.length))
    // For an output that failed to prepare only the image/video can be taken (its text may be an error message).
    .map((x) => ({ key: x.id, label: x.status === "failed" ? "Failed output" : "Earlier output", at: x.at, img: x.images?.[0] ?? x.cover, text: x.status === "failed" ? (x.video ? "Has a video" : "Has an image") : x.body, from: x, mediaOnly: x.status === "failed" }));
  return [...own, ...older].sort((a, b) => b.at.localeCompare(a.at));
}

export function Versions({ r, ctx, onDone }: { r: Run; ctx: Ctx; onDone: () => void }) {
  const list = versionsOf(ctx.state, r);
  const back = (it: Item) => {
    ctx.mutate((st) => { const x = st.runs.find((y) => y.id === r.id); if (x) applyVersion(x, it.from); });
    toast("Went back to this version. The current one stays in the history.");
    onDone();
  };
  const take = (it: Item, part: "text" | "media") => {
    ctx.mutate((st) => { const x = st.runs.find((y) => y.id === r.id); if (x) applyPart(x, it.from, part); });
    toast(part === "media" ? "Took this version's images and video; the text stays." : "Took this version's text; images and video stay.");
    onDone();
  };
  return (
    <div className="vers">
      <div className="vershead"><b>Versions</b><span>{list.length ? `${list.length} earlier ${list.length === 1 ? "version" : "versions"}` : "No earlier versions yet"}</span><button className="btn sm ghost" onClick={onDone}>Close</button></div>
      {list.length > 0 && (
        <ul>
          {list.map((it) => (
            <li key={it.key}>
              {it.img ? <img src={`/${it.img}`} alt="" loading="lazy" /> : <span className="versnoimg" />}
              <span className="verstext"><b>{it.label}</b><em>{ago(it.at)}</em><span>{it.text.split("\n").find((x) => x.trim())}</span></span>
              <span className="versbtns">
                {!it.mediaOnly && <button className="btn sm" onClick={() => back(it)}><RotateCcw size={13} />Go back</button>}
                {!it.mediaOnly && canTakePart(r, it.from, "text") && <button className="btn sm ghost" onClick={() => take(it, "text")}><Type size={13} />Text only</button>}
                {canTakePart(r, it.from, "media") && <button className="btn sm ghost" onClick={() => take(it, "media")}><Film size={13} />{it.from.video ? "Video only" : "Images only"}</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
