// Sosyal gönderiyi görsele (Instagram slaytları) ya da videoya (Reels) çevirir.
// Remotion ayrı bir pakette (render/) ve ayrı bir süreçte çalışır; aynı anda tek render (bellek).
// Ücretsiz: her şey bu Mac'te üretilir, dış servis yok.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { killTree } from "../shared/platform.mjs";
import { fileURLToPath } from "node:url";
import { MEDIA_DIR } from "./store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "render", "render.mjs");
const LIMIT_MS = 12 * 60 * 1000; // sesli Reels uzun sürebilir
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
      } catch { /* aşağıda hata */ }
      resolve({ ok: false, error: (err || out || `Çıkış kodu ${code}`).trim().split("\n").slice(-3).join(" ") });
    });
  });
}

// Sonuç: { ok, files: { images: ["media/..."], video?: "media/..." } } ya da { ok: false, error }.
// template: görsel şablonu (render/src/look.tsx TEMPLATES); yoksa varsayılan.
// kit: projenin görünümü (project.kit); post'un sahne/slaytlarında media varsa gerçek kayıtlı şablon kullanılır.
// scale: slaytları büyütür (LinkedIn görseli: 1200/1080 → 1200x1500).
export function renderPost(runId, post, account, template, signal, kit, scale) {
  if (!canRender()) return Promise.resolve({ ok: false, error: "Render paketi kurulu değil: render/ içinde npm install" });
  const kind = post.format === "ig_reel" || post.format === "short" ? "reel" : post.format === "ig_post" ? "slides" : null;
  if (!kind) return Promise.resolve({ ok: true, files: {} });
  const job = queue.then(() => (signal?.aborted ? { cancelled: true } : run({ kind, post, account, template, kit, ...(scale ? { scale } : {}), outDir: MEDIA_DIR, name: `${runId}-${Date.now().toString(36)}` }, signal)));
  queue = job.catch(() => {});
  return job.then((r) => (r.ok ? { ok: true, files: { images: r.images.map((f) => `media/${f}`), ...(r.video ? { video: `media/${r.video}` } : {}) } } : r));
}

// Sesli Reels'in görüntüsü (render/src/VoiceReel.tsx). Sonuç: { ok, files: { images, video } } ya da { ok: false, error }.
export function renderVoice(runId, chunks, durationMs, account, template, signal, beats = []) {
  if (!canRender()) return Promise.resolve({ ok: false, error: "Render paketi kurulu değil: render/ içinde npm install" });
  const job = queue.then(() => (signal?.aborted ? { cancelled: true } : run({ kind: "voice", chunks, beats, durationMs, account, template, outDir: MEDIA_DIR, name: `${runId}-v${Date.now().toString(36)}` }, signal)));
  queue = job.catch(() => {});
  return job.then((r) => (r.ok ? { ok: true, files: { images: r.images.map((f) => `media/${f}`), video: `media/${r.video}` } } : r));
}

// Yalnız kareler (inceleme için): Reels'te verilen milisaniyeler, gönderide bütün slaytlar. Sonuç: { ok, files: ["/mutlak/yol.jpg"] }.
export function renderStills(runId, post, account, kit, ms, outDir, signal) {
  if (!canRender()) return Promise.resolve({ ok: false, error: "Render paketi kurulu değil" });
  const kind = post.format === "ig_post" ? "slides" : "reel";
  const job = queue.then(() => (signal?.aborted ? { cancelled: true } : run({ kind, post, account, kit, stills: kind === "reel" ? ms : undefined, outDir, name: `${runId}-chk${Date.now().toString(36)}` }, signal)));
  queue = job.catch(() => {});
  return job.then((r) => (r.ok ? { ok: true, files: r.images.map((f) => path.join(outDir, f)) } : r));
}
