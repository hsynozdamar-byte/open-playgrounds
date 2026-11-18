import { Activity, Bot } from "lucide-react";
import type { Ctx } from "../lib";
import { load, useStatus } from "./AgentStatus";

// Ayarlar › Asistan: Rou hangi LLM komutuyla çalışsın (server/claude.mjs, shared/llm.mjs). PG_LLM_CMD verilmişse o geçerli, seçim kapalı.
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
  const line = !s ? "Bakılıyor" : state === "ok" ? "Hazır" : state === "missing" ? `${s.llm?.cmd ?? cur} bulunamadı` : state === "off" ? "Oturum kapalı" : "Durumu bilinmiyor";
  return (
    <>
      <div className="card setcard">
        <h2>Asistan</h2>
        <div className="setrow"><Bot size={16} strokeWidth={1.9} /><span>Komut</span>
          {env ? <em className="setval">{s?.llm?.cmd}</em> : (
            <div className="seg sm" role="radiogroup" aria-label="Rou'nun komutu">{OPTS.map((o) => <button key={o.id} role="radio" aria-checked={cur === o.id} className={cur === o.id ? "on" : ""} onClick={() => pick(o.id)}>{o.label}</button>)}</div>
          )}
        </div>
        <div className="setrow"><Activity size={16} strokeWidth={1.9} /><span>Durum</span><em className="setval" title={state === "missing" ? s?.llm?.install : undefined}>{line}</em></div>
      </div>
      <p className="setfoot">
        {state === "missing" && s?.llm?.install ? <>Kurulum: {s.llm.install}. </> : null}
        Dosya ve görsel okuma, web araması, Chrome ve tarayıcı işleri yalnız Claude Code ile çalışır; diğer komutlarda bu işler açıklamalı bir hatayla durur.
      </p>
    </>
  );
}
