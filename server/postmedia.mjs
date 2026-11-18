// Hesabı bağlı olmayan gönderide ekler: Rou metnin sonuna "EKLER:" altında doğrudan dosya adreslerini yazar,
// burada indirilip data/media'ya konur (run.images) ve o bölüm metinden çıkar. Metinde ek tarifi kalmaz.
import fs from "node:fs";
import path from "node:path";
import { MEDIA_DIR } from "./store.mjs";
import { recordSection } from "./record.mjs";

export const MEDIA_RULE = [
  "Ekler: Gönderiye eklenecek görselleri ve videoları metnin içine yazma, tarif etme, not düşme.",
  "Metinden sonra ayrı bir satıra yalnız \"EKLER:\" yaz; altına her satıra bir doğrudan dosya adresi koy (https:// ile başlayan, .png .jpg .jpeg .webp .gif .svg .mp4 .mov ile biten). Adresin açıldığını WebFetch ile doğrula.",
  "Sayfada kodla oynayan bir animasyonu (dosyası yok) video olarak eklemek için EKLER altına şu satırı yaz: \"KAYIT: <sayfa adresi> | <öğenin aria-label'ı ya da CSS seçicisi> | <saniye, 4-20>\". aria-label'ı sayfanın HTML'inden aynen kopyala (WebFetch); CSS seçici tahmin etme, yalnız HTML'de gördüğün aria-label'ı ya da id'yi kullan; animasyon bir turunu tamamlayacak kadar süre ver. Sunucu o bölümü kaydedip videoya çevirir.",
  "Hiç ek yoksa EKLER bölümünü yazma; eklenemeyen şey için not yazma.",
].join("\n");

const HEAD = /^\s*(EKLER|Ekler|Görseller|Görsel|Medya|Videolar)\s*:?\s*$/m;
const FILE = /https?:\/\/[^\s)"'<>]+?\.(png|jpe?g|webp|gif|svg|mp4|mov|m4v|webm)(\?[^\s)"'<>]*)?(?=[\s)"'<>,.;]|$)/gi;
const MAX = 80 * 1024 * 1024;

async function download(url, file) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status}`);
  const type = r.headers.get("content-type") || "";
  if (!/^(image|video)\//.test(type) && !/octet-stream/.test(type)) throw new Error(`tür ${type}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX) throw new Error("çok büyük");
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, file), buf);
}

// { body, images, failed }: ek bölümü metinden ayrılır; bölümdeki dosya adresleri indirilir.
export async function pullMedia(body, runId) {
  const m = HEAD.exec(body ?? "");
  if (!m) return { body, images: [], failed: [] };
  const text = body.slice(0, m.index).trimEnd();
  // Satır sırası gönderideki sıra: dosya adresi indirilir, KAYIT satırı sayfadan videoya kaydedilir.
  const items = [];
  for (const line of body.slice(m.index).split("\n")) {
    const rec = line.match(/KAYIT:\s*(https?:\/\/\S+)\s*\|\s*(.+?)\s*\|\s*(\d+)/i);
    if (rec) items.push({ rec: [rec[1], rec[2].replace(/^["'`]|["'`]$/g, ""), Number(rec[3])] });
    else for (const url of line.match(FILE) ?? []) if (!items.some((x) => x.url === url)) items.push({ url });
  }
  const images = [], failed = [];
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  for (const [i, x] of items.entries()) {
    if (x.rec) {
      const file = `${runId}-ek${i + 1}.mp4`;
      try { await recordSection(...x.rec, path.join(MEDIA_DIR, file)); images.push(`media/${file}`); } catch { failed.push(`${x.rec[0]} (${x.rec[1]})`); }
      continue;
    }
    const ext = x.url.replace(/\?.*$/, "").split(".").pop().toLowerCase().replace("jpeg", "jpg");
    const file = `${runId}-ek${i + 1}.${ext}`;
    try { await download(x.url, file); images.push(`media/${file}`); } catch { failed.push(x.url); }
  }
  return { body: text, images, failed };
}
