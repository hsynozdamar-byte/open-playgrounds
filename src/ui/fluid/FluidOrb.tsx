import { useEffect, useRef } from "react";
import { DEFAULTS, type FluidParams, mount, PAD } from "./engine";
import { hex, hsl, PLAYGROUNDS_COLORS, playgroundsParams, type Tweaks, worldParams, type WorldColors } from "./world";
export { companion, PLAYGROUNDS_COLORS, playgroundsParams, seedOf, type Tweaks, worldParams, type WorldColors } from "./world";

// Soft Fluid visual system: three components, one rendering backend (engine.ts).
// PlaygroundsOrb = the colors of all worlds together (the logo); WorldOrb = from the colors the user chose, calmer and simpler;
// FluidOrb = the generic component with every knob exposed.


// params: fixed values; frame: values recomputed every frame (e.g. breathing).
// size: pixels or a CSS length (like var(--logo)); for a CSS length the real size is measured and the orb is rebuilt when it changes.
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
  // Without WebGL: a soft static fallback from the same colors
  const [a, b = a, c = b] = params.colors;
  return (
    <span ref={wrap} className={`fluid ${className}`} style={{ width: size, height: size, ["--fa" as string]: a, ["--fb" as string]: b, ["--fc" as string]: c }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <canvas ref={ref} style={params.mode === 4 ? { position: "absolute", inset: `${-(PAD - 1) * 50}%`, width: `${PAD * 100}%`, height: `${PAD * 100}%` } : { width: "100%", height: "100%" }} />
      {children}
    </span>
  );
}

// Main identity: cyan, coral, pink, purple, soft blue. 5 large color fields, slow and continuous.
// Swirl palette (cyclic): orange, red-pink, purple, blue, cyan, yellow
// interactive: while the pointer is over the orb the colors flow toward it
export function PlaygroundsOrb({ size = 40, tweaks = {}, interactive = false }: { size?: number | string; colors?: string[]; tweaks?: Tweaks; interactive?: boolean }) {
  const p = playgroundsParams(tweaks);
  const ptr = usePointer(interactive);
  return <FluidCanvas size={size} params={p} frame={interactive ? (q) => ({ ...q, ptr: ptr.current.cur }) : undefined} label="Playgrounds" pointerRef={interactive ? ptr : undefined} />;
}

// Pointer tracking: the target position is followed smoothly; the effect fades when the pointer leaves
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

// ---------- Fluid Orb (generic component) ----------
// The live orb. When colors is given (2-3 colors) the same structure runs with those colors (a world).
// intensity = silhouette deformation (0.5 is about 5%), fluidity = inner flow, separation = tendency to split off (rare),
// grain = grain, blur = edge softness, speed = speed (1 = a flow of about 12-18 s), animated = false gives a still frame.
export type FluidOrbProps = { colors?: string[]; seed?: number; speed?: number; intensity?: number; fluidity?: number; separation?: number; grain?: number; blur?: number; size?: number | string; animated?: boolean };
export function FluidOrb({ colors, seed = 11, speed = 1, intensity = 0.5, fluidity = 0.6, separation = 0.6, grain = 0.6, blur = 0.55, size = 320, animated = true }: FluidOrbProps) {
  const p: FluidParams = { ...DEFAULTS, colors: colors?.length ? colors : PLAYGROUNDS_COLORS, mode: 4, layers: colors?.length ? 2 : 4, seed, speed: 1.4 * speed, deform: intensity, warp: fluidity, spread: separation, noise: grain, blur, animated };
  return <FluidCanvas size={size} params={p} label="Playgrounds" />;
}

// ---------- World ----------
// Parameters live in world.ts (no React, so other renderers can draw the same orbs).
export function WorldOrb({ id, colors, size = 22, tweaks }: { id: string; colors: WorldColors; size?: number | string; tweaks?: Tweaks }) {
  return <FluidCanvas size={size} params={worldParams(id, colors, tweaks)} />;
}
