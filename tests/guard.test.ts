import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module
import { okHost, trusted } from "../server/guard.mjs";

const req = (headers: Record<string, string>) => ({ headers });

describe("request guard", () => {
  it("lets the app's own page, the CLI and the phone through", () => {
    // The app's own page: on a POST the Origin is its own address.
    expect(trusted(req({ host: "localhost:5340", origin: "http://localhost:5340", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(trusted(req({ host: "127.0.0.1:5340", origin: "http://127.0.0.1:5340" }))).toBe(true);
    // pg and scripts: a Node request with no Origin.
    expect(trusted(req({ host: "127.0.0.1:5340" }))).toBe(true);
    // A phone over Tailscale: IP, full name or short name.
    expect(trusted(req({ host: "100.101.102.103:5340", origin: "http://100.101.102.103:5340" }))).toBe(true);
    expect(trusted(req({ host: "mac.tail1a2b3.ts.net:5340", origin: "http://mac.tail1a2b3.ts.net:5340" }))).toBe(true);
    expect(trusted(req({ host: "macbook:5340" }))).toBe(true);
    expect(trusted(req({ host: "[::1]:5340" }))).toBe(true);
    // Opening the page from a link clicked elsewhere.
    expect(trusted(req({ host: "localhost:5340", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }))).toBe(true);
  });

  it("refuses another site posting to the server", () => {
    expect(trusted(req({ host: "127.0.0.1:5340", origin: "https://evil.example" }))).toBe(false);
    // A page from another local server on the same machine is another origin too.
    expect(trusted(req({ host: "localhost:5340", origin: "http://localhost:5173" }))).toBe(false);
    // A request from a file or a sandboxed frame.
    expect(trusted(req({ host: "127.0.0.1:5340", origin: "null" }))).toBe(false);
    // No Origin, but the browser marks it cross-site (img, script).
    expect(trusted(req({ host: "127.0.0.1:5340", "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" }))).toBe(false);
  });

  it("refuses a foreign name pointed at this machine (DNS rebinding)", () => {
    expect(trusted(req({ host: "evil.example:5340", origin: "http://evil.example:5340" }))).toBe(false);
    expect(trusted(req({ host: "ts.net.evil.example:5340" }))).toBe(false);
    expect(trusted(req({}))).toBe(false);
    expect(okHost("evil.example")).toBe(false);
    expect(okHost("a.ts.net")).toBe(true);
  });
});
