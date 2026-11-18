// Tarayıcıda paylaşım: Claude, kullanıcının açık Chrome'unda (Claude in Chrome eklentisi) çalışır.
// Paylaşım Playgrounds'un tarayıcısında, hesabın dünyasının oturumunda yapılır (server/pb.mjs). Yedek yol (uygulama yoksa): hesabın bağlı
// Chrome'u (account.browser); paylaşmadan önce o Chrome'da açık hesabın
// kullanıcı adı hesabınkiyle karşılaştırılır, uymazsa hiçbir şey paylaşılmaz.
// Paylaşım onaylanmış gönderide başlar: elle (POST /api/publish) ya da saatinde zamanlayıcıdan (server/share.mjs).
import path from "node:path";
import { read, update, MEDIA_DIR, DATA_DIR } from "./store.mjs";
import { shareFiles } from "./sharemedia.mjs";
import { runClaude } from "./claude.mjs";
import { tracker } from "./live.mjs";
import { markPosted } from "./share.mjs";
import { accountById, accountOf, bodyOf, isFeed, mentionRule, missingImage, platformName, profileUrl, taskRef } from "../shared/social.mjs";
import { installed as pbInstalled, rouTab, rouArgs, rouRules, releaseTab, PB_NAME } from "./pb.mjs";
import { SITES } from "../shared/pb.mjs";

const T = "mcp__claude-in-chrome__";
const READ_TOOLS = ["list_connected_browsers", "select_browser", "tabs_context_mcp", "tabs_create_mcp", "navigate", "get_page_text", "read_page", "find", "computer", "tabs_close_mcp"].map((x) => T + x);
const POST_TOOLS = [...READ_TOOLS, ...["form_input", "file_upload", "javascript_tool", "browser_batch"].map((x) => T + x)];
const chrome = (tools) => ["--chrome", "--allowedTools", tools.join(","), "--add-dir", MEDIA_DIR];

export const HOME = {
  instagram: "https://www.instagram.com/",
  linkedin: "https://www.linkedin.com/feed/",
  x: "https://x.com/home",
  threads: "https://www.threads.com/",
  tiktok: "https://www.tiktok.com/upload",
  youtube: "https://studio.youtube.com/",
};
export const canPublish = (platform) => Object.hasOwn(HOME, platform);
// Site yönetim paneli: "Diğer" türündeki hesabın kullanıcı adı bir adresse (example.com/admin gibi) Rou yazıyı o panele girer.
export const panelUrl = (acc) => {
  const h = String(acc?.handle ?? "").trim();
  if (acc?.platform !== "other" || !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(h)) return null;
  return /^https?:\/\//i.test(h) ? h : `https://${h}`;
};
export const canPublishAcc = (acc) => !!acc && (canPublish(acc.platform) || !!panelUrl(acc));

