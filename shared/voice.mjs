import { WRITING_GUIDE } from "./guide.mjs";

// Rou's writing voice. The account's style note and the brand rule sit on top of it.
export const VOICE = [
  "The first sentence states the post's topic or main idea directly. No long intro, no context-setting.",
  "Each paragraph carries new information; do not repeat the previous sentence in other words.",
  "Write concretely: what was done, what changed, where it is used. Real detail instead of abstract assessment.",
  "The close is one natural thought; no slogan, no call to engage, no contrived question.",
  "No filler or hedging phrases ('honestly', 'basically', 'actually', 'in short').",
  "No hype: no revolution, turning point or game-changer. Do not write plans and goals as if they already happened.",
  "No bullet lists, emoji, exclamation-mark storms, 'This is not an X, it is a Y' pattern, or invented quotes.",
].join("\n");

// Tone samples for personal accounts; when empty, only the rules and the project's approved example apply.
export const VOICE_SAMPLES = [];

// Core voice: comes before the guide and extra rules; wins when they conflict.
export const VOICE_CORE = [
  "Get straight to the point. No long intro, no context-setting, no needless explanation.",
  "Write clearly: someone who knows nothing about the topic should understand it on first read. Introduce the product in half a sentence the first time it appears; no internal term or code name goes unexplained.",
  "First person on personal accounts; avoid passive sentences.",
  "Write like you talk, no fake friendliness.",
  "Do not force technical terms into translation: AI, app, UI, prototype can stay as they are.",
  "One idea, a few short sentences. Never explain the same thing twice.",
  "Talk about the process: what you did, what you ran into, how you solved it.",
  "Give your view, do not lecture.",
  "No hype: revolutionary, game-changing, incredible experience.",
  "Stop where it should end. No forced conclusion paragraph and no call to engage.",
].join("\n");
export const LENGTH = [
  "X: 60-240 characters, usually 1-3 sentences.",
  "Threads: 150-400 characters, at most 2 short paragraphs.",
  "LinkedIn: 250-650 characters, 3-5 short paragraphs; in a bilingual post each language is counted separately.",
  "Instagram caption: 120-350 characters, 2-4 sentences; a single CTA and few hashtags if needed.",
  "These are target ranges; do not stretch if one sentence is enough. Corporate accounts keep their own voice but still use these lengths.",
].join("\n");

// English accounts (account.lang en, or the English half of tr+en): the same core voice, in its natural English form.
export const VOICE_CORE_EN = [
  "Get to the point in the first line. No warm-up, no context-setting.",
  "Be clear: someone who has never heard of the product should get it on first read. Introduce the app or game in half a sentence the first time; no unexplained internal names.",
  "First person on personal accounts: I designed, I tried, I shipped. Active voice.",
  "Write like you talk, plain everyday English. Short sentences, contractions are fine. Not a translation from another language.",
  "Talk about the process: what you made, what went wrong, how you fixed it. No design philosophy, no lessons for the reader.",
  "No hype or LinkedIn phrases: game-changer, excited to announce, here's the thing, let's dive in, the best part.",
  "Stop when it's done. No wrap-up line, no question for engagement, no call to action unless the format asks for one.",
].join("\n");

// Core voice and length first, then the writing guide and the older extra rules (for detail); the core voice wins on conflict (especially length and paragraph count).
export const voiceBlock = (guide = WRITING_GUIDE, lang) => `CORE VOICE (most important; if anything below conflicts with it, this applies, especially for length):\n${VOICE_CORE}${lang === "en" || lang === "tr+en" ? `\n\nThe same voice for English text (${lang === "en" ? "this account is English" : "the English half of the bilingual text"}):\n${VOICE_CORE_EN}` : ""}\n\nLENGTH:\n${LENGTH}${VOICE_SAMPLES.length ? `\n\nSamples from the user's own writing (take the tone, do not copy the sentences):\n${VOICE_SAMPLES.map((x) => `"""${x}"""`).join("\n")}` : ""}\n\nDetailed guide (where it conflicts with the core voice, e.g. "3-4 paragraphs", the core voice applies):\n"""\n${guide}\n"""\n\nOlder extra rules (same):\n${VOICE}`;
