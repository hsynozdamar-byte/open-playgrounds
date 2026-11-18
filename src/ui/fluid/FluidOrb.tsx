import { useEffect, useRef } from "react";
import { DEFAULTS, type FluidParams, mount, PAD } from "./engine";
import { hex, hsl, PLAYGROUNDS_COLORS, playgroundsParams, type Tweaks, worldParams, type WorldColors } from "./world";
export { companion, PLAYGROUNDS_COLORS, playgroundsParams, seedOf, type Tweaks, worldParams, type WorldColors } from "./world";

// Soft Fluid görsel sistemi: üç bileşen, tek render altyapısı (engine.ts).
// PlaygroundsOrb = bütün dünyaların renkleri bir arada; WorldOrb = kullanıcının seçtiği renklerden, daha sade ve sakin;
// AgentOrb = aynı dil, durumlara göre nefes alan, yönelen, yoğunlaşan karakter.


// params: sabit değerler; frame: her karede yeniden hesaplanan değerler (ajanın nefesi, konuşma ritmi).
// size: piksel ya da CSS uzunluğu (var(--logo) gibi); CSS uzunluğunda gerçek boyut ölçülür, değişince yeniden kurulur.
export function FluidCanvas({ size, params, frame, className = "", children, label, pointerRef }: { size: number | string; params: FluidParams; frame?: (p: FluidParams) => FluidParams; className?: string; children?: React.ReactNode; label?: string; pointerRef?: { current: { el: HTMLElement | null } } }) {
  const wrap = useRef<HTMLSpanElement>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ params, frame });
  live.current = { params, frame };
  const h = useRef<ReturnType<typeof mount> | null>(null);
  useEffect(() => {
    const el = wrap.current!;
    if (pointerRef) pointerRef.current.el = el;
    let px = 0;
    const setup = () => {
      const w = Math.round(el.offsetWidth);
      if (!w || w === px) return;
      px = w; h.current?.destroy();
      h.current = mount(ref.current!, () => { const { params: p, frame: f } = live.current; return f ? f(p) : p; }, Math.round(w * (live.current.params.mode === 4 ? PAD : 1)));
    };
    setup();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(setup) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); h.current?.destroy(); h.current = null; };
  }, []);
  useEffect(() => { h.current?.update(); });
  // WebGL yoksa aynı renklerden yumuşak, statik bir yedek
  const [a, b = a, c = b] = params.colors;
  return (
    <span ref={wrap} className={`fluid ${className}`} style={{ width: size, height: size, ["--fa" as string]: a, ["--fb" as string]: b, ["--fc" as string]: c }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <canvas ref={ref} style={params.mode === 4 ? { position: "absolute", inset: `${-(PAD - 1) * 50}%`, width: `${PAD * 100}%`, height: `${PAD * 100}%` } : { width: "100%", height: "100%" }} />
      {children}
    </span>
  );
}

// Ana kimlik: cyan, mercan, pembe, mor, yumuşak mavi. 5 büyük renk alanı, yavaş ve sürekli.
// Girdap paleti (döngüsel): turuncu, kırmızı-pembe, mor, mavi, camgöbeği, sarı
// interactive: imleç orb'un üzerindeyken renkler ona doğru akar (giriş ekranı)
export function PlaygroundsOrb({ size = 40, tweaks = {}, interactive = false }: { size?: number | string; colors?: string[]; tweaks?: Tweaks; interactive?: boolean }) {
  const p = playgroundsParams(tweaks);
  const ptr = usePointer(interactive);
  return <FluidCanvas size={size} params={p} frame={interactive ? (q) => ({ ...q, ptr: ptr.current.cur }) : undefined} label="Playgrounds" pointerRef={interactive ? ptr : undefined} />;
}

