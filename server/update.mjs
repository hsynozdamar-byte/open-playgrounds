// Güncelleme: kaynak (src, shared, public, index.html) derlenmiş sürümden (dist) yeniyse ya da sunucu kodu (server, shared, scripts)
// sunucu açıldıktan sonra değiştiyse uygulama "Güncelleme var" der. POST /api/update derler; sunucu kodu değiştiyse gözetimli
// sunucu 75 koduyla çıkıp yeniden başlar (server/serve.mjs). Geliştirme sunucusunda (npm run dev) Vite zaten anlık günceller.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { read } from "./store.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const STARTED = Date.now();
const newest = (rels) => {
  let m = 0;
  const walk = (p) => {
    let st; try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const f of fs.readdirSync(p)) if (f !== "node_modules") walk(path.join(p, f)); }
    else m = Math.max(m, st.mtimeMs);
  };
  for (const r of rels) walk(path.join(ROOT, r));
  return m;
};
const builtAt = () => { try { return fs.statSync(path.join(ROOT, "dist/index.html")).mtimeMs; } catch { return 0; } };

export function version() {
  if (!process.env.PG_SUPERVISED) return { dev: true };
  const built = builtAt();
  return { built, client: newest(["src", "shared", "public", "index.html"]) > built, server: newest(["server", "shared"]) > STARTED, ...(pending ? { pending: true, jobs: jobNames() } : {}) };
}

// Yeniden başlatma kuruldu, süren işlerin bitmesi bekleniyor. Bu sırada zamanlayıcı yeni hazırlık başlatmaz (server/schedule.mjs):
// yoksa sıra hiç boşalmaz ve güncelleme saatlerce gelmez. Uygulama neyin beklendiğini adıyla gösterir (src/ui/Update.tsx).
let pending = false;
export const restartPending = () => pending;
function jobNames(now = Date.now()) {
  try {
    const { state: s } = read();
    return [...new Set(s.runs.filter((r) => r.status === "working" && now - new Date(r.at).getTime() < 90 * 60000).map((r) => s.tasks.find((t) => t.id === r.taskId)?.title ?? r.title ?? "Hazırlık"))].slice(0, 6);
  } catch { return []; }
}

// Sunucu yeniden başlarken süren işler yarıda kalır (hazırlık, paylaşım, Rou'nun kod işi): yeniden başlatma onlar bitene kadar bekler (en çok 90 dk).
export function jobsRunning(now = Date.now()) {
  try {
    const { state: s } = read();
    const fresh = (at, min) => at && now - new Date(at).getTime() < min * 60000;
    const prep = s.runs.filter((r) => r.status === "working" && fresh(r.at, 90)).length;
    const share = s.runs.filter((r) => r.status === "approved" && r.publish?.phase && !r.publish.handoff && fresh(r.publish.at, 20)).length;
    // Rou'nun kod işi tek aşamada uzun sürer (at yenilenmez): kısa bir pencere güncellemenin onu
    // çalışırken kesmesine ve yarım dosyaların kayıtsız kalmasına yol açar. Hazırlıkla aynı pencere.
    const change = s.change && !s.change.done && fresh(s.change.at, 90) ? 1 : 0;
    return prep + share + change;
  } catch { return 0; }
}
export const idle = async () => { for (const end = Date.now() + 90 * 60000; Date.now() < end && jobsRunning() > 0; ) await new Promise((r) => setTimeout(r, 3000)); };

let busy = null;
export function update() {
  if (busy) return busy;
  busy = new Promise((resolve) => {
    const v = version();
    // busy bir sonraki turda temizlenir: senkron dönüşte burada temizlense, ardından atanan söz sonsuza dek eski sonucu döndürürdü
    const done = (r) => { queueMicrotask(() => (busy = null)); resolve(r); if (r.ok && v.server && !pending) { pending = true; void idle().then(() => setTimeout(() => process.exit(75), 300)); } };
    if (!v.client) return done({ ok: true, restart: !!v.server, waiting: v.server ? jobsRunning() : 0 });
    const p = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "build"], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], shell: process.platform === "win32" });
    let err = "";
    p.stderr.setEncoding("utf8").on("data", (d) => (err += d));
    p.on("close", (code) => done(code === 0 ? { ok: true, restart: !!v.server, waiting: v.server ? jobsRunning() : 0 } : { ok: false, error: err.slice(-400) || `vite build ${code}` }));
  });
  return busy;
}
