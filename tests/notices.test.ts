import { describe, expect, it } from "vitest";
import { state } from "./fixture";
import type { Run } from "../src/types";
import { MAX, addNotice, noticeCtas, noticeNow, unreadNotices } from "../shared/notices.mjs";

const run = (p: Partial<Run>): Run => ({ id: "r1", taskId: "t1", at: "2026-10-31T10:00:00.000Z", title: "Gönderi", body: "", status: "approved", ...p }) as Run;

describe("bildirimler", () => {
  it("işin başlığını ve dünyasını alır, yeni önce durur", () => {
    const s = state();
    s.runs = [run({})];
    addNotice(s, { kind: "share_failed", runId: "r1", text: "a" });
    const n = addNotice(s, { kind: "posted", runId: "r1" });
    expect(s.notices![0]).toBe(n);
    expect(n).toMatchObject({ taskId: "t1", worldId: "w1", title: "Mağaza görselleri" });
    expect(unreadNotices(s)).toBe(2);
  });

  it("aynı işin okunmamış aynı tür bildirimini yenisiyle değiştirir, sınırı aşmaz", () => {
    const s = state();
    s.runs = [run({})];
    addNotice(s, { kind: "share_failed", runId: "r1", text: "ilk" });
    addNotice(s, { kind: "share_failed", runId: "r1", text: "ikinci" });
    expect(s.notices!.map((n) => n.text)).toEqual(["ikinci"]);
    for (let i = 0; i < MAX + 5; i++) addNotice(s, { kind: "ready", title: `x${i}` });
    expect(s.notices!.length).toBe(MAX);
  });

  it("düğmeler işin şimdiki durumundan gelir", () => {
    const s = state();
    s.runs = [run({})];
    const n = addNotice(s, { kind: "share_failed", runId: "r1" });
    expect(noticeCtas(s, n).map((c) => c.id)).toEqual(["retry", "card"]);
    s.runs[0].publish = { phase: "Rou is sharing", at: "", by: "claude" } as Run["publish"];
    expect(noticeCtas(s, n).map((c) => c.id)).toEqual(["card"]);
    expect(noticeNow(s, n)).toBe("Rou is sharing");
    Object.assign(s.runs[0], { status: "posted", postUrl: "https://x", publish: undefined });
    expect(noticeCtas(s, n).map((c) => c.id)).toEqual(["view", "card"]);
    expect(noticeNow(s, n)).toBe("Shared later");
  });
});
