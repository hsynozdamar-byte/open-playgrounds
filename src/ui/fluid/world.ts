// Soft Fluid küre parametreleri (React'sız): Playgrounds logosu ve dünya küreleri. FluidOrb.tsx ve Playground Browser (browser/ui/orbs.ts) kullanır.
import { DEFAULTS, type FluidParams, hexRgb } from "./engine";

// speed bir çarpan (1 = bileşenin kendi hızı); diğerleri doğrudan değer
export type Tweaks = Partial<Pick<FluidParams, "speed" | "blur" | "noise" | "deform" | "warp" | "glow" | "spread">>;

// Ana kimlik: cyan, mercan, pembe, mor, yumuşak mavi. 5 büyük renk alanı, yavaş ve sürekli.
// Girdap paleti (döngüsel): turuncu, kırmızı-pembe, mor, mavi, camgöbeği, sarı
export const PLAYGROUNDS_COLORS = ["#ff4d1f", "#ff2d8f", "#9b2cff", "#1f3dff", "#1fd0f5", "#ffc21f"];
export const playgroundsParams = (tweaks: Tweaks = {}): FluidParams => ({ ...DEFAULTS, colors: PLAYGROUNDS_COLORS, seed: 11, mode: 4, layers: 5, deform: 0.3, warp: 0.6, spread: 0.6, noise: 0.6, blur: 0.55, glow: 1, ...tweaks, speed: 1.4 * (tweaks.speed ?? 1) });

// ---------- Dünya ----------
// Girdi: kullanıcının seçtiği 1–3 renk. Tamamlayıcı ton seçilmediyse ana renkten üretilir.
// Görünüm (referans 67): tek S kıvrımıyla kenetlenen iki şerit, aralarında beyaz pus. Kimlik (akış yönü, kıvrım,
// yoğunluk) dünyanın kimliğinden türetilir: dünya tekrar açıldığında aynı kalır.
export type WorldColors = { primary: string; secondary?: string; accent?: string };

export function hsl(hex: string): [number, number, number] {
  const [r, g, b] = hexRgb(hex); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hex(h: number, s: number, l: number) {
  h = ((h % 360) + 360) % 360; const f = (n: number) => { const k = (n + h / 30) % 12; const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); };
  return `#${f(0)}${f(8)}${f(4)}`;
}
export function companion(primary: string) {
  const [h, s, l] = hsl(primary);
  return hex(h + 40, Math.min(1, s * 0.95), Math.max(0.42, l - 0.06));
}
export function seedOf(id: string) { let n = 7; for (const c of id) n = (n * 31 + c.charCodeAt(0)) % 100003; return n; }

export function worldParams(id: string, colors: WorldColors, tweaks: Tweaks = {}): FluidParams {
  const s = seedOf(id), r = (k: number) => ((s * (k * 2654435761 % 1000)) % 1000) / 1000;
  // Logo ile aynı yıkama küre, dünyanın renk ailesinde (seçilen ikinci/üçüncü renk varsa aileye katılır)
  // Ton yakın tutulur (±25°): mavi dünya maviden, turuncu dünya turuncudan okunur
  const [h, sa, l] = hsl(colors.primary);
  // İkinci ton seçildiyse alanlar iki renk arasında paylaşılır; seçilmediyse ana rengin yakın tonları
  let list: string[];
  if (colors.secondary) {
    const [h2, s2, l2] = hsl(colors.secondary);
    list = [colors.primary, colors.secondary, hex(h, sa, Math.max(.3, l - .12)), hex(h2, s2, Math.min(.66, l2 + .06)), colors.accent || hex(h, sa, Math.min(.62, l + .06))];
  } else list = [colors.primary, hex(h - 22, sa, Math.max(.38, l - .08)), hex(h + 24, Math.min(1, sa * .95), Math.min(.6, l + .04)), colors.accent || hex(h, sa, Math.max(.3, l - .14)), hex(h + 10, sa, l)];
  return { ...DEFAULTS, colors: list, seed: s, mode: 4, layers: 5, noise: 0.55, blur: 0.5, deform: 0.3 + r(2) * 0.2, warp: 0.6, spread: 0.3, ...tweaks, speed: (1.5 + r(1) * 0.3) * (tweaks.speed ?? 1) };
}
