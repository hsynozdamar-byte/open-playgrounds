import { useCallback, useEffect, useRef, useState } from "react";
import type { State } from "./types";
import { toast } from "./ui/Toast";

// The JSON file on the server is the single source. Changes are applied optimistically and written in order.
export function useStore() {
  const [state, setState] = useState<State | null>(null);
  const rev = useRef<string>("");
  // Changes not yet written to disk. If the file was changed elsewhere (an AI tool, pg), all of them are re-applied to the current state.
  const pending = useRef<((s: State) => void)[]>([]);
  const saving = useRef(false);
  const warned = useRef(false);
  // Every load and every write bumps this counter, so a stale load response in flight never overwrites newer state.
  const epoch = useRef(0);
  // Last revision the server announced; checked when a write ends so a notice that arrived mid-write is not missed.
  const seen = useRef("");

  const load = useCallback(async () => {
    const mine = ++epoch.current;
    const r = await fetch("/api/state").then((r) => r.json());
    if (mine !== epoch.current) return;
    rev.current = r.rev;
    // A new file arriving while changes are unwritten must not wipe them: they are re-applied on top.
    const next = structuredClone(r.state as State);
    for (const fn of pending.current) fn(next);
    if (pending.current.length) mergeBlocks(next);
    setState(next);
  }, []);

  useEffect(() => {
    load();
    const es = new EventSource("/api/events");
    es.onmessage = (e) => {
      seen.current = e.data;
      if (e.data !== rev.current && !saving.current) load();
    };
    // Server notice (server/notify.mjs): in the Mac app a Notification becomes a native notification with the app icon.
    es.addEventListener("notice", (e) => {
      try {
        const n = JSON.parse((e as MessageEvent).data) as { title: string; text: string };
        if ("Notification" in window && Notification.permission === "granted") new Notification(n.title, { body: n.text });
      } catch { /* if the notice cannot be shown, the work carries on */ }
    });
    return () => es.close();
  }, [load]);

  // Writes the queue in order. On a network error it waits and retries; no change is lost.
  const flush = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    let wait = 1000;
    // A write with no answer is repeated with the same body and id: if the first reached the server, the server
    // recognises it and the changes are not applied twice (otherwise a 409 merge would add the same task, session or note again).
    let again: { sent: number; body: string } | null = null;
    try {
      while (pending.current.length) {
        let sent: number, body: string;
        if (again) ({ sent, body } = again);
        else {
          sent = pending.current.length;
          const base = await new Promise<State>((res) => setState((s) => (res(s!), s)));
          body = JSON.stringify({ state: base, rev: rev.current, save: uid() + uid() });
        }
        let r: Response, j: { rev: string; state?: State };
        try {
          r = await fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body });
          j = await r.json();
        } catch {
          if (!warned.current) toast("Could not save, waiting for the server. Changes are kept.");
          warned.current = true;
          again = { sent, body };
          await new Promise((res) => setTimeout(res, wait));
          wait = Math.min(wait * 2, 15000);
          continue;
        }
        again = null;
        epoch.current++;
        if (r.ok) {
          rev.current = j.rev;
          pending.current = pending.current.slice(sent);
          if (warned.current) toast("Saved");
          warned.current = false;
          wait = 1000;
          continue;
        }
        if (r.status === 409 && j.state) {
          // The file changed in the meantime: every pending change is re-applied to the current file.
          rev.current = j.rev;
          const merged = structuredClone(j.state);
          for (const fn of pending.current) fn(merged);
          mergeBlocks(merged);
          setState(merged);
          continue;
        }
        toast("Could not save: the server rejected the change");
        pending.current = [];
        await load();
      }
    } finally {
      saving.current = false;
    }
    // If the file changed elsewhere while writing (pg wrote something), the notice was skipped: load it now.
    if (seen.current && seen.current !== rev.current) load();
  }, [load]);

  // Undo / redo: the state before and after each change is kept; undoing restores only the records that change touched.
  const past = useRef<Step[]>([]);
  const future = useRef<Step[]>([]);

  const apply = useCallback((fn: (s: State) => void, mode: "edit" | "undo" | "redo" | "sys") => {
    pending.current.push(fn);
    setState((s) => {
      if (!s) return s;
      const next = structuredClone(s);
      fn(next);
      mergeBlocks(next);
      // React may call the updater twice; do not record the same step twice.
      if (mode === "edit" && past.current.at(-1)?.before !== s) {
        past.current.push({ before: s, after: next });
        if (past.current.length > 60) past.current.shift();
        future.current = [];
      }
      return next;
    });
    flush();
  }, [flush]);

  const mutate = useCallback((fn: (s: State) => void) => apply(fn, "edit"), [apply]);
  const system = useCallback((fn: (s: State) => void) => apply(fn, "sys"), [apply]);

  const undo = useCallback(() => {
    const step = past.current.pop();
    if (!step) return false;
    future.current.push(step);
    apply((s) => revert(s, step.after, step.before), "undo");
    return true;
  }, [apply]);
  const redo = useCallback(() => {
    const step = future.current.pop();
    if (!step) return false;
    past.current.push(step);
    apply((s) => revert(s, step.before, step.after), "redo");
    return true;
  }, [apply]);

  return { state, mutate, system, undo, redo };
}

