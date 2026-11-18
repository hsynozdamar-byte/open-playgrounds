import { PLATFORMS, TEXT_FORMATS, bodyOf, formatsOf, isFeed, postOfText, taskRef } from "./social.mjs";

// Revizeler: kullanıcının bir işe verdiği tüm revize notları task.revisions'ta kalır (hiç silinmez, yeni sonda).
// task.revise yalnız sıradaki hazırlığın notu (zamanlayıcının pending bayrağı orada). Rou her hazırlıkta TÜM notları görür;
// eski bir istek yeni notla çelişmedikçe geçerlidir. Yapamadığı isteği sessizce geçmez, YAPILAMADI satırıyla söyler.
export const MAX_REVISIONS = 30;

export function addRevision(task, { note, prev = "", runId, pending, files, moved } = {}) {
  const list = Array.isArray(files) ? files.filter((f) => f?.file) : [];
  const text = String(note ?? "").trim().slice(0, 2000) || (list.length ? "Eklediğim dosyaları kullan ve çıktıya ekle." : "");
  if (!text) return null;
  const at = new Date().toISOString();
  const r = { at, note: text, ...(runId ? { runId } : {}), prev: String(prev).slice(0, 4000), ...(list.length ? { files: list } : {}), ...(moved ? { moved } : {}) };
  task.revisions = [...(task.revisions ?? []), r].slice(-MAX_REVISIONS);
  task.revise = { note: text, prev: r.prev, at, ...(pending ? { pending: true } : {}) };
  return r;
}

// Revize taşıması: not başka bir dünyayı, projeyi ya da hesabı isterse gönderi oraya geçer. Otomasyon işi otomasyondan
// ayrılır ve tek seferlik GÖNDERİ işine (task.post) döner; otomasyonun kendisi değişmez. Hazırlık sonra yeni hesabın
// sesi, dili, proje markası ve Bilgi kaynaklarıyla baştan yazar. Geçersizse { error }, değişecek bir şey yoksa null.
export function movePost(s, task, { worldId, projectId, accountId } = {}) {
  if (!task || (!worldId && !projectId && !accountId)) return null;
  const owner = accountId ? s.worlds.find((w) => (w.accounts ?? []).some((a) => a.id === accountId)) : undefined;
  const acc = owner?.accounts.find((a) => a.id === accountId);
  if (accountId && (!acc || isFeed(acc.platform))) return { error: "Hesap yok" };
  const proj = projectId ? s.projects.find((p) => p.id === projectId) : undefined;
  if (projectId && !proj) return { error: "Proje yok" };
  const world = worldId ?? proj?.worldId ?? owner?.id ?? task.worldId;
  if (!s.worlds.some((w) => w.id === world)) return { error: "Dünya yok" };
  if (proj && proj.worldId !== world) return { error: "Proje o dünyada değil" };
  if (owner && owner.id !== world) return { error: "Hesap o dünyada değil" };
  const ref = taskRef(s, task);
  const from = { worldId: task.worldId, projectId: task.projectId ?? null, accountId: ref?.accountId ?? null, autoId: task.autoId ?? null };
  const auto = task.autoId ? s.automations?.find((a) => a.id === task.autoId) : undefined;
  const format = acc ? (formatsOf(acc.platform).includes(ref?.format) ? ref.format : formatsOf(acc.platform)[0]) : ref?.format;
  if (task.autoId) {
    // Otomasyonun kim hazırlar / kim paylaşır ayarı işe geçer; konu gönderinin özeti olur.
    if (!task.who && auto?.who) task.who = auto.who;
    if (!task.sharer && auto?.sharer) task.sharer = auto.sharer;
    if (task.topic?.title && auto && task.title === auto.title) task.title = task.topic.title;
    const brief = task.topic?.title ? `${task.topic.title}${task.topic.brief ? `. ${task.topic.brief}` : ""}` : task.notes || auto?.action || "";
    task.post = { accountId: "", brief, ...(task.autoSlot ? { at: task.autoSlot } : {}) };
    for (const k of ["autoId", "autoSlot", "autoDay", "format"]) delete task[k];
  }
  if (acc || task.post) task.post = { brief: "", ...task.post, accountId: acc?.id ?? task.post?.accountId ?? ref?.accountId ?? "", ...(format ? { format } : {}) };
  task.worldId = world;
  task.projectId = proj?.id ?? (world === from.worldId ? task.projectId : null);
  return { from, to: { worldId: world, projectId: task.projectId ?? null, accountId: task.post?.accountId || null } };
}

