// Playground Browser: Playgrounds'un kendi tarayıcısı (Electron = Chromium). İki kabukla çalışır:
// - Playground Browser.app: kendi arayüzü (ui/), dünyalar solda, bölmeler sağda.
// - Playgrounds.app (PG_SHELL=app, browser/build.sh app): pencerede Playgrounds'un kendisi (localhost:5340); Tarayıcı sayfası
//   sekmelerin yerini bildirir, gerçek sekmeler oraya oturur. Sunucuyu başlatır, Mac işlerini (giriş öğesi, mikrofon, dış bağlantılar) yapar.
// İkisi aynı veriyi (oturumlar, sekmeler) kullanır; aynı anda yalnız biri açık olabilir. Her dünya ayrı bir oturum bölmesi (persist:pg-<dünya>),
// hepsi aynı anda açık; pencerede bir ya da birkaç dünya yan yana gösterilir. Rou DevTools portundan (127.0.0.1:9333).
// Denetim: 127.0.0.1:9334 (yalnız bu Mac; tarayıcı sayfaları gönderemesin diye "x-pg" başlığı şart). Playgrounds sunucusu (server/pb.mjs)
// ve `pg pb` bunu kullanır: profili öne getir, sekme aç, Rou etiketi, sekme görüntüsü, oturumlar.
import { app, BaseWindow, BrowserWindow, WebContentsView, Menu, ipcMain, session, clipboard, shell, nativeTheme, systemPreferences, Notification, dialog } from "electron";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { SITES, loginsFromCookies } from "../shared/pb.mjs";

const SHELL = process.env.PG_SHELL === "app";
const NAME = SHELL ? "Playgrounds" : "Playground Browser";
const CDP_PORT = Number(process.env.PB_PORT || 9333);
const API_PORT = Number(process.env.PB_API_PORT || 9334);
const PG = process.env.PG_URL || "http://127.0.0.1:5340";
const DIR = path.dirname(fileURLToPath(import.meta.url));

app.setName(NAME);
// Oturumlar ve sekmeler iki kabukta da aynı klasörde.
app.setPath("userData", path.join(app.getPath("appData"), "Playground Browser"));
app.commandLine.appendSwitch("remote-debugging-port", String(CDP_PORT));
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
// Siteler Electron'u değil Chrome'u görsün (bazı girişler gömülü tarayıcıyı reddediyor).
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|playground-browser|Playground ?Browser|Playgrounds)\/\S+/gi, "");

if (!app.requestSingleInstanceLock()) app.quit();

const STATE_FILE = () => path.join(app.getPath("userData"), "pb-state.json");
const WORLDS_FILE = () => path.join(app.getPath("userData"), "pb-worlds.json");
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

let win, ui;
let worlds = [];           // [{ id, name, color, accounts: [{ id, platform, name, handle, login, secret }] }]
let shown = [];            // pencerede gösterilen dünyalar (sırayla)
let focus = null;          // etkin dünya (klavye, yeni sekme)
const tabs = new Map();    // id → { id, worldId, view, url, title, favicon, loading, who, targetId, shot }
const active = new Map();  // worldId → etkin sekme id
let rects = {};            // worldId → bölmenin sayfa alanı (UI'dan)
let tabSeq = 0;

const SITE_INFO = Object.fromEntries(Object.entries(SITES).map(([k, v]) => [k, { hosts: v.hosts, home: v.home, login: v.login }]));
const part = (worldId) => `persist:pg-${worldId}`;
const worldOf = (id) => worlds.find((w) => w.id === id);

// ---- durum: kaydet ve UI'a gönder ----
let saveT;
function saveNow() {
  clearTimeout(saveT);
  const list = [...tabs.values()].map((t) => ({ worldId: t.worldId, url: t.url, title: t.title, active: active.get(t.worldId) === t.id }));
  fs.writeFileSync(STATE_FILE(), JSON.stringify({ shown, focus, tabs: list }));
}
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 400);
}
let pushT;
function push() {
  clearTimeout(pushT);
  pushT = setTimeout(() => ui?.webContents.send("state", snapshot()), 16);
}
function snapshot() {
  return {
    worlds, shown, focus, sites: SITE_INFO,
    tabs: [...tabs.values()].map(({ id, worldId, url, title, favicon, loading, who, canBack, canFwd }) => ({ id, worldId, url, title, favicon, loading, who, canBack, canFwd, active: active.get(worldId) === id })),
  };
}

