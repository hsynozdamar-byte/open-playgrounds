// Sosyal gönderiler. Uygulama (önizleme), sunucu (hazırlatma) ve pg aynı kuralları kullanır.
// Hesap DÜNYADA durur (world.accounts): paylaşım hesapları (Instagram, LinkedIn...) ve gelen kaynakları (Gmail, Slack...).
// Proje dünyanın hesaplarından kullandıklarını seçer (project.accountIds). Otomasyon ya da planlanan gönderi bir hesabı seçer
// (automation.accountId / task.post.accountId) ve o platformun bir biçimini (seçilmezse ilki). Hesap yoksa çıktı düz metindir.

// Gelen kaynakları: buradan gelenler dünyanın Defter'ine düşer. Bağlantı (okuma) Faz 3'te; şimdilik hesap kaydı.
export const FEEDS = {
  gmail: { label: "Gmail", what: "Mailler", field: "E-posta adresi", hint: "ad@gmail.com" },
  gcal: { label: "Google Takvim", what: "Toplantılar", field: "Takvimin hesabı", hint: "ad@gmail.com" },
  slack: { label: "Slack", what: "Mesajlar", field: "Çalışma alanı", hint: "şirket.slack.com" },
  clickup: { label: "ClickUp", what: "Görevler", field: "Çalışma alanı", hint: "Şirket" },
};
export const isFeed = (platform) => Object.hasOwn(FEEDS, platform);

export const PLATFORMS = {
  instagram: { label: "Instagram", formats: ["ig_post", "ig_reel"] },
  linkedin: { label: "LinkedIn", formats: ["linkedin"] },
  x: { label: "X", formats: ["tweet", "thread"] },
  threads: { label: "Threads", formats: ["threads"] },
  tiktok: { label: "TikTok", formats: ["short"] },
  youtube: { label: "YouTube Shorts", formats: ["short"] },
  other: { label: "Diğer", formats: ["text"] },
};
export const PLATFORM_LABEL = Object.fromEntries(Object.entries(PLATFORMS).map(([k, v]) => [k, v.label]));
export const FORMATS = {
  ig_post: { label: "Instagram gönderisi", short: "Gönderi" },
  ig_reel: { label: "Reels", short: "Reels" },
  linkedin: { label: "LinkedIn gönderisi", short: "Gönderi" },
  tweet: { label: "Tweet", short: "Tweet" },
  thread: { label: "Flood", short: "Flood" },
  threads: { label: "Threads gönderisi", short: "Gönderi" },
  short: { label: "Dikey video", short: "Video" },
  text: { label: "Gönderi", short: "Gönderi" },
};
export const formatsOf = (platform) => PLATFORMS[platform]?.formats ?? ["text"];
export const isVideo = (format) => format === "ig_reel" || format === "short";
// Ek alabilen biçimler: metin gönderileri. Instagram ve dikey video biçimleri zaten görsel/videodur.
export const TEXT_FORMATS = ["linkedin", "tweet", "thread", "threads", "text"];
export const canAttach = (format) => TEXT_FORMATS.includes(format);
export const ATTACH_LABEL = { image: "Görsel", video: "Video" };
// LinkedIn gönderisi görselsiz çıkmaz: eki varsayılan olarak tek görsel (otomasyonda video seçildiyse video).
export const needsImage = (format) => format === "linkedin";
export const attachOf = (format, a) => (needsImage(format) ? (a?.attach === "video" ? "video" : "image") : a?.attach);
// Görseli henüz olmayan LinkedIn çıktısı: onaylanamaz, paylaşılamaz. Paylaşılmış ya da yapılmış gönderi eksik sayılmaz.
export const missingImage = (run) => needsImage(run?.post?.format) && !run.images?.length && !run.video && !["posted", "acted"].includes(run.status);
export const platformName = (acc) => (acc.platform === "other" ? acc.name || "Diğer" : PLATFORM_LABEL[acc.platform] ?? FEEDS[acc.platform]?.label ?? acc.platform);
// Hesabın herkese açık profil adresi (hesap kontrolü). LinkedIn şirket sayfası ve site adresi olan kullanıcı adları
// adres olarak alınır; Facebook gibi "Diğer" hesaplarda kullanıcı adı adres değilse profil adresi yok (null).
export function profileUrl(acc) {
  const h = String(acc?.handle ?? "").trim();
  if (!h) return null;
  if (/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}\/\S+$/i.test(h)) return /^https?:\/\//i.test(h) ? h : `https://${h.startsWith("www.") ? h : `www.${h}`}`;
  const u = h.replace(/^@/, "");
  if (!/^[\w.]+$/.test(u)) return null;
  return {
    instagram: `https://www.instagram.com/${u}/`, threads: `https://www.threads.com/@${u}`, x: `https://x.com/${u}`,
    linkedin: `https://www.linkedin.com/in/${u}/`, tiktok: `https://www.tiktok.com/@${u}`, youtube: `https://www.youtube.com/@${u}`,
  }[acc.platform] ?? null;
}

