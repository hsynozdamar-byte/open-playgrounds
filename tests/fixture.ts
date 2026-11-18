import type { Automation, State, Task } from "../src/types";

// Testler için küçük, elle kurulmuş bir durum. Gerçek veriye hiç dokunulmaz.
export function state(): State {
  return {
    version: 3,
    worlds: [
      { id: "w1", name: "Atölye", color: "#3b6cf6", description: "" },
      { id: "w2", name: "Ev", color: "#ff5b2e", description: "" },
    ],
    projects: [{ id: "p1", worldId: "w1", name: "Proje A", description: "Deneme projesi", status: "active", deadline: null }],
    tasks: [task("t1", { projectId: "p1", title: "Mağaza görselleri", day: "2026-10-12" }), task("t2", { title: "Market", worldId: "w2" })],
    blocks: [{ id: "b1", taskId: "t1", worldId: "w1", title: "", start: "2026-10-12T10:00", end: "2026-10-12T11:00", kind: "plan" }],
    sessions: [{ id: "s1", taskId: "t1", start: "2026-10-12T07:00:00.000Z", end: "2026-10-12T07:30:00.000Z", mode: "free" }],
    inbox: [{ id: "n1", worldId: null, source: "note", from: "", url: "", title: "Görsel fikri", body: "yeni fikir", receivedAt: "2026-10-11T09:00:00.000Z", state: "new", suggestion: { title: "x", projectId: "p1" } }],
    timer: null,
    automations: [],
    runs: [],
  };
}

export function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, worldId: "w1", projectId: null, title: id, notes: "", status: "todo", day: null, deadline: null, estimate: null, checklist: [], by: "me", createdAt: "2026-10-01T00:00:00.000Z", ...extra };
}

export function auto(extra: Partial<Automation> = {}): Automation {
  return { id: "a1", worldId: "w1", projectId: "p1", title: "Instagram", action: "", times: ["08:00", "20:00"], minutes: 30, days: [1, 3, 5], status: "active", who: "claude", horizon: null, createdAt: "2026-10-01T00:00:00.000Z", ...extra };
}