const json = (out, list = false) => {
  const m = out.match(list ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
};
const norm = (h) => String(h ?? "").trim().replace(/^@/, "").toLowerCase();
const busy = new Set();
export const publishing = () => [...busy];

// Bağlı Chrome'lar: [{ id, name, local }].
// Bağlı Chrome listesi 10 dakika saklanır: her "Rou başlasın"da yeniden aramak 10-30 sn sürüyordu.
let seenBrowsers = null;
export async function browsers() {
  if (seenBrowsers && Date.now() - seenBrowsers.at < 10 * 60 * 1000) return { ok: true, list: seenBrowsers.list };
  // Aynı anda gelen istekler tek aramayı bekler (zamanlayıcı ile kart birlikte sorabilir).
  if (looking) return looking;
  looking = findBrowsers().finally(() => { looking = null; });
  return looking;
}
let looking = null;
async function findBrowsers() {
  const r = await runClaude("list_connected_browsers aracını bir kez çağır ve SADECE sonucunu ham JSON dizisi olarak yaz. Başka hiçbir şey yapma, sekme açma.", 90000, undefined, { args: ["--chrome", "--allowedTools", T + "list_connected_browsers"] });
  if (!r.ok) return r;
  const list = json(r.out, true);
  if (!Array.isArray(list)) return { ok: false, error: "Chrome listesi okunamadı. Chrome açık ve Claude eklentisi bağlı mı?" };
  const out = list.map((b) => ({ id: String(b.deviceId), name: String(b.name || "Chrome"), local: !!b.isLocal }));
  if (out.length) seenBrowsers = { at: Date.now(), list: out };
  return { ok: true, list: out };
}

const selectLine = (b) => `Önce select_browser aracıyla deviceId "${b.id}" olan Chrome'u seç. Başka bir Chrome kullanma; o bağlı değilse dur ve hata ver.`;

// Bir Chrome'da sitede oturum açık mı (Rou'nun Chrome seçimi, server/browse.mjs chooseBrowser); yalnız okur. { loggedIn, seen }.
export async function siteLogin(browser, site) {
  if (!canPublish(site)) return { loggedIn: false };
  const prompt = [
    selectLine(browser),
    `Yeni bir sekme aç ve ${HOME[site]} adresine git. Sitede bir hesabın açık olup olmadığını bul (giriş sayfasına yönlendiriyorsa açık değildir). Hiçbir şeye basma, hiçbir şey yazma.`,
    "Bitince açtığın sekmeyi kapat.",
    'SADECE şu JSON\'u yaz: {"loggedIn": true|false, "name": "görünen ad ya da boş"}',
  ].join("\n\n");
  const r = await runClaude(prompt, 3 * 60 * 1000, undefined, { args: chrome(READ_TOOLS) });
  const j = r.ok ? json(r.out) : null;
  return { loggedIn: !!j?.loggedIn, seen: String(j?.name ?? "") };
}

// Hesabın Chrome'da açık olup olmadığına bakar; yalnız okur, hiçbir şeye basmaz.
export async function checkAccount(accountId, browser) {
  const { state: s } = read();
  const acc = accountById(s, accountId);
  if (!acc || isFeed(acc.platform) || !canPublish(acc.platform)) return { ok: false, error: "Bu hesap tarayıcıdan paylaşılamaz" };
  const key = `check-${accountId}`;
  if (busy.has(key)) return { ok: false, error: "Zaten kontrol ediliyor" };
  busy.add(key);
  const prompt = [
    selectLine(browser),
    `Yeni bir sekme aç ve ${HOME[acc.platform]} adresine git. ${platformName(acc)} sitesinde hangi hesabın açık olduğunu bul (kullanıcı adı ve görünen ad). Gerekirse profil menüsüne bak ama hiçbir ayarı değiştirme, hiçbir şey paylaşma, beğenme ya da gönderme.`,
    "Bitince açtığın sekmeyi kapat.",
    'SADECE şu JSON\'u yaz: {"loggedIn": true|false, "handle": "@kullaniciadi ya da boş", "name": "görünen ad ya da boş"}',
  ].join("\n\n");
  const r = await runClaude(prompt, 4 * 60 * 1000, undefined, { args: chrome(READ_TOOLS) }).finally(() => busy.delete(key));
  const j = r.ok ? json(r.out) : null;
  const check = j
    ? { at: new Date().toISOString(), ok: !!j.loggedIn && (!acc.handle || norm(j.handle) === norm(acc.handle)), seen: j.loggedIn ? String(j.handle || j.name || "") : "", ...(j.loggedIn ? {} : { error: "Bu Chrome'da giriş yapılmamış" }) }
    : { at: new Date().toISOString(), ok: false, error: (r.error || "Yanıt okunamadı").slice(0, 200) };
  if (j?.loggedIn && acc.handle && !check.ok) check.error = `Chrome'da ${check.seen} açık, hesap ${acc.handle}`;
  update((st) => {
    const a = st.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === accountId);
    if (!a) return;
    a.browser = { id: browser.id, name: browser.name };
    a.check = check;
    // Kullanıcı adı boşsa Chrome'da görüleni yaz.
    if (!a.handle && j?.loggedIn && j.handle) a.handle = String(j.handle).startsWith("@") ? String(j.handle) : `@${j.handle}`;
  });
  return { ok: true, check };
}

