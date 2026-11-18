// Files attached to Rou: image, video, audio, document. An upload is written as data/media/rou-<id>.<ext> and served at /media/.
// So Rou can read them: images and documents as they are (claude opens them with Read), a video as 6 frames + a transcript, audio as a transcript.
// Transcripts come from local whisper.cpp (free, on this computer). Results are kept next to the file and never computed twice.
// Only rou-* files in this folder are accepted; no other path on disk is read.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { id, read, MEDIA_DIR } from "./store.mjs";
import { FFMPEG, FFPROBE } from "../shared/platform.mjs";

const KINDS = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "heic"],
  video: ["mp4", "mov", "m4v", "webm"],
  audio: ["m4a", "mp3", "wav", "ogg", "aac", "webm", "mp4"],
  file: ["pdf", "txt", "md", "csv", "json"],
};
const MAX = 300 * 1024 * 1024;
const NAME = /^rou-[a-z0-9]+\.[a-z0-9]+$/;
const WHISPER = process.env.PG_WHISPER || "whisper-cli";
const MODEL = process.env.PG_WHISPER_MODEL || path.join(os.homedir(), ".local/share/whisper/ggml-large-v3-turbo-q5_0.bin");

function sh(cmd, args, ms = 300000) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.setEncoding("utf8").on("data", (c) => (out += c));
    p.stderr.setEncoding("utf8").on("data", (c) => (err += c));
    const t = setTimeout(() => p.kill("SIGTERM"), ms);
    p.on("error", (e) => (clearTimeout(t), resolve({ ok: false, out: "", err: e.message })));
    p.on("close", (code) => (clearTimeout(t), resolve({ ok: code === 0, out: out.trim(), err })));
  });
}

const extOf = (name) => path.extname(String(name || "")).slice(1).toLowerCase();
export function kindOf(name, type = "") {
  const ext = extOf(name);
  if (type.startsWith("audio/") && KINDS.audio.includes(ext)) return "audio";
  for (const k of ["image", "video", "audio", "file"]) if (KINDS[k].includes(ext)) return k;
  return null;
}
// Only a rou-* file inside data/media; null otherwise.
export function mediaPath(file) {
  if (typeof file !== "string" || !NAME.test(file)) return null;
  const p = path.join(MEDIA_DIR, file);
  return fs.existsSync(p) ? p : null;
}

// The body streams straight into the file. name: original name (for the extension), type: the type the browser gave.
export function upload(req, name, type) {
  return new Promise((resolve) => {
    const kind = kindOf(name, type);
    if (!kind) { req.resume(); return resolve({ ok: false, error: "This file type cannot be attached" }); }
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const file = `rou-${id()}${Date.now().toString(36)}.${extOf(name)}`;
    const dest = path.join(MEDIA_DIR, file);
    const w = fs.createWriteStream(dest);
    let n = 0, done = false;
    const fail = (error) => { if (done) return; done = true; req.unpipe(w); w.destroy(); fs.rmSync(dest, { force: true }); resolve({ ok: false, error }); };
    req.on("data", (c) => (n += c.length) > MAX && fail("File is larger than 300 MB"));
    req.on("error", () => fail("Upload was interrupted"));
    w.on("finish", () => { if (done) return; done = true; resolve({ ok: true, file, kind, size: n }); });
    req.pipe(w);
  });
}

// Transcript of audio (or of a video's sound). Returns "" when empty.
export async function transcribe(file) {
  const src = mediaPath(file);
  if (!src) return { ok: false, error: "File not found" };
  const cache = `${src}.txt`;
  if (fs.existsSync(cache)) return { ok: true, text: fs.readFileSync(cache, "utf8") };
  if (!fs.existsSync(MODEL)) return { ok: false, error: "Speech recognition is not installed (no whisper model)" };
  const wav = path.join(os.tmpdir(), `pg-${path.basename(src)}.wav`);
  const a = await sh(FFMPEG, ["-y", "-v", "error", "-i", src, "-vn", "-ar", "16000", "-ac", "1", "-t", "900", wav]);
  if (!a.ok) return { ok: true, text: "" }; // no audio track
  // World, project and Rou names serve as a hint so proper names are spelled right.
  const s = read().state;
  const hint = [...s.worlds.map((w) => w.name), ...s.projects.map((p) => p.name), ...(s.rous ?? []).map((r) => r.name), "Playgrounds", "Rou"].join(", ").slice(0, 600);
  const r = await sh(WHISPER, ["-m", MODEL, "-l", "auto", "-nt", "-np", "--prompt", hint, "-f", wav]);
  fs.rmSync(wav, { force: true });
  if (!r.ok) return { ok: false, error: `Could not transcribe the audio: ${r.err.split("\n").slice(-2).join(" ").slice(0, 200)}` };
  const text = r.out.replace(/\s+/g, " ").replace(/^\[.*?\]\s*/, "").trim();
  fs.writeFileSync(cache, text);
  return { ok: true, text };
}

// Up to 6 evenly spaced frames from a video (768 px). Frame files are rou-x.mp4.f1.jpg ...
async function frames(src) {
  const have = [1, 2, 3, 4, 5, 6].map((i) => `${src}.f${i}.jpg`).filter((f) => fs.existsSync(f));
  if (have.length) return have;
  const d = Number((await sh(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src])).out) || 6;
  await sh(FFMPEG, ["-y", "-v", "error", "-i", src, "-vf", `fps=${Math.min(6, 6 / d)},scale=768:-2`, "-frames:v", "6", `${src}.f%d.jpg`]);
  return [1, 2, 3, 4, 5, 6].map((i) => `${src}.f${i}.jpg`).filter((f) => fs.existsSync(f));
}

// Turns a message's attachments into lines Rou reads. read: paths to open with the Read tool.
export async function describeFiles(files) {
  const lines = [], read = [];
  for (const f of (Array.isArray(files) ? files : []).slice(0, 8)) {
    const src = mediaPath(f?.file);
    if (!src) continue;
    const name = String(f.name || f.file).slice(0, 80);
    const kind = kindOf(f.file, f.kind === "audio" ? "audio/" : "") ?? "file";
    if (kind === "image" || kind === "file") {
      read.push(src);
      lines.push(`- ${name} (${kind === "image" ? "image" : "document"}, file name ${f.file}): ${src}`);
    } else if (kind === "video") {
      const fr = await frames(src);
      read.push(...fr);
      const t = await transcribe(f.file);
      lines.push(`- ${name} (video, file name ${f.file}). Frames in order: ${fr.join(", ")}${t.ok && t.text ? `\n  Speech in the video: "${t.text.slice(0, 3000)}"` : ""}`);
    } else {
      const t = await transcribe(f.file);
      lines.push(`- ${name} (audio recording, file name ${f.file})${t.ok ? (t.text ? `. Said: "${t.text.slice(0, 4000)}"` : ". There is no speech in it.") : `. Could not listen: ${t.error}`}`);
    }
  }
  return { lines, read };
}
