import { describe, expect, it } from "vitest";
import { find } from "../src/ui/Search";
import { state } from "./fixture";

describe("search", () => {
  it("ignores accents and finds across kinds", () => {
    expect(find(state(), "cafe").map((h) => `${h.kind}:${h.id}`)).toEqual(["task:t1"]);
    expect(find(state(), "photo").map((h) => `${h.kind}:${h.id}`)).toEqual(["task:t1", "note:n1"]);
  });

  it("matches notes and descriptions, not only titles", () => {
    expect(find(state(), "blog").map((h) => h.id)).toEqual(["p1"]);
    expect(find(state(), "morning light").map((h) => h.id)).toEqual(["n1"]);
  });

  it("ranks finished tasks below open ones", () => {
    const s = state();
    s.tasks[1].title = "Café list";
    s.tasks[0].status = "done";
    expect(find(s, "café").map((h) => h.id)).toEqual(["t2", "t1"]);
  });
});
