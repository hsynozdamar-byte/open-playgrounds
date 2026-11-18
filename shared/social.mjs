// Social posts. The app (preview), the server (prepare) and pg share these rules.
// Accounts live on the WORLD (world.accounts): posting accounts (Instagram, LinkedIn...) and incoming sources (Gmail, Slack...).
// A project picks which of its world's accounts it uses (project.accountIds). An automation or a planned post picks an account
// (automation.accountId / task.post.accountId) and one of that platform's formats (the first when none is picked). No account = plain text.

// Incoming sources: what arrives from them lands in the world's Notebook. Reading them is not built yet; for now only the account record.
export const FEEDS = {
  gmail: { label: "Gmail", what: "Mail", field: "Email address", hint: "name@gmail.com" },
  gcal: { label: "Google Calendar", what: "Meetings", field: "Calendar account", hint: "name@gmail.com" },
  slack: { label: "Slack", what: "Messages", field: "Workspace", hint: "company.slack.com" },
  clickup: { label: "ClickUp", what: "Tasks", field: "Workspace", hint: "Company" },
};
export const isFeed = (platform) => Object.hasOwn(FEEDS, platform);

export const PLATFORMS = {
  instagram: { label: "Instagram", formats: ["ig_post", "ig_reel"] },
  linkedin: { label: "LinkedIn", formats: ["linkedin"] },
  x: { label: "X", formats: ["tweet", "thread"] },
  threads: { label: "Threads", formats: ["threads"] },
  tiktok: { label: "TikTok", formats: ["short"] },
  youtube: { label: "YouTube Shorts", formats: ["short"] },
  other: { label: "Other", formats: ["text"] },
};
export const PLATFORM_LABEL = Object.fromEntries(Object.entries(PLATFORMS).map(([k, v]) => [k, v.label]));
export const FORMATS = {
  ig_post: { label: "Instagram post", short: "Post" },
  ig_reel: { label: "Reels", short: "Reels" },
  linkedin: { label: "LinkedIn post", short: "Post" },
  tweet: { label: "Tweet", short: "Tweet" },
  thread: { label: "Thread", short: "Thread" },
  threads: { label: "Threads post", short: "Post" },
  short: { label: "Vertical video", short: "Video" },
  text: { label: "Post", short: "Post" },
};
export const formatsOf = (platform) => PLATFORMS[platform]?.formats ?? ["text"];
export const isVideo = (format) => format === "ig_reel" || format === "short";
// Formats that take an attachment: text posts. Instagram and vertical video formats are already image/video.
export const TEXT_FORMATS = ["linkedin", "tweet", "thread", "threads", "text"];
export const canAttach = (format) => TEXT_FORMATS.includes(format);
export const ATTACH_LABEL = { image: "Image", video: "Video" };
// A LinkedIn post never goes out without media: one image by default (a video when the automation picks video).
export const needsImage = (format) => format === "linkedin";
export const attachOf = (format, a) => (needsImage(format) ? (a?.attach === "video" ? "video" : "image") : a?.attach);
// A LinkedIn output with no image yet cannot be approved or shared. A posted or done post is not counted as missing.
export const missingImage = (run) => needsImage(run?.post?.format) && !run.images?.length && !run.video && !["posted", "acted"].includes(run.status);
export const platformName = (acc) => (acc.platform === "other" ? acc.name || "Other" : PLATFORM_LABEL[acc.platform] ?? FEEDS[acc.platform]?.label ?? acc.platform);
// The account's public profile address (account check). LinkedIn company pages and handles that are a site address
// are taken as the address; for "Other" accounts such as Facebook, a handle that is not an address gives no profile (null).
export function profileUrl(acc) {
  const h = String(acc?.handle ?? "").trim();
  if (!h) return null;
  if (/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}\/\S+$/i.test(h)) return /^https?:\/\//i.test(h) ? h : `https://${h.startsWith("www.") ? h : `www.${h}`}`;
  const u = h.replace(/^@/, "");
  if (!/^[\w.]+$/.test(u)) return null;
  return {
    instagram: `https://www.instagram.com/${u}/`, threads: `https://www.threads.com/@${u}`, x: `https://x.com/${u}`,
    linkedin: `https://www.linkedin.com/in/${u}/`, tiktok: `https://www.tiktok.com/@${u}`, youtube: `https://www.youtube.com/@${u}`,
  }[acc.platform] ?? null;
}

