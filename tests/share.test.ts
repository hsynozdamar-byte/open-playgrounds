import { describe, expect, it } from "vitest";
import { approveRun, dueFallbacks, dueShares, markPosted } from "../server/share.mjs";

// Onaylanan gönderi saatinde Rou ile paylaşılır; otomasyonda yalnız "Otomatik paylaş" açıksa.
const at = (hm: string) => new Date(`2026-10-27T${hm}:00`);
const state = () => ({
  worlds: [{ id: "w", name: "Dünya A", accounts: [{ id: "acc", platform: "instagram", handle: "@ornek", browser: { id: "b1", name: "Chrome" } }] }],
  projects: [{ id: "p", worldId: "w", name: "Proje A", accountIds: ["acc"] }],
  automations: [
    { id: "saat", who: "claude", status: "active", accountId: "acc", sharer: "claude", autoShare: true },
    { id: "rou", who: "claude", status: "active", accountId: "acc", sharer: "claude", autoShare: true },
    { id: "none", who: "claude", status: "active", output: "post", autoShare: true },
  ],
  tasks: [
    { id: "t1", autoId: "saat", autoSlot: "10:00", day: "2026-10-27", status: "todo", worldId: "w", projectId: "p" },
    { id: "t2", autoId: "rou", autoSlot: "", day: "2026-10-27", status: "todo", worldId: "w", projectId: "p" },
    { id: "t3", autoId: "none", autoSlot: "", day: "2026-10-27", status: "todo", worldId: "w", projectId: null },
    { id: "t4", autoId: "saat", autoSlot: "", day: "2026-10-27", status: "todo", worldId: "w", projectId: "p" },
  ] as Record<string, any>[],
  blocks: [],
  runs: [
    { id: "r1", taskId: "t1", status: "approved", body: "Merhaba #proje", at: "x" },
    { id: "r2", taskId: "t2", status: "approved", body: "Rou paylaşsın", at: "x" },
    { id: "r3", taskId: "t3", status: "approved", body: "Hesap yok", at: "x" },
    { id: "r4", taskId: "t4", status: "ready", body: "Onaysız", at: "x" },
  ] as Record<string, any>[],
});

describe("paylaşım", () => {
  it("onaylı gönderiyi saatinde paylaştırır; hesapsız ve onaysızı bekletir", () => {
    expect(dueShares(state(), at("09:00"))).toEqual([{ runId: "r2", by: "claude" }]);
    expect(dueShares(state(), at("10:00"))).toEqual([{ runId: "r1", by: "claude" }, { runId: "r2", by: "claude" }]);
  });
  it("Otomatik paylaş kapalı otomasyonun çıktısı kendiliğinden paylaşılmaz", () => {
    const s = state();
    delete (s.automations[1] as { autoShare?: boolean }).autoShare;
    expect(dueShares(s, at("10:00")).map((x) => x.runId)).toEqual(["r1"]);
  });
  it("tek seferlik gönderi kullanıcı onaylayınca paylaşılır, kendiliğinden onaylanınca paylaşılmaz", () => {
    const s = state();
    s.tasks.push({ id: "t6", day: "2026-10-27", status: "todo", worldId: "w", projectId: "p", post: { accountId: "acc", format: "ig_post" } });
    s.runs.push({ id: "r6", taskId: "t6", status: "approved", body: "Tek", at: "x", post: { format: "ig_post", text: "Tek" } });
    expect(dueShares(s, at("09:00")).map((x) => x.runId)).toContain("r6");
    Object.assign(s.runs[4], { approvedVia: "auto" });
    expect(dueShares(s, at("09:00")).map((x) => x.runId)).not.toContain("r6");
  });
  it("onaydan sonra 5 dk bekler (geri alma süresi); Sen paylaşıyorsan hiç göndermez", () => {
    const s = state();
    Object.assign(s.runs[0], { approvedAt: at("09:58").toISOString() });
    expect(dueShares(s, at("10:00")).map((x) => x.runId)).toEqual(["r2"]);
    expect(dueShares(s, at("10:04")).map((x) => x.runId)).toEqual(["r1", "r2"]);
    Object.assign(s.automations[1], { sharer: "me" });
    expect(dueShares(s, at("10:04")).map((x) => x.runId)).toEqual(["r1"]);
  });
  it("onaydan sonra revize istendiyse ya da yeni taslak çıktıysa eski onaylıyı paylaşmaz", () => {
    const s = state();
    Object.assign(s.runs[1], { at: "2026-10-26T22:40:00Z", approvedAt: "2026-10-26T22:43:00Z" });
    expect(dueShares(s, at("10:00")).map((x) => x.runId)).toContain("r2");
    s.tasks[1].revisions = [{ at: "2026-10-26T23:00:00Z", note: "berbat" }];
    expect(dueShares(s, at("10:00")).map((x) => x.runId)).not.toContain("r2");
    s.tasks[1].revisions = [];
    s.runs.push({ id: "r5", taskId: "t2", status: "ready", body: "yeni", at: "2026-10-26T23:10:00Z" });
    expect(dueShares(s, at("10:00")).map((x) => x.runId)).not.toContain("r2");
  });
  it("gönderilmiş ya da hatalı olanı tekrar göndermez; paylaşılınca iş biter", () => {
    const s = state();
    Object.assign(s.runs[0], { shareSentAt: "x" });
    Object.assign(s.runs[1], { publish: { error: "olmadı", at: "x" } });
    expect(dueShares(s, at("12:00"))).toEqual([]);
    markPosted(s as never, "r1", { url: "https://instagram.com/p/x" });
    expect(s.runs[0]).toMatchObject({ status: "posted", postUrl: "https://instagram.com/p/x" });
    expect(s.tasks[0].status).toBe("done");
  });
});

