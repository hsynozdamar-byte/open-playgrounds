import { NoteBody } from "../ui/NoteBody";
import { PageHead } from "../ui/PageHead";
import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";
import { Archive, ArrowDownToLine, ArrowUp, ArrowUpRight, Check, CheckSquare, Inbox as InboxIcon, Lightbulb, Link2, Pencil, StickyNote, Trash2 } from "lucide-react";
import type { InboxItem, NoteCategory } from "../types";
import { type Ctx, ALL, SOURCE_LABEL, newTask, worldOf } from "../lib";
import { addDays, ago, today } from "../date";
import { uid } from "../store";
import { toast } from "../ui/Toast";
import { binIt } from "../trashOps";
import { openAutoForm } from "../ui/AutoForm";
import { flash, reveal, useReveal } from "../ui/reveal";
import { Incoming, incomingSources } from "./Incoming";
import { openAutoView } from "../ui/openAuto";
import { openRou } from "../ui/Rou";
import { Select, projectGroups } from "../ui/Select";

const CATS: { id: NoteCategory; label: string; plural: string; Icon: typeof StickyNote; empty: string }[] = [
  { id: "note", label: "Note", plural: "Notes", Icon: StickyNote, empty: "Anything on your mind. Turn it into a task later or put it in a world." },
  { id: "idea", label: "Idea", plural: "Ideas", Icon: Lightbulb, empty: "Ideas for a new game, video or app. Once they mature they become an automation or a task." },
  { id: "todo", label: "To do", plural: "To dos", Icon: CheckSquare, empty: "Small things you have not put on a day yet. Make them a task and they go on the calendar." },
  { id: "link", label: "Link", plural: "Links", Icon: Link2, empty: "Pages to look at later. Paste one and the link becomes its title." },
];
// Rou'ya giden istek: bekleyen notları okuyup her birine yer önerir (tek toplu kart, sen seçip onaylarsın).
const ROU_ASK = "Sort the waiting notes in the Notebook: put each one in the right world and project, turn the ones that should be tasks into tasks, and add the ones that belong to an existing task to that task.";
const catOf = (i: InboxItem): NoteCategory => i.category ?? "note";
type Tab = "all" | NoteCategory | "done" | "feeds";