// Kopya gönderi: bir çıktıyı başka bir hesapta da paylaşmak ("şunu Threads ve LinkedIn'de de paylaş").
// Kopya her zaman GÖNDERİ işidir (task.post { accountId, format, at }), düz iş değil: yoksa Gönderiler'de görünmez,
// kimin hesabından paylaşılacağı belli olmaz. Metin ve medya aynen geçer, kopya "Onay bekliyor"da durur.
// Yalnız metin biçimlerine (LinkedIn, X, Threads) kopyalanır; Instagram/dikey video için revise ile taşınır.
// ids: { taskId, runId } yeni kimlikler. Geçersizse { error }.
export function copyPost(s, runId, accountId, { day, at, ids, now = new Date().toISOString() } = {}) {
  const run = s.runs.find((r) => r.id === runId);
  const src = run && s.tasks.find((t) => t.id === run.taskId);
  if (!run || !src) return { error: "Çıktı yok" };
  const text = (run.body?.trim() || (run.post ? bodyOf(run.post) : "")).trim();
  if (!text) return { error: "Çıktının metni yok" };
  const owner = s.worlds.find((w) => (w.accounts ?? []).some((a) => a.id === accountId));
  const acc = owner?.accounts.find((a) => a.id === accountId);
  if (!acc || isFeed(acc.platform)) return { error: "Hesap yok" };
  const formats = formatsOf(acc.platform).filter((f) => TEXT_FORMATS.includes(f));
  if (!formats.length) return { error: `${PLATFORMS[acc.platform]?.label ?? acc.platform} için kopya açılmaz, revise ile taşı` };
  const ref = taskRef(s, src);
  if (ref?.accountId === acc.id) return { error: "Gönderi zaten bu hesapta" };
  const format = formats.includes(run.post?.format) ? run.post.format : formats[0];
  // Proje: hesabı kullanan proje, yoksa aynı dünyadaysa kaynağın projesi.
  const proj = s.projects.find((p) => p.worldId === owner.id && p.status !== "done" && p.accountIds?.includes(acc.id))
    ?? (src.worldId === owner.id ? s.projects.find((p) => p.id === src.projectId) : undefined);
  const when = at ?? src.post?.at ?? src.autoSlot;
  const task = {
    id: ids.taskId, worldId: owner.id, projectId: proj?.id ?? null, title: `${src.title} · ${PLATFORMS[acc.platform]?.label ?? acc.platform}`,
    notes: src.post?.brief ?? src.notes ?? "", status: "todo", day: day ?? src.day ?? now.slice(0, 10), deadline: null, estimate: null, checklist: [],
    by: "claude", createdAt: now, who: "claude", ...(src.sharer ? { sharer: src.sharer } : {}),
    post: { accountId: acc.id, format, brief: src.post?.brief ?? "", ...(when ? { at: when } : {}) },
  };
  const copy = {
    id: ids.runId, taskId: task.id, at: now, title: task.title, body: text, status: "ready", by: run.by ?? "claude", copyOf: run.id,
    images: [...(run.images ?? [])], ...(run.video ? { video: run.video } : {}), ...(run.cover ? { cover: run.cover } : {}),
    post: { ...postOfText(format, text), ...(run.post?.mentions?.length ? { mentions: [...run.post.mentions] } : {}) },
  };
  s.tasks.push(task);
  s.runs.unshift(copy);
  return { task, run: copy };
}

// Eski veride yalnız task.revise vardı: geçmiş boşsa onu ilk kayıt say.
export const revisionsOf = (task) => task?.revisions?.length ? task.revisions : task?.revise?.note ? [{ at: task.revise.at, note: task.revise.note, prev: task.revise.prev ?? "" }] : [];

