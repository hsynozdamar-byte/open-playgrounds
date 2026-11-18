import { expect, it } from "vitest";
import { state as fixture } from "./fixture";
import { moveProjectTo, newWorld, SWATCHES } from "../shared/world.mjs";

it("newWorld picks a free id and an unused color", () => {
  const s = fixture();
  const w = newWorld(s, "Yan Projeler");
  expect(w.id).toBe("yan-projeler");
  expect(s.worlds.map((x) => x.color)).not.toContain(w.color);
  s.worlds.push(w);
  expect(newWorld(s, "Yan Projeler").id).toMatch(/^yan-projeler-/);
  expect(newWorld(s, "all").id).not.toBe("all");
  expect(SWATCHES).toContain(w.color);
});

it("moveProjectTo takes tasks, blocks, notes and only accounts no other project uses", () => {
  const s = fixture() as any;
  const a1 = { id: "a1", platform: "instagram", name: "IG", handle: "@ig" }, a2 = { id: "a2", platform: "x", name: "X", handle: "@x" };
  s.worlds[0].accounts = [a1, a2];
  s.projects[0].accountIds = ["a1", "a2"];
  s.projects.push({ id: "p2", worldId: "w1", name: "Proje B", description: "", status: "active", deadline: null, accountIds: ["a2"] });
  s.inbox.push({ ...s.inbox[0], id: "n2", worldId: "w1", projectId: "p1" });
  moveProjectTo(s, "p1", "w2");
  expect(s.projects[0].worldId).toBe("w2");
  expect(s.tasks.find((t: any) => t.id === "t1").worldId).toBe("w2");
  expect(s.blocks[0].worldId).toBe("w2");
  expect(s.inbox.find((n: any) => n.id === "n2").worldId).toBe("w2");
  expect(s.worlds[1].accounts.map((a: any) => a.id)).toEqual(["a1"]);
  expect(s.worlds[0].accounts.map((a: any) => a.id)).toEqual(["a2"]);
});
