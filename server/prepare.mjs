// A job prepared by the assistant: `claude -p` runs with the task's instruction and the output is written under the task (Run).
// Runs when the user presses "Prepare" in the app (POST /api/prepare) or with `pg prepare <id>`.
// server/schedule.mjs calls it too when the time comes.
// For an automation on a social account (shared/social.mjs) there are three steps: write (structured JSON) → check against the rules → make the visual/video.
import { MEDIA_DIR, read, update, id } from "./store.mjs";
import { setChat } from "../shared/rou.mjs";
import { runClaude } from "./claude.mjs";
import { findMedia } from "./findmedia.mjs";
import { designLow, gate } from "./quality.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pushVersion } from "../shared/versions.mjs";
import { addNotice } from "../shared/notices.mjs";
import { linkTweet } from "./xquote.mjs";
import { SHARE_DIR } from "./paths.mjs";
import { CLARITY_V, setBrief, rawWish, rawRule, addRevision, alwaysMedia, banHits, mediaRequired, visualRules, saveRule, lessonsBlock, pastLessons, carrySource, clarifyPrompt, parseClarity, missingMediaNote, movePost, noMediaNote, parseMissed, quoteNote, redoScope, redoTask, reviseBlock, revisionFiles, revisionMode, revisionsOf, splitGaps, visualNote } from "../shared/revise.mjs";
import { renderPost, renderStills } from "./render.mjs";
import { attachMedia, fileOfKey, probe, timeline } from "./library.mjs";
import { DATA_DIR } from "./store.mjs";
import { prepareBrowse } from "./browse.mjs";
import { MEDIA_RULE, pullMedia } from "./postmedia.mjs";
import { stepsOf, stepText } from "../shared/repeat.mjs";
import { STORYBOARD_SCHEMA, kindsText, normalizeStoryboard, scriptOf } from "../shared/storyboard.mjs";
import { outputOf } from "../shared/stages.mjs";
import { LENGTH, VOICE_CORE, VOICE_CORE_EN, voiceBlock } from "../shared/voice.mjs";
import { guideOf } from "../shared/guide.mjs";
import { seriesColor, seriesRule } from "../shared/series.mjs";
import { FORMATS, HOOK_SEC, SCHEMA, rulesOf, langRule, accountOf, attachOf, bodyOf, canAttach, formatOf, isVideo, needsImage, normalize, platformName, problems, taskRef, pickAccount, formatsOf, platformOfFormat, PLATFORM_LABEL, postOfText, brandExample } from "../shared/social.mjs";
import { FFMPEG, FFPROBE } from "../shared/platform.mjs";

const LIMIT_MS = 4 * 60 * 1000; // stopped after 4 min if stuck
const running = new Map(); // taskId → AbortController
// Checked before the server restarts (GET /api/busy): restarting while a prepare runs would cut it off.
const MISS = /^\s*(?:TOPIC MISMATCH|KONU UYMADI)\s*:\s*([^\n]*)\n*/i;
// Strips the "TOPIC MISMATCH: <reason>" line (old marker: KONU UYMADI) from the output texts; returns the reason ("" if none).
export function stripTopicMiss(r) {
  let why = "";
  const cut = (t) => (typeof t === "string" && MISS.test(t) ? (why ||= t.match(MISS)[1].trim(), t.replace(MISS, "")) : t);
  if (r?.post) {
    for (const k of ["text", "caption", "hook"]) if (r.post[k] != null) r.post[k] = cut(r.post[k]);
    if (Array.isArray(r.post.tweets)) r.post.tweets = r.post.tweets.map(cut);
  }
  if (r) r.body = cut(r.body);
  return why.slice(0, 300);
}
export const activeJobs = () => [...running.keys()];
// Stuck-prepare watchdog: a job over STUCK_MS is stopped and its output becomes
// "failed"; the scheduler (server/schedule.mjs retryable) retries it by itself after 20 min.
const startedAt = new Map(); // taskId → start (ms)
export const STUCK_MS = 60 * 60 * 1000;
export function stopStuck(now = Date.now()) {
  const stuck = [...startedAt].filter(([k, t]) => now - t > STUCK_MS && running.has(k)).map(([k]) => k);
  for (const k of stuck) { running.get(k)?.abort(); running.delete(k); startedAt.delete(k); }
  for (const k of [...startedAt.keys()]) if (!running.has(k)) startedAt.delete(k);
  if (stuck.length) update((st) => { for (const r of st.runs) if (stuck.includes(r.taskId) && r.status === "working") Object.assign(r, { status: "failed", phase: undefined, queued: undefined, at: new Date().toISOString(), renderError: "Did not finish in 60 minutes; Rou will retry by itself in 20 minutes." }); });
  return stuck;
}

const NO_DASH = "Do not use the long dash (—). Do not invent numbers, names or events you do not know.";

// The project's sources (those with use = true): style guide, notes, links. Length is capped.
const SRC_MAX = 9000;
const SRC_TOTAL = 24000;
export function sourcesText(p) {
  let left = SRC_TOTAL;
  return (p?.sources ?? []).filter((x) => x.use !== false && left > 0).map((x) => {
    const body = String(x.body ?? "").slice(0, Math.min(SRC_MAX, left));
    left -= body.length;
    return [`### ${x.title}${x.url ? ` (${x.url})` : ""}`, body].filter(Boolean).join("\n");
  }).join("\n\n");
}
const sourcesBlock = (p) => {
  const t = sourcesText(p);
  return t ? `The project's notes (guide and information; if there is a style guide, follow it to the letter, take the facts from here, do not invent what is not here. Link contents were not opened, only the address and note are given):\n"""\n${t}\n"""` : "";
};

