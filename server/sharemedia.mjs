// Files to share, in the format the platform accepts. LinkedIn takes only one video in a post and does not mix video
// with images: if the post has a video and more than one attachment, they are all merged in order into one video
// (images become 4-second frames). The merged video is data/media/<runId>-li.mp4; it is rebuilt when the attachments change.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, MEDIA_DIR } from "./store.mjs";
import { FFMPEG, FFPROBE } from "../shared/platform.mjs";

const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const STILL_SEC = 4;
const even = (n) => Math.ceil(n / 2) * 2;

// run.order: the carousel order Rou gave. A file not in the list goes last, a line for a file that no longer exists is skipped.
export const ordered = (run, files) => {
  const at = (f) => { const i = (run.order ?? []).indexOf(f); return i < 0 ? Infinity : i; };
  return files.map((f, i) => [f, i]).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map((x) => x[0]);
};

export function shareFiles(run, platform) {
  // Video + separate images (not the cover): on X both are shared (video in the first tweet, images in the reply; publish.mjs).
  const extra = (run.images ?? []).filter((f) => !/-cover\./.test(f) && f !== `media/${run.id}-0.jpg` && f !== `media/${run.id}-0.png`);
  // An Instagram carousel (ig_post) carries the video and the images together, in run.order (the bento cover first).
  const mixed = platform === "instagram" && run.post?.format === "ig_post" && run.video && extra.length;
  const rel = mixed ? ordered(run, [run.video, ...extra]).slice(0, 10)
    : run.video ? (platform === "x" && extra.length ? [run.video, ...extra.slice(0, 4)] : [run.video]) : run.images ?? [];
  const files = rel.map((f) => path.join(DATA_DIR, f));
  // run.noMerge: the user wanted the video and the images separately (e.g. splash + photos); they are not merged into one video.
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

// The padding is filled with the colour of the file's top-left corner so no band shows between attachments of different sizes.
function corner(f) {
  const px = execFileSync(FFMPEG, ["-v", "error", "-i", f, "-frames:v", "1", "-vf", "crop=2:2:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return `0x${[...px.subarray(0, 3)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function merge(files, out) {
  const sizes = files.map(probe);
  // Canvas: the widest and tallest attachment; fits LinkedIn's maximum width of 1920.
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
