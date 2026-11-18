import { useEffect, useRef, useState } from "react";
import { Ban, MessageSquareQuote, Palette, Plus, Shapes, Users, X } from "lucide-react";
import type { Brand, Project } from "../types";
import type { Ctx } from "../lib";

// Projenin marka sesi: Rou gönderi hazırlarken ve haftayı planlarken uyar (server/prepare.mjs brandBlock).
// Rou da sohbette verilen kalıcı kararları buraya yazar (edit_project). Satırlar okunur durur, tıklayınca düzenlenir.
const EMPTY: Brand = { audience: "", pillars: [], use: "", avoid: "" };

type TextKey = "audience" | "use" | "avoid";
const ROWS: { key: TextKey | "pillars"; Icon: typeof Users; label: string; hint: string; ph: string }[] = [
  { key: "audience", Icon: Users, label: "Kitle", hint: "Kime yazıyoruz", ph: "Ör. 25-40 yaş tasarımcılar" },
  { key: "use", Icon: MessageSquareQuote, label: "Ton", hint: "Nasıl konuşuyoruz", ph: "Ör. Kuru ve ironik, kısa paragraflar, ben dili" },
  { key: "pillars", Icon: Shapes, label: "Konular", hint: "Her gönderi birine oturur", ph: "Ör. Geliştirme günlüğü" },
  { key: "avoid", Icon: Ban, label: "Kaçın", hint: "Asla geçmeyecek", ph: "Ör. Emoji, \"devrim niteliğinde\", ünlem" },
];

export function BrandCard({ ctx, project }: { ctx: Ctx; project: Project }) {
  const b = { ...EMPTY, ...project.brand };
  const set = (p: Partial<Brand>) => ctx.mutate((st) => { const x = st.projects.find((y) => y.id === project.id); if (x) x.brand = { ...EMPTY, ...x.brand, ...p }; });
  return (
    <section className="card brand">
      <div className="cardhead"><Palette size={15} className="hicon" /><h3>Marka sesi</h3></div>
      <p className="muted brandnote">Rou gönderileri buna göre yazar. Sohbette "bu projenin tonu şöyle olsun" dersen buraya kendisi yazar.</p>
      <dl className="brandrows">
        {ROWS.map(({ key, Icon, label, hint, ph }) => (
          <div key={key} className="brow">
            <dt><Icon size={15} /><span><b>{label}</b><em>{hint}</em></span></dt>
            <dd>
              {key === "pillars"
                ? <Pillars list={b.pillars} ph={ph} onChange={(pillars) => set({ pillars })} />
                : <InlineText key={`${project.id}-${key}`} value={b[key]} ph={ph} label={label} onSave={(v) => set({ [key]: v })} />}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// Okunur metin; tıklayınca aynı yerde yazı alanı olur. Enter (Shift'siz) ya da dışarı tıklamak kaydeder, Esc vazgeçer.
function InlineText({ value, ph, label, onSave }: { value: string; ph: string; label: string; onSave: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fit = () => { const t = ta.current; if (t) { t.style.height = "auto"; t.style.height = `${t.scrollHeight}px`; } };
  useEffect(() => { if (edit) { fit(); const t = ta.current; t?.focus(); t?.setSelectionRange(t.value.length, t.value.length); } }, [edit]);
  const done = (save: boolean) => { const v = ta.current?.value.trim() ?? value; if (save && v !== value) onSave(v); setEdit(false); };
  if (edit) return (
    <textarea ref={ta} className="bedit" rows={1} defaultValue={value} placeholder={ph} aria-label={label} onInput={fit}
      onBlur={() => done(true)}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); done(true); } if (e.key === "Escape") { e.stopPropagation(); done(false); } }} />
  );
  return (
    <button type="button" className={`bval ${value ? "" : "is-empty"}`} onClick={() => setEdit(true)} aria-label={`${label} düzenle`}>
      {value || <><Plus size={13} />{ph}</>}
    </button>
  );
}

function Pillars({ list, ph, onChange }: { list: string[]; ph: string; onChange: (l: string[]) => void }) {
  const [v, setV] = useState("");
  const [adding, setAdding] = useState(false);
  const add = () => { const x = v.trim().replace(/,$/, ""); if (x && !list.includes(x)) onChange([...list, x]); setV(""); };
  return (
    <div className="bpills">
      {list.map((p) => <span key={p} className="bpill">{p}<button type="button" onClick={() => onChange(list.filter((x) => x !== p))} aria-label={`${p} çıkar`}><X size={12} /></button></span>)}
      {adding
        ? <input autoFocus className="bpilladd" value={v} placeholder={list.length ? "Konu adı" : ph} aria-label="Konu ekle"
            onChange={(e) => (e.target.value.endsWith(",") ? (setV(e.target.value), setTimeout(add)) : setV(e.target.value))}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { e.stopPropagation(); setV(""); setAdding(false); } }}
            onBlur={() => { add(); setAdding(false); }} />
        : <button type="button" className={`bval bpillbtn ${list.length ? "" : "is-empty"}`} onClick={() => setAdding(true)}><Plus size={13} />{list.length ? "Konu ekle" : ph}</button>}
    </div>
  );
}
