import { describe, expect, it } from "vitest";
import { gate } from "../server/quality.mjs";

describe("onay kapısı", () => {
  it("iç not kalan metni geçirmez", () => {
    expect(gate({ body: "KONU UYMADI: yok\n\nMetin", post: { text: "KONU UYMADI: yok\n\nMetin" } }).failed).toContain("note");
  });
  it("olmayan medya dosyasını geçirmez", () => {
    expect(gate({ body: "Metin", images: ["media/yok-boyle-bir-dosya.png"] }).failed).toContain("file");
  });
  it("görüntüsüz şablon kartı geçirmez", () => {
    expect(gate({ body: "Metin", attach: { format: "ig_post", slides: [{ title: "Başlık", text: "Yazı", image: "yok" }] } }, ["projeyok"]).failed).toContain("blank");
  });
  it("revizede istenen GIF yoksa geçirmez", () => {
    const task = { revisions: [{ note: "logo animasyonunu gif olarak da ekle" }] };
    expect(gate({ body: "Metin", post: { text: "Metin" } }, [], task).failed).toContain("asked");
    expect(gate({ body: "Metin", post: { text: "Metin" }, images: ["media/x.gif"] }, [], task).failed ?? []).not.toContain("asked");
  });
  it("videoyu kaldırmak isteyen revizede video aramaz", () => {
    const clear = { ask: "Gönderinin başındaki videoyu (p9xkai-v0.mp4, sürüm 17'nin inceleme kaydı) çıkar, yerine başka bir video koyma.", media: "keep" };
    expect(gate({ body: "Metin", post: { text: "Metin" } }, [], { revisions: [{ note: "ilk vidoe cok sacma ne gerke var?", clear }] }).failed ?? []).not.toContain("asked");
    expect(gate({ body: "Metin", post: { text: "Metin" } }, [], { revisions: [{ note: "ilk video çok saçma, ne gerek var?" }] }).failed ?? []).not.toContain("asked");
    expect(gate({ body: "Metin", post: { text: "Metin" } }, [], { revisions: [{ note: "x", clear: { ask: "Oynanış videosu ekle", media: "new" } }] }).failed).toContain("asked");
  });
  it("bilye kaydırma kayıt isteği sayılmaz", () => {
    const clear = { ask: "Motoru anlat. Çok bilyeli tahtada ilk kaydırmada deliğe düşen bilye varsa tahta atılıyor.", media: "new" };
    expect(gate({ body: "Metin", post: { text: "Metin" } }, [], { revisions: [{ note: "x", clear }] }).failed ?? []).not.toContain("asked");
    expect(gate({ body: "Metin", post: { text: "Metin" } }, [], { revisions: [{ note: "x", clear: { ask: "Sitenin kaydını ekle", media: "new" } }] }).failed).toContain("asked");
  });
  it("düzgün metin gönderisini geçirir", () => {
    expect(gate({ body: "Metin", post: { text: "Metin" } })).toEqual({ ok: true });
  });
});
