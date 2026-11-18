import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { END_SEC, HOOK_SEC } from "../../shared/social.mjs";
import { type Account, type Look, DISPLAY, MONO, fit, look } from "./look";

export type ReelProps = { account: Account; hook: string; scenes: { text: string; sec: number; accent?: string }[]; template?: string };
type Seg = { kind: "hook" | "scene" | "end"; text: string; accent?: string; frames: number };

function segments(p: ReelProps, fps: number): Seg[] {
  return [
    ...(p.hook ? [{ kind: "hook" as const, text: p.hook, frames: Math.round(HOOK_SEC * fps) }] : []),
    ...p.scenes.map((x) => ({ kind: "scene" as const, text: x.text, accent: x.accent, frames: Math.round(x.sec * fps) })),
    { kind: "end" as const, text: "", frames: Math.round(END_SEC * fps) },
  ];
}
export const reelFrames = (p: ReelProps, fps: number) => segments(p, fps).reduce((n, s) => n + s.frames, 0);

// The Instagram UI covers ~420 px at the bottom and ~150 px on the right; the text stays outside that area.
const LEFT = 92;
const RIGHT = 168;
const BOTTOM_SAFE = 470;
const TOP_SAFE = 340;

const clean = (w: string) => w.toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}]/gu, "");
// The words of the accent phrase within the sentence.
function accentSet(words: string[], accent?: string) {
  const hit = new Set<number>();
  if (!accent) return hit;
  const target = accent.split(/\s+/).map(clean).filter(Boolean);
  for (let i = 0; i + target.length <= words.length; i++) {
    if (target.every((t, k) => clean(words[i + k]) === t)) {
      target.forEach((_, k) => hit.add(i + k));
      break;
    }
  }
  return hit;
}

// A scene: words rise in turn and slide up and out as the scene ends.
function Words({ seg, L }: { seg: Seg; L: Look }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = seg.text.split(/\s+/).filter(Boolean);
  const hit = accentSet(words, seg.accent);
  const hook = seg.kind === "hook";
  const size = hook ? fit(seg.text, [[16, 150], [28, 128], [44, 108], [999, 92]]) : fit(seg.text, [[22, 112], [40, 96], [64, 82], [999, 70]]);
  const stagger = Math.max(2, Math.min(4, Math.floor(16 / Math.max(1, words.length / 2))));
  const exit = interpolate(frame, [seg.frames - 7, seg.frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: LEFT,
        right: RIGHT,
        top: TOP_SAFE,
        bottom: BOTTOM_SAFE,
        display: "flex",
        alignItems: "center",
        transform: `translateY(${-60 * exit}px)`,
        opacity: 1 - exit,
        filter: `blur(${6 * exit}px)`,
      }}
    >
      <h1 style={{ margin: 0, fontFamily: DISPLAY, fontWeight: 800, fontSize: size, lineHeight: 1.04, letterSpacing: "-0.035em", color: L.ink, textWrap: "balance" }}>
        {words.map((w, i) => {
          const t = spring({ frame: frame - 2 - i * stagger, fps, config: { damping: 200, stiffness: 170, mass: 0.7 } });
          return (
            <span key={i} style={{ display: "inline-block", whiteSpace: "pre", transform: `translateY(${(1 - t) * 0.42}em)`, opacity: t, filter: `blur(${(1 - t) * 10}px)`, color: hit.has(i) ? L.accent : undefined }}>
              {w}{i < words.length - 1 ? " " : ""}
            </span>
          );
        })}
      </h1>
    </div>
  );
}

function End({ account, L }: { account: Account; L: Look }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame, fps, config: { damping: 200, stiffness: 140 } });
  return (
    <div style={{ position: "absolute", left: LEFT, right: RIGHT, top: TOP_SAFE, bottom: BOTTOM_SAFE, display: "flex", flexDirection: "column", justifyContent: "center", gap: 22, opacity: t, transform: `translateY(${(1 - t) * 30}px)` }}>
      <span style={{ width: 22, height: 22, borderRadius: 11, background: L.dot }} />
      <b style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 96, lineHeight: 1.02, letterSpacing: "-0.035em", color: L.ink }}>{account.name}</b>
      {account.handle && <span style={{ fontFamily: MONO, fontSize: 40, letterSpacing: "0.02em", color: L.muted }}>{account.handle}</span>}
    </div>
  );
}

// Vertical Reels (1080x1920): hook, scenes, end card. No sound; music is added in Instagram.
export function Reel(p: ReelProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const L = look(p.template, p.account.color);
  const segs = segments(p, fps);
  let from = 0;
  return (
    <AbsoluteFill style={{ background: "#0c0d10" }}>
      {L.bg({ color: p.account.color, x: 18 + 22 * Math.sin(frame / 70), y: 14 + 10 * Math.cos(frame / 90), strength: 1.1 })}
      {p.account.handle && (
        <div style={{ position: "absolute", top: 250, left: LEFT, display: "flex", alignItems: "center", gap: 14, fontFamily: MONO, fontSize: 30, letterSpacing: "0.03em", color: L.muted }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: L.dot }} />
          {p.account.handle}
        </div>
      )}
      {segs.map((s, i) => {
        const at = from;
        from += s.frames;
        return (
          <Sequence key={i} from={at} durationInFrames={s.frames} layout="none">
            {s.kind === "end" ? <End account={p.account} L={L} /> : <Words seg={s} L={L} />}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
