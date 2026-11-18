import { Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { contrast } from "../../shared/storyboard.mjs";
import { DISPLAY, MONO, type Look } from "./look";

// Sesli Reels'in sahne görüntüleri (shared/storyboard.mjs KINDS). Her biri anlatılanı gösterir:
// arayüz kodla çizilir, ölçüler canlı sayar, sayfa gerçekten çekilmiştir. frame: sahnenin kendi karesi.
export type Visual =
  | { kind: "title" | "rule"; text: string }
  | { kind: "card"; from: Card; to: Card; marks: string[]; title: string; body: string }
  | { kind: "type"; from: Type; to: Type; marks: string[]; sample: string }
  | { kind: "color"; from: { bg: string; fg: string }; to: { bg: string; fg: string }; sample: string }
  | { kind: "motion"; from: { ease: string; ms: number }; to: { ease: string; ms: number } }
  | { kind: "code"; lang: string; code: string; highlight: number[] }
  | { kind: "screen"; url: string; image?: string };
type Card = { radius: number; padding: number; inner: number; gap: number };
type Type = { size: number; line: number; tracking: number; weight: number };
export type SceneProps = { v: Visual; frames: number; L: Look; color: string };

const PAPER = "#f4f2ee";
const INK = "#16171b";
const out = (t: number) => 1 - (1 - t) ** 3;
// Önce→sonra: sahnenin %30'una kadar "önce", %30-%62 arası geçiş, sonra "sonra" durur.
function useMorph(frames: number) {
  const f = useCurrentFrame();
  return out(interpolate(f, [frames * 0.3, frames * 0.62], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function Chip({ children, L, on = true }: { children: React.ReactNode; L: Look; on?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", height: 52, padding: "0 20px", borderRadius: 26, fontFamily: MONO, fontSize: 30, fontWeight: 500, color: on ? "#0c0d10" : L.ink, background: on ? L.accent : "rgb(255 255 255 / 0.1)", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function CardScene({ v, frames, L, color }: SceneProps & { v: Extract<Visual, { kind: "card" }> }) {
  const t = useMorph(frames);
  const c = { radius: mix(v.from.radius, v.to.radius, t), padding: mix(v.from.padding, v.to.padding, t), inner: mix(v.from.inner, v.to.inner, t), gap: mix(v.from.gap, v.to.gap, t) };
  // Ekranda 2x ölçek: 24 px'lik bir radius telefonda nasıl görünüyorsa öyle okunur.
  const k = 2;
  const W = 640;
  const marks = new Set(v.marks);
  const label = (n: number) => `${Math.round(n)} px`;
  const pad = c.padding * k;
  const glow = "rgb(255 255 255 / 0.0)";
  return (
    <div style={{ position: "relative", width: W, display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
      <div style={{ position: "relative", width: W, padding: pad, borderRadius: c.radius * k, background: PAPER, boxShadow: "0 40px 80px -30px rgb(0 0 0 / 0.6)", display: "flex", flexDirection: "column", gap: c.gap * k }}>
        {marks.has("padding") && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pad, borderRadius: `${c.radius * k}px 0 0 ${c.radius * k}px`, background: `color-mix(in srgb, ${L.accent} 34%, transparent)` }} />}
        {marks.has("padding") && <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: pad, borderRadius: `${c.radius * k}px ${c.radius * k}px 0 0`, background: `color-mix(in srgb, ${L.accent} 34%, transparent)` }} />}
        <div style={{ position: "relative", height: 300, borderRadius: c.inner * k, background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 45%, #fff))`, boxShadow: marks.has("inner") ? `0 0 0 4px ${L.accent}` : `0 0 0 0 ${glow}` }} />
        {marks.has("gap") && <div style={{ position: "absolute", left: pad, right: pad, top: pad + 300, height: c.gap * k, background: `color-mix(in srgb, ${L.accent} 40%, transparent)` }} />}
        <div style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 44, letterSpacing: "-0.03em", color: INK, lineHeight: 1.1 }}>{v.title || "Kart başlığı"}</div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 30, color: "#5d5f66", lineHeight: 1.35, marginTop: -c.gap * k * 0.6 }}>{v.body || "Kısa bir açıklama satırı burada durur."}</div>
        {marks.has("radius") && (
          <svg width={c.radius * k + 8} height={c.radius * k + 8} style={{ position: "absolute", left: -4, top: -4, overflow: "visible" }}>
            <path d={`M 4 ${c.radius * k + 4} A ${c.radius * k} ${c.radius * k} 0 0 1 ${c.radius * k + 4} 4`} fill="none" stroke={L.accent} strokeWidth={8} strokeLinecap="round" />
          </svg>
        )}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
        {v.marks.map((m) => <Chip key={m} L={L}>{{ radius: "radius", padding: "padding", inner: "iç radius", gap: "gap" }[m]} {label(c[m as keyof Card])}</Chip>)}
      </div>
    </div>
  );
}

function TypeScene({ v, frames, L }: SceneProps & { v: Extract<Visual, { kind: "type" }> }) {
  const t = useMorph(frames);
  const s = { size: mix(v.from.size, v.to.size, t), line: mix(v.from.line, v.to.line, t), tracking: mix(v.from.tracking, v.to.tracking, t), weight: mix(v.from.weight, v.to.weight, t) };
  const fmt: Record<string, string> = { size: `${Math.round(s.size)} px`, line: s.line.toFixed(2), tracking: `${s.tracking.toFixed(2)} em`, weight: String(Math.round(s.weight / 100) * 100) };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34, width: 860 }}>
      <div style={{ width: 860, padding: "64px 60px", borderRadius: 40, background: PAPER }}>
        <p style={{ margin: 0, fontFamily: DISPLAY, fontSize: s.size * 2.4, lineHeight: s.line, letterSpacing: `${s.tracking}em`, fontWeight: s.weight, color: INK }}>{v.sample}</p>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center" }}>
        {v.marks.map((m) => <Chip key={m} L={L}>{{ size: "boyut", line: "satır", tracking: "harf arası", weight: "kalınlık" }[m]} {fmt[m]}</Chip>)}
      </div>
    </div>
  );
}

