import { useEffect, useRef, useState } from "react";

// The page's scrollbar: takes no space (the page is always full width), appears on scroll or when the pointer reaches the
// right edge, fades after a second; can be grabbed and dragged. Hidden when the page does not scroll.
export function PageThumb() {
  const [g, setG] = useState({ top: 0, h: 0, show: false });
  const [on, setOn] = useState(false);
  const [drag, setDrag] = useState(false);
  const hide = useRef<number>(0);
  useEffect(() => {
    const calc = () => {
      const el = document.documentElement, vh = innerHeight, sh = el.scrollHeight;
      if (sh <= vh + 2) return setG((x) => (x.show ? { top: 0, h: 0, show: false } : x));
      const h = Math.max(36, (vh / sh) * (vh - 8));
      setG({ top: 4 + (scrollY / (sh - vh)) * (vh - 8 - h), h, show: true });
    };
    const wake = () => { calc(); setOn(true); clearTimeout(hide.current); hide.current = window.setTimeout(() => setOn(false), 1000); };
    const near = (e: PointerEvent) => { if (innerWidth - e.clientX < 14) wake(); };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(document.body);
    addEventListener("scroll", wake, { passive: true });
    addEventListener("resize", calc);
    addEventListener("pointermove", near, { passive: true });
    return () => { ro.disconnect(); removeEventListener("scroll", wake); removeEventListener("resize", calc); removeEventListener("pointermove", near); clearTimeout(hide.current); };
  }, []);
  if (!g.show) return null;
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const y0 = e.clientY, s0 = scrollY, el = document.documentElement;
    const ratio = (el.scrollHeight - innerHeight) / (innerHeight - 8 - g.h);
    setDrag(true);
    const move = (m: PointerEvent) => scrollTo({ top: s0 + (m.clientY - y0) * ratio });
    const up = () => { setDrag(false); removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  return <div className={`pthumb ${on || drag ? "is-on" : ""} ${drag ? "is-drag" : ""}`} style={{ top: g.top, height: g.h }} onPointerDown={start} aria-hidden />;
}
