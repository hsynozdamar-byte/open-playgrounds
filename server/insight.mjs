// Hesap analizi: bir Instagram hesabına üç bakış (profil puanı, ne işe yarıyor, haftanın planı). Yöntem aşağıdaki METHOD metninde.
// Rou profili hesabın dünyasının tarayıcısında ARKA PLANDA açar (rouTab quiet), ekran görüntüsü ve sayfa içeriğinden okur,
// yöntemi uygular. Hiçbir şeye tıklayıp değiştirmez, giriş yapmaz, beğenmez, mesaj atmaz.
// Sonuç account.insights[kind] = { at, score?, summary, items: [{ title, detail }], error? }; sürerken { phase }.
import { read, update } from "./store.mjs";
import { runClaude } from "./claude.mjs";
import { releaseTab, rouArgs, rouRules, rouTab } from "./pb.mjs";

export const KINDS = {
  profile: {
    label: "Profil puanı",
    ask: "Profili 100 üzerinden puanla. Ölçüt (her biri ağırlıklı): ad alanı aranan kelimeyi taşıyor mu (10), bio kime ne sunduğunu ve neden takip edilmesi gerektiğini ilk satırda söylüyor mu (20), bağlantı ve çağrı net mi (10), öne çıkan hikâyeler düzenli ve adlı mı (10), sabitlenen gönderiler hesabı tanıtıyor mu (15), ızgara tutarlı bir görünüm ve tekrar eden seriler gösteriyor mu (20), son gönderilerin sıklığı düzenli mi (15). En zayıf alanları önce ver; her biri için kopyalanabilir bir yeniden yazım ya da somut düzeltme yaz.",
  },
  audit: {
    label: "Ne işe yarıyor",
    ask: "Son gönderileri ve görünen sayıları (beğeni, yorum, izlenme) incele: hesabın kendi ortalamasını hangileri geçti, ortak yanları ne (biçim, konu, ilk kare, başlık), hangileri düştü ve neden. Neyi tekrarlamalı, neyi bırakmalı, sıradaki üç denemeyi yaz. Görünmeyen sayıyı uydurma; yalnız sayfada görüneni kullan.",
  },
  plan: {
    label: "Haftanın planı",
    ask: "Bu hesabın önümüzdeki haftasını planla: her gönderi için gün, biçim (reel, carousel, gönderi, hikâye), konu, açılış cümlesi ya da ilk kare ve neden o gün. Hesabın son gönderilerinde işe yarayanlara ve projenin konusuna dayan; haftada 3-5 gönderi yeter.",
  },
};
const busy = new Set();
// Yanıttaki ilk JSON nesnesi.
const json = (out) => { const m = String(out ?? "").match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const HOME = (handle) => `https://www.instagram.com/${String(handle ?? "").replace(/^@/, "").replace(/^.*instagram\.com\//, "").replace(/\/.*$/, "")}/`;

export function accountInsight(accountId, kind) {
  const k = KINDS[kind];
  const { state: s } = read();
  const world = s.worlds.find((w) => w.accounts?.some((a) => a.id === accountId));
  const acc = world?.accounts.find((a) => a.id === accountId);
  if (!k || !acc) return { ok: false, error: "Hesap ya da analiz türü yok" };
  if (acc.platform !== "instagram") return { ok: false, error: "Bu analiz yalnız Instagram hesapları için" };
  const key = `${accountId}:${kind}`;
  if (busy.has(key)) return { ok: false, error: "Bu analiz zaten sürüyor" };
  busy.add(key);
  const set = (v) => update((st) => { const a = st.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === accountId); if (a) a.insights = { ...(a.insights ?? {}), [kind]: v }; });
  const prev = acc.insights?.[kind];
  set({ ...(prev ?? {}), phase: "Rou profili açıyor", at: prev?.at ?? new Date().toISOString() });
  const project = s.projects.find((p) => p.accountIds?.includes(acc.id));
  const done = (async () => {
    let tab;
    try { tab = await rouTab(world, `insight-${accountId}-${kind}`, `Rou analiz ediyor · ${k.label}`); }
    catch (e) { return { ok: false, error: e.message }; }
    const prompt = [
      `Kullanıcının Instagram hesabını analiz ediyorsun: ${acc.handle || acc.name}${project ? ` (proje: ${project.name}${project.description ? `, ${project.description}` : ""})` : ""}.`,
      rouRules(tab, null),
      `Bu sekmede ${HOME(acc.handle || acc.name)} adresini aç. Sayfayı take_snapshot ile oku, gerekirse aşağı kaydır (en çok ilk 12 gönderi) ve take_screenshot ile bak. Bir gönderiyi açman gerekirse aç, sonra geri dön.`,
      "Kurallar: yalnız oku. Hiçbir şeye beğeni, yorum, takip, mesaj, düzenleme yapma; giriş yapma; ayar açma. Oturum kapalıysa dur ve hata yaz.",
      "Gereken veriyi bu sayfadan kendin topla; soru sorma.",
      k.ask,
      "Türkçe yaz, kısa ve somut. Uydurma sayı yok.",
      'SADECE şu JSON\'u yaz: {"score": 0-100 ya da null, "summary": "2-3 cümle", "items": [{"title": "kısa başlık", "detail": "ne, neden, kopyalanabilir öneri"}], "error": "yapılamadıysa nedeni ya da boş"}',
    ].join("\n\n");
    try { return await runClaude(prompt, 8 * 60 * 1000, undefined, { args: rouArgs(null, ["Read"], [], { read: true }) }); }
    finally { releaseTab(tab.targetId); }
  })().then((r) => {
    busy.delete(key);
    const j = r.ok ? json(r.out) : null;
    const at = new Date().toISOString();
    if (!j || j.error) return set({ ...(prev ?? {}), at: prev?.at ?? at, error: String(j?.error || r.error || "Yanıt okunamadı").slice(0, 300), phase: undefined });
    set({ at, score: typeof j.score === "number" ? Math.round(j.score) : null, summary: String(j.summary ?? "").slice(0, 800), items: (Array.isArray(j.items) ? j.items : []).slice(0, 12).map((x) => ({ title: String(x?.title ?? "").slice(0, 160), detail: String(x?.detail ?? "").slice(0, 900) })) });
  });
  return { ok: true, done };
}
