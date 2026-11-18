// Playgrounds desktop app (Electron = Chromium). It runs in one of two shells:
// - Default (PG_SHELL=app or unset): the window shows Playgrounds itself; the Browser page reports where the tabs go and the real
//   tabs sit there. It starts the server with Electron's own Node (ELECTRON_RUN_AS_NODE) and handles the login item, microphone and outside links.
//   In a packaged install (electron-builder, build/dist.mjs) the code is inside the app and data is in the user folder (userData/data).
//   Run from the repo (`npm run desktop`, browser/build.sh) it uses the repo: it builds first if the source is newer, and data is the repo's data/.
// - PG_SHELL=browser: a separate browser UI (ui/), worlds on the left, panes on the right.
// Both use the same data (sessions, tabs); only one can be open at a time. Each world is its own session partition (persist:pg-<world>),
// all live at once; the window shows one or several worlds side by side. Rou connects through the DevTools port (127.0.0.1:9333).
// Control API: 127.0.0.1:9334 (this computer only; the "x-pg" header is required so web pages cannot call it). The Playgrounds server (server/pb.mjs)
// and `pg pb` use it: bring a profile forward, open a tab, Rou label, tab image, logins.
import { app, BaseWindow, BrowserWindow, WebContentsView, Menu, ipcMain, session, clipboard, shell, nativeTheme, systemPreferences, Notification, dialog } from "electron";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { SITES, loginsFromCookies } from "../shared/pb.mjs";