// Defter: not yaz, kategorisini seç. Sonra işe çevir, bir dünyaya koy, arşivle ya da sil.
export function Inbox({ ctx }: { ctx: Ctx }) {
  const { state: s, route } = ctx;
  const lens = route.lens;
  const [tab, setTab] = useState<Tab>("all");
  const sideRef = useRef<HTMLElement>(null);
  const emptyRef = useRef<HTMLDivElement>(null);
  // Masaüstünde boş kartın alt kenarı soldaki menü kartının alt kenarıyla aynı hizada.
  useLayoutEffect(() => {
    const side = sideRef.current, el = emptyRef.current;
    if (!side || !el) return;
    const fit = () => {
      el.style.minHeight = "";
      if (innerWidth <= 860) return;
      const h = side.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
      if (h > el.offsetHeight) el.style.minHeight = `${h}px`;
    };
    const ro = new ResizeObserver(fit);
    ro.observe(side);
    if (el.previousElementSibling) ro.observe(el.previousElementSibling);
    const t = setTimeout(fit, 250); // sayfa geçişindeki kayma bitince
    return () => (ro.disconnect(), clearTimeout(t));
  });
  // Aramadan gelen not: arşivdeyse Arşiv sekmesi açılır, kart vurgulanır.
  useReveal("note", (id) => {
    const n = s.inbox.find((x) => x.id === id);
    if (!n) return;
    setTab(n.state === "done" ? "done" : "all");
    flash(`[data-note="${id}"]`);
  });
  useReveal("incoming", () => setTab("feeds"));
  const inLens = (i: InboxItem) => lens === ALL || i.worldId === lens || i.worldId === null;
  const open = s.inbox.filter((i) => i.state === "new" && inLens(i));
  const archived = s.inbox.filter((i) => i.state === "done" && inLens(i));
  const items = (tab === "done" ? archived : tab === "all" ? open : open.filter((i) => catOf(i) === tab)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  const remove = (i: InboxItem) => {
    binIt(ctx, "note", i.title, { inbox: [i] }, (st) => void (st.inbox = st.inbox.filter((x) => x.id !== i.id)), "Note deleted");
  };
  const [askClear, setAskClear] = useState(false);
  const clearArchive = () => {
    binIt(ctx, "note", `Archive, ${archived.length} ${archived.length === 1 ? "note" : "notes"}`, { inbox: archived }, (st) => void (st.inbox = st.inbox.filter((x) => !archived.some((y) => y.id === x.id))), `${archived.length} ${archived.length === 1 ? "note" : "notes"} deleted`);
    setAskClear(false);
  };

  const nav: { id: Tab; label: string; n: number; Icon: typeof StickyNote }[] = [
    { id: "all", label: "All", n: open.length, Icon: InboxIcon },
    ...CATS.map((c) => ({ id: c.id as Tab, label: c.plural, n: open.filter((i) => catOf(i) === c.id).length, Icon: c.Icon })),
  ];
  const CurrentIcon = tab === "feeds" ? ArrowDownToLine : tab === "done" ? Archive : nav.find((x) => x.id === tab)!.Icon;
  const cat = CATS.find((c) => c.id === tab);
  const empty = tab === "done"
    ? { title: "Archive is empty", text: "Notes you archive or turn into tasks stay here." }
    : cat
      ? { title: `No ${cat.plural.toLocaleLowerCase("en")} yet`, text: cat.empty }
      : { title: "Notebook is empty", text: "Write whatever comes to mind above. Then make it a task, put it in a world or archive it." };

  return (
    <>
    <PageHead ctx={ctx} title="Notebook" sub="Write what comes to mind, then turn it into a task." />
    <div className="notebook">
      <aside ref={sideRef} className="card nbside">
        <nav className="nbnav">
          {nav.map(({ id, label, n, Icon }) => (
            <button key={id} className={`nbitem ${tab === id ? "on" : ""} ${id !== "all" ? `c-${id}` : ""}`} onClick={() => setTab(id)}>
              <Icon size={16} />
              <span className="l">{label}</span>
              {n > 0 && <span className="c">{n}</span>}
            </button>
          ))}
          <span className="nbsep" />
          <button className={`nbitem ${tab === "done" ? "on" : ""}`} onClick={() => setTab("done")}>
            <Archive size={16} />
            <span className="l">Archive</span>
            {archived.length > 0 && <span className="c">{archived.length}</span>}
          </button>
          <Feeds ctx={ctx} on={tab === "feeds"} onClick={() => setTab("feeds")} />
        </nav>
      </aside>

      <section className="nbmain">
        {tab === "feeds" ? <Incoming ctx={ctx} /> : <>
        {tab !== "done" && <Composer ctx={ctx} defaultCat={tab === "all" ? "note" : tab} />}

        {tab === "done" && archived.length > 0 && (askClear ? (
          <div className="delconfirm nbconfirm" role="alertdialog" aria-label="Clear archive">
            <b>Delete {archived.length} archived {archived.length === 1 ? "note" : "notes"} for good?</b>
            <p>Tasks made from notes stay where they are.</p>
            <div className="bmbtns">
              <button className="btn sm ghost" onClick={() => setAskClear(false)}>Cancel</button>
              <button className="btn sm dangerfill" onClick={clearArchive}>Yes, delete</button>
            </div>
          </div>
        ) : (
          <div className="nbbar">
            <span className="muted">{archived.length} archived {archived.length === 1 ? "note" : "notes"}</span>
            <button className="btn sm danger push" onClick={() => setAskClear(true)}>
Clear archive
            </button>
          </div>
        ))}

        {tab !== "done" && open.length > 1 && (
          <div className="nbbar nbrou">
            <span className="muted">{open.length} waiting notes</span>
            <button className="btn sm push" onClick={() => openRou(ROU_ASK)}>Let Rou sort them</button>
          </div>
        )}

        {items.length > 0 && (
          <div className="nbgrid">
            {splitCols(items).map((col, k) => (
              <div key={k} className="nbcol">
                <AnimatePresence initial={false}>
                  {col.map(({ i, n }) => <NoteCard key={i.id} i={i} n={n} ctx={ctx} onDelete={() => remove(i)} />)}
                </AnimatePresence>
              </div>
            ))}
          </div>
        )}
        {items.length === 0 && (
          <div ref={emptyRef} className={`card nbempty ${cat ? `c-${cat.id}` : ""}`}>
            <span className="ei"><CurrentIcon size={20} /></span>
            <div className="et">
              <b>{empty.title}</b>
              <p>{empty.text}</p>
            </div>
          </div>
        )}
        </>}
      </section>
    </div>
    </>
  );
}

// Gelenler: mail, Slack gibi kaynaklar. Okunanlar Defter'e düşer, kaynaklar da burada kurulur.
function Feeds({ ctx, on, onClick }: { ctx: Ctx; on: boolean; onClick: () => void }) {
  const n = incomingSources(ctx).length;
  return (
    <button className={`nbitem nbfeedlink ${on ? "on" : ""}`} onClick={onClick}>
      <ArrowDownToLine size={16} />
      <span className="l">Incoming</span>
      <span className="c">{n ? `${n} ${n === 1 ? "source" : "sources"}` : "add"}</span>
    </button>
  );
}

// Yazma alanı: Enter ekler, Shift+Enter yeni satır. İlk satır başlık, gerisi not.
function Composer({ ctx, defaultCat }: { ctx: Ctx; defaultCat: NoteCategory }) {
  const [text, setText] = useState("");
  const [cat, setCat] = useState<NoteCategory>(defaultCat);
  const [lastDefault, setLastDefault] = useState(defaultCat);
  if (defaultCat !== lastDefault) (setLastDefault(defaultCat), setCat(defaultCat));
  const ref = useRef<HTMLTextAreaElement>(null);
  const lens = ctx.route.lens;
  const add = () => {
    const v = text.trim();
    if (!v) return;
    const [title, ...rest] = v.split("\n");
    ctx.mutate((st) =>
      void st.inbox.unshift({ id: uid(), worldId: lens === ALL ? null : lens, source: "note", from: "", url: /^https?:\/\//.test(title.trim()) ? title.trim() : "", title: title.trim(), body: rest.join("\n").trim(), receivedAt: new Date().toISOString(), state: "new", category: cat }),
    );
    setText("");
    ref.current?.focus();
  };
  return (
    <form className={`composer c-${cat}`} onSubmit={(e) => (e.preventDefault(), add())}>
      <textarea
        ref={ref}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) (e.preventDefault(), add());
        }}
        placeholder="Write something…"
      />
      <div className="cfoot">
        <div className="catpick">
          {CATS.map(({ id, label, Icon }) => (
            <button type="button" key={id} className={`catchip c-${id} ${cat === id ? "on" : ""}`} onClick={() => setCat(id)} aria-label={label} title={label}>
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <span className="kbd">Enter adds · Shift+Enter new line</span>
        <button className="btn sm primary cadd" disabled={!text.trim()} aria-label="Add"><ArrowUp size={16} className="m-ic" /><span>Add</span></button>
      </div>
    </form>
  );
}

function NoteCard({ i, n, ctx, onDelete }: { i: InboxItem; n: number; ctx: Ctx; onDelete: () => void }) {
  const s = ctx.state;
  const [conv, setConv] = useState(false);
  const [ask, setAsk] = useState(false);
  const [edit, setEdit] = useState(false);
  const saved = useRef(false);
  const t = today();
  const lensWorld = ctx.route.lens === ALL ? s.worlds[0].id : ctx.route.lens;
  const live = (id?: string | null) => (id && s.projects.some((p) => p.id === id) ? id : null);
  const sp = live(i.suggestion?.projectId) ?? live(i.projectId);
  // pick: proje id'si ya da "none:<dünya>" (iş kartındaki proje seçicisiyle aynı).
  const [f, setF] = useState<{ title: string; pick: string; day: string | null }>(() => ({
    title: i.suggestion?.title ?? i.title,
    pick: sp ?? `none:${i.worldId ?? lensWorld}`,
    day: i.suggestion?.day !== undefined ? i.suggestion.day : t,
  }));
  const w = i.worldId ? worldOf(s, i.worldId) : undefined;
  const proj = live(i.projectId) ? s.projects.find((p) => p.id === i.projectId) : undefined;
  const c = CATS.find((x) => x.id === catOf(i))!;
  const set = (fn: (x: InboxItem) => void) => ctx.mutate((st) => { const x = st.inbox.find((y) => y.id === i.id); if (x) fn(x); });
  const made = i.taskId ? s.tasks.find((x) => x.id === i.taskId) : undefined;
  const pickWorld = f.pick.startsWith("none:") ? f.pick.slice(5) : s.projects.find((p) => p.id === f.pick)?.worldId ?? lensWorld;
  const pickProject = f.pick.startsWith("none:") ? null : f.pick;

  const convert = () => {
    // Çift tıklama ya da Enter tekrarı ikinci bir iş açmasın.
    if (saved.current || !f.title.trim()) return;
    saved.current = true;
    const task = newTask(pickWorld, f.title.trim(), { projectId: pickProject, day: f.day, notes: [i.title !== f.title.trim() ? i.title : "", i.body].filter(Boolean).join("\n\n"), ...(i.url ? { source: { type: i.source, url: i.url } } : {}) });
    ctx.mutate((st) => {
      const x = st.inbox.find((y) => y.id === i.id);
      if (!x || (x.taskId && st.tasks.some((y) => y.id === x.taskId))) return;
      st.tasks.push(task);
      x.state = "done";
      x.taskId = task.id;
    });
    const where = [worldOf(s, pickWorld).name, s.projects.find((p) => p.id === pickProject)?.name].filter(Boolean).join(" › ");
    toast(`Task created: ${where}`, () => ctx.open(task.id), "Open");
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, pointerEvents: "none" }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className={`ncard c-${c.id} ${i.state === "done" ? "archived" : ""}`}
      data-note={i.id}
      style={{ ["--w" as string]: w?.color ?? "var(--ink-3)", order: n }}
    >
      <header className="nctop">
        <Select className="ncat" title="Change category" label="Category" value={c.id} onChange={(v) => set((x) => (x.category = v as NoteCategory))}
          groups={[{ options: CATS.map((x) => ({ value: x.id, label: x.label })) }]}>
          <c.Icon size={13} />{c.label}
        </Select>
        {i.source !== "note" && <span className="nsrc">{SOURCE_LABEL[i.source] ?? i.source}{i.from ? ` · ${i.from}` : ""}</span>}
        <span className="ntime">{ago(i.receivedAt)}</span>
        {!edit && (
          <span className="ntools">
            {i.state === "new" && <button className="iconbtn nedbtn" title="Edit" aria-label="Edit note" onClick={() => setEdit(true)}><Pencil size={15} /></button>}
            <button className="iconbtn del" title="Delete" aria-label="Delete" onClick={() => setAsk(true)}><Trash2 size={15} /></button>
          </span>
        )}
      </header>

      {edit ? (
        <NoteEdit i={i} onSave={(title, body) => (set((x) => ((x.title = title), (x.body = body))), setEdit(false))} onCancel={() => setEdit(false)} />
      ) : (
        <>
          <h3>{i.url ? <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a> : i.title}</h3>
          {i.body && <NoteBody text={i.body} onToggle={i.state === "new" ? (body) => set((x) => (x.body = body)) : undefined} />}
        </>
      )}
      {i.suggestion && !conv && !made && <p className="sugg">Suggestion: “{i.suggestion.title}”</p>}

      {edit ? null : ask ? (
        <div className="delconfirm" role="alertdialog" aria-label="Delete note">
          <b>Delete this note for good?</b>
          {(made || i.state === "new") && <p>{made ? "The task made from this note stays where it is." : "To only remove it from the list, press Archive."}</p>}
          <div className="bmbtns">
            <button className="btn sm ghost" onClick={() => setAsk(false)}>Cancel</button>
            <button className="btn sm dangerfill" onClick={onDelete}>Yes, delete</button>
          </div>
        </div>
      ) : conv && !made ? (
        <form className="convert" onSubmit={(e) => (e.preventDefault(), convert())}>
          <input className="ctitle" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus aria-label="Task name" />
          <div className="crow">
            <Select className="ppick" style={{ ["--w" as string]: worldOf(s, pickWorld).color }} label="Project" value={f.pick} onChange={(v) => setF({ ...f, pick: v })} groups={projectGroups(s, f.pick)}>
              <i />{worldOf(s, pickWorld).name}<span className="sep">›</span><b>{pickProject ? s.projects.find((p) => p.id === pickProject)?.name : "No project"}</b>
            </Select>
            <div className="seg sm">
              {[{ l: "Today", v: t }, { l: "Tomorrow", v: addDays(t, 1) }, { l: "Someday", v: null }].map((o) => (
                <button type="button" key={o.l} className={f.day === o.v ? "on" : ""} onClick={() => setF({ ...f, day: o.v })}>{o.l}</button>
              ))}
            </div>
          </div>
          <div className="nact">
            <button className="btn sm primary" disabled={!f.title.trim()}>Save as task</button>
            <button type="button" className="btn sm ghost" onClick={() => setConv(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <footer className="nact">
          {made ? (
            <button className="btn sm" onClick={() => ctx.open(made.id)}><ArrowUpRight size={14} />Open task</button>
          ) : i.autoId && s.automations.some((a) => a.id === i.autoId) ? (
            <button className="btn sm" onClick={() => openAutoView(i.autoId!)}><ArrowUpRight size={14} />View automation</button>
          ) : i.state === "new" ? (
            <>
              <button className="btn sm" onClick={() => setConv(true)}>Make a task</button>
              <button className="btn sm" onClick={() => openAutoForm({ fromNote: i.id })}>Make an automation</button>
            </>
          ) : null}
          {i.state === "new" && !made && !i.autoId && (
            <Select className="ppick wpick" style={{ ["--w" as string]: w?.color ?? "var(--ink-3)" }} title="Put in a world or project" label="World or project"
              value={proj ? `p:${proj.id}` : i.worldId ? `w:${i.worldId}` : ""}
              groups={[{ options: [{ value: "", label: "No world" }] }, ...projectGroups(s, null, (id) => `p:${id}`, (wid) => `w:${wid}`)]}
              onChange={(v) => {
                const p = v.startsWith("p:") ? s.projects.find((x) => x.id === v.slice(2)) : undefined;
                set((x) => {
                  x.worldId = p ? p.worldId : v.startsWith("w:") ? v.slice(2) : null;
                  if (p) x.projectId = p.id;
                  else delete x.projectId;
                });
              }}>
              <i />{w ? w.name : "No world"}{proj && <><span className="sep">›</span><b>{proj.name}</b></>}
            </Select>
          )}
          {i.state === "new" ? (
            <button className="btn sm ghost push" onClick={() => set((x) => (x.state = "done"))}>Archive</button>
          ) : (
            <button className="btn sm ghost push" onClick={() => set((x) => (x.state = "new"))}>Back to Notebook</button>
          )}
        </footer>
      )}
    </motion.article>
  );
}

// Notu yerinde düzenle: ilk satır başlık, gerisi metin (Defter'e yazarkenki gibi). ⌘Enter kaydeder, Esc vazgeçer.
function NoteEdit({ i, onSave, onCancel }: { i: InboxItem; onSave: (title: string, body: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(() => [i.title, i.body].filter(Boolean).join("\n"));
  const save = () => {
    const [title, ...rest] = text.trim().split("\n");
    if (title?.trim()) onSave(title.trim(), rest.join("\n").trim());
  };
  return (
    <form className="nedit" onSubmit={(e) => (e.preventDefault(), save())}>
      <textarea
        autoFocus
        value={text}
        rows={Math.min(14, Math.max(3, text.split("\n").length + 1))}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), save());
        }}
        aria-label="Note"
      />
      <span className="kbd">First line is the title · "- " list · "- [ ] " to do · "## " heading</span>
      <div className="nact">
        <button className="btn sm primary" disabled={!text.trim()}>Save</button>
        <button type="button" className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// İki sütun, üstleri aynı çizgide: notlar sırayla kısa kalan sütuna gider (yükseklik tahmini metin uzunluğundan).
// Dar ekranda sütunlar açılır (display: contents), kartlar `order` ile yine sırayla dizilir.
function splitCols(items: InboxItem[]) {
  const cols: { i: InboxItem; n: number }[][] = [[], []];
  const h = [0, 0];
  items.forEach((i, n) => {
    const k = h[1] < h[0] ? 1 : 0;
    cols[k].push({ i, n });
    h[k] += 150 + Math.ceil(i.title.length / 60) * 24 + (i.body ? i.body.split("\n").reduce((a, l) => a + Math.max(1, Math.ceil(l.length / 70)), 0) * 22 : 0);
  });
  return cols;
}

