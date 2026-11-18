// İçerik önerileri: bir otomasyon için güncel gündemden gönderi fikirleri (trend, neden şimdi, kaynak).
// Rou web aramasıyla çıkarır.
// Sonuç automation.ideas = { at, items: [{ title, brief, why, trend?, url? }], error? }; sürerken { phase }. Hiçbir şey paylaşılmaz.
import { read, update } from "./store.mjs";
import { runClaude } from "./claude.mjs";

const busy = new Set();
const json = (out) => { const m = String(out ?? "").match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const FORMAT = '{"title": "konu, en çok 70 karakter", "brief": "ne anlatacak, 1-2 cümle", "why": "neden şimdi / neden işe yarar, 1 cümle", "trend": "dayandığı gündem ya da boş", "url": "kaynak ya da boş"}';

// Rou'nun çıktısından gelen fikirler: yalnız bilinen alanlar, sınırlı uzunluk, http(s) kaynak, en çok 8.
export const cleanIdeas = (items) => (Array.isArray(items) ? items : [])
  .filter((x) => x && typeof x === "object" && String(x.title ?? "").trim())
  .slice(0, 8)
  .map((x) => ({ title: String(x.title).trim().slice(0, 120), brief: String(x.brief ?? "").slice(0, 400), why: String(x.why ?? "").slice(0, 300), trend: String(x.trend ?? "").slice(0, 200), url: /^https?:\/\//.test(String(x.url ?? "")) ? String(x.url).slice(0, 500) : "" }));

const set = (autoId, v) => update((st) => { const x = st.automations.find((y) => y.id === autoId); if (x) x.ideas = v; });

// Fikirlerin neye göre aranacağı: Rou'nun prompt'unun başı.
export function ideasBrief(s, a) {
  const p = s.projects.find((x) => x.id === a.projectId);
  const recent = s.runs.filter((r) => s.tasks.find((t) => t.id === r.taskId)?.autoId === a.id).slice(0, 10).map((r) => `- ${r.title}: ${(r.body ?? "").split("\n").find((l) => l.trim())?.slice(0, 120) ?? ""}`);
  const planned = Object.values(a.topics ?? {}).map((t) => `- ${t.title}`).slice(0, 14);
  return [
    `Kullanıcının "${a.title}" otomasyonu için içerik önerileri${p ? ` (proje: ${p.name}${p.description ? `, ${p.description}` : ""})` : ""}.`,
    `Otomasyonun talimatı: ${a.action || "(yok)"}`,
    p?.brand?.audience ? `Kitle: ${p.brand.audience}` : "",
    recent.length ? `Son gönderiler (tekrarlama):\n${recent.join("\n")}` : "",
    planned.length ? `Zaten planlı konular (tekrarlama):\n${planned.join("\n")}` : "",
    "Bu hesaba uyan 6 gönderi fikri çıkar. Her fikir somut olsun: neyi anlatacağı ve neden şimdi işe yarayacağı. Trend ya da haber varsa kaynağını ver; yoksa uydurma, url'yi boş bırak. Türkçe yaz, kısa.",
  ].filter(Boolean).join("\n\n");
}

export function postIdeas(autoId) {
  const { state: s } = read();
  const a = s.automations.find((x) => x.id === autoId);
  if (!a) return { ok: false, error: "Otomasyon yok" };
  if (busy.has(autoId)) return { ok: false, error: "Öneriler zaten hazırlanıyor" };
  const prev = a.ideas;
  const started = new Date().toISOString();
  const brief = ideasBrief(s, a);

  busy.add(autoId);
  set(autoId, { ...(prev ?? {}), at: prev?.at ?? started, error: undefined, phase: "Rou gündemi tarıyor" });
  const prompt = [
    brief,
    "WebSearch ile bu alanda son günlerin gündemini, tartışılan konuları ve trend formatları ara.",
    `SADECE şu JSON'u yaz: {"items": [${FORMAT}]}`,
  ].join("\n\n");
  const done = runClaude(prompt, 6 * 60 * 1000, undefined, { args: ["--allowedTools", "WebSearch,WebFetch"] }).then((r) => {
    busy.delete(autoId);
    const items = cleanIdeas(r.ok ? json(r.out)?.items : null);
    const at = new Date().toISOString();
    if (!items.length) return set(autoId, { ...(prev ?? {}), at: prev?.at ?? at, phase: undefined, error: String(r.error || "Öneri çıkmadı").slice(0, 300) });
    set(autoId, { at, items });
  });
  return { ok: true, by: "claude", done };
}
