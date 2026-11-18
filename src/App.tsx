import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { type Ctx, type Route, ALL, worldOf } from "./lib";
import { Rail, openNewWorld } from "./ui/Rail";
import { Logo } from "./ui/Orb";
import { addSample, makeSample } from "./sample";
import { Drawer } from "./ui/Drawer";
import { TimerBar, useTimerEngine } from "./ui/Timer";
import { Toaster, toast } from "./ui/Toast";
import { PageThumb } from "./ui/PageThumb";
import { Today } from "./views/Today";
import { Calendar } from "./views/Calendar";
import { Inbox } from "./views/Inbox";
import { Projects } from "./views/Projects";
import { ProjectFormHost } from "./ui/ProjectForm";
import { SearchHost } from "./ui/Search";
import { BackupsHost } from "./ui/Backups";
import { TrashHost } from "./ui/Trash";
import { useReminders } from "./ui/useReminders";
import { Profile } from "./views/Profile";
import { Tip } from "./ui/Tip";

const VIEWS: Route["view"][] = ["focus", "calendar", "inbox", "projects", "profile"];

// Address: #view/world[/project]  (e.g. #projects/work/abc123)
function fromHash(): Route {
  const [v, l, p] = location.hash.slice(1).split("/");
  return { view: VIEWS.includes(v as Route["view"]) ? (v as Route["view"]) : "focus", lens: l || ALL, project: p || undefined };
}
const toHash = (r: Route) => `#${r.view}/${r.lens}${r.project ? `/${r.project}` : ""}`;

export default function App() {
  const { state, mutate, undo, redo } = useStore();
  const [route, setRoute] = useState<Route>(fromHash);
  // The browser must not restore the old scroll on back/forward; the page transition manages scrolling
  useEffect(() => { history.scrollRestoration = "manual"; }, []);
  const [open, setOpen] = useState<string | null>(null);

  // The address is fixed in place only when its spelling differs (first load, an old link, back/forward): a new history
  // entry would make the Back button jump to the same page every time.
  const fixHash = useRef(true);
  useEffect(() => {
    if (location.hash !== toHash(route)) history[fixHash.current ? "replaceState" : "pushState"](null, "", toHash(route));
    fixHash.current = false;
  }, [route]);
  // While a popup (task card, confirm) is on top, the wheel does not scroll the page behind it.
  // The scrollbar is not hidden (hiding it widened the page); only scrolling that would pass through is blocked.
  useEffect(() => {
    const scrollsMore = (el: Element | null, root: Element, dy: number) => {
      for (let x = el; x && x !== root.parentElement; x = x.parentElement) {
        const st = getComputedStyle(x);
        if (!/(auto|scroll)/.test(st.overflowY) || x.scrollHeight <= x.clientHeight + 1) continue;
        if (dy > 0 ? x.scrollTop + x.clientHeight < x.scrollHeight - 1 : x.scrollTop > 0) return true;
      }
      return false;
    };
    const k = (e: WheelEvent) => {
      const t = e.target as Element;
      const box = t.closest(".drawer, .leavebox, .modal, .spop");
      if (box) { if (!scrollsMore(t, box, e.deltaY)) e.preventDefault(); return; }
      if (t.closest(".scrim, .leavescrim")) e.preventDefault();
    };
    addEventListener("wheel", k, { passive: false });
    return () => removeEventListener("wheel", k);
  }, []);
  // In the Mac app (WKWebView) Backspace outside a text field goes back a page; prevent that.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Backspace" && !(e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) e.preventDefault();
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  // ⌘Z undoes, ⇧⌘Z (or ⌘Y) redoes. Inside a text field the browser's own undo applies.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) return;
      const key = e.key.toLowerCase();
      const isRedo = (key === "z" && e.shiftKey) || key === "y";
      if (key !== "z" && key !== "y") return;
      e.preventDefault();
      if (isRedo ? redo() : undo()) toast(isRedo ? "Redone" : "Undone");
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [undo, redo]);
  useEffect(() => {
    const h = () => { fixHash.current = true; setRoute(fromHash()); };
    addEventListener("popstate", h);
    return () => removeEventListener("popstate", h);
  }, []);

  return state ? <Shell state={state} mutate={mutate} route={route} setRoute={setRoute} open={open} setOpen={setOpen} /> : <div className="boot" />;
}

