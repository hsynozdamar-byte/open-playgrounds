import { PLATFORMS, TEXT_FORMATS, bodyOf, formatsOf, isFeed, postOfText, taskRef } from "./social.mjs";

// Revisions: every revision note the user gives a task stays in task.revisions (never deleted, newest last).
// task.revise is only the note for the next prepare (the scheduler's pending flag lives there). Rou sees ALL notes on each prepare;
// an old request stands unless a newer note contradicts it. A request it cannot do is not skipped silently: it says so with an UNABLE line.
export const MAX_REVISIONS = 30;

export function addRevision(task, { note, prev = "", runId, pending, files, moved } = {}) {
  const list = Array.isArray(files) ? files.filter((f) => f?.file) : [];
  const text = String(note ?? "").trim().slice(0, 2000) || (list.length ? "Use the files I attached and add them to the output." : "");
  if (!text) return null;
  const at = new Date().toISOString();
  const r = { at, note: text, ...(runId ? { runId } : {}), prev: String(prev).slice(0, 4000), ...(list.length ? { files: list } : {}), ...(moved ? { moved } : {}) };
  task.revisions = [...(task.revisions ?? []), r].slice(-MAX_REVISIONS);
  task.revise = { note: text, prev: r.prev, at, ...(pending ? { pending: true } : {}) };
  return r;
}

// Revision move: if the note asks for another world, project or account, the post moves there. An automation task detaches
// from its automation and becomes a one-off POST task (task.post); the automation itself is unchanged. The next prepare then
// rewrites it with the new account's voice, language, project brand and Notes sources. { error } if invalid, null if nothing changes.
export function movePost(s, task, { worldId, projectId, accountId } = {}) {
  if (!task || (!worldId && !projectId && !accountId)) return null;
  const owner = accountId ? s.worlds.find((w) => (w.accounts ?? []).some((a) => a.id === accountId)) : undefined;
  const acc = owner?.accounts.find((a) => a.id === accountId);
  if (accountId && (!acc || isFeed(acc.platform))) return { error: "No such account" };
  const proj = projectId ? s.projects.find((p) => p.id === projectId) : undefined;
  if (projectId && !proj) return { error: "No such project" };
  const world = worldId ?? proj?.worldId ?? owner?.id ?? task.worldId;
  if (!s.worlds.some((w) => w.id === world)) return { error: "No such world" };
  if (proj && proj.worldId !== world) return { error: "Project is not in that world" };
  if (owner && owner.id !== world) return { error: "Account is not in that world" };
  const ref = taskRef(s, task);
  const from = { worldId: task.worldId, projectId: task.projectId ?? null, accountId: ref?.accountId ?? null, autoId: task.autoId ?? null };
  const auto = task.autoId ? s.automations?.find((a) => a.id === task.autoId) : undefined;
  const format = acc ? (formatsOf(acc.platform).includes(ref?.format) ? ref.format : formatsOf(acc.platform)[0]) : ref?.format;
  if (task.autoId) {
    // The automation's who-prepares / who-shares settings carry over to the task; the topic becomes the post brief.
    if (!task.who && auto?.who) task.who = auto.who;
    if (!task.sharer && auto?.sharer) task.sharer = auto.sharer;
    if (task.topic?.title && auto && task.title === auto.title) task.title = task.topic.title;
    const brief = task.topic?.title ? `${task.topic.title}${task.topic.brief ? `. ${task.topic.brief}` : ""}` : task.notes || auto?.action || "";
    task.post = { accountId: "", brief, ...(task.autoSlot ? { at: task.autoSlot } : {}) };
    for (const k of ["autoId", "autoSlot", "autoDay", "format"]) delete task[k];
  }
  if (acc || task.post) task.post = { brief: "", ...task.post, accountId: acc?.id ?? task.post?.accountId ?? ref?.accountId ?? "", ...(format ? { format } : {}) };
  task.worldId = world;
  task.projectId = proj?.id ?? (world === from.worldId ? task.projectId : null);
  return { from, to: { worldId: world, projectId: task.projectId ?? null, accountId: task.post?.accountId || null } };
}

