// Demo veri: node scripts/demo.mjs <hedef-klasör>  →  <hedef>/playground.json
// Gerçek data/ klasörüne yazmayı reddeder. Uygulamayı denemek için: PG_DATA=<hedef> npm run dev
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "../shared/social.mjs";
import { migrateRous } from "../shared/rou.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
if (!arg) { console.error("Kullanım: node scripts/demo.mjs <hedef-klasör>"); process.exit(1); }
const target = path.resolve(arg);
const real = path.join(ROOT, "data");
if (target === real || target.startsWith(real + path.sep)) { console.error("Reddedildi: gerçek data/ klasörü."); process.exit(1); }
fs.mkdirSync(target, { recursive: true });

// Sabit tohumlu rastgele: aynı çıktı her çalıştırmada.
let seed = 20261025;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
let n = 0;
const id = (p = "") => `${p}${(n++).toString(36).padStart(3, "0")}${Math.floor(rnd() * 1e6).toString(36)}`.slice(0, 8);

const pad = (x) => String(x).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const base = new Date(); base.setHours(0, 0, 0, 0);
const day = (off) => { const d = new Date(base); d.setDate(d.getDate() + off); return iso(d); };
const at = (off, h, m = 0) => { const d = new Date(base); d.setDate(d.getDate() + off); d.setHours(h, m, 0, 0); return d.toISOString(); };
const ts = (off, h, m = 0) => `${day(off)}T${pad(h)}:${pad(m)}`;
const dow = (off) => new Date(base.getTime() + off * 86400000).getDay(); // 0=Paz

// Dünya: tek bir çalışma alanı (uygulama en az bir dünya ister). Demo üç proje üzerinden döner.
const worlds = [
  { id: "studyo", name: "Stüdyo", color: "#3d5afe", color2: "#22c8e6", description: "Müşteri işi, kendi uygulamam ve bir yan proje", accounts: [
    { id: "acc-ig", platform: "instagram", name: "Uygulama hesabı", handle: "@sample.studio", voice: "Sade, samimi, kısa cümleler. Emoji az." },
    { id: "acc-li", platform: "linkedin", name: "Kişisel LinkedIn", handle: "linkedin.com/in/ornek", voice: "Birinci tekil, yaparak öğrenme notları." },
  ] },
];
const W = "studyo";

// Projeler: [kimlik, ad, açıklama, durum, bitiş farkı (gün)]
const P = {};
const projects = [];
const proj = (key, name, description, status, dl) => {
  const p = { id: id("p"), worldId: W, name, description, status, deadline: dl == null ? null : day(dl) };
  P[key] = p.id; projects.push(p);
};
proj("marka", "Kafe markalama", "Mahalle kafesi için logo, renkler ve menü tasarımı", "active", 6);
proj("fit", "Antrenman uygulaması v2", "Onboarding yenileme, ilerleme ekranı, ödeme duvarı ve yayın", "active", 12);
proj("arac", "Renk paleti aracı", "Fotoğraftan palet çıkaran küçük web aracı", "active", 14);

// İşler
const tasks = [];
const blocks = [];
const T = {};
const ck = (...items) => items.map(([text, done]) => ({ id: id("c"), text, done: !!done }));
const task = (key, projectKey, title, o = {}) => {
  const t = {
    id: id("t"), worldId: W, projectId: projectKey ? P[projectKey] : null, title, notes: o.notes ?? "", status: o.status ?? "todo",
    day: o.day ?? null, deadline: o.deadline ?? null, estimate: o.estimate ?? null, checklist: o.checklist ?? [], by: "me",
    createdAt: at(o.created ?? -20, 10),
  };
  if (t.status === "done") t.doneAt = at(o.doneOff ?? -1, o.doneH ?? 17, o.doneM ?? 20);
  if (o.order != null) t.order = o.order;
  if (o.who) t.who = o.who;
  if (key) T[key] = t.id;
  tasks.push(t);
  return t;
};
const done = (key, pk, title, off, o = {}) => task(key, pk, title, { ...o, status: "done", doneOff: off, created: off - 5, deadline: o.deadline ?? null });
const block = (t, off, h, m, mins, kind = "plan", title = "") =>
  blocks.push({ id: id("b"), taskId: t ? t.id : null, worldId: W, title, start: ts(off, h, m), end: ts(off, h + Math.floor((m + mins) / 60), (m + mins) % 60), kind });

