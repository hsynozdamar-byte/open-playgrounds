// Derlenmiş uygulamayı + API'yi sunar. serve.mjs bunu çalıştırır; 75 koduyla çıkarsa (Rou sunucu kodunu değiştirdi) yeniden başlatır.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { handle, read, update } from "./store.mjs";
import { startSchedule } from "./schedule.mjs";
import { resumeActs } from "./browse.mjs";

const DIST = path.resolve(import.meta.dirname, "../dist");
const PORT = Number(process.env.PORT || 5340);
// Varsayılan: yalnız bu bilgisayar (127.0.0.1). Telefondan erişim isteğe bağlı: PG_LISTEN=0.0.0.0 ve PG_ALLOW_TAILSCALE=1
// ile Tailscale ağındaki cihazlar da girer; aynı Wi-Fi'deki başka cihazlar yine giremez. API'nin parolası yok.
const HOST = process.env.PG_LISTEN || "127.0.0.1";
const TAILNET = process.env.PG_ALLOW_TAILSCALE === "1";
const allowed = (ip = "") => {
  const a = ip.replace(/^::ffff:/, "");
  if (a === "127.0.0.1" || a === "::1") return true;
  if (!TAILNET) return false;
  const m = a.match(/^100\.(\d+)\./);
  return (m && +m[1] >= 64 && +m[1] <= 127) || a.toLowerCase().startsWith("fd7a:115c:a1e0:");
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };

// Tek bir yakalanmamış hata sunucunun tamamını (zamanlayıcı, süren hazırlıklar, paylaşımlar) düşürmesin: günlüğe yazılır, sunucu sürer.
process.on("unhandledRejection", (e) => console.error("yakalanmamış hata (promise):", e?.stack ?? e));
process.on("uncaughtException", (e) => console.error("yakalanmamış hata:", e?.stack ?? e));
// Kapatılırken "exit" olayı çalışsın: süren claude süreçleri orada durdurulur (server/claude.mjs stopAll).
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => process.exit(0));

// Sunucu yeniden başlayınca yarıda kalan işler takılı kalmasın. Port alındıktan sonra çalışır: aynı portta ikinci bir sunucu
// yanlışlıkla başlarsa (kabuğun bekçisi) çalışan sunucunun süren işlerini "yarıda kaldı" diye işaretlemeden kapanır.
function sweep() {
  const half = (r) => r.status === "working" || (r.status === "approved" && r.publish?.phase && r.publish.by === "claude");
  const { state } = read();
  // Tasarım puanından "Hazırlanamadı" olmuş eski çıktılar, işin son çıktısıysa ve günü geçmediyse, eleştirisiyle onaya alınır
  // (yoksa kartta görselleri hiç görünmez).
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const hidden = (st, r) => r.status === "failed" && /^Tasarım denetimi geçmedi/.test(r.renderError ?? "") && (r.video || r.images?.length)
    && !st.runs.some((x) => x.taskId === r.taskId && x.at > r.at) && st.tasks.some((t) => t.id === r.taskId && t.status !== "done" && (t.day ?? "") >= today);
  if (!state.runs?.some(half) && !state.automations?.some((a) => a.ideas?.phase) && !state.runs?.some((r) => hidden(state, r))) return;
  const at = new Date().toISOString();
  update((st) => {
    // Öneri araması (Rou) bellekte tutulur; yeniden başlayınca "tarıyor" yazısı kalmasın.
    for (const a of st.automations ?? []) if (a.ideas?.phase) { delete a.ideas.phase; delete a.ideas.asked; }
    for (const r of st.runs ?? []) if (hidden(st, r)) { r.status = "ready"; delete r.renderError; }
    for (const r of st.runs ?? []) {
      if (r.status === "working") Object.assign(r, { status: "failed", renderError: "Yarıda kaldı: uygulama yeniden başladı. Yeniden hazırlatabilirsin.", phase: undefined });
      // Rou paylaşırken kapandıysa gönderi çıkmış olabilir: kendiliğinden yeniden denenmez, kontrol kullanıcıya kalır.
      // (Önceden "Rou paylaşıyor" sonsuza dek kalıyor, gönderi ne çıkıyor ne haber veriliyordu.)
      else if (half(r)) r.publish = { error: "Yarıda kaldı: uygulama paylaşım sırasında yeniden başladı. Profilinden kontrol et; paylaşıldıysa 'Paylaştım' de.", at, by: "claude" };
    }
  });
}

http
  .createServer((req, res) => {
    if (!allowed(req.socket.remoteAddress)) return res.writeHead(403).end();
    return handle(req, res, () => {
      let file = path.join(DIST, decodeURIComponent(new URL(req.url, "http://x").pathname));
      if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
      // Sayfa her açılışta yeniden sorulur (yeni derleme hemen görünsün); adı hash'li dosyalar sınırsız önbellekte kalır.
      const cache = file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": cache });
      fs.createReadStream(file).pipe(res);
    });
  })
  .on("error", (e) => { console.error(`Sunucu başlatılamadı: ${e.message}`); process.exit(1); })
  .listen(PORT, HOST, () => { console.log(`Playground → http://localhost:${PORT}`); sweep(); startSchedule(); if (!process.env.PG_NO_SCHEDULE) { resumeActs(); setTimeout(() => import("./change.mjs").then((C) => C.resumeChanges()).catch(() => {}), 10000); setTimeout(() => import("./pb.mjs").then(async (P) => P.releaseStaleLabels((await import("./store.mjs")).read().state)).catch(() => {}), 8000); } });
