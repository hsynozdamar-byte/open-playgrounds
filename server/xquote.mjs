// Quote and reply on X: if the post is to quote or reply to a tweet, the tweet address and instruction lines like
// "share as a quote" are removed from the text; the target tweet is stored as post.quote / post.reply.
// The preview shows the target tweet (author, text, image); sharing opens that tweet and quotes or replies to it (server/publish.mjs).
import { bodyOf } from "../shared/social.mjs";

export const TWEET_URL = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]+)\/status\/(\d+)\S*/;
const INSTRUCTION = /^\s*(al[ıi]nt[ıi]|yan[ıi]t|quote|quoting|reply|replying)[^\n]{0,40}(payla[şs]|olarak|tweet|share|as a)[^\n]*$/i;

export function modeOf(notes) {
  const t = String(notes ?? "");
  return /al[ıi]nt[ıi]|quote|quoting/i.test(t) ? "quote" : /yan[ıi]t|reply|replying/i.test(t) ? "reply" : null;
}

// fxtwitter's public API: author, text, first image or the video's cover. If unreachable only the address is kept.
async function tweetInfo(user, id) {
  const url = `https://x.com/${user}/status/${id}`;
  try {
    const j = await fetch(`https://api.fxtwitter.com/${user}/status/${id}`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    const t = j?.tweet;
    if (!t) return { url };
    const media = (x) => {
      const m = x?.media?.all?.[0] ?? x?.media?.videos?.[0] ?? x?.media?.photos?.[0];
      if (!m) return undefined;
      // A mid-size mp4 so the preview can play a video (else the original address).
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

// Refreshes the target tweet info of a ready post (a video may not show in the quote box).
export async function refreshTarget(post) {
  const t = post?.quote ?? post?.reply;
  const m = t?.url?.match(TWEET_URL);
  if (!m) return post;
  return { ...post, [post.quote ? "quote" : "reply"]: await tweetInfo(m[1], m[2]) };
}

export const withBody = (r) => ({ ...r, body: bodyOf(r.post) });
