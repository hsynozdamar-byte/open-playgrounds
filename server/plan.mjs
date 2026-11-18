// Gönderi konuları: Rou otomasyonların ileri tarihli saatlerine konu önerir (planTopics) ya da haftayı doldurur (fillTopics).
import { read, update } from "./store.mjs";
import { runClaude } from "./claude.mjs";
import { platformName, accountOf } from "../shared/social.mjs";
import { brandBlock, sourcesText } from "./prepare.mjs";
import { alwaysMedia, pastLessons, visualRules } from "../shared/revise.mjs";
import { addDirs, workDirs, workHints } from "./findmedia.mjs";
import { nextRun, occurrenceOf, topicKey } from "../shared/repeat.mjs";

const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (day, n) => { const [y, m, d] = day.split("-").map(Number); return iso(new Date(y, m - 1, d + n)); };
const dayName = (day) => { const [y, m, d] = day.split("-").map(Number); return DAYS[new Date(y, m - 1, d).getDay()]; };

// Otomasyonun önümüzdeki çalışmaları için konu önerisi: her saat için kısa başlık + ne anlatacağı.
// Talimat, marka sesi, Bilgi ve son paylaşılanlar okunur; tekrar etmez. Sunucu veriye yazmaz, uygulama uygular.
// from/until (YYYY-MM-DD) verilirse yalnız o aralıktaki saatler; empty ise yalnız konusu boş olanlar.
export async function planTopics({ autoId, count, from: since, until, empty, note }, signal) {
  const { state: s } = read();
  const a = s.automations.find((x) => x.id === autoId);
  if (!a) return { ok: false, error: "Otomasyon yok" };
  const n = Math.max(1, Math.min(14, Number(count) || 6));
  const slots = [];
  const now = new Date();
  let from = since ? new Date(...since.split("-").map((x, i) => Number(x) - (i === 1 ? 1 : 0))) : now;
  if (from < now) from = now;
  while (slots.length < n) {
    const r = nextRun(a, from);
    if (!r || (until && r.day >= until)) break;
    const task = occurrenceOf(s, a, r.day, r.slot);
    const topic = task?.topic ?? a.topics?.[topicKey(r.day, r.slot)];
    // Çıktısı olan çalışma zaten yazıldı; ona konu önerilmez.
    if ((!task || !s.runs.some((x) => x.taskId === task.id)) && !(empty && topic)) slots.push(r);
    const [h, m] = (r.slot || "23:59").split(":").map(Number);
    const [y, mo, d] = r.day.split("-").map(Number);
    from = new Date(y, mo - 1, d, h, m + 1);
  }
  if (!slots.length) return { ok: false, error: "Planlı saat yok" };
  const p = s.projects.find((x) => x.id === a.projectId);
  const acc = accountOf(s, a);
  const ids = new Set(s.tasks.filter((t) => t.autoId === a.id).map((t) => t.id));
  const recent = s.runs.filter((r) => r.taskId && ids.has(r.taskId) && r.body).slice(0, 10).map((r) => r.body.split("\n").find((x) => x.trim())?.slice(0, 140)).filter(Boolean);
  const planned = Object.values(a.topics ?? {}).map((t) => t.title);
  // Her gönderisinde gerçek görsel şart olan hesapta konu, diskte ya da yayında gerçekten duran bir işe dayanır (source).
  const real = alwaysMedia(visualRules(s, { autoId: a.id, worldId: a.worldId }));
  const dirs = real ? workDirs(s, p) : [];
  const used = real ? [...new Set(s.tasks.filter((t) => t.autoId === a.id).map((t) => t.topic?.source).concat(Object.values(a.topics ?? {}).map((t) => t.source)).filter(Boolean))].slice(-30) : [];
  const prompt = [
    "Kullanıcının bir sosyal medya otomasyonu için önümüzdeki gönderilerin konularını planlıyorsun. Şimdi yalnız konu: her gönderi sonra ayrıca yazılacak.",
    // Hafta özetinden gelen talimat: o dönemin planı buna göre kurulur, diğer kurallardan önce gelir.
    note ? `Kullanıcının bu dönem için talimatı (en önemli; konuları buna göre seç ve sırala, istemediği konuyu koyma): ${note}` : "",
    `Otomasyon: ${a.title}`,
    acc ? `Hesap: ${platformName(acc)} ${acc.handle || acc.name}${acc.voice ? ` · Tarz: ${acc.voice}` : ""}` : "",
    p ? `Proje: ${p.name}${p.description ? `: ${p.description}` : ""}` : "",
    brandBlock(p),
    sourcesText(p),
    `Talimat (genel yön): ${a.action || a.title}`,
    recent.length ? `Son paylaşılanların ilk satırları (tekrar etme):\n${recent.map((x) => `- ${x}`).join("\n")}` : "",
    (() => { const l = pastLessons(s, { id: "", autoId: a.id }, 10); return l.length ? `Kullanıcı bu otomasyonun gönderilerine şu revizeleri verdi; konu seçerken aynı hataya düşme (ör. istemediği konu, yanlış odak):\n${l.map((x) => `- ${x}`).join("\n")}` : ""; })(),
    planned.length ? `Zaten planlı konular (tekrar etme):\n${planned.map((x) => `- ${x}`).join("\n")}` : "",
    `Konu istenen saatler:\n${slots.map((x) => `- ${x.day} ${dayName(x.day)}${x.slot ? ` ${x.slot}` : ""}`).join("\n")}`,
    real ? [
      "Bu hesabın her gönderisinde gerçek bir görsel ya da video olacak. Bu yüzden her konu kullanıcının GERÇEKTEN var olan ve gösterilebilen bir işine dayanmalı. Konu seçmeden önce Read, Glob ve Grep ile şuralara bak:",
      workHints(s),
      dirs.length ? `Okuyabildiğin klasörler: ${dirs.join(", ")}` : "",
      "Her konu için source yaz: gönderide gösterilecek şeyin adresi ya da dosya yolu (ör. https://example.com/work/proje ya da bir video dosyası). Hareketli işleri (launch ve logo animasyonu, açılış, geçiş) öne al. brief yalnız o kaynakta gerçekten görüneni anlatsın; kanıtı olmayan olay, deneme ya da karar hikâyesi (ör. 'üç versiyon denedim') yazma. Aynı kaynağı iki konuda kullanma.",
      used.length ? `Daha önce kullanılan kaynaklar (yeniden kullanma):\n${used.map((x) => `- ${x}`).join("\n")}` : "",
    ].filter(Boolean).join("\n") : "",
    "Kurallar: Her saat için bir konu. Konu hesabı takip eden biri için ilginç ve açık olsun: kullanıcının yaptığı bir iş, ürün ya da karar; iç araç adlarına (Rou, otomasyon akışı) dayanan, yalnız onu ilgilendiren altyapı konuları değil. Konular somut ve birbirinden farklı; marka içerik başlıkları varsa dağıt. Bilmediğin rakam, olay, müşteri, ürün özelliği uydurma; Bilgi'de ve talimatta olandan çık. Uzun tire (—) kullanma.",
    `SADECE şu JSON'u yaz: {"items":[{"day":"YYYY-MM-DD","slot":"HH:MM ya da boş","title":"konu, en fazla 8 kelime","brief":"ne anlatacak, 1-2 cümle"${real ? ',"source":"gösterilecek gerçek işin adresi ya da dosya yolu"' : ""}}]}`,
  ].filter(Boolean).join("\n\n");
  const r = await runClaude(prompt, (real ? 8 : 3) * 60 * 1000, signal, real ? { args: ["--allowedTools", "Read,Glob,Grep", ...addDirs(dirs)] } : {});
  if (!r.ok) return r;
  let j;
  try { j = JSON.parse(r.out.match(/\{[\s\S]*\}/)?.[0] ?? ""); } catch { return { ok: false, error: "Konular okunamadı" }; }
  const clean = (x, n) => String(x || "").replace(/—/g, ",").trim().slice(0, n);
  const items = (Array.isArray(j?.items) ? j.items : []).map((x) => {
    const at = slots.find((y) => y.day === x?.day && (y.slot || "") === (x?.slot || ""));
    return at && x.title ? { day: at.day, slot: at.slot || "", title: clean(x.title, 90), brief: clean(x.brief, 400), ...(real && x.source ? { source: clean(x.source, 300) } : {}) } : null;
  }).filter(Boolean);
  return items.length ? { ok: true, items } : { ok: false, error: "Konu çıkmadı" };
}

