#!/usr/bin/env node
// Records a page in real time (a headless Chrome shell with its own profile; an open Chrome is not touched).
// An opening or a single section:  node scripts/record.mjs <url> <seconds> <out.mp4> [--no-scroll]
// A site tour (top to bottom, scrolling at human pace; extra addresses go into the same video in turn):
//                          node scripts/record.mjs <url> <seconds> <out.mp4> --tour [<url2> <url3> ...]
import { recordPage, recordTour } from "../server/record.mjs";
const [url, sec, out, ...flags] = process.argv.slice(2);
if (!/^https?:\/\//.test(url ?? "") || !out) { console.error("Usage: node scripts/record.mjs <url> <seconds> <out.mp4> [--no-scroll | --tour [<url2> ...]]"); process.exit(2); }
try {
  if (flags.includes("--tour")) await recordTour([url, ...flags.filter((x) => /^https?:\/\//.test(x))], Number(sec) || 40, out);
  else await recordPage(url, Number(sec) || 10, out, { scroll: !flags.includes("--no-scroll") });
  console.log(out); process.exit(0);
} catch (e) { console.error(String(e?.message ?? e)); process.exit(1); }
