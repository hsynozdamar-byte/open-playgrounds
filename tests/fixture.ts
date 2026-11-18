import type { State, Task } from "../src/types";

// A small hand-made state for tests. Real data is never touched.
export function state(): State {
  return {
    version: 3,
    worlds: [
      { id: "work", name: "Work", color: "#3b6cf6", description: "" },
      { id: "home", name: "Home", color: "#ff5b2e", description: "" },
    ],
    projects: [{ id: "p1", worldId: "work", name: "Website", description: "Portfolio with a blog", status: "active", deadline: null }],
    tasks: [task("t1", { projectId: "p1", title: "Café photos", day: "2026-10-12" }), task("t2", { title: "Groceries", worldId: "home" })],
    blocks: [{ id: "b1", taskId: "t1", worldId: "work", title: "", start: "2026-10-12T10:00", end: "2026-10-12T11:00", kind: "plan" }],
    sessions: [{ id: "s1", taskId: "t1", start: "2026-10-12T07:00:00.000Z", end: "2026-10-12T07:30:00.000Z", mode: "free" }],
    inbox: [{ id: "n1", worldId: null, source: "note", from: "", url: "", title: "Photo idea", body: "warm morning light", receivedAt: "2026-10-11T09:00:00.000Z", state: "new", suggestion: { title: "x", projectId: "p1" } }],
    timer: null,
  };
}

export function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, worldId: "work", projectId: null, title: id, notes: "", status: "todo", day: null, deadline: null, estimate: null, checklist: [], by: "me", createdAt: "2026-10-01T00:00:00.000Z", ...extra };
}
