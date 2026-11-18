#!/usr/bin/env node
// Gönderiyi görsele/videoya çevirir. server/render.mjs ayrı bir süreç olarak çağırır:
//   node render/render.mjs <spec.json>
// spec: { kind: "slides" | "reel" | "voice" | "scene" (id, props?, coverMs?), post, chunks?, durationMs?, account: { name, handle, color }, template?: "night" | "paper" | "bold", outDir, name }
// Çıktı (son satır JSON): { ok, images: [dosya adları], video?: dosya adı }
// Paket bir kez derlenir (render/.cache/bundle), kaynak değişince yeniden.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, ".cache", "bundle");
const SOURCES = [path.join(ROOT, "src"), path.join(ROOT, "..", "shared", "social.mjs")];

const newest = (p) => {
  const st = fs.statSync(p);
  return st.isDirectory() ? Math.max(0, ...fs.readdirSync(p).map((f) => newest(path.join(p, f)))) : st.mtimeMs;
};
async function serveUrl() {
  const stamp = path.join(OUT, ".stamp");
  const src = Math.max(...SOURCES.map(newest));
  if (fs.existsSync(stamp) && +fs.readFileSync(stamp, "utf8") >= src) return OUT;
  fs.rmSync(OUT, { recursive: true, force: true });
  const url = await bundle({ entryPoint: path.join(ROOT, "src", "index.ts"), outDir: OUT });
  fs.writeFileSync(stamp, String(src));
  return url;
}

const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const url = await serveUrl();
const account = { name: spec.account.name || "", handle: spec.account.handle || "", color: spec.account.color || "#3b86e8" };
fs.mkdirSync(spec.outDir, { recursive: true });
const images = [];
let video;

// Projenin kayıtları ve görünüm dosyaları (spec.media, spec.kit mutlak yollarla gelir): pakette public/pg/<ad>/ altına bağlanır,
// render bitince silinir. Aynı diskteyse kopya yerine sabit bağ (büyük videolar için).
const PUB = path.join(OUT, "public", "pg", spec.name);
let linked = 0;
function link(file) {
  if (!file || !fs.existsSync(file)) return null;
  fs.mkdirSync(PUB, { recursive: true });
  const rel = `pg/${spec.name}/${linked++}${path.extname(file).toLowerCase()}`;
  const dest = path.join(OUT, "public", rel);
  try { fs.linkSync(file, dest); } catch { fs.copyFileSync(file, dest); }
  return rel;
}
const linkMedia = (m) => {
  if (!m?.file) return undefined;
  const src = link(m.file);
  return src ? { src, kind: m.kind, w: m.w, h: m.h, from: m.from ?? 0, ...(m.art ? { art: true } : {}) } : undefined;
};
const kit = spec.kit ? { ...spec.kit, assets: undefined, fonts: (spec.kit.fonts ?? []).map((f) => ({ ...f, file: link(f.file) })).filter((f) => f.file), logo: link(spec.kit.logo) ?? undefined, logoDark: link(spec.kit.logoDark) ?? undefined, badge: link(spec.kit.badge) ?? undefined, icon: link(spec.kit.icon) ?? undefined, bgImage: link(spec.kit.bgImage) ?? undefined } : undefined;
const foot = !!spec.kit || [...(spec.post?.scenes ?? []), ...(spec.post?.slides ?? [])].some((x) => x.media);
process.on("exit", () => fs.rmSync(PUB, { recursive: true, force: true }));
// Bellek: tek seferde en fazla 2 sekme.
const concurrency = 2;

