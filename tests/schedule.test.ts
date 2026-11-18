import { describe, expect, it } from "vitest";
import { dueNow } from "../server/schedule.mjs";

// Zamanlayıcı: bugünün açık otomasyon işlerinden hangileri şimdi hazırlanmalı.
const at = (hm: string) => new Date(`2026-10-27T${hm}:00`);
const state = (extra: Record<string, unknown> = {}) => ({
  automations: [
    { id: "c", who: "claude", status: "active" },
    { id: "m", who: "me", status: "active" },
    { id: "p", who: "claude", status: "paused" },
  ],
  tasks: [
    { id: "c1", autoId: "c", autoSlot: "10:00", day: "2026-10-27", autoDay: "2026-10-27", status: "todo" },
    { id: "c2", autoId: "c", autoSlot: "", day: "2026-10-27", autoDay: "2026-10-27", status: "todo" },
    { id: "m1", autoId: "m", autoSlot: "", day: "2026-10-27", status: "todo" },
    { id: "p1", autoId: "p", autoSlot: "", day: "2026-10-27", status: "todo" },
    { id: "old", autoId: "c", autoSlot: "", day: "2026-10-26", status: "todo" },
  ],
  runs: [],
  ...extra,
});

describe("zamanlayıcı", () => {
  it("Rou'nun yarınki işini bugün 12:00'den sonra hazırlar; ahead false olan kendi gününü bekler", () => {
    const s = state();
    s.automations.push({ id: "n", who: "claude", status: "active", ahead: false } as never);
    s.tasks.push({ id: "t1", autoId: "c", autoSlot: "09:30", day: "2026-10-28", autoDay: "2026-10-28", status: "todo" }, { id: "t2", autoId: "n", autoSlot: "09:30", day: "2026-10-28", autoDay: "2026-10-28", status: "todo" } as never);
    expect(dueNow(s, at("11:59")).claude).not.toContain("t1");
    expect(dueNow(s, at("12:00")).claude).toContain("t1");
    expect(dueNow(s, at("23:00")).claude).not.toContain("t2");
  });

  it("saatinden bir saat önce, saatsizi 07:00'den sonra hazırlar", () => {
    expect(dueNow(state(), at("06:30"))).toEqual({ claude: [], chrome: [] });
    expect(dueNow(state(), at("08:10"))).toEqual({ claude: ["c2"], chrome: [] });
    expect(dueNow(state(), at("09:00"))).toEqual({ claude: ["c1", "c2"], chrome: [] });
  });
  it("hazırlanmış, gönderilmiş, bitmiş ya da başka güne taşınmış işi atlar", () => {
    const s = state({ runs: [{ taskId: "c1", status: "failed" }] });
    (s.tasks as { id: string; status?: string; day?: string }[]).forEach((t) => {
      if (t.id === "c2") t.day = "2026-10-28";
    });
    expect(dueNow(s, at("12:00"))).toEqual({ claude: [], chrome: [] });
  });
  it("Rou'ya atanmış tek işi günü gelince başlatır", () => {
    const s = state({
      tasks: [
        { id: "r1", who: "claude", day: "2026-10-27", status: "todo" },
        { id: "r2", who: "claude", day: "2026-10-27", status: "todo" },
        { id: "o1", who: "claude", day: "2026-10-26", status: "todo" },
        { id: "n1", who: "claude", day: null, status: "todo" },
        { id: "f1", who: "claude", day: "2026-10-28", status: "todo" },
        { id: "me", day: "2026-10-27", status: "todo" },
      ],
      blocks: [{ taskId: "r2", start: "2026-10-27T15:00", end: "2026-10-27T16:00" }],
    });
    expect(dueNow(s, at("06:00"))).toEqual({ claude: ["o1"], chrome: [] });
    expect(dueNow(s, at("08:00"))).toEqual({ claude: ["r1", "o1"], chrome: [] });
    expect(dueNow(s, at("14:00"))).toEqual({ claude: ["r1", "r2", "o1"], chrome: [] });
  });

  it("Rou'nun Chrome işini plansız, doğrudan yürüyenlere ayırır", () => {
    const s = state({ tasks: [
      { id: "c1", who: "claude", day: "2026-10-27", status: "todo", title: "LinkedIn sayfasını Chrome ile kur" },
      { id: "c2", who: "claude", day: "2026-10-27", status: "todo", title: "Form", browser: { id: "x", name: "Mac" } },
      { id: "w1", who: "claude", day: "2026-10-27", status: "todo", title: "Yazı yaz" },
    ] });
    expect(dueNow(s, at("08:00"))).toEqual({ claude: ["w1"], chrome: ["c1", "c2"] });
  });
});

describe("düşen işi yeniden deneme", () => {
  const failed = (at: string, err = "Tasarım denetimi geçmedi (6/10)") => ({ id: at, taskId: "c2", at: `2026-10-27T${at}:00`, status: "failed", renderError: err });
  it("son deneme düştüyse 20 dk sonra yeniden hazırlar, günde en çok 3 kez", () => {
    expect(dueNow(state({ runs: [failed("08:00")] }), at("08:10")).claude).not.toContain("c2");
    expect(dueNow(state({ runs: [failed("08:00")] }), at("08:30")).claude).toContain("c2");
    expect(dueNow(state({ runs: [failed("07:00"), failed("07:30"), failed("08:00")] }), at("09:00")).claude).not.toContain("c2");
  });
  it("kullanıcının elinin gerektiği hatada ve hazır çıktıda denemez", () => {
    expect(dueNow(state({ runs: [failed("08:00", "Rou soruyor: hangi video?")] }), at("09:00")).claude).not.toContain("c2");
    expect(dueNow(state({ runs: [{ ...failed("08:00"), status: "ready" }] }), at("09:00")).claude).not.toContain("c2");
  });
});