export const TWEET_MAX = 280;
// X Premium hesapta uzun gönderi açık.
export const X_PREMIUM_MAX = 25000;
export const tweetMax = (acc) => (acc?.premium ? X_PREMIUM_MAX : TWEET_MAX);
export const THREADS_MAX = 500;
export const IG_CAPTION_MAX = 2200;
export const IG_FOLD = 125; // Instagram açıklamanın bu kadarını "devamı" demeden gösterir
export const LI_FOLD = 210; // LinkedIn "devamını gör" öncesi yaklaşık

// Eski veri: hesaplar projedeydi (project.accounts). Dünyaya taşınır, proje kullandıklarını accountIds ile tutar.
export function migrate(s) {
  let changed = false;
  for (const p of s.projects ?? []) {
    if (!p.accounts) continue;
    const w = s.worlds.find((x) => x.id === p.worldId);
    if (w) {
      w.accounts ??= [];
      for (const a of p.accounts) if (!w.accounts.some((x) => x.id === a.id)) w.accounts.push(a);
      p.accountIds = [...new Set([...(p.accountIds ?? []), ...p.accounts.map((a) => a.id)])];
    }
    delete p.accounts;
    changed = true;
  }
  return changed;
}

// Hesabı id ile bulur (tüm dünyalarda). Sonuç: hesap + dünyası.
export function accountById(s, id) {
  if (!id) return undefined;
  for (const w of s.worlds) {
    const a = w.accounts?.find((x) => x.id === id);
    if (a) return { ...a, world: w };
  }
  return undefined;
}
// Projenin kullandığı hesaplar (dünyasından, seçili sırayla).
export const accountsOfProject = (s, p) => {
  const w = p && s.worlds.find((x) => x.id === p.worldId);
  return (p?.accountIds ?? []).map((id) => w?.accounts?.find((a) => a.id === id)).filter(Boolean);
};
// Hesabı kullanan projeler: gönderi o projenin bağlamıyla (açıklama, marka, bilgi) hazırlanır.
export const projectsOfAccount = (s, id) => s.projects.filter((p) => p.accountIds?.includes(id));

