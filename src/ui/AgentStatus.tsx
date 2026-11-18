import { useEffect, useState } from "react";
import type { Ctx } from "../lib";

// Hazırlayanların durumu (server/status.mjs). Tek istek paylaşılır, 5 dakikada bir yenilenir.
type Status = { claude: { state: "ok" | "off" | "missing" | "unknown" } };
let last: Status | null = null;
let inflight: Promise<Status | null> | null = null;
const subs = new Set<(s: Status | null) => void>();

function load(fresh = false) {
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

function useStatus() {
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
  return m < 60 ? `${m} dk` : m < 48 * 60 ? `${Math.round(m / 60)} sa` : `${Math.round(m / 1440)} gün`;
};
const DAY = 26 * 3600 * 1000; // günlük iş: bir günden uzun görünmediyse uyarı

type Light = { id: "claude"; name: string; tone: "ok" | "warn" | "off" | "idle" | "busy"; text: string; fix?: string; taskId?: string };

// Yalnız etkin otomasyonlarda kullanılan hazırlayanlar gösterilir.
export function lights(ctx: Ctx, s: Status | null): Light[] {
  const used = new Set(ctx.state.automations.filter((a) => a.status === "active").map((a) => a.who));
  const out: Light[] = [];
  // Rou bir iş hazırlıyorsa ışık onu söyler ve tıklayınca işi açar (12 dk'dan eski "hazırlanıyor" kayıtları sayılmaz).
  const busy = ctx.state.runs.filter((r) => (r.status === "working" && Date.now() - new Date(r.at).getTime() < 60 * 60 * 1000) || (!!r.act?.phase && Date.now() - new Date(r.act.at).getTime() < 45 * 60 * 1000));
  if (busy.length) used.add("claude");
  if (busy.length && s?.claude.state === "ok") {
    const t = ctx.state.tasks.find((x) => x.id === busy[0].taskId);
    out.push({ id: "claude", name: "Rou", tone: "busy", text: busy.length > 1 ? `Çalışıyor: ${busy.length} görev` : `Çalışıyor: ${t?.title ?? busy[0].title} · ${busy[0].act?.live?.step ?? busy[0].live?.step ?? busy[0].phase ?? "hazırlıyor"}`, taskId: busy[0].taskId });
  } else if (used.has("claude")) {
    const c = s?.claude.state;
    out.push(!s ? { id: "claude", name: "Rou", tone: "idle", text: "Bakılıyor" }
      : c === "ok" ? { id: "claude", name: "Rou", tone: "ok", text: "Hazır" }
      : c === "missing" ? { id: "claude", name: "Rou", tone: "off", text: "Bu bilgisayarda kurulu değil", fix: "Claude Code'u kur, sonra terminalde `claude` yazıp giriş yap." }
      : { id: "claude", name: "Rou", tone: "off", text: "Oturum kapalı", fix: "Terminalde `claude` yazıp giriş yap. Kapalıyken hazırlatma çalışmaz." });
  }
  return out;
}

// Otomasyonlar sayfası: hazırlayanların ışıkları.
export function AgentLights({ ctx }: { ctx: Ctx }) {
  const s = useStatus();
  const list = lights(ctx, s);
  const [busy, setBusy] = useState(false);
  if (!list.length) return null;
  return (
    <div className="agents">
      <div className="cardhead"><h3>Hazırlayanlar</h3>
        <button className="link" disabled={busy} onClick={() => (setBusy(true), load(true).finally(() => setBusy(false)))}>{busy ? "Bakılıyor" : "Yenile"}</button>
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

// `komut` kod olarak görünür.
const code = (t?: string) => t?.split("`").map((x, i) => (i % 2 ? <code key={i}>{x}</code> : x));

// Odak ve onay kuyruğu: bir hazırlayan çalışmıyorsa tek satır uyarı.
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
