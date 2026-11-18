import { describe, expect, it } from "vitest";
import { reviseScope, revisionFiles, revisionMode } from "../shared/revise.mjs";

// Gerçek revize notlarından: yalnız görsel istendiyse metne, yalnız metin istendiyse görsele dokunulmaz.
describe("revize kapsamı", () => {
  it("notun neye dokunduğunu bulur", () => {
    expect(reviseScope("GÖRSEL BERBAT, BUNU DUZEMNELEMN LAIZMDI HALETSNEE")).toEqual({ text: false, visual: true });
    expect(reviseScope("GORSLEI DUZNELESENE FIRMA ALTINDAKI SIRKETLERIN OLDGUU BIR GORSEL OLSU")).toEqual({ text: false, visual: true });
    expect(reviseScope("METIN BERBAT VE UZUN, NEYI ANLATTIN BURADA")).toEqual({ text: true, visual: false });
    expect(reviseScope("video berbat v ekasiyor, splashten sonra markalarin vidolari geliyordu")).toEqual({ text: false, visual: true });
    expect(reviseScope("hic olumlu hissettirmiyor, revize et")).toEqual({ text: true, visual: true });
    // İçerik isteği görsel kelimesiyle gelse de metni değiştirir.
    expect(reviseScope("burada da twitte oldugu gibi oyun icinden bhaseden bir sey laizm 4 adet roldan ve oyundan oyun ic goruntulerle duznele.")).toEqual({ text: true, visual: true });
  });
  it("yalnız son nottan sonra yeni çıktı yoksa revize turu sayılır", () => {
    const task = { id: "t", revisions: [{ at: "2026-11-02T10:00:00Z", note: "metin uzun", runId: "r1" }] };
    const s = { runs: [{ id: "r1", taskId: "t", at: "2026-11-02T09:00:00Z", status: "ready", post: { format: "linkedin", text: "a" } }, { id: "now", taskId: "t", at: "2026-11-02T10:01:00Z", status: "working" }] };
    expect(revisionMode(s, task, "now")?.prev.id).toBe("r1");
    s.runs.push({ id: "r2", taskId: "t", at: "2026-11-02T10:05:00Z", status: "ready", post: { format: "linkedin", text: "b" } });
    expect(revisionMode(s, task, "now")).toBeNull();
  });
});

describe("revize ekleri", () => {
  it("sonraki not görseli eleştirdiyse önceki görsel eki düşer", () => {
    const task = { id: "t", revisions: [
      { at: "1", note: "logo kullan", runId: "a", files: [{ file: "rou-a.png", kind: "image", name: "a.png" }] },
      { at: "2", note: "mock görseli berbat, ince uzun", runId: "b" },
    ] };
    expect(revisionFiles(task as never)).toEqual([]);
    const keep = { id: "t", revisions: [{ at: "1", note: "metin uzun", runId: "a", files: [{ file: "rou-a.png", kind: "image", name: "a.png" }] }] };
    expect(revisionFiles(keep as never).map((f) => f.file)).toEqual(["rou-a.png"]);
  });
});