const SHELL = process.env.PG_SHELL !== "browser";
const NAME = SHELL ? "Playgrounds" : "Playground Browser";
const MAC = process.platform === "darwin";
// The DevTools port (Rou's browser tools) must be set before Chromium starts; if it is taken (another Playgrounds is open) a free port is picked,
// or Rou would drive that app's tabs. The control API is the same: 9333/9334 preferred, a free port if taken; the server learns it through the environment.
function freePortSync(want) {
  const js = `const s=require("net").createServer();s.once("error",()=>{const t=require("net").createServer();t.listen(0,"127.0.0.1",()=>{process.stdout.write(String(t.address().port));t.close();});});s.listen(${want},"127.0.0.1",()=>{process.stdout.write("${want}");s.close();});`;
  try { return Number(execFileSync(process.execPath, ["-e", js], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", timeout: 5000, windowsHide: true })) || want; } catch { return want; }
}
const CDP_PORT = freePortSync(Number(process.env.PB_PORT || 9333));
const API_PORT = Number(process.env.PB_API_PORT || 9334);
let apiPort = API_PORT;
// The Playgrounds server address; in the shell the port is picked at startup (pickPort).
let PG = process.env.PG_URL || "http://127.0.0.1:5340";
const DIR = path.dirname(fileURLToPath(import.meta.url));

app.setName(NAME);
// For Windows notifications and taskbar grouping.
if (process.platform === "win32") app.setAppUserModelId("app.playgrounds.desktop");
// Sessions, tabs and (in a packaged install) data: ~/Library/Application Support/Playgrounds, %APPDATA%\Playgrounds.
// PG_USER_DATA gives another folder (tests, screenshots).
app.setPath("userData", process.env.PG_USER_DATA || path.join(app.getPath("appData"), "Playgrounds"));
if (process.env.PG_USER_DATA) app.setAppLogsPath(path.join(process.env.PG_USER_DATA, "logs"));
app.commandLine.appendSwitch("remote-debugging-port", String(CDP_PORT));
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
// Sites should see Chrome, not Electron (some logins reject embedded browsers).
app.userAgentFallback = app.userAgentFallback.replace(/ (Electron|playground-browser|Playground ?Browser|Playgrounds)\/\S+/gi, "");

if (!app.requestSingleInstanceLock()) app.quit();

const STATE_FILE = () => path.join(app.getPath("userData"), "pb-state.json");
const WORLDS_FILE = () => path.join(app.getPath("userData"), "pb-worlds.json");
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

let win, ui;
let worlds = [];           // [{ id, name, color, accounts: [{ id, platform, name, handle, login, secret }] }]
let shown = [];            // worlds shown in the window (in order)
let focus = null;          // the active world (keyboard, new tab)
const tabs = new Map();    // id → { id, worldId, view, url, title, favicon, loading, who, targetId, shot }
const active = new Map();  // worldId → active tab id
let rects = {};            // worldId → the pane's page area (from the UI)
let tabSeq = 0;

const SITE_INFO = Object.fromEntries(Object.entries(SITES).map(([k, v]) => [k, { hosts: v.hosts, home: v.home, login: v.login }]));
const part = (worldId) => `persist:pg-${worldId}`;
const worldOf = (id) => worlds.find((w) => w.id === id);

// ---- state: save it and send it to the UI ----
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

// ---- tabs ----
// A tab's record (address, title) is separate from its page (a WebContentsView, its own renderer process): a tab that is not visible and has not
// been looked at for a while sleeps (the page closes, the address stays) and reloads at the same address when shown or acted on. Tabs start asleep at launch.
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
// Opens a sleeping tab's page (leaves it alone if already open); every path that acts on a page goes through this.
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
  // A popup (like OAuth, with a size) becomes a small separate window in the same session; anything else becomes a new tab in the same world.
  wc.setWindowOpenHandler(({ url: u, features, disposition }) => {
    // A page may open web addresses only: an address like file:// would show a file from disk when loaded from the main process.
    if (!/^(https?:|about:blank)/i.test(u)) return { action: "deny" };
    // While Rou works, a page cannot open new tabs or windows: the address opens in the same tab (so tabs and windows do not pile up).
    if (t.who) { wc.loadURL(u).catch(() => {}); return { action: "deny" }; }
    if (disposition === "new-window" && /width|height/.test(features)) {
      // Same session as the opener (the world's partition); if a partition is given Electron opens a new context, window.opener breaks and Google sign-in stays blank.
      return { action: "allow", overrideBrowserWindowOptions: { width: 520, height: 680 } };
    }
    newTab(worldId, u, { activate: disposition !== "background-tab" });
    return { action: "deny" };
  });
  // On the way to Google sign-in, if this world has no Google session, the one from another world is brought over (Google rejects a fresh sign-in here but not an account pick).
  const toGoogle = (e) => {
    if (t.googleShared || !(e.isMainFrame ?? true) || !isGoogleAuth(e.url)) return;
    t.googleShared = true;
    e.preventDefault();
    shareGoogle(worldId).catch(() => {}).finally(() => wc.loadURL(e.url).catch(() => {}));
  };
  // Small windows opened from this tab (sign-in popups) close with the tab.
  wc.on("did-create-window", (w) => { (t.kids ??= []).push(w); w.on("closed", () => { t.kids = (t.kids ?? []).filter((x) => x !== w); }); });
  wc.on("will-navigate", toGoogle);
  wc.on("will-redirect", toGoogle);
  wc.on("context-menu", (_e, p) => contextMenu(t, p));
  // DevTools target id: Rou finds the tab with it.
  try {
    wc.debugger.attach("1.3");
    wc.debugger.sendCommand("Target.getTargetInfo").then((r) => { t.targetId = r.targetInfo.targetId; }).catch(() => {}).finally(() => { try { wc.debugger.detach(); } catch {} });
  } catch {}
  if (t.url) wc.loadURL(t.url).catch(() => {});
  return view;
}
// Rou's background tabs live in a hidden window: the page thinks it is visible, so it paints and is not throttled (Rou takes
// screenshots over CDP), but nothing comes to the front. If the user opens the tab in Browser the page moves to the main window and returns when it leaves.
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
// Closes the page and keeps the record. A tab is not put to sleep while Rou works, audio plays or it is visible in the window.
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

// Each shown world's active tab is placed in its pane; other tabs are taken out of the window (they keep running in the background).
// The area comes in the UI's CSS pixels (multiplied by the zoom). covered: something from the UI is on top of the area (a window, a menu, Rou);
// the tab is pulled out for that time and its last image stays in its place (captured before it is removed and sent to the UI).
function layout() {
  if (!win) return;
  const want = new Set(shown.map((w) => active.get(w)).filter(Boolean));
  const z = ui?.webContents.getZoomFactor() ?? 1;
  for (const t of tabs.values()) {
    const r = rects[t.worldId];
    // An empty tab (no address) gets no page: Playgrounds' own empty-tab screen (accounts, search) shows in its place.
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
  // Notices stay above the pages.
  const kids = win.contentView.children;
  for (const v of [updView, quitView]) if (v && kids.includes(v) && kids.at(-1) !== v) win.contentView.addChildView(v);
}

function show(list, f) {
  shown = [...new Set(list.filter((id) => worldOf(id)))].slice(0, 4);
  focus = f && shown.includes(f) ? f : shown[0] ?? null;
  // In its own UI the areas are measured again; in the Playgrounds shell the page reports on every frame (when changed) and the old ones stay.
  if (!SHELL) rects = {};
  push(); save();
}

// Brings a world forward: if already visible only the focus moves; otherwise it is shown alone.
function bring(worldId) {
  if (!shown.includes(worldId)) show([worldId], worldId);
  else { focus = worldId; push(); }
  // In the Playgrounds shell the Browser page opens.
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
  if (p.linkURL) items.push({ label: "Open link in new tab", click: () => newTab(t.worldId, p.linkURL) }, { label: "Copy link", click: () => clipboard.writeText(p.linkURL) }, { type: "separator" });
  if (p.isEditable) items.push({ role: "cut", label: "Cut" }, { role: "copy", label: "Copy" }, { role: "paste", label: "Paste" }, { type: "separator" });
  else if (p.selectionText) items.push({ role: "copy", label: "Copy" }, { type: "separator" });
  const site = hostOf(t.url);
  items.push({ label: "Back", enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() }, { label: "Reload", click: () => wc.reload() }, { type: "separator" }, { label: "Inspect", click: () => wc.inspectElement(p.x, p.y) });
  Menu.buildFromTemplate(items).popup();
}

// ---- Google oturumu ----
// A Google session that is open in one world is copied into another world's partition that reaches Google sign-in.
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
// ---- worlds: from Playgrounds (the last known ones if it is closed) ----
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

// Login: only the name and expiry of the cookies in the world's partition.
const logins = new Map();
// When a session cookie is added or removed (sign-in, sign-out) the chip updates at once, without waiting for /state or a world reload.
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

// ---- from the UI ----
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
    // Tabs are reordered by dragging: the world's tabs take the given order, other worlds' tabs stay in place.
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

// ---- control API ----
const tabOut = (t) => ({ id: t.id, worldId: t.worldId, url: t.url, title: t.title, who: t.who, targetId: t.targetId, active: active.get(t.worldId) === t.id, visible: shown.includes(t.worldId) && active.get(t.worldId) === t.id });
function api(req, res) {
  const send = (code, body, type = "application/json") => { res.writeHead(code, { "content-type": type, "cache-control": "no-store" }); res.end(type === "application/json" ? JSON.stringify(body) : body); };
  // The Host is checked too: a foreign domain that resolves to 127.0.0.1 (DNS rebinding) could add the x-pg header itself.
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
      if (!worldOf(worldId)) { await loadWorlds(); if (!worldOf(worldId)) return send(404, { ok: false, error: "No such world" }); }
      // Background work (Rou): the window does not come forward, the page does not change, the user's tab is not touched. A new, inactive tab
      // runs without being put in the window (quietRun: painted unseen, not throttled); it shows with its label in the tab row in Browser.
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
      if (!t) return send(404, { ok: false, error: "No such tab" });
      wake(t); active.set(t.worldId, t.id); bring(t.worldId); layout(); push();
      return send(200, { ok: true });
    }
    // When Rou finishes it closes its own tab (so tabs do not pile up).
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
      // A visible tab is captured live; a hidden one returns its last image.
      if (t.view && win.contentView.children.includes(t.view)) {
        const img = await t.view.webContents.capturePage().catch(() => null);
        if (img && !img.isEmpty()) t.shot = img.resize({ width: Math.min(w, img.getSize().width) }).toJPEG(60);
      }
      return t.shot ? send(200, t.shot, "image/jpeg") : send(404, { ok: false });
    }
    if (url.pathname === "/worlds" && req.method === "POST") { await loadWorlds(); return send(200, { ok: true }); }
    // A Mac notification under the app's own name and icon (an osascript notification shows under Script Editor and opens it on click).
    if (url.pathname === "/notify" && req.method === "POST") {
      const { title, text } = await body();
      if (!Notification.isSupported()) return send(200, { ok: false });
      // On macOS the title is the app name and the subject the subtitle; Windows has no subtitle, so the subject becomes the title.
      const n = new Notification(MAC ? { title: "Playgrounds", subtitle: String(title || ""), body: String(text || "") } : { title: String(title || "Playgrounds"), body: String(text || "") });
      n.on("click", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); app.focus({ steal: true }); } });
      n.show();
      return send(200, { ok: true });
    }
    send(404, { ok: false });
  })().catch((e) => send(500, { ok: false, error: e.message }));
}