const hexMix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((n, i) => Math.round(mix(n, y[i], t)).toString(16).padStart(2, "0")).join("")}`;
};
function ColorScene({ v, frames, L }: SceneProps & { v: Extract<Visual, { kind: "color" }> }) {
  const t = useMorph(frames);
  const bg = hexMix(v.from.bg, v.to.bg, t);
  const fg = hexMix(v.from.fg, v.to.fg, t);
  const ratio = contrast(bg, fg);
  const pass = ratio >= 4.5;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
      <div style={{ width: 760, height: 560, borderRadius: 44, background: bg, display: "flex", flexDirection: "column", justifyContent: "center", padding: 64, gap: 18, boxShadow: "0 40px 80px -30px rgb(0 0 0 / 0.6)" }}>
        <b style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 150, letterSpacing: "-0.04em", lineHeight: 1, color: fg }}>{v.sample}</b>
        <span style={{ fontFamily: DISPLAY, fontWeight: 500, fontSize: 38, color: fg }}>Bu satırı rahat okuyabiliyor musun?</span>
      </div>
      <div style={{ display: "flex", gap: 14 }}>
        <Chip L={L}>kontrast {ratio.toFixed(1)}:1</Chip>
        <Chip L={L} on={false}>{pass ? "AA geçer" : "AA geçmez"}</Chip>
      </div>
    </div>
  );
}

function ease(name: string, x: number, fps: number) {
  if (name === "ease-in") return x ** 3;
  if (name === "ease-out") return 1 - (1 - x) ** 3;
  if (name === "spring") return spring({ frame: x * fps * 0.9, fps, config: { damping: 11, stiffness: 120, mass: 0.8 } });
  return x;
}
function Lane({ e, label, L }: { e: { ease: string; ms: number }; label: string; L: Look }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur = (e.ms / 1000) * fps;
  const cycle = dur + fps * 0.6;
  const x = Math.min(1, (f % cycle) / dur);
  const p = ease(e.ease, x, fps);
  const pts = Array.from({ length: 41 }, (_, i) => `${(i / 40) * 220},${150 - ease(e.ease, i / 40, fps) * 150}`).join(" ");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
      <div style={{ position: "relative", width: 520, height: 140, borderRadius: 32, background: "rgb(255 255 255 / 0.07)" }}>
        <div style={{ position: "absolute", top: 30, left: 30 + p * 380, width: 80, height: 80, borderRadius: 24, background: L.accent }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <svg width={220} height={150} style={{ overflow: "visible" }}><polyline points={pts} fill="none" stroke={L.ink} strokeWidth={5} strokeLinejoin="round" /></svg>
        <span style={{ fontFamily: MONO, fontSize: 28, color: L.muted }}>{label}</span>
      </div>
    </div>
  );
}
function MotionScene({ v, L }: SceneProps & { v: Extract<Visual, { kind: "motion" }> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 60 }}>
      <Lane e={v.from} label={`${v.from.ease} · ${v.from.ms} ms`} L={L} />
      <Lane e={v.to} label={`${v.to.ease} · ${v.to.ms} ms`} L={L} />
    </div>
  );
}

function RuleScene({ v, L }: SceneProps & { v: Extract<Visual, { kind: "rule" }> }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const parts = v.text.split(/(\s*[=+×÷<>→-]\s*)/).filter(Boolean);
  return (
    <div style={{ width: 880, padding: "70px 64px", borderRadius: 44, background: "rgb(255 255 255 / 0.06)", border: "2px solid rgb(255 255 255 / 0.1)" }}>
      <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: v.text.length > 34 ? 70 : 88, lineHeight: 1.12, letterSpacing: "-0.035em", color: L.ink, textWrap: "balance" }}>
        {parts.map((x, i) => {
          const t = spring({ frame: f - 4 - i * 4, fps, config: { damping: 200, stiffness: 180 } });
          const op = /^\s*[=+×÷<>→-]\s*$/.test(x);
          return <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: t, transform: `translateY(${(1 - t) * 30}px)`, color: op ? L.accent : undefined }}>{x}</span>;
        })}
      </div>
    </div>
  );
}

function CodeScene({ v, L }: SceneProps & { v: Extract<Visual, { kind: "code" }> }) {
  const lines = v.code.split("\n");
  return (
    <div style={{ width: 880, borderRadius: 36, background: "#14161b", border: "2px solid rgb(255 255 255 / 0.08)", padding: "44px 0", boxShadow: "0 40px 80px -30px rgb(0 0 0 / 0.7)" }}>
      {v.lang && <div style={{ padding: "0 48px 22px", fontFamily: MONO, fontSize: 26, color: L.muted }}>{v.lang}</div>}
      {lines.map((l, i) => {
        const on = v.highlight.includes(i + 1);
        return (
          <div key={i} style={{ display: "flex", gap: 30, padding: "6px 48px", background: on ? `color-mix(in srgb, ${L.accent} 20%, transparent)` : undefined, fontFamily: MONO, fontSize: 36, lineHeight: 1.45, color: on ? L.ink : "rgb(244 242 238 / 0.72)", whiteSpace: "pre" }}>
            <span style={{ width: 30, color: "rgb(255 255 255 / 0.28)", textAlign: "right" }}>{i + 1}</span>{l}
          </div>
        );
      })}
    </div>
  );
}

// Gerçek sayfa: tarayıcı çerçevesinde, sahne boyunca yavaşça aşağı kayar ve biraz yaklaşır.
function ScreenScene({ v, frames, L }: SceneProps & { v: Extract<Visual, { kind: "screen" }> }) {
  const f = useCurrentFrame();
  const t = interpolate(f, [0, frames], [0, 1], { extrapolateRight: "clamp" });
  const host = v.url.replace(/^https:\/\//, "").replace(/\/$/, "");
  return (
    <div style={{ width: 880, height: 780, borderRadius: 36, overflow: "hidden", background: "#fff", boxShadow: "0 40px 80px -30px rgb(0 0 0 / 0.7)", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 72, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 28px", background: "#ececef" }}>
        {[0, 1, 2].map((i) => <i key={i} style={{ width: 16, height: 16, borderRadius: 8, background: "#c9c9ce" }} />)}
        <span style={{ marginLeft: 16, flex: 1, height: 44, borderRadius: 22, background: "#fff", display: "flex", alignItems: "center", padding: "0 22px", fontFamily: MONO, fontSize: 24, color: "#55565c", overflow: "hidden", whiteSpace: "nowrap" }}>{host}</span>
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        {v.image
          ? <Img src={v.image} style={{ position: "absolute", left: 0, top: 0, width: "100%", transformOrigin: "50% 0", transform: `translateY(${-t * 38}%) scale(${1 + t * 0.06})` }} />
          : <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontFamily: MONO, fontSize: 30, color: L.muted }}>{host}</div>}
      </div>
    </div>
  );
}

function TitleScene({ v, L }: SceneProps & { v: Extract<Visual, { kind: "title" }> }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = v.text.split(/\s+/);
  return (
    <h1 style={{ margin: 0, width: 880, fontFamily: DISPLAY, fontWeight: 800, fontSize: v.text.length > 30 ? 104 : 128, lineHeight: 1.02, letterSpacing: "-0.04em", color: L.ink, textWrap: "balance" }}>
      {words.map((w, i) => {
        const t = spring({ frame: f - 2 - i * 3, fps, config: { damping: 200, stiffness: 190, mass: 0.7 } });
        return <span key={i} style={{ display: "inline-block", whiteSpace: "pre", opacity: t, transform: `translateY(${(1 - t) * 0.4}em)` }}>{w}{i < words.length - 1 ? " " : ""}</span>;
      })}
    </h1>
  );
}

export function Scene(p: SceneProps) {
  const v = p.v;
  if (v.kind === "card") return <CardScene {...p} v={v} />;
  if (v.kind === "type") return <TypeScene {...p} v={v} />;
  if (v.kind === "color") return <ColorScene {...p} v={v} />;
  if (v.kind === "motion") return <MotionScene {...p} v={v} />;
  if (v.kind === "code") return <CodeScene {...p} v={v} />;
  if (v.kind === "screen") return <ScreenScene {...p} v={v} />;
  if (v.kind === "rule") return <RuleScene {...p} v={v} />;
  return <TitleScene {...p} v={v} />;
}