// ---- sekmeler ----
// Sekme kaydı (adres, başlık) ile sayfası (WebContentsView, ayrı bir renderer süreci) ayrı: görünmeyen ve bir süredir bakılmayan sekme
// uyur (sayfası kapanır, adresi kalır), gösterilince ya da bir işlem gelince aynı adresle yeniden yüklenir. Açılışta sekmeler uyur başlar.
const SLEEP_MS = 10 * 60 * 1000;
function newTab(worldId, url, { activate = true, who, asleep = false, title = "" } = {}) {
  const id = `t${++tabSeq}`;
  const t = { id, worldId, view: null, url: url || "", title, favicon: "", loading: false, who: who || "", seen: Date.now() };
  tabs.set(id, t);
  if (!asleep) wake(t);
  if (activate || !active.get(worldId)) active.set(worldId, id);
  layout(); push(); save();
  return t;
}
// Uyuyan sekmenin sayfasını açar (zaten açıksa dokunmaz); sayfaya iş yapan her yol bundan geçer.
function wake(t) {
  t.seen = Date.now();
  if (t.view) return t.view;
  const { worldId } = t;
  const view = new WebContentsView({ webPreferences: { partition: part(worldId), sandbox: true, contextIsolation: true } });
  view.setBackgroundColor("#ffffff");
  view.setBorderRadius?.(10);
  t.view = view;
  const wc = view.webContents;
  const sync = () => {
    if (t.view !== view) return;
    const was = t.url;
    t.url = wc.getURL(); t.title = wc.getTitle();
    const h = hostOf(t.url);
    if (h && !isGoogleAuth(t.url)) t.site = h;
    if (!was !== !t.url) layout();
    t.canBack = wc.navigationHistory.canGoBack(); t.canFwd = wc.navigationHistory.canGoForward();
    push(); save();
  };
  wc.on("did-start-loading", () => { t.loading = true; push(); });
  wc.on("did-stop-loading", () => { t.loading = false; sync(); });
  wc.on("did-navigate", sync);
  wc.on("did-navigate-in-page", sync);
  wc.on("page-title-updated", sync);
  wc.on("page-favicon-updated", (_e, icons) => { t.favicon = icons[0] || ""; push(); });
  wc.on("focus", () => { uiFocus = false; t.seen = Date.now(); if (focus !== worldId) { focus = worldId; push(); } });
  // Açılır pencere (OAuth gibi, boyutlu) ayrı küçük pencere olur ama aynı oturumda; gerisi aynı dünyada yeni sekme.
  wc.setWindowOpenHandler(({ url: u, features, disposition }) => {
    // Sayfa yalnız web adresi açabilir: file:// gibi adresler ana süreçten yüklenince diskteki dosyayı gösterir.
    if (!/^(https?:|about:blank)/i.test(u)) return { action: "deny" };
    // Rou çalışırken sayfa yeni sekme/pencere açamaz: adres aynı sekmede açılır (sekmeler ve pencereler birikmesin).
    if (t.who) { wc.loadURL(u).catch(() => {}); return { action: "deny" }; }
    if (disposition === "new-window" && /width|height/.test(features)) {
      // Oturum açanla aynı (dünyanın bölmesi); partition verilirse Electron yeni bağlam açar, window.opener kopar ve Google girişi boş kalır.
      return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 680 } };
    }
    newTab(worldId, u, { activate: disposition !== "background-tab" });
    return { action: "deny" };
  });
  // Google girişine giderken bu dünyada Google oturumu yoksa başka dünyadakini getirir (Google yeni girişi burada reddediyor, hesap seçimini değil).
  const toGoogle = (e) => {
    if (t.googleShared || !(e.isMainFrame ?? true) || !isGoogleAuth(e.url)) return;
    t.googleShared = true;
    e.preventDefault();
    shareGoogle(worldId).catch(() => {}).finally(() => wc.loadURL(e.url).catch(() => {}));
  };
  // Bu sekmeden açılan küçük pencereler (giriş açılırları) sekmeyle birlikte kapanır.
  wc.on("did-create-window", (w) => { (t.kids ??= []).push(w); w.on("closed", () => { t.kids = (t.kids ?? []).filter((x) => x !== w); }); });
  wc.on("will-navigate", toGoogle);
  wc.on("will-redirect", toGoogle);
  wc.on("context-menu", (_e, p) => contextMenu(t, p));
  // DevTools hedef kimliği: Rou ve şifre girişi sekmeyi bununla bulur.
  try {
    wc.debugger.attach("1.3");
    wc.debugger.sendCommand("Target.getTargetInfo").then((r) => { t.targetId = r.targetInfo.targetId; }).catch(() => {}).finally(() => { try { wc.debugger.detach(); } catch {} });
  } catch {}
  if (t.url) wc.loadURL(t.url).catch(() => {});
  return view;
}
// Rou'nun arka plan sekmeleri görünmez bir pencerede durur: sayfa kendini görünür sanar, çizilir ve kısılmaz (Rou CDP ile
// ekran görüntüsü alır), ama hiçbir şey öne gelmez. Kullanıcı sekmeyi Tarayıcı'da açarsa sayfa ana pencereye geçer, çıkınca geri döner.
const QUIET = { width: 1280, height: 900 };
let backWin = null;
function back() {
  if (backWin && !backWin.isDestroyed()) return backWin;
  backWin = new BrowserWindow({ ...QUIET, show: false, paintWhenInitiallyHidden: true, skipTaskbar: true, focusable: false, webPreferences: { backgroundThrottling: false } });
  return backWin;
}
function park(t) {
  if (!t.quiet || !t.view || win?.contentView.children.includes(t.view)) return;
  back().contentView.addChildView(t.view);
  t.view.setBounds({ x: 0, y: 0, ...QUIET });
}
function quietRun(t) {
  wake(t);
  t.quiet = true;
  t.view.webContents.setBackgroundThrottling(false);
  park(t);
}
function quietEnd(t) {
  if (!t.quiet) return;
  t.quiet = false;
  if (!t.view || t.view.webContents.isDestroyed()) return;
  t.view.webContents.setBackgroundThrottling(true);
  if (backWin && !backWin.isDestroyed()) backWin.contentView.removeChildView(t.view);
}
// Sayfayı kapatır, kaydı bırakır. Rou çalışıyorsa, ses çalıyorsa ya da pencerede görünüyorsa uyutmaz.
function sleep(t) {
  if (!t.view || t.who || t.capturing) return;
  const wc = t.view.webContents;
  if (wc.isCurrentlyAudible?.() || win?.contentView.children.includes(t.view)) return;
  t.view = null; t.targetId = undefined; t.loading = false;
  wc.close();
  push();
}
function sleepIdle() {
  const now = Date.now();
  for (const t of tabs.values()) if (t.view && now - t.seen > SLEEP_MS) sleep(t);
}

function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  const same = [...tabs.values()].filter((x) => x.worldId === t.worldId);
  const i = same.findIndex((x) => x.id === id);
  for (const w of t.kids ?? []) if (!w.isDestroyed()) w.close();
  if (t.view) { win.contentView.removeChildView(t.view); if (backWin && !backWin.isDestroyed()) backWin.contentView.removeChildView(t.view); t.view.webContents.close(); }
  tabs.delete(id);
  if (active.get(t.worldId) === id) {
    const next = same[i + 1] ?? same[i - 1];
    next ? active.set(t.worldId, next.id) : active.delete(t.worldId);
  }
  layout(); push(); save();
}

