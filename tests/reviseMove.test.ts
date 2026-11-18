import { describe, expect, it } from "vitest";
import { addRevision, movePost, reviseBlock, revisionMode } from "../shared/revise.mjs";
import { accountOf, taskRef } from "../shared/social.mjs";
import { describe as card } from "../src/ui/rouActions";
import type { State } from "../src/types";
import { auto, state, task } from "./fixture";

// İki dünya, her birinde bir LinkedIn hesabı; A dünyasındaki otomasyon işi B dünyasındaki Proje B'ye taşınacak.
function world(): State {
  const s = state();
  s.worlds.push(
    { id: "w-a", name: "Dünya A", color: "#000", description: "", accounts: [{ id: "gl", platform: "linkedin", name: "Dünya A", handle: "", voice: "", lang: "tr+en" }] },
    { id: "w-b", name: "Dünya B", color: "#a6ff00", description: "", accounts: [{ id: "jl", platform: "linkedin", name: "Dünya B", handle: "", voice: "", lang: "tr+en" }] },
  ) ;
  s.projects.push(
    { id: "gp", worldId: "w-a", name: "Proje A", description: "", status: "active", deadline: null },
    { id: "fe", worldId: "w-b", name: "Proje B", description: "", status: "active", deadline: null },
  );
  s.automations.push(auto({ id: "ga", worldId: "w-a", projectId: "gp", title: "A LinkedIn", accountId: "gl", format: "linkedin", sharer: "claude", times: ["10:00"] }));
  s.tasks.push(task("ft", { worldId: "w-a", projectId: "gp", title: "A LinkedIn", autoId: "ga", autoSlot: "10:00", autoDay: "2026-11-04", day: "2026-11-04", by: "claude", topic: { title: "Proje B", brief: "iyi haber okuyucu" } }));
  s.runs.push({ id: "r1", taskId: "ft", at: "2026-11-04T07:00:00.000Z", title: "A LinkedIn", body: "eski metin", status: "ready", by: "claude", post: { format: "linkedin", text: "eski metin" } } as State["runs"][number]);
  return s;
}

describe("revize taşıması", () => {
  it("otomasyon işini hedef hesabın tek seferlik gönderisine çevirir, otomasyon aynı kalır", () => {
    const s = world();
    const a0 = structuredClone(s.automations[0]);
    const t = s.tasks.find((x) => x.id === "ft")!;
    const mv = movePost(s, t, { projectId: "fe", accountId: "jl" });
    expect(mv && !("error" in mv) && mv.from).toEqual({ worldId: "w-a", projectId: "gp", accountId: "gl", autoId: "ga" });
    expect(t).toMatchObject({ worldId: "w-b", projectId: "fe", who: "claude", sharer: "claude", title: "Proje B", post: { accountId: "jl", format: "linkedin", brief: "Proje B. iyi haber okuyucu", at: "10:00" } });
    expect(t.autoId).toBeUndefined();
    expect(s.automations[0]).toEqual(a0);
    expect(accountOf(s, taskRef(s, t))).toMatchObject({ id: "jl", project: { id: "fe" } });
  });

  it("dünyası tutmayan hesap ya da proje reddedilir, veri değişmez", () => {
    const s = world();
    const t = s.tasks.find((x) => x.id === "ft")!;
    const before = structuredClone(t);
    expect(movePost(s, t, { projectId: "gp", accountId: "jl" })).toEqual({ error: "Account is not in that world" });
    expect(movePost(s, t, { worldId: "w-b", projectId: "gp" })).toEqual({ error: "Project is not in that world" });
    expect(movePost(s, t, { accountId: "yok" })).toEqual({ error: "No such account" });
    expect(t).toEqual(before);
    expect(movePost(s, t, {})).toBeNull();
  });

  it("taşınan iş eski metni düzeltmez, yeni hesapla baştan yazılır", () => {
    const s = world();
    const t = s.tasks.find((x) => x.id === "ft")!;
    const mv = movePost(s, t, { projectId: "fe", accountId: "jl" });
    addRevision(t, { note: "Dünya B hesabında paylaş", prev: "eski metin", runId: "r1", moved: mv && !("error" in mv) ? mv.from : undefined });
    expect(revisionMode(s, t, "yeni")).toBeNull();
    expect(reviseBlock(t)).toContain("moved the post elsewhere");
  });

  it("Rou kartı taşımayı gösterir, geçersiz hedefte çıkmaz", () => {
    const s = world();
    const ok = card({ type: "revise", runId: "r1", note: "dünya b linkedin", projectId: "fe", accountId: "jl" }, s);
    expect(ok?.verb).toBe("Move and revise");
    expect(ok?.detail).toContain("Dünya B · Proje B · LinkedIn Dünya B");
    expect(card({ type: "revise", runId: "r1", note: "x", accountId: "yok" }, s)).toBeNull();
    expect(card({ type: "revise", runId: "r1", note: "x" }, s)?.verb).toBe("Revise");
    expect(s.tasks.find((x) => x.id === "ft")?.autoId).toBe("ga");
  });
});
