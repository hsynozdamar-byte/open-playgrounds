// Sharing in the browser: the assistant works in the user's open Chrome (Claude in Chrome extension).
// Sharing happens in the Playgrounds browser, in the session of the account's world (server/pb.mjs). Fallback (no app): the account's
// linked Chrome (account.browser); before sharing, the handle logged in there is compared with the
// account's, and nothing is shared if they differ.
// Sharing starts on an approved post: by hand (POST /api/publish) or from the scheduler at its time (server/share.mjs).
import path from "node:path";
import { read, update, MEDIA_DIR, DATA_DIR } from "./store.mjs";
import { shareFiles } from "./sharemedia.mjs";
import { runClaude } from "./claude.mjs";
import { tracker } from "./live.mjs";
import { markPosted } from "./share.mjs";
import { accountById, accountOf, bodyOf, isFeed, mentionRule, missingImage, platformName, profileUrl, taskRef } from "../shared/social.mjs";
import { installed as pbInstalled, rouTab, rouArgs, rouRules, releaseTab, PB_NAME } from "./pb.mjs";
import { SITES } from "../shared/pb.mjs";

const T = "mcp__claude-in-chrome__";
const READ_TOOLS = ["list_connected_browsers", "select_browser", "tabs_context_mcp", "tabs_create_mcp", "navigate", "get_page_text", "read_page", "find", "computer", "tabs_close_mcp"].map((x) => T + x);
const POST_TOOLS = [...READ_TOOLS, ...["form_input", "file_upload", "javascript_tool", "browser_batch"].map((x) => T + x)];
const chrome = (tools) => ["--chrome", "--allowedTools", tools.join(","), "--add-dir", MEDIA_DIR];

export const HOME = {
  instagram: "https://www.instagram.com/",
  linkedin: "https://www.linkedin.com/feed/",
  x: "https://x.com/home",
  threads: "https://www.threads.com/",
  tiktok: "https://www.tiktok.com/upload",
  youtube: "https://studio.youtube.com/",
};
export const canPublish = (platform) => Object.hasOwn(HOME, platform);
// Site admin panel: if the handle of an "other" account is an address (like example.com/admin), Rou enters the post in that panel.
export const panelUrl = (acc) => {
  const h = String(acc?.handle ?? "").trim();
  if (acc?.platform !== "other" || !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(h)) return null;
  return /^https?:\/\//i.test(h) ? h : `https://${h}`;
};
export const canPublishAcc = (acc) => !!acc && (canPublish(acc.platform) || !!panelUrl(acc));

