import { describe, expect, it } from "vitest";
import { addRevision, reviseBlock, revisionsOf, splitGaps } from "../shared/revise.mjs";
import type { Task } from "../src/types";

const task = () => ({ id: "t1", title: "X" }) as unknown as Task;

describe("revizeler", () => {
  it("her notu saklar, sıradakini task.revise'a yazar", () => {
    const t = task();
    addRevision(t, { note: "daha kısa", prev: "v1", runId: "r1" });
    addRevision(t, { note: "bağlantı ekle", prev: "v2", runId: "r2", pending: true });
    expect(revisionsOf(t).map((r) => r.note)).toEqual(["daha kısa", "bağlantı ekle"]);
    expect(t.revise).toMatchObject({ note: "bağlantı ekle", prev: "v2", pending: true });
  });
  it("Rou'ya tüm notları ve son çıktıyı verir", () => {
    const t = task();
    addRevision(t, { note: "daha kısa", prev: "v1" });
    addRevision(t, { note: "bağlantı ekle", prev: "v2" });
    const b = reviseBlock(t);
    expect(b).toContain("1. ");
    expect(b).toContain("daha kısa");
    expect(b).toContain("(EN SON): bağlantı ekle");
    expect(b).toContain('"""\nv2\n"""');
  });
  it("YAPILAMADI satırlarını çıktıdan ayırır", () => {
    const { text, gaps } = splitGaps('{"text":"a"}\nYAPILAMADI: video ekle | tweet biçimi video taşımıyor\n- YAPILAMADI: link');
    expect(text).toBe('{"text":"a"}');
    expect(gaps).toEqual([{ ask: "video ekle", why: "tweet biçimi video taşımıyor" }, { ask: "link", why: "" }]);
  });
});

describe("revize ekleri", () => {
  it("dosyalar revizede saklanır, Rou'ya iletilir ve tekrarsız toplanır", async () => {
    const { addRevision, reviseBlock, revisionFiles } = await import("../shared/revise.mjs");
    const t: Record<string, unknown> = {};
    expect(addRevision(t, { note: "", files: [{ file: "rou-a.png", kind: "image" }] })?.note).toContain("dosyaları kullan");
    addRevision(t, { note: "video bu olsun", files: [{ file: "rou-v.mp4", kind: "video" }, { file: "rou-a.png", kind: "image" }] });
    expect(revisionFiles(t).map((f: { file: string }) => f.file)).toEqual(["rou-a.png", "rou-v.mp4"]);
    expect(reviseBlock(t)).toContain("video data/media/rou-v.mp4");
  });
});

describe("revize denetimi", () => {
  it("denetçinin eksik listesini okur: nesne ya da düz dizgi, en çok 4, part varsayılanı metin", async () => {
    const { parseMissed } = await import("../shared/revise.mjs");
    expect(parseMissed('tamam {"missing":[{"what":"videoyu ekle","part":"media"},"siteyi sona yaz",{"what":""},{"what":"a","part":"x"},{"what":"b"},{"what":"c"}]}')).toEqual([
      { what: "videoyu ekle", part: "media" }, { what: "siteyi sona yaz", part: "text" }, { what: "a", part: "text" }, { what: "b", part: "text" },
    ]);
    expect(parseMissed('{"missing":[]}')).toEqual([]);
    expect(parseMissed("bozuk {")).toEqual([]);
    expect(parseMissed(undefined)).toEqual([]);
  });
  it("ikinci tur: asıl not ve netleştirmesi kalır, eksikler Rou'ya ayrıca söylenir, yalnız eksik taraf yapılır", async () => {
    const { addRevision, redoScope, redoTask, reviseBlock, revisionsOf } = await import("../shared/revise.mjs");
    const t = task();
    addRevision(t, { note: "daha kısa", prev: "v1", runId: "r1" });
    addRevision(t, { note: "animasyonu ekle", prev: "v2", runId: "r2" });
    (t.revisions!.at(-1) as Record<string, unknown>).clear = { ask: "Logo animasyonunu video olarak ekle.", keep: [], ban: [], media: "new", text: false, visual: true };
    const missed = [{ what: "Logo animasyonu video olarak yok, durağan görsel var", part: "media" as const }];
    const t2 = redoTask(t, missed);
    expect(revisionsOf(t2)).toHaveLength(2);
    expect(revisionsOf(t2).at(-1)).toMatchObject({ note: "animasyonu ekle", runId: "r2", clear: { media: "new" } });
    expect(revisionsOf(t).at(-1)).not.toHaveProperty("redo");
    expect(reviseBlock(t2)).toContain("İLK DENEMEDE EKSİK KALDI");
    expect(reviseBlock(t2)).toContain("- Logo animasyonu video olarak yok, durağan görsel var");
    expect(reviseBlock(t)).not.toContain("İLK DENEMEDE EKSİK KALDI");
    expect(redoScope(missed)).toEqual({ text: false, visual: true });
    expect(redoScope([{ what: "siteyi yaz", part: "text" }])).toEqual({ text: true, visual: false });
  });
});

