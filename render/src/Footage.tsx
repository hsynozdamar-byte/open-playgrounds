import { useEffect, useState } from "react";
import { AbsoluteFill, Img, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { END_SEC, HOOK_SEC } from "../../shared/social.mjs";
import { type Account, DISPLAY, deep, fit, phrase, phraseStyle, readable } from "./look";

// Projenin gerçek görüntüsüyle Reels ve gönderi.
// Başlık ilk karede okunur ve video boyunca durur; her sahne kendi kaydını gösterir, altyazı o kayıtta görüneni söyler.
// Görüntü yatayse eğik bir kartta, dikeyse tam ekran. Üstte küçük etiket yok; logo yalnız kapanışta.

// Projenin görünümü (project.kit): yazı tipleri, renkler, logo. Dosyalar render sırasında public/ altına bağlanır.
export type Kit = {
  fonts?: { family: string; file: string; weight?: string; range?: string; style?: "normal" | "italic" }[];
  display?: string;
  displayWeight?: number;
  text?: string;
  logo?: string;
  logoKind?: "wordmark" | "icon";
  // Koyu zemin için logo (açık logo, koyulaştırılmış posterde).
  logoDark?: string;
  bg?: [string, string, string];
  ink?: string;
  accent?: string;
  end?: string;
  accent2?: string;
  // Seri rengi (otomasyonun automation.color'ı, prepare.mjs kitOf): bu seride vurgu rengi accent yerine bu.
  seriesColor?: string;
  // sticker: oyun dili (beyaz dolgu, kalın kontur). night: stüdyo dili (koyu sahne, büyük harf yazı, köşelerde iki renk boya lekesi).
  // mono: siyah sahne, üstte bulanık beyaz ışık, beyaz büyük harf başlık, gri gövde, ince çizgi, altta logo.
  style?: "sticker" | "night" | "mono";
  // mono: yazısız atmosfer fotoğrafı; logo ve yazı üstüne kodla basılır.
  // night: renkli zemin görseli; lekeler çizilmez, yazı ink rengiyle basılır.
  bgImage?: string;
  paint?: [string, string];
  // night stilinde başlığın harfi (büyük ya da küçük) ve gövdenin italik olup olmadığı.
  case?: "upper" | "lower";
  italic?: boolean;
};
export type Media = { src: string; kind: "video" | "image"; w: number; h: number; from?: number };
// Sahne kayıt (media) ya da projenin objesiyle (asset) vurucu kart; hiçbiri yoksa yalnız yazılı kart.
export type FootScene = { text: string; sec: number; accent?: string; media?: Media; asset?: Media };
export type FootReelProps = { account: Account; hook: string; scenes: FootScene[]; kit?: Kit };
export type FootSlideProps = { account: Account; slides: { title: string; text: string; media?: Media }[]; index: number; kit?: Kit };

// brand: kitin kendi vurgu rengi; accent: seri rengi varsa o, yoksa brand.
type K = Required<Pick<Kit, "display" | "text" | "bg" | "ink" | "accent">> & Kit & { brand: string };
function resolve(kit: Kit | undefined, color: string): K {
  const c = color || "#3b86e8";
  const k = {
    display: DISPLAY,
    text: DISPLAY,
    displayWeight: 800,
    bg: [readable(c), c, deep(c)],
    ink: "#14151a",
    accent: c,
    ...kit,
  } as K;
  return { ...k, brand: k.accent, accent: kit?.seriesColor ?? k.accent };
}

// Seri rengi (kit.seriesColor, otomasyonun automation.color'ı): başlığın arkasında seri renginde levha (kitin mürekkebiyle kontur
// ve alt gölge); night/mono gibi düz stillerde başlığın solunda seri renginde dikey çizgi. Izgarada seriler bu renkten ayrılır.
// Seri yoksa (tek seferlik gönderi) hiçbir şey çizilmez, başlık kitin kendi hâlinde kalır. Başlık kutusu relative + isolate olmalı.
// night stilinde sağ üstteki büyük boya lekesi de seri renginde (ızgarada en çok görünen renk o).
const plated = (k: K): React.CSSProperties => (k.seriesColor ? { position: "relative", isolation: "isolate", ...(flat(k) ? {} : { maxWidth: 820 }) } : {});
function SeriesPlate({ k }: { k: K }) {
  if (!k.seriesColor) return null;
  if (flat(k)) return <div style={{ position: "absolute", zIndex: -1, left: -34, top: "0.08em", bottom: "0.08em", width: 12, borderRadius: 6, background: k.seriesColor }} />;
  return <div style={{ position: "absolute", zIndex: -1, inset: "-0.2em -0.34em", borderRadius: 34, background: k.seriesColor, border: `7px solid ${k.ink}`, boxShadow: `0 14px 0 ${k.ink}`, transform: "rotate(1.4deg)" }} />;
}

// Projenin yazı tiplerini yükler; yüklenene kadar kare çekilmez.
function useFonts(kit?: Kit) {
  const [h] = useState(() => (kit?.fonts?.length ? delayRender("kit fonts") : null));
  useEffect(() => {
    if (h === null || !kit?.fonts) return;
    Promise.all(kit.fonts.map((f) => new FontFace(f.family, `url(${staticFile(f.file)})`, { weight: f.weight ?? "100 900", ...(f.style ? { style: f.style } : {}), ...(f.range ? { unicodeRange: f.range } : {}) }).load().then((ff) => document.fonts.add(ff))))
      .catch(() => {})
      .then(() => continueRender(h));
  }, [h, kit]);
}

// Oyunun arayüzündeki gibi: beyaz dolgu, kalın kontur, alt gölge. night stilinde düz beyaz, büyük harf, sıkı satır.
const flat = (k: K) => k.style === "night" || k.style === "mono";
// night stilinde renkli zemin görseli ya da açık zemin: yazı kitin mürekkebiyle.
const lit = (k: K) => k.style === "night" && (!!k.bgImage || !dark(k.bg[0]));
const sticker = (k: K, size: number): React.CSSProperties => flat(k) ? ({
  fontFamily: k.display,
  fontWeight: k.displayWeight,
  // Küçük harfli geniş yazılar sıkı aralıkla daha küçük basılır.
  fontSize: Math.round(size * (k.style === "mono" ? 1.7 : k.case === "lower" ? 0.78 : 1.18)),
  lineHeight: k.case === "lower" ? 1 : k.style === "mono" ? 0.88 : 0.92,
  letterSpacing: k.case === "lower" ? "-0.04em" : "0.01em",
  textTransform: k.case === "lower" ? "lowercase" : "uppercase",
  color: k.style === "mono" ? "#F0F0F0" : lit(k) ? k.ink : "#fff",
  textWrap: "balance",
}) : ({
  fontFamily: k.display,
  fontWeight: k.displayWeight,
  fontSize: size,
  lineHeight: 1.04,
  letterSpacing: "-0.01em",
  color: "#fff",
  WebkitTextStroke: `${Math.round(size * 0.11)}px ${k.ink}`,
  paintOrder: "stroke fill",
  textShadow: `0 ${Math.round(size * 0.08)}px 0 ${k.ink}`,
  textWrap: "balance",
});

// Boya lekesi: ana daire + etrafında sıçramış damlalar (sabit, tohumla).
function Splat({ x, y, r: rad, color, seed }: { x: number; y: number; r: number; color: string; seed: number }) {
  const rnd = (i: number) => { const v = Math.sin(seed * 97.13 + i * 12.9898) * 43758.5453; return v - Math.floor(v); };
  const drops = Array.from({ length: 9 }, (_, i) => {
    const a = rnd(i) * Math.PI * 2;
    const d = rad * (1.05 + rnd(i + 20) * 0.75);
    return { cx: x + Math.cos(a) * d, cy: y + Math.sin(a) * d, r: rad * (0.06 + rnd(i + 40) * 0.16) };
  });
  return (
    <g fill={color}>
      <circle cx={x} cy={y} r={rad} />
      {drops.map((p, i) => <circle key={i} {...p} />)}
    </g>
  );
}

function Bg({ k }: { k: K }) {
  const { width, height } = useVideoConfig();
  if (k.style === "mono") return (
    <AbsoluteFill style={{ background: k.bg[0] }}>
      {k.bgImage ? <Img src={staticFile(k.bgImage)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : <AbsoluteFill style={{ background: `radial-gradient(60% 34% at 30% -4%, rgb(255 255 255 / 0.42), transparent 70%), radial-gradient(40% 26% at 82% 2%, rgb(255 255 255 / 0.16), transparent 72%)`, filter: "blur(30px)" }} />}
      {/* Yazının oturduğu alt bölge her fotoğrafta okunur kalsın. */}
      {k.bgImage && <AbsoluteFill style={{ background: "linear-gradient(180deg, transparent 30%, rgb(5 5 5 / 0.82) 72%, #050505 100%)" }} />}
    </AbsoluteFill>
  );
  if (k.style === "night") {
    const [a0, b] = k.paint ?? [k.accent, k.accent2 ?? k.accent];
    const a = k.seriesColor ?? a0;
    if (k.bgImage) return (
      <AbsoluteFill style={{ background: k.bg[0] }}>
        <Img src={staticFile(k.bgImage)} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
    );
    // Açık zemin: düz zemin, boya lekesi yok; logo ve yazı mürekkep renginde.
    if (lit(k)) return <AbsoluteFill style={{ background: k.bg[0] }} />;
    return (
      <AbsoluteFill style={{ background: k.bg[0] }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <Splat x={width * 0.97} y={height * 0.02} r={width * 0.17} color={a} seed={3} />
          <Splat x={width * 0.02} y={height * 0.98} r={width * 0.15} color={b} seed={7} />
        </svg>
      </AbsoluteFill>
    );
  }
  return (
    // Varsayılan zemin: projenin üç tonu, yumuşak ışıkla.
    <AbsoluteFill style={{ background: `linear-gradient(170deg, ${k.bg[0]} 0%, ${k.bg[1]} 55%, ${k.bg[2]} 100%)` }}>
      <AbsoluteFill style={{ background: "radial-gradient(70% 45% at 50% 45%, rgb(255 255 255 / 0.22), transparent 70%)" }} />
    </AbsoluteFill>
  );
}

// Kayıt: kutuyu doldurur (cover), sahne boyunca hafifçe yaklaşır.
function Shot({ m, frames, style }: { m: Media; frames: number; style?: React.CSSProperties }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Hafif yaklaşma yalnız videoda; ekran görüntüsü kenarı kesilmesin diye sabit durur.
  const z = m.kind === "video" ? interpolate(f, [0, frames], [1, 1.06], { extrapolateRight: "clamp" }) : 1;
  const s: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z})`, ...style };
  return m.kind === "video"
    ? <OffthreadVideo src={staticFile(m.src)} trimBefore={Math.round((m.from ?? 0) * fps)} muted style={s} />
    : <Img src={staticFile(m.src)} style={s} />;
}

// Zemin koyuysa gövde yazısı beyaz.
function dark(hex: string) {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 < 0.45;
}
const tall = (m?: Media) => !!m && m.h > m.w * 1.1;
// Gerçek ekran/kayıt kırpılmaz: kart görüntünün kendi oranında, verilen kutuya sığacak en büyük boyutta (border dahil değil).
const fitCard = (m: Media, maxW: number, maxH: number) => {
  const r = m.w && m.h ? m.w / m.h : 16 / 9;
  return maxW / r <= maxH ? { w: maxW, h: Math.round(maxW / r) } : { w: Math.round(maxH * r), h: maxH };
};
const words = (t: string) => t.split(/\s+/).filter(Boolean);
const clean = (w: string) => w.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]/gu, "");

function Caption({ text, accent, k, at }: { text: string; accent?: string; k: K; at: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f - at, fps, config: { damping: 12, stiffness: 220 } });
  if (f < at) return null;
  const ws = words(text);
  const hit = new Set(accent ? words(accent).map(clean) : []);
  const size = fit(text, [[28, 54], [48, 48], [999, 42]]);
  return (
    <div style={{ display: "flex", justifyContent: "center", transform: `scale(${0.7 + pop * 0.3})`, opacity: Math.min(1, pop * 2) }}>
      <div style={{ maxWidth: 900, padding: `${size * 0.42}px ${size * 0.8}px`, borderRadius: size * 0.9, background: k.accent, boxShadow: `0 ${Math.round(size * 0.14)}px 0 ${k.ink}`, border: `5px solid ${k.ink}`, fontFamily: k.text, fontWeight: 800, fontSize: size, lineHeight: 1.16, color: "#fff", textAlign: "center", textWrap: "balance" }}>
        {ws.map((w, i) => <span key={i} style={{ color: hit.has(clean(w)) ? k.ink : undefined }}>{w}{i < ws.length - 1 ? " " : ""}</span>)}
      </div>
    </div>
  );
}

// Bir sahne: kayıt (kartta ya da tam ekran) + altyazı. at: altyazının çıktığı kare (ilk sahnede başlık önce okunur).
function SceneView({ s, frames, k, at }: { s: FootScene; frames: number; k: K; at: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: f, fps, config: { damping: 14, stiffness: 160 } });
  const m = s.media;
  if (m && tall(m)) {
    return (
      <AbsoluteFill>
        <Shot m={m} frames={frames} />
        <AbsoluteFill style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${k.ink} 72%, transparent) 0%, transparent 34%, transparent 58%, color-mix(in srgb, ${k.ink} 62%, transparent) 100%)` }} />
        <div style={{ position: "absolute", left: 60, right: 170, top: 1250 }}><Caption text={s.text} accent={s.accent} k={k} at={at} /></div>
      </AbsoluteFill>
    );
  }
  const c = m ? fitCard(m, 1000, 700) : { w: 1000, h: 700 };
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 40 + (1000 - c.w) / 2, top: 600 + (700 - c.h) / 2, width: c.w, height: c.h, borderRadius: 56, overflow: "hidden", border: `12px solid ${k.ink}`, background: k.ink, boxShadow: `0 28px 0 ${k.ink}, 0 40px 80px rgb(0 0 0 / 0.35)`, transform: `rotate(-1.6deg) scale(${0.95 + pop * 0.05})` }}>
        {m ? <Shot m={m} frames={frames} /> : null}
      </div>
      <div style={{ position: "absolute", left: 60, right: 60, top: 1250 }}><Caption text={s.text} accent={s.accent} k={k} at={at} /></div>
    </AbsoluteFill>
  );
}