// Bitenler (son 30 gün)
done("d1", "marka", "Logo için 3 yön çiz", -26, { estimate: 180, notes: "Kafenin sıcak, mahalle havası olsun. Elle çizilmiş his." });
done("d2", "marka", "Renk paleti ve yazı tipi seçimi", -22, { estimate: 90, deadline: day(-21) });
done("d3", "marka", "Logo revizyonu (2. tur)", -17, { estimate: 120, deadline: day(-16) });
done("d4", "marka", "Tabela ve bardak için ölçüleri al", -12, { estimate: 30 });
done("d5", "fit", "Onboarding akışını kağıda çiz", -28, { estimate: 90 });
done("d6", "fit", "İlerleme ekranı ilk taslak", -19, { estimate: 120 });
done("d7", "fit", "Anahtar kelime araştırması", -13, { estimate: 60 });
done("d8", "fit", "Ödeme duvarı metinleri", -9, { estimate: 60, deadline: day(-8) });
done("d9", "fit", "İlk 3 mağaza ekran görüntüsü", -6, { estimate: 120, deadline: day(-5) });
done("d10", "fit", "Yeni sürüm duyuru metni taslağı", -4, { estimate: 40 });
done("d11", "fit", "Mağaza açıklaması (kısa ve uzun)", -1, { estimate: 45, doneH: 16, doneM: 5 });
done("d12", "arac", "Palet çıkarma mantığını dene", -18, { estimate: 120, notes: "k-means ile 5 renk; canvas'tan piksel okuma yeterli." });
done("d13", "arac", "İlk arayüz taslağı", -5, { estimate: 90 });
done("d14", "arac", "Fotoğraf yükleme alanı", -2, { estimate: 60 });
// Bugün biten
done("dt1", "marka", "Kafe sahibiyle renkleri onayla", 0, { estimate: 20, doneH: 9, doneM: 10 });

// Açık: gecikmiş
task("o1", "marka", "Logo kullanım rehberini müşteriye gönder", { status: "doing", day: day(0), deadline: day(-2), estimate: 60, notes: "Tek PDF: logo boşlukları, renk kodları, yazı tipleri, yanlış kullanımlar.", checklist: ck(["Logo boşlukları", 1], ["Renk kodları", 1], ["Yanlış kullanımlar", 0], ["PDF'e çevir", 0]), order: 1 });
// Bugün
task("o3", "marka", "Menü tasarımını bitir", { day: day(0), deadline: day(5), estimate: 150, notes: "Kahve, tatlı, soğuk içecekler. Tek sayfa, iki yüz.", checklist: ck(["Kahve bölümü", 1], ["Tatlılar", 0], ["Soğuk içecekler", 0], ["Baskı kontrolü", 0]), order: 2 });
task("o4", "fit", "Mağaza ekran görüntüleri: 4. ve 5. ekran", { day: day(0), deadline: day(3), estimate: 90, order: 3 });
task("o5", "fit", "Rakip uygulamaların ödeme duvarlarını topla", { day: day(0), estimate: 30, who: "claude", notes: "5 uygulama: fiyat, deneme süresi, ilk cümle. Tablo olarak.", order: 4 });
// Yarın ve bu hafta
task("o7", "fit", "Ödeme duvarı: iki fiyat seçeneği çiz", { day: day(1), deadline: day(8), estimate: 120, checklist: ck(["Aylık kartı", 0], ["Yıllık kartı", 0], ["Ücretsiz deneme ifadesi", 0]) });
task("o8", "arac", "Palet aracı: kopyala butonu", { day: day(2), deadline: day(13), estimate: 60 });
task("o9", "arac", "Ürün sayfasına geri bildirim formu ekle", { day: day(2), estimate: 20, who: "claude", notes: "Tally formunu oluştur, linki sayfanın altına koy." });
task("o12", "fit", "Duyuru için 3 görsel", { day: day(3), deadline: day(8), estimate: 120 });
task("o15", "marka", "Logo dosyalarını teslim et (SVG, PNG, PDF)", { day: day(4), deadline: day(6), estimate: 45, checklist: ck(["SVG", 0], ["PNG @2x", 0], ["PDF", 0], ["Kullanım rehberi", 0]) });
task("o16", "marka", "Bardak ve tabela uygulamaları", { day: day(5), deadline: day(6), estimate: 90 });
// Önümüzdeki iki hafta
task("o18", "fit", "Onboarding'in ilk 3 ekranını Figma'da kur", { day: day(8), deadline: day(11), estimate: 240 });
task("o19", "fit", "Yayın günü gönderilerini planla", { day: day(9), deadline: day(9), estimate: 60 });
task("o20", "arac", "Aracı yayınla ve paylaş", { day: day(12), deadline: day(14), estimate: 90 });
// Bekleyen
task("o23", "marka", "Kafe sahibinden menü fiyatlarını bekle", { status: "waiting", deadline: day(3), notes: "Fiyatlar gelmeden baskıya gitmeyelim." });
task("o24", "fit", "Mağaza incelemesinin sonucu", { status: "waiting", notes: "Gönderildi, 24-48 saat." });
// Tarihsiz
task("u1", "arac", "Paleti CSS değişkeni ve Tailwind olarak da kopyala", { estimate: 60 });
task("u2", "fit", "Karanlık mod renk denemeleri", { estimate: 90 });
task("u3", "marka", "Instagram için açılış gönderisi fikri", { notes: "Kafe açılışında logo hikâyesi: ilk eskizden tabelaya." });