// Netleştirme önceki çıktının görsellerini ve iş adlarını görür, öğrenilecekleri (need) yazar.
describe("revize notunu anlama", () => {
  it("gives the clarifier the output's media and the work names", async () => {
    // @ts-expect-error plain ESM module
    const { clarifyPrompt, parseClarity } = await import("../shared/revise.mjs");
    const task = { title: "X gönderisi", revisions: [{ at: "2026-11-11T12:04:00Z", note: "mark akimligi tasarimlairmi portfloyoda derledim deyip siteyi bastan sona bi gezdirebiliriz", prev: "" }] };
    const p = clarifyPrompt(task, { prevText: "eski metin", prevMedia: "a-v0.mp4 · example.com/work açılış kaydı", names: ["Proje A", "Proje B"] });
    expect(p).toContain("a-v0.mp4 · example.com/work açılış kaydı");
    expect(p).toContain("Proje A, Proje B");
    expect(p).toContain("media new");
    expect(p).toContain('"need"');
    expect(clarifyPrompt(task, {})).toContain("görselleri/videosu: yok");
    const c = parseClarity('{"ask":"Siteyi baştan sona gezdiren video ekle.","keep":[],"ban":[],"media":"new","text":true,"visual":true,"need":["Proje A sitesinde hangi bölümler var?","x"]}');
    expect(c.need).toEqual(["Proje A sitesinde hangi bölümler var?"]);
    expect(parseClarity('{"ask":"Kısalt.","media":"any","text":true,"visual":false,"need":[]}')).not.toHaveProperty("need");
  });
});

// Talimat bir örneği anlat diyorsa ve not başka şey istiyorsa okuyucu talimatı yeniden yazar.
describe("revize talimatı düzeltir", () => {
  it("shows the brief to the reader and replaces it when the reader rewrites it", async () => {
    // @ts-expect-error plain ESM module
    const { clarifyPrompt, parseClarity, setBrief, briefOf } = await import("../shared/revise.mjs");
    const task = { title: "Bölüm motoru", post: { brief: "Level 17 örneğini anlat." }, revisions: [{ at: "a", note: "motor hakkında ne yazmışsın, level 17 ne" }] };
    const p = clarifyPrompt(task, {});
    expect(p).toContain("Level 17 örneğini anlat.");
    expect(p).toContain("'X ne alaka'");
    const c = parseClarity('{"ask":"Motoru anlat.","ban":["Level 17"],"media":"new","brief":"Bölüm motorunun nasıl çalıştığını anlat: üretim, çözücü, ret kuralları."}');
    expect(c.ban).toEqual(["Level 17"]);
    expect(setBrief(task, task.revisions[0], c.brief)).toBe(true);
    expect(briefOf(task)).toContain("Bölüm motorunun");
    expect((task.revisions[0] as { prevBrief?: string }).prevBrief).toBe("Level 17 örneğini anlat.");
    expect(parseClarity('{"ask":"Kısalt.","brief":null}')).not.toHaveProperty("brief");
  });
});

describe("yasak metne aittir", () => {
  it("görsel değişmiyorsa yasak metni yeniden yazdırır", async () => {
    const { parseClarity } = await import("../shared/revise.mjs");
    const c = parseClarity('{"ask":"Logoya anlam yükleyen hikâyeli cümle olmasın","ban":["kelebek","wings"],"media":"keep","text":false,"visual":false}');
    expect(c?.text).toBe(true);
  });
});
