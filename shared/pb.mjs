// Playground Browser (PB): Playgrounds'un kendi tarayıcısı (browser/, Electron). Saf kurallar; tarayıcı, sunucu ve testler kullanır.
// Her dünya PB'de ayrı bir oturum bölmesi (persist:pg-<dünya>). Dünyanın hesapları orada açık durur; Rou DevTools portundan çalışır.

// Platformların giriş sayfası ve oturum çerezi (yalnız adı ve süresi okunur, değeri asla).
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

// Adres bu platformun alanında mı (şifre yalnız oraya girilir).
export function onPlatform(platform, url) {
  const site = SITES[platform];
  let host = "";
  try { host = new URL(url).hostname.toLowerCase(); } catch { return false; }
  if (!site || new URL(url).protocol !== "https:") return false;
  return site.hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

// Chrome çerez zamanı: 1601'den beri mikrosaniye. 0 = oturum çerezi (tarayıcı açıkken geçerli).
const chromeNow = (now = Date.now()) => (now + 11644473600000) * 1000;
// rows: [{ host_key, name, expires_utc, has_expires }] → platform → true | false | null (bilinmiyor).
export function loginsFromCookies(rows, platforms, now = Date.now()) {
  const out = {};
  for (const p of platforms) {
    const c = SITES[p]?.cookie;
    if (!c) { out[p] = null; continue; }
    const [host, name] = c;
    // Çerez alt alan adında da olabilir (LinkedIn li_at: .www.linkedin.com).
    const base = host.replace(/^\./, "");
    const onHost = (h) => { h = String(h).replace(/^\./, ""); return h === base || h.endsWith(`.${base}`); };
    out[p] = rows.some((r) => r.name === name && onHost(r.host_key) && (!Number(r.has_expires) || Number(r.expires_utc) > chromeNow(now)));
  }
  return out;
}
