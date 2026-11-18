import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Bin } from "../types";
import type { Ctx } from "../lib";
import { KEEP_DAYS, blocker, purgeTrash, restoreTrash, trashOrigin, trashSummary } from "../../shared/trash.mjs";
import { toast } from "./Toast";

// Trash: deleted items stay for 30 days (shared/trash.mjs). Restore them or delete them for good.
export const openTrash = () => dispatchEvent(new Event("pg-trash"));

export function TrashHost({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const o = () => setOpen(true);
    addEventListener("pg-trash", o);
    return () => removeEventListener("pg-trash", o);
  }, []);
  return <AnimatePresence>{open && <Trash ctx={ctx} onClose={() => setOpen(false)} />}</AnimatePresence>;
}

const KIND: Record<Bin["kind"], string> = { world: "World", project: "Project", task: "Task", auto: "Automation", run: "Output", note: "Note", account: "Account", source: "Source" };

function ago(at: string) {
  const d = Math.floor((Date.now() - Date.parse(at)) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

function Trash({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const s = ctx.state;
  const list = (s.trash ?? []).filter((b) => Date.now() - Date.parse(b.at) < KEEP_DAYS * 864e5);
  const [ask, setAsk] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose]);

  const restore = (b: Bin) => {
    ctx.mutate((st) => void restoreTrash(st, b.id));
    toast(`“${b.title}” restored`);
  };
  const purge = (id?: string) => {
    ctx.mutate((st) => purgeTrash(st, id));
    setAsk(null);
  };

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="modal backups" role="dialog" aria-label="Trash" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
        <header className="bkhead">
          <div>
            <h2>Trash</h2>
            <p>Deleted items stay here for {KEEP_DAYS} days, then go away on their own.</p>
          </div>
          {list.length > 0 && ask !== "all" && <button className="btn sm ghost" onClick={() => setAsk("all")}>Empty trash</button>}
          <button className="iconbtn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        {ask === "all" && (
          <div className="bkconfirm">
            <p>{list.length} {list.length === 1 ? "item" : "items"} in the Trash will be deleted for good. This cannot be undone.</p>
            <div className="foot">
              <span />
              <button className="btn sm" onClick={() => setAsk(null)}>Cancel</button>
              <button className="btn sm dangerfill" onClick={() => purge()}>Yes, empty</button>
            </div>
          </div>
        )}
        {!list.length ? <p className="muted bkempty">The Trash is empty.</p> : (
          <ul className="bklist">
            {list.map((b) => {
              const wait = blocker(s, b);
              const sum = trashSummary(b);
              const from = trashOrigin(s, b);
              return (
                <li key={b.id}>
                  <div className="bkrow">
                    <span className="bktx">
                      <b>{b.title}</b>
                      <span className="bkmeta">{[KIND[b.kind], from, sum && `contains ${sum}`, ago(b.at)].filter(Boolean).map((x, i) => <Fragment key={i}>{i ? " · " : ""}<i>{x}</i></Fragment>)}{wait ? ` · restore ${wait} first` : ""}</span>
                    </span>
                    {ask !== b.id && (
                      <>
                        <button className="btn sm ghost" onClick={() => setAsk(b.id)}>Delete forever</button>
                        <button className="btn sm" disabled={!!wait} onClick={() => restore(b)}>Restore</button>
                      </>
                    )}
                  </div>
                  {ask === b.id && (
                    <div className="bkconfirm">
                      <p>“{b.title}” will be deleted for good. This cannot be undone.</p>
                      <div className="foot">
                        <span />
                        <button className="btn sm" onClick={() => setAsk(null)}>Cancel</button>
                        <button className="btn sm dangerfill" onClick={() => purge(b.id)}>Yes, delete</button>
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
