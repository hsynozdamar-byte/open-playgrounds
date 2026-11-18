// Hazırlayanın durumu: Claude girişi açık mı. Rou'nun kod değişikliği açık mı (PG_CHANGE=1).
import { execFile } from "node:child_process";
import { changeOn } from "./change.mjs";

const CLAUDE = process.env.PG_CLAUDE || "claude";

// `claude auth status` birkaç saniye sürebilir; sonuç 5 dakika saklanır.
let cache = null;
function claude() {
  if (cache && Date.now() - cache.at < 5 * 60 * 1000) return Promise.resolve(cache.v);
  return new Promise((resolve) => {
    execFile(CLAUDE, ["auth", "status"], { timeout: 10000 }, (err, out) => {
      let v;
      if (err && err.code === "ENOENT") v = { state: "missing" };
      else {
        try {
          const j = JSON.parse(out);
          v = j.loggedIn ? { state: "ok" } : { state: "off" };
        } catch {
          v = { state: err ? "off" : "unknown" };
        }
      }
      cache = { at: Date.now(), v };
      resolve(v);
    });
  });
}

export async function status() {
  return { claude: await claude(), change: changeOn() };
}

export const forget = () => (cache = null);
