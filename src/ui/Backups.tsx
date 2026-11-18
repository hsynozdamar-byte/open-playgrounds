import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { dayLong, relDay } from "../date";
import { toast } from "./Toast";

// Yedekten geri dönüş. Sunucu her gün ilk yazımdan önce bir kopya alır (server/store.mjs).
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

// Günlük yedek o günün başındaki hâldir; "once-" yedeği bir geri dönüşten hemen önceki hâl.
function label(b: Backup) {
  const t = new Date(b.at);
  const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(b.name)) {
    const r = relDay(b.name);
    return { title: r === "bugün" ? "Bugünün başı" : r === "dün" ? "Dünün başı" : `${dayLong(b.name)} başı`, when: "Günün ilk kaydından önce" };
  }
  if (b.name.startsWith("once-")) return { title: "Geri dönmeden önceki hâl", when: `${dayLong(b.at.slice(0, 10))} ${hm}` };
  return { title: "Elle alınan yedek", when: `${dayLong(b.at.slice(0, 10))} ${hm}` };
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
    if (!r.ok) return toast(r.error ?? "Geri dönülemedi");
    onClose();
    toast("Yedeğe dönüldü. Önceki hâl de yedeklendi.");
  };

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="modal backups" role="dialog" aria-label="Yedekler" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
        <header className="bkhead">
          <div>
            <h2>Yedekler</h2>
            <p>Bir güne dönersen şimdiki hâl de yedeklenir.</p>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </header>
        {!list ? <p className="muted bkempty">Yükleniyor</p> : !list.length ? <p className="muted bkempty">Henüz yedek yok. İlk kayıttan sonra her gün bir yedek alınır.</p> : (
          <ul className="bklist">
            {list.map((b) => {
              const l = label(b);
              return (
                <li key={b.name}>
                  <div className="bkrow">
                    <span className="bktx">
                      <b>{l.title}</b>
                      <span>{l.when} · {b.worlds} dünya, {b.projects} proje, {b.tasks} görev, {b.notes} not</span>
                    </span>
                    {ask !== b.name && <button className="btn sm" onClick={() => setAsk(b.name)}>Bu hâle dön</button>}
                  </div>
                  {ask === b.name && (
                    <div className="bkconfirm">
                      <p>Şimdiki bütün veriler bu yedekle değişir. Şimdiki hâl ayrıca saklanır, istersen ona geri dönebilirsin.</p>
                      <div className="foot">
                        <span />
                        <button className="btn sm" onClick={() => setAsk(null)}>Vazgeç</button>
                        <button className="btn sm primary" disabled={busy} onClick={() => restore(b.name)}>Evet, dön</button>
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