type ShellProps = { state: Ctx["state"]; mutate: Ctx["mutate"]; route: Route; setRoute: (r: Route) => void; open: string | null; setOpen: (x: string | null) => void };

function Shell({ state, mutate, route, setRoute, open, setOpen }: ShellProps) {
  const lens = route.lens === ALL || state.worlds.some((w) => w.id === route.lens) ? route.lens : ALL;
  const r = { ...route, lens };
  // Changing the world closes the open project (unless said otherwise).
  const go = (p: Partial<Route>) => setRoute({ ...r, ...("lens" in p && !("project" in p) ? { project: undefined } : {}), ...p });
  const ctx: Ctx = { state, mutate, route: r, go, open: setOpen };
  useTimerEngine(ctx);
  useReminders(ctx);
  const world = lens === ALL ? null : worldOf(state, lens);
  // On a world switch the background flow pauses briefly: the large moving layers made the transition frame stutter in WebKit
  const [switching, setSwitching] = useState(false);
  const firstLens = useRef(true);
  useEffect(() => {
    if (firstLens.current) { firstLens.current = false; return; }
    setSwitching(true); const id = setTimeout(() => setSwitching(false), 900); return () => clearTimeout(id);
  }, [lens]);
  const task = state.tasks.find((t) => t.id === open) ?? null;

  return (
    <div className={`app${switching ? " is-switching" : ""}`} style={{ ["--w" as string]: world?.color ?? "var(--accent)" }}>
      <AnimatePresence>
        <motion.div key={lens} className={`wash ${world ? "is-world" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} style={{ ["--w" as string]: world?.color ?? "transparent" }} aria-hidden>
          <i className="f1" /><i className="f2" /><i className="f3" />
        </motion.div>
      </AnimatePresence>
      <div className="wash-grain" aria-hidden />
      <Rail {...ctx} />
      <div className="stage">
        {/* A new page starts at the top: scroll resets after the old page fades out, before the new one arrives */}
        <AnimatePresence mode="wait" onExitComplete={() => window.scrollTo(0, 0)}>
          <motion.main key={`${r.view}-${lens}-${r.project ?? ""}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            {state.worlds.length === 0 ? <Welcome ctx={ctx} /> : <>
            {r.view === "calendar" && <Calendar ctx={ctx} />}
            {r.view === "focus" && <Today ctx={ctx} />}
            {r.view === "inbox" && <Inbox ctx={ctx} />}
            {r.view === "projects" && <Projects ctx={ctx} />}
            {r.view === "profile" && <Profile ctx={ctx} />}
            </>}
          </motion.main>
        </AnimatePresence>
      </div>
      <TimerBar ctx={ctx} hidden={r.view === "focus"} />
      <PageThumb />
      <Toaster />
      <Tip />
      <ProjectFormHost ctx={ctx} />
      <SearchHost ctx={ctx} />
      <BackupsHost />
      <TrashHost ctx={ctx} />
      <AnimatePresence>{task && <Drawer key={task.id} task={task} ctx={ctx} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
}

// No worlds yet: how it works in three steps, then start empty or with an example.
function Welcome({ ctx }: { ctx: Ctx }) {
  const sample = () => {
    const x = makeSample();
    ctx.mutate((s) => addSample(s, x));
    ctx.go({ lens: x.worlds[0].id, view: "focus" });
  };
  return (
    <section className="card welcome">
      <Logo size={44} />
      <h1>Welcome to Playgrounds</h1>
      <p>All your tasks in one place: each part of your life gets its own world, and they all share one calendar.</p>
      <ol className="wsteps">
        <li><b>World</b><span>Open a world for each area: personal, work, side projects.</span></li>
        <li><b>Projects and tasks</b><span>Put projects inside a world and tasks inside a project.</span></li>
        <li><b>Calendar and focus</b><span>Drag a task onto an hour and start the timer when you begin.</span></li>
      </ol>
      <div className="wbtns">
        <button className="btn primary" onClick={openNewWorld}>Create your first world</button>
        <button className="btn" onClick={sample}>Start with an example</button>
      </div>
    </section>
  );
}
