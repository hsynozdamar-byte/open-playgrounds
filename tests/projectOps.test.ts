import { describe, expect, it } from "vitest";
import { moveProject, projectStats, removeProject, restoreProject, takeProject } from "../src/projectOps";
import { auto, state } from "./fixture";

describe("project delete and move", () => {
  it("deletes a project with its tasks, blocks, sessions and automations, and restores all of it", () => {
    const s = state();
    s.automations.push(auto());
    const snap = takeProject(s, "p1");
    removeProject(s, "p1");
    expect(s.projects).toEqual([]);
    expect(s.tasks.map((t) => t.id)).toEqual(["t2"]);
    expect(s.blocks).toEqual([]);
    expect(s.sessions).toEqual([]);
    expect(s.automations).toEqual([]);
    expect(s.inbox[0].suggestion!.projectId).toBeNull();
    restoreProject(s, snap);
    expect(s.projects.map((p) => p.id)).toEqual(["p1"]);
    expect(s.tasks.length).toBe(2);
    expect(s.blocks.length).toBe(1);
    expect(s.automations.length).toBe(1);
  });

  it("says what goes with the project", () => {
    expect(projectStats(state(), "p1")).toBe("Everything inside goes too: 1 task, 1 focus session. You can undo right after.");
  });

  it("moves a project with its tasks, blocks and automations to another world", () => {
    const s = state();
    s.automations.push(auto());
    moveProject(s, "p1", "w2");
    expect(s.projects[0].worldId).toBe("w2");
    expect(s.tasks.find((t) => t.id === "t1")!.worldId).toBe("w2");
    expect(s.blocks[0].worldId).toBe("w2");
    expect(s.automations[0].worldId).toBe("w2");
  });

  it("ignores a move to a world that doesn't exist", () => {
    const s = state();
    moveProject(s, "p1", "yok");
    expect(s.projects[0].worldId).toBe("w1");
  });
});
