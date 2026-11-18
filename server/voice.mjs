// Voiced Reels: the voice the user recorded (POST /api/run-voice) is transcribed (with word timings),
// a vertical video with word-by-word captions is rendered, and the voice is added. All local and free (whisper.cpp + Remotion + ffmpeg).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { read, update, MEDIA_DIR } from "./store.mjs";
import { mediaPath } from "./attach.mjs";
import { renderVoice } from "./render.mjs";
import { renderAccount } from "./prepare.mjs";
import { accountOf, taskRef } from "../shared/social.mjs";
import { alignBeats } from "../shared/storyboard.mjs";
import { HEADLESS } from "../shared/headless.mjs";
import { FFMPEG, FFPROBE } from "../shared/platform.mjs";

const CHROME = HEADLESS;
// For speech: cut low rumble, reduce noise, compress, bring to Instagram level (-14 LUFS, peak -1.5 dBTP).
const VOICE_CHAIN = "highpass=f=80,lowpass=f=12000,afftdn=nf=-25,acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2,loudnorm=I=-14:TP=-1.5:LRA=9";

// A shot of a real page (scene kind screen): taken with headless Chrome at phone width (420 px, 2.5x) so its text is readable in the video, converted to a jpeg data URL.
async function capture(url, dir, i) {
  const png = path.join(dir, `s${i}.png`);
  const r = await sh(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${path.join(dir, "chrome")}`, "--hide-scrollbars", "--force-device-scale-factor=2.5", "--window-size=420,1500", "--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", `--screenshot=${png}`, url], 60 * 1000);
  if (!r.ok || !fs.existsSync(png)) return undefined;
  const jpg = path.join(dir, `s${i}.jpg`);
  await sh(FFMPEG, ["-y", "-v", "error", "-i", png, "-q:v", "5", jpg]);
  return fs.existsSync(jpg) ? `data:image/jpeg;base64,${fs.readFileSync(jpg).toString("base64")}` : undefined;
}

const WHISPER = process.env.PG_WHISPER || "whisper-cli";
const MODEL = process.env.PG_WHISPER_MODEL || path.join(os.homedir(), ".local/share/whisper/ggml-large-v3-turbo-q5_0.bin");
const busy = new Set();

function sh(cmd, args, ms = 10 * 60 * 1000) {
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
const setRun = (runId, p) => update((st) => { const r = st.runs.find((x) => x.id === runId); if (r) Object.assign(r, p); });
const tail = (s) => String(s || "").trim().split("\n").slice(-2).join(" ").slice(0, 240);

// whisper.cpp word output (-ml 1 -sow -oj): each piece is one word, times in ms.
export function wordsOf(json) {
  const out = [];
  for (const x of json.transcription ?? []) {
    const t = String(x.text ?? "").trim();
    if (!t || /^\[.*\]$/.test(t)) continue;
    out.push({ t, from: x.offsets.from, to: x.offsets.to });
  }
  return out;
}

// Caption chunks: at most 4 words or ~22 letters; a new chunk at a sentence end or a silence longer than 350 ms.
export function chunksOf(words) {
  const chunks = [];
  let cur = null;
  for (const w of words) {
    const gap = cur ? w.from - cur.to : 0;
    const len = cur ? cur.words.map((x) => x.t).join(" ").length + 1 + w.t.length : 0;
    if (!cur || cur.words.length >= 4 || len > 22 || gap > 350 || /[.!?…]$/.test(cur.words[cur.words.length - 1].t)) {
      cur = { words: [], from: w.from, to: w.to };
      chunks.push(cur);
    }
    cur.words.push(w);
    cur.to = w.to;
  }
  return chunks;
}

export function runVoice(runId, file) {
  const src = mediaPath(file);
  if (!src) return { ok: false, error: "Voice file not found" };
  const { state: s } = read();
  const run = s.runs.find((r) => r.id === runId);
  if (!run) return { ok: false, error: "No such output" };
  if (busy.has(runId)) return { ok: false, error: "The video is already being prepared" };
  if (!fs.existsSync(MODEL)) return { ok: false, error: "Speech recognition is not installed (no whisper model)" };
  busy.add(runId);
  setRun(runId, { voice: file, phase: "Transcribing the voice", renderError: undefined });
  const task = s.tasks.find((t) => t.id === run.taskId);
  const acc = accountOf(s, taskRef(s, task));
  const project = s.projects.find((p) => p.id === task?.projectId);
  const account = acc && task ? renderAccount(s, task, acc) : { name: project?.name ?? "", handle: "", color: s.worlds.find((w) => w.id === task?.worldId)?.color };
  (async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pg-voice-"));
    try {
      // The voice is cleaned first; the transcript and the video are built on this clean voice (timings match exactly).
      const clean = path.join(tmp, "clean.wav");
      const c = await sh(FFMPEG, ["-y", "-v", "error", "-i", src, "-vn", "-af", VOICE_CHAIN, "-ar", "48000", "-ac", "1", clean]);
      if (!c.ok) throw new Error(`Could not read the audio: ${tail(c.err)}`);
      const wav = path.join(tmp, "a.wav");
      const a = await sh(FFMPEG, ["-y", "-v", "error", "-i", clean, "-ar", "16000", "-ac", "1", wav]);
      if (!a.ok) throw new Error(`Could not read the audio: ${tail(a.err)}`);
      const dur = Number((await sh(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav])).out) || 0;
      if (dur < 1) throw new Error("The recording is too short");
      // Hint: the script that was read (so spellings come out right: radius, padding), then world/project names.
      const script = String(run.body ?? "").replace(/\*\*[^*]+\*\*/g, " ").replace(/\s+/g, " ").trim();
      const hint = [script, ...s.worlds.map((w) => w.name), ...s.projects.map((p) => p.name)].join(" ").slice(0, 700);
      const w = await sh(WHISPER, ["-m", MODEL, "-l", "auto", "-ml", "1", "-sow", "-oj", "-np", "--prompt", hint, "-of", path.join(tmp, "w"), "-f", wav]);
      if (!w.ok) throw new Error(`Could not transcribe the voice: ${tail(w.err)}`);
      const words = wordsOf(JSON.parse(fs.readFileSync(path.join(tmp, "w.json"), "utf8")));
      if (!words.length) throw new Error("No speech was heard in the recording");
      // Scenes: each scene of the script is placed at the moment its sentence starts in the voice; page scenes are shot.
      const sb = run.storyboard?.beats ?? [];
      const starts = alignBeats(sb, words);
      const beats = [];
      for (let i = 0; i < sb.length; i++) {
        const visual = { ...sb[i].visual };
        if (visual.kind === "screen") { setRun(runId, { phase: "Capturing the page" }); visual.image = await capture(visual.url, tmp, i); }
        beats.push({ start: starts[i], text: sb[i].text, visual });
      }
      setRun(runId, { phase: "Preparing the video" });
      const m = await renderVoice(runId, chunksOf(words), Math.round(dur * 1000), account, run.template, undefined, beats);
      if (!m.ok) throw new Error(m.error || "Could not render the video");
      setRun(runId, { phase: "Adding the voice" });
      const silent = path.join(MEDIA_DIR, path.basename(m.files.video));
      const out = silent.replace(/\.mp4$/, "-ses.mp4");
      const mux = await sh(FFMPEG, ["-y", "-v", "error", "-i", silent, "-i", clean, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]);
      if (!mux.ok) throw new Error(`Could not add the voice: ${tail(mux.err)}`);
      fs.rmSync(silent, { force: true });
      update((st) => {
        const r = st.runs.find((x) => x.id === runId);
        if (!r) return;
        delete r.phase;
        delete r.renderError;
        r.video = `media/${path.basename(out)}`;
        r.images = m.files.images;
        r.transcript = words.map((x) => x.t).join(" ");
      });
    } catch (e) {
      setRun(runId, { phase: undefined, renderError: String(e?.message ?? e).slice(0, 300) });
    } finally {
      busy.delete(runId);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  })();
  return { ok: true };
}