const json = (out, list = false) => {
  const m = out.match(list ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
};
const norm = (h) => String(h ?? "").trim().replace(/^@/, "").toLowerCase();
const busy = new Set();
export const publishing = () => [...busy];

// Connected Chromes: [{ id, name, local }].
// The list is kept for 10 minutes: searching again on every "Rou, start" took 10-30 s.
let seenBrowsers = null;
export async function browsers() {
  if (seenBrowsers && Date.now() - seenBrowsers.at < 10 * 60 * 1000) return { ok: true, list: seenBrowsers.list };
  // Requests that arrive together wait for one search (the scheduler and a card may ask at once).
  if (looking) return looking;
  looking = findBrowsers().finally(() => { looking = null; });
  return looking;
}
let looking = null;
async function findBrowsers() {
  const r = await runClaude("Call the list_connected_browsers tool once and write ONLY its result as a raw JSON array. Do nothing else, open no tabs.", 90000, undefined, { args: ["--chrome", "--allowedTools", T + "list_connected_browsers"] });
  if (!r.ok) return r;
  const list = json(r.out, true);
  if (!Array.isArray(list)) return { ok: false, error: "Could not read the Chrome list. Is Chrome open and the Claude extension connected?" };
  const out = list.map((b) => ({ id: String(b.deviceId), name: String(b.name || "Chrome"), local: !!b.isLocal }));
  if (out.length) seenBrowsers = { at: Date.now(), list: out };
  return { ok: true, list: out };
}

const selectLine = (b) => `First use the select_browser tool to pick the Chrome with deviceId "${b.id}". Use no other Chrome; if it is not connected, stop and report an error.`;

// Whether a site is logged in in a Chrome (used when Rou picks a Chrome, server/browse.mjs chooseBrowser); read-only. { loggedIn, seen }.
export async function siteLogin(browser, site) {
  if (!canPublish(site)) return { loggedIn: false };
  const prompt = [
    selectLine(browser),
    `Open a new tab and go to ${HOME[site]}. Find out whether an account is logged in on the site (if it redirects to a login page, none is). Click nothing, type nothing.`,
    "When done, close the tab you opened.",
    'Write ONLY this JSON: {"loggedIn": true|false, "name": "display name or empty"}',
  ].join("\n\n");
  const r = await runClaude(prompt, 3 * 60 * 1000, undefined, { args: chrome(READ_TOOLS) });
  const j = r.ok ? json(r.out) : null;
  return { loggedIn: !!j?.loggedIn, seen: String(j?.name ?? "") };
}

// Checks whether the account is logged in in Chrome; read-only, clicks nothing.
export async function checkAccount(accountId, browser) {
  const { state: s } = read();
  const acc = accountById(s, accountId);
  if (!acc || isFeed(acc.platform) || !canPublish(acc.platform)) return { ok: false, error: "This account cannot be shared from the browser" };
  const key = `check-${accountId}`;
  if (busy.has(key)) return { ok: false, error: "Already being checked" };
  busy.add(key);
  const prompt = [
    selectLine(browser),
    `Open a new tab and go to ${HOME[acc.platform]}. Find out which account is logged in on ${platformName(acc)} (handle and display name). Look at the profile menu if needed, but change no setting and share, like or send nothing.`,
    "When done, close the tab you opened.",
    'Write ONLY this JSON: {"loggedIn": true|false, "handle": "@handle or empty", "name": "display name or empty"}',
  ].join("\n\n");
  const r = await runClaude(prompt, 4 * 60 * 1000, undefined, { args: chrome(READ_TOOLS) }).finally(() => busy.delete(key));
  const j = r.ok ? json(r.out) : null;
  const check = j
    ? { at: new Date().toISOString(), ok: !!j.loggedIn && (!acc.handle || norm(j.handle) === norm(acc.handle)), seen: j.loggedIn ? String(j.handle || j.name || "") : "", ...(j.loggedIn ? {} : { error: "Not logged in in this Chrome" }) }
    : { at: new Date().toISOString(), ok: false, error: (r.error || "Could not read the reply").slice(0, 200) };
  if (j?.loggedIn && acc.handle && !check.ok) check.error = `Chrome has ${check.seen} logged in, the account is ${acc.handle}`;
  update((st) => {
    const a = st.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === accountId);
    if (!a) return;
    a.browser = { id: browser.id, name: browser.name };
    a.check = check;
    // If the handle is empty, store the one seen in Chrome.
    if (!a.handle && j?.loggedIn && j.handle) a.handle = String(j.handle).startsWith("@") ? String(j.handle) : `@${j.handle}`;
  });
  return { ok: true, check };
}

// Account check in the Playgrounds browser, in the session of the account's world: who is logged in and whether the
// profile page opens. Read-only: does not log in, click or change settings. On a LinkedIn company page the logged-in person
// cannot be the page itself; there, being logged in and the page opening is enough.
export async function checkAccountPb(accountId) {
  const { state: s } = read();
  const world = s.worlds.find((w) => w.accounts?.some((a) => a.id === accountId));
  const acc = world?.accounts.find((a) => a.id === accountId);
  const home = acc && (SITES[acc.platform]?.home ?? (/facebook/i.test(acc.name ?? "") ? "https://www.facebook.com/" : null));
  if (!acc || !home) return { ok: false, error: "This account cannot be checked in the browser" };
  if (!pbInstalled()) return { ok: false, error: `${PB_NAME} is not installed` };
  const key = `check-${accountId}`;
  if (busy.has(key)) return { ok: false, error: "Already being checked" };
  busy.add(key);
  const profile = profileUrl(acc);
  const page = /\/company\//.test(profile ?? "");
  let tab;
  let check;
  try {
    tab = await rouTab(world, key, `Rou is checking the account · ${platformName(acc)}`);
    const prompt = [
      `Your task: check the ${platformName(acc)} account by READING only. Do nothing else.`,
      rouRules(tab),
      `1) In this tab go to ${home}. Find out which account is logged in on the site (handle and display name; open the profile menu if needed but enter no settings). If it redirects to a login page, no account is logged in; DO NOT LOG IN.`,
      profile ? `2) Then in the same tab go to ${profile} and check whether the page really opens as this account's profile ("page doesn't exist", "user not found" or a redirect to another account counts as not opening). Also write the handle on the profile that opened.` : "",
      "Do not share, like, follow, message, change settings or log in.",
      `Write ONLY this JSON: {"loggedIn": true|false, "handle": "handle of the logged-in account or empty", "name": "display name or empty"${profile ? ', "profileOpens": true|false, "profileHandle": "handle on the profile page or empty"' : ""}}`,
    ].filter(Boolean).join("\n\n");
    const r = await runClaude(prompt, 5 * 60 * 1000, undefined, { args: rouArgs(undefined, [], [], { read: true }), cwd: MEDIA_DIR });
    const j = r.ok ? json(r.out) : null;
    if (!j) check = { at: new Date().toISOString(), ok: false, via: "pb", error: String(r.error || "Could not read the reply").slice(0, 200) };
    else {
      const seen = j.loggedIn ? String(j.handle || j.name || "") : "";
      const match = !acc.handle || page || !profile ? !!j.loggedIn : norm(j.handle) === norm(acc.handle);
      const opens = profile ? !!j.profileOpens : null;
      const errs = [
        !j.loggedIn ? "Not logged in" : !match ? `Logged in as ${seen}, the account says ${acc.handle}` : "",
        opens === false ? `Profile did not open: ${profile}` : "",
      ].filter(Boolean);
      check = { at: new Date().toISOString(), ok: !errs.length, via: "pb", seen, ...(profile ? { profile, profileOpens: opens, profileSeen: String(j.profileHandle || "") } : {}), ...(errs.length ? { error: errs.join(" · ") } : {}) };
    }
  } catch (e) {
    check = { at: new Date().toISOString(), ok: false, via: "pb", error: String(e.message).slice(0, 200) };
  } finally {
    busy.delete(key);
    if (tab) releaseTab(tab.targetId);
  }
  update((st) => { const a = st.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === accountId); if (a) a.check = check; });
  return { ok: true, check };
}

