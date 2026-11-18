import { describe, expect, it } from "vitest";
import { asksPermission, loggedInBrowser, orphanedActs, pickBrowser, siteOf, usableBrowsers } from "../shared/chrome.mjs";

// Rou Chrome'u kendisi seçer: tek bağlıysa o, çoksa işin sitesine giriş yapılmış olan, o da yoksa son kullanılan.
const A = { id: "a", name: "Kişisel" };
const B = { id: "b", name: "İş" };
const task = { id: "t", worldId: "w", title: "LinkedIn şirket sayfası kur", notes: "" };
const state = (extra: Record<string, unknown> = {}) => ({ worlds: [{ id: "w", accounts: [] }], tasks: [task], runs: [], ...extra });

describe("Chrome seçimi", () => {
  it("bağlı Chrome yoksa seçmez, tek bağlıysa onu seçer", () => {
    expect(pickBrowser(state(), task, [])).toBeNull();
    expect(pickBrowser(state(), task, [B])).toEqual(B);
  });
  it("işin sitesine giriş yapılmış Chrome'u seçer", () => {
    const s = state({ worlds: [{ id: "w", accounts: [{ id: "x", platform: "linkedin", browser: B, check: { ok: true, at: "2026-10-20" } }, { id: "y", platform: "instagram", browser: A, check: { ok: true, at: "2026-10-28" } }] }] });
    expect(siteOf(task)).toBe("linkedin");
    expect(pickBrowser(s, task, [A, B])).toEqual(B);
  });
  it("giriş tutmamışsa ya da site belli değilse son kullanılanı seçer", () => {
    const s = state({
      worlds: [{ id: "w", accounts: [{ id: "x", platform: "linkedin", browser: B, check: { ok: false, at: "2026-10-20" } }] }],
      tasks: [task, { id: "o", browser: A }],
      runs: [{ id: "r", taskId: "o", at: "2026-10-27", act: { at: "2026-10-28T10:00" } }],
    });
    expect(pickBrowser(s, task, [A, B])).toEqual(A);
    expect(pickBrowser(state(), { ...task, title: "Bir iş" }, [A, { ...B, local: true }])).toEqual({ id: "b", name: "İş" });
  });
  it("bağlı olmayan Chrome'u seçmez", () => {
    const s = state({ worlds: [{ id: "w", accounts: [{ id: "x", platform: "linkedin", browser: { id: "z", name: "Eski" }, check: { ok: true, at: "2026-10-28" } }] }] });
    expect(pickBrowser(s, task, [A, B])).toEqual(A);
  });
  it("girişi bilinmiyorsa bunu söyler, oturumu olmayan Chrome'u atlar", () => {
    expect(loggedInBrowser(state(), task, [A, B])).toBeNull();
    const run = { act: { loggedOut: "a" } };
    expect(usableBrowsers([A, B], run)).toEqual([B]);
    expect(pickBrowser(state({ tasks: [{ ...task, browser: A }] }), task, usableBrowsers([A, B], run), run)).toEqual(B);
  });
  it("izin/onay isteyen araç sonucunu tanır", () => {
    expect(asksPermission("Permission denied: the user has not allowed access to linkedin.com")).toBe(true);
    expect(asksPermission("Navigated to https://www.linkedin.com")).toBe(false);
  });
});

describe("Yarıda kalan Chrome işleri", () => {
  it("sonucu yazılmamış çalışan işleri bulur, tek işi ve öğeli işi ayırır", () => {
    const runs = [
      { id: "d", status: "approved", act: { phase: "Rou Chrome'da çalışıyor" } },
      { id: "i", status: "approved", items: [{ id: "x" }], act: { phase: "1 öğe yapılıyor" } },
      { id: "q", status: "approved", act: { question: "Onaylıyor musun?" } },
      { id: "e", status: "approved", act: { phase: "x", error: "hata" } },
      { id: "a", status: "acted", act: { phase: "x" } },
    ];
    const o = orphanedActs({ runs });
    expect(o.direct.map((r) => r.id)).toEqual(["d"]);
    expect(o.items.map((r) => r.id)).toEqual(["i"]);
  });
});
