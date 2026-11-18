import { expect, it } from "vitest";
import { state as fixture } from "./fixture";
import { moveProjectTo, newWorld, SWATCHES } from "../shared/world.mjs";

it("newWorld picks a free id and an unused color", () => {
  const s = fixture();
  const w = newWorld(s, "Side Projects");
  expect(w.id).toBe("side-projects");
  expect(s.worlds.map((x) => x.color)).not.toContain(w.color);
  s.worlds.push(w);
  expect(newWorld(s, "Side Projects").id).toMatch(/^side-projects-/);
  expect(newWorld(s, "all").id).not.toBe("all");
  expect(newWorld(s, "Café Société").id).toBe("cafe-societe");
  expect(SWATCHES).toContain(w.color);
});

it("moveProjectTo takes the project's tasks, blocks and notes", () => {
  const s = fixture();
  s.inbox.push({ ...s.inbox[0], id: "n2", worldId: "work", projectId: "p1" });
  moveProjectTo(s, "p1", "home");
  expect(s.projects[0].worldId).toBe("home");
  expect(s.tasks.find((t) => t.id === "t1")!.worldId).toBe("home");
  expect(s.tasks.find((t) => t.id === "t2")!.worldId).toBe("home");
  expect(s.blocks[0].worldId).toBe("home");
  expect(s.inbox.find((n) => n.id === "n2")!.worldId).toBe("home");
});
