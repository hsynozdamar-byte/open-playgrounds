import { describe, expect, it } from "vitest";
import { moveProject, projectStats, removeProject, restoreProject, takeProject } from "../src/projectOps";
import { state } from "./fixture";

describe("project delete and move", () => {
  it("deletes a project with its tasks, blocks and sessions, and restores all of it", () => {
    const s = state();
    const snap = takeProject(s, "p1");
    removeProject(s, "p1");
    expect(s.projects).toEqual([]);
    expect(s.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(s.blocks).toEqual([]);
    expect(s.sessions).toEqual([]);
    expect(s.inbox[0].suggestion!.projectId).toBeNull();
    restoreProject(s, snap);
    expect(s.projects.map((p) => p.id)).toEqual(["p1"]);
    expect(s.tasks.length).toBe(2);
    expect(s.blocks.length).toBe(1);
  });

  it("says what goes with the project", () => {
    expect(projectStats(state(), "p1")).toBe("Everything inside goes too: 1 task, 1 focus session. You can undo right after.");
  });

  it("moves a project with its tasks and blocks to another world", () => {
    const s = state();
    moveProject(s, "p1", "home");
    expect(s.projects[0].worldId).toBe("home");
    expect(s.tasks.find((t) => t.id === "t1")!.worldId).toBe("home");
    expect(s.blocks[0].worldId).toBe("home");
  });

  it("ignores a move to a world that doesn't exist", () => {
    const s = state();
    moveProject(s, "p1", "nowhere");
    expect(s.projects[0].worldId).toBe("work");
  });
});
