// Claude'un hazırladığı iş: işin talimatıyla `claude -p` çalışır, çıktısı işin altına (Run) yazılır.
// Kullanıcı uygulamadan "Hazırlat"a basınca (POST /api/prepare) ya da `pg prepare <id>` ile çalışır.
// Zamanı gelince server/schedule.mjs de çağırır.
// Sosyal hesaptaki otomasyonda (shared/social.mjs) üç adım: yaz (yapılı JSON) → kurallara göre kontrol et → görsel/video üret.
import { MEDIA_DIR, read, update, id } from "./store.mjs";
import { setChat } from "../shared/rou.mjs";
import { runClaude } from "./claude.mjs";
import { findMedia } from "./findmedia.mjs";
import { designLow, gate } from "./quality.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pushVersion } from "../shared/versions.mjs";
import { addNotice } from "../shared/notices.mjs";
import { linkTweet } from "./xquote.mjs";
import { SHARE_DIR } from "./paths.mjs";
import { CLARITY_V, setBrief, rawWish, rawRule, addRevision, alwaysMedia, banHits, mediaRequired, visualRules, saveRule, lessonsBlock, pastLessons, carrySource, clarifyPrompt, parseClarity, missingMediaNote, movePost, noMediaNote, parseMissed, quoteNote, redoScope, redoTask, reviseBlock, revisionFiles, revisionMode, revisionsOf, splitGaps, visualNote } from "../shared/revise.mjs";
import { renderPost, renderStills } from "./render.mjs";
import { attachMedia, fileOfKey, probe, timeline } from "./library.mjs";
import { DATA_DIR } from "./store.mjs";
import { prepareBrowse } from "./browse.mjs";
import { MEDIA_RULE, pullMedia } from "./postmedia.mjs";
import { stepsOf, stepText } from "../shared/repeat.mjs";
import { STORYBOARD_SCHEMA, kindsText, normalizeStoryboard, scriptOf } from "../shared/storyboard.mjs";
import { outputOf } from "../shared/stages.mjs";
import { LENGTH, VOICE_CORE, VOICE_CORE_EN, voiceBlock } from "../shared/voice.mjs";
import { guideOf } from "../shared/guide.mjs";
import { seriesColor, seriesRule } from "../shared/series.mjs";
import { FORMATS, HOOK_SEC, SCHEMA, rulesOf, langRule, accountOf, attachOf, bodyOf, canAttach, formatOf, isVideo, needsImage, normalize, platformName, problems, taskRef, pickAccount, formatsOf, platformOfFormat, PLATFORM_LABEL, postOfText, brandExample } from "../shared/social.mjs";

const LIMIT_MS = 4 * 60 * 1000; // takılırsa 4 dk sonra durdurulur
const running = new Map(); // taskId → AbortController
// Sunucu yeniden başlatılmadan önce bakılır (GET /api/busy): süren hazırlık varken yeniden başlatma işi keser.
const MISS = /^\s*KONU UYMADI\s*:\s*([^\n]*)\n*/i;
// Çıktının metinlerinden "KONU UYMADI: <neden>" satırını söker; nedeni döndürür (yoksa "").
export function stripTopicMiss(r) {
  let why = "";
  const cut = (t) => (typeof t === "string" && MISS.test(t) ? (why ||= t.match(MISS)[1].trim(), t.replace(MISS, "")) : t);
  if (r?.post) {
    for (const k of ["text", "caption", "hook"]) if (r.post[k] != null) r.post[k] = cut(r.post[k]);
    if (Array.isArray(r.post.tweets)) r.post.tweets = r.post.tweets.map(cut);
  }
  if (r) r.body = cut(r.body);
  return why.slice(0, 300);
}
export const activeJobs = () => [...running.keys()];
// Takılan hazırlık bekçisi: STUCK_MS'yi aşan iş durdurulur, çıktısı
// "Hazırlanamadı" olur; zamanlayıcı (server/schedule.mjs retryable) 20 dk sonra kendiliğinden yeniden dener.
const startedAt = new Map(); // taskId → başlangıç (ms)
export const STUCK_MS = 60 * 60 * 1000;
export function stopStuck(now = Date.now()) {
  const stuck = [...startedAt].filter(([k, t]) => now - t > STUCK_MS && running.has(k)).map(([k]) => k);
  for (const k of stuck) { running.get(k)?.abort(); running.delete(k); startedAt.delete(k); }
  for (const k of [...startedAt.keys()]) if (!running.has(k)) startedAt.delete(k);
  if (stuck.length) update((st) => { for (const r of st.runs) if (stuck.includes(r.taskId) && r.status === "working") Object.assign(r, { status: "failed", phase: undefined, queued: undefined, at: new Date().toISOString(), renderError: "60 dakikada bitmedi; Rou 20 dakika sonra kendiliğinden yeniden deneyecek." }); });
  return stuck;
}

const NO_DASH = "Uzun tire (—) kullanma. Bilmediğin rakam, isim ya da olay uydurma.";

// Projenin kaynakları (use = true olanlar): tarz rehberi, notlar, bağlantılar. Uzunluk sınırlı.
const SRC_MAX = 9000;
const SRC_TOTAL = 24000;
export function sourcesText(p) {
  let left = SRC_TOTAL;
  return (p?.sources ?? []).filter((x) => x.use !== false && left > 0).map((x) => {
    const body = String(x.body ?? "").slice(0, Math.min(SRC_MAX, left));
    left -= body.length;
    return [`### ${x.title}${x.url ? ` (${x.url})` : ""}`, body].filter(Boolean).join("\n");
  }).join("\n\n");
}
const sourcesBlock = (p) => {
  const t = sourcesText(p);
  return t ? `Projenin kaynakları (rehber ve bilgi; tarz rehberi varsa harfiyen uygula, bilgiyi buradan al, burada olmayanı uydurma. Bağlantıların içeriği açılmadı, yalnız adres ve not var):\n"""\n${t}\n"""` : "";
};

