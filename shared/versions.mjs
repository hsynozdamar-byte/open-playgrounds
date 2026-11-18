// Gönderinin küçük sürüm geçmişi: düzenleme, yeniden çizim ve geri dönüşten önce eski hâl run.versions'a girer (en yeni başta).
// Revize yeni bir çıktı (run) açar; aynı işin eski çıktıları da sürüm olarak listelenir (src/ui/Versions.tsx).
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

// Şu anki hâli geçmişe ekler; son kayıtla aynıysa eklemez.
export function pushVersion(run, why) {
  if (!run.post && !run.images?.length && !run.body) return;
  const v = snapshot(run, why);
  if (run.versions?.[0] && same(run.versions[0], v)) return;
  run.versions = [v, ...(run.versions ?? [])].slice(0, VERSION_MAX);
}

// from: geçmişteki bir sürüm ya da aynı işin eski bir çıktısı. Şu anki hâl geçmişe girer, böylece bu da geri alınabilir.
export function applyVersion(run, from) {
  pushVersion(run, "restore");
  for (const k of KEYS) {
    if (from[k] !== undefined) run[k] = structuredClone(from[k]);
    else delete run[k];
  }
  run.edited = true;
  delete run.renderError;
}

// Yalnız bir parça (ör. eski çıktının videosu, metni değil): "media" eski çıktının görsel/videosunu,
// "text" metnini alır; öbürü şu anki hâliyle kalır. Görsel biçimlerde (IG gönderisi, Reel) metin sahnelerle bağlı, ayrılmaz.
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
