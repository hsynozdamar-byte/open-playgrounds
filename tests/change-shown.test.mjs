import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { shownOf } from "../server/change.mjs";

const MEDIA = path.resolve(import.meta.dirname, "..", "data", "media");

describe("shownOf: Rou'nun yaptığı işin görseli sohbette", () => {
  it("GÖSTER satırını metinden çıkarır, dosyayı ve runId'yi ekler", () => {
    const f = "zz-test-cover.png";
    fs.mkdirSync(MEDIA, { recursive: true });
    fs.writeFileSync(path.join(MEDIA, f), "x");
    try {
      const s = { runs: [{ id: "s8ynb4", at: "2026-11-01T00:00:00Z" }] };
      const o = shownOf(`Kapağı yeniledim.\nGÖSTER: ${f}, s8ynb4, yok.png`, null, s);
      expect(o.text).toBe("Kapağı yeniledim.");
      expect(o.extra.files).toEqual([{ file: f, name: f, kind: "image" }]);
      expect(o.extra.show).toEqual(["s8ynb4"]);
    } finally { fs.rmSync(path.join(MEDIA, f)); }
  });
  it("satır yoksa ve dosya yoksa ek koymaz", () => {
    const o = shownOf("Bitti.", null, { runs: [] });
    expect(o).toEqual({ text: "Bitti.", extra: {} });
  });
});
