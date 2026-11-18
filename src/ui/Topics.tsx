import type { Automation, State, Topic } from "../types";
import type { Ctx } from "../lib";
import { runOfTask } from "../runs";
import { occurrenceOf, topicKey } from "../../shared/repeat.mjs";
import { isQueued, isStale, queuePrepare } from "./Auto";
import { makeOccurrence } from "../../shared/repeat.mjs";
import { toast } from "./Toast";

// Otomasyonun önümüzdeki gönderileri ve her birinin konusu. Konu, iş açılmadan önce otomasyonda (a.topics),
// açıldıktan sonra işte (task.topic) durur; Rou hazırlarken buna göre yazar (server/prepare.mjs topicBlock).

export function topicOf(s: State, a: Automation, day: string, slot: string): Topic | undefined {
  return occurrenceOf(s, a, day, slot)?.topic ?? a.topics?.[topicKey(day, slot)];
}

export function setTopic(ctx: Ctx, a: Automation, day: string, slot: string, t: Topic | null) {
  ctx.mutate((st) => {
    const task = occurrenceOf(st, a, day, slot);
    if (task) { if (t) task.topic = t; else delete task.topic; return; }
    const x = st.automations.find((y) => y.id === a.id);
    if (!x) return;
    x.topics = { ...(x.topics ?? {}) };
    if (t) x.topics[topicKey(day, slot)] = t; else delete x.topics[topicKey(day, slot)];
  });
}

export async function suggestTopics(ctx: Ctx, a: Automation, count: number) {
  const r = await fetch("/api/plan-topics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ autoId: a.id, count }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
  if (!r.ok) return toast(`No topics came back: ${r.error ?? "error"}`);
  // Elle yazılmış konuya dokunmaz; yalnız boş olanları doldurur.
  const items = (r.items as { day: string; slot: string; title: string; brief: string; source?: string }[]).filter((x) => !topicOf(ctx.state, a, x.day, x.slot));
  for (const x of items) setTopic(ctx, a, x.day, x.slot, { title: x.title, brief: x.brief, ...(x.source ? { source: x.source } : {}) });
  toast(items.length ? `Topics planned for ${items.length} ${items.length === 1 ? "post" : "posts"}` : "No empty topics left");
}

// Otomasyon saatlerini (iş açılmamışsa açarak) Rou'nun sırasına alır; konu otomasyondan işe geçer.
export function queueSlots(ctx: Ctx, list: { a: Automation; day: string; slot: string }[], extra: string[] = []) {
  const s = ctx.state;
  const tmp = { tasks: [], blocks: [] } as unknown as State;
  const ids = list.map(({ a, day, slot }) => occurrenceOf(s, a, day, slot)?.id ?? makeOccurrence(tmp, { ...a, topics: { ...a.topics } }, day, slot).id);
  ctx.mutate((st) => {
    st.tasks.push(...tmp.tasks); st.blocks.push(...tmp.blocks);
    for (const { a, day, slot } of list) { const x = st.automations.find((y) => y.id === a.id); if (x?.topics) delete x.topics[topicKey(day, slot)]; }
  });
  const all = [...ids, ...extra];
  setTimeout(() => queuePrepare(all), 500);
  toast(`${all.length} ${all.length === 1 ? "post" : "posts"} added to Rou's queue; Rou prepares them one by one`);
}

// Satırın durumu: boşta, sırada, hazırlanıyor ya da hazırlanamadı.
export const stateOf = (s: State, t?: { id: string; queuedAt?: string }) => {
  if (!t) return "idle";
  const r = runOfTask(s.runs, t.id);
  if (r?.status === "working" && !isStale(r)) return "busy";
  if (isQueued(t as never)) return "queued";
  if (r && (r.status === "failed" || isStale(r))) return "failed";
  return "idle";
};
