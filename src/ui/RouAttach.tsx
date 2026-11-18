import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Music, Video, X } from "lucide-react";
import type { Att } from "../types";

// Attachment for Rou: image, video, audio, document. The file is uploaded to the server (data/media), the message holds only its name.
export type Pending = Att & { key: string; up?: boolean; preview?: string };

export async function uploadFile(f: Blob, name: string): Promise<Att | { error: string }> {
  const r = await fetch(`/api/upload?name=${encodeURIComponent(name)}&type=${encodeURIComponent(f.type)}`, { method: "POST", body: f })
    .then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
  return r.ok ? { file: r.file, name, kind: r.kind } : { error: r.error ?? "Couldn't upload" };
}

const ICON = { video: Video, audio: Music, file: FileText } as const;

// Attachments waiting to be sent (above the input).
export function AttChips({ list, onRemove }: { list: Pending[]; onRemove: (key: string) => void }) {
  if (!list.length) return null;
  return (
    <ul className="ratts">
      {list.map((a) => {
        const I = a.kind === "image" ? null : ICON[a.kind];
        return (
          <li key={a.key} className={a.up ? "is-up" : ""}>
            {a.kind === "image" && a.preview ? <img src={a.preview} alt="" /> : I && <I size={15} />}
            <span>{a.name}</span>
            {a.up ? <Loader2 size={13} className="spin" /> : <button type="button" onClick={() => onRemove(a.key)} aria-label={`Remove ${a.name}`}><X size={13} /></button>}
          </li>
        );
      })}
    </ul>
  );
}

// Attachments in a message: image as a thumbnail, video and audio with a player, document by name.
export function MsgFiles({ files }: { files: Att[] }) {
  return (
    <div className="rmfiles">
      {files.map((f) =>
        f.kind === "image" ? <img key={f.file} src={`/media/${f.file}`} alt={f.name} loading="lazy" />
        : f.kind === "video" ? <video key={f.file} src={`/media/${f.file}`} controls preload="metadata" />
        : f.kind === "audio" ? <audio key={f.file} src={`/media/${f.file}`} controls preload="metadata" />
        : <span key={f.file} className="rmdoc"><FileText size={14} />{f.name}</span>,
      )}
    </div>
  );
}

// Voice command: record → upload → transcribe locally → the text arrives in the input; the user sends it (so they can correct it).
// While recording cancel (discards the recording) or finish (transcribes). Microphone permission is asked on first use.
export function useVoice(onText: (t: string) => void, onError: (e: string) => void) {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [sec, setSec] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const drop = useRef(false);
  useEffect(() => {
    if (state !== "rec") return;
    setSec(0);
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [state]);
  useEffect(() => () => rec.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return onError("Voice recording isn't available in this window");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return onError("Microphone access was denied"); }
    const r = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (drop.current) return setState("idle");
      setState("busy");
      const type = r.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      const up = await uploadFile(blob, `voice.${type.includes("mp4") ? "m4a" : "webm"}`);
      if ("error" in up) { setState("idle"); return onError(up.error); }
      const t = await fetch("/api/transcribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file: up.file }) })
        .then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
      setState("idle");
      if (!t.ok) return onError(t.error ?? "Couldn't transcribe");
      if (!t.text?.trim()) return onError("I didn't hear anything");
      onText(t.text.trim());
    };
    rec.current = r;
    drop.current = false;
    r.start();
    setState("rec");
  };
  const stop = (discard = false) => { drop.current = discard; if (rec.current?.state === "recording") rec.current.stop(); };
  return { state, sec, start: () => void start(), finish: () => stop(), cancel: () => stop(true) };
}
