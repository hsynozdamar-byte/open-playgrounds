import { afterEach, describe, expect, it, vi } from "vitest";
import { elapsed, pause, resume, stop, toBreak } from "../src/timer";
import type { State } from "../src/types";
import { state } from "./fixture";

const T0 = new Date("2026-11-10T09:00:00.000Z").getTime();
const at = (sec: number) => vi.setSystemTime(T0 + sec * 1000);
const run = (s: State) => (fn: (s: State) => void) => fn(s);
const begin = (mode: "free" | "pomo") => {
  vi.useFakeTimers();
  at(0);
  const s = state();
  s.sessions = [];
  s.timer = { taskId: "t1", startedAt: new Date(T0).toISOString(), mode, phase: "focus", length: mode === "pomo" ? 25 : 0, round: 1 };
  return s;
};
const seconds = (s: State) => s.sessions.reduce((n, x) => n + (new Date(x.end).getTime() - new Date(x.start).getTime()) / 1000, 0);

afterEach(() => vi.useRealTimers());

describe("timer", () => {
  it("keeps short stretches between pauses instead of dropping them", () => {
    const s = begin("free");
    at(50); pause(run(s));
    expect(s.sessions).toHaveLength(0);
    at(100); resume(run(s));
    at(150); stop(run(s));
    // 50 s + 50 s of work: written as one session.
    expect(seconds(s)).toBe(100);
    expect(s.timer).toBeNull();
  });

  it("does not count a recorded stretch twice", () => {
    const s = begin("free");
    at(120); pause(run(s));
    expect(seconds(s)).toBe(120);
    expect(s.timer!.carry).toBeUndefined();
    at(200); resume(run(s));
    at(290); stop(run(s));
    expect(seconds(s)).toBe(210);
  });

  it("starts the break from zero after a pause in the focus phase", () => {
    const s = begin("pomo");
    at(600); pause(run(s));
    at(700); resume(run(s));
    at(1600); toBreak(run(s));
    expect(s.timer!.phase).toBe("break");
    expect(s.timer!.base).toBeUndefined();
    expect(s.timer!.pausedAt).toBeUndefined();
    expect(elapsed(s.timer!, T0 + 1630 * 1000)).toBe(30);
  });
});