// Takvim blokları: bugün ve bu hafta
const tk = (k) => tasks.find((t) => t.id === T[k]);
block(tk("o1"), 0, 9, 30, 60);
block(null, 0, 11, 0, 30, "meeting", "Müşteri görüşmesi: kafe sahibi");
block(tk("o3"), 0, 13, 30, 150);
block(tk("o4"), 0, 16, 30, 90);
block(tk("o7"), 1, 10, 0, 120);
block(null, 1, 14, 0, 45, "meeting", "Haftalık plan");
block(tk("o8"), 2, 10, 0, 60);
block(tk("o12"), 3, 11, 0, 120);
block(tk("o15"), 4, 10, 0, 60);
block(tk("o16"), 5, 14, 0, 90);

// Odak oturumları: son 30 gün. Bazı günler sıfır.
const sessions = [];
const doneTasks = tasks.filter((t) => t.status === "done");
const pickTask = (off) => {
  const near = doneTasks.filter((t) => t.doneAt && Math.abs((new Date(t.doneAt) - new Date(at(off, 12))) / 86400000) < 4);
  const pool = near.length ? near : doneTasks;
  return pool[Math.floor(rnd() * pool.length)];
};
const zero = new Set([-29, -28, -23, -20, -14, -13, -8, -3]);
for (let off = -29; off <= 0; off++) {
  if (zero.has(off)) continue;
  const weekend = [0, 6].includes(dow(off));
  const count = off === 0 ? 1 : weekend ? (rnd() < 0.5 ? 1 : 0) : 1 + Math.floor(rnd() * 3);
  let h = 9 + Math.floor(rnd() * 2);
  for (let i = 0; i < count; i++) {
    const t = off === 0 ? tasks.find((x) => x.id === T.o1) : pickTask(off);
    const mins = [25, 25, 45, 50, 90, 35, 60][Math.floor(rnd() * 7)];
    const m = Math.floor(rnd() * 4) * 15;
    sessions.push({ id: id("s"), taskId: t.id, start: at(off, h, m), end: at(off, h, m + mins), mode: mins === 25 ? "pomo" : rnd() < 0.15 ? "manual" : "free" });
    h += 2 + Math.floor(rnd() * 3);
    if (h > 21) break;
  }
}
// Akşam ağırlığı için birkaç geç oturum
for (const off of [-10, -9, -5, -4, -2]) {
  const t = pickTask(off);
  sessions.push({ id: id("s"), taskId: t.id, start: at(off, 21, 0), end: at(off, 21, 40), mode: "free" });
}
sessions.sort((a, b) => a.start.localeCompare(b.start));