// Gösterilen her dünyanın etkin sekmesi kendi bölmesine yerleşir; diğer sekmeler pencereden çıkarılır (arka planda çalışmaya devam eder).
// Alan arayüzün CSS pikseliyle gelir (yakınlaştırma çarpılır). covered: alanın üstünde arayüzden bir şey var (pencere, menü, Rou);
// sekme o sürece çekilir, yerinde son görüntüsü durur (kapanmadan önce çekilip arayüze gönderilir).
function layout() {
  if (!win) return;
  const want = new Set(shown.map((w) => active.get(w)).filter(Boolean));
  const z = ui?.webContents.getZoomFactor() ?? 1;
  for (const t of tabs.values()) {
    const r = rects[t.worldId];
    // Boş sekme (adres yok) sayfaya konmaz: yerinde Playgrounds'un boş sekme ekranı (hesaplar, arama) görünür.
    const on = want.has(t.id) && r && !r.covered && !!t.url && !t.url.startsWith("about:");
    const kids = win.contentView.children;
    if (on) {
      wake(t);
      if (!kids.includes(t.view)) { if (t.quiet && backWin && !backWin.isDestroyed()) backWin.contentView.removeChildView(t.view); win.contentView.addChildView(t.view); }
      t.view.setBounds({ x: Math.round(r.x * z), y: Math.round(r.y * z), width: Math.max(1, Math.round(r.w * z)), height: Math.max(1, Math.round(r.h * z)) });
    } else if (t.view && kids.includes(t.view)) {
      if (want.has(t.id)) t.seen = Date.now();
      if (want.has(t.id) && r?.covered) {
        if (t.capturing) continue;
        t.capturing = true;
        t.view.webContents.capturePage().then((img) => {
          if (!img.isEmpty()) ui?.webContents.send("shot", { tab: t.id, src: img.toDataURL() });
        }).catch(() => {}).finally(() => { t.capturing = false; if (t.view && (rects[t.worldId]?.covered || !rects[t.worldId])) { win.contentView.removeChildView(t.view); park(t); } });
      } else { win.contentView.removeChildView(t.view); park(t); }
    }
  }
  // Uyarılar sayfaların üstünde kalır.
  const kids = win.contentView.children;
  for (const v of [updView, quitView]) if (v && kids.includes(v) && kids.at(-1) !== v) win.contentView.addChildView(v);
}

function show(list, f) {
  shown = [...new Set(list.filter((id) => worldOf(id)))].slice(0, 4);
  focus = f && shown.includes(f) ? f : shown[0] ?? null;
  // Kendi arayüzünde alanlar yeniden ölçülür; Playgrounds kabuğunda sayfa her karede bildirir (değişince), eskisi kalır.
  if (!SHELL) rects = {};
  push(); save();
}

// Dünyayı öne getirir: zaten görünüyorsa yalnız odak; değilse tek başına gösterilir.
function bring(worldId) {
  if (!shown.includes(worldId)) show([worldId], worldId);
  else { focus = worldId; push(); }
  // Playgrounds kabuğunda Tarayıcı sayfası açılır.
  if (SHELL) ui?.webContents.send("route", { view: "browser", world: worldId });
  if (win.isMinimized()) win.restore();
  win.show(); app.focus({ steal: true });
}

function navigate(t, input) {
  const s = String(input || "").trim();
  if (!s) return;
  const url = /^[a-z]+:\/\//i.test(s) ? s : /^[^\s]+\.[^\s]{2,}(\/.*)?$/.test(s) ? `https://${s}` : `https://www.google.com/search?q=${encodeURIComponent(s)}`;
  if (t.view) { t.url = url; t.view.webContents.loadURL(url).catch(() => {}); layout(); }
  else { t.url = url; wake(t); layout(); }
}

function contextMenu(t, p) {
  const wc = t.view.webContents;
  const items = [];
  if (p.linkURL) items.push({ label: "Bağlantıyı yeni sekmede aç", click: () => newTab(t.worldId, p.linkURL) }, { label: "Bağlantıyı kopyala", click: () => clipboard.writeText(p.linkURL) }, { type: "separator" });
  if (p.isEditable) items.push({ role: "cut", label: "Kes" }, { role: "copy", label: "Kopyala" }, { role: "paste", label: "Yapıştır" }, { type: "separator" });
  else if (p.selectionText) items.push({ role: "copy", label: "Kopyala" }, { type: "separator" });
  const site = hostOf(t.url);
  items.push({ label: "Geri", enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() }, { label: "Yenile", click: () => wc.reload() }, { type: "separator" }, { label: "İncele", click: () => wc.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(items).popup();
}

// ---- Google oturumu ----
// Bir dünyada açık olan Google oturumu, Google girişine gelen başka bir dünyanın bölmesine kopyalanır.
const hostOf = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.hostname : ""; } catch { return ""; } };
const isGoogleAuth = (u) => /^(accounts\.google\.com|accounts\.youtube\.com|gds\.google\.com)$/.test(hostOf(u));
const hasGoogle = async (ses) => (await ses.cookies.get({ domain: "google.com", name: "SID" })).length > 0;
async function shareGoogle(worldId) {
  const to = session.fromPartition(part(worldId));
  if (await hasGoogle(to)) return null;
  for (const w of worlds) {
    if (w.id === worldId) continue;
    const from = session.fromPartition(part(w.id));
    if (!(await hasGoogle(from))) continue;
    for (const d of ["google.com", "youtube.com"]) for (const c of await from.cookies.get({ domain: d })) {
      const x = { url: `https://${c.domain.replace(/^\./, "")}${c.path}`, name: c.name, value: c.value, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite };
      if (!c.hostOnly) x.domain = c.domain;
      if (c.expirationDate) x.expirationDate = c.expirationDate;
      await to.cookies.set(x).catch(() => {});
    }
    await to.cookies.flushStore();
    return w;
  }
  return null;
}
// ---- dünyalar: Playgrounds'tan (kapalıysa son bilinen) ----
async function loadWorlds() {
  try {
    const r = await fetch(`${PG}/api/state`, { signal: AbortSignal.timeout(3000) });
    const { state } = await r.json();
    worlds = state.worlds.map((w) => ({ id: w.id, name: w.name, color: w.color, color2: w.color2, accounts: (w.accounts ?? []).filter((a) => SITES[a.platform]).map(({ id, platform, name, handle, login, secret }) => ({ id, platform, name, handle, login, secret: !!secret })) }));
    fs.writeFileSync(WORLDS_FILE(), JSON.stringify(worlds));
  } catch {
    if (!worlds.length) worlds = readJson(WORLDS_FILE(), []);
  }
  await refreshLogins();
  push();
}

