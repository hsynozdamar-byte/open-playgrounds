import { useEffect, useRef, useState } from "react";
import { RouMascot } from "./Rou";
import { PLAYGROUNDS_COLORS } from "./fluid/FluidOrb";

// Rou on the welcome screen: lives around the "Playgrounds" wordmark. There is a 3D scene around the text: z < 0 is behind the text
// (shrinks, blurs, stays behind the letters), z > 0 in front (grows). Rou does different things in turn:
// laps the text like a comet, sits on the letters and looks around, peeks out from behind them,
// thinks, drifts far away and comes back, does a flip, dozes. It picks the order at random and never repeats the same act;
// it greets on opening and on click, otherwise only rarely. With reduced motion it sits still on the text.
type V = { x: number; y: number; z: number };   // relative to the text centre, in units of text height (H)
type Bubble = { kind: "say" | "think"; text: string } | null;
type St = V & { mood?: "idle" | "think" | "happy"; bubble?: Bubble; gaze?: [number, number] | null; rot?: number; sq?: number; sleep?: boolean; wave?: number; op?: number };
type Seg = { t0: number; dur: number; until: number; f: (u: number, t: number) => St };
type Metrics = { cx: number; cy: number; H: number; W: number; r: number; letters: { x: number; top: number }[]; vw: number; vh: number; floor: number };

const TRAIL = 0.42;   // trail length, s
const ZS = 0.45;   // depth scale: z=-1 → 0.55, z=1 → 1.45
const ZMAX = 1.45;
const EN = (() => { try { return new URLSearchParams(location.search).get("gate") === "en"; } catch { return false; } })();   // ?gate=en promo recording (Gate.tsx)
const THOUGHTS = ["Hmm…", "What should we focus on today?", "Any free time on the calendar?", "A coffee would be nice.", "Notes piling up?", "Shall we finish that project?"];

const RGB = PLAYGROUNDS_COLORS.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
const palAt = (x: number) => { const n = RGB.length, y = ((x % n) + n) % n, i = Math.floor(y), f = y - i, a = RGB[i], b = RGB[(i + 1) % n];
  return a.map((v, k) => Math.round(v + (b[k] - v) * f)); };
const inOut3 = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const inOut5 = (x: number) => (x < 0.5 ? 16 * x ** 5 : 1 - (-2 * x + 2) ** 5 / 2);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const bez = (a: V, b: V, c: V, d: V, u: number): V => {
  const m = 1 - u, A = m * m * m, B = 3 * m * m * u, C = 3 * m * u * u, D = u * u * u;
  return { x: A * a.x + B * b.x + C * c.x + D * d.x, y: A * a.y + B * b.y + C * c.y + D * d.y, z: A * a.z + B * b.z + C * c.z + D * d.z };
};
// Fixed gaze in pieces: [start u, gx, gy]
const gazeAt = (u: number, keys: [number, number, number][]): [number, number] | null => {
  let g: [number, number] | null = null;
  for (const [k, x, y] of keys) if (u >= k) g = [x, y];
  return g;
};

// Letter positions and top edges of the text (in H units, relative to the text centre)
function measure(mark: HTMLElement, gate: HTMLElement): Metrics {
  // Letters are separate spans (they rise one by one on opening): positions are read from offsets without transform, so they are right while the animation runs too
  const cs = getComputedStyle(mark);
  const H = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight) || H * 0.88;
  const gr = gate.getBoundingClientRect();
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const raw: { x: number; top: number; bl: number; l: number; r: number }[] = [];
  for (const el of mark.querySelectorAll<HTMLElement>(".gch")) {
    const ch = el.textContent ?? "", m = ctx.measureText(ch);
    const l = mark.offsetLeft + el.offsetLeft, top = mark.offsetTop + el.offsetTop;
    const bl = top + (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    raw.push({ x: l + el.offsetWidth / 2, top: bl - m.actualBoundingBoxAscent, bl, l, r: l + el.offsetWidth });
  }
  const mx = mark.offsetLeft, my = mark.offsetTop;
  const bl = raw.length ? raw[0].bl : my + lh;
  const capTop = raw.length ? Math.min(...raw.map((q) => q.top)) : my;
  const left = raw.length ? raw[0].l : mx, right = raw.length ? raw[raw.length - 1].r : mx + mark.offsetWidth;
  const cx = (left + right) / 2, cy = (capTop + bl) / 2;
  const R = Math.max(H * 0.72, 58);
  const form = gate.querySelector<HTMLElement>(".gate-form");
  return {
    cx, cy, H, W: (right - left) / H, r: R / H,
    letters: raw.map((q) => ({ x: (q.x - cx) / H, top: (q.top - cy) / H })),
    vw: gr.width, vh: gr.height, floor: form ? form.offsetTop - 8 : gr.height,
  };
}

