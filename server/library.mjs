// Projenin medya kütüphanesi: diskteki bir klasördeki videolar ve görseller (project.mediaDir).
// Kullanıcı her birini "İyi" ya da "Kötü" diye işaretler (project.media[rel]); otomasyonlar yalnız iyileri kullanır.
// Dosyalar yerinde kalır, kopyalanmaz. Yol her istekte klasörün içinde mi diye denetlenir.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { read, DATA_DIR } from "./store.mjs";

export const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
export const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
const SKIP = /^(node_modules|frames|probe|\..*)$/;
const MAX = 600;
// store.mjs ile döngüsel içe aktarma var (store → prepare → library): yol ilk kullanımda hesaplanır.
const thumbsDir = () => path.join(DATA_DIR, "thumbs");

export const expand = (p) => path.resolve(String(p || "").replace(/^~(?=\/|$)/, os.homedir()));
export const dirOf = (projectId) => {
  const p = read().state.projects.find((x) => x.id === projectId);
  return p?.mediaDir ? expand(p.mediaDir) : null;
};
// Projenin bütün medya klasörleri: ilki mediaDir, sonrakiler mediaDirs. Ham yazımla (~/...) döner.
export const dirsOf = (projectId) => {
  const p = read().state.projects.find((x) => x.id === projectId);
  return [...new Set([p?.mediaDir, ...(p?.mediaDirs ?? [])].filter(Boolean))];
};
// Dosya anahtarı: ilk klasördeki dosya için klasöre göre yol (eski işaretler bozulmasın), diğerleri için "klasör::yol".
export const keyOf = (dirs, i, rel) => (i === 0 ? rel : `${dirs[i]}::${rel}`);
export function fileOfKey(projectId, key) {
  const dirs = dirsOf(projectId);
  if (typeof key !== "string" || !dirs.length) return null;
  const k = key.indexOf("::");
  if (k < 0) return fileOf(expand(dirs[0]), key);
  const d = key.slice(0, k);
  return dirs.includes(d) ? fileOf(expand(d), key.slice(k + 2)) : null;
}
// Bütün klasörlerin medyası tek listede, en yeni önce. Okunamayan klasör hata listesine düşer, diğerleri gelir.
export function listAll(projectId) {
  const dirs = dirsOf(projectId);
  if (!dirs.length) return { ok: false, error: "Klasör yok" };
  const items = [];
  const missing = [];
  dirs.forEach((d, i) => {
    const r = list(expand(d));
    if (!r.ok) return void missing.push(d);
    for (const it of r.items) items.push({ ...it, key: keyOf(dirs, i, it.rel), dir: d });
  });
  return { ok: true, items: items.sort((a, b) => b.at.localeCompare(a.at)), missing };
}

// Klasördeki medya, en yeni önce. Derinlik sınırlı; render ara dosyaları (frames, probe) atlanır.
export function list(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, error: "Klasör yok" };
  const out = [];
  const walk = (d, depth) => {
    if (out.length >= MAX) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.test(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(f, depth + 1); continue; }
      const kind = VIDEO.test(e.name) ? "video" : IMAGE.test(e.name) ? "image" : null;
      if (!kind) continue;
      const st = fs.statSync(f);
      out.push({ rel: path.relative(dir, f), kind, size: st.size, at: st.mtime.toISOString() });
      if (out.length >= MAX) return;
    }
  };
  walk(dir, 0);
  return { ok: true, items: out.sort((a, b) => b.at.localeCompare(a.at)) };
}

// rel klasörün içinde kalmalı ve medya olmalı. mediaDir istemcinin yazabildiği veridir (PUT /api/state):
// klasör ev dizinine çevrilse bile buradan yalnız görsel ve video okunur, bağlantı (symlink) klasörün dışına çıkaramaz.
export function fileOf(dir, rel) {
  if (!dir || typeof rel !== "string") return null;
  // Sitenin adresiyle yazılmış anahtar ("/landing/x.webp") klasörün içinden okunur.
  const f = path.resolve(dir, rel.replace(/^\/+/, ""));
  if (!f.startsWith(dir + path.sep) || !(VIDEO.test(f) || IMAGE.test(f))) return null;
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) return null;
  try { return fs.realpathSync(f).startsWith(fs.realpathSync(dir) + path.sep) ? f : null; } catch { return null; }
}

