import { describe, expect, it } from "vitest";
import { postBasis, topicOk } from "../src/postBasis";
import { state } from "./fixture";

describe("elle eklenen gönderinin dayanağı", () => {
  it("konu, proje, marka, hesap tonu ve kullanılan kaynak sayısı", () => {
    const s = state();
    const p = s.projects[0];
    s.worlds.find((w) => w.id === p.worldId)!.accounts = [{ id: "x1", platform: "x", name: "", handle: "@marka", voice: "kısa, esprili" }];
    p.accountIds = ["x1"];
    p.brand = { audience: "tasarımcılar", pillars: [], use: "", avoid: "" };
    p.sources = [{ id: "a", kind: "note", title: "Rehber", body: "..", use: true, addedAt: "" }, { id: "b", kind: "note", title: "Eski", body: "..", use: false, addedAt: "" }];
    const t = { ...s.tasks[0], title: "Yeni sürüm", projectId: p.id, autoId: undefined, post: { accountId: "x1", format: "tweet" as const, brief: "" } };
    expect(postBasis(s, t)).toEqual({ topic: "Yeni sürüm", project: p.name, brand: true, account: "X @marka", voice: "kısa, esprili", sources: 1, auto: "" });
  });

  it("konu en az 3 harf", () => {
    expect(topicOk("X")).toBe(false);
    expect(topicOk("  a b ")).toBe(true);
    expect(topicOk("Yeni")).toBe(true);
  });
});
