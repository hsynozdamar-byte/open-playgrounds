import { AnimatePresence, motion } from "motion/react";
import { openAutoView } from "./openAuto";
import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, FolderKanban, History, NotebookPen, Plus, Repeat, Search as SearchIcon } from "lucide-react";
import { openBackups } from "./Backups";
import { openNewWorld } from "./Rail";
import type { Ctx } from "../lib";
import { worldOf } from "../lib";
import type { State } from "../types";
import { relDay, today } from "../date";
import { Orb } from "./Orb";
import { StatusMark } from "./StatusMark";
import { reveal } from "./reveal";

export const openSearch = () => dispatchEvent(new Event("pg-search"));

// Türkçe harfler sadeleşir: "gorsel" yazınca "görsel" de bulunur.
const fold = (x: string) => x.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

type Kind = "task" | "project" | "note" | "auto" | "world" | "cmd";
type Hit = { kind: Kind; id: string; title: string; meta: string; worldId: string | null; score: number; done?: boolean; status?: State["tasks"][number]["status"] };

const GROUP: Record<Kind, string> = { cmd: "Commands", task: "Tasks", project: "Projects", note: "Notebook", auto: "Automations", world: "Worlds" };
const ORDER: Kind[] = ["world", "project", "task", "auto", "note", "cmd"];
// Aramadan çalışan komutlar: id → başlık ve arama kelimeleri.
const CMDS: { id: string; title: string; meta: string; words: string }[] = [
  { id: "backups", title: "Restore from backup", meta: "Daily backups", words: "backup restore recover undo" },
  { id: "world", title: "New world", meta: "Add a world", words: "new world add create" },
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Başlıkta baştan eşleşme en üstte, sonra kelime başı, sonra içinde; yalnız açıklamada geçen en altta.
function score(q: string, title: string, rest: string[]) {
  const t = fold(title);
  if (t.startsWith(q)) return 100;
  if (t.split(/\s+/).some((w) => w.startsWith(q))) return 80;
  if (t.includes(q)) return 60;
  return rest.some((r) => fold(r).includes(q)) ? 30 : 0;
}

export function find(s: State, raw: string): Hit[] {
  const q = fold(raw.trim());
  const proj = new Map(s.projects.map((p) => [p.id, p]));
  const wname = (id: string | null) => (id ? s.worlds.find((w) => w.id === id)?.name ?? "" : "");
  const out: Hit[] = [];
  if (!q) {
    // Boşken: bugünün ve geciken açık işler.
    const t = today();
    return s.tasks
      .filter((x) => x.status !== "done" && x.day && x.day <= t)
      .sort((a, b) => (a.day! < b.day! ? -1 : a.day! > b.day! ? 1 : (a.order ?? 0) - (b.order ?? 0)))
      .slice(0, 8)
      .map((x) => ({ kind: "task", id: x.id, title: x.title, meta: [wname(x.worldId), x.projectId ? proj.get(x.projectId)?.name : "", x.day === t ? "today" : relDay(x.day!)].filter(Boolean).join(" · "), worldId: x.worldId, score: 1, status: x.status }));
  }
  for (const w of s.worlds) {
    const n = score(q, w.name, [w.description]);
    if (n) out.push({ kind: "world", id: w.id, title: w.name, meta: w.description, worldId: w.id, score: n });
  }
  for (const p of s.projects) {
    const n = score(q, p.name, [p.description]);
    if (n) out.push({ kind: "project", id: p.id, title: p.name, meta: wname(p.worldId), worldId: p.worldId, score: n - (p.status === "done" ? 20 : 0), done: p.status === "done" });
  }
  for (const x of s.tasks) {
    const n = score(q, x.title, [x.notes, ...x.checklist.map((c) => c.text)]);
    if (!n) continue;
    const when = x.status === "done" ? "done" : x.day ? relDay(x.day) : "someday";
    out.push({ kind: "task", id: x.id, title: x.title, meta: [wname(x.worldId), x.projectId ? proj.get(x.projectId)?.name : "", when].filter(Boolean).join(" · "), worldId: x.worldId, score: n - (x.status === "done" ? 25 : 0), done: x.status === "done", status: x.status });
  }
  for (const a of s.automations) {
    const n = score(q, a.title, [a.action]);
    const days = a.days.length === 7 ? "Every day" : a.days.map((d) => DAYS[d]).join(", ");
    if (n) out.push({ kind: "auto", id: a.id, title: a.title, meta: [wname(a.worldId), days, a.times.join(", ")].filter(Boolean).join(" · "), worldId: a.worldId, score: n - (a.status === "paused" ? 10 : 0) });
  }
  for (const i of s.inbox) {
    const n = score(q, i.title, [i.body, i.from]);
    if (n) out.push({ kind: "note", id: i.id, title: i.title, meta: [wname(i.worldId), i.state === "done" ? "archived" : ""].filter(Boolean).join(" · ") || "Notebook", worldId: i.worldId, score: n - (i.state === "done" ? 20 : 0), done: i.state === "done" });
  }
  for (const c of CMDS) {
    const n = score(q, c.title, [c.words]);
    if (n) out.push({ kind: "cmd", id: c.id, title: c.title, meta: c.meta, worldId: null, score: n });
  }
  // Her grupta en iyi 6, gruplar sabit sırada.
  return ORDER.flatMap((k) => out.filter((h) => h.kind === k).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "en")).slice(0, 6));
}