// Hesap kontrolü Playgrounds'un tarayıcısında, hesabın dünyasının oturumunda: girişli kullanıcı kim ve profil
// sayfası açılıyor mu. Yalnız okur: giriş yapmaz, hiçbir şeye basmaz, ayar değiştirmez. LinkedIn şirket sayfasında girişli kişi
// sayfanın kendisi olamaz; orada giriş + sayfanın açılması yeter.
export async function checkAccountPb(accountId) {
  const { state: s } = read();
  const world = s.worlds.find((w) => w.accounts?.some((a) => a.id === accountId));
  const acc = world?.accounts.find((a) => a.id === accountId);
  const home = acc && (SITES[acc.platform]?.home ?? (/facebook/i.test(acc.name ?? "") ? "https://www.facebook.com/" : null));
  if (!acc || !home) return { ok: false, error: "Bu hesap tarayıcıda kontrol edilemez" };
  if (!pbInstalled()) return { ok: false, error: `${PB_NAME} kurulu değil` };
  const key = `check-${accountId}`;
  if (busy.has(key)) return { ok: false, error: "Zaten kontrol ediliyor" };
  busy.add(key);
  const profile = profileUrl(acc);
  const page = /\/company\//.test(profile ?? "");
  let tab;
  let check;
  try {
    tab = await rouTab(world, key, `Rou hesabı kontrol ediyor · ${platformName(acc)}`);
    const prompt = [
      `Görevin: ${platformName(acc)} hesabını yalnız OKUYARAK kontrol etmek. Başka hiçbir şey yapma.`,
      rouRules(tab),
      `1) Bu sekmede ${home} adresine git. Sitede hangi hesabın açık olduğunu bul (kullanıcı adı ve görünen ad; gerekirse profil menüsünü aç ama hiçbir ayara girme). Giriş sayfasına yönlendiriyorsa açık hesap yoktur; GİRİŞ YAPMA.`,
      profile ? `2) Sonra aynı sekmede ${profile} adresine git ve sayfanın gerçekten bu hesabın profili olarak açılıp açılmadığına bak ("sayfa yok", "kullanıcı bulunamadı" ya da başka bir hesaba yönlendirme açılmadı sayılır). Açılan profildeki kullanıcı adını da yaz.` : "",
      "Paylaşma, beğenme, takip etme, mesaj atma, ayar değiştirme, giriş yapma yok.",
      `SADECE şu JSON'u yaz: {"loggedIn": true|false, "handle": "açık hesabın kullanıcı adı ya da boş", "name": "görünen ad ya da boş"${profile ? ', "profileOpens": true|false, "profileHandle": "profil sayfasındaki kullanıcı adı ya da boş"' : ""}}`,
    ].filter(Boolean).join("\n\n");
    const r = await runClaude(prompt, 5 * 60 * 1000, undefined, { args: rouArgs(undefined, [], [], { read: true }), cwd: MEDIA_DIR });
    const j = r.ok ? json(r.out) : null;
    if (!j) check = { at: new Date().toISOString(), ok: false, via: "pb", error: String(r.error || "Yanıt okunamadı").slice(0, 200) };
    else {
      const seen = j.loggedIn ? String(j.handle || j.name || "") : "";
      const match = !acc.handle || page || !profile ? !!j.loggedIn : norm(j.handle) === norm(acc.handle);
      const opens = profile ? !!j.profileOpens : null;
      const errs = [
        !j.loggedIn ? "Giriş yapılmamış" : !match ? `Girişli hesap ${seen}, kayıtta ${acc.handle}` : "",
        opens === false ? `Profil açılmadı: ${profile}` : "",
      ].filter(Boolean);
      check = { at: new Date().toISOString(), ok: !errs.length, via: "pb", seen, ...(profile ? { profile, profileOpens: opens, profileSeen: String(j.profileHandle || "") } : {}), ...(errs.length ? { error: errs.join(" · ") } : {}) };
    }
  } catch (e) {
    check = { at: new Date().toISOString(), ok: false, via: "pb", error: String(e.message).slice(0, 200) };
  } finally {
    busy.delete(key);
    if (tab) releaseTab(tab.targetId);
  }
  update((st) => { const a = st.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === accountId); if (a) a.check = check; });
  return { ok: true, check };
}

