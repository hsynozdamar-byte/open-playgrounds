import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { state } from "./fixture";

// pg add --project kimlikle de çalışır; boş proje pg rm ile çöpe gider (2026-11-08: kimlik ad sanılıp yeni proje açılmıştı).
function pg(dir: string, ...args: string[]) {
  return execFileSync("node", ["scripts/pg.mjs", ...args], { env: { ...process.env, PG_DATA: dir, PG_NO_SCHEDULE: "1" }, encoding: "utf8" });
}
const data = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "playground.json"), "utf8")).state ?? JSON.parse(fs.readFileSync(path.join(dir, "playground.json"), "utf8"));

describe("pg --project", () => {
  it("proje kimliğini tanır, yeni proje açmaz", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-"));
    fs.writeFileSync(path.join(dir, "playground.json"), JSON.stringify(state()));
    pg(dir, "add", "Deneme", "--pg", "w1", "--project", "p1", "--day", "tarihsiz");
    const s = data(dir);
    expect(s.projects).toHaveLength(1);
    expect(s.tasks.find((t: { title: string }) => t.title === "Deneme").projectId).toBe("p1");
  });

  it("boş projeyi çöpe atar, dolu projeye dokunmaz", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-"));
    fs.writeFileSync(path.join(dir, "playground.json"), JSON.stringify(state()));
    pg(dir, "project", "Boş", "--pg", "w1");
    const empty = data(dir).projects.find((p: { name: string }) => p.name === "Boş").id;
    pg(dir, "rm", empty);
    expect(() => pg(dir, "rm", "p1")).toThrow();
    const s = data(dir);
    expect(s.projects.map((p: { id: string }) => p.id)).toEqual(["p1"]);
    expect(s.trash.some((b: { kind: string }) => b.kind === "project")).toBe(true);
  });
});

// Bilgi notu, Medya klasörü ve başka dünyanın hesabından tek seferlik gönderi pg ile yazılır.
describe("pg src, pedit --media-dir, add --post <başka dünyanın hesabı>", () => {
  it("adds a Bilgi link, sets the media folder with good files, takes another world's account by its exact id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-"));
    const st = state() as { worlds: { id: string; accounts?: unknown[] }[] };
    st.worlds.push({ ...st.worlds[0], id: "diger", name: "Diğer", accounts: [{ id: "xacc", platform: "x", name: "X", handle: "@x" }] } as never);
    fs.writeFileSync(path.join(dir, "playground.json"), JSON.stringify(st));
    pg(dir, "src", "p1", "Site", "--body", "Oyunun sitesi", "--url", "https://example.com/oyun");
    const media = fs.mkdtempSync(path.join(os.tmpdir(), "pg-media-"));
    fs.writeFileSync(path.join(media, "play.mp4"), "");
    pg(dir, "pedit", "p1", "--media-dir", media, "--good", "play.mp4");
    expect(() => pg(dir, "pedit", "p1", "--good", "../dis.mp4")).toThrow();
    pg(dir, "add", "Gönderi", "--pg", "w1", "--project", "p1", "--day", "bugün", "--post", "xacc", "--by", "claude");
    expect(() => pg(dir, "add", "Gönderi 2", "--pg", "w1", "--post", "@x")).toThrow();
    const s = data(dir);
    const p = s.projects.find((x: { id: string }) => x.id === "p1");
    expect(p.sources.at(-1)).toMatchObject({ kind: "link", title: "Site", url: "https://example.com/oyun", use: true });
    expect(p.mediaDir).toBe(media);
    expect(p.media).toEqual({ "play.mp4": "good" });
    expect(s.tasks.find((t: { title: string }) => t.title === "Gönderi").post).toMatchObject({ accountId: "xacc", format: "tweet" });
  });
});