// Oturum: dünyanın bölmesindeki çerezlerin yalnız adı ve süresi.
const logins = new Map();
// Oturum çerezi eklenince ya da silinince (giriş, çıkış) çip hemen güncellenir; yalnız /state ya da dünya yüklemesi beklenmez.
const COOKIE_NAMES = new Set(Object.values(SITES).filter((s) => s.cookie).map((s) => s.cookie[1]));
const watched = new Set();
let loginT;
function watchLogins(worldId) {
  if (watched.has(worldId)) return;
  watched.add(worldId);
  session.fromPartition(part(worldId)).cookies.on("changed", (_e, c) => {
    if (!COOKIE_NAMES.has(c.name)) return;
    clearTimeout(loginT);
    loginT = setTimeout(() => refreshLogins().then(push), 500);
  });
}
async function refreshLogins() {
  for (const w of worlds) {
    watchLogins(w.id);
    const plats = [...new Set(w.accounts.map((a) => a.platform))];
    const rows = [];
    for (const p of plats) {
      const c = SITES[p]?.cookie;
      if (!c) continue;
      const got = await session.fromPartition(part(w.id)).cookies.get({ name: c[1], url: SITES[p].home }).catch(() => []);
      for (const k of got) rows.push({ host_key: k.domain.startsWith(".") ? k.domain : `.${k.domain}`, name: k.name, has_expires: k.session ? 0 : 1, expires_utc: k.expirationDate ? (k.expirationDate * 1000 + 11644473600000) * 1000 : 0 });
    }
    const map = loginsFromCookies(rows, plats);
    logins.set(w.id, Object.fromEntries(w.accounts.map((a) => [a.id, map[a.platform] ?? null])));
    for (const a of w.accounts) a.on = logins.get(w.id)[a.id];
  }
}

// ---- UI'dan gelenler ----
ipcMain.on("rects", (_e, r) => { rects = r; browserOpen = Object.keys(r).length > 0; layout(); });
ipcMain.on("act", (_e, a) => {
  const t = a.tab ? tabs.get(a.tab) : null;
  switch (a.type) {
    case "show": return show(a.worlds, a.focus);
    case "focus": focus = a.world; return push();
    case "newTab": return newTab(a.world, a.url || "");
    case "close": return closeTab(a.tab);
    case "activate": if (t) { t.seen = Date.now(); active.set(t.worldId, t.id); focus = t.worldId; layout(); push(); save(); } return;
    case "go": if (t) navigate(t, a.input); else if (a.world) navigate(newTab(a.world, ""), a.input); return;
    case "back": return t && wake(t).webContents.navigationHistory.goBack();
    case "fwd": return t && wake(t).webContents.navigationHistory.goForward();
    case "reload": return t && wake(t).webContents.reload();
    case "stop": return t?.view?.webContents.stop();
    case "focusPage": return t && wake(t).webContents.focus();
    // Sekmeler sürüklenerek sıralanır: dünyanın sekmeleri verilen sıraya girer, diğer dünyalarınki yerinde kalır.
    case "order": {
      const ids = (a.order ?? []).filter((id) => tabs.get(id)?.worldId === a.world);
      if (!ids.length) return;
      const next = [...tabs.values()].filter((x) => x.worldId !== a.world || !ids.includes(x.id));
      const at = [...tabs.values()].findIndex((x) => x.worldId === a.world);
      next.splice(Math.max(0, at), 0, ...ids.map((id) => tabs.get(id)));
      tabs.clear();
      for (const x of next) tabs.set(x.id, x);
      push(); save();
      return;
    }
  }
});