if (spec.kind === "slides") {
  const slides = spec.post.slides;
  for (let i = 0; i < slides.length; i++) {
    const inputProps = foot
      ? { account, kit, index: i, slides: slides.map((x) => ({ title: x.title, text: x.text, media: linkMedia(x.media), bg: linkMedia(x.bg) })) }
      : { account, slides, index: i, template: spec.template };
    const comp = await selectComposition({ serveUrl: url, id: foot ? (spec.post.wide ? "footcover" : "footslide") : "slide", inputProps });
    const file = `${spec.name}-${i + 1}.png`;
    // spec.scale: büyütülmüş çıktı (LinkedIn görseli 1080x1350 yerine 1200x1500).
    await renderStill({ composition: comp, serveUrl: url, output: path.join(spec.outDir, file), inputProps, imageFormat: "png", ...(spec.scale ? { scale: spec.scale } : {}) });
    images.push(file);
  }
} else if (spec.kind === "scene") {
  // Koddan kurulmuş tek seferlik sahne (Root'ta spec.id): ekran kaydı yerine olayın kendisi yeniden çizilir.
  const inputProps = spec.props ?? {};
  // props.clips: { ad: mutlak yol } → pakete bağlanmış göreli yol (gerçek kayıtlar sahnede oynar).
  if (inputProps.clips) inputProps.clips = Object.fromEntries(Object.entries(inputProps.clips).map(([k, f]) => [k, link(f) ?? undefined]));
  const comp = await selectComposition({ serveUrl: url, id: spec.id, inputProps });
  const at = (ms) => Math.min(comp.durationInFrames - 1, Math.round((ms / 1000) * comp.fps));
  for (const ms of spec.stills ?? []) {
    const file = `${spec.name}-${ms}.jpg`;
    await renderStill({ composition: comp, serveUrl: url, output: path.join(spec.outDir, file), inputProps, frame: at(ms), imageFormat: "jpeg", jpegQuality: 85 });
    images.push(file);
  }
  if (spec.stills) { console.log(JSON.stringify({ ok: true, images })); process.exit(0); }
  video = `${spec.name}.mp4`;
  await renderMedia({ composition: comp, serveUrl: url, codec: "h264", outputLocation: path.join(spec.outDir, video), inputProps, concurrency, crf: 18, pixelFormat: "yuv420p" });
  const cover = `${spec.name}-cover.jpg`;
  await renderStill({ composition: comp, serveUrl: url, output: path.join(spec.outDir, cover), inputProps, frame: at(spec.coverMs ?? 0), imageFormat: "jpeg", jpegQuality: 90 });
  images.push(cover);
} else if (spec.kind === "voice") {
  // Sesli Reels: görüntü sessiz üretilir, ses sunucuda ffmpeg ile eklenir.
  const inputProps = { account, chunks: spec.chunks, beats: spec.beats ?? [], durationMs: spec.durationMs, template: spec.template };
  const comp = await selectComposition({ serveUrl: url, id: "voicereel", inputProps });
  // Yalnız kareler (kontrol): spec.stills = [ms, ...] verilirse video üretilmez.
  if (spec.stills) {
    for (const ms of spec.stills) {
      const file = `${spec.name}-${ms}.jpg`;
      await renderStill({ composition: comp, serveUrl: url, output: path.join(spec.outDir, file), inputProps, frame: Math.min(comp.durationInFrames - 1, Math.round((ms / 1000) * comp.fps)), imageFormat: "jpeg", jpegQuality: 85 });
      images.push(file);
    }
    console.log(JSON.stringify({ ok: true, images }));
    process.exit(0);
  }
  video = `${spec.name}.mp4`;
  await renderMedia({ composition: comp, serveUrl: url, codec: "h264", outputLocation: path.join(spec.outDir, video), inputProps, concurrency, crf: 20, pixelFormat: "yuv420p" });
  const cover = `${spec.name}-cover.jpg`;
  await renderStill({ composition: comp, serveUrl: url, output: path.join(spec.outDir, cover), inputProps, frame: Math.min(comp.durationInFrames - 1, 45), imageFormat: "jpeg", jpegQuality: 88 });
  images.push(cover);
} else {
  const inputProps = foot
    ? { account, kit, hook: spec.post.hook, scenes: spec.post.scenes.map((x) => ({ text: x.text, sec: x.sec, accent: x.accent, media: linkMedia(x.media), asset: linkMedia(x.asset), act: x.act })) }
    : { account, hook: spec.post.hook, scenes: spec.post.scenes, template: spec.template };
  const comp = await selectComposition({ serveUrl: url, id: foot ? "footreel" : "reel", inputProps });
  if (spec.stills) {
    for (const ms of spec.stills) {
      const file = `${spec.name}-${ms}.jpg`;
      await renderStill({ composition: comp, serveUrl: url, output: path.join(spec.outDir, file), inputProps, frame: Math.min(comp.durationInFrames - 1, Math.round((ms / 1000) * comp.fps)), imageFormat: "jpeg", jpegQuality: 85 });
      images.push(file);
    }
    console.log(JSON.stringify({ ok: true, images }));
    process.exit(0);
  }
  video = `${spec.name}.mp4`;
  await renderMedia({ composition: comp, serveUrl: url, codec: "h264", outputLocation: path.join(spec.outDir, video), inputProps, concurrency, crf: 20, pixelFormat: "yuv420p" });
  // Kapak: hook tamamen göründüğü an.
  const cover = `${spec.name}-cover.jpg`;
  await renderStill({ composition: comp, serveUrl: url, output: path.join(spec.outDir, cover), inputProps, frame: Math.min(comp.durationInFrames - 1, foot ? 20 : 40), imageFormat: "jpeg", jpegQuality: 88 });
  images.push(cover);
}

console.log(JSON.stringify({ ok: true, images, ...(video ? { video } : {}) }));
