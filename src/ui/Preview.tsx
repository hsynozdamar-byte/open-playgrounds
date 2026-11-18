import { useEffect, useRef, useState } from "react";
import type { Post, Run, State, XTarget } from "../types";
import { worldOf } from "../lib";
import { BrandIcon } from "./BrandIcon";
import { Gallery, mediaOf, splitBody, srcOf } from "./Gallery";
import { PLATFORM_NAME, platformsOf } from "../../shared/stages.mjs";
import { IG_FOLD, LI_FOLD, THREADS_MAX, accountOf, tweetMax, isVideo, missingImage, platformName, problems, taskRef } from "../../shared/social.mjs";

// Preview of a social post: as it will look on the platform. Data comes from Run.post.
type Acc = { name: string; handle: string; color: string; platform: string; label: string; premium?: boolean };

export function accountForRun(s: State, r: Run): Acc {
  const task = s.tasks.find((t) => t.id === r.taskId);
  const acc = accountOf(s, taskRef(s, task));
  const color = worldOf(s, task?.worldId ?? null)?.color ?? "#3b86e8";
  return { name: acc?.name || acc?.project?.name || "Account", handle: acc?.handle ?? "", color, platform: acc?.platform ?? "", label: acc ? platformName(acc) : "", premium: !!acc?.premium };
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toLocaleUpperCase("en-US");
function Avatar({ acc, size = 36 }: { acc: Acc; size?: number }) {
  return <span className="pvav" style={{ ["--c" as string]: acc.color, width: size, height: size }}>{initials(acc.name)}</span>;
}

// The part of the text visible without folding: at most `chars` characters and `lines` lines.
function fold(text: string, chars: number, lines: number) {
  let cut = Math.min(text.length, chars);
  let n = 0;
  for (let i = 0; i < cut; i++) if (text[i] === "\n" && ++n >= lines) { cut = i; break; }
  if (cut >= text.length) return null;
  // Cut at a word boundary; if that lands in the first few letters of a new paragraph, cut at the end of the paragraph. Trailing punctuation must not collide with "…".
  const nl = text.lastIndexOf("\n", cut);
  const sp = text.lastIndexOf(" ", cut);
  const end = nl > 0 && cut - nl < 40 ? nl : sp > cut * 0.6 ? sp : cut;
  return text.slice(0, end).trimEnd().replace(/[.,;:]+$/, "");
}

function Folded({ text, chars, lines, more, children }: { text: string; chars: number; lines: number; more: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const cut = fold(text, chars, lines);
  return (
    <p className="pvtext">
      {children}
      {open || !cut ? text : cut}
      {cut && !open && <>… <button className="pvmore" onClick={() => setOpen(true)}>{more}</button></>}
      {cut && open && <> <button className="pvmore" onClick={() => setOpen(false)}>show less</button></>}
    </p>
  );
}

const Tags = ({ tags }: { tags: string[] }) => (tags.length ? <p className="pvtags">{tags.join(" ")}</p> : null);

// Plain post for LinkedIn and for an account whose platform is "Other". Like the LinkedIn feed: text, image below (if none "Image missing").
const whenOf = (r: Run) => {
  const at = r.postedAt;
  if (!at) return "now";
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function TextPost({ post, acc, r, compact }: { post: Extract<Post, { format: "linkedin" | "text" }>; acc: Acc; r: Run; compact?: boolean }) {
  return (
    <div className="pv pv-li">
      <header className="pvhead">
        <Avatar acc={acc} size={44} />
        <div className="pvwho"><b>{acc.name}</b><span>{acc.handle && !acc.handle.includes("/") ? acc.handle : acc.label}</span>{!compact && <span>{whenOf(r)}</span>}</div>
      </header>
      {missingImage(r) ? <p className="pvnoimg">{r.phase ? `${r.phase}…` : "Image missing"}</p> : <Media r={r} />}
      {compact ? <p className="pvtext pvclamp">{post.text}</p> : <Folded text={post.text} chars={LI_FOLD} lines={3} more="more" />}
    </div>
  );
}

// X / Threads: the account once on top, a line below; tweets stacked on the same left edge.
// If r is given the attachments (video, images) show under the first tweet: like an X post.
function Tweets({ post, acc, compact, r }: { post: Extract<Post, { format: "tweet" | "thread" | "threads" }>; acc: Acc; compact?: boolean; r?: Run }) {
  const handle = acc.handle || acc.label;
  const max = post.format === "threads" ? THREADS_MAX : tweetMax(acc);
  const many = post.tweets.length > 1;
  return (
    <div className={`pv pv-x ${many ? "is-thread" : ""}`}>
      <header className="pvhead pvxhead">
        <Avatar acc={acc} size={40} />
        <div className="pvwho"><b>{acc.name}</b><span>{handle}</span></div>
      </header>
      {post.tweets.map((t, i) => (
        <article key={i} className="pvtweet">
          <p className={`pvtext ${compact ? "pvclamp" : ""}`}>{t}</p>
          {i === 0 && r && <div className="pvxmedia"><Media r={r} /></div>}
          {i === 0 && (post.quote || post.reply) && <XQuote t={(post.quote ?? post.reply)!} reply={!post.quote} />}
          <span className={`pvcount ${t.length > max ? "is-over" : ""}`}>
            {many && <b>{i + 1}/{post.tweets.length}</b>}
            {acc.premium && post.format !== "threads" ? `${t.length} characters` : `${t.length}/${max}`}
          </span>
        </article>
      ))}
    </div>
  );
}

// A quoted or replied-to tweet: a framed box as on X (author, text, image or video cover; an inner box if it quotes a tweet too).
function XQuote({ t, reply }: { t: XTarget; reply: boolean }) {
  // The video plays muted in a loop as on X; it carries its own controls so a click does not go to the box's link.
  const thumb = (m?: XTarget["media"]) => m && (
    <div className="pvq-media" onClick={(e) => m.video && e.preventDefault()}>
      {m.video ? <video src={m.video} poster={m.thumb} muted loop autoPlay playsInline controls /> : <img src={m.thumb} alt="" loading="lazy" />}
      {m.kind === "video" && !m.video && <i className="pvq-play" aria-hidden />}
    </div>
  );
  return (
    <a className="pvq" href={t.url} target="_blank" rel="noreferrer">
      <span className="pvq-label">{reply ? "Reply" : "Quote"}</span>
      <div className="pvq-who">{t.avatar && <img src={t.avatar} alt="" />}<b>{t.name ?? t.url}</b>{t.handle && <span>{t.handle}</span>}</div>
      {t.text && <p className="pvq-text">{t.text}</p>}
      {thumb(t.media)}
      {t.inner && (
        <div className="pvq pvq-inner">
          <div className="pvq-who"><b>{t.inner.name}</b><span>{t.inner.handle}</span></div>
          {t.inner.text && <p className="pvq-text">{t.inner.text}</p>}
          {thumb(t.inner.media)}
        </div>
      )}
    </a>
  );
}

// Instagram: slide images slide sideways; if there are no images (not rendered) the slide text is a placeholder.
function Carousel({ post, r, acc }: { post: Extract<Post, { format: "ig_post" }>; r: Run; acc: Acc }) {
  const [i, setI] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  // In a carousel where the work itself is shared, the video is also one frame and its order comes from run.order.
  const items = mediaOf(r).filter((m) => !m.remote);
  const n = items.length || post.slides.length;
  const go = (k: number) => {
    const el = strip.current;
    if (!el) return;
    el.scrollTo({ left: k * el.clientWidth, behavior: "smooth" });
  };
  return (
    <div className="pvig-media">
      <div className="pvstrip" ref={strip} onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))}>
        {items.length
          ? items.map((m, k) => m.kind === "video"
            ? <video key={m.src} src={srcOf(m.src)} controls muted playsInline preload="metadata" />
            : <img key={m.src} src={srcOf(m.src)} alt={r.asIs ? "" : post.slides[k]?.title ?? ""} loading="lazy" />)
          : post.slides.map((x, k) => (
            <div key={k} className={`pvslide ${k === 0 ? "is-cover" : ""}`} style={{ ["--c" as string]: acc.color }}>
              <b>{x.title}</b>{x.text && <span>{x.text}</span>}
            </div>
          ))}
      </div>
      {n > 1 && (
        <>
          {i > 0 && <button className="pvnav prev" onClick={() => go(i - 1)} aria-label="Previous slide">‹</button>}
          {i < n - 1 && <button className="pvnav next" onClick={() => go(i + 1)} aria-label="Next slide">›</button>}
          <span className="pvcounter">{i + 1}/{n}</span>
        </>
      )}
      {n > 1 && <div className="pvdots">{Array.from({ length: n }, (_, k) => <i key={k} className={k === i ? "on" : ""} />)}</div>}
    </div>
  );
}