function Logo({ k, account, width }: { k: K; account: Account; width: number }) {
  if (k.logo && k.logoKind !== "icon") return <Img src={staticFile(k.logo)} style={{ width }} />;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
      {k.logo && <Img src={staticFile(k.logo)} style={{ width: width * 0.42, borderRadius: width * 0.1, border: `10px solid ${k.ink}`, boxShadow: `0 18px 0 ${k.ink}` }} />}
      <div style={{ ...sticker(k, 120), textAlign: "center" }}>{account.name}</div>
    </div>
  );
}

function End({ k, account }: { k: K; account: Account }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: f, fps, config: { damping: 13 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 48, paddingBottom: 260 }}>
      <div style={{ transform: `scale(${t}) rotate(${(1 - t) * -10}deg)` }}><Logo k={k} account={account} width={840} /></div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28, opacity: t, transform: `translateY(${(1 - t) * 90}px)` }}>
        {k.end && <div style={{ ...sticker(k, 64), textAlign: "center", maxWidth: 900 }}>{k.end}</div>}
        {account.handle && <div style={{ fontFamily: k.text, fontWeight: 800, fontSize: 40, color: "#fff", background: k.ink, padding: "18px 36px", borderRadius: 999 }}>{account.handle}</div>}
      </div>
    </AbsoluteFill>
  );
}

