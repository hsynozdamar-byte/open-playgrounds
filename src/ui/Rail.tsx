import { motion, LayoutGroup, Reorder, useDragControls } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, FolderKanban, Globe, History, Megaphone, NotebookPen, Plus, Search, Target, Trash2, type LucideIcon } from "lucide-react";
import { commit as commitTimer } from "../timer";
import { toast } from "./Toast";
import { binIt } from "../trashOps";
import { ALL, type Ctx, inboxNew } from "../lib";
import type { State, World } from "../types";
import { today } from "../date";
import { Logo, Orb } from "./Orb";
import { readMe } from "../views/Profile";
import { SWATCHES, worldId } from "../../shared/world.mjs";
import { RouButton, useRouUnseen } from "./Rou";
import { NoticeBell } from "./Notices";
import { postsWaiting } from "../views/Studio";
import { openSearch } from "./Search";
import { openBackups } from "./Backups";
import { openTrash } from "./Trash";
import { ColorPick } from "./Fields";


type View = Ctx["route"]["view"];

// Left panel: brand (= home), pages, worlds. The selected world filters every page.
// The world list scrolls only when it really overflows; if not, nothing is clipped while the selected frame slides.
// The world list scrolls sideways; the edge with a hidden world fades.
function useScrollEdges(active: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    el.addEventListener("scroll", check, { passive: true });
    check();
    return () => (ro.disconnect(), el.removeEventListener("scroll", check));
  }, []);
  // Keep the selected world in the visible area.
  useEffect(() => {
    ref.current?.querySelector(".railitem.on")?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [active]);
  return [ref, edges] as const;
}

