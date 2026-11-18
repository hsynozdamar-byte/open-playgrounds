import { useEffect, useState } from "react";
import { ArrowUpRight, Globe, MonitorUp, Play, RefreshCw, Send } from "lucide-react";
import type { Live, Run, Task } from "../types";
import type { Ctx } from "../lib";
import { toast } from "./Toast";
import { canFocusTab, usePlatform } from "../platform";

const host = (u: string) => { try { const x = new URL(u); return (x.host + x.pathname).replace(/\/$/, ""); } catch { return u; } };
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
// Brings forward the tab Rou is working in: the Browser page of Playgrounds, the task's world (fallback: Chrome).
export const focusTab = (runId?: string) => void post("/api/focus-chrome", { runId });

// While Rou works in the browser: which page, what it is doing now, the last steps (server/live.mjs).
// On the Chrome fallback path the box highlights it when the Claude extension is waiting for permission.
export function LiveBox({ live, busy, runId }: { live?: Live; busy: boolean; runId?: string }) {
  const platform = usePlatform();
  if (!live) return busy ? <div className="livebox"><p className="livenow"><RefreshCw size={13} className="spin" />Opening the browser…</p></div> : null;
  const past = live.log.slice(0, -1).slice(-4);
  return (
    <div className={`livebox ${live.waiting ? "is-waiting" : ""}`}>
      <div className="livehead">
        <span className="livewhere"><Globe size={13} />{live.url ? <a href={live.url} target="_blank" rel="noreferrer">{host(live.url)}</a> : live.browser || "Browser"}</span>
        {canFocusTab(platform) && <button className={`btn sm ${live.waiting ? "primary" : "ghost"}`} onClick={() => focusTab(runId)}><MonitorUp size={13} />Show tab</button>}
      </div>
      <p className="livenow">{busy && !live.waiting && <RefreshCw size={13} className="spin" />}{live.step}</p>
      {live.waiting && <p className="livewait">The browser is asking for permission. Switch to the tab and allow it; Rou picks up where it left off.</p>}
      {past.length > 0 && <ol className="livelog">{past.map((x, i) => <li key={i}>{x}</li>)}</ol>}
    </div>
  );
}

// Request to start Rou's browser task after approval or Save in the drawer; the panel takes it when it opens.
const pending = new Set<string>();
export function requestDo(runId: string) { pending.add(runId); window.dispatchEvent(new Event("pg-do")); }

// A single task (not an automation), Rou's: Rou carries out the approved plan in Playgrounds' browser, in the session of the task's world (POST /api/do).
// If a question comes it is answered here.
export function DoPanel({ r }: { r: Run; task?: Task; ctx?: Ctx }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const act = r.act;
  const working = !!act?.phase && Date.now() - new Date(act.at).getTime() < 45 * 60 * 1000;
  const start = async (ans?: string) => {
    setBusy(true);
    const res = await post("/api/do", { runId: r.id, ...(ans ? { answer: ans } : {}) });
    setBusy(false);
    dispatchEvent(new Event("pg-do-ready"));
    if (!res.ok) return toast(res.error ?? "Couldn't start");
    setAnswer("");
    toast("Rou started in the browser");
  };
  useEffect(() => {
    const take = () => { if (pending.has(r.id) && r.status === "approved" && !working && !act?.question) { pending.delete(r.id); void start(); } };
    take();
    window.addEventListener("pg-do", take);
    return () => window.removeEventListener("pg-do", take);
  });
  if (working) return <div className="dopanel"><LiveBox live={act?.live} busy runId={r.id} /></div>;
  return (
    <div className="dopanel">
      {act?.note && <p className="donote">{act.note}{act.url && <> <a className="link" href={act.url} target="_blank" rel="noreferrer">Open page <ArrowUpRight size={12} /></a></>}</p>}
      {act?.error && <p className="pvissues">Rou couldn't do it: {act.error}</p>}
      {act?.question ? (
        <form className="doask" onSubmit={(e) => (e.preventDefault(), answer.trim() && start(answer.trim()))}>
          {/* Long lists (e.g. subscriptions "1 … | 2 …") item by item; the question and the explanation on separate lines. */}
          {(() => { const parts = act.question.split(/\s+\|\s+|\n+/).map((x) => x.trim()).filter(Boolean); return parts.length > 3
            ? <div className="doq"><b>Rou asks</b><ul>{parts.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            : <p><b>Rou asks</b>{act.question}</p>; })()}
          <textarea rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer" aria-label="Answer to Rou's question" />
          <button className="btn sm primary" disabled={!answer.trim()}><Send size={13} />Answer and continue</button>
        </form>
      ) : r.status === "approved" && (
        <button className="btn sm primary" disabled={busy} onClick={() => start()}>{busy ? <RefreshCw size={13} className="spin" /> : <Play size={13} />}{act?.error || act?.note ? "Let Rou try again" : "Let Rou do it"}</button>
      )}
      {act?.live && !working && <details className="dolast"><summary>Last run: {act.live.step}</summary><LiveBox live={act.live} busy={false} runId={r.id} /></details>}
    </div>
  );
}
