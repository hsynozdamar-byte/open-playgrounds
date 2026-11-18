import { AddTile } from "./QuickAdd";
import { useRef, useState } from "react";
import { BookOpen, FileText, Link2, StickyNote, Upload, X } from "lucide-react";
import type { Project, Source, SourceKind } from "../types";
import type { Ctx } from "../lib";
import { uid } from "../store";
import { toast } from "./Toast";
import { binIt } from "../trashOps";

// Projenin kaynakları: not, yüklenen metin dosyası, bağlantı. İçerik uygulamanın verisinde durur, diskteki bir yola bağlanmaz.
// "Hazırlarken kullan" açıksa Claude bu projede hazırlarken (otomasyon çıktısı, gönderi) bunları okur.
const MAX_FILE = 200_000;
const TEXT = /\.(md|markdown|txt|csv|json)$/i;
const ICON: Record<SourceKind, typeof FileText> = { note: StickyNote, file: FileText, link: Link2 };
const k = (n: number) => (n < 1000 ? `${n} characters` : `${(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 })}k characters`);
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };

export function SourcesCard({ ctx, project }: { ctx: Ctx; project: Project }) {
  const list = project.sources ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<"note" | "link" | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const mut = (fn: (l: Source[]) => void) => ctx.mutate((st) => { const p = st.projects.find((x) => x.id === project.id); if (p) fn((p.sources ??= [])); });
  const set = (id: string, patch: Partial<Source>) => mut((l) => { const x = l.find((y) => y.id === id); if (x) Object.assign(x, patch); });
  const add = (s: Omit<Source, "id" | "use" | "addedAt">) => {
    const src: Source = { id: uid(), use: true, addedAt: new Date().toISOString(), ...s };
    mut((l) => void l.unshift(src));
    return src;
  };
  const remove = (s: Source) => {
    binIt(ctx, "source", s.title, { source: { projectId: project.id, src: s } }, (st) => {
      const p = st.projects.find((x) => x.id === project.id);
      if (p?.sources) p.sources = p.sources.filter((x) => x.id !== s.id);
    }, `“${s.title}” removed`);
  };
  const upload = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      if (!TEXT.test(f.name)) { toast(`${f.name}: text files only (.md, .txt, .csv, .json)`); continue; }
      if (f.size > MAX_FILE) { toast(`${f.name} is too big (200 KB at most)`); continue; }
      const body = (await f.text()).trim();
      const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || f.name.replace(TEXT, "");
      add({ kind: "file", title, body });
      toast(`Source added: ${title}`);
    }
    if (file.current) file.current.value = "";
  };
  return (
    <section className="card srcs" onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()} onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); upload(e.dataTransfer.files); }}>
      <div className="cardhead">
        <BookOpen size={15} className="hicon" />
        <h3>Sources</h3>
        <span className="n">{list.length || ""}</span>
      </div>
      <p className="empty srcnote">A style guide, a note or a link; Rou reads them when preparing for this project.</p>
      {/* Kaynaklar kutu kutu; ilk kutu ekleme. Kutuya basınca altında düzenlenir. */}
      <ul className="strip srcstrip">
        <AddTile items={[{ label: "Add note", onClick: () => setAdding("note") }, { label: "Upload file", onClick: () => file.current?.click() }, { label: "Add link", onClick: () => setAdding("link") }]} />
        {list.map((s) => {
          const Icon = ICON[s.kind] ?? StickyNote;
          return (
            <li key={s.id}>
              <div className={`srctile ${open === s.id ? "on" : ""} ${s.use ? "" : "is-off"}`}>
                <button className="srct" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                  <Icon size={16} className="srcicon" />
                  <b>{s.title}</b>
                  <span>{s.kind === "link" ? host(s.url ?? "") : k(s.body.length)}</span>
                </button>
                <div className="srcfoot">
                  <label className="srcuse" title="Rou reads this source when preparing"><input type="checkbox" checked={s.use} onChange={(e) => set(s.id, { use: e.target.checked })} />Use when preparing</label>
                  <button className="iconbtn" onClick={() => remove(s)} aria-label="Remove source" title="Remove source"><X size={15} /></button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <input ref={file} type="file" accept=".md,.markdown,.txt,.csv,.json,text/plain,text/markdown" multiple hidden onChange={(e) => upload(e.target.files)} />
      {adding && <NewSource kind={adding} onCancel={() => setAdding(null)} onSave={(s) => { const x = add(s); setAdding(null); setOpen(x.id); }} />}
      {(() => { const s = list.find((x) => x.id === open); return s && (
        <div className="srcbody">
          <input key={`t-${s.id}`} className="srctitle" defaultValue={s.title} onBlur={(e) => e.target.value.trim() && set(s.id, { title: e.target.value.trim() })} aria-label="Source name" />
          {s.kind === "link" && <a className="srcurl" href={s.url} target="_blank" rel="noreferrer">{s.url}</a>}
          <textarea key={`b-${s.id}`} rows={s.kind === "link" ? 3 : 12} defaultValue={s.body} placeholder={s.kind === "link" ? "Why does this link matter? Rou does not open the link; it reads this note." : ""} onBlur={(e) => e.target.value !== s.body && set(s.id, { body: e.target.value })} />
        </div>
      ); })()}
    </section>
  );
}

function NewSource({ kind, onSave, onCancel }: { kind: "note" | "link"; onSave: (s: Omit<Source, "id" | "use" | "addedAt">) => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const link = kind === "link";
  const okUrl = /^https?:\/\/\S+\.\S+/.test(url.trim());
  const ok = link ? okUrl : !!(title.trim() || body.trim());
  const save = () => ok && onSave(link
    ? { kind, title: title.trim() || host(url.trim()), body: body.trim(), url: url.trim() }
    : { kind, title: title.trim() || body.trim().split("\n")[0].slice(0, 60), body: body.trim() });
  return (
    <form className="srcnew" onSubmit={(e) => (e.preventDefault(), save())}>
      {link && <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" aria-label="Link" inputMode="url" />}
      <input autoFocus={!link} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={link ? "Name (site name if empty)" : "Name, e.g. Voice guide"} aria-label="Name" />
      <textarea rows={link ? 2 : 6} value={body} onChange={(e) => setBody(e.target.value)} placeholder={link ? "Note: why does this link matter? Rou does not open the link; it reads this note." : "Text"} aria-label={link ? "Note" : "Text"} />
      <div className="foot"><span /><button type="button" className="btn sm" onClick={onCancel}>Cancel</button><button className="btn sm primary" disabled={!ok}>Add</button></div>
    </form>
  );
}
