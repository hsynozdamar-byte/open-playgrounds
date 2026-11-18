import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

// App-wide short notice: like "Task done · Undo".
type T = { id: number; text: string; undo?: () => void; label?: string };
export function toast(text: string, undo?: () => void, label = "Undo") {
  dispatchEvent(new CustomEvent<T>("pg-toast", { detail: { id: Date.now(), text, undo, label } }));
}

export function Toaster() {
  const [t, setT] = useState<T | null>(null);
  useEffect(() => {
    const h = (e: Event) => setT((e as CustomEvent<T>).detail);
    addEventListener("pg-toast", h);
    return () => removeEventListener("pg-toast", h);
  }, []);
  useEffect(() => {
    if (!t) return;
    const x = setTimeout(() => setT(null), 6000);
    return () => clearTimeout(x);
  }, [t]);
  return (
    <AnimatePresence>
      {t && (
        <motion.div key={t.id} className={`toast ${t.undo ? "" : "is-plain"}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}>
          <span>{t.text}</span>
          {t.undo && (
            <button className="btn sm" onClick={() => (t.undo!(), setT(null))}>
              {t.label}
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