// ---- denetim API'si ----
const tabOut = (t) => ({ id: t.id, worldId: t.worldId, url: t.url, title: t.title, who: t.who, targetId: t.targetId, active: active.get(t.worldId) === t.id, visible: shown.includes(t.worldId) && active.get(t.worldId) === t.id });
function api(req, res) {
  const send = (code, body, type = "application/json") => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
  // Host da denetlenir: 127.0.0.1'e çevrilen yabancı bir alan adı (DNS rebinding) x-pg başlığını kendi ekleyebilir.
  if (req.headers["x-pg"] !== "1" || !/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host ?? "")) return send(403, { ok: false });
  const url = new URL(req.url, "http://x");
  const body = () => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { r(JSON.parse(b || "{}")); } catch { r({}); } }); });
  (async () => {
    if (url.pathname === "/state") {
      await refreshLogins();
      return send(200, { ok: true, update: !!updView, shown, focus, worlds: worlds.map((w) => ({ id: w.id, logins: logins.get(w.id) ?? {}, tabs: [...tabs.values()].filter((t) => t.worldId === w.id).map(tabOut) })) });
    }
    if (url.pathname === "/open" && req.method === "POST") {
      const { worldId, url: u, who, newTab: fresh, quiet } = await body();
      if (!worldOf(worldId)) { await loadWorlds(); if (!worldOf(worldId)) return send(404, { ok: false, error: "Dünya yok" }); }
      // Arka plan işi (Rou): pencere öne gelmez, sayfa değişmez, kullanıcının sekmesine dokunulmaz. Yeni, etkin olmayan bir sekme
      // pencereye konmadan çalışır (quietRun: görünmeden çizilir, kısılmaz); Tarayıcı'da sekme satırında etiketiyle durur.
      if (quiet) {
        const t = newTab(worldId, u || "", { activate: false, who });
        quietRun(t);
        for (let i = 0; i < 20 && !t.targetId; i++) await new Promise((r) => setTimeout(r, 100));
        return send(200, { ok: true, tab: tabOut(t) });
      }
      bring(worldId);
      let t = tabs.get(active.get(worldId));
      if (fresh || !t || (u && t.who)) t = newTab(worldId, u || "", { who });
      else if (u) { navigate(t, u); if (who) t.who = who; }
      wake(t);
      active.set(worldId, t.id); layout(); push();
      for (let i = 0; i < 20 && !t.targetId; i++) await new Promise((r) => setTimeout(r, 100));
      return send(200, { ok: true, tab: tabOut(t) });
    }
    if (url.pathname === "/focus" && req.method === "POST") {
      const { tabId } = await body();
      const t = tabs.get(tabId) ?? [...tabs.values()].find((x) => x.targetId === tabId);
      if (!t) return send(404, { ok: false, error: "Sekme yok" });
      wake(t); active.set(t.worldId, t.id); bring(t.worldId); layout(); push();
      return send(200, { ok: true });
    }
    // Rou işini bitirince kendi sekmesini kapatır (sekmeler birikmesin).
    if (url.pathname === "/close" && req.method === "POST") {
      const { tabId } = await body();
      const t = tabs.get(tabId) ?? [...tabs.values()].find((x) => x.targetId === tabId);
      if (t) { quietEnd(t); closeTab(t.id); }
      return send(200, { ok: !!t });
    }
    if (url.pathname === "/who" && req.method === "POST") {
      const { tabId, who } = await body();
      const t = tabs.get(tabId) ?? [...tabs.values()].find((x) => x.targetId === tabId);
      if (t) { t.who = who || ""; if (!t.who) quietEnd(t); push(); }
      return send(200, { ok: !!t });
    }
    if (url.pathname === "/shot") {
      const t = tabs.get(url.searchParams.get("tab")) ?? [...tabs.values()].find((x) => x.targetId === url.searchParams.get("tab"));
      if (!t) return send(404, { ok: false });
      const w = Math.min(1280, Number(url.searchParams.get("w")) || 640);
      // Görünen sekme anlık çekilir; görünmeyen için son görüntü.
      if (t.view && win.contentView.children.includes(t.view)) {
        const img = await t.view.webContents.capturePage().catch(() => null);
        if (img && !img.isEmpty()) t.shot = img.resize({ width: Math.min(w, img.getSize().width) }).toJPEG(60);
      }
      return t.shot ? send(200, t.shot, "image/jpeg") : send(404, { ok: false });
    }
    if (url.pathname === "/worlds" && req.method === "POST") { await loadWorlds(); return send(200, { ok: true }); }
    // Mac bildirimi uygulamanın kendi adı ve ikonuyla (osascript bildirimi Betik Düzenleyici adına çıkar, tıklayınca onu açar).
    if (url.pathname === "/notify" && req.method === "POST") {
      const { title, text } = await body();
      if (!Notification.isSupported()) return send(200, { ok: false });
      const n = new Notification({ title: "Playgrounds", subtitle: String(title || ""), body: String(text || "") });
      n.on("click", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); app.focus({ steal: true }); } });
      n.show();
      return send(200, { ok: true });
    }
    send(404, { ok: false });
  })().catch((e) => send(500, { ok: false, error: e.message }));
}

// ---- pencere ----
// Güncelleme (Playgrounds'taki gibi): uygulama açıldıktan sonra kod değiştiyse sağ altta "Güncelleme var · Güncelle". Dakikada bir ve pencere öne gelince bakılır.
// Yalnız arayüz (ui/) değiştiyse Güncelle arayüzü yerinde yeniler: pencere ve sekmeler kapanmaz. Ana süreç (main.mjs, shared/pb.mjs)
// değiştiyse yeniden başlamak şart; uygulama birkaç saniyede kendini yeniden açar, sekmeler ve bölmeler geri gelir.
let uiBase = Date.now();
const MAIN_BASE = uiBase;
// Playgrounds kabuğunda arayüz Playgrounds'un kendisi; onun güncellemesini Playgrounds yapar.
const UI_FILES = () => SHELL ? [] : fs.readdirSync(path.join(DIR, "ui")).map((f) => path.join(DIR, "ui", f));
const MAIN_FILES = [path.join(DIR, "main.mjs"), path.join(DIR, "..", "shared", "pb.mjs")];
const newer = (files, t) => { try { return files.some((f) => fs.statSync(f).mtimeMs > t); } catch { return false; } };
const UPD_HTML = `<!doctype html><meta charset="utf-8"><style>
:root{--panel:#fff;--ink:#17151d;--line:rgb(23 21 29/.08);--acc:#5b3df0}
@media (prefers-color-scheme:dark){:root{--panel:#1c1a23;--ink:#f1f0f5;--line:rgb(255 255 255/.1);--acc:#8f7bff}}
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
body{display:flex;align-items:flex-end;justify-content:flex-end;padding:0 16px 16px 0;box-sizing:border-box;font:550 13px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.bar{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-radius:14px;background:var(--panel);color:var(--ink);border:1px solid var(--line);box-shadow:0 14px 40px -12px rgb(16 24 40/.28);animation:in .25s cubic-bezier(.23,1,.32,1)}
svg{color:var(--acc);flex:none}
button{font:600 12px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;height:28px;padding:0 12px;border:0;border-radius:9px;background:var(--acc);color:#fff}
body.busy button{display:none} body.busy svg{animation:spin 1s linear infinite}
@keyframes in{from{opacity:0;transform:translateY(12px) scale(.97)}} @keyframes spin{to{transform:rotate(360deg)}}</style>
<div class="bar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>
<span id="t">Güncelleme var</span><button onclick="document.body.className='busy';document.getElementById('t').textContent='Güncelleniyor…';console.log('pb:update')">Güncelle</button></div>`;
let updView = null;
function checkUpdate() {
  if (updView || !win || win.isDestroyed()) return;
  const restart = newer(MAIN_FILES, MAIN_BASE);
  if (!restart && !newer(UI_FILES(), uiBase)) return;
  updView = new WebContentsView();
  updView.setBackgroundColor("#00000000");
  updView.webContents.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(UPD_HTML.replace("Güncelleniyor…", restart ? "Yeniden açılıyor…" : "Güncelleniyor…")));
  // Düğme konsola yazar (data: sayfasında hash olayı gelmiyor).
  updView.webContents.on("console-message", (e) => {
    if (e.message !== "pb:update") return;
    if (!newer(MAIN_FILES, MAIN_BASE)) {
      uiBase = Date.now();
      ui.webContents.reload();
      ui.webContents.once("did-finish-load", () => push());
      win.contentView.removeChildView(updView); updView.webContents.close(); updView = null;
      return;
    }
    // Kilit bırakılır ki yeni açılan kopya kendini kapatmasın.
    saveNow(); app.releaseSingleInstanceLock(); app.relaunch(); app.exit(0);
  });
  placeUpdate();
}
function placeUpdate() {
  if (!updView) return;
  const b = win.getContentBounds(), w = 290, h = 80;
  updView.setBounds({ x: b.width - w, y: b.height - h, width: w, height: h });
  win.contentView.addChildView(updView);
}