export function reviseBlock(task) {
  const list = revisionsOf(task);
  if (!list.length) return "";
  const last = list.at(-1);
  return [
    "REVİZE (en önemli kısım; diğer bütün kurallardan önce gelir):",
    `Kullanıcı bu işin çıktılarına ${list.length} kez revize notu yazdı. Hepsi geçerli; yeni bir not eskisiyle çelişirse yenisi kazanır. Notlardaki her isteği tek tek uygula, beğendiği yerleri koru.`,
    list.map((r, i) => `${i + 1}. ${r.at ? r.at.slice(0, 16).replace("T", " ") : ""}${i === list.length - 1 ? " (EN SON)" : ""}: ${r.note}${r.clear ? `\n   Netleştirilmiş istek: ${r.clear.ask}${r.clear.keep.length ? ` Koru: ${r.clear.keep.join("; ")}.` : ""}` : ""}${r.files?.length ? `\n   Eklediği dosyalar (Read ile bak; çıktıya kendiliğinden eklenir, metin ve görsel onlarla uyumlu olsun): ${r.files.map((f) => f.kind === "video" ? `video data/media/${f.file}${f.frames?.length ? ` (videonun ne gösterdiğini bu karelerden anla, Read ile aç: ${f.frames.map((x) => `data/${x}`).join(", ")}${f.said ? `; videoda söylenen: "${f.said}"` : ""}; video olduğu gibi gönderiye girer, metin videonun gerçekten gösterdiğini anlatsın)` : ""}` : `görsel data/media/${f.file}`).join(", ")}` : ""}`).join("\n"),
    bansOf(task).length ? `ASLA GEÇMEYECEK (metin, sahne, görsel/video üstü yazı, açıklama, hashtag; hiçbir yerde, örnek olarak bile): ${bansOf(task).join(", ")}` : "",
    // İlk deneme nota karşı denetlendi ve eksik kaldı (server/prepare.mjs revised): ikinci tur yalnız bunları tamamlar.
    last.redo?.length ? `İLK DENEMEDE EKSİK KALDI (taslak bunları hâlâ yapmıyor; bu turda mutlaka yap, yapılmış yerleri bozma):\n${last.redo.map((x) => `- ${x}`).join("\n")}` : "",
    last.moved ? "Bu revizeyle gönderi başka bir yere taşındı (dünya, proje ya da hesap değişti). Son çıktı eski hesabın sesiyle yazılmıştı: onu düzeltme, şimdiki hesabın sesi, dili, proje markası ve Bilgi kaynaklarıyla baştan yaz; içerikten yalnız gerçek bilgileri al." : "",
    last.prev ? `Son çıktı (bunu düzelt):\n"""\n${last.prev}\n"""` : "",
    "Bir isteği bu çıktıda yapamıyorsan (ör. bu biçime video eklenemiyor, bağlantı bilinmiyor) metni o isteği yapmış gibi değiştirme ve sessizce geçme: çıktının EN SONUNA, ayrı satırlarda `YAPILAMADI: <istek> | <neden>` yaz (JSON istendiyse JSON'un dışına, altına).",
  ].filter(Boolean).join("\n");
}

