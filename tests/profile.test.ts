import { describe, expect, it } from "vitest";
import { state } from "./fixture";
import { profileStats } from "../src/profileStats";

describe("profileStats", () => {
  it("counts focus, done, streak and per-world time in the period", () => {
    const s = state();
    s.tasks[0].status = "done"; s.tasks[0].doneAt = "2026-10-12T12:00:00.000Z"; s.tasks[0].deadline = "2026-10-13";
    const r = profileStats(s, 7, "2026-10-12");
    expect(r.focus).toBe(30);
    expect(r.done).toBe(1);
    expect(r.onTime).toBe(100);
    expect(r.streak).toBe(1);
    expect(r.worlds[0].w.id).toBe("work");
    expect(r.worlds[0].min).toBe(30);
    expect(r.projects[0].p.id).toBe("p1");
    expect(r.chart).toHaveLength(7);
    expect(r.chart.at(-1)!.min).toBe(30);
  });
  it("leaves old sessions out of the period", () => {
    const r = profileStats(state(), 7, "2026-11-30");
    expect(r.focus).toBe(0);
    expect(r.streak).toBe(0);
    expect(r.peak).toBeNull();
  });
});
