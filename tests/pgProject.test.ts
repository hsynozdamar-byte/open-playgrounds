import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { state } from "./fixture";

// pg add --project works with an id too; an empty project goes to the Trash with pg rm (an id was once taken for a name and opened a new project).
function pg(dir: string, ...args: string[]) {
  return execFileSync("node", ["scripts/pg.mjs", ...args], { env: { ...process.env, PG_DATA: dir, PG_NO_SCHEDULE: "1" }, encoding: "utf8" });
}
const data = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "playground.json"), "utf8")).state ?? JSON.parse(fs.readFileSync(path.join(dir, "playground.json"), "utf8"));

describe("pg --project", () => {
  it("accepts a project id and opens no new project", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-"));
    fs.writeFileSync(path.join(dir, "playground.json"), JSON.stringify(state()));
    pg(dir, "add", "Trial", "--pg", "w1", "--project", "p1", "--day", "someday");
    const s = data(dir);
    expect(s.projects).toHaveLength(1);
    expect(s.tasks.find((t: { title: string }) => t.title === "Trial").projectId).toBe("p1");
  });

  it("trashes an empty project and leaves a project with content alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-"));
    fs.writeFileSync(path.join(dir, "playground.json"), JSON.stringify(state()));
    pg(dir, "project", "Empty", "--pg", "w1");
    const empty = data(dir).projects.find((p: { name: string }) => p.name === "Empty").id;
    pg(dir, "rm", empty);
    expect(() => pg(dir, "rm", "p1")).toThrow();
    const s = data(dir);
    expect(s.projects.map((p: { id: string }) => p.id)).toEqual(["p1"]);
    expect(s.trash.some((b: { kind: string }) => b.kind === "project")).toBe(true);
  });
});

// A Notes link, the Media folder and a one-off post from another world's account are written with pg.
describe("pg src, pedit --media-dir, add --post <another world's account>", () => {
  it("adds a Notes link, sets the media folder with good files, takes another world's account by its exact id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-"));
    const st = state() as { worlds: { id: string; accounts?: unknown[] }[] };
    st.worlds.push({ ...st.worlds[0], id: "other", name: "Other", accounts: [{ id: "xacc", platform: "x", name: "X", handle: "@x" }] } as never);
    fs.writeFileSync(path.join(dir, "playground.json"), JSON.stringify(st));
    pg(dir, "src", "p1", "Site", "--body", "The game site", "--url", "https://example.com/game");
    const media = fs.mkdtempSync(path.join(os.tmpdir(), "pg-media-"));
    fs.writeFileSync(path.join(media, "play.mp4"), "");
    pg(dir, "pedit", "p1", "--media-dir", media, "--good", "play.mp4");
    expect(() => pg(dir, "pedit", "p1", "--good", "../outside.mp4")).toThrow();
    pg(dir, "add", "Post", "--pg", "w1", "--project", "p1", "--day", "today", "--post", "xacc", "--by", "claude");
    expect(() => pg(dir, "add", "Post 2", "--pg", "w1", "--post", "@x")).toThrow();
    const s = data(dir);
    const p = s.projects.find((x: { id: string }) => x.id === "p1");
    expect(p.sources.at(-1)).toMatchObject({ kind: "link", title: "Site", url: "https://example.com/game", use: true });
    expect(p.mediaDir).toBe(media);
    expect(p.media).toEqual({ "play.mp4": "good" });
    expect(s.tasks.find((t: { title: string }) => t.title === "Post").post).toMatchObject({ accountId: "xacc", format: "tweet" });
  });
});
