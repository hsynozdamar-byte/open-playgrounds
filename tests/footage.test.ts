import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.PG_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "pg-footage-"));
process.env.PG_NO_SCHEDULE = "1";
const { noteSeconds, pickFootage, videoWish } = await import("../server/prepare.mjs");

// Tek seferlik gönderinin brief'i oynanış görüntüsü istiyorsa ilk hazırlıkta da kayıttan kesit girer.
describe("brief oynanış görüntüsü isterse", () => {
  it("reads gameplay from a one-off post's brief, a later note still decides, a site is never read from the brief", () => {
    expect(videoWish({ post: { brief: "Oyunun içinden gerçek oynanış görüntüsüyle." } })).toBe("footage");
    expect(videoWish({ post: { brief: "Site linki sonda, web sitesi videosu." } })).toBe(null);
    expect(videoWish({ post: { brief: "Yeni oyunu tanıt." } })).toBe(null);
    expect(videoWish({ post: { brief: "Yeni oyunu tanıt." }, revisions: [{ at: "x", note: "sitenin videosunu ekle" }] })).toBe("site");
    expect(videoWish({ post: { brief: "Oynanış görüntüsüyle." }, revisions: [{ at: "x", note: "metni kısalt" }] })).toBe("footage");
  });
});

describe("revizede oynanış kesiti", () => {
  it("süreyi revize notundan okur, 6-90 sn arasında tutar", () => {
    expect(noteSeconds("1 dakikalik iyi bir oynanis olsun")).toBe(60);
    expect(noteSeconds("30 sn yeter")).toBe(30);
    expect(noteSeconds("3 dakika")).toBe(90);
    expect(noteSeconds("daha iyi bir görüntü bul")).toBe(15);
  });
  it("iyi işaretli kayıt yoksa aynı videoyu kesmez, nedenini söyler", async () => {
    const s = { projects: [{ id: "p", media: {} }], tasks: [], runs: [] };
    const task = { id: "t", revisions: [{ at: "2026-11-05T00:00:00Z", note: "daha iyi oynanış bul" }] };
    const r = await pickFootage(s, task, ["p"], { key: "a.mp4", from: 0, sec: 15 });
    expect(r.error).toMatch(/no gameplay recording/);
  });
});

// "Ekstra tasarım yapmadan" isteyen notta işin kendi görselleri şablonsuz girer;
// Instagram kırpmasın diye kesilmeden 4:5 kareye oturtulur, akışın kabul ettiği orandaki video olduğu gibi kalır.
describe("işin kendisi olduğu gibi paylaşılır", () => {
  it("fits images into a 4:5 frame without cropping; a video keeps its ratio unless it sits in a carousel", async () => {
    const { spawnSync } = await import("node:child_process");
    const { feedFrame } = await import("../server/prepare.mjs");
    const { MEDIA_DIR } = await import("../server/store.mjs");
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const make = (name: string, size: string, extra: string[] = []) => spawnSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=red:s=${size}`, ...extra, path.join(MEDIA_DIR, name)]);
    make("raw-r0.png", "390x844", ["-frames:v", "1"]);
    make("raw-v0.mp4", "1440x900", ["-t", "1", "-pix_fmt", "yuv420p"]);
    const size = (name: string) => spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path.join(MEDIA_DIR, name)], { encoding: "utf8" }).stdout.trim();
    feedFrame({ video: "media/raw-v0.mp4" }, "#ffffff");
    expect(size("raw-v0.mp4")).toBe("1440,900");
    // Carousel'de (görsel + video) video da aynı 4:5 kareye oturur: Instagram hepsini ilk karenin oranına kırpar.
    feedFrame({ images: ["media/raw-r0.png"], video: "media/raw-v0.mp4" }, "#ffffff");
    expect(size("raw-r0.png")).toBe("1080,1350");
    expect(size("raw-v0.mp4")).toBe("1080,1350");
  });
  it("is asked for by the clarified note and stays for later notes", async () => {
    // @ts-expect-error plain ESM module
    const { rawWish, parseClarity } = await import("../shared/revise.mjs");
    const c = parseClarity('{"ask":"İşin animasyonunu olduğu gibi paylaş.","media":"new","text":false,"visual":true,"raw":true}');
    expect(c).toMatchObject({ raw: true, v: 4 });
    expect(rawWish({ revisions: [{ at: "a", note: "x", clear: c }, { at: "b", note: "kısalt", clear: parseClarity('{"ask":"Kısalt.","media":"any"}') }] })).toBe(true);
    expect(rawWish({ revisions: [{ at: "b", note: "kısalt" }] })).toBe(false);
  });
});

describe("kalıcı kural işin kendisini istiyorsa ilk taslak da şablonsuz", () => {
  it("reads the work-as-is rules as work-as-is and leaves other rules alone", async () => {
    // @ts-expect-error plain ESM module
    const { rawRule } = await import("../shared/revise.mjs");
    expect(rawRule("- X gönderilerinde ilk görsel bento kolaj olsun; ondan sonraki görseller ek tasarım yapılmadan markaya ait işlerin kendisi olsun.")).toBe(true);
    expect(rawRule("- İlk kare bento olsun, sonraki kareler işin gerçek görselleri olsun.")).toBe(true);
    expect(rawRule("- Oyun gönderilerinde arka planı yapay zekâ çizsin.\n- Kapakta logo büyük olsun.")).toBe(false);
    expect(rawRule(undefined)).toBe(false);
  });
});