// Küçük resim: videonun 1. saniyesi (kısa videoda ilk kare), 360 px. data/thumbs'ta saklanır.
export function thumb(file) {
  fs.mkdirSync(thumbsDir(), { recursive: true });
  const st = fs.statSync(file);
  const out = path.join(thumbsDir(), crypto.createHash("sha1").update(`${file}:${st.mtimeMs}`).digest("hex").slice(0, 20) + ".jpg");
  if (fs.existsSync(out)) return Promise.resolve(out);
  const args = (ss) => ["-y", "-loglevel", "error", ...(ss ? ["-ss", ss] : []), "-i", file, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "5", out];
  const run = (a) => new Promise((res) => { const p = spawn("ffmpeg", a); p.on("error", () => res(false)); p.on("exit", (c) => res(c === 0 && fs.existsSync(out))); });
  return run(args(VIDEO.test(file) ? "1" : null)).then((ok) => (ok || !VIDEO.test(file) ? ok : run(args(null)))).then((ok) => (ok ? out : null));
}

// Ölçü ve süre (ffprobe), dosya + değişme zamanına göre bellekte tutulur. Görselde süre 0.
const probes = new Map();
export function probe(file) {
  const st = fs.statSync(file);
  const k = `${file}:${st.mtimeMs}`;
  if (probes.has(k)) return probes.get(k);
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8" });
  let out = null;
  try {
    const j = JSON.parse(r.stdout);
    const s = j.streams?.[0];
    if (s?.width) out = { w: s.width, h: s.height, dur: VIDEO.test(file) ? Number(j.format?.duration) || 0 : 0, kind: VIDEO.test(file) ? "video" : "image" };
  } catch { /* okunamadı */ }
  probes.set(k, out);
  return out;
}

// Videonun bir karesi (gönderi slaytı için), data/thumbs'ta tam boy png.
export function frameAt(file, sec) {
  fs.mkdirSync(thumbsDir(), { recursive: true });
  const st = fs.statSync(file);
  const out = path.join(thumbsDir(), crypto.createHash("sha1").update(`${file}:${st.mtimeMs}:${sec}`).digest("hex").slice(0, 20) + "-full.png");
  if (!fs.existsSync(out)) spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(sec), "-i", file, "-frames:v", "1", out]);
  return fs.existsSync(out) ? out : null;
}

// Gönderinin seçtiği kayıtları (scene.clip / slide.image = medya adı) dosyaya çevirir: render'a { file, kind, w, h, from } gider.
// Bilinmeyen ad atlanır; başlangıç sahne kayıttan taşmasın diye kısılır.
// Sahnede kayıt yerine kaynağın kendi görseli (ör. haberin sitedeki kapağı) adresle verilebilir: bir kez indirilir, data/media/web-* olarak saklanır.
// Görselde haber kaynağının logosu/filigranı varsa adresin sonuna #crop=sol,üst,sağ,alt (0-0.6 oran) yazılır: o kenarlar kırpılır. Yatay kapakta yalnız ürünün durduğu yarıyı almak için sol ya da sağ 0.6ya kadar çıkabilir.
function webFile(ref) {
  const [url, frag = ""] = ref.split("#");
  const ext = (url.match(/\.(png|jpe?g|webp|gif)(?:\?|$)/i)?.[1] ?? "jpg").toLowerCase();
  const file = path.join(DATA_DIR, "media", `web-${crypto.createHash("sha1").update(url).digest("hex").slice(0, 16)}.${ext}`);
  if (!(fs.existsSync(file) && fs.statSync(file).size > 0)) {
    const r = spawnSync("curl", ["-sfL", "-m", "25", "-o", file, url]);
    if (r.status !== 0 || !fs.existsSync(file) || fs.statSync(file).size < 500) { fs.rmSync(file, { force: true }); return null; }
  }
  const c = /crop=([\d.]+),([\d.]+),([\d.]+),([\d.]+)/.exec(frag)?.slice(1).map((x) => Math.min(0.6, Math.max(0, Number(x) || 0)));
  if (!c || c.every((x) => x === 0)) return file;
  const out = file.replace(/\.[a-z]+$/, `-c${c.map((x) => Math.round(x * 1000)).join("-")}.png`);
  if (fs.existsSync(out)) return out;
  const [l, t, rr, b] = c;
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", `crop=iw*${(1 - l - rr).toFixed(4)}:ih*${(1 - t - b).toFixed(4)}:iw*${l}:ih*${t}`, "-frames:v", "1", out]);
  return r.status === 0 && fs.existsSync(out) ? out : file;
}

