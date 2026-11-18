// Ortak görünüm: yazı tipi, renk ve zemin. Slayt ve Reels aynı dili konuşur.
import { loadFont as display } from "@remotion/google-fonts/InterTight";
import { loadFont as mono } from "@remotion/google-fonts/GeistMono";
import type { CSSProperties, ReactElement } from "react";

export const DISPLAY = display("normal", { weights: ["500", "600", "800"], subsets: ["latin", "latin-ext"] }).fontFamily;
export const MONO = mono("normal", { weights: ["500"], subsets: ["latin", "latin-ext"] }).fontFamily;

export type Account = { name: string; handle: string; color: string };

export const INK = "#f4f2ee";
export const BASE = "#0c0d10";

// Hesap rengi koyu zeminde okunsun diye açılır (vurgu yazısı için).
export function readable(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#7fb0ff";
  const n = parseInt(m[1], 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum < 0.55) {
    const k = (0.62 - lum) / (1 - lum);
    [r, g, b] = [r, g, b].map((x) => Math.round(x + (255 - x) * k));
  }
  return `rgb(${r} ${g} ${b})`;
}

// Zemin: koyu taban, hesap renginde yumuşak ışık, ince gren.
const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .5 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>')}")`;
export function Backdrop({ color, x = 18, y = 12, strength = 1 }: { color: string; x?: number; y?: number; strength?: number }) {
  const glow: CSSProperties = {
    position: "absolute",
    inset: 0,
    background: [
      `radial-gradient(70% 55% at ${x}% ${y}%, color-mix(in srgb, ${color} ${Math.round(46 * strength)}%, transparent), transparent 70%)`,
      `radial-gradient(60% 45% at ${100 - x}% ${100 - y / 2}%, color-mix(in srgb, ${color} ${Math.round(16 * strength)}%, transparent), transparent 75%)`,
      BASE,
    ].join(", "),
  };
  return (
    <>
      <div style={glow} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.07, mixBlendMode: "overlay" }} />
    </>
  );
}

// Uzun metinde yazı küçülür: karakter sayısına göre basamaklı boyut.
export const fit = (text: string, steps: [number, number][]) => {
  const n = text.length;
  for (const [max, size] of steps) if (n <= max) return size;
  return steps[steps.length - 1][1];
};

// Başlık satırları anlamdan kırılır (BİR ÇATI, / ÜÇ ŞİRKET): balance yalnız uzunluğa bakıp ifadeyi ortadan bölüyordu.
// Virgül, nokta, iki nokta ya da yazarın \n'si satır sonu olur; kısa kelimeler (≤3 harf) sonraki kelimeye yapışır, satır sonunda kalmaz.
export const phrase = (t: string) =>
  t.replace(/([,.:;!?])\s+(?=\S)/g, "$1\n").replace(/(^|[\s\u00a0])(\S{1,3}) (?=\S)/gu, "$1$2\u00a0");
export const phraseStyle = { whiteSpace: "pre-line" as const };

// Açık zeminde okunsun diye koyulaştırılmış hesap rengi.
export function deep(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#1f5fbf";
  const n = parseInt(m[1], 16);
  let [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  if (lum > 0.42) [r, g, b] = [r, g, b].map((x) => Math.round(x * (0.42 / lum)));
  return `rgb(${r} ${g} ${b})`;
}

// Şablonlar: slayt ve Reels aynı şablonu kullanır. Uygulamadaki seçici de bu adları kullanır (src/ui/PostEditor.tsx).
export type Template = "night" | "paper" | "bold";
export type Look = { ink: string; muted: string; accent: string; dot: string; bg: (p: { color: string; x?: number; y?: number; strength?: number }) => ReactElement };

function Paper() {
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: "#f2eee6" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.12, mixBlendMode: "multiply" }} />
    </>
  );
}
function Bold({ color }: { color: string }) {
  return (
    <>
      <div style={{ position: "absolute", inset: 0, background: color }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgb(255 255 255 / 0.14), transparent 45%, rgb(0 0 0 / 0.28))" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: GRAIN, opacity: 0.08, mixBlendMode: "overlay" }} />
    </>
  );
}

export function look(template: string | undefined, color: string): Look {
  if (template === "paper") return { ink: "#16140f", muted: "rgb(22 20 15 / 0.62)", accent: deep(color), dot: deep(color), bg: () => <Paper /> };
  if (template === "bold") return { ink: "#ffffff", muted: "rgb(255 255 255 / 0.74)", accent: "#0c0d10", dot: "#ffffff", bg: (p) => <Bold color={p.color} /> };
  return { ink: INK, muted: "rgb(244 242 238 / 0.6)", accent: readable(color), dot: readable(color), bg: (p) => <Backdrop {...p} /> };
}
