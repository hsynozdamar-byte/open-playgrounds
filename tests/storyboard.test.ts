import { describe, expect, it } from "vitest";
import { alignBeats, contrast, normalizeStoryboard, scriptOf } from "../shared/storyboard.mjs";

describe("video senaryosu", () => {
  it("geçersiz görüntüyü başlığa çevirir, ölçüleri sınırlar, ekran yazısını 8 kelimeye keser", () => {
    const sb = normalizeStoryboard({ beats: [
      { say: "Kartların neden yamuk?", text: "bir iki üç dört beş altı yedi sekiz dokuz", visual: { kind: "uydurma" } },
      { say: "Sebebi köşeler.", text: "Köşe", visual: { kind: "card", from: { radius: 200 }, to: { radius: 24 }, marks: ["radius", "x"] } },
      { say: "Sayfaya bak.", visual: { kind: "screen", url: "javascript:alert(1)" } },
    ] })!;
    expect(sb.beats[0].text.split(" ")).toHaveLength(8);
    expect(sb.beats[0].visual.kind).toBe("title");
    expect(sb.beats[1].visual).toMatchObject({ kind: "card", from: { radius: 64 }, to: { radius: 24 }, marks: ["radius"] });
    expect(sb.beats[2].visual.kind).toBe("title");
    expect(scriptOf(sb)).toContain("**2. Köşe**\nSebebi köşeler.");
  });
  it("tek sahnelik senaryo kabul edilmez", () => {
    expect(normalizeStoryboard({ beats: [{ say: "Tek" }] })).toBeNull();
  });
  it("sahneleri sesteki cümleye oturtur; bulunamayanı araya koyar", () => {
    const words = "kartların neden yamuk sebebi köşeler kural basit dış radius".split(" ").map((t, i) => ({ t, from: i * 500, to: i * 500 + 400 }));
    const beats = [{ say: "Kartların neden yamuk?" }, { say: "Sebebi köşeler." }, { say: "Hiç söylenmedi bu." }, { say: "Kural basit: dış radius." }] as never;
    const at = alignBeats(beats, words);
    expect(at[0]).toBe(0);
    expect(at[1]).toBe(1500);
    expect(at[3]).toBe(2500);
    expect(at[2]).toBeGreaterThan(at[1]);
  });
  it("kontrast oranı WCAG'e göre", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 0);
  });
});
