import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileOf } from "../server/library.mjs";

describe("fileOf", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pg-lib-")));
  fs.mkdirSync(path.join(dir, "brand"));
  fs.writeFileSync(path.join(dir, "brand", "logo.webp"), "x");

  it("reads a site-style key with a leading slash inside the folder", () => {
    expect(fileOf(dir, "/brand/logo.webp")).toBe(path.join(dir, "brand", "logo.webp"));
    expect(fileOf(dir, "brand/logo.webp")).toBe(path.join(dir, "brand", "logo.webp"));
  });

  it("still refuses paths outside the folder", () => {
    expect(fileOf(dir, "/../etc/hosts.png")).toBeNull();
    expect(fileOf(dir, "../x.png")).toBeNull();
  });
});
