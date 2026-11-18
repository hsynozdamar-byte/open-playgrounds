import { useEffect, useRef, useState } from "react";
import { Mic, Square, Upload } from "lucide-react";
import { runOfTask } from "../runs";
import type { Automation, Run, Task } from "../types";
import { type Ctx, ALL } from "../lib";
import { today } from "../date";
import { stagesOf } from "../../shared/stages.mjs";
import { autoOf } from "./Auto";
import { uploadFile } from "./RouAttach";
import { toast } from "./Toast";

// Bugün panosu: bugünün otomasyon işleri (ve önceki günlerden onay bekleyenler), her biri adımlarıyla.
// Her kartta tek soru cevaplanır: şu an hangi adımda, kimin elinde, sıradaki ne.
export type BoardRow = { task: Task; a: Automation; run?: Run };

export function boardRows(ctx: Ctx): BoardRow[] {
  const s = ctx.state;
  const lens = ctx.route.lens;
  const t = today();
  const rows: BoardRow[] = [];
  for (const task of s.tasks) {
    const a = autoOf(s, task);
    if (!a || (lens !== ALL && task.worldId !== lens) || !task.day) continue;
    const run = runOfTask(s.runs, task.id);
    const open = run && (run.status === "ready" || run.status === "approved") && task.day < t;
    if (task.day === t || open) rows.push({ task, a, run });
  }
  return rows.sort((x, y) => (x.task.day! + (x.task.autoSlot || "99")).localeCompare(y.task.day! + (y.task.autoSlot || "99")));
}

// Senin elinde olan adımlar: ses, onay, kendi işin.
export const yourTurn = (ctx: Ctx, rows: BoardRow[]) => rows.filter(({ task, a, run }) => {
  const st = stagesOf(ctx.state, a, task, run);
  return !st.busy && st.steps.find((x) => x.key === st.current)?.who === "Sen";
}).length;

// Kartın tek cümlelik durumu: hangi aşamada ve sıradaki adım kimde ("Onaylandı · Rou paylaşacak").
export const whereText = (st: ReturnType<typeof stagesOf>, run?: Run) => {
  const shares = st.steps.some((x) => x.key === "publish");
  if (st.finished) return run?.status === "posted" ? "Paylaşıldı · tamamlandı" : "Tamamlandı";
  const cur = st.steps.find((x) => x.key === st.current)!;
  if (cur.state === "fail") return cur.key === "video" ? "Video üretilemedi" : cur.key === "image" ? "Görsel üretilemedi" : cur.key === "publish" ? "Paylaşılamadı" : "Hazırlanamadı";
  if (st.busy) return cur.key === "video" ? "Rou videoyu üretiyor" : cur.key === "image" ? "Rou görseli üretiyor" : cur.key === "publish" ? `${cur.who} paylaşıyor` : `${cur.who} hazırlıyor`;
  if (cur.key === "publish" && run?.publish?.phase) return `${cur.who} paylaşıyor`;
  return {
    write: cur.who === "Sen" ? "Senden bekleniyor" : `${cur.who} hazırlayacak`,
    voice: "Hazır · ses kaydın bekleniyor",
    video: "Rou videoyu üretecek",
    image: "Görsel eksik",
    approve: shares ? "Hazır · onayını bekliyor" : "Rou tamamladı · inceleme bekliyor",
    publish: cur.who === "Sen" ? "Onaylandı · paylaşım sende" : `Onaylandı · ${cur.who} paylaşacak`,
  }[cur.key];
};

// Ses adımı: metni oku, kaydet (ya da dosya seç). Kayıt yüklenince video kendiliğinden üretilir.
export function VoiceStep({ run }: { run: Run }) {
  const [state, setState] = useState<"idle" | "rec" | "up">("idle");
  const [sec, setSec] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state !== "rec") return;
    setSec(0);
    const t = setInterval(() => setSec((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  // Kart kayıt sürerken kapanırsa kayıt atılır: yarım ses yüklenip video render'ı başlamasın.
  const dropped = useRef(false);
  useEffect(() => () => { dropped.current = true; rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  const send = async (blob: Blob, name: string) => {
    setState("up");
    const up = await uploadFile(blob, name);
    if ("error" in up) { setState("idle"); return toast(up.error); }
    const r = await fetch("/api/run-voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.id, file: up.file }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Sunucuya ulaşılamadı" }));
    setState("idle");
    if (!r.ok) toast(r.error ?? "Ses eklenemedi");
  };
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return toast("Bu pencerede ses kaydı yok");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast("Mikrofon izni verilmedi"); }
    const r = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (dropped.current) return;
      const type = r.mimeType || "audio/webm";
      void send(new Blob(chunks, { type }), `ses.${type.includes("mp4") ? "m4a" : "webm"}`);
    };
    rec.current = r;
    r.start();
    setState("rec");
  };
  const mmss = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  return (
    <div className="bvoice">
      <div className="bscript">{script(run.body)}</div>
      <div className="bvact">
        {state === "rec" ? (
          <button className="btn sm brec" onClick={() => rec.current?.stop()}><Square size={12} />Bitir · {mmss}</button>
        ) : (
          <button className="btn sm primary" disabled={state === "up"} onClick={() => void start()}><Mic size={14} />{state === "up" ? "Yükleniyor…" : "Sesini kaydet"}</button>
        )}
        <button className="btn sm ghost" disabled={state !== "idle"} onClick={() => file.current?.click()}><Upload size={13} />Dosya seç</button>
        <input ref={file} type="file" accept="audio/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f, f.name); e.target.value = ""; }} />
        <span className="muted bvhint">Metni kendi tarzında oku; video sesine göre kurulur.</span>
      </div>
    </div>
  );
}

// Metindeki **kalın** başlıklar düz yazı olarak değil, kalın gösterilir.
const script = (t: string) => t.split(/(\*\*[^*]+\*\*)/g).map((x, i) => (x.startsWith("**") && x.endsWith("**") ? <b key={i}>{x.slice(2, -2)}</b> : x));

// LinkedIn görseli: metin hazır, görsel yoksa Rou yalnız görseli üretir (metin aynı kalır).
export function ImageStep({ run, failed }: { run: Run; failed?: boolean }) {
  const make = () => fetch("/api/run-image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.id }) }).then((x) => x.json()).then((r) => !r.ok && toast(r.error ?? "Başlatılamadı")).catch(() => toast("Sunucuya ulaşılamadı"));
  if (run.phase) return <p className="bnote muted"><span>{run.phase}…</span></p>;
  if (failed) return <div className="bnote"><p>Görsel üretilemedi: {run.renderError}</p><button className="btn sm" onClick={make}>Yeniden dene</button></div>;
  return <div className="bnote"><p>Görsel eksik.</p><button className="btn sm" onClick={make}>Görseli üret</button></div>;
}

export function VideoStep({ run, failed }: { run: Run; failed: boolean }) {
  const retry = () => fetch("/api/run-voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.id, file: run.voice }) }).then((x) => x.json()).then((r) => !r.ok && toast(r.error ?? "Başlatılamadı")).catch(() => toast("Sunucuya ulaşılamadı"));
  if (failed) return <div className="bnote"><p>Video üretilemedi: {run.renderError}</p><button className="btn sm" onClick={retry}>Yeniden dene</button></div>;
  return <p className="bnote muted"><span>{run.phase ? `${run.phase}…` : "Video sırada…"}</span></p>;
}
