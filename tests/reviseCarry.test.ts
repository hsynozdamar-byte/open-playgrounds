import { describe, expect, it } from "vitest";
import { asksMedia, carrySource, missingMediaNote, noMediaNote, quoteNote, splitGaps } from "../shared/revise.mjs";

const t = (note: string) => ({ revisions: [{ at: "2026-11-05T10:00:00Z", note }] });

describe("revize ekleri taşıma", () => {
  it("alıntı notu eksiz demek değil, yalnız metin notu eksiz", () => {
    expect(quoteNote(t("bu bağlantıya alıntı olarak paylaşacağız"))).toBe(true);
    expect(noMediaNote(t("bu bağlantıya alıntı olarak paylaşacağız"))).toBe(false);
    expect(noMediaNote(t("sadece metin olsun"))).toBe(true);
    expect(noMediaNote(t("videosuz paylaş"))).toBe(true);
  });

  it("konu olarak geçen alıntı kartları alıntı gönderi isteği değil", () => {
    expect(quoteNote(t("Quote ve insight kartları kısmını koru. Paket açılış videosunu ekle."))).toBe(false);
    expect(quoteNote(t("proje için alıntı kartlarını anlat"))).toBe(false);
    expect(quoteNote(t("bunu alıntıla"))).toBe(true);
    expect(quoteNote(t("video eksik, alintiyi dogru yapman lazimdi."))).toBe(true);
    expect(quoteNote(t("quote tweet olarak at"))).toBe(true);
  });

  it("not açıkça görsel/animasyon ekletiyorsa netleştirme ne derse desin görsel aranır", () => {
    expect(asksMedia(t("proje icin paket acilis animasyonunu da ekler misin."))).toBe(true);
    expect(asksMedia(t("Projenin paket açılış (pack-opening) animasyon videosunu gönderiye ekle."))).toBe(true);
    expect(asksMedia(t("ekran kaydı olsun"))).toBe(true);
    expect(asksMedia(t("görseli değiştir, daha sade olsun"))).toBe(false);
    expect(asksMedia(t("metni kısalt"))).toBe(false);
    expect(asksMedia(t("videoyu kaldır, sadece metin"))).toBe(false);
  });

  it("video eksik notu var olan videoyu ister", () => {
    expect(missingMediaNote(t("video eksik, alintiyi dogru yapman lazimdi."))).toBe(true);
    expect(missingMediaNote(t("berbat bir sey bu vidoe bile yok"))).toBe(true);
    expect(missingMediaNote(t("görseli değiştir, daha sade olsun"))).toBe(false);
  });

  it("önceki çıktıda ek yoksa işin en yeni ekli çıktısı seçilir", () => {
    const runs = [
      { id: "new", taskId: "a", at: "2026-11-05T12:00:00Z" },
      { id: "prev", taskId: "a", at: "2026-11-05T11:30:00Z" },
      { id: "v2", taskId: "a", at: "2026-11-05T11:05:00Z", video: "media/v2.mp4", images: ["media/v2.jpg"] },
      { id: "v1", taskId: "a", at: "2026-11-05T10:57:00Z", video: "media/v1.mp4" },
      { id: "other", taskId: "b", at: "2026-11-05T13:00:00Z", video: "media/o.mp4" },
    ];
    expect(carrySource(runs, "a", runs[1], "new")?.id).toBe("v2");
    expect(carrySource(runs, "a", runs[3], "new")?.id).toBe("v1");
    expect(carrySource(runs, "c", null, "new")).toBeNull();
  });

  it("YAPILAMADI satırları metinden ayrılır", () => {
    const { text, gaps } = splitGaps('{"tweets":["Bu etkileşimi bir sanat koleksiyonu için kullansak?"]}\n\nYAPILAMADI: Video ekleme | Video dosyası sağlanmadı.');
    expect(JSON.parse(text).tweets[0]).toBe("Bu etkileşimi bir sanat koleksiyonu için kullansak?");
    expect(gaps).toHaveLength(1);
  });
});
