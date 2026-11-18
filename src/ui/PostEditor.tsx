import { useState } from "react";
import { pushVersion } from "../../shared/versions.mjs";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { type MediaItem, joinBody, kindOf, mediaOf, splitBody, srcOf } from "./Gallery";
import type { Post, Run } from "../types";
import type { Ctx } from "../lib";
import { IG_CAPTION_MAX, THREADS_MAX, bodyOf, isVideo, normalize, problems, tweetMax } from "../../shared/social.mjs";
import { toast } from "./Toast";
import { accountForRun } from "./Preview";
import { Stepper } from "./Fields";

// Edit a post in place before approval. Text formats save at once; for a post with images/video
// saving makes the server write the post and regenerate the images/video (POST /api/rerender).
// Template names match render/src/look.tsx.
export const TEMPLATES = [
  { id: "night", label: "Night", hint: "Dark ground, light in the account color" },
  { id: "paper", label: "Paper", hint: "Light ground, dark text" },
  { id: "bold", label: "Color", hint: "Account color ground, white text" },
];

const Count = ({ n, max }: { n: number; max: number }) => <span className={`pecount ${n > max ? "is-over" : ""}`}>{n}/{max}</span>;
const tagsText = (t: string[]) => t.join(" ");
const tagsOf = (s: string) => s.split(/[\s,]+/).filter(Boolean);