// ---- window ----
// Update (as in Playgrounds): if the code changed after the app opened, "Update available · Update" shows bottom right. It is checked every minute and when the window comes forward.
// If only the UI (ui/) changed, Update reloads the UI in place: the window and tabs stay open. If the main process (main.mjs, shared/pb.mjs)
// changed, a restart is required; the app reopens itself in a few seconds and the tabs and panes come back.
let uiBase = Date.now();
const MAIN_BASE = uiBase;
// In the Playgrounds shell the UI is Playgrounds itself; Playgrounds handles its own update.
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
<span id="t">Update available</span><button onclick="document.body.className='busy';document.getElementById('t').textContent='Updating…';console.log('pb:update')">Update</button></div>`;
let updView = null;
function checkUpdate() {
  if (updView || !win || win.isDestroyed()) return;
  const restart = newer(MAIN_FILES, MAIN_BASE);
  if (!restart && !newer(UI_FILES(), uiBase)) return;
  updView = new WebContentsView();
  updView.setBackgroundColor("#00000000");
  updView.webContents.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(UPD_HTML.replace("Updating…", restart ? "Reopening…" : "Updating…")));
  // The button writes to the console (a data: page gets no hash event).
  updView.webContents.on("console-message", (e) => {
    if (e.message !== "pb:update") return;
    if (!newer(MAIN_FILES, MAIN_BASE)) {
      uiBase = Date.now();
      ui.webContents.reload();
      ui.webContents.once("did-finish-load", () => push());
      win.contentView.removeChildView(updView); updView.webContents.close(); updView = null;
      return;
    }
    // The lock is released so the newly opened copy does not close itself.
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

// ⌘Q does not quit at once: a "press again" notice shows on top and a second ⌘Q within 2 s quits. Quit from the Dock and logging out are not affected.
const QUIT_HTML = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}
body{display:grid;place-items:center;font:600 13px/1 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
div{display:flex;align-items:center;gap:8px;height:36px;padding:0 16px;border-radius:999px;background:rgb(23 21 29/.86);color:#fff;box-shadow:0 8px 24px -8px rgb(0 0 0/.35);animation:in .18s ease-out}
kbd{font:inherit;padding:3px 7px;border-radius:6px;background:rgb(255 255 255/.16)}
@keyframes in{from{opacity:0;transform:translateY(-6px)}}</style><div>Press <kbd>${MAC ? "⌘Q" : "Ctrl+Q"}</kbd> again to quit</div>`;
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
    { label: NAME, submenu: [{ role: "about", label: `About ${NAME}` }, { type: "separator" }, { role: "hide", label: "Hide" }, { role: "hideOthers", label: "Hide others" }, { type: "separator" }, { label: "Quit", accelerator: "CmdOrCtrl+Q", click: askQuit }] },
    { label: "File", submenu: [
      { label: "New tab", accelerator: "CmdOrCtrl+T", click: () => { if (focus) { newTab(focus, ""); ui.webContents.send("focusAddress"); } } },
      { label: "Close tab", accelerator: "CmdOrCtrl+W", click: () => cur() && closeTab(cur().id) },
      { label: "Address", accelerator: "CmdOrCtrl+L", click: () => ui.webContents.send("focusAddress") },
    ] },
    { label: "Edit", submenu: [{ role: "undo", label: "Undo" }, { role: "redo", label: "Redo" }, { type: "separator" }, { role: "cut", label: "Cut" }, { role: "copy", label: "Copy" }, { role: "paste", label: "Paste" }, { role: "selectAll", label: "Select all" }] },
    { label: "View", submenu: [
      { label: "Collapse sidebar", accelerator: "CmdOrCtrl+\\", click: () => ui.webContents.send("toggleSide") },
      { type: "separator" },
      { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => (cur() && wake(cur()).webContents)?.reload() },
      { label: "Back", accelerator: "CmdOrCtrl+[", click: () => (cur() && wake(cur()).webContents)?.navigationHistory.goBack() },
      { label: "Forward", accelerator: "CmdOrCtrl+]", click: () => (cur() && wake(cur()).webContents)?.navigationHistory.goForward() },
      { type: "separator" },
      ...Array.from({ length: 9 }, (_, i) => ({ label: `World ${i + 1}`, accelerator: `CmdOrCtrl+${i + 1}`, click: () => worlds[i] && bring(worlds[i].id) })),
      { type: "separator" },
      { label: "Developer tools (page)", accelerator: "Alt+CmdOrCtrl+I", click: () => (cur() && wake(cur()).webContents)?.openDevTools({ mode: "detach" }) },
    ] },
    { role: "windowMenu", label: "Window" },
  ]));
}

