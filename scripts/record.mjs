#!/usr/bin/env node
// Bir sayfanın kaydı (görünmez Chrome kabuğu, ayrı profil; açık Chrome'a dokunmaz), gerçek hızında.
// Açılış ya da tek bölüm:  node scripts/record.mjs <url> <saniye> <çıktı.mp4> [--no-scroll]
// Site turu (baştan sona, insan hızında kaydırarak; ek adresler sırayla aynı videoya girer):
//                          node scripts/record.mjs <url> <saniye> <çıktı.mp4> --tour [<url2> <url3> ...]
import { recordPage, recordTour } from "../server/record.mjs";
const [url, sec, out, ...flags] = process.argv.slice(2);
if (!/^https?:\/\//.test(url ?? "") || !out) { console.error("Kullanım: node scripts/record.mjs <url> <saniye> <çıktı.mp4> [--no-scroll | --tour [<url2> ...]]"); process.exit(2); }
try {
  if (flags.includes("--tour")) await recordTour([url, ...flags.filter((x) => /^https?:\/\//.test(x))], Number(sec) || 40, out);
  else await recordPage(url, Number(sec) || 10, out, { scroll: !flags.includes("--no-scroll") });
  console.log(out); process.exit(0);
} catch (e) { console.error(String(e?.message ?? e)); process.exit(1); }