// Çıktıdaki YAPILAMADI satırlarını ayırır: { text: satırlar çıkmış çıktı, gaps: [{ ask, why }] }.
export function splitGaps(out) {
  const gaps = [];
  const text = String(out ?? "").split("\n").filter((l) => {
    const m = l.trim().replace(/^[-•*`]+\s*/, "").match(/^YAPILAMADI\s*:\s*(.+?)\s*(?:\|\s*(.+?))?`?$/i);
    if (!m) return true;
    gaps.push({ ask: m[1].trim().slice(0, 200), why: (m[2] ?? "").trim().slice(0, 300) });
    return false;
  }).join("\n").trim();
  return { text, gaps };
}

// Revize denetimi: çıktı her revizede nota karşı denetlenir (metin, görseller ve video kareleri). Denetçinin cevabı: {"missing":[{"what","part":"text|media"}]}; düz dizgi de kabul (metin sayılır).
export function parseMissed(out) {
  const m = String(out ?? "").match(/\{[\s\S]*\}/);
  let j;
  try { j = m ? JSON.parse(m[0]) : null; } catch { return []; }
  return (Array.isArray(j?.missing) ? j.missing : [])
    .map((x) => (typeof x === "string" ? { what: x } : x))
    .filter((x) => x && String(x.what ?? "").trim())
    .map((x) => ({ what: String(x.what).trim().slice(0, 200), part: x.part === "media" ? "media" : "text" }))
    .slice(0, 4);
}
// Eksik kalanı tamamlayan ikinci tur: son nota `redo` listesi eklenir (asıl not ve netleştirmesi aynen kalır) ve yalnız eksik
// kalan taraf (metin, görsel ya da ikisi) yeniden yapılır.
export function redoTask(task, missed) {
  const list = revisionsOf(task);
  return { ...task, revisions: [...list.slice(0, -1), { ...list.at(-1), redo: missed.map((m) => m.what) }] };
}
export const redoScope = (missed) => ({ text: missed.some((m) => m.part !== "media"), visual: missed.some((m) => m.part === "media") });

// Revizelerde eklenen bütün dosyalar (eskiden yeniye, tekrarsız): çıktıya eklenir.
// Sonraki bir not görseli eleştirdiyse ("mock berbat", "görsel olmamış") ondan önceki görsel ekleri düşer; yoksa beğenilmeyen ek
// her yeni hazırlıkta yine öne konurdu.
export const revisionFiles = (task) => {
  const revs = revisionsOf(task);
  let cut = -1;
  revs.forEach((r, i) => { if (!r.files?.length && VISUAL.test(fold(r.note))) cut = i; });
  const seen = new Set();
  return revs.flatMap((r, i) => (i > cut ? r.files ?? [] : [])).filter((f) => !seen.has(f.file) && seen.add(f.file));
};

// Revize notu neye dokunuyor: metin mi, görsel/video mu, ikisi mi. Kullanıcı çoğu zaman Türkçe karakter ve büyük/küçük harf
// karışık yazar ("GORSELI DUZNELE SADECE"); kökler o hâliyle de tutsun. İkisi de geçmiyorsa ikisi birden sayılır.
const fold = (t) => String(t ?? "").toLocaleLowerCase("tr").replace(/[çc]/g, "c").replace(/[ğg]/g, "g").replace(/[ıi]/g, "i").replace(/[öo]/g, "o").replace(/[şs]/g, "s").replace(/[üu]/g, "u");
export const visualNote = (n) => VISUAL.test(fold(n));
const VISUAL = /gorse|gorsl|video|vido|resim|foto|slayt|slide|kapak|ekran goru|logo|goruntu|animasyon|kasiyor|render|tasarim/;
// İçerik istekleri de metindir: "oyun içinden bahseden bir şey lazım" görsel kelimesi geçse de metni değiştirir.
const TEXT = /metin|meti|yazi|cumle|dil\b|dili|ton\b|baslik|paragraf|kelime|ifade|anlat|hikaye|giris|kapanis|link|ingilizce|turkce|emoji|hashtag|bahs|bhas|soyle|icerik|konu|tweet|twit|gonderi|karakter|rol/;
export function reviseScope(note) {
  const n = fold(note);
  const visual = VISUAL.test(n), text = TEXT.test(n);
  return visual || text ? { text, visual } : { text: true, visual: true };
}

// Bu hazırlık bir revize mi: en son not önceki bir çıktıya verildi ve ondan sonra başka bir çıktı yok (şimdiki hariç).
// Öyleyse { rev, prev, scope }: Rou baştan yazmaz, önceki çıktıyı nota göre düzenler.
export function revisionMode(s, task, runId) {
  const rev = revisionsOf(task).at(-1);
  if (!rev?.runId || rev.moved) return null;   // başka hesaba taşındı: eski metin düzeltilmez, yeni hesabın sesiyle baştan yazılır
  const prev = (s.runs ?? []).find((r) => r.id === rev.runId && r.taskId === task.id);
  if (!prev || !(prev.post || prev.body)) return null;
  const newer = (s.runs ?? []).some((r) => r.taskId === task.id && r.id !== runId && r.id !== prev.id && r.at > rev.at && r.status !== "failed");
  if (newer) return null;
  return { rev, prev, scope: rev.clear ? { text: rev.clear.text || !rev.clear.visual, visual: rev.clear.visual || rev.clear.media === "new" || asksMedia(task) } : reviseScope(rev.note) };
}

// Son revize ekleri açıkça istemiyor mu ("sadece metin", "görselsiz", "videosuz"): gönderi eksiz çıkar.
// "Alıntı" tek başına eksiz demek değil; yeni ek üretilmez, var olan taşınır.
export const noMediaNote = (task) => task?.revisions?.at(-1)?.clear?.media === "none" || /(sadece|yaln[ıi]z) metin|g[öo]rsel(siz| olmas[ıi]n)|videosuz/i.test(task?.revisions?.at(-1)?.note ?? "");
// Alıntı gönderi isteği (X'te quote): "alıntıla", "alıntı olarak paylaş", "alıntıyı düzelt", "quote tweet". Konu olarak geçen
// "alıntı kartları" / "quote cards" bu değil.
export const quoteNote = (task) => /al[ıi]nt[ıi](la|y[ıi]|s[ıi]n|\s+(olarak|yap|at\b|tweet|g[öo]nderi|payla))|quote[- ]?(tweet|post|olarak|et\b|it\b|this|le)|\bqt\b/i.test(task?.revisions?.at(-1)?.note ?? "");
// Not, var olan görselin/videonun eksik kaldığını söylüyor ("video eksik", "görsel yok"): yenisi üretilmez, önceki taşınır.
export const missingMediaNote = (task) => {
  if (task?.revisions?.at(-1)?.clear?.media === "keep") return true;
  const n = fold(task?.revisions?.at(-1)?.note);
  return /(vid|vdi|gorsel|kapak|resim)\S*\s+(bile\s+)?(eksik|yok|dus|kayb|gitm)|(eksik|kayip)\s+(vid|gorsel)/.test(n);
};
// Not açıkça görsel/video/animasyon EKLENMESİNİ istiyor mu ("paket açılış animasyonunu da ekler misin"). Netleştirme bunu
// "visual: false" diye okuyabiliyor; not açıkça istiyorsa netleştirme geçersiz.
export const asksMedia = (task) => {
  const n = fold(task?.revisions?.at(-1)?.note);
  if (/(sadece|yalniz) metin|gorsel(siz| olmasin)|videosuz|video(yu)? (kaldir|cikar|sil)/.test(n)) return false;
  // "görseli sade olsun" gibi var olan eki değiştiren notlar burada sayılmaz: yalnız ekleme fiilleri (ve hareketli kayıt için "olsun").
  const add = /(video|vid[oe]|animasyon|gif|gorsel|ekran (goruntu|kayd)|kaydi|klip|reveal|footage)\S*(\s+\S+){0,6}?\s+(ekle|koy|kullan|kaydet|cek)/;
  const motion = /(video|animasyon|gif|ekran kaydi|kaydi|klip)\S*\s+(de |da )?olsun/;
  return add.test(n) || motion.test(n);
};
// Son not görsel/video istiyor mu (netleştirmede visual + keep/new, ya da not açıkça ekletiyor): çıktı eksiz gelirse onaya düşmez.
// Bir işin kalıcı görsel kuralları: otomasyonun satırları + dünyanın satırları (world.visual).
export const visualRules = (s, task) => {
  const a = task?.autoId && s.automations?.find((x) => x.id === task.autoId);
  const w = s.worlds?.find((x) => x.id === (task?.worldId ?? a?.worldId));
  const lines = [...String(a?.visual ?? "").split("\n"), ...String(w?.visual ?? "").split("\n")].map((x) => x.trim()).filter(Boolean);
  return [...new Set(lines)].join("\n");
};
// Kurallardan biri her gönderide görsel/video şart koşuyor mu ("X gönderilerinde her zaman bir görsel bulunmalı").
// shortcut: serbest metin kural düzenli ifadeyle okunur; otomasyon formuna "her gönderide gerçek görsel" anahtarı gelince ona geç.
export const alwaysMedia = (rules) => String(rules ?? "").split("\n").map(fold).some((l) =>
  !/\b(ekleme|kullanma|koyma|olmasin)\b/.test(l) && /(\bher (zaman|gonderi\S*)|\bmutlaka|\bhep)\b.*(gorsel|video|animasyon|gif|kayit|kaydi)\S*.*\b(bulun|olmali|olsun|ekle)\S*/.test(l));
// Kalıcı kural işin kendisinin olduğu gibi paylaşılmasını istiyor mu ("ek tasarım yapılmadan markaya ait işlerin kendisi",
// "sonraki kareler işin gerçek görselleri"). Öyleyse Instagram carousel'i ilk taslakta da şablon kartla çizilmez.
// shortcut: serbest metin kural düzenli ifadeyle okunur; otomasyon formuna "işin kendisini paylaş" anahtarı gelince ona geç.
export const rawRule = (rules) => String(rules ?? "").split("\n").map(fold).some((l) =>
  /\b(ek|ekstra|ayri) tasarim\S* yap\S*madan|\bis(in|lerin) kendisi|\bisin gercek gorselleri/.test(l));
export const mediaRequired = (task) => { const c = task?.revisions?.at(-1)?.clear; return (!!c && c.visual === true && (c.media === "keep" || c.media === "new")) || asksMedia(task); };
// Taşınacak ek: önceki çıktının; onda yoksa (ör. eksiz kalmış başarısız bir tur) işin en yeni ekli çıktısının.
// Dosyaları silinmiş ya da çöpe atılmış çıktılar runs'ta olmadığından seçilmez.
export function carrySource(runs, taskId, prev, skip) {
  const has = (r) => r && (r.video || r.images?.length);
  if (has(prev)) return prev;
  return [...(runs ?? [])].filter((r) => r.taskId === taskId && r.id !== skip && has(r)).sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))[0] ?? null;
}