function Instagram({ post, acc, r }: { post: Extract<Post, { format: "ig_post" }>; acc: Acc; r: Run }) {
  const handle = (acc.handle || acc.name).replace(/^@/, "");
  return (
    <div className="pv pv-ig">
      <header className="pvhead"><Avatar acc={acc} size={32} /><b>{handle}</b></header>
      <Carousel post={post} r={r} acc={acc} />
      <Folded text={post.caption} chars={IG_FOLD} lines={2} more="more"><b>{handle}</b> </Folded>
      <Tags tags={post.hashtags} />
    </div>
  );
}

// Preview video: tap to pause/play, a draggable progress bar below, elapsed and total time on top.
// When paused a play mark shows in the middle; the current second is always visible (2026-11-04).
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
function ReelVideo({ src, poster }: { src: string; poster?: string }) {
  const v = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [d, setD] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let id = 0;
    const tick = () => { if (v.current) setT(v.current.currentTime); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  const toggle = () => { const x = v.current; if (!x) return; if (x.paused) void x.play(); else x.pause(); };
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const x = v.current; if (!x || !d) return;
    const b = e.currentTarget.getBoundingClientRect();
    x.currentTime = Math.max(0, Math.min(d, ((e.clientX - b.left) / b.width) * d));
    setT(x.currentTime);
  };
  return (
    <>
      <video ref={v} src={src} poster={poster} autoPlay muted loop playsInline controls={false} onClick={toggle}
        onLoadedMetadata={(e) => setD(e.currentTarget.duration)} onPlay={() => setPaused(false)} onPause={() => setPaused(true)} />
      {paused && <button className="pvplay" onClick={toggle} aria-label="Play"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M8 5v14l11-7z" fill="currentColor" /></svg></button>}
      <span className="pvtime mono">{clock(t)} / {clock(d)}</span>
      <div className="pvbar" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seek(e); }} onPointerMove={(e) => e.buttons && seek(e)} role="slider" aria-label="Video position" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(t)}>
        <i style={{ width: d ? `${(t / d) * 100}%` : 0 }} />
      </div>
    </>
  );
}