// Defter
const note = (o) => ({ id: id("n"), worldId: o.projectId ? W : null, projectId: o.projectId ?? null, source: "note", from: "", url: o.url ?? "", title: o.title, body: o.body ?? "", receivedAt: at(o.off, o.h ?? 10, o.m ?? 0), state: "new", category: o.category });
const inbox = [
  note({ off: 0, h: 8, m: 40, category: "idea", projectId: P.fit, title: "Antrenman bitince tek dokunuşla paylaşılabilir özet kartı", body: "Bitirdiğin antrenmanın **süresi**, **hacmi** ve bir cümle.\n\n- Story boyutunda\n- Koyu ve açık tema\n- Logo köşede, küçük" }),
  note({ off: 0, h: 9, category: "todo", projectId: P.marka, title: "Kafe sahibine menü fiyatlarını sor", body: "Fiyatlar menüde olmadan baskıya gitmeyelim.\n\n1. Kahveler\n2. Tatlılar\n3. Sandviçler" }),
  note({ off: -1, h: 18, category: "idea", projectId: P.arac, title: "Paleti CSS değişkeni ve Tailwind olarak da kopyala", body: "```css\n:root { --c1: #3d5afe; --c2: #ff6b5b; }\n```\nTek tıkla üç biçim: HEX, CSS, Tailwind." }),
  note({ off: -2, h: 13, category: "note", projectId: P.marka, title: "Müşteri görüşme notu: kafe", body: "## Konuşulanlar\n\n- Logo tabelada uzaktan okunmalı\n- Menüde fiyatlar büyük, açıklamalar kısa\n- Bardakta yalnız amblem\n\n> \"Mahallenin kafesi gibi dursun, zincir gibi değil.\"" }),
  note({ off: -3, h: 9, category: "idea", title: "Haftalık kapanış ritüeli: Cuma 17:00, 15 dakika", body: "Bitenleri say, gelecek haftanın ilk 3 işini seç, masayı topla." }),
  note({ off: -4, h: 16, category: "link", projectId: P.fit, url: "https://example.com/mobil-onboarding", title: "Onboarding'de soru sayısı üzerine vaka çalışması", body: "3 ile 5 soru arası en iyi tamamlanma. Bizim akışta şu an **6**." }),
  note({ off: -8, h: 21, category: "idea", title: "Kısa videolu 'bugün ne tasarladım' serisi", body: "Haftada 2 video, 20 saniye. Önce ekran kaydı, sonra tek cümle." }),
];

// Otomasyonlar ve çıktılar
const mkAuto = (o) => ({ id: id("a"), worldId: W, projectId: null, minutes: 20, status: "active", who: "me", horizon: day(14), createdAt: at(-20, 10), ...o });
const a1 = mkAuto({ projectId: P.fit, title: "Haftalık uygulama gönderisi", action: "Uygulamanın bu haftaki bir özelliğini 4 slaytta anlat. Sade, samimi, ilk slaytta soru.", times: ["09:00"], days: [0, 1, 3, 5], minutes: 15, who: "claude", image: true, accountId: "acc-ig", format: "ig_post", steps: [{ id: id("st"), kind: "post", tool: "Instagram", account: "acc-ig" }] });
const a2 = mkAuto({ title: "Pazartesi sabahı haftalık plan", action: "Geçen haftayı özetle, bu hafta için 3 öncelik öner.", times: ["08:30"], days: [1], minutes: 20, who: "claude" });
const automations = [a1, a2];
// Bugünün otomasyon işleri
const autoToday = [];
const hasDay = (a) => a.days.includes(dow(0));
for (const a of [a1, a2]) {
  if (!hasDay(a)) continue;
  const slot = a.times[0] ?? "";
  const t = task(null, a.projectId ? Object.keys(P).find((k) => P[k] === a.projectId) : null, a.title, { day: day(0), estimate: a.minutes });
  t.autoId = a.id; t.autoSlot = slot; t.autoDay = day(0); t.by = a.who;
  autoToday.push(t);
}
const slide = (title, text) => ({ title, text });
const post = { format: "ig_post", slides: [slide("Antrenmanını hatırlıyor musun?", "Çoğumuz son setin kaç tekrar olduğunu unuturuz."), slide("Artık kendisi hatırlıyor", "Her set otomatik kaydedilir, kilo ve tekrar yan yana görünür."), slide("Geçen haftayla karşılaştır", "Küçük ilerlemeler de çizgide görünür."), slide("Denemek için", "Güncellemeyi App Store'dan indir.")], caption: "Son setin kaç tekrar olduğunu hatırlamak zorunda değilsin. Yeni sürümde ilerleme ekranı seninle.", hashtags: ["#antrenman", "#fitness", "#uygulama"] };
const runs = [
  { id: id("r"), taskId: autoToday.find((t) => t.autoId === a1.id)?.id, at: at(0, 7, 55), title: a1.title, body: `${post.slides.map((s, i) => `${i + 1}. ${s.title}\n${s.text}`).join("\n\n")}\n\n${post.caption}\n\n${post.hashtags.join(" ")}`, status: "ready", post, by: "claude", on: day(0) },
  { id: id("r"), at: at(-2, 7, 50), title: a1.title, body: "Bu hafta: Karanlık mod.\n\nGece antrenmanları için gözü yormayan yeni tema.", status: "posted", post: { format: "ig_post", slides: [slide("Gece antrenmanı", "Gözünü yormayan yeni tema."), slide("Otomatik geçiş", "Telefonunun ayarını izler.")], caption: "Gece antrenmanı yapanlara: karanlık mod geldi.", hashtags: ["#karanlıkmod"] }, by: "claude", on: day(-2), postedAt: at(-2, 9, 5) },
  { id: id("r"), at: at(-6, 8, 35), title: a2.title, body: "## Geçen hafta\n- Logo revizyonu bitti\n- Mağaza anahtar kelimeleri çıkarıldı\n\n## Bu hafta öncelik\n1. Menü tasarımı\n2. Logo kullanım rehberi\n3. Ödeme duvarı", status: "approved", by: "claude", on: day(-6) },
].filter((r) => r.taskId !== undefined || r.on !== day(0));
const runs2 = runs.map((r) => (r.taskId === undefined ? (({ taskId, ...x }) => x)(r) : r));