describe("onay", () => {
  it("paylaşımlı iş açık kalır, düşük puanlı çıktı kendiliğinden onaylanmaz", () => {
    const s = state();
    Object.assign(s.runs[3], { review: { score: 3, notes: ["zayıf"] } });
    expect(() => approveRun(s, "r4", { via: "auto" })).toThrow(/Design score is low/);
    expect(approveRun(s, "r4")).toMatchObject({ status: "approved" });
    expect(s.tasks.find((t) => t.id === "t4")!.status).toBe("todo");
    expect(() => approveRun(s, "r4")).toThrow();
  });
});

// Yedek zincir: Rou paylaşamazsa paylaşım kullanıcıya kalır.
describe("paylaşım yedeği", () => {
  it("Rou hata yazınca paylaşım kullanıcıya geçer; paketi verilmişse bir daha dokunmaz", () => {
    const s = state();
    Object.assign(s.runs[1], { publish: { error: "buton yok", at: at("10:05").toISOString() }, tried: ["claude"] });
    expect(dueFallbacks(s, at("10:06"))).toEqual([{ runId: "r2", next: "me", reason: "Rou could not share: buton yok" }]);
    Object.assign(s.runs[1], { publish: { handoff: true, at: at("10:06").toISOString() } });
    expect(dueFallbacks(s, at("10:07"))).toEqual([]);
  });
});

describe("LinkedIn görseli", () => {
  // LinkedIn gönderisi görselsiz onaylanmaz ve paylaşılmaz.
  const li = () => {
    const s = state();
    s.worlds[0].accounts.push({ id: "li", platform: "linkedin", handle: "@ornek.li", browser: { id: "b1", name: "Chrome" } });
    s.projects[0].accountIds.push("li");
    s.automations.push({ id: "lia", who: "claude", status: "active", accountId: "li", sharer: "claude", autoShare: true } as never);
    s.tasks.push({ id: "t9", autoId: "lia", autoSlot: "", day: "2026-10-27", status: "todo", worldId: "w", projectId: "p" });
    s.runs.push({ id: "r9", taskId: "t9", status: "approved", body: "Notlar", at: "x", post: { format: "linkedin", text: "Notlar" } });
    return s;
  };
  it("görsel yoksa paylaşmaz, gelince paylaşır", () => {
    const s = li();
    expect(dueShares(s, at("12:00")).map((x) => x.runId)).not.toContain("r9");
    Object.assign(s.runs[4], { images: ["media/r9-1.png"] });
    expect(dueShares(s, at("12:00")).map((x) => x.runId)).toContain("r9");
  });
  it("görselsiz onaylanmaz", () => {
    const s = li();
    Object.assign(s.runs[4], { status: "ready", at: at("08:00").toISOString() });
    expect(() => approveRun(s as never, "r9")).toThrow("Image missing");
    Object.assign(s.runs[4], { images: ["media/r9-1.png"] });
    expect(approveRun(s as never, "r9")).toMatchObject({ status: "approved" });
  });
});

describe("Instagram carousel'i video ile görselleri birlikte taşır", () => {
  it("shares every file in the stored order; a Reel and X keep their own rules", async () => {
    const { shareFiles } = await import("../server/sharemedia.mjs");
    const base = (f: string) => f.split("/").pop();
    const run = { id: "r", post: { format: "ig_post" }, video: "media/r-v0.mp4", images: ["media/r-r0.png", "media/r-r1.png"], order: ["media/r-r0.png", "media/r-v0.mp4", "media/r-r1.png"] };
    expect(shareFiles(run, "instagram").map(base)).toEqual(["r-r0.png", "r-v0.mp4", "r-r1.png"]);
    // Sıra yoksa video başta, görseller arkada.
    expect(shareFiles({ ...run, order: undefined }, "instagram").map(base)).toEqual(["r-v0.mp4", "r-r0.png", "r-r1.png"]);
    // Reels tek videodur; kapağı ayrı ek değildir.
    expect(shareFiles({ id: "r", post: { format: "reel" }, video: "media/r.mp4", images: ["media/r-cover.jpg"] }, "instagram").map(base)).toEqual(["r.mp4"]);
  });
});
