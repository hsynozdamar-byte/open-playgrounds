import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { dayLong, relDay } from "../date";
import { toast } from "./Toast";

// Restore from a backup. The server takes a copy before the first write of each day (server/store.mjs).
type Backup = { name: string; at: string; worlds: number; projects: number; tasks: number; notes: number; automations: number };

export const openBackups = () => dispatchEvent(new Event("pg-backups"));

export function BackupsHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const o = () => setOpen(true);
    addEventListener("pg-backups", o);
    return () => removeEventListener("pg-backups", o);
  }, []);
  return <AnimatePresence>{open && <Backups onClose={() => setOpen(false)} />}</AnimatePresence>;
}

// A daily backup is the state at the start of that day; a "once-" backup is the state right before a restore.
function label(b: Backup) {
  const t = new Date(b.at);
  const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(b.name)) {
    const r = relDay(b.name);
    return { title: r === "today" ? "Start of today" : r === "yesterday" ? "Start of yesterday" : `Start of ${dayLong(b.name)}`, when: "Before the first save of the day" };
  }
  if (b.name.startsWith("once-")) return { title: "State before a restore", when: `${dayLong(b.at.slice(0, 10))} ${hm}` };
  return { title: "Manual backup", when: `${dayLong(b.at.slice(0, 10))} ${hm}` };
}

function Backups({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Backup[] | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/backups").then((r) => r.json()).then(setList).catch(() => setList([]));
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);

  const restore = async (name: string) => {
    setBusy(true);
    const r = await fetch("/api/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then((r) => r.json()).catch(() => ({ ok: false }));
    setBusy(false);
    if (!r.ok) return toast(r.error ?? "Could not restore");
    onClose();
    toast("Restored from backup. The previous state was backed up too.");
  };

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="modal backups" role="dialog" aria-label="Backups" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
        <header className="bkhead">
          <div>
            <h2>Backups</h2>
            <p>If you go back to a day, the current state is backed up too.</p>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        {!list ? <p className="muted bkempty">Loading</p> : !list.length ? <p className="muted bkempty">No backups yet. After the first save, a backup is taken every day.</p> : (
          <ul className="bklist">
            {list.map((b) => {
              const l = label(b);
              return (
                <li key={b.name}>
                  <div className="bkrow">
                    <span className="bktx">
                      <b>{l.title}</b>
                      <span>{l.when} · {b.worlds} {b.worlds === 1 ? "world" : "worlds"}, {b.projects} {b.projects === 1 ? "project" : "projects"}, {b.tasks} {b.tasks === 1 ? "task" : "tasks"}, {b.notes} {b.notes === 1 ? "note" : "notes"}</span>
                    </span>
                    {ask !== b.name && <button className="btn sm" onClick={() => setAsk(b.name)}>Restore this</button>}
                  </div>
                  {ask === b.name && (
                    <div className="bkconfirm">
                      <p>All current data is replaced by this backup. The current state is kept separately, so you can go back to it.</p>
                      <div className="foot">
                        <span />
                        <button className="btn sm" onClick={() => setAsk(null)}>Cancel</button>
                        <button className="btn sm primary" disabled={busy} onClick={() => restore(b.name)}>Yes, restore</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </motion.div>
    </div>
  );
}
