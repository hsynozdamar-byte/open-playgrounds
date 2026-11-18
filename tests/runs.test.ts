import { describe, expect, it } from "vitest";
import { runOfTask } from "../src/runs";
import type { Run } from "../src/types";

const run = (id: string, status: Run["status"], taskId = "t1") => ({ id, taskId, status, at: "2026-11-05T00:00:00.000Z", title: id, body: "" }) as Run;

describe("runOfTask", () => {
  it("prefers the posted run over newer drafts", () => {
    expect(runOfTask([run("new", "ready"), run("p", "posted"), run("old", "ready")], "t1")?.id).toBe("p");
  });
  it("falls back to the newest run", () => {
    expect(runOfTask([run("x", "ready", "t2"), run("a", "failed"), run("b", "ready")], "t1")?.id).toBe("a");
    expect(runOfTask([], "t1")).toBeUndefined();
  });
});