// ---- Playgrounds shell ----
// What the shell does: starts the server if there is none, remembers the last page and zoom, closing the window does not quit the app
// on macOS (reminders keep running), outside links open in the default browser, and the microphone is granted to Playgrounds only.
const ROOT = path.join(DIR, "..");
// Running from the repo (src/ exists) or from a packaged copy (only the built dist/, server/, shared/, scripts/).
const DEV = fs.existsSync(path.join(ROOT, "src"));
let PG_PORT = Number(new URL(PG).port || 5340);
const LOG = () => path.join(app.getPath("logs"), "Playgrounds.log");
const SHELL_FILE = () => path.join(app.getPath("userData"), "pg-shell.json");
// In a packaged install data is in the user folder; run from the repo it is the repo's data/ (PG_DATA wins in both).
const DATA = () => process.env.PG_DATA || (DEV ? "" : path.join(app.getPath("userData"), "data"));
const isLocal = (u) => { try { const x = new URL(u); return ["localhost", "127.0.0.1"].includes(x.hostname) && Number(x.port) === PG_PORT; } catch { return false; } };
let server = null, quitting = false, uiFocus = true;
const splash = (text) => "data:text/html;charset=utf-8," + encodeURIComponent(`<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;font:500 15px -apple-system,system-ui,sans-serif;color:#8a919e;background:#f4f5f7"><style>@media (prefers-color-scheme: dark){body{background:#0a0b0e!important}}</style><div>${text}</div>`);