export function Rail(ctx: Ctx) {
  const { state, route, go, mutate } = ctx;
  const unseen = useRouUnseen(state);
  const [worldsRef, edges] = useScrollEdges(route.lens);
  const t = today();
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const editing = state.worlds.find((w) => w.id === editId) ?? null;
  // World settings can be opened from anywhere: openWorldSettings(id).
  useEffect(() => {
    const h = (e: Event) => setEditId((e as CustomEvent<string>).detail);
    const n = () => setAdding(true);
    addEventListener("pg-world-settings", h);
    addEventListener("pg-world-new", n);
    return () => (removeEventListener("pg-world-settings", h), removeEventListener("pg-world-new", n));
  }, []);
  // Worlds are reordered by dragging. While dragging the order is kept locally, saved on drop.
  const [order, setOrder] = useState<World[] | null>(null);
  const shown = order ? order.map((w) => state.worlds.find((x) => x.id === w.id) ?? w).filter((w) => state.worlds.some((x) => x.id === w.id)) : state.worlds;
  const saveOrder = () => {
    if (!order) return;
    const ids = order.map((w) => w.id);
    setOrder(null);
    if (ids.join() === state.worlds.map((w) => w.id).join()) return;
    mutate((s) => void s.worlds.sort((a, b) => (ids.indexOf(a.id) + 1 || 1e9) - (ids.indexOf(b.id) + 1 || 1e9)));
  };
  // Profile is a page of its own: while it is open no world (nor Playgrounds) looks selected at the top; pressing one leaves the profile for Focus.
  const onProfile = route.view === "profile";
  const leave = onProfile ? { view: "focus" as View, project: undefined } : {};
  const count = (id: string) => state.tasks.filter((x) => (id === ALL || x.worldId === id) && x.status !== "done" && x.day && x.day <= t).length;
  const pages: { id: View; label: string; short?: string; n?: number; Icon: LucideIcon; desk?: boolean }[] = [
    { id: "focus", label: "Focus", Icon: Target, n: count(route.lens) },
    { id: "calendar", label: "Calendar", Icon: CalendarDays },
    { id: "inbox", label: "Notebook", Icon: NotebookPen, n: inboxNew(state, route.lens).length },
    { id: "projects", label: "Projects", Icon: FolderKanban },
    { id: "posts", label: "Posts", Icon: Megaphone, n: postsWaiting(state, route.lens) },
    { id: "browser", label: "Browser", Icon: Globe, desk: true },
  ];
  return (
    <div className="chrome">
      <header className="topbar">
      <LayoutGroup id="rail">
        <Item on={!onProfile && route.lens === ALL} onClick={() => go({ lens: ALL, ...leave })} label="Playgrounds" n={count(ALL)} home>
          <Logo size={28} />
        </Item>
        <div className="worlds">
          <Reorder.Group ref={worldsRef} as="div" axis="x" layoutScroll className={`wlist ${edges.start ? "fade-s" : ""} ${edges.end ? "fade-e" : ""}`} values={shown} onReorder={setOrder}>
            {shown.map((w) => (
              <WorldItem key={w.id} world={w} onDone={saveOrder}>
                <Item on={!onProfile && route.lens === w.id} onClick={() => go({ lens: w.id, ...leave })} label={w.name} hint={w.description} n={count(w.id)} color={w.color}>
                  <Orb world={w} size={22} />
                </Item>
              </WorldItem>
            ))}
          </Reorder.Group>
          <button className="addworld" onClick={() => setAdding(true)} aria-label="New world" title="New world">
            <Plus size={16} strokeWidth={2} />
          </button>
        </div>
      </LayoutGroup>
      {/* On mobile the bottom of the left panel (Profile, Trash, Backups) is hidden; Profile opens from here, the other two are on the Profile page. */}
      <button className={`mprofile ${route.view === "profile" ? "on" : ""}`} onClick={() => go({ view: "profile", project: undefined })} aria-label="Profile" title="Profile">
        <span className="proav" aria-hidden>{(readMe().name || readMe().email || "Y").slice(0, 1).toLocaleUpperCase("en")}</span>
      </button>
      <NoticeBell ctx={ctx} />
      <RouButton waiting={unseen} />
      </header>
      <nav className="rail">
      <button className="searchbtn" onClick={openSearch} aria-label="Search" title="Search (⌘K)">
        <Search className="pi" size={17} strokeWidth={1.9} />
        <span className="tl">Search</span>
        <kbd>⌘K</kbd>
      </button>
      <LayoutGroup id="pages">
        <div className="pages">
          {pages.map((p) => (
            <button key={p.id} className={`pageitem ${route.view === p.id ? "on" : ""} ${p.desk ? "is-desk" : ""}`} onClick={() => go({ view: p.id, project: undefined })}>
              {route.view === p.id && <motion.span layoutId="page-pill" className="pill-bg" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />}
              <p.Icon className="pi" size={17} strokeWidth={1.9} />
              <span className="tl">{p.short ? <><span className="lg">{p.label}</span><span className="sm">{p.short}</span></> : p.label}</span>
              {!!p.n && <span className="n">{p.n}</span>}
            </button>
          ))}
        </div>
      </LayoutGroup>
      <div className="railfoot">
        <button className={`pageitem proitem ${route.view === "profile" ? "on" : ""}`} onClick={() => go({ view: "profile", project: undefined })}>
          <span className="proav" aria-hidden>{(readMe().name || readMe().email || "Y").slice(0, 1).toLocaleUpperCase("en")}</span>
          <span className="tl">Profile</span>
        </button>
        <button className="pageitem" onClick={openTrash}>
          <Trash2 className="pi" size={17} strokeWidth={1.9} />
          <span className="tl">Trash</span>
          {!!state.trash?.length && <span className="n is-quiet">{state.trash.length}</span>}
        </button>
        <button className="pageitem" onClick={openBackups}>
          <History className="pi" size={17} strokeWidth={1.9} />
          <span className="tl">Backups</span>
        </button>
      </div>
      </nav>
      {adding && (
        <WorldForm
          used={state.worlds.map((w) => w.color)}
          onClose={() => setAdding(false)}
          onSave={({ name, color, color2, description }) => {
            const id = worldId(state, name);
            mutate((s) => void s.worlds.push({ id, name, color, ...(color2 ? { color2 } : {}), description }));
            go({ lens: id, view: "projects", project: undefined });
            setAdding(false);
          }}
        />
      )}
      {editing && (
        <WorldForm
          key={editing.id}
          world={editing}
          stats={deleteStats(state, editing.id)}
          onClose={() => setEditId(null)}
          onSave={({ name, color, color2, description }) => {
            mutate((s) => {
              const w = s.worlds.find((x) => x.id === editing.id);
              if (!w) return;
              Object.assign(w, { name, color, description });
              if (color2) w.color2 = color2; else delete w.color2;
            });
            setEditId(null);
          }}
          onDelete={() => {
            const { index: _i, world, ...rest } = takeWorld(state, editing.id);
            binIt({ mutate }, "world", editing.name, { worlds: [world], ...rest }, (s) => removeWorld(s, editing.id), `${editing.name} deleted`);
            if (route.lens === editing.id) go({ lens: ALL });
            setEditId(null);
          }}
        />
      )}
    </div>
  );
}

