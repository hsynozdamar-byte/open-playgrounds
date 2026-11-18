// Does a request really come from the app's own page (or a local tool such as `pg`)?
// Any other site open in your browser can send requests to 127.0.0.1:5340; the connection comes from this computer,
// so an address filter would not stop it. Three rules do:
// - Host may only be localhost, an IP address, a Tailscale name (*.ts.net) or a dotless local name.
//   A foreign domain pointed at 127.0.0.1 (DNS rebinding) cannot pass itself off as the app's page.
// - If there is an Origin header, it must equal Host. A POST from another site carries that site as Origin.
// - If the browser marks the request as cross-site (Sec-Fetch-Site: cross-site), only a page load passes.
// Requests from Node (pg, tests) send no Origin; they pass the Host rule.
import net from "node:net";

export const hostName = (h = "") => {
  const s = String(h).trim().toLowerCase();
  if (s.startsWith("[")) return s.slice(1, Math.max(1, s.indexOf("]")));
  return s.replace(/:\d+$/, "");
};

export const okHost = (h) => {
  const n = hostName(h);
  return n === "localhost" || net.isIP(n) !== 0 || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(n) || /^[a-z0-9-]+$/.test(n);
};

export function trusted(req) {
  const h = req.headers ?? {};
  const host = String(h.host ?? "").trim().toLowerCase();
  if (!host || !okHost(host)) return false;
  if (h.origin !== undefined) {
    let from;
    try { from = new URL(String(h.origin)).host.toLowerCase(); } catch { return false; }
    if (from !== host) return false;
  }
  if (h["sec-fetch-site"] === "cross-site" && h["sec-fetch-mode"] !== "navigate") return false;
  return true;
}
