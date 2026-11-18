import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RouMascot } from "./Rou";

// On desktop Rou in the top bar very rarely lifts off its place and floats to a few points on screen. When the pointer reaches Rou's button
// (or the wandering Rou is clicked, or the chat opens) it quickly returns. On mobile, touch and reduced motion
// it never leaves. To test, in the console: dispatchEvent(new Event("pg-rou-wander")).
const FIRST = [60, 150], NEXT = [150, 320];   // seconds: first outing and gap between later ones
const SIZE = 44;
const rnd = ([a, b]: number[]) => a + Math.random() * (b - a);
const ease = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

type Leg = { x0: number; y0: number; x1: number; y1: number; t0: number; dur: number; hold: number };

export function RouWander({ home, onAway }: { home: React.RefObject<HTMLElement | null>; onAway: (v: boolean) => void }) {
  const [on, setOn] = useState(false);
  const [mood, setMood] = useState<"idle" | "happy">("idle");
  const el = useRef<HTMLDivElement>(null);
  const st = useRef({ legs: [] as Leg[], i: 0, back: false, x: 0, y: 0 });
  const ok = () => matchMedia("(hover: hover) and (pointer: fine) and (min-width: 721px)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const homeAt = () => { const r = home.current?.querySelector(".rou")?.getBoundingClientRect() ?? home.current!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };

  // Timer: leave rarely
  useEffect(() => {
    let tm = 0;
    const go = () => {
      if (!ok() || document.hidden || on || !home.current) return;
      const h = homeAt(), now = performance.now() / 1000, legs: Leg[] = [];
      let x = h.x, y = h.y, t = now;
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const nx = 90 + Math.random() * (innerWidth - 180), ny = 110 + Math.random() * (innerHeight - 200);
        const dur = 1.8 + Math.hypot(nx - x, ny - y) / 420;
        legs.push({ x0: x, y0: y, x1: nx, y1: ny, t0: t, dur, hold: 1 + Math.random() * 2.2 });
        t += dur + legs[legs.length - 1].hold; x = nx; y = ny;
      }
      st.current = { legs, i: 0, back: false, x: h.x, y: h.y };
      setMood("idle"); setOn(true); onAway(true);
    };
    const plan = (r: number[]) => { tm = window.setTimeout(() => { go(); plan(NEXT); }, rnd(r) * 1000); };
    plan(FIRST);
    addEventListener("pg-rou-wander", go);
    return () => { clearTimeout(tm); removeEventListener("pg-rou-wander", go); };
  }, [on]);

  // Movement and return
  useEffect(() => {
    if (!on) return;
    let raf = 0, px = st.current.x;
    const goHome = () => {
      const s = st.current; if (s.back) return;
      const h = homeAt(), now = performance.now() / 1000;
      s.back = true; s.legs = [{ x0: s.x, y0: s.y, x1: h.x, y1: h.y, t0: now, dur: Math.min(0.7, 0.3 + Math.hypot(h.x - s.x, h.y - s.y) / 2600), hold: 0 }]; s.i = 0;
      setMood("happy");
    };
    const near = (e: PointerEvent) => { const r = home.current?.getBoundingClientRect(); if (r && e.clientX > r.left - 10 && e.clientX < r.right + 10 && e.clientY > r.top - 10 && e.clientY < r.bottom + 10) goHome(); };
    addEventListener("pointermove", near); addEventListener("pg-rou", goHome); addEventListener("pg-rou-back", goHome);
    const step = () => {
      const s = st.current, now = performance.now() / 1000;
      let leg = s.legs[s.i];
      if (!leg) { if (!s.back) goHome(); raf = requestAnimationFrame(step); return; }
      if (now > leg.t0 + leg.dur + leg.hold) {
        if (s.back) { setOn(false); onAway(false); return; }
        s.i++; leg = s.legs[s.i]; if (!leg) { goHome(); raf = requestAnimationFrame(step); return; }
      }
      const u = Math.max(0, Math.min(1, (now - leg.t0) / leg.dur)), k = s.back ? u * u * (3 - 2 * u) : ease(u);
      // the path is slightly curved: an arc, not a straight line
      const bend = s.back ? 0 : Math.sin(u * Math.PI) * 60 * (s.i % 2 ? 1 : -1);
      const dx = leg.x1 - leg.x0, dy = leg.y1 - leg.y0, L = Math.hypot(dx, dy) || 1;
      s.x = leg.x0 + dx * k - (dy / L) * bend; s.y = leg.y0 + dy * k + (dx / L) * bend;
      const vx = s.x - px; px = s.x;
      const float = s.back ? 0 : Math.sin(now * 2.6) * 4;
      const lean = Math.max(-20, Math.min(20, vx * 1.6));
      const sc = s.back ? 1 - 0.32 * k : 0.68 + 0.32 * Math.min(1, (now - s.legs[0].t0) / 0.4);   // grows when leaving its 30 px place, shrinks when returning
      el.current!.style.transform = `translate(${s.x - SIZE / 2}px, ${s.y - SIZE / 2 + float}px) scale(${sc}) rotate(${lean}deg)`;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); removeEventListener("pointermove", near); removeEventListener("pg-rou", goHome); removeEventListener("pg-rou-back", goHome); };
  }, [on]);

  if (!on) return null;
  return createPortal(
    <div ref={el} className="rou-wander" onClick={(e) => { e.stopPropagation(); dispatchEvent(new CustomEvent("pg-rou-back")); }} aria-hidden>
      <RouMascot size={SIZE} mood={mood} />
    </div>,
    document.body,
  );
}
