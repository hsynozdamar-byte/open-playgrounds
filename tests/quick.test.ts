import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addParsed, lateKind, parseQuick } from "../src/lib";
import { task, state } from "./fixture";

beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 9, 12, 9, 0), toFake: ["Date"] }));
afterEach(() => vi.useRealTimers());

describe("quick add", () => {
  it("reads world, project, day, time, duration and deadline from one line", () => {
    const p = parseQuick(state(), "Mağaza görselleri @atö #proje yarın 14:00 1sa !cum", "w2");
    expect(p).toMatchObject({ title: "Mağaza görselleri", worldId: "w1", projectId: "p1", day: "2026-10-13", time: 840, estimate: 60, deadline: "2026-10-16" });
  });

  it("creates a new project when the #name doesn't exist, and a block for the time", () => {
    const s = state();
    const t = addParsed(s, parseQuick(s, "Logo #yeni 10:30 45dk", "w2"))!;
    expect(s.projects.find((p) => p.id === t.projectId)!.name).toBe("yeni");
    expect(t.day).toBe("2026-10-12");
    expect(s.blocks.find((b) => b.taskId === t.id)).toMatchObject({ start: "2026-10-12T10:30", end: "2026-10-12T11:15" });
  });

  it("reads 5.10 as a date and 14.30 as a time", () => {
    expect(parseQuick(state(), "a 5.10", "w2").day).toBe("2027-10-05");
    expect(parseQuick(state(), "a 14.30", "w2").time).toBe(870);
  });
});

describe("lateKind", () => {
  it("prefers a missed deadline over a missed day", () => {
    expect(lateKind(task("x", { day: "2026-10-10", deadline: "2026-10-11" }), "2026-10-12")).toBe("deadline");
    expect(lateKind(task("x", { day: "2026-10-10" }), "2026-10-12")).toBe("day");
    expect(lateKind(task("x", { day: "2026-10-10", status: "done" }), "2026-10-12")).toBeNull();
  });
  it("leaves a date that does not exist in the title instead of storing it", () => {
    const p = parseQuick(state(), "Yazı 31.02", "w1");
    expect(p.day).toBeUndefined();
    expect(p.title).toBe("Yazı 31.02");
    expect(parseQuick(state(), "Yazı 40/13", "w1").day).toBeUndefined();
    expect(parseQuick(state(), "Yazı 5/3", "w1").day).toMatch(/^\d{4}-03-05$/);
  });
});