// Copy post: share an output on another account too ("share this on Threads and LinkedIn as well").
// The copy is always a POST task (task.post { accountId, format, at }), not a plain task: otherwise it does not show on Posts
// and it is unclear which account shares it. Text and media pass through unchanged; the copy waits at "Waiting for approval".
// Only copies to text formats (LinkedIn, X, Threads); Instagram / vertical video are moved with a revision instead.
// ids: { taskId, runId } are the new ids. { error } if invalid.
export function copyPost(s, runId, accountId, { day, at, ids, now = new Date().toISOString() } = {}) {
  const run = s.runs.find((r) => r.id === runId);
  const src = run && s.tasks.find((t) => t.id === run.taskId);
  if (!run || !src) return { error: "No such output" };
  const text = (run.body?.trim() || (run.post ? bodyOf(run.post) : "")).trim();
  if (!text) return { error: "The output has no text" };
  const owner = s.worlds.find((w) => (w.accounts ?? []).some((a) => a.id === accountId));
  const acc = owner?.accounts.find((a) => a.id === accountId);
  if (!acc || isFeed(acc.platform)) return { error: "No such account" };
  const formats = formatsOf(acc.platform).filter((f) => TEXT_FORMATS.includes(f));
  if (!formats.length) return { error: `Cannot copy to ${PLATFORMS[acc.platform]?.label ?? acc.platform}; move it with a revision note instead` };
  const ref = taskRef(s, src);
  if (ref?.accountId === acc.id) return { error: "The post is already on this account" };
  const format = formats.includes(run.post?.format) ? run.post.format : formats[0];
  // Project: the one using the account, else the source's project if it is in the same world.
  const proj = s.projects.find((p) => p.worldId === owner.id && p.status !== "done" && p.accountIds?.includes(acc.id))
    ?? (src.worldId === owner.id ? s.projects.find((p) => p.id === src.projectId) : undefined);
  const when = at ?? src.post?.at ?? src.autoSlot;
  const task = {
    id: ids.taskId, worldId: owner.id, projectId: proj?.id ?? null, title: `${src.title} · ${PLATFORMS[acc.platform]?.label ?? acc.platform}`,
    notes: src.post?.brief ?? src.notes ?? "", status: "todo", day: day ?? src.day ?? now.slice(0, 10), deadline: null, estimate: null, checklist: [],
    by: "claude", createdAt: now, who: "claude", ...(src.sharer ? { sharer: src.sharer } : {}),
    post: { accountId: acc.id, format, brief: src.post?.brief ?? "", ...(when ? { at: when } : {}) },
  };
  const copy = {
    id: ids.runId, taskId: task.id, at: now, title: task.title, body: text, status: "ready", by: run.by ?? "claude", copyOf: run.id,
    images: [...(run.images ?? [])], ...(run.video ? { video: run.video } : {}), ...(run.cover ? { cover: run.cover } : {}),
    post: { ...postOfText(format, text), ...(run.post?.mentions?.length ? { mentions: [...run.post.mentions] } : {}) },
  };
  s.tasks.push(task);
  s.runs.unshift(copy);
  return { task, run: copy };
}

// Old data had only task.revise: if the history is empty, treat it as the first entry.
export const revisionsOf = (task) => task?.revisions?.length ? task.revisions : task?.revise?.note ? [{ at: task.revise.at, note: task.revise.note, prev: task.revise.prev ?? "" }] : [];

