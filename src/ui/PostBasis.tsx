import { Sparkles } from "lucide-react";
import type { Ctx } from "../lib";
import type { Task } from "../types";
import { postBasis, topicOk } from "../postBasis";
import { kickOffWhat, prepare } from "./Auto";
import { toast } from "./Toast";

export const SHORT_TOPIC = "The topic is too short. Write what the post should say in the title, and Rou writes from that.";

// On the card of a hand-added post: what Rou will write this post from. If there is no output it can be prepared from here.
export function PostBasis({ task, ctx }: { task: Task; ctx: Ctx }) {
  const s = ctx.state;
  const b = postBasis(s, task);
  const ran = s.runs.some((r) => r.taskId === task.id);
  const ok = topicOk(b.topic);
  const go = () => {
    if (!ok) return toast(SHORT_TOPIC);
    void prepare(task.id);
    toast("Rou is preparing the post");
  };
  const rows: [string, string][] = [
    ["Topic", b.topic || "None"],
    ["Project", b.project || "No project"],
    ["Project brand", b.brand ? "Yes" : "None"],
    ["Account", b.account || "None"],
    ["Account voice", b.voice || "Not written"],
    ["Sources", b.sources ? `${b.sources} ${b.sources === 1 ? "source" : "sources"}` : "None"],
    ["Belongs to", b.auto ? `Automation: ${b.auto}` : "One-off"],
  ];
  return (
    <section className="dsec pbasis">
      <div className="dsechead"><span className="flabel">What it's prepared from</span></div>
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className={k === "Topic" && !ok ? "is-warn" : ""}>{v}</dd></div>)}</dl>
      {!ok && <p className="pbwarn">{SHORT_TOPIC}</p>}
      {!ran && !kickOffWhat(s, task) && task.status !== "done" && <button className="btn sm dsecbtn" onClick={go}><Sparkles size={14} />Prepare now</button>}
    </section>
  );
}
