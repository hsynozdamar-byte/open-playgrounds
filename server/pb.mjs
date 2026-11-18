// Playground Browser (PB): Playgrounds'un kendi tarayıcısı (browser/, Electron = Chromium). Her dünya ayrı bir oturum bölmesi, hepsi aynı anda açık;
// pencerede bir ya da birkaç dünya yan yana görünür. Bu modül PB'nin denetim API'sini (127.0.0.1:9334) ve DevTools portunu (9333) kullanır:
// - İzleme: dünyaların oturumları (çerezin yalnız adı ve süresi), açık sekmeler, sekme görüntüsü.
// - `pg pb <dünya> [adres]` PB'yi öne getirir ve o dünyanın bölmesini açar.
// - Rou: `claude -p` + chrome-devtools-mcp DevTools portuna bağlanır; iş için dünyada o platformun açık sekmesi (yoksa yeni bir sekme) öne gelir, "Rou ..." etiketi alır; Rou yalnız onda çalışır.
//   Giriş gerekirse Rou durur; girişi kullanıcı tarayıcıda yapar (Rou şifre bilmez, yazmaz).
import fs from "node:fs";
import { spawn } from "node:child_process";
import { SITES } from "../shared/pb.mjs";
import { npxCommand } from "../shared/platform.mjs";

// Tarayıcı artık Playgrounds uygulamasının içinde (Tarayıcı sayfası); ayrı Playground Browser.app yok.
export const PB_NAME = "Playgrounds";
// PG_APP: masaüstü uygulamasının yolu (kapalıysa açmak için). Uygulamanın kendi başlattığı sunucuda PG_SHELL=app gelir.
export const PB_APP = process.env.PG_APP || "";
export const PB_PORT = Number(process.env.PB_PORT || 9333);
const API = `http://127.0.0.1:${Number(process.env.PB_API_PORT || 9334)}`;
const APP_PORT = Number(process.env.PORT || 5340);
const goUrl = (key) => `http://127.0.0.1:${APP_PORT}/pb/go?k=${encodeURIComponent(key)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const appToOpen = () => (PB_APP && fs.existsSync(PB_APP) ? PB_APP : "");
let seenRunning = false;
export const installed = () => !process.env.PG_NO_PB && (process.env.PG_SHELL === "app" || seenRunning || !!appToOpen());

// PB denetim API'si. Başlık şart: PB'de açık bir sayfa bu adrese istek atamasın.
async function call(p, body, ms = 5000) {
  const r = await fetch(API + p, { method: body ? "POST" : "GET", headers: { "x-pg": "1", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  if (r.headers.get("content-type")?.startsWith("image/")) return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  return r.json();
}
export const running = () => call("/state", null, 1500).then((x) => (seenRunning ||= !!x?.ok, !!x?.ok)).catch(() => false);

// Kapalıysa açar (pencere öne gelmez) ve API'nin cevap vermesini bekler.
async function ensure() {
  if (await running()) return true;
  const app = appToOpen();
  if (!app) throw new Error(`${PB_NAME} masaüstü uygulaması açık değil`);
  if (process.platform === "darwin") spawn("open", ["-g", app], { stdio: "ignore", detached: true }).unref();
  else spawn(app, [], { stdio: "ignore", detached: true }).unref();
  for (let t = 0; t < 20000; t += 500) { await sleep(500); if (await running()) return true; }
  throw new Error(`${PB_NAME} açılamadı`);
}

// Uygulamanın Tarayıcı sayfası için: dünya başına oturumlar ve sekmeler.
export async function pbState(s) {
  const st = await call("/state", null, 4000).catch(() => null);
  if (!st && !installed()) return { installed: false, running: false, profiles: [], other: [] };
  const by = new Map((st?.worlds ?? []).map((w) => [w.id, w]));
  const profiles = s.worlds.map((w) => {
    const x = by.get(w.id);
    return {
      worldId: w.id, dir: `pg-${w.id}`, exists: !!x, open: !!x?.tabs.length, shown: !!st?.shown.includes(w.id),
      accounts: Object.fromEntries((w.accounts ?? []).map((a) => [a.id, !SITES[a.platform]?.cookie ? null : x?.logins[a.id] ?? null])),
      pages: (x?.tabs ?? []).map((t) => ({ id: t.id, title: t.title, url: t.url, ...(t.who ? { rou: t.who } : {}), visible: t.visible })),
    };
  });
  return { installed: true, running: !!st, profiles, other: [] };
}

// Sekmenin küçük görüntüsü: görünen sekme anlık, görünmeyen için son görüntü.
export async function shot(tabId, width = 640) {
  const img = await call(`/shot?tab=${encodeURIComponent(tabId)}&w=${width}`, null, 4000);
  if (!Buffer.isBuffer(img)) throw new Error("Görüntü yok");
  return img;
}

// Dünyanın bölmesini öne getirir; adres verilirse orada yeni sekmede açar.
export async function openProfile(world, url) {
  if (url && !/^https?:\/\//.test(url)) return { ok: false, error: "Adres http(s) olmalı" };
  try {
    await ensure();
    const r = await call("/open", { worldId: world.id, url, newTab: !!url });
    return r.ok ? { ok: true, tab: r.tab } : { ok: false, error: r.error || "Açılamadı" };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function focusPage(tabId) {
  await ensure();
  const r = await call("/focus", { tabId });
  if (!r.ok) throw new Error(r.error || "Sekme yok");
  return { ok: true };
}

// Rou'nun çalışma sekmesi: dünyada yeni, etiketli bir sekme (pb/go?k=) ARKA PLANDA açılır. Uygulama öne gelmez, kullanıcının
// açık sekmesi değişmez; aynı dünyanın oturumu (çerezler) kullanılır. Rou list_pages'te bu adresi bulur, siteye kendisi gider.
export async function rouTab(world, key, label = "Rou çalışıyor") {
  await ensure();
  const url = goUrl(key);
  const r = await call("/open", { worldId: world.id, url, who: label, newTab: true, quiet: true });
  if (!r.ok || !r.tab?.targetId) throw new Error(r.error || "Rou'nun sekmesi açılamadı");
  TAB_OF.set(r.tab.targetId, r.tab.id);
  return { url, targetId: r.tab.targetId, tabId: r.tab.id };
}
// targetId sekme uyuyup uyanınca ya da sayfa başka sürece geçince değişebiliyor; kapatırken sabit sekme kimliği kullanılır
// (yoksa Rou'nun sekmeleri kapanmadan birikir).
const TAB_OF = new Map();
// İş bitince etiket kalkar (sekme açık kalır; kullanıcı sonucu görür).
// İş bitince Rou'nun sekmesi kapanır (eskiden açık kalıp birikiyordu). keep: sonuç ekranda kalsın diye yalnız etiket kalkar.
export const releaseTab = (targetId, { keep = false } = {}) => {
  const tabId = TAB_OF.get(targetId) ?? targetId;
  if (!keep) TAB_OF.delete(targetId);
  return call(keep ? "/who" : "/close", keep ? { tabId, who: "" } : { tabId }).catch(() => {});
};

// Rou'nun araçları: chrome-devtools-mcp PB'nin DevTools portuna bağlanır. JavaScript çalıştırma, new_page (yanlış dünyada açılır) ve close_page kapalı.
const MCP_VERSION = "1.12.0";
// tools: ek izinli araçlar (Read, Write, Bash(...)); dirs: Rou'nun okuyup yazabileceği ek klasörler.
// read: sayfayı okuma araçları (take_snapshot, take_screenshot; debugging kategorisi) da açılır (hesap analizi).
export function rouArgs(filesDir, tools = [], dirs = [], { read = false } = {}) {
  const mcp = { mcpServers: { pb: npxCommand(["-y", `chrome-devtools-mcp@${MCP_VERSION}`, "--browserUrl", `http://127.0.0.1:${PB_PORT}`, "--usageStatistics=false", "--performanceCrux=false", "--javascriptEvaluation=false", "--categoryPerformance=false", "--categoryEmulation=false", "--categoryMemory=false", "--categoryNetwork=false", ...(read ? [] : ["--categoryDebugging=false"]), "--screenshotFormat=jpeg", "--screenshotMaxWidth=1280", ...(filesDir ? ["--workspace", filesDir] : [])]) } };
  return ["--mcp-config", JSON.stringify(mcp), "--strict-mcp-config", "--allowedTools", [`mcp__pb`, ...tools].join(","), "--disallowedTools", "mcp__pb__new_page,mcp__pb__close_page", ...[filesDir, ...dirs].filter(Boolean).flatMap((d) => ["--add-dir", d])];
}
// Rou'nun her PB işinde başa eklenen satırlar.
export const rouRules = (tab, acc) => [
  `Tarayıcı: ${PB_NAME} uygulamasının Tarayıcı sayfası (Playgrounds'un kendi tarayıcısı; her dünya ayrı oturum). Önce list_pages ile adresi ${tab.url} olan sekmeyi bul ve select_page ile seç. Yalnız bu sekmede çalış: başka sekmeyi ya da tarayıcının kendi arayüz sayfasını (file://) seçme, new_page kullanma; gerekirse bu sekmede navigate_page ile git.`,
  acc ? `Giriş gerekirse: kullanıcı adı ya da e-posta alanına "${acc.login || acc.handle?.replace(/^@/, "") || ""}" yaz. Şifreyi bilmiyorsun, sormayacaksın ve yazmayacaksın: şifre istenirse dur ve "giriş gerekli" diye hata olarak yaz; girişi kullanıcı tarayıcıda yapar. Doğrulama kodu, CAPTCHA ya da "bu sen misin" ekranı çıkarsa da dur ve hata olarak yaz.` : "",
].filter(Boolean).join("\n");