// a: otomasyon ya da { projectId, accountId }. Seçili hesap silindiyse hesap yok sayılır.
// Sonuç: hesap + projesi (yoksa hesabı kullanan ilk proje) + dünyası. Gelen kaynakları (Gmail...) paylaşım hesabı değildir.
export const accountOf = (s, a) => {
  const acc = accountById(s, a?.accountId);
  if (!acc || isFeed(acc.platform)) return undefined;
  const p = (a?.projectId ? s.projects.find((x) => x.id === a.projectId) : undefined) ?? projectsOfAccount(s, acc.id)[0];
  return { ...acc, project: p };
};
// Bir işin hesabı ve biçimi: planlanan gönderide task.post, otomasyonda otomasyonunki.
export const taskRef = (s, t) => {
  if (!t) return undefined;
  if (t.post) return { projectId: t.projectId, accountId: t.post.accountId, format: t.post.format };
  const a = t.autoId ? s.automations.find((x) => x.id === t.autoId) : undefined;
  return a && t.format ? { ...a, format: t.format } : a; // sırayla biçimli otomasyonda işin kendi biçimi
};
// Elle eklenen gönderinin platformu: hesap yoksa biçimden okunur (Gönderi ekle'de seçilen platform post.format olarak durur).
export const POST_PLATFORMS = ["instagram", "linkedin", "x", "threads"];
export const platformOfFormat = (format) => (format ? Object.keys(PLATFORMS).find((p) => PLATFORMS[p].formats.includes(format)) : undefined);
export const postPlatform = (s, t) => accountOf(s, taskRef(s, t))?.platform ?? platformOfFormat(t?.post?.format);

// Hesabı seçilmemiş elle gönderi için hesap: platform seçildiyse dünyada o platformun hesabı (projenin bağlı hesabı önce),
// "Rou seçsin" ise projenin bağlı hesaplarından konuda adı geçen platform, yoksa ilki. Uygun hesap yoksa undefined (düz metin, elle paylaşım).
const HINTS = { instagram: /instagram|\big\b|reels?|carousel/i, linkedin: /linkedin/i, x: /\bx\b|tweet|twitter|flood/i, threads: /threads/i };
export function pickAccount(s, t) {
  if (!t?.post || accountOf(s, taskRef(s, t))) return undefined;
  const w = s.worlds.find((x) => x.id === t.worldId);
  const social = (w?.accounts ?? []).filter((a) => !isFeed(a.platform));
  const p = s.projects.find((x) => x.id === t.projectId);
  const mine = social.filter((a) => p?.accountIds?.includes(a.id));
  const plat = platformOfFormat(t.post.format);
  if (plat) return [...mine, ...social].find((a) => a.platform === plat);
  const text = `${t.title} ${t.post.brief ?? ""} ${t.notes ?? ""}`;
  return mine.find((a) => HINTS[a.platform]?.test(text)) ?? mine[0];
}
// Platformu seçilmiş ama dünyada o platformun hesabı olmayan gönderi: platformun adı (görev kartındaki not için).
export function missingAccount(s, t) {
  if (!t?.post || accountOf(s, taskRef(s, t))) return undefined;
  const plat = platformOfFormat(t.post.format);
  return plat && !pickAccount(s, t) ? PLATFORM_LABEL[plat] : undefined;
}

export function formatOf(s, a) {
  const acc = accountOf(s, a);
  if (!acc) return null;
  const list = formatsOf(acc.platform);
  return a.format && list.includes(a.format) ? a.format : list[0];
}