// Vurucu kart: dönen ışın zemin, büyük yazı, altta obje zıplayarak girer.
function Punch({ s, k, lead, at }: { s: FootScene; k: K; lead?: string; at: number }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = lead && f < at ? lead : s.text;
  const ti = spring({ frame: lead && f >= at ? f - at : f, fps, config: { damping: 9, stiffness: 200 } });
  const fig = !!s.asset;
  const pop = spring({ frame: f - 3, fps, config: { damping: 10, stiffness: 150, mass: 0.9 } });
  const size = fig ? fit(text, [[14, 132], [26, 110], [999, 90]]) : fit(text, [[14, 150], [30, 124], [999, 100]]);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: `repeating-conic-gradient(from ${f * 0.6}deg at 50% 64%, color-mix(in srgb, ${k.accent} 34%, transparent) 0deg 9deg, transparent 9deg 20deg)` }} />
      <div style={{ position: "absolute", left: 70, right: 70, top: fig ? 300 : 0, bottom: fig ? undefined : 420, display: "flex", alignItems: fig ? "flex-start" : "center", justifyContent: "center" }}>
        <div style={{ ...sticker(k, size), textAlign: "center", transform: `scale(${interpolate(ti, [0, 1], [1.35, 1])}) rotate(${-2.5 + (1 - ti) * -6}deg)`, opacity: Math.min(1, ti * 3) }}>{text}</div>
      </div>
      {s.asset && (
        <div style={{ position: "absolute", left: 0, right: 0, top: 800, display: "flex", justifyContent: "center", transform: `translateY(${(1 - pop) * 480 + Math.sin(f / 9) * 10}px) rotate(${Math.sin(f / 14) * 4}deg)` }}>
          <Img src={staticFile(s.asset.src)} style={{ width: 560, height: 560, objectFit: "contain", filter: `drop-shadow(0 22px 0 ${k.ink})` }} />
        </div>
      )}
    </AbsoluteFill>
  );
}
const isPunch = (s: FootScene) => !s.media;

