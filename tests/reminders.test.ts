import { describe, expect, it } from "vitest";
import { dueBlocks } from "../src/ui/useReminders";
import { state } from "./fixture";

describe("reminders", () => {
  it("finds a block that started within the last 10 minutes", () => {
    const s = state(); // b1: 2026-10-12 10:00
    expect(dueBlocks(s, new Date(2026, 9, 12, 9, 59)).length).toBe(0);
    expect(dueBlocks(s, new Date(2026, 9, 12, 10, 0)).map((b) => b.id)).toEqual(["b1"]);
    expect(dueBlocks(s, new Date(2026, 9, 12, 10, 9)).length).toBe(1);
    expect(dueBlocks(s, new Date(2026, 9, 12, 10, 11)).length).toBe(0);
  });

  it("skips finished tasks and the task already on the timer", () => {
    const at = new Date(2026, 9, 12, 10, 1);
    const s = state();
    s.timer = { taskId: "t1", startedAt: "", mode: "free", phase: "focus", length: 0, round: 1 };
    expect(dueBlocks(s, at).length).toBe(0);
    const d = state();
    d.tasks[0].status = "done";
    expect(dueBlocks(d, at).length).toBe(0);
  });
});
