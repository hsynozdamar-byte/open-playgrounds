import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Sunucu deposu geçici bir klasörde: gerçek veriye dokunulmaz.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-test-"));
process.env.PG_DATA = dir;
const store = await import("../server/store.mjs");
const file = path.join(dir, "playground.json");

describe("server store", () => {
  it("keeps a write that lands between pg's read and write", () => {
    store.read();
    let first = true;
    store.update((s: { inbox: { id: string }[] }) => {
      if (first) {
        first = false;
        const other = JSON.parse(fs.readFileSync(file, "utf8"));
        other.inbox.push({ id: "app" });
        fs.writeFileSync(file, JSON.stringify(other));
      }
      s.inbox.push({ id: "pg" });
    });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).inbox.map((i: { id: string }) => i.id)).toEqual(["app", "pg"]);
  });

  it("gives every write a new revision", () => {
    const a = store.update(() => {});
    const b = store.update(() => {});
    expect(a).not.toBe(b);
  });

  it("takes one backup a day", () => {
    expect(fs.readdirSync(path.join(dir, "backups")).length).toBe(1);
  });
});
