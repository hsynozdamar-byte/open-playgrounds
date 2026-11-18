import { describe, expect, it } from "vitest";
import { revert } from "../src/store";
import { task, state } from "./fixture";

describe("revert (undo)", () => {
  it("undoes only what the step changed and keeps writes made in between", () => {
    const before = state();
    const after = structuredClone(before);
    after.tasks[0].title = "New title";
    // Meanwhile pg added a task and changed another one.
    const now = structuredClone(after);
    now.tasks.push(task("t9", { by: "Claude Code" }));
    now.tasks[1].status = "done";
    revert(now, after, before);
    expect(now.tasks.find((t) => t.id === "t1")!.title).toBe("Café photos");
    expect(now.tasks.some((t) => t.id === "t9")).toBe(true);
    expect(now.tasks.find((t) => t.id === "t2")!.status).toBe("done");
  });

  it("keeps another writer's change to a different field of the same record", () => {
    const before = state();
    const after = structuredClone(before);
    after.tasks[0].title = "New title";
    // Meanwhile an AI tool changed the status of the same task.
    const now = structuredClone(after);
    now.tasks[0].status = "done";
    revert(now, after, before);
    expect(now.tasks[0].title).toBe("Café photos");
    expect(now.tasks[0].status).toBe("done");
  });

  it("brings a deleted record back and removes an added one", () => {
    const before = state();
    const after = structuredClone(before);
    after.tasks = after.tasks.filter((t) => t.id !== "t2");
    after.inbox.push({ ...after.inbox[0], id: "n2" });
    const now = structuredClone(after);
    revert(now, after, before);
    expect(now.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(now.inbox.map((n) => n.id)).toEqual(["n1"]);
  });

  it("restores the order after worlds are reordered", () => {
    const before = state();
    const after = structuredClone(before);
    after.worlds.reverse();
    const now = structuredClone(after);
    now.worlds.push({ id: "new", name: "New", color: "#000", description: "" });
    revert(now, after, before);
    expect(now.worlds.map((w) => w.id)).toEqual(["work", "home", "new"]);
  });

  it("clears the timer when its task no longer exists", () => {
    const before = state();
    const after = structuredClone(before);
    after.tasks.push(task("t3"));
    after.timer = { taskId: "t3", startedAt: "2026-10-12T08:00:00.000Z", mode: "free", phase: "focus", length: 0, round: 1 };
    const now = structuredClone(after);
    revert(now, after, before);
    expect(now.timer).toBeNull();
  });
});

describe("stable ids", () => {
  it("gives a change the same ids every time it is applied", async () => {
    const { stable, uid } = await import("../src/store");
    const add = stable((s) => void s.inbox.push({ ...s.inbox[0], id: uid() }));
    const a = state(), b = state();
    add(a); add(b);
    expect(a.inbox.at(-1)!.id).toBe(b.inbox.at(-1)!.id);
    // An unwrapped call makes a new id every time.
    expect(uid()).not.toBe(uid());
    // Undo: the record added on the copy is found in the data by the same id and removed.
    const before = state(), after = state(), live = state();
    add(after); add(live);
    revert(live, after, before);
    expect(live.inbox.map((n) => n.id)).toEqual(["n1"]);
  });
});
