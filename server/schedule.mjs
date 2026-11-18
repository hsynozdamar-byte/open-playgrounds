// Otomasyonların zamanlayıcısı: sunucu açıkken dakikada bir bakar. Bugünün işlerini açar (materialize);
// Rou'nun işini saatinden LEAD dk önce hazırlar. Rou'ya atanmış tek işler de aynı yoldan. Çıktılar yine onay bekler,
// onaylanmadan hiçbir şey paylaşılmaz. Bilgisayar uyurken çalışmaz; uyanınca kaçırdığı bugünkü işleri yakalar.
import { restartPending } from "./update.mjs";
import { read, update } from "./store.mjs";
import { materialize, needsMaterialize } from "../shared/repeat.mjs";
import { needsChrome } from "../shared/chrome.mjs";
import { accountOf, taskRef } from "../shared/social.mjs";

export const LEAD = 60; // dk: saatli işler bu kadar önce hazırlanır
export const DAY_START = "07:00"; // saatsiz işler bu saatten sonra hazırlanır
export const AHEAD_AT = "12:00"; // Rou'nun otomasyon işleri bir gün önceden, bu saatten sonra hazırlanır (automation.ahead === false olanlar kendi günü)

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };

// Düşen iş kendiliğinden yeniden denenir: son çıktı "Hazırlanamadı" ise, son denemeden RETRY_MIN dk geçtiyse ve bugün
// RETRY_MAX'tan az denendiyse. Rou'nun soru sorduğu, kullanıcının elinin gerektiği (şifre, revizeye dosya) ya da paylaşılmış işler denenmez.
export const RETRY_MIN = 20, RETRY_MAX = 3;
// "Revize iste ile tekrar dene": yasaklı ifade ikinci denemede de kaldı, aynı notla üçüncü deneme de aynı sonucu verir.
const NEEDS_YOU = /durduruldu|Rou soruyor|zaten paylaşıldı|şifre|dosya olarak ekle|Revize iste ile tekrar dene/i;
const failText = (r) => `${r.renderError ?? ""} ${r.body ?? ""}`;
export function retryable(s, t, now = new Date()) {
  const runs = (s.runs ?? []).filter((r) => r.taskId === t.id);
  if (!runs.length || runs.some((r) => r.status === "posted" || r.status === "working")) return false;
  const last = runs.reduce((a, b) => (String(a.at ?? "") > String(b.at ?? "") ? a : b));
  if (!last.at || last.status !== "failed") return false;
  if (NEEDS_YOU.test(failText(last))) return false;
  if (now - new Date(last.at) < RETRY_MIN * 60 * 1000) return false;
  // Gün yerel saatle sayılır (UTC ile sayınca gün sınırı kayıyordu).
  const day = iso(now);
  return runs.filter((r) => r.status === "failed" && r.at && iso(new Date(r.at)) === day).length < RETRY_MAX;
}

// Şimdi hazırlanması gereken işler. Saf işlev (test edilir).
export function dueNow(s, now = new Date()) {
  const today = iso(now);
  const tomorrow = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const min = now.getHours() * 60 + now.getMinutes();
  const out = { claude: [], chrome: [] };
  for (const t of s.tasks ?? []) {
    // Rou'ya atanmış tek iş: günü geldiyse (ya da geçtiyse) başlar; takvimde saati varsa saatinden LEAD dk önce.
    if (!t.autoId && t.who === "claude") {
      if (t.status === "done" || t.status === "waiting" || !t.day || t.day > today) continue;
      if ((s.runs ?? []).some((r) => r.taskId === t.id)) continue;
      const blk = (s.blocks ?? []).filter((b) => b.taskId === t.id && b.start.slice(0, 10) === today).map((b) => toMin(b.start.slice(11, 16))).sort((x, y) => x - y)[0];
      const at = t.day < today ? 0 : blk !== undefined ? Math.max(0, blk - LEAD) : toMin(DAY_START);
      if (min < at) continue;
      (needsChrome(t) ? out.chrome : out.claude).push(t.id);
      continue;
    }
    if (!t.autoId || t.status === "done") continue;
    const a = (s.automations ?? []).find((x) => x.id === t.autoId);
    if (!a || a.status !== "active" || a.who !== "claude") continue;
    // Yarının işi: bugün AHEAD_AT'ten sonra hazırlanır; onay bir gün önceden verilir.
    const ahead = a.ahead !== false && t.day === tomorrow && (t.autoDay ?? t.day) === tomorrow;
    if (!ahead && (t.day !== today || (t.autoDay ?? t.day) !== today)) continue;
    const tried = (s.runs ?? []).filter((r) => r.taskId === t.id);
    if (tried.length && !retryable(s, t, now)) continue; // hazırlandı, hazırlanıyor ya da denendi
    // Daha önce denenmiş iş zamanı gelmiş iştir: yeniden deneme saatini beklemez (önceden hazırlanan yarının işi gibi).
    const at = tried.length ? 0 : ahead ? toMin(AHEAD_AT) : t.autoSlot ? Math.max(0, toMin(t.autoSlot) - LEAD) : toMin(DAY_START);
    if (min < at) continue;
    out.claude.push(t.id);
  }
  return out;
}