export const TWEET_MAX = 280;
// Long posts are open on X Premium accounts.
export const X_PREMIUM_MAX = 25000;
export const tweetMax = (acc) => (acc?.premium ? X_PREMIUM_MAX : TWEET_MAX);
export const THREADS_MAX = 500;
export const IG_CAPTION_MAX = 2200;
export const IG_FOLD = 125; // Instagram shows this much of the caption before "more"
export const LI_FOLD = 210; // LinkedIn shows about this much before "see more"

// Old data: accounts lived on the project (project.accounts). They move to the world; the project keeps the ones it uses in accountIds.
export function migrate(s) {
  let changed = false;
  for (const p of s.projects ?? []) {
    if (!p.accounts) continue;
    const w = s.worlds.find((x) => x.id === p.worldId);
    if (w) {
      w.accounts ??= [];
      for (const a of p.accounts) if (!w.accounts.some((x) => x.id === a.id)) w.accounts.push(a);
      p.accountIds = [...new Set([...(p.accountIds ?? []), ...p.accounts.map((a) => a.id)])];
    }
    delete p.accounts;
    changed = true;
  }
  return changed;
}

// Finds an account by id (across all worlds). Result: the account + its world.
export function accountById(s, id) {
  if (!id) return undefined;
  for (const w of s.worlds) {
    const a = w.accounts?.find((x) => x.id === id);
    if (a) return { ...a, world: w };
  }
  return undefined;
}
// The accounts a project uses (from its world, in the chosen order).
export const accountsOfProject = (s, p) => {
  const w = p && s.worlds.find((x) => x.id === p.worldId);
  return (p?.accountIds ?? []).map((id) => w?.accounts?.find((a) => a.id === id)).filter(Boolean);
};
// Projects that use the account: the post is prepared with that project's context (description, brand, notes).
export const projectsOfAccount = (s, id) => s.projects.filter((p) => p.accountIds?.includes(id));

// a: an automation or { projectId, accountId }. If the chosen account was deleted there is no account.
// Result: the account + its project (else the first project using it) + its world. Incoming sources (Gmail...) are not posting accounts.
export const accountOf = (s, a) => {
  const acc = accountById(s, a?.accountId);
  if (!acc || isFeed(acc.platform)) return undefined;
  const p = (a?.projectId ? s.projects.find((x) => x.id === a.projectId) : undefined) ?? projectsOfAccount(s, acc.id)[0];
  return { ...acc, project: p };
};
// A task's account and format: task.post for a planned post, the automation's for an automation.
export const taskRef = (s, t) => {
  if (!t) return undefined;
  if (t.post) return { projectId: t.projectId, accountId: t.post.accountId, format: t.post.format };
  const a = t.autoId ? s.automations.find((x) => x.id === t.autoId) : undefined;
  return a && t.format ? { ...a, format: t.format } : a; // in an automation with rotating formats, the task's own format
};
// The platform of a hand-added post: with no account it is read from the format (the platform picked in Add post is stored as post.format).
export const POST_PLATFORMS = ["instagram", "linkedin", "x", "threads"];
export const platformOfFormat = (format) => (format ? Object.keys(PLATFORMS).find((p) => PLATFORMS[p].formats.includes(format)) : undefined);
export const postPlatform = (s, t) => accountOf(s, taskRef(s, t))?.platform ?? platformOfFormat(t?.post?.format);