// Haftanın konuları: aralıktaki her otomasyonun (Rou yazar) konusu boş saatlerini Rou doldurur ve veriye yazar.
// Elle yazılmış konuya dokunmaz. Uygulamadaki "Haftayı planla" ve zamanlayıcı (her gün önümüzdeki 7 gün) bunu çağırır.
let filling = false;
export async function fillTopics(opts, signal) {
  if (filling) return { ok: false, error: "Rou zaten konu planlıyor" };
  filling = true;
  try { return await fill(opts, signal); } finally { filling = false; }
}
async function fill({ from, until, autoIds, note }, signal) {
  const { state: s } = read();
  const autos = s.automations.filter((a) => a.status === "active" && a.who !== "me" && !a.browser && (!autoIds || autoIds.includes(a.id)));
  let filled = 0;
  const errors = [];
  for (const a of autos) {
    if (signal?.aborted) break;
    // Talimat varsa henüz hazırlanmamış bütün saatler yeniden planlanır; yoksa yalnız boş konular doldurulur.
    const r = await planTopics({ autoId: a.id, count: 14, from, until, empty: !note, note }, signal);
    if (!r.ok) { if (r.error !== "Planlı saat yok") errors.push(`${a.title}: ${r.error}`); continue; }
    update((st) => {
      const x = st.automations.find((y) => y.id === a.id);
      if (!x) return;
      for (const it of r.items) {
        const t = { title: it.title, brief: it.brief, ...(it.source ? { source: it.source } : {}) };
        const task = occurrenceOf(st, x, it.day, it.slot);
        if (task) { if (!task.topic || note) { task.topic = t; filled++; } continue; }
        x.topics = { ...(x.topics ?? {}) };
        if (!x.topics[topicKey(it.day, it.slot)] || note) { x.topics[topicKey(it.day, it.slot)] = t; filled++; }
      }
    });
  }
  return filled || !errors.length ? { ok: true, filled, errors } : { ok: false, error: errors[0] };
}
