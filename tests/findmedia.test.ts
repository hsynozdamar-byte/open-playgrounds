import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("parseFound", () => {
  it("keeps only this run's files that exist, and passes questions through", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pgfm-"));
    process.env.PG_DATA = dir;
    fs.mkdirSync(path.join(dir, "media"), { recursive: true });
    fs.writeFileSync(path.join(dir, "media", "abc-r0.png"), "x");
    const { parseFound } = await import("../server/findmedia.mjs");
    const ok = parseFound('done {"files":["media/abc-r0.png","media/abc-r1.png","media/zzz-r0.png","/etc/passwd"],"from":"ProjeA/design","note":"ekranlar"}', "abc");
    expect(ok.files).toEqual(["media/abc-r0.png"]);
    expect(ok).not.toHaveProperty("fix");
    // Metin bulunan işle çelişiyorsa soru yerine düzeltme döner.
    expect(parseFound('{"files":["media/abc-r0.png"],"from":"f","note":"n","fix":"üç değil iki versiyon"}', "abc").fix).toBe("üç değil iki versiyon");
    expect(parseFound('{"ask":"Hangisi?","options":["a","b"]}', "abc").ask).toBe("Hangisi?");
    expect(parseFound('{"files":[]}', "abc").error).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// "X gönderilerinde her zaman bir görsel bulunmalı" gibi kalıcı kurallar ilk hazırlıkta da uygulanır.
describe("standing visual rules", () => {
  it("reads 'always a visual' from the saved rule lines", async () => {
    // @ts-expect-error plain ESM module
    const { alwaysMedia, visualRules } = await import("../shared/revise.mjs");
    expect(alwaysMedia("- Görselde web sitesi kaydı kullanma, her zaman oyunun kendi içinden oynanış görüntüsü kullan.\n- X gönderilerinde her zaman bir görsel bulunmalı.")).toBe(true);
    expect(alwaysMedia("- Her gönderiye projenin hareketli bir GIF animasyonunu mutlaka ekle; durağan bir kare GIF yerine geçmez.")).toBe(true);
    expect(alwaysMedia("- Her gönderide görsellerin yanına oyunun içinden akıcı bir gerçek oynanış videosu da ekle.")).toBe(true);
    expect(alwaysMedia("- Her gönderide yalnız bir kapak görseli kullan, başka görsel ekleme.")).toBe(false);
    expect(alwaysMedia("- Görselde web sitesi kaydı kullanma, her zaman oyunun kendi içinden oynanış görüntüsü kullan.")).toBe(false);
    expect(alwaysMedia("- Oyun gönderilerinde arka plan yapay zekâyla çizilmiş bir sahne olsun; gradyan kullanma.")).toBe(false);
    expect(alwaysMedia("- Her videonun sonuna bir kapanış kartı koy.")).toBe(false);
    expect(alwaysMedia("")).toBe(false);
    const s = { automations: [{ id: "a1", worldId: "w1", visual: "- A\n- B" }], worlds: [{ id: "w1", visual: "- B\n- C" }] };
    expect(visualRules(s, { autoId: "a1" })).toBe("- A\n- B\n- C");
  });

  it("uses the user's work hints from settings, with a neutral default", async () => {
    const { workHints } = await import("../server/findmedia.mjs");
    expect(workHints({ settings: { workHints: " videolar ~/Videolar " } })).toBe("videolar ~/Videolar");
    expect(workHints({})).toBe("projenin Medya klasörü ve Bilgi kaynakları");
  });

  it("tells the search where the real work lives, to prefer motion, and passes rules and the topic's source", async () => {
    const { findPrompt } = await import("../server/findmedia.mjs");
    const p = findPrompt({ title: "X gönderisi", topic: { title: "Proje A launch", brief: "", source: "https://example.com/work/proje-a" } }, { tweets: ["metin"] }, "abc", [], "- X gönderilerinde her zaman bir görsel bulunmalı.", { hints: "portfolyo: example.com/work/<slug>" });
    expect(p).toContain("portfolyo: example.com/work/<slug>");
    expect(p).toContain("Konunun kaynağı (önce buraya bak; uygunsa bunu göster): https://example.com/work/proje-a");
    expect(p).toContain("Hareket önce gelir");
    expect(p).toContain("- X gönderilerinde her zaman bir görsel bulunmalı.");
    expect(findPrompt({ title: "t" }, null, "abc")).not.toContain("kalıcı görsel kuralları");
  });
});


describe("findPrompt, ikinci tur", () => {
  it("ilk denemede eksik kalanı isteklerin içinde söyler ve çelişen metin için soru yerine fix ister", async () => {
    const { findPrompt } = await import("../server/findmedia.mjs");
    const task = { title: "X gönderisi", revisions: [{ note: "animasyonu ekle", redo: ["Logo animasyonu video olarak yok"] }] };
    const p = findPrompt(task, { tweets: ["metin"] }, "abc");
    expect(p).toContain("İlk denemede eksik kaldı, bu kez mutlaka yap: Logo animasyonu video olarak yok");
    expect(p).toContain("fix alanına");
    expect(p).toContain('"fix":');
  });
});

// Rou önce işi okur, sonra dosya toplar.
describe("research before writing", () => {
  it("returns the facts Rou learned, and accepts facts alone when the media stays", async () => {
    // Modül bu dosyada daha önce yüklendi: medya klasörü ilk yüklemedeki klasördür.
    process.env.PG_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), "pgfm-"));
    const { MEDIA_DIR } = await import("../server/store.mjs");
    const dir = path.dirname(MEDIA_DIR);
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(path.join(MEDIA_DIR, "abc-r0.png"), "x");
    const { parseFound } = await import("../server/findmedia.mjs");
    const full = parseFound('{"files":["media/abc-r0.png"],"from":"f","note":"n","facts":["Uzman plan yazar, üye uygular.","kısa"]}', "abc");
    expect(full.facts).toEqual(["Uzman plan yazar, üye uygular."]);
    const only = parseFound('{"files":[],"from":"~/Developer/proje","facts":["Diyetisyen haftalık diyet programı yazar."]}', "abc", { factsOnly: true });
    expect(only).toMatchObject({ files: [], facts: ["Diyetisyen haftalık diyet programı yazar."] });
    expect(parseFound('{"files":[]}', "abc", { factsOnly: true }).error).toBeTruthy();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("asks for the work to be read first, names the tour tool and the criticised files", async () => {
    const { findPrompt } = await import("../server/findmedia.mjs");
    const task = { title: "X gönderisi", revisions: [{ at: "2026-11-11T13:41:00Z", note: "bir pt nasil kullanir bir diyetisyen nasil kullanir", clear: { ask: "Rolleri anlat.", keep: [], ban: [], media: "new", text: true, visual: true, need: ["PT, diyetisyen ve üye uygulamayı nasıl kullanıyor?"] } }] };
    const p = findPrompt(task, { text: "eski" }, "abc", [], "", { prev: { video: "media/old-v0.mp4", images: ["media/old-r0.png"], found: { from: "f", note: "üç üye ekranı" } } });
    expect(p).toContain("ÖNCE İŞİ ÖĞREN");
    expect(p).toContain("PT, diyetisyen ve üye uygulamayı nasıl kullanıyor?");
    expect(p).toContain("--tour");
    expect(p).toMatch(/old-v0\.mp4[\s\S]*AYNI dosyaları/);
    expect(p).toContain('"facts"');
    const only = findPrompt(task, { text: "eski" }, "abc", [], "", { factsOnly: true });
    expect(only).toContain("files boş kalsın");
    expect(only).not.toContain("--tour");
  });
});

describe("kapak bento ve carousel sırası", () => {
  it("keeps the order the agent gave when a video sits among images", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pgfm-"));
    process.env.PG_DATA = dir;
    const { parseFound } = await import("../server/findmedia.mjs");
    const { MEDIA_DIR } = await import("../server/store.mjs");
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    for (const f of ["ord-r0.png", "ord-v0.mp4", "ord-r1.png"]) fs.writeFileSync(path.join(MEDIA_DIR, f), "x");
    const f = parseFound('{"files":["media/ord-r0.png","media/ord-v0.mp4","media/ord-r1.png"],"from":"f","note":"n"}', "ord");
    expect(f.order).toEqual(["media/ord-r0.png", "media/ord-v0.mp4", "media/ord-r1.png"]);
    expect(parseFound('{"files":["media/ord-r0.png"],"from":"f","note":"n"}', "ord")).not.toHaveProperty("order");
  });
  it("asks for a bento cover only when a rule or the note wants one", async () => {
    const { findPrompt } = await import("../server/findmedia.mjs");
    const task = { id: "t", title: "Proje A carousel", revisions: [{ at: "a", note: "tasarım yapma", clear: { ask: "İşin kendisini paylaş.", raw: true } }] };
    const post = { format: "ig_post", caption: "x" };
    const withRule = findPrompt(task, post, "ord", [], "- İlk kare markanın kimlik parçalarını toplayan bir bento olsun.", { raw: true });
    expect(withRule).toContain("Kapak bento");
    expect(withRule).not.toContain("kolaj yapma");
    const plain = findPrompt(task, post, "ord", [], "", { raw: true });
    expect(plain).not.toContain("Kapak bento");
    expect(plain).toContain("kolaj yapma");
  });
});

describe("kapak bento hazır alınmaz, beğenilen örnek gösterilir", () => {
  it("points at the newest bento of the same automation and forbids a ready-made one", async () => {
    const { findPrompt, bentoRef } = await import("../server/findmedia.mjs");
    const s = {
      tasks: [{ id: "men", autoId: "a" }, { id: "fea", autoId: "a" }, { id: "oth", autoId: "b" }],
      runs: [
        { id: "o1", taskId: "oth", status: "ready", asIs: true, order: ["media/o1-r0.png"] },
        { id: "m1", taskId: "men", status: "ready", asIs: true, order: ["media/m1-r0.png"] },
        { id: "f1", taskId: "fea", status: "ready", asIs: true, order: ["media/f1-r0.png", "media/f1-v0.mp4"] },
      ],
    };
    const ref = bentoRef(s, s.tasks[0]);
    expect(ref.endsWith("media/f1-r0.png")).toBe(true);
    const p = findPrompt({ id: "men", title: "x", revisions: [{ at: "a", note: "bentoyu iyi yap", clear: { ask: "Bentoyu kendin kur.", raw: true } }] }, { format: "ig_post", caption: "x" }, "ord", [], "", { raw: true, bentoRef: ref });
    expect(p).toContain("HAZIR BENTO KOYMA");
    expect(p).toContain("f1-r0.png");
  });
});
