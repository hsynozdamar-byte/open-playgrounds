import { describe, expect, it } from "vitest";
import { copyPost } from "../shared/revise.mjs";
import { itemsOf, studioAccounts } from "../src/views/Studio";
import { describe as describeAction, planSteps } from "../src/ui/rouActions";
import { ALL, type Ctx } from "../src/lib";
import type { State } from "../src/types";
import { state, task } from "./fixture";

// Bir X gönderisi Threads ve LinkedIn'de de paylaşılacak: kopyalar gönderi işi olarak açılır ve Gönderiler'de görünür.
function setup(): State {
  const s = state();
  s.worlds[0].accounts = [{ id: "xx", platform: "x", name: "DV", handle: "@dv", voice: "" }, { id: "th", platform: "threads", name: "DV", handle: "@dv", voice: "" }];
  s.worlds[1].accounts = [{ id: "li", platform: "linkedin", name: "Ayşe", handle: "@ay", voice: "" }, { id: "ig", platform: "instagram", name: "Ay", handle: "@ai", voice: "" }];
  s.projects.push({ id: "pli", worldId: "w2", name: "LinkedIn", description: "", status: "active", deadline: null, accountIds: ["li"] });
  s.tasks.push(task("src", { projectId: "p1", title: "Ürün A", day: "2026-11-08", who: "claude", post: { accountId: "xx", format: "tweet", brief: "", at: "10:00" } }));
  s.runs.push({ id: "r1", taskId: "src", at: "2026-11-07T10:00:00.000Z", title: "Ürün A", body: "Bir.\n\nİki.", status: "approved", video: "media/r1.mp4", images: [], post: { format: "tweet", tweets: ["Bir.\n\nİki."] } });
  return s;
}
const ctx = (s: State) => ({ state: s, route: { lens: ALL } }) as unknown as Ctx;
const week = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

describe("kopya gönderi", () => {
  it("kopya task.post'lu gönderi işi, metin ve video aynen, onay bekler", () => {
    const s = setup();
    const r = copyPost(s, "r1", "li", { ids: { taskId: "c1", runId: "cr1" } });
    if ("error" in r) throw new Error(r.error);
    expect(r.task).toMatchObject({ worldId: "w2", projectId: "pli", day: "2026-11-08", post: { accountId: "li", format: "linkedin", at: "10:00" } });
    expect(r.run).toMatchObject({ status: "ready", body: "Bir.\n\nİki.", video: "media/r1.mp4", post: { format: "linkedin", text: "Bir.\n\nİki." }, copyOf: "r1" });
    const t = copyPost(s, "r1", "th", { ids: { taskId: "c2", runId: "cr2" } });
    expect(!("error" in t) && t.run.post).toEqual({ format: "threads", tweets: ["Bir.\n\nİki."] });
  });

  it("kopyalar Gönderiler'in haftasında, hesaplarıyla ve Onay bekliyor durumunda görünür", () => {
    const s = setup();
    copyPost(s, "r1", "li", { ids: { taskId: "c1", runId: "cr1" } });
    copyPost(s, "r1", "th", { ids: { taskId: "c2", runId: "cr2" } });
    const c = ctx(s);
    const items = itemsOf(c, studioAccounts(c), week);
    const of = (id: string) => items.find((x) => x.key === id);
    expect(of("c1")?.acc?.id).toBe("li");
    expect(of("c2")?.acc?.id).toBe("th");
    expect(of("c1")?.run?.status).toBe("ready");
    expect(of("src")?.acc?.id).toBe("xx");
  });

  it("Instagram'a, aynı hesaba ya da olmayan hesaba kopya açılmaz; Rou kartı da çıkmaz", () => {
    const s = setup();
    expect(copyPost(s, "r1", "ig", { ids: { taskId: "a", runId: "b" } })).toHaveProperty("error");
    expect(copyPost(s, "r1", "xx", { ids: { taskId: "a", runId: "b" } })).toHaveProperty("error");
    expect(copyPost(s, "r1", "yok", { ids: { taskId: "a", runId: "b" } })).toHaveProperty("error");
    expect(describeAction({ type: "copy_post", runId: "r1", accountId: "ig" }, s)).toBeNull();
    expect(describeAction({ type: "copy_post", runId: "r1", accountId: "li" }, s)?.verb).toBe("Copy post");
    expect(s.tasks.length).toBe(3);
  });

  it("iki hesaplı plan iki kopya açar", () => {
    const s = setup();
    const steps = planSteps({ type: "plan", title: "Kopyalar", steps: [{ type: "copy_post", runId: "r1", accountId: "li" }, { type: "copy_post", runId: "r1", accountId: "th" }] }, s);
    expect(steps.every((x) => x.d)).toBe(true);
  });
});
