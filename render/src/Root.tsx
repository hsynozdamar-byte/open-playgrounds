import { Composition, Still } from "remotion";
import { Reel, reelFrames, type ReelProps } from "./Reel";
import { Slide, type SlideProps } from "./Slide";
import { FootReel, FootSlide, footFrames, type FootReelProps, type FootSlideProps, FootCover } from "./Footage";
import { VoiceReel, voiceFrames, type VoiceReelProps } from "./VoiceReel";

export const FPS = 30;

const slide: SlideProps = {
  account: { name: "Account", handle: "@account", color: "#3b86e8" },
  index: 0,
  slides: [{ title: "The cover sentence goes here", text: "" }, { title: "Second slide", text: "A short explanation." }],
};
const reel: ReelProps = {
  account: { name: "Account", handle: "@account", color: "#3b86e8" },
  hook: "Nobody says this",
  scenes: [{ text: "First scene text", sec: 3 }, { text: "Second scene, accented word", sec: 3, accent: "accented" }],
};

const voice: VoiceReelProps = {
  account: { name: "Account", handle: "@account", color: "#3b86e8" },
  durationMs: 2400,
  chunks: [{ from: 0, to: 1100, words: [{ t: "Why", from: 0, to: 500 }, { t: "are", from: 500, to: 800 }, { t: "cards", from: 800, to: 1100 }] }, { from: 1200, to: 2300, words: [{ t: "It's", from: 1200, to: 1700 }, { t: "corners.", from: 1700, to: 2300 }] }],
};

const foot: FootReelProps = { account: reel.account, hook: "Ship small, ship often.", scenes: [{ text: "One change a day", sec: 3 }] };
const footSlide: FootSlideProps = { account: slide.account, index: 0, slides: [{ title: "Ship small, ship often.", text: "One clear change at a time." }] };

export function Root() {
  return (
    <>
      <Still id="slide" component={Slide} width={1080} height={1350} defaultProps={slide} />
      <Composition
        id="reel"
        component={Reel}
        width={1080}
        height={1920}
        fps={FPS}
        durationInFrames={reelFrames(reel, FPS)}
        defaultProps={reel}
        calculateMetadata={({ props }) => ({ durationInFrames: reelFrames(props, FPS) })}
      />
      <Still id="footslide" component={FootSlide} width={1080} height={1350} defaultProps={footSlide} />
      <Still id="footcover" component={FootCover} width={1920} height={1080} defaultProps={footSlide} />
      <Composition
        id="footreel"
        component={FootReel}
        width={1080}
        height={1920}
        fps={FPS}
        durationInFrames={footFrames(foot, FPS)}
        defaultProps={foot}
        calculateMetadata={({ props }) => ({ durationInFrames: footFrames(props, FPS) })}
      />
      <Composition
        id="voicereel"
        component={VoiceReel}
        width={1080}
        height={1920}
        fps={FPS}
        durationInFrames={voiceFrames(voice, FPS)}
        defaultProps={voice}
        calculateMetadata={({ props }) => ({ durationInFrames: voiceFrames(props, FPS) })}
      />
    </>
  );
}
