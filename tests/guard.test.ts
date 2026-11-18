import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module
import { okHost, trusted } from "../server/guard.mjs";

const req = (headers: Record<string, string>) => ({ headers });

describe("request guard", () => {
  it("lets the app's own page, the CLI and the phone through", () => {
    process.env.PG_ALLOW_TAILSCALE = "1";
    // Uygulamanın sayfası: POST'ta Origin kendi adresidir.
    expect(trusted(req({ host: "localhost:5340", origin: "http://localhost:5340", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(trusted(req({ host: "127.0.0.1:5340", origin: "http://127.0.0.1:5340" }))).toBe(true);
    // pg ve Electron kabuğu: Node isteği, Origin yok.
    expect(trusted(req({ host: "127.0.0.1:5340" }))).toBe(true);
    // Telefon, Tailscale üzerinden: IP, tam ad ya da kısa ad.
    expect(trusted(req({ host: "100.101.102.103:5340", origin: "http://100.101.102.103:5340" }))).toBe(true);
    expect(trusted(req({ host: "mac.tail1a2b3.ts.net:5340", origin: "http://mac.tail1a2b3.ts.net:5340" }))).toBe(true);
    expect(trusted(req({ host: "macbook:5340" }))).toBe(true);
    expect(trusted(req({ host: "[::1]:5340" }))).toBe(true);
    // Başka bir yerden tıklanan bağlantıyla sayfanın açılması.
    expect(trusted(req({ host: "localhost:5340", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }))).toBe(true);
    delete process.env.PG_ALLOW_TAILSCALE;
    // Tailscale adı yalnız PG_ALLOW_TAILSCALE=1 ile geçer.
    expect(trusted(req({ host: "mac.tail1a2b3.ts.net:5340" }))).toBe(false);
  });

  it("refuses another site posting to the server", () => {
    expect(trusted(req({ host: "127.0.0.1:5340", origin: "https://evil.example" }))).toBe(false);
    // Aynı makinedeki başka bir yerel sunucunun sayfası da başka kaynaktır.
    expect(trusted(req({ host: "localhost:5340", origin: "http://localhost:5173" }))).toBe(false);
    // Dosyadan ya da kum havuzundaki çerçeveden gelen istek.
    expect(trusted(req({ host: "127.0.0.1:5340", origin: "null" }))).toBe(false);
    // Origin'siz gelen ama tarayıcının başka site diye işaretlediği istek (img, script).
    expect(trusted(req({ host: "127.0.0.1:5340", "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" }))).toBe(false);
  });

  it("refuses a foreign name pointed at this machine (DNS rebinding)", () => {
    expect(trusted(req({ host: "evil.example:5340", origin: "http://evil.example:5340" }))).toBe(false);
    expect(trusted(req({ host: "ts.net.evil.example:5340" }))).toBe(false);
    expect(trusted(req({}))).toBe(false);
    expect(okHost("evil.example")).toBe(false);
    expect(okHost("a.ts.net")).toBe(false);
    process.env.PG_ALLOW_TAILSCALE = "1";
    expect(okHost("a.ts.net")).toBe(true);
    delete process.env.PG_ALLOW_TAILSCALE;
  });
});
