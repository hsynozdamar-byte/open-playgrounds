// Serves the built app and the API (npm start). Listens on this computer only.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { handle } from "./store.mjs";

const DIST = path.resolve(import.meta.dirname, "../dist");
const PORT = Number(process.env.PORT || 5340);
// 127.0.0.1 by default. Set PG_HOST to reach it from another device (e.g. a Tailscale address); the data has no login.
const HOST = process.env.PG_HOST || "127.0.0.1";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };

process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e?.stack ?? e));
process.on("uncaughtException", (e) => console.error("uncaught exception:", e?.stack ?? e));
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(sig, () => process.exit(0));

if (!fs.existsSync(path.join(DIST, "index.html"))) {
  console.error("No build found. Run `npm start` (it builds first) or `npm run build`.");
  process.exit(1);
}

http
  .createServer((req, res) =>
    handle(req, res, () => {
      let file;
      try { file = path.join(DIST, decodeURIComponent(new URL(req.url, "http://x").pathname)); } catch { res.writeHead(400); return res.end(); }
      if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
      // The page is asked for again on every load; hashed asset files are cached for good.
      const cache = file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": cache });
      fs.createReadStream(file).pipe(res);
    }),
  )
  .on("error", (e) => { console.error(`Could not start the server: ${e.message}`); process.exit(1); })
  .listen(PORT, HOST, () => console.log(`Playgrounds → http://localhost:${PORT}`));
