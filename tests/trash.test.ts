import { describe, expect, it } from "vitest";
import { state as fixture } from "./fixture";
import { blocker, purgeTrash, restoreTrash, toTrash, trashOrigin, trashSummary } from "../shared/trash.mjs";
import { removeProject, takeProject } from "../src/projectOps";

describe("Trash", () => {
  it("a deleted project goes to the trash with its records and comes back", () => {
    const s = fixture();
    const p = s.projects[0];
    const { index: _i, project, ...rest } = takeProject(s, p.id);
    const n = s.tasks.length;
    const gone = rest.tasks.length;
    toTrash(s, "b1", "project", p.name, { projects: [project], ...rest });
    removeProject(s, p.id);
    expect(s.tasks.length).toBe(n - gone);
    expect(trashSummary(s.trash![0])).not.toContain("project");
    expect(restoreTrash(s, "b1")).toBe(true);
    expect(s.projects.some((x) => x.id === p.id)).toBe(true);
    expect(s.tasks.length).toBe(n);
    expect(s.trash).toHaveLength(0);
  });

  it("a task whose world was deleted waits until the world is restored", () => {
    const s = fixture();
    const t = s.tasks[0];
    const w = s.worlds.find((x) => x.id === t.worldId)!;
    toTrash(s, "t", "task", t.title, { tasks: [t] });
    s.tasks = s.tasks.filter((x) => x.id !== t.id);
    toTrash(s, "w", "world", w.name, { worlds: [w] });
    s.worlds = s.worlds.filter((x) => x.id !== w.id);
    expect(blocker(s, s.trash!.find((b) => b.id === "t")!)).toBe(w.name);
    expect(restoreTrash(s, "t")).toBe(false);
    expect(restoreTrash(s, "w")).toBe(true);
    expect(restoreTrash(s, "t")).toBe(true);
  });

  it("items older than 30 days drop out, delete forever removes one", () => {
    const s = fixture();
    s.trash = [{ id: "old", kind: "note", title: "old", at: new Date(Date.now() - 31 * 864e5).toISOString(), recs: {} }];
    toTrash(s, "new", "note", "new", {});
    expect(s.trash.map((b) => b.id)).toEqual(["new"]);
    purgeTrash(s, "new");
    expect(s.trash).toHaveLength(0);
  });
});

it("trashOrigin names world and project, also from trash", () => {
  const s = fixture();
  const t = s.tasks.find((x) => x.projectId)!;
  const w = s.worlds.find((x) => x.id === t.worldId)!;
  const p = s.projects.find((x) => x.id === t.projectId)!;
  toTrash(s, "b1", "task", t.title, { tasks: [t] });
  expect(trashOrigin(s, s.trash![0])).toBe(`${w.name} › ${p.name}`);
  s.projects = s.projects.filter((x) => x.id !== p.id);
  toTrash(s, "b2", "project", p.name, { projects: [p] });
  expect(trashOrigin(s, s.trash![1])).toBe(`${w.name} › ${p.name}`);
});