// Reels, TikTok, Shorts: plays the video if there is one (muted, loop); otherwise the scene texts.
function Reel({ post, acc, r }: { post: Extract<Post, { format: "ig_reel" | "short" }>; acc: Acc; r: Run }) {
  const handle = (acc.handle || acc.name).replace(/^@/, "");
  const [script, setScript] = useState(false);
  return (
    <div className="pv pv-reel">
      <div className="pvphone" style={{ ["--c" as string]: acc.color }}>
        {r.video ? (
          <ReelVideo src={`/${r.video}`} poster={r.images?.[0] ? `/${r.images[0]}` : undefined} />
        ) : (
          <div className="pvstory"><b>{post.hook || post.scenes[0]?.text}</b></div>
        )}
        <div className="pvover">
          <span className="pvuser"><Avatar acc={acc} size={22} />{handle}</span>
          {post.caption && <span className="pvcap">{post.caption.split("\n")[0]}</span>}
        </div>
      </div>
      <div className="pvside">
        <Folded text={post.caption} chars={IG_FOLD} lines={2} more="more"><b>{handle}</b> </Folded>
        <Tags tags={post.hashtags} />
        <button className="pvmore" onClick={() => setScript(!script)}>{script ? "Hide script" : `Script · ${post.scenes.length + (post.hook ? 1 : 0)} scenes`}</button>
        {script && (
          <ol className="pvscript">
            {post.hook && <li><span className="mono">Hook</span>{post.hook}</li>}
            {post.scenes.map((x, k) => <li key={k}><span className="mono">{x.sec} s</span>{x.text}</li>)}
          </ol>
        )}
      </div>
    </div>
  );
}

// Attachments of a text post: images and videos slide sideways in one strip.
function Media({ r }: { r: Run }) {
  return <Gallery items={mediaOf(r, true)} />;
}