export function GateRou({ name, mark }: { name: string; mark: React.RefObject<HTMLElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  const fig = useRef<HTMLDivElement>(null);
  const bub = useRef<HTMLSpanElement>(null);
  const said = useRef("\u00a0");
  const back = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);
  const [R, setR] = useState(0);
  const [look, setLook] = useState<{ mood: "idle" | "think" | "happy"; bubble: Bubble; sleep: boolean }>({ mood: "idle", bubble: null, sleep: false });
  const cmd = useRef<"" | "greet" | "leave">("");
  useEffect(() => { const f = () => { cmd.current = "leave"; }; addEventListener("pg-gate-leave", f); return () => removeEventListener("pg-gate-leave", f); }, []);

  useEffect(() => {
    const gate = box.current!.parentElement!;
    const el = mark.current;
    if (!el) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let M = measure(el, gate);
    setR(Math.round(M.r * M.H * ZMAX));
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cvs = [back.current!, front.current!];
    const ctx = cvs.map((c) => c.getContext("2d")!);
    const size = () => { for (const c of cvs) { c.width = M.vw * dpr; c.height = M.vh * dpr; c.style.width = `${M.vw}px`; c.style.height = `${M.vh}px`; } ctx.forEach((x) => x.setTransform(dpr, 0, 0, dpr, 0, 0)); };
    size();
    const ro = new ResizeObserver(() => { M = measure(el, gate); setR(Math.round(M.r * M.H * ZMAX)); size(); });
    ro.observe(gate); ro.observe(el);
    // Keep it off the edge of the screen and out of the form (clamp in H units)
    const clampV = (p: V): V => {
      const s = (1 + ZS * p.z) * M.r * 0.56;
      const minX = (s * M.H + 6 - M.cx) / M.H, maxX = (M.vw - s * M.H - 6 - M.cx) / M.H;
      const minY = (s * M.H + 10 - M.cy) / M.H, maxY = (M.floor - s * M.H - M.cy) / M.H;
      return { x: Math.min(maxX, Math.max(minX, p.x)), y: Math.min(maxY, Math.max(minY, p.y)), z: p.z };
    };
    const letter = (i: number) => M.letters[Math.min(M.letters.length - 1, Math.max(0, i))] ?? { x: 0, top: -0.4 };
    const sitAt = (i: number): V => { const z = 0.06, s = 1 + ZS * z; return { x: letter(i).x, y: letter(i).top - M.r * s * 0.45, z }; };
    const side = (dir: 1 | -1, z = 0.3): V => clampV({ x: dir * (M.W / 2 + M.r * 0.75), y: -0.25, z });
    const orbit = () => ({ rx: Math.min(M.W / 2 + M.r * 0.45, (M.vw / 2 - M.r * M.H * 0.6) / M.H), ry: 0.5, yc: -0.08 });
    const orbitAt = (th: number): V => { const o = orbit(); return { x: o.rx * Math.cos(th), y: o.yc + o.ry * Math.sin(th), z: Math.sin(th) }; };

    // Timeline: motion is a pure function of time (the trail history is sampled from the same function)
    const segs: Seg[] = [];
    let tEnd = 0, cur: V = sitAt(6), last: string[] = [], lastGreet = -99;
    const push = (dur: number, f: Seg["f"]) => { const s = { t0: tEnd, dur, until: tEnd + dur, f }; segs.push(s); tEnd += dur; const e = f(1, tEnd); cur = { x: e.x, y: e.y, z: e.z }; };
    const hold = (dur: number, at: V, extra: (u: number, t: number) => Partial<St> = () => ({})) =>
      push(dur, (u, t) => ({ ...at, y: at.y + Math.sin(t * 2.2) * 0.02, ...extra(u, t) }));
    const fly = (to: V, o: { dur?: number; arc?: number; dz?: number; mood?: St["mood"] } = {}) => {
      const a = cur, b = to;
      const d = Math.hypot(b.x - a.x, b.y - a.y, (b.z - a.z) * 1.5);
      const dur = o.dur ?? Math.min(1.8, Math.max(0.7, 0.55 + d * 0.28));
      const arc = o.arc ?? rnd(-0.6, -0.25) * Math.min(1.5, d);   // curve upward
      const dz = o.dz ?? rnd(-0.6, 0.6);
      const c1 = { x: lerp(a.x, b.x, 0.3), y: lerp(a.y, b.y, 0.3) + arc, z: lerp(a.z, b.z, 0.3) + dz };
      const c2 = { x: lerp(a.x, b.x, 0.7), y: lerp(a.y, b.y, 0.7) + arc * 0.7, z: lerp(a.z, b.z, 0.7) + dz * 0.6 };
      const dir = Math.sign(b.x - a.x) || 1;
      push(dur, (u) => ({ ...bez(a, c1, c2, b, inOut3(u)), mood: o.mood, gaze: u < 0.85 ? [dir * 0.9, 0] : null }));
    };
    const landSq = (u: number, dur: number) => { const k = (u * dur) / 0.42; return k < 1 ? 1 + 0.22 * Math.sin(Math.PI * k) * (1 - k) : 1; };

    const ACTS: Record<string, () => void> = {
      greet: () => {
        const at = side(Math.random() < 0.5 ? 1 : -1, 0.85);
        fly(at, { dz: 0.3 });
        wave(at);
      },
      greetHere: () => {   // on click: spins in place, comes forward if it is behind
        const at = clampV({ ...cur, z: Math.max(cur.z, 0.5) });
        if (Math.hypot(at.x - cur.x, at.y - cur.y, at.z - cur.z) > 0.05) fly(at, { dur: 0.45, arc: -0.1, dz: 0 });
        wave(at);
      },
    };
    const wave = (at: V) => {
      hold(2.6, at, (u) => ({ mood: "happy", wave: Math.min(1, u * 8, (1 - u) * 8), bubble: { kind: "say", text: !EN && name ? `Hi ${name}!` : "Hi there!" }, gaze: null }));
      lastGreet = tEnd;
    };
    Object.assign(ACTS, {
      lap: () => {
        const th0 = Math.PI * 0.5 + (Math.random() < 0.5 ? 0.45 : -0.45);
        fly(orbitAt(th0), { dur: 0.8 });
        const laps = Math.random() < 0.6 ? 1 : 2, dir = Math.random() < 0.5 ? 1 : -1, dur = 1.7 + laps * 1.1;
        push(dur, (u) => ({ ...orbitAt(th0 + dir * inOut5(u) * Math.PI * 2 * laps), gaze: [dir * -0.9, 0] }));
        hold(0.7, cur, () => ({ mood: "happy" }));
      },
      sit: () => {
        const i = pick([6, 7, 8, 1, 9]);
        fly(sitAt(i), { arc: -0.8 });
        const d1 = rnd(3.2, 4.4);
        hold(d1, sitAt(i), (u) => ({ sq: landSq(u, d1), gaze: gazeAt(u, [[0, 0, 0.6], [0.22, -1, 0.1], [0.48, 1, 0.1], [0.74, 0, -0.2]]), y: sitAt(i).y }));
        if (Math.random() < 0.6) {   // hop from letter to letter
          const j = i >= 8 ? i - 2 : i + 2, a = sitAt(i), b = sitAt(j);
          push(0.55, (u) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) - Math.sin(Math.PI * u) * 0.45, z: a.z, sq: 1 - 0.08 * Math.sin(Math.PI * u), gaze: [Math.sign(b.x - a.x), 0] }));
          hold(1.6, b, (u) => ({ sq: landSq(u, 1.6), gaze: [0, 0.3] }));
        }
      },
      peek: () => {
        const i = pick([2, 6, 7, 8]), L = letter(i), z = -0.28, s = 1 + ZS * z;
        const down = { x: L.x, y: L.top + M.r * s * 0.62, z }, up = { x: L.x, y: L.top + M.r * s * 0.12, z };
        fly({ ...down, y: down.y }, { dz: -0.9, arc: -0.3 });
        push(0.6, (u) => ({ ...down, y: lerp(down.y, up.y, inOut3(u)) }));
        hold(rnd(2.4, 3.2), up, (u) => ({ gaze: gazeAt(u, [[0, -1, 0], [0.4, 1, 0], [0.75, 0, 0.2]]) }));
        push(0.45, (u) => ({ ...up, y: lerp(up.y, down.y, inOut3(u)) }));
      },
      think: () => {
        const at = side(Math.random() < 0.5 ? 1 : -1, 0.35);
        fly(at);
        const text = pick(THOUGHTS.slice(1));
        hold(4.4, at, (u) => ({ mood: u < 0.88 ? "think" : "idle", gaze: gazeAt(u, [[0, -0.8, -0.8], [0.45, 0.8, -0.8], [0.88, 0, 0]]),
          bubble: u < 0.12 ? null : { kind: "think", text: u < 0.4 ? "Hmm…" : text } }));
      },
      far: () => {
        const dir = Math.random() < 0.5 ? 1 : -1;
        const a = clampV({ x: dir * M.W * 0.42, y: -1.5, z: -1 }), b = clampV({ x: -dir * M.W * 0.1, y: -1.25, z: -1 });
        fly(a, { dz: -0.4, dur: 1.6 });
        push(4.2, (u, t) => ({ x: lerp(a.x, b.x, inOut3(u)), y: lerp(a.y, b.y, u) + Math.sin(u * Math.PI * 2) * 0.18 + Math.sin(t * 2.2) * 0.02, z: -1, gaze: [-dir * 0.8, 0.3] }));
      },
      loop: () => {
        const at = side(Math.random() < 0.5 ? 1 : -1, 0.5), rr = 0.38;
        fly(at);
        push(1.3, (u) => { const k = inOut3(u), a = k * Math.PI * 2; return { x: at.x + Math.sin(a) * rr, y: at.y - rr + Math.cos(a) * rr, z: at.z + Math.sin(a) * 0.3, rot: k * 360 }; });
        hold(0.9, at, () => ({ mood: "happy" }));
      },
      doze: () => {
        const at = clampV({ x: (Math.random() < 0.5 ? 1 : -1) * M.W * 0.3, y: -1.05, z: -0.15 });
        fly(at);
        hold(4.2, at, (u, t) => ({ sleep: u < 0.86, y: at.y + Math.sin(t * 1.1) * 0.05, rot: u < 0.86 ? Math.sin(t * 1.1) * 6 : 0,
          bubble: u > 0.15 && u < 0.86 ? { kind: "think", text: "z z z" } : null }));
        push(0.5, (u) => ({ ...at, y: at.y - Math.sin(Math.PI * u) * 0.35, sq: 1 - 0.1 * Math.sin(Math.PI * u) }));   // wakes up, hops
      },
      stare: () => {   // comes closer and looks at you
        const at = clampV({ x: (Math.random() < 0.5 ? 1 : -1) * M.W * 0.18, y: 0.1, z: 1 });
        fly(at, { dz: 0.4 });
        hold(2.2, at, (u, t) => ({ gaze: null, rot: Math.sin(t * 1.6) * 7 * Math.min(1, u * 5) }));
      },
    });
    const W8: Record<string, number> = { lap: 3, sit: 3, peek: 2.5, think: 2.5, far: 1.5, loop: 1.5, doze: 1, stare: 1.5, greet: 0.6 };
    const next = () => {
      if (cmd.current === "greet") { cmd.current = ""; ACTS.greetHere(); last = ["greet", ...last].slice(0, 2); return; }
      const pool = Object.keys(W8).filter((k) => !last.includes(k) && (k !== "greet" || tEnd - lastGreet > 45));
      let x = Math.random() * pool.reduce((s, k) => s + W8[k], 0), k = pool[0];
      for (const p of pool) { x -= W8[p]; if (x <= 0) { k = p; break; } }
      ACTS[k](); last = [k, ...last].slice(0, 2);
    };
    // Opening: when the letters settle it peeks out from behind the "o", glides forward and greets
    {
      const L = letter(6), z = -0.28, s = 1 + ZS * z, down = { x: L.x, y: L.top + M.r * s * 0.7, z }, up = { x: L.x, y: L.top + M.r * s * 0.12, z };
      // Stays invisible until the letters settle, then appears as they rise
      cur = down; hold(1.25, down, () => ({ op: 0 })); push(0.8, (u) => ({ ...down, y: lerp(down.y, up.y, inOut3(u)), op: Math.min(1, Math.max(0, (u - 0.5) / 0.35)) }));
      hold(1.1, up, (u) => ({ gaze: gazeAt(u, [[0, -1, 0], [0.5, 1, 0]]) }));
      ACTS.greet(); last = ["greet"];
    }
    const replan = (t: number) => { for (let i = segs.length - 1; i >= 0; i--) { const s = segs[i]; if (s.t0 >= t) segs.splice(i, 1); else if (s.until > t) s.until = t; }
      const s = sample(t); cur = { x: s.x, y: s.y, z: s.z }; tEnd = t; };
    const sample = (t: number): St => {
      let s = segs[0];
      for (const q of segs) { if (q.t0 <= t) s = q; else break; }
      return s.f(Math.min(1, Math.max(0, (Math.min(t, s.until) - s.t0) / s.dur)), t);
    };
    const proj = (p: V) => { const sc = 1 + ZS * p.z; return { x: M.cx + p.x * M.H, y: M.cy + p.y * M.H, sc }; };

    let pointer: [number, number] | null = null;
    const pm = (e: PointerEvent) => { const g = gate.getBoundingClientRect(); pointer = [e.clientX - g.left, e.clientY - g.top]; };
    addEventListener("pointermove", pm);
    const sparks: { x: number; y: number; z: number; t: number; vx: number; vy: number }[] = [];
    let raf = 0, t0 = 0, prevLook = "";
    const step = (now: number) => {
      if (!fig.current || !bub.current) return;   // on close refs drop before the effect
      if (!t0) t0 = now;
      const t = still ? 2.2 : (now - t0) / 1000;
      if (cmd.current === "greet" || cmd.current === "leave") {
        replan(t);
        if (cmd.current === "leave") { cmd.current = ""; const a = cur; push(0.7, (u) => ({ ...a, z: lerp(a.z, 2.4, inOut3(u)), y: lerp(a.y, 0, u), op: 1 - u })); push(99, () => ({ ...cur, op: 0 })); }
        else next();
      }
      while (tEnd < t + 1.5) next();
      while (segs.length > 2 && segs[1].until < t - TRAIL - 0.1) segs.shift();
      const s = sample(t);
      const p = proj(s);
      // Speed: screen px/s
      const q = proj(sample(t - 1 / 60));
      const v = Math.hypot(p.x - q.x, p.y - q.y) * 60;
      const vk = Math.min(1, v / 1400);
      const lean = s.wave ? Math.sin(t * 9) * 13 * s.wave : Math.max(-20, Math.min(20, ((p.x - q.x) * 60) / 60));
      const stretch = 1 + 0.14 * vk;
      const sq = s.sq ?? 1;
      const f = fig.current!;
      const rs = M.r * M.H;
      const depthBlur = Math.max(0, -s.z - 0.45) * 5;
      f.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${p.sc / ZMAX}) rotate(${lean + (s.rot ?? 0)}deg) scale(${stretch * sq}, ${1 / (stretch * sq)})`;
      f.style.zIndex = s.z < -0.05 ? "1" : "3";
      f.style.opacity = String((s.op ?? 1) * (1 - Math.max(0, -s.z - 0.5) * 0.5));
      f.style.filter = depthBlur > 0.05 ? `blur(${depthBlur.toFixed(2)}px) saturate(${(1 - depthBlur * 0.06).toFixed(2)})` : "";
      // Gaze: at the scene if it wants, otherwise at the pointer (otherwise at you)
      let g = s.gaze ?? null;
      if (!g) { if (pointer) { const dx = pointer[0] - p.x, dy = pointer[1] - p.y, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260); g = [(dx / d) * k, (dy / d) * k]; } else g = [0, 0.15]; }
      // The bubble stays above Rou's head but does not shrink with it
      const bw = (bub.current!.firstElementChild as HTMLElement).offsetWidth / 2 + 10;   // so it does not overflow the screen
      bub.current!.style.transform = `translate(${Math.min(M.vw - bw, Math.max(bw, p.x))}px, ${p.y - rs * p.sc * 0.5}px)`;
      f.style.setProperty("--gx", g[0].toFixed(2)); f.style.setProperty("--gy", g[1].toFixed(2));
      const lk = JSON.stringify([s.mood ?? "idle", s.bubble ?? null, !!s.sleep]);
      if (lk !== prevLook) { prevLook = lk; setLook({ mood: s.mood ?? "idle", bubble: s.bubble ?? null, sleep: !!s.sleep }); }

      // Comet trail: in fast moments the past path is sampled densely; the part behind stays behind the text
      for (const c of ctx) c.clearRect(0, 0, M.vw, M.vh);
      let pp = p, pt = t;
      for (let i = 1; i <= 96; i++) {
        const tt = t - (TRAIL * i) / 96;
        if (tt < 0) break;
        const sp = sample(tt), a = proj(sp);
        const sv = Math.min(1, Math.max(0, (Math.hypot(a.x - pp.x, a.y - pp.y) / (pt - tt) - 500) / 1100));
        pp = a; pt = tt;
        const fade = 1 - i / 96;
        const w = rs * 0.3 * fade ** 1.2 * sv * a.sc;
        if (w < 0.6) continue;
        const al = fade * sv * (sp.op ?? 1) * (0.5 + 0.5 * Math.min(1, a.sc));
        const [r, gg, b] = palAt(i / 14 + t * 0.6);
        const c = ctx[sp.z < -0.05 ? 0 : 1];
        const gr = c.createRadialGradient(a.x, a.y, 0, a.x, a.y, w);
        gr.addColorStop(0, `rgba(255,255,255,${0.55 * al})`);
        gr.addColorStop(0.3, `rgba(${r},${gg},${b},${0.4 * al})`);
        gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        c.fillStyle = gr; c.beginPath(); c.arc(a.x, a.y, w, 0, Math.PI * 2); c.fill();
      }
      if (vk > 0.45 && Math.random() < vk) sparks.push({ x: p.x + rnd(-0.25, 0.25) * rs * p.sc, y: p.y + rnd(-0.2, 0.2) * rs * p.sc, z: s.z, t, vx: rnd(-10, 10), vy: rnd(10, 28) });
      for (let i = sparks.length - 1; i >= 0; i--) {
        const k2 = sparks[i], age = t - k2.t;
        if (age > 0.9) { sparks.splice(i, 1); continue; }
        const al = 1 - age / 0.9, rr = rs * 0.03 * (1 - age * 0.6);
        const c = ctx[k2.z < -0.05 ? 0 : 1];
        c.fillStyle = `rgba(255,255,255,${al})`; c.shadowColor = "rgba(180,140,255,.9)"; c.shadowBlur = rr * 4;
        c.beginPath(); c.arc(k2.x + k2.vx * age, k2.y + k2.vy * age, rr, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0;
      }
      if (!still) raf = requestAnimationFrame(step);
    };
    if (still) { segs.length = 0; tEnd = 0; cur = sitAt(6); hold(99, sitAt(6), () => ({ gaze: [0, 0.4] })); }
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); removeEventListener("pointermove", pm); };
  }, [mark, name]);

  if (look.bubble) said.current = look.bubble.text;
  return (
    <div ref={box} className="gate-rou" aria-hidden>
      <canvas ref={back} className="gate-trail" />
      <canvas ref={front} className="gate-trail is-front" />
      <div ref={fig} className={`gate-rou-fig${look.sleep ? " is-sleep" : ""}`} onClick={() => { cmd.current = "greet"; }}>
        {R > 0 && <RouMascot size={R} mood={look.mood} />}
      </div>
      <span ref={bub} className="gate-bubble-at">
        <span className={`gate-bubble${look.bubble ? " on" : ""}${look.bubble?.kind === "think" ? " is-think" : ""}`}>{look.bubble?.text ?? said.current}</span>
      </span>
    </div>
  );
}
