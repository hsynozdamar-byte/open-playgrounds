import { describe, expect, it } from "vitest";
import { accountOf, bodyOf, formatOf, mentionRule, migrate, normalize, postOfText, problems, profileUrl, reelSeconds, taskRef } from "../shared/social.mjs";
import { auto, state } from "./fixture";

describe("sosyal gönderi", () => {
  it("eski proje hesapları dünyaya taşınır, proje onları seçili tutar", () => {
    const s = state();
    const p = s.projects[0] as typeof s.projects[0] & { accounts?: unknown[] };
    p.accounts = [{ id: "ig", platform: "instagram", name: "Proje A", handle: "@ornek", voice: "" }];
    expect(migrate(s)).toBe(true);
    expect(p.accounts).toBeUndefined();
    expect(p.accountIds).toEqual(["ig"]);
    expect(s.worlds.find((w) => w.id === p.worldId)?.accounts?.[0].id).toBe("ig");
    expect(migrate(s)).toBe(false);
  });

  it("planlanan gönderinin hesabı işin kendisinden; Gmail paylaşım hesabı sayılmaz", () => {
    const s = state();
    const w = s.worlds.find((x) => x.id === s.projects[0].worldId)!;
    w.accounts = [{ id: "li", platform: "linkedin", name: "", handle: "", voice: "" }, { id: "gm", platform: "gmail", name: "", handle: "a@b.c", voice: "" }];
    s.projects[0].accountIds = ["li"];
    const t = { ...s.tasks[0], projectId: null, autoId: undefined, post: { accountId: "li", format: "linkedin" as const, brief: "b" } };
    expect(accountOf(s, taskRef(s, t))?.project?.id).toBe(s.projects[0].id);
    expect(formatOf(s, taskRef(s, t))).toBe("linkedin");
    expect(accountOf(s, { projectId: null, accountId: "gm" })).toBeUndefined();
  });

  it("otomasyon projenin bir hesabını seçer; biçim o platformdan, hesap yoksa düz metin", () => {
    const s = state();
    s.worlds.find((w) => w.id === s.projects[0].worldId)!.accounts = [
      { id: "ig", platform: "instagram", name: "Proje A", handle: "@ornek", voice: "" },
      { id: "tt", platform: "tiktok", name: "Proje A", handle: "@proje", voice: "" },
    ];
    s.projects[0].accountIds = ["ig", "tt"];
    expect(formatOf(s, auto({ accountId: "ig" }))).toBe("ig_post");
    expect(formatOf(s, auto({ accountId: "ig", format: "ig_reel" }))).toBe("ig_reel");
    expect(formatOf(s, auto({ accountId: "ig", format: "linkedin" }))).toBe("ig_post");
    expect(formatOf(s, auto({ accountId: "tt" }))).toBe("short");
    expect(accountOf(s, auto({ accountId: "tt" }))?.handle).toBe("@proje");
    expect(formatOf(s, auto())).toBeNull();
    expect(formatOf(s, auto({ accountId: "silindi" }))).toBeNull();
  });

  it("modelin JSON'u temizlenir: uzun tire, etiketler, vurgu", () => {
    const p = normalize("ig_reel", { hook: "Bir — iki", scenes: [{ text: "Sonra en iyi kural oldu", sec: 99, accent: "en iyi" }, { text: "x", accent: "yok" }], caption: "c", hashtags: "oyun #kar oyun" });
    expect(p).toMatchObject({ hook: "Bir , iki", scenes: [{ sec: 8, accent: "en iyi" }, { text: "x" }], hashtags: ["#oyun", "#kar"] });
    expect(p && "scenes" in p && p.scenes[1].accent).toBeUndefined();
    expect(normalize("linkedin", { text: "" })).toBeNull();
    expect(normalize("tweet", { tweets: ["a", "b"] })).toEqual({ format: "thread", tweets: ["a", "b"] });
  });

  it("ölçülebilir sorunlar ve kopyalanacak metin", () => {
    const long = normalize("thread", { tweets: ["x".repeat(300), "kısa"] });
    expect(problems(long)).toEqual(["1. tweet 300 karakter, en fazla 280."]);
    const ig = normalize("ig_post", { slides: [{ title: "Kapak" }, { title: "İki", text: "t" }], caption: "Açıklama", hashtags: ["#a"] });
    expect(bodyOf(ig)).toBe("Açıklama\n\n#a");
    const reel = normalize("ig_reel", { hook: "h", scenes: [{ text: "bir iki üç dört beş altı yedi sekiz dokuz on", sec: 2 }] });
    expect(problems(reel)).toContain("1. sahne 2 sn içinde okunamaz.");
    expect(reel && reel.format === "ig_reel" && reelSeconds(reel)).toBeCloseTo(6.2);
  });
});

describe("mentionRule", () => {
  it("is empty without mentions", () => {
    expect(mentionRule({ format: "linkedin", text: "x" })).toBe("");
    expect(mentionRule(undefined)).toBe("");
  });
  it("tells the sharer to pick the company page for each @name", () => {
    const r = mentionRule({ format: "linkedin", text: "Hi @Acme", mentions: ["Acme"] });
    expect(r).toContain("@Acme");
    expect(r).toContain("Acme şirket sayfasını");
  });
});

describe("postOfText", () => {
  it("puts hand-written text where the preview reads it", () => {
    expect(postOfText("tweet", "a")).toEqual({ format: "tweet", tweets: ["a"] });
    expect(postOfText("threads", "a")).toEqual({ format: "threads", tweets: ["a"] });
    expect(postOfText("linkedin", "a")).toEqual({ format: "linkedin", text: "a" });
    expect(bodyOf(postOfText("tweet", "a"))).toBe("a");
  });
});

describe("profil adresi", () => {
  it("platforma göre profil adresini kurar", () => {
    expect(profileUrl({ platform: "instagram", handle: "@ornek.site" })).toBe("https://www.instagram.com/ornek.site/");
    expect(profileUrl({ platform: "threads", handle: "@ornek.site" })).toBe("https://www.threads.com/@ornek.site");
    expect(profileUrl({ platform: "x", handle: "@ornek_site" })).toBe("https://x.com/ornek_site");
    expect(profileUrl({ platform: "linkedin", handle: "@ornektasarimci" })).toBe("https://www.linkedin.com/in/ornektasarimci/");
    expect(profileUrl({ platform: "linkedin", handle: "linkedin.com/company/12345678" })).toBe("https://www.linkedin.com/company/12345678");
    expect(profileUrl({ platform: "other", name: "Facebook", handle: "Ayşe Yılmaz" })).toBeNull();
    expect(profileUrl({ platform: "x", handle: "" })).toBeNull();
  });
});