const HOW = {
  linkedin: "On LinkedIn open the 'Start a post' box, write the text exactly, add the image as media (uncropped), press 'Post'.",
  x: "On X write the text exactly into the new post box and press 'Post'. If there are several tweets, share the first, then add each one in order as a reply to the previous one (a thread); or add them all at once with + in the compose window and press 'Post all'.",
  threads: "On Threads write the text exactly into the new post box and press 'Post'.",
  instagram: "On Instagram open a new post with 'Create' (+), upload the images to the file input in order (the video for Reels). THE CROP STEP IS MANDATORY: Instagram web crops to a square (1:1) by default, which is not acceptable. On the crop screen press the crop button at the bottom left and choose 'Original' (video must show 9:16, images 4:5); then look at the preview with take_screenshot: the top and bottom of the image or video must not be cut off, all of it must be visible. If it looks square or the edges are cut, DO NOT SHARE, fix it or report an error. Then Next, write the text exactly into the caption, press 'Share'.",
  tiktok: "On the TikTok upload page upload the video to the file input, write the text exactly into the description, press 'Post'.",
  youtube: "In YouTube Studio upload the video with 'Create' > 'Upload videos'; write the first line of the text (at most 100 characters) as the title and the whole text as the description; choose not made for kids, visibility 'Public', publish.",
};