export function PostEditor({ r, ctx, color, onDone }: { r: Run; ctx: Ctx; color: string; onDone: () => void }) {
  const [p, setP] = useState<Post>(() => structuredClone(r.post!));
  const [tags, setTags] = useState(() => ("hashtags" in r.post! ? tagsText(r.post!.hashtags) : ""));
  const [template, setTemplate] = useState(r.template ?? "night");
  const [busy, setBusy] = useState(false);
  const media = p.format === "ig_post" || isVideo(p.format);
  // In text posts (X, Threads, LinkedIn) attachments are edited by hand; in image/video formats the template makes them.
  const [items, setItems] = useState<MediaItem[]>(() => mediaOf(r, true));
  const [uploading, setUploading] = useState(0);
  const mediaKey = (xs: MediaItem[]) => xs.map((m) => `${m.src}|${m.poster ?? ""}`).join(",");
  const mediaChanged = !media && mediaKey(items) !== mediaKey(mediaOf(r, true));
  const set = (patch: Partial<Post>) => setP((x) => ({ ...x, ...patch }) as Post);
  const full = (): Post => ("hashtags" in p ? { ...p, hashtags: tagsOf(tags) } : p);
  const acc = accountForRun(ctx.state, r);
  const issues = problems(normalize(p.format, full()), acc);

  const save = async () => {
    // A text post can be saved empty (image only, or to be written later); a slide/scene post needs at least one.
    const next = normalize(p.format, full()) ?? (p.format === "linkedin" || p.format === "text" ? { format: p.format, text: "" } : null);
    if (!next) return toast("The post can't be empty");
    if (!media) {
      const m = mediaFromItems(items);
      ctx.mutate((st) => {
        const x = st.runs.find((y) => y.id === r.id);
        if (!x) return;
        pushVersion(x, "edit");
        Object.assign(x, { post: next, body: bodyOf(next), edited: true });
        if (!mediaChanged) return;
        // Hand-edited attachments are not tied to the template plan: the scheduler must not redraw them when the kit changes.
        if (x.video !== m.video) delete x.cover;
        delete x.order;
        if (m.video) x.video = m.video; else delete x.video;
        if (m.images.length) x.images = m.images; else delete x.images;
        delete x.attach; delete x.kitHash;
      });
      toast("Post saved");
      return onDone();
    }
    setBusy(true);
    const res = await fetch("/api/rerender", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: r.id, post: next, template }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the server" }));
    setBusy(false);
    if (!res.ok) return toast(res.error ?? "Couldn't save");
    toast(isVideo(p.format) ? "Saved, the video is being remade" : "Saved, the images are being remade");
    onDone();
  };

  return (
    <div className="peditor" style={{ ["--c" as string]: color }}>
      {(p.format === "linkedin" || p.format === "text") && (
        <label className="fld">
          <span>Text <Count n={p.text.length} max={3000} /></span>
          <textarea className="petext" value={p.text} onChange={(e) => set({ text: e.target.value })} rows={10} />
        </label>
      )}

      {(p.format === "tweet" || p.format === "thread" || p.format === "threads") && (
        <div className="pelist">
          {p.tweets.map((t, i) => (
            <label key={i} className="fld">
              <span>{p.tweets.length > 1 ? `Tweet ${i + 1}` : p.format === "threads" ? "Post" : "Tweet"} <Count n={t.length} max={p.format === "threads" ? THREADS_MAX : tweetMax(acc)} />
                {p.tweets.length > 1 && <button type="button" className="perm" onClick={() => set({ tweets: p.tweets.filter((_, j) => j !== i) })} aria-label="Delete tweet"><X size={13} /></button>}
              </span>
              <textarea value={t} rows={3} onChange={(e) => set({ tweets: p.tweets.map((x, j) => (j === i ? e.target.value : x)) })} />
            </label>
          ))}
          {p.format === "thread" && p.tweets.length < 10 && <button type="button" className="slotadd" onClick={() => set({ tweets: [...p.tweets, ""] })}><Plus size={13} />Add tweet</button>}
        </div>
      )}

      {p.format === "ig_post" && (
        <div className="pelist">
          {p.slides.map((x, i) => (
            <div key={i} className="peslide">
              <span className="pen">{i === 0 ? "Cover" : `${i + 1}`}</span>
              <div className="pefields">
                <input value={x.title} placeholder="Title" aria-label={`Slide ${i + 1} title`} onChange={(e) => set({ slides: p.slides.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)) })} />
                <textarea value={x.text} rows={2} placeholder={i === 0 ? "Subline (optional)" : "Short text"} aria-label={`Slide ${i + 1} text`} onChange={(e) => set({ slides: p.slides.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) })} />
              </div>
              {p.slides.length > 2 && <button type="button" className="perm" onClick={() => set({ slides: p.slides.filter((_, j) => j !== i) })} aria-label="Delete slide"><X size={13} /></button>}
            </div>
          ))}
          {p.slides.length < 10 && <button type="button" className="slotadd" onClick={() => set({ slides: [...p.slides, { title: "", text: "" }] })}><Plus size={13} />Add slide</button>}
        </div>
      )}

      {isVideo(p.format) && "scenes" in p && (
        <div className="pelist">
          <label className="fld"><span>Hook <em>first 2 seconds</em></span><input value={p.hook} onChange={(e) => set({ hook: e.target.value })} /></label>
          {p.scenes.map((x, i) => (
            <div key={i} className="peslide">
              <span className="pen">{i + 1}</span>
              <div className="pefields">
                <input value={x.text} aria-label={`Scene ${i + 1}`} onChange={(e) => set({ scenes: p.scenes.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) })} />
                <div className="pescene">
                  <label>Length <Stepper value={x.sec} min={1.5} max={8} step={0.5} label={`Scene ${i + 1} length`} onChange={(v) => set({ scenes: p.scenes.map((y, j) => (j === i ? { ...y, sec: v } : y)) })} /> s</label>
                  <label>Accent <input value={x.accent ?? ""} placeholder="a word from the line" onChange={(e) => set({ scenes: p.scenes.map((y, j) => (j === i ? { ...y, accent: e.target.value || undefined } : y)) })} /></label>
                </div>
              </div>
              {p.scenes.length > 1 && <button type="button" className="perm" onClick={() => set({ scenes: p.scenes.filter((_, j) => j !== i) })} aria-label="Delete scene"><X size={13} /></button>}
            </div>
          ))}
          {p.scenes.length < 9 && <button type="button" className="slotadd" onClick={() => set({ scenes: [...p.scenes, { text: "", sec: 3 }] })}><Plus size={13} />Add scene</button>}
        </div>
      )}

      {"caption" in p && (
        <>
          <label className="fld"><span>Caption <Count n={p.caption.length} max={IG_CAPTION_MAX} /></span><textarea value={p.caption} rows={4} onChange={(e) => set({ caption: e.target.value })} /></label>
          <label className="fld"><span>Hashtags</span><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="#tag #tag" spellCheck={false} /></label>
        </>
      )}

      {media && (
        <div className="fld">
          <span>Template</span>
          <div className="petpl" role="radiogroup" aria-label="Visual template">
            {TEMPLATES.map((t) => (
              <button type="button" key={t.id} role="radio" aria-checked={template === t.id} className={template === t.id ? "on" : ""} onClick={() => setTemplate(t.id)} title={t.hint}>
                <i className={`tp-${t.id}`}><b>Aa</b></i>{t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {!media && <MediaField items={items} setItems={setItems} busy={uploading} setBusy={setUploading} hint={acc?.platform === "x" ? "On X the video goes in the first tweet, images (up to 4) in the reply" : undefined} />}

      {issues.length > 0 && <ul className="pvissues">{issues.map((x) => <li key={x}>{x}</li>)}</ul>}
      <div className="foot">
        <span />
        <button type="button" className="btn sm" onClick={onDone} disabled={busy}>Cancel</button>
        <button type="button" className="btn sm primary" onClick={save} disabled={busy || !!uploading}>{busy ? "Saving…" : media ? (isVideo(p.format) ? "Save, remake video" : "Save, remake images") : "Save"}</button>
      </div>
    </div>
  );
}

// Attachments field: add, remove and reorder images and videos. Uploaded files go to data/media (/api/upload).
// The draft editor and text posts with an account (X, Threads, LinkedIn) use the same field.
function MediaField({ items, setItems, busy, setBusy, hint }: { items: MediaItem[]; setItems: (f: (xs: MediaItem[]) => MediaItem[]) => void; busy: number; setBusy: (f: (n: number) => number) => void; hint?: string }) {
  const add = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      setBusy((n) => n + 1);
      const res = await fetch(`/api/upload?name=${encodeURIComponent(f.name)}&type=${encodeURIComponent(f.type)}`, { method: "POST", body: f }).then((x) => x.json()).catch(() => ({ ok: false }));
      setBusy((n) => n - 1);
      if (!res.ok) { toast(res.error ?? `Couldn't upload ${f.name}`); continue; }
      const src = `media/${res.file}`;
      setItems((xs) => [...xs, { src, kind: kindOf(src) }]);
    }
  };
  const move = (i: number, d: number) => setItems((xs) => { const ys = [...xs]; const [x] = ys.splice(i, 1); ys.splice(i + d, 0, x); return ys; });
  return (
    <div className="fld">
      <span>Attachments <em>{items.length ? `${items.length} ${items.length === 1 ? "file" : "files"}, in post order` : "Image or video"}{hint ? ` · ${hint}` : ""}</em></span>
      <div className="dethumbs">
        {items.map((m, i) => (
          <div key={m.src} className="dethumb">
            {m.kind === "video" ? <video src={srcOf(m.src)} muted preload="metadata" /> : <img src={srcOf(m.src)} alt="" />}
            <span className="detn">{i + 1}</span>
            <button type="button" className="detx" onClick={() => setItems((xs) => xs.filter((y) => y.src !== m.src))} aria-label="Remove attachment" title="Remove"><X size={13} /></button>
            {items.length > 1 && <span className="detbar">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move earlier" title="Move earlier"><ChevronLeft size={14} /></button>
              <button type="button" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move later" title="Move later"><ChevronRight size={14} /></button>
            </span>}
          </div>
        ))}
        <label className="detadd">
          <input type="file" accept="image/*,video/*" multiple onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          <Plus size={16} />{busy ? "Uploading…" : "Add"}
        </label>
      </div>
    </div>
  );
}

// Attachments of a text post with an account: one video (the first), images in order; the video's own cover (poster) stays ahead of the image.
export function mediaFromItems(items: MediaItem[]) {
  const vid = items.find((m) => m.kind === "video");
  const imgs = items.filter((m) => m.kind !== "video" && !m.remote).map((m) => m.src);
  return { video: vid?.src, images: [...(vid?.poster ? [vid.poster] : []), ...imgs] };
}

// Editor for a draft with no account: title, attachments (images and video; add, remove, reorder) and text.
// Uploaded files go to data/media (run.images); remote links in the text stay at the end of the text.
export function DraftEditor({ r, ctx, onDone }: { r: Run; ctx: Ctx; onDone: () => void }) {
  const [title, setTitle] = useState(r.title);
  const [text, setText] = useState(() => splitBody(r.body).text);
  const [items, setItems] = useState<MediaItem[]>(() => mediaOf(r));
  const [busy, setBusy] = useState(0);
  const save = () => {
    const own = items.filter((m) => !m.remote).map((m) => m.src);
    const body = joinBody(text, items.filter((m) => m.remote).map((m) => m.src));
    ctx.mutate((st) => {
      const x = st.runs.find((y) => y.id === r.id);
      if (!x) return;
      pushVersion(x, "edit");
      Object.assign(x, { title: title.trim() || x.title, body, images: own, edited: true });
      delete x.video;
    });
    toast("Draft saved");
    onDone();
  };
  return (
    <div className="peditor deditor">
      <label className="fld"><span>Title</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <MediaField items={items} setItems={setItems} busy={busy} setBusy={setBusy} />
      <label className="fld"><span>Text <Count n={text.length} max={3000} /></span><textarea className="petext" value={text} onChange={(e) => setText(e.target.value)} rows={10} /></label>
      <div className="foot">
        <span />
        <button type="button" className="btn sm" onClick={onDone}>Cancel</button>
        <button type="button" className="btn sm primary" disabled={!!busy} onClick={save}>Save</button>
      </div>
    </div>
  );
}
