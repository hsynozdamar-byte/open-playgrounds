import { describe, expect, it } from "vitest";
import { noWarnings } from "../server/claude.mjs";

describe("runClaude hata metni", () => {
  it("claude'un oturum uyarısı hata nedeni sayılmaz", () => {
    expect(noWarnings("Warning: this sign-in ends between 2026-11-21 and 2026-11-24 (in 4 days at the earliest).\n")).toBe("");
    expect(noWarnings("Warning: x\nupload failed")).toBe("upload failed");
  });
});