// Shares the post in the account's Chrome. The result is written to the run: posted + postUrl or publish.error.
export function publish(runId) {
  const { state: s } = read();
  const run = s.runs.find((r) => r.id === runId);
  if (!run?.post && !run?.body) return { ok: false, error: "No post" };
  if (run.status === "posted") return { ok: false, error: "Already shared" };
  // The server checks too: an old card or another client cannot share an unapproved (or un-approved) output.
  if (run.status !== "approved") return { ok: false, error: "Approve it first" };
  if (missingImage(run)) return { ok: false, error: "Image missing; a LinkedIn post is not shared without its image" };
  const task = s.tasks.find((t) => t.id === run.taskId);
  const acc = accountOf(s, taskRef(s, task));
  if (!canPublishAcc(acc)) return { ok: false, error: "This account cannot be shared from the browser" };
  const panel = panelUrl(acc);
  // If the Playgrounds browser is installed Rou shares there, in the world's profile; otherwise in the account's linked Chrome.
  const pb = pbInstalled();
  if (!pb && !acc.browser) return { ok: false, error: "The account is not linked to a Chrome" };
  if (busy.has(runId)) return { ok: false, error: "Already being shared" };
  busy.add(runId);
  let files;
  try { files = shareFiles(run, acc.platform); } catch (e) { busy.delete(runId); return { ok: false, error: `Could not merge the attachments into one video: ${e.message}`.slice(0, 300) }; }
  const text0 = run.post ? bodyOf(run.post) : run.body;
  // Reply or quote on X: if the text has a tweet address and the task's note/revision says "reply" or "quote",
  // no new tweet is posted; that tweet is opened and replied to or quoted, and the address is removed from the text.
  const notes = [task?.title, task?.notes, ...(task?.revisions ?? []).map((r) => r.note)].join("\n");
  const linked = acc.platform === "x" && (run.post?.quote ? ["quote", run.post.quote.url] : run.post?.reply ? ["reply", run.post.reply.url] : null);
  const target = linked ? linked[1] : acc.platform === "x" && String(text0 ?? "").match(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+\S*/)?.[0];
  const mode = linked ? linked[0] : target && (/al[ıi]nt[ıi]|quote|quoting/i.test(notes) ? "quote" : /yan[ıi]t|reply/i.test(notes) ? "reply" : null);
  const text = mode ? String(text0).replace(target, "").replace(/\n{3,}/g, "\n\n").trim() : text0;
  const onTweet = mode && `This post is NOT a new tweet: it will be shared as a ${mode === "quote" ? "QUOTE" : "REPLY"} to this tweet: ${target.split("?")[0]}\nOpen that address. ${mode === "quote" ? "Press the Repost button under the tweet, choose 'Quote' from the menu; check that the quoted tweet shows in the window that opens, write the text, upload the files below (if any) to this window's media input and see that they uploaded, then press 'Post'." : "Press the Reply button under the tweet; check that the tweet being replied to shows in the window that opens, write the text, upload the files below (if any) to this window, press 'Reply'."} If the tweet does not open or was deleted, SHARE NOTHING and report an error.`;
  const tweets = run.post?.format === "thread" ? run.post.tweets : null;
  const set = (p) => update((st) => { const r = st.runs.find((x) => x.id === runId); if (r) Object.assign(r, p); });
  // Retry:
  // Rou is told why the previous attempt failed; if it stopped midway the post may be out, so it checks the profile first.
  const prev = run.publish?.reason || run.publish?.error || "";
  const again = !!prev || (run.tried ?? []).includes("claude");
  set({ publish: { phase: again ? "Rou is trying again" : "Rou is sharing", at: new Date().toISOString(), by: "claude" }, tried: [...new Set([...(run.tried ?? []), "claude"])] });
  const head = String(text0 ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 120) ?? "";
  const retryLine = again ? [
    `This post was tried before and did not finish${prev ? `. Result of the previous attempt: ${prev.replace(/\s+/g, " ").slice(0, 300)}` : ""}.`,
    `FIRST open the account's own profile and look at the latest posts: if this post (first line: "${head}") is already shared, DO NOT SHARE AGAIN; write posted true and that post's address.`,
    "If it is not shared, close any draft or share window left open by the previous attempt (do not save the draft) and share from the start, once. If the previous attempt got stuck on a step (file upload, account switch), try that step another way; for example upload the files one by one and see that they uploaded.",
  ].join("\n") : "";
  const world = s.worlds.find((w) => w.accounts?.some((a) => a.id === acc.id));
  // Site panel: the post is entered in the panel as new content; the account note (voice) is the panel's rule (draft or published).
  const panelPrompt = (tab) => [
    `The user approved this post in the app. Your task: enter the post once as new content in the admin panel of the ${platformName(acc)} site.`,
    rouRules(tab, acc.secret ? acc : null),
    retryLine,
    `In this tab go to ${panel}. If not logged in and no login details were given, DO NOTHING, stop and report a "not logged in to the panel" error.`,
    acc.voice ? `Panel rule (account note): ${acc.voice}` : "",
    "Find the section in the panel that fits the post (in the menu, like Blog, Posts, News) and open the new content form. If content with the same title already exists, do not open a new one, update it.",
    "Fill the fields from the post: name or title = the first line of the text; short summary (pitch, description summary) = one sentence from the first paragraph; main text (description, body) = the text other than the title line, leaving a blank line between paragraphs. If the panel has separate link fields, do not write the link lines at the end of the text (\"App Store:\", address lines) into the main text, enter them in the link fields with their label (App Store, Instagram, Site); if there is no link field, leave them in the text. If there is a tag field, write 3-5 short, searchable tags (type, platform, tool used; e.g. game, ios, godot, AI). If there is a stage field, pick it from the project's status (Live if it is published). If the slug is empty, make a short slug from the title (at most 6 words). Leave a field you do not know empty, invent nothing.",
    files.length ? `Cover image: upload this file to the image field with the upload_file tool (do not click the file button), verify in the preview that it uploaded:\n${files[0]}` : "No cover image; leave the image field empty.",
    "Status: the user approved the post in the app, this is the publishing approval. Set the status to Published (unless the account note explicitly says \"leave as draft\"). Press Save only once.",
    "Before finishing, check (in the same tab, without opening a new one): open the post on the public page of the site (in the list and on its own page). The title, cover image, paragraphs and links must show. If the page does not open or something looks broken, write it to error (posted can still be true). Change or delete no other content in the panel.",
    `Text (exactly):\n<<<\n${text}\n>>>`,
    'Write ONLY this JSON: {"posted": true|false|"unknown", "draft": true|false, "url": "public address of the post on the site (NOT the admin panel address; empty if you could not find it)", "error": "what went wrong if it was not saved or you saw a problem on the site"}',
  ].filter(Boolean).join("\n\n");
  const prompt = (tab) => panel ? panelPrompt(tab) : [
    "The user approved sharing this post on their own account in the app. Your task: share the post once on the account below, exactly as written.",
    tab ? rouRules(tab, acc.secret ? acc : null) : selectLine(acc.browser),
    retryLine,
    `Platform: ${platformName(acc)}. Account: ${acc.handle || acc.name}. ${tab ? "In this tab" : "In a new tab"} open ${HOME[acc.platform]}.`,
    acc.handle ? `BEFORE SHARING: verify that the logged-in handle is ${acc.handle}. If another account is logged in, first switch to ${acc.handle} from the platform's own account switcher (Instagram: profile photo or the "More" menu > "Switch accounts"; X: the account menu at the bottom left; LinkedIn and others: the profile menu). If the account is not in the list and login details were given, log in from there with "log into existing account". After switching, verify the handle again. If it is still not ${acc.handle} or you cannot log in, SHARE NOTHING, stop and report an error.` : "Before sharing, note which account is logged in.",
    onTweet || HOW[acc.platform],
    tweets && !mode ? `Thread, ${tweets.length} tweets, in order:\n${tweets.map((x, i) => `--- ${i + 1} ---\n${x}`).join("\n")}` : `Text (exactly, with its line breaks):\n<<<\n${text}\n>>>`,
    mentionRule(run.post),
    acc.platform === "x" && files.length > 1 && /\.(mp4|mov)$/i.test(files[0]) ? `On X a video and images do not go in the same tweet: the first file (the video) is uploaded to the first tweet with the text; the remaining ${files.length - 1} images are uploaded, without text, to a second tweet added in the same share as a reply to the first.` : "",
    files.length ? `Files to upload (in this order; do not click the file button, use the file upload tool (file_upload or upload_file) on the file input):\n${files.join("\n")}` : "No files.",
    "Rules: do not change the text or add to it. Press the share button only once. If you are not sure whether it was shared, do not retry; check the latest post on the profile. Change nothing else on the account or the site, send no messages, like nothing. When done, try to find the address of the shared post. Leave the tab you opened open.",
    'Write ONLY this JSON: {"posted": true|false|"unknown", "url": "address of the post or empty", "account": "handle of the account it was shared on", "error": "reason if it was not shared"}',
  ].filter(Boolean).join("\n\n");
  // started.failed: Rou never got started in the browser (no app, tab did not open); then the post is certainly not out.
  const started = { failed: false };
  // Uploading images and video (Instagram carousel, video) can take over 10 minutes; the limit grows with the file count.
  const LIMIT = Math.min(30, 12 + files.length * 3) * 60 * 1000;
  const tr = tracker(runId, "publish", { name: pb ? PB_NAME : acc.browser?.name });
  const live = { onTool: tr.onTool, onResult: tr.onResult };
  const start = async () => {
    if (!pb && panel) { started.failed = true; return { ok: false, error: `Logging in to the site panel is done with ${PB_NAME}; the app is not installed` }; }
    if (!pb) return runClaude(prompt(null), LIMIT, undefined, { args: chrome(POST_TOOLS), cwd: MEDIA_DIR, ...live });
    let tab;
    try { tab = await rouTab(world, `share-${runId}`, `Rou is sharing · ${platformName(acc)}`, acc.platform); } catch (e) { started.failed = true; return { ok: false, error: e.message }; }
    return runClaude(prompt(tab), LIMIT, undefined, { args: rouArgs(MEDIA_DIR, [], [], { read: acc.platform === "instagram" }), cwd: MEDIA_DIR, ...live }).finally(() => releaseTab(tab.targetId));
  };
  const done = start().then((r) => {
    busy.delete(runId);
    tr.stop();
    const j = r.ok ? json(r.out) : null;
    if (j?.posted === true) { import("./notify.mjs").then(({ notify }) => notify(panel ? (j.draft ? "Post entered in the panel as a draft" : j.error ? `Post is live but: ${j.error}`.slice(0, 120) : "Post is live on the site") : "Post shared", read().state.runs.find((x) => x.id === runId)?.title ?? ""));
      // Site panel: keep the post's public address on the site, not the panel address (dropped if it is the panel's path).
      const url = typeof j.url === "string" && !(panel && new URL(panel).pathname.length > 1 && j.url.includes(new URL(panel).pathname)) ? j.url : undefined;
      return update((st) => void markPosted(st, runId, { url })); }
    // If Rou could not write a result (time ran out, reply unreadable) the post may be out: it is not called "could not share", a check is asked for.
    // Otherwise "Try again" or sharing by hand would post the same post twice.
    const never = started.failed || /Claude oturumu kapalı|Claude çalıştırılamadı|Claude is signed out|could not be started/.test(r.error ?? "");
    const unsure = j?.posted === "unknown" || (!j && !never);
    const why = j ? "" : ` (Rou could not write a result: ${String(r.error || "reply unreadable").replace(/\s+/g, " ").slice(0, 90)})`;
    const error = unsure ? `Could not tell whether it was shared${why}. Check your profile; if it was shared, press 'I shared it'.` : (j?.error || r.error || "Could not read the reply").slice(0, 300);
    update((st) => void markPosted(st, runId, { error }));
  }).catch((e) => {
    // If the output is deleted while sharing, markPosted throws; uncaught it would take the whole server down.
    busy.delete(runId);
    tr.stop();
    console.error("share:", e?.message ?? e);
  });
  return { ok: true, done };
}

