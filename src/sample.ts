import type { State } from "./types";
import { uid } from "./store";
import { addDays, mkTs, today } from "./date";

// İlk açılışta istenirse: uygulamanın nasıl çalıştığını gösteren küçük bir örnek dünya. Dünya ayarlarından tek seferde silinir.
export function makeSample() {
  const t = today();
  const w = { id: `ornek-${uid().slice(0, 3)}`, name: "Örnek", color: "#14b8a6", description: "Deneme dünyası; istediğin zaman silebilirsin" };
  const p = { id: uid(), worldId: w.id, name: "Kişisel site", description: "Basit bir portfolyo sitesi", status: "active" as const, deadline: addDays(t, 14) };
  const task = (title: string, extra: Partial<State["tasks"][number]> = {}) => ({ id: uid(), worldId: w.id, projectId: p.id, title, notes: "", status: "todo" as const, day: null, deadline: null, estimate: null, checklist: [], by: "me", createdAt: new Date().toISOString(), ...extra });
  const write = task("Ana sayfa metnini yaz", { day: t, estimate: 60, checklist: [{ id: uid(), text: "Başlık", done: true }, { id: uid(), text: "Hakkımda", done: false }] });
  const now = new Date();
  const start = Math.min(22 * 60, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30 + 30);
  return {
    worlds: [w],
    projects: [p],
    tasks: [write, task("Görselleri topla", { day: addDays(t, 1) }), task("Siteyi yayına al", { deadline: addDays(t, 7) })],
    blocks: [{ id: uid(), taskId: write.id, worldId: w.id, title: "", start: mkTs(t, start), end: mkTs(t, start + 60), kind: "plan" as const }],
    inbox: [{ id: uid(), worldId: w.id, source: "note", from: "", url: "", title: "Siteye blog bölümü eklenebilir", body: "", receivedAt: new Date().toISOString(), state: "new", category: "idea" as const }],
    automations: [{ id: uid(), worldId: w.id, projectId: p.id, title: "Haftalık yedek al", action: "", times: ["17:00"], minutes: 15, days: [5], status: "active" as const, who: "me" as const, horizon: null, createdAt: new Date().toISOString() }],
  } satisfies Partial<State>;
}

// Kimlikler dışarıda üretilir: değişiklik yeniden uygulansa da aynı kayıtlar eklenir.
export function addSample(s: State, x: ReturnType<typeof makeSample>) {
  if (s.worlds.some((w) => w.id === x.worlds[0].id)) return;
  for (const k of ["worlds", "projects", "tasks", "blocks", "inbox", "automations"] as const) (s[k] as unknown[]).push(...structuredClone(x[k]));
}
