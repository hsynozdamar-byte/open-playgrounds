import { describe, expect, it } from "vitest";
import { applyVersion, pushVersion, VERSION_MAX } from "../shared/versions.mjs";
import type { Run } from "../src/types";

const run = (): Run => ({ id: "r", at: "", title: "t", body: "ilk", status: "ready", images: ["media/a.png"] });

describe("versions", () => {
  it("keeps the old state and skips duplicates", () => {
    const r = run();
    pushVersion(r, "edit");
    pushVersion(r, "edit");
    expect(r.versions).toHaveLength(1);
    r.body = "ikinci";
    pushVersion(r, "render");
    expect(r.versions?.[0].body).toBe("ikinci");
  });
  it("restoring puts the current state into history", () => {
    const r = run();
    pushVersion(r, "edit");
    r.body = "yeni"; r.images = ["media/b.png"];
    applyVersion(r, r.versions![0]);
    expect(r.body).toBe("ilk");
    expect(r.images).toEqual(["media/a.png"]);
    expect(r.versions?.[0]).toMatchObject({ why: "restore", body: "yeni" });
  });
  it("caps the history", () => {
    const r = run();
    for (let i = 0; i < VERSION_MAX + 4; i++) { r.body = `b${i}`; pushVersion(r, "edit"); }
    expect(r.versions).toHaveLength(VERSION_MAX);
  });
});
