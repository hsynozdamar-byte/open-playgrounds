import { describe, expect, it } from "vitest";
import { stagesOf } from "../shared/stages.mjs";
import { attachOf, missingImage } from "../shared/social.mjs";

// Otomasyon işinin adımları: metin → (ses) → (video) → onay → (paylaşım).
const s = { worlds: [], projects: [], automations: [], tasks: [], runs: [] } as never;
const vid = { id: "a", who: "claude", output: "video", voice: "me" } as never;
const txt = { id: "b", who: "claude" } as never;
const at = new Date().toISOString();
const keys = (x: { steps: { key: string; state: string }[] }) => x.steps.map((st) => `${st.key}:${st.state}`).join(" ");

describe("adımlar", () => {
  it("paylaşan: varsayılan Rou, otomasyonda Sen seçilebilir, iş kendi seçimiyle ezer", () => {
    const pub = (a: object, t?: object) => stagesOf(s, a as never, t as never, undefined).steps.find((x) => x.key === "publish")?.who;
    expect(pub(vid)).toBe("Rou");
    expect(pub({ ...(vid as object), sharer: "claude" })).toBe("Rou");
    expect(pub({ ...(vid as object), sharer: "claude" }, { sharer: "me" })).toBe("Sen");
  });
  it("sesli video: metin bitince sıra seste, ses gelince videoda, video gelince onayda", () => {
    expect(keys(stagesOf(s, vid, undefined, undefined))).toBe("write:now voice:todo video:todo approve:todo publish:todo");
    expect(stagesOf(s, vid, undefined, { status: "ready", at, body: "x" } as never).current).toBe("voice");
    expect(stagesOf(s, vid, undefined, { status: "ready", at, body: "x", voice: "media/v.m4a" } as never).current).toBe("video");
    expect(stagesOf(s, vid, undefined, { status: "ready", at, body: "x", voice: "v", video: "media/r.mp4" } as never).current).toBe("approve");
    // Onaydan sonra sıra paylaşımda (hesap bağlı olmasa da: kendin paylaşıp "Paylaştım" dersin); paylaşılınca biter.
    expect(stagesOf(s, vid, undefined, { status: "approved", at, body: "x" } as never).current).toBe("publish");
    expect(stagesOf(s, vid, undefined, { status: "posted", at, body: "x" } as never).finished).toBe(true);
  });
  it("metin: hazırlanıyor, hata, onay", () => {
    expect(stagesOf(s, txt, undefined, { status: "working", at } as never)).toMatchObject({ current: "write", busy: true });
    expect(keys(stagesOf(s, txt, undefined, { status: "failed", at } as never))).toBe("write:fail approve:todo");
    expect(stagesOf(s, txt, undefined, { status: "ready", at, body: "x" } as never).current).toBe("approve");
  });
});

describe("LinkedIn görseli", () => {
  const ls = { worlds: [{ id: "w", accounts: [{ id: "li", platform: "linkedin" }] }], projects: [], automations: [], tasks: [], runs: [] } as never;
  const li = { id: "c", who: "claude", accountId: "li" } as never;
  const post = { format: "linkedin", text: "x" };
  it("metin → görsel → onay → paylaşım; görsel bitmeden onaya geçmez", () => {
    expect(keys(stagesOf(ls, li, undefined, undefined))).toBe("write:now image:todo approve:todo publish:todo");
    expect(stagesOf(ls, li, undefined, { status: "ready", at, body: "x", post } as never).current).toBe("image");
    expect(stagesOf(ls, li, undefined, { status: "approved", at, body: "x", post } as never).current).toBe("image");
    expect(stagesOf(ls, li, undefined, { status: "ready", at, body: "x", post, phase: "Görsel hazırlanıyor" } as never)).toMatchObject({ current: "image", busy: true });
    expect(keys(stagesOf(ls, li, undefined, { status: "ready", at, body: "x", post, renderError: "olmadı" } as never))).toBe("write:done image:fail approve:todo publish:todo");
    expect(stagesOf(ls, li, undefined, { status: "ready", at, body: "x", post, images: ["media/a.png"] } as never).current).toBe("approve");
  });
  it("video eki seçildiyse görsel yerine video adımı gelir", () => {
    const lv = { id: "d", who: "claude", accountId: "li", attach: "video" } as never;
    expect(keys(stagesOf(ls, lv, undefined, undefined))).toBe("write:now video:todo approve:todo publish:todo");
    expect(stagesOf(ls, lv, undefined, { status: "ready", at, body: "x", post, video: "media/a.mp4" } as never).current).toBe("approve");
  });
  it("ek seçimi: LinkedIn'de varsayılan görsel, video seçilebilir; diğer biçimler seçimi korur", () => {
    expect(attachOf("linkedin", undefined)).toBe("image");
    expect(attachOf("linkedin", { attach: "video" })).toBe("video");
    expect(attachOf("tweet", undefined)).toBeUndefined();
    expect(missingImage({ post: { format: "linkedin" } })).toBe(true);
    expect(missingImage({ post: { format: "linkedin" }, images: ["a.png"] })).toBe(false);
    expect(missingImage({ post: { format: "linkedin" }, status: "posted" })).toBe(false);
    expect(missingImage({ post: { format: "tweet" } })).toBe(false);
  });
});

describe("gönderi konusu", () => {
  it("otomasyonun konusu iş açılınca göreve geçer ve otomasyondan silinir", async () => {
    const { makeOccurrence, topicKey } = await import("../shared/repeat.mjs");
    const st = { tasks: [], blocks: [] } as never as { tasks: { topic?: unknown }[]; blocks: unknown[] };
    const a = { id: "x", worldId: "w", projectId: null, title: "T", who: "claude", days: [1], times: ["10:00"], topics: { [topicKey("2026-11-02", "10:00")]: { title: "Konu", brief: "Kısa" } } } as never as { topics: Record<string, unknown> };
    const t = makeOccurrence(st as never, a as never, "2026-11-02", "10:00");
    expect(t.topic).toEqual({ title: "Konu", brief: "Kısa" });
    expect(a.topics).toEqual({});
  });
});
