// Rou'ya verilen tek işin Chrome'da yapılması gerekiyor mu: daha önce Chrome seçildiyse ya da iş, notu veya planı Chrome/tarayıcı diyorsa.
// Böyle işler plan onayı beklemeden doğrudan yürür (server/browse.mjs startDirect).
export const needsChrome = (t, r) => !!t?.browser || /chrome|tarayıcı|browser/i.test(`${t?.title ?? ""} ${t?.notes ?? ""} ${r?.body ?? ""}`);

// Bağlı Chrome yokken hem kartta hem Mac bildiriminde aynı cümle.
export const NO_CHROME = "Chrome'da Claude eklentisi bağlı değil, Chrome'u açıp eklentiyi bağla";

// İşin gerektirdiği site (hesap platformu): işin adı, notu ya da planı söylüyorsa.
const SITES = [["linkedin", /linkedin/i], ["instagram", /instagram/i], ["x", /\btwitter\b|\bx\.com\b|\btweet/i], ["threads", /threads/i], ["tiktok", /tiktok/i], ["youtube", /youtube/i]];
export const siteOf = (t, r) => SITES.find(([, re]) => re.test(`${t?.title ?? ""} ${t?.notes ?? ""} ${r?.body ?? ""}`))?.[0] ?? null;

// Rou'nun Chrome'u kendisi seçmesi. list: bağlı Chrome'lar ([{ id, name }], hepsinde Claude in Chrome bağlı).
// Birden çoksa: işin sitesine giriş yapılmış olan (dünyadaki hesabın Chrome'u, kontrolü tutmuş), o da yoksa son kullanılan.
// Saf işlev (test edilir); seçilemezse null.
export function pickBrowser(s, task, list, run) {
  if (!list?.length) return null;
  if (list.length === 1) return { id: list[0].id, name: list[0].name };
  const on = (b) => b && list.find((x) => x.id === b.id);
  const accs = (s.worlds ?? []).flatMap((w) => (w.accounts ?? []).map((a) => ({ ...a, mine: w.id === task.worldId })));
  const hit = loggedInBrowser(s, task, list, run);
  if (hit) return hit;
  // Son kullanılan: Rou'nun Chrome işlerindeki son çalışma ya da hesap kontrolü.
  const seen = [
    ...(s.tasks ?? []).filter((t) => t.browser).map((t) => ({ b: t.browser, at: (s.runs ?? []).filter((r) => r.taskId === t.id).map((r) => r.act?.at ?? r.at ?? "").sort().pop() ?? "" })),
    ...accs.filter((a) => a.browser).map((a) => ({ b: a.browser, at: a.check?.at ?? "" })),
  ].filter((x) => on(x.b)).sort((a, b) => b.at.localeCompare(a.at));
  const b = seen[0] ? on(seen[0].b) : list.find((x) => x.local) ?? list[0];
  return { id: b.id, name: b.name };
}

// İşin sitesine giriş yapıldığı bilinen bağlı Chrome (dünyadaki hesabın Chrome'u, kontrolü tutmuş); yoksa null.
export function loggedInBrowser(s, task, list, run) {
  const site = siteOf(task, run);
  if (!site || !list?.length) return null;
  const on = (b) => b && list.find((x) => x.id === b.id);
  const accs = (s.worlds ?? []).flatMap((w) => (w.accounts ?? []).map((a) => ({ ...a, mine: w.id === task.worldId })));
  const hit = accs.filter((a) => a.platform === site && a.check?.ok && on(a.browser)).sort((a, b) => (b.mine - a.mine) || String(b.check.at).localeCompare(String(a.check.at)))[0];
  return hit ? { id: on(hit.browser).id, name: on(hit.browser).name } : null;
}

// Son çalışmada sitede oturum bulunmayan Chrome (run.act.loggedOut) bir dahaki seçimde atlanır.
export const usableBrowsers = (list, run) => (list ?? []).filter((b) => b.id !== run?.act?.loggedOut);

// Claude in Chrome'un araç sonucu bir izin/onay beklediğini söylüyor mu (site izni, araç onayı).
export const asksPermission = (text) => /permission|not allowed|allow (this|access)|approv|izin|onay/i.test(String(text ?? ""));

// Sunucu yeniden başlayınca yarıda kalan Chrome işleri: act.phase duruyor ama sonucu (hata, soru, bitti) yazılmamış.
// direct = tek iş (Rou baştan sona yapar, kaldığı yerden sürer); items = otomasyon öğeleri (yeniden basmamak için sürmez, hata yazılır).
export function orphanedActs(s) {
  const open = (s.runs ?? []).filter((r) => r.status === "approved" && r.act?.phase && !r.act.error && !r.act.question);
  return { direct: open.filter((r) => !r.items?.length), items: open.filter((r) => r.items?.length) };
}
