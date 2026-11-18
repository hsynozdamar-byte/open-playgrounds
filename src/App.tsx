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
import { Posts } from "./views/Studio";
import { Browser } from "./views/Browser";
import { inShell } from "./ui/LiveBrowser";
import { AutoFormHost } from "./ui/AutoForm";
import { AutoViewHost } from "./ui/AutoView";
import { AccountFormHost } from "./ui/Social";
import { ProjectFormHost } from "./ui/ProjectForm";
import { RouChat } from "./ui/Rou";
import { SearchHost } from "./ui/Search";
import { BackupsHost } from "./ui/Backups";
import { TrashHost } from "./ui/Trash";
import { UpdateBar } from "./ui/Update";
import { useReminders } from "./ui/useReminders";
import { Gate, seenGate } from "./ui/Gate";
import { LOGOUT } from "./views/Settings";
import { Profile } from "./views/Profile";
import { useNow } from "./ui/useNow";
import { needsMaterialize, materialize } from "../shared/repeat.mjs";
import { Tip } from "./ui/Tip";

const VIEWS: Route["view"][] = ["focus", "calendar", "inbox", "projects", "posts", "browser", "profile"];

// Adres: #görünüm/dünya[/proje]  (ör. #projects/dunya/abc123)
function fromHash(): Route {
  const [v0, l, p] = location.hash.slice(1).split("/");
  const v = v0 === "autos" ? "posts" : v0; // Otomasyonlar sayfası kalktı (2026-10-31); eski adresler Gönderiler'e düşer
  return { view: VIEWS.includes(v as Route["view"]) ? (v as Route["view"]) : "focus", lens: l || ALL, project: p || undefined };
}
const toHash = (r: Route) => `#${r.view}/${r.lens}${r.project ? `/${r.project}` : ""}`;

export default function App() {
  const { state, mutate, system, undo, redo } = useStore();
  // Tekrarlayan işlerin bugünkü kopyası: uygulama açıkken gün dönünce de açılır.
  const minute = useNow(true, 60000);
  useEffect(() => {
    if (!state) return;
    if (needsMaterialize(state)) system((s) => void materialize(s));
  }, [state, minute, system]);
  const [route, setRoute] = useState<Route>(fromHash);
  // Tarayıcı geri/ileride eski kaydırmayı kendisi geri getirmesin; sayfa geçişi kaydırmayı yönetir
  useEffect(() => { history.scrollRestoration = "manual"; }, []);
  const [open, setOpen] = useState<string | null>(null);

  // Adres yalnız yazımı farklıysa (ilk açılış, eski bir bağlantı, geri/ileri) yerinde düzeltilir: yeni bir geçmiş kaydı
  // açılsaydı Geri tuşu her seferinde aynı sayfaya geri atardı.
  const fixHash = useRef(true);
  useEffect(() => {
    if (location.hash !== toHash(route)) history[fixHash.current ? "replaceState" : "pushState"](null, "", toHash(route));
    fixHash.current = false;
  }, [route]);
  // Rou bir gönderiyi paylaşınca uygulamada da haber ver (ilk yüklemede eskiler sayılmaz).
  const posted = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!state) return;
    const now = new Set(state.runs.filter((r) => r.status === "posted").map((r) => r.id));
    if (posted.current) for (const r of state.runs) {
      if (r.status !== "posted" || posted.current.has(r.id) || !r.postedAt || Date.now() - new Date(r.postedAt).getTime() > 30 * 60 * 1000) continue;
      const url = r.postUrl;
      toast(`Shared: ${r.title}`, url ? () => void window.open(url, "_blank") : undefined, "Open post");
    }
    posted.current = now;
  }, [state?.runs]);
  // Açılır pencere (iş kartı, onay) ya da Rou sohbeti üstündeyken tekerlek arkadaki sayfayı kaydırmaz.
  // Kaydırma çubuğu gizlenmez (gizlemek sayfayı genişletiyordu); yalnız arkaya geçecek kaydırma engellenir.
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
      const box = t.closest(".drawer, .leavebox, .rouchat, .modal, .spop");
      if (box) { if (!scrollsMore(t, box, e.deltaY)) e.preventDefault(); return; }
      if (t.closest(".scrim, .leavescrim")) e.preventDefault();
    };
    addEventListener("wheel", k, { passive: false });
    return () => removeEventListener("wheel", k);
  }, []);
  // Mac uygulamasında (WKWebView) yazı alanı dışında Backspace bir önceki sayfaya döner; bunu engelle.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Backspace" && !(e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) e.preventDefault();
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  // ⌘Z geri al, ⇧⌘Z (ya da ⌘Y) yinele. Yazı alanındayken tarayıcının kendi geri alması çalışır.
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

  // Karşılama ekranı oturumda bir kez; veri arkada yüklenir, giriş yapılınca uygulama altından çıkar.
  const [inside, setInside] = useState(seenGate);
  // Profil > Çıkış yap: karşılama ekranı yeniden açılır
  useEffect(() => { const h = () => setInside(false); addEventListener(LOGOUT, h); return () => removeEventListener(LOGOUT, h); }, []);
  return (
    <>
      {state ? <Shell state={state} mutate={mutate} route={route} setRoute={setRoute} open={open} setOpen={setOpen} /> : <div className="boot" />}
      {!inside && <Gate onEnter={() => setInside(true)} />}
    </>
  );
}

