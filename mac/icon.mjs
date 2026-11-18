// mac/icon.html → mac/icon-1024.png (headless Chrome). browser/build.sh then turns it into an .icns.
import puppeteer from "puppeteer-core";
import { HEADLESS } from "../shared/headless.mjs";
const dir = new URL(".", import.meta.url).pathname;
const b = await puppeteer.launch({ executablePath: HEADLESS, headless: true });
const p = await b.newPage();
await p.setViewport({ width: 1024, height: 1024 });
await p.goto("file://" + dir + "icon.html");
await new Promise((r) => setTimeout(r, 400));
await p.screenshot({ path: dir + "icon-1024.png", omitBackground: true });
await b.close();