// Rou'nun iş sekmesinin ilk sayfası: Rou sekmeyi bulup işe başlayana kadar görünür.
export const goPage = () => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Rou · ${PB_NAME}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-content:center;gap:6px;text-align:center;font:15px/1.45 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:Canvas;color:CanvasText}h1{font-size:22px;margin:0}p{margin:0;opacity:.6}</style>
</head><body><h1>Rou bu sekmede çalışacak</h1><p>Sekmeyi kapatma; iş bitince Rou burada bırakır.</p></body></html>`;

// Sunucu yeniden başlayınca yarıda kalan işlerin sekmeleri birikmesin: hiçbir iş sürmüyorsa Rou'nun etiketli sekmeleri kapanır (yoksa saatlerce "çalışıyor" görünürler).
export async function releaseStaleLabels(s) {
  const busy = (s.runs ?? []).some((r) => r.status === "working" || r.publish?.phase || r.act?.status === "working");
  if (busy) return 0;
  const st = await call("/state", null, 4000).catch(() => null);
  let n = 0;
  // Etiketli sekme Rou'nun bir işinin sekmesidir; iş sürmüyorsa kapanır (iş devam ederse rouTab yenisini açar).
  for (const w of st?.worlds ?? []) for (const t of w.tabs ?? []) if (t.who) { await call("/close", { tabId: t.id }).catch(() => {}); n++; }
  return n;
}
