// A post's small version history: before an edit, re-render or restore, the old state goes into run.versions (newest first).
// A revision opens a new output (run); the task's older outputs are also listed as versions (src/ui/Versions.tsx).
export const VERSION_MAX = 8;
const KEYS = ["post", "attach", "body", "images", "video", "cover", "template"];
const MEDIA = ["attach", "images", "video", "cover", "template"];
const VISUAL_FORMATS = ["ig_post", "ig_reel", "short"];

export function snapshot(run, why) {
  const v = { at: new Date().toISOString(), why };
  for (const k of KEYS) if (run[k] !== undefined) v[k] = structuredClone(run[k]);
  return v;
}

const same = (a, b) => KEYS.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

// Adds the current state to the history; skipped when it equals the latest entry.
export function pushVersion(run, why) {
  if (!run.post && !run.images?.length && !run.body) return;
  const v = snapshot(run, why);
  if (run.versions?.[0] && same(run.versions[0], v)) return;
  run.versions = [v, ...(run.versions ?? [])].slice(0, VERSION_MAX);
}

// from: a version in the history or an older output of the same task. The current state goes into the history, so this can be undone too.
export function applyVersion(run, from) {
  pushVersion(run, "restore");
  for (const k of KEYS) {
    if (from[k] !== undefined) run[k] = structuredClone(from[k]);
    else delete run[k];
  }
  run.edited = true;
  delete run.renderError;
}

// Only one part (e.g. the old output's video, not its text): "media" takes the old output's images/video,
// "text" takes its text; the other stays as it is now. In visual formats (IG post, Reel) the text is tied to the scenes and cannot be split.
export function canTakePart(run, from, part) {
  if (part === "media") return MEDIA.some((k) => from[k] && (Array.isArray(from[k]) ? from[k].length : true));
  const f = run.post?.format;
  return !!(from.post && f && from.post.format === f && !VISUAL_FORMATS.includes(f));
}
export function applyPart(run, from, part) {
  if (!canTakePart(run, from, part)) return false;
  pushVersion(run, "restore");
  if (part === "media") for (const k of MEDIA) { if (from[k] !== undefined) run[k] = structuredClone(from[k]); else delete run[k]; }
  else {
    const keep = { quote: run.post?.quote, reply: run.post?.reply };
    run.post = structuredClone(from.post);
    for (const k of ["quote", "reply"]) if (!run.post[k] && keep[k]) run.post[k] = keep[k];
    run.body = from.body;
  }
  run.edited = true;
  delete run.renderError;
  return true;
}
