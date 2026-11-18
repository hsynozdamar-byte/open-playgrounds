import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isHex, seriesColor, seriesRule, tones } from "../shared/series.mjs";

process.env.PG_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "pg-series-"));
process.env.PG_NO_SCHEDULE = "1";
const { kitHash, kitOf, renderAccount } = await import("../server/prepare.mjs");

const kit = { accent: "#ff4fa8", bg: ["#a3defc", "#f59fd8", "#4b5596"] as [string, string, string] };
const s = {
  worlds: [{ id: "w", color: "#7c4dff" }],
  automations: [{ id: "a1", color: "#2D9CF0" }, { id: "a2", color: "mavi" }, { id: "a3", color: "#a64dff" }],
  tasks: [],
};
const acc = { name: "Proje A", handle: "@proje", project: { id: "p", worldId: "w", kit } };

describe("seri rengi (automation.color)", () => {
  it("otomasyonun rengi seri rengidir; tek seferlik gönderi ve geçersiz renk seri rengi taşımaz", () => {
    expect(seriesColor(s, { autoId: "a1" })).toBe("#2d9cf0");
    expect(seriesColor(s, { autoId: "a2" })).toBeUndefined();
    expect(seriesColor(s, { post: { accountId: "x" } })).toBeUndefined();
    expect(isHex("#a64dff")).toBe(true);
    expect(isHex("#fff")).toBe(false);
  });

  it("tones: rengin kendisi ve %30 koyusu", () => {
    expect(tones("#ffffff")).toEqual(["#ffffff", "#b3b3b3"]);
  });

  it("kit vurgusu ve hesap rengi seriden gelir; tek seferlik gönderide kit aynen kalır", () => {
    expect(kitOf(s, acc, { autoId: "a1" })).toEqual({ ...kit, seriesColor: "#2d9cf0" });
    expect(kitOf(s, acc, { post: {} })).toBe(kit);
    expect(kitOf(s, acc, { autoId: "a3" })).toMatchObject({ seriesColor: "#a64dff" });
    expect(renderAccount(s, { autoId: "a1", worldId: "w" }, acc).color).toBe("#2d9cf0");
    expect(renderAccount(s, { worldId: "w" }, acc).color).toBe("#7c4dff");
  });

  it("renk atanınca onay bekleyen eski görseller yeniden çizilmez (kit parmak izi aynı)", () => {
    expect(kitHash(kitOf(s, acc, { autoId: "a1" }))).toBe(kitHash(kit));
  });

  it("prompt kuralı", () => {
    expect(seriesRule("#C8102E")).toBe("Seri rengi: #c8102e, bu serinin bütün kapak ve slaytlarında vurgu bu renk.");
    expect(seriesRule(undefined)).toBe("");
  });
});