// Rou'lar, sohbet, hafıza
const rous = [
  { id: "rou", name: "Rou", color: "", persona: "" },
  { id: "rou-editor", name: "Editör", color: "#e0218a", persona: "Yazdığım metinleri sadeleştir. Gereksiz sıfatları at, bir cümleyi ikiye bölmekten çekinme." },
];
const msg = (role, text, off, h, m) => ({ role, text, at: at(off, h, m) });
const chat = {
  rou: [
    msg("user", "Bugün neye odaklanmalıyım?", 0, 8, 45),
    msg("rou", "Gecikmiş bir iş var: logo kullanım rehberi. Bugüne aldım, 09:30'a 60 dakikalık blok koydum. Öğleden sonra menü tasarımına 150 dakika ayrıldı.", 0, 8, 45),
    msg("user", "Palet aracına bu hafta zaman var mı?", 0, 8, 47),
    msg("rou", "Çarşamba 10:00'da kopyala butonu için bir saat var. Geri bildirim formunu da ben kuracağım, aynı gün hallederim.", 0, 8, 47),
  ],
};
const memory = [
  { id: id("m"), text: "Sabahları 09:00-12:00 arası en verimli; toplantıları öğleden sonraya koy.", at: at(-12, 10) },
  { id: id("m"), text: "Tasarım işlerinde 'bitti' demeden önce telefonda bakmayı sever.", at: at(-9, 14) },
  { id: id("m"), text: "Akşam 21:00 sonrasına iş koyma; uyku saati sabit.", at: at(-6, 18) },
  { id: id("m"), text: "Metinlerde 'çok' ve 'gerçekten' kelimelerini sevmez.", at: at(-4, 11), rouId: "rou-editor" },
];

const state = {
  version: 3, worlds, projects, tasks, blocks, sessions, inbox, timer: null, automations, runs: runs2,
  rous, chat, memory, talk: [], trash: [], changes: [],
};
migrate(state); migrateRous(state);
fs.writeFileSync(path.join(target, "playground.json"), JSON.stringify(state, null, 2) + "\n");

const count = (k) => `${k}: ${state[k].length}`;
console.log(target);
console.log(["worlds", "projects", "tasks", "blocks", "sessions", "inbox", "automations", "runs", "rous", "memory"].map(count).join(", "), `, chat msgs: ${Object.values(chat).flat().length}`);