// ⌘Q hemen kapatmaz: üstte "tekrar bas" uyarısı çıkar, 2 sn içinde ikinci ⌘Q kapatır. Dock'tan Çık ve oturum kapatma etkilenmez.
const QUIT_HTML = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}
body{display:grid;place-items:center;font:600 13px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
div{display:flex;align-items:center;gap:8px;height:36px;padding:0 16px;border-radius:999px;background:rgb(23 21 29/.86);color:#fff;box-shadow:0 8px 24px -8px rgb(0 0 0/.35);animation:in .18s ease-out}
kbd{font:inherit;padding:3px 7px;border-radius:6px;background:rgb(255 255 255/.16)}
@keyframes in{from{opacity:0;transform:translateY(-6px)}}</style><div>Çıkmak için <kbd>⌘Q</kbd> tuşuna tekrar bas</div>`;
let quitAt = 0, quitView = null, quitT = null;
function askQuit() {
  if (Date.now() - quitAt < 2000 || !win || win.isDestroyed()) return app.quit();
  quitAt = Date.now();
  if (!quitView) {
    quitView = new WebContentsView();
    quitView.setBackgroundColor("#00000000");
    quitView.webContents.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(QUIT_HTML));
  } else quitView.webContents.reload();
  const b = win.getContentBounds(), w = 300, h = 52;
  quitView.setBounds({ x: Math.round((b.width - w) / 2), y: 12, width: w, height: h });
  win.contentView.addChildView(quitView);
  clearTimeout(quitT);
  quitT = setTimeout(() => { quitAt = 0; win?.contentView.removeChildView(quitView); }, 2000);
}

function menu() {
  if (SHELL) return shellMenu();
  const cur = () => tabs.get(active.get(focus));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: NAME, submenu: [{ role: "about", label: `${NAME} hakkında` }, { type: "separator" }, { role: "hide", label: "Gizle" }, { role: "hideOthers", label: "Diğerlerini gizle" }, { type: "separator" }, { label: "Çık", accelerator: "CmdOrCtrl+Q", click: askQuit }] },
    { label: "Dosya", submenu: [
      { label: "Yeni sekme", accelerator: "CmdOrCtrl+T", click: () => { if (focus) { newTab(focus, ""); ui.webContents.send("focusAddress"); } } },
      { label: "Sekmeyi kapat", accelerator: "CmdOrCtrl+W", click: () => cur() && closeTab(cur().id) },
      { label: "Adres", accelerator: "CmdOrCtrl+L", click: () => ui.webContents.send("focusAddress") },
    ] },
    { label: "Düzen", submenu: [{ role: "undo", label: "Geri al" }, { role: "redo", label: "Yinele" }, { type: "separator" }, { role: "cut", label: "Kes" }, { role: "copy", label: "Kopyala" }, { role: "paste", label: "Yapıştır" }, { role: "selectAll", label: "Tümünü seç" }] },
    { label: "Görünüm", submenu: [
      { label: "Kenar çubuğunu daralt", accelerator: "CmdOrCtrl+\\", click: () => ui.webContents.send("toggleSide") },
      { type: "separator" },
      { label: "Yenile", accelerator: "CmdOrCtrl+R", click: () => (cur() && wake(cur()).webContents)?.reload() },
      { label: "Geri", accelerator: "CmdOrCtrl+[", click: () => (cur() && wake(cur()).webContents)?.navigationHistory.goBack() },
      { label: "İleri", accelerator: "CmdOrCtrl+]", click: () => (cur() && wake(cur()).webContents)?.navigationHistory.goForward() },
      { type: "separator" },
      ...Array.from({ length: 9 }, (_, i) => ({ label: `${i + 1}. dünya`, accelerator: `CmdOrCtrl+${i + 1}`, click: () => worlds[i] && bring(worlds[i].id) })),
      { type: "separator" },
      { label: "Geliştirici araçları (sayfa)", accelerator: "Alt+CmdOrCtrl+I", click: () => (cur() && wake(cur()).webContents)?.openDevTools({ mode: "detach" }) },
    ] },
    { role: "windowMenu", label: "Pencere" },
  ]));
}

// ---- Playgrounds kabuğu (PG_SHELL=app) ----
// Eski Mac uygulamasının (mac/Playgrounds.swift) işleri: sunucu yoksa derleyip başlatır, son sayfa ve yakınlaştırma hatırlanır,
// pencereyi kapatmak uygulamayı kapatmaz (hatırlatmalar sürer), dış bağlantılar varsayılan tarayıcıda, mikrofon yalnız Playgrounds'a.
const ROOT = path.join(DIR, "..");
const PG_PORT = Number(new URL(PG).port || 5340);
const LOG = path.join(os.homedir(), "Library", "Logs", "Playgrounds.log");
const SHELL_FILE = () => path.join(app.getPath("userData"), "pg-shell.json");
const isLocal = (u) => { try { const x = new URL(u); return ["localhost", "127.0.0.1"].includes(x.hostname) && Number(x.port) === PG_PORT; } catch { return false; } };
let server = null, quitting = false, uiFocus = true;
const splash = (text) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;font:500 15px -apple-system,system-ui;color:#8a919e;background:#f4f5f7"><style>@media (prefers-color-scheme: dark){body{background:#0a0b0e!important}}</style><div>${text}</div>`);
const alive = () => fetch(`${PG}/api/backups`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
// Kaynak dist'ten yeniyse önce derler. Finder'dan açılınca PATH boş gelir; node ve claude yolları eklenir.
function launchServer() {
  const script = `NVM_NODE=$(ls -d $HOME/.nvm/versions/node/*/bin 2>/dev/null | tail -1)
export PATH="$HOME/.local/bin:$NVM_NODE:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "${ROOT}" || exit 1
echo "--- $(date) başlıyor (Playgrounds kabuğu)"
if [ ! -f dist/index.html ] || [ -n "$(find src shared index.html public -newer dist/index.html -print -quit)" ]; then npx vite build || exit 1; fi
exec node server/serve.mjs`;
  const out = fs.openSync(LOG, "a");
  server = spawn("/bin/zsh", ["-c", script], { stdio: ["ignore", out, out] });
  server.on("exit", () => { server = null; });
}
// Sunucu bir sebeple kapanırsa (çökme, elle durdurma) dakikada bir bakılır ve yeniden başlatılır; sayfa bağlantıyı kendisi tazeler.
async function keepServer() {
  if (quitting || server || (await alive())) return;
  launchServer();
}
async function startPlaygrounds() {
  const st = readJson(SHELL_FILE(), {});
  const go = () => {
    ui.webContents.setZoomFactor(st.zoom || 1);
    ui.webContents.loadURL(`${PG}/${st.route ? `#${st.route}` : ""}`);
  };
  if (await alive()) return go();
  launchServer();
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await alive()) return go();
    if (!server) break;
  }
  ui.webContents.loadURL(splash("Sunucu başlamadı. Ayrıntı: ~/Library/Logs/Playgrounds.log"));
}
function remember() {
  if (!ui || ui.webContents.isDestroyed()) return;
  const u = ui.webContents.getURL();
  if (!isLocal(u)) return;
  fs.writeFileSync(SHELL_FILE(), JSON.stringify({ ...readJson(SHELL_FILE(), {}), route: new URL(u).hash.slice(1), zoom: ui.webContents.getZoomFactor() }));
}
async function shellWindow() {
  win = new BaseWindow({ width: 1440, height: 940, minWidth: 390, minHeight: 560, backgroundColor: "#f4f5f7", title: NAME, show: false });
  ui = new WebContentsView({ webPreferences: { preload: path.join(DIR, "ui", "preload.cjs"), contextIsolation: true, sandbox: false, spellcheck: true, additionalArguments: ["--pg-shell"] } });
  ui.setBackgroundColor("#00000000");
  win.contentView.addChildView(ui);
  const fit = () => { const b = win.getContentBounds(); ui.setBounds({ x: 0, y: 0, width: b.width, height: b.height }); };
  fit(); win.on("resize", fit);
  const wc = ui.webContents;
  // Playgrounds dışındaki web adresleri uygulamanın tarayıcısında, açık dünyada (yoksa öndeki bölmede) yeni sekmede açılır.
  // Web olmayanlar (mailto: gibi) sistemde açılır; gömülü içerik (iframe) yerinde kalır.
  const openInside = (u) => {
    if (!/^https?:/i.test(u)) return shell.openExternal(u);
    const lens = decodeURIComponent(new URL(wc.getURL()).hash.slice(1).split("/")[1] ?? "");
    const worldId = [lens, focus, shown[0], worlds[0]?.id].find((id) => id && worldOf(id));
    if (!worldId) return shell.openExternal(u);
    newTab(worldId, u);
    bring(worldId);
  };
  wc.setWindowOpenHandler(({ url: u }) => { if (!isLocal(u)) openInside(u); return { action: "deny" }; });
  wc.on("will-navigate", (e, u) => { if (!isLocal(u) && !u.startsWith("data:")) { e.preventDefault(); openInside(u); } });
  wc.on("render-process-gone", () => setTimeout(() => wc.reload(), 500));
  wc.on("did-finish-load", () => { rects = {}; browserOpen = false; layout(); push(); });
  wc.on("focus", () => { uiFocus = true; });
  wc.on("context-menu", (_e, p) => {
    const items = p.isEditable ? [{ role: "cut", label: "Kes" }, { role: "copy", label: "Kopyala" }, { role: "paste", label: "Yapıştır" }, { type: "separator" }, { role: "selectAll", label: "Tümünü seç" }]
      : p.selectionText ? [{ role: "copy", label: "Kopyala" }] : p.linkURL ? [{ label: "Bağlantıyı kopyala", click: () => clipboard.writeText(p.linkURL) }] : [];
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
  // Mikrofon yalnız Playgrounds'un kendi sayfasına (Rou'ya sesle yazma); bildirimler de.
  wc.session.setPermissionRequestHandler((w, perm, cb, d) => cb(isLocal(d.requestingUrl || w.getURL()) && ["media", "notifications", "clipboard-read", "clipboard-sanitized-write"].includes(perm)));
  wc.session.setPermissionCheckHandler((w, perm, origin) => isLocal(origin) && ["media", "notifications", "clipboard-read", "clipboard-sanitized-write"].includes(perm));
  wc.loadURL(splash("Açılıyor…"));
  win.show();
  // Kapatınca gizlenir (Dock'tan geri gelir); ⌘Q ile kapanır.
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); remember(); win.hide(); } });
  win.on("blur", remember);
  app.on("before-quit", () => { quitting = true; remember(); server?.kill("SIGTERM"); });
  // Girişte başlatma kapalı gelir; menüden açılır.
  if (systemPreferences.getMediaAccessStatus("microphone") === "not-determined") systemPreferences.askForMediaAccess("microphone").catch(() => {});
  await startPlaygrounds();
}
// Tarayıcıda çalışılan sekme: odak bir sekmedeyse ⌘R/⌘W/⌘[ ona gider, değilse Playgrounds'a.
function shellMenu() {
  const cur = () => tabs.get(active.get(focus));
  const onTab = () => !uiFocus && browserOpen && cur();
  const zoom = (f) => { const wc = ui.webContents; wc.setZoomFactor(f(wc.getZoomFactor())); remember(); layout(); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: NAME, submenu: [
      { label: "Girişte başlat", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
      { type: "separator" }, { role: "hide", label: "Playgrounds'u gizle" }, { role: "hideOthers", label: "Diğerlerini gizle" }, { type: "separator" },
      { label: "Playgrounds'tan çık", accelerator: "CmdOrCtrl+Q", click: askQuit },
    ] },
    { label: "Düzen", submenu: [{ role: "undo", label: "Geri al" }, { role: "redo", label: "Yinele" }, { type: "separator" }, { role: "cut", label: "Kes" }, { role: "copy", label: "Kopyala" }, { role: "paste", label: "Yapıştır" }, { role: "selectAll", label: "Tümünü seç" }] },
    { label: "Görünüm", submenu: [
      { label: "Yenile", accelerator: "CmdOrCtrl+R", click: () => (onTab() ? wake(cur()).webContents.reload() : ui.webContents.reload()) },
      { label: "Büyüt", accelerator: "CmdOrCtrl+Plus", click: () => zoom((z) => Math.min(2, z + 0.1)) },
      { label: "Küçült", accelerator: "CmdOrCtrl+-", click: () => zoom((z) => Math.max(0.6, z - 0.1)) },
      { label: "Gerçek boyut", accelerator: "CmdOrCtrl+0", click: () => zoom(() => 1) },
      { type: "separator" },
      { label: "Varsayılan tarayıcıda aç", accelerator: "Shift+CmdOrCtrl+O", click: () => shell.openExternal(ui.webContents.getURL()) },
    ] },
    { label: "Tarayıcı", submenu: [
      { label: "Yeni sekme", accelerator: "CmdOrCtrl+T", click: () => { const w = focus || shown[0] || worlds[0]?.id; if (!w) return; bring(w); newTab(w, ""); ui.webContents.send("focusAddress"); } },
      { label: "Sekmeyi kapat", accelerator: "CmdOrCtrl+W", click: () => (browserOpen && cur() ? closeTab(cur().id) : win.close()) },
      { label: "Adres", accelerator: "CmdOrCtrl+L", click: () => browserOpen && ui.webContents.send("focusAddress") },
      { label: "Geri", accelerator: "CmdOrCtrl+[", click: () => (cur() && wake(cur()).webContents)?.navigationHistory.goBack() },
      { label: "İleri", accelerator: "CmdOrCtrl+]", click: () => (cur() && wake(cur()).webContents)?.navigationHistory.goForward() },
      { type: "separator" },
      { label: "Geliştirici araçları (sayfa)", accelerator: "Alt+CmdOrCtrl+I", click: () => (onTab() ? wake(cur()).webContents.openDevTools({ mode: "detach" }) : ui.webContents.openDevTools({ mode: "detach" })) },
    ] },
    { label: "Pencere", submenu: [{ role: "minimize", label: "Küçült" }, { label: "Kapat", accelerator: "Shift+CmdOrCtrl+W", click: () => win.close() }] },
  ]));
}
// Tarayıcı sayfası açık mı (arayüz alan bildirdiyse).
let browserOpen = false;

