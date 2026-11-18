import { useEffect, useState } from "react";
import type { Ctx } from "../lib";

// Status of the preparers (server/status.mjs). One request is shared and refreshed every 5 minutes.
// claude: status of the selected assistant (Claude Code, Codex, Gemini CLI); llm: which one is selected.
export type Status = { claude: { state: "ok" | "off" | "missing" | "unknown" }; llm?: { id: string; name: string; cmd: string; fromEnv: boolean; install: string; caps: Record<string, boolean> } };
let last: Status | null = null;
let inflight: Promise<Status | null> | null = null;
const subs = new Set<(s: Status | null) => void>();

export function load(fresh = false) {
  inflight ??= fetch(`/api/status${fresh ? "?fresh=1" : ""}`)
    .then((r) => r.json() as Promise<Status>)
    .catch(() => null)
    .then((s) => {
      inflight = null;
      last = s;
      subs.forEach((f) => f(s));
      return s;
    });
  return inflight;
}

export function useStatus() {
  const [s, set] = useState(last);
  useEffect(() => {
    subs.add(set);
    if (!last) load();
    const t = setInterval(() => load(), 5 * 60 * 1000);
    return () => (subs.delete(set), clearInterval(t));
  }, []);
  return s;
}

const since = (t: string) => {
  const m = Math.max(1, Math.round((Date.now() - new Date(t).getTime()) / 60000));
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
};
const DAY = 26 * 3600 * 1000;   // daily job: warn if not seen for more than a day

type Light = { id: "claude"; name: string; tone: "ok" | "warn" | "off" | "idle" | "busy"; text: string; fix?: string; taskId?: string };

// Only preparers used by active automations are shown.
export function lights(ctx: Ctx, s: Status | null): Light[] {
  const used = new Set(ctx.state.automations.filter((a) => a.status === "active").map((a) => a.who));
  const out: Light[] = [];
  // If Rou is preparing a task the light says so and opens the task on click ("preparing" records older than 12 min do not count).
  const busy = ctx.state.runs.filter((r) => (r.status === "working" && Date.now() - new Date(r.at).getTime() < 60 * 60 * 1000) || (!!r.act?.phase && Date.now() - new Date(r.act.at).getTime() < 45 * 60 * 1000));
  if (busy.length) used.add("claude");
  if (busy.length && s?.claude.state === "ok") {
    const t = ctx.state.tasks.find((x) => x.id === busy[0].taskId);
    out.push({ id: "claude", name: "Rou", tone: "busy", text: busy.length > 1 ? `Working: ${busy.length} tasks` : `Working: ${t?.title ?? busy[0].title} · ${busy[0].act?.live?.step ?? busy[0].live?.step ?? busy[0].phase ?? "preparing"}`, taskId: busy[0].taskId });
  } else if (used.has("claude")) {
    const c = s?.claude.state;
    out.push(!s ? { id: "claude", name: "Rou", tone: "idle", text: "Checking" }
      : c === "ok" ? { id: "claude", name: "Rou", tone: "ok", text: "Ready" }
      : c === "missing" ? { id: "claude", name: "Rou", tone: "off", text: `${s.llm?.name ?? "Claude Code"} not found: ${s.llm?.cmd ?? "claude"} is not on PATH`, fix: `Install: ${s.llm?.install ?? "Claude Code"}. Or pick another command in Settings › Assistant.` }
      : { id: "claude", name: "Rou", tone: "off", text: "Signed out", fix: `Type \`${s.llm?.cmd ?? "claude"}\` in the terminal and sign in. Preparing doesn't work while signed out.` });
  }
  return out;
}

// Automations page: lights for the preparers.
export function AgentLights({ ctx }: { ctx: Ctx }) {
  const s = useStatus();
  const list = lights(ctx, s);
  const [busy, setBusy] = useState(false);
  if (!list.length) return null;
  return (
    <div className="agents">
      <div className="cardhead"><h3>Preparers</h3>
        <button className="link" disabled={busy} onClick={() => (setBusy(true), load(true).finally(() => setBusy(false)))}>{busy ? "Checking" : "Refresh"}</button>
      </div>
      <ul>
        {list.map((l) => (
          <li key={l.id} className={`agent t-${l.tone}`} title={l.fix?.replace(/`/g, "") ?? (l.taskId ? l.text : undefined)}>
            {l.taskId
              ? <button className="agentgo" onClick={() => ctx.open(l.taskId!)}><i /><b>{l.name}</b><span>{l.text}</span></button>
              : <><i /><b>{l.name}</b><span>{l.text}</span></>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// `command` shows as code.
const code = (t?: string) => t?.split("`").map((x, i) => (i % 2 ? <code key={i}>{x}</code> : x));

// Focus and the approval queue: a one-line warning when a preparer is not running.
export function AgentAlert({ ctx }: { ctx: Ctx }) {
  const s = useStatus();
  const bad = lights(ctx, s).filter((l) => l.tone === "off" || l.tone === "warn");
  if (!bad.length) return null;
  return (
    <div className="agentalert" role="status">
      {bad.map((l) => (
        <p key={l.id} className={`t-${l.tone}`}><i /><span><b>{l.name}: {l.text}.</b> {code(l.fix)}</span></p>
      ))}
    </div>
  );
}