export function SearchHost({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const o = () => setOpen(true);
    // ⌘K her yerde; "/" yazı alanı dışında.
    const k = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input,textarea,select,[contenteditable]");
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault();
        setOpen((x) => !x);
      }
    };
    addEventListener("pg-search", o);
    addEventListener("keydown", k);
    return () => (removeEventListener("pg-search", o), removeEventListener("keydown", k));
  }, []);
  return <AnimatePresence>{open && <Palette ctx={ctx} onClose={() => setOpen(false)} />}</AnimatePresence>;
}

function Palette({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const s = ctx.state;
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const hits = useMemo(() => find(s, q), [s, q]);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const pick = (h: Hit) => {
    onClose();
    if (h.kind === "task") return ctx.open(h.id);
    if (h.kind === "cmd") return h.id === "backups" ? openBackups() : openNewWorld();
    if (h.kind === "world") return ctx.go({ lens: h.id });
    if (h.kind === "project") return ctx.go({ view: "projects", lens: h.worldId!, project: h.id });
    if (h.kind === "auto") return openAutoView(h.id);
    // Not dünyasızsa açık dünyada da görünür; değilse kendi dünyasına geçilir.
    if (h.kind === "note") ctx.go({ view: "inbox", lens: h.worldId ?? ctx.route.lens, project: undefined });
    reveal(h.kind, h.id);
  };

  const key = (e: React.KeyboardEvent) => {
    // Yalnız arama kapanır; alttaki iş kartı ya da Rou sohbeti aynı Esc ile kapanmaz.
    if (e.key === "Escape") { e.stopPropagation(); return onClose(); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = hits.length;
      if (n) setAt((i) => (i + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
    }
    if (e.key === "Enter" && hits[at]) {
      e.preventDefault();
      pick(hits[at]);
    }
  };

  let last: Kind | null = null;
  return (
    <div className="scrim search-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="palette" role="dialog" aria-label="Search" initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.14 }}>
        <label className="pfield">
          <SearchIcon size={18} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="Search tasks, projects, notes and automations" aria-label="Search" />
          <button type="button" className="pesc" onClick={onClose}>Esc</button>
        </label>
        <ul ref={list} className="presults">
          {!q.trim() && hits.length > 0 && <li className="pgroup">Today and late</li>}
          {hits.map((h, i) => {
            const head = q.trim() && h.kind !== last ? GROUP[h.kind] : null;
            last = h.kind;
            const w = h.worldId ? worldOf(s, h.worldId) : null;
            return (
              <li key={`${h.kind}-${h.id}`} className="pli">
                {head && <div className="pgroup">{head}</div>}
                <button data-i={i} className={`pitem ${i === at ? "on" : ""} ${h.done ? "is-done" : ""}`} onMouseMove={() => at !== i && setAt(i)} onClick={() => pick(h)} style={{ ["--w" as string]: w?.color ?? "var(--ink-3)" }}>
                  <span className="pic">
                    {h.kind === "task" ? <StatusMark status={h.status!} size={16} />
                      : h.kind === "world" && w ? <Orb world={w} size={18} />
                      : h.kind === "project" ? <FolderKanban size={16} />
                      : h.kind === "auto" ? <Repeat size={16} />
                      : h.kind === "cmd" ? (h.id === "backups" ? <History size={16} /> : <Plus size={16} />)
                      : <NotebookPen size={16} />}
                  </span>
                  <span className="ptx">
                    <b>{h.title}</b>
                    {h.meta && <span>{h.meta}</span>}
                  </span>
                  {i === at && <CornerDownLeft className="pent" size={14} />}
                </button>
              </li>
            );
          })}
          {q.trim() && !hits.length && <li className="pnone">Nothing found for “{q.trim()}”.</li>}
          {!q.trim() && !hits.length && <li className="pnone">No open tasks for today. Type to search.</li>}
        </ul>
      </motion.div>
    </div>
  );
}
