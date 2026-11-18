import { describe, expect, it } from "vitest";

// 2026-11-11: site kaydı gerçek zamanlı; tur birden çok sayfayı gezer, biten sayfanın duran kuyruğu videoya girmez.
describe("site recording", () => {
  it("plans a tour over unique http pages within the time limits", async () => {
    const { tourPlan } = await import("../server/record.mjs");
    expect(tourPlan(["https://a.com", "https://a.com", "file:///etc/passwd", "https://a.com/b"], 60)).toEqual({ urls: ["https://a.com", "https://a.com/b"], each: 30 });
    expect(tourPlan(["https://a.com"], 500).each).toBe(90);
    expect(tourPlan(["https://a.com", "https://b.com", "https://c.com"], 5).each).toBe(8);
    expect(tourPlan([], 40).urls).toEqual([]);
  });
  it("drops frames inside cut ranges and holds the last frame only until the cut", async () => {
    const { keptFrames } = await import("../server/record.mjs");
    // kareler 0, 1, 2 (duran sayfa), 10, 11; 3-10 arası atılır
    const k = keptFrames([0, 1, 2, 5, 10, 11], [[3, 10]], 12);
    expect(k.map((x) => x.i)).toEqual([0, 1, 2, 4, 5]);
    expect(k.map((x) => x.d)).toEqual([1, 1, 1, 1, 1]);
    // kuyruk kesimi: son kare kesim anına kadar kalır; duran kare en çok 5 sn
    expect(keptFrames([0, 1], [[2.5, Infinity]], 40).at(-1)).toEqual({ i: 1, d: 1.5 });
    expect(keptFrames([0, 20], [], 21)[0].d).toBe(5);
  });
});