// Files marked Good in the project's Media (server/library.mjs): whichever recording a post uses is picked from here.
// Each row: name, orientation, length and (if any) what is visible in it (project.mediaNotes).
const goodMedia = (p) => Object.entries(p?.media ?? {}).filter(([, v]) => v === "good").map(([k]) => k).slice(0, 80);
const mediaBlock = (p) => {
  const good = goodMedia(p);
  if (!good.length) return "";
  const rows = good.map((k) => {
    const f = fileOfKey(p.id, k);
    const m = f && probe(f);
    if (!m) return null;
    const shape = m.h > m.w * 1.1 ? "vertical" : "horizontal";
    const note = p.mediaNotes?.[k];
    return `- ${k} · ${m.kind === "video" ? `video, ${shape}, ${Math.round(m.dur)} s` : `image, ${shape}`}${note ? ` · ${note}` : ""}`;
  }).filter(Boolean);
  return rows.length ? `Media you can use (recordings the user marked Good; write the name exactly, do not invent another name):\n${rows.join("\n")}` : "";
};
const hasMedia = (p) => goodMedia(p).length > 0 || !!p?.kit?.assets?.length;
// Scenes without a recording: the project's objects (project.kit).
const kitBlock = (p) => {
  const k = p?.kit;
  if (!k) return "";
  return [
    k.assets?.length ? `Objects (asset, name exactly):\n${k.assets.map((a) => `- ${a.name}: ${a.note}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
};

// Visual rules for footage posts: every scene/slide shows a real recording, and the text says what is visible in it.
const VISUAL_RULES = [
  "The goal is not real footage, it is the best possible version of this idea. First pick the idea (POV, comparison, tip, list, funny moment, revealed result), then the strongest visual for each scene: clip (a product, app or scene recording) or asset (a card introducing the object). If neither exists, the scene is only a card with big text.",
  "When picking a screen, do not pick a frame with a window opened on top, a tutorial box, a promo popup or a dialog with a dark overlay; pick the frame that shows the feature on the screen itself.",
  "If you pick a clip, from: the second of the recording to start at (must not exceed the video length). For a slide, the image field comes from the media list.",
  "Edit: hook, build-up, peak (the strongest footage goes there), and a tie at the end that loops back to the start. At most two text-card scenes; alternate them with recordings for rhythm.",
  "The text describes what is on screen: what is happening in the product/app at that moment, why it matters. No abstract feeling sentences, be concrete.",
  "hook: the headline on top of recorded scenes (not shown on punch cards), at most 7 words; a concrete claim or a curiosity question. Do not write a small top label, an account name or a category.",
  "Do not use the same recording in two scenes. If a recording has promo text burned in, do not pick it. The app's own interface text is fine, but your scene text must not contradict what is on screen at that moment.",
];

// Revision: the user gave a note on the earlier output; the new output is corrected according to it (task.revise, written in prepare).
// The predetermined topic of this run: the instruction is the general direction, the topic is this post itself.
// The title and the content tell the same thing. A revision comes before the topic.
const topicBlock = (task) => task.topic?.title ? `${revisionsOf(task).length ? "This post's originally planned topic is below. If the user changed the topic or the content in the revision notes, follow the NOTE, not this topic; the topic will be updated from the new text after the revision.\n" : ""}This post's topic (planned in advance${revisionsOf(task).length ? "" : ", stay true to it"}): ${task.topic.title}${task.topic.brief ? `\nWhat it will tell: ${task.topic.brief}` : ""}${task.topic.source ? `\nReal work to show (a recording of it will be attached to the post): ${task.topic.source}. The text must describe only what is really visible there; do not write an event, experiment or decision story that is not there.` : ""}\nChoose the content according to this title: find in the source what the title promises (e.g. for "the biggest investment", the biggest investment with a disclosed amount). If the source has nothing that fits the title, do not force the title; write the closest real content and say "TOPIC MISMATCH: <reason>" on the first line.` : "";
// reviseBlock: shared/revise.mjs (all revision notes, the latest emphasised; what could not be done comes back as an UNABLE line).

function context(s, task) {
  const auto = task.autoId ? s.automations.find((a) => a.id === task.autoId) : undefined;
  const w = s.worlds.find((x) => x.id === task.worldId);
  const p = task.projectId ? s.projects.find((x) => x.id === task.projectId) : undefined;
  return { auto, w, p };
}

const isPost = (task, auto) => !!task.post || !!(auto && (auto.platforms?.length || stepsOf(auto).some((x) => x.kind === "post")));
function plainPrompt(s, task) {
  const { auto, w, p } = context(s, task);
  const past = s.runs.filter((r) => r.status === "approved" && r.taskId && s.tasks.find((t) => t.id === r.taskId)?.autoId === task.autoId && task.autoId).slice(0, 3);
  return [
    "You are preparing a job for the user's planner, Playgrounds. Your output will be shown to the user for approval directly in the app.",
    `World: ${w?.name ?? task.worldId}${p ? ` · Project: ${p.name}${p.description ? ` (${p.description})` : ""}` : ""}`,
    sourcesBlock(p),
    mediaBlock(p),
    reviseBlock(task),
    laterSteps(s, task),
    `Task: ${task.title}`,
    auto?.action || task.notes ? `Instruction: ${auto?.action || task.notes}` : "",
    topicBlock(task),
    task.post ? `This is a social media post${platformOfFormat(task.post.format) ? ` (${PLATFORM_LABEL[platformOfFormat(task.post.format)]})` : ""}; no account is linked, the user will share it by hand. Write the text to be shared directly.${task.post.brief ? `\nWhat it will tell: ${task.post.brief}` : ""}` : "",
    task.post ? voiceBlock(guideOf(read().state)) : "",
    auto?.steps?.length ? `This automation's steps (you do only the ones marked Claude; prepare your output to suit the others, e.g. write it in the format of the place it will be shared):\n${stepsOf(auto).map((x, i) => `${i + 1}. ${stepText(x)}${x.note ? ` (${x.note})` : ""}${x.tool === "claude" ? " ← you" : ""}`).join("\n")}` : "",
    auto && (auto.platforms?.length || stepsOf(auto).some((x) => x.kind === "post")) ? voiceBlock(guideOf(read().state)) : "",
    isPost(task, auto) ? MEDIA_RULE : "",
    past.length ? `Outputs approved before (do not repeat them, keep their tone):\n${past.map((r) => `- ${r.body.slice(0, 400)}`).join("\n")}` : "",
    `Rules: Write only the requested output, add no explanation before or after it. ${NO_DASH}`,
  ].filter(Boolean).join("\n\n");
}

// Voiced video (a.voice === "me"): Rou writes the script scene by scene; each scene's visual shows what is said.
function videoPrompt(s, task) {
  return [
    plainPrompt(s, task),
    `This is the script of a vertical Reels video. The user will read each scene's "say" sentence in their own voice; the video will show each scene at the moment that sentence is spoken. Your output must be only this JSON (no explanation, no code block):\n${STORYBOARD_SCHEMA}`,
    `Visual kinds (visual.kind is only one of these; use the fields exactly):\n${kindsText()}`,
    [
      "Rules:",
      "- 5 to 8 scenes. 25-35 s of speech in total (about 70-95 words). The first scene is a 0-2 s hook.",
      "- One idea per scene. The visual must show what is said in that scene: if a before/after is told, give its measurements with card/type/color/motion; if a rule is stated, rule; if a page is mentioned, screen (real address).",
      "- Do not use the same kind more than twice in a row; at most one title scene (the hook or the final takeaway).",
      "- text: at most 8 words that stay on screen; it must not repeat say, it should sum it up.",
      "- Numbers only when real and as measurements (px, ms, ratio). Write things like a star count as you saw them on the page, do not write them if you did not see them.",
      "- say: everyday, short sentences; easy to read aloud; terms may stay in English.",
    ].join("\n"),
  ].join("\n\n");
}
async function prepareVideo(s, task, signal) {
  const r = await runClaude(videoPrompt(s, task), LIMIT_MS, signal, { args: ["--allowedTools", "WebSearch,WebFetch,Read", "--add-dir", MEDIA_DIR] });
  if (!r.ok) return r;
  const m = r.out.match(/\{[\s\S]*\}/);
  let sb = null;
  try { sb = m && normalizeStoryboard(JSON.parse(m[0])); } catch { /* handled below */ }
  if (!sb) return { ok: false, error: "Could not read the script (broken JSON). Prepare it again." };
  return { ok: true, body: scriptOf(sb), storyboard: sb };
}

// The account's earlier posts: approved ones as style examples, recent topics so they are not repeated.
function history(s, acc) {
  const mine = s.runs.filter((r) => {
    const t = r.post && s.tasks.find((x) => x.id === r.taskId);
    return t && accountOf(s, taskRef(s, t))?.id === acc.id;
  }).sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  const good = mine.filter((r) => r.status !== "trashed" && (r.status === "approved" || r.status === "posted"));
  return {
    approved: good.slice(0, 3).map((r) => r.body.slice(0, 900)),
    recent: mine.slice(0, 10).map((r) => (r.body.split("\n").find((l) => l.trim()) ?? "").slice(0, 140)).filter(Boolean),
  };
}

// The project's brand frame: audience, content pillars, phrases to use and to avoid.
export function brandBlock(p) {
  const b = p?.brand;
  if (!b) return "";
  const lines = [
    b.audience && `Audience: ${b.audience}`,
    b.pillars?.length && `Content pillars (every post fits one): ${b.pillars.join(", ")}`,
    b.use && `Use: ${b.use}`,
    b.avoid && `Never use: ${b.avoid}`,
  ].filter(Boolean);
  return lines.length ? `Brand:\n${lines.join("\n")}` : "";
}

export function accountBlock(acc) {
  const p = acc.project;
  return [
    `Account: ${platformName(acc)} · ${acc.name || p?.name || acc.world?.name || ""}${acc.handle ? ` (${acc.handle})` : ""}`,
    p ? `Project: ${p.name}` : "",
    p?.description ? `About the project: ${p.description}` : "",
    acc.voice ? `The account's style (short note):\n${acc.voice}` : "",
    brandBlock(p),
    sourcesBlock(p),
    mediaBlock(p),
    kitBlock(p),
  ].filter(Boolean).join("\n\n");
}

export function socialPrompt(s, task, acc, format) {
  const { auto } = context(s, task);
  const h = history(s, acc);
  return [
    `You are preparing a ${FORMATS[format].label} for the user. The post will be previewed in the app as it will really look and shown for the user's approval.`,
    accountBlock(acc),
    task.post ? `This post's topic: ${task.title}\nWhat it will tell: ${task.post.brief || task.notes || task.title}${task.post.brief && task.notes ? `\nInstruction and information: ${task.notes}` : ""}${task.post.pillar ? `\nContent pillar: ${task.post.pillar}` : ""}` : `This automation's instruction: ${auto?.action || task.notes || task.title}`,
    task.post ? "" : topicBlock(task),
    seriesRule(seriesColor(s, task)),
    `Format rules (${FORMATS[format].label}):\n${rulesOf(format, acc).map((r) => `- ${r}`).join("\n")}`,
    langRule(acc, format),
    (format === "ig_post" || isVideo(format)) && hasMedia(acc.project) ? `Visual rules:\n${VISUAL_RULES.map((r) => `- ${r}`).join("\n")}` : "",
    voiceBlock(guideOf(read().state), acc?.lang),
    reviseBlock(task),
    revisionsOf(task).length ? "" : lessonsBlock(pastLessons(s, task)),
    laterSteps(s, task, acc, format),
    "Priority: revision note > account style > writing voice > instruction > format rules. Format rules are only about length and layout; if they contradict the style, the style wins.",
    brandExample(acc.project?.brand) ? `A sample text the user approved (this is the account's target voice and structure; take the sentence construction, use of person and paragraph layout from it, do not copy the content):\n"""\n${brandExample(acc.project.brand)}\n"""` : "",
    h.approved.length && !brandExample(acc.project?.brand) ? `Posts approved on this account (take the tone from them, do not repeat the content):\n${h.approved.map((b) => `"""\n${b}\n"""`).join("\n")}` : "",
    h.recent.length ? `First lines of the recent posts (do not repeat the same topic or the same opening):\n${h.recent.map((b) => `- ${b}`).join("\n")}` : "",
    `Rules: ${NO_DASH} Do not add information about the account or project that was not given (numbers, customers, results, dates); if unsure, write it general but honest.`,
    `Your output must be ONLY a single JSON object like this, write nothing else:\n${SCHEMA[format]}`,
  ].filter(Boolean).join("\n\n");
}

// Revision round: instead of rewriting, the earlier output is edited according to the note (one pass; no check round, it used to
// "improve" away the words the user asked for). If the note has the user's own sentences, the text is built from them.
// found: what Rou learned from the work itself before writing, and the real files it attached to the post (server/findmedia.mjs).
export const foundBlock = (found) => !found ? "" : [
  found.facts?.length ? `FACTS OF THE WORK (Rou read the project itself before writing; the text rests on these, build the telling the note asks for from here, do not invent information beyond them):\n${found.facts.map((x) => `- ${x}`).join("\n")}` : "",
  found.note ? `REAL VISUALS ATTACHED TO THE POST (the text must fit what is visible in them; do not describe something that is not visible as if it were in the visual): ${found.from}. ${found.note}` : "",
  found.fix ? `The old text contradicted the real work, fix it: ${found.fix}` : "",
].filter(Boolean).join("\n\n");
function editPrompt(s, task, acc, format, prevPost, found) {
  return [
    `The user gave a revision note on the ${FORMATS[format].label} draft. You are not rewriting the draft: you do what the note asks and do not touch what it does not ask about.`,
    reviseBlock(task).replace(/Last output \(fix this\):[\s\S]*?"""\n[\s\S]*?\n"""/, ""),
    `Draft to edit (JSON):\n${JSON.stringify(prevPost)}`,
    foundBlock(found),
    [
      "How to edit:",
      "- The latest note is the most important; apply it to the letter first, then check whether it contradicts the older notes (if it does, the newer wins).",
      "- Sentences dictated in the note are usually a direction, not verbatim text (the user may have dictated the note by voice). Take the content and the order, write it as a proper, full text; do not leave shallow, word-for-word short sentences. Only if the user said \"use this text\" or gave a ready text in quotes, base it on that and keep its words.",
      "- Each main idea (e.g. each company, each step) in its own short paragraph; a blank line between paragraphs. No line break after every sentence.",
      "- Remove completely anything the note says \"don't say X, unnecessary\" about; do not put something similar in its place.",
      "- Sentences the note does not mention stay exactly as they are. If told to shorten, shorten, do not lengthen. If the note wants the work told better or deeper, you do not have to keep the old sentences: rebuild the telling from the FACTS OF THE WORK.",
      "- If the planned topic or brief contradicts the revision notes, the notes stand; do not go back to the old topic.",
      "- If the text is bilingual (Turkish, `· · ·`, English), rebuild the English from the final Turkish so it does not read like a translation.",
    ].join("\n"),
    accountBlock(acc),
    langRule(acc, format),
    `Writing voice (wherever you touch the text):\n${VOICE_CORE}${acc?.lang === "en" || acc?.lang === "tr+en" ? `\n${VOICE_CORE_EN}` : ""}\nLength:\n${LENGTH}`,
    `Rules: ${NO_DASH} Do not add information that was not given.`,
    `Write ONLY JSON (same schema):\n${SCHEMA[format]}`,
  ].filter(Boolean).join("\n\n");
}

function checkPrompt(acc, format, post, issues, task) {
  return [
    `You are checking a ${FORMATS[format].label} draft before it is published. Your job: fix the places that break the rules, do not spoil what is good.`,
    // Revision notes here too: so the check does not undo a revision Rou applied in the name of a format rule.
    task ? reviseBlock(task).replace(/If you cannot do a request in this output[\s\S]*$/, "Do not undo these revisions; if the draft applies them, keep them.") : "",
    accountBlock(acc),
    `Format rules:\n${rulesOf(format, acc).map((r) => `- ${r}`).join("\n")}`,
    voiceBlock(guideOf(read().state), acc?.lang),
    langRule(acc, format),
    `Check: does it follow the language rule; is there a line break after every sentence (if so, merge the sentences into flowing paragraphs of 2 to 4 sentences); are there sentences that do not fit the writing voice or sound artificial; are there banned phrases and patterns from the style guide; are there sentences that sound artificial, like an ad or "like a LinkedIn post"; is there invented information; do the lengths follow the rule; does the language read naturally, are spelling and punctuation correct; is there a long dash (—).`,
    issues.length ? `Measured problems (fix for sure):\n${issues.map((x) => `- ${x}`).join("\n")}` : "",
    `Draft:\n${JSON.stringify(post)}`,
    `Give the corrected version in the same schema (unchanged if there is no problem). Write ONLY JSON:\n${SCHEMA[format]}`,
  ].filter(Boolean).join("\n\n");
}

// Attachment of a text post: a single image (1-slide ig_post template) or a vertical video (short scenes). It carries the same idea as the text.
// Visual rule: the automation's own lines + the world's permanent visual rules (world.visual; e.g. all of a world's posts).
const autoVisual = (task) => visualRules(read().state, task);

function attachPrompt(acc, post, kind, task) {
  return [
    // Revision notes apply to the image and video too (e.g. "show the sub-brands in the visual"), not only to the text.
    task ? reviseBlock(task).replace(/If you cannot do a request in this output[\s\S]*$/, "Apply the notes' visual and video requests in this attachment; the text already applied the ones about the text.") : "",
    `You are preparing ${kind === "video" ? "a short vertical video" : "a single image"} for the user's ${FORMATS[post.format]?.label ?? "post"}. The post's text:\n"""\n${bodyOf(post)}\n"""`,
    accountBlock(acc),
    acc.about ? `This text is about: ${acc.about}. The project information, recordings and objects above belong to this project. The visual shows this project: a real frame of the product (image in the slide) or a cover with its objects whose subject is clear at first glance. No plain ground with only text. ${acc.platform === "other" ? "The text is short." : "The text is short and carries the project's name."}` : "",
    kind === "video"
      ? `The video is told with on-screen text (no sound), 12 to 25 seconds. hook: at most 7 words. scenes: 3 to 5 scenes, each with one short sentence (at most 10 words) and its duration (sec, 2 to 5). It does not summarise the text, it shows the core of the idea. Leave caption and hashtags empty.`
      : acc.platform === "other" ? `A single image: the 16:9 cover of the article on the site (logo, title and short text on the left, a visual on the right). title at most 32 characters (spaces included; fits two lines on the cover), a strong title that says what the article is about; the logo already shows the project's name, so the title does not repeat the name (e.g. it does not start with "ProjectName: ..."); text is a single sentence of at most 75 characters (two lines) or empty. Leave caption and hashtags empty.`
      : `A single slide: title at most 8 words, a strong sentence carrying the core of the text; text at most 1 short sentence or empty. The visual is made from this text. Leave caption and hashtags empty.`,
    kind !== "video" && acc.lang === "tr+en" ? "Write two slides: the first in Turkish, the second the same visual in English (same idea, same length; it must not read like a translation). The post is shared in two languages, each language gets its own visual."
      : acc.lang === "tr+en" || acc.lang === "en" ? "Text in the visual/video is in English." : "Text in the visual/video is in Turkish.",
    hasMedia(acc.project) ? `Visual rules:\n${VISUAL_RULES.map((r) => `- ${r}`).join("\n")}` : "",
    hasMedia(acc.project) ? "Put a good frame of the product on the screen card (image in the slide): the product really in use, the main action visible, the interface readable. Do not pick a menu, loading or empty screen; do not pick a frame with a window opened on top, a tutorial or promo box (popup, dialog with a dark overlay) either. If you pick from a video, give the from second the fullest moment of the action; if there is a screenshot, pick the one that tells the most." : "",
    autoVisual(task) ? `The user's permanent visual rules for this automation (from earlier revisions; follow them in every visual):\n${autoVisual(task)}` : "",
    seriesRule(seriesColor(read().state, task)),
    `Rules: ${NO_DASH} Do not add information that is not in the text. The writing voice is the same as the text: plain, not exaggerated.`,
    `Write ONLY JSON:\n${kind === "video" ? SCHEMA.short : SCHEMA.ig_post}`,
    'Think about using what you have: if project recordings, a logo (kit) or objects appear above, they are already there, do not ask for them as a need.',
    'Also add a "needs" field to the JSON: things that would make this visual clearly better but that you do not have (e.g. "logo (SVG/PNG)", "a real screenshot of the product", "a product photo"), at most 3 short items; an empty list if nothing is missing.',
  ].filter(Boolean).join("\n\n");
}

// Quality gate: before the full render, frames are taken, Rou looks at them and critiques them, and fixes the plan if needed (at most 2 rounds).
// The measure is "the best it should be": hook, visual-text fit, rhythm, peak, legibility.
const REVIEW_ROUNDS = 2;
const PASS = 8;
// Moments to look at (ms): the cover, the middle of each scene (after the caption appears in the first scene), the end.
function stillTimes(post) {
  const out = [300];
  let t = 0;
  post.scenes.forEach((x, i) => {
    const lead = i === 0 && post.hook ? HOOK_SEC : 0;
    out.push(Math.round((t + lead + x.sec * 0.55) * 1000));
    t += lead + x.sec;
  });
  out.push(Math.round((t + 1.2) * 1000));
  return out;
}
function reviewPrompt(acc, post, sheet, lines, format, task) {
  return [
    task ? reviseBlock(task).replace(/If you cannot do a request in this output[\s\S]*$/, "When critiquing, check whether these revisions were followed; if not, fix it, and do not undo what was followed.") : "",
    `You are critiquing a ${FORMATS[format]?.label ?? "post"} draft before it is published. The measure: real footage is not required, it must be the best it should be. Do not let something mediocre pass.`,
    `Look at this image with Read: ${sheet}\n${isVideo(format) ? "Left to right: the cover (0.3 s), then the middle of each scene in order, the end card on the far right." : "Left to right: the slides in order."}`,
    format === "ig_post" && post.slides?.length <= 2 ? `This is a post's attached visual: do not change the number of slides (${post.slides.length}) or each slide's language${post.slides.length === 2 ? " (the first in Turkish, the second in English)" : ""}; only improve the text and the visual.` : "",
        lines.length ? `Timelines of the recordings used (look with Read if needed; frames left to right, row by row, the first frame is 0 s):\n${lines.join("\n")}` : "",
    accountBlock(acc),
    langRule(acc, format),
    `Visual rules:\n${VISUAL_RULES.map((r) => `- ${r}`).join("\n")}`,
    [
      "Score (1-10, 8 = published as it is):",
      "- Does the cover stop the scroll on the first frame: the title is readable, the visual raises curiosity.",
      "- Does each scene's text match what is visible in that frame (e.g. it is a contradiction if the text says 'special power' while the screen shows 'BONKED'). On a contradiction, take from to the right moment from the timeline or change the recording or object.",
      "- One read at a time; the text is short and big, not cut off, not overlapping.",
      "- Edit: hook, build-up, peak, a tie at the end that loops back to the start. Is there an empty, abstract or repeated scene.",
      "- Does it fit the project's look; is there invented information.",
    ].join("\n"),
    `Draft:\n${JSON.stringify(post)}`,
    `Write ONLY JSON: {"score": 1-10, "notes": ["short critique", ...], "post": the corrected draft in the same schema, or null if 8 or above}. Schema: ${SCHEMA[format]}`,
  ].filter(Boolean).join("\n\n");
}
async function polish(runId, s, task, acc, post, signal) {
  const pid = acc.project?.id;
  const format = post.format;
  if (!pid || !(format === "ig_post" || isVideo(format))) return { post };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pg-review-"));
  let review;
  try {
    for (let round = 1; round <= REVIEW_ROUNDS; round++) {
      setRun(runId, { phase: `Looking at the frames (round ${round})`, at: new Date().toISOString() });
      const st = await renderStills(runId, attachMedia(pid, post), renderAccount(s, task, acc), kitOf(s, acc, task), isVideo(format) ? stillTimes(post) : undefined, dir, signal);
      if (st.cancelled) return { cancelled: true };
      if (!st.ok) break;
      const sheet = path.join(dir, `sheet-${round}.jpg`);
      spawnSync(FFMPEG, ["-y", "-loglevel", "error", ...st.files.flatMap((f) => ["-i", f]), "-filter_complex", `${st.files.map((_, i) => `[${i}]scale=360:-2[v${i}]`).join(";")};${st.files.map((_, i) => `[v${i}]`).join("")}hstack=inputs=${st.files.length}`, "-q:v", "4", sheet]);
      if (!fs.existsSync(sheet)) break;
      const lines = (post.scenes ?? post.slides ?? []).map((x) => x.clip ?? x.image).filter(Boolean).map((k) => {
        const f = fileOfKey(pid, k);
        const tl = f && timeline(f);
        return tl ? `- ${k}: ${tl.file} (each frame ${tl.step} s)` : null;
      }).filter(Boolean);
      const r = await runClaude(reviewPrompt(acc, post, sheet, lines, format, task), LIMIT_MS, signal, { args: ["--allowedTools", "Read", "--add-dir", dir, "--add-dir", path.join(DATA_DIR, "thumbs")] });
      if (r.cancelled) return r;
      const j = r.ok ? json(r.out) : null;
      if (!j) break;
      const score = Math.max(1, Math.min(10, Number(j.score) || 0));
      review = { score, notes: (Array.isArray(j.notes) ? j.notes : []).map(String).slice(0, 8), rounds: round };
      const fixed = j.post && normalize(format, { ...j.post, caption: j.post.caption ?? post.caption, hashtags: j.post.hashtags ?? post.hashtags });
      if (score >= PASS || !fixed) break;
      post = fixed;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { post, review };
}

const json = (out) => {
  const m = out.match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
};
const setRun = (runId, p) => update((st) => { const r = st.runs.find((x) => x.id === runId); if (r) Object.assign(r, p); });

// Attachment of a text post: Rou writes the attachment's draft, checks it and produces it. Result: { attach, images, video?, review?, template? } or { renderError }.
// The LinkedIn image is 4:5, 1200x1500 (the 1080x1350 slide is scaled).
// If the text is about another project, the visual is made with that project's recordings and logo.
// Subject: the project named in the text's first line or in the task's topic that has visual material (not the account's own project).
// Does the latest revision note ask for an attachment: video > image. If a file was attached, go by that (those files already enter the output, no production needed).
// Steps that come after this text: so the writing step does not note them as "could not do" (the image/video is made in a separate step).
function laterSteps(s, task, acc, format) {
  const { auto } = context(s, task);
  const lines = [];
  if (wantsFootage(task)) lines.push("A plain gameplay cut without text will be added to the post (a real recording of the game; no title, caption or logo). Do not say in the text that the video has a title, text or logo; describe the game that is visible in the video.");
  if (format && canAttach(format) && (askedAttach(task) ?? attachOf(format, auto))) lines.push("An image or video will be produced in a separate step after this text and added to the post. Do not write the revision's image/video requests as UNABLE; write the text to suit that attachment.");
  return lines.length ? `Next steps:\n${lines.map((x) => `- ${x}`).join("\n")}` : "";
}
// If the revision asks for a "video of the site/page ...", the address to record: first the link in the notes, else the first link in the output text.
// If the revision asks for plain gameplay footage ("gameplay video", "game footage", "no text on the video"): no text video is built,
// a real gameplay recording marked Good in the project's Media is picked and added as a cut without text.
// Which video: the LATEST note that touches the video decides (a site link in an old note does not override a new "not a site video" note). Typos are recognised too ("oynais goruntusu").
// "not a site video" rules the site out. Result: "footage" | "site" | null.
const foldTr = (t) => String(t ?? "").toLocaleLowerCase("tr").replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u");
const PLAY = /oyn[a-z]{0,3}s|oynay|gameplay|oyun ?(ici|ic)? ?(gor|vid|kay)|ekran kayd|karakt|game ?(play|footage|video|recording|clip)|screen ?record|charact/;
const SITE = /site|sayfa|\bweb|https?:\/\/|\.(com|wtf|app|io|net)\b|splash|animasyon|\bpage|animation/;
const NOT_SITE = /(site|sayfa|web)[a-z]* ?(vid[a-z]*|vd[a-z]*|kayd[a-z]*)? ?(degil|olmasin|istemiyorum)|\b(not|no|dont want|do not want) (a |the )?(site|web ?site|page|web)\b|(site|web ?site|page) (video|recording )?(is ?n.?t|not|no)\b/;
// If a one-off post's brief asks for gameplay footage ("with real gameplay footage from inside the game"), a cut from the
// recording in Media is added on the first prepare too. Only gameplay is read from the brief, not a site recording.
export function videoWish(task) {
  const revs = revisionsOf(task);
  if (revs.some((x) => x.files?.length)) return null;
  for (const r of [...revs].reverse()) {
    const n = foldTr(r.note);
    const play = PLAY.test(n);
    const vid = /vid|vd[eo]|reels?\b|klip|clip|footage/.test(n) || play;
    if (!vid) continue;
    if (play || NOT_SITE.test(n)) return "footage";
    return SITE.test(n) ? "site" : null;
  }
  return PLAY.test(foldTr(task?.post?.brief)) ? "footage" : null;
}
export const wantsFootage = (task) => videoWish(task) === "footage";
export function footageOf(s, task, projectIds) {
  for (const pid of projectIds.filter(Boolean)) {
    const p = s.projects.find((x) => x.id === pid);
    const keys = Object.entries(p?.media ?? {}).filter(([k, v]) => v === "good" && /\.(mp4|mov|m4v|webm)$/i.test(k)).map(([k]) => k);
    const score = (k) => { const n = k.toLowerCase(); return (/gameplay|oynan/.test(n) ? 4 : 0) + (/play|level|record|screen|kayit/.test(n) ? 2 : 0) - (/scene|promo|veo|ad[_-]/.test(n) ? 3 : 0); };
    for (const k of keys.sort((a, b) => score(b) - score(a))) { const f = fileOfKey(pid, k); if (f && fs.existsSync(f)) return f; }
  }
  return null;
}
// If the revision asks for different characters or roles: a few seconds from the real recording of each of several recordings
// (the last part of the file name tells the role), one after another in a single video.
export function footageClips(s, task, projectIds, n = 4) {
  for (const pid of projectIds.filter(Boolean)) {
    const p = s.projects.find((x) => x.id === pid);
    const keys = Object.entries(p?.media ?? {}).filter(([k, v]) => v === "good" && /\.(mp4|mov|m4v|webm)$/i.test(k) && !/scene|promo|veo|ad[_-]/i.test(k)).map(([k]) => k);
    const seen = new Set(), out = [];
    for (const k of keys) {
      const role = (k.split(/[\\/:]/).at(-1) ?? k).replace(/\.[a-z0-9]+$/i, "").split(/[_-]/).at(-1).toLowerCase();
      const f = fileOfKey(pid, k);
      if (seen.has(role) || !f || !fs.existsSync(f)) continue;
      seen.add(role); out.push(f);
      if (out.length >= n) break;
    }
    if (out.length >= 2) return out;
  }
  return [];
}
export function montageFootage(files, out, each = 3.8) {
  const ins = files.flatMap((f) => ["-ss", "4", "-t", String(each), "-i", f]);
  // The recordings' own aspect ratio is kept (game recordings are horizontal 2340x1080): the first recording's ratio, at most 1920 wide.
  const m0 = probe(files[0]) ?? { w: 1920, h: 1080 };
  const W = Math.min(1920, m0.w) & ~1, H = Math.round((W * m0.h) / m0.w) & ~1;
  const chain = files.map((_, i) => `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[v${i}]`).join(";");
  const f = spawnSync(FFMPEG, ["-y", "-v", "error", ...ins, "-filter_complex", `${chain};${files.map((_, i) => `[v${i}]`).join("")}concat=n=${files.length}:v=1:a=0[o]`, "-map", "[o]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out], { encoding: "utf8" });
  if (f.status !== 0) throw new Error(f.stderr.slice(0, 160));
  return out;
}
// Picking a recording cut in a revision (so the same part of the same clip is not cut again). The timelines of the real recordings marked Good
// are shown to Rou, which picks a clip + start by the note's criterion; the previous pick is not repeated. { key, file, from, sec, why } | { error }.
export const noteSeconds = (note) => {
  const t = foldTr(note);
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(dk|dakika|min)/) ?? null;
  const s2 = t.match(/(\d+)\s*(sn|saniye|sec)/);
  const v = m ? Number(m[1].replace(",", ".")) * 60 : s2 ? Number(s2[1]) : 15;
  return Math.max(6, Math.min(90, Math.round(v)));
};
export async function pickFootage(s, task, projectIds, prev, signal) {
  const note = revisionsOf(task).at(-1)?.note ?? "";
  const sec = noteSeconds(note);
  const cands = [];
  for (const pid of projectIds.filter(Boolean)) {
    const p = s.projects.find((x) => x.id === pid);
    for (const [k, v] of Object.entries(p?.media ?? {})) {
      if (v !== "good" || !/\.(mp4|mov|m4v|webm)$/i.test(k) || /scene|promo|veo|ad[_-]/i.test(k)) continue;
      const f = fileOfKey(pid, k);
      const m = f && fs.existsSync(f) ? probe(f) : null;
      if (!m?.dur) continue;
      const tl = timeline(f);
      if (tl) cands.push({ key: k, file: f, dur: Math.floor(m.dur), tl });
    }
    if (cands.length) break;
  }
  if (!cands.length) return { error: "The project's Media has no gameplay recording marked Good" };
  const list = cands.slice(0, 12);
  const prompt = [
    "You are picking a single cut from the project's real recordings (gameplay, screen recording) for a post. The user's revision note is the criterion.",
    `Revision note: ${note}`,
    `Length of the cut: ${sec} s (the whole recording if it is shorter).`,
    prev ? `The cut used in the previous output (the user did not like it, DO NOT REPEAT): ${prev.key} @ ${prev.from ?? 0} s, ${prev.sec ?? 15} s.` : "",
    "Candidates (each one's timeline is a sheet of frames: left to right, top to bottom, each frame 'step' seconds apart). Open each sheet with Read and look:",
    list.map((c, i) => `${i + 1}. key: ${c.key} | length: ${c.dur} s | timeline: ${c.tl.file} (step ${c.tl.step} s)`).join("\n"),
    "Pick: the part that best fits what the note asks for, clearly played, not a menu/loading/empty screen. If a recording shows what the note calls bad (e.g. bots jumping randomly), do not pick it.",
    'Write ONLY JSON: {"key": "<the candidate\'s key value exactly>", "from": <start second>, "why": "<one sentence>"} or {"none": "<reason>"} if none fits',
  ].filter(Boolean).join("\n\n");
  const r = await runClaude(prompt, 4 * 60 * 1000, signal, { args: ["--allowedTools", "Read", "--add-dir", path.dirname(list[0].tl.file)] });
  if (r.cancelled) return { cancelled: true };
  const j = r.ok ? json(r.out) : null;
  if (!j) return { error: "Rou could not pick a cut" };
  if (j.none) return { error: `No suitable gameplay part: ${String(j.none).slice(0, 160)}` };
  const c = list.find((x) => x.key === j.key);
  if (!c) return { error: "Rou picked a recording that is not in the list" };
  const len = Math.min(sec, c.dur);
  const from = Math.max(0, Math.min(Number(j.from) || 0, c.dur - len));
  if (prev && prev.key === c.key && Math.abs((prev.from ?? 0) - from) < len / 2) return { error: "Rou picked the same part again; a new gameplay recording is needed (mark one Good in Media)" };
  return { key: c.key, file: c.file, from, sec: len, why: String(j.why ?? "").slice(0, 200) };
}

export function cutFootage(src, out, sec = 15, from = 0) {
  const f = spawnSync(FFMPEG, ["-y", "-v", "error", ...(from > 0 ? ["-ss", String(from)] : []), "-i", src, "-t", String(sec), "-vf", "scale='min(1080,iw)':-2", "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out], { encoding: "utf8" });
  if (f.status !== 0) throw new Error(f.stderr.slice(0, 160));
  return out;
}
export function siteVideoUrl(task, r) {
  const revs = revisionsOf(task);
  if (!revs.length || revs.some((x) => x.files?.length)) return null;
  const notes = revs.map((x) => x.note).join("\n");
  if (videoWish(task) !== "site") return null;
  const pick = (t) => (String(t ?? "").match(/https?:\/\/[^\s)"'<>]+/) ?? [])[0]?.replace(/[.,;]+$/, "");
  const text = r?.post ? JSON.stringify(r.post) : r?.body;
  return pick(notes) ?? pick(text) ?? null;
}
export function askedAttach(task) {
  const revs = revisionsOf(task);
  // If files were attached, they enter the output and nothing else is produced.
  if (!revs.length || revs.some((r) => r.files?.length)) return undefined;
  // If plain gameplay footage was asked for, no text video is built; a cut from the real recording in Media is added (wantsFootage).
  if (wantsFootage(task)) return undefined;
  // From the newest note backwards: the first note that touches the attachment decides (negatives like "no image" turn it off).
  // If a video of the site was asked for, no attachment is produced; the page recording (siteVideoUrl) gives the video.
  for (const r of [...revs].reverse()) {
    const n = r.note.toLocaleLowerCase("tr");
    const vid = /v[iı]d[eo]|reels?\b|kl[iı]p|oynan[iı][sş]|clip|gameplay|footage/.test(n);
    const img = /g[oö]rsel|ekran g[oö]r[uü]nt|screenshot|res[iı]m|foto[gğ]raf|kapak|[iı]mage|picture|photo|visual|cover|thumbnail/.test(n);
    if (!vid && !img) continue;
    if (/olmas[iı]n|olmayacak|istem[iı]yorum|ekleme\b|kald[iı]r|gerek yok|no need|don'?t (want|add|need)|do not (want|add|need)|without|remove|drop|no (image|video|visual|picture|photo|cover)|not needed/.test(n)) return undefined;
    if (vid && /s[iı]te|sayfa|web|splash|\bpage|https?:\/\//.test(n)) return undefined;
    if (vid && /oyna?n[iı]?[sş]|oynans|gameplay|oyun v[iı]d|oyun g[oö]r|ekran kayd|yaz[iı] olmas[iı]n|game ?(play|footage|video)|screen ?record|no text|without text/.test(n)) return undefined;
    return vid ? "video" : "image";
  }
  return undefined;
}
async function attachStep(runId, s, task, acc, post, kind, signal) {
  const out = {};
  setRun(runId, { phase: kind === "video" ? "Writing the video" : "Writing the image", at: new Date().toISOString() });
  const third = await runClaude(attachPrompt(acc, post, kind, task), LIMIT_MS, signal);
  if (third.cancelled) return third;
  const raw = third.ok ? json(third.out) : null;
  const needs = Array.isArray(raw?.needs) ? raw.needs.map((x) => String(x).trim().slice(0, 120)).filter(Boolean).slice(0, 3) : [];
  if (needs.length) out.needs = needs;
  let extra = raw ? normalize(kind === "video" ? "short" : "ig_post", raw) : null;
  // The cover of a site article (account type "Other": blog, admin panel) is drawn 16:9; sites show the cover on a horizontal card.
  const wide = kind !== "video" && acc.platform === "other";
  if (extra && wide) extra.wide = true;
  // On a bilingual account a pair of visuals (Turkish + English); a single visual otherwise.
  const pair = kind !== "video" && acc.lang === "tr+en";
  if (extra?.format === "ig_post") extra = { ...extra, slides: extra.slides.slice(0, pair ? 2 : 1), caption: "", hashtags: [] };
  // A card without a visual does not go to approval: if no slide has footage (screen, recording), Rou searches the computer for a real visual; if it finds none it asks.
  if (extra?.slides?.length && kind !== "video" && !attachMedia(acc.project?.id, extra).slides?.some((x) => x.media)) {
    const f = await realMedia(runId, task, post, out, signal);
    if (f?.cancelled) return f;
    if (f?.fail) return { ...out, renderError: f.fail, noVisual: true };
    return out;
  }
  if (extra) {
    const pol = await polish(runId, s, task, acc, extra, signal);
    if (pol.cancelled) return pol;
    // The quality round may rewrite the plan; the attachment stays a single visual (two for a pair: Turkish + English).
    // If the round did not keep both slides of a pair, the first plan is used (so the language order is not broken).
    const want = pair ? 2 : 1;
    if (pol.post?.format === "ig_post") extra = pair && pol.post.slides?.length !== 2 ? extra : { ...pol.post, slides: pol.post.slides.slice(0, want), caption: "", hashtags: [] };
    else extra = pol.post ?? extra;
    if (wide && extra) extra.wide = true;
    if (pol.review) out.review = pol.review;
  }
  if (!extra) return { ...out, renderError: `Could not write the ${kind === "video" ? "video" : "image"}` };
  out.attach = extra;
  setRun(runId, { phase: kind === "video" ? "Preparing the video" : "Preparing the image", at: new Date().toISOString() });
  const template = s.runs.find((r) => r.taskId === task.id && r.template)?.template;
  if (template) out.template = template;
  const scale = kind === "image" && needsImage(post.format) ? LI_SCALE : undefined;
  // For a pair each language is drawn as its own single visual: no counter and no "Swipe", two independent visuals.
  if (pair && extra.slides?.length === 2) {
    const images = [];
    for (const one of extra.slides) {
      const media = await renderPost(runId, attachMedia(acc.project?.id, { ...extra, slides: [one] }), renderAccount(s, task, acc), template, signal, kitOf(s, acc, task), scale);
      if (media.cancelled) return media;
      if (!media.ok) return Object.assign(out, { renderError: media.error });
      images.push(...(media.files.images ?? []));
    }
    return Object.assign(out, { images });
  }
  const media = await renderPost(runId, attachMedia(acc.project?.id, extra), renderAccount(s, task, acc), template, signal, kitOf(s, acc, task), scale);
  if (media.cancelled) return media;
  return Object.assign(out, media.ok ? media.files : { renderError: media.error });
}
const LI_SCALE = 1200 / 1080;

// Revision round (revisionMode): if only a visual was asked for the text stays as it is, if only text was asked for the earlier image/video is kept.
// The text is edited in one pass. If a visual was asked for, the attachment (or the post's own visuals) is produced again.
// If the last revision says "text only" or "no image", the post comes out without any. If it says "quote" or "video is missing", no new attachment is produced,
// the existing video/image is carried (from the task's newest output with an attachment if the previous output has none).
const MEDIA_KEYS = ["attach", "images", "video", "order", "asIs", "cover", "template"];
// The work's own visuals enter the feed as they are (rawWish): because an Instagram carousel crops to the first visual's ratio, each visual
// is fitted uncropped into a 4:5 (1080x1350) frame on the brand's plain ground; a video is put in the same frame if it is with images (carousel) or
// its ratio is one the feed does not accept (narrower than 4:5, wider than 1.91:1). No text, frame or logo is added. GIFs are left alone.
export function feedFrame(out, bg = "#ffffff") {
  const color = /^#[0-9a-f]{6}$/i.test(bg ?? "") ? `0x${bg.slice(1)}` : "0xffffff";
  const fit = "scale=1080:1350:force_original_aspect_ratio=decrease:flags=lanczos";
  const swap = (rel, args, ext) => {
    const src = path.join(DATA_DIR, rel), tmp = `${src}.feed.${ext}`;
    const f = spawnSync(FFMPEG, ["-y", "-v", "error", "-i", src, ...args, tmp], { encoding: "utf8" });
    if (f.status === 0 && fs.existsSync(tmp)) fs.renameSync(tmp, src); else fs.rmSync(tmp, { force: true });
  };
  for (const rel of out.images ?? []) {
    if (/\.gif$/i.test(rel)) continue;
    swap(rel, ["-filter_complex", `color=c=${color}:s=1080x1350[bg];[0:v]${fit}[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:format=auto`, "-frames:v", "1"], path.extname(rel).slice(1));
  }
  if (out.video) {
    const [w, h] = spawnSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path.join(DATA_DIR, out.video)], { encoding: "utf8" }).stdout.trim().split(",").map(Number);
    // In a carousel (image + video) Instagram crops all frames to the first frame's ratio: the video sits in the same 4:5 frame.
    const carousel = (out.images ?? []).length > 0 && Math.abs(w / h - 0.8) > 0.01;
    if (w && h && (carousel || w / h < 0.8 || w / h > 1.91)) swap(out.video, ["-vf", `${fit},pad=1080:1350:(ow-iw)/2:(oh-ih)/2:color=${color}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "copy"], "mp4");
  }
  return out;
}
// When an attachment is carried, what it shows is carried too (found.from/note): the step that reads the next note and the checker know what the files are.
const carry = (out, s, task, prev, runId) => { const src = carrySource(s.runs, task.id, prev, runId); if (src) { for (const k of MEDIA_KEYS) if (src[k]) out[k] = src[k]; if (src.found && !out.found?.note) out.found = { from: src.found.from, note: src.found.note, ...(out.found?.facts ? { facts: out.found.facts } : {}) }; } return out; };
async function reviseOnce(runId, s, task, acc, format, signal, { prev, scope: scope0, redo = false }) {
  // In a format that carries no visual (Threads, X text), a visual-only revision changes nothing: the note is applied to the text.
  let scope = scope0.text || canAttach(format) || format === "ig_post" || isVideo(format) ? scope0 : { ...scope0, text: true };
  const prevPost = normalize(format, prev.post ?? { format, text: prev.body }) ?? prev.post;
  let post = prevPost;
  let gaps = [];
  const mediaPost = format === "ig_post" || isVideo(format);
  // The work first, then the writing: before writing, Rou reads the work itself and finds the real visual (findmedia: facts + files); the text is written from them.
  // In the second round (redo), if only the text is missing it is not searched again: the first attempt's attachment and facts are carried.
  // On an Instagram or video post, if the note says "don't design, share the work itself" (rawWish), no template is drawn: Rou finds the work's real
  // animation and visuals and they become the output's attachment as they are.
  const raw = mediaPost && (rawWish(task) || (format === "ig_post" && rawRule(autoVisual(task)))) && !noMediaNote(task) && !revisionFiles(task).length && !(redo && !scope.visual);
  const newMedia = raw || (!(redo && !scope.visual) && !mediaPost && wantsReal(task, scope.visual) && !noMediaNote(task) && !(quoteNote(task) && ownSource(s, task, prev, runId)) && !revisionFiles(task).length && (redo || wantsNew(task) || !ownSource(s, task, prev, runId)));
  // The visual stays but the note wants the work told better (clear.need): only the work is read.
  const factsOnly = !newMedia && !redo && scope.text && needsFacts(task);
  const pre = {};
  if (newMedia || factsOnly) {
    const m = await realMedia(runId, task, prevPost ?? { format, text: prev.body }, pre, signal, { prev, factsOnly, redo, raw });
    if (m.cancelled) return m;
    // If the work could not be read, the revision does not stop: the text is written with the information at hand.
    if (m.fail && !factsOnly) return { ok: false, error: m.fail };
    if (raw) feedFrame(pre, kitOf(s, acc, task)?.bg?.[0]);
  }
  const found = pre.found ?? (redo ? prev.found : null);
  // If the real work found contradicts the old text, the text is rewritten too (even if the note only asked for a visual).
  if (pre.found?.fix && !scope.text) scope = { ...scope, text: true };
  if (scope.text || !prevPost) {
    setRun(runId, { phase: "Applying the revision" });
    const r = await runClaude(editPrompt(s, task, acc, format, prevPost ?? { format, text: prev.body }, found), LIMIT_MS, signal, { args: ["--allowedTools", "Read", "--add-dir", MEDIA_DIR] });
    if (r.cancelled) return r;
    if (!r.ok) return r;
    gaps = splitGaps(r.out).gaps;
    const j = json(r.out);
    // When the work is shared as it is (raw) slides are not drawn: Rou may write a slide with no text and a single file, and the schema rejects it.
    // The caption is taken, the rest of the old draft stays.
    post = normalize(format, j) ?? (raw && prevPost && typeof j?.caption === "string" && j.caption.trim() ? { ...prevPost, caption: j.caption.trim(), ...(Array.isArray(j.hashtags) ? { hashtags: j.hashtags.map(String) } : {}) } : null);
    if (!post) return { ok: false, error: `Could not read Claude's reply:\n${r.out.slice(0, 400)}` };
  }
  // fix was applied to the text this round: it is not kept in the output (so the second round does not read it as a "contradiction" again).
  const { fix: _fix, ...kept } = found ?? {};
  const out = { ok: true, post, body: bodyOf(post), revisedFrom: prev.id, ...(gaps.length ? { gaps } : {}), ...(found ? { found: kept } : {}) };
  if (noMediaNote(task) && !mediaPost) return out;
  // Rou found the real visual: it is the output's attachment.
  if (pre.images || pre.video) { if (pre.images) out.images = pre.images; if (pre.video) out.video = pre.video; if (pre.order) out.order = pre.order; if (raw) out.asIs = true; return out; }
  // The visual was not touched or the note only says the existing attachment went missing: the earlier attachment is carried as it is.
  if (!mediaPost && (!scope.visual || quoteNote(task) || (missingMediaNote(task) && carrySource(s.runs, task.id, prev, runId)))) return carry(out, s, task, prev, runId);
  const kind = wantsFootage(task) || (!mediaPost && wantsReal(task, scope.visual)) ? null : askedAttach(task) ?? attachOf(format, context(s, task).auto);
  if (kind && canAttach(format)) {
    setRun(runId, { post, body: out.body });
    const extra = await attachStep(runId, s, task, acc, post, kind, signal);
    if (extra.cancelled) return extra;
    Object.assign(out, extra);
  } else if (!mediaPost) {
    // If no new attachment is produced (e.g. a gameplay cut), the earlier one stays.
    carry(out, s, task, prev, runId);
  }
  if (mediaPost) {
    const pol = await polish(runId, s, task, acc, post, signal);
    if (pol.cancelled) return pol;
    if (pol.post !== post) Object.assign(out, { post: pol.post, body: bodyOf(pol.post) });
    post = pol.post;
    if (pol.review) out.review = pol.review;
    setRun(runId, { phase: isVideo(format) ? "Preparing the video" : "Preparing the images", at: new Date().toISOString(), post, body: out.body });
    const template = prev.template ?? s.runs.find((r) => r.taskId === task.id && r.template)?.template;
    if (template) out.template = template;
    const media = await renderPost(runId, attachMedia(acc.project?.id, post), renderAccount(s, task, acc), template, signal, kitOf(s, acc, task));
    if (media.cancelled) return media;
    Object.assign(out, media.ok ? media.files : { renderError: media.error });
  }
  return out;
}

// The revision asks for a visual but there is no attachment: Rou searches the computer for the real visual itself (server/findmedia.mjs). If it finds one, out.images;
// if it cannot be sure, its question becomes the output's error (shown on the card, answered with Request revision).
// An attachment Rou made with a template (run.attach: title card, text video) does not count as a "real visual"; when a revision
// asks for an image/video it is not carried, a real recording is searched for instead.
const ownSource = (s, task, prev, runId) => carrySource(s.runs.filter((r) => !r.attach), task.id, prev && !prev.attach ? prev : null, runId);
// If the clarified note wants a new attachment (media "new"), the existing one is not carried: a new one is searched from the real recording.
const wantsNew = (task) => task?.revisions?.at(-1)?.clear?.media === "new";
// If the clarified note lists things to learn from the work itself (clear.need): Rou reads the work before writing.
const needsFacts = (task) => !!task?.revisions?.at(-1)?.clear?.need?.length;
// If a permanent rule says "a visual on every post" (alwaysMedia), a real visual is searched for even if the revision does not ask; if the work has a real visual, it is carried.
const wantsReal = (task, visual = true) => mediaRequired(task) || alwaysMedia(autoVisual(task)) || (visual && !!askedAttach(task));
// A revision must be done in one go: EVERY revision output is checked against the note (text, image, video; the checker opens and looks at the files), the
// side that fell short is redone once more; if it is still missing, it is listed on the card under "Rou could not do these".
async function revised(runId, s, task, acc, format, signal, rv) {
  let out = await reviseOnce(runId, s, task, acc, format, signal, rv);
  if (!out.ok) return out;
  // The text is now written in the same round from the real work Rou found (reviseOnce); the second round is only for what the checker found missing.
  let missed = await revisionMissed(runId, task, out, rv.prev, format, signal);
  if (missed.length && !signal?.aborted) {
    setRun(runId, { phase: "Rou is completing what the revision missed", at: new Date().toISOString() });
    const first = { ...rv.prev, post: out.post, body: out.body, found: out.found };
    for (const k of MEDIA_KEYS) first[k] = out[k];
    const again = await reviseOnce(runId, s, redoTask(task, missed), acc, format, signal, { prev: first, scope: redoScope(missed), redo: true });
    if (again.cancelled) return again;
    // If the second round did not succeed (no visual found), the first attempt stays and the gaps show on the card.
    if (again.ok) {
      out = { ...again, revisedFrom: rv.prev.id, ...(again.found || !out.found ? {} : { found: out.found }) };
      missed = await revisionMissed(runId, task, out, rv.prev, format, signal);
    }
  }
  if (missed.length) out.missed = missed.map((m) => m.what);
  return out;
}
// Five frames of a moving file (video, GIF) in one image: the checker looks at it with Read.
function motionSheet(src, out) {
  const d = Number(spawnSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], { encoding: "utf8" }).stdout) || 0;
  if (!d) return null;
  spawnSync(FFMPEG, ["-y", "-loglevel", "error", "-i", src, "-vf", `fps=${(5 / d).toFixed(4)},scale=320:-2,tile=5x1`, "-frames:v", "1", out]);
  return fs.existsSync(out) ? out : null;
}
export function missedPrompt(task, out, prev, files, format) {
  const rv = revisionsOf(task).at(-1);
  const names = (r) => [r?.video, ...(r?.images ?? [])].filter(Boolean).map((f) => path.basename(f)).join(", ") || "none";
  // In an image or video post the text is inside the scenes: the draft itself is given.
  // In an output where the work itself is shared (asIs) slides are not drawn: the old slide titles are not given to the checker, only the caption.
  const draft = (r) => (r?.post && !canAttach(format) && !r.asIs ? JSON.stringify(r.post).slice(0, 3000) : String(r?.body ?? "").slice(0, 3000));
  return [
    "The user wrote a revision note on a social post's output and Rou prepared the output again. You are the checker: see whether everything the note asks for was done in the new output.",
    `Revision note: ${rv.note}`,
    rv.clear?.ask ? `Clarified request: ${rv.clear.ask}` : "",
    rv.clear?.keep?.length ? `To be kept: ${rv.clear.keep.join("; ")}` : "",
    `Previous output:\n"""\n${draft(prev)}\n"""\nFiles of the previous output: ${names(prev)}`,
    `New output:\n"""\n${draft(out)}\n"""`,
    files.length ? `Files of the new output (open each with Read and look; the frames of a moving file are left to right in a single image):\n${files.map((f) => `- ${f.name}: ${f.path}${f.motion ? " (video or GIF, its frames)" : ""}`).join("\n")}` : "The new output has no files.",
    out.found ? `Rou's note about the files: ${out.found.from}. ${out.found.note}` : "",
    out.gaps?.length ? `What Rou already said it could not do (do not list again): ${out.gaps.map((g) => g.ask).join("; ")}` : "",
    [
      "Rules:",
      "- Write only the concrete thing the note CLEARLY asks for that was not done or was done wrongly in the new output.",
      "- If the note asked for a change in the text and the text did not change that way, it is missing. If the note asked for an image, video, GIF or animation and there is no file, the file shows something other than what was asked, or motion was asked for and a still image came, it is missing.",
      "- If files are not in the list above, ignore them; do not guess from a file name, open and look.",
      "- Do not comment on taste, quality or style; do not ask for something that is not in the note. If unsure, do not list it.",
      '- part: "text" if the missing thing is in the writing (text, title, scene or slide text, link); "media" if it is in the image, the video or the attachment.',
    ].join("\n"),
    'Only JSON: {"missing": [{"what": "the missing thing, short, imperative", "part": "text|media"}]}. If everything was done, {"missing": []}.',
  ].filter(Boolean).join("\n\n");
}
// Requests in the revision that the output does not meet. A cheap model, only Read; on error it returns empty (it does not stop the job).
async function revisionMissed(runId, task, out, prev, format, signal) {
  if (!revisionsOf(task).length || signal?.aborted) return [];
  setRun(runId, { phase: "Rou is comparing the output with the revision note", at: new Date().toISOString() });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pg-missed-"));
  try {
    const files = [out.video, ...(out.images ?? [])].filter(Boolean).slice(0, 7).map((f, i) => {
      const abs = path.join(DATA_DIR, f), motion = /\.(mp4|mov|webm|gif)$/i.test(f);
      return { name: path.basename(f), motion, path: motion ? motionSheet(abs, path.join(tmp, `m${i}.jpg`)) : abs };
    }).filter((f) => f.path && fs.existsSync(f.path));
    const r = await runClaude(missedPrompt(task, out, prev, files, format), 4 * 60 * 1000, signal, { tier: "mid", args: ["--allowedTools", "Read", "--add-dir", MEDIA_DIR, "--add-dir", tmp] });
    return r.ok ? parseMissed(r.out) : [];
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
async function realMedia(runId, task, post, out, signal, opt = {}) {
  setRun(runId, { phase: opt.factsOnly ? "Rou is reading the work itself" : opt.prev ? "Rou is reading the work and looking for the real visual" : "Rou is looking for a visual on the computer", at: new Date().toISOString(), ...(out.body ? { post, body: out.body } : {}) });
  const f = await findMedia(runId, task, post, signal, read().state, opt);
  if (f.cancelled) return f;
  if (f.files) { if (f.files.length) out.images = f.files; if (f.video) out.video = f.video; if (f.order) out.order = f.order; out.found = { from: f.from, note: f.note, ...(f.facts?.length ? { facts: f.facts } : {}), ...(f.fix ? { fix: f.fix } : {}) }; return { done: true }; }
  if (f.ask) return { fail: `Rou asks: ${f.ask}${f.options?.length ? ` What I found: ${f.options.join("; ")}.` : ""} Write your answer as a revision note.` };
  // A timeout or a crash is temporary: nothing is asked of you, the scheduler retries after 20 minutes.
  if (f.transient) return { transient: true, fail: `${f.error}. Rou will retry by itself in 20 minutes.` };
  return { fail: `${f.error}. Attach the recording or image to the revision as a file; Rou does not make a template visual.` };
}
const textOnly = (format) => !(format === "ig_post" || isVideo(format));
async function social(runId, s, task, acc, format, signal) {
  const rv = revisionMode(s, task, runId);
  if (rv) return revised(runId, s, task, acc, format, signal, rv);
  let post, gaps = [];
  // The work itself in the first draft too: if the automation's permanent rule wants no extra design in the carousel (rawRule), no template card is drawn.
  // Rou first reads the work and finds the real files (the bento cover included), and the caption is written from them. If no real work is found,
  // the task does not stop: it is prepared the old template way and the gap is written on the card.
  const pre = {};
  let rawFail = "";
  if (format === "ig_post" && rawRule(autoVisual(task)) && !noMediaNote(task) && !revisionFiles(task).length) {
    const m = await realMedia(runId, task, { format, text: "" }, pre, signal, { raw: true });
    if (m.cancelled) return m;
    if (m.transient) return { ok: false, error: m.fail };
    if (m.fail) rawFail = m.fail;
    else feedFrame(pre, kitOf(s, acc, task)?.bg?.[0]);
  }
  const rawDone = !!(pre.images || pre.video);
  const brief = (prompt) => (pre.found ? `${prompt}\n\n${foundBlock(pre.found)}` : prompt);
  setRun(runId, { phase: "Writing" });
  // The topic may rest on a source (e.g. example.com/llms.txt): the first write may look at the web; the second round only checks what was written.
  const first = await runClaude(brief(socialPrompt(s, task, acc, format)), LIMIT_MS, signal, { args: ["--allowedTools", "WebSearch,WebFetch,Read", "--add-dir", MEDIA_DIR] });
  if (!first.ok) return first;
  gaps = splitGaps(first.out).gaps;
  post = normalize(format, json(first.out));
  if (!post) return { ok: false, error: `Could not read Claude's reply:\n${first.out.slice(0, 400)}` };
  if (signal.aborted) return { cancelled: true };
  // Check pass: if it fails, the first draft stays.
  setRun(runId, { phase: "Checking", at: new Date().toISOString() });
  const second = await runClaude(checkPrompt(acc, format, post, problems(post, acc), task), LIMIT_MS, signal);
  if (second.cancelled) return second;
  const fixed = second.ok ? normalize(format, json(second.out)) : null;
  if (fixed) post = fixed;
  const out = { ok: true, post, body: bodyOf(post), ...(gaps.length ? { gaps } : {}) };
  if (rawDone) { const { fix: _fix, ...found } = pre.found ?? {}; return { ...out, asIs: true, ...(pre.images ? { images: pre.images } : {}), ...(pre.video ? { video: pre.video } : {}), ...(pre.order ? { order: pre.order } : {}), found }; }
  if (rawFail) out.gaps = [...(out.gaps ?? []), { ask: "By rule the work's own visuals were to be shared", why: `${rawFail} Prepared with the template.` }];
  // If a revision asked for an image or video (even if the attachment setting is empty), that attachment is produced: like "add a video", "add a screenshot".
  // If real gameplay footage was asked for, no text image/video is produced (LinkedIn's default image included); the cut is added later.
  // An image/video given in a revision enters the output by itself (end of prepare): no template visual is produced on top of it.
  // A text post prepared again (no revision): if an earlier output of the task that reached approval has a video or image (a hand-
  // added recording, GIF, carousel), it is kept; the template card is not produced again.
  // If the last revision says "text only" or "no image", the earlier video/image is not carried and no new attachment is produced. If it says "quote" or "video is missing",
  // no new attachment is produced, the task's existing video is carried.
  const bare = noMediaNote(task);
  // "Keep" carries only if there is an attachment to keep; otherwise a new attachment counts as asked for.
  const reuse = quoteNote(task) || (missingMediaNote(task) && !!carrySource(s.runs, task.id, null, runId));
  // A template card without a visual (none of the attachment's slides has footage) is not carried: so an empty card does not come back to approval on a re-prepare either.
  const blank = (r) => !!r.attach?.slides?.length && !r.video && !attachMedia(acc?.project?.id, r.attach).slides?.some((x) => x.media);
  const keep = !bare && textOnly(format) && (s.runs.filter((r) => r.taskId === task.id && r.id !== runId && ["ready", "approved", "posted"].includes(r.status) && (r.video || r.images?.length) && !blank(r)).sort((a, b) => b.at.localeCompare(a.at))[0] || (reuse && carrySource(s.runs, task.id, null, runId)));
  const kept = keep || null;
  if (kept) for (const k of MEDIA_KEYS) if (kept[k]) out[k] = kept[k];
  let found = false;
  if (!bare && textOnly(format) && wantsReal(task) && !(quoteNote(task) && ownSource(s, task, null, runId)) && !revisionFiles(task).length && (wantsNew(task) || !ownSource(s, task, null, runId))) {
    for (const k of MEDIA_KEYS) delete out[k];
    const m = await realMedia(runId, task, post, out, signal);
    if (m.cancelled) return m;
    // If only a permanent rule (not a revision) asks for a visual and no real visual was found, the draft still goes to approval; the gap is written on the card.
    // (The topic may come from the news: the user may have no work of their own to show. A timeout is temporary, that is retried.)
    const ruleOnly = !mediaRequired(task) && !askedAttach(task);
    if (m.fail && !(ruleOnly && !m.transient)) return { ok: false, error: m.fail };
    if (m.fail) out.gaps = [...(out.gaps ?? []), { ask: "A visual is required by rule but was not found", why: m.fail }];
    found = !!m.done;
  }
  const kind = found || (textOnly(format) && wantsReal(task)) || bare || reuse || kept || wantsFootage(task) || revisionFiles(task).length ? null : askedAttach(task) ?? attachOf(format, context(s, task).auto);
  if (kind && canAttach(format)) {
    setRun(runId, { post, body: out.body });
    const extra = await attachStep(runId, s, task, acc, post, kind, signal);
    if (extra.cancelled) return extra;
    Object.assign(out, extra);
  }
  if (format === "ig_post" || isVideo(format)) {
    const pol = await polish(runId, s, task, acc, post, signal);
    if (pol.cancelled) return pol;
    if (pol.post !== post) Object.assign(out, { post: pol.post, body: bodyOf(pol.post) });
    post = pol.post;
    if (pol.review) out.review = pol.review;
    setRun(runId, { phase: isVideo(format) ? "Preparing the video" : "Preparing the images", at: new Date().toISOString(), post, body: out.body });
    // A post prepared again keeps its earlier template.
    const template = s.runs.find((r) => r.taskId === task.id && r.template)?.template;
    if (template) out.template = template;
    const media = await renderPost(runId, attachMedia(acc.project?.id, post), renderAccount(s, task, acc), template, signal, kitOf(s, acc, task));
    if (media.cancelled) return media;
    Object.assign(out, media.ok ? media.files : { renderError: media.error });
  }
  return out;
}

// The visual's look: the project's kit, else the world's kit.
// The kit's fingerprint: which look the output was drawn with.
// The series colour is not part of the fingerprint: when a colour is assigned, old visuals waiting for approval are not redrawn, only later prepares are affected.
export const kitHash = (k) => {
  const { seriesColor: _, ...rest } = k ?? {};
  return createHash("md5").update(JSON.stringify(k ? rest : null)).digest("hex").slice(0, 10);
};
// Series colour (automation.color, shared/series.mjs seriesColor): in this series the kit's accent colour is replaced by it; the font, logo and language stay the same.
export const kitOf = (s, acc, task) => {
  const kit = acc?.project?.kit ?? s.worlds.find((w) => w.id === (acc?.project?.worldId ?? acc?.world?.id))?.kit;
  const color = seriesColor(s, task);
  if (!kit) return kit;
  return color ? { ...kit, seriesColor: color } : kit;
};

// The account name and colour in the visuals; if there is a series colour, the night/paper/bold templates and the VoiceReel accent take it.
export const renderAccount = (s, task, acc) => ({ name: acc.name || acc.project?.name || "", handle: acc.handle, color: seriesColor(s, task) ?? s.worlds.find((w) => w.id === task.worldId)?.color });

// If the last revision note has not been clarified yet (written in the last 2 days, not tried), it is clarified before the prepare.
const unseenVideos = (task) => revisionsOf(task).flatMap((r) => r.files ?? []).filter((f) => f.kind === "video" && !f.frames);
async function seeVideos(runId, taskId) {
  setRun(runId, { phase: "Watching the video you gave", at: new Date().toISOString() });
  const { describeFiles } = await import("./attach.mjs");
  const seen = {};
  for (const f of unseenVideos(read().state.tasks.find((t) => t.id === taskId))) {
    try {
      const d = await describeFiles([f]);
      const said = (d.lines[0]?.match(/(?:Speech in the video|Videodaki konuşma): "([\s\S]*)"/) ?? [])[1] ?? "";
      // Whisper makes things up on music ("Thanks for watching"): that does not count as speech.
      const real = said && !/izledi[gğ]iniz i[cç]in te[sş]ekk|thanks for watching|abone ol|altyaz[ıi]/i.test(said);
      seen[f.file] = { frames: d.read.map((x) => path.relative(DATA_DIR, x)), ...(real ? { said: said.slice(0, 2000) } : {}) };
    } catch { seen[f.file] = { frames: [] }; }
  }
  update((st) => { const t = st.tasks.find((x) => x.id === taskId); for (const r of t?.revisions ?? []) for (const f of r.files ?? []) if (seen[f.file]) Object.assign(f, seen[f.file]); });
}
// A note decoded by an old reader (no clear.v) is read again too: if the task is being prepared again, that note is still unresolved.
const needsClarity = (task) => { const r = revisionsOf(task).at(-1); return !!(r?.note && task.revisions?.length && (!r.clear || (r.clear.v ?? 1) < CLARITY_V) && !r.clearTried && Date.now() - new Date(r.at) < 2 * 86400e3); };
async function clarify(runId, taskId, acc, signal) {
  setRun(runId, { phase: "Reading the revision note" });
  const s = read().state;
  const task = s.tasks.find((t) => t.id === taskId);
  const last = revisionsOf(task).at(-1);
  const prev = last?.runId ? s.runs.find((r) => r.id === last.runId) : null;
  const autos = s.automations.filter((a) => a.worldId === task.worldId && a.status !== "paused").map((a) => ({ id: a.id, title: a.title, here: a.id === task.autoId }));
  // What was in the output the note was given on: the files and the note Rou wrote for them (what "wrong video" refers to).
  const prevMedia = prev ? [[prev.video, ...(prev.images ?? [])].filter(Boolean).map((f) => path.basename(f)).join(", "), prev.found ? `${prev.found.from}. ${prev.found.note}` : prev.attach ? "a card/video Rou made with a template" : ""].filter(Boolean).join(" · ").slice(0, 1200) : "";
  const names = [...new Set([...s.worlds, ...s.projects].map((x) => x.name).filter(Boolean))].slice(0, 80);
  // The note drives the rest of the job: the strongest model reads it (the default, Opus; it used to be Sonnet and decoded misspelled notes wrongly).
  const r = await runClaude(clarifyPrompt(task, { account: acc ? `${platformName(acc)} ${acc.handle || acc.name}` : "", prevText: prev?.body ?? last?.prev, prevMedia, names, autos }), 3 * 60 * 1000, signal);
  const clear = r.ok ? parseClarity(r.out) : null;
  update((st) => {
    const t = st.tasks.find((x) => x.id === taskId);
    const rv = t?.revisions?.find((x) => x.at === last?.at);
    if (!rv) return;
    if (clear) rv.clear = clear; else rv.clearTried = true;
    // If the instruction contradicts the note, the reader's corrected instruction is written: the writer no longer goes back to the old instruction.
    if (clear?.brief) setBrief(t, rv, clear.brief);
    // Permanent rule: written to the automations, and this post is prepared with it too; the card shows "Made a permanent rule".
    if (clear?.rule && !rv.saved) { const ids = saveRule(st, t.worldId, clear.rule); if (ids.length) rv.saved = ids; }
  });
}

// move { worldId, projectId, accountId }: a revision moves the post to another world, project or account (shared/revise.mjs movePost).
// A revision that arrives while a prepare runs is not refused; the note is written to the task at once and starts by itself when the running prepare ends.
const after = new Map(); // taskId → { rouId }
function queueAfter(taskId, feedback, files, rouId) {
  update((st) => {
    const t = st.tasks.find((x) => x.id === taskId);
    const prev = st.runs.find((r) => r.taskId === taskId && r.body);
    if (!t) return;
    const rv = addRevision(t, { note: feedback || "", prev: prev?.body ?? "", runId: prev?.id, files });
    if (prev && rv) Object.assign(prev, { revisedAt: new Date().toISOString(), reviseNote: rv.note, ...(rv.files ? { reviseFiles: rv.files } : {}) });
    const w = st.runs.find((r) => r.taskId === taskId && r.status === "working");
    if (w) w.queued = "A new revision is queued: it will start when this prepare ends";
  });
  after.set(taskId, { rouId });
  return { ok: true, queued: 1, message: "Revision queued: it will start when the current prepare ends." };
}
function runAfter(taskId) {
  const q = after.get(taskId);
  if (!q) return;
  after.delete(taskId);
  setTimeout(() => prepare(taskId, undefined, [], undefined, { rouId: q.rouId }), 500);
}

export function prepare(taskId, feedback, files = [], move, { rouId } = {}) {
  if (running.has(taskId)) {
    if ((typeof feedback === "string" && feedback.trim()) || files.length) return queueAfter(taskId, feedback, files, rouId);
    return { ok: false, error: "Already being prepared" };
  }
  // A post that was shared is not rewritten: a language or rule change does not change the published text.
  if (read().state.runs.some((r) => r.taskId === taskId && r.status === "posted")) return { ok: false, error: "This post was already shared; it is not prepared again" };
  if (move && (move.worldId || move.projectId || move.accountId)) {
    const { state: s0 } = read();
    const t0 = s0.tasks.find((x) => x.id === taskId);
    const err = movePost(structuredClone(s0), t0 && structuredClone(t0), move)?.error;
    if (err) return { ok: false, error: `Could not move it: ${err}` };
  }
  if ((typeof feedback === "string" && feedback.trim()) || files.length || move) update((st) => {
    const t = st.tasks.find((x) => x.id === taskId);
    const prev = st.runs.find((r) => r.taskId === taskId && r.body);
    if (!t) return;
    const mv = move ? movePost(st, t, move) : null;
    const moved = mv && !mv.error ? mv.from : undefined;
    const rv = addRevision(t, { note: feedback || (moved ? "Move the post here and prepare it again." : ""), prev: prev?.body ?? "", runId: prev?.id, files, moved });
    if (prev && rv) Object.assign(prev, { revisedAt: new Date().toISOString(), reviseNote: rv.note, ...(rv.files ? { reviseFiles: rv.files } : {}) });
  });
  const { state: s } = read();
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, error: "No such task" };
  // The app and pg are separate processes: if the file has a fresh "working" record, do not start a second time.
  if (s.runs.some((r) => r.taskId === taskId && r.status === "working" && Date.now() - new Date(r.at) < 6 * 60 * 1000)) return { ok: false, error: "Already being prepared" };
  const auto = task.autoId ? s.automations.find((a) => a.id === task.autoId) : undefined;
  // A manual post with no account chosen: if a suitable account exists it is written to the task, and what follows (preview, sharing) goes with that account.
  const pick = pickAccount(s, task);
  if (pick) {
    update((st) => { const t = st.tasks.find((x) => x.id === taskId); if (t?.post) { t.post.accountId = pick.id; if (!formatsOf(pick.platform).includes(t.post.format)) t.post.format = formatsOf(pick.platform)[0]; } });
    task.post = { ...task.post, accountId: pick.id, format: formatsOf(pick.platform).includes(task.post.format) ? task.post.format : formatsOf(pick.platform)[0] };
  }
  const ref = taskRef(s, task);
  const acc = accountOf(s, ref);
  const format = acc ? formatOf(s, ref) : null;
  const runId = id();
  update((st) => void st.runs.unshift({ id: runId, taskId, at: new Date().toISOString(), title: task.title, body: "", status: "working", by: "claude" }));
  const ctl = new AbortController();
  running.set(taskId, ctl);
  startedAt.set(taskId, Date.now());
  // A new revision note is clarified first (shared/revise.mjs clarifyPrompt); the prepare reads the clarified request.
  const launch = (s, task) => auto?.browser && auto.who === "claude" ? (setRun(runId, { phase: "Preparing in the browser" }), prepareBrowse(s, task, auto, ctl.signal, runId))
    : acc && format && !(isVideo(format) && auto?.voice === "me")
    ? social(runId, s, task, acc, format, ctl.signal)
    : auto && auto.voice === "me" && outputOf(s, auto) === "video"
    ? (setRun(runId, { phase: "Writing the script" }), prepareVideo(s, task, ctl.signal))
    : runClaude(plainPrompt(s, task), LIMIT_MS, ctl.signal, { args: ["--allowedTools", "WebSearch,WebFetch,Read", "--add-dir", MEDIA_DIR] }).then(async (r) => {
      if (!r.ok) return r;
      const { text, gaps } = splitGaps(r.out);
      if (!isPost(task, auto)) return { ok: true, body: text, ...(gaps.length ? { gaps } : {}) };
      // The post's attachments are split from the text and downloaded; an address that cannot be downloaded is not written back to the text, only counted.
      setRun(runId, { phase: "Downloading attachments" });
      const m = await pullMedia(text, runId);
      return { ok: true, body: m.body, images: m.images, ...(gaps.length ? { gaps } : {}), ...(m.failed.length ? { renderError: `${m.failed.length} attachment(s) could not be downloaded: ${m.failed.join(" ")}` } : {}) };
    });
  // A video given in a revision is watched first (frames + speech): Rou does not write the text without knowing what the video shows.
  const pre = unseenVideos(task).length ? seeVideos(runId, taskId) : Promise.resolve();
  const job = pre.then(() => needsClarity(read().state.tasks.find((t) => t.id === taskId) ?? task)
    ? clarify(runId, taskId, acc, ctl.signal).then(() => { const s2 = read().state; return launch(s2, s2.tasks.find((t) => t.id === taskId) ?? task); })
    : (() => { const s2 = read().state; return launch(s2, s2.tasks.find((t) => t.id === taskId) ?? task); })());
  const done = job.then(async (r) => {
    // Quote/reply on X: the target tweet is split from the text and linked to the post (server/xquote.mjs).
    if (r?.ok && r.post?.tweets) {
      const tk = read().state.tasks.find((t) => t.id === taskId);
      const linked = await linkTweet(r.post, [tk?.title, tk?.notes, ...(tk?.revisions ?? []).map((x) => x.note)].join("\n"));
      if (linked !== r.post) { r.post = linked; r.body = bodyOf(linked); }
    }
    // If the revision asks for a video of a design on the site (video + site/page address), the page is recorded from its opening and the video enters the output.
    if (r?.ok && !ctl.signal.aborted) {
      const st0 = read().state;
      const tk = st0.tasks.find((t) => t.id === taskId);
      const url = siteVideoUrl(tk, r);
      if (!url && wantsFootage(tk)) {
        const pids = [tk.projectId, acc?.project?.id];
        const many = /karakt|karekt|character|\brol(ler|den|dan|u|leri|lerini|lerden)?\b|\broles?\b|sinif/.test(foldTr(revisionsOf(tk).at(-1)?.note)) ? footageClips(st0, tk, pids) : [];
        // If the previous output had a cut (revision), Rou picks a new part by the note's criterion; on the first prepare the old way (the best-fitting recording, from the start).
        const prevRun = st0.runs.find((x) => x.taskId === taskId && x.id !== runId && x.video?.includes("-play."));
        let src = many.length ? null : footageOf(st0, tk, pids);
        if (!many.length && revisionsOf(tk).length && prevRun) {
          setRun(runId, { phase: "Looking at the gameplay recordings", at: new Date().toISOString() });
          const pick = await pickFootage(st0, tk, pids, prevRun.footage ?? { key: null, from: 0, sec: 15 }, ctl.signal);
          if (pick.cancelled) r.cancelled = true;
          else if (pick.error) { src = null; r.video = undefined; r.renderError = pick.error; r.footageFailed = true; }
          else { try { const file = `${runId}-play.mp4`; cutFootage(pick.file, path.join(MEDIA_DIR, file), pick.sec, pick.from); r.video = `media/${file}`; r.images = []; r.footage = { key: pick.key, from: pick.from, sec: pick.sec, why: pick.why }; delete r.attach; delete r.renderError; } catch (e) { r.renderError = `Could not cut the gameplay clip: ${String(e?.message ?? e).slice(0, 120)}`; r.footageFailed = true; } }
          src = null;
        }
        if (r.footage || r.footageFailed) { /* the revision cut was picked above */ }
        else if (many.length) { try { const file = `${runId}-play.mp4`; montageFootage(many, path.join(MEDIA_DIR, file)); r.video = `media/${file}`; r.images = []; delete r.attach; delete r.renderError; } catch (e) { r.renderError = `Could not cut the gameplay clip: ${String(e?.message ?? e).slice(0, 120)}`; } }
        else if (src) { try { const file = `${runId}-play.mp4`; cutFootage(src, path.join(MEDIA_DIR, file)); r.video = `media/${file}`; r.images = []; delete r.attach; delete r.renderError; } catch (e) { r.renderError = `Could not cut the gameplay clip: ${String(e?.message ?? e).slice(0, 120)}`; } }
        else r.renderError = r.renderError ?? "The project's Media has no gameplay video marked Good";
      }
      if (url) {
        setRun(runId, { phase: "Recording a video of the site", at: new Date().toISOString() });
        try { const { recordPage } = await import("./record.mjs"); const file = `${runId}-site.mp4`; await recordPage(url, 20, path.join(MEDIA_DIR, file)); r.video = `media/${file}`; }
        catch (e) { r.renderError = `Could not record a video of the site: ${String(e?.message ?? e).slice(0, 120)}`; }
      }
    }
    // If a phrase banned in the revision is still in the output, it does not go to approval; it is retried once by itself.
    if (r?.ok && !ctl.signal.aborted) {
      const tk = read().state.tasks.find((t) => t.id === taskId);
      const hits = banHits(tk, r);
      if (hits.length) {
        const again = !tk.revisions?.at(-1)?.banRetry;
        r = { ok: false, error: `A phrase the revision asked to remove is still there: ${hits.join(", ")}.${again ? " Rou is trying once more by itself." : " Add a revision note to try again."}` };
        if (again) { update((st) => { const t = st.tasks.find((x) => x.id === taskId); const last = t?.revisions?.at(-1); if (last) last.banRetry = true; }); after.set(taskId, { rouId }); }
      }
    }
    // If the note asked for a visual, an output without one does not go to approval.
    if (r?.ok && !ctl.signal.aborted && !(r.images?.length || r.video || r.attach)) {
      const tk = read().state.tasks.find((t) => t.id === taskId);
      if (r.noVisual) r = { ok: false, error: r.renderError };
      else if (mediaRequired(tk)) r = { ok: false, error: `The revision asked for a visual but none could be found to add${r.renderError ? ` (${r.renderError})` : ""}. Attach the visual to the revision as a file, or put it in the project's Media folder.` };
    }
    // Removes only its own record: so an old job stopped by the watchdog does not, when it ends late, delete the record of the job that started again.
    if (running.get(taskId) === ctl) running.delete(taskId);
    if (r.cancelled || ctl.signal.aborted) return;
    update((st) => {
      const run = st.runs.find((x) => x.id === runId);
      if (!run) return;
      delete run.phase;
      if (!r.ok) { Object.assign(run, { status: "failed", body: String(r.error ?? "").slice(0, 600), at: new Date().toISOString() }); addNotice(st, { kind: "failed", runId, by: "claude", text: run.body.slice(0, 200) }); return; }
      // Rou's own note ("TOPIC MISMATCH: …") does not go into the text: it becomes a separate note on the card.
      const miss = stripTopicMiss(r);
      if (miss) run.topicMiss = miss;
      // Approval gate (server/quality.mjs): if one of the mistake kinds caught before is present, it does not go to approval.
      const tk = st.tasks.find((t) => t.id === taskId);
      const pid0 = tk?.projectId ?? st.automations.find((a) => a.id === tk?.autoId)?.projectId;
      const wid = tk?.worldId ?? st.projects.find((p) => p.id === pid0)?.worldId;
      const gq = gate(r, [pid0, ...st.projects.filter((p) => p.worldId === wid && p.id !== pid0).map((p) => p.id)], tk, st);
      if (!gq.ok) { Object.assign(run, { status: "failed", body: gq.error, renderError: gq.error, at: new Date().toISOString(), ...(r.post ? { post: r.post } : {}), ...(r.attach ? { attach: r.attach } : {}) }); addNotice(st, { kind: "failed", runId, by: "claude", text: gq.error.slice(0, 200) }); return; }
      Object.assign(run, { status: "ready", body: r.body, at: new Date().toISOString() });
      if (r.post) run.post = r.post;
      if (r.attach) run.attach = r.attach;
      if (r.needs) run.needs = r.needs;
      if (r.found) run.found = r.found;
      if (r.items) run.items = r.items;
      if (r.storyboard) run.storyboard = r.storyboard;
      if (r.template) run.template = r.template;
      if (r.images?.length) { run.images = r.images; run.kitHash = kitHash(acc ? kitOf(st, acc, st.tasks.find((x) => x.id === taskId)) : undefined); }
      if (r.video) run.video = r.video;
      // The carousel order and the "the work itself" flag pass to the output.
      if (r.order) run.order = r.order;
      if (r.asIs) run.asIs = true;
      if (r.footage) run.footage = r.footage;
      // The revision asked for a new gameplay cut but none was found: the old video does not go to approval as if it were a "new output".
      if (r.footageFailed) { run.status = "failed"; run.renderError = String(r.renderError ?? "Could not pick a new gameplay cut").slice(0, 300); }
      if (r.review) run.review = r.review;
      if (r.renderError) run.renderError = String(r.renderError).slice(0, 300);
      // An output whose design score is under FLOOR does not become "failed": it goes to approval, its critique stays open on the card, the button becomes "Approve anyway";
      // it is not produced again by itself and not approved by itself (approveRun).
      const low = designLow(r);
      // Which revision it answers: the latest note; requests that could not be done show on the card (run.reviseGaps).
      const revs = revisionsOf(st.tasks.find((t) => t.id === taskId));
      if (revs.length) run.answers = revs.at(-1).at;
      // Images and videos added in a revision enter the output: images in front, the video is replaced by the one the user gave.
      const extra = revisionFiles(st.tasks.find((t) => t.id === taskId));
      const imgs = extra.filter((f) => f.kind === "image").map((f) => `media/${f.file}`);
      if (imgs.length) run.images = [...imgs, ...(run.images ?? []).filter((x) => !imgs.includes(x))];
      const vid = extra.filter((f) => f.kind === "video").at(-1);
      if (vid) run.video = `media/${vid.file}`;
      // Requests the text step said it "could not do" but that were done in the output are dropped: image/video requests if an attachment was produced.
      const media = !!(run.video || run.images?.length);
      const gaps = (r.gaps ?? []).filter((g) => { const t = `${g.ask} ${g.why ?? ""}`.toLocaleLowerCase("tr"); return !((media && /v[iı]d[eo]|g[oö]rsel|ekran g[oö]r[uü]nt|res[iı]m|foto[gğ]raf|kapak|oynan[iı][sş]|image|screenshot|picture|photo|cover|gameplay|visual/.test(t))); });
      // Requests the check still found missing after two rounds (added before the single assignment, otherwise they do not show on the card).
      for (const a of r.missed ?? []) gaps.push({ ask: a, why: "Rou tried twice, it is not in the output" });
      if (gaps.length) run.reviseGaps = gaps; else delete run.reviseGaps;
      // An output of an automation that needs no approval is approved by itself; it is not said to be "waiting for approval".
      if (run.status === "failed") return;
      if (auto?.approve !== false || low) addNotice(st, { kind: "ready", runId, by: "claude", text: low ? `Ready, but the design review gave a low score (${r.review.score}/10). Its critique is on the card; you decide.` : run.renderError ? `Ready, but ${run.renderError}` : "Rou prepared it." });
    });
    if (rouId) reportRevise(rouId, taskId, runId, r, auto);
    if (r.ok) proposeVisualRule(taskId).catch(() => {});
    if (r.ok && r.body) refreshTopic(taskId, r.body).catch(() => {});
  }).catch((e) => {
    if (running.get(taskId) === ctl) running.delete(taskId);
    setRun(runId, { status: "failed", body: String(e).slice(0, 600), phase: undefined });
  }).finally(() => { setRun(runId, { queued: undefined }); runAfter(taskId); });
  // done: resolves when finished (pg prepare waits for it; the API does not).
  return { ok: true, runId, done };
}

// Prepares several tasks in order (one claude at a time). Queued ones that are already being prepared are skipped.
let chain = Promise.resolve();
// Queued tasks are marked with task.queuedAt (the app shows "Queued"); the mark is removed when their turn comes.
// A task waiting in the queue is not added again. The scheduler sends the same list every minute; since the queued task has no output yet,
// it would be added again every minute.
const waiting = new Set();
export function prepareMany(ids) {
  const fresh = [...new Set(ids)].filter((id) => !waiting.has(id));
  if (!fresh.length) return { ok: true, n: 0 };
  const at = new Date().toISOString();
  update((st) => { for (const t of st.tasks) if (fresh.includes(t.id) && !st.runs.some((r) => r.taskId === t.id && r.status === "working")) t.queuedAt = at; });
  for (const taskId of fresh) {
    waiting.add(taskId);
    chain = chain.then(() => {
      waiting.delete(taskId);
      update((st) => { const t = st.tasks.find((x) => x.id === taskId); if (t) delete t.queuedAt; });
      return prepare(taskId).done ?? null;
    }).catch(() => { waiting.delete(taskId); });
  }
  return { ok: true, n: fresh.length };
}

// Carries the video/images of another output of the same task to this output (a good video from the past; Rou or the user picks it).
export function copyMedia(runId, fromId) {
  let res = { ok: false, error: "No such output" };
  update((st) => {
    const r = st.runs.find((x) => x.id === runId);
    const from = st.runs.find((x) => x.id === fromId);
    if (!r || !from) return;
    if (r.taskId !== from.taskId) { res = { ok: false, error: "An output of another task" }; return; }
    if (!from.video && !from.images?.length) { res = { ok: false, error: "That output has no video or image" }; return; }
    pushVersion(r, "media");
    for (const k of MEDIA_KEYS) { if (from[k]) r[k] = from[k]; else delete r[k]; }
    res = { ok: true };
  });
  return res;
}

// Produces the edited post's images/video again.
// If edit: { post, template } is given, the post is updated first (from the editor), then the images are produced.
export function rerender(runId, edit) {
  if (running.has(`r-${runId}`)) return { ok: false, error: "Already being prepared" };
  if (edit?.post) {
    let ok = false;
    update((st) => {
      const r = st.runs.find((x) => x.id === runId);
      const post = r?.post && normalize(r.post.format, edit.post);
      if (!post) return;
      pushVersion(r, "edit");
      Object.assign(r, { post, body: bodyOf(post), edited: true, ...(edit.template ? { template: String(edit.template) } : {}) });
      ok = true;
    });
    if (!ok) return { ok: false, error: "Could not read the post" };
  }
  const { state: s } = read();
  const run = s.runs.find((r) => r.id === runId);
  if (!run?.post) return { ok: false, error: "No such post" };
  // A text post (X, Threads, LinkedIn) is not rendered from its own text: without an attachment (attach) only the text is updated, the video/image stays as it is
  if (textOnly(run.post.format) && !run.attach) return { ok: true, kept: true };
  const src = run.attach ?? run.post; // if the text post has an attachment, the image/video comes from it
  const task = s.tasks.find((t) => t.id === run.taskId);
  const acc = accountOf(s, taskRef(s, task));
  const ctl = new AbortController();
  running.set(`r-${runId}`, ctl);
  setRun(runId, { phase: isVideo(src.format) ? "Preparing the video" : "Preparing the images", renderError: undefined });
  const one = (p) => renderPost(runId, attachMedia(acc?.project?.id, p), acc && task ? renderAccount(s, task, acc) : { name: "", handle: "", color: undefined }, run.template, ctl.signal, acc ? kitOf(s, acc, task) : undefined, run.attach && needsImage(run.post.format) ? LI_SCALE : undefined);
  // Bilingual attachment image pair: each language is its own single image (no counter).
  const pair = run.attach && acc?.lang === "tr+en" && src.format === "ig_post" && src.slides?.length === 2;
  const job = pair
    ? (async () => { const images = []; for (const x of src.slides) { const m = await one({ ...src, slides: [x] }); if (!m.ok) return m; images.push(...(m.files.images ?? [])); } return { ok: true, files: { images } }; })()
    : one(src);
  job.then((m) => {
    running.delete(`r-${runId}`);
    update((st) => {
      const r = st.runs.find((x) => x.id === runId);
      if (!r) return;
      delete r.phase;
      if (m.ok) {
        if (!edit?.post) pushVersion(r, edit?.why ?? "render");
        r.images = m.files.images; if (m.files.video) r.video = m.files.video; else delete r.video; delete r.renderError;
        r.kitHash = kitHash(acc ? kitOf(st, acc, task) : undefined);
        delete r.kitTried;
      }
      else { r.renderError = String(m.error ?? "").slice(0, 300); r.kitTried = kitHash(acc ? kitOf(st, acc, task) : undefined); }
    });
  }).catch((e) => {
    running.delete(`r-${runId}`);
    setRun(runId, { phase: undefined, renderError: String(e?.message ?? e).slice(0, 300) });
  });
  return { ok: true };
}

// Produces only the image for an output that lacks one (LinkedIn or a text post whose attachment is set to Image); the text stays as it is. If it was approved, the approval is taken back:
// an approval without the image is void, the user approves again with the image. done: resolves when finished (pg image waits for it).
export function makeImage(runId) {
  const key = `i-${runId}`;
  if (running.has(key)) return { ok: false, error: "The image is already being prepared" };
  const { state: s } = read();
  const run = s.runs.find((r) => r.id === runId || r.id.startsWith(runId));
  if (!run?.post) return { ok: false, error: "No such post" };
  if (run.status === "posted") return { ok: false, error: "The post was already shared" };
  if (run.status === "working") return { ok: false, error: "The output is still being prepared" };
  const task = s.tasks.find((t) => t.id === run.taskId);
  const acc = task && accountOf(s, taskRef(s, task));
  if (!acc) return { ok: false, error: "Account not found" };
  const kind = askedAttach(task) ?? attachOf(run.post.format, context(s, task).auto);
  if (!kind || !(needsImage(run.post.format) || canAttach(run.post.format))) return { ok: false, error: "This post has no attachment (set Attachment: Image in the automation)" };
  update((st) => {
    const r = st.runs.find((x) => x.id === run.id);
    if (!r) return;
    if (r.status === "approved") { r.status = "ready"; delete r.approvedAt; delete r.approvedVia; delete r.publish; delete r.shareSentAt; }
    delete r.renderError;
  });
  const ctl = new AbortController();
  running.set(key, ctl);
  const done = attachStep(run.id, s, task, acc, run.post, kind, ctl.signal).then((m) => {
    running.delete(key);
    if (m.cancelled) return;
    update((st) => {
      const r = st.runs.find((x) => x.id === run.id);
      if (!r) return;
      delete r.phase;
      for (const k of ["attach", "images", "video", "review", "template", "needs"]) if (m[k]) r[k] = m[k];
      // An image was produced: old gaps of the "could not add an image" kind go away.
      if (m.images?.length && r.reviseGaps) r.reviseGaps = r.reviseGaps.filter((g) => !/görsel|kapak|image|visual|cover|picture/i.test(g.ask));
      if (!m.needs) delete r.needs;
      if (m.renderError) r.renderError = String(m.renderError).slice(0, 300);
    });
  }).catch((e) => {
    running.delete(key);
    setRun(run.id, { phase: undefined, renderError: String(e).slice(0, 300) });
  });
  return { ok: true, runId: run.id, done };
}

// Stop: the running claude process is closed, the "working" record is deleted; the task goes back to unprepared.
export function cancel(taskId) {
  // The queued revision is dropped too: otherwise the prepare would start again by itself half a second after Stop.
  after.delete(taskId);
  running.get(taskId)?.abort();
  running.delete(taskId);
  update((st) => void (st.runs = st.runs.filter((r) => !(r.taskId === taskId && r.status === "working"))));
  return { ok: true };
}

// The final text given by the user (Rou's set_text action in chat): written word for word, Rou does not touch it.
// If a share handoff folder exists, its text.txt (metin.txt in older folders) is updated too. The images stay as they are.
export function setRunText(runId, text) {
  const t = String(text ?? "").replace(/\r/g, "").replace(/—/g, ",").trim();
  if (!t) return { ok: false, error: "The text is empty" };
  let ok = false;
  update((s) => {
    const r = s.runs.find((x) => x.id === runId);
    if (!r) return;
    pushVersion(r, "edit");
    r.prevBody ??= r.body;
    r.body = t;
    // For the Tweet/Threads format the preview and sharing read post.tweets.
    if (r.post) r.post = Array.isArray(r.post.tweets) ? { ...r.post, ...postOfText(r.post.format, t) } : { ...r.post, text: t };
    r.byUser = new Date().toISOString();
    delete r.reviseGaps;
    ok = true;
  });
  if (!ok) return { ok: false, error: "No such output" };
  const root = SHARE_DIR;
  try {
    for (const g of fs.readdirSync(root)) for (const d of fs.readdirSync(path.join(root, g))) {
      const f = path.join(root, g, d, ".run");
      if (fs.existsSync(f) && fs.readFileSync(f, "utf8").trim() === runId) fs.writeFileSync(path.join(root, g, d, fs.existsSync(path.join(root, g, d, "metin.txt")) ? "metin.txt" : "text.txt"), t + "\n");
    }
  } catch { /* no folder: only the app */ }
  return { ok: true };
}

// When a revision asked for in chat ends, the result lands in that Rou's chat: the new output in its own view (show), what it could not do stated plainly.
export function reportRevise(rouId, taskId, runId, r, auto) {
  update((st) => {
    const run = st.runs.find((x) => x.id === runId);
    const t = st.tasks.find((x) => x.id === taskId);
    if (!run || !t) return;
    const title = t.topic?.title || t.title;
    const text = !r.ok
      ? `I could not prepare the revision of "${title}": ${String(r.error ?? "unknown error").slice(0, 200)}`
      : [
          `I made the revision of "${title}", the new version is below.`,
          run.reviseGaps?.length ? `What I could not do: ${run.reviseGaps.map((g) => g.ask).join(", ")}.` : "",
          run.renderError ? `Note: ${run.renderError}` : "",
          auto?.approve !== false ? "It is waiting for your approval." : "",
        ].filter(Boolean).join(" ");
    setChat(st, rouId, (l) => [...l, { role: "rou", text, at: new Date().toISOString(), ...(r.ok ? { show: [runId] } : {}) }]);
  });
}

// A visual revision turns into a permanent rule.
// In an automation task, the latest note that objects to the visual is turned into a general rule and lands in the chat as an edit_auto proposal (added to the visual field).
// Once approved, every visual of the automation (the attachment plan) is prepared with these rules. One-off requests do not become rules.
async function proposeVisualRule(taskId) {
  const { state: s } = read();
  const task = s.tasks.find((t) => t.id === taskId);
  const auto = task?.autoId && s.automations.find((a) => a.id === task.autoId);
  const rev = revisionsOf(task).at(-1);
  if (!auto || !rev || !visualNote(rev.note) || rev.ruled) return;
  const old = auto.visual?.trim() ?? "";
  const r = await runClaude([
    `The user wrote this revision note on an output of the "${auto.title}" automation:\n"""\n${rev.note}\n"""`,
    old ? `The automation's current visual rules:\n${old}` : "The automation has no visual rules yet.",
    "Does this note yield a general visual/cover rule to apply to ALL future visuals of this automation? If it is specific to this post only (a certain text, a certain mistake), it does not. If it does, write a single sentence of clear English, imperative, that states plainly what the user wants; do not write it if it is the same as the existing rules. Do not use the long dash.",
    'Write ONLY JSON: {"rule": "…" | null}',
  ].join("\n\n"), 90 * 1000);
  const rule = (r.ok ? json(r.out)?.rule : null)?.trim?.();
  update((st) => {
    const t = st.tasks.find((x) => x.id === taskId);
    const last = revisionsOf(t).at(-1);
    if (last) last.ruled = true;
    if (!rule) return;
    const talk = (st.talk ??= []);
    const visual = [old, `- ${rule}`].filter(Boolean).join("\n");
    talk.push({ id: id(), from: "rou", to: "me", at: new Date().toISOString(), text: `I drew a permanent visual rule from your revision of "${auto.title}". Should it apply to all later visuals of this automation?\n${rule}`, action: { type: "edit_auto", autoId: auto.id, visual } });
    if (talk.length > 60) talk.splice(0, talk.length - 60);
  });
}

// After a revision the topic and brief are updated from the new text. Only for revised tasks; if the topic already matches the text it does not change.
async function refreshTopic(taskId, body) {
  const { state: s } = read();
  const task = s.tasks.find((t) => t.id === taskId);
  if (!task?.topic || !revisionsOf(task).length) return;
  const r = await runClaude([
    `A post's topic on the task:\nTitle: ${task.topic.title ?? ""}\nBrief: ${task.topic.brief ?? ""}`,
    `The post's final text after the revision:\n"""\n${String(body).slice(0, 3000)}\n"""`,
    "If the topic title and brief do not say what this text tells, rewrite them: title at most 8 words, brief a single short sentence, plain language in the same language as the current title, no information that is not in the text, no long dash. If they already match, return them unchanged.",
    'Write ONLY JSON: {"title": "…", "brief": "…"}',
  ].join("\n\n"), 90 * 1000);
  const j = r.ok ? json(r.out) : null;
  const title = String(j?.title ?? "").trim(), brief = String(j?.brief ?? "").trim();
  if (!title) return;
  update((st) => { const t = st.tasks.find((x) => x.id === taskId); if (t?.topic && (t.topic.title !== title || t.topic.brief !== brief)) t.topic = { ...t.topic, title, brief: brief || t.topic.brief }; });
}
