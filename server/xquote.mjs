// X'te alıntı ve yanıt: gönderi bir tweete alıntı ya da yanıt olacaksa metindeki tweet adresi ve
// "alıntı olarak paylaş" gibi talimat satırları metinden çıkar; hedef tweet post.quote / post.reply olarak saklanır.
// Önizleme hedef tweeti (yazar, metin, görsel) gösterir; paylaşım o tweeti açıp alıntılar ya da yanıtlar (server/publish.mjs).
import { bodyOf } from "../shared/social.mjs";

export const TWEET_URL = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)\S*/;
const INSTRUCTION = /^\s*(al[ıi]nt[ıi]|yan[ıi]t|quote|reply)[^\n]{0,40}(payla[şs]|olarak|tweet)[^\n]*$/i;

export function modeOf(notes) {
  const t = String(notes ?? "");
  return /al[ıi]nt[ıi]|quote/i.test(t) ? "quote" : /yan[ıi]t|reply/i.test(t) ? "reply" : null;
}

// fxtwitter'ın herkese açık API'si: yazar, metin, ilk görsel ya da videonun kapağı. Ulaşılamazsa yalnız adres kalır.
async function tweetInfo(user, id) {
  const url = `https://x.com/${user}/status/${id}`;
  try {
    const j = await fetch(`https://api.fxtwitter.com/${user}/status/${id}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    const t = j?.tweet;
    if (!t) return { url };
    const media = (x) => {
      const m = x?.media?.all?.[0] ?? x?.media?.videos?.[0] ?? x?.media?.photos?.[0];
      if (!m) return undefined;
      // Videoda önizleme oynasın diye orta boy mp4 (yoksa asıl adres).
      const mp4 = (m.formats ?? []).filter((f) => f.container === "mp4" && f.bitrate).sort((a, b) => a.bitrate - b.bitrate);
      const video = m.type === "photo" ? undefined : (mp4[Math.min(2, mp4.length - 1)]?.url ?? m.url);
      return { kind: m.type === "photo" ? "image" : "video", thumb: m.thumbnail_url ?? m.url, ...(video ? { video } : {}) };
    };
    const inner = t.quote ? { name: t.quote.author?.name, handle: `@${t.quote.author?.screen_name}`, text: t.quote.text, media: media(t.quote) } : undefined;
    return { url, name: t.author?.name, handle: `@${t.author?.screen_name}`, avatar: t.author?.avatar_url, text: t.text, media: media(t), ...(inner ? { inner } : {}) };
  } catch { return { url }; }
}

export async function linkTweet(post, notes) {
  if (!post?.tweets?.length || post.format === "threads") return post;
  const mode = modeOf(notes);
  if (!mode) return post;
  const first = post.tweets[0];
  const m = first.match(TWEET_URL) ?? String(notes).match(TWEET_URL);
  if (!m) return post;
  const clean = (t) => t.replace(TWEET_URL, "").split("\n").filter((l) => !INSTRUCTION.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const tweets = post.tweets.map(clean).filter(Boolean);
  const target = await tweetInfo(m[1], m[2]);
  return { ...post, tweets: tweets.length ? tweets : post.tweets, [mode]: target };
}

// Hazır bir gönderinin hedef tweet bilgisini yeniler (alıntı kutusunda video görünmeyebilir).
export async function refreshTarget(post) {
  const t = post?.quote ?? post?.reply;
  const m = t?.url?.match(TWEET_URL);
  if (!m) return post;
  return { ...post, [post.quote ? "quote" : "reply"]: await tweetInfo(m[1], m[2]) };
}

export const withBody = (r) => ({ ...r, body: bodyOf(r.post) });