// İmleç takibi: hedef konum yumuşakça izlenir, imleç uzaklaşınca etki söner
type Ptr = { el: HTMLElement | null; tgt: [number, number, number]; cur: [number, number, number]; last: number };
function usePointer(on: boolean) {
  const r = useRef<Ptr>({ el: null, tgt: [0, 0, 0], cur: [0, 0, 0], last: 0 });
  useEffect(() => {
    if (!on) return;
    const move = (e: PointerEvent) => {
      const el = r.current.el; if (!el) return;
      const b = el.getBoundingClientRect(), R = b.width / 2;
      const x = (e.clientX - b.left - R) / (R * 0.94), y = -(e.clientY - b.top - R) / (R * 0.94);
      r.current.tgt = [x, y, Math.max(0, 1 - Math.max(0, Math.hypot(x, y) - 1) * 1.5)];
    };
    const leave = () => { r.current.tgt = [r.current.tgt[0], r.current.tgt[1], 0]; };
    addEventListener("pointermove", move); document.addEventListener("pointerleave", leave);
    let raf = 0;
    const step = (now: number) => {
      const s = r.current, dt = Math.min(0.05, (now - (s.last || now)) / 1000); s.last = now;
      const k = 1 - Math.exp(-dt * 4);
      s.cur = [s.cur[0] + (s.tgt[0] - s.cur[0]) * k, s.cur[1] + (s.tgt[1] - s.cur[1]) * k, s.cur[2] + (s.tgt[2] - s.cur[2]) * k];
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { removeEventListener("pointermove", move); document.removeEventListener("pointerleave", leave); cancelAnimationFrame(raf); };
  }, [on]);
  return r;
}

// ---------- Fluid Orb (genel bileşen) ----------
// Referans orb'un canlı hâli. colors verilirse (2-3 renk) aynı yapı o renklerle çalışır (dünya, ajan).
// intensity = silüet deformasyonu (0.5 ≈ %5), fluidity = iç akış, separation = ayrılma eğilimi (seyrek),
// grain = tanecik, blur = kenar yumuşaklığı, speed = hız (1 = ~12-18 sn'lik akış), animated = false ise durgun kare.
export type FluidOrbProps = { colors?: string[]; seed?: number; speed?: number; intensity?: number; fluidity?: number; separation?: number; grain?: number; blur?: number; size?: number | string; animated?: boolean; state?: AgentState };
export function FluidOrb({ colors, seed = 11, speed = 1, intensity = 0.5, fluidity = 0.6, separation = 0.6, grain = 0.6, blur = 0.55, size = 320, animated = true, state }: FluidOrbProps) {
  const p: FluidParams = { ...DEFAULTS, colors: colors?.length ? colors : PLAYGROUNDS_COLORS, mode: 4, layers: colors?.length ? 2 : 4, seed, speed: 1.4 * speed, deform: intensity, warp: fluidity, spread: separation, noise: grain, blur, animated };
  const t0 = useRef(0);
  const frame = state ? (q: FluidParams): FluidParams => {
    if (!t0.current) t0.current = performance.now();
    const st = stateParams(state, (performance.now() - t0.current) / 1000);
    return { ...q, ...st, speed: (st.speed ?? q.speed) * speed, warp: q.warp, deform: q.deform, glow: q.glow };
  } : undefined;
  return <FluidCanvas size={size} params={p} frame={frame} label="Playgrounds" />;
}

// ---------- Dünya ----------
// Parametreler world.ts'te (React'sız; Playground Browser da aynı küreleri çizer).
export function WorldOrb({ id, colors, size = 22, tweaks }: { id: string; colors: WorldColors; size?: number | string; tweaks?: Tweaks }) {
  return <FluidCanvas size={size} params={worldParams(id, colors, tweaks)} />;
}

// ---------- Ajan ----------
export type AgentState = "idle" | "listening" | "thinking" | "speaking" | "happy" | "loading";
export const AGENT_COLORS = ["#7b3cff", "#2f6bff", "#22d3f5", "#ff4fb8", "#b892ff"];
// Tek renkten girdap ailesi (Rou rengi): komşu tonlar + açık ve canlı yan renkler
// Rou'nun kubbesi: tek rengin yakın tonları (neon, gökkuşağı değil)
export function rouTones(c: string) { const [h, s, l] = hsl(c); return [c, hex(h - 12, s, Math.max(.4, l - .08)), hex(h + 14, s, Math.min(.66, l + .06)), hex(h, s * .9, Math.min(.78, l + .18)), hex(h + 6, s, l)]; }
export function family(c: string) { const [h, s, l] = hsl(c); return [c, hex(h - 35, s, Math.max(.45, l - .05)), hex(h + 45, Math.min(1, s * .95), Math.min(.7, l + .1)), hex(h - 80, Math.min(1, s * .9), .62), hex(h + 15, s * .7, .8)]; }

// Her durumun hedef parametreleri; engine geçişi yumuşak yapar. Zamanla değişen kısım (nefes, konuşma ritmi) burada hesaplanır.
function stateParams(state: AgentState, t: number): Partial<FluidParams> {
  const breath = Math.sin(t * 1.25) * 0.025;
  switch (state) {
    case "listening": return { breathe: breath * 0.6 + 0.02, lean: [0.0, -0.55], ripple: 0.55, scale: 1.02, speed: 0.8 };
    case "thinking": return { breathe: breath * 0.5, focus: 1, speed: 0.7, warp: 0.75, ripple: 0.15 };
    case "speaking": {
      // Konuşma ritmi: birkaç düzensiz dalganın toplamı, sert değil
      const v = Math.max(0, Math.sin(t * 7.1) * 0.5 + Math.sin(t * 11.3 + 1.2) * 0.3 + Math.sin(t * 3.7) * 0.4);
      return { breathe: 0.01 + v * 0.03, ripple: 0.3 + v * 0.6, speed: 0.9 };
    }
    case "happy": return { breathe: breath + 0.05, sat: 1.25, lift: 1, speed: 0.85, glow: 0.35 };
    case "loading": return { breathe: breath * 0.4, orbit: 0.85, speed: 0.9, warp: 0.7 };
    default: return { breathe: breath, speed: 0.5 };
  }
}

// Rou (uMode 5): inci kask + koyu ekran. Renk alanı Playgrounds logosuyla aynı (seed 11, aynı hız, ortak saat):
// logo değiştikçe Rou'nun kaskı da aynı anda aynı renklere döner. Rou'ya renk seçildiyse o rengin tonlarıyla.
export function RouOrb({ state = "idle", size = 64, colors }: { state?: AgentState; size?: number | string; colors?: string[] }) {
  const base: FluidParams = { ...DEFAULTS, colors: colors ?? PLAYGROUNDS_COLORS, seed: 11, mode: 5, speed: 1.4, glow: colors ? 0 : 1, noise: 0.4, blur: 0.2 };
  const t0 = useRef(0);
  const frame = (p: FluidParams): FluidParams => {
    if (!t0.current) t0.current = performance.now();
    const s = stateParams(state, (performance.now() - t0.current) / 1000);
    return { ...p, focus: s.focus ?? 0, ripple: s.ripple ?? 0 };
  };
  return <FluidCanvas size={size} params={base} frame={frame} className={`fluid-rou is-${state}`} />;
}

export function AgentOrb({ state = "idle", size = 64, colors = AGENT_COLORS, eyes = false, tweaks = {} }: { state?: AgentState; size?: number | string; colors?: string[]; eyes?: boolean; tweaks?: Tweaks }) {
  const t0 = useRef(0);
  const base: FluidParams = { ...DEFAULTS, colors, seed: 23, mode: 4, layers: 5, spread: 0.25, speed: 0.75, deform: 0.5, warp: 0.6, noise: 0.3, blur: 0.3, ...tweaks };
  const frame = (p: FluidParams): FluidParams => {
    if (!t0.current) t0.current = performance.now();
    const s = stateParams(state, (performance.now() - t0.current) / 1000);
    return { ...p, ...s, speed: (s.speed ?? p.speed) * (tweaks.speed ?? 1) };
  };
  return (
    <FluidCanvas size={size} params={base} frame={frame} className={`fluid-agent is-${state}`} label="Assistant">
      {eyes && <span className="fluid-eyes" style={{ ["--s" as string]: typeof size === "number" ? `${size}px` : size }}><i /><i /></span>}
    </FluidCanvas>
  );
}
