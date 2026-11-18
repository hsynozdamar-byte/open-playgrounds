import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { Flag, Repeat, X } from "lucide-react";
import type { Ctx } from "../lib";
import { uid } from "../store";
import { DatePick } from "./DatePick";
import { toast } from "./Toast";
import { Select } from "./Select";

// New project: name, world, description and time in one window. Saving opens the project page.
// Time: with a deadline or ongoing.
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
    toast(`${name.trim()} created`);
    onClose();
  };
  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.form className="modal autoform projform" style={{ ["--w" as string]: w?.color }} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} onSubmit={(e) => (e.preventDefault(), save())}>
        <div className="afhead">
          <h2 className="mtitle">New project</h2>
          <button type="button" className="x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <input className="big" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" aria-label="Project name" />
        <dl className="props">
          <div>
            <dt>World</dt>
            <dd>
              <Select className="ppick" style={{ ["--w" as string]: w?.color }} label="World" value={worldId} onChange={setWorld}
                groups={[{ options: s.worlds.map((x) => ({ value: x.id, label: x.name, color: x.color })) }]}>
                <i />{w?.name}
              </Select>
            </dd>
          </div>
          <div>
            <dt>About</dt>
            <dd><textarea className="notes" rows={2} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="Goal, scope." /></dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd className="pftime">
              <div className="seg">
                <button type="button" className={!ongoing ? "on" : ""} onClick={() => setOngoing(false)}><Flag size={13} />Deadline</button>
                <button type="button" className={ongoing ? "on" : ""} onClick={() => setOngoing(true)}><Repeat size={13} />Ongoing</button>
              </div>
              {!ongoing && <DatePick value={deadline} onChange={setDeadline} label="Deadline" placeholder="Pick a date" />}
            </dd>
          </div>
          {ongoing && (
            <div>
              <dt />
              <dd><p className="muted whohint pfsum">An ongoing project has no end date.</p></dd>
            </div>
          )}
        </dl>
        <div className="foot">
          <span />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name.trim()}>Create project</button>
        </div>
      </motion.form>
    </div>
  );
}