const lens = (p: FootReelProps, fps: number) => p.scenes.map((s, i) => Math.round(((i === 0 && p.hook ? HOOK_SEC : 0) + s.sec) * fps));
export const footFrames = (p: FootReelProps, fps: number) => lens(p, fps).reduce((n, x) => n + x, 0) + Math.round(END_SEC * fps);

export function FootReel(p: FootReelProps) {
  useFonts(p.kit);
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = resolve(p.kit, p.account.color);
  const ls = lens(p, fps);
  const endAt = ls.reduce((n, x) => n + x, 0);
  const hookIn = spring({ frame: f, fps, config: { damping: 9, stiffness: 180 } });
  // Başlık yalnız kayıtlı sahnelerde üstte durur; vurucu kart kendi büyük yazısını taşır.
  let acc = 0;
  const cur = p.scenes.find((_, i) => (acc += ls[i]) > f);
  let from = 0;
  return (
    <AbsoluteFill>
      <Bg k={k} />
      {p.scenes.map((s, i) => {
        const at = from;
        from += ls[i];
        return (
          <Sequence key={i} from={at} durationInFrames={ls[i]} layout="none">
            {isPunch(s)
              ? <Punch s={s} k={k} lead={i === 0 ? p.hook : undefined} at={i === 0 && p.hook ? Math.round(HOOK_SEC * fps) : 0} />
              : <SceneView s={s} frames={ls[i]} k={k} at={i === 0 && p.hook ? Math.round(HOOK_SEC * fps) : 4} />}
          </Sequence>
        );
      })}
      {/* Başlık: 0. karede tam görünür (kapak), kapanışa kadar durur. */}
      {p.hook && f < endAt && cur && !isPunch(cur) && (
        <div style={{ position: "absolute", top: 170, left: 70, right: 70, textAlign: "center", transform: `scale(${interpolate(hookIn, [0, 1], [1.12, 1])}) rotate(-1.4deg)`, ...sticker(k, fit(p.hook, [[22, 104], [38, 92], [999, 80]])), ...plated(k) }}><SeriesPlate k={k} />{p.hook}</div>
      )}
      <Sequence from={endAt} layout="none"><End k={k} account={p.account} /></Sequence>
    </AbsoluteFill>
  );
}

