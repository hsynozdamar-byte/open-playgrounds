import { useCallback, useEffect, useRef, useState } from "react";
import type { State } from "./types";
import { toast } from "./ui/Toast";

// Sunucudaki JSON dosyası tek kaynak. Değişiklikler iyimser uygulanır ve sırayla yazılır.
export function useStore() {
  const [state, setState] = useState<State | null>(null);
  const rev = useRef<string>("");
  // Henüz diske yazılmamış değişiklikler. Dosya başka yerden (Claude, pg) değiştiyse hepsi güncel duruma yeniden uygulanır.
  const pending = useRef<((s: State) => void)[]>([]);
  const saving = useRef(false);
  const warned = useRef(false);
  // Her yükleme ve her yazma bu sayacı artırır: yolda eskimiş bir yükleme cevabı yeni durumun üstüne yazmaz.
  const epoch = useRef(0);
  // Sunucunun bildirdiği son sürüm; yazma sürerken gelen bildirim kaçmasın diye yazma bitince bakılır.
  const seen = useRef("");

  const load = useCallback(async () => {
    const mine = ++epoch.current;
    const r = await fetch("/api/state").then((r) => r.json());
    if (mine !== epoch.current) return;
    rev.current = r.rev;
    // Yazılmamış değişiklik varken gelen yeni dosya bunları silmesin: üstüne yeniden uygulanır.
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
    // Sunucunun bildirimi (server/notify.mjs): Mac uygulamasında Notification yerel bildirime döner, uygulamanın ikonuyla.
    es.addEventListener("notice", (e) => {
      try {
        const n = JSON.parse((e as MessageEvent).data) as { title: string; text: string };
        if ("Notification" in window && Notification.permission === "granted") new Notification(n.title, { body: n.text });
      } catch { /* bildirim gösterilemezse görev yine sürer */ }
    });
    return () => es.close();
  }, [load]);

  // Kuyruğu sırayla yazar. Ağ hatasında bekleyip yeniden dener; değişiklik kaybolmaz.
  const flush = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    let wait = 1000;
    // Cevabı gelmeyen yazma aynı gövde ve aynı kimlikle yinelenir: ilki sunucuya ulaşmışsa sunucu onu tanır ve
    // değişiklikler ikinci kez uygulanmaz (yoksa 409 birleştirmesi aynı işi, oturumu ya da notu bir daha eklerdi).
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
          // Dosya bu arada değişti: bekleyen her değişiklik güncel dosyaya yeniden uygulanır.
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
    // Yazma sürerken dosya başka yerden değiştiyse (çıktı hazır oldu, pg yazdı) bildirimi atlanmıştı: şimdi yüklenir.
    if (seen.current && seen.current !== rev.current) load();
  }, [load]);

  // Geri al / yinele: her değişikliğin öncesi ve sonrası saklanır; geri alırken yalnız o değişikliğin dokunduğu kayıtlar geri döner.
  const past = useRef<Step[]>([]);
  const future = useRef<Step[]>([]);

  const apply = useCallback((fn: (s: State) => void, mode: "edit" | "undo" | "redo" | "sys") => {
    pending.current.push(fn);
    setState((s) => {
      if (!s) return s;
      const next = structuredClone(s);
      fn(next);
      mergeBlocks(next);
      // React updater'ı iki kez çağırabilir; aynı adımı iki kez kaydetme.
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
const LISTS = ["worlds", "projects", "tasks", "blocks", "sessions", "inbox", "automations", "runs", "memory", "rous"] as const;

// from → to yönündeki değişikliği şimdiki duruma uygular, yalnız değişen kayıtlara dokunur.
// Arada pg ya da Claude'un yazdıkları (yeni çıktı, oturum, iş) yerinde kalır.
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
      // Paylaşılmış çıktı geri alınmaz: "Onayla"yı geri almak onu yeniden onay bekler yapar, ikinci kez paylaşılırdı.
      if (k === "runs" && at >= 0 && (list[at] as { status?: string }).status === "posted") continue;
      // Kayıt iki durumda da varsa yalnız bu adımın değiştirdiği alanlar geri döner: aynı kayda bu arada
      // başkasının (Rou, pg, zamanlayıcı) yazdığı başka alanlar yerinde kalır.
      if (at >= 0 && old) list[at] = fields(list[at], old, x);
      else if (at >= 0) list[at] = structuredClone(x);
      else list.splice(Math.min(i, list.length), 0, structuredClone(x));
    }
    // Sıra değiştiyse (ör. dünyaları sürükleyip dizmek) hedefteki sırayı geri kur; diğer kayıtlar yerinde kalır.
    const order = (l: Rec[]) => l.filter((x) => A.has(x.id) && B.has(x.id)).map((x) => x.id).join();
    if (order(a) !== order(b)) {
      const want = b.filter((x) => list.some((y) => y.id === x.id)).map((x) => x.id);
      const slots = list.map((y, i) => (B.has(y.id) ? i : -1)).filter((i) => i >= 0);
      const byId = new Map(list.map((y) => [y.id, y]));
      slots.forEach((at, j) => (list[at] = byId.get(want[j])!));
    }
    (s as unknown as Record<string, Rec[]>)[k] = list;
  }
  // Yazım rehberi (set_guide) tek alan: değiştiyse önceki hâline döner.
  if (JSON.stringify(from.writingGuide) !== JSON.stringify(to.writingGuide)) { if (to.writingGuide) s.writingGuide = structuredClone(to.writingGuide); else delete s.writingGuide; }
  // Zamanlayıcı geri alınmaz (süre gerçek zaman); yalnız işi artık yoksa görünmez bir sayaç kalmasın.
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

// Aynı işin aynı gündeki üst üste binen ya da uç uca değen saatleri tek blokta birleşir.
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

// Aynı değişiklik birden çok kez uygulanır (iyimser kopya, geri al kopyası, taslak, 409 sonrası yeniden uygulama). Kimlik her
// seferinde yeniden üretilirse kopyadaki kayıtla verideki kayıt ayrı kimlik alır: geri al yanlış kaydı arar, taslakta eklenen
// satırı düzenleyen sonraki adım onu bulamaz. withIds içinde çalışan işlev her uygulanışta aynı kimlikleri alır.
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
// Bir değişikliği kimlikleri sabit hâle getirir.
export const stable = (fn: (s: State) => void) => { const ids: string[] = []; return (s: State) => withIds(ids, () => fn(s)); };
