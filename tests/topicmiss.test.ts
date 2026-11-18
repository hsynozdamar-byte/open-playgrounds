import { describe, expect, it } from "vitest";
import { stripTopicMiss } from "../server/prepare.mjs";

describe("KONU UYMADI satırı", () => {
  it("metinden sökülür, nedeni ayrı döner", () => {
    const r = { body: "KONU UYMADI: kaynakta yok.\n\nAsıl metin", post: { text: "KONU UYMADI: kaynakta yok.\n\nAsıl metin" } };
    expect(stripTopicMiss(r)).toBe("kaynakta yok.");
    expect(r.post.text).toBe("Asıl metin");
    expect(r.body).toBe("Asıl metin");
  });
  it("satır yoksa dokunmaz", () => {
    const r = { body: "Metin", post: { tweets: ["Bir", "İki"] } };
    expect(stripTopicMiss(r)).toBe("");
    expect(r.post.tweets).toEqual(["Bir", "İki"]);
  });
});