// Projenin Medya'sında İyi işaretli dosyalar (server/library.mjs): gönderi hangi kaydı kullanacaksa buradan seçilir.
// Her satır: ad, yön, süre ve (varsa) içinde ne göründüğü (project.mediaNotes).
const goodMedia = (p) => Object.entries(p?.media ?? {}).filter(([, v]) => v === "good").map(([k]) => k).slice(0, 80);
const mediaBlock = (p) => {
  const good = goodMedia(p);
  if (!good.length) return "";
  const rows = good.map((k) => {
    const f = fileOfKey(p.id, k);
    const m = f && probe(f);
    if (!m) return null;
    const shape = m.h > m.w * 1.1 ? "dikey" : "yatay";
    const note = p.mediaNotes?.[k];
    return `- ${k} · ${m.kind === "video" ? `video, ${shape}, ${Math.round(m.dur)} sn` : `görsel, ${shape}`}${note ? ` · ${note}` : ""}`;
  }).filter(Boolean);
  return rows.length ? `Kullanılabilecek medya (kullanıcının İyi dediği kayıtlar; adı tam olarak yaz, başka ad uydurma):\n${rows.join("\n")}` : "";
};
const hasMedia = (p) => goodMedia(p).length > 0 || !!p?.kit?.assets?.length;
// Kayıt dışı sahneler: projenin objeleri (project.kit).
const kitBlock = (p) => {
  const k = p?.kit;
  if (!k) return "";
  return [
    k.assets?.length ? `Objeler (asset, adı aynen):\n${k.assets.map((a) => `- ${a.name}: ${a.note}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
};

// Kayıtlı görsel kuralları: her sahne/slayt gerçek bir kayıt gösterir, yazı o kayıtta görüneni söyler.
const VISUAL_RULES = [
  "Hedef gerçek görüntü değil, bu fikrin olabilecek en iyi hâli. Önce fikri seç (POV, kıyas, ipucu, liste, komik an, açığa çıkan sonuç), sonra her sahne için en güçlü görseli: clip (ürün, uygulama ya da sahne kaydı) ya da asset (objeyi tanıtan kart). Hiçbiri yoksa sahne yalnız büyük yazılı karttır.",
  "Ekran seçerken üstüne açılmış pencere, öğretici kutusu, tanıtım popup'ı ya da koyu perdeli diyalog olan kareyi seçme; özelliği ekranın kendisinde gösteren kareyi seç.",
  "clip seçersen from: kaydın kaçıncı saniyesinden başlanacağı (videonun süresini aşmasın). Slaytta image alanı medya listesinden.",
  "Kurgu: kanca, gelişme, doruk (en güçlü görüntü orada), kapanışta başa dönen bir bağ. Yazılı kart en fazla iki sahne; ritim için kayıtla dönüşümlü kur.",
  "Yazı ekranda görüneni anlatır: üründe/uygulamada o an ne oluyor, neden önemli. Soyut duygu cümlesi yok, somut ol.",
  "hook: kayıtlı sahnelerde üstte duran başlık (vurucu kartta görünmez), en fazla 7 kelime; somut bir iddia ya da merak sorusu. Küçük üst etiket, hesap adı ya da kategori yazma.",
  "Aynı kaydı iki sahnede kullanma. Kayıtta yanmış tanıtım yazısı varsa o kaydı seçme. Uygulamanın kendi arayüz yazıları sorun değil ama sahne yazın o an ekranda görünenle çelişmesin.",
];

// Revize: kullanıcı önceki çıktıya not verdi; yeni çıktı o nota göre düzeltilir (task.revise, prepare'de yazılır).
// Bu çalışmanın önceden belirlenmiş konusu: talimat genel yön, konu bu gönderinin kendisi.
// Başlık ile içerik aynı şeyi anlatır. Revize konudan önce gelir.
const topicBlock = (task) => task.topic?.title ? `${revisionsOf(task).length ? "Bu gönderinin ilk planlanan konusu aşağıda. Kullanıcı revize notlarında konuyu ya da içeriği değiştirdiyse NOTA uy, bu konuya değil; konu revizeden sonra yeni metne göre güncellenecek.\n" : ""}Bu gönderinin konusu (önceden planlandı${revisionsOf(task).length ? "" : ", buna sadık kal"}): ${task.topic.title}${task.topic.brief ? `\nNe anlatacak: ${task.topic.brief}` : ""}${task.topic.source ? `\nGösterilecek gerçek iş (gönderiye bunun kaydı eklenecek): ${task.topic.source}. Metin yalnız orada gerçekten görüneni anlatsın; orada olmayan bir olay, deneme ya da karar hikâyesi yazma.` : ""}\nİçeriği bu başlığa göre seç: başlığın vaat ettiği şeyi (ör. "en büyük yatırım" ise tutarı açıklanmış en büyük yatırım) kaynakta bul. Kaynakta başlığa uyan içerik yoksa başlığı zorlama; en yakın gerçek içeriği yaz ve ilk satırda "KONU UYMADI: <neden>" de.` : "";
// reviseBlock: shared/revise.mjs (tüm revize notları, en son vurgulu; yapılamayanlar YAPILAMADI satırıyla döner).

function context(s, task) {
  const auto = task.autoId ? s.automations.find((a) => a.id === task.autoId) : undefined;
  const w = s.worlds.find((x) => x.id === task.worldId);
  const p = task.projectId ? s.projects.find((x) => x.id === task.projectId) : undefined;
  return { auto, w, p };
}

const isPost = (task, auto) => !!task.post || !!(auto && (auto.platforms?.length || stepsOf(auto).some((x) => x.kind === "post")));
function plainPrompt(s, task) {
  const { auto, w, p } = context(s, task);
  const past = s.runs.filter((r) => r.status === "approved" && r.taskId && s.tasks.find((t) => t.id === r.taskId)?.autoId === task.autoId && task.autoId).slice(0, 3);
  return [
    "Kullanıcının planlayıcısı Playgrounds için bir iş hazırlıyorsun. Çıktın doğrudan uygulamada onayına sunulacak.",
    `Dünya: ${w?.name ?? task.worldId}${p ? ` · Proje: ${p.name}${p.description ? ` (${p.description})` : ""}` : ""}`,
    sourcesBlock(p),
    mediaBlock(p),
    reviseBlock(task),
    laterSteps(s, task),
    `İş: ${task.title}`,
    auto?.action || task.notes ? `Talimat: ${auto?.action || task.notes}` : "",
    topicBlock(task),
    task.post ? `Bu bir sosyal medya gönderisi${platformOfFormat(task.post.format) ? ` (${PLATFORM_LABEL[platformOfFormat(task.post.format)]})` : ""}; hesabı bağlı değil, kullanıcı elle paylaşacak. Doğrudan paylaşılacak metni yaz.${task.post.brief ? `\nNe anlatacak: ${task.post.brief}` : ""}` : "",
    task.post ? voiceBlock(guideOf(read().state)) : "",
    auto?.steps?.length ? `Bu otomasyonun adımları (sen yalnız Claude olanları yaparsın; diğerleri için çıktını uygun hazırla, ör. paylaşılacak yerin biçimine göre yaz):\n${stepsOf(auto).map((x, i) => `${i + 1}. ${stepText(x)}${x.note ? ` (${x.note})` : ""}${x.tool === "claude" ? " ← sen" : ""}`).join("\n")}` : "",
    auto && (auto.platforms?.length || stepsOf(auto).some((x) => x.kind === "post")) ? voiceBlock(guideOf(read().state)) : "",
    isPost(task, auto) ? MEDIA_RULE : "",
    past.length ? `Daha önce onaylanan çıktılar (tekrar etme, tonunu koru):\n${past.map((r) => `- ${r.body.slice(0, 400)}`).join("\n")}` : "",
    `Kurallar: Sadece istenen çıktıyı yaz, başına ya da sonuna açıklama ekleme. ${NO_DASH}`,
  ].filter(Boolean).join("\n\n");
}

// Sesli video (a.voice === "me"): Rou senaryoyu sahne sahne yazar; her sahnenin görüntüsü anlatılanı gösterir.
function videoPrompt(s, task) {
  return [
    plainPrompt(s, task),
    `Bu bir dikey Reels videosunun senaryosu. Kullanıcı her sahnenin "say" cümlesini kendi sesiyle okuyacak; video her sahneyi o cümle söylendiği anda gösterecek. Çıktın yalnız bu JSON olsun (açıklama yok, kod bloğu yok):\n${STORYBOARD_SCHEMA}`,
    `Görüntü türleri (visual.kind yalnız bunlardan biri; alanları aynen kullan):\n${kindsText()}`,
    [
      "Kurallar:",
      "- 5 ile 8 sahne. Toplam 25-35 sn konuşma (yaklaşık 70-95 kelime). İlk sahne 0-2 sn kanca.",
      "- Her sahne tek fikir. Görüntü o sahnede söyleneni göstermeli: önce/sonra anlatılıyorsa card/type/color/motion ile ölçülerini ver; kural söyleniyorsa rule; bir sayfadan söz ediliyorsa screen (gerçek adres).",
      "- Aynı türü art arda ikiden fazla kullanma; en çok bir title sahnesi (kanca ya da son çıkarım).",
      "- text: ekranda kalacak en çok 8 kelime, say'i tekrar etmesin, onu özetlesin.",
      "- Rakamlar yalnız gerçek ve ölçü olarak (px, ms, oran). Yıldız sayısı gibi bilgileri sayfada gördüğün gibi yaz, görmediysen yazma.",
      "- say: günlük, kısa cümleler; kolay okunur; terimler İngilizce kalabilir.",
    ].join("\n"),
  ].join("\n\n");
}
async function prepareVideo(s, task, signal) {
  const r = await runClaude(videoPrompt(s, task), LIMIT_MS, signal, { args: ["--allowedTools", "WebSearch,WebFetch,Read", "--add-dir", MEDIA_DIR] });
  if (!r.ok) return r;
  const m = r.out.match(/\{[\s\S]*\}/);
  let sb = null;
  try { sb = m && normalizeStoryboard(JSON.parse(m[0])); } catch { /* aşağıda */ }
  if (!sb) return { ok: false, error: "Senaryo okunamadı (JSON bozuk). Yeniden hazırla." };
  return { ok: true, body: scriptOf(sb), storyboard: sb };
}

// Hesabın önceki gönderileri: onaylananlar tarz örneği, son konular tekrar etmemek için.
function history(s, acc) {
  const mine = s.runs.filter((r) => {
    const t = r.post && s.tasks.find((x) => x.id === r.taskId);
    return t && accountOf(s, taskRef(s, t))?.id === acc.id;
  }).sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  const good = mine.filter((r) => r.status !== "trashed" && (r.status === "approved" || r.status === "posted"));
  return {
    approved: good.slice(0, 3).map((r) => r.body.slice(0, 900)),
    recent: mine.slice(0, 10).map((r) => (r.body.split("\n").find((l) => l.trim()) ?? "").slice(0, 140)).filter(Boolean),
  };
}

// Projenin marka çerçevesi: kitle, içerik başlıkları, kullanılacak ve kaçınılacak ifadeler.
export function brandBlock(p) {
  const b = p?.brand;
  if (!b) return "";
  const lines = [
    b.audience && `Kitle: ${b.audience}`,
    b.pillars?.length && `İçerik başlıkları (her gönderi birine oturur): ${b.pillars.join(", ")}`,
    b.use && `Kullan: ${b.use}`,
    b.avoid && `Asla kullanma: ${b.avoid}`,
  ].filter(Boolean);
  return lines.length ? `Marka:\n${lines.join("\n")}` : "";
}

export function accountBlock(acc) {
  const p = acc.project;
  return [
    `Hesap: ${platformName(acc)} · ${acc.name || p?.name || acc.world?.name || ""}${acc.handle ? ` (${acc.handle})` : ""}`,
    p ? `Proje: ${p.name}` : "",
    p?.description ? `Proje hakkında: ${p.description}` : "",
    acc.voice ? `Hesabın tarzı (kısa not):\n${acc.voice}` : "",
    brandBlock(p),
    sourcesBlock(p),
    mediaBlock(p),
    kitBlock(p),
  ].filter(Boolean).join("\n\n");
}

export function socialPrompt(s, task, acc, format) {
  const { auto } = context(s, task);
  const h = history(s, acc);
  return [
    `Kullanıcı için bir ${FORMATS[format].label} hazırlıyorsun. Gönderi uygulamada gerçek görünümüyle önizlenecek ve onayına sunulacak.`,
    accountBlock(acc),
    task.post ? `Bu gönderinin konusu: ${task.title}\nNe anlatacak: ${task.post.brief || task.notes || task.title}${task.post.brief && task.notes ? `\nTalimat ve bilgiler: ${task.notes}` : ""}${task.post.pillar ? `\nİçerik başlığı: ${task.post.pillar}` : ""}` : `Bu otomasyonun talimatı: ${auto?.action || task.notes || task.title}`,
    task.post ? "" : topicBlock(task),
    seriesRule(seriesColor(s, task)),
    `Biçim kuralları (${FORMATS[format].label}):\n${rulesOf(format, acc).map((r) => `- ${r}`).join("\n")}`,
    langRule(acc, format),
    (format === "ig_post" || isVideo(format)) && hasMedia(acc.project) ? `Görüntü kuralları:\n${VISUAL_RULES.map((r) => `- ${r}`).join("\n")}` : "",
    voiceBlock(guideOf(read().state), acc?.lang),
    reviseBlock(task),
    revisionsOf(task).length ? "" : lessonsBlock(pastLessons(s, task)),
    laterSteps(s, task, acc, format),
    "Öncelik: revize notu > hesabın tarzı > yazı sesi > talimat > biçim kuralları. Biçim kuralları yalnız uzunluk ve yerleşimdir; tarzla çelişirse tarz kazanır.",
    brandExample(acc.project?.brand) ? `Kullanıcının onayladığı örnek metin (bu hesabın hedef sesi ve yapısı bu; cümle kuruluşunu, kişi kullanımını ve paragraf düzenini buradan al, içeriği kopyalama):\n"""\n${brandExample(acc.project.brand)}\n"""` : "",
    h.approved.length && !brandExample(acc.project?.brand) ? `Bu hesapta onaylanmış gönderiler (tonu buradan al, içeriği tekrar etme):\n${h.approved.map((b) => `"""\n${b}\n"""`).join("\n")}` : "",
    h.recent.length ? `Son gönderilerin ilk satırları (aynı konuyu ve aynı açılışı tekrar etme):\n${h.recent.map((b) => `- ${b}`).join("\n")}` : "",
    `Kurallar: ${NO_DASH} Hesap ya da proje hakkında verilmeyen bilgi (rakam, müşteri, sonuç, tarih) ekleme; emin değilsen genel ama dürüst yaz.`,
    `Çıktın SADECE şu şekilde tek bir JSON nesnesi olsun, başka hiçbir şey yazma:\n${SCHEMA[format]}`,
  ].filter(Boolean).join("\n\n");
}

// Revize turu: baştan yazmak yerine önceki çıktı nota göre düzenlenir (tek geçiş; denetim turu yok, kullanıcının istediği
// kelimeleri "iyileştirip" kaydırıyordu). Notta kullanıcının kendi cümleleri varsa metin onlarla kurulur.
// found: Rou'nun yazmadan önce işin kendisinden öğrendikleri ve gönderiye eklediği gerçek dosyalar (server/findmedia.mjs).
export const foundBlock = (found) => !found ? "" : [
  found.facts?.length ? `İŞİN GERÇEKLERİ (Rou yazmadan önce projenin kendisini okudu; metin bunlara dayanır, notun istediği anlatımı buradan kur, bunların dışında bilgi uydurma):\n${found.facts.map((x) => `- ${x}`).join("\n")}` : "",
  found.note ? `GÖNDERİYE EKLENEN GERÇEK GÖRSELLER (metin bunlarda görünenle uyumlu olsun; görünmeyen bir şeyi görselde varmış gibi anlatma): ${found.from}. ${found.note}` : "",
  found.fix ? `Eski metin gerçek işle çelişiyordu, düzelt: ${found.fix}` : "",
].filter(Boolean).join("\n\n");
function editPrompt(s, task, acc, format, prevPost, found) {
  return [
    `Kullanıcı ${FORMATS[format].label} taslağına revize notu verdi. Taslağı baştan yazmıyorsun: notun istediğini yapıyor, istemediği yere dokunmuyorsun.`,
    reviseBlock(task).replace(/Son çıktı \(bunu düzelt\):[\s\S]*?"""\n[\s\S]*?\n"""/, ""),
    `Düzenlenecek taslak (JSON):\n${JSON.stringify(prevPost)}`,
    foundBlock(found),
    [
      "Nasıl düzenlenir:",
      "- En son not en önemlisi; önce onu harfiyen uygula, sonra eski notlarla çeliştiği yer var mı bak (çelişirse yeni kazanır).",
      "- Notta dikte edilmiş cümleler çoğu zaman yön, birebir metin değil (kullanıcı notu sesle yazdırmış olabilir). İçeriği ve sırayı al, düzgün ve dolu bir metin olarak yaz; sığ, birebir aktarılmış kısa cümleler bırakma. Yalnız \"bu metni kullan\" ya da tırnak içinde hazır bir metin verdiyse onu temel al, kelimelerini koru.",
      "- Her ana fikir (ör. her şirket, her adım) kendi kısa paragrafında; paragraflar arasında boş satır. Cümle başına satır atlama yok.",
      "- \"X deme, gereksiz\" denen her şeyi tamamen çıkar; yerine benzerini koyma.",
      "- Notun söz etmediği cümleler aynen kalır. Kısalt dendiyse kısalt, uzatma. Not işin daha iyi ya da daha derin anlatılmasını istiyorsa eski cümleleri korumak zorunda değilsin: anlatımı İŞİN GERÇEKLERİ'nden yeniden kur.",
      "- Planlanmış konu ya da brief revize notlarıyla çelişiyorsa notlar geçerli; eski konuya geri dönme.",
      "- Metin iki dilliyse (Türkçe, `· · ·`, İngilizce) İngilizceyi Türkçenin son hâline göre yeniden kur, çeviri kokmasın.",
    ].join("\n"),
    accountBlock(acc),
    langRule(acc, format),
    `Yazı sesi (metne dokunduğun her yerde):\n${VOICE_CORE}${acc?.lang === "en" || acc?.lang === "tr+en" ? `\n${VOICE_CORE_EN}` : ""}\nUzunluk:\n${LENGTH}`,
    `Kurallar: ${NO_DASH} Verilmeyen bilgi ekleme.`,
    `SADECE JSON yaz (aynı şema):\n${SCHEMA[format]}`,
  ].filter(Boolean).join("\n\n");
}

function checkPrompt(acc, format, post, issues, task) {
  return [
    `Bir ${FORMATS[format].label} taslağını yayından önce denetliyorsun. Görevin: kuralları çiğneyen yerleri düzeltmek, iyi olanı bozmamak.`,
    // Revize notları burada da: denetim, Rou'nun uyguladığı revizeyi biçim kuralı diye geri almasın.
    task ? reviseBlock(task).replace(/Bir isteği bu çıktıda yapamıyorsan[\s\S]*$/, "Bu revizeleri geri alma; taslak onları uyguluyorsa koru.") : "",
    accountBlock(acc),
    `Biçim kuralları:\n${rulesOf(format, acc).map((r) => `- ${r}`).join("\n")}`,
    voiceBlock(guideOf(read().state), acc?.lang),
    langRule(acc, format),
    `Kontrol et: dil kuralına uyuyor mu; her cümleden sonra satır atlanmış mı (atlanmışsa cümleleri 2 ile 4 cümlelik akan paragraflarda birleştir); yazı sesine uymayan, yapay duran cümle var mı; tarz rehberindeki yasak ifadeler ve kalıplar var mı; yapay, reklam gibi ya da "LinkedIn postu gibi" duran cümle var mı; uydurma bilgi var mı; uzunluklar kurala uyuyor mu; Türkçe doğal mı, yazım ve noktalama doğru mu; uzun tire (—) var mı.`,
    issues.length ? `Ölçülen sorunlar (kesin düzelt):\n${issues.map((x) => `- ${x}`).join("\n")}` : "",
    `Taslak:\n${JSON.stringify(post)}`,
    `Düzeltilmiş hâli aynı şemayla ver (sorun yoksa aynen). SADECE JSON yaz:\n${SCHEMA[format]}`,
  ].filter(Boolean).join("\n\n");
}

// Metin gönderisinin eki: tek görsel (1 slaytlık ig_post şablonu) ya da dikey video (short sahneleri). Metinle aynı fikri taşır.
// Görsel kural: otomasyonun kendi satırları + dünyanın kalıcı görsel kuralları (world.visual; ör. bir dünyanın bütün gönderileri).
const autoVisual = (task) => visualRules(read().state, task);

function attachPrompt(acc, post, kind, task) {
  return [
    // Revize notları görsele ve videoya da uygulanır (ör. "görselde alt markalar olsun"); yalnız metne değil.
    task ? reviseBlock(task).replace(/Bir isteği bu çıktıda yapamıyorsan[\s\S]*$/, "Notlardaki görsel ve video isteklerini bu ekte uygula; metinle ilgili olanları metin zaten uyguladı.") : "",
    `Kullanıcının ${FORMATS[post.format]?.label ?? "gönderisi"} için ${kind === "video" ? "kısa dikey bir video" : "tek bir görsel"} hazırlıyorsun. Gönderinin metni:\n"""\n${bodyOf(post)}\n"""`,
    accountBlock(acc),
    acc.about ? `Bu yazının konusu: ${acc.about}. Yukarıdaki proje bilgisi, kayıtlar ve objeler bu projeye ait. Görsel bu projeyi gösterir: ürünün gerçek bir karesi (slaytta image) ya da objeleriyle, ilk bakışta ne olduğu anlaşılan bir kapak. Düz zemin üstüne yalnız yazı olmaz. ${acc.platform === "other" ? "Yazı kısa." : "Yazı kısa ve projenin adını taşır."}` : "",
    kind === "video"
      ? `Video ekranda yazıyla anlatılır (ses yok), 12 ile 25 saniye. hook: en fazla 7 kelime. scenes: 3 ile 5 sahne, her sahnede tek kısa cümle (en fazla 10 kelime) ve süresi (sec, 2 ile 5). Metni özetlemez, fikrin özünü gösterir. caption ve hashtags boş kalsın.`
      : acc.platform === "other" ? `Tek görsel: sitedeki yazının 16:9 kapağı (solda logo, başlık ve kısa yazı, sağda görüntü). title en fazla 32 karakter (boşluk dahil; kapakta iki satıra sığar), yazının ne anlattığını söyleyen güçlü bir başlık; logo projenin adını zaten gösteriyor, başlık adı tekrar etmez (ör. "ProjeAdı: ..." diye başlamaz); text en fazla 75 karakterlik tek cümle (iki satır) ya da boş. caption ve hashtags boş kalsın.`
      : `Tek slayt: title en fazla 8 kelime, metnin özünü taşıyan güçlü bir cümle; text en fazla 1 kısa cümle ya da boş. Görsel bu yazıdan üretilir. caption ve hashtags boş kalsın.`,
    kind !== "video" && acc.lang === "tr+en" ? "İki slayt yaz: birincisi Türkçe, ikincisi aynı görselin İngilizcesi (aynı fikir, aynı uzunluk; çeviri kokmasın). Gönderi iki dilde paylaşılıyor, her dil kendi görselini alır."
      : acc.lang === "tr+en" || acc.lang === "en" ? "Görsel/videodaki yazılar İngilizce." : "Görsel/videodaki yazılar Türkçe.",
    hasMedia(acc.project) ? `Görüntü kuralları:\n${VISUAL_RULES.map((r) => `- ${r}`).join("\n")}` : "",
    hasMedia(acc.project) ? "Ekran kartına (slaytta image) ürünün iyi bir karesini koy: ürün gerçekten kullanılırken, asıl hareket görünürken, arayüzü okunur. Menü, yükleme ya da boş ekran seçme; üstüne açılmış pencere, öğretici ya da tanıtım kutusu (popup, koyu perdeli diyalog) olan kareyi de seçme. Videodan seçiyorsan from saniyesini hareketin en dolu anına ver; ekran görüntüsü varsa en çok şey anlatanı seç." : "",
    autoVisual(task) ? `Kullanıcının bu otomasyon için kalıcı görsel kuralları (önceki revizelerinden; her görselde uy):\n${autoVisual(task)}` : "",
    seriesRule(seriesColor(read().state, task)),
    `Kurallar: ${NO_DASH} Metinde olmayan bilgi ekleme. Yazı sesi metinle aynı: sade, abartısız.`,
    `SADECE JSON yaz:\n${kind === "video" ? SCHEMA.short : SCHEMA.ig_post}`,
    'Elindekileri kullanmayı düşün: yukarıda proje kayıtları, logo (kit) ya da objeler varsa onlar zaten var, ihtiyaç diye isteme.',
    'JSON\'a "needs" alanı da ekle: bu görseli belirgin biçimde daha iyi yapacak ama elinde olmayan şeyler (ör. "logo (SVG/PNG)", "ürünün gerçek ekran görüntüsü", "ürün fotoğrafı"), en çok 3 kısa madde; eksik yoksa boş liste.',
  ].filter(Boolean).join("\n\n");
}

// Kalite kapısı: tam render'dan önce kareler çekilir, Rou onlara bakıp eleştirir, gerekirse planı düzeltir (en çok 2 tur).
// Ölçüt "olması gerekenin en iyisi": kanca, görüntü-yazı uyumu, ritim, doruk, okunurluk.
const REVIEW_ROUNDS = 2;
const PASS = 8;
// Bakılacak anlar (ms): kapak, her sahnenin ortası (ilk sahnede altyazı çıktıktan sonra), kapanış.
function stillTimes(post) {
  const out = [300];
  let t = 0;
  post.scenes.forEach((x, i) => {
    const lead = i === 0 && post.hook ? HOOK_SEC : 0;
    out.push(Math.round((t + lead + x.sec * 0.55) * 1000));
    t += lead + x.sec;
  });
  out.push(Math.round((t + 1.2) * 1000));
  return out;
}
function reviewPrompt(acc, post, sheet, lines, format, task) {
  return [
    task ? reviseBlock(task).replace(/Bir isteği bu çıktıda yapamıyorsan[\s\S]*$/, "Eleştirirken bu revizelere uyulmuş mu bak; uyulmadıysa düzelt, uyulan yerleri geri alma.") : "",
    `Bir ${FORMATS[format]?.label ?? "gönderi"} taslağını yayından önce eleştiriyorsun. Ölçüt: gerçek görüntü şart değil, olması gerekenin en iyisi olmak zorunda. Vasat bir şeyi geçirme.`,
    `Read ile şu görsele bak: ${sheet}\n${isVideo(format) ? "Soldan sağa: kapak (0,3 sn), sonra her sahnenin ortası sırayla, en sağda kapanış kartı." : "Soldan sağa: slaytlar sırayla."}`,
    format === "ig_post" && post.slides?.length <= 2 ? `Bu bir gönderinin ek görseli: slayt sayısını (${post.slides.length}) ve her slaytın dilini değiştirme${post.slides.length === 2 ? " (birincisi Türkçe, ikincisi İngilizce)" : ""}; yalnız yazıyı ve görüntüyü iyileştir.` : "",
        lines.length ? `Kullanılan kayıtların zaman çizelgeleri (gerekirse Read ile bak; kareler soldan sağa, satır satır, ilk kare 0 sn):\n${lines.join("\n")}` : "",
    accountBlock(acc),
    langRule(acc, format),
    `Görüntü kuralları:\n${VISUAL_RULES.map((r) => `- ${r}`).join("\n")}`,
    [
      "Puanla (1-10, 8 = olduğu gibi yayınlanır):",
      "- Kapak ilk karede durduruyor mu: başlık okunuyor, görüntü merak uyandırıyor.",
      "- Her sahnenin yazısı o karede görünenle örtüşüyor mu (ör. 'özel güç' yazarken ekranda 'BONKED' varsa çelişki). Çelişkide from'u zaman çizelgesinden doğru ana al ya da kaydı veya objeyi değiştir.",
      "- Bir anda tek okuma; yazı kısa ve büyük, kesilmiyor, üst üste binmiyor.",
      "- Kurgu: kanca, gelişme, doruk, kapanışta başa dönen bağ. Boş, soyut ya da tekrar eden sahne var mı.",
      "- Projenin görünümüne uyuyor mu; uydurma bilgi var mı.",
    ].join("\n"),
    `Taslak:\n${JSON.stringify(post)}`,
    `SADECE JSON yaz: {"score": 1-10, "notes": ["kısa eleştiri", ...], "post": düzeltilmiş taslak aynı şemayla ya da 8 ve üstüyse null}. Şema: ${SCHEMA[format]}`,
  ].filter(Boolean).join("\n\n");
}
async function polish(runId, s, task, acc, post, signal) {
  const pid = acc.project?.id;
  const format = post.format;
  if (!pid || !(format === "ig_post" || isVideo(format))) return { post };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-review-"));
  let review;
  try {
    for (let round = 1; round <= REVIEW_ROUNDS; round++) {
      setRun(runId, { phase: `Karelere bakıyor (${round}. tur)`, at: new Date().toISOString() });
      const st = await renderStills(runId, attachMedia(pid, post), renderAccount(s, task, acc), kitOf(s, acc, task), isVideo(format) ? stillTimes(post) : undefined, dir, signal);
      if (st.cancelled) return { cancelled: true };
      if (!st.ok) break;
      const sheet = path.join(dir, `sheet-${round}.jpg`);
      spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...st.files.flatMap((f) => ["-i", f]), "-filter_complex", `${st.files.map((_, i) => `[${i}]scale=360:-2[v${i}]`).join(";")};${st.files.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${st.files.length}`, "-q:v", "4", sheet]);
      if (!fs.existsSync(sheet)) break;
      const lines = (post.scenes ?? post.slides ?? []).map((x) => x.clip ?? x.image).filter(Boolean).map((k) => {
        const f = fileOfKey(pid, k);
        const tl = f && timeline(f);
        return tl ? `- ${k}: ${tl.file} (her kare ${tl.step} sn)` : null;
      }).filter(Boolean);
      const r = await runClaude(reviewPrompt(acc, post, sheet, lines, format, task), LIMIT_MS, signal, { args: ["--allowedTools", "Read", "--add-dir", dir, "--add-dir", path.join(DATA_DIR, "thumbs")] });
      if (r.cancelled) return r;
      const j = r.ok ? json(r.out) : null;
      if (!j) break;
      const score = Math.max(1, Math.min(10, Number(j.score) || 0));
      review = { score, notes: (Array.isArray(j.notes) ? j.notes : []).map(String).slice(0, 8), rounds: round };
      const fixed = j.post && normalize(format, { ...j.post, caption: j.post.caption ?? post.caption, hashtags: j.post.hashtags ?? post.hashtags });
      if (score >= PASS || !fixed) break;
      post = fixed;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { post, review };
}

const json = (out) => {
  const m = out.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
};
const setRun = (runId, p) => update((st) => { const r = st.runs.find((x) => x.id === runId); if (r) Object.assign(r, p); });

// Metin gönderisinin eki: Rou ekin taslağını yazar, kontrol eder ve üretir. Sonuç: { attach, images, video?, review?, template? } ya da { renderError }.
// LinkedIn görseli 4:5, 1200x1500 (slayt 1080x1350 ölçeklenir).
// Yazı başka bir projeyi anlatıyorsa görsel o projenin kayıtları ve logosuyla yapılır.
// Konu: metnin ilk satırında ya da görevin konusunda adı geçen, görüntü malzemesi olan proje (hesabın kendi projesi değil).
// En son revize notu ek istiyor mu: video > görsel. Eklenen dosya varsa ona göre (o dosyalar zaten çıktıya girer, üretim gerekmez).
// Bu metinden sonra gelen adımlar: yazım adımı bunları "yapamadım" diye not düşmesin (görsel/video ayrı adımda yapılır).
function laterSteps(s, task, acc, format) {
  const { auto } = context(s, task);
  const lines = [];
  if (wantsFootage(task)) lines.push("Gönderiye yazısız, sade bir oynanış kesiti eklenecek (oyunun gerçek kaydı; başlık, altyazı ve logo yok). Metinde videoda başlık, yazı ya da logo olduğunu söyleme; videoda görünen oyunu anlat.");
  if (format && canAttach(format) && (askedAttach(task) ?? attachOf(format, auto))) lines.push("Görsel ya da video bu metinden sonra ayrı bir adımda üretilip gönderiye eklenecek. Revizedeki görsel/video isteklerini YAPILAMADI diye yazma; metni o eke uygun yaz.");
  return lines.length ? `Sonraki adımlar:\n${lines.map((x) => `- ${x}`).join("\n")}` : "";
}
// Revize "sitedeki/sayfadaki ... videosu" istiyorsa kaydedilecek adres: önce notlardaki bağlantı, yoksa çıktı metnindeki ilk bağlantı.
// Revize sade bir oynanış görüntüsü istiyorsa ("oynanış videosu", "oyun görüntüsü", "videoda yazı olmasın"): yazılı video kurulmaz,
// projenin Medya'sında İyi işaretli gerçek oynanış kaydı seçilip yazısız bir kesit olarak eklenir.
// Hangi video: videoya değinen EN SON not karar verir (eski bir nottaki site bağlantısı yeni "site videosu değil" notunu ezmez). Yazım hataları da tanınır ("oynais goruntusu").
// "site videosu değil/olmasın" siteyi eler. Sonuç: "footage" | "site" | null.
const foldTr = (t) => String(t ?? "").toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u");
const PLAY = /oyn[a-z]{0,3}s|oynay|gameplay|oyun ?(ici|ic)? ?(gor|vid|kay)|ekran kayd|karakt/;
const SITE = /site|sayfa|\bweb|https?:\/\/|\.(com|wtf|app|io|net)\b|splash|animasyon/;
const NOT_SITE = /(site|sayfa|web)[a-z]* ?(vid[a-z]*|vd[a-z]*|kayd[a-z]*)? ?(degil|olmasin|istemiyorum)/;
// Tek seferlik gönderinin brief'i oynanış görüntüsü istiyorsa ("oyunun içinden gerçek oynanış görüntüsüyle") ilk hazırlıkta da
// Medya'daki kayıttan kesit eklenir. Brief'ten yalnız oynanış okunur, site kaydı değil.
export function videoWish(task) {
  const revs = revisionsOf(task);
  if (revs.some((x) => x.files?.length)) return null;
  for (const r of [...revs].reverse()) {
    const n = foldTr(r.note);
    const play = PLAY.test(n);
    const vid = /vid|vd[eo]|reels?\b|klip/.test(n) || play;
    if (!vid) continue;
    if (play || NOT_SITE.test(n)) return "footage";
    return SITE.test(n) ? "site" : null;
  }
  return PLAY.test(foldTr(task?.post?.brief)) ? "footage" : null;
}
export const wantsFootage = (task) => videoWish(task) === "footage";
export function footageOf(s, task, projectIds) {
  for (const pid of projectIds.filter(Boolean)) {
    const p = s.projects.find((x) => x.id === pid);
    const keys = Object.entries(p?.media ?? {}).filter(([k, v]) => v === "good" && /\.(mp4|mov|m4v|webm)$/i.test(k)).map(([k]) => k);
    const score = (k) => { const n = k.toLowerCase(); return (/gameplay|oynan/.test(n) ? 4 : 0) + (/play|level|record|screen|kayit/.test(n) ? 2 : 0) - (/scene|promo|veo|ad[_-]/.test(n) ? 3 : 0); };
    for (const k of keys.sort((a, b) => score(b) - score(a))) { const f = fileOfKey(pid, k); if (f && fs.existsSync(f)) return f; }
  }
  return null;
}
// Revize farklı karakterleri ya da rolleri istiyorsa: her biri başka bir kaydın (dosya adının son parçası rolü söyler)
// gerçek kaydından birkaç saniye, art arda tek videoda.
export function footageClips(s, task, projectIds, n = 4) {
  for (const pid of projectIds.filter(Boolean)) {
    const p = s.projects.find((x) => x.id === pid);
    const keys = Object.entries(p?.media ?? {}).filter(([k, v]) => v === "good" && /\.(mp4|mov|m4v|webm)$/i.test(k) && !/scene|promo|veo|ad[_-]/i.test(k)).map(([k]) => k);
    const seen = new Set(), out = [];
    for (const k of keys) {
      const role = (k.split(/[\\/:]/).at(-1) ?? k).replace(/\.[a-z0-9]+$/i, "").split(/[_-]/).at(-1).toLowerCase();
      const f = fileOfKey(pid, k);
      if (seen.has(role) || !f || !fs.existsSync(f)) continue;
      seen.add(role); out.push(f);
      if (out.length >= n) break;
    }
    if (out.length >= 2) return out;
  }
  return [];
}
export function montageFootage(files, out, each = 3.8) {
  const ins = files.flatMap((f) => ["-ss", "4", "-t", String(each), "-i", f]);
  // Kayıtların kendi oranı korunur (oyun kayıtları yatay 2340x1080): ilk kaydın oranında, en çok 1920 genişlik.
  const m0 = probe(files[0]) ?? { w: 1920, h: 1080 };
  const W = Math.min(1920, m0.w) & ~1, H = Math.round((W * m0.h) / m0.w) & ~1;
  const chain = files.map((_, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[v${i}]`).join(";");
  const f = spawnSync("ffmpeg", ["-y", "-v", "error", ...ins, "-filter_complex", `${chain};${files.map((_, i) => `[v${i}]`).join("")}concat=n=${files.length}:v=1:a=0[o]`, "-map", "[o]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out], { encoding: "utf8" });
  if (f.status !== 0) throw new Error(f.stderr.slice(0, 160));
  return out;
}
// Revizede kayıt kesiti seçimi (aynı klibin aynı bölümü yeniden kesilmesin). İyi işaretli gerçek kayıtların zaman çizelgeleri Rou'ya gösterilir,
// not ölçütüyle klip + başlangıç seçer; önceki seçim tekrar edilmez. { key, file, from, sec, why } | { error }.
export const noteSeconds = (note) => {
  const t = foldTr(note);
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(dk|dakika|min)/) ?? null;
  const s2 = t.match(/(\d+)\s*(sn|saniye|sec)/);
  const v = m ? Number(m[1].replace(",", ".")) * 60 : s2 ? Number(s2[1]) : 15;
  return Math.max(6, Math.min(90, Math.round(v)));
};
export async function pickFootage(s, task, projectIds, prev, signal) {
  const note = revisionsOf(task).at(-1)?.note ?? "";
  const sec = noteSeconds(note);
  const cands = [];
  for (const pid of projectIds.filter(Boolean)) {
    const p = s.projects.find((x) => x.id === pid);
    for (const [k, v] of Object.entries(p?.media ?? {})) {
      if (v !== "good" || !/\.(mp4|mov|m4v|webm)$/i.test(k) || /scene|promo|veo|ad[_-]/i.test(k)) continue;
      const f = fileOfKey(pid, k);
      const m = f && fs.existsSync(f) ? probe(f) : null;
      if (!m?.dur) continue;
      const tl = timeline(f);
      if (tl) cands.push({ key: k, file: f, dur: Math.floor(m.dur), tl });
    }
    if (cands.length) break;
  }
  if (!cands.length) return { error: "Projenin Medya'sında İyi işaretli oynanış kaydı yok" };
  const list = cands.slice(0, 12);
  const prompt = [
    "Bir gönderi için projenin gerçek kayıtlarından (oynanış, ekran kaydı) tek bir kesit seçiyorsun. Kullanıcının revize notu ölçüttür.",
    `Revize notu: ${note}`,
    `Kesitin uzunluğu: ${sec} sn (kayıt daha kısaysa kaydın tamamı).`,
    prev ? `Önceki çıktıda kullanılan kesit (kullanıcı beğenmedi, TEKRAR ETME): ${prev.key} @ ${prev.from ?? 0} sn, ${prev.sec ?? 15} sn.` : "",
    "Adaylar (her birinin zaman çizelgesi bir kare sayfası: soldan sağa, yukarıdan aşağı, her kare 'adım' saniye arayla). Her sayfayı Read ile aç ve bak:",
    list.map((c, i) => `${i + 1}. key: ${c.key} | süre: ${c.dur} sn | zaman çizelgesi: ${c.tl.file} (adım ${c.tl.step} sn)`).join("\n"),
    "Seç: notun istediğine en uygun, anlaşılır oynanan, menü/yükleme/boş ekran olmayan bölüm. Bir kayıt notta kötü denen şeyi gösteriyorsa (ör. botlar rastgele zıplıyor) onu seçme.",
    'SADECE JSON yaz: {"key": "<adayın key değeri aynen>", "from": <başlangıç sn>, "why": "<tek cümle Türkçe>"} ya da uygun yoksa {"none": "<neden>"}',
  ].filter(Boolean).join("\n\n");
  const r = await runClaude(prompt, 4 * 60 * 1000, signal, { args: ["--allowedTools", "Read", "--add-dir", path.dirname(list[0].tl.file)] });
  if (r.cancelled) return { cancelled: true };
  const j = r.ok ? json(r.out) : null;
  if (!j) return { error: "Rou kesit seçemedi" };
  if (j.none) return { error: `Uygun oynanış bölümü yok: ${String(j.none).slice(0, 160)}` };
  const c = list.find((x) => x.key === j.key);
  if (!c) return { error: "Rou listede olmayan bir kayıt seçti" };
  const len = Math.min(sec, c.dur);
  const from = Math.max(0, Math.min(Number(j.from) || 0, c.dur - len));
  if (prev && prev.key === c.key && Math.abs((prev.from ?? 0) - from) < len / 2) return { error: "Rou yine aynı bölümü seçti; yeni bir oynanış kaydı gerekiyor (Medya'da İyi işaretle)" };
  return { key: c.key, file: c.file, from, sec: len, why: String(j.why ?? "").slice(0, 200) };
}

export function cutFootage(src, out, sec = 15, from = 0) {
  const f = spawnSync("ffmpeg", ["-y", "-v", "error", ...(from > 0 ? ["-ss", String(from)] : []), "-i", src, "-t", String(sec), "-vf", "scale='min(1080,iw)':-2", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out], { encoding: "utf8" });
  if (f.status !== 0) throw new Error(f.stderr.slice(0, 160));
  return out;
}
export function siteVideoUrl(task, r) {
  const revs = revisionsOf(task);
  if (!revs.length || revs.some((x) => x.files?.length)) return null;
  const notes = revs.map((x) => x.note).join("\n");
  if (videoWish(task) !== "site") return null;
  const pick = (t) => (String(t ?? "").match(/https?:\/\/[^\s)"'<>]+/) ?? [])[0]?.replace(/[.,;]+$/, "");
  const text = r?.post ? JSON.stringify(r.post) : r?.body;
  return pick(notes) ?? pick(text) ?? null;
}
export function askedAttach(task) {
  const revs = revisionsOf(task);
  // Eklenen dosya varsa o dosyalar çıktıya girer, ayrıca üretilmez.
  if (!revs.length || revs.some((r) => r.files?.length)) return undefined;
  // Sade oynanış görüntüsü istendiyse yazılı video kurulmaz; Medya'daki gerçek kayıttan kesit eklenir (wantsFootage).
  if (wantsFootage(task)) return undefined;
  // En yeni nottan geriye: eke değinen ilk not karar verir ("görsel olmasın" gibi olumsuzlar eki kapatır).
  // Sitenin videosu istendiyse ek üretilmez; sayfa kaydı (siteVideoUrl) videoyu verir.
  for (const r of [...revs].reverse()) {
    const n = r.note.toLocaleLowerCase("tr");
    const vid = /v[iı]d[eo]|reels?\b|kl[iı]p|oynan[iı][sş]/.test(n);
    const img = /g[oö]rsel|ekran g[oö]r[uü]nt|screenshot|res[iı]m|foto[gğ]raf|kapak|[iı]mage/.test(n);
    if (!vid && !img) continue;
    if (/olmas[iı]n|olmayacak|istem[iı]yorum|ekleme\b|kald[iı]r|gerek yok/.test(n)) return undefined;
    if (vid && /s[iı]te|sayfa|web|splash|https?:\/\//.test(n)) return undefined;
    if (vid && /oyna?n[iı]?[sş]|oynans|gameplay|oyun v[iı]d|oyun g[oö]r|ekran kayd|yaz[iı] olmas[iı]n/.test(n)) return undefined;
    return vid ? "video" : "image";
  }
  return undefined;
}
async function attachStep(runId, s, task, acc, post, kind, signal) {
  const out = {};
  setRun(runId, { phase: kind === "video" ? "Video yazılıyor" : "Görsel yazılıyor", at: new Date().toISOString() });
  const third = await runClaude(attachPrompt(acc, post, kind, task), LIMIT_MS, signal);
  if (third.cancelled) return third;
  const raw = third.ok ? json(third.out) : null;
  const needs = Array.isArray(raw?.needs) ? raw.needs.map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 3) : [];
  if (needs.length) out.needs = needs;
  let extra = raw ? normalize(kind === "video" ? "short" : "ig_post", raw) : null;
  // Site yazısının kapağı (hesap türü "Diğer": blog, yönetim paneli) 16:9 çizilir; siteler kapağı yatay kartta gösterir.
  const wide = kind !== "video" && acc.platform === "other";
  if (extra && wide) extra.wide = true;
  // İki dilli hesapta görsel çifti (Türkçe + İngilizce); diğerlerinde tek görsel.
  const pair = kind !== "video" && acc.lang === "tr+en";
  if (extra?.format === "ig_post") extra = { ...extra, slides: extra.slides.slice(0, pair ? 2 : 1), caption: "", hashtags: [] };
  // Görselsiz kart onaya gitmez: hiçbir slaytın görüntüsü yoksa (ekran, kayıt) Rou gerçek görseli bilgisayarda arar; bulamazsa sorar.
  if (extra?.slides?.length && kind !== "video" && !attachMedia(acc.project?.id, extra).slides?.some((x) => x.media)) {
    const f = await realMedia(runId, task, post, out, signal);
    if (f?.cancelled) return f;
    if (f?.fail) return { ...out, renderError: f.fail, noVisual: true };
    return out;
  }
  if (extra) {
    const pol = await polish(runId, s, task, acc, extra, signal);
    if (pol.cancelled) return pol;
    // Kalite turu planı yeniden yazabilir; ek yine tek görsel (çiftte iki: Türkçe + İngilizce) kalır.
    // Çiftte tur iki slaytı korumadıysa ilk plan kullanılır (dil sırası bozulmasın).
    const want = pair ? 2 : 1;
    if (pol.post?.format === "ig_post") extra = pair && pol.post.slides?.length !== 2 ? extra : { ...pol.post, slides: pol.post.slides.slice(0, want), caption: "", hashtags: [] };
    else extra = pol.post ?? extra;
    if (wide && extra) extra.wide = true;
    if (pol.review) out.review = pol.review;
  }
  if (!extra) return { ...out, renderError: `${kind === "video" ? "Video" : "Görsel"} yazılamadı` };
  out.attach = extra;
  setRun(runId, { phase: kind === "video" ? "Video hazırlanıyor" : "Görsel hazırlanıyor", at: new Date().toISOString() });
  const template = s.runs.find((r) => r.taskId === task.id && r.template)?.template;
  if (template) out.template = template;
  const scale = kind === "image" && needsImage(post.format) ? LI_SCALE : undefined;
  // Çiftte her dil ayrı tek görsel olarak çizilir: sayaç ve "Kaydır" çıkmaz, iki bağımsız görsel olur.
  if (pair && extra.slides?.length === 2) {
    const images = [];
    for (const one of extra.slides) {
      const media = await renderPost(runId, attachMedia(acc.project?.id, { ...extra, slides: [one] }), renderAccount(s, task, acc), template, signal, kitOf(s, acc, task), scale);
      if (media.cancelled) return media;
      if (!media.ok) return Object.assign(out, { renderError: media.error });
      images.push(...(media.files.images ?? []));
    }
    return Object.assign(out, { images });
  }
  const media = await renderPost(runId, attachMedia(acc.project?.id, extra), renderAccount(s, task, acc), template, signal, kitOf(s, acc, task), scale);
  if (media.cancelled) return media;
  return Object.assign(out, media.ok ? media.files : { renderError: media.error });
}
const LI_SCALE = 1200 / 1080;

// Revize turu (revisionMode): yalnız görsel istendiyse metin aynen kalır, yalnız metin istendiyse önceki görsel/video korunur.
// Metin tek geçişte düzenlenir. Görsel istendiyse ek (ya da gönderinin kendi görselleri) yeniden üretilir.
// Son revize "yalnız metin", "görselsiz" diyorsa gönderi eksiz çıkar. "Alıntı" ya da "video eksik" diyorsa yeni ek üretilmez,
// var olan video/görsel taşınır (önceki çıktıda yoksa işin en yeni ekli çıktısından).
const MEDIA_KEYS = ["attach", "images", "video", "order", "asIs", "cover", "template"];
// İşin kendi görselleri akışa olduğu gibi girer (rawWish): Instagram carousel'i ilk görselin oranına kırptığı için her görsel
// kesilmeden 4:5 (1080x1350) kareye, markanın düz zeminine oturtulur; video görsellerle birlikteyse (carousel) ya da akışın
// kabul etmediği orandaysa (4:5'ten dar, 1,91:1'den geniş) aynı kareye alınır. Yazı, çerçeve, logo eklenmez. GIF'e dokunulmaz.
export function feedFrame(out, bg = "#ffffff") {
  const color = /^#[0-9a-f]{6}$/i.test(bg ?? "") ? `0x${bg.slice(1)}` : "0xffffff";
  const fit = "scale=1080:1350:force_original_aspect_ratio=decrease:flags=lanczos";
  const swap = (rel, args, ext) => {
    const src = path.join(DATA_DIR, rel), tmp = `${src}.feed.${ext}`;
    const f = spawnSync("ffmpeg", ["-y", "-v", "error", "-i", src, ...args, tmp], { encoding: "utf8" });
    if (f.status === 0 && fs.existsSync(tmp)) fs.renameSync(tmp, src); else fs.rmSync(tmp, { force: true });
  };
  for (const rel of out.images ?? []) {
    if (/\.gif$/i.test(rel)) continue;
    swap(rel, ["-filter_complex", `color=c=${color}:s=1080x1350[bg];[0:v]${fit}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto`, "-frames:v", "1"], path.extname(rel).slice(1));
  }
  if (out.video) {
    const [w, h] = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path.join(DATA_DIR, out.video)], { encoding: "utf8" }).stdout.trim().split(",").map(Number);
    // Carousel'de (görsel + video) Instagram bütün kareleri ilk karenin oranına kırpar: video da aynı 4:5 kareye oturur.
    const carousel = (out.images ?? []).length > 0 && Math.abs(w / h - 0.8) > 0.01;
    if (w && h && (carousel || w / h < 0.8 || w / h > 1.91)) swap(out.video, ["-vf", `${fit},pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=${color}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "copy"], "mp4");
  }
  return out;
}
// Ek taşınırken ne gösterdiği de taşınır (found.from/note): sonraki notu okuyan adım ve denetçi dosyaların ne olduğunu bilir.
const carry = (out, s, task, prev, runId) => { const src = carrySource(s.runs, task.id, prev, runId); if (src) { for (const k of MEDIA_KEYS) if (src[k]) out[k] = src[k]; if (src.found && !out.found?.note) out.found = { from: src.found.from, note: src.found.note, ...(out.found?.facts ? { facts: out.found.facts } : {}) }; } return out; };
async function reviseOnce(runId, s, task, acc, format, signal, { prev, scope: scope0, redo = false }) {
  // Görsel taşımayan biçimde (Threads, X metni) yalnız görsel revizesi hiçbir şey değiştirmez: not metne uygulanır.
  let scope = scope0.text || canAttach(format) || format === "ig_post" || isVideo(format) ? scope0 : { ...scope0, text: true };
  const prevPost = normalize(format, prev.post ?? { format, text: prev.body }) ?? prev.post;
  let post = prevPost;
  let gaps = [];
  const mediaPost = format === "ig_post" || isVideo(format);
  // Önce iş, sonra yazı: Rou yazmadan önce işin kendisini okur ve gerçek görseli bulur (findmedia: facts + dosyalar); metin onlara göre yazılır.
  // İkinci turda (redo) yalnız metin eksikse yeniden aranmaz: ilk denemenin eki ve gerçekleri taşınır.
  // Instagram ve video gönderisinde not "tasarım yapma, işin kendisini paylaş" dediyse (rawWish) şablon çizilmez: Rou işin gerçek
  // animasyonunu ve görsellerini bulur, onlar olduğu gibi çıktının eki olur.
  const raw = mediaPost && (rawWish(task) || (format === "ig_post" && rawRule(autoVisual(task)))) && !noMediaNote(task) && !revisionFiles(task).length && !(redo && !scope.visual);
  const newMedia = raw || (!(redo && !scope.visual) && !mediaPost && wantsReal(task, scope.visual) && !noMediaNote(task) && !(quoteNote(task) && ownSource(s, task, prev, runId)) && !revisionFiles(task).length && (redo || wantsNew(task) || !ownSource(s, task, prev, runId)));
  // Görsel kalıyor ama not işin daha iyi anlatılmasını istiyor (clear.need): yalnız iş okunur.
  const factsOnly = !newMedia && !redo && scope.text && needsFacts(task);
  const pre = {};
  if (newMedia || factsOnly) {
    const m = await realMedia(runId, task, prevPost ?? { format, text: prev.body }, pre, signal, { prev, factsOnly, redo, raw });
    if (m.cancelled) return m;
    // İş okunamadıysa revize durmaz: metin eldeki bilgiyle yazılır.
    if (m.fail && !factsOnly) return { ok: false, error: m.fail };
    if (raw) feedFrame(pre, kitOf(s, acc, task)?.bg?.[0]);
  }
  const found = pre.found ?? (redo ? prev.found : null);
  // Bulunan gerçek iş eski metinle çelişiyorsa metin de yeniden yazılır (not yalnız görsel istemiş olsa bile).
  if (pre.found?.fix && !scope.text) scope = { ...scope, text: true };
  if (scope.text || !prevPost) {
    setRun(runId, { phase: "Revizeyi uyguluyor" });
    const r = await runClaude(editPrompt(s, task, acc, format, prevPost ?? { format, text: prev.body }, found), LIMIT_MS, signal, { args: ["--allowedTools", "Read", "--add-dir", MEDIA_DIR] });
    if (r.cancelled) return r;
    if (!r.ok) return r;
    gaps = splitGaps(r.out).gaps;
    const j = json(r.out);
    // İş olduğu gibi paylaşılırken (raw) slaytlar çizilmez: Rou yazısız, tek dosyalı bir slayt yazabilir ve şema onu reddeder
    // Açıklama alınır, eski taslağın gerisi kalır.
    post = normalize(format, j) ?? (raw && prevPost && typeof j?.caption === "string" && j.caption.trim() ? { ...prevPost, caption: j.caption.trim(), ...(Array.isArray(j.hashtags) ? { hashtags: j.hashtags.map(String) } : {}) } : null);
    if (!post) return { ok: false, error: `Claude'un yanıtı okunamadı:\n${r.out.slice(0, 400)}` };
  }
  // fix bu turda metne uygulandı: çıktıda saklanmaz (ikinci tur onu yeniden "çelişki" diye okumasın).
  const { fix: _fix, ...kept } = found ?? {};
  const out = { ok: true, post, body: bodyOf(post), revisedFrom: prev.id, ...(gaps.length ? { gaps } : {}), ...(found ? { found: kept } : {}) };
  if (noMediaNote(task) && !mediaPost) return out;
  // Rou gerçek görseli buldu: çıktının eki odur.
  if (pre.images || pre.video) { if (pre.images) out.images = pre.images; if (pre.video) out.video = pre.video; if (pre.order) out.order = pre.order; if (raw) out.asIs = true; return out; }
  // Görsele dokunulmadı ya da not yalnız var olan ekin kaybolduğunu söylüyor: önceki ek aynen taşınır.
  if (!mediaPost && (!scope.visual || quoteNote(task) || (missingMediaNote(task) && carrySource(s.runs, task.id, prev, runId)))) return carry(out, s, task, prev, runId);
  const kind = wantsFootage(task) || (!mediaPost && wantsReal(task, scope.visual)) ? null : askedAttach(task) ?? attachOf(format, context(s, task).auto);
  if (kind && canAttach(format)) {
    setRun(runId, { post, body: out.body });
    const extra = await attachStep(runId, s, task, acc, post, kind, signal);
    if (extra.cancelled) return extra;
    Object.assign(out, extra);
  } else if (!mediaPost) {
    // Yeni ek üretilmiyorsa (ör. oynanış kesiti) önceki ek kalır.
    carry(out, s, task, prev, runId);
  }
  if (mediaPost) {
    const pol = await polish(runId, s, task, acc, post, signal);
    if (pol.cancelled) return pol;
    if (pol.post !== post) Object.assign(out, { post: pol.post, body: bodyOf(pol.post) });
    post = pol.post;
    if (pol.review) out.review = pol.review;
    setRun(runId, { phase: isVideo(format) ? "Video hazırlanıyor" : "Görseller hazırlanıyor", at: new Date().toISOString(), post, body: out.body });
    const template = prev.template ?? s.runs.find((r) => r.taskId === task.id && r.template)?.template;
    if (template) out.template = template;
    const media = await renderPost(runId, attachMedia(acc.project?.id, post), renderAccount(s, task, acc), template, signal, kitOf(s, acc, task));
    if (media.cancelled) return media;
    Object.assign(out, media.ok ? media.files : { renderError: media.error });
  }
  return out;
}

