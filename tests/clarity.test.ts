import { describe, expect, it } from "vitest";
import { bansOf, banHits, missingMediaNote, noMediaNote, parseClarity, pastLessons, reviseBlock } from "../shared/revise.mjs";
import { applyPart, canTakePart } from "../shared/versions.mjs";

const rev = (note: string, clear?: object) => ({ at: "2026-11-05T10:00:00Z", note, prev: "", ...(clear ? { clear } : {}) });

describe("revize netleştirme", () => {
  it("JSON'u okur, kısa yasakları atar", () => {
    const c = parseClarity('tamam {"ask":"Raiden Space\'i çıkar","ban":["Raiden Space","ab"],"media":"keep","general":"Haber anlatma"}');
    expect(c).toMatchObject({ ask: "Raiden Space'i çıkar", ban: ["Raiden Space"], media: "keep", general: "Haber anlatma" });
    expect(parseClarity("anlaşılmadı")).toBeNull();
  });
  it("yasak çıktıda aranır; alıntılanan tweet sayılmaz", () => {
    const task = { revisions: [rev("RAIDEN NEDEN VAR", { ask: "Çıkar", keep: [], ban: ["Raiden Space"], media: "any", text: true, visual: false })] };
    expect(bansOf(task)).toEqual(["Raiden Space"]);
    expect(banHits(task, { body: "raiden space yatırım aldı" })).toEqual(["Raiden Space"]);
    expect(banHits(task, { body: "runway", post: { quote: { text: "Raiden Space" } } })).toEqual([]);
    expect(reviseBlock(task as never)).toMatch(/MUST NEVER APPEAR.*Raiden Space/);
  });
  it("medya kararı netleşmiş isteği okur", () => {
    const c = (media: string) => ({ revisions: [rev("x", { ask: "a", keep: [], ban: [], media, text: true, visual: false })] });
    expect(noMediaNote(c("none"))).toBe(true);
    expect(missingMediaNote(c("keep"))).toBe(true);
    expect(missingMediaNote(c("any"))).toBe(false);
  });
  it("başka görevlere yalnız genel ders taşınır", () => {
    const s = { tasks: [
      { id: "a", autoId: "x", revisions: [rev("şu tweeti alıntıla", { ask: "Alıntıla", keep: [], ban: [], media: "any", text: true, visual: false })] },
      { id: "b", autoId: "x", revisions: [rev("playgrounds anlatma", { ask: "a", keep: [], ban: [], media: "any", text: true, visual: false, general: "Playgrounds'u konu yapma" })] },
      { id: "c", autoId: "x" },
    ] };
    expect(pastLessons(s, s.tasks[2])).toEqual(["Playgrounds'u konu yapma"]);
  });
});

describe("sürümden parça alma", () => {
  it("videoyu alır, metni ve alıntıyı korur", () => {
    const run = { id: "r", post: { format: "tweet", tweets: ["yeni"], quote: { url: "u" } }, body: "yeni", video: "media/kart.mp4" } as never;
    const old = { post: { format: "tweet", tweets: ["eski"] }, body: "eski", video: "media/mona.mp4", cover: "media/mona.png" };
    expect(applyPart(run, old, "media")).toBe(true);
    expect(run).toMatchObject({ body: "yeni", video: "media/mona.mp4", cover: "media/mona.png" });
    applyPart(run, old, "text");
    expect(run).toMatchObject({ body: "eski", video: "media/mona.mp4", post: { quote: { url: "u" } } });
  });
  it("Reel'de metin sahnelerden ayrılmaz", () => {
    expect(canTakePart({ post: { format: "ig_reel" } } as never, { post: { format: "ig_reel" } }, "text")).toBe(false);
  });
});

describe("mediaRequired", () => {
  it("is true only when the clarified note asks for visuals", async () => {
    const { mediaRequired } = await import("../shared/revise.mjs");
    const t = (clear: object) => ({ revisions: [{ note: "x", at: "", clear }] }) as never;
    expect(mediaRequired(t({ visual: true, media: "keep" }))).toBe(true);
    expect(mediaRequired(t({ visual: true, media: "new" }))).toBe(true);
    expect(mediaRequired(t({ visual: false, media: "keep" }))).toBe(false);
    expect(mediaRequired(t({ visual: true, media: "none" }))).toBe(false);
    expect(mediaRequired(undefined)).toBe(false);
  });
});

describe("permanent rules from a revision", () => {
  it("parses a group rule and writes it to the named automations of the same world only", async () => {
    const { parseClarity, saveRule } = await import("../shared/revise.mjs");
    const c = parseClarity(JSON.stringify({ ask: "Ürün görüntüsü kullan.", rule: { text: "Ürün gönderilerinde ürünün kendi ekranı görünsün.", autos: ["aa1111", "bb2222", "cc3333"], kind: "visual" } }));
    expect(c?.rule?.text).toBe("Ürün gönderilerinde ürünün kendi ekranı görünsün.");
    const st = { automations: [{ id: "aa1111", worldId: "w1", visual: "- eski kural" }, { id: "bb2222", worldId: "w1" }, { id: "cc3333", worldId: "other" }] } as never as { automations: { id: string; worldId: string; visual?: string }[] };
    expect(saveRule(st, "w1", c!.rule)).toEqual(["aa1111", "bb2222"]);
    expect(st.automations[0].visual).toBe("- eski kural\n- Ürün gönderilerinde ürünün kendi ekranı görünsün.");
    expect(st.automations[1].visual).toBe("- Ürün gönderilerinde ürünün kendi ekranı görünsün.");
    expect(st.automations[2].visual).toBeUndefined();
    expect(saveRule(st, "w1", c!.rule)).toEqual(["aa1111", "bb2222"]);
    expect(st.automations[0].visual?.split("\n").length).toBe(2);
    expect(parseClarity(JSON.stringify({ ask: "x", rule: null }))?.rule).toBeUndefined();
  });
});
