import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight, FolderOpen, Image, Plus, X } from "lucide-react";
import type { Project } from "../types";
import type { Ctx } from "../lib";

// Projenin medya kütüphanesi: diskteki bir ya da birkaç klasörün videoları ve görselleri (server/library.mjs).
// Her birini izleyip İyi ya da Kötü dersin; otomasyonlar gönderi hazırlarken yalnız iyileri kullanır.
// key: işaretlerin anahtarı (ilk klasörde klasöre göre yol, diğerlerinde "klasör::yol"); rel: klasör içindeki yol.
type Item = { key: string; rel: string; dir: string; kind: "video" | "image"; size: number; at: string };
type Kind = "all" | "video" | "image";
const KINDS: [Kind, string][] = [["all", "Hepsi"], ["video", "Video"], ["image", "Fotoğraf"]];
type Filter = "all" | "new" | "good" | "bad";
const FILTERS: [Filter, string][] = [["new", "Bakılmadı"], ["good", "İyi"], ["bad", "Kötü"], ["all", "Hepsi"]];
const PAGE = 24;
const src = (p: string, rel: string, kind: "file" | "thumb") => `/lib/${kind}?p=${encodeURIComponent(p)}&rel=${encodeURIComponent(rel)}`;
const base = (rel: string) => rel.split("/").pop() ?? rel;
const folder = (rel: string) => rel.split("/").slice(0, -1).join(" / ");

// Klasörün kısa adı: son iki anlamlı parça ("public" gibi ara klasörler atlanır); tam yol üstüne gelince görünür.
const dirName = (d: string) => d.replace(/\/+$/, "").split("/").filter((x) => x && x !== "public").slice(-2).join(" / ");