// Revize görsel istiyor ama ek yok: Rou bilgisayarda gerçek görseli kendisi arar (server/findmedia.mjs). Bulursa out.images,
// emin olamazsa sorusu çıktının hatası olur (kartta görünür, cevap Revize iste ile verilir).
// Rou'nun şablonla ürettiği ek (run.attach: başlık kartı, yazılı video) "gerçek görsel" sayılmaz; revize görsel/video
// isteyince taşınmaz, yerine gerçek kayıt aranır.
const ownSource = (s, task, prev, runId) => carrySource(s.runs.filter((r) => !r.attach), task.id, prev && !prev.attach ? prev : null, runId);
// Netleşmiş not yeni ek istiyorsa (media "new") eldeki ek taşınmaz: yenisi gerçek kayıttan aranır.
const wantsNew = (task) => task?.revisions?.at(-1)?.clear?.media === "new";
// Netleşmiş not işin kendisinden öğrenilecek şeyler saydı (clear.need): Rou yazmadan önce işi okur.
const needsFacts = (task) => !!task?.revisions?.at(-1)?.clear?.need?.length;
// Kalıcı kural "her gönderide görsel" diyorsa (alwaysMedia) revize istemese de gerçek görsel aranır; işin gerçek görseli varsa o taşınır.
const wantsReal = (task, visual = true) => mediaRequired(task) || alwaysMedia(autoVisual(task)) || (visual && !!askedAttach(task));
// Revize tek seferde yapılmalı: HER revize çıktısı nota karşı denetlenir (metin, görsel, video; denetçi dosyaları açıp bakar), eksik kalan
// taraf bir kez daha yaptırılır; yine eksikse kartta "Rou bunları yapamadı" altında yazar.
async function revised(runId, s, task, acc, format, signal, rv) {
  let out = await reviseOnce(runId, s, task, acc, format, signal, rv);
  if (!out.ok) return out;
  // Metin artık Rou'nun bulduğu gerçek işe göre aynı turda yazılır (reviseOnce); ikinci tur yalnız denetçinin bulduğu eksik için.
  let missed = await revisionMissed(runId, task, out, rv.prev, format, signal);
  if (missed.length && !signal?.aborted) {
    setRun(runId, { phase: "Rou revizede eksik kalanı tamamlıyor", at: new Date().toISOString() });
    const first = { ...rv.prev, post: out.post, body: out.body, found: out.found };
    for (const k of MEDIA_KEYS) first[k] = out[k];
    const again = await reviseOnce(runId, s, redoTask(task, missed), acc, format, signal, { prev: first, scope: redoScope(missed), redo: true });
    if (again.cancelled) return again;
    // İkinci tur çıkmadıysa (görsel bulunamadı) ilk deneme kalır, eksikler kartta görünür.
    if (again.ok) {
      out = { ...again, revisedFrom: rv.prev.id, ...(again.found || !out.found ? {} : { found: out.found }) };
      missed = await revisionMissed(runId, task, out, rv.prev, format, signal);
    }
  }
  if (missed.length) out.missed = missed.map((m) => m.what);
  return out;
}
// Hareketli dosyanın (video, GIF) beş karesi tek görselde: denetçi Read ile bakar.
function motionSheet(src, out) {
  const d = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], { encoding: "utf8" }).stdout) || 0;
  if (!d) return null;
  spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", `fps=${(5 / d).toFixed(4)},scale=320:-2,tile=5x1`, "-frames:v", "1", out]);
  return fs.existsSync(out) ? out : null;
}
export function missedPrompt(task, out, prev, files, format) {
  const rv = revisionsOf(task).at(-1);
  const names = (r) => [r?.video, ...(r?.images ?? [])].filter(Boolean).map((f) => path.basename(f)).join(", ") || "yok";
  // Görsel ve video gönderisinde yazı sahnelerin içinde: taslağın kendisi verilir.
  // İşin kendisi paylaşılan çıktıda (asIs) slaytlar çizilmez: eski slayt başlıkları denetçiye verilmez, yalnız açıklama.
  const draft = (r) => (r?.post && !canAttach(format) && !r.asIs ? JSON.stringify(r.post).slice(0, 3000) : String(r?.body ?? "").slice(0, 3000));
  return [
    "Kullanıcı bir sosyal gönderinin çıktısına revize notu yazdı, Rou çıktıyı yeniden hazırladı. Sen denetçisin: notun istediği her şey yeni çıktıda yapılmış mı bak.",
    `Revize notu: ${rv.note}`,
    rv.clear?.ask ? `Netleşmiş istek: ${rv.clear.ask}` : "",
    rv.clear?.keep?.length ? `Korunması istenenler: ${rv.clear.keep.join("; ")}` : "",
    `Önceki çıktı:\n"""\n${draft(prev)}\n"""\nÖnceki çıktının dosyaları: ${names(prev)}`,
    `Yeni çıktı:\n"""\n${draft(out)}\n"""`,
    files.length ? `Yeni çıktının dosyaları (her birini Read ile aç ve bak; hareketli dosyanın kareleri soldan sağa tek görselde):\n${files.map((f) => `- ${f.name}: ${f.path}${f.motion ? " (video ya da GIF, kareleri)" : ""}`).join("\n")}` : "Yeni çıktının dosyası yok.",
    out.found ? `Rou'nun dosyalar hakkındaki notu: ${out.found.from}. ${out.found.note}` : "",
    out.gaps?.length ? `Rou'nun yapamadığını zaten söyledikleri (yeniden yazma): ${out.gaps.map((g) => g.ask).join("; ")}` : "",
    [
      "Kurallar:",
      "- Yalnız notun AÇIKÇA istediği ve yeni çıktıda yapılmamış ya da yanlış yapılmış somut şeyi yaz.",
      "- Not metinde bir değişiklik istediyse ve metin o yönde değişmediyse eksiktir. Not görsel, video, GIF ya da animasyon istediyse ve dosya yoksa, dosya istenenden başka bir şeyi gösteriyorsa ya da hareket istenip durağan görsel geldiyse eksiktir.",
      "- Dosyalar yukarıdaki listede yoksa onları yok say; dosya adından tahmin yürütme, açıp bak.",
      "- Zevk, kalite ve üslup yorumu yapma; notta olmayan bir şeyi isteme. Emin değilsen yazma.",
      '- part: eksik yazıdaysa (metin, başlık, sahne ya da slayt yazısı, bağlantı) "text"; görselde, videoda ya da ekteyse "media".',
    ].join("\n"),
    'Yalnız JSON: {"missing": [{"what": "eksik şey, kısa, emir kipinde", "part": "text|media"}]}. Hepsi yapıldıysa {"missing": []}.',
  ].filter(Boolean).join("\n\n");
}
// Revizedeki isteklerden çıktıda karşılanmayanlar. Ucuz model, yalnız Read; hata olursa boş döner (işi durdurmaz).
async function revisionMissed(runId, task, out, prev, format, signal) {
  if (!revisionsOf(task).length || signal?.aborted) return [];
  setRun(runId, { phase: "Rou çıktıyı revize notuyla karşılaştırıyor", at: new Date().toISOString() });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pg-missed-"));
  try {
    const files = [out.video, ...(out.images ?? [])].filter(Boolean).slice(0, 7).map((f, i) => {
      const abs = path.join(DATA_DIR, f), motion = /\.(mp4|mov|webm|gif)$/i.test(f);
      return { name: path.basename(f), motion, path: motion ? motionSheet(abs, path.join(tmp, `m${i}.jpg`)) : abs };
    }).filter((f) => f.path && fs.existsSync(f.path));
    const r = await runClaude(missedPrompt(task, out, prev, files, format), 4 * 60 * 1000, signal, { args: ["--model", "sonnet", "--allowedTools", "Read", "--add-dir", MEDIA_DIR, "--add-dir", tmp] });
    return r.ok ? parseMissed(r.out) : [];
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
async function realMedia(runId, task, post, out, signal, opt = {}) {
  setRun(runId, { phase: opt.factsOnly ? "Rou işin kendisini okuyor" : opt.prev ? "Rou işi okuyor ve gerçek görseli arıyor" : "Rou bilgisayarda görsel arıyor", at: new Date().toISOString(), ...(out.body ? { post, body: out.body } : {}) });
  const f = await findMedia(runId, task, post, signal, read().state, opt);
  if (f.cancelled) return f;
  if (f.files) { if (f.files.length) out.images = f.files; if (f.video) out.video = f.video; if (f.order) out.order = f.order; out.found = { from: f.from, note: f.note, ...(f.facts?.length ? { facts: f.facts } : {}), ...(f.fix ? { fix: f.fix } : {}) }; return { done: true }; }
  if (f.ask) return { fail: `Rou soruyor: ${f.ask}${f.options?.length ? ` Bulduklarım: ${f.options.join("; ")}.` : ""} Cevabını Revize iste ile yaz.` };
  // Süre dolması ya da çökme geçicidir: senden bir şey istenmez, zamanlayıcı 20 dakika sonra yeniden dener.
  if (f.transient) return { transient: true, fail: `${f.error}. Rou 20 dakika sonra kendiliğinden yeniden deneyecek.` };
  return { fail: `${f.error}. Kaydı ya da görseli revizeye dosya olarak ekle; Rou şablon görsel üretmez.` };
}
const textOnly = (format) => !(format === "ig_post" || isVideo(format));
async function social(runId, s, task, acc, format, signal) {
  const rv = revisionMode(s, task, runId);
  if (rv) return revised(runId, s, task, acc, format, signal, rv);
  let post, gaps = [];
  // İlk taslakta da işin kendisi: otomasyonun kalıcı kuralı carousel'de ek tasarım istemiyorsa (rawRule) şablon kart çizilmez.
  // Rou önce işi okur ve gerçek dosyaları bulur (kapak bento dahil), açıklama onlara göre yazılır. Gerçek iş bulunamazsa
  // görev durmaz: eski şablon yoluyla hazırlanır ve eksik kartta yazar.
  const pre = {};
  let rawFail = "";
  if (format === "ig_post" && rawRule(autoVisual(task)) && !noMediaNote(task) && !revisionFiles(task).length) {
    const m = await realMedia(runId, task, { format, text: "" }, pre, signal, { raw: true });
    if (m.cancelled) return m;
    if (m.transient) return { ok: false, error: m.fail };
    if (m.fail) rawFail = m.fail;
    else feedFrame(pre, kitOf(s, acc, task)?.bg?.[0]);
  }
  const rawDone = !!(pre.images || pre.video);
  const brief = (prompt) => (pre.found ? `${prompt}\n\n${foundBlock(pre.found)}` : prompt);
  setRun(runId, { phase: "Yazıyor" });
  // Konu bir kaynağa dayanabilir (ör. example.com/llms.txt): ilk yazım web'e bakabilir; ikinci tur yalnız yazılanı denetler.
  const first = await runClaude(brief(socialPrompt(s, task, acc, format)), LIMIT_MS, signal, { args: ["--allowedTools", "WebSearch,WebFetch,Read", "--add-dir", MEDIA_DIR] });
  if (!first.ok) return first;
  gaps = splitGaps(first.out).gaps;
  post = normalize(format, json(first.out));
  if (!post) return { ok: false, error: `Claude'un yanıtı okunamadı:\n${first.out.slice(0, 400)}` };
  if (signal.aborted) return { cancelled: true };
  // Kontrol geçişi: başarısızsa ilk taslak kalır.
  setRun(runId, { phase: "Kontrol ediyor", at: new Date().toISOString() });
  const second = await runClaude(checkPrompt(acc, format, post, problems(post, acc), task), LIMIT_MS, signal);
  if (second.cancelled) return second;
  const fixed = second.ok ? normalize(format, json(second.out)) : null;
  if (fixed) post = fixed;
  const out = { ok: true, post, body: bodyOf(post), ...(gaps.length ? { gaps } : {}) };
  if (rawDone) { const { fix: _fix, ...found } = pre.found ?? {}; return { ...out, asIs: true, ...(pre.images ? { images: pre.images } : {}), ...(pre.video ? { video: pre.video } : {}), ...(pre.order ? { order: pre.order } : {}), found }; }
  if (rawFail) out.gaps = [...(out.gaps ?? []), { ask: "Kural gereği işin kendi görselleri paylaşılacaktı", why: `${rawFail} Şablonla hazırlandı.` }];
  // Revizede görsel ya da video istendiyse (ek ayarı boş olsa da) o ek üretilir: "video ekle", "ekran görüntüsü ekle" gibi.
  // Gerçek oynanış görüntüsü istendiyse yazılı görsel/video üretilmez (LinkedIn'in varsayılan görseli dahil); kesit sonra eklenir.
  // Revizede verilen görsel/video çıktıya kendisi girer (prepare sonu): üstüne şablon görsel üretilmez.
  // Yeniden hazırlatılan metin gönderisi (revize yok): işin daha önce onaya düşmüş bir çıktısında video ya da görsel varsa (elle
  // eklenmiş kayıt, GIF, carousel) o korunur; şablon kart yeniden üretilmez.
  // Son revize "yalnız metin", "görselsiz" diyorsa önceki video/görsel taşınmaz, yeni ek de üretilmez. "Alıntı" ya da "video eksik"
  // diyorsa yeni ek üretilmez, işin var olan videosu taşınır.
  const bare = noMediaNote(task);
  // "Koru" ancak korunacak ek varsa taşır; yoksa yeni ek istenmiş sayılır.
  const reuse = quoteNote(task) || (missingMediaNote(task) && !!carrySource(s.runs, task.id, null, runId));
  // Görselsiz şablon kart (ekindeki hiçbir slaytın görüntüsü yok) taşınmaz: yeniden hazırlıkta da boş kart onaya dönmesin.
  const blank = (r) => !!r.attach?.slides?.length && !r.video && !attachMedia(acc?.project?.id, r.attach).slides?.some((x) => x.media);
  const keep = !bare && textOnly(format) && (s.runs.filter((r) => r.taskId === task.id && r.id !== runId && ["ready", "approved", "posted"].includes(r.status) && (r.video || r.images?.length) && !blank(r)).sort((a, b) => b.at.localeCompare(a.at))[0] || (reuse && carrySource(s.runs, task.id, null, runId)));
  const kept = keep || null;
  if (kept) for (const k of MEDIA_KEYS) if (kept[k]) out[k] = kept[k];
  let found = false;
  if (!bare && textOnly(format) && wantsReal(task) && !(quoteNote(task) && ownSource(s, task, null, runId)) && !revisionFiles(task).length && (wantsNew(task) || !ownSource(s, task, null, runId))) {
    for (const k of MEDIA_KEYS) delete out[k];
    const m = await realMedia(runId, task, post, out, signal);
    if (m.cancelled) return m;
    // Görseli revize değil yalnız kalıcı kural istiyorsa ve gerçek görsel bulunamadıysa taslak yine onaya düşer; eksik kartta yazar.
    // (Konu gündemden gelmiş olabilir: kullanıcının gösterecek kendi işi yoktur. Süre dolması geçicidir, o yeniden denenir.)
    const ruleOnly = !mediaRequired(task) && !askedAttach(task);
    if (m.fail && !(ruleOnly && !m.transient)) return { ok: false, error: m.fail };
    if (m.fail) out.gaps = [...(out.gaps ?? []), { ask: "Kural gereği görsel gerekli ama bulunamadı", why: m.fail }];
    found = !!m.done;
  }
  const kind = found || (textOnly(format) && wantsReal(task)) || bare || reuse || kept || wantsFootage(task) || revisionFiles(task).length ? null : askedAttach(task) ?? attachOf(format, context(s, task).auto);
  if (kind && canAttach(format)) {
    setRun(runId, { post, body: out.body });
    const extra = await attachStep(runId, s, task, acc, post, kind, signal);
    if (extra.cancelled) return extra;
    Object.assign(out, extra);
  }
  if (format === "ig_post" || isVideo(format)) {
    const pol = await polish(runId, s, task, acc, post, signal);
    if (pol.cancelled) return pol;
    if (pol.post !== post) Object.assign(out, { post: pol.post, body: bodyOf(pol.post) });
    post = pol.post;
    if (pol.review) out.review = pol.review;
    setRun(runId, { phase: isVideo(format) ? "Video hazırlanıyor" : "Görseller hazırlanıyor", at: new Date().toISOString(), post, body: out.body });
    // Yeniden hazırlatılan gönderi önceki şablonunu korur.
    const template = s.runs.find((r) => r.taskId === task.id && r.template)?.template;
    if (template) out.template = template;
    const media = await renderPost(runId, attachMedia(acc.project?.id, post), renderAccount(s, task, acc), template, signal, kitOf(s, acc, task));
    if (media.cancelled) return media;
    Object.assign(out, media.ok ? media.files : { renderError: media.error });
  }
  return out;
}

// Görselin görünümü: projenin kiti, yoksa dünyanın kiti.
// Kitin parmak izi: çıktı hangi görünümle çizildi.
// Seri rengi parmak izine girmez: renk atanınca onay bekleyen eski görseller yeniden çizilmez, yalnız sonraki hazırlıklar etkilenir.
export const kitHash = (k) => {
  const { seriesColor: _, ...rest } = k ?? {};
  return createHash("md5").update(JSON.stringify(k ? rest : null)).digest("hex").slice(0, 10);
};
// Seri rengi (automation.color, shared/series.mjs seriesColor): kitin vurgu rengi bu seride onunla değişir; yazı tipi, logo ve dil aynı kalır.
export const kitOf = (s, acc, task) => {
  const kit = acc?.project?.kit ?? s.worlds.find((w) => w.id === (acc?.project?.worldId ?? acc?.world?.id))?.kit;
  const color = seriesColor(s, task);
  if (!kit) return kit;
  return color ? { ...kit, seriesColor: color } : kit;
};

// Görsellerdeki hesap adı ve renk; seri rengi varsa night/paper/bold şablonları ve VoiceReel vurguyu ondan alır.
export const renderAccount = (s, task, acc) => ({ name: acc.name || acc.project?.name || "", handle: acc.handle, color: seriesColor(s, task) ?? s.worlds.find((w) => w.id === task.worldId)?.color });

// Son revize notu henüz netleştirilmediyse (son 2 günde yazıldı, denenmedi) hazırlıktan önce netleştirilir.
const unseenVideos = (task) => revisionsOf(task).flatMap((r) => r.files ?? []).filter((f) => f.kind === "video" && !f.frames);
async function seeVideos(runId, taskId) {
  setRun(runId, { phase: "Verdiğin video izleniyor", at: new Date().toISOString() });
  const { describeFiles } = await import("./attach.mjs");
  const seen = {};
  for (const f of unseenVideos(read().state.tasks.find((t) => t.id === taskId))) {
    try {
      const d = await describeFiles([f]);
      const said = (d.lines[0]?.match(/Videodaki konuşma: "([\s\S]*)"/) ?? [])[1] ?? "";
      // Whisper müzikte uydurur ("İzlediğiniz için teşekkür ederim"): konuşma sayılmaz.
      const real = said && !/izledi[gğ]iniz i[cç]in te[sş]ekk|thanks for watching|abone ol|altyaz[ıi]/i.test(said);
      seen[f.file] = { frames: d.read.map((x) => path.relative(DATA_DIR, x)), ...(real ? { said: said.slice(0, 2000) } : {}) };
    } catch { seen[f.file] = { frames: [] }; }
  }
  update((st) => { const t = st.tasks.find((x) => x.id === taskId); for (const r of t?.revisions ?? []) for (const f of r.files ?? []) if (seen[f.file]) Object.assign(f, seen[f.file]); });
}
// Eski okuyucunun çözdüğü not (clear.v yok) da yeniden okunur: iş yeniden hazırlanıyorsa o not hâlâ sonuçlanmamıştır.
const needsClarity = (task) => { const r = revisionsOf(task).at(-1); return !!(r?.note && task.revisions?.length && (!r.clear || (r.clear.v ?? 1) < CLARITY_V) && !r.clearTried && Date.now() - new Date(r.at) < 2 * 86400e3); };
async function clarify(runId, taskId, acc, signal) {
  setRun(runId, { phase: "Revize notu okunuyor" });
  const s = read().state;
  const task = s.tasks.find((t) => t.id === taskId);
  const last = revisionsOf(task).at(-1);
  const prev = last?.runId ? s.runs.find((r) => r.id === last.runId) : null;
  const autos = s.automations.filter((a) => a.worldId === task.worldId && a.status !== "paused").map((a) => ({ id: a.id, title: a.title, here: a.id === task.autoId }));
  // Notun verildiği çıktıda ne vardı: dosyalar ve Rou'nun o dosyalar için yazdığı not ("yanlış video" neyi kastediyor).
  const prevMedia = prev ? [[prev.video, ...(prev.images ?? [])].filter(Boolean).map((f) => path.basename(f)).join(", "), prev.found ? `${prev.found.from}. ${prev.found.note}` : prev.attach ? "Rou'nun şablonla ürettiği kart/video" : ""].filter(Boolean).join(" · ").slice(0, 1200) : "";
  const names = [...new Set([...s.worlds, ...s.projects].map((x) => x.name).filter(Boolean))].slice(0, 80);
  // Not, işin geri kalanını yönetir: en güçlü model okur (varsayılan Opus; önce Sonnet'ti ve yazım hatalı notları yanlış çözüyordu).
  const r = await runClaude(clarifyPrompt(task, { account: acc ? `${platformName(acc)} ${acc.handle || acc.name}` : "", prevText: prev?.body ?? last?.prev, prevMedia, names, autos }), 3 * 60 * 1000, signal);
  const clear = r.ok ? parseClarity(r.out) : null;
  update((st) => {
    const t = st.tasks.find((x) => x.id === taskId);
    const rv = t?.revisions?.find((x) => x.at === last?.at);
    if (!rv) return;
    if (clear) rv.clear = clear; else rv.clearTried = true;
    // Talimat notla çelişiyorsa okuyucunun düzelttiği talimat yazılır: yazar artık eski talimata dönmez.
    if (clear?.brief) setBrief(t, rv, clear.brief);
    // Kalıcı kural: otomasyonlara yazılır, bu gönderi de onunla hazırlanır; kartta "Kalıcı kural yaptı" görünür.
    if (clear?.rule && !rv.saved) { const ids = saveRule(st, t.worldId, clear.rule); if (ids.length) rv.saved = ids; }
  });
}

// move { worldId, projectId, accountId }: revize gönderiyi başka dünyaya, projeye ya da hesaba taşır (shared/revise.mjs movePost).
// Hazırlık sürerken gelen revize reddedilmez; not hemen işe yazılır, süren hazırlık bitince kendiliğinden başlar.
const after = new Map(); // taskId → { rouId }
function queueAfter(taskId, feedback, files, rouId) {
  update((st) => {
    const t = st.tasks.find((x) => x.id === taskId);
    const prev = st.runs.find((r) => r.taskId === taskId && r.body);
    if (!t) return;
    const rv = addRevision(t, { note: feedback || "", prev: prev?.body ?? "", runId: prev?.id, files });
    if (prev && rv) Object.assign(prev, { revisedAt: new Date().toISOString(), reviseNote: rv.note, ...(rv.files ? { reviseFiles: rv.files } : {}) });
    const w = st.runs.find((r) => r.taskId === taskId && r.status === "working");
    if (w) w.queued = "Yeni revize sırada: bu hazırlık bitince başlayacak";
  });
  after.set(taskId, { rouId });
  return { ok: true, queued: 1, message: "Revize sıraya alındı: şu anki hazırlık bitince başlayacak." };
}
function runAfter(taskId) {
  const q = after.get(taskId);
  if (!q) return;
  after.delete(taskId);
  setTimeout(() => prepare(taskId, undefined, [], undefined, { rouId: q.rouId }), 500);
}

export function prepare(taskId, feedback, files = [], move, { rouId } = {}) {
  if (running.has(taskId)) {
    if ((typeof feedback === "string" && feedback.trim()) || files.length) return queueAfter(taskId, feedback, files, rouId);
    return { ok: false, error: "Zaten hazırlanıyor" };
  }
  // Paylaşılmış gönderi yeniden yazılmaz: dil ya da kural değişikliği yayındaki metni değiştirmez.
  if (read().state.runs.some((r) => r.taskId === taskId && r.status === "posted")) return { ok: false, error: "Bu gönderi zaten paylaşıldı; yeniden hazırlanmaz" };
  if (move && (move.worldId || move.projectId || move.accountId)) {
    const { state: s0 } = read();
    const t0 = s0.tasks.find((x) => x.id === taskId);
    const err = movePost(structuredClone(s0), t0 && structuredClone(t0), move)?.error;
    if (err) return { ok: false, error: `Taşınamadı: ${err}` };
  }
  if ((typeof feedback === "string" && feedback.trim()) || files.length || move) update((st) => {
    const t = st.tasks.find((x) => x.id === taskId);
    const prev = st.runs.find((r) => r.taskId === taskId && r.body);
    if (!t) return;
    const mv = move ? movePost(st, t, move) : null;
    const moved = mv && !mv.error ? mv.from : undefined;
    const rv = addRevision(t, { note: feedback || (moved ? "Gönderiyi buraya taşı ve yeniden hazırla." : ""), prev: prev?.body ?? "", runId: prev?.id, files, moved });
    if (prev && rv) Object.assign(prev, { revisedAt: new Date().toISOString(), reviseNote: rv.note, ...(rv.files ? { reviseFiles: rv.files } : {}) });
  });
  const { state: s } = read();
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, error: "Görev yok" };
  // Uygulama ve pg ayrı süreçler: dosyada yeni bir "hazırlanıyor" kaydı varsa ikinci kez başlatma.
  if (s.runs.some((r) => r.taskId === taskId && r.status === "working" && Date.now() - new Date(r.at) < 6 * 60 * 1000)) return { ok: false, error: "Zaten hazırlanıyor" };
  const auto = task.autoId ? s.automations.find((a) => a.id === task.autoId) : undefined;
  // Hesabı seçilmemiş elle gönderi: uygun hesap varsa işe yazılır, sonrası (önizleme, paylaşım) o hesapla yürür.
  const pick = pickAccount(s, task);
  if (pick) {
    update((st) => { const t = st.tasks.find((x) => x.id === taskId); if (t?.post) { t.post.accountId = pick.id; if (!formatsOf(pick.platform).includes(t.post.format)) t.post.format = formatsOf(pick.platform)[0]; } });
    task.post = { ...task.post, accountId: pick.id, format: formatsOf(pick.platform).includes(task.post.format) ? task.post.format : formatsOf(pick.platform)[0] };
  }
  const ref = taskRef(s, task);
  const acc = accountOf(s, ref);
  const format = acc ? formatOf(s, ref) : null;
  const runId = id();
  update((st) => void st.runs.unshift({ id: runId, taskId, at: new Date().toISOString(), title: task.title, body: "", status: "working", by: "claude" }));
  const ctl = new AbortController();
  running.set(taskId, ctl);
  startedAt.set(taskId, Date.now());
  // Yeni revize notu önce netleştirilir (shared/revise.mjs clarifyPrompt); hazırlık netleşmiş isteği okur.
  const launch = (s, task) => auto?.browser && auto.who === "claude" ? (setRun(runId, { phase: "Tarayıcıda hazırlanıyor" }), prepareBrowse(s, task, auto, ctl.signal, runId))
    : acc && format && !(isVideo(format) && auto?.voice === "me")
    ? social(runId, s, task, acc, format, ctl.signal)
    : auto && auto.voice === "me" && outputOf(s, auto) === "video"
    ? (setRun(runId, { phase: "Senaryo yazılıyor" }), prepareVideo(s, task, ctl.signal))
    : runClaude(plainPrompt(s, task), LIMIT_MS, ctl.signal, { args: ["--allowedTools", "WebSearch,WebFetch,Read", "--add-dir", MEDIA_DIR] }).then(async (r) => {
      if (!r.ok) return r;
      const { text, gaps } = splitGaps(r.out);
      if (!isPost(task, auto)) return { ok: true, body: text, ...(gaps.length ? { gaps } : {}) };
      // Gönderinin ekleri metinden ayrılıp indirilir; inmeyen adres metne geri yazılmaz, yalnız sayılır.
      setRun(runId, { phase: "Ekler indiriliyor" });
      const m = await pullMedia(text, runId);
      return { ok: true, body: m.body, images: m.images, ...(gaps.length ? { gaps } : {}), ...(m.failed.length ? { renderError: `${m.failed.length} ek indirilemedi: ${m.failed.join(" ")}` } : {}) };
    });
  // Revizede verilen video önce izlenir (kareler + konuşma): Rou videonun ne gösterdiğini bilmeden metin yazmaz.
  const pre = unseenVideos(task).length ? seeVideos(runId, taskId) : Promise.resolve();
  const job = pre.then(() => needsClarity(read().state.tasks.find((t) => t.id === taskId) ?? task)
    ? clarify(runId, taskId, acc, ctl.signal).then(() => { const s2 = read().state; return launch(s2, s2.tasks.find((t) => t.id === taskId) ?? task); })
    : (() => { const s2 = read().state; return launch(s2, s2.tasks.find((t) => t.id === taskId) ?? task); })());
  const done = job.then(async (r) => {
    // X'te alıntı/yanıt: hedef tweet metinden ayrılıp gönderiye bağlanır (server/xquote.mjs).
    if (r?.ok && r.post?.tweets) {
      const tk = read().state.tasks.find((t) => t.id === taskId);
      const linked = await linkTweet(r.post, [tk?.title, tk?.notes, ...(tk?.revisions ?? []).map((x) => x.note)].join("\n"));
      if (linked !== r.post) { r.post = linked; r.body = bodyOf(linked); }
    }
    // Revize sitedeki tasarımın videosunu istiyorsa (video + site/sayfa adresi) sayfa açılıştan itibaren kaydedilir ve videosu çıktıya girer.
    if (r?.ok && !ctl.signal.aborted) {
      const st0 = read().state;
      const tk = st0.tasks.find((t) => t.id === taskId);
      const url = siteVideoUrl(tk, r);
      if (!url && wantsFootage(tk)) {
        const pids = [tk.projectId, acc?.project?.id];
        const many = /karakt|karekt|character|\brol(ler|den|dan|u|leri|lerini|lerden)?\b|\broles?\b|sinif/.test(foldTr(revisionsOf(tk).at(-1)?.note)) ? footageClips(st0, tk, pids) : [];
        // Önceki çıktıda kesit vardıysa (revize) Rou not ölçütüyle yeni bir bölüm seçer; ilk hazırlıkta eski düzen (en uygun kayıt, baştan).
        const prevRun = st0.runs.find((x) => x.taskId === taskId && x.id !== runId && x.video?.includes("-play."));
        let src = many.length ? null : footageOf(st0, tk, pids);
        if (!many.length && revisionsOf(tk).length && prevRun) {
          setRun(runId, { phase: "Oynanış kayıtlarına bakıyor", at: new Date().toISOString() });
          const pick = await pickFootage(st0, tk, pids, prevRun.footage ?? { key: null, from: 0, sec: 15 }, ctl.signal);
          if (pick.cancelled) r.cancelled = true;
          else if (pick.error) { src = null; r.video = undefined; r.renderError = pick.error; r.footageFailed = true; }
          else { try { const file = `${runId}-play.mp4`; cutFootage(pick.file, path.join(MEDIA_DIR, file), pick.sec, pick.from); r.video = `media/${file}`; r.images = []; r.footage = { key: pick.key, from: pick.from, sec: pick.sec, why: pick.why }; delete r.attach; delete r.renderError; } catch (e) { r.renderError = `Oynanış kesiti çıkarılamadı: ${String(e?.message ?? e).slice(0, 120)}`; r.footageFailed = true; } }
          src = null;
        }
        if (r.footage || r.footageFailed) { /* revize kesiti yukarıda seçildi */ }
        else if (many.length) { try { const file = `${runId}-play.mp4`; montageFootage(many, path.join(MEDIA_DIR, file)); r.video = `media/${file}`; r.images = []; delete r.attach; delete r.renderError; } catch (e) { r.renderError = `Oynanış kesiti çıkarılamadı: ${String(e?.message ?? e).slice(0, 120)}`; } }
        else if (src) { try { const file = `${runId}-play.mp4`; cutFootage(src, path.join(MEDIA_DIR, file)); r.video = `media/${file}`; r.images = []; delete r.attach; delete r.renderError; } catch (e) { r.renderError = `Oynanış kesiti çıkarılamadı: ${String(e?.message ?? e).slice(0, 120)}`; } }
        else r.renderError = r.renderError ?? "Projenin Medya'sında İyi işaretli oynanış videosu yok";
      }
      if (url) {
        setRun(runId, { phase: "Sitenin videosu kaydediliyor", at: new Date().toISOString() });
        try { const { recordPage } = await import("./record.mjs"); const file = `${runId}-site.mp4`; await recordPage(url, 20, path.join(MEDIA_DIR, file)); r.video = `media/${file}`; }
        catch (e) { r.renderError = `Sitenin videosu kaydedilemedi: ${String(e?.message ?? e).slice(0, 120)}`; }
      }
    }
    // Revizede yasaklanan ifade çıktıda kaldıysa onaya düşmez; bir kez kendiliğinden yeniden denenir.
    if (r?.ok && !ctl.signal.aborted) {
      const tk = read().state.tasks.find((t) => t.id === taskId);
      const hits = banHits(tk, r);
      if (hits.length) {
        const again = !tk.revisions?.at(-1)?.banRetry;
        r = { ok: false, error: `Revizede çıkarılması istenen ifade hâlâ var: ${hits.join(", ")}.${again ? " Rou kendiliğinden bir kez daha deniyor." : " Revize iste ile tekrar dene."}` };
        if (again) { update((st) => { const t = st.tasks.find((x) => x.id === taskId); const last = t?.revisions?.at(-1); if (last) last.banRetry = true; }); after.set(taskId, { rouId }); }
      }
    }
    // Not görsel istediyse eksiz çıktı onaya düşmez.
    if (r?.ok && !ctl.signal.aborted && !(r.images?.length || r.video || r.attach)) {
      const tk = read().state.tasks.find((t) => t.id === taskId);
      if (r.noVisual) r = { ok: false, error: r.renderError };
      else if (mediaRequired(tk)) r = { ok: false, error: `Revizede görsel istendi ama eklenecek görsel bulunamadı${r.renderError ? ` (${r.renderError})` : ""}. Görselleri revizeye dosya olarak ekle ya da projenin Medya klasörüne koy.` };
    }
    // Yalnız kendi kaydını siler: bekçinin durdurduğu eski iş geç bitince yeniden başlamış işin kaydını silmesin.
    if (running.get(taskId) === ctl) running.delete(taskId);
    if (r.cancelled || ctl.signal.aborted) return;
    update((st) => {
      const run = st.runs.find((x) => x.id === runId);
      if (!run) return;
      delete run.phase;
      if (!r.ok) { Object.assign(run, { status: "failed", body: String(r.error ?? "").slice(0, 600), at: new Date().toISOString() }); addNotice(st, { kind: "failed", runId, by: "claude", text: run.body.slice(0, 200) }); return; }
      // Rou'nun kendine notu ("KONU UYMADI: …") metne girmez: kartta ayrı not olur.
      const miss = stripTopicMiss(r);
      if (miss) run.topicMiss = miss;
      // Onay kapısı (server/quality.mjs): daha önce yakalanmış hata türlerinden biri varsa onaya düşmez.
      const tk = st.tasks.find((t) => t.id === taskId);
      const pid0 = tk?.projectId ?? st.automations.find((a) => a.id === tk?.autoId)?.projectId;
      const wid = tk?.worldId ?? st.projects.find((p) => p.id === pid0)?.worldId;
      const gq = gate(r, [pid0, ...st.projects.filter((p) => p.worldId === wid && p.id !== pid0).map((p) => p.id)], tk, st);
      if (!gq.ok) { Object.assign(run, { status: "failed", body: gq.error, renderError: gq.error, at: new Date().toISOString(), ...(r.post ? { post: r.post } : {}), ...(r.attach ? { attach: r.attach } : {}) }); addNotice(st, { kind: "failed", runId, by: "claude", text: gq.error.slice(0, 200) }); return; }
      Object.assign(run, { status: "ready", body: r.body, at: new Date().toISOString() });
      if (r.post) run.post = r.post;
      if (r.attach) run.attach = r.attach;
      if (r.needs) run.needs = r.needs;
      if (r.found) run.found = r.found;
      if (r.items) run.items = r.items;
      if (r.storyboard) run.storyboard = r.storyboard;
      if (r.template) run.template = r.template;
      if (r.images?.length) { run.images = r.images; run.kitHash = kitHash(acc ? kitOf(st, acc, st.tasks.find((x) => x.id === taskId)) : undefined); }
      if (r.video) run.video = r.video;
      // Carousel sırası ve "işin kendisi" işareti çıktıya geçer.
      if (r.order) run.order = r.order;
      if (r.asIs) run.asIs = true;
      if (r.footage) run.footage = r.footage;
      // Revize yeni bir oynanış kesiti istedi ama bulunamadı: eski video "yeni çıktı" gibi onaya düşmez.
      if (r.footageFailed) { run.status = "failed"; run.renderError = String(r.renderError ?? "Yeni oynanış kesiti seçilemedi").slice(0, 300); }
      if (r.review) run.review = r.review;
      if (r.renderError) run.renderError = String(r.renderError).slice(0, 300);
      // Tasarım puanı FLOOR altında kalan çıktı "Hazırlanamadı" olmaz: onaya düşer, eleştirisi kartta açık durur, düğme "Yine de onayla" olur;
      // kendiliğinden yeniden üretilmez ve kendiliğinden onaylanmaz (approveRun).
      const low = designLow(r);
      // Hangi revizeye cevap: en son not; yapılamayan istekler kartta görünür (run.reviseGaps).
      const revs = revisionsOf(st.tasks.find((t) => t.id === taskId));
      if (revs.length) run.answers = revs.at(-1).at;
      // Revizede eklenen görsel ve videolar çıktıya girer: görseller önde, video kullanıcının verdiğiyle değişir.
      const extra = revisionFiles(st.tasks.find((t) => t.id === taskId));
      const imgs = extra.filter((f) => f.kind === "image").map((f) => `media/${f.file}`);
      if (imgs.length) run.images = [...imgs, ...(run.images ?? []).filter((x) => !imgs.includes(x))];
      const vid = extra.filter((f) => f.kind === "video").at(-1);
      if (vid) run.video = `media/${vid.file}`;
      // Metin adımının "yapamadım" dediği ama çıktıda yapılmış istekler düşer: ek üretildiyse görsel/video istekleri.
      const media = !!(run.video || run.images?.length);
      const gaps = (r.gaps ?? []).filter((g) => { const t = `${g.ask} ${g.why ?? ""}`.toLocaleLowerCase("tr"); return !((media && /v[iı]d[eo]|g[oö]rsel|ekran g[oö]r[uü]nt|res[iı]m|foto[gğ]raf|kapak|oynan[iı][sş]/.test(t))); });
      // Denetimin iki turdan sonra hâlâ eksik bulduğu istekler (tek atamadan önce eklenir, yoksa kartta görünmez).
      for (const a of r.missed ?? []) gaps.push({ ask: a, why: "Rou iki kez denedi, çıktıda yok" });
      if (gaps.length) run.reviseGaps = gaps; else delete run.reviseGaps;
      // Onay istemeyen otomasyonun çıktısı kendiliğinden onaylanır; ona "onayını bekliyor" denmez.
      if (run.status === "failed") return;
      if (auto?.approve !== false || low) addNotice(st, { kind: "ready", runId, by: "claude", text: low ? `Hazır, ama tasarım denetimi düşük puan verdi (${r.review.score}/10). Eleştirisi kartta; sen karar ver.` : run.renderError ? `Hazır, ama ${run.renderError}` : "Rou hazırladı." });
    });
    if (rouId) reportRevise(rouId, taskId, runId, r, auto);
    if (r.ok) proposeVisualRule(taskId).catch(() => {});
    if (r.ok && r.body) refreshTopic(taskId, r.body).catch(() => {});
  }).catch((e) => {
    if (running.get(taskId) === ctl) running.delete(taskId);
    setRun(runId, { status: "failed", body: String(e).slice(0, 600), phase: undefined });
  }).finally(() => { setRun(runId, { queued: undefined }); runAfter(taskId); });
  // done: bitince çözülür (pg prepare bekler; API beklemez).
  return { ok: true, runId, done };
}

// Birden çok işi sırayla hazırlar (aynı anda tek claude). Kuyruktakiler zaten hazırlanıyorsa atlanır.
let chain = Promise.resolve();
// Sıradakiler task.queuedAt ile işaretlenir (uygulama "Sırada" gösterir); sırası gelince işaret kalkar.
// Sırada bekleyen iş bir daha eklenmez. Zamanlayıcı aynı listeyi dakikada bir yollar; sıradaki işin henüz çıktısı olmadığı için
// her dakika yeniden eklenirdi.
const waiting = new Set();
export function prepareMany(ids) {
  const fresh = [...new Set(ids)].filter((id) => !waiting.has(id));
  if (!fresh.length) return { ok: true, n: 0 };
  const at = new Date().toISOString();
  update((st) => { for (const t of st.tasks) if (fresh.includes(t.id) && !st.runs.some((r) => r.taskId === t.id && r.status === "working")) t.queuedAt = at; });
  for (const taskId of fresh) {
    waiting.add(taskId);
    chain = chain.then(() => {
      waiting.delete(taskId);
      update((st) => { const t = st.tasks.find((x) => x.id === taskId); if (t) delete t.queuedAt; });
      return prepare(taskId).done ?? null;
    }).catch(() => { waiting.delete(taskId); });
  }
  return { ok: true, n: fresh.length };
}

// Düzenlenen gönderinin görsellerini/videosunu yeniden üretir.
// edit: { post, template } verilirse önce gönderi güncellenir (düzenleyiciden), sonra görseller üretilir.
// Aynı işin başka bir çıktısındaki video/görselleri bu çıktıya taşır (geçmişteki iyi video; Rou ya da kullanıcı seçer).
export function copyMedia(runId, fromId) {
  let res = { ok: false, error: "Çıktı yok" };
  update((st) => {
    const r = st.runs.find((x) => x.id === runId);
    const from = st.runs.find((x) => x.id === fromId);
    if (!r || !from) return;
    if (r.taskId !== from.taskId) { res = { ok: false, error: "Başka işin çıktısı" }; return; }
    if (!from.video && !from.images?.length) { res = { ok: false, error: "O çıktıda video ya da görsel yok" }; return; }
    pushVersion(r, "media");
    for (const k of MEDIA_KEYS) { if (from[k]) r[k] = from[k]; else delete r[k]; }
    res = { ok: true };
  });
  return res;
}

export function rerender(runId, edit) {
  if (running.has(`r-${runId}`)) return { ok: false, error: "Zaten hazırlanıyor" };
  if (edit?.post) {
    let ok = false;
    update((st) => {
      const r = st.runs.find((x) => x.id === runId);
      const post = r?.post && normalize(r.post.format, edit.post);
      if (!post) return;
      pushVersion(r, "edit");
      Object.assign(r, { post, body: bodyOf(post), edited: true, ...(edit.template ? { template: String(edit.template) } : {}) });
      ok = true;
    });
    if (!ok) return { ok: false, error: "Gönderi okunamadı" };
  }
  const { state: s } = read();
  const run = s.runs.find((r) => r.id === runId);
  if (!run?.post) return { ok: false, error: "Gönderi yok" };
  // Metin gönderisi (X, Threads, LinkedIn) kendi metninden render edilmez: eki (attach) yoksa yalnız metin güncellenir, video/görsel olduğu gibi kalır
  if (textOnly(run.post.format) && !run.attach) return { ok: true, kept: true };
  const src = run.attach ?? run.post; // metin gönderisinin eki varsa görsel/video ondan
  const task = s.tasks.find((t) => t.id === run.taskId);
  const acc = accountOf(s, taskRef(s, task));
  const ctl = new AbortController();
  running.set(`r-${runId}`, ctl);
  setRun(runId, { phase: isVideo(src.format) ? "Video hazırlanıyor" : "Görseller hazırlanıyor", renderError: undefined });
  const one = (p) => renderPost(runId, attachMedia(acc?.project?.id, p), acc && task ? renderAccount(s, task, acc) : { name: "", handle: "", color: undefined }, run.template, ctl.signal, acc ? kitOf(s, acc, task) : undefined, run.attach && needsImage(run.post.format) ? LI_SCALE : undefined);
  // İki dilli ek görsel çifti: her dil ayrı tek görsel (sayaç yok).
  const pair = run.attach && acc?.lang === "tr+en" && src.format === "ig_post" && src.slides?.length === 2;
  const job = pair
    ? (async () => { const images = []; for (const x of src.slides) { const m = await one({ ...src, slides: [x] }); if (!m.ok) return m; images.push(...(m.files.images ?? [])); } return { ok: true, files: { images } }; })()
    : one(src);
  job.then((m) => {
    running.delete(`r-${runId}`);
    update((st) => {
      const r = st.runs.find((x) => x.id === runId);
      if (!r) return;
      delete r.phase;
      if (m.ok) {
        if (!edit?.post) pushVersion(r, edit?.why ?? "render");
        r.images = m.files.images; if (m.files.video) r.video = m.files.video; else delete r.video; delete r.renderError;
        r.kitHash = kitHash(acc ? kitOf(st, acc, task) : undefined);
        delete r.kitTried;
      }
      else { r.renderError = String(m.error ?? "").slice(0, 300); r.kitTried = kitHash(acc ? kitOf(st, acc, task) : undefined); }
    });
  }).catch((e) => {
    running.delete(`r-${runId}`);
    setRun(runId, { phase: undefined, renderError: String(e?.message ?? e).slice(0, 300) });
  });
  return { ok: true };
}

// Görseli eksik çıktıya (LinkedIn ya da eki Görsel seçili metin) yalnız görseli üretir; metin aynen kalır. Onaylıysa onay geri alınır:
// görselsiz onay geçersiz, kullanıcı görselle birlikte yeniden onaylar. done: bitince çözülür (pg image bekler).
export function makeImage(runId) {
  const key = `i-${runId}`;
  if (running.has(key)) return { ok: false, error: "Görsel zaten hazırlanıyor" };
  const { state: s } = read();
  const run = s.runs.find((r) => r.id === runId || r.id.startsWith(runId));
  if (!run?.post) return { ok: false, error: "Gönderi yok" };
  if (run.status === "posted") return { ok: false, error: "Gönderi zaten paylaşıldı" };
  if (run.status === "working") return { ok: false, error: "Çıktı daha hazırlanıyor" };
  const task = s.tasks.find((t) => t.id === run.taskId);
  const acc = task && accountOf(s, taskRef(s, task));
  if (!acc) return { ok: false, error: "Hesap bulunamadı" };
  const kind = askedAttach(task) ?? attachOf(run.post.format, context(s, task).auto);
  if (!kind || !(needsImage(run.post.format) || canAttach(run.post.format))) return { ok: false, error: "Bu gönderinin eki yok (otomasyonda Ek: Görsel seçilmeli)" };
  update((st) => {
    const r = st.runs.find((x) => x.id === run.id);
    if (!r) return;
    if (r.status === "approved") { r.status = "ready"; delete r.approvedAt; delete r.approvedVia; delete r.publish; delete r.shareSentAt; }
    delete r.renderError;
  });
  const ctl = new AbortController();
  running.set(key, ctl);
  const done = attachStep(run.id, s, task, acc, run.post, kind, ctl.signal).then((m) => {
    running.delete(key);
    if (m.cancelled) return;
    update((st) => {
      const r = st.runs.find((x) => x.id === run.id);
      if (!r) return;
      delete r.phase;
      for (const k of ["attach", "images", "video", "review", "template", "needs"]) if (m[k]) r[k] = m[k];
      // Görsel üretildi: "görsel eklenemedi" türü eski eksikler kalkar.
      if (m.images?.length && r.reviseGaps) r.reviseGaps = r.reviseGaps.filter((g) => !/görsel|kapak/i.test(g.ask));
      if (!m.needs) delete r.needs;
      if (m.renderError) r.renderError = String(m.renderError).slice(0, 300);
    });
  }).catch((e) => {
    running.delete(key);
    setRun(run.id, { phase: undefined, renderError: String(e).slice(0, 300) });
  });
  return { ok: true, runId: run.id, done };
}

// Durdur: çalışan claude süreci kapanır, "hazırlanıyor" kaydı silinir; iş hazırlanmamış hale döner.
export function cancel(taskId) {
  // Sıradaki revize de düşer: yoksa Durdur'dan yarım saniye sonra hazırlık kendiliğinden yeniden başlardı.
  after.delete(taskId);
  running.get(taskId)?.abort();
  running.delete(taskId);
  update((st) => void (st.runs = st.runs.filter((r) => !(r.taskId === taskId && r.status === "working"))));
  return { ok: true };
}

// Kullanıcının verdiği son metin (sohbette Rou'nun set_text işi): kelimesi kelimesine yazılır, Rou dokunmaz.
// Paylaşım teslim klasörü varsa metin.txt de güncellenir. Görseller aynen kalır.
export function setRunText(runId, text) {
  const t = String(text ?? "").replace(/\r/g, "").replace(/—/g, ",").trim();
  if (!t) return { ok: false, error: "Metin boş" };
  let ok = false;
  update((s) => {
    const r = s.runs.find((x) => x.id === runId);
    if (!r) return;
    pushVersion(r, "edit");
    r.prevBody ??= r.body;
    r.body = t;
    // Tweet/Threads biçiminde önizleme ve paylaşım post.tweets'i okur.
    if (r.post) r.post = Array.isArray(r.post.tweets) ? { ...r.post, ...postOfText(r.post.format, t) } : { ...r.post, text: t };
    r.byUser = new Date().toISOString();
    delete r.reviseGaps;
    ok = true;
  });
  if (!ok) return { ok: false, error: "Çıktı yok" };
  const root = SHARE_DIR;
  try {
    for (const g of fs.readdirSync(root)) for (const d of fs.readdirSync(path.join(root, g))) {
      const f = path.join(root, g, d, ".run");
      if (fs.existsSync(f) && fs.readFileSync(f, "utf8").trim() === runId) fs.writeFileSync(path.join(root, g, d, "metin.txt"), t + "\n");
    }
  } catch { /* klasör yoksa yalnız uygulama */ }
  return { ok: true };
}

// Sohbetten istenen revize bitince sonuç o Rou'nun sohbetine düşer: yeni çıktı kendi görünümüyle (show), yapamadıkları açıkça.
export function reportRevise(rouId, taskId, runId, r, auto) {
  update((st) => {
    const run = st.runs.find((x) => x.id === runId);
    const t = st.tasks.find((x) => x.id === taskId);
    if (!run || !t) return;
    const title = t.topic?.title || t.title;
    const text = !r.ok
      ? `"${title}" revizesini hazırlayamadım: ${String(r.error ?? "bilinmeyen hata").slice(0, 200)}`
      : [
          `"${title}" revizeni yaptım, yeni hâli aşağıda.`,
          run.reviseGaps?.length ? `Yapamadığım: ${run.reviseGaps.map((g) => g.ask).join(", ")}.` : "",
          run.renderError ? `Not: ${run.renderError}` : "",
          auto?.approve !== false ? "Onayını bekliyor." : "",
        ].filter(Boolean).join(" ");
    setChat(st, rouId, (l) => [...l, { role: "rou", text, at: new Date().toISOString(), ...(r.ok ? { show: [runId] } : {}) }]);
  });
}

// Görsel revizesi kalıcı kurala dönüşür.
// Otomasyon işinde görsele itiraz eden son not, genel bir kurala çevrilip sohbete edit_auto önerisi olarak düşer (visual alanına eklenir).
// Onaylanınca otomasyonun her görseli (ek planı) bu kurallarla hazırlanır. Tek seferlik istekler kural olmaz.
async function proposeVisualRule(taskId) {
  const { state: s } = read();
  const task = s.tasks.find((t) => t.id === taskId);
  const auto = task?.autoId && s.automations.find((a) => a.id === task.autoId);
  const rev = revisionsOf(task).at(-1);
  if (!auto || !rev || !visualNote(rev.note) || rev.ruled) return;
  const old = auto.visual?.trim() ?? "";
  const r = await runClaude([
    `Kullanıcı "${auto.title}" otomasyonunun bir çıktısına şu revize notunu yazdı:\n"""\n${rev.note}\n"""`,
    old ? `Otomasyonun mevcut görsel kuralları:\n${old}` : "Otomasyonun henüz görsel kuralı yok.",
    "Bu nottan bu otomasyonun BÜTÜN gelecek görsellerine uygulanacak genel bir görsel/kapak kuralı çıkıyor mu? Yalnız bu gönderiye özgü (belirli bir yazı, belirli bir hata) ise çıkmaz. Çıkıyorsa tek cümle, düzgün Türkçe, emir kipinde, kullanıcının istediği şeyi açıkça söyleyen bir kural yaz; mevcut kurallarla aynıysa yazma. Uzun tire kullanma.",
    'SADECE JSON: {"rule": "…" | null}',
  ].join("\n\n"), 90 * 1000);
  const rule = (r.ok ? json(r.out)?.rule : null)?.trim?.();
  update((st) => {
    const t = st.tasks.find((x) => x.id === taskId);
    const last = revisionsOf(t).at(-1);
    if (last) last.ruled = true;
    if (!rule) return;
    const talk = (st.talk ??= []);
    const visual = [old, `- ${rule}`].filter(Boolean).join("\n");
    talk.push({ id: id(), from: "rou", to: "me", at: new Date().toISOString(), text: `"${auto.title}" revizenden kalıcı bir görsel kuralı çıkardım. Bu otomasyonun bundan sonraki bütün görsellerine uygulansın mı?\n${rule}`, action: { type: "edit_auto", autoId: auto.id, visual } });
    if (talk.length > 60) talk.splice(0, talk.length - 60);
  });
}

// Revizeden sonra konu ve açıklama yeni metne göre güncellenir. Yalnız revizeli işlerde; konu metinle zaten örtüşüyorsa değişmez.
async function refreshTopic(taskId, body) {
  const { state: s } = read();
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task?.topic || !revisionsOf(task).length) return;
  const r = await runClaude([
    `Bir gönderinin görevdeki konusu:\nBaşlık: ${task.topic.title ?? ""}\nAçıklama: ${task.topic.brief ?? ""}`,
    `Gönderinin revizeden sonraki son metni:\n"""\n${String(body).slice(0, 3000)}\n"""`,
    "Konu başlığı ve açıklama bu metnin anlattığı şeyi söylemiyorsa yeniden yaz: başlık en çok 8 kelime, açıklama tek kısa cümle, sade Türkçe, metinde olmayan bilgi yok, uzun tire yok. Zaten örtüşüyorsa aynısını döndür.",
    'SADECE JSON: {"title": "…", "brief": "…"}',
  ].join("\n\n"), 90 * 1000);
  const j = r.ok ? json(r.out) : null;
  const title = String(j?.title ?? "").trim(), brief = String(j?.brief ?? "").trim();
  if (!title) return;
  update((st) => { const t = st.tasks.find((x) => x.id === taskId); if (t?.topic && (t.topic.title !== title || t.topic.brief !== brief)) t.topic = { ...t.topic, title, brief: brief || t.topic.brief }; });
}
