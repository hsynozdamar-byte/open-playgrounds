// İstek gerçekten uygulamanın kendi sayfasından (ya da pg, Electron kabuğu gibi yerel bir araçtan) mı geliyor?
// Tarayıcıda açık başka bir site de 127.0.0.1:5340'a istek atabilir (IP süzgeci onu durdurmaz: bağlantı bu bilgisayardan gelir).
// O istek /api/change'e ulaşırsa Rou'nun kod değiştiren ajanı başlar. Üç kural bunu keser:
// - Host yalnız localhost, bir IP adresi, noktasız yerel ad ya da (PG_ALLOW_TAILSCALE=1 ise) Tailscale adı (*.ts.net) olabilir.
//   Böylece 127.0.0.1'e çevrilen yabancı bir alan adı (DNS rebinding) kendini uygulamanın sayfası gibi gösteremez.
// - Origin başlığı varsa Host ile aynı olmalı. Başka bir siteden gelen POST'un Origin'i o sitedir.
// - Tarayıcı isteği "başka siteden" diye işaretlediyse (Sec-Fetch-Site: cross-site) yalnız sayfa açılışı geçer.
// Node'dan gelen istekler (pg, kabuk, testler) Origin göndermez; onlar Host kuralından geçer.
import net from "node:net";

export const hostName = (h = "") => {
  const s = String(h).trim().toLowerCase();
  if (s.startsWith("[")) return s.slice(1, Math.max(1, s.indexOf("]")));
  return s.replace(/:\d+$/, "");
};

export const okHost = (h) => {
  const n = hostName(h);
  return n === "localhost" || net.isIP(n) !== 0 || (process.env.PG_ALLOW_TAILSCALE === "1" && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/.test(n)) || /^[a-z0-9-]+$/.test(n);
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
