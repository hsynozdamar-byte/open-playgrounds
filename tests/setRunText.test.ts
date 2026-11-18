import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.PG_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "pg-settext-"));
process.env.PG_NO_SCHEDULE = "1";
const { setRunText } = await import("../server/prepare.mjs");
const { read, update } = await import("../server/store.mjs");

describe("setRunText", () => {
  it("Threads/X çıktısında post.tweets'i de yeni metinle yazar", () => {
    update((s) => {
      s.runs = [
        { id: "th", taskId: "t", body: "eski", status: "ready", post: { format: "threads", tweets: ["eski"] } },
        { id: "li", taskId: "t", body: "eski", status: "ready", post: { format: "linkedin", text: "eski" } },
      ];
    });
    expect(setRunText("th", "yeni\n\nmetin").ok).toBe(true);
    expect(setRunText("li", "yeni").ok).toBe(true);
    const runs = read().state.runs;
    expect(runs.find((r) => r.id === "th").post.tweets).toEqual(["yeni\n\nmetin"]);
    expect(runs.find((r) => r.id === "li").post.text).toBe("yeni");
  });
});
