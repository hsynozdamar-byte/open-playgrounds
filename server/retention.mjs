// Saklama (günde bir, zamanlayıcıdan). Metin ve kayıtlar hep kalır; yer kaplayan medya kademeli azalır:
// - Hiçbir kayda (çıktı, sürüm, çöp) bağlı olmayan medya 7 gün sonra media/.trash'e taşınır, orada 30 gün durur, sonra silinir.
// - Paylaşılmış gönderinin videosu 30 gün sonra kayıttan düşer (dosya yukarıdaki yoldan çöpe gider).
// - Paylaşılmış gönderi 90 günü geçince görseli tek küçük önizlemeye iner, sürüm geçmişi boşaltılır (run.slim).
// - Paylaşılmış gönderinin teslim klasörü (paylaşım klasöründe, server/paths.mjs) Çöp Kutusu'na gider.
// - Başarısız ve yerini yenisine bırakmış eski çıktılar 30 gün sonra Çöp Kutusu'na gider (30 gün geri alınabilir).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { read, update, MEDIA_DIR } from "./store.mjs";
import { toTrash } from "../shared/trash.mjs";
import { sweepHandoffs } from "./share.mjs";
import { FFMPEG } from "../shared/platform.mjs";

const DAY = 864e5;
export const KEEP = { orphan: 7, bin: 30, video: 30, posted: 90, oldRuns: 30 };
const BIN = path.join(MEDIA_DIR, ".trash");
const age = (iso, now) => (iso ? (now - Date.parse(iso)) / DAY : 0);

export function retention(now = Date.now()) {
  const out = { binned: 0, deleted: 0, videos: 0, slimmed: 0, runs: 0 };
  update((s) => {
    // Eski çıktılar: başarısız ya da aynı işin daha yenisi olan, onaylanmamış/paylaşılmamış çıktılar.
    const latest = new Map();
    for (const r of s.runs) if (r.taskId && !latest.has(r.taskId)) latest.set(r.taskId, r.id);
    const old = s.runs.filter((r) => age(r.at, now) > KEEP.oldRuns && (r.status === "failed" || ((r.status === "ready" || r.status === "working") && r.taskId && latest.get(r.taskId) !== r.id)));
    for (const r of old) toTrash(s, `ret-${r.id}`, "run", r.title, { runs: [r] });
    if (old.length) s.runs = s.runs.filter((r) => !old.includes(r));
    out.runs = old.length;
    for (const r of s.runs) {
      if (r.status !== "posted") continue;
      if (r.video && age(r.postedAt, now) > KEEP.video) { delete r.video; out.videos++; }
      if (!r.slim && age(r.postedAt, now) > KEEP.posted) {
        const first = r.images?.[0];
        if (first) {
          const src = path.join(MEDIA_DIR, path.basename(first));
          const small = first.replace(/(\.\w+)$/, "-thumb.jpg");
          try { execFileSync(FFMPEG, ["-y", "-loglevel", "error", "-i", src, "-vf", "scale='min(640,iw)':-2", "-q:v", "4", path.join(MEDIA_DIR, path.basename(small))], { stdio: "ignore" }); r.images = [small]; } catch { /* küçültülemezse dokunma */ }
        }
        delete r.versions;
        r.slim = true;
        out.slimmed++;
      }
    }
  });
  // Teslim klasörleri: paylaşılmış ya da kaydı silinmiş çıktılarınki Çöp Kutusu'na (server/share.mjs).
  out.handoffs = sweepHandoffs(read().state);
  // Bağsız medya: kayıtların hiçbirinde adı geçmeyen dosyalar.
  const refs = JSON.stringify(read().state);
  fs.mkdirSync(BIN, { recursive: true });
  for (const f of fs.readdirSync(MEDIA_DIR)) {
    const p = path.join(MEDIA_DIR, f);
    const st = fs.statSync(p);
    if (!st.isFile() || f.startsWith(".") || f.startsWith("rou-") || refs.includes(f)) continue;
    if ((now - st.mtimeMs) / DAY > KEEP.orphan) { fs.renameSync(p, path.join(BIN, f)); fs.utimesSync(path.join(BIN, f), new Date(now), new Date(now)); out.binned++; }
  }
  for (const f of fs.readdirSync(BIN)) {
    const p = path.join(BIN, f);
    if ((now - fs.statSync(p).mtimeMs) / DAY > KEEP.bin) { fs.rmSync(p); out.deleted++; }
  }
  return out;
}
