import { describe, expect, it } from "vitest";
import { loginsFromCookies, onPlatform } from "../shared/pb.mjs";

const NOW = Date.UTC(2026, 9, 30);
const chrome = (ms: number) => (ms + 11644473600000) * 1000;

describe("Playground Browser", () => {
  it("reads login state from cookie names and expiry only", () => {
    const rows = [
      { host_key: ".x.com", name: "auth_token", expires_utc: chrome(NOW + 86400000), has_expires: 1 },
      { host_key: ".instagram.com", name: "sessionid", expires_utc: chrome(NOW - 1000), has_expires: 1 },
      { host_key: ".linkedin.com", name: "li_at", expires_utc: 0, has_expires: 0 },
    ];
    expect(loginsFromCookies(rows, ["x", "instagram", "linkedin", "threads", "clickup", "other"], NOW)).toEqual({ x: true, instagram: false, linkedin: true, threads: false, clickup: null, other: null });
  });
  it("counts a login cookie set on a subdomain (LinkedIn li_at on .www.linkedin.com)", () => {
    const rows = [{ host_key: ".www.linkedin.com", name: "li_at", expires_utc: chrome(NOW + 86400000), has_expires: 1 }, { host_key: ".notx.com", name: "auth_token", expires_utc: 0, has_expires: 0 }];
    expect(loginsFromCookies(rows, ["linkedin", "x"], NOW)).toEqual({ linkedin: true, x: false });
  });
  it("counts a live Instagram sessionid, without marking Threads logged in", () => {
    const rows = [{ host_key: ".instagram.com", name: "sessionid", expires_utc: chrome(NOW + 86400000), has_expires: 1 }, { host_key: ".instagram.com", name: "ds_user_id", expires_utc: chrome(NOW + 86400000), has_expires: 1 }];
    expect(loginsFromCookies(rows, ["instagram", "threads"], NOW)).toEqual({ instagram: true, threads: false });
  });
  it("types a password only on the platform's own https host", () => {
    expect(onPlatform("x", "https://x.com/i/flow/login")).toBe(true);
    expect(onPlatform("linkedin", "https://www.linkedin.com/login")).toBe(true);
    expect(onPlatform("x", "https://x.com.evil.io/login")).toBe(false);
    expect(onPlatform("x", "http://x.com/login")).toBe(false);
    expect(onPlatform("other", "https://x.com/")).toBe(false);
  });
});
