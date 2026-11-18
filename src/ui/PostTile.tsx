import { AlertTriangle, ArrowUpRight, Check, Clock, Eye, RefreshCw } from "lucide-react";
import { openPost } from "./openPost";
import type { Run, Task } from "../types";
import type { Ctx } from "../lib";
import { relDay, today } from "../date";
import { autoOf, isStale, runTag } from "./Auto";
import { sharerOf } from "../../shared/stages.mjs";
import { DraftPost, PostPreview } from "./Preview";

// A card for one output: when and status on top, below it the post as it looks on the platform (image, video, text).
// The whole card is clickable: it opens the task card (Drawer) with the full output, approval, editing and sharing. Text is cut to a few lines. Automation history and Posts use the same card.
const ICON: Partial<Record<Run["status"], typeof Check>> = { posted: Check, approved: Check, acted: Check, ready: Eye, failed: AlertTriangle, working: RefreshCw };
const cap = (x: string) => x.replace(/^./, (c) => c.toLocaleUpperCase("en-US"));

// If the time has passed, it is shared right after approval (server/share.mjs).
function shareNote(ctx: Ctx, task: Task) {
  if (!task.autoSlot || !task.day) return "Awaiting your approval";
  const d = new Date(), now = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const past = task.day < today() || (task.day === today() && task.autoSlot <= now);
  const who = sharerOf(autoOf(ctx.state, task), task) === "me" ? "you" : "Rou";
  return past ? `Approve and ${who} ${who === "you" ? "share" : "shares"} it right away` : `Approve and ${who} ${who === "you" ? "share" : "shares"} it · ${task.autoSlot}`;
}

export function PostTile({ ctx, task, run: latest, title }: { ctx: Ctx; task: Task; run?: Run; title?: string }) {
  // While a revision is prepared the previous output looks faded with "Preparing revision" on top; the card stays in the list.
  const revising = latest?.status === "working" && !isStale(latest);
  const run = revising ? ctx.state.runs.find((r) => r.taskId === task.id && r !== latest) ?? latest : latest;
  const st: Run["status"] | "none" = run ? (isStale(run) ? "failed" : run.status) : "none";
  const I = st === "none" ? Clock : ICON[st];
  const label = run && st === "failed" ? "Couldn't prepare" : runTag(ctx.state, task, run);
  const when = `${cap(relDay(task.day!))}${task.autoSlot ? ` · ${task.autoSlot}` : ""}`;
  return (
    <li className={`ptile is-${st}`} onClick={(e) => !(e.target as Element).closest("a, video, .ptfoot") && ctx.open(task.id)}>
      <header className="pthead">
        <span className="ptwhen">{when}{title && <em>{title}</em>}</span>
        {revising ? <span className="ptst is-working"><RefreshCw size={12} className="spin" />{latest?.phase ? `${latest.phase}…` : "Preparing revision"}</span> : <span className={`ptst is-${st}`}>{I && <I size={12} strokeWidth={2.5} className={st === "working" ? "spin" : undefined} />}{label}</span>}
      </header>
      <div className={`ptbody ${revising ? "is-revising" : ""}`}>
        {run?.post && st !== "failed" ? <PostPreview r={run} s={ctx.state} compact />
          : run?.body && st !== "working" ? <DraftPost r={run} s={ctx.state} compact />
          : <p className="ptempty">{st === "working" ? "Preparing…" : st === "failed" ? "Couldn't prepare. Open it and try again." : "No output was made for this slot."}</p>}
      </div>
      {(st === "ready" || run?.postUrl) && (
        <footer className="ptfoot">
          {st === "ready" && <span className="ptnote">{shareNote(ctx, task)}</span>}
          {run?.postUrl && <a className="link" href={run.postUrl} target="_blank" rel="noreferrer" onClick={(e) => openPost(run, e)}>Open post<ArrowUpRight size={13} /></a>}
          {st === "ready" && <button className="btn sm primary ptgo" onClick={() => ctx.open(task.id)}>Review</button>}
        </footer>
      )}
    </li>
  );
}
