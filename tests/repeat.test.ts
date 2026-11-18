import { describe, expect, it } from "vitest";
import { materialize, needsMaterialize, nextRun, setDay } from "../shared/repeat.mjs";
import { auto, state } from "./fixture";

const MON = "2026-10-12", TUE = "2026-10-13";

describe("materialize", () => {
  it("opens one task and block per time on a matching day", () => {
    const s = state();
    s.automations.push(auto());
    expect(materialize(s, MON)).toBe(true);
    const occ = s.tasks.filter((t) => t.autoId === "a1");
    expect(occ.map((t) => t.autoSlot)).toEqual(["08:00", "20:00"]);
    expect(occ.every((t) => t.day === MON && t.projectId === "p1")).toBe(true);
    expect(s.blocks.filter((b) => occ.some((t) => t.id === b.taskId)).map((b) => b.start)).toEqual([`${MON}T08:00`, `${MON}T20:00`]);
  });

  it("opens nothing on other days but still moves the horizon", () => {
    const s = state();
    s.automations.push(auto());
    materialize(s, "2026-10-17");
    expect(s.tasks.some((t) => t.autoId)).toBe(false);
    expect(s.automations[0].horizon).toBe("2026-10-18");
    expect(needsMaterialize(s, "2026-10-17")).toBe(false);
  });

  it("opens tomorrow's tasks a day early so they can be prepared and approved the day before", () => {
    const s = state();
    s.automations.push(auto());
    materialize(s, "2026-10-11");
    expect(s.tasks.filter((t) => t.autoId === "a1").map((t) => t.day)).toEqual([MON, MON]);
    materialize(s, MON);
    expect(s.tasks.filter((t) => t.autoId === "a1")).toHaveLength(2);
  });

  it("does not bring back a deleted occurrence the same day", () => {
    const s = state();
    s.automations.push(auto());
    materialize(s, MON);
    s.tasks = s.tasks.filter((t) => t.autoSlot !== "08:00");
    expect(materialize(s, MON)).toBe(false);
    expect(s.tasks.filter((t) => t.autoId).length).toBe(1);
  });

  it("skips paused automations", () => {
    const s = state();
    s.automations.push(auto({ status: "paused" }));
    expect(materialize(s, MON)).toBe(false);
    expect(s.tasks.some((t) => t.autoId)).toBe(false);
  });

  it("gives the user's own steps as a checklist when a bot prepares", () => {
    const s = state();
    s.automations.push(auto({ steps: [{ id: "x", kind: "text", tool: "claude" }, { id: "y", kind: "post", tool: "me", account: "LinkedIn" }] }));
    materialize(s, MON);
    expect(s.tasks.find((t) => t.autoId)!.checklist.map((c) => c.text)).toEqual(["Share · Me · LinkedIn"]);
  });
});

describe("setDay", () => {
  it("moves future blocks to the new day and keeps the occurrence's own day", () => {
    const s = state();
    s.automations.push(auto());
    materialize(s, MON);
    const t = s.tasks.find((x) => x.autoSlot === "20:00")!;
    setDay(s, t, TUE, MON);
    expect(t.day).toBe(TUE);
    expect(t.autoDay).toBe(MON);
    expect(s.blocks.find((b) => b.taskId === t.id)!.start).toBe(`${TUE}T20:00`);
  });

  it("drops future blocks when the task becomes undated", () => {
    const s = state();
    s.automations.push(auto());
    materialize(s, MON);
    const t = s.tasks.find((x) => x.autoSlot === "20:00")!;
    setDay(s, t, null, MON);
    expect(s.blocks.some((b) => b.taskId === t.id)).toBe(false);
  });
});

describe("nextRun", () => {
  it("finds the next time today, then the next matching day", () => {
    const a = auto();
    expect(nextRun(a, new Date(2026, 9, 12, 9, 0))).toEqual({ day: MON, slot: "20:00" });
    expect(nextRun(a, new Date(2026, 9, 12, 21, 0))).toEqual({ day: "2026-10-14", slot: "08:00" });
  });
});

describe("formatAt", () => {
  it("rotates formats over the automation's runs and stamps each task", async () => {
    const { formatAt } = await import("../shared/repeat.mjs");
    const { taskRef } = await import("../shared/social.mjs");
    // Pzt, Çar, Cum 18:00; sayım 2026-10-12 (Pzt) başlar.
    const a = auto({ days: [1, 3, 5], times: ["18:00"], formats: ["ig_reel", "ig_post"], format: "ig_reel", formatsFrom: MON });
    expect(["2026-10-12", "2026-10-14", "2026-10-16", "2026-10-19"].map((d) => formatAt(a, d, "18:00"))).toEqual(["ig_reel", "ig_post", "ig_reel", "ig_post"]);
    const s = state();
    s.automations.push(a);
    materialize(s, "2026-10-14");
    const t = s.tasks.find((x) => x.autoId === a.id)!;
    expect(t.format).toBe("ig_post");
    expect(taskRef(s, t)?.format).toBe("ig_post");
  });

  it("keeps the single format when no rotation is set", async () => {
    const { formatAt } = await import("../shared/repeat.mjs");
    expect(formatAt(auto({ format: "ig_post" }), MON, "08:00")).toBe("ig_post");
  });
});