let lastRetention = 0;
let lastTopics = "";
export function tick(now = new Date()) {
  if (needsMaterialize(read().state)) update((s) => void materialize(s, iso(now)));
  // Onay beklemeyen otomasyon (a.approve === false): çıktı gelince uygulamadaki Onayla ile aynı yoldan onaylanır (approveRun).
  // Paylaşılacak gönderinin işi açık kalır ve saatinde paylaşılır; önceden iş burada "bitti" yapılıyordu ve gönderi hiç çıkmıyordu.
  // Sesi, videosu ya da görseli eksik çıktı onaylanmaz, kartta bekler.
  const auto = (st, r) => { const t = st.tasks.find((x) => x.id === r.taskId); const a = t && st.automations.find((x) => x.id === t.autoId); return a?.approve === false ? t : null; };
  if (read().state.runs.some((r) => r.status === "ready" && auto(read().state, r))) import("./share.mjs").then(({ approveRun }) => update((st) => {
    for (const r of st.runs) if (r.status === "ready" && auto(st, r)) { try { approveRun(st, r.id, { via: "auto" }); } catch { /* eksik: bekler */ } }
  })).catch((e) => console.error("onay:", e));
  // Takılan hazırlıklar durdurulur; aşağıdaki retryable onları 20 dk sonra yeniden başlatır.
  import("./prepare.mjs").then(({ stopStuck }) => { const x = stopStuck(); if (x.length) console.log("takılan hazırlık durduruldu:", x.join(", ")); }).catch((e) => console.error("bekçi:", e));
  const s = read().state;
  const d = dueNow(s, now);
  // Güncelleme için yeniden başlatma bekleniyorsa yeni hazırlık başlamaz; işler yeni sunucuda, bir sonraki turda alınır.
  const hold = restartPending();
  if (!hold && d.claude.length) import("./prepare.mjs").then(({ prepareMany }) => prepareMany(d.claude)).catch((e) => console.error("hazırlık:", e));
  // Rou'nun Chrome işleri plansız, doğrudan yürür; Chrome'u Rou kendisi seçer, bağlı Chrome yoksa kartta yazar ve bildirim gider.
  if (d.chrome.length) import("./browse.mjs").then(async ({ startDirect }) => { for (const id of d.chrome) await startDirect(id); }).catch((e) => console.error("tarayıcı işi:", e));
  // Kit (görünüm) değiştiyse onay bekleyen görseller yeni kitle yeniden çizilir; eski hâl sürüm geçmişinde kalır.
  // Bu kitle bir kez denenip çizilemeyen çıktı (kitTried) yeniden denenmez: yoksa bozuk bir render her dakika baştan başlardı.
  import("./prepare.mjs").then(({ kitHash, kitOf, rerender }) => {
    const st = read().state;
    const stale = st.runs.filter((r) => r.status === "ready" && r.kitHash && r.images?.length && r.post && !r.phase).filter((r) => {
      const t = st.tasks.find((x) => x.id === r.taskId);
      const acc = t && accountOf(st, taskRef(st, t));
      const h = acc && kitHash(kitOf(st, acc, t));
      return acc && h !== r.kitHash && h !== r.kitTried;
    });
    for (const r of stale.slice(0, 2)) rerender(r.id, { why: "kit" });
  }).catch((e) => console.error("kit:", e));
  // Haftalık konu planı: günde bir, önümüzdeki 7 günün konusu boş saatlerini Rou doldurur (server/plan.mjs fillTopics).
  if (now.getHours() * 60 + now.getMinutes() >= toMin(DAY_START) && lastTopics !== iso(now)) {
    lastTopics = iso(now);
    import("./plan.mjs").then(({ addDays, fillTopics }) => fillTopics({ from: iso(now), until: addDays(iso(now), 7) })).then((r) => r.filled && console.log(`konu: ${r.filled} gönderinin konusu planlandı`)).catch((e) => console.error("konu:", e));
  }
  // Saklama: günde bir (server/retention.mjs).
  if (Date.now() - lastRetention > 864e5) {
    lastRetention = Date.now();
    import("./retention.mjs").then(({ retention }) => { const r = retention(); if (Object.values(r).some(Boolean)) console.log("saklama:", r); }).catch((e) => console.error("saklama:", e));
  }
  // Onaylanmış gönderiler saatinde paylaşılır (server/share.mjs).
  import("./share.mjs").then(({ shareDue, fallbackDue }) => { shareDue(now); fallbackDue(now); }).catch((e) => console.error("paylaşım:", e));
  return d;
}

export function startSchedule() {
  if (process.env.PG_NO_SCHEDULE) return;
  setTimeout(() => { safe(); setInterval(safe, 60 * 1000); }, 15 * 1000);
}
const safe = () => { try { tick(); } catch (e) { console.error("zamanlayıcı:", e); } };
