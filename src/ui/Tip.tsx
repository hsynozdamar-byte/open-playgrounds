import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// İpucu: sistemin sarı title kutusu yerine uygulamanın kendi baloncuğu. Kodda title yazmaya devam edilir;
// fare bir title'ın üstüne gelince title data-tip'e taşınır (sistem kutusu çıkmaz) ve kısa bir beklemeyle baloncuk açılır.
export function Tip() {
  const [tip, setTip] = useState<{ text: string; el: Element } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    let timer = 0;
    let cur: Element | null = null;
    const hide = () => { clearTimeout(timer); cur = null; setTip(null); };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element).closest?.("[title], [data-tip]");
      if (el === cur) return;
      hide();
      if (!el) return;
      const t = el.getAttribute("title");
      if (t !== null) {
        el.removeAttribute("title");
        if (t) el.setAttribute("data-tip", t);
        if (t && !el.getAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", t);
      }
      const text = el.getAttribute("data-tip");
      if (!text) return;
      cur = el;
      timer = window.setTimeout(() => cur === el && el.isConnected && setTip({ text, el }), 450);
    };
    addEventListener("pointerover", over);
    addEventListener("pointerdown", hide, true);
    addEventListener("keydown", hide, true);
    addEventListener("scroll", hide, true);
    addEventListener("blur", hide);
    return () => {
      clearTimeout(timer);
      removeEventListener("pointerover", over);
      removeEventListener("pointerdown", hide, true);
      removeEventListener("keydown", hide, true);
      removeEventListener("scroll", hide, true);
      removeEventListener("blur", hide);
    };
  }, []);
  // Öğenin altına ortalı; altta yer yoksa üstüne. Ekran kenarından 8px içeride kalır.
  useLayoutEffect(() => {
    if (!tip || !box.current) return setPos(null);
    const a = tip.el.getBoundingClientRect();
    const w = box.current.offsetWidth, h = box.current.offsetHeight;
    const left = Math.max(8, Math.min(a.left + a.width / 2 - w / 2, innerWidth - w - 8));
    const top = a.bottom + 8 + h <= innerHeight - 8 ? a.bottom + 8 : a.top - 8 - h;
    setPos({ left, top });
  }, [tip]);
  if (!tip) return null;
  return createPortal(
    <div ref={box} className="tipbub" role="tooltip" style={pos ?? { visibility: "hidden", left: 0, top: 0 }}>{tip.text}</div>,
    document.body,
  );
}
