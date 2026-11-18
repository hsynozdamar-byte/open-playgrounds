import { describe, expect, it } from "vitest";
import type { Run } from "../src/types";
import { mediaOf } from "../src/ui/Gallery";

const run = (x: Partial<Run>) => ({ id: "r1", taskId: "t1", at: "", title: "", body: "", status: "ready", ...x }) as Run;

describe("mediaOf", () => {
  it("video varken ilk görseli ayrı ek değil, videonun kapağı yapar", () => {
    const items = mediaOf(run({ video: "media/r1.mp4", images: ["media/r1-0.jpg"], post: { format: "linkedin", text: "x" } }), true);
    expect(items).toEqual([{ src: "media/r1.mp4", kind: "video", poster: "media/r1-0.jpg" }]);
  });
  it("kapak dışındaki görseller ek olarak kalır", () => {
    const items = mediaOf(run({ video: "media/r1.mp4", images: ["media/c-cover.jpg", "media/b.png"] }), true);
    expect(items.map((m) => m.src)).toEqual(["media/r1.mp4", "media/b.png"]);
  });
  it("başka çıktının görselleri videonun kapağı olmaz", () => {
    const items = mediaOf(run({ video: "media/u.mov", images: ["media/x-0.png", "media/x-1.png"] }), true);
    expect(items.map((m) => m.src)).toEqual(["media/u.mov", "media/x-0.png", "media/x-1.png"]);
  });
  it("cover olmadan ve videosuz eski davranış", () => {
    expect(mediaOf(run({ video: "media/r1.mp4", images: ["media/c.jpg"] })).map((m) => m.src)).toEqual(["media/r1.mp4", "media/c.jpg"]);
    expect(mediaOf(run({ images: ["media/a.jpg", "media/b.jpg"] }), true).map((m) => m.kind)).toEqual(["image", "image"]);
  });
});
