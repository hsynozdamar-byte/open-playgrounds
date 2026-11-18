import type { Bin } from "./types";
import type { Ctx } from "./lib";
import { uid } from "./store";
import { restoreTrash, toTrash } from "../shared/trash.mjs";
import { toast } from "./ui/Toast";

// Deletes and puts the records in the Trash; the toast's "Undo" brings them back from the Trash.
export function binIt(ctx: Pick<Ctx, "mutate">, kind: Bin["kind"], title: string, recs: Bin["recs"], remove: (s: Ctx["state"]) => void, msg: string) {
  const id = uid();
  const snap = structuredClone(recs);
  ctx.mutate((s) => {
    remove(s);
    toTrash(s, id, kind, title, snap);
  });
  toast(msg, () => ctx.mutate((s) => void restoreTrash(s, id)));
}
