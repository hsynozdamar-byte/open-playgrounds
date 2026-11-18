import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RefreshCw } from "lucide-react";

// Güncelleme uyarısı (Mac uygulaması / npm start): kod değişince sağ altta "Güncelleme var · Güncelle" çıkar.
// Güncelle: sunucu derler (gerekirse kendini yeniden başlatır), sayfa yeni sürümle açılır. Dakikada bir ve pencere öne gelince sorulur.
type V = { dev?: boolean; built?: number; client?: boolean; server?: boolean; pending?: boolean; jobs?: string[] };

// Yeni sürüm hazır ama sayfa kendiliğinden yenilenmedi (yazılmamış metin vardı): çubuk hemen görünür.
export const UPDATE_READY = "pg:update-ready";
// Ekranda yazılmış metin var mı: odak bir yazı alanında ya da görünür bir alanda boş olmayan metin. Yenileme bunları silerdi.
export function hasDraft() {
  const a = document.activeElement as HTMLElement | null;
  if (a?.isContentEditable || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return true;
  return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type]), input[type=text], input[type=search], input[type=url], input[type=email]")]
    .some((el) => !el.readOnly && !el.disabled && el.value.trim() !== "" && el.offsetParent !== null);
}

// Sunucu süren işler bitince yeniden başlar (en çok 90 dk): yeni sunucu ayağa kalkana (server bayrağı düşene) kadar beklenir, sonra sayfa yenilenir.
// Beklerken hangi işlerin sürdüğü çubukta adıyla yazar; önceden yalnız "İşler bitince" diyordu ve neyin beklendiği görünmüyordu.
async function reloadWhenUp(onJobs: (jobs: string[]) => void) {
  for (const end = Date.now() + 95 * 60000; Date.now() < end; ) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const v: V = await (await fetch("/api/version", { cache: "no-store" })).json();
      if (!v.server) return location.reload();
      onJobs(v.jobs ?? []);
    } catch { /* yeniden başlıyor */ }
  }
  location.reload();
}

export function UpdateBar() {
  const [state, setState] = useState<"idle" | "ready" | "busy" | "error">("idle");
  const [jobs, setJobs] = useState<string[]>([]);
  const first = useRef<number | null>(null);
  const waiting = useRef(false);
  const wait = () => { if (waiting.current) return Promise.resolve(); waiting.current = true; setState("busy"); return reloadWhenUp(setJobs); };
  useEffect(() => {
    const check = async () => {
      try {
        const v: V = await (await fetch("/api/version", { cache: "no-store" })).json();
        if (v.dev) return;
        // Güncelleme başka bir pencereden (ya da sayfa yenilenmeden önce) başlatılmış ve işleri bekliyor: düğme değil, bekleyiş görünür.
        if (v.pending) { setJobs(v.jobs ?? []); return void wait(); }
        first.current ??= v.built ?? 0;
        if (v.client || v.server || (v.built ?? 0) > first.current) setState((s) => (s === "idle" ? "ready" : s));
      } catch { /* sunucu yok */ }
    };
    void check();
    const t = setInterval(check, 60000);
    const ready = () => setState((s) => (s === "idle" ? "ready" : s));
    addEventListener("focus", check);
    addEventListener(UPDATE_READY, ready);
    return () => (clearInterval(t), removeEventListener("focus", check), removeEventListener(UPDATE_READY, ready));
  }, []);
  const go = async () => {
    setState("busy");
    try {
      const r = await (await fetch("/api/update", { method: "POST" })).json();
      if (!r.ok) return setState("error");
      if (r.restart) await wait(); else location.reload();
    } catch { await wait(); }
  };
  return (
    <AnimatePresence>
      {state !== "idle" && (
        <motion.div className="updbar" role="status" initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}>
          <RefreshCw size={16} className={state === "busy" ? "spin" : ""} />
          <span>{state === "busy" ? (jobs.length ? `Updates when this is done: ${jobs[0]}${jobs.length > 1 ? ` +${jobs.length - 1}` : ""}` : "Updating…") : state === "error" ? "Build failed, check the terminal" : "Update available"}</span>
          {state === "ready" && <button className="btn sm primary" onClick={go}>Update</button>}
          {state === "error" && <button className="btn sm" onClick={() => setState("ready")}>Close</button>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