export function MediaCard({ ctx, project }: { ctx: Ctx; project: Project }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<Filter>("new");
  const [n, setN] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("all");
  const dirs = [...new Set([project.mediaDir, ...(project.mediaDirs ?? [])].filter(Boolean))] as string[];
  const [adding, setAdding] = useState(!dirs.length);
  const [missing, setMissing] = useState<string[]>([]);
  const marks = project.media ?? {};
  // Dosya bir gönderide kullanıldı mı: gönderinin sahne (clip) ya da slayt (image) anahtarlarından. Paylaşıldı > onayda > taslakta.
  const used = useMemo(() => {
    const m = new Map<string, { st: "posted" | "ready" | "draft"; at: string }>();
    const rank = { posted: 3, ready: 2, draft: 1 } as const;
    for (const r of ctx.state.runs) {
      const t = ctx.state.tasks.find((x) => x.id === r.taskId);
      if (!t || t.projectId !== project.id || !r.post) continue;
      const parts = [...((r.post as { scenes?: { clip?: string }[] }).scenes ?? []).map((x) => x.clip), ...((r.post as { slides?: { image?: string }[] }).slides ?? []).map((x) => x.image)].filter(Boolean) as string[];
      const st = r.status === "posted" || r.status === "acted" ? "posted" : r.status === "ready" || r.status === "approved" ? "ready" : "draft";
      for (const k of parts) { const cur = m.get(k); if (!cur || rank[st] > rank[cur.st]) m.set(k, { st, at: r.postedAt ?? r.at }); }
    }
    return m;
  }, [ctx.state.runs, ctx.state.tasks, project.id]);

  useEffect(() => {
    if (!dirs.length) return setItems(null);
    let live = true;
    setErr("");
    fetch(`/api/library?p=${encodeURIComponent(project.id)}`).then((r) => r.json()).then((r) => {
      if (!live) return;
      if (r.ok) { setItems(r.items); setMissing(r.missing ?? []); }
      else { setItems(null); setErr(r.error ?? "Klasör okunamadı"); }
    }).catch(() => live && setErr("Sunucuya ulaşılamadı"));
    return () => { live = false; };
  }, [project.id, dirs.join("|")]);

  const count = useMemo(() => {
    const c = { all: 0, new: 0, good: 0, bad: 0 };
    for (const it of items ?? []) if (kind === "all" || it.kind === kind) { c.all++; c[marks[it.key] ?? "new"]++; }
    return c;
  }, [items, marks, kind]);
  const kinds = useMemo(() => ({ all: items?.length ?? 0, video: items?.filter((x) => x.kind === "video").length ?? 0, image: items?.filter((x) => x.kind === "image").length ?? 0 }), [items]);
  // Hiç bakılmamış yoksa açılışta Hepsi gösterilir.
  const f = filter === "new" && items && count.new === 0 ? "all" : filter;
  const shown = (items ?? []).filter((it) => (kind === "all" || it.kind === kind) && (f === "all" || (marks[it.key] ?? "new") === f));

  // Klasör ekle: ilk klasör mediaDir'e, sonrakiler mediaDirs'e.
  const addDir = (v: string) => ctx.mutate((st) => {
    const p = st.projects.find((x) => x.id === project.id);
    const d = v.trim();
    if (!p || !d || p.mediaDir === d || p.mediaDirs?.includes(d)) return;
    if (!p.mediaDir) p.mediaDir = d; else (p.mediaDirs ??= []).push(d);
  });
  // Klasörü çıkar: dosyalar diskte kalır. İlk klasör çıkarsa sıradaki ilk olur; onun işaretlerinin anahtarı "klasör::yol"dan yola döner.
  const removeDir = (d: string) => ctx.mutate((st) => {
    const p = st.projects.find((x) => x.id === project.id);
    if (!p) return;
    if (p.mediaDir === d) {
      const next = p.mediaDirs?.shift();
      p.mediaDir = next;
      if (next && p.media) for (const k of Object.keys(p.media)) {
        if (!k.includes("::")) delete p.media[k];
        else if (k.startsWith(`${next}::`)) { p.media[k.slice(next.length + 2)] = p.media[k]; delete p.media[k]; }
      }
    } else {
      p.mediaDirs = p.mediaDirs?.filter((x) => x !== d);
      if (p.media) for (const k of Object.keys(p.media)) if (k.startsWith(`${d}::`)) delete p.media[k];
    }
    if (!p.mediaDirs?.length) delete p.mediaDirs;
  });
  const mark = (rel: string, v: "good" | "bad") => ctx.mutate((st) => {
    const p = st.projects.find((x) => x.id === project.id);
    if (!p) return;
    const m = (p.media ??= {});
    if (m[rel] === v) delete m[rel]; else m[rel] = v;
  });

  return (
    <section className="card media">
      <div className="cardhead">
        <Image size={15} className="hicon" />
        <h3>Medya</h3>
        <span className="n">{items?.length || ""}</span>
        {items && items.length > 0 && <span className="mediasum">{(() => { const u = items.filter((x) => used.has(x.key)); const posted = u.filter((x) => used.get(x.key)!.st === "posted").length; return u.length ? `${u.length} dosya gönderide kullanıldı${posted ? `, ${posted} tanesi paylaşıldı` : ""}` : "Hiçbiri henüz bir gönderide kullanılmadı"; })()}</span>}
        {items && items.length > 0 && (
          <div className="seg sm mfilter mkind">
            {KINDS.map(([k, label]) => (
              <button key={k} className={kind === k ? "on" : ""} onClick={() => { setKind(k); setN(PAGE); }}>{label}<span className="mc">{kinds[k]}</span></button>
            ))}
          </div>
        )}
        {items && items.length > 0 && (
          <div className="seg sm mfilter">
            {FILTERS.map(([k, label]) => (
              <button key={k} className={f === k ? "on" : ""} onClick={() => { setFilter(k); setN(PAGE); }}>{label}<span className="mc">{count[k]}</span></button>
            ))}
          </div>
        )}
      </div>
      <ul className="mdirs">
        {dirs.map((d) => (
          <li key={d} className={missing.includes(d) ? "is-missing" : ""}>
            <FolderOpen size={14} className="hicon" />
            <span title={d}>{dirName(d)}</span>
            {missing.includes(d) && <em>bulunamadı</em>}
            <button className="iconbtn" onClick={() => removeDir(d)} aria-label="Klasörü çıkar" title="Klasörü çıkar (dosyalar diskte kalır)"><X size={14} /></button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form className="mdir" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get("dir") ?? ""); if (v.trim()) { addDir(v); setAdding(false); } }}>
          <FolderOpen size={15} className="hicon" />
          <input name="dir" placeholder="Klasör yolu, ör. ~/Videolar/Proje" autoFocus={dirs.length > 0} />
          <button className="btn sm" type="submit">Bağla</button>
          {dirs.length > 0 && <button className="btn sm ghost" type="button" onClick={() => setAdding(false)}>Vazgeç</button>}
        </form>
      ) : (
        <button className="link maddir" onClick={() => setAdding(true)}><Plus size={14} />Klasör ekle</button>
      )}
      {!dirs.length && <p className="empty">Video ve fotoğraf klasörünü bağla; İyi işaretlediklerin gönderilerde kullanılır.</p>}
      {err && <p className="empty">{err}</p>}
      {items && items.length === 0 && <p className="empty">Bu klasörlerde video ya da fotoğraf yok.</p>}
      {shown.length > 0 && (
        <ul className="mgrid">
          {shown.slice(0, n).map((it) => (
            <li key={it.key} className={`mtile is-${marks[it.key] ?? "new"}`}>
              <button onClick={() => setOpen(it.key)} title={`${it.dir}/${it.rel}`}>
                <span className="mthumb">
                  <img src={src(project.id, it.key, "thumb")} alt="" loading="lazy" />
                  {it.kind === "video" && <span className="mplay" />}
                  {marks[it.key] && <span className={`mbadge ${marks[it.key]}`}>{marks[it.key] === "good" ? "İyi" : "Kötü"}</span>}
                  {used.get(it.key) && <span className={`mediause is-${used.get(it.key)!.st}`}>{used.get(it.key)!.st === "posted" ? "Paylaşıldı" : used.get(it.key)!.st === "ready" ? "Gönderide" : "Taslakta"}</span>}
                </span>
                <span className="mname">{base(it.rel)}</span>
                <span className="mfold">{[dirs.length > 1 ? base(it.dir) : "", folder(it.rel)].filter(Boolean).join(" / ") || " "}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.length > n && <button className="btn sm mmore" onClick={() => setN(n + PAGE * 2)}>{shown.length - n} tane daha</button>}
      {items && f !== "all" && shown.length === 0 && items.length > 0 && <p className="empty">{f === "good" ? "Henüz İyi işaretli yok." : f === "bad" ? "Kötü işaretli yok." : "Hepsine baktın."}</p>}
      {createPortal(<AnimatePresence>
        {open && <Viewer key="v" pid={project.id} list={shown} k={open} marks={marks} onMark={mark} onGo={setOpen} onClose={() => setOpen(null)} />}
      </AnimatePresence>, document.body)}
    </section>
  );
}

function Viewer({ pid, list, k, marks, onMark, onGo, onClose }: { pid: string; list: Item[]; k: string; marks: Record<string, "good" | "bad">; onMark: (rel: string, v: "good" | "bad") => void; onGo: (rel: string) => void; onClose: () => void }) {
  const i = Math.max(0, list.findIndex((x) => x.key === k));
  const it = list[i] ?? list[0];
  const go = (d: number) => list.length && onGo(list[(i + d + list.length) % list.length].key);
  // İşaretleyince sıradaki bakılmamışa geçer (yoksa yerinde kalır).
  const pick = (v: "good" | "bad") => {
    const was = marks[it.key];
    onMark(it.key, v);
    if (was === v) return;
    const next = [...list.slice(i + 1), ...list.slice(0, i)].find((x) => !marks[x.key] && x.key !== it.key);
    if (next) onGo(next.key);
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  if (!it) return null;
  const m = marks[it.key];
  return (
    <motion.div className="scrim center mview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="mvbox" role="dialog" aria-label={base(it.rel)} initial={{ y: 12, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, opacity: 0 }}>
        <div className="mvstage">
          {it.kind === "video"
            ? <video key={it.key} src={src(pid, it.key, "file")} controls autoPlay playsInline />
            : <img key={it.key} src={src(pid, it.key, "file")} alt="" />}
        </div>
        <div className="mvbar">
          <div className="mvtext">
            <b title={it.rel}>{base(it.rel)}</b>
            <span>{[base(it.dir), folder(it.rel)].filter(Boolean).join(" / ")} · {i + 1} / {list.length}</span>
          </div>
          <div className="mvnav">
            <button className="iconbtn" onClick={() => go(-1)} aria-label="Önceki"><ChevronLeft size={18} /></button>
            <button className="iconbtn" onClick={() => go(1)} aria-label="Sonraki"><ChevronRight size={18} /></button>
          </div>
          <div className="mvpick">
            <button className={`btn ${m === "bad" ? "is-bad" : ""}`} onClick={() => pick("bad")}>Kötü</button>
            <button className={`btn ${m === "good" ? "is-good" : ""}`} onClick={() => pick("good")}>İyi</button>
          </div>
          <button className="iconbtn mvclose" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </div>
      </motion.div>
    </motion.div>
  );
}
