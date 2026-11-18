import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RefreshCw } from "lucide-react";

// Update notice (desktop app / npm start): when the code changes, "Update available · Update" appears bottom right.
// Update: the server builds (restarts itself if needed) and the page reopens on the new version. Checked once a minute and when the window comes to the front.
type V = { dev?: boolean; built?: number; client?: boolean; server?: boolean; pending?: boolean; jobs?: string[] };

// A new version is ready but the page did not reload by itself (there was unsaved text): the bar shows right away.
export const UPDATE_READY = "pg:update-ready";
// Is there typed text on screen: focus is in a text field or a visible field holds non-empty text. A reload would erase it.
export function hasDraft() {
  const a = document.activeElement as HTMLElement | null;
  if (a?.isContentEditable || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return true;
  return [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type]), input[type=text], input[type=search], input[type=url], input[type=email]")]
    .some((el) => !el.readOnly && !el.disabled && el.value.trim() !== "" && el.offsetParent !== null);
}

// The server restarts when its running jobs finish (90 min at most): wait until the new server is up (the server flag drops), then reload the page.
// While waiting, the bar names the jobs still running.
async function reloadWhenUp(onJobs: (jobs: string[]) => void) {
  for (const end = Date.now() + 95 * 60000; Date.now() < end; ) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const v: V = await (await fetch("/api/version", { cache: "no-store" })).json();
      if (!v.server) return location.reload();
      onJobs(v.jobs ?? []);
    } catch { /* restarting */ }
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
        // The update was started from another window (or before the page reloaded) and is waiting for jobs: show the wait, not the button.
        if (v.pending) { setJobs(v.jobs ?? []); return void wait(); }
        first.current ??= v.built ?? 0;
        if (v.client || v.server || (v.built ?? 0) > first.current) setState((s) => (s === "idle" ? "ready" : s));
      } catch { /* no server */ }
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