// Identity: this install's token (userData/install.json) and a digest of the data folder. A server on the same port is used only if its identity
// matches (another Playgrounds may be running on 5340); if not, a free port is picked.
const TOKEN = (() => {
  const f = () => path.join(app.getPath("userData"), "install.json");
  const j = readJson(f(), {});
  if (j.token) return j.token;
  const token = crypto.randomUUID();
  try { fs.mkdirSync(path.dirname(f()), { recursive: true }); fs.writeFileSync(f(), JSON.stringify({ token })); } catch { /* tried again at the next launch */ }
  return token;
})();
const dataTag = (dir) => crypto.createHash("sha256").update(path.resolve(dir)).digest("hex").slice(0, 16);
const whoami = (port) => fetch(`http://127.0.0.1:${port}/api/whoami`, { signal: AbortSignal.timeout(1500) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
// Is it free: first it tries to connect (on macOS connecting to 127.0.0.1 succeeds even while a server listens on 0.0.0.0),
// then it tries to listen on all addresses.
const answers = (port) => new Promise((res) => { const c = net.connect(port, "127.0.0.1"); c.setTimeout(800); c.once("connect", () => { c.destroy(); res(true); }); c.once("error", () => res(false)); c.once("timeout", () => { c.destroy(); res(false); }); });
const bindable = (port) => new Promise((res) => { const t = net.createServer(); t.once("error", () => res(false)); t.listen(port, () => t.close(() => res(true))); });
const portFree = async (port) => !(await answers(port)) && (await bindable(port));
const anyPort = () => new Promise((res) => { const t = net.createServer(); t.listen(0, "127.0.0.1", () => { const { port } = t.address(); t.close(() => res(port)); }); });
const ours = (w) => w?.app === "playgrounds" && (w.token === TOKEN || w.data === dataTag(DATA() || path.join(ROOT, "data")));
async function pickPort() {
  const st = readJson(SHELL_FILE(), {});
  // Order: PORT, the port from last time (the page's local storage is tied to the port), 5340.
  for (const p of [...new Set([Number(process.env.PORT), st.port, 5340].filter((x) => x > 0))]) {
    const w = await whoami(p);
    if (ours(w)) return { port: p, running: true };
    if (!w && (await portFree(p))) return { port: p, running: false };
  }
  return { port: await anyPort(), running: false };
}
const alive = () => whoami(PG_PORT).then(ours);

// An app opened from Finder has a short PATH (/usr/bin:/bin...): claude, ffmpeg and whisper would not be found. PATH is read from the
// user's shell and the usual folders are added. On Windows PATH is used as it is.
function userPath() {
  const sep = path.delimiter;
  const list = String(process.env.PATH || "").split(sep);
  if (process.platform !== "win32") {
    try {
      const out = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "__PGPATH__%s" "$PATH"'], { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] });
      list.unshift(...(out.split("__PGPATH__")[1] ?? "").trim().split(sep));
    } catch { /* the shell could not be read: the usual folders are enough */ }
    list.push(path.join(os.homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
  }
  return [...new Set(list.filter(Boolean))].join(sep);
}
// In the repo, if the source is newer than dist it is built first (a packaged install ships dist ready).
function stale() {
  if (!DEV) return false;
  let built = 0;
  try { built = fs.statSync(path.join(ROOT, "dist", "index.html")).mtimeMs; } catch { return true; }
  const newer = (p) => { let st; try { st = fs.statSync(p); } catch { return false; } return st.isDirectory() ? fs.readdirSync(p).some((f) => f !== "node_modules" && newer(path.join(p, f))) : st.mtimeMs > built; };
  return ["src", "shared", "index.html", "public"].some((r) => newer(path.join(ROOT, r)));
}
// The server runs on Electron's own Node (no separate Node install needed). Its environment: data folder, port, the shell's ports, identity.
function serverEnv() {
  return {
    ...process.env, ELECTRON_RUN_AS_NODE: "1", PATH: userPath(), PORT: String(PG_PORT), PG_SHELL: "app", PG_INSTALL_TOKEN: TOKEN,
    PB_PORT: String(CDP_PORT), PB_API_PORT: String(apiPort), ...(DATA() ? { PG_DATA: DATA() } : {}), ...(DEV ? {} : { PG_PACKAGED: "1" }),
  };
}
function launchServer() {
  fs.mkdirSync(path.dirname(LOG()), { recursive: true });
  const out = fs.openSync(LOG(), "a");
  fs.writeSync(out, `--- ${new Date().toISOString()} starting (Playgrounds shell, port ${PG_PORT}${DEV ? ", repo" : ""})\n`);
  const env = serverEnv();
  const serve = () => {
    server = spawn(process.execPath, [path.join(ROOT, "server", "serve.mjs")], { cwd: ROOT, env, stdio: ["ignore", out, out], windowsHide: true });
    server.on("exit", () => { server = null; });
  };
  if (!stale()) return serve();
  server = spawn(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: ROOT, env, stdio: ["ignore", out, out], windowsHide: true });
  server.on("exit", (code) => { server = null; if (code === 0 && !quitting) serve(); });
}
// If the server stops for any reason (a crash, a manual stop) it is checked every minute and restarted; the page refreshes its connection by itself.
async function keepServer() {
  if (quitting || server || (await alive())) return;
  launchServer();
}
async function startPlaygrounds() {
  const st = readJson(SHELL_FILE(), {});
  if (!process.env.PG_URL) {
    const { port } = await pickPort();
    PG_PORT = port;
    PG = `http://127.0.0.1:${port}`;
    fs.writeFileSync(SHELL_FILE(), JSON.stringify({ ...readJson(SHELL_FILE(), {}), port }));
  }
  const go = () => {
    ui.webContents.setZoomFactor(st.zoom || 1);
    ui.webContents.loadURL(`${PG}/${st.route ? `#${st.route}` : ""}`);
  };
  if (await alive()) return go();
  if (process.env.PG_URL) return ui.webContents.loadURL(splash(`The server is not responding: ${PG}`));
  launchServer();
  for (let i = 0; i < 360; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await alive()) return go();
    if (!server && i > 4) break;
  }
  ui.webContents.loadURL(splash(`The server did not start. Details: ${LOG()}`));
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
  // Web addresses outside Playgrounds open in the app's browser, in a new tab of the open world (or the front pane if none).
  // Non-web ones (like mailto:) open in the system; embedded content (an iframe) stays in place.
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
    const items = p.isEditable ? [{ role: "cut", label: "Cut" }, { role: "copy", label: "Copy" }, { role: "paste", label: "Paste" }, { type: "separator" }, { role: "selectAll", label: "Select all" }]
      : p.selectionText ? [{ role: "copy", label: "Kopyala" }] : p.linkURL ? [{ label: "Copy link", click: () => clipboard.writeText(p.linkURL) }] : [];
    if (items.length) Menu.buildFromTemplate(items).popup();
  });
  // The microphone only for Playgrounds' own page (voice input to Rou); notifications too.
  wc.session.setPermissionRequestHandler((w, perm, cb, d) => cb(isLocal(d.requestingUrl || w.getURL()) && ["media", "notifications", "clipboard-read", "clipboard-sanitized-write"].includes(perm)));
  wc.session.setPermissionCheckHandler((w, perm, origin) => isLocal(origin) && ["media", "notifications", "clipboard-read", "clipboard-sanitized-write"].includes(perm));
  wc.loadURL(splash("Opening…"));
  win.show();
  // On macOS closing hides the window (it comes back from the Dock); ⌘Q quits. Windows has no Dock: closing quits the app.
  win.on("close", (e) => { if (!quitting && MAC) { e.preventDefault(); remember(); win.hide(); } });
  if (!MAC) win.on("closed", () => app.quit());
  win.on("blur", remember);
  // Quitting must not hang: the server is stopped; if Chromium hangs while closing (seen on SIGTERM; the main loop is stopped so a timer would not
  // run either) a separate watchdog process ends this process after 6 s.
  app.on("before-quit", () => { quitting = true; remember(); saveNow(); server?.kill("SIGTERM"); watchdog(); });
  // Open at login is off by default; it is turned on from the menu.
  if (MAC && systemPreferences.getMediaAccessStatus("microphone") === "not-determined") systemPreferences.askForMediaAccess("microphone").catch(() => {});
  await startPlaygrounds();
}
// The tab being worked in: if focus is on a tab, ⌘R/⌘W/⌘[ go to it, otherwise to Playgrounds.
function shellMenu() {
  const cur = () => tabs.get(active.get(focus));
  const onTab = () => !uiFocus && browserOpen && cur();
  const zoom = (f) => { const wc = ui.webContents; wc.setZoomFactor(f(wc.getZoomFactor())); remember(); layout(); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: NAME, submenu: [
      // The login item only if the user turns it on (off by default).
      { label: "Open at login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
      { type: "separator" }, ...(MAC ? [{ role: "hide", label: "Hide Playgrounds" }, { role: "hideOthers", label: "Hide others" }, { type: "separator" }] : []),
      { label: "Quit Playgrounds", accelerator: "CmdOrCtrl+Q", click: askQuit },
    ] },
    { label: "Edit", submenu: [{ role: "undo", label: "Undo" }, { role: "redo", label: "Redo" }, { type: "separator" }, { role: "cut", label: "Cut" }, { role: "copy", label: "Copy" }, { role: "paste", label: "Paste" }, { role: "selectAll", label: "Select all" }] },
    { label: "View", submenu: [
      { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => (onTab() ? wake(cur()).webContents.reload() : ui.webContents.reload()) },
      { label: "Zoom in", accelerator: "CmdOrCtrl+Plus", click: () => zoom((z) => Math.min(2, z + 0.1)) },
      { label: "Zoom out", accelerator: "CmdOrCtrl+-", click: () => zoom((z) => Math.max(0.6, z - 0.1)) },
      { label: "Actual size", accelerator: "CmdOrCtrl+0", click: () => zoom(() => 1) },
      { type: "separator" },
      { label: "Open in default browser", accelerator: "Shift+CmdOrCtrl+O", click: () => shell.openExternal(ui.webContents.getURL()) },
    ] },
    { label: "Browser", submenu: [
      { label: "New tab", accelerator: "CmdOrCtrl+T", click: () => { const w = focus || shown[0] || worlds[0]?.id; if (!w) return; bring(w); newTab(w, ""); ui.webContents.send("focusAddress"); } },
      { label: "Close tab", accelerator: "CmdOrCtrl+W", click: () => (browserOpen && cur() ? closeTab(cur().id) : win.close()) },
      { label: "Address", accelerator: "CmdOrCtrl+L", click: () => browserOpen && ui.webContents.send("focusAddress") },
      { label: "Back", accelerator: "CmdOrCtrl+[", click: () => (cur() && wake(cur()).webContents)?.navigationHistory.goBack() },
      { label: "Forward", accelerator: "CmdOrCtrl+]", click: () => (cur() && wake(cur()).webContents)?.navigationHistory.goForward() },
      { type: "separator" },
      { label: "Developer tools (page)", accelerator: "Alt+CmdOrCtrl+I", click: () => (onTab() ? wake(cur()).webContents.openDevTools({ mode: "detach" }) : ui.webContents.openDevTools({ mode: "detach" })) },
    ] },
    { label: "Window", submenu: [{ role: "minimize", label: "Minimize" }, { label: "Close", accelerator: "Shift+CmdOrCtrl+W", click: () => win.close() }] },
  ]));
}
// Is the Browser page open (if the UI reported areas).
let browserOpen = false;

