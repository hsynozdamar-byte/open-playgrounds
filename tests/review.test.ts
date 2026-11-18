import { afterEach, describe, expect, it, vi } from "vitest";
import { moveLeft, weekReview } from "../src/ui/WeekReview";
import { task, state } from "./fixture";

const MON = "2026-10-12";

describe("weekly review", () => {
  afterEach(() => void vi.useRealTimers());

  it("sums planned and worked time per world, and lists done, missed and left", () => {
    const s = state();
    s.tasks.push(task("t3", { day: "2026-10-13", deadline: "2026-10-13" }));
    s.tasks.push(task("t4", { status: "done", doneAt: new Date(2026, 9, 14, 12).toISOString() }));
    s.tasks.push(task("t5", { day: "2026-10-14", autoId: "a1" }));
    const r = weekReview(s, "all", MON, "2026-10-15");
    expect(r.worlds.map((w) => [w.w.id, w.planned, w.worked])).toEqual([["w1", 60, 30]]);
    expect(r.done.map((t) => t.id)).toEqual(["t4"]);
    expect(r.missed.map((t) => t.id)).toEqual(["t3"]);
    // Otomasyon işi kendi kendine açılır; taşınmaz.
    expect(r.left.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("moves what's left to next Monday together with its future blocks", () => {
    // Yalnız gelecekteki bloklar taşınır: saati haftanın başına sabitle.
    vi.useFakeTimers({ now: new Date(2026, 9, 12, 8) });
    const s = state();
    moveLeft(s, ["t1"], "2026-10-19");
    expect(s.tasks[0].day).toBe("2026-10-19");
    expect(s.blocks[0].start.slice(0, 10)).toBe("2026-10-19");
  });

  it("filters by world", () => {
    expect(weekReview(state(), "w2", MON).worlds).toEqual([]);
  });
});