const HOW = {
  linkedin: "LinkedIn'de 'Gönderi başlat' alanını aç, metni aynen yaz, görseli medya olarak ekle (kırpmadan), 'Gönder'e bas.",
  x: "X'te yeni gönderi alanına metni aynen yaz ve 'Gönder'e bas. Birden çok tweet varsa ilkini paylaş, sonra her birini bir öncekine yanıt olarak (flood) sırayla ekle; ya da oluşturma penceresindeki + ile hepsini tek seferde ekleyip 'Tümünü gönder'.",
  threads: "Threads'te yeni gönderi alanına metni aynen yaz ve 'Paylaş'a bas.",
  instagram: "Instagram'da 'Oluştur' (+) ile yeni gönderi aç, dosya girişine görselleri sırasıyla yükle (Reels ise videoyu). KIRPMA ADIMI ZORUNLU: Instagram web varsayılan olarak kare (1:1) kırpar, bu kabul edilmez. Kırpma ekranında sol alttaki kırpma düğmesine bas ve 'Orijinal' seç (video için 9:16, görseller için 4:5 görünmeli); sonra take_screenshot ile önizlemeye bak: görselin ya da videonun üstü ve altı kesilmemiş, tamamı görünüyor olmalı. Kare görünüyorsa ya da kenarlar kesikse PAYLAŞMA, düzelt ya da hata ver. Sonra ileri, açıklamaya metni aynen yaz, 'Paylaş'a bas.",
  tiktok: "TikTok yükleme sayfasında dosya girişine videoyu yükle, açıklamaya metni aynen yaz, 'Paylaş'a bas.",
  youtube: "YouTube Studio'da 'Oluştur' > 'Video yükle' ile videoyu yükle; başlığa metnin ilk satırını (en fazla 100 karakter), açıklamaya metnin tamamını yaz; çocuklara özel değil seç, görünürlük 'Herkese açık', yayınla.",
};

