import { describe, expect, it } from "vitest";
import { mediaFromItems } from "../src/ui/PostEditor";

describe("mediaFromItems", () => {
  it("keeps one video with its own cover first, then the images in order", () => {
    expect(mediaFromItems([
      { src: "media/r1-0.jpg", kind: "image" },
      { src: "media/v.mov", kind: "video", poster: "media/r1-cover.jpg" },
      { src: "media/b.png", kind: "image" },
      { src: "media/w.mp4", kind: "video" },
      { src: "https://x.y/z.png", kind: "image", remote: true },
    ])).toEqual({ video: "media/v.mov", images: ["media/r1-cover.jpg", "media/r1-0.jpg", "media/b.png"] });
  });
  it("removing everything leaves no media", () => {
    expect(mediaFromItems([])).toEqual({ video: undefined, images: [] });
  });
});
