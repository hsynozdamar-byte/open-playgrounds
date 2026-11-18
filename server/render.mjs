// Turns a social post into images (Instagram slides) or a video (Reels).
// Remotion lives in a separate package (render/) and runs in a separate process; one render at a time (memory).
// Free: everything is made on this computer, no outside service.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { killTree } from "../shared/platform.mjs";
import { fileURLToPath } from "node:url";
import { MEDIA_DIR } from "./store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "render", "render.mjs");
const LIMIT_MS = 12 * 60 * 1000; // a voiced Reel can take long
let queue = Promise.resolve();

export const canRender = () => fs.existsSync(path.join(ROOT, "render", "node_modules", "@remotion", "renderer"));

function run(spec, signal) {
  return new Promise((resolve) => {
    const file = path.join(os.tmpdir(), `pg-render-${spec.name}.json`);
    fs.writeFileSync(file, JSON.stringify(spec));
    const child = spawn(process.execPath, [CLI, file], { cwd: path.join(ROOT, "render"), stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
    const kill = () => killTree(child.pid);
    let out = "", err = "";
    child.stdout.setEncoding("utf8").on("data", (c) => (out += c));
    child.stderr.setEncoding("utf8").on("data", (c) => (err += c));
    const timer = setTimeout(kill, LIMIT_MS);
    const onAbort = () => kill();
    signal?.addEventListener("abort", onAbort);
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fs.rmSync(file, { force: true });
      if (signal?.aborted) return resolve({ cancelled: true });
      const last = out.trim().split("\n").pop() ?? "";
      try {
        const j = JSON.parse(last);
        if (code === 0 && j.ok) return resolve({ ok: true, ...j });
      } catch { /* error below */ }
      resolve({ ok: false, error: (err || out || `Exit code ${code}`).trim().split("\n").slice(-3).join(" ") });
    });
  });
}

// Result: { ok, files: { images: ["media/..."], video?: "media/..." } } or { ok: false, error }.
// template: the look template (render/src/look.tsx TEMPLATES); default when missing.
// kit: the project's look (project.kit); when the post's scenes/slides have media, the real recorded template is used.
// scale: enlarges the slides (LinkedIn image: 1200/1080 → 1200x1500).
export function renderPost(runId, post, account, template, signal, kit, scale) {
  if (!canRender()) return Promise.resolve({ ok: false, error: "The render package is not installed: run npm install in render/" });
  const kind = post.format === "ig_reel" || post.format === "short" ? "reel" : post.format === "ig_post" ? "slides" : null;
  if (!kind) return Promise.resolve({ ok: true, files: {} });
  const job = queue.then(() => (signal?.aborted ? { cancelled: true } : run({ kind, post, account, template, kit, ...(scale ? { scale } : {}), outDir: MEDIA_DIR, name: `${runId}-${Date.now().toString(36)}` }, signal)));
  queue = job.catch(() => {});
  return job.then((r) => (r.ok ? { ok: true, files: { images: r.images.map((f) => `media/${f}`), ...(r.video ? { video: `media/${r.video}` } : {}) } } : r));
}

// The picture of a voiced Reel (render/src/VoiceReel.tsx). Result: { ok, files: { images, video } } or { ok: false, error }.
export function renderVoice(runId, chunks, durationMs, account, template, signal, beats = []) {
  if (!canRender()) return Promise.resolve({ ok: false, error: "The render package is not installed: run npm install in render/" });
  const job = queue.then(() => (signal?.aborted ? { cancelled: true } : run({ kind: "voice", chunks, beats, durationMs, account, template, outDir: MEDIA_DIR, name: `${runId}-v${Date.now().toString(36)}` }, signal)));
  queue = job.catch(() => {});
  return job.then((r) => (r.ok ? { ok: true, files: { images: r.images.map((f) => `media/${f}`), video: `media/${r.video}` } } : r));
}

// Stills only (for review): the given milliseconds for Reels, all slides for a post. Result: { ok, files: ["/absolute/path.jpg"] }.
export function renderStills(runId, post, account, kit, ms, outDir, signal) {
  if (!canRender()) return Promise.resolve({ ok: false, error: "The render package is not installed" });
  const kind = post.format === "ig_post" ? "slides" : "reel";
  const job = queue.then(() => (signal?.aborted ? { cancelled: true } : run({ kind, post, account, kit, stills: kind === "reel" ? ms : undefined, outDir, name: `${runId}-chk${Date.now().toString(36)}` }, signal)));
  queue = job.catch(() => {});
  return job.then((r) => (r.ok ? { ok: true, files: r.images.map((f) => path.join(outDir, f)) } : r));
}
