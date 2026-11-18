import { useEffect, useRef } from "react";
import type { Ctx } from "../lib";
import type { State } from "../types";
import { blockTitle } from "../lib";
import { addDays, hm, localTs, today } from "../date";
import { chime, notify, startTask } from "../timer";
import { toast } from "./Toast";
import { useNow } from "./useNow";

// Hatırlatmalar (uygulama açıkken): takvimdeki işin saati gelince, ve günün ilk açılışında bugün deadline'ı olan işler.
// Hatırlatılanlar bu tarayıcıda tutulur; sayfa yenilenince aynısı tekrar çıkmaz.
const KEY = "pg-reminded";
const LATE_MIN = 10; // saati 10 dakikadan fazla geçmişse artık hatırlatılmaz

function seen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch { return new Set(); }
}
// Anahtar "b:GÜN:blok" ya da "d:GÜN"; yalnız dünden bu yana olanlar saklanır.
function remember(keys: Set<string>) {
  const from = addDays(today(), -1);
  const keep = [...keys].filter((k) => k.split(":")[1] >= from);
  try { localStorage.setItem(KEY, JSON.stringify(keep)); } catch { /* yok */ }
}

// Şu an başlaması gereken bloklar: başlangıcı geçmiş ama LATE_MIN içinde, işi bitmemiş, sayaçta değil.
export function dueBlocks(s: State, now = new Date()) {
  const cur = localTs(now);
  const from = localTs(new Date(now.getTime() - LATE_MIN * 60000));
  return s.blocks.filter((b) => {
    if (!b.taskId || b.start > cur || b.start < from) return false;
    const t = s.tasks.find((x) => x.id === b.taskId);
    if (!t || t.status === "done" || s.timer?.taskId === t.id) return false;
    // Rou'nun işi için "Başlama zamanı" çalmaz: o iş senin odak sayacınla başlamaz.
    const auto = t.autoId ? s.automations.find((a) => a.id === t.autoId) : undefined;
    return (auto?.who ?? t.who ?? "me") === "me";
  });
}

export function useReminders(ctx: Ctx) {
  const minute = useNow(true, 30000);
  const s = ctx.state;
  const c = useRef(ctx);
  c.current = ctx;
  useEffect(() => {
    const ctx = c.current;
    const done = seen();
    let changed = false;
    // Tek bildirim alanı var: saati gelen iş daha acil, en son o gösterilir.
    const t = today();
    const k = `d:${t}`;
    if (!done.has(k)) {
      const due = s.tasks.filter((x) => x.deadline === t && x.status !== "done");
      done.add(k);
      changed = true;
      if (due.length) toast(due.length === 1 ? `Deadline today: ${due[0].title}` : `${due.length} tasks have a deadline today`, () => (due.length === 1 ? ctx.open(due[0].id) : ctx.go({ view: "focus" })), "Show");
    }
    for (const b of dueBlocks(s)) {
      const k = `b:${b.start.slice(0, 10)}:${b.id}`;
      if (done.has(k)) continue;
      done.add(k);
      changed = true;
      const title = blockTitle(s, b);
      chime();
      notify(`${hm(b.start)} · ${title}`, "Time to start.");
      toast(`${hm(b.start)} · ${title} is starting`, () => startTask(ctx.mutate, b.taskId!), "Start");
    }
    if (changed) remember(done);
  }, [s, minute]);
}