export function reviseBlock(task) {
  const list = revisionsOf(task);
  if (!list.length) return "";
  const last = list.at(-1);
  return [
    "REVISION (the most important part; it comes before all other rules):",
    `The user has written ${list.length} revision note(s) on this task's outputs. All of them stand; if a newer note contradicts an older one, the newer wins. Apply every request in the notes one by one and keep what the user liked.`,
    list.map((r, i) => `${i + 1}. ${r.at ? r.at.slice(0, 16).replace("T", " ") : ""}${i === list.length - 1 ? " (LATEST)" : ""}: ${r.note}${r.clear ? `\n   Clarified request: ${r.clear.ask}${r.clear.keep.length ? ` Keep: ${r.clear.keep.join("; ")}.` : ""}` : ""}${r.files?.length ? `\n   Files attached (look with Read; they are added to the output automatically, so the text and visuals must fit them): ${r.files.map((f) => f.kind === "video" ? `video data/media/${f.file}${f.frames?.length ? ` (work out what the video shows from these frames, open them with Read: ${f.frames.map((x) => `data/${x}`).join(", ")}${f.said ? `; said in the video: "${f.said}"` : ""}; the video goes into the post as it is, so the text must describe what the video really shows)` : ""}` : `image data/media/${f.file}`).join(", ")}` : ""}`).join("\n"),
    bansOf(task).length ? `MUST NEVER APPEAR (text, scenes, on-image or on-video text, caption, hashtags; nowhere, not even as an example): ${bansOf(task).join(", ")}` : "",
    // The first attempt was checked against the note and fell short (server/prepare.mjs revised): the second pass only completes these.
    last.redo?.length ? `MISSING FROM THE FIRST ATTEMPT (the draft still does not do these; you must do them this round, and do not break what is already done):\n${last.redo.map((x) => `- ${x}`).join("\n")}` : "",
    last.moved ? "This revision moved the post elsewhere (the world, project or account changed). The last output was written in the old account's voice: do not fix it, rewrite it from scratch with the current account's voice, language, project brand and Notes sources; take only the real facts from its content." : "",
    last.prev ? `Last output (fix this):\n"""\n${last.prev}\n"""` : "",
    "If you cannot do a request in this output (e.g. this format cannot carry a video, the link is unknown), do not change the text as if you had done it and do not skip it silently: at the VERY END of the output, on separate lines, write `UNABLE: <request> | <reason>` (if JSON was asked for, outside the JSON, below it).",
  ].filter(Boolean).join("\n");
}

