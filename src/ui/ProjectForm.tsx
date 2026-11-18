import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Flag, Repeat, X } from "lucide-react";
import type { Ctx } from "../lib";
import { uid } from "../store";
import { DatePick } from "./DatePick";
import { toast } from "./Toast";
import { Select } from "./Select";

// Yeni proje: ad, dünya, açıklama, zaman tek pencerede; hesaplar Gönderiler'deki hesap penceresinden bağlanır. Kaydedince proje sayfası açılır.
// Zaman: deadline'lı ya da sürekli. Sürekli projede gün seçilirse ritim projenin otomasyonu olur (Rou o günlerde hazırlar).
const WEEK = [1, 2, 3, 4, 5, 6, 0];
type Req = { worldId: string };
export const openProjectForm = (r: Req) => dispatchEvent(new CustomEvent("pg-project-form", { detail: r }));

export function ProjectFormHost({ ctx }: { ctx: Ctx }) {
  const [req, setReq] = useState<Req | null>(null);
  useEffect(() => {
    const h = (e: Event) => setReq((e as CustomEvent<Req>).detail);
    addEventListener("pg-project-form", h);
    return () => removeEventListener("pg-project-form", h);
  }, []);
  if (!req) return null;
  return <ProjectForm key={JSON.stringify(req)} ctx={ctx} req={req} onClose={() => setReq(null)} />;
}

function ProjectForm({ ctx, req, onClose }: { ctx: Ctx; req: Req; onClose: () => void }) {
  const s = ctx.state;
  const [name, setName] = useState("");
  const [worldId, setWorld] = useState(s.worlds.some((w) => w.id === req.worldId) ? req.worldId : s.worlds[0]?.id);
  const [about, setAbout] = useState("");
  const [deadline, setDeadline] = useState("");
  const [ongoing, setOngoing] = useState(false);
  const w = s.worlds.find((x) => x.id === worldId);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);
  const save = () => {
    if (!name.trim() || !worldId) return;
    const id = uid();
    ctx.mutate((st) => {
      st.projects.push({ id, worldId, name: name.trim(), description: about.trim(), status: "active", deadline: ongoing ? null : deadline || null, ...(ongoing ? { ongoing: true } : {}) });
    });
    ctx.go({ view: "projects", lens: worldId, project: id });
    toast(`${name.trim()} kuruldu`);
    onClose();
  };
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.form className="modal autoform projform" style={{ ["--w" as string]: w?.color }} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} onSubmit={(e) => (e.preventDefault(), save())}>
        <div className="afhead">
          <h2 className="mtitle">Yeni proje</h2>
          <button type="button" className="x" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </div>
        <input className="big" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Projenin adı" aria-label="Projenin adı" />
        <dl className="props">
          <div>
            <dt>Dünya</dt>
            <dd>
              <Select className="ppick" style={{ ["--w" as string]: w?.color }} label="Dünya" value={worldId} onChange={setWorld}
                groups={[{ options: s.worlds.map((x) => ({ value: x.id, label: x.name, color: x.color })) }]}>
                <i />{w?.name}
              </Select>
            </dd>
          </div>
          <div>
            <dt>Hakkında</dt>
            <dd><textarea className="notes" rows={2} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Hedef, kapsam. Rou hazırlarken bunu da okur." /></dd>
          </div>
          <div>
            <dt>Zaman</dt>
            <dd className="pftime">
              <div className="seg">
                <button type="button" className={!ongoing ? "on" : ""} onClick={() => setOngoing(false)}><Flag size={13} />Deadline</button>
                <button type="button" className={ongoing ? "on" : ""} onClick={() => setOngoing(true)}><Repeat size={13} />Sürekli</button>
              </div>
              {!ongoing && <DatePick value={deadline} onChange={setDeadline} label="Deadline" placeholder="Tarih seç" />}
            </dd>
          </div>
          {/* Proje sürekli durur; tekrar eden iş projenin içinde bir işe bağlanır (iş kartı › Düzenli tekrarlansın). */}
          {ongoing && (
            <div>
              <dt />
              <dd><p className="muted whohint pfsum">Sürekli proje bitmez. Düzenli paylaşım gibi tekrar eden görevleri projeyi kurduktan sonra bir göreve bağlarsın: görevi aç, Düzenli tekrarlansın.</p></dd>
            </div>
          )}
        </dl>
        <div className="foot">
          <span />
          <button type="button" className="btn" onClick={onClose}>Vazgeç</button>
          <button className="btn primary" disabled={!name.trim()}>Projeyi kur</button>
        </div>
      </motion.form>
    </div>
  );
}