// Gönderi slaytı (1080x1350): başlık üstte, kayıt ortada kartta, kısa metin altta.
export function FootSlide({ account, slides, index, kit }: FootSlideProps) {
  useFonts(kit);
  const k = resolve(kit, account.color);
  const s = slides[index] ?? { title: "", text: "" };
  const m = s.media;
  const last = index === slides.length - 1 && slides.length > 1;
  const title = sticker(k, m ? fit(s.title, [[24, 96], [44, 82], [999, 70]]) : fit(s.title, [[24, 128], [48, 104], [999, 86]]));
  if (flat(k)) Object.assign(title, { textAlign: "left" });
  const body: React.CSSProperties = { fontFamily: k.text, fontWeight: 700, fontSize: fit(s.text, [[80, 44], [150, 38], [999, 34]]), lineHeight: 1.28, color: dark(k.bg[1]) ? "#fff" : k.ink, textAlign: "center", textWrap: "pretty", maxWidth: 900 };
  // Ekran görüntüsü kendi oranında: hiçbir kenarı kesilmez (yatay geniş, dikey dar kart).
  const card = m ? fitCard(m, 940, tall(m) ? 780 : 640) : { w: 0, h: 0 };
  return (
    <AbsoluteFill>
      <Bg k={k} />
      <AbsoluteFill style={{ padding: k.style === "mono" ? "120px 84px 264px" : k.style === "night" ? "120px 84px 170px" : "88px 70px 84px", display: "flex", flexDirection: "column", alignItems: flat(k) ? "flex-start" : "center", justifyContent: k.style === "mono" && !m ? "flex-end" : "center", gap: k.style === "mono" ? 40 : 52 }}>
        {s.title && <div style={flat(k) ? { ...title, ...phraseStyle, alignSelf: "stretch", ...plated(k) } : { ...title, ...phraseStyle, textAlign: "center", transform: "rotate(-1.2deg)", ...plated(k) }}><SeriesPlate k={k} />{phrase(s.title)}</div>}
        {m && (
          <div style={{ position: "relative", flex: "none", width: card.w, height: card.h, borderRadius: 48, overflow: "hidden", border: `11px solid ${k.ink}`, background: k.ink, boxShadow: `0 24px 0 ${k.ink}`, transform: "rotate(1.2deg)" }}>
            <Shot m={m} frames={1} style={{ transform: "none" }} />
          </div>
        )}
        {!m && last && !flat(k) && <Logo k={k} account={account} width={620} />}
        {s.text && <div style={k.style === "mono" ? { ...body, textAlign: "left", fontWeight: 400, fontSize: Math.round((body.fontSize as number) * 0.92), color: "#8C8C8C", lineHeight: 1.32, letterSpacing: "-0.01em" } : k.style === "night" ? { ...body, textAlign: "left", fontStyle: k.italic === false ? "normal" : "italic", fontWeight: 400, fontSize: Math.round((body.fontSize as number) * 1.15), color: lit(k) ? k.ink : "rgb(255 255 255 / 0.82)", lineHeight: 1.22 } : body}>{s.text}</div>}
      </AbsoluteFill>
      {k.style === "mono" && (
        <div style={{ position: "absolute", left: 84, right: 84, bottom: 72, display: "flex", alignItems: "flex-end", justifyContent: "space-between", paddingTop: 40, borderTop: "2px solid rgb(240 240 240 / 0.16)" }}>
          {k.logo && <Img src={staticFile(k.logo)} style={{ height: 74 }} />}
          {k.end && <span style={{ fontFamily: k.text, fontStyle: "italic", fontSize: 34, color: "#8C8C8C" }}>{k.end}</span>}
        </div>
      )}
      {k.style === "night" && k.logo && <Img src={staticFile(k.logo)} style={{ position: "absolute", right: 84, bottom: 72, height: 92 }} />}
    </AbsoluteFill>
  );
}