type Step = { before: State; after: State };
type Rec = { id: string };
const LISTS = ["worlds", "projects", "tasks", "blocks", "sessions", "inbox"] as const;

// Applies the change from → to onto the current state, touching only the records that changed.
// Whatever pg or an AI tool wrote in between (a new session, a task) stays in place.
export function revert(s: State, from: State, to: State) {
  for (const k of LISTS) {
    const a = (from[k] ?? []) as Rec[], b = (to[k] ?? []) as Rec[];
    const A = new Map(a.map((x) => [x.id, x])), B = new Map(b.map((x) => [x.id, x]));
    let list = [...((s[k] ?? []) as Rec[])];
    for (const x of a) if (!B.has(x.id)) list = list.filter((y) => y.id !== x.id);
    for (const [i, x] of b.entries()) {
      const old = A.get(x.id);
      if (old && JSON.stringify(old) === JSON.stringify(x)) continue;
      const at = list.findIndex((y) => y.id === x.id);
      // If the record exists in both states, only the fields this step changed are restored: other fields
      // someone else (pg, the timer) wrote to the same record in the meantime stay in place.
      if (at >= 0 && old) list[at] = fields(list[at], old, x);
      else if (at >= 0) list[at] = structuredClone(x);
      else list.splice(Math.min(i, list.length), 0, structuredClone(x));
    }
    // If the order changed (e.g. worlds dragged into a new order), restore the target order; other records stay in place.
    const order = (l: Rec[]) => l.filter((x) => A.has(x.id) && B.has(x.id)).map((x) => x.id).join();
    if (order(a) !== order(b)) {
      const want = b.filter((x) => list.some((y) => y.id === x.id)).map((x) => x.id);
      const slots = list.map((y, i) => (B.has(y.id) ? i : -1)).filter((i) => i >= 0);
      const byId = new Map(list.map((y) => [y.id, y]));
      slots.forEach((at, j) => (list[at] = byId.get(want[j])!));
    }
    (s as unknown as Record<string, Rec[]>)[k] = list;
  }
  // The timer is not undone (time is real); only make sure no invisible timer is left when its task no longer exists.
  if (s.timer && !s.tasks.some((t) => t.id === s.timer!.taskId)) s.timer = null;
}

function fields(now: Rec, from: Rec, to: Rec): Rec {
  const out = { ...now } as Record<string, unknown>, a = from as Record<string, unknown>, b = to as Record<string, unknown>;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    if (k in b) out[k] = structuredClone(b[k]);
    else delete out[k];
  }
  return out as Rec;
}

// Overlapping or touching blocks of the same task on the same day merge into one block.
function mergeBlocks(s: State) {
  const sorted = [...s.blocks].sort((a, b) => a.start.localeCompare(b.start));
  const keep: typeof s.blocks = [];
  const last = new Map<string, (typeof s.blocks)[number]>();
  for (const b of sorted) {
    const key = b.taskId ? `${b.taskId}|${b.start.slice(0, 10)}` : "";
    const prev = key ? last.get(key) : undefined;
    if (prev && b.start <= prev.end) {
      if (b.end > prev.end) prev.end = b.end;
      continue;
    }
    keep.push(b);
    if (key) last.set(key, b);
  }
  if (keep.length !== s.blocks.length) s.blocks = keep;
}

// The same change is applied many times (optimistic copy, undo copy, draft, re-apply after a 409). If ids were generated
// anew each time, the record in the copy and the one in the data would get different ids: undo would look for the wrong
// record, and a later step editing a row added in a draft could not find it. A function run inside withIds gets the same ids on every run.
const fresh = () => Math.random().toString(36).slice(2, 8);
let tape: { ids: string[]; at: number } | null = null;
export const uid = () => {
  if (!tape) return fresh();
  if (tape.at >= tape.ids.length) tape.ids.push(fresh());
  return tape.ids[tape.at++];
};
export function withIds<T>(ids: string[], fn: () => T): T {
  const prev = tape;
  tape = { ids, at: 0 };
  try { return fn(); } finally { tape = prev; }
}
// Makes a change's ids stable.
export const stable = (fn: (s: State) => void) => { const ids: string[] = []; return (s: State) => withIds(ids, () => fn(s)); };