// Rou logs in to the account in the Playgrounds browser profile of the account's world (if the session dropped).
// Rou does not type passwords: if the session is closed or a verification code or CAPTCHA appears it stops; the user logs in in the browser.
export function pbLogin(accountId) {
  const s = read().state;
  const world = s.worlds.find((w) => w.accounts?.some((a) => a.id === accountId));
  const acc = world?.accounts.find((a) => a.id === accountId);
  const site = acc && SITES[acc.platform];
  if (!acc || !site) return { ok: false, error: "No browser login for this account" };
  if (!pbInstalled()) return { ok: false, error: `${PB_NAME} is not installed` };
  const key = `login-${accountId}`;
  if (busy.has(key)) return { ok: false, error: "Already logging in" };
  busy.add(key);
  const set = (p) => update((st) => { const a = st.worlds.flatMap((w) => w.accounts ?? []).find((x) => x.id === accountId); if (a) a.pbLogin = { ...p, at: new Date().toISOString() }; });
  set({ phase: "Rou is logging in" });
  const done = (async () => {
    let tab;
    try {
      tab = await rouTab(world, key, `Rou is logging in · ${platformName(acc)}`, acc.platform);
      const prompt = [
        `Your task: log in to the ${platformName(acc)} account (${acc.handle || acc.login || acc.name}). Do nothing else.`,
        rouRules(tab, acc),
        `In this tab go to ${site.home}. If the account is already logged in, do not log in, only find out which account it is. If not, log in at ${site.login}.`,
        acc.handle ? `After logging in, verify that the logged-in account is ${acc.handle}.` : "",
        "Do not share, like, message or change settings. Leave the tab open when done.",
        'Write ONLY this JSON: {"loggedIn": true|false, "handle": "handle of the logged-in account or empty", "error": "why you could not log in"}',
      ].filter(Boolean).join("\n\n");
      const r = await runClaude(prompt, 6 * 60 * 1000, undefined, { args: rouArgs(), cwd: MEDIA_DIR });
      const j = r.ok ? json(r.out) : null;
      if (j?.loggedIn) set({ ok: true, seen: String(j.handle || "") });
      else set({ ok: false, error: String(j?.error || r.error || "Could not read the reply").slice(0, 300) });
    } catch (e) {
      set({ ok: false, error: String(e.message).slice(0, 300) });
    } finally {
      busy.delete(key);
      if (tab) releaseTab(tab.targetId);
    }
  })();
  return { ok: true, done };
}