// Dragging starts at once with a mouse; on touch the bar can scroll, so a press and hold comes first.
function WorldItem({ world, onDone, children }: { world: World; onDone: () => void; children: React.ReactNode }) {
  const controls = useDragControls();
  const ref = useRef<HTMLDivElement>(null);
  const hold = useRef<{ t?: number; x: number; y: number }>({ x: 0, y: 0 });
  const moved = useRef(false);
  const [lifted, setLifted] = useState(false);
  const liftedRef = useRef(false);
  liftedRef.current = lifted;
  const cancel = () => clearTimeout(hold.current.t);
  // Do not let the page scroll after a press and hold.
  useEffect(() => {
    const el = ref.current;
    const stop = (e: TouchEvent) => liftedRef.current && e.preventDefault();
    el?.addEventListener("touchmove", stop, { passive: false });
    return () => el?.removeEventListener("touchmove", stop);
  }, []);
  return (
    <Reorder.Item
      ref={ref}
      as="div"
      value={world}
      className={`witem ${lifted ? "is-lifted" : ""}`}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => ((moved.current = true), setLifted(true))}
      onDragEnd={() => (setLifted(false), onDone())}
      onPointerDown={(e) => {
        moved.current = false;
        if (e.pointerType === "mouse") return controls.start(e);
        const ev = e.nativeEvent;
        hold.current = { x: e.clientX, y: e.clientY, t: window.setTimeout(() => (navigator.vibrate?.(10), setLifted(true), controls.start(ev)), 350) };
      }}
      onPointerMove={(e) => e.pointerType !== "mouse" && Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 8 && cancel()}
      onPointerUp={() => (cancel(), !moved.current && setLifted(false))}
      onPointerCancel={() => (cancel(), setLifted(false))}
      // After a drag and drop the world must not also be selected.
      onClickCapture={(e) => moved.current && (e.stopPropagation(), (moved.current = false))}
      onContextMenu={(e) => e.preventDefault()}
      whileDrag={{ scale: 1.06, zIndex: 2 }}
      transition={{ type: "spring", stiffness: 500, damping: 38 }}
    >
      {children}
    </Reorder.Item>
  );
}

function Item({ on, onClick, label, hint, n, color, home, children }: { on: boolean; onClick: () => void; label: string; hint?: string; n: number; color?: string; home?: boolean; children: React.ReactNode }) {
  // On a narrow screen the bar can scroll: keep the selected world visible.
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (on) ref.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [on]);
  return (
    <button ref={ref} className={`railitem ${on ? "on" : ""} ${home ? "ishome" : ""}`} onClick={onClick} title={home ? "All worlds" : hint ? `${label}: ${hint}` : label} style={color ? { ["--w" as string]: color } : undefined}>
      {/* Critically damped: it does not overshoot, so an item at the edge does not overflow and look cut off. */}
      {on && <motion.span layoutId="rail-ring" className="ring" transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} />}
      <motion.span className="orbwrap" whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.92 }}>{children}</motion.span>
      <span className="name">{label}</span>
      {n > 0 && <span className="badge">{n}</span>}
    </button>
  );
}

type WorldDraft = { name: string; color: string; color2?: string; description: string };