// Hesabın dili (account.lang, yoksa tr). "tr+en": önce Türkçe metin, altında aynı metnin İngilizcesi.
export const LANGS = [
  { id: "tr", label: "Türkçe" },
  { id: "en", label: "İngilizce" },
  { id: "tr+en", label: "Türkçe + İngilizce" },
];
export const SEP = "· · ·";
// Hesabın dil ayarı kesindir (dil hesap başına seçilir). Otomasyon talimatında, marka
// örneğinde ya da eski gönderilerde başka dil geçse de bu geçerli; yalnız o gönderiye yazılan revize notu dili değiştirebilir.
export function langRule(acc, format) {
  return `${langOf(acc, format)} Bu hesabın dil ayarıdır ve kesindir: otomasyon talimatı, örnek metin ya da eski gönderiler başka dilde olsa da bu dilde yaz. Yalnız bu gönderiye yazılmış bir revize notu dili değiştirebilir.`;
}
function langOf(acc, format) {
  const l = acc?.lang ?? "tr";
  if (l === "en") return "Dil: her şey İngilizce (metin, slayt, başlık, ekrandaki yazı, açıklama). Doğal, ana dili İngilizce olan biri gibi.";
  if (l !== "tr+en") return "Dil: Türkçe.";
  const visual = format === "ig_post" || format === "ig_reel" || format === "short";
  return [
    `Dil: iki dilli. Önce Türkçe metni yaz, sonra bir boş satır, tek başına "${SEP}" satırı, bir boş satır ve aynı metnin İngilizcesi.`,
    "İngilizce özet değil, aynı içeriğin doğal İngilizcesi (birebir çeviri kokmasın); paragraf sayısı aynı.",
    "Uzunluk kuralları her dil için ayrı geçerli; toplam LinkedIn sınırı 3000 karakter.",
    visual ? "Görsel/videodaki yazılar yalnız İngilizce; açıklama (caption) iki dilli." : "",
    "Tweet ya da flood ise her tweet iki dili birlikte taşıyamıyorsa yalnız Türkçe yaz.",
  ].filter(Boolean).join(" ");
}

// Biçime göre yazım kuralları. Hesabın tarzı bunlardan önce gelir; bunlar yalnız biçimdir.
export const RULES = {
  ig_post: [
    "Kaydırmalı (carousel) Instagram gönderisi: 3 ile 7 arası slayt. Slaytlar görsele basılacak, okunması 3 saniye sürmeli.",
    "1. slayt kapak: tek güçlü cümle, en fazla 8 kelime. Diğer slaytlar: kısa başlık (en fazla 6 kelime) + en fazla 2 kısa cümle.",
    "Son slayt bir kapanış: düşünceyi bağlar ya da ne yapılacağını söyler. 'Takip et' kalıbı zorunlu değil.",
    `Açıklama (caption): ilk ${IG_FOLD} karakter tek başına anlamlı olmalı, çünkü gerisi katlanır. En fazla ${IG_CAPTION_MAX} karakter; birkaç cümlelik akan paragraflar, cümle başına satır atlama yok.`,
    "Etiketler: 3 ile 8 arası, konuya özgü, # ile başlar; açıklamanın içine değil hashtags alanına yaz.",
  ],
  ig_reel: [
    "Dikey Reels videosu, ekranda yazıyla anlatılır (sesli anlatım yok). Toplam 12 ile 30 saniye.",
    "hook: ilk 2 saniyede ekranda görünen cümle, en fazla 7 kelime; izleyiciyi durdurmalı.",
    "scenes: 3 ile 7 sahne. Her sahnede ekranda tek bir kısa cümle (en fazla 10 kelime) ve süresi (sec, 2 ile 6 arası). Okuma süresi: kelime başına en az 0,4 sn.",
    "Sahnelerden birinde vurgulanacak tek kelime ya da kısa ifade (accent) seçebilirsin; o cümlenin içinden aynen alınmalı.",
    `Açıklama (caption): ilk ${IG_FOLD} karakter tek başına anlamlı. Etiketler 3 ile 8 arası, hashtags alanında.`,
  ],
  linkedin: [
    `LinkedIn ilk ${LI_FOLD} karakter civarını gösterir, gerisi "devamını gör" ile açılır. İlk iki satır okuyanı tutmalı ama şablon kanca cümlesi olmasın.`,
    "2 ile 4 paragraf; her paragraf birkaç cümlelik akan bir blok, aralarında bir boş satır. Cümle başına satır atlama yok. Toplam 600 ile 1300 karakter arası; düşünce kısaysa kısa kalsın.",
    "Etiket kullanma ya da en fazla 2. Emoji ile madde işareti yapma.",
  ],
  tweet: [
    `Tek tweet, en fazla ${TWEET_MAX} karakter (boşluklar dahil). İdeali 100 ile 220 arası.`,
    "Etiket yok, emoji en fazla bir tane. Bağlantı yok.",
  ],
  thread: [
    `Flood: 3 ile 7 tweet. Her tweet en fazla ${TWEET_MAX} karakter ve tek başına okunabilir.`,
    "İlk tweet floodu taşır; '1/' gibi numara ya da '🧵' koyma.",
    "Etiket yok.",
  ],
  threads: [
    `Tek Threads gönderisi, en fazla ${THREADS_MAX} karakter. Sohbet gibi, doğal.`,
    "Etiket en fazla bir tane. Bağlantı yok.",
  ],
  short: [
    "Dikey kısa video (TikTok ya da YouTube Shorts), ekranda yazıyla anlatılır (sesli anlatım yok). Toplam 12 ile 30 saniye.",
    "hook: ilk 2 saniyede ekranda görünen cümle, en fazla 7 kelime.",
    "scenes: 3 ile 7 sahne. Her sahnede ekranda tek bir kısa cümle (en fazla 10 kelime) ve süresi (sec, 2 ile 6 arası). Okuma süresi: kelime başına en az 0,4 sn.",
    "Sahnelerden birinde vurgulanacak tek kelime ya da kısa ifade (accent) seçebilirsin; o cümlenin içinden aynen alınmalı.",
    "Açıklama (caption): kısa; YouTube Shorts ise ilk satırı başlık gibi (en fazla 100 karakter). Etiketler 3 ile 5 arası, hashtags alanında.",
  ],
  text: [
    "Hesabın platformuna uygun düz metin gönderi. Uzunluğu talimat ve tarz belirler.",
  ],
};