// Gönderiyi hesabın Chrome'unda paylaşır. Sonuç run'a yazılır: posted + postUrl ya da publish.error.
export function publish(runId) {
  const { state: s } = read();
  const run = s.runs.find((r) => r.id === runId);
  if (!run?.post && !run?.body) return { ok: false, error: "Gönderi yok" };
  if (run.status === "posted") return { ok: false, error: "Zaten paylaşıldı" };
  // Sunucu da bakar: eski bir kart ya da başka bir istemci onaysız (ya da onayı düşmüş) çıktıyı paylaştıramaz.
  if (run.status !== "approved") return { ok: false, error: "Önce onaylanmalı" };
  if (missingImage(run)) return { ok: false, error: "Görsel eksik; LinkedIn gönderisi görselsiz paylaşılmaz" };
  const task = s.tasks.find((t) => t.id === run.taskId);
  const acc = accountOf(s, taskRef(s, task));
  if (!canPublishAcc(acc)) return { ok: false, error: "Hesap tarayıcıdan paylaşılamıyor" };
  const panel = panelUrl(acc);
  // Playground Browser kuruluysa Rou orada, dünyanın profilinde paylaşır; değilse hesabın bağlı olduğu Chrome'da.
  const pb = pbInstalled();
  if (!pb && !acc.browser) return { ok: false, error: "Hesap bir Chrome'a bağlı değil" };
  if (busy.has(runId)) return { ok: false, error: "Zaten paylaşılıyor" };
  busy.add(runId);
  let files;
  try { files = shareFiles(run, acc.platform); } catch (e) { busy.delete(runId); return { ok: false, error: `Ekler tek videoda birleştirilemedi: ${e.message}`.slice(0, 300) }; }
  const text0 = run.post ? bodyOf(run.post) : run.body;
  // X'te yanıt ya da alıntı: metinde bir tweet adresi varsa ve işin notu/revizesi "yanıt" ya da "alıntı" diyorsa
  // yeni tweet atılmaz; o tweet açılıp yanıtlanır ya da alıntılanır, adres metinden çıkarılır.
  const notes = [task?.title, task?.notes, ...(task?.revisions ?? []).map((r) => r.note)].join("\n");
  const linked = acc.platform === "x" && (run.post?.quote ? ["quote", run.post.quote.url] : run.post?.reply ? ["reply", run.post.reply.url] : null);
  const target = linked ? linked[1] : acc.platform === "x" && String(text0 ?? "").match(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+\S*/)?.[0];
  const mode = linked ? linked[0] : target && (/al[ıi]nt[ıi]|quote/i.test(notes) ? "quote" : /yan[ıi]t|reply/i.test(notes) ? "reply" : null);
  const text = mode ? String(text0).replace(target, "").replace(/\n{3,}/g, "\n\n").trim() : text0;
  const onTweet = mode && `Bu gönderi yeni tweet DEĞİL: şu tweete ${mode === "quote" ? "ALINTI (quote)" : "YANIT (reply)"} olarak paylaşılacak: ${target.split("?")[0]}\nO adresi aç. ${mode === "quote" ? "Tweetin altındaki Yeniden gönder (repost) düğmesine bas, menüden 'Alıntı' (Quote) seç; açılan pencerede alıntılanan tweetin göründüğünü doğrula, metni yaz, aşağıdaki dosyaları (varsa) bu pencerenin medya girişine yükle ve yüklendiğini gör, sonra 'Gönder'e bas." : "Tweetin altındaki Yanıtla düğmesine bas; açılan pencerede yanıtlanan tweetin göründüğünü doğrula, metni yaz, aşağıdaki dosyaları (varsa) bu pencereye yükle, 'Yanıtla'ya bas."} Tweet açılmıyorsa ya da silinmişse HİÇBİR ŞEY PAYLAŞMA, hata ver.`;
  const tweets = run.post?.format === "thread" ? run.post.tweets : null;
  const set = (p) => update((st) => { const r = st.runs.find((x) => x.id === runId); if (r) Object.assign(r, p); });
  // Yeniden deneme:
  // önceki denemenin neden düştüğü Rou'ya söylenir; yarıda kaldıysa gönderi çıkmış olabilir, önce profile bakar.
  const prev = run.publish?.reason || run.publish?.error || "";
  const again = !!prev || (run.tried ?? []).includes("claude");
  set({ publish: { phase: again ? "Rou yeniden deniyor" : "Rou paylaşıyor", at: new Date().toISOString(), by: "claude" }, tried: [...new Set([...(run.tried ?? []), "claude"])] });
  const head = String(text0 ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 120) ?? "";
  const retryLine = again ? [
    `Bu gönderi daha önce paylaşılmaya çalışıldı ve bitmedi${prev ? `. Önceki denemenin sonucu: ${prev.replace(/\s+/g, " ").slice(0, 300)}` : ""}.`,
    `ÖNCE hesabın kendi profilini aç ve son gönderilere bak: bu gönderi (ilk satırı: "${head}") zaten paylaşılmışsa YENİDEN PAYLAŞMA; posted true ve o gönderinin adresini yaz.`,
    "Paylaşılmamışsa önceki denemeden açık kalan taslak ya da paylaşım penceresini kapat (taslağı kaydetme) ve baştan, tek seferde paylaş. Önceki deneme bir adımda takıldıysa (dosya yükleme, hesap geçişi) o adımı farklı yoldan dene; örneğin dosyaları tek tek yükle, yüklendiklerini gör.",
  ].join("\n") : "";
  const world = s.worlds.find((w) => w.accounts?.some((a) => a.id === acc.id));
  // Site paneli: yazı panelde yeni içerik olarak girilir; hesap notu (voice) panelin kuralıdır (taslak mı, yayında mı).
  const panelPrompt = (tab) => [
    `Kullanıcı bu yazıyı uygulamada onayladı. Görevin: yazıyı ${platformName(acc)} sitesinin yönetim panelinde yeni bir içerik olarak bir kez girmek.`,
    rouRules(tab, acc.secret ? acc : null),
    retryLine,
    `Bu sekmede ${panel} adresine git. Oturum açık değilse ve giriş bilgisi verilmediyse HİÇBİR ŞEY YAPMA, dur ve "panelde oturum açık değil" hatası ver.`,
    acc.voice ? `Panelin kuralı (hesap notu): ${acc.voice}` : "",
    "Panelde yazının türüne uyan bölümü bul (menüde Blog, Yazılar, Haberler gibi) ve yeni içerik formunu aç. Aynı başlıkta bir içerik zaten varsa yenisini açma, onu güncelle.",
    "Alanları yazıdan doldur: ad ya da başlık = metnin ilk satırı; kısa özet (pitch, açıklama özeti) = ilk paragraftan tek cümle; asıl metin (açıklama, gövde) = başlık satırı dışındaki metin, paragraflar arasında boş satır bırakarak. Panelde ayrı bağlantı alanları varsa metnin sonundaki bağlantı satırlarını (\"App Store:\", adres satırları) asıl metne yazma, bağlantı alanlarına etiketiyle gir (App Store, Instagram, Site); bağlantı alanı yoksa metinde kalsın. Etiket alanı varsa 3-5 kısa, aranacak etiket yaz (tür, platform, kullanılan araç; ör. oyun, ios, godot, yapay zeka). Aşama alanı varsa projenin durumuna göre seç (yayındaysa Canlı). Slug boşsa başlıktan kısa bir slug üret (en çok 6 kelime). Bilmediğin alanı boş bırak, hiçbir şey uydurma.",
    files.length ? `Kapak görseli: görsel alanına şu dosyayı upload_file aracıyla yükle (dosya düğmesine tıklama), yüklendiğini önizlemeden doğrula:\n${files[0]}` : "Kapak görseli yok; görsel alanını boş bırak.",
    "Durum: kullanıcı yazıyı uygulamada onayladı, bu yayın onayıdır. Durumu Yayında yap (hesap notu açıkça \"taslak bırak\" demiyorsa). Kaydet'e yalnız bir kez bas.",
    "Bitirmeden kontrol et (aynı sekmede, yeni sekme açmadan): sitenin herkese açık sayfasında yazıyı aç (listede ve kendi sayfasında). Başlık, kapak görseli, paragraflar ve bağlantılar görünmeli. Sayfa açılmıyorsa ya da bir şey bozuk görünüyorsa bunu error'a yaz (posted yine true olabilir). Paneldeki başka hiçbir içeriği değiştirme, silme.",
    `Metin (aynen):\n<<<\n${text}\n>>>`,
    'SADECE şu JSON\'u yaz: {"posted": true|false|"unknown", "draft": true|false, "url": "yazının sitedeki herkese açık adresi (yönetim paneli adresi DEĞİL; bulamadıysan boş)", "error": "kaydedilmediyse ya da sitede sorun gördüysen ne olduğu"}',
  ].filter(Boolean).join("\n\n");
  const prompt = (tab) => panel ? panelPrompt(tab) : [
    "Kullanıcı bu gönderiyi kendi hesabında paylaşmayı uygulamada onayladı. Görevin: gönderiyi aşağıdaki hesapta, aynen yazıldığı gibi bir kez paylaşmak.",
    tab ? rouRules(tab, acc.secret ? acc : null) : selectLine(acc.browser),
    retryLine,
    `Platform: ${platformName(acc)}. Hesap: ${acc.handle || acc.name}. ${tab ? "Bu sekmede" : "Yeni bir sekmede"} ${HOME[acc.platform]} adresini aç.`,
    acc.handle ? `PAYLAŞMADAN ÖNCE: açık hesabın kullanıcı adının ${acc.handle} olduğunu doğrula. Başka bir hesap açıksa önce platformun kendi hesap değiştirme menüsünden ${acc.handle} hesabına geç (Instagram: profil fotoğrafı ya da "Diğer" menüsü > "Hesap değiştir"; X: sol alttaki hesap menüsü; LinkedIn ve diğerleri: profil menüsü). Hesap listede yoksa ve giriş bilgisi verildiyse oradan "mevcut hesaba giriş yap" ile gir. Geçtikten sonra kullanıcı adını yeniden doğrula. Hâlâ ${acc.handle} değilse ya da giriş yapılamıyorsa HİÇBİR ŞEY PAYLAŞMA, dur ve hata ver.` : "Paylaşmadan önce hangi hesabın açık olduğunu not et.",
    onTweet || HOW[acc.platform],
    tweets && !mode ? `Flood, ${tweets.length} tweet, sırayla:\n${tweets.map((x, i) => `--- ${i + 1} ---\n${x}`).join("\n")}` : `Metin (aynen, satır boşluklarıyla):\n<<<\n${text}\n>>>`,
    mentionRule(run.post),
    acc.platform === "x" && files.length > 1 && /\.(mp4|mov)$/i.test(files[0]) ? `X'te video ve görseller aynı tweete girmez: ilk dosya (video) metinle birlikte ilk tweete yüklenir; kalan ${files.length - 1} görsel, aynı paylaşımda ilk tweete yanıt olarak eklenen ikinci tweete (metinsiz) yüklenir.` : "",
    files.length ? `Yüklenecek dosyalar (bu sırayla; dosya düğmesine tıklama, dosya yükleme aracını (file_upload ya da upload_file) dosya girişine kullan):\n${files.join("\n")}` : "Dosya yok.",
    "Kurallar: Metni değiştirme, ekleme yapma. Paylaş tuşuna yalnız bir kez bas. Paylaşıldı mı emin değilsen yeniden deneme; profilde son gönderiye bakıp kontrol et. Hesap ya da sitedeki başka hiçbir şeyi değiştirme, mesaj gönderme, beğenme. Bitince paylaşılan gönderinin adresini bulmaya çalış. Açtığın sekmeyi açık bırak.",
    'SADECE şu JSON\'u yaz: {"posted": true|false|"unknown", "url": "gönderinin adresi ya da boş", "account": "paylaşılan hesabın kullanıcı adı", "error": "paylaşılmadıysa nedeni"}',
  ].filter(Boolean).join("\n\n");
  // started.failed: Rou tarayıcıya hiç başlayamadı (uygulama yok, sekme açılmadı); o zaman gönderinin çıkmadığı kesindir.
  const started = { failed: false };
  // Görsel ve video yüklemek (Instagram carousel'i, video) 10 dakikayı aşabiliyor; süre dosya sayısıyla uzar.
  const LIMIT = Math.min(30, 12 + files.length * 3) * 60 * 1000;
  const tr = tracker(runId, "publish", { name: pb ? PB_NAME : acc.browser?.name });
  const live = { onTool: tr.onTool, onResult: tr.onResult };
  const start = async () => {
    if (!pb && panel) { started.failed = true; return { ok: false, error: `Site paneline giriş ${PB_NAME} ile yapılır; uygulama kurulu değil` }; }
    if (!pb) return runClaude(prompt(null), LIMIT, undefined, { args: chrome(POST_TOOLS), cwd: MEDIA_DIR, ...live });
    let tab;
    try { tab = await rouTab(world, `share-${runId}`, `Rou paylaşıyor · ${platformName(acc)}`, acc.platform); } catch (e) { started.failed = true; return { ok: false, error: e.message }; }
    return runClaude(prompt(tab), LIMIT, undefined, { args: rouArgs(MEDIA_DIR, [], [], { read: acc.platform === "instagram" }), cwd: MEDIA_DIR, ...live }).finally(() => releaseTab(tab.targetId));
  };
  const done = start().then((r) => {
    busy.delete(runId);
    tr.stop();
    const j = r.ok ? json(r.out) : null;
    if (j?.posted === true) { import("./notify.mjs").then(({ notify }) => notify(panel ? (j.draft ? "Yazı panele taslak olarak girildi" : j.error ? `Yazı yayında ama: ${j.error}`.slice(0, 120) : "Yazı sitede yayında") : "Gönderi paylaşıldı", read().state.runs.find((x) => x.id === runId)?.title ?? ""));
      // Site paneli: kayıt adresi değil, yazının sitedeki herkese açık adresi tutulur (panelin yolu verilirse atılır).
      const url = typeof j.url === "string" && !(panel && new URL(panel).pathname.length > 1 && j.url.includes(new URL(panel).pathname)) ? j.url : undefined;
      return update((st) => void markPosted(st, runId, { url })); }
    // Rou sonucu yazamadıysa (süre doldu, yanıt okunamadı) gönderi çıkmış olabilir: "paylaşılamadı" denmez, kontrol istenir.
    // Yoksa "Yeniden dene" ya da elle paylaşım aynı gönderiyi ikinci kez çıkarırdı.
    const never = started.failed || /Claude oturumu kapalı|Claude çalıştırılamadı/.test(r.error ?? "");
    const unsure = j?.posted === "unknown" || (!j && !never);
    const why = j ? "" : ` (Rou sonucu yazamadı: ${String(r.error || "yanıt okunamadı").replace(/\s+/g, " ").slice(0, 90)})`;
    const error = unsure ? `Paylaşılıp paylaşılmadığı anlaşılamadı${why}. Profilinden kontrol et; paylaşıldıysa 'Paylaştım' de.` : (j?.error || r.error || "Yanıt okunamadı").slice(0, 300);
    update((st) => void markPosted(st, runId, { error }));
  }).catch((e) => {
    // Paylaşım sürerken çıktı silindiyse markPosted hata verir; yakalanmazsa sunucunun tamamı kapanırdı.
    busy.delete(runId);
    tr.stop();
    console.error("paylaşım:", e?.message ?? e);
  });
  return { ok: true, done };
}