app.whenReady().then(async () => {
  nativeTheme.themeSource = "system";
  // İndirilenler sorusuz İndirilenler klasörüne.
  app.on("session-created", (s) => s.on("will-download", (_e, item) => item.setSavePath(path.join(os.homedir(), "Downloads", item.getFilename()))));
  const saved = readJson(STATE_FILE(), { shown: [], tabs: [] });
  if (SHELL) await shellWindow();
  else {
    win = new BaseWindow({ width: 1440, height: 920, minWidth: 760, minHeight: 520, titleBarStyle: "hiddenInset", trafficLightPosition: { x: 18, y: 18 }, backgroundColor: "#f3f1f7", title: NAME, show: false });
    ui = new WebContentsView({ webPreferences: { preload: path.join(DIR, "ui", "preload.cjs"), contextIsolation: true, sandbox: false } });
    win.contentView.addChildView(ui);
    const fit = () => { const b = win.getContentBounds(); ui.setBounds({ x: 0, y: 0, width: b.width, height: b.height }); };
    fit(); win.on("resize", fit);
    ui.webContents.loadFile(path.join(DIR, "ui", "index.html"));
    ui.webContents.once("did-finish-load", () => { win.show(); push(); });
    win.on("closed", () => app.quit());
  }
  menu();
  worlds = readJson(WORLDS_FILE(), []);
  await loadWorlds();
  for (const t of saved.tabs ?? []) if (worldOf(t.worldId) && t.url) newTab(t.worldId, t.url, { activate: t.active, asleep: true, title: t.title });
  show(saved.shown?.length ? saved.shown : worlds.slice(0, 1).map((w) => w.id), saved.focus);
  setInterval(() => { loadWorlds(); checkUpdate(); sleepIdle(); if (SHELL) keepServer(); }, 60000);
  win.on("focus", checkUpdate); win.on("resize", placeUpdate);
  http.createServer(api).listen(API_PORT, "127.0.0.1");
});
app.on("second-instance", () => { if (win) { win.show(); app.focus({ steal: true }); } });
app.on("activate", () => win?.show());
app.on("web-contents-created", (_e, wc) => { wc.on("will-attach-webview", (ev) => ev.preventDefault()); });