app.whenReady().then(async () => {
  nativeTheme.themeSource = "system";
  // Downloads go to the Downloads folder without asking.
  app.on("session-created", (s) => s.on("will-download", (_e, item) => item.setSavePath(path.join(app.getPath("downloads"), item.getFilename()))));
  const saved = readJson(STATE_FILE(), { shown: [], tabs: [] });
  await listenApi();
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
});
// Control API: a free port if the preferred one is taken (the server learns it through PB_API_PORT).
function listenApi() {
  return new Promise((resolve) => {
    const srv = http.createServer(api);
    srv.once("error", () => { const alt = http.createServer(api); alt.listen(0, "127.0.0.1", () => { apiPort = alt.address().port; resolve(); }); });
    srv.listen(API_PORT, "127.0.0.1", () => { apiPort = API_PORT; resolve(); });
  });
}
// Quit watchdog: if the process has not ended within 6 s it is killed (data has been written by then).
let watching = false;
function watchdog() {
  if (watching) return;
  watching = true;
  const js = `setTimeout(()=>{try{process.kill(${process.pid},0);process.kill(${process.pid},"SIGKILL")}catch{}},6000)`;
  try { spawn(process.execPath, ["-e", js], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch { /* without a watchdog it is a normal quit */ }
}
// SIGTERM/SIGINT (kill <pid>, logging out): the normal quit path.
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { quitting = true; watchdog(); app.quit(); });
app.on("second-instance", () => { if (win) { win.show(); app.focus({ steal: true }); } });
app.on("activate", () => win?.show());
app.on("web-contents-created", (_e, wc) => { wc.on("will-attach-webview", (ev) => ev.preventDefault()); });