// Rou, hesabın dünyasının Playground Browser profilinde hesaba girer (oturum düştüyse).
// Rou şifre yazmaz: oturum kapalıysa ya da doğrulama kodu, CAPTCHA çıkarsa durur; girişi kullanıcı tarayıcıda yapar.
export function pbLogin(accountId) {
  const s = read().state;
  const world = s.worlds.find((w) => w.accounts?.some((a) => a.id === accountId));
  const acc = world?.accounts.find((a) => a.id === accountId);
  const site = acc && SITES[acc.platform];
  if (!acc || !site) return { ok: false, error: "Bu hesap için tarayıcı girişi yok" };
  if (!pbInstalled()) return { ok: false, error: `${PB_NAME} kurulu değil` };
  const key = `login-${accountId}`;
  if (busy.has(key)) return { ok: false, error: "Zaten giriş yapılıyor" };
  busy.add(key);
  const set = (p) => update((st) => { const a = st.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === accountId); if (a) a.pbLogin = { ...p, at: new Date().toISOString() }; });
  set({ phase: "Rou giriş yapıyor" });
  const done = (async () => {
    let tab;
    try {
      tab = await rouTab(world, key, `Rou giriş yapıyor · ${platformName(acc)}`, acc.platform);
      const prompt = [
        `Görevin: ${platformName(acc)} hesabına (${acc.handle || acc.login || acc.name}) giriş yapmak. Başka hiçbir şey yapma.`,
        rouRules(tab, acc),
        `Bu sekmede ${site.home} adresine git. Hesap zaten açıksa giriş yapma, yalnız hangi hesabın açık olduğunu bul. Açık değilse ${site.login} adresinde giriş yap.`,
        acc.handle ? `Girişten sonra açık hesabın ${acc.handle} olduğunu doğrula.` : "",
        "Paylaşma, beğenme, mesaj atma, ayar değiştirme yok. Bitince sekmeyi açık bırak.",
        'SADECE şu JSON\'u yaz: {"loggedIn": true|false, "handle": "açık hesabın kullanıcı adı ya da boş", "error": "giremediysen nedeni"}',
      ].filter(Boolean).join("\n\n");
      const r = await runClaude(prompt, 6 * 60 * 1000, undefined, { args: rouArgs(), cwd: MEDIA_DIR });
      const j = r.ok ? json(r.out) : null;
      if (j?.loggedIn) set({ ok: true, seen: String(j.handle || "") });
      else set({ ok: false, error: String(j?.error || r.error || "Yanıt okunamadı").slice(0, 300) });
    } catch (e) {
      set({ ok: false, error: String(e.message).slice(0, 300) });
    } finally {
      busy.delete(key);
      if (tab) releaseTab(tab.targetId);
    }
  })();
  return { ok: true, done };
}
