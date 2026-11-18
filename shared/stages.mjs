// Bir otomasyon işinin adımları ve şu an hangisinde olduğu. Otomasyonlar sayfası (Bugün panosu) bunu çizer.
// Çıktı türü: hesabın biçimi videoysa "video", hesap varsa "post", yoksa otomasyonun output alanı (varsayılan "text").
// Metin gönderisinin eki varsa (görsel ya da video; LinkedIn'de zorunlu) metinden sonra o adım gelir; ek olmadan onay ve paylaşım açılmaz.
// a.voice === "me": video kullanıcının sesiyle yapılır; metin hazırlanınca sıra ona geçer.
import { accountOf, attachOf, formatOf, isVideo, needsImage } from "./social.mjs";

const BOT = { claude: "Rou", me: "Sen" }; // claude = Rou (uygulamanın asistanı)
const STALE = 6 * 60 * 1000;

export function outputOf(s, a) {
  const f = formatOf(s, a);
  if (f) return isVideo(f) ? "video" : "post";
  // Hesap bağlı değil ama otomasyon paylaşıyor (paylaşım adımı ya da platform seçili): yine gönderidir; onay işi bitirmez, paylaşım beklenir.
  if (!a?.output && (a?.platforms?.length || a?.steps?.some((x) => x.kind === "post"))) return "post";
  return a?.output ?? "text";
}
// Paylaşımı kim yapar: bu işte seçilen, yoksa otomasyonda seçilen, yoksa Rou.
export const sharerOf = (a, task) => task?.sharer ?? a?.sharer ?? "claude";
export const OUTPUT_LABEL = { text: "Metin", post: "Gönderi", video: "Video", report: "Rapor" };

// state: done | now | todo | fail. now: sıradaki adım (kimin elinde olduğu who'da).
export function stagesOf(s, a, task, run, now = Date.now()) {
  if (task?.format && a) a = { ...a, format: task.format }; // sırayla biçimli otomasyon: bu işin biçimi
  const out = outputOf(s, a);
  const acc = accountOf(s, a);
  const steps = [{ key: "write", label: a.who === "me" ? "Yap" : "Metin", who: BOT[a.who] ?? a.who }];
  if (out === "video" && a.voice === "me") steps.push({ key: "voice", label: "Ses", who: "Sen" });
  // Ek: otomasyonda seçilen görsel ya da video (LinkedIn'de ek zorunlu, varsayılanı görsel).
  const att = a.who !== "me" && out !== "video" ? attachOf(formatOf(s, a), a) : undefined;
  if (out === "video" || att === "video") steps.push({ key: "video", label: "Video", who: "Rou" });
  const image = att === "image";
  if (image) steps.push({ key: "image", label: "Görsel", who: "Rou" });
  if (a.who !== "me" && a.approve !== false) steps.push({ key: "approve", label: "Onay", who: "Sen" });
  // Gönderi ve video paylaşılınca biter: hesap bağlıysa Paylaş düğmesiyle, değilse kendin paylaşıp "Paylaştım" dersin.
  if (acc || out === "post" || out === "video") steps.push({ key: "publish", label: "Paylaşım", who: BOT[sharerOf(a, task)] }); // paylaşan: Rou ya da Sen (otomasyonda ya da işte seçilir)

  const stale = run?.status === "working" && now - new Date(run.at).getTime() > STALE;
  const done = new Set();
  let fail = null;
  if (a.who === "me") { if (task?.status === "done") done.add("write"); }
  else if (run && !stale && run.status !== "working" && run.status !== "failed") done.add("write");
  else if (run && (run.status === "failed" || stale)) fail = "write";
  if (run?.voice) done.add("voice");
  if (run?.video) done.add("video");
  else if (run?.renderError && done.has("write") && (a.voice !== "me" || run.voice)) fail = "video";
  if (run?.images?.length || run?.video || run?.status === "posted" || (run && task?.status === "done")) done.add("image");
  else if (image && run?.renderError && done.has("write")) fail = "image";
  if (["approved", "posted", "acted"].includes(run?.status) || (a.who === "me" && task?.status === "done")) { done.add("approve"); done.add("voice"); done.add("video"); }
  if (run?.status === "posted" || (run && task?.status === "done")) done.add("publish");

  let current = null;
  for (const st of steps) {
    if (done.has(st.key)) st.state = "done";
    else if (!current) { current = st.key; st.state = fail === st.key ? "fail" : "now"; }
    else st.state = "todo";
  }
  const busy = (current === "write" && run?.status === "working" && !stale) || ((current === "video" || current === "image") && !!run?.phase);
  return { output: out, steps, current, busy, finished: !current };
}

// Paylaşılacak platformlar: hesap bağlıysa hesabınki, değilse otomasyonda seçilenler.
export const PLATFORMS = ["instagram", "tiktok", "youtube", "x", "threads", "linkedin"];
export const PLATFORM_NAME = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", x: "X", threads: "Threads", linkedin: "LinkedIn" };
export function platformsOf(s, a) {
  const acc = a && accountOf(s, a);
  return acc ? [acc.platform] : a?.platforms ?? [];
}
