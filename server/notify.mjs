// Notification. It goes to an open Playgrounds page first (store.mjs notice): the desktop app shows it with its own icon.
// Directly in the server process, via POST /api/notify from another process (pg CLI). With no open page the Playgrounds shell
// (Electron) shows it with its own icon; if the shell is not running either, osascript is the last resort on macOS, elsewhere the notification is dropped.
// Silent in tests (PG_DRY).
import { spawn } from "node:child_process";

const q = (x) => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 220)}"`;
const SHELL_API = `http://127.0.0.1:${process.env.PB_API_PORT || 9334}/notify`;
const osa = (title, text) => {
  fetch(SHELL_API, { method: "POST", headers: { "x-pg": "1", "content-type": "application/json" }, body: JSON.stringify({ title, text }), signal: AbortSignal.timeout(2000) })
    .then((r) => r.json()).then((j) => { if (!j.ok) script(title, text); }).catch(() => script(title, text));
};
const script = (title, text) => {
  try {
    if (process.platform === "darwin") spawn("osascript", ["-e", `display notification ${q(text)} with title "Playgrounds" subtitle ${q(title)}`], { stdio: "ignore", detached: true }).unref();
  } catch { /* the job continues without a notification */ }
};
export function notify(title, text) {
  if (process.env.PG_DRY) return;
  if (globalThis.__pgNotice) { if (!globalThis.__pgNotice(String(title), String(text))) osa(title, text); return; }
  fetch(`http://127.0.0.1:${process.env.PORT || 5340}/api/notify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, text }), signal: AbortSignal.timeout(3000) })
    .then((r) => r.json()).then((j) => { if (!j.delivered) osa(title, text); }).catch(() => osa(title, text));
}
