// "Claude ile kur": serbest bir cümleyi (ya da bir işi/notu) otomasyon taslağına çevirir.
// `claude -p` JSON döndürür; kullanıcı formda kontrol edip kaydeder.
import { read } from "./store.mjs";
import { runClaude } from "./claude.mjs";
import { accountsOfProject, formatsOf, isFeed } from "../shared/social.mjs";

function prompt(s, text, fixed) {
  const worlds = s.worlds.filter((w) => !fixed || w.id === fixed.id).map((w) => ({ id: w.id, name: w.name, about: w.description, projects: s.projects.filter((p) => p.worldId === w.id && p.status !== "done").map((p) => ({ id: p.id, name: p.name, ...(accountsOfProject(s, p).filter((a) => !isFeed(a.platform)).length ? { accounts: accountsOfProject(s, p).filter((a) => !isFeed(a.platform)).map((a) => ({ id: a.id, platform: a.platform, name: a.name, handle: a.handle })) } : {}) })) }));
  const d = new Date();
  return [
    "Kullanıcının planlayıcısı Playgrounds için bir otomasyon taslağı çıkar. Sadece JSON yaz, başka hiçbir şey yazma.",
    `Bugün: ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}, haftanın günü ${d.getDay()} (0=Pazar).`,
    fixed ? `Dünya belli: ${fixed.name} (worldId "${fixed.id}"). Projeyi yalnız bu dünyanın projelerinden seç.` : "",
    `Dünyalar ve projeler: ${JSON.stringify(worlds)}`,
    `İstek: """${text}"""`,
    `JSON şeması: {"title": string (kısa, ör. "LinkedIn gönderisi"), "worldId": string (listeden), "projectId": string|null (listeden; uymuyorsa null), "days": number[] (0=Paz..6=Cmt; "her gün" = [0,1,2,3,4,5,6], "hafta içi" = [1,2,3,4,5]), "times": string[] ("HH:MM"; "sabah ve akşam 8" = ["08:00","20:00"]; saat yoksa []), "minutes": number (takvimde ayrılacak süre, varsayılan 30), "who": "claude"|"me" (yazı/içerik hazırlanacaksa ve kişi belirtilmemişse claude; kişinin kendisi yapacaksa me), "action": string (hazırlayacak bota net, Türkçe talimat: ne üretilecek, ton, uzunluk, proje bağlamı; me ise kısa açıklama; projenin hesabı varsa yalnız konuyu yaz, biçim ve tarz hesaptan gelir), "accountId": string|null (yalnız accounts olan projede: istekte geçen platforma ya da hesaba uyan hesabın id'si; değilse null), "format": "ig_post"|"ig_reel"|"linkedin"|"tweet"|"thread"|"threads"|"short"|"text"|null (seçilen hesabın platformuna göre: instagram gönderi ig_post, reels/video ig_reel; linkedin linkedin; x tek tweet tweet, flood thread; threads threads; tiktok ve youtube short; diğer text; hesap yoksa null), "steps": [{"kind": "text"|"image"|"video"|"post"|"other", "tool": "claude"|"me", "account": string (yalnız post: platform ve hesap, ör. "LinkedIn, kişisel profil"), "note": string (kısa: nasıl)}] (istekte geçen sırayla; araç söylenmediyse metin için hazırlayan bot, paylaşım için "me")}`,
    "Uzun tire (—) kullanma. Bilmediğin bilgi uydurma.",
  ].filter(Boolean).join("\n\n");
}

// worldId verilirse dünya sabittir: Claude yalnız o dünyanın projelerini görür ve dünyayı değiştiremez.
export async function draft(text, worldId = null, signal) {
  const { state: s } = read();
  const fixed = worldId ? s.worlds.find((w) => w.id === worldId) : undefined;
  const r = await runClaude(prompt(s, text, fixed), 120000, signal);
  const m = r.ok && r.out.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, error: (r.error || r.out || "Claude yanıt vermedi").slice(0, 300) };
  try {
    const j = JSON.parse(m[0]);
    const world = fixed ?? s.worlds.find((w) => w.id === j.worldId) ?? s.worlds[0];
    const project = s.projects.find((p) => p.id === j.projectId && p.worldId === world.id);
    return {
      ok: true,
      draft: {
        title: String(j.title || text).slice(0, 80),
        worldId: world.id,
        projectId: project?.id ?? null,
        days: Array.isArray(j.days) && j.days.length ? j.days.filter((x) => x >= 0 && x <= 6) : [0, 1, 2, 3, 4, 5, 6],
        times: Array.isArray(j.times) ? j.times.filter((x) => /^\d{2}:\d{2}$/.test(x)) : [],
        minutes: +j.minutes || 30,
        who: ["claude", "me"].includes(j.who) ? j.who : "claude",
        action: String(j.action || ""),
        ...(() => {
          const acc = accountsOfProject(s, project).find((a) => a.id === j.accountId && !isFeed(a.platform));
          return acc ? { accountId: acc.id, ...(formatsOf(acc.platform).includes(j.format) ? { format: j.format } : {}) } : {};
        })(),
        steps: (Array.isArray(j.steps) ? j.steps : []).filter((x) => x && ["text", "image", "video", "post", "other"].includes(x.kind)).slice(0, 8).map((x, i) => ({
          id: `d${i}${Math.random().toString(36).slice(2, 6)}`, kind: x.kind,
          tool: ["claude", "me"].includes(x.tool) ? x.tool : "me",
          ...(x.kind === "post" && x.account ? { account: String(x.account).slice(0, 80) } : {}),
          ...(x.note ? { note: String(x.note).slice(0, 80) } : {}),
        })),
      },
    };
  } catch {
    return { ok: false, error: "Claude'un yanıtı okunamadı" };
  }
}
