// Bir sayfadaki bölümü (animasyon, kodla oynayan görsel) videoya kaydeder: görünmez Chrome, bölüm ortalanır, kırpılmış ekran
// kaydı alınır, H.264 mp4'e çevrilir. Hedef: CSS seçici ya da öğenin aria-label'ı/yazısı (en küçük eşleşen öğe).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { HEADLESS } from "../shared/headless.mjs";

const CHROME = HEADLESS;

export async function recordSection(url, target, seconds, out) {
  const sec = Math.min(20, Math.max(3, Number(seconds) || 8));
  const b = await puppeteer.launch({ executablePath: CHROME, args: ["--autoplay-policy=no-user-gesture-required"] });
  const tmp = path.join(os.tmpdir(), `pg-rec-${Date.now()}.webm`);
  try {
    const p = await b.newPage();
    await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await p.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
    const found = await p.evaluate((t) => {
      let el = null;
      try { el = document.querySelector(t); } catch {}
      if (!el) {
        const q = t.toLocaleLowerCase();
        const hits = [...document.querySelectorAll("body *")].filter((e) => (e.getAttribute("aria-label") || "").toLocaleLowerCase().includes(q) || (e.children.length === 0 && (e.textContent || "").toLocaleLowerCase().includes(q)));
        el = hits.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height).find((e) => e.getBoundingClientRect().width > 80) ?? null;
      }
      if (!el) return null;
      // Sayfa yumuşak kaydırıyorsa ölçü kaydırma bitmeden alınmasın.
      document.documentElement.style.scrollBehavior = "auto";
      el.scrollIntoView({ block: "center", behavior: "instant" });
      el.setAttribute("data-pg-rec", "1");
      return true;
    }, target);
    if (!found) throw new Error(`Bölüm bulunamadı: ${target}`);
    await new Promise((r) => setTimeout(r, 600));
    const box2 = await p.evaluate(() => { const r = document.querySelector("[data-pg-rec]").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
    const x = Math.max(0, Math.round(box2.x)), y = Math.max(0, Math.round(box2.y));
    const crop = { x, y, width: even(Math.min(box2.w, 1440 - x)), height: even(Math.min(box2.h, 900 - y)) };
    const rec = await p.screencast({ path: tmp, crop });
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, sec * 1000));
    await rec.stop();
    const wall = (Date.now() - t0) / 1000;
    // Kayıt kare zamanlarını uzatıyor (görünmez Chrome yavaş yazıyor); video gerçekte geçen süreye sıkıştırılır.
    // Süre başlıktan değil son karenin zamanından okunur (webm başlığındaki süre güvenilmez).
    const pts = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", tmp], { encoding: "utf8", maxBuffer: 16 << 20 }).stdout.trim().split("\n").map(Number).filter((n) => n >= 0);
    const got = pts.length > 1 ? Math.max(...pts) - Math.min(...pts) : wall;
    const f = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", tmp, "-vf", `setpts=(PTS-STARTPTS)*${(wall / got).toFixed(4)}`, "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out], { encoding: "utf8" });
    if (f.status !== 0) throw new Error(`Video çevrilemedi: ${f.stderr.slice(0, 200)}`);
  } finally {
    await b.close().catch(() => {});
    fs.rmSync(tmp, { force: true });
  }
}

