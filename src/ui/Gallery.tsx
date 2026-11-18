import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import type { Run } from "../types";

// A post's attachments: images and videos in one strip that slides sideways like Instagram. The source comes from three places:
// run.video, run.images (under data/media) and image/video links written into the text (the assistant sometimes writes attachments that way).
export type MediaItem = { src: string; kind: "image" | "video"; remote?: boolean; poster?: string };

const VIDEO = /\.(mp4|mov|m4v|webm)(\?.*)?$/i;
const MEDIA_URL = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg|mp4|mov|m4v|webm)(\?\S*)?$/i;
const MEDIA_HEAD = /^(görseller|görsel|ekler|medya|videolar|images|media)\s*:?\s*$/i;
const GAP = 8;   // same as styles.css .galstrip gap
export const srcOf = (src: string) => (/^https?:/i.test(src) ? src : `/${src}`);
export const kindOf = (src: string): MediaItem["kind"] => (VIDEO.test(src) ? "video" : "image");

// Splits the text from the attachment links in it: link lines (and the "Images:" line above them) are taken out of the text.
export function splitBody(body: string) {
  const urls: string[] = [];
  const lines = body.split("\n");
  const keep = lines.filter((l, i) => {
    const t = l.trim().replace(/^[-•*]\s*/, "");
    if (MEDIA_URL.test(t)) return void urls.push(t);
    // Heading line: only if the first non-empty line below it is a link.
    if (MEDIA_HEAD.test(t)) { const next = lines.slice(i + 1).find((x) => x.trim()); return !(next && MEDIA_URL.test(next.trim().replace(/^[-•*]\s*/, ""))); }
    return true;
  });
  return { text: keep.join("\n").replace(/\n{3,}/g, "\n\n").trim(), urls };
}
// Text and remote attachments back into one body: attachments go at the end under "Images:".
export const joinBody = (text: string, urls: string[]) => (urls.length ? `${text.trim()}\n\nImages:\n${urls.join("\n")}` : text.trim());

// cover: when there is a video, the first image is its cover (render and pg run --video --img write it that way): shown as the video's poster, not as a separate attachment.
// The video's own cover: the render output (-cover.) or <runId>-0 given with `pg run --video --img`.
export const isCover = (r: Run, f?: string) => !!f && (/-cover\./.test(f) || new RegExp(`^media/${r.id}-0\\.(jpe?g|png)$`).test(f));
export function mediaOf(r: Run, cover = false): MediaItem[] {
  const imgs = r.images ?? [];
  // The cover is only the video's own cover (-cover.); separate images are not laid over the video as a cover.
  const poster = cover && r.video && isCover(r, imgs[0]) ? imgs[0] : undefined;
  const at = (m: MediaItem) => { const i = (r.order ?? []).indexOf(m.src); return i < 0 ? Infinity : i; };
  const own: MediaItem[] = [...(r.video ? [{ src: r.video, kind: "video" as const, ...(poster ? { poster } : {}) }] : []), ...(poster ? imgs.slice(1) : imgs).map((src) => ({ src, kind: kindOf(src) }))];
  const remote = r.post ? [] : splitBody(r.body ?? "").urls.map((src) => ({ src, kind: kindOf(src), remote: true }));
  // run.order: carousel order (the bento cover can come before the video); without an order the video stays first.
  if (r.order?.length) own.sort((a, b) => at(a) - at(b));
  return [...own, ...remote];
}

export function Gallery({ items, alt = [] }: { items: MediaItem[]; alt?: string[] }) {
  const [i, setI] = useState(0);
  // The strip's ratio follows the first attachment's own ratio: a portrait video is not squeezed into a square box (between 4:5 and 1.91:1; Instagram/LinkedIn limits).
  const [ratio, setRatio] = useState(1);
  const fit = (w: number, h: number) => w && h && setRatio(Math.min(1.91, Math.max(0.8, w / h)));
  const strip = useRef<HTMLDivElement>(null);
  const [big, setBig] = useState<MediaItem | null>(null);
  if (!items.length) return null;
  const n = items.length;
  // There is a GAP between slides; one step = strip width + gap.
  const step = (el: HTMLElement) => el.clientWidth + GAP;
  const go = (k: number) => strip.current?.scrollTo({ left: k * step(strip.current), behavior: "smooth" });
  return (
    <div className="gal">
      <div className="galstrip" ref={strip} style={{ aspectRatio: String(ratio) }} onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / step(e.currentTarget)))}>
        {items.map((m, k) => (
          <div key={m.src} className={`galitem ${/\.svg(\?|$)/i.test(m.src) ? "is-vector" : ""}`}>
            {m.kind === "video"
              ? <video src={srcOf(m.src)} poster={m.poster ? srcOf(m.poster) : undefined} controls playsInline preload="metadata" onLoadedMetadata={k === 0 ? (e) => fit(e.currentTarget.videoWidth, e.currentTarget.videoHeight) : undefined} />
              : <img src={srcOf(m.src)} alt={alt[k] ?? ""} loading="lazy" draggable={false} onLoad={k === 0 ? (e) => fit(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight) : undefined} />}
            {m.kind === "image" && <button className="galbig" onClick={(e) => (e.stopPropagation(), setBig(m))} aria-label="View full size" title="View full size"><Maximize2 size={14} /></button>}
          </div>
        ))}
      </div>
      {n > 1 && <>
        {i > 0 && <button className="pvnav prev" onClick={() => go(i - 1)} aria-label="Previous">‹</button>}
        {i < n - 1 && <button className="pvnav next" onClick={() => go(i + 1)} aria-label="Next">›</button>}
        <span className="pvcounter">{i + 1}/{n}</span>
        <div className="pvdots">{items.map((m, k) => <i key={m.src} className={k === i ? "on" : ""} />)}</div>
      </>}
      {big && <Lightbox src={srcOf(big.src)} onClose={() => setBig(null)} />}
    </div>
  );
}

// Full size: the image at the largest size that fits the screen, never cropped. Esc or a click outside closes it.
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return createPortal(
    <div className="gallb" onClick={onClose} role="dialog" aria-label="Image">
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <button className="gallbx" onClick={onClose} aria-label="Close"><X size={18} /></button>
    </div>,
    document.body,
  );
}
