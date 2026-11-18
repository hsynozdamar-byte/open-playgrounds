// Attachments on a post with no linked account: Rou writes direct file addresses at the end of the text under "ATTACHMENTS:",
// they are downloaded here into data/media (run.images) and that section is removed from the text. No description of the attachments is left in the text.
import fs from "node:fs";
import path from "node:path";
import { MEDIA_DIR } from "./store.mjs";
import { recordSection } from "./record.mjs";

export const MEDIA_RULE = [
  "Attachments: do not write, describe or annotate the images and videos to attach inside the text.",
  "After the text, on a separate line write only \"ATTACHMENTS:\"; under it put one direct file address per line (starting with https:// and ending in .png .jpg .jpeg .webp .gif .svg .mp4 .mov). Verify with WebFetch that the address opens.",
  "To add an animation that plays in code on a page (it has no file) as a video, write this line under ATTACHMENTS: \"RECORD: <page address> | <the element's aria-label or CSS selector> | <seconds, 4-20>\". Copy the aria-label exactly from the page's HTML (WebFetch); do not guess a CSS selector, use only an aria-label or id you saw in the HTML; give enough time for the animation to complete one cycle. The server records that section and turns it into a video.",
  "If there are no attachments, do not write the ATTACHMENTS section; write no note for something that could not be attached.",
].join("\n");

const HEAD = /^\s*(ATTACHMENTS|Attachments|Images|Image|Media|Videos|EKLER|Ekler|Görseller|Görsel|Medya|Videolar)\s*:?\s*$/m;
const FILE = /https?:\/\/[^\s)"'<>]+?\.(png|jpe?g|webp|gif|svg|mp4|mov|m4v|webm)(\?[^\s)"'<>]*)?(?=[\s)"'<>,.;]|$)/gi;
const MAX = 80 * 1024 * 1024;

async function download(url, file) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status}`);
  const type = r.headers.get("content-type") || "";
  if (!/^(image|video)\//.test(type) && !/octet-stream/.test(type)) throw new Error(`type ${type}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX) throw new Error("too large");
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, file), buf);
}

// { body, images, failed }: the attachments section is split off the text; the file addresses in it are downloaded.
export async function pullMedia(body, runId) {
  const m = HEAD.exec(body ?? "");
  if (!m) return { body, images: [], failed: [] };
  const text = body.slice(0, m.index).trimEnd();
  // Line order is the order in the post: a file address is downloaded, a RECORD line is recorded from the page into a video.
  const items = [];
  for (const line of body.slice(m.index).split("\n")) {
    const rec = line.match(/(?:RECORD|KAYIT):\s*(https?:\/\/\S+)\s*\|\s*(.+?)\s*\|\s*(\d+)/i);
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