// The account for a hand-added post with none chosen: if a platform was picked, the world's account on that platform (the project's linked account first);
// if "Rou picks", the platform named in the topic among the project's linked accounts, else the first. No fitting account gives undefined (plain text, shared by hand).
const HINTS = { instagram: /instagram|\big\b|reels?|carousel/i, linkedin: /linkedin/i, x: /\bx\b|tweet|twitter|flood/i, threads: /threads/i };
export function pickAccount(s, t) {
  if (!t?.post || accountOf(s, taskRef(s, t))) return undefined;
  const w = s.worlds.find((x) => x.id === t.worldId);
  const social = (w?.accounts ?? []).filter((a) => !isFeed(a.platform));
  const p = s.projects.find((x) => x.id === t.projectId);
  const mine = social.filter((a) => p?.accountIds?.includes(a.id));
  const plat = platformOfFormat(t.post.format);
  if (plat) return [...mine, ...social].find((a) => a.platform === plat);
  const text = `${t.title} ${t.post.brief ?? ""} ${t.notes ?? ""}`;
  return mine.find((a) => HINTS[a.platform]?.test(text)) ?? mine[0];
}
// A post whose platform is chosen but the world has no account on it: the platform's name (for the note on the task card).
export function missingAccount(s, t) {
  if (!t?.post || accountOf(s, taskRef(s, t))) return undefined;
  const plat = platformOfFormat(t.post.format);
  return plat && !pickAccount(s, t) ? PLATFORM_LABEL[plat] : undefined;
}

export function formatOf(s, a) {
  const acc = accountOf(s, a);
  if (!acc) return null;
  const list = formatsOf(acc.platform);
  return a.format && list.includes(a.format) ? a.format : list[0];
}

// The account's language (account.lang, default en). "tr+en": the Turkish text first, the same text in English below it.
export const LANGS = [
  { id: "en", label: "English" },
  { id: "tr", label: "Turkish" },
  { id: "tr+en", label: "Turkish + English" },
];
export const DEFAULT_LANG = "en";
export const SEP = "· · ·";
// The account's language setting is final (language is chosen per account). Even if the automation instruction, brand
// example or older posts use another language, this applies; only a revision note written for that post can change the language.
export function langRule(acc, format) {
  return `${langOf(acc, format)} This is the account's language setting and it is final: write in this language even if the automation instruction, example text or older posts are in another language. Only a revision note written for this post can change the language.`;
}
function langOf(acc, format) {
  const l = acc?.lang ?? DEFAULT_LANG;
  if (l === "en") return "Language: everything in English (text, slides, headlines, on-screen text, caption). Natural, like a native English speaker.";
  if (l !== "tr+en") return "Language: Turkish. Write the whole post (text, slides, headlines, on-screen text, caption) in natural Turkish.";
  const visual = format === "ig_post" || format === "ig_reel" || format === "short";
  return [
    `Language: bilingual. Write the Turkish text first, then a blank line, the line "${SEP}" on its own, a blank line, and the English version of the same text.`,
    "Not an English summary but natural English of the same content (it should not read like a word-for-word translation); the same number of paragraphs.",
    "The length rules apply to each language separately; the total LinkedIn limit is 3000 characters.",
    visual ? "Text in the image/video is English only; the caption is bilingual." : "",
    "For a tweet or thread, if each tweet cannot carry both languages, write Turkish only.",
  ].filter(Boolean).join(" ");
}