// Splits the UNABLE lines (old marker: YAPILAMADI) out of the output: { text: output without those lines, gaps: [{ ask, why }] }.
export function splitGaps(out) {
  const gaps = [];
  const text = String(out ?? "").split("\n").filter((l) => {
    const m = l.trim().replace(/^[-•*`]+\s*/, "").match(/^(?:UNABLE|YAPILAMADI)\s*:\s*(.+?)\s*(?:\|\s*(.+?))?`?$/i);
    if (!m) return true;
    gaps.push({ ask: m[1].trim().slice(0, 200), why: (m[2] ?? "").trim().slice(0, 300) });
    return false;
  }).join("\n").trim();
  return { text, gaps };
}

// Revision check: every revision's output is checked against the note (text, images and video frames). The checker answers {"missing":[{"what","part":"text|media"}]}; a plain string is accepted too (counts as text).
export function parseMissed(out) {
  const m = String(out ?? "").match(/\{[\s\S]*\}/);
  let j;
  try { j = m ? JSON.parse(m[0]) : null; } catch { return []; }
  return (Array.isArray(j?.missing) ? j.missing : [])
    .map((x) => (typeof x === "string" ? { what: x } : x))
    .filter((x) => x && String(x.what ?? "").trim())
    .map((x) => ({ what: String(x.what).trim().slice(0, 200), part: x.part === "media" ? "media" : "text" }))
    .slice(0, 4);
}
// Second pass that completes what is missing: a `redo` list is added to the last note (the original note and its clarification
// stay as they are) and only the side that fell short (text, visual or both) is redone.
export function redoTask(task, missed) {
  const list = revisionsOf(task);
  return { ...task, revisions: [...list.slice(0, -1), { ...list.at(-1), redo: missed.map((m) => m.what) }] };
}
export const redoScope = (missed) => ({ text: missed.some((m) => m.part !== "media"), visual: missed.some((m) => m.part === "media") });

// All files attached in revisions (oldest to newest, deduplicated): added to the output.
// If a later note criticised the visual ("mock is awful", "the image is wrong"), the visual attachments before it are dropped;
// otherwise the disliked attachment would be put first on every new prepare.
export const revisionFiles = (task) => {
  const revs = revisionsOf(task);
  let cut = -1;
  revs.forEach((r, i) => { if (!r.files?.length && VISUAL.test(fold(r.note))) cut = i; });
  const seen = new Set();
  return revs.flatMap((r, i) => (i > cut ? r.files ?? [] : [])).filter((f) => !seen.has(f.file) && seen.add(f.file));
};

// What the revision note touches: text, image/video, or both. Users often type without Turkish characters and in mixed case
// ("GORSELI DUZNELE SADECE"); the stems match that too (Turkish and English words). If neither matches, both count.
const fold = (t) => String(t ?? "").toLocaleLowerCase("tr").replace(/[çc]/g, "c").replace(/[ğg]/g, "g").replace(/[ıi]/g, "i").replace(/[öo]/g, "o").replace(/[şs]/g, "s").replace(/[üu]/g, "u");
export const visualNote = (n) => VISUAL.test(fold(n));
const VISUAL = /gorse|gorsl|video|vido|resim|foto|slayt|slide|kapak|ekran goru|logo|goruntu|animasyon|kasiyor|render|tasarim|image|picture|photo|visual|cover|screenshot|animation|clip|design|thumbnail|footage/;
// Content requests are text too: "I need something about the game" changes the text even if a visual word appears.
const TEXT = /metin|meti|yazi|cumle|dil\b|dili|ton\b|baslik|paragraf|kelime|ifade|anlat|hikaye|giris|kapanis|link|ingilizce|turkce|emoji|hashtag|bahs|bhas|soyle|icerik|konu|tweet|twit|gonderi|karakter|rol|text\b|copy\b|wording|caption|sentence|headline|tone\b|paragraph|word\b|english|turkish|story|intro|ending|about|mention|content|topic|post\b|character|role/;
export function reviseScope(note) {
  const n = fold(note);
  const visual = VISUAL.test(n), text = TEXT.test(n);
  return visual || text ? { text, visual } : { text: true, visual: true };
}

// Is this prepare a revision: the latest note was given to an earlier output and no other output came after it (except the current one).
// If so { rev, prev, scope }: Rou does not rewrite from scratch, it edits the earlier output according to the note.
export function revisionMode(s, task, runId) {
  const rev = revisionsOf(task).at(-1);
  if (!rev?.runId || rev.moved) return null;   // moved to another account: the old text is not fixed, it is rewritten in the new account's voice
  const prev = (s.runs ?? []).find((r) => r.id === rev.runId && r.taskId === task.id);
  if (!prev || !(prev.post || prev.body)) return null;
  const newer = (s.runs ?? []).some((r) => r.taskId === task.id && r.id !== runId && r.id !== prev.id && r.at > rev.at && r.status !== "failed");
  if (newer) return null;
  return { rev, prev, scope: rev.clear ? { text: rev.clear.text || !rev.clear.visual, visual: rev.clear.visual || rev.clear.media === "new" || asksMedia(task) } : reviseScope(rev.note) };
}

// Does the last revision explicitly not want attachments ("text only", "no image", "no video"): the post goes out without any.
// "Quote" alone does not mean no attachment; no new one is made, the existing one is carried.
export const noMediaNote = (task) => task?.revisions?.at(-1)?.clear?.media === "none" || /(sadece|yaln[ıi]z) metin|g[öo]rsel(siz| olmas[ıi]n)|videosuz|(text|copy)[- ]only|only (the )?text|no (image|visual|video|media|picture|photo)s?\b|without (an? )?(image|visual|video|media|picture|photo)s?/i.test(task?.revisions?.at(-1)?.note ?? "");
// Request for a quote post (quote on X): "alıntıla", "alıntı olarak paylaş", "quote tweet", "quote this". "Quote cards" as a
// topic is not this.
export const quoteNote = (task) => /al[ıi]nt[ıi](la|y[ıi]|s[ıi]n|\s+(olarak|yap|at\b|tweet|g[öo]nderi|payla))|quote[- ]?(tweet|post|olarak|et\b|it\b|this|le)|\bqt\b/i.test(task?.revisions?.at(-1)?.note ?? "");
// The note says the existing image/video is missing ("video is missing", "no image"): a new one is not made, the earlier one is carried.
export const missingMediaNote = (task) => {
  if (task?.revisions?.at(-1)?.clear?.media === "keep") return true;
  const n = fold(task?.revisions?.at(-1)?.note);
  return /(vid|vdi|gorsel|kapak|resim)\S*\s+(bile\s+)?(eksik|yok|dus|kayb|gitm)|(eksik|kayip)\s+(vid|gorsel)|(video|image|visual|cover|picture|photo)\s+(is\s+|was\s+)?(missing|gone|lost)|missing\s+(video|image|visual|cover)|(lost|dropped|removed)\s+the\s+(video|image|visual|cover)/.test(n);
};
// Does the note explicitly ask for an image/video/animation to be ADDED ("can you add the unboxing animation too"). The clarifier
// may read this as "visual: false"; if the note clearly asks, the clarification is overridden.
export const asksMedia = (task) => {
  const n = fold(task?.revisions?.at(-1)?.note);
  if (/(sadece|yalniz) metin|gorsel(siz| olmasin)|videosuz|video(yu)? (kaldir|cikar|sil)|(text|copy)[- ]only|no (image|visual|video|media)s?\b|without (an? )?(image|visual|video|media)s?|(remove|drop|delete) the (video|image|visual)/.test(n)) return false;
  // Notes that change an existing attachment ("make the visual simpler") do not count here: only adding verbs (and "olsun"/"include" for moving recordings).
  const add = /(video|vid[oe]|animasyon|gif|gorsel|ekran (goruntu|kayd)|kaydi|klip|reveal|footage)\S*(\s+\S+){0,6}?\s+(ekle|koy|kullan|kaydet|cek)|(add|include|use|attach|record|show|put|insert)\s+(\S+\s+){0,5}?(video|animation|gif|screen ?recording|recording|clip|reveal|footage|image|visual|screenshot)/;
  const motion = /(video|animasyon|gif|ekran kaydi|kaydi|klip)\S*\s+(de |da )?olsun|(video|animation|gif|screen ?recording|clip) (too|as well)|should (have|include) (a |an )?(video|animation|gif|clip)/;
  return add.test(n) || motion.test(n);
};
// A task's permanent visual rules: the automation's lines + the world's lines (world.visual).
export const visualRules = (s, task) => {
  const a = task?.autoId && s.automations?.find((x) => x.id === task.autoId);
  const w = s.worlds?.find((x) => x.id === (task?.worldId ?? a?.worldId));
  const lines = [...String(a?.visual ?? "").split("\n"), ...String(w?.visual ?? "").split("\n")].map((x) => x.trim()).filter(Boolean);
  return [...new Set(lines)].join("\n");
};
// Does one of the rules require a visual/video on every post ("X posts must always have a visual").
// shortcut: the free-text rule is read with a regex; switch to a switch in the automation form ("real visual on every post") when it exists.
export const alwaysMedia = (rules) => String(rules ?? "").split("\n").map(fold).some((l) =>
  !/\b(ekleme|kullanma|koyma|olmasin|never|dont|do not|no)\b/.test(l) && (/(\bher (zaman|gonderi\S*)|\bmutlaka|\bhep)\b.*(gorsel|video|animasyon|gif|kayit|kaydi)\S*.*\b(bulun|olmali|olsun|ekle)\S*/.test(l) || /\b(always|every post|each post|must|required)\b.*\b(visual|video|animation|gif|image|recording|media)\S*.*\b(have|include|attach|contain|be)\b|\b(always|every post|each post)\b.*\b(include|attach|have|add)\b.*\b(visual|video|animation|gif|image|recording|media)/.test(l)));
// Does a permanent rule ask for the work itself to be shared as it is ("without extra design, the brand's own work",
// "the following frames are the work's real visuals"). If so the Instagram carousel is not drawn with template cards even in the first draft.
// shortcut: the free-text rule is read with a regex; switch to a switch in the automation form ("share the work itself") when it exists.
export const rawRule = (rules) => String(rules ?? "").split("\n").map(fold).some((l) =>
  /\b(ek|ekstra|ayri) tasarim\S* yap\S*madan|\bis(in|lerin) kendisi|\bisin gercek gorselleri|without (any )?(extra|additional) design|(the )?work itself|real (visuals|images|screens) of the work|raw (work|footage)/.test(l));
export const mediaRequired = (task) => { const c = task?.revisions?.at(-1)?.clear; return (!!c && c.visual === true && (c.media === "keep" || c.media === "new")) || asksMedia(task); };
// The attachment to carry: the earlier output's; if it has none (e.g. a failed round that came out without one), the task's newest output with an attachment.
// Outputs whose files were deleted or trashed are not in runs, so they are not picked.
export function carrySource(runs, taskId, prev, skip) {
  const has = (r) => r && (r.video || r.images?.length);
  if (has(prev)) return prev;
  return [...(runs ?? [])].filter((r) => r.taskId === taskId && r.id !== skip && has(r)).sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")))[0] ?? null;
}

// Clarification.
// The raw note is often angry, misspelled and incomplete: before preparing, Rou turns it into one clear request and writes it to
// revision.clear: { ask, keep[], ban[], media keep|new|none|any, text, visual }. The card shows it as "What Rou understood"; prepare and
// the check use it together with the raw note. ban: phrases that must appear NOWHERE in the output (text, scene, on-image text,
// hashtag); they are searched for after prepare, and if found the output does not go to approval.
export const MEDIA_WISH = ["keep", "new", "none", "any"];
// Reader version: notes an older reader (Sonnet, no context) decoded wrongly and that are not resolved yet are read again.
export const CLARITY_V = 4;
// The note asked for the work itself to be shared as it is instead of Rou's designed card ("it's fine to just add what we made
// without extra design", "just sharing the animation we made is enough"). This is permanent for the task:
// a later small note (shorten, remove that) does not bring the template card back.
export const rawWish = (task) => revisionsOf(task).some((r) => r.clear?.raw === true);
// The strongest model reads the note: it sees the earlier output's visuals and the user's project names, knows the visual changes when the
// story changes, and writes what must be learned from the work itself (need): Rou reads these from the real project before writing (server/findmedia.mjs facts).
export function clarifyPrompt(task, { account, prevText, prevMedia = "", names = [], autos = [] } = {}) {
  const list = revisionsOf(task);
  const last = list.at(-1);
  const brief = briefOf(task);
  return [
    "The user wrote a revision note on a social media post's output. Turn the note into one clear request for the team that prepares it. You are not writing the post.",
    `Post: ${task.title}${account ? ` · ${account}` : ""}`,
    brief ? `The post's instruction (brief; the writer reads it on every prepare, and it may have been written by another agent, not the user):\n"""\n${brief.slice(0, 3000)}\n"""` : "",
    list.length > 1 ? `Earlier notes (oldest to newest; still valid, a newer note wins if it contradicts):\n${list.slice(0, -1).map((r, i) => `${i + 1}. ${r.clear?.ask ?? r.note}${r.clear?.ban?.length ? ` [never: ${r.clear.ban.join(", ")}]` : ""}`).join("\n")}` : "",
    prevText ? `The output the note was given on:\n"""\n${String(prevText).slice(0, 1500)}\n"""` : "",
    `Images/video of the output the note was given on: ${prevMedia || "none"}`,
    names.length ? `Names of the user's projects (use them to decode misspelled words): ${names.join(", ")}` : "",
    `NEW NOTE:\n"""\n${last?.note ?? ""}\n"""`,
    [
      "Rules:",
      "- Drop insults and anger, keep the request. Expand abbreviations.",
      "- The note may be typed fast: letters swap, go missing or double (e.g. 'mark akimligi tasarimlairmi' = 'marka kimliği tasarımlarımı', 'portfloyo' = 'portfolyo', 'analtna' = 'anlatan'; 'brnad identiy' = 'brand identity'). Decode each word from the meaning of the sentence and the names above. Do not invent a word that changes the meaning; leave a word you cannot decode as it is.",
      "- First understand what the user is angry about: look at the output (text and visuals), find which part of it the note finds wrong and what it wants instead. If the note is short or angry ('try again', 'wrong', 'why is it missing'), complete the unmet request from the earlier notes.",
      "- ask: what changes, 1-4 short sentences, imperative and CONCRETE: what to tell, what to show. Do not write empty sentences like 'fix it', 'make it better'; do not repeat the note in other words. Include the earlier notes' requests that are still unmet. If the note dictates a sentence, quote it exactly.",
      "- Do NOT ADD requests or limits that are not in the notes: a call to action, a pointer to a site, limits like 'use only these screens' are not written unless the user said them. Where unsure, read broadly, not narrowly.",
      "- If the note questions or rejects something in the output ('what does X have to do with it', 'what is X', 'why did you put X', 'drop X'), put X in ban, drop the part of earlier notes and the instruction that asks for X; in ask, do not ask for X in the text or in the visuals.",
      "- brief: if the instruction contradicts the note or does not tell the subject the note wants (the output's error comes from the instruction), write the corrected full instruction: the rejected part removed, the subject and angle the note wants added, verified facts kept exactly. If there is no contradiction, null.",
      "- keep: things that were liked or must not be touched (empty unless the note says so).",
      "- ban: proper names or phrases that must not appear anywhere in the output (e.g. 'Project X', 'Playgrounds'). Only if the note clearly asks for it; do not put generic words.",
      "- media: keep = the existing image/video stays or it went missing and must come back; new = a new image/video must be made; none = no image, no video; any = the note does not mention media.",
      "- text / visual: whether the note changes the text, the image/video, or both.",
      "- If the note names a way of telling that it does not want in the text (story, metaphor, symbol, reference) or describes how the text should be written ('use this kind of tone', 'like \"I did X, finished it\"'), this is a text request: text true. A praise like 'this language is good, keep it' belongs to the language the note DESCRIBES unless the note clearly praises the old text; it does not mean 'keep the text as it is'. In ask, write how the new text should be using the note's own example.",
      "- ban: next to the word of the banned way of telling, also write the phrases in the earlier text that carry it (butterfly → 'wings', 'flap').",
      "- If the note asks to show, tour or record something ('let's tour the site from start to finish', 'let's show X', 'why are the other pages missing'), this is a visual request: visual true, media new.",
      "- If the note criticises the image or video in the output (wrong video, old image, too fast, bad, you put the same one), media new: the same files do not come back.",
      "- If the note changes WHAT the post tells (new angle, deeper telling, another side of the work), the visual must show the new telling too: text true, visual true, media new. keep only if the note clearly wants the visual to stay.",
      "- raw: true if the note wants the work's OWN visual, recording or animation shared as it is instead of the card, template or extra design Rou makes (e.g. 'it is fine to just add what we made without extra design', 'just sharing the animation we made is enough'). Then visual true, media new; do not ask for extra design in ask.",
      "- need: concrete things that must be learned from the work ITSELF (project code, design files, live site) to do this request well, as questions (e.g. 'how do three different user types use the app, which screens does each have?'). Fill it if the note wants the work told better, deeper or more accurately; an empty array if only tone, length or a single word changes.",
      "- general: a general lesson from this note that fits ALL future posts of the same account (e.g. 'do not make Playgrounds the subject, talk about my own design work'). A request specific to this post (the tweet to quote, a cut of this video, a sentence of this text) is not a lesson; then leave it empty.",
      "- rule: fill it if the note sets a PERMANENT rule such as 'from now on', 'always', 'in this kind of posts', 'when X posts are compiled'; otherwise null. rule.autos: ids of the automations the rule applies to (from the list below; if the note describes a group, e.g. 'game posts', all that belong to the group). rule.kind: visual (visual, cover, video, background) or text (writing). rule.text: the rule itself, one clear sentence, in English. If the rule applies only to a certain kind of subject (game posts, a specific product or brand), say so at the start of the sentence ('In game posts …'); do not generalise a request that comes from this post's subject to all of the account's posts.",
    ].join("\n"),
    autos.length ? `This world's automations (for rule.autos):\n${autos.map((a) => `- ${a.id}: ${a.title}${a.here ? " (this post's automation)" : ""}`).join("\n")}` : "",
    'Write ONLY JSON: {"ask":"...","keep":["..."],"ban":["..."],"media":"keep|new|none|any","text":true,"visual":false,"raw":false,"need":["..."],"general":"","rule":null,"brief":null}',
  ].filter(Boolean).join("\n\n");
}
export function parseClarity(out) {
  const m = String(out ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const ask = String(j?.ask ?? "").trim().slice(0, 600);
  if (!ask) return null;
  const arr = (v) => (Array.isArray(v) ? v : []).map((x) => String(x).trim()).filter((x) => x.length >= 3).slice(0, 8);
  return {
    ask, keep: arr(j.keep), ban: arr(j.ban),
    media: MEDIA_WISH.includes(j.media) ? j.media : "any",
    // A ban with no visual change belongs to the text: the text is rewritten.
    text: j.text !== false || (arr(j.ban).length > 0 && !j.visual), visual: !!j.visual, v: CLARITY_V,
    ...(j.raw === true ? { raw: true } : {}),
    ...(arr(j.need).length ? { need: arr(j.need).slice(0, 5).map((x) => x.slice(0, 240)) } : {}),
    ...(String(j.general ?? "").trim() ? { general: String(j.general).trim().slice(0, 300) } : {}),
    ...(ruleOf(j.rule) ? { rule: ruleOf(j.rule) } : {}),
    ...(typeof j.brief === "string" && j.brief.trim().length >= 20 ? { brief: j.brief.trim().slice(0, 4000) } : {}),
  };
}
// The post's instruction: the writer reads it (server/prepare.mjs). If the revision reader corrects it, setBrief changes it and the old one stays on the revision.
export const briefOf = (task) => String(task?.post ? task.post.brief || task.notes || "" : task?.notes || "");
export function setBrief(task, rv, brief) {
  if (!brief || !task || !rv || brief === briefOf(task)) return false;
  rv.prevBrief = briefOf(task);
  if (task.post?.brief) task.post.brief = brief; else task.notes = brief;
  return true;
}
// Permanent rule: if a revision says "from now on, always" to a group, it is written to the automations' permanent rules (server/prepare.mjs saveRule).
function ruleOf(r) {
  const text = String(r?.text ?? "").trim().slice(0, 300);
  const autos = (Array.isArray(r?.autos) ? r.autos : []).map(String).filter((x) => /^[a-z0-9]{4,12}$/i.test(x)).slice(0, 12);
  if (!text || !autos.length) return null;
  return { text, autos, kind: r.kind === "text" ? "text" : "visual" };
}
// Writes the permanent rule to the automation: a visual rule to automation.visual, a text rule to the end of the instruction.
// The same rule is not written twice. Returns the ids of the automations the rule was written to.
export function saveRule(state, worldId, rule) {
  const done = [];
  for (const a of state.automations ?? []) {
    if (!rule?.autos?.includes(a.id) || a.worldId !== worldId) continue;
    const line = `- ${rule.text}`;
    if (rule.kind === "visual") { if (!(a.visual ?? "").includes(rule.text)) a.visual = [a.visual?.trim(), line].filter(Boolean).join("\n"); }
    else if (!(a.action ?? "").includes(rule.text)) a.action = `${(a.action ?? "").trim()}\nPermanent rule: ${rule.text}`.trim();
    done.push(a.id);
  }
  // A rule covering several automations is written to the world too, so automations created later follow it.
  const w = done.length >= 2 && (state.worlds ?? []).find((x) => x.id === worldId);
  if (w) {
    if (rule.kind === "visual" && !(w.visual ?? "").includes(rule.text)) w.visual = [w.visual?.trim(), `- ${rule.text}`].filter(Boolean).join("\n");
  }
  return done;
}
// Bans from all notes (deduplicated). A later note can lift a ban: "add X back / use X" drops it.
export function bansOf(task) {
  const out = new Map();
  for (const r of revisionsOf(task)) {
    for (const b of r.clear?.ban ?? []) out.set(fold(b), b);
    for (const k of [...out.keys()]) if (new RegExp(`${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.{0,30}(geri ekle|kullan|olsun|kalsin|add (it )?back|use (it|them)|bring (it )?back|keep)`).test(fold(r.note)) && !(r.clear?.ban ?? []).some((b) => fold(b) === k)) out.delete(k);
  }
  return [...out.values()];
}
// Bans found in the output. A quoted/replied tweet (someone else's text) does not count.
export function banHits(task, out) {
  const bans = bansOf(task);
  if (!bans.length || !out) return [];
  const { quote, reply, ...post } = out.post ?? {};
  const hay = fold([out.body, JSON.stringify(post), JSON.stringify(out.storyboard ?? "")].join("\n"));
  return bans.filter((b) => hay.includes(fold(b)));
}

// Revisions given to earlier tasks of the same automation (or the same account's one-off posts): so a new post and the topic
// plan do not repeat the same mistake.
export function pastLessons(s, task, max = 8) {
  const same = (t) => t.id !== task.id && (task.autoId ? t.autoId === task.autoId : false);
  // Only general lessons (clear.general): a task-specific request (quote address, cut) is not carried to another post.
  const items = (s.tasks ?? []).filter(same).flatMap((t) => revisionsOf(t).map((r) => ({ at: r.at ?? "", text: r.clear?.general ?? "" })));
  const seen = new Set();
  return items.filter((x) => x.text && !seen.has(fold(x.text)) && seen.add(fold(x.text))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, max).map((x) => x.text);
}
export const lessonsBlock = (lines) => lines.length ? `The user gave these revisions to this automation's earlier posts (newest to oldest). Do not repeat the same mistake; apply the ones that fit this post in the first draft:\n${lines.map((x) => `- ${x}`).join("\n")}` : "";
