import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { type Account, DISPLAY, MONO, look, type Look } from "./look";
import { Scene, type Visual } from "./Scenes";

// Reels in the person's own voice (1080x1920). The audio is added separately (server/voice.mjs); this is the picture.
// Bands: account + progress on top, then the scene's on-screen text, the scene's visual in the middle, a word-by-word caption at the bottom.
// Scenes sit on the sentence in the audio (beat.start, ms): the picture cuts the moment that sentence is spoken.
export type Word = { t: string; from: number; to: number }; // ms
export type Chunk = { words: Word[]; from: number; to: number };
export type Beat = { start: number; text: string; visual: Visual };
export type VoiceReelProps = { account: Account; chunks: Chunk[]; beats?: Beat[]; durationMs: number; template?: string };

const LEFT = 92;
const RIGHT = 168;
const HEAD_TOP = 372;
const STAGE_TOP = 600;
const STAGE_BOTTOM = 1340;
const CAP_TOP = 1352;

export const voiceFrames = (p: VoiceReelProps, fps: number) => Math.max(fps, Math.ceil((p.durationMs / 1000) * fps) + Math.round(fps * 0.6));

// Caption: small, at the bottom, two lines at most; the spoken word lights up and the unspoken ones are faded.
function Caption({ c, fps, L }: { c: Chunk; fps: number; L: Look }) {
  const frame = useCurrentFrame();
  const ms = (frame / fps) * 1000 + c.from;
  return (
    <div style={{ position: "absolute", left: LEFT, right: RIGHT, top: CAP_TOP, fontFamily: DISPLAY, fontWeight: 700, fontSize: 50, lineHeight: 1.2, letterSpacing: "-0.02em", color: L.ink, textShadow: "0 2px 18px rgb(0 0 0 / 0.55)" }}>
      {c.words.map((w, i) => {
        const now = ms >= w.from && ms < w.to + 100;
        return <span key={i} style={{ opacity: ms >= w.from ? 1 : 0.5, color: now ? L.accent : undefined }}>{w.t}{i < c.words.length - 1 ? " " : ""}</span>;
      })}
    </div>
  );
}

// A scene: the on-screen text comes in fast and stays; the visual settles in place and the camera slowly pushes in over the scene.
function BeatView({ b, frames, L, color }: { b: Beat; frames: number; L: Look; color: string }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const head = spring({ frame: f, fps, config: { damping: 200, stiffness: 260, mass: 0.6 } });
  const stage = spring({ frame: f - 3, fps, config: { damping: 200, stiffness: 150, mass: 0.9 } });
  const cam = interpolate(f, [0, frames], [1, 1.035], { extrapolateRight: "clamp" });
  return (
    <>
      {b.text && b.visual.kind !== "title" && (
        <h2 style={{ position: "absolute", left: LEFT, right: RIGHT, top: HEAD_TOP, margin: 0, fontFamily: DISPLAY, fontWeight: 800, fontSize: 68, lineHeight: 1.05, letterSpacing: "-0.04em", color: L.ink, textWrap: "balance", opacity: head, transform: `translateY(${(1 - head) * 26}px)` }}>{b.text}</h2>
      )}
      <div style={{ position: "absolute", left: 0, right: 0, top: b.visual.kind === "title" ? HEAD_TOP : STAGE_TOP, bottom: 1920 - STAGE_BOTTOM, display: "flex", alignItems: "center", justifyContent: "center", opacity: stage, transform: `translateY(${(1 - stage) * 50}px) scale(${cam})` }}>
        <Scene v={b.visual} frames={frames} L={L} color={color} />
      </div>
    </>
  );
}

export function VoiceReel(p: VoiceReelProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const L = look(p.template, p.account.color);
  const f = (ms: number) => Math.round((ms / 1000) * fps);
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], { extrapolateRight: "clamp" });
  const beats = p.beats ?? [];
  return (
    <AbsoluteFill style={{ background: "#0c0d10" }}>
      {L.bg({ color: p.account.color, x: 18 + 22 * Math.sin(frame / 70), y: 14 + 10 * Math.cos(frame / 90), strength: 1.1 })}
      {(p.account.handle || p.account.name) && (
        <div style={{ position: "absolute", top: 250, left: LEFT, display: "flex", alignItems: "center", gap: 14, fontFamily: MONO, fontSize: 30, letterSpacing: "0.03em", color: L.muted }}>
          <span style={{ width: 12, height: 12, borderRadius: 6, background: L.dot }} />
          {p.account.handle || p.account.name}
        </div>
      )}
      <div style={{ position: "absolute", left: LEFT, right: RIGHT, top: 310, height: 4, borderRadius: 2, background: "rgb(255 255 255 / 0.12)" }}>
        <div style={{ width: `${progress * 100}%`, height: "100%", borderRadius: 2, background: L.dot }} />
      </div>
      {beats.map((b, i) => {
        const end = beats[i + 1] ? f(beats[i + 1].start) : durationInFrames;
        return (
          <Sequence key={`b${i}`} from={f(b.start)} durationInFrames={Math.max(1, end - f(b.start))} layout="none">
            <BeatView b={b} frames={Math.max(1, end - f(b.start))} L={L} color={p.account.color} />
          </Sequence>
        );
      })}
      {p.chunks.map((c, i) => {
        const next = p.chunks[i + 1];
        const end = next ? next.from : c.to + 600;
        return (
          <Sequence key={`c${i}`} from={f(c.from)} durationInFrames={Math.max(1, f(end) - f(c.from))} layout="none">
            <Caption c={c} fps={fps} L={L} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
