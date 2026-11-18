import { describe, expect, it } from "vitest";
import { stepOf } from "../server/live.mjs";

// Rou'nun Chrome'daki araçları uygulamada okunur adımlara çevrilir.
describe("canlı adımlar", () => {
  it("araçları Türkçe adıma çevirir, sayfa adresini tutar", () => {
    expect(stepOf("mcp__claude-in-chrome__navigate", { url: "https://www.linkedin.com/company/setup/new/" })).toEqual({ text: "Açıyor: www.linkedin.com/company/setup/new", url: "https://www.linkedin.com/company/setup/new/" });
    expect(stepOf("mcp__claude-in-chrome__computer", { action: "left_click" })?.text).toBe("Tıklıyor");
    expect(stepOf("mcp__claude-in-chrome__computer", { action: "type", text: "Örnek Uygulama" })?.text).toBe("Yazıyor: Örnek Uygulama");
    expect(stepOf("mcp__claude-in-chrome__form_input", {})?.text).toBe("Formu dolduruyor");
    expect(stepOf("mcp__claude-in-chrome__tabs_context_mcp", {})).toBeNull();
  });
});

// Chrome aracı uzun süre sonuçlanmazsa ya da izin hatası dönerse adım "Chrome'da onay bekliyor" olur.
import { vi, beforeEach, afterEach } from "vitest";
vi.mock("../server/store.mjs", () => ({ update: (fn: (s: unknown) => void) => fn(mem) }));
vi.mock("../server/notify.mjs", () => ({ notify: (...a: string[]) => sent.push(a) }));
const mem = { runs: [{ id: "r", act: { at: "" } as Record<string, unknown> }] };
const sent: string[][] = [];
describe("onay bekleyişi", async () => {
  const { tracker, STALL, WAITING } = await import("../server/live.mjs");
  const live = () => mem.runs[0].act.live as { step: string; waiting?: boolean };
  beforeEach(() => { vi.useFakeTimers(); sent.length = 0; });
  afterEach(() => vi.useRealTimers());
  it("sonuç gelmeyen Chrome aracında bekliyor yazar, bir kez bildirir, sonuç gelince sürer", () => {
    const t = tracker("r", "act", { name: "İş" });
    t.onTool("mcp__claude-in-chrome__navigate", { url: "https://www.linkedin.com/company/setup/new/" });
    vi.advanceTimersByTime(STALL + 10);
    expect(live()).toMatchObject({ step: WAITING, waiting: true });
    expect(sent).toEqual([["Rou Chrome'da onayını bekliyor", "İş, www.linkedin.com"]]);
    t.onResult("ok", false);
    vi.advanceTimersByTime(2000);
    expect(live().waiting).toBeUndefined();
    expect(live().step).toBe("Açıyor: www.linkedin.com/company/setup/new");
    t.stop();
  });
  it("izin hatası dönerse hemen bekliyor yazar", () => {
    const t = tracker("r", "act", { name: "İş" });
    t.onTool("mcp__claude-in-chrome__computer", { action: "left_click" });
    t.onResult("Permission required for this site", true);
    expect(live().step).toBe(WAITING);
    t.stop();
  });
});