export function attachMedia(projectId, post) {
  if (!projectId || !post) return post;
  const st = read().state;
  const pr = st.projects.find((x) => x.id === projectId);
  const kit = pr?.kit ?? st.worlds.find((w) => w.id === pr?.worldId)?.kit;
  const assetOf = (name) => {
    const a = name && kit?.assets?.find((x) => x.name === name);
    return a && fs.existsSync(a.file) ? { file: a.file, kind: "image", w: 1, h: 1, from: 0 } : undefined;
  };
  const one = (key, from, need) => {
    // Revize eki (kullanıcının yüklediği ya da Rou'nun eklediği data/media/rou-* dosyası) adıyla verilir.
    const upload = typeof key === "string" && /^rou-[a-z0-9]+\.[a-z0-9]+$/i.test(key) && path.join(DATA_DIR, "media", key);
    const file = key && (upload && fs.existsSync(upload) ? upload : /^https?:\/\//.test(key) ? webFile(key) : fileOfKey(projectId, key));
    const m = file && probe(file);
    if (!m) return undefined;
    const f = m.kind === "video" ? Math.max(0, Math.min(Number(from) || 0, m.dur - need - 0.2)) : 0;
    return { file, kind: m.kind, w: m.w, h: m.h, from: Math.round(f * 10) / 10 };
  };
  // Kayıt yoksa sahne vurucu karttır: obje (asset).
  if (post.scenes) return { ...post, scenes: post.scenes.map((x, i) => {
    const media = one(x.clip, x.from, x.sec + (i === 0 && post.hook ? 2.2 : 0));
    if (media) return { ...x, media, asset: undefined };
    return { ...x, media: undefined, asset: assetOf(x.asset) };
  }) };
  if (post.slides) return { ...post, slides: post.slides.map((x) => {
    const m = one(x.image, x.from, 0);
    if (m?.kind !== "video") return { ...x, media: m };
    const png = frameAt(m.file, m.from);
    return { ...x, media: png ? { file: png, kind: "image", w: m.w, h: m.h, from: 0 } : undefined };
  }) };
  return post;
}

// Kaydın zaman çizelgesi: eşit aralıklı kareler tek görselde (8 sütun, 240 px), soldan sağa, yukarıdan aşağı.
// İnceleme geçişi bir sahnenin hangi saniyeden başlaması gerektiğini buna bakarak seçer. Sonuç: { file, step } ya da null.
export function timeline(file) {
  const m = probe(file);
  if (!m || m.kind !== "video" || !m.dur) return null;
  fs.mkdirSync(thumbsDir(), { recursive: true });
  const step = Math.max(1.5, Math.round((m.dur / 24) * 2) / 2);
  const st = fs.statSync(file);
  const out = path.join(thumbsDir(), crypto.createHash("sha1").update(`${file}:${st.mtimeMs}:tl${step}`).digest("hex").slice(0, 20) + "-tl.jpg");
  if (!fs.existsSync(out)) spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-vf", `fps=1/${step},scale=240:-2,tile=8x${Math.ceil(m.dur / step / 8)}`, "-frames:v", "1", "-q:v", "5", out]);
  return fs.existsSync(out) ? { file: out, step } : null;
}
