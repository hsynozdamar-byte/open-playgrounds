import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module
import { chunksOf, wordsOf } from "../server/voice.mjs";

describe("sesli Reels altyazısı", () => {
  it("whisper kelime çıktısını okur, boş ve [_BEG_] parçaları atlar", () => {
    const w = wordsOf({ transcription: [{ text: " Kartların", offsets: { from: 0, to: 400 } }, { text: "[_BEG_]", offsets: { from: 0, to: 0 } }, { text: " ", offsets: { from: 400, to: 400 } }, { text: " neden", offsets: { from: 400, to: 700 } }] });
    expect(w).toEqual([{ t: "Kartların", from: 0, to: 400 }, { t: "neden", from: 400, to: 700 }]);
  });
  it("cümle sonunda, uzun sessizlikte ve 4 kelimede yeni parça açar", () => {
    const at = (t: string, from: number) => ({ t, from, to: from + 200 });
    const c = chunksOf([at("Sebebi", 0), at("köşeler.", 200), at("İç", 400), at("içe", 600), at("iki", 800), at("yuvarlak", 1000), at("köşe", 1900)]);
    expect(c.map((x: { words: { t: string }[] }) => x.words.map((w) => w.t).join(" "))).toEqual(["Sebebi köşeler.", "İç içe iki yuvarlak", "köşe"]);
  });
});
