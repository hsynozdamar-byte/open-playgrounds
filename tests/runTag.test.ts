import { expect, test } from "vitest";
import { runTag } from "../src/ui/Auto";

// Otomasyonsuz tek iş (ör. Gmail temizliği) çekmecesi beyaz ekranla çöküyordu: runTag stagesOf'a undefined otomasyon veriyordu.
const s: any = { automations: [], accounts: [], formats: [], runs: [], tasks: [], projects: [], worlds: [] };
const task: any = { id: "t", title: "Gmail", status: "doing", worldId: "w2", projectId: null };

test("otomasyonsuz işte runTag çökmez", () => {
  expect(runTag(s, task, { id: "r", taskId: "t", status: "approved", act: { question: "Hangileri?" } } as any)).toBe("Waiting for your answer");
  expect(runTag(s, task, { id: "r", taskId: "t", status: "approved" } as any)).toBe("Approved");
  expect(runTag(s, { ...task, status: "done" }, { id: "r", taskId: "t", status: "approved" } as any)).toBe("Done");
});
