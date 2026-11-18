import { expect, it, vi } from "vitest";
import { state as fixture, task } from "./fixture";
import type { State } from "../src/types";
import type { Ctx } from "../src/lib";

vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));
vi.mock("../src/ui/AutoForm", () => ({ openAutoForm: vi.fn() }));
const { apply, describe, planSteps } = await import("../src/ui/rouActions");

// apply için en küçük bağlam: mutate durumu yerinde değiştirir.
const ctxOf = (s: State) => ({ state: s, mutate: (fn: (x: State) => void) => fn(s) }) as unknown as Ctx;

it("note actions validate ids against the data", () => {
  const s = fixture();
  expect(describe({ type: "note_task", noteId: "n1", projectId: "p1" }, s)).toMatchObject({ verb: "Make a task" });
  expect(describe({ type: "note_task", noteId: "yok", projectId: "p1" }, s)).toBeNull();
  expect(describe({ type: "note_task", noteId: "n1" }, s)).toBeNull(); // dünyası yok, proje de verilmedi
  expect(describe({ type: "note_attach", noteId: "n1", taskId: "uydurma" }, s)).toBeNull();
  expect(describe({ type: "note_place", noteId: "n1", projectId: "p1" }, s)?.detail).toBe("Atölye › Proje A");
});

it("note_task turns the note into a task in the project and archives it", () => {
  const s = fixture();
  apply({ type: "note_task", noteId: "n1", projectId: "p1", title: "Fikri uygula", day: "2026-10-22", at: "10:00", minutes: 45 }, ctxOf(s));
  const t = s.tasks.find((x) => x.title === "Fikri uygula")!;
  expect(t).toMatchObject({ worldId: "w1", projectId: "p1", day: "2026-10-22", estimate: 45 });
  expect(t.notes).toContain("yeni fikir");
  expect(s.inbox[0]).toMatchObject({ state: "done", taskId: t.id });
  expect(s.blocks.some((b) => b.taskId === t.id && b.start === "2026-10-22T10:00" && b.end === "2026-10-22T10:45")).toBe(true);
});

it("note_attach as steps adds each line as a checklist item", () => {
  const s = fixture();
  s.inbox[0].body = "- [ ] kar\n- rüzgâr\n\n3) buz";
  apply({ type: "note_attach", noteId: "n1", taskId: "t1", as: "steps" }, ctxOf(s));
  expect(s.tasks.find((x) => x.id === "t1")!.checklist.map((c) => c.text)).toEqual(["kar", "rüzgâr", "buz"]);
  expect(s.inbox[0].state).toBe("done");
});

it("a plan links a new project to later steps with @ref and drops steps that depend on an unpicked one", () => {
  const s = fixture();
  s.inbox.push({ id: "n2", worldId: null, source: "note", from: "", url: "", title: "Lansman videosu", body: "", receivedAt: "2026-10-12T09:00:00.000Z", state: "new" });
  const plan = {
    type: "plan" as const,
    title: "Defteri düzenle",
    steps: [
      { type: "add_project" as const, name: "Lansman", worldId: "w1", ref: "p" },
      { type: "note_task" as const, noteId: "n2", projectId: "@p" },
      { type: "note_place" as const, noteId: "n1", projectId: "p1" },
      { type: "done" as const, taskId: "uydurma" },
    ],
  };
  expect(planSteps(plan, s).map((x) => !!x.d)).toEqual([true, true, true, false]);
  // Proje seçilmezse ona bağlı iş de geçersiz olur.
  expect(planSteps(plan, s, new Set([1, 2])).map((x) => !!x.d)).toEqual([true, false, true, false]);
  apply(plan, ctxOf(s), undefined, new Set([0, 1, 2]));
  const p = s.projects.find((x) => x.name === "Lansman")!;
  expect(s.tasks.find((x) => x.title === "Lansman videosu")).toMatchObject({ projectId: p.id, worldId: "w1" });
  expect(s.inbox.find((x) => x.id === "n1")).toMatchObject({ worldId: "w1", projectId: "p1", state: "new" });
});

it("edit_task moving to another world's project carries its blocks along", () => {
  const s = fixture();
  s.projects.push({ id: "p2", worldId: "w2", name: "Ev", description: "", status: "active", deadline: null });
  s.tasks.push(task("t3"));
  apply({ type: "edit_task", taskId: "t1", projectId: "p2", steps: ["a", " "], deadline: "2026-10-30" }, ctxOf(s));
  const t = s.tasks.find((x) => x.id === "t1")!;
  expect(t).toMatchObject({ worldId: "w2", projectId: "p2", deadline: "2026-10-30" });
  expect(t.checklist.map((c) => c.text)).toEqual(["a"]);
  expect(s.blocks.find((b) => b.id === "b1")!.worldId).toBe("w2");
  expect(describe({ type: "edit_task", taskId: "t1" }, s)).toBeNull(); // değişecek bir şey yok
});

it("edit_project writes a tone decision into the project's brand and keeps the rest", () => {
  const s = fixture();
  s.projects[0].brand = { audience: "oyuncular", pillars: ["güncelleme"], use: "", avoid: "emoji" };
  const a = { type: "edit_project" as const, projectId: s.projects[0].id, brand: { use: "kuru ironik, kısa paragraflar" } };
  expect(describe(a, s)).toMatchObject({ verb: "Update project", detail: "tone / use: kuru ironik, kısa paragraflar" });
  apply(a, ctxOf(s));
  expect(s.projects[0].brand).toEqual({ audience: "oyuncular", pillars: ["güncelleme"], use: "kuru ironik, kısa paragraflar", avoid: "emoji" });
  expect(describe(a, s)).toBeNull(); // artık değişen bir şey yok
});

it("edit_auto updates the instruction and days, rejects bad values", () => {
  const s = fixture();
  s.automations.push({ id: "a1", worldId: "w1", projectId: null, title: "Post", action: "Eski ton", times: ["10:00"], minutes: 30, days: [1], status: "active", who: "claude" });
  expect(describe({ type: "edit_auto", autoId: "a1", days: [9] }, s)).toBeNull();
  apply({ type: "edit_auto", autoId: "a1", action: "Yeni ton", days: [3, 0], who: "me" }, ctxOf(s));
  expect(s.automations[s.automations.length - 1]).toMatchObject({ action: "Yeni ton", days: [0, 3], who: "me", times: ["10:00"] });
  apply({ type: "edit_auto", autoId: "a1", who: "robot" } as never, ctxOf(s)); // bilinmeyen kişi atanamaz
  expect(s.automations[s.automations.length - 1].who).toBe("me");
});
