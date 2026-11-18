// Playgrounds browser (PB): Playgrounds' own browser (browser/, Electron = Chromium). Each world is a separate session pane, all open at once;
// the window shows one or several worlds side by side. This module uses PB's control API (127.0.0.1:9334) and DevTools port (9333):
// - Monitoring: the worlds' sessions (cookie name and expiry only), open tabs, tab screenshots.
// - `pg pb <world> [url]` brings PB forward and opens that world's pane.
// - Rou: `claude -p` + chrome-devtools-mcp connects to the DevTools port; for a job, a new tab is opened in the world, gets a "Rou ..." label, and Rou works only in that one.
//   If a login is needed Rou stops; the user logs in in the browser (Rou does not know or type passwords).
import fs from "node:fs";
import { spawn } from "node:child_process";
import { SITES } from "../shared/pb.mjs";
import { npxCommand } from "../shared/platform.mjs";

export const PB_NAME = "Playgrounds";
// PG_APP: path of the desktop app (to open it if closed). A server started by the app itself has PG_SHELL=app.
export const PB_APP = process.env.PG_APP || "";
export const PB_PORT = Number(process.env.PB_PORT || 9333);
const API = `http://127.0.0.1:${Number(process.env.PB_API_PORT || 9334)}`;
const APP_PORT = Number(process.env.PORT || 5340);
const goUrl = (key) => `http://127.0.0.1:${APP_PORT}/pb/go?k=${encodeURIComponent(key)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const appToOpen = () => (PB_APP && fs.existsSync(PB_APP) ? PB_APP : "");
let seenRunning = false;
export const installed = () => !process.env.PG_NO_PB && (process.env.PG_SHELL === "app" || seenRunning || !!appToOpen());

// PB control API. The header is required so a page open in PB cannot call this address.
async function call(p, body, ms = 5000) {
  const r = await fetch(API + p, { method: body ? "POST" : "GET", headers: { "x-pg": "1", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  if (r.headers.get("content-type")?.startsWith("image/")) return r.ok ? Buffer.from(await r.arrayBuffer()) : null;
  return r.json();
}
export const running = () => call("/state", null, 1500).then((x) => (seenRunning ||= !!x?.ok, !!x?.ok)).catch(() => false);

// Opens it if closed (the window does not come forward) and waits for the API to answer.
async function ensure() {
  if (await running()) return true;
  const app = appToOpen();
  if (!app) throw new Error(`The ${PB_NAME} desktop app is not open`);
  if (process.platform === "darwin") spawn("open", ["-g", app], { stdio: "ignore", detached: true }).unref();
  else spawn(app, [], { stdio: "ignore", detached: true }).unref();
  for (let t = 0; t < 20000; t += 500) { await sleep(500); if (await running()) return true; }
  throw new Error(`${PB_NAME} could not be opened`);
}

// For the app's Browser page: sessions and tabs per world.
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

// Small image of a tab: live for a visible tab, the last snapshot for a hidden one.
export async function shot(tabId, width = 640) {
  const img = await call(`/shot?tab=${encodeURIComponent(tabId)}&w=${width}`, null, 4000);
  if (!Buffer.isBuffer(img)) throw new Error("No image");
  return img;
}

// Brings the world's pane forward; if a url is given, opens it in a new tab there.
export async function openProfile(world, url) {
  if (url && !/^https?:\/\//.test(url)) return { ok: false, error: "The address must be http(s)" };
  try {
    await ensure();
    const r = await call("/open", { worldId: world.id, url, newTab: !!url });
    return r.ok ? { ok: true, tab: r.tab } : { ok: false, error: r.error || "Could not open" };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function focusPage(tabId) {
  await ensure();
  const r = await call("/focus", { tabId });
  if (!r.ok) throw new Error(r.error || "No such tab");
  return { ok: true };
}

// Rou's working tab: a new, labelled tab (pb/go?k=) is opened in the world IN THE BACKGROUND. The app does not come forward, the user's
// open tab does not change; the same world's session (cookies) is used. Rou finds this address in list_pages and goes to the site itself.
export async function rouTab(world, key, label = "Rou is working") {
  await ensure();
  const url = goUrl(key);
  const r = await call("/open", { worldId: world.id, url, who: label, newTab: true, quiet: true });
  if (!r.ok || !r.tab?.targetId) throw new Error(r.error || "Rou's tab could not be opened");
  TAB_OF.set(r.tab.targetId, r.tab.id);
  return { url, targetId: r.tab.targetId, tabId: r.tab.id };
}
// targetId can change when a tab sleeps and wakes or the page moves to another process; the stable tab id is used when closing
// (otherwise Rou's tabs would pile up unclosed).
const TAB_OF = new Map();
// When the job ends Rou's tab is closed. keep: only the label is removed so the result stays on screen.
export const releaseTab = (targetId, { keep = false } = {}) => {
  const tabId = TAB_OF.get(targetId) ?? targetId;
  if (!keep) TAB_OF.delete(targetId);
  return call(keep ? "/who" : "/close", keep ? { tabId, who: "" } : { tabId }).catch(() => {});
};

// Rou's tools: chrome-devtools-mcp connects to PB's DevTools port. Running JavaScript, new_page (opens in the wrong world) and close_page are off.
const MCP_VERSION = "1.12.0";
// tools: extra allowed tools (Read, Write, Bash(...)); dirs: extra folders Rou may read and write.
// read: page reading tools (take_snapshot, take_screenshot; the debugging category) are enabled too (account analysis).
export function rouArgs(filesDir, tools = [], dirs = [], { read = false } = {}) {
  const mcp = { mcpServers: { pb: npxCommand(["-y", `chrome-devtools-mcp@${MCP_VERSION}`, "--browserUrl", `http://127.0.0.1:${PB_PORT}`, "--usageStatistics=false", "--performanceCrux=false", "--javascriptEvaluation=false", "--categoryPerformance=false", "--categoryEmulation=false", "--categoryMemory=false", "--categoryNetwork=false", ...(read ? [] : ["--categoryDebugging=false"]), "--screenshotFormat=jpeg", "--screenshotMaxWidth=1280", ...(filesDir ? ["--workspace", filesDir] : [])]) } };
  return ["--mcp-config", JSON.stringify(mcp), "--strict-mcp-config", "--allowedTools", [`mcp__pb`, ...tools].join(","), "--disallowedTools", "mcp__pb__new_page,mcp__pb__close_page", ...[filesDir, ...dirs].filter(Boolean).flatMap((d) => ["--add-dir", d])];
}
// Lines prepended to every PB job of Rou.
export const rouRules = (tab, acc) => [
  `Browser: the Browser page of the ${PB_NAME} app (Playgrounds' own browser; each world is a separate session). First find the tab whose address is ${tab.url} with list_pages and select it with select_page. Work only in this tab: do not select another tab or the browser's own interface page (file://), do not use new_page; navigate in this tab with navigate_page when needed.`,
  acc ? `If a login is needed: type "${acc.login || acc.handle?.replace(/^@/, "") || ""}" into the username or email field. You do not know the password, you will not ask for it and will not type it: if a password is asked for, stop and write "login required" as the error; the user logs in in the browser. If a verification code, CAPTCHA or "is this you" screen appears, stop too and write it as the error.` : "",
].filter(Boolean).join("\n");

// First page of Rou's job tab: shown until Rou finds the tab and starts.
export const goPage = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Rou · ${PB_NAME}</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-content:center;gap:6px;text-align:center;font:15px/1.45 -apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:Canvas;color:CanvasText}h1{font-size:22px;margin:0}p{margin:0;opacity:.6}</style>
</head><body><h1>Rou will work in this tab</h1><p>Do not close the tab; Rou leaves it here when the job is done.</p></body></html>`;

// So tabs of jobs cut off by a server restart do not pile up: if no job is running, Rou's labelled tabs are closed (otherwise they would show "working" for hours).
export async function releaseStaleLabels(s) {
  const busy = (s.runs ?? []).some((r) => r.status === "working" || r.publish?.phase || r.act?.status === "working");
  if (busy) return 0;
  const st = await call("/state", null, 4000).catch(() => null);
  let n = 0;
  // A labelled tab belongs to one of Rou's jobs; it is closed if no job is running (if the job continues rouTab opens a new one).
  for (const w of st?.worlds ?? []) for (const t of w.tabs ?? []) if (t.who) { await call("/close", { tabId: t.id }).catch(() => {}); n++; }
  return n;
}
