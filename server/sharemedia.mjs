// Paylaşılacak dosyalar, platformun kabul ettiği biçimde. LinkedIn bir gönderide yalnız tek video alır, video ile
// görseli de karıştırmaz: gönderide video varsa ve birden çok ek varsa hepsi sırasıyla tek videoda birleşir
// (görseller 4 sn'lik kare olur). Birleşen video data/media/<runId>-li.mp4; ekler değişince yeniden üretilir.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, MEDIA_DIR } from "./store.mjs";
import { FFMPEG, FFPROBE } from "../shared/platform.mjs";

const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const STILL_SEC = 4;
const even = (n) => Math.ceil(n / 2) * 2;

// run.order: Rou'nun verdiği carousel sırası. Listede olmayan dosya sona gider, artık var olmayan satır atlanır.
export const ordered = (run, files) => {
  const at = (f) => { const i = (run.order ?? []).indexOf(f); return i < 0 ? Infinity : i; };
  return files.map((f, i) => [f, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map((x) => x[0]);
};

export function shareFiles(run, platform) {
  // Video + ayrı görseller (kapak değil): X'te ikisi de paylaşılır (video ilk tweette, görseller yanıtta; publish.mjs).
  const extra = (run.images ?? []).filter((f) => !/-cover\./.test(f) && f !== `media/${run.id}-0.jpg` && f !== `media/${run.id}-0.png`);
  // Instagram carousel'i (ig_post) video ile görselleri birlikte taşır, run.order sırasıyla (kapak bento önce).
  const mixed = platform === "instagram" && run.post?.format === "ig_post" && run.video && extra.length;
  const rel = mixed ? ordered(run, [run.video, ...extra]).slice(0, 10)
    : run.video ? (platform === "x" && extra.length ? [run.video, ...extra.slice(0, 4)] : [run.video]) : run.images ?? [];
  const files = rel.map((f) => path.join(DATA_DIR, f));
  // run.noMerge: kullanıcı video ile görselleri ayrı ayrı istedi (ör. splash + fotoğraflar); tek videoda birleştirilmez.
  if (run.noMerge || platform !== "linkedin" || files.length < 2 || !files.some((f) => VIDEO.test(f))) return files;
  const out = path.join(MEDIA_DIR, `${run.id}-li.mp4`);
  const newest = Math.max(...files.map((f) => fs.statSync(f).mtimeMs));
  if (fs.existsSync(out) && fs.statSync(out).mtimeMs > newest) return [out];
  merge(files, out);
  return [out];
}

function probe(f) {
  const [w, h] = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], { encoding: "utf8" }).trim().split(",").map(Number);
  return { w, h };
}

// Kenar boşluğu, dosyanın sol üst köşesindeki renkle dolar; böylece farklı boyutlu ekler arasında şerit görünmez.
function corner(f) {
  const px = execFileSync(FFMPEG, ["-v", "error", "-i", f, "-frames:v", "1", "-vf", "crop=2:2:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return `0x${[...px.subarray(0, 3)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function merge(files, out) {
  const sizes = files.map(probe);
  // Tuval: en geniş ve en yüksek ek; LinkedIn'in en büyük 1920 genişliğine sığar.
  const k = Math.min(1, 1920 / Math.max(...sizes.map((s) => s.w)));
  const W = even(Math.max(...sizes.map((s) => s.w)) * k), H = even(Math.max(...sizes.map((s) => s.h)) * k);
  const args = ["-y", "-v", "error"];
  files.forEach((f) => (VIDEO.test(f) ? args.push("-i", f) : args.push("-loop", "1", "-t", String(STILL_SEC), "-i", f)));
  const chains = files.map((f, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${corner(f)},fps=30,format=yuv420p,setsar=1[v${i}]`);
  const graph = `${chains.join(";")};${files.map((_, i) => `[v${i}]`).join("")}concat=n=${files.length}:v=1:a=0[out]`;
  const tmp = out.replace(/\.mp4$/, ".tmp.mp4");
  execFileSync(FFMPEG, [...args, "-filter_complex", graph, "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-movflags", "+faststart", tmp], { stdio: "ignore", timeout: 5 * 60 * 1000 });
  fs.renameSync(tmp, out);
}