// Netleştirme.
// Ham not çoğu zaman öfkeli, yazım hatalı ve yarım: Rou hazırlığa başlamadan önce notu tek bir net isteğe çevirir ve revision.clear'a
// yazar: { ask, keep[], ban[], media keep|new|none|any, text, visual }. Kartta "Rou'nun anladığı" olarak görünür; hazırlık ve
// denetim ham notla birlikte bunu kullanır. ban: çıktının HİÇBİR yerinde (metin, sahne, görsel yazısı, hashtag) geçmeyecek
// ifadeler; hazırlık sonunda aranır, varsa çıktı onaya düşmez.
export const MEDIA_WISH = ["keep", "new", "none", "any"];
// Okuyucunun sürümü: eski okuyucunun (Sonnet, bağlamsız) yanlış çözdüğü, henüz sonuçlanmamış notlar yeniden okunur.
export const CLARITY_V = 4;
// Not, Rou'nun tasarladığı kart yerine işin kendisinin olduğu gibi paylaşılmasını istedi ("ekstra tasarım yapmadan
// yaptıklarımızı eklesen bile olur", "sadece yaptığımız animasyonu paylaşsan yeterli"). İşte kalıcıdır:
// sonraki küçük bir not (kısalt, şunu çıkar) şablon karta geri döndürmez.
export const rawWish = (task) => revisionsOf(task).some((r) => r.clear?.raw === true);
// Notu en güçlü model okur: önceki çıktının görsellerini ve kullanıcının iş adlarını görür, anlatım değişince görselin de değişeceğini bilir ve işin
// kendisinden öğrenilmesi gerekenleri (need) yazar: Rou yazmadan önce bunları gerçek projeden okur (server/findmedia.mjs facts).
export function clarifyPrompt(task, { account, prevText, prevMedia = "", names = [], autos = [] } = {}) {
  const list = revisionsOf(task);
  const last = list.at(-1);
  const brief = briefOf(task);
  return [
    "Kullanıcı bir sosyal medya gönderisinin çıktısına revize notu yazdı. Notu hazırlayan ekip için tek, net bir isteğe çevir. Gönderiyi sen yazmıyorsun.",
    `Gönderi: ${task.title}${account ? ` · ${account}` : ""}`,
    brief ? `Gönderinin talimatı (brief; yazar bunu her hazırlıkta okur, kullanıcı değil başka bir ajan yazmış olabilir):\n"""\n${brief.slice(0, 3000)}\n"""` : "",
    list.length > 1 ? `Önceki notlar (eskiden yeniye; hâlâ geçerli, yeni not çelişirse yeni kazanır):\n${list.slice(0, -1).map((r, i) => `${i + 1}. ${r.clear?.ask ?? r.note}${r.clear?.ban?.length ? ` [asla: ${r.clear.ban.join(", ")}]` : ""}`).join("\n")}` : "",
    prevText ? `Notun verildiği çıktı:\n"""\n${String(prevText).slice(0, 1500)}\n"""` : "",
    `Notun verildiği çıktının görselleri/videosu: ${prevMedia || "yok"}`,
    names.length ? `Kullanıcının işlerinin adları (yazım hatalı kelimeleri çözerken kullan): ${names.join(", ")}` : "",
    `YENİ NOT:\n"""\n${last?.note ?? ""}\n"""`,
    [
      "Kurallar:",
      "- Hakaret ve öfkeyi at, isteği koru. Kısaltmaları aç.",
      "- Not hızlı yazılmış olabilir: harfler yer değiştirir, eksik ya da fazla olur (ör. 'mark akimligi tasarimlairmi' = 'marka kimliği tasarımlarımı', 'portfloyo' = 'portfolyo', 'analtna' = 'anlatan'). Her kelimeyi cümlenin anlamına ve yukarıdaki adlara göre çöz. Anlamı değiştiren bir kelime uydurma; çözemediğin kelimeyi olduğu gibi bırak.",
      "- Önce kullanıcının neye kızdığını anla: çıktıya (metin ve görseller) bak, notun onun hangi yanını yanlış bulduğunu ve yerine ne istediğini bul. Not kısa ya da öfkeliyse ('tekrar dene', 'yanlış', 'neden yok') eksik kalan isteği önceki notlardan tamamla.",
      "- ask: ne değişecek, 1-4 kısa cümle, emir kipinde ve SOMUT: ne anlatılacak, ne gösterilecek. 'Düzelt', 'daha iyi yap' gibi boş cümle yazma; notu başka sözlerle tekrar etme. Önceki notlardaki hâlâ karşılanmamış istekleri de kat. Notta dikte edilen cümle varsa tırnak içinde aynen geçir.",
      "- Notlarda olmayan istek ya da kısıt EKLEME: çağrı cümlesi, siteye yönlendirme, 'yalnız şu ekranlar kullanılsın' gibi sınırlar kullanıcı söylemediyse yazılmaz. Emin olmadığın yerde dar değil geniş yorumla.",
      "- Not çıktıdaki bir şeyi sorguluyor ya da reddediyorsa ('X ne alaka', 'X ne', 'X'i neden koydun', 'X'i bırak') X'i ban'a koy, önceki notlardan ve talimattan X'i isteyen kısmı at; ask'te X'i ne metinde ne görselde isteme.",
      "- brief: talimat notla çelişiyorsa ya da notun istediği konuyu anlatmıyorsa (çıktıdaki hata talimattan geliyorsa) talimatın düzeltilmiş tam hâlini yaz: reddedilen kısım çıkmış, notun istediği konu ve açı eklenmiş, doğrulanmış bilgiler aynen korunmuş. Çelişki yoksa null.",
      "- keep: beğenilen ya da dokunulmayacak şeyler (not açıkça söylemiyorsa boş).",
      "- ban: çıktının hiçbir yerinde geçmeyecek özel adlar ya da ifadeler (ör. 'Proje X', 'Playgrounds'). Yalnız not bunu açıkça istiyorsa; genel kelime koyma.",
      "- media: keep = var olan görsel/video kalsın ya da eksik kaldı, geri gelsin; new = yeni görsel/video üretilsin; none = görselsiz, videosuz; any = not medyadan söz etmiyor.",
      "- text / visual: not metni mi, görseli/videoyu mu değiştiriyor (ikisi de olabilir).",
      "- Not metinde istemediği bir anlatımı (hikâye, benzetme, sembol, atıf) söylüyorsa ya da metnin nasıl bir dille yazılacağını tarif ediyorsa ('şöyle bir üslup olsun', 'X yaptım, bitirdim gibi') bu metin isteğidir: text true. 'Bu dil iyi, korumak lazım' gibi bir övgü, not açıkça eski metni övmüyorsa notun TARİF ETTİĞİ dile aittir; 'metni olduğu gibi koru' anlamına gelmez. ask'ta metnin yeni hâlinin nasıl olacağını notun kendi örneğiyle yaz.",
      "- ban: yasaklanan anlatımın kelimesinin yanına önceki metinde onu taşıyan ifadeleri de yaz (kelebek → 'wings', 'flap').",
      "- Not bir şeyi göstermeyi, gezdirmeyi ya da kaydetmeyi istiyorsa ('siteyi baştan sona gezdirelim', 'X'i gösterelim', 'diğer sayfalar neden yok') bu görsel isteğidir: visual true, media new.",
      "- Not çıktıdaki görseli ya da videoyu eleştiriyorsa (yanlış video, eski görsel, hızlı, kötü, aynısını koymuşsun) media new: aynı dosyalar geri gelmez.",
      "- Not gönderinin NEYİ anlattığını değiştiriyorsa (yeni açı, daha derin anlatım, işin başka bir yanı) görsel de yeni anlatımı göstermelidir: text true, visual true, media new. keep yalnız not görselin kalmasını açıkça istiyorsa.",
      "- raw: not, Rou'nun tasarladığı kart, şablon ya da ek tasarım yerine işin KENDİ görselinin, kaydının ya da animasyonunun olduğu gibi paylaşılmasını istiyorsa true (ör. 'ekstra tasarım yapmadan yaptıklarımızı eklesen bile olur', 'sadece yaptığımız animasyonu paylaşsan yeterli'). O zaman visual true, media new; ask'te ek tasarım isteme.",
      "- need: bu isteği iyi yapmak için işin KENDİSİNDEN (proje kodu, tasarım dosyaları, canlı site) öğrenilmesi gereken somut şeyler, soru olarak (ör. 'uygulamayı üç farklı kullanıcı tipi nasıl kullanıyor, her birinin hangi ekranları var?'). Not işin daha iyi, daha derin ya da doğru anlatılmasını istiyorsa doldur; yalnız üslup, uzunluk ya da tek kelime değişiyorsa boş dizi.",
      "- general: bu nottan, aynı hesabın BÜTÜN gelecek gönderilerine uyan genel ders (ör. 'Playgrounds'u konu yapma, kendi tasarım işlerimden bahset'). Yalnız bu gönderiye özel istek (alıntılanacak tweet, bu videonun kesiti, bu metnin bir cümlesi) ders değildir; öyleyse boş bırak.",
      "- rule: not 'bundan sonra', 'hep', 'bu tür gönderilerde', 'X gönderileri derlenirken' gibi KALICI bir kural koyuyorsa doldur; yoksa null. rule.autos: kuralın geçerli olduğu otomasyonların id'leri (aşağıdaki listeden; not bir grubu tarif ediyorsa, ör. 'oyun gönderileri', o gruba giren hepsi). rule.kind: visual (görsel, kapak, video, arka plan) ya da text (yazı). rule.text: kuralın kendisi, tek net cümle, Türkçe. Kural yalnız belli bir konu türü için geçerliyse (oyun gönderileri, belirli bir ürün ya da marka) bunu cümlenin başında söyle ('Oyun gönderilerinde …'); bu gönderinin konusundan çıkan isteği hesabın bütün gönderilerine genelleme.",
    ].join("\n"),
    autos.length ? `Bu dünyanın otomasyonları (rule.autos için):\n${autos.map((a) => `- ${a.id}: ${a.title}${a.here ? " (bu gönderinin otomasyonu)" : ""}`).join("\n")}` : "",
    'SADECE JSON yaz: {"ask":"...","keep":["..."],"ban":["..."],"media":"keep|new|none|any","text":true,"visual":false,"raw":false,"need":["..."],"general":"","rule":null,"brief":null}',
  ].filter(Boolean).join("\n\n");
}
export function parseClarity(out) {
  const m = String(out ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const ask = String(j?.ask ?? "").trim().slice(0, 600);
  if (!ask) return null;
  const arr = (v) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter((x) => x.length >= 3).slice(0, 8);
  return {
    ask, keep: arr(j.keep), ban: arr(j.ban),
    media: MEDIA_WISH.includes(j.media) ? j.media : "any",
    // Yasak var ama görsel değişmiyorsa yasak metne aittir: metin yeniden yazılır.
    text: j.text !== false || (arr(j.ban).length > 0 && !j.visual), visual: !!j.visual, v: CLARITY_V,
    ...(j.raw === true ? { raw: true } : {}),
    ...(arr(j.need).length ? { need: arr(j.need).slice(0, 5).map((x) => x.slice(0, 240)) } : {}),
    ...(String(j.general ?? "").trim() ? { general: String(j.general).trim().slice(0, 300) } : {}),
    ...(ruleOf(j.rule) ? { rule: ruleOf(j.rule) } : {}),
    ...(typeof j.brief === "string" && j.brief.trim().length >= 20 ? { brief: j.brief.trim().slice(0, 4000) } : {}),
  };
}
// Gönderinin talimatı: yazar bunu okur (server/prepare.mjs). Revize okuyucusu düzeltirse setBrief ile değişir, eskisi revizede kalır.
export const briefOf = (task) => String(task?.post ? task.post.brief || task.notes || "" : task?.notes || "");
export function setBrief(task, rv, brief) {
  if (!brief || !task || !rv || brief === briefOf(task)) return false;
  rv.prevBrief = briefOf(task);
  if (task.post?.brief) task.post.brief = brief; else task.notes = brief;
  return true;
}
// Kalıcı kural: revize bir gruba "bundan sonra hep" diyorsa otomasyonların kalıcı kuralına yazılır (server/prepare.mjs saveRule).
function ruleOf(r) {
  const text = String(r?.text ?? "").trim().slice(0, 300);
  const autos = (Array.isArray(r?.autos) ? r.autos : []).map(String).filter((x) => /^[a-z0-9]{4,12}$/i.test(x)).slice(0, 12);
  if (!text || !autos.length) return null;
  return { text, autos, kind: r.kind === "text" ? "text" : "visual" };
}
// Otomasyona kalıcı kuralı yazar: görsel kural automation.visual'a, yazı kuralı talimatın sonuna.
// Aynı kural ikinci kez yazılmaz. Dönüş: kuralın yazıldığı otomasyon id'leri.
export function saveRule(state, worldId, rule) {
  const done = [];
  for (const a of state.automations ?? []) {
    if (!rule?.autos?.includes(a.id) || a.worldId !== worldId) continue;
    const line = `- ${rule.text}`;
    if (rule.kind === "visual") { if (!(a.visual ?? "").includes(rule.text)) a.visual = [a.visual?.trim(), line].filter(Boolean).join("\n"); }
    else if (!(a.action ?? "").includes(rule.text)) a.action = `${(a.action ?? "").trim()}\nKalıcı kural: ${rule.text}`.trim();
    done.push(a.id);
  }
  // Birden çok otomasyonu kapsayan kural dünyaya da yazılır: sonradan açılan otomasyonlar da uyar.
  const w = done.length >= 2 && (state.worlds ?? []).find((x) => x.id === worldId);
  if (w) {
    if (rule.kind === "visual" && !(w.visual ?? "").includes(rule.text)) w.visual = [w.visual?.trim(), `- ${rule.text}`].filter(Boolean).join("\n");
  }
  return done;
}
// Bütün notların yasakları (tekrarsız). Sonraki bir not yasağı geri açabilir: "X'i geri ekle/kullan" denirse düşer.
export function bansOf(task) {
  const out = new Map();
  for (const r of revisionsOf(task)) {
    for (const b of r.clear?.ban ?? []) out.set(fold(b), b);
    for (const k of [...out.keys()]) if (new RegExp(`${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.{0,30}(geri ekle|kullan|olsun|kalsin)`).test(fold(r.note)) && !(r.clear?.ban ?? []).some((b) => fold(b) === k)) out.delete(k);
  }
  return [...out.values()];
}
// Çıktıda geçen yasaklar. Alıntılanan/yanıtlanan tweet (başkasının metni) sayılmaz.
export function banHits(task, out) {
  const bans = bansOf(task);
  if (!bans.length || !out) return [];
  const { quote, reply, ...post } = out.post ?? {};
  const hay = fold([out.body, JSON.stringify(post), JSON.stringify(out.storyboard ?? "")].join("\n"));
  return bans.filter((b) => hay.includes(fold(b)));
}

// Aynı otomasyonun (ya da aynı hesabın tek seferlik gönderilerinin) önceki görevlerine verilen revizeler: yeni gönderi ve konu
// planı aynı hatayı baştan yapmasın.
export function pastLessons(s, task, max = 8) {
  const same = (t) => t.id !== task.id && (task.autoId ? t.autoId === task.autoId : false);
  // Yalnız genel dersler (clear.general): göreve özel istek (alıntı adresi, kesit) başka gönderiye taşınmaz.
  const items = (s.tasks ?? []).filter(same).flatMap((t) => revisionsOf(t).map((r) => ({ at: r.at ?? "", text: r.clear?.general ?? "" })));
  const seen = new Set();
  return items.filter((x) => x.text && !seen.has(fold(x.text)) && seen.add(fold(x.text))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, max).map((x) => x.text);
}
export const lessonsBlock = (lines) => lines.length ? `Kullanıcı bu otomasyonun önceki gönderilerine şu revizeleri verdi (en yeniden eskiye). Aynı hatayı baştan yapma; bu gönderiye uyanları ilk taslakta uygula:\n${lines.map((x) => `- ${x}`).join("\n")}` : "";
