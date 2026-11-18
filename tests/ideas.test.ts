import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module
import { cleanIdeas } from "../server/ideas.mjs";

// Öneriler: Rou'nun yazdığı fikirler cleanIdeas'tan geçer.
describe("ideas", () => {
  it("keeps only known fields, http sources and titled ideas", () => {
    const out = cleanIdeas([{ title: " Konu ", brief: "b", why: "w", url: "javascript:alert(1)", extra: "x" }, { brief: "başlıksız" }, "metin", null]);
    expect(out).toEqual([{ title: "Konu", brief: "b", why: "w", trend: "", url: "" }]);
    expect(cleanIdeas("dizi değil")).toEqual([]);
    expect(cleanIdeas(Array.from({ length: 20 }, (_, i) => ({ title: `k${i}` })))).toHaveLength(8);
  });
});
