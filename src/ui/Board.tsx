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

// stagesOf (shared) names the person "Sen"; shown as "You".
export const whoName = (w: string) => (w === "Sen" ? "You" : w);
// Kartın tek cümlelik durumu: hangi aşamada ve sıradaki adım kimde ("Onaylandı · Rou paylaşacak").
export const whereText = (st: ReturnType<typeof stagesOf>, run?: Run) => {
  const shares = st.steps.some((x) => x.key === "publish");
  if (st.finished) return run?.status === "posted" ? "Shared · done" : "Done";
  const cur0 = st.steps.find((x) => x.key === st.current)!;
  const cur = { ...cur0, who: whoName(cur0.who) };
  if (cur.state === "fail") return cur.key === "video" ? "Couldn't make the video" : cur.key === "image" ? "Couldn't make the image" : cur.key === "publish" ? "Couldn't share" : "Couldn't prepare";
  if (st.busy) return cur.key === "video" ? "Rou is making the video" : cur.key === "image" ? "Rou is making the image" : cur.key === "publish" ? `${cur.who} ${cur.who === "You" ? "are" : "is"} sharing` : `${cur.who} ${cur.who === "You" ? "are" : "is"} preparing`;
  if (cur.key === "publish" && run?.publish?.phase) return `${cur.who} ${cur.who === "You" ? "are" : "is"} sharing`;
  return {
    write: cur.who === "You" ? "Waiting for you" : `${cur.who} will prepare it`,
    voice: "Ready · waiting for your voice",
    video: "Rou will make the video",
    image: "Image missing",
    approve: shares ? "Ready · awaiting your approval" : "Rou is done · awaiting review",
    publish: cur.who === "You" ? "Approved · you share it" : `Approved · ${cur.who} will share`,
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
    const r = await fetch("/api/run-voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.id, file: up.file }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
    setState("idle");
    if (!r.ok) toast(r.error ?? "Couldn't add the voice");
  };
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return toast("Recording isn't available in this window");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast("Microphone access was denied"); }
    const r = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (dropped.current) return;
      const type = r.mimeType || "audio/webm";
      void send(new Blob(chunks, { type }), `voice.${type.includes("mp4") ? "m4a" : "webm"}`);
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
          <button className="btn sm brec" onClick={() => rec.current?.stop()}><Square size={12} />Finish · {mmss}</button>
        ) : (
          <button className="btn sm primary" disabled={state === "up"} onClick={() => void start()}><Mic size={14} />{state === "up" ? "Uploading…" : "Record your voice"}</button>
        )}
        <button className="btn sm ghost" disabled={state !== "idle"} onClick={() => file.current?.click()}><Upload size={13} />Pick a file</button>
        <input ref={file} type="file" accept="audio/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f, f.name); e.target.value = ""; }} />
        <span className="muted bvhint">Read the script your own way; the video is built around your voice.</span>
      </div>
    </div>
  );
}

// Metindeki **kalın** başlıklar düz yazı olarak değil, kalın gösterilir.
const script = (t: string) => t.split(/(\*\*[^*]+\*\*)/g).map((x, i) => (x.startsWith("**") && x.endsWith("**") ? <b key={i}>{x.slice(2, -2)}</b> : x));

// LinkedIn görseli: metin hazır, görsel yoksa Rou yalnız görseli üretir (metin aynı kalır).
export function ImageStep({ run, failed }: { run: Run; failed?: boolean }) {
  const make = () => fetch("/api/run-image", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.id }) }).then((x) => x.json()).then((r) => !r.ok && toast(r.error ?? "Couldn't start")).catch(() => toast("Couldn't reach the server"));
  if (run.phase) return <p className="bnote muted"><span>{run.phase}…</span></p>;
  if (failed) return <div className="bnote"><p>Couldn't make the image: {run.renderError}</p><button className="btn sm" onClick={make}>Try again</button></div>;
  return <div className="bnote"><p>Image missing.</p><button className="btn sm" onClick={make}>Make the image</button></div>;
}

export function VideoStep({ run, failed }: { run: Run; failed: boolean }) {
  const retry = () => fetch("/api/run-voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: run.id, file: run.voice }) }).then((x) => x.json()).then((r) => !r.ok && toast(r.error ?? "Couldn't start")).catch(() => toast("Couldn't reach the server"));
  if (failed) return <div className="bnote"><p>Couldn't make the video: {run.renderError}</p><button className="btn sm" onClick={retry}>Try again</button></div>;
  return <p className="bnote muted"><span>{run.phase ? `${run.phase}…` : "Video queued…"}</span></p>;
}
