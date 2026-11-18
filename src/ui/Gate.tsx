import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { GateRou } from "./GateRou";
import { readMe, saveMe } from "../views/Profile";

// Karşılama: hafif renkli, yavaş akan bir zeminde Playgrounds yazısı ve etrafında yaşayan Rou (GateRou). Giriş göstermelik:
// hesap yok, her şey bu bilgisayarda; "Giriş yap" ile Rou ekrana doğru süzülür, uygulamaya geçilir. Oturum boyunca bir kez görünür.
// Masaüstünde alanlar ve düğme tek bir kapsülde; mobilde yazı üstte ortalanır, form alt bantta durur.
const KEY = "pg-in";
// ?gate=en: tanıtım kaydı için (tanıtım videoları): ekran her açılışta görünür, yazılar İngilizce, e-posta boş.
const demo = () => { try { return new URLSearchParams(location.search).get("gate") === "en"; } catch { return false; } };
export const seenGate = () => { if (demo()) return false; try { return sessionStorage.getItem(KEY) === "1"; } catch { return true; } };

export function Gate({ onEnter }: { onEnter: () => void }) {
  const en = demo();
  const me = en ? { ...readMe(), email: "", name: "" } : readMe();
  const [leaving, setLeaving] = useState(false);
  const [mail, setMail] = useState(me.email);
  const [pass, setPass] = useState("");
  const enter = (e: React.FormEvent) => {
    e.preventDefault();
    try { sessionStorage.setItem(KEY, "1"); } catch { /* yok */ }
    if (mail.trim()) saveMe({ email: mail.trim() });
    dispatchEvent(new Event("pg-gate-leave"));   // Rou ekrana doğru süzülür (çıkan ağaç yeni prop almaz)
    setLeaving(true);
  };
  const ease = [0.22, 1, 0.36, 1] as const;
  const first = me.name.trim().split(/\s+/)[0];
  const mark = useRef<HTMLHeadingElement>(null);
  // Harfler ayrı kutuda olunca çiftler arası kerning kaybolur: her çiftin kerning'i ölçülüp harf boşluğuna eklenir
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
            {/* Harfler sırayla yükselir (CSS, gateCh); Rou harfler yerine oturunca "o"nun arkasından çıkar */}
            <motion.h1 ref={mark} className="gate-mark" aria-label="Playgrounds" exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.45, ease }}>
              {[..."Playgrounds"].map((c, i) => <span key={i} className="gch" aria-hidden style={{ ["--i" as string]: i }}>{c}</span>)}
            </motion.h1>
            <motion.p className="gate-sub" initial={{ opacity: 0, y: 8, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0 }} transition={{ duration: 0.7, delay: 1.25, ease }}>
              {!en && first ? `Welcome back, ${first}.` : "All your worlds, one calendar."}
            </motion.p>
          </div>
          <motion.form className="gate-form" onSubmit={enter} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.7, delay: 1.4, ease }}>
            <div className="gate-fields">
              <input type="email" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="Email" autoComplete="email" aria-label="Email" autoFocus={!me.email} />
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Password" autoComplete="current-password" aria-label="Password" autoFocus={!!me.email} />
            </div>
            <button type="submit">Sign in</button>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