// Writing rules per format. The account's style comes before these; these are format only.
export const RULES = {
  ig_post: [
    "Swipeable (carousel) Instagram post: 3 to 7 slides. Slides are printed onto the image and must take 3 seconds to read.",
    "Slide 1 is the cover: one strong sentence, at most 8 words. Other slides: a short title (at most 6 words) + at most 2 short sentences.",
    "The last slide is a close: it ties the thought together or says what to do. A 'Follow' line is not required.",
    `Caption: the first ${IG_FOLD} characters must make sense on their own, because the rest is folded. At most ${IG_CAPTION_MAX} characters; flowing paragraphs of a few sentences, no line break per sentence.`,
    "Hashtags: 3 to 8, specific to the topic, starting with #; put them in the hashtags field, not inside the caption.",
  ],
  ig_reel: [
    "Vertical Reels video, told with on-screen text (no voiceover). 12 to 30 seconds in total.",
    "hook: the sentence on screen in the first 2 seconds, at most 7 words; it must stop the viewer.",
    "scenes: 3 to 7 scenes. Each scene has one short sentence on screen (at most 10 words) and its duration (sec, between 2 and 6). Reading time: at least 0.4 s per word.",
    "In one of the scenes you may pick a single word or short phrase to highlight (accent); it must be taken exactly from within that sentence.",
    `Caption: the first ${IG_FOLD} characters make sense on their own. Hashtags 3 to 8, in the hashtags field.`,
  ],
  linkedin: [
    `LinkedIn shows about the first ${LI_FOLD} characters, the rest opens with "see more". The first two lines must hold the reader but must not be a template hook sentence.`,
    "2 to 4 paragraphs; each paragraph is a flowing block of a few sentences, with a blank line between them. No line break per sentence. 600 to 1300 characters in total; if the thought is short, keep it short.",
    "No hashtags, or at most 2. Do not use emoji as bullet points.",
  ],
  tweet: [
    `A single tweet, at most ${TWEET_MAX} characters (spaces included). Ideally between 100 and 220.`,
    "No hashtags, at most one emoji. No links.",
  ],
  thread: [
    `Thread: 3 to 7 tweets. Each tweet is at most ${TWEET_MAX} characters and readable on its own.`,
    "The first tweet carries the thread; do not add numbering like '1/' or '🧵'.",
    "No hashtags.",
  ],
  threads: [
    `A single Threads post, at most ${THREADS_MAX} characters. Conversational, natural.`,
    "At most one hashtag. No links.",
  ],
  short: [
    "Vertical short video (TikTok or YouTube Shorts), told with on-screen text (no voiceover). 12 to 30 seconds in total.",
    "hook: the sentence on screen in the first 2 seconds, at most 7 words.",
    "scenes: 3 to 7 scenes. Each scene has one short sentence on screen (at most 10 words) and its duration (sec, between 2 and 6). Reading time: at least 0.4 s per word.",
    "In one of the scenes you may pick a single word or short phrase to highlight (accent); it must be taken exactly from within that sentence.",
    "Caption: short; for YouTube Shorts the first line works as a title (at most 100 characters). Hashtags 3 to 5, in the hashtags field.",
  ],
  text: [
    "A plain text post that fits the account's platform. The instruction and style set its length.",
  ],
};

// The JSON shape expected from the model.
export const SCHEMA = {
  ig_post: '{"slides":[{"title":"…","text":"…","image":"media name","from":0}],"caption":"…","hashtags":["#…"]}',
  ig_reel: '{"hook":"…","scenes":[{"text":"…","sec":3,"accent":"…","clip":"media name","from":0,"asset":"object name"}],"caption":"…","hashtags":["#…"]}',
  linkedin: '{"text":"…"}',
  tweet: '{"tweets":["…"]}',
  thread: '{"tweets":["…","…"]}',
  threads: '{"tweets":["…"]}',
  short: '{"hook":"…","scenes":[{"text":"…","sec":3,"accent":"…","clip":"media name","from":0,"asset":"object name"}],"caption":"…","hashtags":["#…"]}',
  text: '{"text":"…"}',
};

