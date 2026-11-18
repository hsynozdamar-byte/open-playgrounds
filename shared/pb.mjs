// Playgrounds browser (PB): Playgrounds' own browser (browser/, Electron). Pure rules; used by the browser, the server and tests.
// Each world is a separate session pane in PB (persist:pg-<world>). The world's accounts stay logged in there; Rou works through the DevTools port.

// Login page and session cookie of each platform (only the name and expiry are read, never the value).
export const SITES = {
  x: { home: "https://x.com/home", login: "https://x.com/i/flow/login", hosts: ["x.com", "twitter.com"], cookie: [".x.com", "auth_token"] },
  instagram: { home: "https://www.instagram.com/", login: "https://www.instagram.com/accounts/login/", hosts: ["instagram.com"], cookie: [".instagram.com", "sessionid"] },
  threads: { home: "https://www.threads.com/", login: "https://www.threads.com/login", hosts: ["threads.com", "threads.net", "instagram.com"], cookie: [".threads.com", "sessionid"] },
  linkedin: { home: "https://www.linkedin.com/feed/", login: "https://www.linkedin.com/login", hosts: ["linkedin.com"], cookie: [".linkedin.com", "li_at"] },
  tiktok: { home: "https://www.tiktok.com/upload", login: "https://www.tiktok.com/login", hosts: ["tiktok.com"], cookie: [".tiktok.com", "sessionid"] },
  youtube: { home: "https://studio.youtube.com/", login: "https://accounts.google.com/ServiceLogin?service=youtube", hosts: ["youtube.com", "google.com"], cookie: [".youtube.com", "LOGIN_INFO"] },
  gmail: { home: "https://mail.google.com/", login: "https://accounts.google.com/", hosts: ["google.com"], cookie: [".google.com", "SID"] },
  gcal: { home: "https://calendar.google.com/", login: "https://accounts.google.com/", hosts: ["google.com"], cookie: [".google.com", "SID"] },
  slack: { home: "https://app.slack.com/", login: "https://slack.com/signin", hosts: ["slack.com"], cookie: [".slack.com", "d"] },
  clickup: { home: "https://app.clickup.com/", login: "https://app.clickup.com/login", hosts: ["clickup.com"], cookie: null },
};
export const siteOfPlatform = (p) => SITES[p] ?? null;

// Whether the address is on this platform's domain (a password is only typed there).
export function onPlatform(platform, url) {
  const site = SITES[platform];
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  if (!site || new URL(url).protocol !== "https:") return false;
  return site.hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

// Chrome cookie time: microseconds since 1601. 0 = session cookie (valid while the browser is open).
const chromeNow = (now = Date.now()) => (now + 11644473600000) * 1000;
// rows: [{ host_key, name, expires_utc, has_expires }] → platform → true | false | null (unknown).
export function loginsFromCookies(rows, platforms, now = Date.now()) {
  const out = {};
  for (const p of platforms) {
    const c = SITES[p]?.cookie;
    if (!c) { out[p] = null; continue; }
    const [host, name] = c;
    // The cookie can be on a subdomain too (LinkedIn li_at: .www.linkedin.com).
    const base = host.replace(/^\./, "");
    const onHost = (h) => { h = String(h).replace(/^\./, ""); return h === base || h.endsWith(`.${base}`); };
    out[p] = rows.some((r) => r.name === name && onHost(r.host_key) && (!Number(r.has_expires) || Number(r.expires_utc) > chromeNow(now)));
  }
  return out;
}