// compact: inside a card (history, post list); check notes and warnings are not shown.
export function PostPreview({ r, s, compact }: { r: Run; s: State; compact?: boolean }) {
  const post = r.post;
  if (!post) return null;
  const acc = accountForRun(s, r);
  const issues = problems(post, acc);
  return (
    <div className="pvwrap">
      {(post.format === "linkedin" || post.format === "text") && <TextPost post={post} acc={acc} r={r} compact={compact} />}
      {(post.format === "tweet" || post.format === "thread" || post.format === "threads") && <Tweets post={post} acc={acc} compact={compact} r={r} />}
      {post.format === "ig_post" && <Instagram post={post} acc={acc} r={r} />}
      {(post.format === "ig_reel" || post.format === "short") && <Reel post={post} acc={acc} r={r} />}
      {!compact && issues.length > 0 && <ul className="pvissues">{issues.map((x) => <li key={x}>{x}</li>)}</ul>}
      {!compact && r.review?.score != null && (
        <details className={`pvreview ${r.review.score < 8 ? "is-low" : ""}`} open={r.review.score < 8}>
          <summary>{r.review.score < 8 ? `Didn't pass Rou's check: ${r.review.score}/10, not ready to publish` : `Rou's check: ${r.review.score}/10`}{(r.review.rounds ?? 1) > 1 ? ` · ${r.review.rounds} rounds` : ""}</summary>
          {!!r.review.notes?.length && <ul>{r.review.notes.map((x) => <li key={x}>{x}</li>)}</ul>}
        </details>
      )}
      {!compact && r.needs?.length ? <div className="pvneeds"><b>What Rou needs for a better visual</b><ul>{r.needs.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
      {r.renderError && <p className="pvissues">Couldn't make the {isVideo(post.format) ? "video" : "images"}: {r.renderError}</p>}
    </div>
  );
}

// Draft of a post with no account record (shared from the world's browser session): shown as it will be shared, with the full text.
// Lines become paragraphs, #tags are highlighted; with no account the name comes from the project name.
export function DraftPost({ r, s, compact }: { r: Run; s: State; compact?: boolean }) {
  const task = s.tasks.find((t) => t.id === r.taskId);
  const acc = accountForRun(s, r);
  const name = acc.name === "Account" ? s.projects.find((p) => p.id === task?.projectId)?.name ?? worldOf(s, task?.worldId ?? null).name : acc.name;
  const who = { ...acc, name };
  const pls = platformsOf(s, s.automations.find((a) => a.id === task?.autoId));
  // X or Threads draft (text only): same look as the post card.
  if (pls.length > 0 && pls.every((pl) => pl === "x" || pl === "threads")) return <div className="pvwrap"><Tweets post={{ format: pls[0] === "threads" ? "threads" : "tweet", tweets: [r.body.trim()] }} acc={who} compact={compact} /></div>;
  const paras = splitBody(r.body).text.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  return (<>
    <div className="pv pv-draft">
      <header className="pvhead">
        <Avatar acc={who} size={36} />
        <div className="pvwho"><b>{name}</b>{(acc.handle || acc.label) && <span>{acc.handle || acc.label}</span>}</div>
        {pls.length > 0 && <span className="pvplat">{pls.map((pl) => <span key={pl}><BrandIcon platform={pl} size={14} />{PLATFORM_NAME[pl] ?? pl}</span>)}</span>}
      </header>
      {!compact && <h3 className="pvdtitle">{r.title}</h3>}
      <Media r={r} />
      <div className="pvdtext">
        {paras.map((x, i) => <p key={i}>{x.split(/(#[\p{L}_][\p{L}\p{N}_]*)/gu).map((y, k) => y.startsWith("#") ? <span key={k} className="pvtag">{y}</span> : y)}</p>)}
      </div>
    </div>
  </>);
}

// Files to download: the Reels video or the slide images.
export function mediaFiles(r: Run) {
  // In a carousel the video is also one frame: it downloads with the images, in the post's order.
  if (r.post?.format === "ig_post") return mediaOf(r).filter((m) => !m.remote).map((m) => m.src);
  return r.video ? [r.video] : [];
}
export function download(files: string[], name: string) {
  files.forEach((f, i) => setTimeout(() => {
    const a = document.createElement("a");
    a.href = `/${f}`;
    a.download = `${name}${files.length > 1 ? `-${i + 1}` : ""}${f.slice(f.lastIndexOf("."))}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, i * 250));
}