// Modelden beklenen JSON şekli.
export const SCHEMA = {
  ig_post: '{"slides":[{"title":"…","text":"…","image":"medya adı","from":0}],"caption":"…","hashtags":["#…"]}',
  ig_reel: '{"hook":"…","scenes":[{"text":"…","sec":3,"accent":"…","clip":"medya adı","from":0,"asset":"obje adı"}],"caption":"…","hashtags":["#…"]}',
  linkedin: '{"text":"…"}',
  tweet: '{"tweets":["…"]}',
  thread: '{"tweets":["…","…"]}',
  threads: '{"tweets":["…"]}',
  short: '{"hook":"…","scenes":[{"text":"…","sec":3,"accent":"…","clip":"medya adı","from":0,"asset":"obje adı"}],"caption":"…","hashtags":["#…"]}',
  text: '{"text":"…"}',
};

const str = (x, max = 4000) => (typeof x === "string" ? x.replace(/—/g, ",").trim().slice(0, max) : "");
const tags = (x) => [...new Set((Array.isArray(x) ? x : typeof x === "string" ? x.split(/\s+/) : []).map((t) => str(t, 60).replace(/^#?/, "#").replace(/[\s,.;]+$/g, "")).filter((t) => t.length > 1))].slice(0, 12);

// Sahnenin/slaytın kaydı: projenin medya adı (server/library.mjs keyOf) ve başlangıç saniyesi.
const clipOf = (key, from, field) => (typeof key === "string" && key.trim() ? { [field]: key.trim().slice(0, 600), from: Math.max(0, Math.round((Number(from) || 0) * 10) / 10) } : {});

// Modelin JSON'unu biçime göre temizler. Kullanılamazsa null.
export function normalize(format, j) {
  if (!j || typeof j !== "object") return null;
  if (format === "ig_post") {
    const slides = (Array.isArray(j.slides) ? j.slides : []).map((x) => ({ title: str(x?.title, 160), text: str(x?.text, 400), ...clipOf(x?.image, x?.from, "image") })).filter((x) => x.title || x.text).slice(0, 10);
    return slides.length ? { format, slides, caption: str(j.caption, IG_CAPTION_MAX), hashtags: tags(j.hashtags) } : null;
  }
  if (isVideo(format)) {
    const scenes = (Array.isArray(j.scenes) ? j.scenes : []).map((x) => {
      const text = str(x?.text, 200);
      const accent = str(x?.accent, 80);
      return { text, sec: Math.max(1.5, Math.min(8, Number(x?.sec) || 3)), ...clipOf(x?.clip, x?.from, "clip"), ...(typeof x?.asset === "string" && x.asset.trim() ? { asset: x.asset.trim().slice(0, 120) } : {}), ...(accent && text.toLocaleLowerCase("tr").includes(accent.toLocaleLowerCase("tr")) ? { accent } : {}) };
    }).filter((x) => x.text).slice(0, 9);
    const hook = str(j.hook, 160);
    return hook || scenes.length ? { format, hook, scenes, caption: str(j.caption, IG_CAPTION_MAX), hashtags: tags(j.hashtags) } : null;
  }
  if (format === "linkedin" || format === "text") {
    const text = str(j.text, 3000);
    return text ? { format, text } : null;
  }
  if (format === "tweet" || format === "thread" || format === "threads") {
    const tweets = (Array.isArray(j.tweets) ? j.tweets : typeof j.text === "string" ? [j.text] : []).map((x) => str(x, X_PREMIUM_MAX)).filter(Boolean).slice(0, format === "threads" ? 1 : 10);
    // Tek tweet istenip birden çok yazıldıysa (revize "iki tweet" dediyse) kesme, flood olarak tut.
    // Alıntı/yanıt hedefi (server/xquote.mjs) düzenlemede kaybolmasın.
    const target = (k) => (j[k] && typeof j[k].url === "string" ? { [k]: j[k] } : {});
    const x = { ...target("quote"), ...target("reply") };
    if (format === "tweet" && tweets.length > 1) return { format: "thread", tweets, ...x };
    return tweets.length ? { format, tweets, ...x } : null;
  }
  return null;
}

// Elle yazılan metinden gönderi (pg run --body): X/Threads biçimleri tweets[] okur, diğerleri text.
export function postOfText(format, text) {
  return format === "tweet" || format === "thread" || format === "threads" ? { format, tweets: [text] } : { format, text };
}

// Paylaşırken etiketlenecek sayfalar (post.mentions: ["Acme"]): metindeki @Ad düz yazı kalmaz,
// platformun önerisinden o şirket/kişi sayfası seçilir. Paylaşan (Rou) bu satırı okur.
export function mentionRule(post) {
  const m = (post?.mentions ?? []).filter(Boolean);
  if (!m.length) return "";
  return `Etiketleme: metindeki ${m.map((x) => `@${x}`).join(", ")} düz yazı olarak kalmasın. Yazarken @ ve adı yazınca açılan öneri listesinden ${m.map((x) => `${x} şirket sayfasını`).join(", ")} seç, etiket bağlantıya dönsün. Öneride doğru sayfa (resmî, doğrulanmış) yoksa adı düz yazı bırak ve sonuçta bunu belirt.`;
}

// Kopyalanacak metin: platforma yapıştırılacak hâli.
export function bodyOf(post) {
  if (!post) return "";
  if (post.format === "ig_post" || isVideo(post.format)) return [post.caption, post.hashtags.join(" ")].filter(Boolean).join("\n\n");
  if (post.format === "linkedin" || post.format === "text") return post.text;
  return post.tweets.join("\n\n");
}

// Kurallara göre ölçülebilir sorunlar. Kontrol geçişine verilir, önizlemede de uyarı olur.
// Hesaba göre biçim kuralları: X Premium'da 280 sınırı yok.
export function rulesOf(format, acc) {
  if (!acc?.premium || (format !== "tweet" && format !== "thread")) return RULES[format];
  const long = "X Premium: 280 karakter sınırı yok. Anlatı gerektiriyorsa tek uzun gönderi yaz (paragraflar arasında bir boş satır); gereksiz uzatma.";
  return [format === "tweet" ? long : `${long} Flood istenirse her tweet tek başına okunabilir olsun.`, ...RULES[format].slice(1)];
}

export function problems(post, acc) {
  if (!post) return [];
  const out = [];
  const words = (t) => t.split(/\s+/).filter(Boolean).length;
  if (post.format === "tweet" || post.format === "thread") {
    post.tweets.forEach((t, i) => t.length > tweetMax(acc) && out.push(`${post.tweets.length > 1 ? `${i + 1}. tweet` : "Tweet"} ${t.length} karakter, en fazla ${tweetMax(acc)}.`));
    if (post.format === "thread" && post.tweets.length < 2) out.push("Flood en az 2 tweet olmalı.");
  }
  if (post.format === "threads" && post.tweets[0]?.length > THREADS_MAX) out.push(`Gönderi ${post.tweets[0].length} karakter, en fazla ${THREADS_MAX}.`);
  if (post.format === "ig_post" || isVideo(post.format)) {
    if (post.caption.length > IG_CAPTION_MAX) out.push(`Açıklama ${post.caption.length} karakter, en fazla ${IG_CAPTION_MAX}.`);
    if (post.hashtags.length > 8) out.push(`${post.hashtags.length} etiket var, en fazla 8.`);
  }
  if (post.format === "ig_post") {
    if (post.slides.length < 2) out.push("Kaydırmalı gönderi en az 2 slayt olmalı.");
    if (post.slides[0] && words(post.slides[0].title) > 10) out.push("Kapak slaytı uzun, en fazla 8 kelime.");
  }
  if (isVideo(post.format)) {
    if (post.hook && words(post.hook) > 9) out.push("Hook uzun, en fazla 7 kelime.");
    post.scenes.forEach((x, i) => words(x.text) * 0.4 > x.sec + 0.01 && out.push(`${i + 1}. sahne ${x.sec} sn içinde okunamaz.`));
  }
  if (post.format === "linkedin" && post.text.length > 3000) out.push("LinkedIn en fazla 3000 karakter.");
  return out;
}

// Video süresi: hook + sahneler + kapanış kartı (saniye).
export const HOOK_SEC = 2.2;
export const END_SEC = 2;
export const reelSeconds = (post) => (post.hook ? HOOK_SEC : 0) + post.scenes.reduce((n, x) => n + x.sec, 0) + END_SEC;

// Okunur taslak: metin, varsa slayt ve sahne yazıları (düzenleyici ve hazırlık kullanır).
export function draftText(post, body) {
  if (!post) return String(body ?? "").trim();
  const parts = [];
  if (post.text) parts.push(post.text);
  if (post.tweets?.length) parts.push(post.tweets.map((t, i) => (post.tweets.length > 1 ? `${i + 1}/ ${t}` : t)).join("\n\n"));
  if (post.hook) parts.push(`Kanca: ${post.hook}`);
  if (post.slides?.length) parts.push(post.slides.map((x, i) => `Slayt ${i + 1}: ${[x.title, x.text].filter(Boolean).join(" · ")}`).join("\n"));
  if (post.scenes?.length) parts.push(post.scenes.map((x, i) => `Sahne ${i + 1}: ${x.text ?? ""}`).join("\n"));
  if (post.caption) parts.push(`Açıklama: ${post.caption}`);
  if (post.hashtags?.length) parts.push(post.hashtags.join(" "));
  return parts.filter(Boolean).join("\n\n").trim();
}

// Marka ayarındaki onaylı örnek: brand.example ya da brand.use içindeki `Onaylı örnek: "…"`. Yoksa boş.
export function brandExample(brand) {
  if (typeof brand?.example === "string" && brand.example.trim()) return brand.example.trim();
  const m = String(brand?.use ?? "").match(/Onaylı örnek:\s*["“]([^"”]+)["”]/u);
  return m ? m[1].trim() : "";
}
