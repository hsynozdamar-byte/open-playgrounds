import { Activity, Bot } from "lucide-react";
import type { Ctx } from "../lib";
import { load, useStatus } from "./AgentStatus";

// Settings › Assistant: which LLM command Rou runs on (server/claude.mjs, shared/llm.mjs). PG_LLM_CMD, when set, wins and the picker is off.
const OPTS = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
] as const;

export function AssistantSetting({ ctx }: { ctx: Ctx }) {
  const s = useStatus();
  const cur = ctx.state.settings?.llm ?? "claude";
  const env = !!s?.llm?.fromEnv;
  const pick = (id: (typeof OPTS)[number]["id"]) => {
    ctx.mutate((st) => { st.settings = { ...st.settings, llm: id === "claude" ? undefined : id }; });
    setTimeout(() => load(true), 400);
  };
  const state = s?.claude.state;
  const line = !s ? "Checking" : state === "ok" ? "Ready" : state === "missing" ? `${s.llm?.cmd ?? cur} not found` : state === "off" ? "Signed out" : "Status unknown";
  return (
    <>
      <div className="card setcard">
        <h2>Assistant</h2>
        <div className="setrow"><Bot size={16} strokeWidth={1.9} /><span>Command</span>
          {env ? <em className="setval">{s?.llm?.cmd}</em> : (
            <div className="seg sm" role="radiogroup" aria-label="Rou's command">{OPTS.map((o) => <button key={o.id} role="radio" aria-checked={cur === o.id} className={cur === o.id ? "on" : ""} onClick={() => pick(o.id)}>{o.label}</button>)}</div>
          )}
        </div>
        <div className="setrow"><Activity size={16} strokeWidth={1.9} /><span>Status</span><em className="setval" title={state === "missing" ? s?.llm?.install : undefined}>{line}</em></div>
      </div>
      <p className="setfoot">
        {state === "missing" && s?.llm?.install ? <>Install: {s.llm.install}. </> : null}
        Reading files and images, web search, Chrome and browser jobs work only with Claude Code; with other commands these jobs stop with an explanatory error.
      </p>
    </>
  );
}
