import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import type { Run } from "../types";

// Gönderinin ekleri: görseller ve videolar tek şeritte, Instagram gibi yana kayar. Kaynak üç yerden gelir:
// run.video, run.images (data/media altında) ve metnin içine yazılmış görsel/video bağlantıları (Rou bazen ekleri böyle yazar).
export type MediaItem = { src: string; kind: "image" | "video"; remote?: boolean; poster?: string };

const VIDEO = /\.(mp4|mov|m4v|webm)(\?.*)?$/i;
const MEDIA_URL = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg|mp4|mov|m4v|webm)(\?\S*)?$/i;
const MEDIA_HEAD = /^(görseller|görsel|ekler|medya|videolar|images|media)\s*:?\s*$/i;
const GAP = 8; // styles.css .galstrip gap ile aynı
export const srcOf = (src: string) => (/^https?:/i.test(src) ? src : `/${src}`);
export const kindOf = (src: string): MediaItem["kind"] => (VIDEO.test(src) ? "video" : "image");

// Metni ve içindeki ek bağlantılarını ayırır: bağlantı satırları (ve üstlerindeki "Görseller:" satırı) metinden çıkar.
export function splitBody(body: string) {
  const urls: string[] = [];
  const lines = body.split("\n");
  const keep = lines.filter((l, i) => {
    const t = l.trim().replace(/^[-•*]\s*/, "");
    if (MEDIA_URL.test(t)) return void urls.push(t);
    // Başlık satırı: altındaki ilk dolu satır bağlantıysa.
    if (MEDIA_HEAD.test(t)) { const next = lines.slice(i + 1).find((x) => x.trim()); return !(next && MEDIA_URL.test(next.trim().replace(/^[-•*]\s*/, ""))); }
    return true;
  });
  return { text: keep.join("\n").replace(/\n{3,}/g, "\n\n").trim(), urls };
}
// Metin ve uzak ekler yeniden tek gövdeye: ekler sonda "Görseller:" altında.
export const joinBody = (text: string, urls: string[]) => (urls.length ? `${text.trim()}\n\nGörseller:\n${urls.join("\n")}` : text.trim());

// cover: video varken ilk görsel onun kapağıdır (render ve pg run --video --img böyle yazar): ayrı ek olarak değil, videonun posteri olarak gösterilir.
// Videonun kendi kapağı: render çıktısı (-cover.) ya da `pg run --video --img` ile verilen <runId>-0.
export const isCover = (r: Run, f?: string) => !!f && (/-cover\./.test(f) || new RegExp(`^media/${r.id}-0\\.(jpe?g|png)$`).test(f));
export function mediaOf(r: Run, cover = false): MediaItem[] {
  const imgs = r.images ?? [];
  // Kapak yalnız videonun kendi kapağıysa (-cover.); ayrı görseller videonun üstüne kapak olarak binmez.
  const poster = cover && r.video && isCover(r, imgs[0]) ? imgs[0] : undefined;
  const at = (m: MediaItem) => { const i = (r.order ?? []).indexOf(m.src); return i < 0 ? Infinity : i; };
  const own: MediaItem[] = [...(r.video ? [{ src: r.video, kind: "video" as const, ...(poster ? { poster } : {}) }] : []), ...(poster ? imgs.slice(1) : imgs).map((src) => ({ src, kind: kindOf(src) }))];
  const remote = r.post ? [] : splitBody(r.body ?? "").urls.map((src) => ({ src, kind: kindOf(src), remote: true }));
  // run.order: carousel sırası (kapak bento videodan önce gelebilir); sırasız çıktıda video başta kalır.
  if (r.order?.length) own.sort((a, b) => at(a) - at(b));
  return [...own, ...remote];
}

export function Gallery({ items, alt = [] }: { items: MediaItem[]; alt?: string[] }) {
  const [i, setI] = useState(0);
  // Şeridin oranı ilk ekin kendi oranından: dikey video kare kutuya sıkışmasın (4:5 ile 1.91:1 arası; Instagram/LinkedIn sınırları).
  const [ratio, setRatio] = useState(1);
  const fit = (w: number, h: number) => w && h && setRatio(Math.min(1.91, Math.max(0.8, w / h)));
  const strip = useRef<HTMLDivElement>(null);
  const [big, setBig] = useState<MediaItem | null>(null);
  if (!items.length) return null;
  const n = items.length;
  // Slaytlar arasında GAP kadar boşluk var; bir adım = şerit genişliği + boşluk.
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
            {m.kind === "image" && <button className="galbig" onClick={(e) => (e.stopPropagation(), setBig(m))} aria-label="Tam boyut gör" title="Tam boyut gör"><Maximize2 size={14} /></button>}
          </div>
        ))}
      </div>
      {n > 1 && <>
        {i > 0 && <button className="pvnav prev" onClick={() => go(i - 1)} aria-label="Önceki">‹</button>}
        {i < n - 1 && <button className="pvnav next" onClick={() => go(i + 1)} aria-label="Sonraki">›</button>}
        <span className="pvcounter">{i + 1}/{n}</span>
        <div className="pvdots">{items.map((m, k) => <i key={m.src} className={k === i ? "on" : ""} />)}</div>
      </>}
      {big && <Lightbox src={srcOf(big.src)} onClose={() => setBig(null)} />}
    </div>
  );
}

// Tam boyut: görsel ekrana sığan en büyük hâliyle, hiç kırpılmadan. Esc ya da dışarı tıklama kapatır.
function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [onClose]);
  return createPortal(
    <div className="gallb" onClick={onClose} role="dialog" aria-label="Görsel">
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <button className="gallbx" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
    </div>,
    document.body,
  );
}
