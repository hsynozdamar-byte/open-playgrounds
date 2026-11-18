import type { State } from "./types";
import { uid } from "./store";
import { addDays, mkTs, today } from "./date";

// Offered on first launch: a small example world that shows how the app works. It can be deleted in one go from the world settings.
export function makeSample() {
  const t = today();
  const w = { id: `example-${uid().slice(0, 3)}`, name: "Example", color: "#14b8a6", description: "A world to try things in; delete it any time" };
  const p = { id: uid(), worldId: w.id, name: "Personal site", description: "A simple portfolio site", status: "active" as const, deadline: addDays(t, 14) };
  const task = (title: string, extra: Partial<State["tasks"][number]> = {}) => ({ id: uid(), worldId: w.id, projectId: p.id, title, notes: "", status: "todo" as const, day: null, deadline: null, estimate: null, checklist: [], by: "me", createdAt: new Date().toISOString(), ...extra });
  const write = task("Write the home page copy", { day: t, estimate: 60, checklist: [{ id: uid(), text: "Headline", done: true }, { id: uid(), text: "About me", done: false }] });
  const now = new Date();
  const start = Math.min(22 * 60, Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30 + 30);
  return {
    worlds: [w],
    projects: [p],
    tasks: [write, task("Collect the images", { day: addDays(t, 1) }), task("Put the site live", { deadline: addDays(t, 7) })],
    blocks: [{ id: uid(), taskId: write.id, worldId: w.id, title: "", start: mkTs(t, start), end: mkTs(t, start + 60), kind: "plan" as const }],
    inbox: [{ id: uid(), worldId: w.id, source: "note", from: "", url: "", title: "The site could have a blog section", body: "", receivedAt: new Date().toISOString(), state: "new", category: "idea" as const }],
  } satisfies Partial<State>;
}

// Ids are made outside: if the change is applied again, the same records are added.
export function addSample(s: State, x: ReturnType<typeof makeSample>) {
  if (s.worlds.some((w) => w.id === x.worlds[0].id)) return;
  for (const k of ["worlds", "projects", "tasks", "blocks", "inbox"] as const) (s[k] as unknown[]).push(...structuredClone(x[k]));
}
