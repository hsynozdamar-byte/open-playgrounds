import { describe, expect, it } from "vitest";
import { state as fixture } from "./fixture";
import type { ChatMsg, State } from "../src/types";
import { DEFAULT_ROU, chatOf, memoryOf, migrateRous, newRou, rouOf, setChat } from "../shared/rou.mjs";

it("migrateRous keeps the old single chat as the default Rou's chat", () => {
  const s = fixture();
  const old: ChatMsg[] = [{ role: "user", text: "Merhaba", at: "2026-10-18T10:00:00Z" }];
  (s as unknown as { chat: ChatMsg[] }).chat = old;
  expect(migrateRous(s)).toBe(true);
  expect(s.rous?.[0]).toMatchObject({ id: DEFAULT_ROU, name: "Rou" });
  expect(chatOf(s, DEFAULT_ROU)).toEqual(old);
  expect(migrateRous(s)).toBe(false);
});

it("each Rou has its own chat and sees shared + own memory", () => {
  const s: State = fixture();
  migrateRous(s);
  const r = newRou("Araştırma", "#0f9d58", "İş başvurularına bakar.");
  s.rous!.push(r);
  setChat(s, r.id, (l) => [...l, { role: "user", text: "Selam" }]);
  expect(chatOf(s, r.id)).toHaveLength(1);
  expect(chatOf(s, DEFAULT_ROU)).toHaveLength(0);
  s.memory = [{ id: "a", text: "Ortak", at: "" }, { id: "b", text: "Kendi", at: "", rouId: r.id }];
  expect(memoryOf(s, r.id).map((m) => m.id)).toEqual(["a", "b"]);
  expect(memoryOf(s, DEFAULT_ROU).map((m) => m.id)).toEqual(["a"]);
  expect(memoryOf(s).map((m) => m.id)).toEqual(["a"]);
  expect(rouOf(s, "yok").id).toBe(DEFAULT_ROU);
});

describe("Rou hangi gönderiden söz edildiğini bilir", () => {
  it("lists one output per task with the task's own id, day and topic", async () => {
    // @ts-expect-error plain ESM module
    const { runLines } = await import("../server/rou.mjs");
    const s = {
      worlds: [], projects: [], automations: [],
      tasks: [
        { id: "men", title: "Proje A carousel", day: "2026-11-10", autoSlot: "10:00", status: "todo" },
        { id: "fea", title: "Proje A carousel", day: "2026-11-12", status: "todo", topic: { title: "Proje B" } },
      ],
      runs: [
        { id: "f3", taskId: "fea", status: "working", at: "2026-11-11T17:46:00Z" },
        { id: "f2", taskId: "fea", status: "ready", at: "2026-11-11T17:33:00Z", body: "Proje B was a restaurant app" },
        { id: "f1", taskId: "fea", status: "ready", at: "2026-11-11T15:55:00Z", body: "old" },
        { id: "m2", taskId: "men", status: "ready", at: "2026-11-11T14:22:00Z", body: "Proje C keeps books" },
        { id: "m1", taskId: "men", status: "failed", at: "2026-11-11T14:16:00Z" },
      ],
    };
    const lines = runLines(s, "2026-11-11").split("\n").filter((l: string) => l.startsWith("- "));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("(runId:f2)");
    expect(lines[0]).toContain("görev günü 2026-11-12 (Per)");
    expect(lines[0]).toContain("yenisi şu an hazırlanıyor");
    expect(lines[0]).not.toContain("GECİKMİŞ");
    expect(lines[1]).toContain("(runId:m2)");
    expect(lines[1]).toContain("görev id:men, görev günü 2026-11-10 (Sal) 10:00, GECİKMİŞ");
  });
});