// New world and world settings use the same form. When editing there is "Delete world" at the bottom.
function WorldForm({ world, used = [], stats, onClose, onSave, onDelete }: { world?: World; used?: string[]; stats?: string; onClose: () => void; onSave: (d: WorldDraft) => void; onDelete?: () => void }) {
  const [name, setName] = useState(world?.name ?? "");
  const [color, setColor] = useState(world?.color ?? SWATCHES.find((c) => !used.includes(c)) ?? SWATCHES[0]);
  const [color2, setColor2] = useState(world?.color2 ?? "");
  const [desc, setDesc] = useState(world?.description ?? "");
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.form
        className="modal"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave({ name: name.trim(), color, color2: color2 || undefined, description: desc.trim() });
        }}
      >
        <p className="flabel">{world ? "World settings" : "New world"}</p>
        <div className="newworld">
          <Orb world={{ id: world?.id ?? "x", name, color, color2: color2 || undefined, description: "" }} size={52} blob />
          <input className="big" autoFocus={!world} placeholder="World name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="toneset">
          <span className="flabel">Main color</span>
          <div className="swatches">
            {SWATCHES.map((c) => (
              <button type="button" key={c} className={c === color ? "on" : ""} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
            ))}
            <ColorPick className={`pick ${SWATCHES.includes(color) ? "" : "on"}`} title="Another color" value={color} onChange={setColor} label="Another main color" />
          </div>
        </div>
        <div className="toneset">
          <span className="flabel">Second tone</span>
          <div className="swatches">
            <button type="button" className={`auto ${color2 ? "" : "on"}`} onClick={() => setColor2("")} aria-label="Automatic" title="Close tones of the main color">A</button>
            {SWATCHES.filter((c) => c !== color).map((c) => (
              <button type="button" key={c} className={c === color2 ? "on" : ""} style={{ background: c }} onClick={() => setColor2(c)} aria-label={c} />
            ))}
            <ColorPick className={`pick ${color2 && !SWATCHES.includes(color2) ? "on" : ""}`} title="Another color" value={color2 || color} onChange={setColor2} label="Another second tone" />
          </div>
        </div>
        <label className="field">
          <span className="flabel">Short description</span>
          <input maxLength={80} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="E.g. My game projects, social media" />
        </label>
        {confirm && onDelete ? (
          <div className="wdel">
            <p>Delete <b>{world?.name}</b>? {stats}</p>
            <div className="foot">
              <span />
              <button type="button" className="btn" onClick={() => setConfirm(false)}>Cancel</button>
              <button type="button" className="btn dangerfill" onClick={onDelete}>Yes, delete</button>
            </div>
          </div>
        ) : (
        <div className="foot">
          {onDelete ? <button type="button" className="btn danger" onClick={() => setConfirm(true)}>Delete world</button> : null}
          <span />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim()}>{world ? "Save" : "Create"}</button>
        </div>
        )}
      </motion.form>
    </div>
  );
}

export const openNewWorld = () => dispatchEvent(new Event("pg-world-new"));
export const openWorldSettings = (id: string) => dispatchEvent(new CustomEvent("pg-world-settings", { detail: id }));

// Delete: the world's projects, tasks, blocks, sessions, notes and automations go together. Undo puts them all back.
function takeWorld(s: State, id: string) {
  const tasks = new Set(s.tasks.filter((t) => t.worldId === id).map((t) => t.id));
  const autos = new Set(s.automations.filter((a) => a.worldId === id).map((a) => a.id));
  return {
    index: s.worlds.findIndex((w) => w.id === id),
    world: s.worlds.find((w) => w.id === id)!,
    projects: s.projects.filter((p) => p.worldId === id),
    tasks: s.tasks.filter((t) => tasks.has(t.id)),
    blocks: s.blocks.filter((b) => b.worldId === id || (b.taskId && tasks.has(b.taskId))),
    sessions: s.sessions.filter((x) => tasks.has(x.taskId)),
    inbox: s.inbox.filter((x) => x.worldId === id),
    automations: s.automations.filter((a) => autos.has(a.id)),
    runs: s.runs.filter((r) => r.taskId && tasks.has(r.taskId)),
  };
}
function removeWorld(s: State, id: string) {
  const snap = takeWorld(s, id);
  const drop = <T,>(list: T[], gone: T[]) => list.filter((x) => !gone.includes(x));
  s.worlds = s.worlds.filter((w) => w.id !== id);
  s.projects = drop(s.projects, snap.projects);
  s.tasks = drop(s.tasks, snap.tasks);
  s.blocks = drop(s.blocks, snap.blocks);
  s.sessions = drop(s.sessions, snap.sessions);
  s.inbox = drop(s.inbox, snap.inbox);
  s.automations = drop(s.automations, snap.automations);
  s.runs = drop(s.runs, snap.runs);
  if (s.timer && snap.tasks.some((t) => t.id === s.timer!.taskId)) { commitTimer(s); s.timer = null; }
}
function deleteStats(s: State, id: string) {
  const w = takeWorld(s, id);
  const parts = [
    w.projects.length && `${w.projects.length} ${w.projects.length === 1 ? "project" : "projects"}`,
    w.tasks.length && `${w.tasks.length} ${w.tasks.length === 1 ? "task" : "tasks"}`,
    w.automations.length && `${w.automations.length} ${w.automations.length === 1 ? "automation" : "automations"}`,
    w.inbox.length && `${w.inbox.length} ${w.inbox.length === 1 ? "note" : "notes"}`,
    w.runs.length && `${w.runs.length} ${w.runs.length === 1 ? "output" : "outputs"}`,
    w.sessions.length && `${w.sessions.length} focus ${w.sessions.length === 1 ? "session" : "sessions"}`,
  ].filter(Boolean);
  return parts.length ? `Everything inside goes too: ${parts.join(", ")}. You can undo right after.` : "There is nothing inside.";
}
