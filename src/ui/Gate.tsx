import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { GateRou } from "./GateRou";
import { readMe } from "../views/Profile";

// Welcome: the Playgrounds wordmark on a softly coloured, slowly drifting background with Rou (GateRou) living around it. There is no account:
// "Let's build" makes Rou glide toward the screen and the app opens. Shown once per session. On mobile the button sits in the bottom band.
const KEY = "pg-in";
// ?gate=en: for promo recordings: the screen shows on every load, no name.
const demo = () => { try { return new URLSearchParams(location.search).get("gate") === "en"; } catch { return false; } };
export const seenGate = () => { if (demo()) return false; try { return sessionStorage.getItem(KEY) === "1"; } catch { return true; } };

export function Gate({ onEnter }: { onEnter: () => void }) {
  const en = demo();
  const me = en ? { ...readMe(), name: "" } : readMe();
  const [leaving, setLeaving] = useState(false);
  const enter = () => {
    try { sessionStorage.setItem(KEY, "1"); } catch { /* no storage */ }
    dispatchEvent(new Event("pg-gate-leave"));   // Rou glides toward the screen (the departing tree gets no new prop)
    setLeaving(true);
  };
  // Enter opens the app too, without a focus ring on the button
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Enter" && !leaving) enter(); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });
  const ease = [0.22, 1, 0.36, 1] as const;
  const first = me.name.trim().split(/\s+/)[0];
  const mark = useRef<HTMLHeadingElement>(null);
  // With each letter in its own box the kerning between pairs is lost: each pair's kerning is measured and added to the letter spacing
  useLayoutEffect(() => {
    const h = mark.current;
    if (!h) return;
    const fit = () => {
      const cs = getComputedStyle(h), c = document.createElement("canvas").getContext("2d")!;
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const els = [...h.querySelectorAll<HTMLElement>(".gch")];
      els.forEach((e, i) => {
        const a = e.textContent ?? "", b = els[i + 1]?.textContent;
        const k = b ? c.measureText(a + b).width - c.measureText(a).width - c.measureText(b).width : 0;
        e.style.marginRight = `calc(-0.065em + ${k.toFixed(2)}px)`;
      });
    };
    fit();
    document.fonts?.ready.then(fit);
  }, []);
  return (
    <AnimatePresence onExitComplete={onEnter}>
      {!leaving && (
        <motion.div className="gate" key="gate" exit={{ opacity: 0 }} transition={{ duration: 0.45, delay: 0.25 }}>
          <div className="gate-bg" aria-hidden><i /><i /><i /><i /></div>
          <GateRou name={first} mark={mark} />
          <div className="gate-hero">
            {/* Letters rise one by one (CSS, gateCh); once Rou has settled on the letters it comes out from behind the "o" */}
            <motion.h1 ref={mark} className="gate-mark" aria-label="Playgrounds" exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.45, ease }}>
              {[..."Playgrounds"].map((c, i) => <span key={i} className="gch" aria-hidden style={{ ["--i" as string]: i }}>{c}</span>)}
            </motion.h1>
            <motion.p className="gate-sub" initial={{ opacity: 0, y: 8, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0 }} transition={{ duration: 0.7, delay: 1.25, ease }}>
              {!en && first ? `Welcome back, ${first}.` : "All your worlds, one calendar."}
            </motion.p>
          </div>
          <motion.button type="button" className="gate-go" onClick={enter} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.7, delay: 1.4, ease }}>
            Let's build
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