type ShellProps = { state: Ctx["state"]; mutate: Ctx["mutate"]; route: Route; setRoute: (r: Route) => void; open: string | null; setOpen: (x: string | null) => void };

function Shell({ state, mutate, route, setRoute, open, setOpen }: ShellProps) {
  const lens = route.lens === ALL || state.worlds.some((w) => w.id === route.lens) ? route.lens : ALL;
  const r = { ...route, lens };
  // Dünya değişince açık proje kapanır (aksi belirtilmedikçe).
  const go = (p: Partial<Route>) => setRoute({ ...r, ...("lens" in p && !("project" in p) ? { project: undefined } : {}), ...p });
  const ctx: Ctx = { state, mutate, route: r, go, open: setOpen };
  useTimerEngine(ctx);
  useReminders(ctx);
  const world = lens === ALL ? null : worldOf(state, lens);
  // Dünya geçişinde zeminin akışı kısa süre durur: hareketli dev katmanlar geçiş karesini WebKit'te takıltıyordu
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
        {/* Yeni sayfa en üstten başlar: eski sayfa söndükten sonra, yenisi gelmeden kaydırma sıfırlanır */}
        <AnimatePresence mode="wait" onExitComplete={() => window.scrollTo(0, 0)}>
          <motion.main key={`${r.view}-${lens}-${r.project ?? ""}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            {state.worlds.length === 0 ? <Welcome ctx={ctx} /> : <>
            {r.view === "calendar" && <Calendar ctx={ctx} />}
            {r.view === "focus" && <Today ctx={ctx} />}
            {r.view === "inbox" && <Inbox ctx={ctx} />}
            {r.view === "projects" && <Projects ctx={ctx} />}
            {r.view === "posts" && <Posts ctx={ctx} />}
            {r.view === "browser" && <Browser ctx={ctx} />}
            {r.view === "profile" && <Profile ctx={ctx} />}
            </>}
          </motion.main>
        </AnimatePresence>
      </div>
      {/* Uygulamadaki tarayıcıda sayaç çubuğu sekmenin üstüne binerdi; orada gizli (sayaç sürer). */}
      <TimerBar ctx={ctx} hidden={r.view === "focus" || (r.view === "browser" && inShell)} />
      <PageThumb />
      <Toaster />
      <Tip />
      <AutoViewHost ctx={ctx} />
      <AutoFormHost ctx={ctx} />
      <AccountFormHost ctx={ctx} />
      <ProjectFormHost ctx={ctx} />
      <RouChat ctx={ctx} />
      <SearchHost ctx={ctx} />
      <BackupsHost />
      <TrashHost ctx={ctx} />
      <UpdateBar />
      <AnimatePresence>{task && <Drawer key={task.id} task={task} ctx={ctx} onClose={() => setOpen(null)} />}</AnimatePresence>
    </div>
  );
}

// Hiç dünya yokken: nasıl çalıştığı üç adımda, sonra örnek dünyayla ya da boş başlama.
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