const str = (x, max = 4000) => (typeof x === "string" ? x.replace(/—/g, ",").trim().slice(0, max) : "");
const tags = (x) => [...new Set((Array.isArray(x) ? x : typeof x === "string" ? x.split(/\s+/) : []).map((t) => str(t, 60).replace(/^#?/, "#").replace(/[\s,.;]+$/g, "")).filter((t) => t.length > 1))].slice(0, 12);

// A scene's/slide's footage: the project's media name (server/library.mjs keyOf) and the start second.
const clipOf = (key, from, field) => (typeof key === "string" && key.trim() ? { [field]: key.trim().slice(0, 600), from: Math.max(0, Math.round((Number(from) || 0) * 10) / 10) } : {});

// Cleans the model's JSON per format. Null when unusable.
export function normalize(format, j) {
  if (!j || typeof j !== "object") return null;
  if (format === "ig_post") {
    const slides = (Array.isArray(j.slides) ? j.slides : []).map((x) => ({ title: str(x?.title, 160), text: str(x?.text, 400), ...clipOf(x?.image, x?.from, "image") })).filter((x) => x.title || x.text).slice(0, 10);
    return slides.length ? { format, slides, caption: str(j.caption, IG_CAPTION_MAX), hashtags: tags(j.hashtags) } : null;
  }
  if (isVideo(format)) {
    const scenes = (Array.isArray(j.scenes) ? j.scenes : []).map((x) => {
      const text = str(x?.text, 200);
      const accent = str(x?.accent, 80);
      return { text, sec: Math.max(1.5, Math.min(8, Number(x?.sec) || 3)), ...clipOf(x?.clip, x?.from, "clip"), ...(typeof x?.asset === "string" && x.asset.trim() ? { asset: x.asset.trim().slice(0, 120) } : {}), ...(accent && text.toLocaleLowerCase("tr").includes(accent.toLocaleLowerCase("tr")) ? { accent } : {}) };
    }).filter((x) => x.text).slice(0, 9);
    const hook = str(j.hook, 160);
    return hook || scenes.length ? { format, hook, scenes, caption: str(j.caption, IG_CAPTION_MAX), hashtags: tags(j.hashtags) } : null;
  }
  if (format === "linkedin" || format === "text") {
    const text = str(j.text, 3000);
    return text ? { format, text } : null;
  }
  if (format === "tweet" || format === "thread" || format === "threads") {
    const tweets = (Array.isArray(j.tweets) ? j.tweets : typeof j.text === "string" ? [j.text] : []).map((x) => str(x, X_PREMIUM_MAX)).filter(Boolean).slice(0, format === "threads" ? 1 : 10);
    // If a single tweet was asked for but several were written (e.g. a revision said "two tweets"), do not cut; keep it as a thread.
    // The quote/reply target (server/xquote.mjs) must not be lost in an edit.
    const target = (k) => (j[k] && typeof j[k].url === "string" ? { [k]: j[k] } : {});
    const x = { ...target("quote"), ...target("reply") };
    if (format === "tweet" && tweets.length > 1) return { format: "thread", tweets, ...x };
    return tweets.length ? { format, tweets, ...x } : null;
  }
  return null;
}

// A post from hand-written text (pg run --body): X/Threads formats read tweets[], the others text.
export function postOfText(format, text) {
  return format === "tweet" || format === "thread" || format === "threads" ? { format, tweets: [text] } : { format, text };
}

// Pages to tag when sharing (post.mentions: ["Acme"]): an @Name in the text does not stay plain text,
// the company/person page is picked from the platform's suggestions. The sharer (Rou) reads this line.
export function mentionRule(post) {
  const m = (post?.mentions ?? []).filter(Boolean);
  if (!m.length) return "";
  return `Tagging: ${m.map((x) => `@${x}`).join(", ")} in the text must not stay plain text. When you type @ and the name, pick ${m.map((x) => `the ${x} company page`).join(", ")} from the suggestion list that opens, so the tag becomes a link. If the suggestions have no correct (official, verified) page, leave the name as plain text and say so in the result.`;
}

// The text to copy: the form to paste into the platform.
export function bodyOf(post) {
  if (!post) return "";
  if (post.format === "ig_post" || isVideo(post.format)) return [post.caption, post.hashtags.join(" ")].filter(Boolean).join("\n\n");
  if (post.format === "linkedin" || post.format === "text") return post.text;
  return post.tweets.join("\n\n");
}

// Measurable problems against the rules. Given to the check pass and shown as warnings in the preview.
// Format rules per account: there is no 280 limit on X Premium.
export function rulesOf(format, acc) {
  if (!acc?.premium || (format !== "tweet" && format !== "thread")) return RULES[format];
  const long = "X Premium: no 280-character limit. If the story needs it, write one long post (a blank line between paragraphs); do not pad.";
  return [format === "tweet" ? long : `${long} If a thread is asked for, each tweet must be readable on its own.`, ...RULES[format].slice(1)];
}

export function problems(post, acc) {
  if (!post) return [];
  const out = [];
  const words = (t) => t.split(/\s+/).filter(Boolean).length;
  if (post.format === "tweet" || post.format === "thread") {
    post.tweets.forEach((t, i) => t.length > tweetMax(acc) && out.push(`${post.tweets.length > 1 ? `Tweet ${i + 1}` : "Tweet"} is ${t.length} characters, at most ${tweetMax(acc)}.`));
    if (post.format === "thread" && post.tweets.length < 2) out.push("A thread needs at least 2 tweets.");
  }
  if (post.format === "threads" && post.tweets[0]?.length > THREADS_MAX) out.push(`The post is ${post.tweets[0].length} characters, at most ${THREADS_MAX}.`);
  if (post.format === "ig_post" || isVideo(post.format)) {
    if (post.caption.length > IG_CAPTION_MAX) out.push(`The caption is ${post.caption.length} characters, at most ${IG_CAPTION_MAX}.`);
    if (post.hashtags.length > 8) out.push(`${post.hashtags.length} hashtags, at most 8.`);
  }
  if (post.format === "ig_post") {
    if (post.slides.length < 2) out.push("A carousel needs at least 2 slides.");
    if (post.slides[0] && words(post.slides[0].title) > 10) out.push("The cover slide is long, at most 8 words.");
  }
  if (isVideo(post.format)) {
    if (post.hook && words(post.hook) > 9) out.push("The hook is long, at most 7 words.");
    post.scenes.forEach((x, i) => words(x.text) * 0.4 > x.sec + 0.01 && out.push(`Scene ${i + 1} can't be read in ${x.sec} s.`));
  }
  if (post.format === "linkedin" && post.text.length > 3000) out.push("LinkedIn takes at most 3000 characters.");
  return out;
}

// Video length: hook + scenes + end card (seconds).
export const HOOK_SEC = 2.2;
export const END_SEC = 2;
export const reelSeconds = (post) => (post.hook ? HOOK_SEC : 0) + post.scenes.reduce((n, x) => n + x.sec, 0) + END_SEC;

// Readable draft: the text, plus slide and scene texts if any (used by the editor and prepare).
export function draftText(post, body) {
  if (!post) return String(body ?? "").trim();
  const parts = [];
  if (post.text) parts.push(post.text);
  if (post.tweets?.length) parts.push(post.tweets.map((t, i) => (post.tweets.length > 1 ? `${i + 1}/ ${t}` : t)).join("\n\n"));
  if (post.hook) parts.push(`Hook: ${post.hook}`);
  if (post.slides?.length) parts.push(post.slides.map((x, i) => `Slide ${i + 1}: ${[x.title, x.text].filter(Boolean).join(" · ")}`).join("\n"));
  if (post.scenes?.length) parts.push(post.scenes.map((x, i) => `Scene ${i + 1}: ${x.text ?? ""}`).join("\n"));
  if (post.caption) parts.push(`Caption: ${post.caption}`);
  if (post.hashtags?.length) parts.push(post.hashtags.join(" "));
  return parts.filter(Boolean).join("\n\n").trim();
}

// The approved example in the brand settings: brand.example or `Approved example: "…"` inside brand.use (the old Turkish label also works). Empty if none.
export function brandExample(brand) {
  if (typeof brand?.example === "string" && brand.example.trim()) return brand.example.trim();
  const m = String(brand?.use ?? "").match(/(?:Approved example|Onaylı örnek):\s*["“]([^"”]+)["”]/u);
  return m ? m[1].trim() : "";
}