// Site kapağı (16:9, 1920x1080): solda logo, başlık ve kısa yazı; sağda projenin gerçek karesi
// kendi oranında (kırpılmaz). Site kapağı küçük kartta da kırptığı için her şey güvenli alanda.
export function FootCover({ account, slides, index, kit }: FootSlideProps) {
  useFonts(kit);
  const k = resolve(kit, account.color);
  const s = slides[index] ?? { title: "", text: "" };
  const m = s.media;
  const card = m ? fitCard(m, tall(m) ? 560 : 860, 800) : { w: 0, h: 0 };
  const title = sticker(k, fit(s.title, [[18, 112], [34, 96], [999, 80]]));
  return (
    <AbsoluteFill>
      <Bg k={k} />
      <AbsoluteFill style={{ background: `repeating-conic-gradient(from 0deg at 74% 52%, color-mix(in srgb, ${k.accent} 26%, transparent) 0deg 9deg, transparent 9deg 20deg)` }} />
      <div style={{ position: "absolute", left: 120, top: 0, bottom: 0, width: m ? 820 : 1680, display: "flex", flexDirection: "column", justifyContent: "center", gap: 40 }}>
        {k.logo && k.logoKind !== "icon" && <Img src={staticFile(k.logo)} style={{ width: 420, alignSelf: "flex-start" }} />}
        {k.logo && k.logoKind === "icon" && <Img src={staticFile(k.logo)} style={{ width: 150, borderRadius: 36, border: `8px solid ${k.ink}` }} />}
        {s.title && <div style={{ ...title, ...phraseStyle, textAlign: "left", transform: "rotate(-1.2deg)", transformOrigin: "0 50%", ...(k.seriesColor ? { ...plated(k), alignSelf: "flex-start", marginLeft: "0.42em" } : {}) }}><SeriesPlate k={k} />{phrase(s.title)}</div>}
        {s.text && <div style={{ fontFamily: k.text, fontWeight: 700, fontSize: fit(s.text, [[70, 44], [999, 38]]), lineHeight: 1.25, color: dark(k.bg[1]) ? "#fff" : k.ink, maxWidth: 760, textWrap: "pretty" }}>{s.text}</div>}
      </div>
      {m ? (
        <div style={{ position: "absolute", right: 110, top: "50%", width: card.w, height: card.h, marginTop: -card.h / 2, borderRadius: 44, overflow: "hidden", border: `11px solid ${k.ink}`, background: k.ink, boxShadow: `0 24px 0 ${k.ink}`, transform: "rotate(2deg)" }}>
          <Shot m={m} frames={1} style={{ transform: "none" }} />
        </div>
      ) : null}
    </AbsoluteFill>
  );
}
