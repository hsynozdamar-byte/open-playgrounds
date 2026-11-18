// Onay kapısı: bir çıktı "Onay bekliyor"a düşmeden önce daha önce yakalanmış hata türlerine bakılır. Takılan kontrol çıktıyı
// "Hazırlanamadı" yapar, nedeni kartta yazar; zamanlayıcı (server/schedule.mjs retryable) kendiliğinden yeniden dener.
// Yeni bir hata türü yakalandığında buraya bir kontrol eklenir (tarih + ne olduğu), testi tests/quality.test.ts'te.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store.mjs";
import { attachMedia } from "./library.mjs";
import { revisionsOf } from "../shared/revise.mjs";

// Tasarım denetiminin puanı bunun altındaysa çıktı zayıf sayılır. Zayıf çıktı da kullanıcıya gösterilir (eleştirisiyle onaya düşer);
// yalnız kendiliğinden onaylanmaz (server/share.mjs approveRun).
export const FLOOR = 5;
export const designLow = (r) => !!r?.review && (r.review?.score) < FLOOR;

const textsOf = (r) => [r.body, r.post?.text, r.post?.caption, r.post?.hook, ...(Array.isArray(r.post?.tweets) ? r.post.tweets : [])].filter((x) => typeof x === "string");

export const CHECKS = [
  // Rou'nun kendine notu metnin ilk satırına girmesin.
  { id: "note", why: "Metinde Rou'nun iç notu kalmış", test: (r) => textsOf(r).some((t) => /^\s*(KONU UYMADI|YAPILAMADI|NOT ?:|TODO)\b/im.test(t)) },
  // Görsel anahtarı çözülmezse siyah zemine yalnız yazı çizilir.
  // Ek başka bir projenin medyasından olabilir (bir hesap başka bir projeyi anlatır): dünyadaki projelerin hiçbirinde çözülmüyorsa boştur.
  { id: "blank", why: "Ekteki görselde gerçek görüntü yok (yalnız yazılı kart)", test: (r, pids) => !!r.attach?.slides?.length && !r.video && !pids.some((pid) => attachMedia(pid, r.attach).slides?.some((x) => x.media)) },
  // Çıktının gösterdiği dosya diskte yoksa paylaşımda boş kalır.
  { id: "file", why: "Çıktının görsel ya da video dosyası bulunamadı", test: (r) => [r.video, ...(r.images ?? [])].filter(Boolean).some((f) => !fs.existsSync(path.join(DATA_DIR, f))) },
  // Metin boş (yalnız görsel gönderisi değilse).
  { id: "empty", why: "Gönderinin metni boş", test: (r) => !!r.post && !textsOf(r).some((t) => t.trim()) && !(r.images?.length || r.video) },
  // Son revize açıkça bir biçim istiyorsa (GIF, video) o biçim çıktıda olmalı.
  // Not okunmuşsa (clear) kapı yalnız yeni medya isteyen notta (media "new") biçim arar; kaldırma/yasak cümleleri istek sayılmaz.
  { id: "asked", why: "Revizede istenen GIF, video ya da animasyon çıktıda yok", test: (r, pids, task) => {
    const rv = revisionsOf(task).at(-1);
    if (rv?.clear && rv.clear.media !== "new") return false;
    const NO = /(video|gif|animasyon|kayd)[^.;]{0,120}?(çıkar|kaldır|sil|olmasın|koyma|istem|gerek yok|ne gerek)|videosuz/i;
    const ask = `${rv?.clear?.ask ?? ""} ${rv?.clear ? "" : rv?.note ?? ""}`;
    if (NO.test(ask)) return false;
    const media = [r.video, ...(r.images ?? [])].filter(Boolean);
    if (/\bgif/i.test(ask)) return !media.some((f) => /\.gif$/i.test(f));
    // "kaydır-" kayıt değil ("ilk kaydırmada").
    if (/\bvideo|animasyon|ekran kayd|\bkayd[ıi](?!r)/i.test(ask)) return !media.some((f) => /\.(mp4|mov|webm|gif)$/i.test(f));
    return false;
  } },
];

// { ok } ya da { ok: false, error, failed: [id] }
// pids: işin projesi ve dünyasındaki öteki projeler. task: revizeleriyle birlikte görev.
export function gate(r, pids = [], task = null, s = null) {
  const failed = CHECKS.filter((c) => { try { return c.test(r, pids.filter(Boolean), task, s); } catch { return false; } });
  if (!failed.length) return { ok: true };
  return { ok: false, failed: failed.map((c) => c.id), error: `Onay kontrolünden geçmedi: ${failed.map((c) => c.why).join("; ")}. Rou kendiliğinden yeniden deneyecek.` };
}
