import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { state } from "./fixture";

// pg runs against a temporary data folder (PG_DATA); real data is never touched.
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-"));
  fs.writeFileSync(path.join(dir, "playground.json"), JSON.stringify(state()));
  const pg = (...args: string[]) => execFileSync("node", ["scripts/pg.mjs", ...args], { env: { ...process.env, PG_DATA: dir }, encoding: "utf8", stdio: "pipe" });
  const data = () => JSON.parse(fs.readFileSync(path.join(dir, "playground.json"), "utf8"));
  return { pg, data };
}

describe("pg", () => {
  it("takes a project id as well as a name, and does not open a second project", () => {
    const { pg, data } = setup();
    pg("add", "Draft", "--world", "work", "--project", "p1", "--day", "someday", "--by", "Codex");
    const s = data();
    expect(s.projects).toHaveLength(1);
    expect(s.tasks.find((t: { title: string }) => t.title === "Draft")).toMatchObject({ projectId: "p1", day: null, by: "Codex" });
  });

  it("reserves a block with --at and reads weekday names in full and short", () => {
    const { pg, data } = setup();
    pg("add", "Call", "--world", "home", "--day", "monday", "--at", "9:30", "--min", "20");
    pg("add", "Write", "--world", "home", "--day", "sat");
    const s = data();
    const call = s.tasks.find((t: { title: string }) => t.title === "Call");
    expect(new Date(`${call.day}T12:00`).getDay()).toBe(1);
    expect(new Date(`${s.tasks.find((t: { title: string }) => t.title === "Write").day}T12:00`).getDay()).toBe(6);
    expect(s.blocks.find((b: { taskId: string }) => b.taskId === call.id)).toMatchObject({ start: `${call.day}T09:30`, end: `${call.day}T09:50` });
  });

  it("puts a tool's suggestion in the Notebook, signed", () => {
    const { pg, data } = setup();
    pg("in", "Read the docs", "--world", "work", "--project", "p1", "--suggest", "Read docs", "--url", "https://example.com", "--by", "Claude Code");
    expect(data().inbox[0]).toMatchObject({ title: "Read the docs", source: "agent", from: "Claude Code", projectId: "p1", state: "new", suggestion: { title: "Read docs", projectId: "p1" } });
  });

  it("trashes an empty project and refuses one with work in it", () => {
    const { pg, data } = setup();
    pg("project", "Empty", "--world", "work");
    const empty = data().projects.find((p: { name: string }) => p.name === "Empty").id;
    pg("rm", empty);
    expect(() => pg("rm", "p1")).toThrow();
    const s = data();
    expect(s.projects.map((p: { id: string }) => p.id)).toEqual(["p1"]);
    expect(s.trash.some((b: { kind: string }) => b.kind === "project")).toBe(true);
  });

  it("adds a project source and prints it in the context", () => {
    const { pg } = setup();
    pg("src", "p1", "Style guide", "--body", "Short sentences.", "--url", "https://example.com/style");
    const out = pg("context", "p1");
    expect(out).toContain("# Website");
    expect(out).toContain("Style guide (https://example.com/style)");
    expect(out).toContain("Café photos");
  });

  it("fails on an unknown command, an unknown day and an empty id", () => {
    const { pg } = setup();
    expect(() => pg("bogus")).toThrow();
    expect(() => pg("add", "x", "--world", "work", "--day", "someday-soon")).toThrow();
    expect(() => pg("done", "")).toThrow();
  });
});
