import { describe, expect, it } from "vitest";
import { find } from "../src/ui/Search";
import { state } from "./fixture";

describe("search", () => {
  it("ignores Turkish letters and finds across kinds", () => {
    const hits = find(state(), "gorsel");
    expect(hits.map((h) => `${h.kind}:${h.id}`)).toEqual(["task:t1", "note:n1"]);
  });

  it("matches notes and descriptions, not only titles", () => {
    expect(find(state(), "deneme").map((h) => h.id)).toEqual(["p1"]);
    expect(find(state(), "yeni fikir").map((h) => h.id)).toEqual(["n1"]);
  });

  it("ranks finished tasks below open ones", () => {
    const s = state();
    s.tasks[1].title = "Mağaza listesi";
    s.tasks[0].status = "done";
    expect(find(s, "mağaza").map((h) => h.id)).toEqual(["t2", "t1"]);
  });
});