// Gerçek zamanlı kayıt.
// Eskiden kare kare sanal zamanla kaydediliyordu: görünmez Chrome yazılımla çizdiği için kare başına ~2 sn sürüyor, 6 dakikalık
// sınırda 5-11 sn'lik video çıkıyordu; sayfadaki <video> ve bazı animasyonlar sanal saate uymadığı için de hızlanmış görünüyordu.
// Kabuk artık ekran kartıyla çizer (Metal, 60 kare/sn) ve sayfa kendi hızında oynarken kareler zaman damgasıyla alınır:
// kayıt, istenen süre kadar sürer ve sitedeki hız neyse videodaki hız odur.
const GPU = process.platform === "darwin" ? ["--enable-gpu", "--use-gl=angle", "--use-angle=metal", "--ignore-gpu-blocklist"] : [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function capture(out, drive) {
  const b = await puppeteer.launch({ executablePath: CHROME, args: ["--autoplay-policy=no-user-gesture-required", ...GPU] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-rec-"));
  const name = (i) => path.join(dir, `f${String(i).padStart(5, "0")}.jpg`);
  const stamps = [];
  try {
    const p = await b.newPage();
    await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    const c = await p.createCDPSession();
    c.on("Page.screencastFrame", (fr) => {
      fs.writeFileSync(name(stamps.length), Buffer.from(fr.data, "base64"));
      stamps.push(fr.metadata.timestamp);
      c.send("Page.screencastFrameAck", { sessionId: fr.sessionId }).catch(() => {});
    });
    await c.send("Page.startScreencast", { format: "jpeg", quality: 90, everyNthFrame: 1 });
    // drive sayfayı gezer; atılacak aralıkları (epoch sn) döndürebilir: biten sayfanın duran kuyruğu, sıradaki sayfanın yüklenişi.
    const drops = (await drive(p, c)) ?? [];
    await c.send("Page.stopScreencast").catch(() => {});
    const kept = keptFrames(stamps, drops, Date.now() / 1000);
    if (kept.length < 15) throw new Error("Kayıt alınamadı: sayfa kare üretmedi");
    fs.writeFileSync(path.join(dir, "list.txt"), kept.map((k) => `file '${name(k.i)}'\nduration ${k.d.toFixed(4)}`).join("\n"));
    const f = spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"), "-vf", "fps=30", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out], { encoding: "utf8" });
    if (f.status !== 0) throw new Error(`Video çevrilemedi: ${f.stderr.slice(0, 200)}`);
    trimLeadingBlank(out);
    return out;
  } finally {
    await b.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Kare zamanlarından video listesi: atılan aralıklardaki kareler çıkar, her kare bir sonraki kareye ya da atılan aralığın
// başına kadar ekranda kalır (sayfa duruyorsa kare gelmez; son kare o süre boyunca görünür, en çok 5 sn).
export function keptFrames(stamps, drops, end) {
  const inDrop = (t) => drops.some(([a, b]) => t >= a && t < b);
  return stamps.map((t, i) => {
    if (inDrop(t)) return null;
    let till = i + 1 < stamps.length ? stamps[i + 1] : Math.max(end, t + 0.033);
    for (const [a] of drops) if (a > t && a < till) till = a;
    return { i, d: Math.min(5, Math.max(0.001, till - t)) };
  }).filter(Boolean);
}

// Sayfanın kendisi açılıştan itibaren (splash animasyonu, ardından gelen bölüm). Açılış animasyonu bitince tek bir gerçek
// tekerlek hareketi: kaydırmaya bağlı açılış animasyonları da oynar.
export function recordPage(url, seconds, out, { scroll = true, wheelAt } = {}) {
  const sec = Math.min(40, Math.max(4, Number(seconds) || 12));
  const at = Number.isFinite(wheelAt) ? wheelAt : Math.min(4.5, sec * 0.25);
  return capture(out, async (p) => {
    const t0 = Date.now();
    p.goto(url, { waitUntil: "load", timeout: 120000 }).catch(() => {});
    if (scroll) { await wait(at * 1000); await p.mouse.move(720, 450).catch(() => {}); await p.mouse.wheel({ deltaY: 120 }).catch(() => {}); }
    await wait(Math.max(0, sec * 1000 - (Date.now() - t0)));
  });
}

// Site turu: sayfa(lar) baştan sona, insan hızında gezilir. Her hamle yaklaşık bir ekran boyu yumuşak tekerlek hareketi,
// ardından okunacak kadar bekleme. Tekerlek olayı kullanılır (scrollTo değil): kaydırmayı kendi yöneten
// siteler de ilerler. Sayfa bitince (konum da görüntü de değişmiyorsa) sıradaki adrese geçilir; her sayfanın duran kuyruğu kesilir.
export const tourPlan = (urls, seconds) => {
  const list = [...new Set((urls ?? []).filter((u) => /^https?:\/\//.test(u)))].slice(0, 6);
  const total = Math.min(90, Math.max(10, Number(seconds) || 40));
  return { urls: list, each: Math.max(8, total / Math.max(1, list.length)) };
};
export function recordTour(urls, seconds, out) {
  const { urls: list, each } = tourPlan(urls, seconds);
  if (!list.length) return Promise.reject(new Error("Kaydedilecek adres yok"));
  return capture(out, async (p, c) => {
    const drops = [];
    let cut;
    // Küçük ekran görüntüleri yardımcı bir sekmede piksel piksel karşılaştırılır (ortalama fark, 0-255). Dosya boyutuna
    // bakmak yetmedi: akan renkli bir zeminde boyut hep aynı kalıyor, tur iletişim bölümünden önce kesiliyordu.
    const q = await p.browser().newPage();
    await p.bringToFront().catch(() => {});
    const diff = (a, b) => q.evaluate(async (a, b) => {
      const px = async (d) => { const im = new Image(); im.src = "data:image/jpeg;base64," + d; await im.decode(); const g = new OffscreenCanvas(72, 45).getContext("2d"); g.drawImage(im, 0, 0, 72, 45); return g.getImageData(0, 0, 72, 45).data; };
      const [x, y] = [await px(a), await px(b)];
      let s = 0; for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
      return s / x.length;
    }, a, b).catch(() => 255);
    for (const [n, url] of list.entries()) {
      const t0 = Date.now();
      await Promise.race([p.goto(url, { waitUntil: "load", timeout: 45000 }).catch(() => {}), wait(20000)]);
      // Önceki sayfanın duran kuyruğu ve bu sayfanın yüklenişi videoya girmez.
      if (n && cut) drops.push([cut, Date.now() / 1000]);
      // İlk sayfada açılış animasyonu izlenir; sonraki sayfalarda yerleşmesi beklenir.
      await wait(n ? 2000 : 4500);
      await p.mouse.move(720, 450).catch(() => {});
      let prev = null, still = 0;
      cut = undefined;
      while ((Date.now() - t0) / 1000 < each) {
        const N = 36;
        for (let i = 0; i < N; i++) { await p.mouse.wheel({ deltaY: Math.sin(((i + 0.5) / N) * Math.PI) * (900 / N) * (Math.PI / 2) }).catch(() => {}); await wait(33); }
        await wait(1800);
        // clip sayfa koordinatındadır: görünen ekranı almak için kaydırma konumu verilir.
        const y = await p.evaluate(() => Math.round(scrollY)).catch(() => 0);
        const shot = await c.send("Page.captureScreenshot", { format: "jpeg", quality: 60, clip: { x: 0, y, width: 1440, height: 900, scale: 0.05 } }).then((x) => x.data).catch(() => "");
        const now = Date.now() / 1000;
        const same = !!prev && !!shot && y === prev.y && (await diff(shot, prev.shot)) < 1.5;
        still = same ? still + 1 : 0;
        // İki hamledir hiçbir şey değişmiyor: sayfa bitti. Kuyruk, değişmeyen ilk ölçümden 1,5 sn sonra kesilir.
        if (same && still === 1) cut = prev.at + 1.5;
        if (!same) cut = undefined;
        if (still >= 2) break;
        prev = { y, shot, at: now };
      }
    }
    if (cut) drops.push([cut, Infinity]);
    return drops;
  });
}

// Sayfa açılmadan önceki boş (beyaz) sekme kareleri atılır: renkler ters çevrilip blackdetect ile 0'dan başlayan boş bölümün sonu bulunur.
// Sitenin kendi koyu splash zemini korunur.
export function trimLeadingBlank(file) {
  const d = spawnSync("ffmpeg", ["-v", "info", "-i", file, "-vf", "negate,blackdetect=d=0.1:pix_th=0.06", "-an", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const m = d.match(/black_start:0(?:\.0+)?\s+black_end:([\d.]+)/);
  const cut = m ? Number(m[1]) : 0;
  if (!(cut > 0.1)) return;
  const tmp = file.replace(/\.mp4$/, ".trim.mp4");
  const f = spawnSync("ffmpeg", ["-y", "-v", "error", "-ss", String(cut), "-i", file, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", tmp], { encoding: "utf8" });
  if (f.status === 0) fs.renameSync(tmp, file); else fs.rmSync(tmp, { force: true });
}
