import { describe, expect, it } from "vitest";
import { weekReport } from "../src/postReport";

const s: any = {
  worlds: [{ id: "w", name: "Dünya A", accounts: [{ id: "a1", name: "Proje A", platform: "instagram" }] }],
  projects: [{ id: "p", name: "Proje A", worldId: "w" }],
  automations: [{ id: "au", projectId: "p", worldId: "w", accountId: "a1" }],
  tasks: [{ id: "t1", autoId: "au" }, { id: "t2", autoId: "au" }],
  runs: [
    { id: "r1", taskId: "t1", status: "posted", postedAt: "2026-11-04T10:00:00" },
    { id: "r2", taskId: "t2", status: "posted", postedAt: "2026-10-30T10:00:00" },
    { id: "r3", taskId: "t2", status: "ready" },
  ],
};

describe("haftalık paylaşım raporu", () => {
  it("haftada paylaşılanı dünya, proje ve hesaba göre sayar, önceki haftayı da verir", () => {
    const r = weekReport(s, "2026-11-02");
    expect(r.total).toBe(1);
    expect(r.prev).toBe(1);
    expect(r.worlds[0]).toMatchObject({ name: "Dünya A", n: 1, prev: 1 });
    expect(r.worlds[0].projects[0].accounts[0]).toMatchObject({ name: "Proje A", n: 1 });
  });

  it("süren hafta geçen haftanın aynı gününe kadar olan kısmıyla karşılaştırılır", () => {
    expect(weekReport(s, "2026-11-02", "2026-11-04").prev).toBe(0);
    expect(weekReport(s, "2026-11-02", "2026-11-08").prev).toBe(1);
  });
});
